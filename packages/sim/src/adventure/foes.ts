// More of the adventure's enemies, the most frequent of the placed and generated ones (docs/ADVENTURE.md census):
// the Tektite, the Stalfos, the Buzz Blob and the Poe, read from main.dol (not traced: no savestate reaches a stage that
// has them). Records and the common rules (hits, knockback, death, drops) are enemies.ts's; this file is their own
// behaviour, stepped by stepEnemies. Velocities are 1/256 px per tick, z up. The game's angles run from down (0) to
// right (0x4000); here they're the sim's (0 right, clockwise, y down), the same directions.
import { hurtFighter, onGround, vulnerable } from "../combat.ts";
import { cos4096, sin4096, TRIG_ONE } from "../entities.ts";
import { angleTo } from "../hazards.ts";
import { moveAxis, SUBPX, type Facing } from "../player.ts";
import type { World } from "../world.ts";
import { nextRandom, type AdventureGame } from "./adventure.ts";
import type { Enemy, EnemyState } from "./enemies.ts";

const random = (game: AdventureGame, n: number) => nextRandom(game.adventure) % n;
/** A random fraction in [0, 1) in 1/256 steps (the game's [1, 2) float − 1). */
const fraction = (game: AdventureGame) => random(game, 256) / 256;
const STEP: Readonly<Record<Facing, readonly [number, number]>> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
/** The game's facing numbers: 0 right, 1 left, 2 down, 3 up. */
const FACINGS: readonly Facing[] = ["right", "left", "down", "up"];

function setState(e: Enemy, state: EnemyState): void {
  e.state = state;
  e.tick = 0;
}

/** `v` eased `ease`/10 of the way to `target`, by at most `max` (0x801F71A4); at least 1/256 px, so it gets there. */
function easeTo(v: number, target: number, ease: number, max: number): number {
  const d = target - v, step = Math.trunc((d * ease) / 10) || Math.sign(d);
  return v + Math.max(-max, Math.min(max, step));
}

/** The nearest Link in play (0x801EEC98's mode 0: no range limit), or -1. */
function nearest(game: AdventureGame, x: number, y: number): number {
  let best = -1, bestD = Infinity;
  game.players.forEach((p, i) => {
    const f = game.battle.fighters[i]!;
    if (!vulnerable(f) || !onGround(f)) return;
    const d = Math.hypot((p.x - x) / SUBPX, (p.y - y) / SUBPX);
    if (d < bestD) [best, bestD] = [i, d];
  });
  return best;
}

/** The facing of the dominant axis toward (dx, dy) (0x801F681C). */
const facingTo = (dx: number, dy: number): Facing => (Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "down" : "up");

/** Moves on both axes against the area's walls; true when a wall stopped it. */
function moveWalls(e: Enemy, world: World): boolean {
  const x0 = e.x, y0 = e.y;
  moveAxis(e, world, e.vx, "x");
  moveAxis(e, world, e.vy, "y");
  return (e.vx !== 0 && e.x - x0 !== e.vx) || (e.vy !== 0 && e.y - y0 !== e.vy);
}

/** A unit vector (× `speed`) along a sim angle. */
const along = (angle: number, speed: number): [number, number] => [Math.trunc((speed * cos4096(angle)) / TRIG_ONE), Math.trunc((speed * sin4096(angle)) / TRIG_ONE)];

// --- the Tektite (TKTA; init 0x8015512C, update 0x80154C30, death 0x80154A10, draw 0x80154A98) ---
// Params & 7: bit 0 a big one (box ±8 not ±6, life 8 not 4, its jumps 12 px/tick up not 6); kinds 2-3 hide under their
// tile until it changes (a bush cut off it); kinds 4-5 start in the middle of a jump, away from the nearest Link.
// Standing ("rest") it waits 20 + rand(20) ticks at first, then jumps: one time in five at the nearest Link (in place
// without one), else any way at random, its velocity easing (0.3, at most 1 px/tick a tick) to 2 px/tick along that
// way, 6 px/tick up, falling 0.5 px/tick² (25 ticks in the air, 39 px high); a wall in the air stops it dead. Landed
// (a dust puff), it slides to a stop and waits 50 + rand(50) ticks (a big one already hurt: 4 + rand(8)), its legs
// toggling every 8 ticks (16 the first). A Link's attack while it stands makes it jump at once. Contact hurts by its
// atcp (hit type 1) on the ground and in the air. Dying, a small one always leaves a small heart, a big one a 50
// Force Gem (its drop class is 0).
export const TEKTITE = {
  half: 6,
  bigHalf: 8,
  life: 4,
  bigLife: 8,
  firstWaitMin: 20,
  firstWaitSpread: 20,
  waitMin: 50,
  waitSpread: 50,
  hurtWaitMin: 4,
  hurtWaitSpread: 8,
  jumpSpeed: 2 * SUBPX,
  ease: 3,
  maxEase: SUBPX,
  vz: 6 * SUBPX,
  bigVz: 12 * SUBPX,
  gravity: SUBPX / 2,
  /** One jump in this many aims at the nearest Link. */
  aimOneIn: 5,
  legTicks: 8,
  landTicks: 16,
  /** A big one's gem (type 3: 50). */
  bigGem: 3,
};

export function initTektite(game: AdventureGame, e: Enemy, params: number): void {
  const p = params & 7;
  e.kind = p;
  e.life = p & 1 ? TEKTITE.bigLife : TEKTITE.life;
  if (p >= 4) {
    // In the middle of a jump: any way, or straight away from the nearest Link.
    const i = nearest(game, e.x, e.y);
    const angle = i >= 0 ? (angleTo(e.x, e.y, game.players[i]!.x, game.players[i]!.y) + 0x8000) & 0xffff : random(game, 0x10000);
    [e.tvx, e.tvy] = along(angle, TEKTITE.jumpSpeed);
    e.vz = TEKTITE.vz;
    e.frame = 2;
    e.state = "fly";
    return;
  }
  e.timer = TEKTITE.firstWaitMin + random(game, TEKTITE.firstWaitSpread);
  e.state = p >= 2 ? "hide" : "rest";
}

/** Tile index (ty × 32 + tx) under an enemy's anchor. */
const tileUnder = (e: Enemy) => Math.floor(e.y / SUBPX / 16) * 32 + Math.floor(e.x / SUBPX / 16);

export function stepTektite(game: AdventureGame, e: Enemy, world: World): void {
  if (e.state === "hide") {
    // Under its tile until it changes (the arena's cut bushes and lifted things).
    if (!game.battle.cut.includes(tileUnder(e))) return;
    e.kind &= 1;
    setState(e, "rest");
  }
  if (e.frameTimer > 0) e.frameTimer--;
  if (e.timer > 0) e.timer--;
  e.vx = easeTo(e.vx, e.tvx, TEKTITE.ease, TEKTITE.maxEase);
  e.vy = easeTo(e.vy, e.tvy, TEKTITE.ease, TEKTITE.maxEase);
  const blocked = moveWalls(e, world);
  e.z += e.vz;
  if (e.state === "rest") {
    if (e.timer === 0) return jump(game, e);
    if (e.frameTimer === 0) {
      e.frame = e.frame === 0 ? 1 : 0;
      e.frameTimer = TEKTITE.legTicks;
    }
    return;
  }
  // In the air.
  if (blocked) e.vx = e.vy = e.tvx = e.tvy = 0;
  e.vz -= TEKTITE.gravity;
  if (e.z <= 0 && e.vz < 0) {
    e.z = 0;
    e.vz = 0;
    e.tvx = e.tvy = 0;
    e.frame = 1;
    e.frameTimer = TEKTITE.landTicks;
    const big = (e.kind & 1) === 1;
    e.timer = big && e.life < TEKTITE.bigLife ? TEKTITE.hurtWaitMin + random(game, TEKTITE.hurtWaitSpread) : TEKTITE.waitMin + random(game, TEKTITE.waitSpread);
    setState(e, "rest");
  }
}

function jump(game: AdventureGame, e: Enemy): void {
  e.vz = e.kind & 1 ? TEKTITE.bigVz : TEKTITE.vz;
  if (random(game, TEKTITE.aimOneIn) === 0) {
    const i = nearest(game, e.x, e.y);
    if (i >= 0) [e.tvx, e.tvy] = along(angleTo(e.x, e.y, game.players[i]!.x, game.players[i]!.y), TEKTITE.jumpSpeed);
    else e.tvx = e.tvy = 0;
  } else [e.tvx, e.tvy] = along(random(game, 0x10000), TEKTITE.jumpSpeed);
  e.frame = 2;
  setState(e, "fly");
}

/** A Link's attack touched a standing Tektite: it jumps on the next tick (0x801F305C's test). */
export function startleTektite(e: Enemy): void {
  if (e.state === "rest") e.timer = 0;
}

// --- the Stalfos (STAL; init 0x80176538, update 0x801757D4, draw 0x801756E4) ---
// Params bit 4 a big one (box ±12, drawn twice the size); then p & 15: 0 walks (also GEN3 kind 0's), 1 dodges by
// jumping away when a Link within 50 px presses the sword button, 2 dodges and throws a bone (OKTM kind 2) where it
// lands, 3 can't be hurt nor hurts for its first 30 ticks then walks, 4 starts in the air (here: walks), 5 belongs to a
// Wizzrobe (it collapses and gets up: not simulated, it walks). Its facing at random. It picks ("rest") a walk of
// 30 + rand(30) ticks: toward the nearest Link along his dominant axis 7 times in 10 (not after a wall), else onto the
// other axis either way; walks at 0.7 px/tick (its velocity easing 0.3, at most 1 px/tick a tick), then picks again.
// A dodge: 2 px/tick away from the nearest Link, 5 px/tick up, 0.4 px/tick² down (about 25 ticks), then still 5 +
// rand(5) ticks. In the air it can't be hurt and doesn't hurt. The bone flies at 1.8 px/tick toward the Link, 300
// ticks at most, blocked by a shield. Side views (its gravity, its jump) aren't simulated.
export const STALFOS = {
  half: 8,
  bigHalf: 12,
  walkSpeed: 179, // 0.7 px/tick
  walkMin: 30,
  walkSpread: 30,
  /** In 10, how often it picks the way toward the Link. */
  faceIn10: 7,
  ease: 3,
  maxEase: SUBPX,
  dodgeRange: 50,
  jumpSpeed: 2 * SUBPX,
  jumpVz: 5 * SUBPX,
  gravity: 102, // 0.4 px/tick²
  landMin: 5,
  landSpread: 5,
  graceTicks: 30,
  boneSpeed: 461, // 1.8 px/tick
  boneTicks: 300,
  boneHalf: 2,
  boneZ: 8 * SUBPX,
};
/** OKTM's kind for a Stalfos's bone (its params 2). */
export const BONE_KIND = 2;
/** Its walk's frames (both2 344 + index, table 0x804A0C10) and their ticks (0x804A0C70); its jump's (0x804A0C88). */
export const STALFOS_WALK: readonly (readonly number[])[] = [[0, 1, 0, 2, 3, 2], [6, 7, 6, 8, 9, 8], [12, 13, 12, 14, 15, 14], [18, 19, 18, 20, 21, 20]];
export const STALFOS_WALK_TICKS: readonly number[] = [3, 10, 3, 3, 10, 3];
export const STALFOS_JUMP: readonly (readonly number[])[] = [[4, 5, 4, 0], [10, 11, 10, 6], [16, 17, 16, 12], [22, 23, 22, 18]];
export const STALFOS_JUMP_TICKS: readonly number[] = [2, 10, 2, 10];

export function initStalfos(game: AdventureGame, e: Enemy, params: number): void {
  e.turn = (params >>> 4) & 1; // (kept in `turn`: a big one)
  e.kind = params & 15;
  e.facing = FACINGS[Math.trunc(fraction(game) * 3.99)]!;
  if (e.kind === 3) {
    e.grace = STALFOS.graceTicks;
    e.kind = 0;
  }
  e.state = "rest";
}

export function stepStalfos(game: AdventureGame, e: Enemy, world: World, spawnBone: (e: Enemy, vx: number, vy: number) => void): void {
  if (e.grace > 0) e.grace--;
  if (e.timer > 0) e.timer--;
  if (e.frameTimer > 0) e.frameTimer--;
  e.vx = easeTo(e.vx, e.tvx, STALFOS.ease, STALFOS.maxEase);
  e.vy = easeTo(e.vy, e.tvy, STALFOS.ease, STALFOS.maxEase);
  const blocked = moveWalls(e, world);
  e.z += e.vz;
  const i = nearest(game, e.x, e.y), p = game.players[i];
  // A dodge (kinds 1, 2): a Link within 50 px pressing the sword button.
  if (e.state === "walk" && (e.kind === 1 || e.kind === 2) && p && Math.hypot((p.x - e.x) / SUBPX, (p.y - e.y) / SUBPX) < STALFOS.dodgeRange) {
    if (game.players.some((q) => (q.action === "swing" || q.action === "stab" || q.action === "lunge") && q.actionTick === 0)) setState(e, "stop");
  }
  switch (e.state) {
    case "rest": {
      if (e.timer === 0) e.timer = STALFOS.walkMin + random(game, STALFOS.walkSpread);
      const old = e.facing;
      if (!blocked && p && random(game, 10) < STALFOS.faceIn10) e.facing = facingTo(p.x - e.x, p.y - e.y);
      else {
        let k = FACINGS.indexOf(e.facing) ^ 2;
        if (random(game, 2)) k ^= 1;
        e.facing = FACINGS[k]!;
      }
      if (e.facing !== old) e.frame = e.frameTimer = 0;
      const [dx, dy] = STEP[e.facing];
      e.tvx = dx * STALFOS.walkSpeed;
      e.tvy = dy * STALFOS.walkSpeed;
      setState(e, "walk");
      break;
    }
    case "walk":
      animate(e, STALFOS_WALK_TICKS);
      if (e.timer === 0) {
        e.tvx = e.tvy = 0;
        setState(e, "rest");
      }
      break;
    case "stop":
      // The dodge's start: facing him, off away from him.
      if (p) {
        e.facing = facingTo(p.x - e.x, p.y - e.y);
        [e.tvx, e.tvy] = along((angleTo(e.x, e.y, p.x, p.y) + 0x8000) & 0xffff, STALFOS.jumpSpeed);
      }
      e.vz = STALFOS.jumpVz;
      e.frame = e.frameTimer = 0;
      setState(e, "fly");
      break;
    case "fly":
      animate(e, STALFOS_JUMP_TICKS, true);
      e.vz -= STALFOS.gravity;
      if (e.z < 0) {
        if (e.kind === 2 && p) spawnBone(e, ...along(angleTo(e.x, e.y, p.x, p.y), STALFOS.boneSpeed));
        e.z = e.vz = e.tvx = e.tvy = 0;
        e.timer = STALFOS.landMin + random(game, STALFOS.landSpread);
        setState(e, "spit"); // (still after a landing)
      }
      break;
    case "spit":
      if (e.timer === 0) setState(e, "rest");
      break;
  }
}

/** Steps a looping (or held, at its last step) animation table: e.frame = the step, e.frameTimer = its ticks left. */
function animate(e: Enemy, ticks: readonly number[], hold = false): void {
  if (e.frameTimer > 0) return;
  if (e.tick > 1) e.frame = hold ? Math.min(ticks.length - 1, e.frame + 1) : (e.frame + 1) % ticks.length;
  e.frameTimer = ticks[e.frame]!;
}

/** A Stalfos can't be hurt in the air (or during its grace). */
export const stalfosHurtable = (e: Enemy) => e.grace === 0 && e.z === 0 && e.state !== "fly";

// --- the Buzz Blob (BZBR; init 0x80144F9C, update 0x8014462C, draw 0x80144194) ---
// Params & 1: 1 also hops. It wanders ("walk"): every 50 + rand(50) ticks, or at once on a wall, a new velocity of
// 0.3 × (rand + the way to the nearest Link) px/tick on each axis, either sign at random (raw, no easing). Kind 1, with
// its 20-tick cool-down over, a Link lined up (within 24 px on an axis) and nothing solid between: a 20-tick squat
// ("stop"), then a hop of 3 px/tick along that way, 5 px/tick up, 0.5 px/tick² down (21 ticks, 63 px), then a cool-down
// of 30 + rand(50). It never hurts by contact: a Link touching it, or striking it with the sword, is shocked (hit type
// 10: 1 damage, no knockback, the electrocuted pose) and it stops ("spit") for 44 ticks; the sword never hurts it
// (blasts, arrows and thrown things do). Into lava (tile type 0x0E) it sinks and goes, without a drop. Its look:
// gc 16 + [0, 1, 2, 1][step], a step every 8 ticks; shocking, gc 16 + [4, 8, 6, 7, 5, 9, 4, 7, 8, 7, 9] every 4.
export const BUZZ = {
  half: 8,
  wanderMin: 50,
  wanderSpread: 50,
  wanderSpeed: 0.3,
  lineUp: 24,
  squatTicks: 20,
  hopSpeed: 3 * SUBPX,
  hopVz: 5 * SUBPX,
  gravity: SUBPX / 2,
  coolMin: 30,
  coolSpread: 50,
  stepTicks: 8,
  shockStepTicks: 4,
  shockSteps: 11,
  shockDamage: 1,
};
/** Tile type 0x0E (a damaging pit, lava), where a Buzz Blob sinks. */
export const LAVA_TYPE = 0x0e;
export const BUZZ_STEPS: readonly number[] = [0, 1, 2, 1];
export const BUZZ_SHOCK_STEPS: readonly number[] = [4, 8, 6, 7, 5, 9, 4, 7, 8, 7, 9];

export function initBuzzBlob(game: AdventureGame, e: Enemy, params: number): void {
  e.kind = params & 1;
  e.frame = Math.trunc(fraction(game) * 3.99);
  e.state = "walk";
}

export function stepBuzzBlob(game: AdventureGame, e: Enemy, world: World, clearLine: (x0: number, y0: number, x1: number, y1: number) => boolean, typeAt: (x: number, y: number) => number): void {
  if (e.frameTimer > 0) e.frameTimer--;
  if (e.timer > 0) e.timer--;
  if (e.grace > 0) e.grace--;
  if (e.shot > 0) e.shot--;
  const blocked = moveWalls(e, world);
  e.z += e.vz;
  switch (e.state) {
    case "walk": {
      if (blocked || e.timer === 0) {
        e.timer = BUZZ.wanderMin + random(game, BUZZ.wanderSpread);
        const i = nearest(game, e.x, e.y), p = game.players[i];
        let ux = 0, uy = 0;
        if (p) {
          const d = Math.hypot(p.x - e.x, p.y - e.y) || 1;
          [ux, uy] = [(p.x - e.x) / d, (p.y - e.y) / d];
        }
        e.vx = Math.round(BUZZ.wanderSpeed * (fraction(game) + ux) * SUBPX) * (random(game, 2) ? -1 : 1);
        e.vy = Math.round(BUZZ.wanderSpeed * (fraction(game) + uy) * SUBPX) * (random(game, 2) ? -1 : 1);
      }
      if (e.frameTimer === 0) {
        e.frameTimer = BUZZ.stepTicks;
        e.frame = (e.frame + 1) & 3;
      }
      // A hop at a Link lined up with it.
      if (e.kind === 1 && e.grace === 0) {
        const i = nearest(game, e.x, e.y), p = game.players[i];
        if (p && (Math.abs(p.y - e.y) < BUZZ.lineUp * SUBPX || Math.abs(p.x - e.x) < BUZZ.lineUp * SUBPX) && clearLine(e.x / SUBPX, e.y / SUBPX, p.x / SUBPX, p.y / SUBPX)) {
          e.facing = facingTo(p.x - e.x, p.y - e.y);
          e.vx = e.vy = 0;
          e.frame = e.facing === "right" ? 0 : e.facing === "left" ? 2 : 1;
          e.grace = BUZZ.squatTicks;
          setState(e, "stop");
        }
      }
      break;
    }
    case "stop":
      if (e.grace === 1) {
        const [dx, dy] = STEP[e.facing];
        [e.vx, e.vy, e.vz] = [dx * BUZZ.hopSpeed, dy * BUZZ.hopSpeed, BUZZ.hopVz];
      }
      if (e.grace > 0) break;
      if (e.z > 0) e.vz -= BUZZ.gravity;
      else if (e.tick > 1) {
        [e.z, e.vx, e.vy, e.vz] = [0, 0, 0, 0];
        e.grace = BUZZ.coolMin + random(game, BUZZ.coolSpread);
        setState(e, "walk");
      }
      break;
    case "spit":
      // Shocking: steps every 4 ticks, back to wandering past its 11th.
      if (e.z > 0) e.vz -= BUZZ.gravity;
      else e.z = e.vz = 0;
      if (e.shot === 0) {
        e.shot = BUZZ.shockStepTicks;
        if (++e.frame >= BUZZ.shockSteps) {
          e.frame = 0;
          setState(e, "walk");
        }
      }
      break;
    case "hide":
      // Sinking into lava.
      if (e.tick >= 46) e.life = -1;
      break;
  }
  if (e.state !== "hide" && typeAt(Math.floor(e.x / SUBPX), Math.floor(e.y / SUBPX)) === LAVA_TYPE) {
    e.vx = e.vy = 0;
    setState(e, "hide");
  }
}

/** A Link touching or striking a Buzz Blob is shocked; it stops to buzz (44 ticks). */
export function shock(game: AdventureGame, e: Enemy, i: number): void {
  const p = game.players[i]!, f = game.battle.fighters[i]!;
  const hit = hurtFighter(p, f, i, BUZZ.shockDamage, e.x, e.y, { cause: "shock", knock: { speed: 0, hop: 0 } });
  if (!hit) return;
  game.battle.hits.push(hit);
  if (e.state === "spit") return;
  e.vx = e.vy = 0;
  e.frame = 0;
  e.shot = BUZZ.shockStepTicks;
  setState(e, "spit");
}

// --- the Poe (POOH; init 0x80143330, update 0x8014292C, draw 0x80142684) ---
// Kind p & 0xFF: 0 floats, 1 and 5 hide until a Link comes within 16 px, 2 and 6 blink (150 + rand(150) ticks seen,
// as many gone; they never move up or down), 3 and 7 are ghosts swords can't kill (struck, they laugh and fade out 20
// ticks; a spotlight kills them: not simulated) with a ±12 box and 100 life, 4-7 wait for their switch (the params' top
// 5 bits), 8 is a trigger (not an enemy), 9 leaves a heart 3 times in 10 (else a magic jar: not simulated). It floats
// over everything (no walls), bobbing at 20 + 4 × cos(its phase) px up (the phase stepping 512 + rand(256) a tick, z easing
// 0.3, at most 1 px/tick), swaying side to side (0.05 px/tick² one way, reversed every 60 + rand(60) ticks; × 0.97 a
// tick) and drifting toward the nearest Link at 0.01 px/tick² on each axis (a ghost or no Link: back toward where it
// last was within 64 px). Seen (alpha past 200) it can be hurt; one stab kills (life 4). Contact hurts by its atcp
// always, seen or not. Fades at 0.3 of the way, at most 10 a tick. Look: gc 132 + [0..5, 2, 3] facing right (6 + … left),
// 6, 6, 3, 3, 6, 6, 3, 3 ticks a step; ghosts: data.arc timg e_obake_*.bti (not drawn).
export const POE = {
  half: 8,
  ghostHalf: 12,
  ghostLife: 100,
  z: 24 * SUBPX,
  bobZ: 20,
  bobAmp: 4,
  bobStepMin: 512,
  bobStepSpread: 256,
  zEase: 3,
  zMax: SUBPX,
  flipMin: 60,
  flipSpread: 60,
  sway: 13, // 0.05 px/tick²
  drift: 3, // 0.01 px/tick² (as near as 1/256 px goes)
  drag: 248, // / 256 = 0.97
  homeRange: 64,
  appear: 16,
  blinkMin: 150,
  blinkSpread: 150,
  fadeEase: 3,
  fadeMax: 10,
  solidAlpha: 200,
  vanishTicks: 20,
  heartIn10: 3,
};
export const POE_FRAMES: readonly number[] = [0, 1, 2, 3, 4, 5, 2, 3];
export const POE_STEP_TICKS: readonly number[] = [6, 6, 3, 3, 6, 6, 3, 3];
const ghost = (e: Enemy) => e.kind === 3 || e.kind === 7;

export function initPoe(game: AdventureGame, e: Enemy, params: number): void {
  e.kind = params & 0xff;
  e.speed = 255; // alpha
  e.timer = POE.flipMin + random(game, POE.flipSpread);
  e.state = "fly";
  e.z = POE.z;
  switch (e.kind) {
    case 1:
    case 5:
      e.speed = 0;
      e.z = 0;
      e.state = "hide";
      break;
    case 2:
    case 6:
      e.grace = POE.blinkMin + random(game, POE.blinkSpread);
      if (e.kind === 6) e.speed = 0;
      break;
    case 3:
    case 7:
      e.life = POE.ghostLife;
      break;
    case 4:
    case 9:
      e.speed = 0;
      break;
  }
}

/** Whether a Poe can be hurt now: seen (and not a ghost, which swords only make laugh). */
export const poeSolid = (e: Enemy) => e.state === "fly" && e.shot2 === 0 && e.speed > POE.solidAlpha;

export function stepPoe(game: AdventureGame, e: Enemy): void {
  if (e.state === "hide") {
    const i = nearest(game, e.x, e.y), p = game.players[i];
    if (p && Math.hypot((p.x - e.x) / SUBPX, (p.y - e.y + e.z) / SUBPX) < POE.appear) {
      e.speed = 200;
      setState(e, "fly");
    }
    return;
  }
  // Bob.
  e.z = easeTo(e.z, Math.round((POE.bobZ + (POE.bobAmp * cos4096(e.angle)) / TRIG_ONE) * SUBPX), POE.zEase, POE.zMax);
  e.angle = (e.angle + POE.bobStepMin + random(game, POE.bobStepSpread)) & 0xffff;
  // Blink (kinds 2, 6); a ghost's laugh wears off.
  if (e.grace > 0 && --e.grace === 0) {
    if (e.kind === 2 || e.kind === 6) {
      e.grace = POE.blinkMin + random(game, POE.blinkSpread);
      e.shot2 ^= 1;
    } else if (ghost(e)) e.shot2 = 0;
  }
  e.speed = easeTo(e.speed, e.shot2 ? 0 : 255, POE.fadeEase, POE.fadeMax);
  // Sway, drift.
  if (e.timer > 0 && --e.timer === 0) {
    e.timer = POE.flipMin + random(game, POE.flipSpread);
    e.shot ^= 1;
  }
  const i = nearest(game, e.x, e.y), p = game.players[i];
  if (p && !ghost(e)) {
    e.vx += Math.sign(p.x - e.x) * POE.drift;
    if (e.kind !== 2 && e.kind !== 6) e.vy += Math.sign(p.y - e.y) * POE.drift;
    e.homeX = e.x;
    e.homeY = e.y;
  } else {
    e.vy = 0;
    if (Math.abs(e.x - e.homeX) > POE.homeRange * SUBPX) e.shot = e.x > e.homeX ? 1 : 0;
  }
  e.vx += e.shot ? -POE.sway : POE.sway;
  e.vx = Math.trunc((e.vx * POE.drag) / SUBPX);
  e.vy = Math.trunc((e.vy * POE.drag) / SUBPX);
  e.x += e.vx;
  e.y += e.vy;
  // Its wings: a step every 6 or 3 ticks.
  if (e.frameTimer > 0) e.frameTimer--;
  else {
    e.facing = e.vx < 0 ? "left" : "right";
    e.frameTimer = POE_STEP_TICKS[e.frame]!;
    e.frame = (e.frame + 1) & 7;
  }
}

/** A sword on a ghost Poe: it laughs and fades out (20 ticks). */
export function poeLaugh(e: Enemy): void {
  e.shot2 = 1;
  e.grace = POE.vanishTicks;
}

// --- the Mozo (MOZO; init 0x801675E0, update 0x80166EC4, draw 0x80166BD0): a tuft of grass that hops about ---
// Never minds the Links; hurts by contact (its atcp, hit type 1). Its init sets life 4 (the csv's 8 is overwritten). Set
// up ("rest", at once): a hop in 20 + rand(20) ticks, a puff in 100 + rand(100). Hopping ("walk"): on the ground with
// its hop due, it hops 1 px/tick along a random angle, 5 px/tick up, falling 1 px/tick² (10 ticks, 15 px up), its
// velocity easing half the way (at most 1 px/tick a tick) to that; landed, it slides to a stop and hops again 20 ticks
// later; a wall turns it back. Its puff due, it stops and shakes (an effect only) for 1-3 rounds of its frames 4 ticks
// each ("spit"), then sets up again. Its frames [0, 1, 2, 3, 2, 1] for 12, 8, 8, 12, 8, 8 ticks: gc 157 + frame. Into
// lava (tile type 0x0E) it sinks 45 ticks and goes (a kill, no drop).
export const MOZO = {
  half: 8,
  life: 4,
  hopMin: 20,
  hopSpread: 20,
  puffMin: 100,
  puffSpread: 100,
  hopSpeed: SUBPX,
  hopVz: 5 * SUBPX,
  gravity: SUBPX,
  ease: 5,
  maxEase: SUBPX,
  puffRoundsMin: 1,
  puffRoundsSpread: 3,
  puffStepTicks: 4,
  sinkTicks: 45,
};
export const MOZO_FRAMES: readonly number[] = [0, 1, 2, 3, 2, 1];
export const MOZO_FRAME_TICKS: readonly number[] = [12, 8, 8, 12, 8, 8];

export function initMozo(e: Enemy): void {
  e.life = MOZO.life;
  e.state = "rest";
}

export function stepMozo(game: AdventureGame, e: Enemy, world: World, typeAt: (x: number, y: number) => number): void {
  if (e.frameTimer > 0) e.frameTimer--;
  if (e.timer > 0) e.timer--; // the hop's
  if (e.shot > 0) e.shot--; // the puff's
  e.vx = easeTo(e.vx, e.tvx, MOZO.ease, MOZO.maxEase);
  e.vy = easeTo(e.vy, e.tvy, MOZO.ease, MOZO.maxEase);
  const blocked = moveWalls(e, world);
  e.z += e.vz;
  if (e.state === "hide") {
    if (e.tick >= MOZO.sinkTicks) e.life = -1;
    return;
  }
  if (typeAt(Math.floor(e.x / SUBPX), Math.floor(e.y / SUBPX)) === LAVA_TYPE) {
    e.vx = e.vy = e.vz = e.tvx = e.tvy = 0;
    return setState(e, "hide");
  }
  if (blocked) [e.tvx, e.tvy] = [-e.tvx, -e.tvy];
  if (e.state === "rest") {
    e.frame = Math.trunc(fraction(game) * 5.99);
    e.frameTimer = 0;
    e.timer = MOZO.hopMin + random(game, MOZO.hopSpread);
    e.shot = MOZO.puffMin + random(game, MOZO.puffSpread);
    setState(e, "walk"); // (hopping the same tick)
  }
  if (e.state === "walk") {
    if (e.z > 0) {
      e.vz -= MOZO.gravity;
      e.timer = MOZO.hopMin;
    } else {
      e.z = e.vz = 0;
      if (e.timer === 0) {
        [e.tvx, e.tvy] = along(random(game, 0x10000), MOZO.hopSpeed);
        e.vz = MOZO.hopVz;
      } else if (e.tvx || e.tvy) e.tvx = e.tvy = 0;
      if (e.shot === 0) {
        e.tvx = e.tvy = 0;
        e.frame = 0;
        e.frameTimer = MOZO.puffStepTicks;
        e.shot2 = MOZO.puffRoundsMin + Math.trunc(fraction(game) * (MOZO.puffRoundsSpread - 0.01));
        return setState(e, "spit");
      }
    }
    if (e.frameTimer === 0) {
      e.frame = (e.frame + 1) % MOZO_FRAMES.length;
      e.frameTimer = MOZO_FRAME_TICKS[e.frame]!;
    }
    return;
  }
  // Puffing.
  if (e.z > 0) e.vz -= MOZO.gravity;
  else e.z = e.vz = 0;
  if (e.frameTimer === 0) {
    e.frameTimer = MOZO.puffStepTicks;
    e.frame = (e.frame + 1) % MOZO_FRAMES.length;
    if (e.frame === 0 && --e.shot2 <= 0) setState(e, "rest");
  }
}

// --- the sand crab (PEAC; init 0x80143DD8, update 0x80143914, draw 0x801438D4) ---
// It only walks left and right. Box ±8. Stopped ("rest", first rand(50) ticks), it turns round and walks ("walk") at 1
// px/tick for 20 + rand(100) ticks or to a wall, then stops 20 + rand(50); walking, a Link level with it (within 40 px
// up or down, 200 px across, nothing solid between) makes it charge at 2 px/tick toward him ("chase") for 50 +
// rand(100) ticks or to a wall, then stop rand(50). Hit, it stops 10 ticks. Its legs: gc 26 + a bit toggled every 8
// ticks (2 charging, still when stopped).
export const CRAB = {
  half: 8,
  speed: SUBPX,
  chargeSpeed: 2 * SUBPX,
  firstStop: 50,
  walkMin: 20,
  walkSpread: 100,
  stopMin: 20,
  stopSpread: 50,
  chargeMin: 50,
  chargeSpread: 100,
  chargeStop: 50,
  levelY: 40,
  levelX: 200,
  hitStop: 10,
  legTicks: 8,
  chargeLegTicks: 2,
};

export function initCrab(game: AdventureGame, e: Enemy): void {
  e.facing = random(game, 2) ? "left" : "right";
  e.timer = Math.trunc(fraction(game) * CRAB.firstStop);
  e.state = "rest";
}

export function stepCrab(game: AdventureGame, e: Enemy, world: World, clearLine: (x0: number, y0: number, x1: number, y1: number) => boolean): void {
  if (e.frameTimer > 0) e.frameTimer--;
  if (e.timer > 0) e.timer--;
  e.vy = 0;
  const blocked = moveWalls(e, world);
  switch (e.state) {
    case "rest":
      e.vx = 0;
      e.frameTimer = CRAB.chargeLegTicks;
      if (e.timer > 0) return;
      e.facing = e.facing === "left" ? "right" : "left";
      e.vx = e.facing === "left" ? -CRAB.speed : CRAB.speed;
      e.timer = CRAB.walkMin + random(game, CRAB.walkSpread);
      setState(e, "walk");
      break;
    case "walk": {
      if (blocked || e.timer === 0) {
        e.timer = CRAB.stopMin + random(game, CRAB.stopSpread);
        e.vx = 0;
        setState(e, "rest");
      }
      const p = game.players.find((q, i) => {
        const f = game.battle.fighters[i]!;
        return vulnerable(f) && onGround(f) && Math.abs(q.x - e.x) < CRAB.levelX * SUBPX && Math.abs(q.y - e.y) < CRAB.levelY * SUBPX && clearLine(e.x / SUBPX, e.y / SUBPX, q.x / SUBPX, q.y / SUBPX);
      });
      if (p) {
        e.vx = p.x < e.x ? -CRAB.chargeSpeed : CRAB.chargeSpeed;
        e.timer = CRAB.chargeMin + random(game, CRAB.chargeSpread);
        setState(e, "chase");
      }
      break;
    }
    case "chase":
      if (blocked || e.timer === 0) {
        e.timer = random(game, CRAB.chargeStop);
        e.vx = 0;
        setState(e, "rest");
      }
      break;
  }
  if (e.frameTimer === 0) {
    e.frameTimer = e.state === "chase" ? CRAB.chargeLegTicks : CRAB.legTicks;
    e.frame ^= 1;
  }
}

/** A hit stops a sand crab 10 ticks (after its knockback). */
export function crabHit(e: Enemy): void {
  e.vx = 0;
  e.timer = CRAB.hitStop;
}

// --- the Armos (AMOS; init 0x80142224, update 0x80141064, draw 0x80140E84) ---
// Kind p & 15 (bit 4: a big one, also kinds 3, 4, 5, 7). A statue ("hide": it can't be hurt nor hurts) that wakes —
// kind 2 when its switch (the params' top 5 bits) is on, kinds 0 and 8-15 when a Link comes within 64 px, kind 3 within
// 28 — flickers 60 ticks ("stop"), then hops ("fly") toward the nearest Link: 0.5 px/tick, 2 px/tick up, 0.2 px/tick²
// down (20 ticks a hop, 10 px high), at once again on each landing; contact hurts by its atcp. Kind 3 hops only while
// the nearest Link has his back to it (his facing the way from it to him: guessed) and swords can't hurt it (nor kind
// 5's). Kinds 1, 4, 5 are statues the Links push and pull (not simulated: they stay where they are), 6 and 7 hop along
// RAIL paths (not simulated: they stand). Life 16 (csv). Its look: a small one both2 338 (awake) or 339 (stone), a big
// one gc 1092/1093.
export const ARMOS = {
  half: 7,
  bigHalf: 14,
  doubleHalf: 12,
  wake: 64,
  bigWake: 28,
  wakeTicks: 60,
  hopSpeed: 128, // 0.5 px/tick
  hopVz: 2 * SUBPX,
  gravity: 51, // 0.2 px/tick²
};
const ARMOS_STATUE = new Set([3, 4, 5, 7]);
/** Kinds 3, 4, 5 and 7: the big statue (gc 1092, box x −14…14, y −20…6: here ±14). */
export const armosStatue = (e: Enemy) => ARMOS_STATUE.has(e.kind);
/** Its box's half size: the statue's, a 2× one's (params bit 4: ±12), else ±7 (0x80142224). */
export const armosHalf = (e: Enemy) => (armosStatue(e) ? ARMOS.bigHalf : e.turn === 1 ? ARMOS.doubleHalf : ARMOS.half);
export const armosBig = (e: Enemy) => armosStatue(e) || e.turn === 1;
/** Armos that only stand (pushed statues, rail hoppers: not simulated). */
const ARMOS_STILL = new Set([1, 4, 5, 6, 7]);

export function initArmos(e: Enemy, params: number): void {
  e.kind = params & 15;
  e.turn = (params >>> 4) & 1; // (a big one)
  e.shot = params >>> 27; // its switch
  e.frame = 1; // stone
  e.state = ARMOS_STILL.has(e.kind) ? "rest" : "hide";
}

export function stepArmos(game: AdventureGame, e: Enemy, world: World, switchOn: (n: number) => boolean): void {
  switch (e.state) {
    case "hide": {
      const i = nearest(game, e.x, e.y), p = game.players[i];
      const reach = e.kind === 3 ? ARMOS.bigWake : ARMOS.wake;
      const woken = e.kind === 2 ? switchOn(e.shot) : !!p && Math.hypot((p.x - e.x) / SUBPX, (p.y - e.y) / SUBPX) < reach;
      if (woken) {
        e.timer = ARMOS.wakeTicks;
        setState(e, "stop");
      }
      return;
    }
    case "stop":
      // Flickering between stone and awake.
      e.frame = (e.tick >> 1) & 1;
      if (--e.timer > 0) return;
      e.frame = 0;
      setState(e, "fly");
      return;
    case "fly": {
      moveWalls(e, world);
      e.z += e.vz;
      e.vz -= ARMOS.gravity;
      if (e.z > 0) return;
      e.z = 0;
      const i = nearest(game, e.x, e.y), p = game.players[i];
      // Kind 3 only while the nearest Link turns his back (guessed: his facing the way from it to him).
      if (!p || (e.kind === 3 && p.facing !== facingTo(p.x - e.x, p.y - e.y))) {
        e.vx = e.vy = e.vz = 0;
        return;
      }
      const d = Math.hypot(p.x - e.x, p.y - e.y) || 1;
      e.vx = Math.round((ARMOS.hopSpeed * (p.x - e.x)) / d);
      e.vy = Math.round((ARMOS.hopSpeed * (p.y - e.y)) / d);
      e.vz = ARMOS.hopVz;
      return;
    }
  }
}

/** An Armos can be hurt only hopping, and kinds 3 and 5 never. */
export const armosHurtable = (e: Enemy) => e.state === "fly" && e.kind !== 3 && e.kind !== 5;

// --- the rat (NZMI; init 0x800F43D0, update 0x800F3E08, draw 0x800F3C70) ---
// Params & 1: 1 a bigger rat (drawn 1.2×) that charges. Life 1, box ±8. It pauses ("rest", 50 + rand(50) ticks), then
// runs ("walk") 10 + rand(80) ticks at 2 px/tick along one of the four ways at random, a wall turning it a quarter
// counter-clockwise, then pauses again. Kind 1 running with the nearest Link within 120 px charges ("chase"): faces him
// (his dominant axis), runs on at 2 px/tick re-facing him every so often (its count's bits 0x1111 clear), for 100
// ticks or to a wall; a bite (its contact) makes it run off the same way 100 ticks ("stop"). Contact hurts by its atcp,
// hit type 1 (kind 1: type 4, knocking a Link back 0.75 px/tick with a 4 px hop). Its look: gc 161 + 4 × facing + 2 ×
// stopped + its step (every 4 ticks).
export const RAT = {
  half: 8,
  life: 1,
  speed: 2 * SUBPX,
  pauseMin: 50,
  pauseSpread: 50,
  runMin: 10,
  runSpread: 80,
  charge: 120,
  chargeTicks: 100,
  runOffTicks: 100,
  stepTicks: 4,
};
/** Its direction index → facing (0x80539E68: + 1 = a quarter counter-clockwise). */
export const RAT_TURNS: readonly Facing[] = ["right", "up", "left", "down"];

export function initRat(game: AdventureGame, e: Enemy, params: number): void {
  e.kind = params & 1;
  e.life = RAT.life;
  e.angle = 0; // its direction index
  e.facing = "right";
  e.timer = RAT.pauseMin + Math.trunc(fraction(game) * RAT.pauseSpread);
  e.state = "rest";
}

/** `bit` = a Link bitten (its contact) last tick; its count is kept in `shot`. */
export function stepRat(game: AdventureGame, e: Enemy, world: World, bit: boolean): void {
  if (e.frameTimer > 0) e.frameTimer--;
  else {
    e.frameTimer = RAT.stepTicks;
    e.frame ^= 1;
  }
  const run = () => {
    const [dx, dy] = STEP[e.facing];
    [e.vx, e.vy] = [dx * RAT.speed, dy * RAT.speed];
    const blocked = moveWalls(e, world);
    e.vx = e.vy = 0;
    if (blocked) {
      e.angle = (e.angle + 1) & 3;
      e.facing = RAT_TURNS[e.angle]!;
    }
    return blocked;
  };
  const pause = () => {
    e.shot = 0;
    e.timer = RAT.pauseMin + Math.trunc(fraction(game) * RAT.pauseSpread);
    setState(e, "rest");
  };
  const i = nearest(game, e.x, e.y), p = game.players[i];
  const near = !!p && Math.hypot((p.x - e.x) / SUBPX, (p.y - e.y) / SUBPX) < RAT.charge;
  switch (e.state) {
    case "rest":
      if (--e.timer > 0) return;
      e.timer = RAT.runMin + Math.trunc(fraction(game) * RAT.runSpread);
      e.angle = Math.trunc(fraction(game) * 4);
      e.facing = RAT_TURNS[e.angle]!;
      e.shot = 0;
      return setState(e, "walk");
    case "walk":
    case "stop":
      if (e.state === "walk" && e.kind === 1 && near) {
        e.facing = facingTo(p!.x - e.x, p!.y - e.y);
        e.angle = RAT_TURNS.indexOf(e.facing);
        e.shot = 0;
        return setState(e, "chase");
      }
      run();
      if (++e.shot >= e.timer) pause();
      return;
    case "chase": {
      if ((e.shot & 0x1111) === 0 && near) {
        e.facing = facingTo(p!.x - e.x, p!.y - e.y);
        e.angle = RAT_TURNS.indexOf(e.facing);
      }
      const blocked = run();
      if (bit) {
        e.shot = 0;
        e.timer = RAT.runOffTicks;
        return setState(e, "stop");
      }
      if (++e.shot >= RAT.chargeTicks || blocked) pause();
      return;
    }
  }
}
