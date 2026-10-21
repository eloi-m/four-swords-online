// Where the on-screen controls go (CSS px): the stick on the left, Sword, Item and Action on the right, the pause
// button at the top. Beside the TV frame when the letterbox margins have room (a phone in landscape: the 608×448
// frame leaves about a sixth of the width on each side), otherwise over the frame's bottom corners, translucent.
// Always inside the safe area (env(safe-area-inset-*): the notch, rounded corners, the home indicator).
import type { Circle, PadButton, TouchButton } from "./touch.ts";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ControlsLayout {
  /** "margins": in the letterbox beside the frame; "over": over the frame's corners. */
  placement: "margins" | "over";
  /** The stick's resting base. */
  stick: Circle;
  /** Where a finger grabs the stick (the left half of the screen) and where the buttons take fingers (the right). */
  stickZone: Rect;
  buttonZone: Rect;
  buttons: PadButton[];
  pause: Rect;
}

/** Sizes at size 1 (CSS px): the smallest button is 56 px across, over the 44 px touch-target minimum. */
const STICK_R = 56;
const PAUSE = 44;
const EDGE = 10; // gap to the safe area's edges
/** Kept clear at the top left: the site's home link (apps/site/src/nav.ts) floats there. */
const HOME_LINK = 40;
/** Controls go in a margin that holds at least this much of their width (the rest overlaps the frame's edge). */
const MARGIN_FIT = 0.8;

interface Shape {
  w: number;
  h: number;
  buttons: { action: TouchButton; x: number; y: number; r: number }[];
}

/** Sword under the right thumb, Item above it, Action to its right: for wide margins and over the frame. */
const CLUSTER: Shape = {
  w: 126,
  h: 140,
  buttons: [
    { action: "Sword", x: 34, y: 106, r: 34 },
    { action: "Item", x: 34, y: 28, r: 28 },
    { action: "Action", x: 98, y: 66, r: 28 },
  ],
};

/** The same buttons stacked, for a narrow margin (an iPhone's, once the safe area is taken off). */
const COLUMN: Shape = {
  w: 68,
  h: 208,
  buttons: [
    { action: "Sword", x: 34, y: 174, r: 34 },
    { action: "Action", x: 34, y: 98, r: 28 },
    { action: "Item", x: 34, y: 28, r: 28 },
  ],
};

/**
 * Lays the controls out in a `view` (the window, CSS px) around the TV `frame` (the letterboxed game picture; the
 * whole view when it isn't letterboxed), inside the safe-area `insets`, at `size` (1 = the default size).
 */
export function layoutControls(view: { w: number; h: number }, frame: Rect, insets: Insets, size: number): ControlsLayout {
  const s = size;
  const left = frame.x - insets.left, right = view.w - insets.right - (frame.x + frame.w);
  const r = STICK_R * s;
  const margins = left >= MARGIN_FIT * 2 * r && right >= MARGIN_FIT * COLUMN.w * s;
  const shape = margins && right < CLUSTER.w * s + 2 * EDGE ? COLUMN : CLUSTER;
  const bottom = view.h - insets.bottom - EDGE;

  // The stick: centered in the margin (or hugging the safe edge when the margin is narrower), a little up from the
  // bottom where the left thumb rests.
  const stickX = margins ? insets.left + Math.max(left / 2, r + EDGE) : insets.left + EDGE + r * 1.3;
  const stick = { x: stickX, y: bottom - r * 1.35, r };

  const w = shape.w * s, h = shape.h * s;
  const x0 = margins ? view.w - insets.right - Math.max((right + w) / 2, w + EDGE) : view.w - insets.right - EDGE - w - r * 0.3;
  const y0 = bottom - h - (shape === CLUSTER ? r * 0.2 : 0);
  const buttons = shape.buttons.map((b) => ({ action: b.action, x: x0 + b.x * s, y: y0 + b.y * s, r: b.r * s }));

  // The pause button: the left margin's top (under the home link), or over the frame's top edge between P1's hearts
  // and the timer.
  const pause = margins
    ? { x: insets.left + EDGE, y: insets.top + EDGE + HOME_LINK, w: PAUSE, h: PAUSE }
    : { x: Math.max(insets.left + EDGE, frame.x + frame.w * 0.34 - PAUSE / 2), y: Math.max(insets.top, frame.y) + 6, w: PAUSE, h: PAUSE };

  const half = view.w / 2;
  return {
    placement: margins ? "margins" : "over",
    stick,
    stickZone: { x: 0, y: 0, w: half, h: view.h },
    buttonZone: { x: half, y: 0, w: view.w - half, h: view.h },
    buttons,
    pause,
  };
}
