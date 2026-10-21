// The Wizzrobe (WIZR; init 0x801788B4, update 0x80176B88, draw 0x801769D8) and the Stalfos it raises (STAL kind 5),
// read from main.dol (not traced: no savestate reaches a stage that has one). Placed in boss023, 053, 070, 071, 072 and
// 081 (kinds 0, 1, 3, 4, 5), made by GEN3 kinds 31 and 37 (kinds 5 and 4). Records and the common rules (hits,
// knockback, death, drops) are enemies.ts's; this file is its own behaviour, stepped by stepEnemies. Velocities are
// 1/256 px per tick, z up. The game's angles run from down (0) to right (0x4000); the sim's from right (0), clockwise.
//
// One actor type plays every part, by params & 0xFF:
// - kinds 0-9 (and 12-19) are Wizzrobes: 0 casts a bolt (WIZR kind 10), 4 a fire bolt (kind 11) that leaves flames,
//   5 throws an ice ball (BOIB), 1 summons four Stalfos (an orb, kind 20), 2 twenty POPOs (an orb, kind 21), 3 drains
//   the Links' Force Gems (a beam, kind 30); 6-9 cast nothing. Life 12, atcp 2, drop class 4 (csv); box ±8.
// - kinds 10, 11 its bolts, 20, 21 its orbs, 22, 23 (and 31) the orbs' sparks, 30 its beam: life 10000, not counted as
//   enemies (+0x1A8 0), never hurt; only the bolts hurt by contact. They draw JPA effects, no sprite.
// (params >> 22) & 31: a switch turned on when it dies (none placed); the top 5 bits: the switch it waits for.
//
// A Wizzrobe's cycle (+0x230 state; here "hide", "spit", "stop", "rest"):
// - gone (0, 1: "hide", not drawn, can't be hurt nor hurts) base + rand(base) ticks: 30 for kind 0, 50 for kinds 4-5,
//   100 for the others. When 30 remain it moves near the Link with the most Force Gems (0x801EEC98 mode 1; ties: the
//   first; the gems are shared here, so the first Link in play): his position + 64 + rand(64) px along one of the four
//   ways (+0x250, rand(4) at first), its ±2 px box swept there in a straight line from where it last stood (0x801F2618
//   from +0x18) without meeting a wall; else the way turns 1-3 quarters at random and it tries again, 4 tries, then
//   once more every tick. It faces him; JPA 1290 and 1291 mark the spot (sound 0x40077) during the last 30 ticks.
// - appears (6, 7: "spit") opaque at once (alpha +0x2D0 = 255), its hat alone (frame 20) for 10 ticks, then its pose;
//   from the next tick it can be hurt and hurts by contact (its atcp, hit type 1) while it stands. Its cast's steps
//   (+0x24C) last 40, 2, 1, 20, 20 ticks (0x804A0DA0 after the first 40; a sixth, 10, never runs): at the third (43
//   ticks in) it casts, frames [f][0..4] (0x804A0D50) as the steps go once the hat's 10 ticks are over:
//   - kinds 0, 4: a bolt (WIZR kind 10 / 11) from its position, 8 px up, 2.5 px/tick along its facing; kind 5 an ice
//     ball (BOIB) the same way; then still 60 ticks ("stop", its casting frame [f][3]) and gone;
//   - kinds 1, 2: (only when none of its summons lives, else a kind 10 bolt as kind 0) an orb (kind 20 at 20 px up /
//     21 at 24 px) over itself; its step lasts 10 ticks more (30), then sound 0x40079 and 20 ticks, still 60, gone;
//   - kind 3: a beam (kind 30) and its step is held while the nearest Link has gems, until he's been within 48 px for
//     31 ticks running, or has had none for 121 ticks, or nobody's there; then 20 ticks, the beam goes, still 60.
//   Kinds 1-3 face their Link every tick of the first four steps (kinds 1, 2: not while a summon lives; kind 3 the
//   nearest), and kind 3 flees from the nearest within 64 px at 1.2 px/tick (velocity easing 0.3, at most 1 px/tick a
//   tick, walls stopping it) and its gem budget (+0x2C4, 200) drops 1 every 8 ticks then.
// - vanishes (9-11: "rest") not solid any more, fading (alpha eased half the way to 0, at most 10 a tick: 255 - 10 n),
//   frames [f][0] 10 ticks, [f][1] 1, [f][2] 1, the hat 2, the hat spinning 16, 17, 18 3 ticks each (19 is set as it
//   goes and never shows: 23 ticks drawn), then gone again.
// A hit (any accepted attack: the sword, arrows, bombs, thrown things; not its own WIZR, FIRE, BLZE, DDGO, FLME, THCL)
// cancels its orb or beam (their life 0), and once its knockback is over it vanishes at once. Dying: kind 1's raised
// Stalfos collapse for good (their +0x94 = 1), kind 3 throws out its gem budget as Force Gems (biggest first, 300 down
// to 1; each 2 - rand(4) px/tick on x and y, 10 + rand(5) up: RUPY params 0x22 << 16 | type, TODO(measure) their
// flight), and its switch (if any) comes on; its drop class 4 as every enemy.
// Its look (0x801769D8): enemy_gc_sob 233 + frame (0-15: right, left, down, up × still, two steps, casting; 16-19 its
// hat spinning, 20 the hat alone; about 17 × 27 px), not drawn gone (states 0, 1); its alpha is the sprite colour's
// alpha byte. Fleeing (kind 3, +0x234) its draw record asks for an afterimage trail (style 17: a copy every 4 ticks
// living 20, colour × (1, 1, 1, 0.75) + (127, 127, 127); tables 0x80471180, 0x804710F0, 0x80471060, 0x804710A8;
// TODO(measure) the copies' fade). It also adds its position to the TV camera's points (0x8030C210; kinds 0, 1, 3-5).
//
// Its spells:
// - bolts (kinds 10, 11; state 12, "fly"): box ±6 (walls ±2), fly at their velocity, hurt a Link touching them (atcp 2,
//   hit type 1; they go on through him, TODO(measure)); gone after 200 ticks, on a wall, or (from their 11th tick)
//   outside the room. Kind 11 leaves a flame (BLZE params 0xE0C0, 8 px lower when flying sideways) 10 ticks after it
//   starts, then every 5, and bursts (JPA 413) at its end. Effects: kind 10 JPA 1292, kind 11 411 twice.
// - BOIB (kind 5's): box ±4, 2.5 px/tick through walls, gone outside the room or on a Link it touches: hit type 24
//   (no damage; the Link's state 81, TODO(measure): frozen?). JPA 598, 599.
// - orbs (kinds 20, 21; states 13, 14): hover their caster's step (30 ticks) where it cast them, then home on the Link
//   with the most gems (its index kept) at 2 px/tick (velocity easing 0.3, at most 1 px/tick a tick, over walls); within
//   4 px of him they burst into sparks: kind 20 four kind-22 sparks a quarter turn apart, kind 21 twenty kind-23 sparks
//   (0x10000 / 20 apart). The Link gone, or the caster hit: they fizzle (JPA 1289). JPA 1286-1288 (×1.2 for kind 20).
// - sparks (kinds 22, 23, 31; state 15): spiral out of the burst point, the radius growing 2 px/tick and the angle
//   0x500 a tick, at the orb's height; their 30th tick (58 px out) they make a STAL params 5 (kind 22), a POPO params 1
//   (kind 23; kind 31 'STOH', which the spawn switch doesn't know) there, falling from that height, if the spot is clear
//   of walls and in the room, else 24 px right, up or left of it in turn, and add it to their Wizzrobe's 20 slots
//   (+0x270, count +0x264: its summons). Then they go (JPA 1289).
// - the beam (kind 30; state 16): sits 24 px above its Wizzrobe; 40 ticks after it starts, then every 2, it takes one
//   Force Gem from the nearest Link on the screen (one 1-gem RUPY, params 0x1B << 16, flies from him to the beam and is
//   lost), sound 0x4007D every 64. Gone when its Wizzrobe kills it (on a hit, or its cast's end). JPA 1293, 1294.
//
// The Stalfos it raises (STAL params 5; init 0x80176538, update 0x801757D4; none are placed): 4 hit points (+0x25C,
// +0x260) and life 1000 while it falls in (1 px/tick² down, at most 10 px/tick; no AI, no hits, no contact), then life
// 10000 (back to 10000 every tick: it never dies by damage). It walks as kind 0; each hit takes the damage off its hit
// points (the knockback as usual; sounds 0x4009D, 0x4009E): out of them it collapses (state 5): its skull (both2 344 +
// 28 + facing; down at first) lies 660 ticks (no hits; contact per the code, TODO(measure)), shaking ±2 px every 2 ticks
// its last 100, then hops (4 px/tick up, 1 px/tick² down, 1.3 px/tick a random way, facing it) until 750 ticks are
// over and it lands: up again (JPA 860), walking, its 4 hit points back. When no WIZR is left on its screen (checked
// each time it picks a walk) or its Wizzrobe dies, it collapses for good (state 7): its skull 130 ticks (shaking from
// the start to 30 before the end), then dies as an enemy does (vtable +0x24: the common 0x801F4F28, its drop; TODO(measure)
// whether it counts as a kill).
import { onGround, vulnerable } from "../combat.ts";
import { cos4096, sin4096, TRIG_ONE } from "../entities.ts";
import { angleTo } from "../hazards.ts";
import { moveAxis, SUBPX, type Facing } from "../player.ts";
import { isSolidAt, ROOM_H, ROOM_W, type World } from "../world.ts";
import { nextRandom, type AdventureGame } from "./adventure.ts";
import type { Enemy, EnemyState } from "./enemies.ts";

const random = (game: AdventureGame, n: number) => nextRandom(game.adventure) % n;
/** A random fraction in [0, 1) in 1/256 steps (the game's [1, 2) float − 1). */
const fraction = (game: AdventureGame) => random(game, 256) / 256;
const STEP: Readonly<Record<Facing, readonly [number, number]>> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
/** The game's facing numbers: 0 right, 1 left, 2 down, 3 up. */
const FACINGS: readonly Facing[] = ["right", "left", "down", "up"];
const facingTo = (dx: number, dy: number): Facing => (Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "down" : "up");
/** A unit vector (× `speed`) along a sim angle. */
const along = (angle: number, speed: number): [number, number] => [Math.trunc((speed * cos4096(angle)) / TRIG_ONE), Math.trunc((speed * sin4096(angle)) / TRIG_ONE)];
/** A unit vector (× `speed`) along a game angle (0 down, 0x4000 right): (sin, cos). */
const alongGame = (angle: number, speed: number): [number, number] => [Math.trunc((speed * sin4096(angle)) / TRIG_ONE), Math.trunc((speed * cos4096(angle)) / TRIG_ONE)];

function setState(e: Enemy, state: EnemyState): void {
  e.state = state;
  e.tick = 0;
}

/** `v` eased `ease`/10 of the way to `target`, by at most `max` (0x801F71A4); at least 1/256 px, so it gets there. */
function easeTo(v: number, target: number, ease: number, max: number): number {
  const d = target - v, step = Math.trunc((d * ease) / 10) || Math.sign(d);
  return v + Math.max(-max, Math.min(max, step));
}

/** The Links a Wizzrobe can pick (0x801EEC98's checks: in play, on the ground; the same screen is the area here). */
const eligible = (game: AdventureGame, i: number) => {
  const f = game.battle.fighters[i]!;
  return vulnerable(f) && onGround(f);
};

/** The nearest Link (0x801EEC98 mode 0), or -1. */
function nearest(game: AdventureGame, x: number, y: number): number {
  let best = -1, bestD = Infinity;
  game.players.forEach((p, i) => {
    if (!eligible(game, i)) return;
    const d = Math.hypot((p.x - x) / SUBPX, (p.y - y) / SUBPX);
    if (d < bestD) [best, bestD] = [i, d];
  });
  return best;
}

/** The Link with the most Force Gems (0x801EEC98 mode 1: the first with more than the best so far). The adventure keeps
 *  one count for the four, so: the first Link in play. TODO(measure): a multiplayer game's per-Link gems (+0xC04). */
function richest(game: AdventureGame): number {
  return game.players.findIndex((_, i) => eligible(game, i));
}

const dist = (game: AdventureGame, i: number, x: number, y: number) => Math.hypot((game.players[i]!.x - x) / SUBPX, (game.players[i]!.y - y) / SUBPX);

/** A ±`half` px box swept in a straight line from (x0, y0) to (x1, y1), 1/256 px, meets no wall (0x801F2618, 0x801F23BC:
 *  steps of at most half the box's side). */
function sweepClear(world: World, x0: number, y0: number, x1: number, y1: number, half: number): boolean {
  const ax = x0 / SUBPX, ay = y0 / SUBPX, bx = x1 / SUBPX, by = y1 / SUBPX;
  const step = Math.max(1, Math.min(half, 4)), n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
  for (let k = 1; k <= n; k++) {
    const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n;
    for (const [cx, cy] of [[-half, -half], [half, -half], [-half, half], [half, half]] as const)
      if (isSolidAt(world, Math.floor(x + cx), Math.floor(y + cy))) return false;
  }
  return true;
}

/** Inside the room (0x801F6758 with no margin: the stage's current screen rectangle). */
const inRoom = (x: number, y: number) => x >= 0 && y >= 0 && x < ROOM_W * SUBPX && y < ROOM_H * SUBPX;

export const WIZZROBE = {
  half: 8,
  /** Its box while it looks for a spot. */
  searchHalf: 2,
  boltHalf: 6,
  boltWallHalf: 2,
  /** Gone: base + rand(base) ticks (0x80177060): kind 0 30, kinds 4-5 50, the others 100. */
  hideKind0: 30,
  hideKind45: 50,
  hideOthers: 100,
  /** The teleport when this many remain. */
  moveAt: 30,
  spotMin: 64,
  spotSpread: 64,
  spotTries: 4,
  /** The hat alone after it appears, and the stand before its cast's first step. */
  hatTicks: 10,
  standTicks: 40,
  /** Its cast's steps after the stand (0x804A0DA0). */
  stepTicks: [2, 1, 20, 20, 10] as readonly number[],
  summonExtra: 10,
  afterTicks: 60,
  /** Alpha: opaque at once when it appears; fading half the way, at most 10 a tick. */
  fadeEase: 5,
  fadeMax: 10,
  /** Kind 3: flees within 64 px at 1.2 px/tick (easing 0.3, at most 1 px/tick a tick); its budget. */
  flee: 64,
  fleeSpeed: 307, // 1.2 px/tick
  ease: 3,
  maxEase: SUBPX,
  budget: 200,
  budgetTicks: 8,
  /** Kind 3's beam ends: the Link within 48 px for more than 30 ticks, or out of gems for more than 120. */
  beamNear: 48,
  beamNearTicks: 30,
  beamPoorTicks: 120,
  /** Bolts and ice balls. */
  boltSpeed: 640, // 2.5 px/tick
  boltZ: 8 * SUBPX,
  boltTicks: 200,
  boltEdgeAfter: 10,
  flameFirst: 10,
  flameTicks: 5,
  flameDrop: 8 * SUBPX,
  /** Orbs. */
  orbZ: [20 * SUBPX, 24 * SUBPX] as readonly number[],
  orbSpeed: 2 * SUBPX,
  orbReach: 4,
  orbSparks: [4, 20] as readonly number[],
  /** Sparks. */
  sparkGrow: 2 * SUBPX,
  sparkTurn: 0x500,
  sparkTicks: 30,
  sparkRetry: 24 * SUBPX,
  /** The beam. */
  beamAbove: 24 * SUBPX,
  beamFirst: 40,
  beamTicks: 2,
};
/** The kinds that are its spells. */
export const WIZZROBE_BOLTS = [10, 11];
export const WIZZROBE_ORBS = [20, 21];
export const WIZZROBE_SPARKS = [22, 23, 31];
export const WIZZROBE_BEAM = 30;
/** A Wizzrobe proper (not one of its spells). */
export const isCaster = (e: Enemy) => e.type === "WIZR" && (e.kind < 10 || (e.kind > 11 && e.kind < 20));

/** Its frames, gc 233 + …: [facing][step] while it casts (0x804A0D50), as it vanishes (0x804A0E4C) and their ticks
 *  (0x804A0E8C); the hat alone 20, spinning 16-19 (0x804A0E9C). */
export const WIZZROBE_CAST: readonly (readonly number[])[] = [[0, 1, 2, 3, 2], [4, 5, 6, 7, 6], [8, 9, 10, 11, 10], [12, 13, 14, 15, 14]];
export const WIZZROBE_VANISH: readonly (readonly number[])[] = [[0, 1, 2, 20], [4, 5, 6, 20], [8, 9, 10, 20], [12, 13, 14, 20]];
export const WIZZROBE_VANISH_TICKS: readonly number[] = [10, 1, 1, 2];
export const WIZZROBE_HAT = 20;
export const WIZZROBE_SPIN = 16;
export const WIZZROBE_SPIN_TICKS = 3;
/** Force Gem worths, types 0-7 (0x804A0EBC): kind 3's budget goes out biggest first. */
export const WIZZROBE_GEMS: readonly number[] = [1, 5, 20, 50, 100, 150, 200, 300];
/** The teleport's four ways (+0x250, the game's angle / 0x4000): down, right, up, left. */
const QUARTERS: readonly (readonly [number, number])[] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/** What a Wizzrobe makes and changes outside its record. */
export interface WizzrobeHooks {
  /** A new enemy (WIZR spells, BOIB, STAL, POPO) or a BLZE flame at (x, y), 1/256 px, z 1/256 px up; null if none. */
  spawn(type: "WIZR" | "BOIB" | "STAL" | "POPO" | "BLZE", params: number, x: number, y: number, z: number): Enemy | null;
  /** One Force Gem of `type` thrown out of (x, y), 1/256 px (kind 3's budget). */
  dropGem(x: number, y: number, type: number): void;
  /** Turns switch `n` on. */
  setSwitch(n: number): void;
}

// Field use. A Wizzrobe: timer = its gone countdown (-1: just gone, draw one), then the hat's 10 ticks; grace = its
// step's ticks (+0x238); shot = the stand after its cast (+0x244); shot2 = the step (+0x24C); frame = gc 233 + frame;
// speed = alpha (0-255); angle = the teleport's way (0-3); leader = its orb's or beam's id; kind 3: turn = its gem
// budget, frameTimer = the budget's clock, tvx/tvy = its flight, homeX/homeY = the beam's end counters (near, poor).
// Bolts: timer = ticks before the room's edge counts, grace = the flame clock, shot = ticks left. Orbs: grace = the
// hover, shot2 = their Link, tvx/tvy = the homing velocity. Sparks: homeX/homeY = the burst point, speed = the radius
// (1/256 px), angle = a game angle, grace = ticks left. The beam: timer = the drain clock, shot = gems taken & 63. A
// spell's leader is its Wizzrobe; a raised Stalfos's too.

/** A spell's life: never hurt; its Wizzrobe sets it to 0 to end it. */
export const WIZZROBE_SPELL_LIFE = 10000;

export function initWizzrobe(game: AdventureGame, e: Enemy, params: number): void {
  e.kind = params & 0xff;
  e.turn = WIZZROBE.budget;
  e.leader = 0;
  if (!isCaster(e)) e.life = WIZZROBE_SPELL_LIFE;
  if (WIZZROBE_BOLTS.includes(e.kind)) {
    e.z = WIZZROBE.boltZ;
    e.timer = WIZZROBE.boltEdgeAfter;
    e.grace = WIZZROBE.flameFirst;
    e.shot = WIZZROBE.boltTicks;
    e.state = "fly";
  } else if (WIZZROBE_ORBS.includes(e.kind)) {
    e.grace = 10; // (its caster sets its own step's ticks)
    e.shot2 = -1;
    e.state = "rest";
  } else if (WIZZROBE_SPARKS.includes(e.kind)) {
    e.homeX = e.x;
    e.homeY = e.y;
    e.speed = 0;
    e.grace = WIZZROBE.sparkTicks;
    e.state = "fly";
  } else if (e.kind === WIZZROBE_BEAM) {
    e.timer = WIZZROBE.beamFirst;
    e.state = "spit";
  } else {
    e.angle = Math.trunc(fraction(game) * 3.99) & 3;
    e.speed = 0;
    e.timer = -1;
    e.state = "hide";
  }
}

/** Solid (it can be hurt and hurts by contact): a Wizzrobe from the tick after it appears until it vanishes. */
export const wizzrobeSolid = (e: Enemy) => isCaster(e) && ((e.state === "spit" && e.tick >= 1) || e.state === "stop");
/** Hurts a Link it touches (its atcp, hit type 1): a solid Wizzrobe, a bolt. */
export const wizzrobeHurts = (e: Enemy) => wizzrobeSolid(e) || (e.type === "WIZR" && WIZZROBE_BOLTS.includes(e.kind));

export function stepWizzrobe(game: AdventureGame, e: Enemy, world: World, hooks: WizzrobeHooks): void {
  if (WIZZROBE_BOLTS.includes(e.kind)) return stepBolt(e, world, hooks);
  if (WIZZROBE_ORBS.includes(e.kind)) return stepOrb(game, e, hooks);
  if (WIZZROBE_SPARKS.includes(e.kind)) return stepSpark(e, world, hooks);
  if (e.kind === WIZZROBE_BEAM) return stepBeam(game, e);
  stepCaster(game, e, world, hooks);
}

function stepCaster(game: AdventureGame, e: Enemy, world: World, hooks: WizzrobeHooks): void {
  // Alpha, velocity, then its timers (the update's order).
  const shown = e.state === "spit" || e.state === "stop";
  e.speed = shown ? 255 : easeTo(e.speed, 0, WIZZROBE.fadeEase, WIZZROBE.fadeMax);
  e.vx = easeTo(e.vx, e.tvx, WIZZROBE.ease, WIZZROBE.maxEase);
  e.vy = easeTo(e.vy, e.tvy, WIZZROBE.ease, WIZZROBE.maxEase);
  if (e.vx || e.vy) {
    moveAxis(e, world, e.vx, "x");
    moveAxis(e, world, e.vy, "y");
  }
  if (e.grace > 0) e.grace--;
  if (e.timer > 0) e.timer--;
  if (e.shot > 0) e.shot--;
  if (e.frameTimer > 0) e.frameTimer--;
  switch (e.state) {
    case "hide":
      if (e.timer < 0) {
        const base = e.kind === 0 ? WIZZROBE.hideKind0 : e.kind === 4 || e.kind === 5 ? WIZZROBE.hideKind45 : WIZZROBE.hideOthers;
        e.timer = base + Math.trunc(fraction(game) * base);
      }
      if (e.timer === WIZZROBE.moveAt && !teleport(game, e, world)) e.timer = WIZZROBE.moveAt + 1;
      if (e.timer > 0) return;
      // Appears: opaque at once, its hat alone, then its pose; its cast's first step in 40.
      e.speed = 255;
      e.frame = WIZZROBE_HAT;
      e.timer = WIZZROBE.hatTicks;
      e.grace = WIZZROBE.standTicks;
      e.shot2 = 0;
      e.homeX = e.homeY = 0;
      return setState(e, "spit");
    case "spit":
      return cast(game, e, hooks);
    case "stop":
      e.vx = e.vy = e.tvx = e.tvy = 0;
      if (e.shot > 0) return;
      // Then the vanish's first step at once.
      e.shot2 = e.grace = 0;
      setState(e, "rest");
      return vanish(e);
    case "rest":
      return vanish(e);
  }
}

/** Gone, 30 ticks before it shows: a spot near the richest Link, or false (again next tick). */
function teleport(game: AdventureGame, e: Enemy, world: World): boolean {
  const i = richest(game);
  if (i < 0) return false;
  const p = game.players[i]!;
  for (let t = 0; t < WIZZROBE.spotTries; t++) {
    const [ox, oy] = QUARTERS[e.angle]!;
    const dx = Math.round((WIZZROBE.spotMin + WIZZROBE.spotSpread * fraction(game)) * SUBPX) * ox;
    const dy = Math.round((WIZZROBE.spotMin + WIZZROBE.spotSpread * fraction(game)) * SUBPX) * oy;
    e.angle = (e.angle + 1 + Math.trunc(fraction(game) * 2.99)) & 3;
    const x = p.x + dx, y = p.y + dy;
    if (!sweepClear(world, e.x, e.y, x, y, WIZZROBE.searchHalf)) continue;
    [e.x, e.y, e.z] = [x, y, 0];
    e.facing = facingTo(p.x - x, p.y - y);
    return true;
  }
  return false;
}

/** Its live summons (raised Stalfos, POPOs) and orbs. */
const summons = (game: AdventureGame, e: Enemy) => game.adventure.enemies.filter((s) => s.leader === e.id && s.life >= 0 && s.id !== e.id && (s.type === "STAL" || s.type === "POPO"));

function cast(game: AdventureGame, e: Enemy, hooks: WizzrobeHooks): void {
  const busy = (e.kind === 1 || e.kind === 2) && summons(game, e).length > 0;
  // Kinds 1-3 face their Link, kind 3 flees, through the first four steps.
  if (e.kind >= 1 && e.kind <= 3) {
    if (e.shot2 <= 3) {
      const i = e.kind === 3 ? nearest(game, e.x, e.y) : richest(game), p = game.players[i];
      if (p && !busy) e.facing = facingTo(p.x - e.x, p.y - e.y);
      if (e.kind === 3) {
        if (e.frameTimer === 0) {
          e.turn = Math.max(0, e.turn - 1);
          e.frameTimer = WIZZROBE.budgetTicks;
        }
        if (p && dist(game, i, e.x, e.y) < WIZZROBE.flee) [e.tvx, e.tvy] = along((angleTo(e.x, e.y, p.x, p.y) + 0x8000) & 0xffff, WIZZROBE.fleeSpeed);
        else e.tvx = e.tvy = 0;
      }
    } else e.tvx = e.tvy = 0;
  }
  // Kind 3 holds its beam's step.
  if (e.kind === 3 && e.shot2 === 3) {
    e.grace = 20;
    const i = nearest(game, e.x, e.y);
    if (i < 0) e.grace = 0;
    else if (game.adventure.gems > 0) {
      if (dist(game, i, e.x, e.y) >= WIZZROBE.beamNear) e.homeX = 0;
      else if (++e.homeX > WIZZROBE.beamNearTicks) endSpell(game, e), (e.grace = 0);
    } else if (++e.homeY > WIZZROBE.beamPoorTicks) endSpell(game, e), (e.grace = 0);
  }
  if (e.grace === 0) {
    e.grace = WIZZROBE.stepTicks[e.shot2]!;
    e.shot2++;
    if (e.shot2 === 3) spell(game, e, hooks, busy);
    if (e.state === "spit" && e.shot2 > 4) {
      if (e.kind === 3) endSpell(game, e);
      e.shot = WIZZROBE.afterTicks;
      return setState(e, "stop");
    }
  }
  if (e.timer === 0 && e.shot2 <= 4) e.frame = WIZZROBE_CAST[FACINGS.indexOf(e.facing)]![e.shot2]!;
}

/** Its cast's third step. */
function spell(game: AdventureGame, e: Enemy, hooks: WizzrobeHooks, busy: boolean): void {
  const kind = busy ? 0 : e.kind;
  const [dx, dy] = STEP[e.facing];
  if (kind === 0 || kind === 4 || kind === 5) {
    const s = kind === 5 ? hooks.spawn("BOIB", 0, e.x, e.y, 0) : hooks.spawn("WIZR", kind === 0 ? 10 : 11, e.x, e.y, WIZZROBE.boltZ);
    if (s) [s.vx, s.vy, s.facing, s.leader] = [dx * WIZZROBE.boltSpeed, dy * WIZZROBE.boltSpeed, e.facing, e.id];
    e.shot = WIZZROBE.afterTicks;
    return setState(e, "stop");
  }
  if (kind < 1 || kind > 3) return;
  if (kind !== 3) e.grace += WIZZROBE.summonExtra;
  const s = hooks.spawn("WIZR", kind === 3 ? WIZZROBE_BEAM : 19 + kind, e.x, e.y, kind === 1 ? WIZZROBE.orbZ[0]! : WIZZROBE.orbZ[1]!);
  if (!s) return;
  s.grace = e.grace;
  s.leader = e.id;
  e.leader = s.id;
}

/** Its orb or beam goes (life 0: they fizzle next tick). */
function endSpell(game: AdventureGame, e: Enemy): void {
  const s = game.adventure.enemies.find((x) => x.id === e.leader);
  if (s && s.leader === e.id) s.life = 0;
  e.leader = 0;
}

function vanish(e: Enemy): void {
  if (e.grace > 0) return;
  if (e.shot2 < 4) {
    e.frame = WIZZROBE_VANISH[FACINGS.indexOf(e.facing)]![e.shot2]!;
    e.grace = WIZZROBE_VANISH_TICKS[e.shot2]!;
    e.shot2++;
    return;
  }
  // The hat spins (the last frame is set as it goes, never drawn).
  e.frame = WIZZROBE_SPIN + e.shot2 - 4;
  e.grace = WIZZROBE_SPIN_TICKS;
  if (++e.shot2 > 7) {
    e.timer = -1;
    setState(e, "hide");
  }
}

/** A hit (any it takes, before its knockback): its orb or beam goes, and it vanishes once the knockback is over
 *  (enemies.ts's stepKnock: back to "rest"). */
export function wizzrobeHurt(game: AdventureGame, e: Enemy): void {
  if (!isCaster(e)) return;
  endSpell(game, e);
  e.grace = e.shot = e.shot2 = 0;
  e.tvx = e.tvy = 0;
}

/** Its death (with enemies.ts's): kind 1's raised Stalfos collapse for good, kind 3's gems, its switch. */
export function wizzrobeDies(game: AdventureGame, e: Enemy, hooks: WizzrobeHooks): void {
  endSpell(game, e);
  if (e.kind === 1) for (const s of summons(game, e)) if (s.type === "STAL") s.angle = 1; // (going for good)
  if (e.kind === 3) for (const type of wizzrobeGems(e.turn)) hooks.dropGem(e.x, e.y, type);
  const sw = (e.params >>> 22) & 31;
  if (sw) hooks.setSwitch(sw);
}

/** Kind 3's budget as gem types, biggest first (at most 100 of them). */
export function wizzrobeGems(budget: number): number[] {
  const out: number[] = [];
  for (let t = WIZZROBE_GEMS.length - 1; t >= 0 && budget > 0 && out.length < 100; )
    if (budget >= WIZZROBE_GEMS[t]!) {
      budget -= WIZZROBE_GEMS[t]!;
      out.push(t);
    } else t--;
  return out;
}

// --- its spells ---

function stepBolt(e: Enemy, world: World, hooks: WizzrobeHooks): void {
  if (e.timer > 0) e.timer--;
  if (e.grace > 0) e.grace--;
  if (e.shot > 0) e.shot--;
  const x0 = e.x, y0 = e.y;
  e.x += e.vx;
  e.y += e.vy;
  if (e.kind === 11 && e.grace === 0) {
    hooks.spawn("BLZE", 0xe0c0, e.x, e.y + (e.facing === "left" || e.facing === "right" ? WIZZROBE.flameDrop : 0), 0);
    e.grace = WIZZROBE.flameTicks;
  }
  const wall = !sweepClear(world, x0, y0, e.x, e.y, WIZZROBE.boltWallHalf);
  if (e.shot === 0 || wall || (e.timer === 0 && !inRoom(e.x, e.y))) e.life = -1; // (kind 11: JPA 413 there)
}

function stepOrb(game: AdventureGame, e: Enemy, hooks: WizzrobeHooks): void {
  if (e.grace > 0) e.grace--;
  e.vx = easeTo(e.vx, e.tvx, WIZZROBE.ease, WIZZROBE.maxEase);
  e.vy = easeTo(e.vy, e.tvy, WIZZROBE.ease, WIZZROBE.maxEase);
  e.x += e.vx;
  e.y += e.vy;
  if (e.life === 0) return void (e.life = -1); // its Wizzrobe was hit: it fizzles (JPA 1289)
  if (e.state === "rest") {
    if (e.grace > 0) return;
    e.shot2 = richest(game);
    if (e.shot2 < 0) return void (e.life = -1);
    setState(e, "chase");
  }
  const p = game.players[e.shot2];
  if (!p || !eligible(game, e.shot2)) return void (e.life = -1);
  [e.tvx, e.tvy] = along(angleTo(e.x, e.y, p.x, p.y), WIZZROBE.orbSpeed);
  if (dist(game, e.shot2, e.x, e.y) >= WIZZROBE.orbReach) return;
  // It bursts into sparks a turn / n apart (game angles).
  const n = WIZZROBE.orbSparks[e.kind - 20]!;
  for (let k = 0; k < n; k++) {
    const s = hooks.spawn("WIZR", e.kind + 2, e.x, e.y, e.z);
    if (!s) continue;
    s.angle = Math.trunc((0x10000 / n) * k) & 0xffff;
    s.leader = e.leader;
  }
  e.life = -1;
}

function stepSpark(e: Enemy, world: World, hooks: WizzrobeHooks): void {
  if (e.grace > 0) e.grace--;
  const [dx, dy] = alongGame(e.angle, e.speed);
  e.x = e.homeX + dx;
  e.y = e.homeY + dy;
  e.speed += WIZZROBE.sparkGrow;
  e.angle = (e.angle + WIZZROBE.sparkTurn) & 0xffff;
  if (e.grace > 0) return;
  // Its monster where it is, else 24 px right, up or left of it.
  const tries: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [0, -1], [-1, 0]];
  for (const [ox, oy] of tries) {
    const x = e.x + ox * WIZZROBE.sparkRetry, y = e.y + oy * WIZZROBE.sparkRetry;
    if (!inRoom(x, y) || !sweepClear(world, x, y, x, y, WIZZROBE.half)) continue;
    const m = e.kind === 22 ? hooks.spawn("STAL", 5, x, y, e.z) : e.kind === 23 ? hooks.spawn("POPO", 1, x, y, e.z) : null;
    if (m) m.leader = e.leader;
    break;
  }
  e.life = -1; // (JPA 1289)
}

function stepBeam(game: AdventureGame, e: Enemy): void {
  const w = game.adventure.enemies.find((x) => x.id === e.leader);
  if (e.life === 0 || !w || w.life < 0) return void (e.life = -1);
  [e.x, e.y, e.z] = [w.x, w.y - WIZZROBE.beamAbove, w.z];
  if (e.timer > 0) e.timer--;
  if (e.timer > 0) return;
  e.timer = WIZZROBE.beamTicks;
  const i = nearest(game, e.x, e.y);
  if (i < 0) return;
  e.facing = facingTo(game.players[i]!.x - e.x, game.players[i]!.y - e.y);
  if (game.adventure.gems <= 0) return;
  game.adventure.gems--; // (a 1-gem RUPY flies from him to the beam and is lost)
  e.shot = (e.shot + 1) & 63;
}

// --- the Stalfos it raises (STAL kind 5) ---

export const RAISED_STALFOS = {
  hits: 4,
  /** Life while it falls in, then for good (reset every tick: it never dies by damage). */
  fallingLife: 1000,
  life: 10000,
  gravity: SUBPX,
  maxFall: 10 * SUBPX,
  startVz: -26, // -0.1 px/tick, to start the fall
  /** Collapsed: its skull 690 ticks (the last 30 hopping), up again once 750 are over and it lands. */
  pileTicks: 690,
  upTicks: 750,
  hopFrom: 30,
  hopVz: 4 * SUBPX,
  hopSpeed: 333, // 1.3 px/tick
  /** Shaking ±2 px every 2 ticks while its pile timer is between these. */
  shakeFrom: 130,
  shakeTo: 30,
  /** Gone for good: its skull 130 ticks, then it dies. */
  goneTicks: 130,
  /** Its skull: both2 344 + 28 + facing. */
  skull: 28,
};

// Field use (stepStalfos leaves these alone): shot = hit points, shot2 = the pile's timer (+0x248), speed = the getting-up
// timer (+0x244), angle = 1 once it goes for good, leader = its Wizzrobe; state "hide" while collapsed.

/** A raised Stalfos as a spark makes it (z already its height). */
export function initRaisedStalfos(e: Enemy): void {
  e.shot = RAISED_STALFOS.hits;
  e.life = RAISED_STALFOS.fallingLife;
  e.vz = RAISED_STALFOS.startVz;
}

/**
 * A raised Stalfos's own part of a tick, before stepStalfos (which it replaces when this returns true: falling in,
 * collapsed, going). `wizzrobeHere`: some WIZR is in the area (checked when it picks a walk, stepStalfos's "rest").
 * Its end (going for good) sets life 0 and "die": enemies.ts's die() then (the game dies at once, vtable +0x24).
 */
export function stepRaisedStalfos(game: AdventureGame, e: Enemy, wizzrobeHere: boolean): boolean {
  if (e.life === RAISED_STALFOS.fallingLife) {
    // Falling in: no AI, no hits, no contact; it lands the tick after it reaches the ground.
    if (e.z > 0) {
      e.vz = Math.max(-RAISED_STALFOS.maxFall, e.vz - RAISED_STALFOS.gravity);
      e.z += e.vz;
      return true;
    }
    e.z = e.vz = e.vx = e.vy = 0;
  }
  e.life = RAISED_STALFOS.life;
  if (e.shot2 > 0) e.shot2--;
  if (e.speed > 0) e.speed--;
  if (e.state !== "hide") {
    if (e.angle === 1 || (e.state === "rest" && !wizzrobeHere)) {
      // Gone for good: its skull 130 ticks.
      e.angle = 1;
      e.vx = e.vy = e.tvx = e.tvy = 0;
      e.facing = "down";
      e.shot2 = RAISED_STALFOS.goneTicks;
      setState(e, "hide");
      return true;
    }
    if (e.shot > 0) return false;
    // Out of hit points (after its knockback): it collapses.
    e.vx = e.vy = e.tvx = e.tvy = 0;
    e.facing = "down";
    e.shot2 = RAISED_STALFOS.pileTicks;
    e.speed = RAISED_STALFOS.upTicks;
    setState(e, "hide"); // (JPA 860)
    return true;
  }
  if (e.angle === 1) {
    if (e.z > 0) e.z = Math.max(0, e.z + (e.vz = Math.max(-RAISED_STALFOS.maxFall, e.vz - RAISED_STALFOS.gravity)));
    if (e.shot2 === 0) {
      e.life = 0;
      setState(e, "die");
    }
    return true;
  }
  // The pile, then its hops (its velocity easing 0.3, at most 1 px/tick a tick); up again on a landing once 750 are over.
  e.vx = easeTo(e.vx, e.tvx, 3, SUBPX);
  e.vy = easeTo(e.vy, e.tvy, 3, SUBPX);
  e.x += e.vx;
  e.y += e.vy;
  if (e.shot2 > RAISED_STALFOS.hopFrom) return true;
  if (e.z > 0) {
    e.vz -= RAISED_STALFOS.gravity;
    e.z = Math.max(0, e.z + e.vz);
    return true;
  }
  e.z = 0;
  if (e.speed === 0) {
    e.vx = e.vy = e.vz = e.tvx = e.tvy = 0;
    e.shot = RAISED_STALFOS.hits; // (JPA 860)
    setState(e, "rest");
    return false;
  }
  e.vz = RAISED_STALFOS.hopVz;
  [e.tvx, e.tvy] = alongGame(random(game, 0x10000), RAISED_STALFOS.hopSpeed);
  e.facing = facingTo(e.tvx, e.tvy);
  return true;
}

/** A hit on a raised Stalfos (its knockback as usual, instead of losing life): the damage comes off its hit points; out
 *  of them it collapses once the knockback is over (stepRaisedStalfos). */
export function raisedStalfosHit(e: Enemy, damage: number): void {
  e.life = RAISED_STALFOS.life;
  e.shot -= damage;
}

/** Can't be hurt while falling in or collapsed. */
export const raisedStalfosHurtable = (e: Enemy) => e.life !== RAISED_STALFOS.fallingLife && e.state !== "hide";
/** Hurts by contact except while falling in and going for good; the code keeps its contact while it lies collapsed
 *  (TODO(measure)). */
export const raisedStalfosHurts = (e: Enemy) => e.life !== RAISED_STALFOS.fallingLife && e.angle !== 1;

