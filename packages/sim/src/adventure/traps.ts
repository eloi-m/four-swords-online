// Two hazards of World 1 that are no enemies (they don't count for "all enemies beaten", nothing beats them):
//
// --- the fireball trap (FBGE; its constructor 0x8021D4CC, init 0x8021D3AC, update 0x8021D2FC; the Cave of No Return's
// room 1 has five, params 0) ---
// Invisible. Its countdown (+0x2A8) starts at 120; once down to 1 it shoots at the nearest Link on its screen within
// 112 px (0x801CECF4, with 1.5 and 112.0) and starts again from 120: a shot every 120 ticks while a Link is in range,
// the first as soon as one comes within it. Params bit 0: not there playing alone, bit 1: not there with several
// players (both 0 here); a switch on (its top 5 bits) puts it away. Its shot plays JA_SE_OBJ_ZORA_TAMA (0x50030).
// The shot (FBAL; init 0x80220274, update 0x80220230, draw 0x802201D8) is the river Zora's fireball's actor (init
// 0x801D2FEC, update 0x801D2E70: waterfoes.ts) with its own look: it flies 1.5 px/tick straight at that Link (on top of
// him: straight down) over everything, at z 0, gone off the screen, on hurting a Link (2, hit type 1: 1.5 px/tick away
// from it, the hop, 60 invincible ticks) or when a shield stops it; nothing hurts it; its box is ±2. It shows as the
// JPA effect 656 (made at its spot, moved with it: apps/game view.ts) and a light, 24 px at strength 128 (the Cave is
// dark: apps/game light.ts). Traced in Dolphin (ref/adv/w1-011-room1.sav, docs/measurements/adventure-world1.md "The
// fireball traps"): the shots, their speed and aim, the countdown, the hit (2, knocked 1.5 px/tick away, 25 ticks, 60
// invincible), and a key carried overhead knocked out of the Link's hands (doors.ts knockKeyOut). Assumed: which Links
// it aims at (any one in play; 0x801CCFE4's exclusions not read), the sim's Link body (±7) against its box, so a hit
// lands a tick early on a fireball coming straight (the game's measured reach ±8).
//
// --- the blade trap (TRAP; init 0x801650AC, update 0x80164834, draw 0x80164640; Tingle's Tower room 2 (0x100,
// 0x101), Hyrule Castle room 9's area 2 (0x4, twice)) ---
// Read from main.dol, not traced (no savestate reaches them). Params: p & 3 its way (0 right, 1 left, 2 down, 3 up),
// bit 2 it turns to the Link's way, bit 4 big (box ±12, drawn larger: none in World 1), (p >> 8) & 15 its look (0:
// enemy_both2 340; else enemy_gc 378 + a step 0-3, the next every 10 ticks), (p >> 12) & 15 non-zero: it slides to and
// fro for good (state 3; none in World 1). Its box is ±6, its wall box ±3. Life 1000 every tick (nothing beats it);
// touching it hurts by its atcp (2, enemyparam.csv), hit type 1, whatever it's doing; a sword meeting it clanks (the
// iron ball's: 0x801F285C, 0x80237948; the Link pushed back) with JA_SE_CHR_SHIELD.
// - waiting (state 0): its cool-down (+0x234) over, the nearest Link (0x801EEC98, any on its screen) within 22 px across
//   its way (|dy| < 22 for right and left, |dx| < 22 for down and up), on whichever side, sets it off: its velocity eases
//   toward 3 px/tick its way (0.3 of the gap a tick, by at most 1 px/tick a tick), JA_SE_OBJ_TRAP_MOVE (0x30013). One
//   that turns first takes the way toward that Link when he's within 22 px across it.
// - sliding (1): a wall (its wall box) or another actor met stops it dead: sparks (JPA 1185, 8 px ahead) and
//   JA_SE_OBJ_TRAP_BOUND (0x30014) at most every 4 ticks; then
// - back (2): it eases home, 0.3 of the gap a tick, by at most 0.5 px/tick; within 1 px of home it's there, and waits
//   10 ticks before it can go again.
// Assumed: the Link's way from it by the larger of |dx| and |dy| (0x801EEC98 not read through), the other actor met
// (+0x9C) only another blade trap, the Links it can see (any one in play), the look's first step (the game's a random
// 0-2: here 0, the sim's random numbers left alone).
import { BLOCK_PUSH_SPEED, SLIDE_SCALE, stopActing } from "../combat.ts";
import { velocityAlong } from "../entities.ts";
import { SUBPX, type Facing } from "../player.ts";
import { isSolidAt, type World } from "../world.ts";
import type { AdventureGame } from "./adventure.ts";
import type { Enemy } from "./enemies.ts";

/** The fireball trap and its shot (1/256 px, ticks). */
export const FIRE_TRAP = {
  /** Its countdown, set at the start and at each shot. */
  every: 120,
  /** It shoots at a Link within this many px. */
  range: 112,
  /** The shot's speed (1.5 px/tick), damage, box half size (px). */
  speed: 384,
  damage: 2,
  half: 2,
};
/** OKTM's kind for a fireball trap's shot (3 is the Zora's fireball, 4 a Wizzrobe's ice ball). */
export const FIRE_TRAP_KIND = 5;
/** Its shot's effect (JPA) and light (px, strength). */
export const FIRE_TRAP_EFFECT = 656;
export const FIRE_TRAP_LIGHT = { radius: 24, alpha: 128 } as const;

/** The blade trap (1/256 px, ticks). */
export const BLADE_TRAP = {
  half: 6,
  bigHalf: 12,
  wallHalf: 3,
  /** Its slide's speed (3 px/tick), eased toward 3/10 of the gap a tick, by at most 1 px/tick a tick. */
  speed: 3 * SUBPX,
  ease: 3,
  accel: SUBPX,
  /** Back home: 3/10 of the gap a tick, by at most 0.5 px/tick; there within 1 px. */
  back: SUBPX / 2,
  home: SUBPX,
  /** It waits this long once home. */
  cool: 10,
  /** A Link within this many px across its way sets it off. */
  across: 22,
  /** Its look's step (kinds but 0), the sparks' least gap, how far ahead they show (px). */
  stepTicks: 10,
  sparkEvery: 4,
  sparkAhead: 8,
  /** Its looks: kind 0 enemy_both2 340, the others enemy_gc 378 + the step. */
  frame: 340,
  stepFrame: 378,
  /** Its sparks (JPA). */
  sparks: 1185,
};

/** Its states (+0x230). */
export const BLADE_STATE = { wait: 0, slide: 1, back: 2, bounce: 3 } as const;

const FACINGS: readonly Facing[] = ["right", "left", "down", "up"];
const STEP: Readonly<Record<Facing, readonly [number, number]>> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
const OPPOSITE: Readonly<Record<Facing, Facing>> = { right: "left", left: "right", down: "up", up: "down" };
const across = (f: Facing) => f === "right" || f === "left";

/** `v` eased `ease`/10 of the way to `target`, by at most `max` (0x801F71A4); at least 1/256 px, so it gets there. */
function easeTo(v: number, target: number, ease: number, max: number): number {
  const d = target - v, step = Math.trunc((d * ease) / 10) || Math.sign(d);
  return v + Math.max(-max, Math.min(max, step));
}

/** The nearest Link in play (not down for good), within `range` px when given, or -1. */
function nearestLink(game: AdventureGame, x: number, y: number, range = Infinity): number {
  let best = -1, bestD = range * range;
  game.players.forEach((p, i) => {
    const f = game.battle.fighters[i]!;
    if (f.mode === "dying" || f.mode === "dead") return;
    const dx = (p.x - x) / SUBPX, dy = (p.y - y) / SUBPX, d = dx * dx + dy * dy;
    if (d <= bestD) [best, bestD] = [i, d];
  });
  return best;
}

// --- the fireball trap ---

/** Its params: gone playing alone with bit 0 (apps/game plays alone: one controller for the four), else waiting. */
export function initFireTrap(e: Enemy): boolean {
  if (e.params & 1) return false;
  e.timer = FIRE_TRAP.every;
  e.atcp = 0;
  e.state = "stop";
  return true;
}

/** One tick of a fireball trap: `shoot(vx, vy)` makes its fireball at it. */
export function stepFireTrap(game: AdventureGame, e: Enemy, shoot: (vx: number, vy: number) => void): void {
  if (e.timer > 1) {
    e.timer--;
    return;
  }
  const p = game.players[nearestLink(game, e.x, e.y, FIRE_TRAP.range)];
  if (!p) return;
  const [vx, vy] = velocityAlong(p.x - e.x, p.y - e.y, FIRE_TRAP.speed);
  shoot(vx, vx || vy ? vy : FIRE_TRAP.speed);
  e.timer = FIRE_TRAP.every;
}

// --- the blade trap ---

// Its fields in the sim's enemy record: `shot` its state (+0x230), `facing` its way (+0x98), `timer` its cool-down
// (+0x234), `frame` its look's step (+0x260) and `frameTimer` its count (+0x238), `grace` the sparks' gap (+0x23C),
// `angle` the tick its last sparks came (-1: none), (`tvx`, `tvy`) the velocity it eases toward (+0x268), (`homeX`,
// `homeY`) home (+0x274), `flags` its params' bits (BLADE_TURNS, BLADE_BIG).
export const BLADE_TURNS = 1;
export const BLADE_BIG = 2;

export function initBladeTrap(e: Enemy): void {
  const p = e.params;
  e.facing = FACINGS[p & 3]!;
  e.flags = ((p >>> 2) & 1 ? BLADE_TURNS : 0) | ((p >>> 4) & 1 ? BLADE_BIG : 0);
  e.kind = (p >>> 8) & 15;
  e.shot = (p >>> 12) & 15 ? BLADE_STATE.bounce : BLADE_STATE.wait;
  e.state = "stop";
  e.life = 1;
  e.frame = e.frameTimer = e.timer = e.grace = 0;
  e.angle = -1;
  e.tvx = e.tvy = e.vx = e.vy = 0;
}

/** Its box's half size, px. */
export const bladeHalf = (e: Enemy): number => (e.flags & BLADE_BIG ? BLADE_TRAP.bigHalf : BLADE_TRAP.half);

/** Its wall box at (x, y) (1/256 px) meets a wall. */
function walled(world: World, x: number, y: number): boolean {
  const h = BLADE_TRAP.wallHalf, px = x / SUBPX, py = y / SUBPX;
  return isSolidAt(world, px - h, py - h) || isSolidAt(world, px + h, py - h) || isSolidAt(world, px - h, py + h) || isSolidAt(world, px + h, py + h);
}

/** Its box meets another blade trap's. */
function metTrap(game: AdventureGame, e: Enemy): boolean {
  const h = bladeHalf(e) * SUBPX;
  return game.adventure.enemies.some((o) => {
    if (o === e || o.type !== "TRAP" || o.life < 0) return false;
    const k = bladeHalf(o) * SUBPX;
    return Math.abs(o.x - e.x) <= h + k && Math.abs(o.y - e.y) <= h + k;
  });
}

/** Stopped dead: its sparks (at most every 4 ticks), its velocity gone. */
function stopDead(game: AdventureGame, e: Enemy): void {
  if (e.grace === 0) {
    e.angle = game.tick;
    e.grace = BLADE_TRAP.sparkEvery;
  }
  e.vx = e.vy = e.tvx = e.tvy = 0;
}

/** Off its way at full speed (the velocity eases toward it). */
function launch(e: Enemy): void {
  const [dx, dy] = STEP[e.facing];
  e.tvx = dx * BLADE_TRAP.speed;
  e.tvy = dy * BLADE_TRAP.speed;
}

export function stepBladeTrap(game: AdventureGame, e: Enemy, world: World): void {
  const T = BLADE_TRAP, S = BLADE_STATE;
  e.life = 1;
  e.vx = easeTo(e.vx, e.tvx, T.ease, T.accel);
  e.vy = easeTo(e.vy, e.tvy, T.ease, T.accel);
  // Moved, then pushed back out of a wall (0x801F2618, its wall box).
  let wall = false;
  if (e.vx || e.vy) {
    const [sx, sy] = [Math.sign(e.vx), Math.sign(e.vy)];
    e.x += e.vx;
    e.y += e.vy;
    for (let n = 0; n < 4 * T.wallHalf * 4 && walled(world, e.x, e.y); n++) {
      e.x -= sx * (SUBPX / 4);
      e.y -= sy * (SUBPX / 4);
      wall = true;
    }
  }
  if (e.kind && e.frameTimer === 0) {
    e.frame = (e.frame + 1) & 3;
    e.frameTimer = T.stepTicks;
  }
  switch (e.shot) {
    case S.wait: {
      if (e.timer > 0) break;
      const p = game.players[nearestLink(game, e.x, e.y)];
      if (!p) break;
      const dx = Math.abs(p.x - e.x) / SUBPX, dy = Math.abs(p.y - e.y) / SUBPX;
      if (e.flags & BLADE_TURNS) {
        const way: Facing = dx >= dy ? (p.x >= e.x ? "right" : "left") : p.y >= e.y ? "down" : "up";
        if (across(way) ? dy < T.across : dx < T.across) e.facing = way;
      }
      if (across(e.facing) ? dy < T.across : dx < T.across) {
        launch(e);
        e.shot = S.slide;
        e.tick = 0;
      }
      break;
    }
    case S.slide:
      if (wall || metTrap(game, e)) {
        stopDead(game, e);
        e.shot = S.back;
        e.tick = 0;
      }
      break;
    case S.back: {
      if (wall) break;
      e.x = easeTo(e.x, e.homeX, T.ease, T.back);
      e.y = easeTo(e.y, e.homeY, T.ease, T.back);
      if (Math.hypot(e.x - e.homeX, e.y - e.homeY) < T.home) {
        [e.x, e.y] = [e.homeX, e.homeY];
        e.timer = T.cool;
        e.shot = S.wait;
        e.tick = 0;
      }
      break;
    }
    case S.bounce:
      if (wall || metTrap(game, e)) {
        stopDead(game, e);
        e.facing = OPPOSITE[e.facing];
      }
      launch(e);
      break;
  }
  if (e.timer > 0) e.timer--;
  if (e.frameTimer > 0) e.frameTimer--;
  if (e.grace > 0) e.grace--;
}

/** Its frame now: kind 0 enemy_both2 340, the others enemy_gc 378 + its step. */
export const bladeFrame = (e: Enemy): { sob: "both2" | "gc"; frame: number } =>
  e.kind ? { sob: "gc", frame: BLADE_TRAP.stepFrame + e.frame } : { sob: "both2", frame: BLADE_TRAP.frame };

/** Its sparks (JPA 1185, 8 px ahead of it) if it stopped dead lately: where, from which tick. */
export function bladeSparks(e: Enemy): { x: number; y: number; start: number } | null {
  if (e.angle < 0) return null;
  const [dx, dy] = STEP[e.facing];
  return { x: e.x / SUBPX + dx * BLADE_TRAP.sparkAhead, y: e.y / SUBPX + dy * BLADE_TRAP.sparkAhead, start: e.angle };
}

/**
 * A Link's sword meeting a blade trap clanks on it as on the iron ball (0x801F285C, then 0x80237948): he's pushed back
 * from it, his action stopped (true: his strike went no further).
 */
export function bladeClanks(game: AdventureGame, i: number, meets: (box: { left: number; top: number; right: number; bottom: number }) => boolean): boolean {
  for (const e of game.adventure.enemies) {
    if (e.type !== "TRAP" || e.life < 0) continue;
    const h = bladeHalf(e) * SUBPX;
    if (!meets({ left: e.x - h, top: e.y - h, right: e.x + h, bottom: e.y + h })) continue;
    const p = game.players[i]!, f = game.battle.fighters[i]!;
    f.endCharge = 0;
    stopActing(p);
    p.action = "tink";
    [f.slideX, f.slideY] = velocityAlong(p.x - e.x, p.y - e.y, BLOCK_PUSH_SPEED * SLIDE_SCALE);
    return true;
  }
  return false;
}
