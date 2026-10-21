// The sword against other Links, as Shadow Battle checks it (Dolphin battle traces, docs/measurements/battle-combat.md "Battle
// measurements: combat"). The game doesn't test the blade's pixels: every sword attack stores two boxes along its
// direction (Link +0x4A0: 20 × 16 px from 4 px behind the anchor to 16 ahead, then 16 × 16 px from 16 to 32 ahead; the
// diagonals are two 16 × 16 squares), and the Link-vs-Link pass hits a Link whose ±7 px body box (+0x4C0) meets one
// of them while the attack is live (+0x458 = 1). What is live, and for how much:
// - swing and stab: all 8 ticks, attack power 4 (damage 2);
// - lunge: its 6th to 14th ticks (of 31), power 8 (damage 4); its boxes trail its 4 px/tick move by a tick;
// - charging (the sword held out): every tick, power 2 (damage 1); a hit ends the charge;
// - spin: all 26 ticks, power 8 (damage 4), the boxes turning once clockwise (below).
// A level-2 sword adds 2 to the power (+0xC18 = 2 poked: a stab took 3). The block test uses the attack's direction
// as the game keeps it (+0x3F0): the facing, or during a spin the box's direction with diagonals counted as up/down.
import { LUNGE } from "./animations.ts";
import type { Facing, PlayerState } from "./player.ts";
import { SUBPX } from "./player.ts";

/** A box in 1/256 px, edges inclusive (the game compares floats with <=). */
export interface SubBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The 8 directions clockwise from right, the spin's order. */
export type Dir8 = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
const RIGHT = 0, DOWN = 2, LEFT = 4, UP = 6;
export const DIR8_OF: Readonly<Record<Facing, Dir8>> = { right: RIGHT, down: DOWN, left: LEFT, up: UP };

type Px = readonly [left: number, top: number, right: number, bottom: number];
/** Both attack boxes per direction, px around the anchor (Link +0x4A0…+0x4BC, every direction traced). */
export const ATTACK_BOXES: Readonly<Record<Dir8, readonly [Px, Px]>> = {
  0: [[-4, -8, 16, 8], [16, -8, 32, 8]], // right
  1: [[0, 0, 16, 16], [8, 8, 24, 24]], // down-right
  2: [[-8, -4, 8, 16], [-8, 16, 8, 32]], // down
  3: [[-16, 0, 0, 16], [-24, 8, -8, 24]], // down-left
  4: [[-16, -8, 4, 8], [-32, -8, -16, 8]], // left
  5: [[-16, -16, 0, 0], [-24, -24, -8, -8]], // up-left
  6: [[-8, -16, 8, 4], [-8, -32, 8, -16]], // up
  7: [[0, -16, 16, 0], [8, -24, 24, -8]], // up-right
};

/** Link's body for sword hits and the Links' pushes: ±7 px around the anchor (Link +0x4C0, traced). */
export const BODY_HALF = 7;

export const SWORD_POWER = 4; // swing and stab (0x8027DEA0 sets +0xBF4 = 4; traced)
export const LUNGE_POWER = 8;
export const SPIN_POWER = 8; // a released charge (spin kind 1)
export const CHARGE_POWER = 2; // the sword held out while charging (0x8027C4FC; traced: 1 damage)
export const SWORD_LEVEL_POWER = 2; // added by a level-2 sword (traced with +0xC18 = 2)
/** The lunge is live from its 6th tick to its 14th (traced: +0x458 byte 0 = 1). */
export const LUNGE_LIVE = { from: 6, to: 14 } as const;

/** The spin's box direction on tick n (1-26), for a spin started facing `f` (every facing traced): 3 steps behind
 *  the facing through the wind-up (7 ticks), then 2, 1 behind, the facing on tick 10, and a step every 2 ticks after,
 *  back to the facing on the last 2. */
export function spinDir(f: Dir8, n: number): Dir8 {
  const step = n <= 7 ? -3 : n <= 10 ? n - 10 : Math.ceil((n - 10) / 2);
  return (((f + step) % 8) + 8) % 8 as Dir8;
}

/** The 4-way direction the block test sees for a box direction: diagonals count as their vertical half (traced). */
export function blockFacing(d: Dir8): Facing {
  if (d === RIGHT) return "right";
  if (d === LEFT) return "left";
  return d < LEFT ? "down" : "up";
}

export interface SwordAttack {
  boxes: readonly [SubBox, SubBox];
  /** The direction the victim's shield must face against (opposite to it). */
  facing: Facing;
  /** The attack power; the damage is half of it. */
  power: number;
}

const box = (x: number, y: number, [l, t, r, b]: Px): SubBox => ({ left: x + l * SUBPX, top: y + t * SUBPX, right: x + r * SUBPX, bottom: y + b * SUBPX });

/** Link's sword attack on other Links this tick, or null when it isn't live. `level` is the sword's level (1 or 2). */
export function swordAttack(p: PlayerState, level = 1): SwordAttack | null {
  let dir = DIR8_OF[p.facing];
  let power: number;
  let x = p.x, y = p.y;
  switch (p.action) {
    case "swing":
    case "stab":
      if (p.actionTick === 0) return null; // the press tick
      power = SWORD_POWER;
      break;
    case "lunge": {
      if (p.actionTick < LUNGE_LIVE.from || p.actionTick > LUNGE_LIVE.to) return null;
      power = LUNGE_POWER;
      if (p.actionTick <= LUNGE.moveTicks) {
        // The boxes are set before the tick's 4 px step (traced), so they trail it.
        const [sx, sy] = STEP[p.facing];
        x -= sx * LUNGE.speed;
        y -= sy * LUNGE.speed;
      }
      break;
    }
    case "charge":
      power = CHARGE_POWER;
      break;
    case "spin":
      if (p.actionTick === 0) return null;
      dir = spinDir(dir, p.actionTick);
      power = SPIN_POWER;
      break;
    default:
      return null;
  }
  const [a, b] = ATTACK_BOXES[dir];
  return { boxes: [box(x, y, a), box(x, y, b)], facing: blockFacing(dir), power: power + (level >= 2 ? SWORD_LEVEL_POWER : 0) };
}

/** The boots' dash against other Links (boots.ts): the sword's boxes for the facing, set before the tick's step
 *  (dx, dy: 1/256 px), so they trail it, power 6 (traced: 3 life at either level). */
export function bootsAttack(p: PlayerState, dx: number, dy: number): SwordAttack {
  const dir = DIR8_OF[p.facing], [a, b] = ATTACK_BOXES[dir];
  return { boxes: [box(p.x - dx, p.y - dy, a), box(p.x - dx, p.y - dy, b)], facing: p.facing, power: BOOTS_POWER };
}
export const BOOTS_POWER = 6;
/** The boots' timings and speeds (boots.ts; here, out of the way of the imports). */
export const BOOTS = {
  /** Ticks standing before the dash, after the press tick (traced: 10). */
  charge: 10,
  /** The dash: 3 px/tick; steered, 2.1 px/tick on each axis (traced). */
  speed: 3 * SUBPX,
  speedSteered: 538,
  /** The crash's bounce (0x8046AFE0: 2.0 back, 4.0 up), its ticks to the ground (traced: 33). */
  bounce: 2 * SUBPX,
  hop: 4 * SUBPX,
  /** How near a crash other Links hop (traced: 49.8 px yes, 52.3 no), and wakes bees and thud switches (main.dol: 80²). */
  joltReach: 50,
  impactReach: 80,
} as const;

const STEP: Readonly<Record<Facing, readonly [number, number]>> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };

/** Link's body box (1/256 px, inclusive). */
export function bodyBox(p: Pick<PlayerState, "x" | "y">): SubBox {
  const h = BODY_HALF * SUBPX;
  return { left: p.x - h, top: p.y - h, right: p.x + h, bottom: p.y + h };
}

export const subBoxesOverlap = (a: SubBox, b: SubBox) => a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;

/** Does either attack box meet the box? */
export const attackMeets = (att: SwordAttack, b: SubBox) => subBoxesOverlap(att.boxes[0], b) || subBoxesOverlap(att.boxes[1], b);

/** Do two attacks' boxes meet (a sword clash)? */
export const attacksMeet = (a: SwordAttack, b: SwordAttack) => attackMeets(a, b.boxes[0]) || attackMeets(a, b.boxes[1]);
