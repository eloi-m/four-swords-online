// Online Shadow Battle, the deterministic part: the match settings the host sends with lobby.start(), the battle every
// peer builds from them (identical everywhere: nothing local, no Math.random), and the RollbackGame the net match runs,
// which also takes out the Link of a player who left (docs/netcode.md "Disconnects") and plays the CPU players: every
// peer (and spectator) works out their buttons inside the step from the state, so nothing about them is sent. A free
// room's matches are free play on the sim's free map (freeplay.ts), restarted with everyone where they stood whenever
// someone joins or leaves (a Link out comes back when its player rejoins), and the battles started from it. No DOM:
// tested in node.
import type { RollbackGame } from "@fso/net";
import {
  addCpus,
  ARENA_ROOMS,
  cloneGame,
  CPU_LEVELS,
  cpuInputs,
  createBattle,
  createFighter,
  createFreePlay,
  DEFAULT_RULES,
  FREE_H,
  FREE_W,
  hashGame,
  HEART,
  HEART_OPTIONS,
  MAX_FIGHTERS,
  MAX_LINKS,
  moreSpawns,
  NO_PROPS,
  stepGame,
  SUBPX,
  type ArenaProps,
  type CpuLevel,
  type Facing,
  type GameState,
  type Spawn,
  type World,
} from "@fso/sim";

/**
 * Bumped whenever the settings or the online rules change meaning: peers refuse a match of another version.
 * 2: arenas have their props (hazards, orbs, bushes) and the battle's random generator is seeded from the lobby.
 * 3: the arenas' switch network (logic actors, pots on switches, the colored panels, gated orbs and hazards).
 * 4: CPU players (`cpus`), played by every peer inside the step (the sim's cpu.ts).
 * 5: the battle constants read from main.dol.
 * 6: the arenas measured in Dolphin (orb generators' timing, soldiers, jets, bombs, Vaati's time-up).
 * 7: free rooms' matches (`mode`): free play with the Links' places (`at`), and battles of up to 8 Links.
 * 8: the side rooms (doors into The Field's house and cave and the Tower of Flames' rooms, holes, side-view rooms and
 *    cannons, Hyrule Castle's dark side through its magic circles; their actors and switches), no shelter from Vaati.
 * 9: the round's measured timings (the 409-tick intro, the result 423 ticks after the knockout, the Total screen
 *    between rounds) and the knockout ticks (`BattleState.downs`).
 * 10: the Tower of Winds in side view (gravity, ladders), its gates and gallery, the giant-bomb Shadow Link; bombchus
 *    (spawners and the orbs' roulette); things falling in side view; CPUs following rivals into side rooms.
 * 11: the message window's requests the state logs (`BattleState.messages`: the castle circle, the orb, the giant bomb).
 * 12: items as traced: drawn arrows and seeds, item levels, the Four Sword as a sword level, items taken with Action,
 *    orbs dropping and items popping up, the bomb's timing and level-2 blast, the boomerang's hook.
 * 13: things thrown or shot through doors and holes (`Entity.warpTicks`…), the push state (`Fighter.push`), the house
 *    door pushed open, pots thrown as bombs fly.
 * 14: the pot tile 0x41 covers a floor switch (arenatiles.ts, from Hyrule Castle).
 * 15: bombs as traced (a blast hurts 12 ticks and sets bombs off at once), the eternal flames burning a tick after they
 *    light, Hyrule Castle's soldiers' patrol, sight and knockback.
 * 16: CPUs use the arenas' floor switches and crystals (cpuswitches.ts: the bombchus, the jets, bombs into side rooms…),
 *    hit stunned rivals.
 * 17: rejoining a running match (the packets' rejoins, the snapshot a player still in it sends through the lobby).
 * 18: battle leftovers traced: a bumped Link's walk frames (`Fighter.bumped`), the trick floor's far edges, a trampled
 *    Link held at a wall, the cucco's 22.5° heading steps, shots on the ground and the quick seed's arc.
 * 19: arbitrated disconnects (the packets' u16 flags, lost reports, relayed inputs, cuts with what the sender holds),
 *    spectators fed by the next player when P1 goes, a rejoin asked of every player.
 * 20: rejoining a free room's matches: a free play's Link out (a player who left) comes back when its inputs do.
 * 21: the Pegasus Boots (The Field's third item: dash, crash, the hop near it), DOSN thud switches, bees woken only by a
 *    ground impact.
 * 22: Hyrule Castle's GEN3 bow soldiers (SLR2, their arrows) and captain (SLR4: his lunge, spear and shield).
 * 23: Hyrule Castle's GEN3 ball-and-chain soldier (SLR3: his swinging ball, its clank on swords).
 * 24: CPUs light crystals that need several blasts at once (cpuswitches.ts volleyOf: bombs put down, or thrown up in the
 *    Tower of Winds' gallery) and throw bombs and pots through doors and holes at a rival in a side room.
 * 25: the Magic Hammer (its pound flattens, a charged one is a ground impact) and the Fire Rod (fireballs, its stream,
 *    burning Links), Hyrule Castle's side rooms' last two items.
 * 26: the boots' dash strikes what a sword strikes (pots, orbs, bushes, soldiers, bees), a level-2 crash jolts within
 *    100 px, jolted Links land dizzy (state 12); CPUs use the boots, the hammer and the Fire Rod.
 * 27: splits refereed (only a majority cuts; a tie goes to the lobby's first claim, the other side drops out and
 *    rejoins), a free room's players away keep their places through restarts (absent from frame 0, `start` with `keep`).
 * 28: the Fire Rod and the hammer traced: a 13-tick rod pose, the fireball from 0 px/tick, flames trailing their Link by
 *    a tick, BLZE flames where fire meets a wall or burns a bush, shallow water puts a burning Link out, the stream back
 *    60 ticks after a wall; a charged pound sets no thud switch and doesn't jolt a flattened Link.
 * 29: CPUs and fire: a burning CPU steers its run (off pits, hazards and walls, to shallow water, into a rival); CPUs
 *    keep off BLZE flames (round them) and burning Links, and the better ones off fireballs.
 */
export const ONLINE_VERSION = 29;

/** A free room's match: free play on the free map, or a Shadow Battle for everyone who was on it. */
export type MatchMode = "free" | "battle";
export const MATCH_MODES: readonly MatchMode[] = ["free", "battle"];
/** Where a Link stood when the host restarted free play: the player's member id, his anchor (px), his facing. */
export type FreeSpot = [id: number, x: number, y: number, facing: Facing];
const FACINGS: readonly Facing[] = ["down", "up", "left", "right"];
const MAX_MEMBER_ID = 255;

/** What the host picks for a match (lobby.start(config); also shared in the room before the start). */
export interface MatchConfig {
  v: number;
  /** boss500 room (0-9). */
  arena: number;
  hearts: number;
  /** Seconds per round, 0 = no limit. */
  time: number;
  /** Stars (round wins) needed to win the match. */
  wins: number;
  /** Input delay in frames, or AUTO_DELAY: each peer adapts its own to the round-trip time (packages/net session). */
  delay: number;
  /** CPU players' levels: they take the slots after the room's players (as many as fit in 4). */
  cpus: CpuLevel[];
  /** A free room's match (absent in a room with a code): the rules above only count for a battle. */
  mode?: MatchMode;
  /** Free play: the Links that stay where they were (the rest of the room's players get free spawns). */
  at?: FreeSpot[];
}

/** The input delay adapting to the network (`MatchConfig.delay`): from AUTO_DELAY_START, between 1 and MAX_DELAY. */
export const AUTO_DELAY = -1;
export const AUTO_DELAY_START = 2;
export const DEFAULT_CONFIG: MatchConfig = { v: ONLINE_VERSION, arena: 0, hearts: DEFAULT_RULES.hearts, time: 0, wins: 3, delay: AUTO_DELAY, cpus: [] };
export const TIME_OPTIONS = [0, 60, 120, 180, 300] as const;
export const WIN_OPTIONS = [1, 2, 3, 5] as const;
export const MAX_TIME = 600;
export const MAX_DELAY = 6;

const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const levels = (v: unknown): CpuLevel[] | null =>
  Array.isArray(v) && v.length < MAX_FIGHTERS && v.every((l) => (CPU_LEVELS as readonly unknown[]).includes(l)) ? (v as CpuLevel[]) : null;

/** The config from a start message, checked: throws with a message a player can read. */
export function parseConfig(raw: unknown): MatchConfig {
  const c = (raw ?? {}) as Partial<Record<keyof MatchConfig, unknown>>;
  if (c.v !== ONLINE_VERSION) throw new Error(`the host runs another version of the online mode (${String(c.v)}, we have ${ONLINE_VERSION}): reload the page`);
  const arena = int(c.arena), hearts = int(c.hearts), time = int(c.time), wins = int(c.wins), delay = int(c.delay);
  if (arena === null || !(ARENA_ROOMS as readonly number[]).includes(arena)) throw new Error(`bad arena ${String(c.arena)}`);
  if (hearts === null || !(HEART_OPTIONS as readonly number[]).includes(hearts)) throw new Error(`bad hearts ${String(c.hearts)}`);
  if (time === null || time < 0 || time > MAX_TIME) throw new Error(`bad time limit ${String(c.time)}`);
  if (wins === null || wins < 1 || wins > 9) throw new Error(`bad wins ${String(c.wins)}`);
  if (delay === null || delay < AUTO_DELAY || delay > MAX_DELAY) throw new Error(`bad input delay ${String(c.delay)}`);
  const cpus = levels(c.cpus ?? []);
  if (!cpus) throw new Error(`bad CPU players ${JSON.stringify(c.cpus)}`);
  const mode = c.mode;
  if (mode !== undefined && !(MATCH_MODES as readonly unknown[]).includes(mode)) throw new Error(`bad mode ${JSON.stringify(mode)}`);
  const at = c.at === undefined ? undefined : spots(c.at);
  if (at === null || (at && mode !== "free")) throw new Error(`bad free play places ${JSON.stringify(c.at)}`);
  return { v: ONLINE_VERSION, arena, hearts, time, wins, delay, cpus: [...cpus], ...(mode ? { mode: mode as MatchMode } : {}), ...(at ? { at } : {}) };
}

/** `at` checked: up to 8 distinct members, each on the free map with a facing. */
function spots(v: unknown): FreeSpot[] | null {
  if (!Array.isArray(v) || v.length > MAX_LINKS) return null;
  const out: FreeSpot[] = [];
  for (const s of v as unknown[]) {
    if (!Array.isArray(s) || s.length !== 4) return null;
    const [id, x, y, facing] = s as unknown[];
    if (int(id) === null || (id as number) < 1 || (id as number) > MAX_MEMBER_ID || out.some((o) => o[0] === id)) return null;
    if (int(x) === null || (x as number) < 0 || (x as number) >= FREE_W || int(y) === null || (y as number) < 0 || (y as number) >= FREE_H) return null;
    if (!(FACINGS as readonly unknown[]).includes(facing)) return null;
    out.push([id as number, x as number, y as number, facing as Facing]);
  }
  return out;
}

/** Settings from a menu, a deep link or a stored preference, brought back to valid values. */
export function cleanConfig(partial: Partial<MatchConfig>): MatchConfig {
  const pick = <T extends number>(v: unknown, ok: (n: number) => boolean, fallback: T) => (typeof v === "number" && Number.isInteger(v) && ok(v) ? v : fallback);
  return {
    v: ONLINE_VERSION,
    arena: pick(partial.arena, (n) => (ARENA_ROOMS as readonly number[]).includes(n), DEFAULT_CONFIG.arena),
    hearts: pick(partial.hearts, (n) => (HEART_OPTIONS as readonly number[]).includes(n), DEFAULT_CONFIG.hearts),
    time: pick(partial.time, (n) => n >= 0 && n <= MAX_TIME, DEFAULT_CONFIG.time),
    wins: pick(partial.wins, (n) => n >= 1 && n <= 9, DEFAULT_CONFIG.wins),
    delay: pick(partial.delay, (n) => n >= AUTO_DELAY && n <= MAX_DELAY, DEFAULT_CONFIG.delay),
    cpus: [...(levels(partial.cpus) ?? DEFAULT_CONFIG.cpus)],
  };
}

/** The session's input delay options for a config: fixed, or adapting from AUTO_DELAY_START. */
export function delayOptions(config: MatchConfig): { inputDelay: number; adaptiveDelay?: { min: number; max: number } } {
  return config.delay === AUTO_DELAY ? { inputDelay: AUTO_DELAY_START, adaptiveDelay: { min: 1, max: MAX_DELAY } } : { inputDelay: config.delay };
}

/** The CPU players of a match with `humans` players in the room: the config's, as many as fit in 4. */
export function cpuSlots(config: MatchConfig, humans: number): CpuLevel[] {
  return config.cpus.slice(0, Math.max(0, MAX_FIGHTERS - humans));
}

/**
 * Frame 0 of a match: `players` Links for the room's players, then the CPU players (cpuSlots), on the arena's first
 * starts (arenaSpawns; a free room's battle of more than 4 on moreSpawns), with the arena's props (arenaProps:
 * hazards, orb generators, bushes). `seed` is the lobby's seed, the same for everyone: it seeds the battle's random
 * generator (what the item orbs hold) and the CPUs', which live in the state.
 */
export function initialBattle(spawns: readonly Spawn[], config: MatchConfig, players: number, seed: number, props: ArenaProps = NO_PROPS): GameState {
  const cpus = cpuSlots(config, players), total = players + cpus.length;
  const most = config.mode === "battle" ? MAX_LINKS : MAX_FIGHTERS;
  if (players < 1 || total < 2 || total > most) throw new Error(`a battle needs 2-${most} players, the room has ${players}${cpus.length ? ` and ${cpus.length} CPUs` : ""}`);
  const starts = config.mode === "battle" && total > spawns.length ? moreSpawns(spawns) : spawns;
  if (starts.length < total) throw new Error(`arena ${config.arena} has only ${starts.length} starts`);
  const state = createBattle(config.arena, starts.slice(0, total), { hearts: config.hearts, timeLimit: config.time * 60, wins: config.wins }, props, seed);
  return addCpus(state, cpus.map((level, k) => ({ player: players + k, level })));
}

/**
 * Frame 0 of free play for the room's players (`players`: member ids by player index) on the free map: the ones in
 * `config.at` where they stood, the others on free spawns (createFreePlay).
 */
export function initialFree(world: World, config: MatchConfig, players: readonly number[], seed: number): GameState {
  const at = new Map((config.at ?? []).map(([id, x, y, facing]) => [id, { x, y, facing }]));
  return createFreePlay(world, players.length, seed, players.map((id) => at.get(id)));
}

/**
 * Where the Links of free play stand in `state` (px, rounded down), by member id (`players`: member ids by player
 * index), for the next free play's `at`; Links out (a player who left) aren't listed, but for the players `away` who
 * keep their places in it (out where they stood, until they rejoin).
 */
export function freeSpots(state: GameState, players: readonly number[], away: readonly number[] = []): FreeSpot[] {
  const fighters = state.battle?.fighters ?? [];
  return state.players.flatMap((p, i): FreeSpot[] => {
    const id = players[i];
    if (id === undefined || (fighters[i]?.mode === "dead" && !away.includes(id))) return [];
    const x = Math.min(FREE_W - 1, Math.max(0, Math.floor(p.x / SUBPX))), y = Math.min(FREE_H - 1, Math.max(0, Math.floor(p.y / SUBPX)));
    return [[id, x, y, p.facing]];
  });
}

/**
 * What the host's free-play restart keeps of the running match (free play, or a battle started from it; `players`:
 * member ids by player index): its players `away` (the lobby's `keep`: their places, out until they rejoin), and where
 * free play's Links stand (`at`). A battle's arena isn't free play's map: after one, everyone gets a free spawn, the
 * players away too.
 */
export function freeRestart(mode: MatchMode | undefined, state: GameState, players: readonly number[], away: readonly number[]): { keep: number[]; at: FreeSpot[] } {
  const keep = players.filter((id) => away.includes(id));
  return { keep, at: mode === "free" ? freeSpots(state, players, keep) : [] };
}

/**
 * The input a player who left gets from then on (the session's `disconnectedInput`): a bit above the sim's buttons
 * (Button uses bits 0-6), so the step below can tell a departed player from one standing still.
 */
export const PLAYER_LEFT = 0x8000;

/**
 * The battle as the rollback session runs it: stepGame with the CPU players' buttons worked out from the state
 * (cpuInputs: the session's inputs are the room's players only), plus the departed players taken out. Their Links stay
 * out of every later round (the round's reset brings every fighter back, so it's applied again after the step); their
 * stars stay for the results. Pure function of (state, inputs), like stepGame: every peer removes the Link at the same
 * frame, the one after the session's cut, and every peer's CPUs press the same buttons. Free play has no rounds: a Link
 * out comes back where it stood on the first frame its player's inputs do (a rejoin, docs/netcode.md "Rejoining").
 */
export function battleGame(world: World): RollbackGame<GameState> {
  return {
    clone: cloneGame,
    hash: hashGame,
    step(state, inputs) {
      let left = 0;
      for (let i = 0; i < inputs.length; i++) if (inputs[i]! & PLAYER_LEFT) left |= 1 << i;
      if (state.battle?.phase === "free") comeBack(state, ~left & ((1 << inputs.length) - 1));
      if (left === 0) return stepGame(state, cpuInputs(state, world, inputs), world);
      retire(state, left);
      stepGame(state, cpuInputs(state, world, inputs.map((v) => (v & PLAYER_LEFT ? 0 : v))), world);
      retire(state, left);
      return state;
    },
  };
}

/** Free play: the Links in `mask` that are out (retire) come back where they stand, as new, their stars kept. */
function comeBack(state: GameState, mask: number): void {
  const b = state.battle!;
  b.fighters.forEach((f, i) => {
    if (!(mask & (1 << i)) || f.mode !== "dead" || f.hearts !== 0) return;
    b.fighters[i] = { ...createFighter(b.rules.hearts * HEART, { x: f.spawnX, y: f.spawnY, facing: f.spawnFacing }), stars: f.stars };
  });
}

/**
 * Takes the Links in `mask` (one bit per player index) out of the round: no hearts, not drawn, not hittable. Whatever
 * he was doing stops (a Link held by him drops on the next tick, and a Link holding him lets go: carry.ts's
 * attachLoads sees to both); his item goes. Things he threw or shot keep flying.
 */
export function retire(state: GameState, mask: number): void {
  const fighters = state.battle?.fighters;
  if (!fighters) return;
  fighters.forEach((f, i) => {
    if (!(mask & (1 << i)) || (f.mode === "dead" && f.hearts === 0)) return;
    Object.assign(f, { hearts: 0, mode: "dead", modeTick: 0, invincible: 0, pushX: 0, pushY: 0 });
    Object.assign(f, { move: "none", moveTick: 0, heldBy: -1, z: 0, vz: 0, flyX: 0, flyY: 0, thrower: -1, escape: 0, item: "", itemTimer: 0, dark: 0, circle: -1, warp: -1, warpLatch: 0 });
    const p = state.players[i];
    if (p) Object.assign(p, { action: "none", actionTick: 0, moving: false, walkTicks: 0 });
  });
}
