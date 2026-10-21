// Time-out: when a round's time limit runs out, Vaati comes (TUGF "TimeUp Gufuu", spawned by the stage timer
// 0x802D3A18 in multiplayer) and knocks out every Link. Measured in Dolphin (docs/measurements/battle-arenas.md "Battle measurements:
// arenas, orbs and camera"; The Field, the Vaati rule's flag stage +0x131F0 set and its timer +0xC4, 10800 frames = 3
// minutes, poked to 400): he appears 64 px past the arena's right edge, 100 px up, flies in at 2 px/frame for 60
// frames, loops twice over the arena at about 5 px/frame and leaves to the left at 6 px/frame; 454 frames after the
// time-out every Link's life is 0 (hit type 18), no bomb. Play goes on meanwhile. His loop here is a circle round the
// middle of the arena (the game's steers: a loop about 110 px across every 150-160 frames). There's no shelter: a Link
// inside The Field's house (a side room) went out on the same frame as the one outside (measured, docs/measurements/side-rooms.md
// "Side rooms"), so the round is a draw. The entity keeps its old kind, "giantBomb".
import { ARENA_W } from "./arena.ts";
import type { BattleState } from "./battle.ts";
import { knockOut } from "./combat.ts";
import { cos4096, isRemoved, removeEntity, sin4096, spawnEntity, TRIG_ONE, type Entity } from "./entities.ts";
import type { GameState } from "./game.ts";
import { SUBPX } from "./player.ts";

export const VAATI_TICKS = 454; // from the time-out to the knockout
/** Where he appears (arena px) and how high he flies. */
export const VAATI_START = { x: ARENA_W + 64, y: 288 } as const;
export const VAATI_HEIGHT = 100;
export const VAATI_ENTER_TICKS = 60; // flying in…
export const VAATI_ENTER_SPEED = 2 * SUBPX; // …at 2 px/tick
export const VAATI_LOOP_SPEED = 5 * SUBPX;
export const VAATI_LOOP_RADIUS = 120; // px, round the arena's middle
export const VAATI_LOOP_STEP = 434; // angle units a tick: a turn in 151 ticks, 5 px/tick on that circle
export const VAATI_LEAVE_TICK = 375; // then off to the left…
export const VAATI_LEAVE_SPEED = 6 * SUBPX; // …at 6 px/tick
/** The old names (the time-out's length; he flies, nothing falls). */
export const GIANT_BOMB_TICKS = VAATI_TICKS;

const LOOP_CENTER = { x: (ARENA_W / 2) * SUBPX, y: VAATI_START.y * SUBPX };

/** Starts the countdown to the knockout: Vaati comes. */
export function startTimeUp(b: BattleState): void {
  b.timeUp = VAATI_TICKS;
  spawnEntity(b, "giantBomb", VAATI_START.x * SUBPX, VAATI_START.y * SUBPX, { timer: VAATI_TICKS, z: VAATI_HEIGHT * SUBPX, phase: "flying" });
}

/**
 * Vaati's flight, one tick (`e.tick` ticks since he came): in from the right, a glide to his loop's rightmost point,
 * loops clockwise (`e.angle`), then away to the left.
 */
function flyVaati(e: Entity): void {
  e.tick++;
  const r = VAATI_LOOP_RADIUS * SUBPX, loopX = LOOP_CENTER.x + r;
  if (e.tick <= VAATI_ENTER_TICKS) {
    e.x -= VAATI_ENTER_SPEED;
  } else if (e.tick < VAATI_LEAVE_TICK && e.x > loopX && e.phase === "flying") {
    e.x = Math.max(loopX, e.x - VAATI_LOOP_SPEED); // (the game swings down into his loop from there)
    if (e.x === loopX) e.phase = "chase";
  } else if (e.tick < VAATI_LEAVE_TICK) {
    e.phase = "chase";
    e.angle = (e.angle + VAATI_LOOP_STEP) & 0xffff;
    e.x = LOOP_CENTER.x + Math.trunc((r * cos4096(e.angle)) / TRIG_ONE);
    e.y = LOOP_CENTER.y + Math.trunc((r * sin4096(e.angle)) / TRIG_ONE);
  } else {
    e.phase = "return";
    e.x -= VAATI_LEAVE_SPEED;
  }
}

/**
 * Advances the countdown (Vaati flies). Returns the round's winner (-1 for a draw) on the tick he knocks everyone
 * out, else undefined.
 */
export function stepTimeUp(state: GameState): number | undefined {
  const b = state.battle!;
  const vaati = b.entities.find((e) => e.kind === "giantBomb" && !isRemoved(e));
  if (vaati) flyVaati(vaati);
  if (--b.timeUp > 0) return undefined;
  if (vaati) removeEntity(vaati);
  state.players.forEach((p, i) => {
    const f = b.fighters[i]!;
    if (f.hearts > 0) knockOut(p, f); // everyone, side rooms included (measured)
  });
  const left = b.fighters.flatMap((f, i) => (f.hearts > 0 ? [i] : []));
  if (left.length <= 1) return left[0] ?? -1;
  const best = Math.max(...left.map((i) => b.fighters[i]!.hearts));
  const leaders = left.filter((i) => b.fighters[i]!.hearts === best);
  return leaders.length === 1 ? leaders[0]! : -1;
}

