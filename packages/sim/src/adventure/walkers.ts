// The snake (ROPE), the Zol (ZASL) and the shelled beetle (PAME), read from main.dol (not traced: no savestate reaches
// their stages but Lake Hylia's Zol, which lies under a rock: rocks.ts heldUnderRocks). In main.dol they're the same
// kind of actor (as ARIJ, BMST, BOIT, FALL, ICHL, KEPO, MIRA, TNDR, the ZSLx Shadow Links… 29 types): one update for
// all of them (0x801CDD58) that calls the type's own methods from its vtable, a state (+0x248), the ticks in it
// (+0x24C, counting up: `tick`), its length (+0x250: `timer`), a speed (+0x254: `speed`) eased toward a target speed
// (+0x258: `tvx`), a facing (+0x98) and a frame player (+0x270: its time in `frameTimer`, the frame in `frame`).
// Records and the common rules are enemies.ts's; velocities 1/256 px per tick.
//
// A tick of one of them (0x801CDD58), when nothing hits it:
// - its speed eases toward its target speed, by 0.1 px/tick when speeding up (+0x25C) and 0.2 px/tick when slowing
//   down (+0x260) (the base constructor 0x801D0F40's values; none of the three changes them);
// - its velocity is its facing × its speed (0x801CE4E8; the Zol's: a heading × its speed), z falls 0.2 px/tick² (at
//   most 4 px/tick; 0x801CE594); it moves (0x801CE120) and lands at z 0 (or bounces: PAME turning over);
// - walls stop it (0x801F2618, its ±8 px wall box): that's the "wall hit" its own step gets;
// - it hurts a Link it touches by its atcp, hit type 1 (0x801CE928: 0x801F2B7C(actor, atcp, -1, 1));
// - its state's count goes up (0x801CE0A4), then its own step runs (vtable +0x90) and its frames (+0x94).
// While it's knocked back (0x801F3D94) none of that runs: it carries on in its state, its count where it was, after.
// Box ±8 px (the base init 0x801D0ED0), a random facing. A new way to walk (0x801CF6B8): one of the four at random, or,
// that way blocked 14 px ahead (0x801CFCF0 / 0x801CFD68: the strip of its width from its middle, on an 8 px grid,
// against tiles and the rocks' boxes, and on the screen), another (0x801CF720: one of the other three at random; that
// blocked too, one of the two left at random, 0x801CF798, and that blocked, the last one).
// Not simulated: the hop every one of them makes when a Link's ground impact lands near it (a hammer's pound, a boots
// crash: 0x801A4FB4; no impacts in the sim), side views, the room's kill memory (stage +0x3548).
import { onGround, vulnerable } from "../combat.ts";
import { cos4096, sin4096, TRIG_ONE, velocityAlong } from "../entities.ts";
import { angleTo } from "../hazards.ts";
import { moveAxis, SUBPX, type Facing } from "../player.ts";
import { isSolidAt, type World } from "../world.ts";
import { nextRandom, type AdventureGame } from "./adventure.ts";
import type { Enemy, EnemyState } from "./enemies.ts";

const random = (game: AdventureGame, n: number) => nextRandom(game.adventure) % n;
/** The game's facing numbers: 0 right, 1 left, 2 down, 3 up. */
const FACINGS: readonly Facing[] = ["right", "left", "down", "up"];
const STEP: Readonly<Record<Facing, readonly [number, number]>> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
const OPPOSITE: Readonly<Record<Facing, Facing>> = { right: "left", left: "right", down: "up", up: "down" };
/** A facing's heading (sim angle; the game's table 0x8053F800). */
const HEADING: Readonly<Record<Facing, number>> = { right: 0, down: 0x4000, left: 0x8000, up: 0xc000 };

/** The types this file steps. */
export const WALKERS: readonly string[] = ["ROPE", "ZASL", "PAME"];

export const WALKER = {
  half: 8,
  /** Speeding up, slowing down (1/256 px per tick, per tick). */
  accel: 26, // 0.1 px/tick²
  decel: 51, // 0.2 px/tick²
  gravity: 51, // 0.2 px/tick²
  maxFall: 4 * SUBPX,
  /** How far past its box a step's way must be clear (0x801CFCF0). */
  aheadClear: 6,
};

function setState(e: Enemy, state: EnemyState): void {
  e.state = state;
  e.tick = 0;
}

/** Whether the way `dist` px from (x, y) along `facing` is blocked for a ±`half` px body (0x801CFD68). */
export function wayBlocked(world: World, x: number, y: number, facing: Facing, dist: number, half = WALKER.half): boolean {
  const [dx, dy] = STEP[facing];
  const px = Math.floor(x / SUBPX), py = Math.floor(y / SUBPX);
  const left = dx ? Math.min(px, px + dx * dist) : px - half, right = dx ? Math.max(px, px + dx * dist) : px + half;
  const top = dy ? Math.min(py, py + dy * dist) : py - half, bottom = dy ? Math.max(py, py + dy * dist) : py + half;
  if (left < 0 || top < 0 || right >= world.widthCells * 8 || bottom >= world.heightCells * 8) return true;
  for (let gy = top; ; gy = Math.min(bottom, gy + 8)) {
    for (let gx = left; ; gx = Math.min(right, gx + 8)) {
      if (isSolidAt(world, gx, gy)) return true;
      if (gx === right) break;
    }
    if (gy === bottom) break;
  }
  return false;
}

const stepBlocked = (world: World, e: Enemy, facing: Facing, half: number) => wayBlocked(world, e.x, e.y, facing, WALKER.aheadClear + half, half);

/** A new way to walk (0x801CF6B8). */
function pickWay(game: AdventureGame, world: World, e: Enemy, half = WALKER.half): Facing {
  const f = FACINGS[random(game, 4)]!;
  return stepBlocked(world, e, f, half) ? anotherWay(game, world, e, f, half) : f;
}

/** Another way than `from` (0x801CF720, 0x801CF798). */
function anotherWay(game: AdventureGame, world: World, e: Enemy, from: Facing, half = WALKER.half): Facing {
  const others = FACINGS.filter((g) => g !== from);
  const f = others[random(game, others.length)]!;
  if (!stepBlocked(world, e, f, half)) return f;
  const left = others.filter((g) => g !== f);
  const k = random(game, 2);
  return stepBlocked(world, e, left[k]!, half) ? left[1 - k]! : left[k]!;
}

/**
 * Its tick's move: its speed eased, its velocity its facing (or `angle`, or `velocity`) × its speed, z falling (landing
 * at 0, or `land`); then the walls. True when a wall stopped it.
 */
function walkerMove(e: Enemy, world: World, how: { angle?: number; velocity?: readonly [number, number]; land?: (e: Enemy) => void } = {}): boolean {
  const d = e.tvx - e.speed;
  e.speed += d > 0 ? Math.min(d, WALKER.accel) : -Math.min(-d, WALKER.decel);
  if (how.velocity) [e.vx, e.vy] = how.velocity;
  else if (how.angle !== undefined) [e.vx, e.vy] = [Math.trunc((e.speed * cos4096(how.angle)) / TRIG_ONE), Math.trunc((e.speed * sin4096(how.angle)) / TRIG_ONE)];
  else [e.vx, e.vy] = [STEP[e.facing][0] * e.speed, STEP[e.facing][1] * e.speed];
  e.vz = Math.max(-WALKER.maxFall, e.vz - WALKER.gravity);
  const x0 = e.x, y0 = e.y;
  moveAxis(e, world, e.vx, "x");
  moveAxis(e, world, e.vy, "y");
  const blocked = (e.vx !== 0 && e.x - x0 !== e.vx) || (e.vy !== 0 && e.y - y0 !== e.vy);
  e.z += e.vz;
  if (e.z <= 0) {
    if (how.land) how.land(e);
    else e.z = e.vz = 0;
  }
  return blocked;
}

/** Link `i` is there for it to go for (0x801D0B44: in play, on its screen). TODO(measure): the game's test. */
function linkThere(game: AdventureGame, i: number): boolean {
  const f = game.battle.fighters[i];
  return !!f && vulnerable(f) && onGround(f);
}

// Frames (the frame player +0x270: 0x801D1C18, 0x801D22DC, 0x801D1D60): a sequence of [frame, ticks]; its time (in
// 1/256 tick) goes up by its rate each tick and wraps round (loop mode 2), showing the frame whose span holds it; it
// starts at a random time (rand(length + 1) whole ticks, the length itself counting as 0).
export type Sequence = readonly (readonly [number, number])[];
const lengthOf = (seq: Sequence) => seq.reduce((n, [, t]) => n + t, 0) * SUBPX;

function frameAt(seq: Sequence, t: number): number {
  let start = 0;
  for (const [frame, ticks] of seq) {
    if (t < start + ticks * SUBPX) return frame;
    start += ticks * SUBPX;
  }
  return seq[0]![0];
}

function randomTime(game: AdventureGame, seq: Sequence): number {
  const n = lengthOf(seq) / SUBPX, r = random(game, n + 1);
  return r === n ? 0 : r * SUBPX;
}

function stepFrames(e: Enemy, seq: Sequence, rate = SUBPX): void {
  e.frameTimer = (e.frameTimer + rate) % lengthOf(seq);
  e.frame = frameAt(seq, e.frameTimer);
}

// Knocked back: its state and count are kept in `flags`' top bits (16-19 the state, 20-31 the count; the low 16 bits
// stay the type's own flags) and given back after (enemies.ts hurtEnemy and stepKnock).
const STATES: readonly EnemyState[] = ["walk", "spit", "fly", "rest", "stop", "chase", "hide", "knock", "die", "patrol", "turn", "look", "notice"];

export function walkerKnocked(e: Enemy): void {
  if (e.state === "knock") return;
  e.flags = ((e.flags & 0xffff) | (STATES.indexOf(e.state) << 16) | (Math.min(e.tick, 0xfff) << 20)) >>> 0;
}

/** The state it was in before its knockback (and its count). */
export function walkerAfterKnock(e: Enemy): EnemyState {
  const state = STATES[(e.flags >>> 16) & 15] ?? "rest";
  const tick = e.flags >>> 20;
  e.flags &= 0xffff;
  e.tick = tick;
  return state;
}

// --- the snake (ROPE; ctor 0x801B7DE0, init 0x801B7D34, its step 0x801B78DC, frames 0x801B7854, draw 0x801B7814) ---
// Placed in the Eastern Temple (boss023 room 1), the Pyramid (boss063 room 8) and the Cloud Citadel (boss082 rooms
// 10-13), params 0 (not read); GEN3 kind 17 makes one. enemyparam.csv: life 8, atcp 2, dasu 4. It rests ("rest", its
// target speed 0) 40 + rand(61) ticks at first, then walks ("walk") 60 + rand(41) ticks at 0.4 px/tick a new way, a wall
// sending it another way (+10 ticks); a walk over, 35 times in 100 it rests 40 + rand(61), else walks a new way. After
// 30 ticks or more resting or walking, a Link in line with it (within 10 px of its column, or else its row), 10-120 px
// off with nothing solid in the ±8 px strip between them, makes it face him and dash ("chase") at 1.5 px/tick for
// 60 + rand(41) ticks (the nearest such Link; a wall turns it another way, +10 ticks), then walk on the same way.
// One made in the air falls ("fly") and rests once down. Look: enemy_gc_sob 181 + 2 × its facing + its step, 10 ticks a
// frame, stepped 1 + 2 × clamp((speed − 0.4) / 1.1, 0, 1) times as fast (×1 walking, ×3 dashing).
export const ROPE = {
  restMin: 40,
  restSpread: 61,
  walkMin: 60,
  walkSpread: 41,
  restIn100: 35,
  wallMore: 10,
  walkSpeed: 102, // 0.4 px/tick
  dashSpeed: 384, // 1.5 px/tick
  dashMin: 60,
  dashSpread: 41,
  dashAfter: 30,
  lineUp: 10,
  dashNear: 10,
  dashFar: 120,
};
/** Its frames by facing (enemy_gc_sob 181 + these; sequences 0x804A3A58). */
export const ROPE_FRAMES: Readonly<Record<Facing, Sequence>> = { right: [[0, 10], [1, 10]], left: [[2, 10], [3, 10]], down: [[4, 10], [5, 10]], up: [[6, 10], [7, 10]] };

export function initRope(game: AdventureGame, e: Enemy): void {
  e.facing = FACINGS[random(game, 4)]!;
  e.speed = e.tvx = 0;
  e.state = e.z > 0 ? "fly" : "rest";
  e.timer = e.z > 0 ? -1 : ROPE.restMin + random(game, ROPE.restSpread);
  e.frameTimer = randomTime(game, ROPE_FRAMES[e.facing]);
}

function ropeRest(game: AdventureGame, e: Enemy): void {
  e.timer = ROPE.restMin + random(game, ROPE.restSpread);
  e.tvx = 0;
  setState(e, "rest");
}

function ropeWalk(game: AdventureGame, world: World, e: Enemy, newWay: boolean): void {
  e.timer = ROPE.walkMin + random(game, ROPE.walkSpread);
  e.tvx = ROPE.walkSpeed;
  if (newWay) e.facing = pickWay(game, world, e);
  setState(e, "walk");
}

/** The way to the nearest Link in line with it, clear between, or null. */
function dashWay(game: AdventureGame, world: World, e: Enemy): Facing | null {
  let way: Facing | null = null, best = ROPE.dashFar * ROPE.dashFar;
  game.players.forEach((p, i) => {
    if (!linkThere(game, i)) return;
    const dx = Math.floor((p.x - e.x) / SUBPX), dy = Math.floor((p.y - e.y) / SUBPX), d2 = dx * dx + dy * dy;
    if (d2 <= ROPE.dashNear * ROPE.dashNear || d2 >= best) return;
    let f: Facing, dist: number;
    if (Math.abs(dx) <= ROPE.lineUp) [f, dist] = [dy > 0 ? "down" : "up", Math.abs(dy)];
    else if (Math.abs(dy) <= ROPE.lineUp) [f, dist] = [dx > 0 ? "right" : "left", Math.abs(dx)];
    else return;
    if (wayBlocked(world, e.x, e.y, f, dist)) return;
    [way, best] = [f, d2];
  });
  return way;
}

export function stepRope(game: AdventureGame, e: Enemy, world: World): void {
  const wall = walkerMove(e, world);
  if ((e.state === "rest" || e.state === "walk") && e.tick >= ROPE.dashAfter) {
    const way = dashWay(game, world, e);
    if (way) {
      e.timer = ROPE.dashMin + random(game, ROPE.dashSpread);
      e.tvx = ROPE.dashSpeed;
      e.facing = way;
      setState(e, "chase");
    }
  }
  switch (e.state) {
    case "rest":
      if (e.tick >= e.timer) ropeWalk(game, world, e, true);
      break;
    case "walk":
    case "chase":
      if (wall) {
        e.facing = anotherWay(game, world, e, e.facing);
        e.timer += ROPE.wallMore;
      } else if (e.tick >= e.timer) {
        if (e.state === "walk" && random(game, 100) < ROPE.restIn100) ropeRest(game, e);
        else ropeWalk(game, world, e, e.state === "walk");
      }
      break;
    case "fly":
      if (e.tick > 1 && e.z <= 0) ropeRest(game, e);
      break;
  }
  const over = Math.max(0, Math.min(ROPE.dashSpeed - ROPE.walkSpeed, e.speed - ROPE.walkSpeed));
  stepFrames(e, ROPE_FRAMES[e.facing], SUBPX + Math.trunc((2 * SUBPX * over) / (ROPE.dashSpeed - ROPE.walkSpeed)));
}

// --- the Zol (ZASL; ctor 0x8020CA34, init 0x8020C878, its step 0x8020C3D0, draw 0x8020C138) ---
// Placed in Lake Hylia (room 4, under a two-Link rock: rocks.ts) and the Tower of Winds (boss073 rooms 0 and 15); GEN3
// kind 32 makes them. enemyparam.csv: life 1, atcp 1, dasu 3. It doesn't split and never hops by itself. Params bit 0:
// kind 1 (none placed). Kind 0 rests 40 + rand(61) ticks, then moves at 0.4 px/tick 60 + rand(41) ticks a new way (a
// wall: another, +10 ticks); a move over, 35 in 100 it rests, else moves again. Kind 1 slides at 0.125 px/tick while a
// Link is on its screen, headed from him + 0x8000 (away, as read: TODO(measure)), its Link looked at again every 90
// ticks; it goes at its init if its spot is solid (not simulated: none placed). Look: enemy_gc_sob 713 + [4, 7, 8, 7]
// for 6, 4, 6, 4 ticks, from a random point, palette 2 drawn as 4 (a blue slime: TODO(measure) in Dolphin).
export const ZOL = {
  restMin: 40,
  restSpread: 61,
  moveMin: 60,
  moveSpread: 41,
  restIn100: 35,
  wallMore: 10,
  speed: 102, // 0.4 px/tick
  slideSpeed: 32, // 0.125 px/tick
  retarget: 90,
};
export const ZOL_FRAMES: Sequence = [[4, 6], [7, 4], [8, 6], [7, 4]];
export const ZOL_PALETTES: Readonly<Record<number, number>> = { 2: 4 };

export function initZol(game: AdventureGame, e: Enemy, params: number): void {
  e.kind = params & 1;
  e.facing = FACINGS[random(game, 4)]!;
  e.angle = HEADING[e.facing];
  e.shot = -1; // kind 1's Link (+0x2A8)
  e.shot2 = 0; // ticks before it looks again (+0x2AC)
  e.speed = e.tvx = 0;
  e.timer = ZOL.restMin + random(game, ZOL.restSpread);
  e.state = "rest";
  e.frameTimer = randomTime(game, ZOL_FRAMES);
}

function zolRest(game: AdventureGame, e: Enemy): void {
  e.timer = ZOL.restMin + random(game, ZOL.restSpread);
  e.tvx = 0;
  e.shot = -1;
  e.shot2 = 0;
  setState(e, "rest");
}

function zolMove(game: AdventureGame, world: World, e: Enemy): void {
  e.timer = ZOL.moveMin + random(game, ZOL.moveSpread);
  e.tvx = ZOL.speed;
  e.shot = -1;
  e.shot2 = 0;
  e.facing = pickWay(game, world, e);
  e.angle = HEADING[e.facing];
  setState(e, "walk");
}

export function stepZol(game: AdventureGame, e: Enemy, world: World): void {
  const wall = walkerMove(e, world, { angle: e.angle });
  if (e.kind === 1) {
    let i = -1, bestD = Infinity;
    game.players.forEach((p, k) => {
      const d = Math.hypot(p.x - e.x, p.y - e.y);
      if (linkThere(game, k) && d < bestD) [i, bestD] = [k, d];
    });
    if (e.state === "chase") {
      if (i < 0) zolRest(game, e);
      else if (e.shot2 > 0) e.shot2--;
      else if (e.shot !== i) [e.shot, e.shot2] = [i, ZOL.retarget];
    } else if (i >= 0) {
      [e.shot, e.shot2] = [i, ZOL.retarget];
      e.tvx = ZOL.slideSpeed;
      setState(e, "chase");
    }
  }
  switch (e.state) {
    case "rest":
      if (e.tick >= e.timer) zolMove(game, world, e);
      break;
    case "walk":
      if (wall) {
        e.facing = anotherWay(game, world, e, e.facing);
        e.timer += ZOL.wallMore;
      } else if (e.tick >= e.timer) {
        if (random(game, 100) < ZOL.restIn100) zolRest(game, e);
        else zolMove(game, world, e);
      }
      e.angle = HEADING[e.facing];
      break;
    case "chase": {
      const p = game.players[e.shot];
      if (p) e.angle = (angleTo(e.x, e.y, p.x, p.y) + 0x8000) & 0xffff;
      break;
    }
  }
  stepFrames(e, ZOL_FRAMES);
}

// --- the shelled beetle (PAME; ctor 0x801B94C8, init 0x801B9378, its step 0x801B8C98, its states' set-up 0x801B91A8,
// its frames 0x801B8C08, velocity 0x801B89DC, struck 0x801B8518, other hits 0x801B87DC, contact 0x801B83F4, death
// 0x801B82E8, draw 0x801B8150) ---
// A beetle in a gold shell that has to be turned over (a Terrorpin). Placed in Tingle's Towers (boss022 room 2, boss032
// room 9), the Temple of Darkness (boss053 room 54) and Frozen Hyrule (boss070 rooms 3, 4, 27, 29); GEN3 kinds 9 and
// 38-42. enemyparam.csv: life 8, atcp 2, dasu 7. Params bit 0 a big one (drawn 1.4×, box ±11.2 px, life 8; a small
// one's is 1); (p >> 1) & 7 = 1-4: it belongs to player 1-4 (palette 8 drawn as 2 + player; only his impacts turn it
// over; a big one he kills leaves two red Force Gems).
// - "walk": 0.35 px/tick for 30 + rand(16) ticks a new way (out of a hop back up it keeps its facing), a wall: another
//   way (+10 ticks).
// - turned over ("turn") by a Link's hammer pound or ground impact (not simulated: flipPame is the hook): it hops back
//   (its facing reversed) at 0.6 px/tick, 3 px/tick up (big 2), bouncing where it lands (z and vz × −0.6, its speed
//   × 0.6, until |vz| < 0.1), then lies on its back ("rest") 400 + rand(101) ticks, shakes ("stop") 30 + rand(11)
//   (frames twice as fast), hops back up ("fly") and walks. A hop is over once it's down, or after 120 ticks.
// - kicked (a small one walking struck by a Link's attack): it slides on its back away from him ("chase") at 2.5
//   px/tick, 2 px/tick up, for 540 ticks (never slower than 1.8, slowing to 0 over its last 30), off walls and off the
//   Links it runs into, hurting them (and knocking 100 worth of Force Gems out of each: not simulated); then on its back.
// - upright (walking, hopping back up, or the first 10 ticks of turning over or a slide) nothing hurts it: a sword on a
//   big one clanks off; on its back everything does (a small one dies at once). Its contact hurts upright or sliding;
//   on its back it only blocks Links (not simulated).
// Look: enemy_gc_sob 189 + [0, 1] upright, [2, 3] on its back, 10 ticks each (a new sequence from its first frame).
export const PAME = {
  half: 8,
  bigHalf: 11, // ±8 × 1.4
  bigScale: 1.4,
  smallLife: 1,
  walkSpeed: 90, // 0.35 px/tick
  walkMin: 30,
  walkSpread: 16,
  wallMore: 10,
  hopSpeed: 154, // 0.6 px/tick
  hopVz: 3 * SUBPX,
  bigHopVz: 2 * SUBPX,
  hopMaxTicks: 120,
  bounceStop: 26, // 0.1 px/tick
  backMin: 400,
  backSpread: 101,
  shakeMin: 30,
  shakeSpread: 11,
  slideSpeed: 640, // 2.5 px/tick
  slideMinSpeed: 461, // 1.8 px/tick
  slideVz: 2 * SUBPX,
  slideTicks: 540,
  slideSlowTicks: 30,
  uprightTicks: 10,
  deathGemType: 2,
};
export const PAME_UPRIGHT: Sequence = [[0, 10], [1, 10]];
export const PAME_BACK: Sequence = [[2, 10], [3, 10]];
/** `flags` bit 0: a big one; `kind` = its Link + 1 (0 none). */
export const PAME_BIG = 1;
export const pameBig = (e: Enemy) => (e.flags & PAME_BIG) !== 0;
const onBack = (e: Enemy) => e.state === "turn" || e.state === "rest" || e.state === "stop" || e.state === "chase";
const seqOf = (e: Enemy) => (onBack(e) ? PAME_BACK : PAME_UPRIGHT);

export function initPame(game: AdventureGame, e: Enemy, params: number): void {
  e.facing = FACINGS[random(game, 4)]!;
  if (params & 1) e.flags |= PAME_BIG;
  const owner = (params >>> 1) & 7;
  e.kind = owner >= 1 && owner <= 4 ? owner : 0;
  if (!pameBig(e)) e.life = PAME.smallLife;
  e.state = "walk";
  e.timer = PAME.walkMin + random(game, PAME.walkSpread);
  e.speed = e.tvx = PAME.walkSpeed;
  e.frameTimer = randomTime(game, PAME_UPRIGHT);
}

function setPame(game: AdventureGame, world: World, e: Enemy, state: EnemyState): void {
  const seq = seqOf(e), from = e.state;
  switch (state) {
    case "walk":
      e.timer = PAME.walkMin + random(game, PAME.walkSpread);
      e.tvx = PAME.walkSpeed;
      if (from !== "fly") e.facing = pickWay(game, world, e, pameBig(e) ? PAME.bigHalf : PAME.half);
      break;
    case "turn":
    case "fly":
      e.timer = -1;
      e.facing = OPPOSITE[e.facing];
      e.speed = e.tvx = PAME.hopSpeed;
      e.vz = pameBig(e) ? PAME.bigHopVz : PAME.hopVz;
      break;
    case "rest":
      e.timer = PAME.backMin + random(game, PAME.backSpread);
      e.tvx = 0;
      break;
    case "stop":
      e.timer = PAME.shakeMin + random(game, PAME.shakeSpread);
      e.tvx = 0;
      break;
    case "chase":
      e.timer = PAME.slideTicks;
      e.facing = OPPOSITE[e.facing];
      e.speed = e.tvx = PAME.slideSpeed;
      e.vz = PAME.slideVz;
      break;
  }
  setState(e, state);
  if (seqOf(e) !== seq) e.frameTimer = 0;
}

function bounce(e: Enemy): void {
  e.z = -Math.trunc((e.z * 3) / 5);
  e.vz = -Math.trunc((e.vz * 3) / 5);
  e.speed = Math.trunc((e.speed * 3) / 5);
  e.tvx = Math.trunc((e.tvx * 3) / 5);
  if (Math.abs(e.vz) < PAME.bounceStop) e.z = e.vz = 0;
}

function slideVelocity(e: Enemy): readonly [number, number] {
  const left = e.timer - e.tick;
  if (left > 0 && left < PAME.slideSlowTicks) return [e.vx - Math.trunc(e.vx / left), e.vy - Math.trunc(e.vy / left)];
  if (e.vx * e.vx + e.vy * e.vy >= PAME.slideMinSpeed * PAME.slideMinSpeed) return [e.vx, e.vy];
  return e.vx || e.vy ? velocityAlong(e.vx, e.vy, PAME.slideMinSpeed) : [0, PAME.slideMinSpeed];
}

/** `hitLinks`: the Links its contact hit last tick (a bit each), for a slide's bounces off them. */
export function stepPame(game: AdventureGame, e: Enemy, world: World, hitLinks: number): void {
  const sliding = e.state === "chase";
  const x0 = e.x, y0 = e.y;
  const wall = walkerMove(e, world, { ...(sliding ? { velocity: slideVelocity(e) } : {}), ...(e.state === "turn" ? { land: bounce } : {}) });
  switch (e.state) {
    case "walk":
      if (wall) {
        e.facing = anotherWay(game, world, e, e.facing, pameBig(e) ? PAME.bigHalf : PAME.half);
        e.timer += PAME.wallMore;
      } else if (e.tick >= e.timer) setPame(game, world, e, "walk");
      break;
    case "turn":
    case "fly":
      if ((e.tick > 1 && e.z <= 0 && e.vz === 0) || e.tick >= PAME.hopMaxTicks) {
        e.z = e.vz = 0;
        setPame(game, world, e, e.state === "turn" ? "rest" : "walk");
      }
      break;
    case "rest":
      if (e.tick >= e.timer) setPame(game, world, e, "stop");
      break;
    case "stop":
      if (e.tick >= e.timer) setPame(game, world, e, "fly");
      break;
    case "chase":
      if (wall) {
        // Off the wall: the blocked axis turned back. TODO(measure): 0x801CC350's reflection.
        if (e.vx && e.x !== x0 + e.vx) e.vx = -e.vx;
        if (e.vy && e.y !== y0 + e.vy) e.vy = -e.vy;
      } else if (hitLinks) {
        // Off the first Link it ran into, mirrored about the way from him to it.
        const p = game.players[31 - Math.clz32(hitLinks & -hitLinks)]!;
        const [nx, ny] = velocityAlong(e.x - p.x, e.y - p.y, SUBPX);
        const dot = Math.trunc((e.vx * nx + e.vy * ny) / SUBPX);
        if (dot < 0) [e.vx, e.vy] = [e.vx - Math.trunc((2 * dot * nx) / SUBPX), e.vy - Math.trunc((2 * dot * ny) / SUBPX)];
      }
      if (e.tick >= e.timer) {
        e.z = e.vz = e.speed = 0;
        setPame(game, world, e, "rest");
      }
      break;
  }
  stepFrames(e, seqOf(e), e.state === "stop" ? 2 * SUBPX : SUBPX);
}

/** A hammer pound or a ground impact by Link `i` (0x801B8908): none in the sim yet. */
export function flipPame(game: AdventureGame, world: World, e: Enemy, i: number): void {
  if (e.z > 0 || (e.kind && e.kind - 1 !== i)) return;
  if (e.state === "walk") setPame(game, world, e, "turn");
  else if (e.state === "rest" || e.state === "stop" || e.state === "chase") setPame(game, world, e, "fly");
}

/** Upright for hits: walking, hopping back up, or turning over or sliding in their first 10 ticks. */
export const pameUpright = (e: Enemy) => e.state === "walk" || e.state === "fly" || ((e.state === "turn" || e.state === "chase") && e.tick < PAME.uprightTicks);

/** Link `i`'s sword meets it: true when it's hurt; upright a small walking one is kicked away from him instead. */
export function pameStruck(game: AdventureGame, world: World, e: Enemy, i: number): boolean {
  if (!pameUpright(e)) return true;
  if (!pameBig(e) && e.state === "walk") {
    const p = game.players[i]!;
    setPame(game, world, e, "chase");
    [e.vx, e.vy] = velocityAlong(e.x - p.x, e.y - p.y, PAME.slideSpeed);
    if (!e.vx && !e.vy) e.vy = PAME.slideSpeed;
  }
  return false;
}

/** Its contact hurts only upright or sliding. */
export const pameHarms = (e: Enemy) => e.state === "walk" || e.state === "fly" || e.state === "chase";

/** A big coloured one killed by its own Link leaves two red Force Gems (0x801B82E8; thrown ±1.5 px/tick sideways in
 *  the game: here 12 px apart). */
export function pameDeathGems(e: Enemy, drop: (x: number, y: number, type: number) => void): void {
  if (!pameBig(e) || !e.kind || e.kind - 1 !== e.hitBy) return;
  for (const s of [1, -1]) drop(e.x + s * 12 * SUBPX, e.y, PAME.deathGemType);
}
