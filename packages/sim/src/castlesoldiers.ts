// Hyrule Castle's bow soldiers (SLR2), captain (SLR4) and ball-and-chain soldier (SLR3) in Shadow Battle. The castle's
// GEN3 spawners make them when their switch rises (switches.ts: kind 0x08 an archer, params 0; kind 0x1D a captain, params
// 0x1008800; kind 0x15 a ball-and-chain soldier), reached by the arena's random soldier picks (docs/BACKLOG.md B2 "What
// the arenas hold"). The archers' and captain's rules are the adventure's (read from main.dol, traced in Lake Hylia and
// Hyrule Castle: adventure/soldiers.ts uses the constants below), here on the battle's entities, its seeded generator
// and integer math; not traced in battle. Struck, they take twice the Link's share of the attack as the sword soldiers
// do and are knocked away like them (strike.ts strikeEntity).
//
// What the battle leaves out (assumed): the captain's group. The battle's sword soldiers keep no group, so the captain
// has no followers: he marches on his orders (gather: away from the nearest Link; attack: at him) and chases after his
// first lunge; the archers (group 0) never gather nor flee their captain's loss. The bush archers and bomb throwers
// (SLR2 kinds 2 and 3) aren't in the arenas.
//
// Its SLR3 ball-and-chain soldier (GEN3 kind 0x15, params 0): its rules were read from main.dol (below;
// docs/measurements/battle-constants.md "Hazards"), its walk traced in the adventure's Hyrule Castle (adventure/soldiers.ts
// uses the constants and helpers below). Its ball is no entity of its own here: the soldier's fields say where it is
// (`ballOf`).
//
// Fields (Entity's kind-specific ones):
// - "bowSoldier": phase "rest" walking, "look" looking round, "chase" closing in, "shoot", "stun" knocked; `timer` its
//   walk's or look's ticks left, `param` its approach speed (1/256 px a tick), `homeX` the ticks to its next shot (or its
//   cool-down), `homeY` its engagement's ticks left, `angle` the ticks it stands after a wall turned it.
// - "captain": phase "rest" marching, "chase", "active" winding up, "lunge", "hold", "stun"; `timer` his order's leg
//   (or the hold), `param` his order (CAPTAIN_ORDER), `homeX` his cool-down, `homeY` his params (kind, legs), `angle` his heading.
// - "soldierArrow": an archer's arrow, `tick` its age.
// - "ballSoldier": phase "chase" walking at a Link, "rest" with none; `angle` its ball's swing, `param` its swing speed,
//   `homeX` its chain's length (1/256 px), `timer` its reel-in after a hit.
import type { BattleState } from "./battle.ts";
import { AWAY, BLOCK_PUSH_SPEED, hurtFighter, KNOCK_HARD, SLIDE_SCALE, stopActing, type Fighter, type Knock } from "./combat.ts";
import { boxAround, boxesOverlap, cos4096, distance2, FACING_STEP, isqrt, randomInt, removeEntity, setPhase, sin4096, spawnEntity, TRIG_ONE, velocityAlong, type Entity } from "./entities.ts";
import type { GameState } from "./game.ts";
import { angleTo, nearestTarget, touching } from "./hazards.ts";
import { moveAxis, SUBPX, type Facing } from "./player.ts";
import { screenAt } from "./siderooms.ts";
import { DEBRIS, DEBRIS_TICKS, SOLDIER_STUN_DECAY, SOLDIER_STUN_TICKS } from "./strike.ts";
import { isSolidAt, surfaceAt, type World } from "./world.ts";

// --- the bow soldier (SLR2; init 0x80157FB0, update 0x80155B44, draw 0x801555D8) ---
// Kind p & 0xFF: 0-1 archers, 2 bomb throwers, 3 hid in a bush (tile type 0x21: an archer once the bush is gone); its
// life 12 (table 0x8049FDC8); (p >> 16) & 0xFF = 1 faster (base speed 1.4, not 0.7). An archer walks ("walk") at its
// base speed, a wall turning it (the game's facing + 1) and standing it 8 ticks, its legs 50 + rand(50) ticks; then
// looks round ("rest": 60 ticks a round, 1-2 rounds) and walks off a quarter-turn either way. A Link in the quadrant it
// faces within 100 px (its cool-down over) is noticed: an engagement of 250 + rand(250) ticks, its first shot in 70 +
// rand(10 × (instance & 7)), then it steers ("chase", at 1.5 × base + rand(0.2), easing 0.3, at most 1 px/tick a tick)
// to the point 70 px from him on its own side, in line with him (a wall turns that point a quarter round him), and
// shoots ("spit", 39 ticks; the arrow on the 16th: OKTM kind 1 at 3 px/tick along its facing, through walls its first 5
// ticks); again until its engagement is over, then walks (a cool-down of 30 + rand(instance & 7)). Its captain gone,
// it flees ("stop": 1.5 px/tick away from the Link, 150 + rand(100) ticks). A bomb thrower turns every 15 ticks and
// throws a lit bomb (HBMB) at (1.4 + rand) px/tick ahead, 3 px/tick up, at a Link it faces within 100 px, every 90
// ticks. A bush archer rises when a Link comes within 80 px and shoots volleys of three arrows 50 ticks apart, sinking
// again when he's beyond 100 (hidden it can't be hurt; it's never knocked back). Sprites: gc 79 + its frame (walk: right
// 0, 1, 0, 2, left 8…, down 16…, up 24…; shooting: right 0, 3, 4, 5…); a bomb thrower gc 276 + frame.
export const BOWMAN = {
  half: 8,
  life: 12,
  baseSpeed: 0.7,
  fastSpeed: 1.4,
  ease: 3,
  maxEase: SUBPX,
  legMin: 50,
  legSpread: 50,
  bumpTicks: 8,
  bumpLeg: 10,
  lookTicks: 15,
  notice: 100,
  engageMin: 250,
  engageSpread: 250,
  firstShot: 70,
  ring: 70,
  arrive: 2,
  shootTicks: 39,
  arrowTick: 16,
  arrowSpeed: 3 * SUBPX,
  arrowThrough: 5,
  arrowTicks: 300,
  coolMin: 30,
  fleeSpeed: 384, // 1.5 px/tick
  fleeMin: 150,
  fleeSpread: 100,
  bombTurn: 15,
  bombEvery: 90,
  bombSpeed: 1.4,
  bombVz: 3 * SUBPX,
  wake: 80,
  sink: 100,
  volleyGap: 50,
};
export const BOWMAN_WALK: readonly (readonly number[])[] = [[0, 1, 0, 2], [8, 9, 8, 10], [16, 17, 16, 18], [24, 25, 24, 26]];
export const BOWMAN_WALK_TICKS: readonly number[] = [6, 8, 6, 8];
export const BOWMAN_SHOOT: readonly (readonly number[])[] = [[0, 3, 4, 5], [8, 11, 12, 13], [16, 19, 20, 21], [24, 27, 28, 29]];
export const BOWMAN_LOOK: readonly (readonly number[])[] = [[0, 6, 0, 7], [8, 14, 8, 15], [16, 22, 16, 23], [24, 30, 24, 31]];
/** Where its arrow appears (px from it, by its facing). */
export const ARROW_FROM: Readonly<Record<Facing, readonly [number, number]>> = { right: [2, -4], left: [-2, -4], down: [-2, 0], up: [2, -10] };
/** The bow soldier's sprites: enemy_gc_sob 79 + its frame. */
export const BOWMAN_FRAME = 79;

// --- the captain (SLR4; init 0x80174B44, update 0x80172DC4, its spear: the second SLR4 it spawns) ---
// Kind p & 0xFF (life (12, 12, 20, 20, 25, 25)[kind] × 2: room 9's read 24); its group p >> 24; its orders' legs
// ((p >> 12) & 15) × 20 ticks (attack) and ((p >> 8) & 15) × 20 (gather), 0 = 200 + rand(200). It marches ("walk") at
// 0.9 px/tick, re-aimed every 10 ticks: at the nearest Link under the attack order, straight away from him under the
// gather order (traced: room 9's back and forth, its soldiers closing on it), flipping the order at the end of each
// leg; with no soldier of its group left it chases ("chase": re-aimed every 40 ticks at 1.1 px/tick). A Link within 80
// px with its cool-down over: a wind-up ("stop", 47 ticks), then a lunge ("fly") along its facing at 13 px/tick, 1 less
// each tick, hurting 4 (hit type 3) as it goes, a 70-tick hold ("spit"; kinds other than 0-1: 42) and a 120-tick
// cool-down. Its shield: a sword from the Link it faces is blocked (no harm; it's pushed back). Its spear (kept by it,
// not a record here) hurts a Link touching the box ahead of it by its atcp 3 (4, type 3, lunging). Its soldiers'
// group: kind 1 captains take them with them when they die. Sprites gc 550 + frame (march: right 0, 1, 0, 2; left 3…;
// down 6…; up 9…; the lunge: right 33, 32, 33, 34, 35, 36…).
export const CAPTAIN = {
  half: 12,
  life: [12, 12, 20, 20, 25, 25] as readonly number[],
  legUnit: 20,
  legMin: 200,
  legSpread: 200,
  march: 230, // 0.9 px/tick
  marchAim: 10,
  chase: 282, // 1.1 px/tick
  chaseAim: 40,
  reach: 80,
  windupTicks: 47,
  lungeSpeed: 13 * SUBPX,
  lungeSlow: SUBPX,
  holdTicks: 70,
  shortHold: 42,
  cooldown: 120,
  lungeDamage: 4,
};
/** The spear's box ahead of the captain (offset px by facing, half sizes): 0x804A0AD8, 0x804A0B10. */
export const SPEAR: Readonly<Record<Facing, readonly [number, number, number, number]>> = { right: [16, -7, 8, 4], left: [-22, -7, 8, 4], down: [-12, 8, 4, 8], up: [12, -24, 4, 8] };
export const CAPTAIN_MARCH: readonly (readonly number[])[] = [[0, 1, 0, 2], [3, 4, 3, 5], [6, 7, 6, 8], [9, 10, 9, 11]];
export const CAPTAIN_MARCH_TICKS: readonly number[] = [8, 12, 8, 12];
export const CAPTAIN_LUNGE: readonly (readonly number[])[] = [[33, 32, 33, 34, 35, 36], [38, 37, 38, 39, 40, 41], [43, 42, 43, 44, 45, 46], [49, 47, 48, 49, 50, 51]];
/** The captain's sprites: enemy_gc_sob 550 + its frame. */
export const CAPTAIN_FRAME = 550;
/** Captain orders: attack (march at the Links), gather (march away; the group closes on him). */
export const CAPTAIN_ORDER = { attack: 0, gather: 1 } as const;

// --- the ball-and-chain soldier (SLR3; init 0x80171AF8, update 0x80170450, draw 0x80170008; its ball a second SLR3) ---
// Kind p & 0xFF (GEN3 0x15's params 0: kind 0); life 32 (enemyparam.csv; 16 alone in some stages, 24 in the
// adventure's Hyrule Castle: neither is battle). Its ball is an SLR3 of kind 5 it spawns and places every tick (life
// 10000: it can't be hurt): at its hand (by its walk frame: table 0x804A07F8) + the chain's length × (cos, sin) of its
// swing angle, 16 px up; the angle turns 400 units a tick (a turn in 164 ticks), the length eases 0.7 of the way (at
// most 3 px a tick) to 70 px, or to 10 reeled in. The ball hurts a Link it touches (±8 px) by 2, hit type 3 (6 px/tick
// knockback); the soldier's body by its atcp 2, type 1. It walks at the nearest Link (0x801EEC98: no range, any Link on
// its screen) at 0.3 px/tick, its velocity easing 0.3 of the way (at most 1 px/tick a tick); with no Link it stands
// and reels the ball in. Struck (the shared sword hit 0x801F2FAC: 16 px/tick away, then eased back to its walk), it
// reels the ball in for 30 ticks and swings 1.9 × faster (twice at most: 400, 760, 1444). A sword meeting the ball
// clanks (0x80237948: a hit type 14 of 0 on the Link, from the ball: pushed 2 px/tick away, the sword recoiling; effects
// 279, 280). Sprites gc 127 + its walk frame (0, 1, 2), the chain's ten links gc 131 at 0.7 (from its hand to the ball,
// a tenth apart), the ball gc 130 at 1.5, turning 0.2 rad a tick.
export const BALL_SOLDIER = {
  half: 8,
  life: 32,
  walk: 77, // 0.3 px/tick
  ease: 3,
  maxEase: SUBPX,
  spin: 400,
  spinUp: 19, // /10
  spinMax: 1444, // after two speed-ups
  reach: 70 * SUBPX,
  reeled: 10 * SUBPX,
  reelEase: 7,
  reelMax: 3 * SUBPX,
  reelTicks: 30,
  knock: 16 * SUBPX,
  ballHalf: 8,
  ballHeight: 16,
  links: 10,
  ballDamage: 2,
};
/** The ball's knockback: hit type 3 (main.dol's hit table: 6 px/tick, the 3.0 hop up to 4 damage). TODO(measure) */
export const BALL_KNOCK: Knock = { speed: 6 * SUBPX, hop: 768 };
/** Its walk: frames 1, 2, 1, 0 for 2, 10, 10, 10 ticks (tables 0x804A07D8, 0x804A07E8). */
export const BALL_SOLDIER_WALK: readonly number[] = [1, 2, 1, 0];
export const BALL_SOLDIER_WALK_TICKS: readonly number[] = [2, 10, 10, 10];
/** Its hand (px from it) by its walk frame: where the chain starts. */
export const BALL_HAND: readonly (readonly [number, number])[] = [[-8, 1], [-9, 2], [-9, 4]];
/** The ball-and-chain soldier's sprites: enemy_gc_sob 127 + its walk frame; the ball 130, a chain link 131. */
export const BALL_SOLDIER_FRAME = 127;
export const BALL_FRAME = 130;
export const CHAIN_FRAME = 131;
export const CHAIN_SCALE = 0.7;
export const BALL_SCALE = 1.5;
export const BALL_TURN = 0.2; // rad a tick (TODO(measure): which way)

/** enemyparam.csv's atcp: an archer's body 2 (SLR2), its arrow 2 (OKTM), the captain's body and spear 3 (SLR4). */
export const BOWMAN_DAMAGE = 2;
export const SOLDIER_ARROW_DAMAGE = 2;
export const CAPTAIN_DAMAGE = 3;
/** The ball-and-chain soldier's body: its atcp 2 (SLR3), hit type 1. */
export const BALL_SOLDIER_DAMAGE = 2;
/** An arrow's box: ±2 px (OKTM kind 1, as a Stalfos's bone). */
export const SOLDIER_ARROW_HALF = 2;

/** The game's facing numbers: 0 right, 1 left, 2 down, 3 up. */
const FACINGS: readonly Facing[] = ["right", "left", "down", "up"];
const facingTo = (dx: number, dy: number): Facing => (Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "down" : "up");
const along = (angle: number, speed: number): [number, number] => [Math.trunc((speed * cos4096(angle)) / TRIG_ONE), Math.trunc((speed * sin4096(angle)) / TRIG_ONE)];
/** The low 3 bits of its id: the game's instance number in its random spreads. */
const instance = (e: Entity) => e.id & 7;
/** rand(n × fraction): the adventure's `n × rand(256) / 256`, truncated. */
const scaled = (b: BattleState, n: number) => Math.trunc((n * randomInt(b, 256)) / 256);
const NEAREST = 1024;

/** `v` eased `ease`/10 of the way to `target`, by at most `max`; at least 1/256 px. */
function easeTo(v: number, target: number, ease: number, max: number): number {
  const d = target - v, step = Math.trunc((d * ease) / 10) || Math.sign(d);
  return v + Math.max(-max, Math.min(max, step));
}

/**
 * Moves it by its velocity, a pit ahead stopping it as a wall does (as the sword soldiers). True when it was stopped.
 * With `half`, against the walls with its own square wall box (the captain's, SOLDIER_WALL_BOX), else as a Link.
 */
function moveBlocked(e: Entity, world: World, half = 0): boolean {
  const x0 = e.x, y0 = e.y;
  const ahead = (v: number) => Math.sign(v) * 6;
  const move = (v: number, axis: "x" | "y") => (half ? moveInBox(e, world, half, v, axis) : moveAxis(e, world, v, axis));
  if (e.vx && surfaceAt(world, Math.floor((e.x + e.vx) / SUBPX) + ahead(e.vx), Math.floor(e.y / SUBPX)) !== "pit") move(e.vx, "x");
  if (e.vy && surfaceAt(world, Math.floor(e.x / SUBPX), Math.floor((e.y + e.vy) / SUBPX) + ahead(e.vy)) !== "pit") move(e.vy, "y");
  return (e.vx !== 0 && e.x - x0 !== e.vx) || (e.vy !== 0 && e.y - y0 !== e.vy);
}

// The soldiers' wall boxes (+0x80..+0x8C, square: SLR1 ±8 from its init 0x80153AA4, SLR4 ±10; traced in the adventure's
// room 9, docs/measurements/adventure-enemies.md "Adventure: the sword soldiers": they stop 8 and 10 px off the fence).
// The battle's sword soldiers and captain are the same actors.
/** Half the wall box (px) of a sword soldier and a captain. */
export const SOLDIER_WALL_BOX = { SLR1: 8, SLR4: 10 } as const;

/** Is a square box (half size px, its bottom and right edges exclusive) at (x, y) (1/256 px) in a wall along the side
 *  leading along `axis` in direction `dir` (sampled every 8 px)? */
export function boxSideHits(world: World, x: number, y: number, half: number, axis: "x" | "y", dir: number): boolean {
  const h = half * SUBPX, edge = (dir > 0 ? h - 1 : -h) + (axis === "x" ? x : y);
  const across = axis === "x" ? y : x;
  for (let o = -h; ; o = Math.min(o + 8 * SUBPX, h - 1)) {
    const a = Math.floor(edge / SUBPX), b = Math.floor((across + o) / SUBPX);
    if (axis === "x" ? isSolidAt(world, a, b) : isSolidAt(world, b, a)) return true;
    if (o === h - 1) return false;
  }
}

/** Moves `e` along one axis against the walls with its square wall box (half size px), in steps of at most 4 px (no wall
 *  is thinner than 8 px), a step into a wall backed off 0.5 px at a time; true when a wall stopped it. */
export function moveInBox(e: { x: number; y: number }, world: World, half: number, delta: number, axis: "x" | "y"): boolean {
  const dir = Math.sign(delta), n = Math.ceil(Math.abs(delta) / (4 * SUBPX));
  for (let k = 1, done = 0; k <= n; k++) {
    const step = Math.round((delta * k) / n) - done, from = e[axis];
    done += step;
    e[axis] += step;
    while (Math.sign(e[axis] - from) === dir && boxSideHits(world, e.x, e.y, half, axis, dir)) e[axis] -= dir * (SUBPX / 2);
    if (Math.sign(e[axis] - from) !== dir) e[axis] = from;
    if (e[axis] - from !== step) return true;
  }
  return false;
}

/** A new bow soldier's fields (SLR2 init: a random facing, walking). */
export function newBowSoldier(b: BattleState, params: number): Partial<Entity> {
  const speed = bowSpeed(params);
  return {
    hp: BOWMAN.life,
    facing: FACINGS[randomInt(b, 4)]!,
    param: ((3 * speed) >> 1) + Math.trunc(randomInt(b, 256) / 5), // its approach speed: 1.5 × base + rand(0.2) px
    timer: BOWMAN.legMin + randomInt(b, BOWMAN.legSpread),
    homeX: 0,
    homeY: 0,
    angle: 0,
  };
}
const bowSpeed = (params: number) => Math.round((((params >>> 16) & 0xff) === 1 ? BOWMAN.fastSpeed : BOWMAN.baseSpeed) * SUBPX);

/** A new captain's fields (SLR4 init: life 2 × its kind's, the gather order first, a random facing). */
export function newCaptain(b: BattleState, params: number): Partial<Entity> {
  const kind = params & 0xff;
  return {
    hp: 2 * (CAPTAIN.life[kind] ?? CAPTAIN.life[0]!),
    param: CAPTAIN_ORDER.gather, // (it flips to attack at its first leg's end: traced, Lake Hylia's room 9 marched away first)
    timer: legOf(b, (params >>> 8) & 15),
    facing: kind === 2 || kind === 3 ? "up" : FACINGS[randomInt(b, 4)]!,
    homeX: 0,
    homeY: params >>> 0,
    angle: 0,
  };
}
const legOf = (b: BattleState, nibble: number) => (nibble ? nibble * CAPTAIN.legUnit : CAPTAIN.legMin + randomInt(b, CAPTAIN.legSpread));

/** One tick of a bow soldier. */
export function stepBowSoldier(state: GameState, e: Entity, world: World): void {
  const b = state.battle!;
  e.tick++;
  if (e.homeX > 0) e.homeX--; // the cool-down or the next shot's delay
  if (e.homeY > 0) e.homeY--; // the engagement
  if (e.phase === "stun") {
    if (!stepStun(e, world)) return;
    // Back at him: chasing, engaged for a while yet (the adventure's knock).
    e.homeY = Math.max(e.homeY, BOWMAN.engageMin);
    e.homeX = Math.max(e.homeX, BOWMAN.firstShot);
    setPhase(e, "chase");
  }
  const i = nearestTarget(state, e.x, e.y, NEAREST), p = state.players[i];
  const near = !!p && distance2(p.x, p.y, e.x, e.y) < BOWMAN.notice * BOWMAN.notice;
  const notices = () => !!p && e.homeX === 0 && near && facingTo(p.x - e.x, p.y - e.y) === e.facing;
  switch (e.phase) {
    case "rest": {
      // Walking; a wall turns it and stands it a while.
      if (e.angle > 0) {
        e.angle--;
        e.vx = e.vy = 0;
      } else {
        const [dx, dy] = FACING_STEP[e.facing], speed = bowSpeed(0); // (the arenas' archers: params 0, the base speed)
        [e.vx, e.vy] = [dx * speed, dy * speed];
        if (moveBlocked(e, world)) {
          e.facing = FACINGS[(FACINGS.indexOf(e.facing) + 1) & 3]!;
          e.vx = e.vy = 0;
          e.timer = Math.max(e.timer, BOWMAN.bumpLeg);
          e.angle = BOWMAN.bumpTicks;
          setPhase(e, "rest");
        }
      }
      if (notices()) return notice(b, e, p!);
      if (--e.timer <= 0) {
        e.vx = e.vy = 0;
        e.timer = (1 + randomInt(b, 2)) * 4 * BOWMAN.lookTicks;
        setPhase(e, "look");
      }
      return;
    }
    case "look":
      // Looking round (1-2 rounds), then off a quarter-turn either way.
      e.vx = e.vy = 0;
      if (notices()) return notice(b, e, p!);
      if (--e.timer <= 0) {
        let k = FACINGS.indexOf(e.facing) ^ 2;
        if (randomInt(b, 2)) k ^= 1;
        e.facing = FACINGS[k]!;
        e.timer = BOWMAN.legMin + randomInt(b, BOWMAN.legSpread);
        setPhase(e, "rest");
      }
      return;
    case "chase": {
      // To the point 70 px from him, in line with him, on its own side.
      if (!p) {
        e.vx = e.vy = 0;
        e.timer = BOWMAN.legMin;
        return setPhase(e, "rest");
      }
      const [ox, oy] = FACING_STEP[e.facing];
      const tx = p.x - ox * BOWMAN.ring * SUBPX, ty = p.y - oy * BOWMAN.ring * SUBPX;
      const [vx, vy] = velocityAlong(tx - e.x, ty - e.y, e.param);
      e.vx = easeTo(e.vx, vx, BOWMAN.ease, BOWMAN.maxEase);
      e.vy = easeTo(e.vy, vy, BOWMAN.ease, BOWMAN.maxEase);
      // A wall turns the point a quarter round him.
      if (moveBlocked(e, world)) e.facing = FACINGS[[2, 3, 1, 0][FACINGS.indexOf(e.facing)]!]!;
      else e.facing = facingTo(p.x - e.x, p.y - e.y);
      const dx = tx - e.x, dy = ty - e.y;
      if (isqrt(dx * dx + dy * dy) <= BOWMAN.arrive * SUBPX || e.homeX === 0) {
        e.vx = e.vy = 0;
        setPhase(e, "shoot");
      }
      return;
    }
    case "shoot":
      e.vx = e.vy = 0;
      if (e.tick === BOWMAN.arrowTick) {
        const [dx, dy] = FACING_STEP[e.facing], [fx, fy] = ARROW_FROM[e.facing];
        spawnEntity(b, "soldierArrow", e.x + fx * SUBPX, e.y + fy * SUBPX, { phase: "flying", facing: e.facing, vx: dx * BOWMAN.arrowSpeed, vy: dy * BOWMAN.arrowSpeed });
      }
      if (e.tick < BOWMAN.shootTicks) return;
      if (e.homeY === 0) {
        e.homeX = BOWMAN.coolMin + randomInt(b, instance(e) + 1);
        e.timer = BOWMAN.legMin + randomInt(b, BOWMAN.legSpread);
        return setPhase(e, "rest");
      }
      e.homeX = BOWMAN.firstShot + scaled(b, 70 * instance(e));
      return setPhase(e, "chase");
  }
}

function notice(b: BattleState, e: Entity, p: { x: number; y: number }): void {
  e.homeY = BOWMAN.engageMin + randomInt(b, BOWMAN.engageSpread);
  e.homeX = BOWMAN.firstShot + scaled(b, 10 * instance(e));
  e.facing = facingTo(p.x - e.x, p.y - e.y);
  setPhase(e, "chase");
}

/** Knocked away (strike.ts), slowing as the sword soldiers do; true on the tick it's over. */
function stepStun(e: Entity, world: World): boolean {
  e.vx = Math.trunc((e.vx * SOLDIER_STUN_DECAY) / 100);
  e.vy = Math.trunc((e.vy * SOLDIER_STUN_DECAY) / 100);
  moveAxis(e, world, e.vx, "x");
  moveAxis(e, world, e.vy, "y");
  if (e.tick < SOLDIER_STUN_TICKS) return false;
  e.vx = e.vy = 0;
  return true;
}

/** One tick of a captain. */
export function stepCaptain(state: GameState, e: Entity, world: World): void {
  const b = state.battle!;
  e.tick++;
  if (e.homeX > 0) e.homeX--;
  if (e.phase === "stun") {
    if (!stepStun(e, world)) return;
    setPhase(e, "rest"); // (marching on: the adventure's knock)
  }
  const i = nearestTarget(state, e.x, e.y, NEAREST), p = state.players[i];
  const kind = e.homeY & 0xff;
  switch (e.phase) {
    case "rest":
    case "chase": {
      if (p && distance2(p.x, p.y, e.x, e.y) < CAPTAIN.reach * CAPTAIN.reach && e.homeX === 0) {
        e.facing = facingTo(p.x - e.x, p.y - e.y);
        e.vx = e.vy = 0;
        return setPhase(e, "active");
      }
      const marching = e.phase === "rest";
      if (marching && --e.timer <= 0) {
        e.param = e.param === CAPTAIN_ORDER.attack ? CAPTAIN_ORDER.gather : CAPTAIN_ORDER.attack;
        e.timer = legOf(b, (e.homeY >>> (e.param === CAPTAIN_ORDER.attack ? 12 : 8)) & 15);
      }
      if (e.tick % (marching ? CAPTAIN.marchAim : CAPTAIN.chaseAim) === 1 && p) {
        const toward = angleTo(e.x, e.y, p.x, p.y);
        e.angle = marching && e.param === CAPTAIN_ORDER.gather ? (toward + 0x8000) & 0xffff : toward;
      }
      [e.vx, e.vy] = along(e.angle, marching ? CAPTAIN.march : CAPTAIN.chase);
      moveBlocked(e, world, SOLDIER_WALL_BOX.SLR4);
      if (e.vx || e.vy) e.facing = facingTo(e.vx, e.vy);
      return;
    }
    case "active":
      // The wind-up, then the lunge along his facing.
      if (e.tick < CAPTAIN.windupTicks) return;
      [e.vx, e.vy] = FACING_STEP[e.facing].map((d) => d * CAPTAIN.lungeSpeed) as [number, number];
      return setPhase(e, "lunge");
    case "lunge": {
      moveBlocked(e, world, SOLDIER_WALL_BOX.SLR4);
      const slow = (v: number) => (v > 0 ? Math.max(0, v - CAPTAIN.lungeSlow) : Math.min(0, v + CAPTAIN.lungeSlow));
      [e.vx, e.vy] = [slow(e.vx), slow(e.vy)];
      if (e.vx || e.vy) return;
      e.timer = kind <= 1 ? CAPTAIN.holdTicks : CAPTAIN.shortHold;
      return setPhase(e, "hold");
    }
    case "hold":
      if (--e.timer > 0) return;
      e.homeX = CAPTAIN.cooldown;
      // (No followers in battle: he chases from now on.)
      return setPhase(e, "chase");
  }
}

/** Does the captain's shield stop a sword from (x, y)? He faces that way, and isn't lunging or holding. */
export const shieldStops = (e: Entity, x: number, y: number) => e.phase !== "lunge" && e.phase !== "hold" && e.phase !== "stun" && facingTo(x - e.x, y - e.y) === e.facing;

/** The captain's spear's box (px). */
export function spearBox(e: Entity): { left: number; top: number; right: number; bottom: number } {
  const [dx, dy, hx, hy] = SPEAR[e.facing];
  const x = Math.floor(e.x / SUBPX) + dx, y = Math.floor(e.y / SUBPX) + dy;
  return { left: x - hx, top: y - hy, right: x + hx - 1, bottom: y + hy - 1 };
}

/**
 * The bow soldiers' and captains' harm, after they moved: a Link touching an archer takes its atcp (hit type 1); the
 * captain's body and spear his (the spear blockable), 4 lunging (hit type 3). Not while knocked away.
 */
export function soldierContact(state: GameState, e: Entity): void {
  const b = state.battle!;
  if (e.phase === "stun") return;
  const hurt = (i: number, damage: number, blockable: boolean, hard: boolean) => {
    const hit = hurtFighter(state.players[i]!, b.fighters[i]!, i, damage, e.x, e.y, { cause: "soldier", ...(blockable ? { blockable } : {}), ...(hard ? { knock: KNOCK_HARD } : {}) });
    if (hit) b.hits.push(hit);
  };
  if (e.kind === "bowSoldier") {
    for (const i of touching(state, boxAround(e.x, e.y, BOWMAN.half))) hurt(i, BOWMAN_DAMAGE, false, false);
    return;
  }
  const lunge = e.phase === "lunge";
  const spear = spearBox(e);
  for (const i of touching(state, spear)) hurt(i, lunge ? CAPTAIN.lungeDamage : CAPTAIN_DAMAGE, true, lunge);
  for (const i of touching(state, boxAround(e.x, e.y, CAPTAIN.half))) hurt(i, lunge ? CAPTAIN.lungeDamage : CAPTAIN_DAMAGE, false, lunge);
}

/**
 * An archer's arrow: straight on at 3 px a tick, through walls its first 5 ticks, gone at a wall after that or after
 * 300 ticks; a Link it meets takes 2 (blockable: a shield facing it stops it, as the Links' arrows) and it's gone.
 */
export function stepSoldierArrow(state: GameState, e: Entity, world: World): void {
  const b = state.battle!;
  e.tick++;
  e.x += e.vx;
  e.y += e.vy;
  const solid = isSolidAt(world, Math.floor(e.x / SUBPX), Math.floor(e.y / SUBPX)) && e.tick > BOWMAN.arrowThrough;
  if (solid || e.tick > BOWMAN.arrowTicks) return removeEntity(e);
  const box = boxAround(e.x, e.y, SOLDIER_ARROW_HALF);
  const victim = touching(state, box)[0];
  if (victim === undefined) return;
  const hit = hurtFighter(state.players[victim]!, b.fighters[victim]!, victim, SOLDIER_ARROW_DAMAGE, e.x, e.y, { cause: "arrow", blockable: true });
  if (hit) b.hits.push(hit);
  removeEntity(e);
}

/** A new ball-and-chain soldier's fields (SLR3 init: its ball at its hand, swinging out). */
export function newBallSoldier(): Partial<Entity> {
  return { hp: BALL_SOLDIER.life, param: BALL_SOLDIER.spin, angle: 0, homeX: 0, homeY: 0, timer: 0 };
}

/** Its walk frame (0-2): stepping while it has a Link to walk at, the first frame standing. */
export function ballSoldierFrame(e: Entity): number {
  return e.phase === "chase" ? ballWalkFrame(e.tick) : 0;
}

/** Its walk frame (0-2) `tick` ticks into its walk (the adventure's SLR3 too). */
export function ballWalkFrame(tick: number): number {
  const ticks = BALL_SOLDIER_WALK_TICKS;
  let r = Math.max(0, tick - 1) % ticks.reduce((a, n) => a + n, 0), k = 0;
  while (r >= ticks[k]!) r -= ticks[k++]!;
  return BALL_SOLDIER_WALK[k]!;
}

/** Where the chain starts (1/256 px) for a soldier at (x, y) in walk frame `frame`. */
export function ballHandAt(x: number, y: number, frame: number): [number, number] {
  const [hx, hy] = BALL_HAND[frame]!;
  return [x + hx * SUBPX, y + hy * SUBPX];
}

/** The ball's ground position (1/256 px) at the end of a chain `length` long from `hand`, swung to `angle`. */
export function ballAt(hand: readonly [number, number], angle: number, length: number): [number, number] {
  const [dx, dy] = along(angle, length);
  return [hand[0] + dx, hand[1] + dy];
}

/** Where its chain starts (1/256 px). */
export function ballHand(e: Entity): [number, number] {
  return ballHandAt(e.x, e.y, ballSoldierFrame(e));
}

/** Its ball's ground position (1/256 px; drawn BALL_SOLDIER.ballHeight px up). */
export function ballOf(e: Entity): [number, number] {
  return ballAt(ballHand(e), e.angle, e.homeX);
}

/** Whether a ball-and-chain soldier walks at this Link (0x801EEC98): alive, not falling or away, invincible or not. */
export const ballSoldierSees = (f: Fighter) => f.hearts > 0 && f.mode !== "dying" && f.mode !== "dead" && f.mode !== "falling" && !AWAY.has(f.move);

/** The nearest Link it walks at (0x801EEC98): one it sees, on its screen, at any distance; -1 if none. */
function ballTarget(state: GameState, e: Entity): number {
  const b = state.battle!;
  let best = -1, bestD = Infinity;
  state.players.forEach((p, i) => {
    const f = b.fighters[i]!;
    if (!ballSoldierSees(f) || screenAt(p.y) !== screenAt(e.y)) return;
    const d = distance2(p.x, p.y, e.x, e.y);
    if (d < bestD) (best = i), (bestD = d);
  });
  return best;
}

/**
 * One tick of a ball-and-chain soldier. Phases: "chase" walking at the nearest Link, "rest" standing with no Link to
 * walk at. `angle` its swing, `param` its swing speed, `homeX` the chain's length (1/256 px), `timer` its reel-in after a
 * hit (it can't be struck meanwhile: TODO(measure), main.dol keeps a per-Link mask for a while).
 */
export function stepBallSoldier(state: GameState, e: Entity, world: World): void {
  e.tick++;
  if (e.timer > 0) e.timer--;
  const i = ballTarget(state, e), p = state.players[i];
  if (!p) {
    if (e.phase !== "rest") setPhase(e, "rest");
  } else if (e.phase !== "chase") setPhase(e, "chase");
  // Its velocity eases to its walk (a knock from a strike eases off the same way), then it moves.
  const [tx, ty] = p ? along(angleTo(e.x, e.y, p.x, p.y), BALL_SOLDIER.walk) : [0, 0];
  e.vx = easeTo(e.vx, tx, BALL_SOLDIER.ease, BALL_SOLDIER.maxEase);
  e.vy = easeTo(e.vy, ty, BALL_SOLDIER.ease, BALL_SOLDIER.maxEase);
  moveBlocked(e, world);
  // The ball swings round; the chain lets out (or is reeled in).
  e.angle = (e.angle + e.param) & 0xffff;
  const reach = e.phase === "rest" || e.timer > 0 ? BALL_SOLDIER.reeled : BALL_SOLDIER.reach;
  e.homeX = easeTo(e.homeX, reach, BALL_SOLDIER.reelEase, BALL_SOLDIER.reelMax);
}

/**
 * Struck (strike.ts): twice the Link's share off its life, knocked 16 px/tick away from (x, y), the ball reeled in for
 * 30 ticks and swung faster; dead at 0. True when it reacted.
 */
export function strikeBallSoldier(b: BattleState, e: Entity, damage: number, x: number, y: number): boolean {
  if (e.timer > 0) return true;
  e.hp -= 2 * Math.max(1, damage);
  if (e.hp <= 0) {
    removeEntity(e);
    spawnEntity(b, "debris", e.x, e.y, { param: DEBRIS.soldier, timer: DEBRIS_TICKS });
    return true;
  }
  let [kx, ky] = velocityAlong(e.x - x, e.y - y, BALL_SOLDIER.knock);
  if (!kx && !ky) ky = BALL_SOLDIER.knock; // (struck from its own spot)
  e.vx += kx;
  e.vy += ky;
  if (e.phase === "chase" && e.param < BALL_SOLDIER.spinMax) e.param = Math.trunc((e.param * BALL_SOLDIER.spinUp) / 10);
  e.timer = BALL_SOLDIER.reelTicks;
  return true;
}

/**
 * A Link's sword meeting a ball (its ±8 px box): it clanks (no harm either way), the Link recoils and is pushed 2 px/tick
 * away from the ball. True when it did (his sword strikes nothing else that tick: assumed).
 */
export function ballClanks(state: GameState, i: number, sword: { left: number; top: number; right: number; bottom: number }): boolean {
  const b = state.battle!;
  for (const e of b.entities) {
    if (e.kind !== "ballSoldier" || e.hp <= 0) continue;
    const [bx, by] = ballOf(e);
    if (!boxesOverlap(sword, boxAround(bx, by, BALL_SOLDIER.ballHalf))) continue;
    const p = state.players[i]!, f = b.fighters[i]!;
    f.endCharge = 0;
    stopActing(p);
    p.action = "tink";
    [f.slideX, f.slideY] = velocityAlong(p.x - bx, p.y - by, BLOCK_PUSH_SPEED * SLIDE_SCALE);
    return true;
  }
  return false;
}

/** The ball-and-chain soldier's harm, after it moved: its ball 2 (hit type 3), its body 2 (type 1). */
export function ballSoldierContact(state: GameState, e: Entity): void {
  const b = state.battle!;
  const [bx, by] = ballOf(e);
  for (const i of touching(state, boxAround(bx, by, BALL_SOLDIER.ballHalf))) {
    const hit = hurtFighter(state.players[i]!, b.fighters[i]!, i, BALL_SOLDIER.ballDamage, bx, by, { cause: "soldier", knock: BALL_KNOCK });
    if (hit) b.hits.push(hit);
  }
  for (const i of touching(state, boxAround(e.x, e.y, BALL_SOLDIER.half))) {
    const hit = hurtFighter(state.players[i]!, b.fighters[i]!, i, BALL_SOLDIER_DAMAGE, e.x, e.y, { cause: "soldier" });
    if (hit) b.hits.push(hit);
  }
}

/** Kinds of this module (strike.ts strikes them, the CPUs swat them). */
export const CASTLE_SOLDIERS: ReadonlySet<string> = new Set(["bowSoldier", "captain", "ballSoldier"]);
