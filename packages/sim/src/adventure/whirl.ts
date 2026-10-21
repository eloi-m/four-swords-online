// The spin attack in the cross formation: a whirl of the four round the diamond's middle (traced in Hyrule Castle room
// 58, docs/measurements/adventure-world1.md "Hyrule Castle room 58: the cross formation's spin"; the walkthrough's "spin
// attack in cross formation" on its four crystals). Let go after a full charge in the cross, the four spin together
// (state 9) for 34 ticks, not the battle's 26:
// - ticks 1-10: the leader stands, each Link's boxes turning as the battle's spin from his own facing (attacks.ts
//   spinDir; the cross faces out: formation.ts); each follower dashes 6 px/tick, straight, toward the circle of radius
//   16 round the diamond's middle C (the leader + (0, 16)) at the angle of his own box direction (the side ones cross
//   through the middle: in the game they jostle there on ticks 3-6, off that line by up to ~2.5 px; not simulated);
// - ticks 11-34: the four go round C on that circle, 15° a tick clockwise from their places (the leader from up, the
//   left Link from 270°, the right one 90°, the bottom one 180°), back on them on tick 34; the followers still out of
//   it dash on toward their point on it (traced: within ~1 px; the game's steps there are 6.6-6.9 px, not modelled);
//   each one's box direction is the 8-way nearest his angle.
// Every Link's two boxes are placed where he stood the tick before (they trail him a tick, as the lunge's), power 8.
// Then state 0 in the cross again. Not simulated: the 16 ticks everything stands still from the tick the crystals' switch
// (9) comes on (the camera's event, mid-whirl).
import { ATTACK_BOXES, blockFacing, DIR8_OF, SPIN_POWER, SWORD_LEVEL_POWER, spinDir, swordAttack, type Dir8, type SwordAttack } from "../attacks.ts";
import { moveAxis, SUBPX } from "../player.ts";
import type { World } from "../world.ts";
import type { AdventureGame } from "./adventure.ts";
import { dashTo } from "./formation.ts";

/** The whirl's ticks (state 9 in the cross: traced 34). */
export const CROSS_SPIN_TICKS = 34;
/** Its wind-up: the leader stands and the followers dash out (ticks 1-10). */
export const CROSS_SPIN_WINDUP = 10;
/** The followers' dash (traced: 6 px/tick). */
export const CROSS_SPIN_DASH = 6 * SUBPX;
/** The circle's middle below the leader (px) and its radius (px). */
export const CROSS_SPIN_MIDDLE = 16;
export const CROSS_SPIN_RADIUS = 16;
/** Each slot's place on the circle, in 15° steps clockwise from up: the leader up, then the cross's left, right and
 *  bottom Links (formation.ts FORMATION_SLOTS.cross). One step a tick round it from tick 11. */
export const CROSS_SPIN_PLACES: readonly number[] = [0, 18, 6, 12];

/** The whirl under way (AdventureState.crossSpin): its tick (1-34), the circle's middle and where each Link stood the
 *  tick before (x, y per Link, 1/256 px: the boxes' anchors). */
export interface CrossSpin {
  tick: number;
  cx: number;
  cy: number;
  at: number[];
}

// sin(15° × k) × 16 px in 1/256 px, k = 0…6 (a table: the sim stays in integers).
const SIN16 = [0, 1060, 2048, 2896, 3547, 3956, 4096];
/** sin and −cos of 15° × `k` (clockwise from up), × 16 px in 1/256 px: the circle's point. */
function onCircle(k: number): [number, number] {
  const s = (n: number): number => {
    const m = ((n % 24) + 24) % 24;
    return m <= 6 ? SIN16[m]! : m <= 12 ? SIN16[12 - m]! : -s(m - 12);
  };
  return [s(k), -s(k + 6)];
}

/** A box direction's angle in 15° steps clockwise from up. */
const dirSteps = (d: Dir8): number => ((d - DIR8_OF.up + 8) % 8) * 3;
/** The 8-way box direction nearest an angle in 15° steps clockwise from up (never halfway: they're 15° apart). */
const nearestDir = (k: number): Dir8 => ((DIR8_OF.up + Math.round((((k % 24) + 24) % 24) / 3)) % 8) as Dir8;

/** Link `i`'s box direction on the whirl's tick `n`. */
function whirlDir(game: AdventureGame, i: number, n: number): Dir8 {
  if (n <= CROSS_SPIN_WINDUP) return spinDir(DIR8_OF[game.players[i]!.facing], n);
  return nearestDir((CROSS_SPIN_PLACES[i] ?? 0) + n - CROSS_SPIN_WINDUP);
}

/** Where Link `i` heads on the whirl's tick `n` (1/256 px). */
function whirlPoint(w: CrossSpin, game: AdventureGame, i: number, n: number): [number, number] {
  const k = n <= CROSS_SPIN_WINDUP ? dirSteps(whirlDir(game, i, n)) : (CROSS_SPIN_PLACES[i] ?? 0) + n - CROSS_SPIN_WINDUP;
  const [dx, dy] = onCircle(k);
  return [w.cx + dx, w.cy + dy];
}

const noteWhere = (game: AdventureGame): number[] => game.players.flatMap((p) => [p.x, p.y]);

/**
 * After the leader's step: his charge let go in the cross formation (his spin's first tick) starts the whirl. The
 * followers then take its first tick (stepCrossSpinFollower).
 */
export function startCrossSpin(game: AdventureGame): void {
  const a = game.adventure, l = game.players[0]!;
  if (a.crossSpin || a.formation !== "cross" || a.away || game.players.length < 2 || l.action !== "spin" || l.actionTick !== 1) return;
  a.crossSpin = { tick: 1, cx: l.x, cy: l.y + CROSS_SPIN_MIDDLE * SUBPX, at: noteWhere(game) };
}

/**
 * The leader's tick in the whirl (from its second tick): true when it took it (the caller ticks his fighter). Past its
 * 34th tick, or broken off (struck, the formation left), it's over and the leader's own step ends the spin.
 */
export function stepCrossSpin(game: AdventureGame, world: World): boolean {
  const a = game.adventure, w = a.crossSpin, l = game.players[0]!;
  if (!w) return false;
  if (w.tick >= CROSS_SPIN_TICKS || a.formation !== "cross" || l.action !== "spin" || game.battle.fighters[0]!.mode !== "active") {
    a.crossSpin = null;
    return false;
  }
  w.tick++;
  w.at = noteWhere(game);
  l.actionTick = w.tick;
  if (w.tick > CROSS_SPIN_WINDUP) {
    const [tx, ty] = whirlPoint(w, game, 0, w.tick);
    moveAxis(l, world, tx - l.x, "x");
    moveAxis(l, world, ty - l.y, "y");
  }
  return true;
}

/** A follower's tick in the whirl: toward his point on the circle (the caller mirrors the leader's spin tick). */
export function stepCrossSpinFollower(game: AdventureGame, i: number, world: World): void {
  const w = game.adventure.crossSpin!, p = game.players[i]!, x0 = p.x, y0 = p.y;
  const [tx, ty] = whirlPoint(w, game, i, w.tick);
  dashTo(p, world, tx, ty, CROSS_SPIN_DASH);
  p.moving = p.x !== x0 || p.y !== y0;
}

/** Link `i`'s sword attack this tick, the whirl's included (else attacks.ts swordAttack). */
export function linkAttack(game: AdventureGame, i: number, level = 1): SwordAttack | null {
  const w = game.adventure.crossSpin, p = game.players[i]!;
  if (!w || p.action !== "spin" || w.at.length < (i + 1) * 2) return swordAttack(p, level);
  const dir = whirlDir(game, i, w.tick), x = w.at[i * 2]!, y = w.at[i * 2 + 1]!;
  const box = ([l, t, r, b]: readonly number[]) => ({ left: x + l! * SUBPX, top: y + t! * SUBPX, right: x + r! * SUBPX, bottom: y + b! * SUBPX });
  const [inner, outer] = ATTACK_BOXES[dir];
  return { boxes: [box(inner), box(outer)], facing: blockFacing(dir), power: SPIN_POWER + (level >= 2 ? SWORD_LEVEL_POWER : 0) };
}
