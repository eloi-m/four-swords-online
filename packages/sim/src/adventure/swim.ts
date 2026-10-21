// Swimming in deep water (tile types 0x0d, 0x3b, 0x3e and the water around 0x5c-0x5f's walls), seen from above.
// Measured in Dolphin (docs/measurements/adventure-lake-hylia.md "Adventure: swimming and ledges"; Lake Hylia room 2's river, state 74):
// - a Link walking into deep water swims from the tick after the one that put all four of his side sensors (±7 px) in
//   it (walking down from the pier: at y 183 with the water from 176, not at 181.5); he's back on his feet the tick
//   after his anchor leaves it (175.525 with the pier below 176), standing that tick, walking from the next;
// - he swims at 1 px/tick (0.707 per axis on diagonals) from the first tick, moving along the direction he swam the
//   tick before (from a stop, his facing; turning, the old way for one tick), facing the stick at once; with the stick
//   released he glides on, 0.025 px/tick slower every tick; no current in Lake Hylia's river (currents: CURRENT_TILES);
// - B dives: 7 ticks on he shows the underwater frames (504-507) and comes up 300 ticks after the press (frames
//   856-860: out of breath). R and A while diving speed him up for a while (not modelled);
// - the sword, items and lifting do nothing in water; room changes happen as on land (the same walk-on speed), for a
//   Link swimming toward the side;
// - the other Links follow the leader's trail in the water, swimming too.
import { Button, nextFacing, SUBPX, type PlayerState } from "../player.ts";
import { CELL, isSolidAt, surfaceAt, type World } from "../world.ts";
import type { AdventureGame } from "./adventure.ts";
import { DIAGONAL, dirOf, dirOfFacing, DIRS, DIVE_TICKS, type LinkMotion } from "./motion.ts";

/** Swim speeds are kept in 1/40 of 1/256 px per tick, so that the glide's slowdown of 0.025 px/tick is whole. */
export const SWIM_UNIT = 40 * SUBPX;
export const SWIM_SPEED = SWIM_UNIT; // 1 px/tick
export const SWIM_GLIDE_SLOWDOWN = SUBPX; // 0.025 px/tick each tick
export const SWIM_ANIMATION_TICKS = 24; // 4 frames of 6 ticks

const SIDES: readonly (readonly [number, number])[] = [[0, -7], [0, 7], [-7, 0], [7, 0]];
const DIRECTIONS = Button.Up | Button.Down | Button.Left | Button.Right;

const isDeep = (world: World, x: number, y: number) => surfaceAt(world, x, y) === "deep";

/** All four side sensors in deep water: a walking Link starts swimming. */
export function inDeepWater(world: World, p: Pick<PlayerState, "x" | "y">): boolean {
  const x = Math.floor(p.x / SUBPX), y = Math.floor(p.y / SUBPX);
  return SIDES.every(([sx, sy]) => isDeep(world, x + sx, y + sy));
}

/** The anchor in deep water: a swimming Link goes on swimming. */
export function anchorInDeepWater(world: World, p: Pick<PlayerState, "x" | "y">): boolean {
  return isDeep(world, Math.floor(p.x / SUBPX), Math.floor(p.y / SUBPX));
}

/** Starts swimming (from the next tick) when a walking Link has gone into deep water. */
export function enterWater(m: LinkMotion, p: PlayerState, world: World): boolean {
  if (m.mode !== "walk" || !inDeepWater(world, p)) return false;
  m.mode = "wade";
  m.tick = 0;
  m.speed = 0;
  m.dir = dirOfFacing(p.facing);
  m.vx = 0; // the dive's countdown
  p.action = "none";
  p.actionTick = 0;
  p.moving = false;
  p.walkTicks = 0;
  return true;
}

/**
 * A swimming step along one axis against the walls: taken whole, then undone half a px at a time while a leading
 * sensor is in a wall, but the sensors reach half a px further than on land (traced against room 2's rock: swimming
 * down he stopped at 232.02, 232.23, 232.43 with the rock from 240, where walking stops half a px nearer).
 * TODO(measure): the other sides and the corners (taken alike).
 */
function swimAxis(p: PlayerState, world: World, delta: number, axis: "x" | "y", onStone?: OnStone): void {
  if (!delta) return;
  const dir = Math.sign(delta), start = p[axis];
  const lead = SWIM_SENSORS.filter(([sx, sy]) => (axis === "x" ? sx : sy) * dir > 0);
  const at = (v: number, [sx, sy]: readonly [number, number]) => {
    const x = axis === "x" ? v : p.x, y = axis === "y" ? v : p.y;
    return [Math.floor((x + sx) / SUBPX), Math.floor((y + sy) / SUBPX)] as const;
  };
  const hit = (v: number) => lead.some((s) => isSolidAt(world, ...at(v, s)));
  // A river stone the whole step ran into (its first leading sensor that did: the side one before the corners).
  if (onStone && world.spikes) {
    const s = lead.find((s) => isStoneAt(world, ...at(start + delta, s)));
    if (s) onStone(s);
  }
  // The half-px steps back go on past where the step began (traced: gliding into the rock he bobs back and forth).
  let v = start + delta;
  for (let n = 0; n < 32 && hit(v); n++) v -= dir * (SUBPX / 2);
  p[axis] = v;
}

/** Told the sensor offset (1/256 px) that ran into a river stone (swimAxis). */
export type OnStone = (sensor: readonly [number, number]) => void;

const isStoneAt = (world: World, x: number, y: number) => {
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  return cx >= 0 && cy >= 0 && cx < world.widthCells && cy < world.heightCells && world.spikes![cy * world.widthCells + cx] === 1;
};

/**
 * The swimming Link's wall sensors, 1/256 px: ±7.5 px at the sides' middles (8 px up: swimming up into Tingle's Tower
 * room 0's ladder foot he stopped at y 208.0 under its solid half ending at 200), ±5.5 px at the corners.
 */
const SWIM_SENSORS: readonly (readonly [number, number])[] = [[0, -2048], [0, 1920], [-1920, 0], [1920, 0], [-1408, -1408], [1408, -1408], [-1408, 1408], [1408, 1408]];

/**
 * The water's currents (main.dol 0x80242DAC, run by the swimming states; traced in Tingle's Tower, below): the tile
 * under a swimming Link pushes him along, his drift growing by `step` px/tick every tick up to `max` (its length capped
 * there); off these tiles it shrinks by 0.05 px/tick to nothing. Slow ones (0xB4-0xB7, 0.05 up to 0.5) and fast ones
 * (0x95-0x98, 0.15 up to 2), each up, down, left, right. In Tingle's Tower, from `w1-boss012-start` (room 0's river,
 * 0xB6: swimming left 1.5 px/tick; room 1's, 0xB5: swimming right he went 1 across and 0.5 down, gliding to a stop
 * across while still going 0.5 down). Lake Hylia's river (room 2) has none.
 */
export const CURRENT_TILES: readonly { tile: number; dx: number; dy: number; step: number; max: number }[] = [
  { tile: 0xb4, dx: 0, dy: -1, step: SWIM_UNIT / 20, max: SWIM_UNIT / 2 },
  { tile: 0xb5, dx: 0, dy: 1, step: SWIM_UNIT / 20, max: SWIM_UNIT / 2 },
  { tile: 0xb6, dx: -1, dy: 0, step: SWIM_UNIT / 20, max: SWIM_UNIT / 2 },
  { tile: 0xb7, dx: 1, dy: 0, step: SWIM_UNIT / 20, max: SWIM_UNIT / 2 },
  { tile: 0x95, dx: 0, dy: -1, step: (SWIM_UNIT * 3) / 20, max: SWIM_UNIT * 2 },
  { tile: 0x96, dx: 0, dy: 1, step: (SWIM_UNIT * 3) / 20, max: SWIM_UNIT * 2 },
  { tile: 0x97, dx: -1, dy: 0, step: (SWIM_UNIT * 3) / 20, max: SWIM_UNIT * 2 },
  { tile: 0x98, dx: 1, dy: 0, step: (SWIM_UNIT * 3) / 20, max: SWIM_UNIT * 2 },
];
/** Off a current's tiles the drift shrinks by this much a tick (SWIM_UNIT per px/tick). */
export const CURRENT_FADE = SWIM_UNIT / 20;

/** Scales the drift (cx, cy) to the length `to` (the drift's own length `len`). Integer, deterministic (sqrt is exact). */
function scaleDrift(m: LinkMotion, len: number, to: number): void {
  m.cx = Math.round((m.cx * to) / len);
  m.cy = Math.round((m.cy * to) / len);
}

/** A tick of the current under a swimming Link: his drift updated by the tile under his anchor, then taken. */
export function stepCurrent(m: LinkMotion, p: PlayerState, world: World, onStone?: OnStone): void {
  const cx = Math.floor(p.x / SUBPX / CELL), cy = Math.floor(p.y / SUBPX / CELL);
  const code = world.currents && cx >= 0 && cy >= 0 && cx < world.widthCells && cy < world.heightCells ? world.currents[cy * world.widthCells + cx]! : 0;
  const c = code ? CURRENT_TILES[code - 1]! : null;
  if (c) {
    m.cx += c.dx * c.step;
    m.cy += c.dy * c.step;
    const len = Math.sqrt(m.cx * m.cx + m.cy * m.cy);
    if (len >= c.max) scaleDrift(m, len, c.max);
  } else if (m.cx || m.cy) {
    const len = Math.sqrt(m.cx * m.cx + m.cy * m.cy);
    if (len - CURRENT_FADE <= 0) m.cx = m.cy = 0;
    else scaleDrift(m, len, len - CURRENT_FADE);
  }
  swimAxis(p, world, Math.round((m.cx * SUBPX) / SWIM_UNIT), "x", onStone);
  swimAxis(p, world, Math.round((m.cy * SUBPX) / SWIM_UNIT), "y", onStone);
}

/**
 * River stones (spike tiles, type 0x51: solid; traced in Tingle's Tower room 4, docs/measurements/adventure-world1.md
 * "River stones"): a swimming Link running into one loses a quarter heart and is knocked back (combat.ts KNOCK_SLOW:
 * 0.75 px/tick for 33 ticks with a 4 px/tick hop, state 15), the current holding off while it lasts and his drift gone after it; for the 60 invincibility ticks after
 * the stone only blocks him. Diving doesn't take him under them. The knock is straight away from the sensor that ran
 * into it (swimAxis: the side sensors before the corners, the current's step before the stroke's), e.g. in Dolphin:
 * moving right into one, left; carried down onto a stone's corner by the current, up-left; down onto its top, up;
 * up-right into a corner, down-left; sliding down past a stone's side, nothing. The other Links follow the leader's
 * trail through his knock-backs, unhurt (their hop on the trail isn't modelled).
 */
export const STONE_DAMAGE = 1;

/** Ticks left under water, 0 at the surface. */
export const diveTicks = (m: LinkMotion) => (m.mode === "swim" ? m.vx : 0);

/** One tick of a swimming Link under the stick `buttons`. Returns false when he got out of the water this tick. */
export function stepSwim(m: LinkMotion, p: PlayerState, buttons: number, world: World, onStone?: OnStone): boolean {
  m.mode = "swim";
  const dx = (buttons & Button.Right ? 1 : 0) - (buttons & Button.Left ? 1 : 0);
  const dy = (buttons & Button.Down ? 1 : 0) - (buttons & Button.Up ? 1 : 0);
  const pressed = buttons & ~p.held;
  p.held = buttons;
  if (pressed & Button.Sword && m.vx === 0) m.vx = DIVE_TICKS;
  else if (m.vx > 0) m.vx--;
  const input = dx !== 0 || dy !== 0;
  m.speed = input ? SWIM_SPEED : Math.max(0, m.speed - SWIM_GLIDE_SLOWDOWN);
  const along = DIRS[m.dir < 0 ? dirOfFacing(p.facing) : m.dir]!;
  const unit = along[0] && along[1] ? DIAGONAL : SUBPX;
  // The current carries him first, then his stroke (traced: carried down against a stone's side as he swam right, the
  // knock was the side sensor's).
  stepCurrent(m, p, world, onStone);
  swimAxis(p, world, Math.round((m.speed * along[0]! * unit) / SWIM_UNIT), "x", onStone);
  swimAxis(p, world, Math.round((m.speed * along[1]! * unit) / SWIM_UNIT), "y", onStone);
  if (input) {
    m.dir = dirOf(dx, dy);
    p.facing = nextFacing(p.facing, buttons & DIRECTIONS);
  }
  m.tick = (m.tick + 1) % SWIM_ANIMATION_TICKS;
  if (anchorInDeepWater(world, p)) return true;
  // Ashore: the tick still shows him swimming; he stands the next and walks from the one after (the turn tick).
  m.mode = "ashore";
  m.vx = 0;
  m.cx = m.cy = 0;
  p.moving = false;
  p.walkTicks = 0;
  return false;
}
