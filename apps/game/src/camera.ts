// The adventure's TV camera, read from main.dol (the camera object [[0x8053AB10]+0x24]: its step 0x8030E154 and the
// box's step 0x8030CD18, the modes' table 0x804AA8E8) and checked against Dolphin traces of Lake Hylia (the object's
// box +0x1B4, its edges' holds +0x1C4, the view +0x164, the zoom +0x858 = 608 / the view's width, frame by frame).
// It keeps a box (world px) around what it follows: the leader, and the points the room's actors hand it every tick
// (0x8030C210, only those inside the room: `focusPoints` below lists who does, and when). Each such point counts
// pulled 72 px toward the box (the margin 104 less the mode's 32), so the view shows it with 32 px to spare. The view
// is the box grown by 104 px on each side, clipped to the room, at least 284 px wide (142 each side; 2.1408 a zoom),
// widened to the TV's 608:448 and moved back inside the room. Two modes (the table's entries 0 and 4):
// - with focus points: each edge eases a tenth of its gap per tick, at most 3 px × its gap / the largest gap; an edge
//   that went out holds 240 ticks before it may come back in, unless the opposite edge is going out (the box pans);
// - without: a fifth of the gap, at most 3 px out, 1 px back in (3 while the opposite edge goes out), no hold.
// While the Links are inside a GBA-screen area the box eases onto the whole room (the view 512 px wide, zoom 1.1875)
// over 70 ticks (twice-smoothed cosine). A room change by an edge eases the view from the last room's to the new
// room's (as it stands around the leader then) over 30 ticks, quadratically, starting 2 ticks after the sim switched
// rooms (render's RoomPan, measured); then the box starts over around the leader. A warp or a stairway snaps.
// The camera acts on the points of the tick before (the game's camera runs before its actors).
// Not done: the camera's special focus (+0x7F4: a talking owl, a Shadow Link's entrance), its shake (+0x1DC), the
// other modes (several players: Shadow Battle's camera is apps/battle's camera.ts).
import { SUBPX, switchOn } from "@fso/sim";
import { pickupShown, type AdventureGame, type AdventureStage } from "@fso/sim/adventure";

/** The TV's aspect, height over width. */
const ASPECT = 448 / 608;
const TV_W = 608;
const ROOM_W = 512, ROOM_H = 384;

/** A mode's constants (one 36-byte entry of the table 0x804AA8E8). */
interface CameraMode {
  /** The view's margin round the box. */
  margin: number;
  /** Half the view's least width. */
  minHalf: number;
  /** The margin a focus point gets (a point is pulled margin − this toward the box). */
  focusMargin: number;
  /** Most px an edge moves out (and in, while the opposite edge goes out) a tick, for the edge with the farthest to go. */
  out: number;
  /** Most px an edge comes back in a tick. */
  in: number;
  /** Ticks an edge that went out holds before it comes back in. */
  hold: number;
  /** Of the gap per tick. */
  ease: number;
}

/** Entry 0: the adventure's camera with focus points this tick. */
export const FOCUS_MODE: CameraMode = { margin: 104, minHalf: 142, focusMargin: 32, out: 3, in: 3, hold: 240, ease: 0.1 };
/** Entry 4: none. */
export const PLAIN_MODE: CameraMode = { margin: 104, minHalf: 142, focusMargin: 112, out: 3, in: 1, hold: 0, ease: 0.2 };
/** Ticks the box takes onto the whole room for a GBA-screen area (+0x838). */
export const WHOLE_ROOM_TICKS = 70;
/** A room change's pan: its ticks (+0x1EC) and the ticks before it starts. */
export const PAN_TICKS = 30;
export const PAN_DELAY = 2;
/** A YAJI lights once a Link is within this many px of its column or row. */
export const YAJI_REACH = 32;

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

/** What the camera follows on a tick (world px): the leader, the focus points, whether the Links are in a GBA area. */
export interface CameraTargets {
  leader: Point;
  focus: readonly Point[];
  wholeRoom: boolean;
}

const inside = (p: Point, r: Box) => p.x >= r.left && p.y >= r.top && p.x < r.right && p.y < r.bottom;
const cos = (deg: number) => Math.cos((deg * Math.PI) / 180);
const mix = (a: Box, b: Box, k: number): Box => ({
  left: a.left + (b.left - a.left) * k,
  top: a.top + (b.top - a.top) * k,
  right: a.right + (b.right - a.right) * k,
  bottom: a.bottom + (b.bottom - a.bottom) * k,
});

/** The box that would hold the targets (0x8030CD18's first part): the leader, each focus point pulled toward it. */
export function targetBox(t: CameraTargets, room: Box, mode: CameraMode): Box {
  if (t.wholeRoom) {
    const m = mode.margin;
    return { left: room.left + m, top: room.top + m, right: room.right - m, bottom: room.bottom - m };
  }
  const b = { left: t.leader.x, top: t.leader.y, right: t.leader.x, bottom: t.leader.y };
  const d = mode.margin - mode.focusMargin;
  const pull = (v: number, lo: number, hi: number) => (v < lo ? (v < lo - d ? v + d : lo) : v > hi ? (v > hi + d ? v - d : hi) : v);
  for (const p of t.focus) {
    const x = pull(p.x, b.left, b.right), y = pull(p.y, b.top, b.bottom);
    b.left = Math.min(b.left, x);
    b.right = Math.max(b.right, x);
    b.top = Math.min(b.top, y);
    b.bottom = Math.max(b.bottom, y);
  }
  return b;
}

/** What a box shows of a room (0x8030CD18's end): its world px rectangle, 608:448. */
export function boxView(box: Box, room: Box, mode: CameraMode): Box {
  const m = mode.margin;
  let l = Math.max(box.left - m, room.left), t = Math.max(box.top - m, room.top);
  let r = Math.min(box.right + m, room.right), b = Math.min(box.bottom + m, room.bottom);
  // Into the room along one axis, keeping the size.
  const shift = (lo: number, hi: number, min: number, max: number): [number, number] => {
    if (lo < min) [lo, hi] = [min, hi + min - lo];
    if (hi > max) [lo, hi] = [lo - (hi - max), max];
    return [lo, hi];
  };
  const half = mode.minHalf;
  if (r - l < 2 * half) [l, r] = shift((l + r) / 2 - half, (l + r) / 2 + half, room.left, room.right);
  if (b - t < 2 * half * ASPECT) [t, b] = shift((t + b) / 2 - half * ASPECT, (t + b) / 2 + half * ASPECT, room.top, room.bottom);
  const roomW = room.right - room.left;
  if (b - t > roomW * ASPECT) [t, b] = [(t + b) / 2 - (roomW * ASPECT) / 2, (t + b) / 2 + (roomW * ASPECT) / 2];
  if ((r - l) * ASPECT > b - t) {
    const h = (r - l) * ASPECT;
    [t, b] = [(t + b) / 2 - h / 2, (t + b) / 2 + h / 2];
    if (t < room.top) [t, b] = [room.top, Math.min(b + room.top - t, room.bottom)];
    if (b > room.bottom) [t, b] = [Math.max(t - (b - room.bottom), room.top), room.bottom];
  } else {
    const w = (b - t) / ASPECT;
    [l, r] = [(l + r) / 2 - w / 2, (l + r) / 2 + w / 2];
    if (l < room.left) [l, r] = [room.left, Math.min(r + room.left - l, room.right)];
    if (r > room.right) [l, r] = [Math.max(l - (r - room.right), room.left), room.right];
  }
  return { left: l, top: t, right: r, bottom: b };
}

const fround = (b: Box): Box => ({ left: Math.fround(b.left), top: Math.fround(b.top), right: Math.fround(b.right), bottom: Math.fround(b.bottom) });

/** The view's zoom: TV px per world px. */
export const zoomOf = (view: Box): number => TV_W / (view.right - view.left);

export class AdventureCamera {
  /** The box it keeps (null: it starts over around what it follows). */
  box: Box | null = null;
  /** Per edge (left, right, top, bottom): ticks left before it may come back in. */
  holds = [0, 0, 0, 0];
  /** The view (world px). */
  view: Box = { left: 0, top: 0, right: 512, bottom: 377.26 };
  room: Box = { left: 0, top: 0, right: 512, bottom: 384 };
  /** The whole-room ease: its box at the start and ticks left (-1: none). */
  private whole: { from: Box; left: number } | null = null;
  /** A room change's pan: the view it leaves, the new room's at the start, ticks so far. */
  private pan: { from: Box; to: Box; tick: number } | null = null;
  /** What it follows, a tick late. */
  private last: CameraTargets | null = null;

  /** A new room (world px): `pan` eases the view over from the last room's (an edge walk), else it snaps. */
  enter(room: Box, targets: CameraTargets, pan: boolean): void {
    const from = this.view;
    this.room = room;
    this.box = null;
    this.holds = [0, 0, 0, 0];
    this.whole = null;
    this.last = null;
    this.view = boxView(targetBox(targets, room, PLAIN_MODE), room, PLAIN_MODE);
    this.pan = pan ? { from, to: this.view, tick: 0 } : null;
    if (this.pan) this.view = from;
  }

  /** One tick, with what it follows now (it acts on the tick before's). */
  step(targets: CameraTargets): void {
    const t = this.last ?? { ...targets, focus: [] }; // (no actor has handed it a point yet)
    this.last = { ...targets, focus: targets.focus.filter((p) => inside(p, this.room)) };
    if (this.pan) {
      // The new room's view comes in as 1 − (ticks left / 30)²; the box starts over after.
      const k = Math.max(0, this.pan.tick++ - PAN_DELAY);
      if (k < PAN_TICKS) {
        this.view = mix(this.pan.from, this.pan.to, 1 - (1 - k / PAN_TICKS) ** 2);
        this.last = { ...targets, focus: [] };
        return;
      }
      this.pan = null;
      this.box = null;
    }
    const mode = t.focus.length ? FOCUS_MODE : PLAIN_MODE;
    let to = fround(targetBox(t, this.room, mode));
    if (!this.box) {
      this.box = to;
      this.whole = null;
    } else if (t.wholeRoom && (this.whole?.left ?? 1) > 0) {
      this.whole ??= { from: { ...this.box }, left: WHOLE_ROOM_TICKS };
      const u = 0.5 + 0.5 * cos((180 * this.whole.left) / WHOLE_ROOM_TICKS);
      to = mix(this.whole.from, to, 0.5 + 0.5 * cos(180 * (1 - u)));
      this.whole.left--;
      this.box = to;
    } else {
      if (!t.wholeRoom) this.whole = null;
      this.box = this.ease(this.box, to, mode);
    }
    this.view = boxView(this.box, this.room, mode);
  }

  /** Each edge's step toward `to` (0x8030CD18's middle part). */
  private ease(box: Box, to: Box, mode: CameraMode): Box {
    // Out-going gaps: left, right, top, bottom (positive: the edge goes out).
    const gaps = [box.left - to.left, to.right - box.right, box.top - to.top, to.bottom - box.bottom].map(Math.fround);
    const most = Math.max(0, ...gaps), least = Math.min(0, ...gaps);
    const speeds = gaps.map((g, i) => {
      let s = 0;
      if (g > 0) {
        s = (mode.out * g) / most;
        if (this.holds[i]! < mode.hold) this.holds[i] = mode.hold;
      } else if (g < 0 && !(this.holds[i] !== 0 && gaps[i ^ 1]! <= 0)) s = ((gaps[i ^ 1]! < 0.1 ? mode.in : mode.out) * g) / least;
      return s;
    });
    // The holds count down on every tick (after this tick's speeds, before the new holds took effect).
    for (let i = 0; i < 4; i++) if (gaps[i]! <= 0 && this.holds[i]! > 0) this.holds[i]!--;
    const f = Math.fround, ease = f(mode.ease);
    const move = (at: number, target: number, outward: number, out: number, back: number) => {
      const d = f(ease * f(target - at));
      return at + (d * outward > 0 ? Math.sign(d) * Math.min(Math.abs(d), out) : Math.sign(d) * Math.min(Math.abs(d), back));
    };
    // In single floats, as the game keeps it: an edge easing in stops an ulp short, so it keeps its hold.
    return {
      left: f(move(box.left, to.left, -1, speeds[0]!, speeds[0]!)),
      right: f(move(box.right, to.right, 1, speeds[1]!, speeds[1]!)),
      top: f(move(box.top, to.top, -1, speeds[2]!, speeds[2]!)),
      bottom: f(move(box.bottom, to.bottom, 1, speeds[3]!, speeds[3]!)),
    };
  }
}

/**
 * The points the current room's actors hand the camera this tick (world px), read from each type's update:
 * - YAJI (the arrow signs, update 0x802AFCE8, init 0x802B0194): once a Link comes within 32 px of its column (p & 15 of
 *   0 or 1) or row (2, 3), the whole room's height or width, it turns its switch (p >> 27) on and, with its switch on,
 *   lights (state 1; traced in Lake Hylia's room 0: switch 1, from the tick the Links came in at x 44).
 * - FOCS (0x802C9558): `FocusPoints` below.
 * - Force Gems (RUPY, 0x8032D534) of type 3 (50) and up, lying or falling; keys (KEY0, 0x802C5074) lying, at their
 *   height (x, y − z).
 * - the soldiers' captain (SLR4, 0x80172DC4) always; a sword soldier (SLR1, 0x80151148) while it walks in (state 0);
 *   an Octorok (OKTA, 0x8013FD50) of params 2; a Zora (ZORA, 0x801BA854) out of the water (+0x248 ≠ 0); the minor
 *   Shadow Links (ZSLH, ZSLJ: their method 0x80221114, every tick on the TV).
 * Not done (seen in main.dol, none in Lake Hylia's path or not simulated): DOOR (one of its states), HNRY of kind
 * (p >> 16) & 0xFF = 8 (a gem that flies), GOL2's pads, KEPO, SWT4, FTGL, BBSL, SLK2, SLR3, TENN, FLYO, the bosses.
 */
export class FocusPoints {
  /** FOCS by actor index: its state (0 going to it, 1 holding, 2 for good, 3 done) and ticks left. */
  private readonly focs = new Map<number, { state: number; left: number }>();
  /** The YAJIs a Link came near (their switch, which the sim leaves off, set as far as the camera goes). */
  private readonly lit = new Set<number>();
  private room = -1;

  /**
   * This tick's points. `seen` tells whether a world point is on the TV now (0x8030C2A8: inside the screen less 14 px),
   * which moves a FOCS on.
   */
  points(game: AdventureGame, stage: AdventureStage, origin: Point, seen: (p: Point) => boolean): Point[] {
    const a = game.adventure, b = game.battle, out: Point[] = [];
    if (a.room !== this.room) {
      this.room = a.room;
      this.focs.clear();
      this.lit.clear();
    }
    const at = (x: number, y: number) => ({ x: origin.x + x, y: origin.y + y });
    for (const actor of stage.area(a.room, a.area).actors) {
      const p = actor.params >>> 0;
      if (actor.id === "YAJI") {
        const across = (p & 15) >= 2;
        if (game.players.some((l) => Math.abs((across ? l.y : l.x) / SUBPX - (across ? actor.y : actor.x)) <= YAJI_REACH)) this.lit.add(actor.index);
        if (p >>> 27 && (this.lit.has(actor.index) || switchOn(b, p >>> 27))) out.push(at(actor.x, actor.y));
      } else if (actor.id === "FOCS") {
        const hold = p & 0xfff, input = (p >>> 22) & 31;
        const f = this.focs.get(actor.index) ?? { state: hold ? 0 : 2, left: hold };
        this.focs.set(actor.index, f);
        const point = at(actor.x, actor.y), on = !input || switchOn(b, input);
        if (f.state === 0 && on) {
          out.push(point);
          if (seen(point)) Object.assign(f, { state: 1, left: hold });
        } else if (f.state === 1) {
          out.push(point);
          if (f.left-- === 0) f.state = 3;
        } else if (f.state === 2 && on) out.push(point);
      }
    }
    for (const it of a.pickups) {
      if (!pickupShown(game, it) || it.fetched) continue;
      if ((it.type === "gem" && it.from === "RUPY" && it.kind >= 3) || it.type === "key") out.push(at(it.x / SUBPX, (it.y - it.z) / SUBPX));
    }
    for (const e of a.enemies) {
      if (e.state === "die" || (e.gate && !switchOn(b, e.gate))) continue;
      const follow =
        e.type === "SLR4" ||
        e.type === "ZSLH" ||
        e.type === "ZSLJ" ||
        (e.type === "SLR1" && e.state === "walk") ||
        (e.type === "OKTA" && e.params === 2) ||
        (e.type === "ZORA" && e.state !== "hide");
      if (follow) out.push(at(e.x / SUBPX, e.y / SUBPX));
    }
    return out;
  }
}

/** The TV camera as the view drives it, once per simulation tick: the rooms on the stage's grid, its points. */
export class TvCamera {
  readonly camera = new AdventureCamera();
  private readonly focus = new FocusPoints();
  private readonly stage: AdventureStage;
  private room = -1;

  constructor(stage: AdventureStage) {
    this.stage = stage;
  }

  get view(): Box {
    return this.camera.view;
  }

  follow(game: AdventureGame): void {
    const a = game.adventure, p = game.players[0]!, cell = this.stage.cellOf(a.room);
    if (!cell) return;
    const o = { x: cell.cx * ROOM_W, y: cell.cy * ROOM_H };
    const targets: CameraTargets = {
      leader: { x: o.x + p.x / SUBPX, y: o.y + p.y / SUBPX },
      focus: a.area === 0 ? this.focus.points(game, this.stage, o, (q) => this.onTv(q)) : [],
      wholeRoom: a.area !== 0,
    };
    if (a.room !== this.room) {
      // A room change by an edge pans; a warp, a stairway or the first frame snaps.
      this.camera.enter({ left: o.x, top: o.y, right: o.x + ROOM_W, bottom: o.y + ROOM_H }, targets, this.room >= 0 && !!a.edge);
      this.room = a.room;
    }
    this.camera.step(targets);
  }

  /** Whether a world point is on the TV, 14 px in from its sides (0x8030C2A8). */
  private onTv(q: Point): boolean {
    const v = this.camera.view, k = TV_W / (v.right - v.left);
    const x = (q.x - v.left) * k, y = (q.y - v.top) * k;
    return x >= 14 && x < TV_W - 14 && y >= 14 && y < 448 - 14;
  }
}
