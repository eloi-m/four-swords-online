// The four Links in formation (playing alone): the leader is the player's, the other three follow, each walking the
// trail of the Link ahead of it. Measured in Dolphin (docs/measurements/adventure-lake-hylia.md "Adventure: rooms, doors, enemies and Force
// Gems", the Lake Hylia savestate's Links): a follower walks at walking speed along the points the Link ahead passed
// (corners included), and doesn't take a step that would bring it closer than 18 px (of trail) to that Link; the second
// Link steps before the leader moves (19.5 px behind him while walking, 18.5 once he stopped), the third and fourth
// after the Link ahead (18 px). A room change or a door stacks them onto the leader.
// The four share one heart meter (the single-player HUD has one): damage to any is taken off all.
import type { Fighter } from "../combat.ts";
import { isqrt } from "../entities.ts";
import { HITBOX, HITBOX_CORNER, moveAxis, SUBPX, wallAhead, WALK_SPEED, type Facing, type PlayerState } from "../player.ts";
import { isSolidAt, type World } from "../world.ts";
import type { AdventureGame } from "./adventure.ts";

/** A follower's step per axis in deep water (traced: 1 px/tick). */
export const SWIM_FOLLOW_SPEED = SUBPX;
/** Trail px a follower keeps from the Link ahead (measured 18). */
export const FOLLOW_SPACING = 18 * SUBPX;
/** Points a trail keeps (older ones are dropped: a follower that far behind heads straight for what's left). */
export const TRAIL_POINTS = 64;

/** Starts the trails: each follower heads for where the Link ahead stands. */
export function resetTrails(game: AdventureGame): void {
  const a = game.adventure;
  a.trails = game.players.slice(0, -1).map((p) => [p.x, p.y]);
  // (And a side view's tracks: sideview.ts stepSideFollower.)
  a.tracks = [];
  for (let i = 1; i < a.links.length; i++) a.links[i]!.chase = false;
}

/**
 * Notes where Link `i` stands now on the trail its follower walks, once he's a pixel or more (on either axis) from the
 * last point noted (a wall's half step isn't: measured, the follower went past it).
 */
export function recordTrail(game: AdventureGame, i: number): void {
  const p = game.players[i]!, t = game.adventure.trails[i];
  if (!t?.length) return;
  if (Math.max(Math.abs(p.x - t[t.length - 2]!), Math.abs(p.y - t[t.length - 1]!)) < SUBPX) return;
  t.push(p.x, p.y);
  if (t.length > TRAIL_POINTS * 2) t.splice(0, t.length - TRAIL_POINTS * 2);
}

const dist = (ax: number, ay: number, bx: number, by: number) => isqrt((ax - bx) ** 2 + (ay - by) ** 2);

/** Trail length from follower `f` to the Link ahead `a` along the points `t`. */
function remaining(f: PlayerState, a: PlayerState, t: readonly number[]): number {
  let d = 0, x = f.x, y = f.y;
  for (let k = 0; k < t.length; k += 2) {
    d += dist(x, y, t[k]!, t[k + 1]!);
    [x, y] = [t[k]!, t[k + 1]!];
  }
  return d + dist(x, y, a.x, a.y);
}

/**
 * One follower's tick: a step toward the next point of the trail of the Link ahead, up to `speed` on each axis
 * (walking speed; swimming slower: adventure.ts stepOther), if it keeps FOLLOW_SPACING (measured: past the leader's last half step at a corner, the second Link went 0.5 across
 * and 1.5 up in one tick, onto the leader's first step round the corner).
 */
export function stepFollower(game: AdventureGame, i: number, speed = WALK_SPEED): void {
  const p = game.players[i]!, ahead = game.players[i - 1]!, t = game.adventure.trails[i - 1];
  if (!t?.length) return;
  // The trail keeps its last point (where the next one is noted from); points reached are dropped.
  while (t.length > 2 && p.x === t[0] && p.y === t[1]) t.splice(0, 2);
  const tx = t[0]!, ty = t[1]!;
  const mx = Math.max(-speed, Math.min(speed, tx - p.x)), my = Math.max(-speed, Math.min(speed, ty - p.y));
  if ((!mx && !my) || remaining(p, ahead, t) - dist(0, 0, mx, my) < FOLLOW_SPACING) {
    p.moving = false;
    p.walkTicks = 0;
    return;
  }
  const x0 = p.x, y0 = p.y;
  p.x += mx;
  p.y += my;
  if (t.length > 2 && p.x === tx && p.y === ty) t.splice(0, 2);
  const dx = p.x - x0, dy = p.y - y0;
  if (dx || dy) {
    p.facing = facingOf(dx, dy, p.facing);
    p.walkTicks++;
    p.moving = true;
    recordTrail(game, i);
  }
}

// The walk's facing: the axis it moves most along (a pure diagonal keeps a facing on it).
function facingOf(dx: number, dy: number, current: Facing): Facing {
  const h: Facing = dx > 0 ? "right" : "left", v: Facing = dy > 0 ? "down" : "up";
  if (Math.abs(dx) > Math.abs(dy)) return h;
  if (Math.abs(dy) > Math.abs(dx)) return v;
  return current === h || current === v ? current : h;
}

/**
 * The C stick's formations (traced in Lake Hylia room 2 and its cave, docs/measurements/adventure-lake-hylia.md "Adventure: swimming,
 * ledges, formations"): instead of the trail, the followers keep places beside the leader, the same whatever his
 * facing: "wide" (C right) to his right 16 px apart, "box" (C up) a 2 × 2 square with him top-left, "cross" (C left) a
 * diamond under him (and he turns up; the others face out, and its spin attack is a whirl: whirl.ts), "long" (C
 * down) a column under him. They dash to their places at 6.5 px/tick and walk with him; walls stop them one by one (a follower caught on a wall pushes it). A room change or a door ends
 * the formation (the followers trail again: traced after the cave's door).
 * Walls (traced in Lake Hylia room 3 round its 32 × 16 rock at (224, 288), docs/measurements/adventure-lake-hylia.md
 * "Adventure: formations against walls"): a follower that got no nearer his place this tick while the leader has a
 * clear straight way to it is put on the leader, a walking step toward it, and dashes from there (how one left behind
 * a wall corner gets round; with the way blocked, or his place in a wall, he stays pressed against it: the straight-way
 * test is inferred from when it did and didn't happen). The four in their places walk as one, a follower in his place
 * held by a wall holding the leader too (holdFormation; the routes gather once they're done with a formation). Traced,
 * not applied (the routes were scripted without it and the Cave of No Return's then fell short of its quota): a blocked
 * dash goes on at 0.3 of its step, sliding along the wall.
 */
export type FormationKind = "trail" | "box" | "long" | "cross" | "wide" | "apart" | "gather";
/** The input bits of the C stick (above the sim's Button bits; only the adventure reads them). */
export const FORMATION_BUTTONS: Readonly<Record<StickFormation, number>> = { box: 128, long: 256, cross: 512, wide: 1024 };
/** The C stick's formations. */
export type StickFormation = "box" | "long" | "cross" | "wide";
export const FORMATION_MASK = 128 | 256 | 512 | 1024;
/** The followers' places, px from the leader. */
export const FORMATION_SLOTS: Readonly<Record<StickFormation, readonly (readonly [number, number])[]>> = {
  wide: [[16, 0], [32, 0], [48, 0]],
  box: [[16, 0], [0, 16], [16, 16]],
  cross: [[-16, 16], [16, 16], [0, 32]],
  long: [[0, 16], [0, 32], [0, 48]],
};
/** The cross faces out (traced in Hyrule Castle room 58): its left, right and bottom Links face that way, whatever the
 *  leader's facing (the other formations face his way). */
export const CROSS_FACINGS: readonly Facing[] = ["left", "right", "down"];
/** How fast followers go to their places (traced: 6.5 px/tick along the line to it). */
export const FORMATION_DASH = 1664;

/** A C press picks a formation (the leader's buttons `buttons`, `held` last tick's). */
export function pickFormation(game: AdventureGame, buttons: number, held: number): void {
  const pressed = buttons & ~held & FORMATION_MASK;
  if (!pressed || game.players.length < 2 || game.adventure.away) return;
  const kind = (Object.keys(FORMATION_BUTTONS) as (keyof typeof FORMATION_BUTTONS)[]).find((k) => pressed & FORMATION_BUTTONS[k]);
  if (!kind) return;
  game.adventure.formation = kind;
  if (kind === "cross") game.players[0]!.facing = "up";
}

/**
 * Moving the Links apart (traced in Lake Hylia room 3, `free1`…`free5`, and room 58's area 5): X makes the three others
 * stand and wait (sprite 451, facing down) while the leader goes on alone; stacked on him (after a door or a room
 * change) they first step away (each about 16 px, over 8 ticks: red down-right, blue down, purple left; TODO(measure):
 * whether it depends on the facing), trailing him they stay where they are. The D-pad hands the controls to the Link of
 * that color (right red, left blue, down purple; up green assumed); the one left waits where he is, put on the middle of
 * a floor switch he stands on (traced: (265.1, 216.6) → (264, 216)). Y calls them back (they dash to the one in
 * control, then trail him again); the C stick puts them in a formation again. The one in control goes through doors
 * and room changes alone (traced: the others stayed on their switches in area 5); Y then brings them onto him at once,
 * from wherever they are (AdventureState.away).
 * The sim keeps the Link in control in slot 0 (the leader everything else reads): handing over swaps the two slots'
 * records, AdventureState.colors saying which Link (tunic) is in which slot.
 */
export const SEPARATE_BUTTON = 2048;
export const GATHER_BUTTON = 4096;
/** The D-pad's pick: this bit, with the Link's color (0 green, 1 red, 2 blue, 3 purple) in bits 13-14. */
export const SELECT_BUTTON = 32768;
export const selectButtons = (color: number): number => SELECT_BUTTON | ((color & 3) << 13);
/** Where X sends each follower stacked on the leader, by color (px from where he stood; traced from the leader facing down). */
export const APART_STEPS: readonly (readonly [number, number])[] = [[0, 16], [15, 9], [0, 13], [-16, 4]];
export const APART_TICKS = 8;
/** A follower this close to the leader (px, both axes) is stacked on him: X sends him a step away. */
export const STACKED = 4;
/** The sprite of a Link standing apart, waiting. */
export const WAITING_FRAME = 451;
/** A floor switch's reach for a Link left on it (px from its middle, both axes): he's put on the middle. */
export const SWITCH_SEAT = 8;

/** X, Y and the D-pad (the leader's buttons `buttons`, `held` last tick's): apart, together, another Link in control. */
export function pickApart(game: AdventureGame, buttons: number, held: number): void {
  const a = game.adventure, pressed = buttons & ~held;
  if (game.players.length < 2) return;
  if (pressed & SEPARATE_BUTTON && a.formation !== "apart") {
    a.formation = "apart";
    const l = game.players[0]!;
    for (let i = 1; i < game.players.length; i++) {
      const p = game.players[i]!, [dx, dy] = APART_STEPS[a.colors[i] ?? i] ?? [0, 0];
      const stacked = Math.abs(p.x - l.x) <= STACKED * SUBPX && Math.abs(p.y - l.y) <= STACKED * SUBPX;
      Object.assign(a.links[i]!, { ox: p.x + (stacked ? dx * SUBPX : 0), oy: p.y + (stacked ? dy * SUBPX : 0), tick: stacked ? APART_TICKS : 0 });
      p.facing = "down";
    }
  } else if (pressed & GATHER_BUTTON && a.away) {
    // From another area they're on him at once (traced: the next tick).
    a.away = null;
    a.formation = "trail";
    gatherOnLeader(game);
  } else if (pressed & GATHER_BUTTON && a.formation !== "trail") a.formation = "gather";
  else if (pressed & SELECT_BUTTON && a.formation === "apart" && !a.away) {
    const k = a.colors.indexOf((buttons >> 13) & 3);
    if (k > 0) {
      swapSlots(game, 0, k);
      seatOnSwitch(game, k);
    }
  }
}

/** Link `i`, left waiting on a floor switch, is put on its middle. */
function seatOnSwitch(game: AdventureGame, i: number): void {
  const p = game.players[i]!;
  for (const e of game.battle.entities) {
    if (e.kind !== "switch") continue;
    const cx = e.x + 8 * SUBPX, cy = e.y + 8 * SUBPX;
    if (Math.abs(p.x - cx) > SWITCH_SEAT * SUBPX || Math.abs(p.y - cy) > SWITCH_SEAT * SUBPX) continue;
    Object.assign(p, { x: cx, y: cy, facing: "down" });
    return;
  }
}

/** Swaps two Links' places in the state (their players, fighters, motions and colors). */
function swapSlots(game: AdventureGame, i: number, k: number): void {
  const a = game.adventure, b = game.battle;
  const swap = <T>(list: T[]) => ([list[i], list[k]] = [list[k]!, list[i]!]);
  swap(game.players);
  swap(b.fighters);
  swap(a.links);
  swap(a.colors);
  for (const p of [game.players[i]!, game.players[k]!]) Object.assign(p, { moving: false, walkTicks: 0 });
  a.links[k]!.tick = 0;
  resetTrails(game);
}

/** A follower's tick apart: the step away X sent him, then standing; or dashing back to the leader on Y. */
export function stepApart(game: AdventureGame, i: number, world: World): void {
  const a = game.adventure, p = game.players[i]!, m = a.links[i]!;
  if (a.formation === "apart") {
    if (m.tick > 0) {
      const k = m.tick--;
      moveAxis(p, world, Math.round((m.ox - p.x) / k), "x");
      moveAxis(p, world, Math.round((m.oy - p.y) / k), "y");
      p.moving = true;
      p.walkTicks++;
    } else {
      p.moving = false;
      p.walkTicks = 0;
    }
    return;
  }
  // Called back: a dash (as into a formation) onto the leader.
  const l = game.players[0]!, d = dist(p.x, p.y, l.x, l.y), x0 = p.x, y0 = p.y;
  if (d > 0) {
    const k = Math.min(1, FORMATION_DASH / d);
    moveAxis(p, world, Math.round((l.x - p.x) * k), "x");
    moveAxis(p, world, Math.round((l.y - p.y) * k), "y");
  }
  p.moving = p.x !== x0 || p.y !== y0;
  if (p.moving) p.walkTicks++;
}

/** Called back, once every Link is on the leader or got as near as he could, they trail him again. */
export function gatherDone(game: AdventureGame): void {
  const a = game.adventure, l = game.players[0]!;
  if (a.formation !== "gather") return;
  if (game.players.every((p, i) => i === 0 || !p.moving || (Math.abs(p.x - l.x) <= 2 * SUBPX && Math.abs(p.y - l.y) <= 2 * SUBPX))) gatherOnLeader(game);
}

/** A follower's dash toward (tx, ty) (1/256 px): `speed` (FORMATION_DASH) per tick along the line, against the walls. */
export function dashTo(p: PlayerState, world: World, tx: number, ty: number, speed = FORMATION_DASH): void {
  const d = dist(p.x, p.y, tx, ty);
  if (d > 0) {
    const k = Math.min(1, speed / d);
    moveAxis(p, world, Math.round((tx - p.x) * k), "x");
    moveAxis(p, world, Math.round((ty - p.y) * k), "y");
  }
}

// A Link's box (its side middles and corners, as player.ts's sensors).
const BOX: readonly (readonly [number, number])[] = [
  [0, HITBOX.top], [0, HITBOX.bottom], [HITBOX.left, 0], [HITBOX.right, 0],
  [-HITBOX_CORNER, -HITBOX_CORNER], [HITBOX_CORNER, -HITBOX_CORNER], [-HITBOX_CORNER, HITBOX_CORNER], [HITBOX_CORNER, HITBOX_CORNER],
];

/** Whether a Link's box goes from (ax, ay) to (bx, by) (1/256 px) in a straight line without meeting a wall (2 px samples). */
function clearLine(world: World, ax: number, ay: number, bx: number, by: number): boolean {
  const n = Math.max(1, Math.ceil(dist(ax, ay, bx, by) / (2 * SUBPX)));
  for (let k = 1; k <= n; k++) {
    const x = Math.floor((ax + ((bx - ax) * k) / n) / SUBPX), y = Math.floor((ay + ((by - ay) * k) / n) / SUBPX);
    if (BOX.some(([sx, sy]) => isSolidAt(world, x + sx, y + sy))) return false;
  }
  return true;
}

/** A follower's tick in a C-stick formation: toward its place by the leader, against the walls. */
export function stepFormationFollower(game: AdventureGame, i: number, world: World): void {
  const kind = game.adventure.formation;
  if (kind === "trail" || kind === "apart" || kind === "gather") {
    stepApart(game, i, world);
    return;
  }
  const p = game.players[i]!, l = game.players[0]!;
  const [ox, oy] = FORMATION_SLOTS[kind][i - 1] ?? [0, 0];
  const x0 = p.x, y0 = p.y, tx = l.x + ox * SUBPX, ty = l.y + oy * SUBPX, before = dist(p.x, p.y, tx, ty);
  dashTo(p, world, tx, ty);
  const after = dist(p.x, p.y, tx, ty);
  if (after > 0 && after >= before && clearLine(world, l.x, l.y, tx, ty)) {
    // Left behind a wall while the leader has a clear way to his place: on the leader, a walking step toward it
    // (traced: (1.06, 1.06) off him toward a place at (16, 16), (1.5, 0) toward one at (16, 0); then the dash).
    Object.assign(p, { x: l.x, y: l.y });
    const d = dist(l.x, l.y, tx, ty);
    if (d > 0) {
      const k = Math.min(1, WALK_SPEED / d);
      moveAxis(p, world, Math.round((tx - l.x) * k), "x");
      moveAxis(p, world, Math.round((ty - l.y) * k), "y");
    }
  }
  p.facing = kind === "cross" ? (CROSS_FACINGS[i - 1] ?? l.facing) : l.facing;
  if (p.x !== x0 || p.y !== y0) {
    p.moving = true;
    p.walkTicks++;
  } else {
    p.moving = false;
    p.walkTicks = 0;
  }
}

/**
 * The leader's walk in a C-stick formation, from where he stood (x0, y0): the four in their places walk as one, so a
 * follower in his place whose side meets a wall that way holds the leader there, per axis (traced: the column walking
 * right stopped where its second Link met room 3's rock, docs/measurements/adventure-lake-hylia.md "Walking in
 * formation"). Without it the leader walked on into the held follower's spot: the box walking right into a two-Link rock
 * left him stacked on his second Link, and the two lifted it as one Link on screen. Not applied (untraced in detail): the
 * corner slide that moves all four with a follower (a follower touching a wall with a corner only doesn't hold him); a
 * follower still dashing to his place doesn't hold him (traced).
 */
export function holdFormation(game: AdventureGame, world: World, x0: number, y0: number): void {
  const a = game.adventure, kind = a.formation;
  if (!(kind in FORMATION_SLOTS) || a.crossSpin) return;
  const l = game.players[0]!, slots = FORMATION_SLOTS[kind as StickFormation];
  for (let i = 1; i < game.players.length; i++) {
    const p = game.players[i]!, f = game.battle.fighters[i]!, m = a.links[i];
    const [ox, oy] = slots[i - 1] ?? [0, 0];
    if (f.mode !== "active" || f.move !== "none" || (m && m.mode !== "walk")) continue;
    if (Math.abs(p.x - (x0 + ox * SUBPX)) > IN_PLACE || Math.abs(p.y - (y0 + oy * SUBPX)) > IN_PLACE) continue;
    for (const axis of ["x", "y"] as const) {
      const d = l[axis] - (axis === "x" ? x0 : y0);
      const way: Facing = axis === "x" ? (d > 0 ? "right" : "left") : d > 0 ? "down" : "up";
      if (!d || !wallAhead(world, p, way)) continue;
      const q = { x: p.x, y: p.y };
      moveAxis(q, world, d, axis);
      if (Math.abs(q[axis] - p[axis]) < Math.abs(d)) l[axis] = (axis === "x" ? x0 : y0) + q[axis] - p[axis];
    }
  }
}
/** A follower this close (1/256 px, per axis) to his place is in it (the dash lands on it exactly; a wall leaves him off). */
const IN_PLACE = SUBPX / 4;

/** Stacks the other Links onto the leader and starts their trails there (a room change, a door). */
export function gatherOnLeader(game: AdventureGame): void {
  const l = game.players[0]!, links = game.adventure.links;
  // The Links apart stay where they are (in another area, or back in theirs).
  if (game.adventure.away || game.adventure.formation === "apart") return;
  game.adventure.formation = "trail";
  for (const p of game.players.slice(1)) Object.assign(p, { x: l.x, y: l.y, facing: l.facing, moving: false, walkTicks: 0, action: "none", actionTick: 0 });
  // Where he is: swimming with him (or not), none of them mid-jump.
  const swimming = links[0]?.mode === "swim" || links[0]?.mode === "wade";
  for (let i = 1; i < links.length; i++) Object.assign(links[i]!, { mode: swimming ? "swim" : "walk", tick: links[0]!.tick, speed: 0, ledge: 0, vx: 0, vy: 0 });
  game.adventure.hops = [];
  resetTrails(game);
}

/**
 * The shared heart meter, after a tick that started at `before` (quarter hearts): the most any Link lost comes off, the
 * most any gained goes on, and every Link shows the result (up to `max`).
 */
export function shareHearts(fighters: Fighter[], before: number, max: number): void {
  if (fighters.length < 2) return;
  let lost = 0, gained = 0;
  for (const f of fighters) {
    lost = Math.min(lost, f.hearts - before);
    gained = Math.max(gained, f.hearts - before);
  }
  const shared = Math.max(0, Math.min(max, before + lost + gained));
  for (const f of fighters) f.hearts = shared;
}
