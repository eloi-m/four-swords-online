// The push (state 13): walking into a wall for 20 ticks without getting anywhere, Link leans on it and doesn't move,
// even with a diagonal held that would slide him along it on foot. Measured in Dolphin (docs/measurements/walking-and-sword.md
// "Collision", "Adventure: …" and, in Shadow Battle, "The push state and doors"): it starts on the 21st tick without
// progress (the walk cycle running on in place until then), its frames 8 ticks each from the tick before (player_sob
// 666-687: 4 frames right and left, an 8-step cycle of 7 frames down and up); with the stick released it goes on 6
// more ticks, then he stands; with the stick turned he pushes one tick the new way, stands one tick, then walks; a
// press of the sword, the item or Action ends it at once. Shadow Battle's Links push walls as the adventure's leader
// does (traced on The Field's south wall).
// The state is a plain record (`PushState`) in the battle's Fighter and the adventure's state.
import type { Fighter } from "./combat.ts";
import { Button, nextFacing, type Facing, type PlayerState } from "./player.ts";

export const PUSH_AFTER = 20; // ticks walking without progress (measured)
export const PUSH_RELEASE_TICKS = 6; // pushing on after the stick is released (measured)
export const PUSH_FRAME_TICKS = 8; // measured: 670, 671, 672, 673 for 8 ticks each (facing left)

/** Ticks walking without progress, pushing, its animation tick, ticks since the stick was released, the standing tick
 *  after a turned push. */
export interface PushState {
  ticks: number;
  on: boolean;
  tick: number;
  release: number;
  idle: number;
}

export const createPush = (): PushState => ({ ticks: 0, on: false, tick: 0, release: 0, idle: 0 });

const DIRECTIONS = Button.Up | Button.Down | Button.Left | Button.Right;
const HELD: Readonly<Record<Facing, number>> = { up: Button.Up, down: Button.Down, left: Button.Left, right: Button.Right };

/** What a push does this tick, before Link steps: true when it takes the tick over (no walking). */
export function stepPushing(s: PushState, p: PlayerState, f: Fighter, buttons: number): boolean {
  if (!s.on) return false;
  const pressed = buttons & ~p.held;
  // A press of the sword, item or action ends it at once; so does anything that isn't plain standing.
  if (pressed & (Button.Sword | Button.Item | Button.Action) || f.mode !== "active" || f.move !== "none" || p.action !== "none") {
    s.on = false;
    s.idle = 0;
    return false;
  }
  s.tick++;
  if (buttons & HELD[p.facing]) {
    s.release = 0;
    p.held = buttons;
    return true;
  }
  if (buttons & DIRECTIONS) {
    // Turned: one tick pushing the new way, one standing, then walking.
    p.facing = nextFacing(p.facing, buttons);
    s.on = false;
    s.idle = 1;
    p.held = buttons;
    return true;
  }
  p.held = buttons;
  if (++s.release > PUSH_RELEASE_TICKS) {
    s.on = false;
    p.moving = false;
    p.walkTicks = 0;
  }
  return true;
}

/** After Link stepped (from (x0, y0)): counts the ticks he walked without getting anywhere, and starts the push. */
export function notePushing(s: PushState, p: PlayerState, f: Fighter, x0: number, y0: number): void {
  if (s.on || s.idle) return; // (pushing, or turned out of it: stepPushing and pushingIdle have the tick)
  const walking = p.moving && p.action === "none" && f.mode === "active" && f.move === "none";
  if (walking && p.x === x0 && p.y === y0) {
    if (++s.ticks > PUSH_AFTER) {
      s.on = true;
      s.tick = 1; // its frames count from the tick before (measured: 670 ×7, then 671 ×8 …)
      s.release = 0;
    }
  } else s.ticks = 0;
}

/** The standing tick after a turned push (true: Link stands this tick; he walks from the next, measured). */
export function pushingIdle(s: PushState, p: PlayerState, buttons: number): boolean {
  if (!s.idle) return false;
  s.idle = 0;
  s.ticks = 0;
  p.held = buttons;
  p.moving = (buttons & DIRECTIONS) !== 0;
  p.walkTicks = 0;
  return true;
}

/**
 * The push's frames per facing: 4 right and left; down an 8-step cycle over 7 frames (traced in Shadow Battle: 674,
 * 675, 676, 677, 674, 678, 679, 680), up taken alike (681 and 682 traced).
 */
export const PUSH_FRAMES: Readonly<Record<Facing, readonly number[]>> = {
  right: [666, 667, 668, 669],
  left: [670, 671, 672, 673],
  down: [674, 675, 676, 677, 674, 678, 679, 680],
  up: [681, 682, 683, 684, 681, 685, 686, 687],
};

/** The push frame now, or -1 when Link isn't pushing. */
export function pushingFrame(s: PushState, p: PlayerState): number {
  if (!s.on && !(s.idle && s.tick > 0)) return -1;
  const frames = PUSH_FRAMES[p.facing];
  return frames[Math.floor(s.tick / PUSH_FRAME_TICKS) % frames.length]!;
}
