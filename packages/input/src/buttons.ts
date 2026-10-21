// What every input source produces: the sim's u16 button mask for one player and one tick (`Button` in
// packages/sim/src/player.ts: Up 1, Down 2, Left 4, Right 8, Sword 16, Item 32, Action 64).
import { Button } from "@fso/sim";

/**
 * Anything that holds a player's buttons: a keyboard layout, a gamepad, the on-screen controls, or buttons computed
 * each tick (a CPU player reading the sim state through a closure). LocalInput merges attached sources into a player's
 * buttons (`attach`); a source that replaces a player instead can overwrite that slot of `LocalInput.sample()`.
 */
export interface ButtonSource {
  /** The buttons held now; called once per tick (a source may latch presses shorter than a tick until then). */
  sample(): number;
  /** False while the source isn't in use (the on-screen controls on a desktop): its buttons are skipped. */
  readonly active?: boolean;
  /** How the menu names it ("On-screen controls"). */
  readonly label?: string;
}

export const DIRECTIONS = Button.Up | Button.Down | Button.Left | Button.Right;

/** Opposite directions cancel out, as on a d-pad. */
export function cancelOpposites(buttons: number): number {
  if ((buttons & (Button.Up | Button.Down)) === (Button.Up | Button.Down)) buttons &= ~(Button.Up | Button.Down);
  if ((buttons & (Button.Left | Button.Right)) === (Button.Left | Button.Right)) buttons &= ~(Button.Left | Button.Right);
  return buttons;
}

/** The buttons of several sources played together: held on any of them, opposite directions cancelled. */
export function mergeButtons(...masks: number[]): number {
  let buttons = 0;
  for (const m of masks) buttons |= m;
  return cancelOpposites(buttons & 0xffff);
}
