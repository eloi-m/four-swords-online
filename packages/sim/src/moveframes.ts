// player_sob frames for the Shadow Battle moves beyond walking and the sword: lifting, carrying, throwing, slamming,
// rolling, using an item and riding Epona, plus being held or thrown by another Link. Play orders and durations were
// measured in Dolphin (docs/measurements/battle-combat.md, "Lifting, throwing, rolling, damage and items") unless marked TODO.
// A move's press tick (moveTick -1) still shows the walking or standing frame; the move plays from the next tick.
import { PLAYER_ANIMATIONS, type Dir, type PerDir } from "./animations.ts";
import { BOOTS } from "./attacks.ts";
import type { Fighter } from "./combat.ts";
import { fireRodFrame, hammerFrame } from "./itemframes.ts";
import type { PlayerState } from "./player.ts";
import { CIRCLE_RAISE_TICKS, circleHidden, HOLE_FALL_TICKS, launchHidden, warpWalkStep } from "./siderooms.ts";

const DIRS: readonly Dir[] = ["right", "left", "down", "up"];
/** Frames `base(d) + offsets` per facing. */
const per = (base: (i: number) => number, offsets: readonly number[]): PerDir<readonly number[]> =>
  Object.fromEntries(DIRS.map((d, i) => [d, offsets.map((o) => base(i) + o)])) as unknown as PerDir<readonly number[]>;

export interface MoveAnimation {
  readonly frames: PerDir<readonly number[]>;
  readonly ticks: readonly number[];
}

/** Lifting (state 17): b ×7, b+1 ×8, b+2 ×8, b+3 ×1, b = 688 + 4 × direction; carrying from the 25th tick. */
export const LIFT: MoveAnimation = { frames: per((i) => 688 + 4 * i, [0, 1, 2, 3]), ticks: [7, 8, 8, 1] };
/** The empty lift (Action standing, nothing in front): b ×8, b+1 ×13. */
export const EMPTY_LIFT: MoveAnimation = { frames: per((i) => 688 + 4 * i, [0, 1]), ticks: [8, 13] };

/** Carrying (state 18): the arms-up walk, 3 ticks per frame (24-tick cycle); standing shows the first frame. */
export const CARRY = {
  stand: { right: 704, left: 708, down: 712, up: 719 } as PerDir<number>,
  walk: {
    right: [704, 705, 706, 707, 704, 705, 706, 707],
    left: [708, 709, 710, 711, 708, 709, 710, 711],
    down: [712, 713, 714, 715, 712, 716, 717, 718],
    up: [719, 720, 721, 722, 719, 723, 724, 725],
  } as PerDir<readonly number[]>,
  walkTicks: [3, 3, 3, 3, 3, 3, 3, 3] as readonly number[],
  /** The load bobs with the walk: height offset (px) per walk frame. */
  bob: [0, 2, 1, -1, 0, 2, 1, -1] as readonly number[],
};

/** Throwing (states 22 then 23): t ×7, t+1 ×2, t+2 ×1, then t+2, t+3 ×8, t+4 ×4, t+2; t = 802 + 5 × direction. */
export const THROW: MoveAnimation = { frames: per((i) => 802 + 5 * i, [0, 1, 2, 2, 3, 4, 2]), ticks: [7, 2, 1, 1, 8, 4, 1] };
/** The throw lets go on its 11th tick (the first of state 23). */
export const THROW_RELEASE_TICK = 10;
/** The slam (state 21, Sword while carrying): t ×7, t+1, t+2, t+3 ×8, t+4 ×4, t+2 (measured facing up). */
export const SLAM: MoveAnimation = { frames: per((i) => 802 + 5 * i, [0, 1, 2, 3, 4, 2]), ticks: [7, 1, 1, 8, 4, 1] };

/** Rolling (state 79): r ×4, r+1 ×4, r+2 ×3, r+3 ×3, r+4 ×3, r+5 ×4, r = 770 + 6 × direction. */
export const ROLL: MoveAnimation = { frames: per((i) => 770 + 6 * i, [0, 1, 2, 3, 4, 5]), ticks: [4, 4, 3, 3, 3, 4] };

/** Using an item: the bow and slingshot (b, w, b+2, b+3 for 3, 4, 3, 4 ticks), the boomerang (c…c+3: 2, 2, 2, 11). */
// The bow's and slingshot's second frame is their walk pose w (bow 335 + 3 × direction, slingshot 758 + 3 × direction).
const aim = (b: number, w: number): MoveAnimation => ({
  frames: Object.fromEntries(DIRS.map((d, i) => [d, [b + 4 * i, w + 3 * i, b + 4 * i + 2, b + 4 * i + 3]])) as unknown as PerDir<readonly number[]>,
  ticks: [3, 4, 3, 4],
});
export const USE = {
  bow: aim(319, 335),
  slingshot: aim(742, 758), // measured facing down (750, 764); the others by the same layout (hypothesis)
  boomerang: { frames: per((i) => 347 + 4 * i, [0, 1, 2, 3]), ticks: [2, 2, 2, 11] } as MoveAnimation,
};
/** The shot leaves on the 7th tick of the pose at the earliest (bow, slingshot and boomerang traced). */
export const USE_RELEASE_TICK = 6;
/** Walking while drawing the bow or the slingshot: w, w+1, w, w+2 for 4, 4, 2, 4 ticks (traced: the bow facing right). */
export const USE_WALK = { offsets: [0, 1, 0, 2] as readonly number[], ticks: [4, 4, 2, 4] as readonly number[], cycle: 14 };

/** The bow's or slingshot's pose: b ×3, then w (walking: USE_WALK) until the shot, then b+2 ×3, b+3 ×4 (traced). */
function aimFrame(use: MoveAnimation, p: PlayerState, f: Fighter): number {
  const frames = use.frames[p.facing];
  if (f.shot < 0 || f.moveTick <= f.shot) {
    if (f.moveTick < use.ticks[0]!) return frames[0]!;
    return frames[1]! + (p.moving && p.walkTicks > 0 ? USE_WALK.offsets[frameAt(USE_WALK.ticks, p.walkTicks)]! : 0);
  }
  return f.moveTick - f.shot <= use.ticks[2]! ? frames[2]! : frames[3]!;
}

/** Held over another Link's head (traced in battle, the held Link facing down): 662, 663, 662, 664, 665, 664, 6 ticks
 *  each from the lift's press tick, and a frame on at once on each press of a direction (his struggle: carry.ts keeps
 *  the count in moveTick). The other facings' frames are assumed the same. */
export const HELD = { frames: [662, 663, 662, 664, 665, 664] as readonly number[], frameTicks: 6 };
/** Thrown or wriggling free: the held frame stays through the hop (traced: 662 or 663). */
export const THROWN = { frame: 662 };
/**
 * Riding Epona (traced, items.ts): the mount 850-853, 7 ticks each; then the gallop's frame by its speed: base at
 * 3 px/tick, base+1 slowing, base+2 at 2 (right 826, left 829, down 832, up 835).
 */
export const RIDE = {
  mount: [850, 851, 852, 853] as readonly number[],
  mountTicks: 7,
  /** How long the mount lasts: the frames twice round. */
  mountFor: 56,
  base: { right: 826, left: 829, down: 832, up: 835 } as PerDir<number>,
};
/** The gallop frame for a tick of the 19-tick round (items.ts EPONA_GALLOP: 7 fast, 4 slowing, 8 slow). */
export const rideFrame = (facing: keyof PerDir<number>, t: number): number => {
  const k = t % 19;
  return RIDE.base[facing] + (k < 7 ? 0 : k < 11 ? 1 : 2);
};

export function frameAt(ticks: readonly number[], tick: number): number {
  for (let i = 0; i < ticks.length; i++) {
    tick -= ticks[i]!;
    if (tick < 0) return i;
  }
  return ticks.length - 1;
}

export const sumTicks = (ticks: readonly number[]) => ticks.reduce((a, b) => a + b, 0);
export const CARRY_CYCLE = sumTicks(CARRY.walkTicks);

/** The carry walk frame (0-7) Link shows. */
export function carryStep(p: PlayerState): number {
  return p.moving && p.walkTicks > 0 ? frameAt(CARRY.walkTicks, p.walkTicks % CARRY_CYCLE) : 0;
}

const play = (a: MoveAnimation, p: PlayerState, tick: number) => a.frames[p.facing][frameAt(a.ticks, tick)]!;

/** The frame for a Link's move (Fighter.move), or null when he's walking or using his sword. */
export function moveFrame(p: PlayerState, f: Fighter): number | null {
  // The press tick of a throw or a slam still carries (traced); other moves' press ticks walk or stand.
  if (f.moveTick < 0 && (f.move === "throw" || f.move === "slam")) return CARRY.stand[p.facing];
  if (f.move === "dash" || f.move === "crash" || f.move === "jolt") return bootsFrame(p, f);
  if (f.move === "hammer" || f.move === "squash") return hammerFrame(p, f);
  if (f.move === "fireRod" || f.move === "burning") return fireRodFrame(p, f);
  if (f.moveTick < 0 && f.move !== "held" && f.move !== "thrown") return null; // the press tick
  switch (f.move) {
    case "lift":
      return play(LIFT, p, f.moveTick);
    case "emptyLift":
      return play(EMPTY_LIFT, p, f.moveTick);
    case "carry":
      return p.moving && p.walkTicks > 0 ? CARRY.walk[p.facing][carryStep(p)]! : CARRY.stand[p.facing];
    case "throw":
      return play(THROW, p, f.moveTick);
    case "slam":
      return play(SLAM, p, f.moveTick);
    case "roll":
      return play(ROLL, p, f.moveTick);
    case "held":
      return HELD.frames[Math.floor(f.moveTick / HELD.frameTicks) % HELD.frames.length]!;
    case "thrown":
      return THROWN.frame;
    case "use":
      if (f.item === "bow" || f.item === "slingshot") return aimFrame(USE[f.item], p, f);
      return play(USE.boomerang, p, f.moveTick);
    case "take":
      return takeFrame(p, f);
    case "ride":
      if (f.moveTick < RIDE.mountFor) return RIDE.mount[Math.floor(f.moveTick / RIDE.mountTicks) % RIDE.mount.length]!;
      return rideFrame(p.facing, f.moveTick - RIDE.mountFor);
    case "warp":
      // Through a door: the walk cycle at 2 ticks a frame, its first stride while he stands in the doorway (measured).
      return WALK_BASE[p.facing] + warpWalkStep(f);
    case "hole":
      // Into a hole: the pit's fall, then standing in the side room (measured).
      return f.moveTick > 0 && f.moveTick <= HOLE_FALL_TICKS ? holeFallFrame(f.moveTick - 1) : STAND[p.facing];
    case "cannon":
      return IN_CANNON; // (measured: 976 all the ride)
    case "launch":
      return launchHidden(f) ? -1 : LAUNCHED; // shot up, gone over the top edge and in the hole, then flying (176)
    case "circle":
    case "circleBack":
      // Through a magic circle and back (measured): the sword raised (796), gone, standing; hidden on the TV coming back.
      if (circleHidden(f)) return -1;
      return f.moveTick > 0 && f.moveTick <= CIRCLE_RAISE_TICKS ? CIRCLE_RAISE : STAND[p.facing];
    case "spot":
      return circleHidden(f) ? -1 : STAND[p.facing]; // spinning (siderooms.ts turns him)
    default:
      return null;
  }
}

/**
 * The boots (traced, every facing): a counter c = ticks since the press / 2; standing, c walk frames on,
 * then dashing on `BOOTS_DASH` [c mod its length]; the crash on the knockback frames (k ×4, k+1 ×4, k+2 ×4, k+3), from the
 * tick after the one that met the wall (still a dash frame); a Link hopping near a crash keeps his standing pose.
 */
export const BOOTS_DASH: PerDir<readonly number[]> = {
  right: [197, 198, 199, 200],
  left: [201, 202, 203, 204],
  down: [205, 206, 207, 208, 205, 209, 210, 211],
  up: [212, 213, 214, 215, 212, 216, 217, 218],
};
const KNOCKBACK = PLAYER_ANIMATIONS.knockback.frames;
function bootsFrame(p: PlayerState, f: Fighter): number | null {
  if (f.move === "jolt") return STAND[p.facing];
  if (f.move === "crash" && f.moveTick >= 0) return KNOCKBACK[p.facing][Math.min(3, f.moveTick >> 2)]!;
  if (f.moveTick < 0 && f.move === "dash") return null; // the press tick walks
  // (The crash's first tick: the dash's tick it met the wall on, kept in `shot`.)
  const k = (f.move === "crash" ? f.shot : f.moveTick) + 1, c = k >> 1;
  if (k <= BOOTS.charge) return WALK_BASE[p.facing] + c;
  const frames = BOOTS_DASH[p.facing];
  return frames[c % frames.length]!;
}

/**
 * Taking an item off the ground (traced, the Link facing up): standing 9 ticks, then the pose facing the camera whatever
 * his facing: 234 ×4, 235, 236 until he's free (orbs.ts TAKE_TICKS).
 */
export const TAKE = { standTicks: 9, frames: [234, 235, 236] as readonly number[], ticks: [4, 1] as readonly number[] };
function takeFrame(p: PlayerState, f: Fighter): number {
  const t = f.moveTick - TAKE.standTicks;
  if (t < 0) return STAND[p.facing];
  return t < TAKE.ticks[0]! ? TAKE.frames[0]! : t < TAKE.ticks[0]! + TAKE.ticks[1]! ? TAKE.frames[1]! : TAKE.frames[2]!;
}

/** player_sob in a cannon, and shot from one (measured); raising his sword in a magic circle (measured facing up). */
const CIRCLE_RAISE = 796;
const IN_CANNON = 976;
const LAUNCHED = 176;
const STAND: PerDir<number> = { right: 60, left: 61, down: 62, up: 63 };
/** The pit's fall frames (combat.ts FALL_SEQUENCE: 183 ×8, 184 ×8, 185 ×8, 186 ×6, 187 ×6, 188 ×6, 187 ×6, 186 ×10). */
const HOLE_FALL = { frames: [183, 184, 185, 186, 187, 188, 187, 186], ticks: [8, 8, 8, 6, 6, 6, 6, 10] } as const;
const holeFallFrame = (t: number): number => HOLE_FALL.frames[frameAt(HOLE_FALL.ticks, t)]!;

/** player_sob's walk cycles: 8 frames per facing from these. */
const WALK_BASE: PerDir<number> = { right: 0, left: 8, down: 16, up: 24 };
