// The battle camera, as measured in Dolphin (docs/measurements/battle-arenas.md "Battle measurements: arenas, orbs and camera"; the
// camera object [[0x8053AB10]+0x24]: its box +0x1B4…+0x1C0, the edges' hold timers +0x1C4…+0x1D0, the view
// +0x164…+0x170, the zoom +0x858 = 608 / the view's width). It keeps a box around what it follows: the Links still in
// the round, and from the first tick of play the arena's FOCS focus points (Hyrule Castle's and Above the Clouds'
// four, which in effect fix the camera there). Each edge eases a tenth of the way per frame (all four scaled alike so
// that the largest step is at most 3 px) out to the outermost Link, and back in only after 60 frames without a Link
// past it, never closer than 128 px outside him. The view is that box grown by 86 px on each side, clipped to the
// arena, widened to the TV's 608:448 around the box's centre, at most 512 × 377.3 (the arena's width), and moved back
// inside the arena, never narrower than 260 px (130 each side of its middle: the table's second field). At a round's end
// (BFIN, the byte +0x7F4 = 1 a tick after the HUD starts fading out) the edges ease exactly onto what it follows, with no
// hold and no slack: the Links where they lie, then the winner alone, which zooms in on him (`step(points, true)`).
// Plain logic: the scene steps it once per simulation tick.

export const CAMERA_MARGIN = 86; // room px around the box (multiplayer mode's first field, table 0x804AA8E8)
export const CAMERA_SLACK = 128; // an edge comes back in no closer than this outside the outermost Link
export const CAMERA_HOLD = 60; // frames an edge waits, once no Link is past it, before it comes back in
export const CAMERA_EASE = 0.1; // of the gap per frame
export const CAMERA_MAX_STEP = 3; // px per frame, for the edge that has the farthest to go
export const CAMERA_MIN_HALF = 130; // room px: the view is at least twice this wide (the table's second field)

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The view: its centre and size, room px. */
export interface CameraView {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The smallest box around `points` (null when there are none). */
export function bounds(points: readonly Point[]): Box | null {
  if (!points.length) return null;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

const EDGES = ["left", "top", "right", "bottom"] as const;

export class BattleCamera {
  box: Box;
  /** Per edge (left, top, right, bottom): frames left before it may come back in. */
  holds = [0, 0, 0, 0];
  /** What it followed on the last frame: the game's camera runs before the Links move, a frame behind them. */
  private last: readonly Point[];

  constructor(points: readonly Point[]) {
    this.box = bounds(points) ?? { left: 0, top: 0, right: 0, bottom: 0 };
    this.last = points;
  }

  /** The round's start: the box is exactly around what it follows. */
  reset(points: readonly Point[]): void {
    this.box = bounds(points) ?? this.box;
    this.holds = [0, 0, 0, 0];
    this.last = points;
  }

  /**
   * One frame, with what it follows now (it acts on where that was a frame ago). `exact`: the round's end, every edge
   * eases onto the points (traced: no hold, no slack, from the frame after BFIN's first).
   */
  step(points: readonly Point[], exact = false): void {
    const ext = bounds(this.last);
    this.last = points;
    if (!ext) return;
    const gaps = EDGES.map((edge, i) => {
      const at = this.box[edge], to = ext[edge], outward = i < 2 ? -1 : 1; // left and top grow toward smaller values
      if (exact) {
        this.holds[i] = 0;
        return to - at;
      }
      if ((to - at) * outward > 0) {
        this.holds[i] = CAMERA_HOLD;
        return to - at;
      }
      if (this.holds[i]! > 0) {
        this.holds[i]!--;
        return 0;
      }
      const inside = (at - to) * outward; // how far the edge is outside the outermost point
      return inside > CAMERA_SLACK ? (to + outward * CAMERA_SLACK) - at : 0;
    });
    const far = Math.max(...gaps.map(Math.abs));
    const k = far * CAMERA_EASE > CAMERA_MAX_STEP ? CAMERA_MAX_STEP / far : CAMERA_EASE;
    EDGES.forEach((edge, i) => (this.box[edge] += gaps[i]! * k));
  }
}

/** What a box shows, in an arena of `width` × `height` px, on a screen of `aspect` (608:448). */
export function cameraView(box: Box, width: number, height: number, aspect: number): CameraView {
  const m = CAMERA_MARGIN;
  const left = Math.max(0, box.left - m), right = Math.min(width, box.right + m);
  const top = Math.max(0, box.top - m), bottom = Math.min(height, box.bottom + m);
  let w = Math.max(right - left, 2 * CAMERA_MIN_HALF), h = bottom - top;
  if (h * aspect > w) w = h * aspect;
  else h = w / aspect;
  const maxW = Math.min(width, height * aspect);
  if (w > maxW) [w, h] = [maxW, maxW / aspect];
  const clamp = (v: number, half: number, size: number) => Math.min(Math.max(v, half), size - half);
  return { x: clamp((left + right) / 2, w / 2, width), y: clamp((top + bottom) / 2, h / 2, height), w, h };
}
