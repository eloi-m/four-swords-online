// Shadow Battle rules: 2-4 Links in one arena (up to 8 here), the last one standing wins the round (a star), and the
// first to `rules.wins` stars wins the match. Phases: countdown → play → roundOver → countdown (next round) … →
// matchOver. Free play (rules.free) is one endless "free" phase instead: the same fight, but nobody ever loses a heart.
// Everything lives in GameState.battle and advances only through stepGame. Lifting, rolling, items, orbs, the doors to
// the side rooms and the arena's hazards live in their own modules (moves.ts, siderooms.ts, arenastep.ts and what they
// call), on the entities and props kept here.
import { stepArena, stepStrikes } from "./arenastep.ts";
import { flyThrownLinks, landSlams } from "./carry.ts";
import { createFighter, dragHooked, HEART, resolveHits, separateLinks, stepFighter, type Fighter, type Hit, type MoveHook } from "./combat.ts";
import type { CpuBrain } from "./cpu.ts";
import { battleWorld, type Entity } from "./entities.ts";
import type { GameState } from "./game.ts";
import { spawnArena } from "./hazards.ts";
import { pruneMessages, type BattleMessage } from "./messages.ts";
import { moveHook } from "./moves.ts";
import { createPlayer, type Facing } from "./player.ts";
import { NO_PROPS, type ArenaProps } from "./props.ts";
import { notePushing } from "./push.ts";
import { sideViewAt, sideViewFall, stepWarps } from "./siderooms.ts";
import { startTimeUp, stepTimeUp } from "./timeup.ts";
import type { World } from "./world.ts";

/**
 * The round's intro, from the arena showing to the Links' control (measured: 409 frames, "Battle measurements: arenas,
 * orbs and camera"; what shows meanwhile, "J2D screens in Dolphin": "Be the last one standing!", then "Go!"). Every
 * round has it: each round is one of the game's battles, which all start this way.
 */
export const COUNTDOWN_TICKS = 409;
/**
 * From the knockout to the game's "PRESS START" (measured: BFIN's states 1, 2, 3 and 5 start 137, 0, 130 and 25 frames
 * apart and the last lasts 130, so its waiting state 6 comes 423 frames after the knockout). The match's last round
 * ends here (matchOver); the game waits for A, then shows its Total screen.
 */
export const RESULT_TICKS = 423;
/**
 * The Total screen (the stars so far) between rounds, after RESULT_TICKS: the game's own sequence up to its star
 * landing (110 frames), a second to see it, and the fade back (ours: the game waits for a press, then picks an area).
 */
export const TOTAL_TICKS = 195;
/** A round that doesn't end the match: its result, then the Total screen. */
export const ROUND_OVER_TICKS = RESULT_TICKS + TOTAL_TICKS;
/**
 * Starting hearts. The game's Shadow Battle gives every Link 12 life (3 hearts, traced for 2-4 players); its settings
 * (the GBA's Rules: Vaati, Powerful Items, Status Display; and a Handicap) have no hearts setting, so 3 is the default
 * and the others are this implementation's own.
 */
export const HEART_OPTIONS = [2, 3, 4, 6] as const;
/** Players in a local match or an online room (the game's 4). */
export const MAX_FIGHTERS = 4;
/** Links createBattle takes: free play's crowd, and the battle it turns into on The Field (arena.ts moreSpawns). */
export const MAX_LINKS = 8;

export interface BattleRules {
  hearts: number; // starting hearts (HEART_OPTIONS; the game's are 3)
  timeLimit: number; // ticks per round, 0 = none
  wins: number; // stars needed to win the match
  /** At time-out Vaati drops his giant bomb (timeup.ts; the default); false: the most hearts wins at once. */
  vaatiBomb?: boolean;
  /**
   * Free play: the "free" phase for good, no rounds, no time limit, no Vaati. Hits land as usual (knockback,
   * invincibility, falls) but the hearts they take come back on the same tick.
   */
  free?: boolean;
}

export const DEFAULT_RULES: BattleRules = { hearts: 3, timeLimit: 0, wins: 3 };

export type BattlePhase = "countdown" | "play" | "roundOver" | "matchOver" | "free";

export interface BattleState {
  rules: BattleRules;
  phase: BattlePhase;
  phaseTick: number; // ticks since the phase started
  round: number; // 1-based
  timeLeft: number; // ticks left in the round when there's a time limit
  roundWinner: number; // player index, -1 for a draw (or before the round ends)
  matchWinner: number; // player index once the match is over, else -1
  fighters: Fighter[]; // index-aligned with GameState.players
  hits: Hit[]; // hits landed or blocked this tick (for effects and sounds)
  /** The arena's hazards, switches, orb generators and bushes (props.ts); never changes during a match. */
  props: ArenaProps;
  /** Everything else in the arena: carried and thrown things, bombs, shots, orbs, hazards (entities.ts). */
  entities: Entity[];
  nextId: number; // id of the next entity (ids start at 1; 0 = none)
  rng: number; // the battle's random generator state (orb contents, bee wobble), a u32
  cut: number[]; // bush tiles cut or lifted this round, door tiles opened (tile index ty * 32 + tx)
  respawn: number[]; // per prop: ticks until its entity comes back (orbs, socket bombs, soldiers, bees), 0 = none
  timeUp: number; // ticks until Vaati's giant bomb goes off, 0 = not dropped
  /** The room's 32 switches (switches.ts), bit n = switch n; cleared at each round's start. */
  switches: number;
  /** Above the Clouds' colored floor panels (panels.ts): per RBPN prop, color << 16 | timer. */
  panels: number[];
  /** The players the computer plays (cpu.ts addCpus: their memory, by player), absent when all are human. */
  cpus?: CpuBrain[];
  /**
   * Per player: `GameState.tick` right after the step that took his last heart this round, -1 while he still has
   * some (what the "P2 down!" message and the round's end are timed from).
   */
  downs: number[];
  /** The message window's requests the state can't tell afterwards (messages.ts), absent while there are none. */
  messages?: BattleMessage[];
}

/** A player start (px, arena-local) and the way Link faces there. */
export interface Spawn {
  x: number;
  y: number;
  facing: Facing;
}

/**
 * A new match in `room`, one Link per spawn (2-8, or 1-8 in free play). `props` are the arena's hazards and orb
 * generators (`arenaProps(stage, tileTypes, room)`); `seed` seeds the battle's random generator (the same on every peer
 * online).
 */
export function createBattle(room: number, spawns: readonly Spawn[], rules: BattleRules = DEFAULT_RULES, props: ArenaProps = NO_PROPS, seed = 1): GameState {
  const fewest = rules.free ? 1 : 2;
  if (spawns.length < fewest || spawns.length > MAX_LINKS) throw new Error(`${rules.free ? "Free play" : "Shadow Battle"} needs ${fewest}-${MAX_LINKS} players, got ${spawns.length}`);
  const battle: BattleState = {
    rules: { ...rules },
    phase: rules.free ? "free" : "countdown",
    phaseTick: 0,
    round: 1,
    timeLeft: rules.timeLimit,
    roundWinner: -1,
    matchWinner: -1,
    fighters: spawns.map((s) => createFighter(rules.hearts * HEART, s)),
    hits: [],
    props,
    entities: [],
    nextId: 1,
    rng: seed >>> 0 || 1,
    cut: [],
    respawn: [],
    timeUp: 0,
    switches: 0,
    panels: [],
    downs: spawns.map(() => -1),
  };
  spawnArena(battle);
  return { tick: 0, room, players: spawns.map((s) => createPlayer(s.x, s.y, s.facing)), battle };
}

/** Indices of the Links still in the round. */
export function standing(battle: BattleState): number[] {
  return battle.fighters.flatMap((f, i) => (f.hearts > 0 ? [i] : []));
}

function setPhase(b: BattleState, phase: BattlePhase): void {
  b.phase = phase;
  b.phaseTick = 0;
}

/** Advances a battle one tick. Called by stepGame when `state.battle` is set. */
export function stepBattle(state: GameState, inputs: readonly number[], world: World): GameState {
  const b = state.battle!;
  b.hits = [];
  const view = battleWorld(world, b); // the arena with its cut bushes and open trapdoors
  const moves = moveHook(state);
  switch (b.phase) {
    case "countdown":
      state.players.forEach((p, i) => (p.held = inputs[i] ?? 0)); // no control yet; a held button isn't a press at "go"
      if (++b.phaseTick >= COUNTDOWN_TICKS) setPhase(b, "play");
      break;
    case "play": {
      fight(state, inputs, view, moves);
      const left = standing(b);
      if (left.length <= 1) endRound(b, left[0] ?? -1);
      else if (b.timeUp > 0) {
        const winner = stepTimeUp(state);
        if (winner !== undefined) endRound(b, winner);
      } else if (b.rules.timeLimit > 0 && --b.timeLeft <= 0) {
        b.timeLeft = 0;
        if (b.rules.vaatiBomb === false) endRound(b, timeUpWinner(b, left));
        else startTimeUp(b);
      }
      break;
    }
    case "roundOver": {
      // Animations (knockback, death…) play out; nobody is in control.
      separateLinks(state.players, b.fighters, view);
      const before = state.players.map((p) => p.y);
      state.players.forEach((p, i) => stepFighter(p, b.fighters[i]!, 0, view, moves));
      flyThrownLinks(state, view);
      dragHooked(state.players, b.fighters, view, b.entities);
      sideViewFall(state, view, before);
      stepArena(state, view, false);
      {
        // The match's last round ends with its result; the others go on to the Total screen, then the next round.
        const champion = b.fighters.findIndex((f) => f.stars >= b.rules.wins);
        if (++b.phaseTick >= (champion >= 0 ? RESULT_TICKS : ROUND_OVER_TICKS)) {
          if (champion >= 0) {
            b.matchWinner = champion;
            setPhase(b, "matchOver");
          } else nextRound(state);
        }
      }
      break;
    }
    case "matchOver":
      state.players.forEach((p, i) => stepFighter(p, b.fighters[i]!, 0, view, moves));
      stepArena(state, view, false);
      b.phaseTick++;
      break;
    case "free":
      fight(state, inputs, view, moves);
      // Undoes every kind of damage at once (swords, shots, bombs, thrown Links, pits). Checked by mode, not hearts: a
      // hit that took the last heart leaves him "hurt" and he lands on his feet, while a retired Link ("dead", a
      // player who left) stays out.
      for (const f of b.fighters) if (f.mode !== "dead" && f.mode !== "dying") f.hearts = b.rules.hearts * HEART;
      break;
  }
  state.tick++;
  pruneMessages(state);
  // Knockouts (a Link taken out of an online match goes straight to "dead": not one).
  b.fighters.forEach((f, i) => {
    if (f.hearts <= 0 && f.mode !== "dead" && b.downs[i]! < 0) b.downs[i] = state.tick;
  });
  return state;
}

/** A tick of the fight, everyone in control: the Links move, then the arena, then the hits. */
function fight(state: GameState, inputs: readonly number[], view: World, moves: MoveHook): void {
  const b = state.battle!;
  separateLinks(state.players, b.fighters, view);
  const before = state.players.map((p) => p.y), held = state.players.map((p) => p.held);
  state.players.forEach((p, i) => {
    const f = b.fighters[i]!, x0 = p.x, y0 = p.y;
    const side = sideViewAt(b, p.y);
    stepFighter(p, f, inputs[i] ?? 0, view, moves, !side);
    if (!side) notePushing(f.push, p, f, x0, y0); // leaning on a wall he walked into (push.ts)
  });
  flyThrownLinks(state, view);
  landSlams(state);
  dragHooked(state.players, b.fighters, view, b.entities);
  sideViewFall(state, view, before); // gravity on the side-view screens
  stepWarps(state, state.players.map((p, i) => p.held & ~held[i]!)); // doors into and out of the side rooms, once everyone moved
  stepArena(state, view, true);
  b.hits.push(...resolveHits(state.players, b.fighters));
  stepStrikes(state);
  b.phaseTick++;
}

// With the giant bomb off (rules.vaatiBomb false), the most hearts wins at time-out, and a tie is a draw.
function timeUpWinner(b: BattleState, left: number[]): number {
  const best = Math.max(...left.map((i) => b.fighters[i]!.hearts));
  const leaders = left.filter((i) => b.fighters[i]!.hearts === best);
  return leaders.length === 1 ? leaders[0]! : -1;
}

function endRound(b: BattleState, winner: number): void {
  b.roundWinner = winner;
  if (winner >= 0) b.fighters[winner]!.stars++;
  setPhase(b, "roundOver");
}

function nextRound(state: GameState): void {
  const b = state.battle!;
  b.round++;
  b.timeLeft = b.rules.timeLimit;
  b.timeUp = 0;
  b.roundWinner = -1;
  b.fighters = b.fighters.map((f) => ({ ...createFighter(b.rules.hearts * HEART, { x: f.spawnX, y: f.spawnY, facing: f.spawnFacing }), stars: f.stars }));
  state.players.forEach((p, i) => {
    const f = b.fighters[i]!;
    Object.assign(p, createPlayer(f.spawnX, f.spawnY, f.spawnFacing), { held: p.held });
  });
  b.downs = b.fighters.map(() => -1);
  spawnArena(b);
  setPhase(b, "countdown");
}

/** A rematch with the same arena, players (CPUs included), rules and props (the random generators carry on). */
export function restartBattle(state: GameState): GameState {
  const b = state.battle!;
  const spawns = b.fighters.map((f) => ({ x: f.spawnX, y: f.spawnY, facing: f.spawnFacing }));
  const next = createBattle(state.room, spawns, b.rules, b.props, b.rng);
  if (b.cpus) next.battle!.cpus = b.cpus.map((c) => ({ ...c }));
  return next;
}

export function cloneBattle(b: BattleState): BattleState {
  return {
    ...b,
    rules: { ...b.rules },
    fighters: b.fighters.map((f) => ({ ...f, push: { ...f.push } })),
    hits: b.hits.map((h) => ({ ...h })),
    entities: b.entities.map((e) => ({ ...e })),
    cut: [...b.cut],
    respawn: [...b.respawn],
    panels: [...b.panels],
    downs: [...b.downs],
    ...(b.messages ? { messages: [...b.messages] } : {}), // (requests never change once made)
    ...(b.cpus ? { cpus: b.cpus.map((c) => ({ ...c })) } : {}),
    // props never change during a match: shared
  };
}
