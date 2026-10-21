// The on-screen controls' multi-touch state, without the DOM (touch-controls.ts feeds it Pointer Events): every finger
// is tracked by its pointer id from the moment it lands until it lifts, as the stick's or as a button finger, so the
// left thumb can hold a direction while the right one holds Sword for a charge (56 ticks) or taps Action for a roll.
import { Button } from "@fso/sim";
import { stickButtons, STICK_THRESHOLD } from "./stick.ts";

export type TouchButton = "Sword" | "Item" | "Action";
export const TOUCH_BUTTONS: readonly TouchButton[] = ["Sword", "Item", "Action"];

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface PadButton extends Circle {
  action: TouchButton;
}

/** A finger lands on a button within HIT of its radius, and slides off it past STAY (so a thumb can wander a bit). */
const HIT = 1.2;
const STAY = 1.5;

export interface StickFinger {
  id: number;
  /** The base's center: where the finger pushes from. */
  ox: number;
  oy: number;
  /** The finger. */
  x: number;
  y: number;
}

export class TouchPad {
  /** The stick's resting base: a finger landing on it pushes from its center, elsewhere from where it lands. */
  stickBase: Circle = { x: 0, y: 0, r: 60 };
  /** Where the buttons are, in the pointers' coordinates. */
  buttons: PadButton[] = [];
  threshold = STICK_THRESHOLD;
  /** The finger on the stick, if any. */
  stick: StickFinger | null = null;
  /** Button fingers: pointer id → the button under it (null: between buttons, pressing nothing). */
  private readonly fingers = new Map<number, PadButton | null>();
  /** Buttons pressed since the last sample: a tap shorter than a tick still reaches the sim. */
  private latched = 0;

  /** A finger lands where it grabs the stick (a second one there is ignored). */
  stickDown(id: number, x: number, y: number): void {
    if (this.stick || this.fingers.has(id)) return;
    const base = this.stickBase;
    const onBase = Math.hypot(x - base.x, y - base.y) <= base.r;
    this.stick = { id, ox: onBase ? base.x : x, oy: onBase ? base.y : y, x, y };
    this.trail();
  }

  /** A finger lands where the buttons are; returns the buttons it newly pressed (for haptics). */
  buttonDown(id: number, x: number, y: number): number {
    if (this.stick?.id === id || this.fingers.has(id)) return 0;
    const before = this.pressed();
    this.fingers.set(id, this.hit(x, y));
    return this.newlyPressed(before);
  }

  /** A finger moves; returns the buttons it newly pressed (sliding onto another button). */
  move(id: number, x: number, y: number): number {
    const stick = this.stick;
    if (stick?.id === id) {
      stick.x = x;
      stick.y = y;
      this.trail();
      return 0;
    }
    if (!this.fingers.has(id)) return 0;
    const before = this.pressed();
    const on = this.fingers.get(id) ?? null;
    if (!on || Math.hypot(x - on.x, y - on.y) > on.r * STAY) this.fingers.set(id, this.hit(x, y));
    return this.newlyPressed(before);
  }

  /** A finger lifts (or the browser took it: pointercancel). */
  up(id: number): void {
    if (this.stick?.id === id) this.stick = null;
    this.fingers.delete(id);
  }

  /** Lets go of everything (the controls were hidden, the page lost focus). */
  reset(): void {
    this.stick = null;
    this.fingers.clear();
    this.latched = 0;
  }

  /** Whether any finger is down. */
  get touching(): boolean {
    return this.stick !== null || this.fingers.size > 0;
  }

  /** The stick's push from its base's center (at most its radius: the base trails the finger). */
  get stickOffset(): { x: number; y: number } {
    const s = this.stick;
    return s ? { x: s.x - s.ox, y: s.y - s.oy } : { x: 0, y: 0 };
  }

  /** The buttons held now. */
  get held(): number {
    const s = this.stick;
    return (s ? stickButtons(s.x - s.ox, s.y - s.oy, this.stickBase.r, this.threshold) : 0) | this.pressed();
  }

  /** The buttons for this tick: held now, or pressed since the last sample. */
  sample(): number {
    const buttons = this.held | this.latched;
    this.latched = 0;
    return buttons;
  }

  /** Whether a finger presses `action`. */
  isPressed(action: TouchButton): boolean {
    return (this.pressed() & Button[action]) !== 0;
  }

  private pressed(): number {
    let buttons = 0;
    for (const b of this.fingers.values()) if (b) buttons |= Button[b.action];
    return buttons;
  }

  private newlyPressed(before: number): number {
    const now = this.pressed() & ~before;
    this.latched |= now;
    return now;
  }

  /** The nearest button a finger at (x, y) lands on, if any. */
  private hit(x: number, y: number): PadButton | null {
    let best: PadButton | null = null, bestD = Infinity;
    for (const b of this.buttons) {
      const d = Math.hypot(x - b.x, y - b.y) / b.r;
      if (d <= HIT && d < bestD) (best = b), (bestD = d);
    }
    return best;
  }

  /** A finger pushed past the base's edge drags the base along, so turning back needs only a short move. */
  private trail(): void {
    const s = this.stick!, r = this.stickBase.r;
    const dx = s.x - s.ox, dy = s.y - s.oy, d = Math.hypot(dx, dy);
    if (d <= r) return;
    s.ox = s.x - (dx * r) / d;
    s.oy = s.y - (dy * r) / d;
  }
}
