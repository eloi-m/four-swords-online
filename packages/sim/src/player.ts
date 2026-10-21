// Link: walking with the game's sensor-based tile collision and corner sliding, axis by axis. Positions are integers
// in 1/256 px so the simulation is bit-exact on every machine (a requirement for rollback netcode later).
import type { Action } from "./actions.ts";
import { isSolidAt, type World } from "./world.ts";

export const SUBPX = 256;

export const Button = { Up: 1, Down: 2, Left: 4, Right: 8, Sword: 16, Item: 32, Action: 64 } as const;

export type Facing = "down" | "up" | "left" | "right";

// Measured in Dolphin from RAM traces (docs/measurements/walking-and-sword.md, tools/dolphin/src/trace.ts).
export const WALK_SPEED = 384; // 1.5 px/frame, in 1/256 px: full speed on the first step, no acceleration
// The game walks 1.5 px along the stick angle, so a diagonal is 1.5/√2 = 1.0607 px per axis (271.5/256, rounded).
export const WALK_SPEED_DIAGONAL = 272;
export const WALK_FRAME_TICKS = 3; // ticks per walk animation frame: 8 frames × 3 = a 24-tick cycle

// Wall sensors relative to the sprite anchor (which is the game's actor position), in pixels: the middle of each side
// of this box, plus the four diagonal points (±HITBOX_CORNER, ±HITBOX_CORNER), an octagon with cut corners.
export const HITBOX = { left: -7, right: 7, top: -7, bottom: 7 } as const;
export const HITBOX_CORNER = 5;
// Corner sliding: while the middle of Link's leading side is clear but one of its corner sensors is caught, he slides
// sideways at walking speed; so a corner is forgiven up to NUDGE_RANGE px (the corner sensors' offset).
export const NUDGE_RANGE = HITBOX_CORNER;
export const NUDGE_STEPS = 5; // the game advances in fifths of a step (0.3 px at walking speed), sliding per fifth
export const WALL_BACKOFF = SUBPX / 2; // walls undo a step, and push Link out sideways, in 0.5 px increments
const MAX_PUSH = 8; // backoff steps a side push may take (4 px)

/** player_sob standing poses; the walk cycles' frame 0 is a stride. */
export const STAND_FRAME = { right: 60, left: 61, down: 62, up: 63 } as const;

export interface PlayerState {
  x: number; // 1/256 px
  y: number;
  facing: Facing;
  moving: boolean;
  walkTicks: number;
  action: Action; // sword actions, see actions.ts
  actionTick: number; // ticks into the action (0 = the press tick, still a walking tick)
  held: number; // buttons of the last tick, for press detection
}

export function createPlayer(px: number, py: number, facing: Facing = "down"): PlayerState {
  return { x: px * SUBPX, y: py * SUBPX, facing, moving: false, walkTicks: 0, action: "none", actionTick: 0, held: 0 };
}

/** Sprite frame in player_sob for the current pose: walk cycles are 8 frames per direction. */
export function playerFrame(p: PlayerState): number {
  if (!p.moving || p.walkTicks === 0) return STAND_FRAME[p.facing];
  const base = { right: 0, left: 8, down: 16, up: 24 }[p.facing];
  return base + (Math.floor(p.walkTicks / WALK_FRAME_TICKS) % 8);
}

type Axis = "x" | "y";
type Sensor = readonly [number, number];
const C = HITBOX_CORNER;
const SENSORS: readonly Sensor[] = [[0, HITBOX.top], [0, HITBOX.bottom], [HITBOX.left, 0], [HITBOX.right, 0], [-C, -C], [C, -C], [-C, C], [C, C]];
// Sensors leading a move along an axis, and the side ones that push Link out instead of stopping him.
const ahead = (axis: Axis, dir: number) => SENSORS.filter(([sx, sy]) => (axis === "x" ? sx : sy) * dir > 0);
const beside = (axis: Axis): [Sensor, number][] =>
  axis === "x" ? [[[0, HITBOX.top], 1], [[0, HITBOX.bottom], -1]] : [[[HITBOX.left, 0], 1], [[HITBOX.right, 0], -1]];

function hits(world: World, x: number, y: number, sensors: readonly Sensor[]): boolean {
  const px = Math.floor(x / SUBPX), py = Math.floor(y / SUBPX);
  return sensors.some(([sx, sy]) => isSolidAt(world, px + sx, py + sy));
}

/** Is the middle of Link's side facing `facing` against a wall a pixel on (the boots' crash: boots.ts)? */
export function wallAhead(world: World, p: Pick<PlayerState, "x" | "y">, facing: Facing): boolean {
  const [sx, sy] = facing === "right" ? [HITBOX.right + 1, 0] : facing === "left" ? [HITBOX.left - 1, 0] : facing === "down" ? [0, HITBOX.bottom + 1] : [0, HITBOX.top - 1];
  return hits(world, p.x, p.y, [[sx, sy]]);
}

// Keeps the current facing while its direction is held; otherwise horizontal directions win (as the game does for
// a diagonal pressed from a perpendicular facing).
export function nextFacing(current: Facing, buttons: number): Facing {
  const held: Record<Facing, boolean> = {
    up: (buttons & Button.Up) !== 0,
    down: (buttons & Button.Down) !== 0,
    left: (buttons & Button.Left) !== 0,
    right: (buttons & Button.Right) !== 0,
  };
  if (held[current]) return current;
  return (["left", "right", "up", "down"] as const).find((d) => held[d]) ?? current;
}

/** Advances one 60 Hz tick. Mutates and returns `p`. */
export function stepPlayer(p: PlayerState, buttons: number, world: World): PlayerState {
  const dx = (buttons & Button.Right ? 1 : 0) - (buttons & Button.Left ? 1 : 0);
  const dy = (buttons & Button.Down ? 1 : 0) - (buttons & Button.Up ? 1 : 0);
  if (dx === 0 && dy === 0) {
    p.moving = false; // stops dead on the first tick without input
    p.walkTicks = 0;
    return p;
  }
  p.facing = nextFacing(p.facing, buttons);
  if (!p.moving) {
    // From standing, the first tick of input only turns Link; he walks from the next tick (the game's idle state
    // hands over to its walk state), so a one-tick tap never moves him.
    p.moving = true;
    return p;
  }
  p.walkTicks++;
  const speed = dx !== 0 && dy !== 0 ? WALK_SPEED_DIAGONAL : WALK_SPEED;
  const slide = dx === 0 || dy === 0; // corner sliding only happens when walking straight
  moveAxis(p, world, dx * speed, "x", slide);
  moveAxis(p, world, dy * speed, "y", slide);
  return p;
}

// Moves `delta` (1/256 px) along one axis against the walls. With `slide` (straight walking) it goes in NUDGE_STEPS
// fifths, and a fifth that would catch only a corner sensor goes sideways, away from that corner, instead (corner
// sliding). Then backs off in WALL_BACKOFF increments while a leading sensor is in a wall (walls are at least 8 px
// thick, so steps up to 4 px can't tunnel), and pushes Link out of any wall a side sensor ended up in.
export function moveAxis(p: Pick<PlayerState, "x" | "y">, world: World, delta: number, axis: Axis, slide = false): void {
  if (delta === 0) return;
  const dir = Math.sign(delta), start = p[axis], perp = axis === "x" ? "y" : "x", lead = ahead(axis, dir);
  if (slide) {
    for (let i = 1, done = 0; i <= NUDGE_STEPS; i++) {
      const step = Math.round((delta * i) / NUDGE_STEPS) - done;
      done += step;
      const side = cornerSide(world, p, axis, dir, p[axis] + step);
      if (side) p[perp] += side * Math.abs(step);
      else p[axis] += step;
    }
  } else p[axis] += delta;
  const at = (v: number) => (axis === "x" ? hits(world, v, p.y, lead) : hits(world, p.x, v, lead));
  let v = p[axis];
  while (Math.sign(v - start) === dir && at(v)) v -= dir * WALL_BACKOFF;
  p[axis] = Math.sign(v - start) === dir ? v : start;
  for (const [sensor, away] of beside(axis)) {
    const from = p[perp];
    for (let n = 0; n < MAX_PUSH && hits(world, p.x, p.y, [sensor]); n++) p[perp] += away * WALL_BACKOFF;
    if (hits(world, p.x, p.y, [sensor])) p[perp] = from;
  }
}

// At `next` along `axis`: 1 or -1 (the perpendicular direction to slide) when exactly one leading corner sensor is in a
// wall while the middle of the leading side is clear, else 0.
function cornerSide(world: World, p: Pick<PlayerState, "x" | "y">, axis: Axis, dir: number, next: number): number {
  const x = axis === "x" ? next : p.x, y = axis === "y" ? next : p.y;
  const middle: Sensor = axis === "x" ? [dir * HITBOX.right, 0] : [0, dir * HITBOX.bottom];
  if (hits(world, x, y, [middle])) return 0;
  const [neg, pos] = axis === "x" ? [[dir * C, -C], [dir * C, C]] as const : [[-C, dir * C], [C, dir * C]] as const;
  const a = hits(world, x, y, [neg]), b = hits(world, x, y, [pos]);
  return a === b ? 0 : a ? 1 : -1;
}
