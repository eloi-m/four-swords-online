// The hammer's and the Fire Rod's timings, sizes and player_sob frames (hammer.ts, firerod.ts have the rest; here,
// out of the way of the imports, for moveframes.ts).
import { SUBPX, type Facing, type PlayerState } from "./player.ts";
import type { Fighter } from "./combat.ts";

/** Fighter.shot of a hammer pose, a flattening or a Fire Rod pose whose last tick was the last one. */
export const ITEM_OVER = -2;
const OVER = ITEM_OVER;

export const HAMMER = {
  /** Charged after this many ticks held (+0x3FC reaching 48). */
  charge: 48,
  /** The release counter's value on which the pound comes down and its box goes live, and the last live one. */
  pound: 5,
  poundLast: 6,
  /** The pose ends when the release counter reaches this (that tick still in the pose); charged, `endCharged`. */
  end: 17,
  endCharged: 30,
  /** A charged pound's ground impact, on the counter's 18 and 19 (+0xB9A). */
  impact: 18,
  impactLast: 19,
  /** The pound box's half size (px) and the life it takes. */
  half: 8,
  damage: 2,
  damageCharged: 4,
  /** Others within this many px hop at a charged pound (×2 with a level-2 hammer). */
  joltReach: 50,
  /** Flattened: state 64's ticks (11: the height 1.0 down by 0.05 a tick, then 0.5), the flat timer from the hit. */
  squashTicks: 10,
  flatTicks: 300,
  flatTicksCharged: 600,
  /** Height in hundredths: flat, and the step it grows back by a tick. */
  flatHeight: 50,
  regrow: 5,
} as const;

/** The pound's center from the Link (px), by facing (table 0x8046B0C0; charged, its second half). */
export const POUND_AT: Readonly<Record<Facing, readonly [number, number]>> = { right: [20, 7], left: [-20, 7], down: [0, 12], up: [0, -8] };
export const POUND_AT_CHARGED: Readonly<Record<Facing, readonly [number, number]>> = { right: [24, 7], left: [-24, 7], down: [0, 11], up: [0, -6] };

export const hammerCharged = (f: Pick<Fighter, "charge">) => f.charge >= HAMMER.charge;

const DIR_INDEX: Readonly<Record<Facing, number>> = { right: 0, left: 1, down: 2, up: 3 };

/**
 * The hammer's player_sob frame (0x80267818: base + the frame index +0x3FB): 291 + 7 × direction, charged 363 + 8 ×
 * direction (the big hammer); raised while held (index 2, 1 then 0 by the charge), then by the release counter:
 * 1 ×2, 2 ×2, 5 ×8, 6 to the end (measured facing down: 306 ×2, 307 ×2, 310 ×8, 311 ×5); charged 1, 2, then 5 and 6
 * by turns (on the TV indices 3 and 4 show as 5 and 6), 5 ×2, 6 ×2, 5 ×2, 6 ×5, 7 to the end. A flattened Link
 * stands (traced). Null on the press tick (he walks or stands).
 */
export function hammerFrame(p: PlayerState, f: Fighter): number | null {
  const d = DIR_INDEX[p.facing];
  if (f.move === "squash") return [60, 61, 62, 63][d]!;
  if (f.moveTick < 0) return null;
  const charged = hammerCharged(f), c = f.shot === OVER ? (charged ? HAMMER.endCharged : HAMMER.end) : f.shot;
  let k: number;
  if (c === 0) k = f.charge < 2 ? 2 : f.charge < 4 ? 1 : 0;
  else if (!charged) k = c < 3 ? 1 : c < 5 ? 2 : c < 13 ? 5 : 6;
  else k = c < 2 ? 1 : c < 3 ? 2 : c < 9 ? (c % 2 ? 5 : 6) : c < 11 ? 5 : c < 13 ? 6 : c < 15 ? 5 : c < 20 ? 6 : 7;
  return charged ? 363 + 8 * d + k : 291 + 7 * d + k;
}

export const FIRE_ROD = {
  /** The pose's ticks (its counter +0x3FA 0…12) and the counter the fireball leaves on, or the stream holds it on
   *  (traced: 13 ticks, the fireball on the 12th). */
  pose: 13,
  fire: 11,
  /** The fireball: how far ahead it appears (px), its speed (1/256 px/tick: from 0, easing 3 tenths of the way to
   *  2 px/tick before each move, the first on the tick it appears: 0.6, 1.02, 1.31 … traced) and box. */
  out: 8,
  speed: 2 * SUBPX,
  ease: 3,
  half: 6,
  /** Ticks a burst fireball stays for its effect (drawing only: FIRE removes itself at once on the TV). */
  burst: 30,
  lifetime: 600, // safety net: one that never meets a wall goes away
  /** The stream's ticks at most (the magic meter, 384, one a tick). */
  magic: 384,
  /** Fire's damage on a Link (FIRE's atcp) and his invincibility after it. */
  damage: 2,
  invincible: 2,
} as const;

/** Fighter.shot while the Fire Rod's button has stayed held from the press (+0xB84: the stream may go on). */
export const STREAMING = 1;

/** Is this Link's stream of flame out this tick (the pose held on its counter 11, Fighter.charge its ticks)? */
export const streaming = (f: Fighter) => f.move === "fireRod" && f.shot === STREAMING && f.moveTick === FIRE_ROD.fire - 1 && f.charge > 0;

/** The stream's walk frames (rodWalk: 466 right, 470 left, 474 down, 481 up), by the charge's walk cycle. */
const STREAM_WALK: Readonly<Record<Facing, readonly number[]>> = {
  right: [466, 467, 468, 469, 466, 467, 468, 469],
  left: [470, 471, 472, 473, 470, 471, 472, 473],
  down: [474, 475, 476, 477, 474, 478, 479, 480],
  up: [481, 482, 483, 484, 481, 485, 486, 487],
};
const STREAM_WALK_TICKS = [4, 2, 4, 4, 4, 2, 4, 4]; // (animations.ts CHARGE.walkTicks: traced alike)

/**
 * The Fire Rod's player_sob frame: 395 + 6 × direction + the index by the pose's counter (0 ×2, 1, 2, 3 ×6, 4, 5 ×2:
 * traced facing right, 395 ×2, 396, 397, 398 ×6, 399, 400 ×2); through the stream the rod held out (466…), walking
 * on the charge's cycle. Null on the press tick (he walks or stands). A burning Link runs on the TV's run frames
 * (0x80267018: 885 + 8 × direction + a frame every 2 ticks; the GBA screens draw 917… with the flames).
 */
export function fireRodFrame(p: PlayerState, f: Fighter): number | null {
  const d = { right: 0, left: 1, down: 2, up: 3 }[p.facing];
  // (The hit tick still shows the pose he was in.)
  if (f.move === "burning") return f.moveTick < 0 ? null : 885 + 8 * d + (Math.floor((f.moveTick + 1) / 2) & 7);
  if (f.moveTick < 0) return null;
  if (streaming(f)) {
    let t = p.moving ? p.walkTicks : 0, k = 0;
    while (t >= STREAM_WALK_TICKS[k]!) t -= STREAM_WALK_TICKS[k++]!;
    return STREAM_WALK[p.facing][k]!;
  }
  // (After a stream the pose is on its counter 11 at least: the tick the magic ran out shows it too, traced.)
  const c = f.charge > 0 ? Math.max(FIRE_ROD.fire, Math.min(f.moveTick, FIRE_ROD.pose - 1)) : Math.min(f.moveTick, FIRE_ROD.pose - 1);
  return 395 + 6 * d + (c < 2 ? 0 : c < 3 ? 1 : c < 4 ? 2 : c < 10 ? 3 : c < 11 ? 4 : 5);
}
