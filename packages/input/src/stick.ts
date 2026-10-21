// A thumb stick → direction buttons. FSA has no analog walk: Link stands still below a tilt threshold and walks at full
// speed above it, in 8 directions (docs/measurements/walking-and-sword.md "Analog stick": 0.59 of full tilt doesn't walk, 0.69 does).
import { Button } from "@fso/sim";

/** Displacement, in stick radii, past which the stick holds a direction (the game's 0.59–0.69). */
export const STICK_THRESHOLD = 0.6;

// 45° sectors centered on each axis and diagonal, counted clockwise from right (screen y points down).
const SECTORS = [
  Button.Right,
  Button.Right | Button.Down,
  Button.Down,
  Button.Down | Button.Left,
  Button.Left,
  Button.Left | Button.Up,
  Button.Up,
  Button.Up | Button.Right,
] as const;

/**
 * The direction buttons of a stick pushed by (dx, dy) (screen px, y down) on a base of `radius`: none inside
 * `threshold` × radius (the dead zone), else the 8-way direction whose 45° sector holds the angle.
 */
export function stickButtons(dx: number, dy: number, radius: number, threshold = STICK_THRESHOLD): number {
  if (!(radius > 0) || Math.hypot(dx, dy) < threshold * radius) return 0;
  return SECTORS[Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) & 7]!;
}
