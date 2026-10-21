// The river Zora (ZORA) and its fireball, and the fish of the side-view areas (PUKU), read from main.dol (not traced).
// Records and the common rules are enemies.ts's; velocities 1/256 px per tick.
import { onGround, vulnerable } from "../combat.ts";
import { sin4096, TRIG_ONE, velocityAlong } from "../entities.ts";
import { moveAxis, SUBPX, type Facing } from "../player.ts";
import type { World } from "../world.ts";
import { nextRandom, type AdventureGame } from "./adventure.ts";
import type { Enemy, EnemyState } from "./enemies.ts";

const random = (game: AdventureGame, n: number) => nextRandom(game.adventure) % n;
const fraction = (game: AdventureGame) => random(game, 256) / 256;
/** The game's facing numbers: 0 right, 1 left, 2 down, 3 up. */
const FACINGS: readonly Facing[] = ["right", "left", "down", "up"];
const STEP: Readonly<Record<Facing, readonly [number, number]>> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
const OPPOSITE: Readonly<Record<Facing, Facing>> = { right: "left", left: "right", down: "up", up: "down" };

/** The nearest Link in play within `range` px, or -1 (0x801D05F8). */
function nearestWithin(game: AdventureGame, x: number, y: number, range: number): number {
  let best = -1, bestD = range * range;
  game.players.forEach((p, i) => {
    const f = game.battle.fighters[i]!;
    if (!vulnerable(f) || !onGround(f)) return;
    const dx = (p.x - x) / SUBPX, dy = (p.y - y) / SUBPX, d = dx * dx + dy * dy;
    if (d <= bestD) [best, bestD] = [i, d];
  });
  return best;
}

// --- the river Zora (ZORA; init 0x801BB1AC, its state logic 0x801BA8F8 run by the walkers' update 0x801CDD58, its
// state changes 0x801BACE8, draw 0x801BA670; LTZR, the lotus Zora, shares the code) ---
// It lives on deep water (tile type 0x0D: its tile test 0x801BA88C; every placed one sits on it) and never swims: it
// waits under water, comes up, looks about, spits a fireball at the nearest Link and dives again, over and over:
// - "hide" (state 0): unseen, can't be hurt nor hurts. After 60 + rand(121) ticks, once a Link on its screen is within
//   300 px, it rises.
// - "rise" (1): under water it moves to a deep-water tile picked at random among those 16 px apart within ± its params
//   (0-15) tiles of where it was placed (0: it stays); its ripples show (the JPA effect 1365, not drawn here), its
//   scale grows from 0 to 1.5 by 0.05 a tick; then, a new wait of 60 + rand(121) ticks over, at the end of a 24-tick
//   ripple loop, it surfaces.
// - "fly" (2, surfacing): a splash, frames 10, 9, 8, 0 for 3, 3, 3, 6 ticks; then it looks.
// - "rest" (3, looking): frames 0-3, 6 ticks each, for 40 + rand(41) ticks rounded up to the end of a loop; then it
//   spits. Up (looking and spitting) its box is ±12, it can be hurt and touching it hurts by its atcp (hit type 1).
// - "spit" (4): frames 4-7, 6 ticks each, once; on its 21st tick a fireball (ZOSH) at the nearest Link within 300 px,
//   1.5 px/tick straight at him (none in range: no shot).
// - "dive" (5): frames 0, 8, 9, 10, 11 for 6, 3, 3, 3, 3 ticks; then hidden.
// Drawn from "fly" to "dive", gc 213 + frame, 1.5× (its scale). Life 4 and atcp 2 (csv), drops by dasu 1. A hit while it
// lives doesn't knock it back: it freezes 24 ticks (the walkers' update skips it while +0xD8 counts).
// Its fireball (ZOSH; init 0x801D2FEC, update 0x801D2E70): box ±2, no wall box (it flies over everything), gone once
// off the screen, on hurting a Link (2, hit type 1) or when a shield stops it; nothing hurts it; gc 229-232, 3 ticks
// each. Here an OKTM of kind 3.
export const ZORA = {
  half: 12,
  waitMin: 60,
  waitSpread: 121,
  sight: 300,
  /** Its scale ×256 once up (1.5), grown 0.05 a tick while rising. */
  scale: 384,
  growStep: 13,
  lookMin: 40,
  lookSpread: 41,
  tile: 16,
  deepType: 0x0d,
  maxRange: 15,
  shotSpeed: 384, // 1.5 px/tick
  freezeTicks: 24,
};
/** Its animations (table 0x804A3D68): [frame, ticks]; the ripple's and the look's loop, the others play once. */
export const ZORA_ANIMS: readonly (readonly (readonly [number, number])[])[] = [
  [[12, 6], [13, 6], [14, 6], [15, 6]],
  [[10, 3], [9, 3], [8, 3], [0, 6]],
  [[0, 6], [1, 6], [2, 6], [3, 6]],
  [[4, 6], [5, 6], [6, 6], [7, 6]],
  [[0, 6], [8, 3], [9, 3], [10, 3], [11, 3]],
];
const ANIM_OF: Partial<Record<EnemyState, number>> = { rise: 0, fly: 1, rest: 2, spit: 3, dive: 4 };
const LOOPED = new Set([0, 2]);
const animTotal = (a: number) => ZORA_ANIMS[a]!.reduce((n, [, t]) => n + t, 0);
/** A once-played animation ends one tick short of its total (0x801D22DC). */
const animEnd = (a: number) => animTotal(a) - (LOOPED.has(a) ? 0 : 1);
const SPIT_AT = animEnd(3) - 2;
/** OKTM's kind for a Zora's fireball (1 an arrow, 2 a bone). */
export const FIREBALL_KIND = 3;
export const ZORA_SHOT = { half: 2, damage: 2, frames: [16, 17, 18, 19] as readonly number[], stepTicks: 3 };

/** Its fields: `kind` its range (tiles), `timer` its wait, `speed` its scale ×256, `shot2` its animation, `shot` its
 *  clock, `frame` the frame shown (gc 213 + frame), `grace` a hit's freeze. */
export function initZora(game: AdventureGame, e: Enemy, params: number): void {
  e.kind = Math.min(ZORA.maxRange, params & 0xff);
  e.facing = "down";
  e.state = "hide";
  e.speed = e.shot = e.shot2 = 0;
  e.timer = ZORA.waitMin + random(game, ZORA.waitSpread);
}

/** Up (looking or spitting) and not frozen: it can be hurt and it hurts. */
export const zoraUp = (e: Enemy) => (e.state === "rest" || e.state === "spit") && e.grace === 0;

function setZora(game: AdventureGame, e: Enemy, state: EnemyState, typeAt: (x: number, y: number) => number): void {
  e.state = state;
  e.tick = 0;
  e.timer = e.shot = 0;
  e.shot2 = ANIM_OF[state] ?? 0;
  if (state === "hide" || state === "rise") {
    e.timer = ZORA.waitMin + random(game, ZORA.waitSpread);
    e.speed = 0;
  }
  if (state === "rise" && e.kind > 0) {
    // Under water: to a random deep-water tile within its range of its placement (scan 0x801BADCC).
    const spots: [number, number][] = [];
    for (let dx = -e.kind; dx <= e.kind; dx++)
      for (let dy = -e.kind; dy <= e.kind; dy++) if (typeAt(Math.floor(e.homeX / SUBPX) + dx * ZORA.tile, Math.floor(e.homeY / SUBPX) + dy * ZORA.tile) === ZORA.deepType) spots.push([dx, dy]);
    const spot = spots.length ? spots[random(game, spots.length)]! : null;
    if (spot) [e.x, e.y] = [e.homeX + spot[0] * ZORA.tile * SUBPX, e.homeY + spot[1] * ZORA.tile * SUBPX];
  }
  if (state === "rest") e.timer = ZORA.lookMin + random(game, ZORA.lookSpread);
}

/** One tick of a Zora: `spit(vx, vy)` makes its fireball at it; `typeAt` the area's tile type at a px. */
export function stepZora(game: AdventureGame, e: Enemy, typeAt: (x: number, y: number) => number, spit: (vx: number, vy: number) => void): void {
  if (e.grace > 0) {
    // Frozen by a hit: its clocks wait too.
    e.grace--;
    e.tick--;
    return;
  }
  const a = e.shot2, end = animEnd(a);
  const loopEnds = LOOPED.has(a) && e.shot === end - 1;
  const done = !LOOPED.has(a) && e.shot >= end;
  switch (e.state) {
    case "hide":
      if (e.tick >= e.timer && nearestWithin(game, e.x, e.y, ZORA.sight) >= 0) setZora(game, e, "rise", typeAt);
      break;
    case "rise":
      if (e.speed !== ZORA.scale) e.speed = Math.min(ZORA.scale, e.speed + ZORA.growStep);
      else if (e.tick >= e.timer && loopEnds) setZora(game, e, "fly", typeAt);
      break;
    case "fly":
      if (e.tick > 1 && done) setZora(game, e, "rest", typeAt);
      break;
    case "rest":
      if (e.tick >= e.timer && loopEnds) setZora(game, e, "spit", typeAt);
      break;
    case "spit":
      if (e.tick > 1 && e.shot === SPIT_AT) {
        const p = game.players[nearestWithin(game, e.x, e.y, ZORA.sight)];
        if (p) {
          const [vx, vy] = velocityAlong(p.x - e.x, p.y - e.y, ZORA.shotSpeed);
          spit(vx, vx || vy ? vy : ZORA.shotSpeed);
        }
      }
      if (e.tick > 1 && done) setZora(game, e, "dive", typeAt);
      break;
    case "dive":
      if (e.tick > 1 && done) setZora(game, e, "hide", typeAt);
      break;
  }
  // Its animation steps after its logic.
  const b = e.shot2;
  e.shot = LOOPED.has(b) ? (e.shot + 1) % animTotal(b) : Math.min(e.shot + 1, animEnd(b));
  let t = e.shot;
  for (const [frame, ticks] of ZORA_ANIMS[b]!) {
    e.frame = frame;
    if (t < ticks) break;
    t -= ticks;
  }
}

/** A hit on a Zora that's up: life off, frozen 24 ticks while it lives (true: it took it so; no knockback). */
export function hurtZora(e: Enemy, damage: number): boolean {
  e.life = Math.max(0, e.life - damage);
  e.invincible = ZORA.freezeTicks;
  if (e.life <= 0) return false;
  e.grace = ZORA.freezeTicks;
  return true;
}

/** A fireball's tick: on over everything, gone off the area (TODO(measure): the camera's rect, +0xCC). */
export function stepFireball(e: Enemy, world: World): void {
  e.x += e.vx;
  e.y += e.vy;
  const x = Math.floor(e.x / SUBPX), y = Math.floor(e.y / SUBPX);
  if (x < 0 || y < 0 || x >= world.widthCells * 8 || y >= world.heightCells * 8) e.life = -1;
}

// --- the fish (PUKU; init 0x8017BBFC, update 0x8017B3B4, draw 0x8017B1A0, its tile test 0x8017BBA8) ---
// Every one placed swims in the water (tile type 0x3B) of a GBA-screen side-view area (Lake Hylia rooms 3 and 6, the
// Coast, Tingle's Towers…). It can be on types 0x00, 0x02, 0x03 and 0x3B; anything else is a wall to it. It never jumps
// and nothing hurts it (its update has no hurt check: TODO(measure)); touching it hurts by its atcp (2; the big one 4),
// hit type 1. Params: bit 0 a big one (drawn 2×, box ±16, its wall box ±16 × ±10, faster); (p >> 4) & 0xFF non-zero: a
// patroller, its facing ((p >> 4) & 15) − 1, over 8 × ((p >> 8) & 0xFF) px of its home (0: 16); else a cruiser facing
// left or right at random. Its velocity eases 0.1 of the way to its target, by at most 0.1 px/tick a tick.
// - cruising ("walk"): 0.4 px/tick (big 0.9) ahead, bobbing (0.3 × sin of a phase stepped 300 a tick); at most every 20
//   ticks (at once on a wall) it turns to face its home when a wall stops it, it's 16 px past the screen's edge, or it's
//   more than 96 + rand(16) px across from home (the turn stops it dead); its 160-tick charge cool-down over, the nearest
//   Link in the quadrant ahead within 96 px (big 128) and 32 px up or down makes it charge;
// - charging ("chase"): from a standstill to 0.9 px/tick (big 1.7), bobbing 0.2 × sin; it ends on a wall or 16 px past
//   the screen's edge (the big one: having bitten a Link, or 24 px inside the edge), or after 350 ticks: it turns about,
//   stopped dead, and cruises on;
// - patrolling ("rest"): 0.4 px/tick along its facing; after 10 ticks a wall, or being farther than its range from home,
//   turns it about, stopped dead.
// Look: both2 323 + 2 × (facing & 1) + a fin toggle every 8 ticks (4 charging); the big one 2×.
export const PUKU = {
  half: 8,
  bigHalf: 16,
  bigWallX: 16,
  bigWallY: 10,
  cruise: 102, // 0.4 px/tick
  bigCruise: 230, // 0.9
  charge: 230, // 0.9
  bigCharge: 435, // 1.7
  patrol: 102,
  ease: 1, // / 10
  maxEase: 26, // 0.1 px/tick
  bob: 77, // 0.3 px/tick
  chargeBob: 51, // 0.2
  bobStep: 300,
  turnTicks: 20,
  homeAcross: 96,
  homeSpread: 16,
  edge: 16,
  bigChargeEdge: -24,
  sight: 96,
  bigSight: 128,
  level: 32,
  chargeTicks: 350,
  chargeCool: 160,
  patrolGrace: 10,
  defaultRange: 16,
  stepTicks: 8,
  chargeStepTicks: 4,
  bigAtcp: 4,
  water: [0x00, 0x02, 0x03, 0x3b] as readonly number[],
};

/** Its fields: `kind` 1 a big one, `shot2` the game's state (0-5), `turn` its patrol range (px), `angle` its bob's
 *  phase, `timer` the turn or charge countdown, `grace` the charge's cool-down, `frame` its fins, `vz` 1 when it bit a
 *  Link last tick (enemies.ts contact). */
export function initPuku(game: AdventureGame, e: Enemy, params: number): void {
  e.kind = params & 1;
  e.turn = 8 * ((params >>> 8) & 0xff);
  e.facing = FACINGS[Math.trunc(fraction(game) * 1.99)]!;
  if (e.kind === 1) e.atcp = PUKU.bigAtcp;
  e.shot2 = 0;
  e.state = "walk";
  if ((params >>> 4) & 0xff) {
    if (!e.turn) e.turn = PUKU.defaultRange;
    e.facing = FACINGS[(((params >>> 4) & 15) - 1) & 3]!;
    e.shot2 = 4;
    e.state = "rest";
  }
}

export const pukuHalf = (e: Enemy) => (e.kind === 1 ? PUKU.bigHalf : PUKU.half);

/** `v` eased `ease`/10 of the way to `target`, by at most `max`; at least 1/256 px. */
function easeTo(v: number, target: number, ease: number, max: number): number {
  const d = target - v, step = Math.trunc((d * ease) / 10) || Math.sign(d);
  return v + Math.max(-max, Math.min(max, step));
}

/** Moves on each axis against what it can't be on; [stopped across, stopped up or down]. */
function swim(e: Enemy, world: World, typeAt: (x: number, y: number) => number): [boolean, boolean] {
  const [hx, hy] = e.kind === 1 ? [PUKU.bigWallX, PUKU.bigWallY] : [PUKU.half, PUKU.half];
  const free = (x: number, y: number) => {
    for (const cx of [x - hx, x + hx]) for (const cy of [y - hy, y + hy]) if (!PUKU.water.includes(typeAt(Math.floor(cx), Math.floor(cy)))) return false;
    return true;
  };
  const stopped = (v: number, axis: "x" | "y"): boolean => {
    if (!v) return false;
    const x = (e.x + (axis === "x" ? v : 0)) / SUBPX, y = (e.y + (axis === "y" ? v : 0)) / SUBPX;
    if (!free(x, y)) return true;
    const from = e[axis];
    moveAxis(e, world, v, axis);
    return e[axis] - from !== v;
  };
  return [stopped(e.vx, "x"), stopped(e.vy, "y")];
}

/** The game's quadrant of (dx, dy) (0x801F681C). */
const quadrant = (dx: number, dy: number): Facing => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy >= 0 ? "down" : "up");

function stopDead(e: Enemy): void {
  e.vx = e.vy = e.tvx = e.tvy = 0;
}

/** One tick of a fish. `view` = the screen's rect, area px (TODO(measure): the GBA camera's view; here the area). */
export function stepPuku(game: AdventureGame, e: Enemy, world: World, typeAt: (x: number, y: number) => number, view: { left: number; top: number; right: number; bottom: number }): void {
  const big = e.kind === 1, bit = e.vz === 1;
  e.vz = 0;
  e.vx = easeTo(e.vx, e.tvx, PUKU.ease, PUKU.maxEase);
  e.vy = easeTo(e.vy, e.tvy, PUKU.ease, PUKU.maxEase);
  const [stopX, stopY] = swim(e, world, typeAt);
  let blocked = big ? stopX : stopX || stopY;
  const x = e.x / SUBPX, y = e.y / SUBPX;
  const off = (margin: number) => x <= view.left - margin || x >= view.right + margin || y <= view.top - margin || y >= view.bottom + margin;
  const sign = e.facing === "left" ? -1 : 1;
  switch (e.shot2) {
    case 0:
      e.tvx = sign * (big ? PUKU.bigCruise : PUKU.cruise);
      e.tvy = 0;
      e.shot2 = 1;
    // falls through
    case 1: {
      e.state = "walk";
      e.tvy = Math.trunc((PUKU.bob * sin4096(e.angle)) / TRIG_ONE);
      const far = Math.abs(e.homeX - e.x) / SUBPX > PUKU.homeAcross + PUKU.homeSpread * fraction(game);
      e.angle = (e.angle + PUKU.bobStep) & 0xffff;
      if ((e.timer === 0 || blocked) && (blocked || off(PUKU.edge) || far)) {
        const home: Facing = e.homeX < e.x ? "left" : "right";
        if (home !== e.facing) stopDead(e);
        e.facing = home;
        e.timer = PUKU.turnTicks;
        e.shot2 = 0;
      }
      if (e.grace > 0) break;
      let i = -1, d = Infinity;
      game.players.forEach((p, k) => {
        const f = game.battle.fighters[k]!, dd = Math.hypot(p.x - e.x, p.y - e.y) / SUBPX;
        if (vulnerable(f) && onGround(f) && dd < d) [i, d] = [k, dd];
      });
      const p = game.players[i];
      if (p && quadrant(p.x - e.x, p.y - e.y) === e.facing && d < (big ? PUKU.bigSight : PUKU.sight) && Math.abs(p.y - e.y) / SUBPX < PUKU.level) e.shot2 = 2;
      break;
    }
    case 2:
      stopDead(e);
      e.tvx = sign * (big ? PUKU.bigCharge : PUKU.charge);
      e.grace = 0;
      e.timer = PUKU.chargeTicks;
      e.shot2 = 3;
    // falls through
    case 3:
      e.state = "chase";
      e.tvy = Math.trunc((PUKU.chargeBob * sin4096(e.angle)) / TRIG_ONE);
      e.angle = (e.angle + PUKU.bobStep) & 0xffff;
      if (big) blocked = bit;
      if (blocked || off(big ? PUKU.bigChargeEdge : PUKU.edge) || e.timer === 0) {
        e.facing = OPPOSITE[e.facing];
        stopDead(e);
        e.grace = PUKU.chargeCool;
        e.timer = PUKU.turnTicks;
        e.shot2 = 0;
      }
      break;
    case 4: {
      e.state = "rest";
      const [dx, dy] = STEP[e.facing];
      [e.tvx, e.tvy] = [dx * PUKU.patrol, dy * PUKU.patrol];
      e.timer = PUKU.patrolGrace;
      e.shot2 = 5;
      break;
    }
    case 5:
      if (e.timer === 0 && (blocked || Math.hypot(e.homeX - e.x, e.homeY - e.y) / SUBPX > e.turn)) {
        e.facing = OPPOSITE[e.facing];
        stopDead(e);
        e.shot2 = 4;
      }
      break;
  }
  if (e.frameTimer === 0) {
    e.frameTimer = e.shot2 === 3 ? PUKU.chargeStepTicks : PUKU.stepTicks;
    e.frame ^= 1;
  }
  if (e.frameTimer > 0) e.frameTimer--;
  if (e.timer > 0) e.timer--;
  if (e.grace > 0) e.grace--;
}
