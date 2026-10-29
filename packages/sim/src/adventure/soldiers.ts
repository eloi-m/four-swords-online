// The soldiers: the sword soldiers (SLR1), the bow soldiers (SLR2), the captains (SLR4) and the ball-and-chain soldier
// (SLR3), and the orders a captain
// gives the soldiers of its group, read from main.dol and traced in Lake Hylia (room 5's ambush, room 9's captain and
// his group: docs/measurements/adventure-enemies.md "Adventure: generators, kills and drops", "Adventure: the soldiers"). A soldier's
// params' top byte names its captain's group (the captain's own top byte), not a rail. Records and the common rules are
// enemies.ts's; velocities 1/256 px per tick.
import { BOMB_FUSE } from "../bombs.ts";
import { ARROW_FROM, BALL_SOLDIER, ballAt, ballHandAt, ballSoldierSees, ballWalkFrame, boxSideHits, BOWMAN, BOWMAN_WALK_TICKS, CAPTAIN, CAPTAIN_MARCH_TICKS, moveInBox, SOLDIER_WALL_BOX, SPEAR } from "../castlesoldiers.ts";
import { cos4096, sin4096, spawnEntity, TRIG_ONE, velocityAlong } from "../entities.ts";
import { angleTo } from "../hazards.ts";
import { BLOCK_PUSH_SPEED, onGround, SLIDE_SCALE, stopActing, vulnerable } from "../combat.ts";
import { moveAxis, SUBPX, type Facing } from "../player.ts";
import { isSolidAt, ROOM_H, ROOM_W, surfaceAt, type World } from "../world.ts";
import { nextRandom, type AdventureGame } from "./adventure.ts";
import type { Enemy, EnemyState } from "./enemies.ts";
import type { AdventureStage } from "./stage.ts";

export { BALL_FRAME, BALL_SCALE, BALL_SOLDIER, BALL_SOLDIER_FRAME, BALL_TURN, BOWMAN, BOWMAN_LOOK, BOWMAN_SHOOT, BOWMAN_WALK, BOWMAN_WALK_TICKS, CAPTAIN, CAPTAIN_LUNGE, CAPTAIN_MARCH, CAPTAIN_MARCH_TICKS, CHAIN_FRAME, CHAIN_SCALE, SPEAR } from "../castlesoldiers.ts";

const random = (game: AdventureGame, n: number) => nextRandom(game.adventure) % n;
const fraction = (game: AdventureGame) => random(game, 256) / 256;
const STEP: Readonly<Record<Facing, readonly [number, number]>> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
/** The game's facing numbers: 0 right, 1 left, 2 down, 3 up. */
const FACINGS: readonly Facing[] = ["right", "left", "down", "up"];
const facingTo = (dx: number, dy: number): Facing => (Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "down" : "up");
const along = (angle: number, speed: number): [number, number] => [Math.trunc((speed * cos4096(angle)) / TRIG_ONE), Math.trunc((speed * sin4096(angle)) / TRIG_ONE)];

function setState(e: Enemy, state: EnemyState): void {
  e.state = state;
  e.tick = 0;
}

/** `v` eased `ease`/10 of the way to `target`, by at most `max`; at least 1/256 px. */
function easeTo(v: number, target: number, ease: number, max: number): number {
  const d = target - v, step = Math.trunc((d * ease) / 10) || Math.sign(d);
  return v + Math.max(-max, Math.min(max, step));
}

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

function moveWalls(e: Enemy, world: World): boolean {
  const x0 = e.x, y0 = e.y;
  moveAxis(e, world, e.vx, "x");
  moveAxis(e, world, e.vy, "y");
  return (e.vx !== 0 && e.x - x0 !== e.vx) || (e.vy !== 0 && e.y - y0 !== e.vy);
}

/** Nothing solid on the straight line between two points, px (sampled every 4 px). TODO(measure): the game's test
 *  (0x801F23BC). */
export function clearLine(world: World, x0: number, y0: number, x1: number, y1: number): boolean {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 4);
  for (let k = 1; k < n; k++) if (isSolidAt(world, Math.floor(x0 + ((x1 - x0) * k) / n), Math.floor(y0 + ((y1 - y0) * k) / n))) return false;
  return true;
}

/** A sim angle (0 right, clockwise) give or take `spread` (the game's spread − 2 × spread × rand). */
const wobble = (game: AdventureGame, angle: number, spread: number) => (angle - spread + random(game, 2 * spread)) & 0xffff;

// --- the sword soldier (SLR1; init 0x80153AA4, update 0x80150284, its states' table 0x8049FCF8) ---
// Kind p & 7 (its life from 0x8049FA40: 12, 12, 1, 12, 16, 8, 20, 0; kinds 1-3 see a Link 1000 px off, the others 100);
// (p >> 16) & 15 = 1 a faster one (base speed 1.2, not 0.7); p bit 8: it chases the first Link it sees from anywhere;
// p bit 12: it never takes an attack slot (below); its group (captain) p >> 24. A random facing. Its states (+0x230):
// - "patrol" (1): it walks along its facing at its base speed, a step of its legs every 6 or 8 ticks, for 50 + rand(50)
//   ticks, then looks round ("look", 3): its head turns every 15 ticks (right, up, right, down facing right…), one or
//   two rounds, then it walks off onto the other axis, either way. A wall stops it 8 ticks ("turn", 2), then it walks
//   back the other way (no wall turns it again for 20 + rand(20) ticks). Placed, it starts looking round.
// - it notices a Link (its cool-down over): patrolling, one in the quadrant it faces within its reach; looking round,
//   one within 100 px in the quadrant its head faces; then "!" and a 21-tick wind-up ("stop", 4 then 5) facing him, and
//   a chase ("chase", 6) of 50 + rand(200) ticks at 1.5 × base + rand(0.2) px/tick: standing until its first aim
//   20 + rand(instance & 7) ticks in, then re-aimed every 13 + rand(instance & 7) ticks at the nearest Link give or take
//   0x1000 (its facing his quadrant; kinds 1-3 and 6 without a captain go at half speed across their facing), its
//   velocity easing 0.3 of the way (at most 1 px/tick a tick). Then it stands ("patrol" without a walk) with a 30 +
//   rand(instance & 7) tick cool-down. Struck, it winds up again.
// - the attack slots (0x804BF850, one per Link, and a countdown 0x80539F68 drained at a rate 0x8053AB48): a chasing
//   soldier within 56 px of a Link takes his slot if it's free and the countdown, less the rate, is out (it's then 200
//   again); otherwise it steers away from him (its target velocity at its chase speed, 0x7000 round from him) every tick,
//   until its next aim. Every soldier's init frees the slots and sets the countdown to 200 and the rate to 0; a soldier
//   struck or killed frees its slot and adds 2 to the rate (at most 200; the first time also zeroes the countdown). So
//   until a Link strikes one, soldiers stop 40-56 px short of him and pace (traced: room 5, 900 ticks idle).
// - a captain's soldier: under the gather order it goes straight to a chase (no wind-up) and aims at its captain while
//   more than 40 px from him, its chase held; under the attack order a chase lasts while it sees a Link.
// - room 5 of Lake Hylia (traced): one spawned at world (104x, 87x) / 10 in the room on cell (2, 2) appears 32 px higher
//   and walks in ("walk", 0): right at 1.4 px/tick for 110 + rand(40) ticks (a Link it sees ahead makes it wind up),
//   then chases 150 + rand(100) ticks; the others in that room chase for good.
// Timers count down at the end of its tick. Its box against the walls and its body that shoves the others: below
// (shoveSoldiers). Not simulated: kinds 1 and 6's own states, the guards ((p >> 16) & 15 of 6-9: standing facing a set
// way), the circling ones (4), side views' gravity.
export const SOLDIER_LIFE: readonly number[] = [12, 12, 1, 12, 16, 8, 20, 0];
export const SOLDIER = {
  half: 7,
  /** Base speeds (+0x290), px/tick; a chase's (+0x28C) is 1.5 × it + rand(0.2). */
  baseSpeed: 0.7,
  fastSpeed: 1.2,
  chaseSpeedFactor: 1.5,
  chaseSpeedSpread: 0.2,
  /** Its velocity eases 3/10 of the way to its target (0x801F71A4), by at most 1 px/tick a tick. */
  ease: 3,
  maxEase: SUBPX,
  legMin: 50,
  legSpread: 50,
  bumpTicks: 8,
  bumpGraceMin: 20,
  bumpGraceSpread: 20,
  bumpLeg: 10,
  lookFirst: 8,
  lookStep: 15,
  /** Its reach (px): kinds 1-3, the others; looking round. */
  sightFar: 1000,
  sight: 100,
  windupTicks: 20,
  chaseMin: 50,
  chaseSpread: 200,
  firstAim: 20,
  aimMin: 13,
  wobble: 0x1000,
  coolMin: 30,
  standTicks: 20,
  /** A captain's soldier: gathering within this of him (px); an attack order's aims are this much further apart. */
  gather: 40,
  attackAim: 10,
  groupHold: 20,
  /** Room 5's others' chase, held. */
  hold: 10,
  /** The attack slots. */
  slotReach: 56,
  slotWait: 200,
  slotRate: 2,
  slotRateMax: 200,
  veer: 0x7000,
  /** Room 5's walk in. */
  walkInSpeed: 358, // 1.4 px/tick
  walkInMin: 110,
  walkInSpread: 40,
  walkInChaseMin: 150,
  walkInChaseSpread: 100,
  walkInLift: 32,
  walkInCell: [2, 2] as const,
  walkInSpot: [104, 87] as const,
};
/** `Enemy.flags` of a sword soldier: chases the first Link it sees (p bit 8, +0x280), chases for good (room 5's,
 *  +0x270), takes no attack slot (p bit 12), was chasing when knocked back. */
export const SOLDIER_AT_ONCE = 1;
export const SOLDIER_ALWAYS = 2;
export const SOLDIER_NO_SLOT = 4;
export const SOLDIER_WAS_CHASING = 8;
/** Its poses (enemy_both 143 + pose): walking (0x8049FA78, a step every 6 / 8 ticks: 0x8049FAF8), looking round
 *  (0x8049FB38) and where its head looks then (0x8049FB78), by facing. */
export const SOLDIER_WALK: readonly (readonly number[])[] = [[0, 1, 0, 2, 0, 1, 0, 3], [6, 7, 6, 8, 6, 7, 6, 9], [12, 13, 12, 14, 12, 13, 12, 15], [18, 19, 18, 20, 18, 19, 18, 21]];
export const SOLDIER_STEP_TICKS: readonly number[] = [6, 8, 6, 8, 6, 8, 6, 8];
export const SOLDIER_LOOK: readonly (readonly number[])[] = [[0, 4, 0, 5], [6, 10, 6, 11], [12, 16, 12, 17], [18, 22, 18, 23]];
const LOOK_AT: readonly (readonly number[])[] = [[0, 3, 0, 2], [1, 3, 1, 2], [2, 1, 2, 0], [3, 1, 3, 0]];
/** A chasing soldier's step every 4 ticks. TODO(measure): where the game steps it. */
const CHASE_STEP_TICKS = 4;

/** The attack slots (main.dol 0x804BF850): per Link the soldier that has it (an enemy id, -1 none), the countdown
 *  before another may take a free one and the rate it drains at. */
export interface SoldierSlots {
  links: number[];
  wait: number;
  rate: number;
}
export const newSlots = (): SoldierSlots => ({ links: [-1, -1, -1, -1], wait: SOLDIER.slotWait, rate: 0 });

/** A sword soldier's pose (enemy_both 143 + it) as its state shows it. */
export function soldierPose(e: Enemy): number {
  const d = FACINGS.indexOf(e.facing);
  if (e.state === "look") return SOLDIER_LOOK[d]![e.frame & 3]!;
  if (e.state === "patrol" || e.state === "walk" || e.state === "chase" || e.state === "turn") return SOLDIER_WALK[d]![e.frame & 7]!;
  return SOLDIER_WALK[d]![0]!;
}

const instance = (e: Enemy) => e.id & 7;

/** A soldier's init (0x80153AA4): its kind's life, a random facing, its base speed, its flags; room 5's walk in. */
export function initSwordSoldier(game: AdventureGame, stage: AdventureStage, e: Enemy, params: number): void {
  e.kind = params & 7;
  e.group = params >>> 24;
  e.gate = 0;
  e.life = Math.max(1, SOLDIER_LIFE[e.kind]!);
  e.facing = FACINGS[random(game, 4)]!;
  e.speed = Math.round((((params >>> 16) & 15) === 1 ? SOLDIER.fastSpeed : SOLDIER.baseSpeed) * SUBPX);
  e.turn = chaseSpeed(game, e);
  e.flags = (params & 0x100 ? SOLDIER_AT_ONCE : 0) | (params & 0x1000 ? SOLDIER_NO_SLOT : 0);
  // Placed, it stands (no walk yet), its leg over: it looks round first.
  e.state = "patrol";
  e.timer = 0;
  e.frameTimer = SOLDIER.lookFirst;
  game.adventure.slots = newSlots();
  const cell = stage.cellOf(game.adventure.room);
  if (!cell || game.adventure.area !== 0 || cell.cx !== SOLDIER.walkInCell[0] || cell.cy !== SOLDIER.walkInCell[1]) return;
  const wx = Math.floor((cell.cx * ROOM_W * SUBPX + e.x) / (10 * SUBPX)), wy = Math.floor((cell.cy * ROOM_H * SUBPX + e.y) / (10 * SUBPX));
  if (wx !== SOLDIER.walkInSpot[0] || wy !== SOLDIER.walkInSpot[1]) {
    e.flags |= SOLDIER_ALWAYS;
    return;
  }
  e.y -= SOLDIER.walkInLift * SUBPX;
  e.homeY = e.y;
  e.facing = "right";
  e.state = "walk";
  e.tvx = SOLDIER.walkInSpeed;
  e.timer = SOLDIER.walkInMin + random(game, SOLDIER.walkInSpread);
}

/** 1.5 × the base speed + rand(0.2) px/tick (drawn per chase, +0x28C). */
const chaseSpeed = (game: AdventureGame, e: Enemy) => Math.round(SOLDIER.chaseSpeedFactor * e.speed) + Math.floor(random(game, SUBPX) * SOLDIER.chaseSpeedSpread);

function startChase(game: AdventureGame, e: Enemy, ticks: number): void {
  setState(e, "chase");
  e.timer = ticks;
  e.shot = SOLDIER.firstAim + Math.trunc(fraction(game) * instance(e));
  e.turn = chaseSpeed(game, e);
}

/** A soldier struck or gone: its slot freed, the rate up by 2 (0x8015394C, and its update when struck). */
export function soldierStruck(game: AdventureGame, e: Enemy): void {
  const s = game.adventure.slots;
  s.links = s.links.map((id) => (id === e.id ? -1 : id));
  if (e.flags & SOLDIER_NO_SLOT) return;
  if (s.rate === 0) s.wait = 0;
  s.rate = Math.min(SOLDIER.slotRateMax, s.rate + SOLDIER.slotRate);
}

/** What a sword soldier struck goes back to after its knockback: its chase, else a wind-up. */
export function soldierAfterKnock(e: Enemy): EnemyState {
  const chasing = (e.flags & SOLDIER_WAS_CHASING) !== 0;
  e.flags &= ~SOLDIER_WAS_CHASING;
  if (!chasing) e.timer = 0;
  return chasing ? "chase" : "notice";
}

/** Before its knockback: remember whether it was chasing (the game keeps a chase going, else winds up again). */
export function soldierKnocked(e: Enemy): void {
  if (e.state === "chase" || e.state === "stop") e.flags |= SOLDIER_WAS_CHASING;
  else e.flags &= ~SOLDIER_WAS_CHASING;
}

export function stepSwordSoldier(game: AdventureGame, e: Enemy, world: World): void {
  const a = game.adventure;
  const i = nearest(game, e.x, e.y), p = game.players[i];
  const dx = p ? (p.x - e.x) / SUBPX : 0, dy = p ? (p.y - e.y) / SUBPX : 0;
  const dist = p ? Math.hypot(dx, dy) : Infinity;
  const quad = p ? facingTo(dx, dy) : null;
  const reach = e.kind >= 1 && e.kind <= 3 ? SOLDIER.sightFar : SOLDIER.sight;
  const captain = captainOf(game, e);
  const gathering = !!captain && captain.shot2 === ORDER_GATHER;
  // No Link to go for: a wind-up or a chase ends.
  if (!p && (e.state === "notice" || e.state === "stop" || e.state === "chase")) {
    a.slots.links = a.slots.links.map((id) => (id === e.id ? -1 : id));
    setState(e, "patrol");
  }
  // Its velocity eases to its target (rounded: the game's float velocity within 0.01 px).
  const ease = (v: number, t: number) => v + Math.max(-SOLDIER.maxEase, Math.min(SOLDIER.maxEase, Math.round(((t - v) * SOLDIER.ease) / 10) || Math.sign(t - v)));
  e.vx = ease(e.vx, e.tvx);
  e.vy = ease(e.vy, e.tvy);
  // The attack slots: a chasing soldier near a Link whose slot it can't have steers away from him.
  if (p && e.state === "chase" && dist < SOLDIER.slotReach && !(e.flags & SOLDIER_NO_SLOT)) {
    const s = a.slots, held = s.links[i] ?? -1;
    if (held !== e.id) {
      if (held < 0 && (s.wait -= s.rate) <= 0) {
        s.wait = SOLDIER.slotWait;
        s.links[i] = e.id;
      } else [e.tvx, e.tvy] = along((angleTo(e.x, e.y, p.x, p.y) - SOLDIER.veer) & 0xffff, e.turn);
    }
  }
  const blocked = moveSoldier(e, world, SOLDIER_WALL_BOX.SLR1);
  const look = () => {
    if (e.frameTimer > 0) return;
    e.frame = (e.frame + 1) & 7;
    e.frameTimer = e.state === "chase" ? CHASE_STEP_TICKS : SOLDIER_STEP_TICKS[e.frame]!;
  };
  const notices = (inSight: boolean) => !!p && e.shot === 0 && quad === e.facing && dist <= reach && inSight;
  if (e.state === "notice") {
    // "!": the wind-up starts (a captain's gather order: at once).
    e.tvx = e.tvy = 0;
    setState(e, "stop");
    e.timer = gathering ? 0 : SOLDIER.windupTicks;
  }
  switch (e.state) {
    case "walk":
      // Room 5's walk in.
      look();
      if (e.timer === 0) {
        e.flags &= ~SOLDIER_AT_ONCE;
        e.speed = Math.round(SOLDIER.baseSpeed * SUBPX);
        startChase(game, e, SOLDIER.walkInChaseMin + random(game, SOLDIER.walkInChaseSpread));
      } else if (notices(clearLine(world, e.x / SUBPX, e.y / SUBPX, p!.x / SUBPX, p!.y / SUBPX))) {
        e.speed = Math.round(SOLDIER.baseSpeed * SUBPX);
        setState(e, "notice");
      }
      break;
    case "patrol":
      if (blocked && e.grace === 0) {
        // A wall: 8 ticks still, then back the other way.
        e.tvx = e.tvy = e.vx = e.vy = 0;
        e.frameTimer = SOLDIER.bumpTicks;
        e.facing = FACINGS[FACINGS.indexOf(e.facing) ^ 1]!;
        setState(e, "turn");
      } else if (p && e.flags & (SOLDIER_AT_ONCE | SOLDIER_ALWAYS)) {
        e.flags &= ~SOLDIER_AT_ONCE;
        e.speed = Math.round(SOLDIER.baseSpeed * SUBPX);
        startChase(game, e, SOLDIER.walkInChaseMin + random(game, SOLDIER.walkInChaseSpread));
      } else if (e.timer === 0) {
        // Its leg over: it looks round, one or two rounds.
        e.tvx = e.tvy = 0;
        e.frame = 0;
        e.shot2 = 1 + Math.floor(1.99 * fraction(game));
        e.frameTimer = SOLDIER.lookFirst;
        setState(e, "look");
      } else {
        look();
        if (gathering) setState(e, "notice");
        else if (notices(true)) setState(e, "notice");
      }
      break;
    case "turn":
      if (e.frameTimer > 0) break;
      [e.tvx, e.tvy] = STEP[e.facing].map((d) => d * e.speed) as [number, number];
      e.frame = 0;
      e.frameTimer = SOLDIER.standTicks;
      e.timer = Math.max(e.timer, SOLDIER.bumpLeg);
      e.grace = SOLDIER.bumpGraceMin + Math.floor(SOLDIER.bumpGraceSpread * fraction(game));
      setState(e, "patrol");
      break;
    case "look":
      if (e.frameTimer === 0) {
        e.frame = (e.frame + 1) & 3;
        e.frameTimer = SOLDIER.lookStep;
        if (e.shot2 > 0) {
          if (e.frame === 0) e.shot2--;
          break;
        }
        // Off onto the other axis, either way.
        const vertical = e.facing === "down" || e.facing === "up";
        e.facing = vertical ? (random(game, 2) ? "left" : "right") : random(game, 2) ? "up" : "down";
        [e.tvx, e.tvy] = STEP[e.facing].map((d) => d * e.speed) as [number, number];
        e.timer = SOLDIER.legMin + random(game, SOLDIER.legSpread);
        e.frame = 0;
        e.frameTimer = SOLDIER.lookFirst;
        setState(e, "patrol");
      } else if (p && e.shot === 0 && dist <= SOLDIER.sight && quad === FACINGS[LOOK_AT[FACINGS.indexOf(e.facing)]![e.frame & 3]!]) setState(e, "notice");
      break;
    case "stop":
      // The wind-up, facing him.
      if (quad) e.facing = quad;
      if (e.timer === 0) startChase(game, e, SOLDIER.chaseMin + random(game, SOLDIER.chaseSpread));
      break;
    case "chase": {
      if (captain && (gathering || (p && clearLine(world, e.x / SUBPX, e.y / SUBPX, p.x / SUBPX, p.y / SUBPX)))) e.timer = Math.max(e.timer, SOLDIER.groupHold);
      if (e.flags & SOLDIER_ALWAYS) e.timer = Math.max(e.timer, SOLDIER.hold);
      look();
      if (e.timer === 0) {
        // Over: it stands, cooling down.
        a.slots.links = a.slots.links.map((id) => (id === e.id ? -1 : id));
        e.tvx = e.tvy = 0;
        e.frame = e.shot2 = 0;
        e.frameTimer = SOLDIER.standTicks;
        e.timer = SOLDIER.legMin + random(game, SOLDIER.legSpread);
        e.shot = SOLDIER.coolMin + Math.trunc(fraction(game) * instance(e));
        setState(e, "patrol");
        break;
      }
      if (e.shot > 0) break;
      // Re-aimed: at the nearest Link give or take 0x1000, or at its captain while gathering.
      e.shot = SOLDIER.aimMin + Math.trunc(fraction(game) * instance(e));
      if (p) {
        e.angle = wobble(game, angleTo(e.x, e.y, p.x, p.y), SOLDIER.wobble);
        e.facing = quad!;
      }
      if (captain) {
        if (gathering) {
          if (Math.hypot((captain.x - e.x) / SUBPX, (captain.y - e.y) / SUBPX) > SOLDIER.gather) e.angle = wobble(game, angleTo(e.x, e.y, captain.x, captain.y), SOLDIER.wobble);
        } else e.shot += SOLDIER.attackAim + Math.trunc(fraction(game) * instance(e));
      }
      [e.tvx, e.tvy] = along(e.angle, e.turn);
      // Kinds 1-3 and 6 without a captain go at half speed across their facing.
      if (e.group === 0 && (e.kind === 6 || (e.kind >= 1 && e.kind <= 3))) {
        if (e.facing === "right" || e.facing === "left") e.tvy = Math.trunc(e.tvy / 2);
        else e.tvx = Math.trunc(e.tvx / 2);
      }
      break;
    }
  }
  for (const k of ["timer", "shot", "grace", "frameTimer"] as const) if (e[k] > 0) e[k]--;
}

/** Moves a soldier against walls (with its own box, `half` px: else a Link's), and never into a pit or deep water; true
 *  when something stopped it. */
function moveSoldier(e: Enemy, world: World, half?: number): boolean {
  const x0 = e.x, y0 = e.y;
  const ahead = (v: number) => Math.sign(v) * 6;
  const safe = (px: number, py: number) => !["pit", "deep"].includes(surfaceAt(world, px, py));
  const move = (v: number, axis: "x" | "y") => (half ? moveInBox(e, world, half, v, axis) : moveAxis(e, world, v, axis));
  if (e.vx && safe(Math.floor((e.x + e.vx) / SUBPX) + ahead(e.vx), Math.floor(e.y / SUBPX))) move(e.vx, "x");
  if (e.vy && safe(Math.floor(e.x / SUBPX), Math.floor((e.y + e.vy) / SUBPX) + ahead(e.vy))) move(e.vy, "y");
  return (e.vx !== 0 && e.x - x0 !== e.vx) || (e.vy !== 0 && e.y - y0 !== e.vy);
}

// --- the soldiers' boxes: against the walls, and shoving each other ---
// Traced in room 9 (docs/measurements/adventure-enemies.md "Adventure: the sword soldiers"): an actor's box against the
// walls (+0x80..+0x8C, ±8 px for SLR1, ±10 for SLR4: they stop 8 and 10 px off the fence) and its body (+0x60..+0x6C)
// that shoves: SLR1 x −4..4, y −6..2; SLR4 x −12..12, y −20..4. Every tick after all the actors' updates (0x801F6A4C,
// from the actor loop 0x801F871C), each actor whose push class (+0xB8) is 1 is shoved out of every body of a weight
// (+0xBC: SLR1 2, SLR4 3) at least its own, in the order they updated: 1 px at a time (up to 8 times while they
// overlap) from the other's position give or take 0x2000, unless that step would put its wall box in a wall (0x801F23BC).
// So the soldiers' centres keep about 8 px apart on an axis, and they give way to their captain, who shoves through them.
// (The wall boxes and their moves are the battle's too: castlesoldiers.ts SOLDIER_WALL_BOX, moveInBox.)
export { moveInBox, SOLDIER_WALL_BOX };
/** The bodies that shove (px: left, top, right, bottom) and their weights. */
export const SOLDIER_BODY = {
  SLR1: { box: [-4, -6, 4, 2], weight: 2 },
  SLR4: { box: [-12, -20, 12, 4], weight: 3 },
} as const;
type Shover = keyof typeof SOLDIER_BODY;
const shoves = (e: Enemy): e is Enemy & { type: Shover } => e.type in SOLDIER_BODY;
export const SHOVE = { step: SUBPX, steps: 8, spread: 0x2000 };


/** Is a square box (half size px) at (x, y) (1/256 px) in a wall anywhere along its sides? */
const boxInWall = (world: World, x: number, y: number, half: number) =>
  boxSideHits(world, x, y, half, "x", 1) || boxSideHits(world, x, y, half, "x", -1) || boxSideHits(world, x, y, half, "y", 1) || boxSideHits(world, x, y, half, "y", -1);

const bodyOf = (e: Enemy & { type: Shover }) => {
  const b = SOLDIER_BODY[e.type].box;
  return [e.x + b[0] * SUBPX, e.y + b[1] * SUBPX, e.x + b[2] * SUBPX, e.y + b[3] * SUBPX] as const;
};
const overlap = (a: readonly number[], b: readonly number[]) => Math.min(a[2]!, b[2]!) >= Math.max(a[0]!, b[0]!) && Math.min(a[3]!, b[3]!) >= Math.max(a[1]!, b[1]!);

/** The soldiers shoving each other apart (0x801F6A4C), once a tick after every enemy's step. */
export function shoveSoldiers(game: AdventureGame, world: World, shown: (e: Enemy) => boolean): void {
  const bodies = game.adventure.enemies.filter((e) => shoves(e) && e.life > 0 && e.state !== "die" && shown(e)) as (Enemy & { type: Shover })[];
  for (const a of bodies) {
    const weight = SOLDIER_BODY[a.type].weight, half = SOLDIER_WALL_BOX[a.type];
    for (const b of bodies) {
      if (b === a || SOLDIER_BODY[b.type].weight < weight) continue;
      const other = bodyOf(b);
      for (let n = 0; n < SHOVE.steps && overlap(bodyOf(a), other); n++) {
        const [dx, dy] = along(wobble(game, angleTo(b.x, b.y, a.x, a.y), SHOVE.spread), SHOVE.step);
        if (boxInWall(world, a.x + dx, a.y + dy, half)) break;
        a.x += dx;
        a.y += dy;
      }
    }
  }
}

// --- the captain's group ---

/** Captain orders: attack (march at the Links), gather (march away; the group closes on him). */
export const ORDER_ATTACK = 0;
export const ORDER_GATHER = 1;
/** `leader` of a soldier whose captain is gone. */
export const LEADER_GONE = -2;

/** A soldier's captain (once found: the SLR4 of its group), or null. */
export function captainOf(game: AdventureGame, e: Enemy): Enemy | null {
  if (e.leader === 0 && e.group > 0) {
    const c = game.adventure.enemies.find((x) => x.type === "SLR4" && x.group === e.group && x.kind !== SPEAR_KIND);
    e.leader = c ? c.id : -1;
  }
  if (e.leader <= 0) return null;
  const c = game.adventure.enemies.find((x) => x.id === e.leader);
  if (!c || c.life <= 0) {
    e.leader = LEADER_GONE;
    return null;
  }
  return c;
}

/** Gathering (SLR1, SLR2: their captain's gather order) while more than 40 px from him: heads his way give or take
 *  0x1000, re-aimed every 20 + rand(instance & 7) ticks. True while it does. */
export function gather(game: AdventureGame, e: Enemy, world: World, speed: number): boolean {
  const c = captainOf(game, e);
  if (!c || c.shot2 !== ORDER_GATHER) return false;
  if (Math.hypot((c.x - e.x) / SUBPX, (c.y - e.y) / SUBPX) <= GROUP.gather) {
    e.vx = e.vy = 0;
    return true;
  }
  if (e.grace > 0) e.grace--;
  else {
    e.grace = GROUP.reaimMin + random(game, (e.id & 7) + 1);
    e.angle = (angleTo(e.x, e.y, c.x, c.y) + random(game, 2 * GROUP.spread + 1) - GROUP.spread) & 0xffff;
  }
  [e.vx, e.vy] = along(e.angle, speed);
  moveWalls(e, world);
  e.facing = facingTo(e.vx, e.vy);
  return true;
}
export const GROUP = { gather: 40, reaimMin: 20, spread: 0x1000 };

// --- the bow soldier (SLR2) ---
// Its rules and constants are the battle's (../castlesoldiers.ts BOWMAN: Hyrule Castle's arena spawns archers too).
/** OKTM's kind for an arrow (its params 1). */
export const ARROW_KIND = 1;
export function initBowman(game: AdventureGame, e: Enemy, params: number): void {
  e.kind = params & 0xff;
  e.life = BOWMAN.life;
  e.group = params >>> 24;
  e.facing = FACINGS[random(game, 4)]!;
  e.speed = Math.round((((params >>> 16) & 0xff) === 1 ? BOWMAN.fastSpeed : BOWMAN.baseSpeed) * SUBPX);
  e.turn = Math.round(1.5 * e.speed + 0.2 * fraction(game) * SUBPX); // its approach speed
  e.timer = BOWMAN.legMin + random(game, BOWMAN.legSpread);
  e.state = e.kind === 3 ? "hide" : e.kind === 2 ? "rest" : "walk";
}

/** Can a bow soldier be hurt now (a bush archer only out of its bush)? */
export const bowmanHurtable = (e: Enemy) => e.kind !== 3 || (e.state !== "hide" && e.state !== "fly");

export function stepBowman(game: AdventureGame, e: Enemy, world: World, spawnArrow: (x: number, y: number, vx: number, vy: number) => void, bushAt: (x: number, y: number) => boolean): void {
  if (e.shot > 0) e.shot--; // the cool-down or the next shot's delay
  if (e.shot2 > 0) e.shot2--; // the engagement
  if (e.frameTimer > 0) e.frameTimer--;
  const i = nearest(game, e.x, e.y), p = game.players[i];
  const dist = p ? Math.hypot((p.x - e.x) / SUBPX, (p.y - e.y) / SUBPX) : Infinity;
  if (e.kind === 3) return stepBushArcher(game, e, p, dist, spawnArrow, bushAt);
  if (e.kind === 2) return stepBomber(game, e, world, p, dist);
  const captain = captainOf(game, e);
  if (e.leader === LEADER_GONE && e.state !== "stop") {
    e.timer = BOWMAN.fleeMin + random(game, BOWMAN.fleeSpread);
    setState(e, "stop");
  }
  if (e.state !== "stop" && e.state !== "spit" && gather(game, e, world, e.speed)) return;
  void captain;
  const notices = () => !!p && e.shot === 0 && dist < BOWMAN.notice && facingTo(p.x - e.x, p.y - e.y) === e.facing;
  switch (e.state) {
    case "walk": {
      const [dx, dy] = STEP[e.facing];
      [e.vx, e.vy] = [dx * e.speed, dy * e.speed];
      if (moveWalls(e, world)) {
        e.facing = FACINGS[(FACINGS.indexOf(e.facing) + 1) & 3]!;
        e.vx = e.vy = 0;
        e.timer = Math.max(e.timer, BOWMAN.bumpLeg);
        e.grace = BOWMAN.bumpTicks;
        setState(e, "walk");
      }
      if (e.grace > 0) {
        e.grace--;
        e.vx = e.vy = 0;
      }
      animate(e, BOWMAN_WALK_TICKS);
      if (notices()) return notice(game, e, p!);
      if (--e.timer <= 0) {
        e.timer = (1 + random(game, 2)) * 4 * BOWMAN.lookTicks;
        e.frame = 0;
        setState(e, "rest");
      }
      return;
    }
    case "rest":
      // Looking round.
      e.vx = e.vy = 0;
      e.frame = Math.floor(e.tick / BOWMAN.lookTicks) & 3;
      if (notices()) return notice(game, e, p!);
      if (--e.timer <= 0) {
        let k = FACINGS.indexOf(e.facing) ^ 2;
        if (random(game, 2)) k ^= 1;
        e.facing = FACINGS[k]!;
        e.timer = BOWMAN.legMin + random(game, BOWMAN.legSpread);
        setState(e, "walk");
      }
      return;
    case "chase": {
      // To the point 70 px from him, in line with him, on its own side.
      if (!p) return setState(e, "walk");
      const [ox, oy] = STEP[e.facing];
      const tx = p.x - ox * BOWMAN.ring * SUBPX, ty = p.y - oy * BOWMAN.ring * SUBPX;
      const d = Math.hypot(tx - e.x, ty - e.y);
      const [vx, vy] = d > 0 ? [Math.round((e.turn * (tx - e.x)) / d), Math.round((e.turn * (ty - e.y)) / d)] : [0, 0];
      e.vx = easeTo(e.vx, vx, BOWMAN.ease, BOWMAN.maxEase);
      e.vy = easeTo(e.vy, vy, BOWMAN.ease, BOWMAN.maxEase);
      // A wall turns the point a quarter round him.
      if (moveWalls(e, world)) e.facing = FACINGS[[2, 3, 1, 0][FACINGS.indexOf(e.facing)]!]!;
      else e.facing = facingTo(p.x - e.x, p.y - e.y);
      animate(e, BOWMAN_WALK_TICKS);
      if (d <= BOWMAN.arrive * SUBPX || e.shot === 0) {
        e.vx = e.vy = 0;
        e.frame = 0;
        setState(e, "spit");
      }
      return;
    }
    case "spit":
      e.vx = e.vy = 0;
      e.frame = Math.min(3, Math.floor(e.tick / 8));
      if (e.tick === BOWMAN.arrowTick) {
        const [dx, dy] = STEP[e.facing], [fx, fy] = ARROW_FROM[e.facing];
        spawnArrow(e.x + fx * SUBPX, e.y + fy * SUBPX, dx * BOWMAN.arrowSpeed, dy * BOWMAN.arrowSpeed);
      }
      if (e.tick < BOWMAN.shootTicks) return;
      if (e.shot2 === 0) {
        e.shot = BOWMAN.coolMin + random(game, (e.id & 7) + 1);
        e.timer = BOWMAN.legMin + random(game, BOWMAN.legSpread);
        return setState(e, "walk");
      }
      e.shot = BOWMAN.firstShot + Math.trunc(70 * (e.id & 7) * fraction(game));
      return setState(e, "chase");
    case "stop": {
      // Fleeing, its captain gone.
      if (p) [e.vx, e.vy] = along((angleTo(e.x, e.y, p.x, p.y) + 0x8000) & 0xffff, BOWMAN.fleeSpeed);
      if (moveWalls(e, world) && p) e.facing = FACINGS[random(game, 4)]!;
      else e.facing = facingTo(e.vx, e.vy);
      animate(e, BOWMAN_WALK_TICKS);
      if (--e.timer <= 0) {
        e.leader = -1;
        e.shot = BOWMAN.coolMin + random(game, (e.id & 7) + 1);
        e.timer = BOWMAN.legMin + random(game, BOWMAN.legSpread);
        setState(e, "walk");
      }
      return;
    }
  }
}

function notice(game: AdventureGame, e: Enemy, p: { x: number; y: number }): void {
  e.shot2 = BOWMAN.engageMin + random(game, BOWMAN.engageSpread);
  e.shot = BOWMAN.firstShot + Math.trunc(10 * (e.id & 7) * fraction(game));
  e.facing = facingTo(p.x - e.x, p.y - e.y);
  setState(e, "chase");
}

function animate(e: Enemy, ticks: readonly number[]): void {
  if (e.frameTimer > 0) return;
  e.frame = (e.frame + 1) % ticks.length;
  e.frameTimer = ticks[e.frame]!;
}

// A bush archer: hidden in its bush ("hide") until a Link comes within 80 px, rising ("fly", 10 ticks), shooting volleys
// ("spit") of three arrows 50 ticks apart, sinking ("fly" again) once he's beyond 100 px.
function stepBushArcher(game: AdventureGame, e: Enemy, p: { x: number; y: number } | undefined, dist: number, spawnArrow: (x: number, y: number, vx: number, vy: number) => void, bushAt: (x: number, y: number) => boolean): void {
  if (!bushAt(Math.floor(e.x / SUBPX), Math.floor(e.y / SUBPX))) {
    // Its bush gone: an archer.
    e.kind = 0;
    e.timer = BOWMAN.legMin;
    return setState(e, "walk");
  }
  switch (e.state) {
    case "hide":
      if (p && dist < BOWMAN.wake) {
        e.shot2 = 1; // rising
        setState(e, "fly");
      }
      return;
    case "fly":
      if (e.tick < 10) return;
      if (e.shot2 === 1) {
        e.shot = 0;
        return setState(e, "spit");
      }
      return setState(e, "hide");
    case "spit":
      if (p) e.facing = facingTo(p.x - e.x, p.y - e.y);
      if (p && dist > BOWMAN.sink) {
        e.shot2 = 0;
        return setState(e, "fly");
      }
      if (e.shot > 0) return;
      // A volley: three shots of the shooting cycle.
      if (e.tick % BOWMAN.shootTicks === BOWMAN.arrowTick && e.tick < 3 * BOWMAN.shootTicks) {
        const [dx, dy] = STEP[e.facing], [fx] = ARROW_FROM[e.facing];
        spawnArrow(e.x + fx * SUBPX, e.y - 10 * SUBPX, dx * BOWMAN.arrowSpeed, dy * BOWMAN.arrowSpeed);
      }
      if (e.tick >= 3 * BOWMAN.shootTicks) {
        e.shot = BOWMAN.volleyGap;
        e.tick = 0;
      }
      e.frame = Math.min(3, Math.floor((e.tick % BOWMAN.shootTicks) / 8));
      return;
  }
}

// A bomb thrower: turns every 15 ticks (every fourth turn round, half the time onto the other axis); a Link it faces
// within 100 px gets a lit bomb, every 90 ticks.
function stepBomber(game: AdventureGame, e: Enemy, world: World, p: { x: number; y: number } | undefined, dist: number): void {
  e.vx = e.vy = 0;
  moveWalls(e, world);
  if (e.state === "spit") {
    e.frame = Math.min(3, Math.floor(e.tick / 8));
    if (e.tick === BOWMAN.arrowTick) {
      const [dx, dy] = STEP[e.facing], speed = (BOWMAN.bombSpeed + fraction(game)) * SUBPX;
      spawnEntity(game.battle, "bomb", e.x + dx * 8 * SUBPX, e.y + dy * 8 * SUBPX, {
        timer: BOMB_FUSE,
        phase: "flying",
        vx: Math.round(dx * speed),
        vy: Math.round(dy * speed),
        vz: BOWMAN.bombVz,
        z: 16 * SUBPX,
        owner: -1,
      });
    }
    if (e.tick >= BOWMAN.shootTicks) {
      e.shot = BOWMAN.bombEvery;
      setState(e, "rest");
    }
    return;
  }
  if (p && e.shot === 0 && dist < BOWMAN.notice && facingTo(p.x - e.x, p.y - e.y) === e.facing) {
    e.frame = 0;
    return setState(e, "spit");
  }
  if (e.tick % BOWMAN.bombTurn === BOWMAN.bombTurn - 1) {
    e.frame = (e.frame + 1) & 3;
    let k = FACINGS.indexOf(e.facing) ^ 1;
    if (e.frame === 0 && random(game, 2)) k ^= 2;
    e.facing = FACINGS[k]!;
  }
}

// --- the captain (SLR4) ---
// Its rules and constants are the battle's (../castlesoldiers.ts CAPTAIN: Hyrule Castle's arena spawns a captain too).
/** The second SLR4 a captain spawns (its spear; params 7): not an enemy here. */
export const SPEAR_KIND = 7;
const legOf = (game: AdventureGame, nibble: number) => (nibble ? nibble * CAPTAIN.legUnit : CAPTAIN.legMin + random(game, CAPTAIN.legSpread));

export function initCaptain(game: AdventureGame, e: Enemy, params: number): void {
  e.kind = params & 0xff;
  e.group = params >>> 24;
  e.life = 2 * (CAPTAIN.life[e.kind] ?? CAPTAIN.life[0]!);
  e.shot2 = ORDER_GATHER; // (it flips to attack at its first leg's end: traced, room 9 marched away first)
  e.timer = legOf(game, (params >>> 8) & 15);
  e.facing = e.kind === 2 || e.kind === 3 ? "up" : FACINGS[random(game, 4)]!;
  e.state = e.kind >= 4 ? "chase" : "walk";
}

export function stepCaptain(game: AdventureGame, e: Enemy, world: World): void {
  if (e.shot > 0) e.shot--;
  if (e.frameTimer > 0) e.frameTimer--;
  const i = nearest(game, e.x, e.y), p = game.players[i];
  const dist = p ? Math.hypot((p.x - e.x) / SUBPX, (p.y - e.y) / SUBPX) : Infinity;
  const followers = game.adventure.enemies.some((x) => x.leader === e.id && x.life > 0);
  if (e.state === "walk" && !followers && game.adventure.enemies.some((x) => x.group === e.group && x.type !== "SLR4")) setState(e, "chase");
  switch (e.state) {
    case "walk":
    case "chase": {
      if (p && dist < CAPTAIN.reach && e.shot === 0) {
        e.facing = facingTo(p.x - e.x, p.y - e.y);
        e.vx = e.vy = 0;
        e.frame = 0;
        return setState(e, "stop");
      }
      const marching = e.state === "walk";
      if (marching && --e.timer <= 0) {
        e.shot2 = e.shot2 === ORDER_ATTACK ? ORDER_GATHER : ORDER_ATTACK;
        e.timer = legOf(game, (e.params >>> (e.shot2 === ORDER_ATTACK ? 12 : 8)) & 15);
      }
      if (e.tick % (marching ? CAPTAIN.marchAim : CAPTAIN.chaseAim) === 1 && p) {
        const toward = angleTo(e.x, e.y, p.x, p.y);
        e.angle = marching && e.shot2 === ORDER_GATHER ? (toward + 0x8000) & 0xffff : toward;
      }
      [e.vx, e.vy] = along(e.angle, marching ? CAPTAIN.march : CAPTAIN.chase);
      moveCaptain(e, world);
      e.facing = facingTo(e.vx, e.vy);
      if (e.frameTimer === 0) {
        e.frame = (e.frame + 1) & 3;
        e.frameTimer = CAPTAIN_MARCH_TICKS[e.frame]!;
      }
      return;
    }
    case "stop":
      // The wind-up.
      e.frame = Math.min(1, Math.floor(e.tick / 24));
      if (e.tick < CAPTAIN.windupTicks) return;
      [e.vx, e.vy] = STEP[e.facing].map((d) => d * CAPTAIN.lungeSpeed) as [number, number];
      e.frame = 2;
      return setState(e, "fly");
    case "fly": {
      moveCaptain(e, world);
      const slow = (v: number) => (v > 0 ? Math.max(0, v - CAPTAIN.lungeSlow) : Math.min(0, v + CAPTAIN.lungeSlow));
      [e.vx, e.vy] = [slow(e.vx), slow(e.vy)];
      e.frame = Math.min(5, 2 + Math.floor(e.tick / 4));
      if (e.vx || e.vy) return;
      e.timer = e.kind <= 1 ? CAPTAIN.holdTicks : CAPTAIN.shortHold;
      return setState(e, "spit");
    }
    case "spit":
      e.frame = 5;
      if (--e.timer > 0) return;
      e.shot = CAPTAIN.cooldown;
      e.frame = 0;
      return setState(e, e.kind >= 4 || !followers ? "chase" : "walk");
  }
}

/** A captain moves against the walls with his box (±10 px). */
function moveCaptain(e: Enemy, world: World): void {
  moveInBox(e, world, SOLDIER_WALL_BOX.SLR4, e.vx, "x");
  moveInBox(e, world, SOLDIER_WALL_BOX.SLR4, e.vy, "y");
}

/** Does a captain's shield stop a sword from (x, y)? It faces that Link. */
export const shieldStops = (e: Enemy, x: number, y: number) => e.state !== "fly" && e.state !== "spit" && facingTo(x - e.x, y - e.y) === e.facing;

/** The captain's spear's box (1/256 px). */
export function spearBox(e: Enemy): { left: number; top: number; right: number; bottom: number } {
  const [dx, dy, hx, hy] = SPEAR[e.facing];
  const x = e.x + dx * SUBPX, y = e.y + dy * SUBPX;
  return { left: x - hx * SUBPX, top: y - hy * SUBPX, right: x + hx * SUBPX, bottom: y + hy * SUBPX };
}

// --- the ball-and-chain soldier (SLR3, 鉄球兵) ---
// Its rules and constants are the battle's (../castlesoldiers.ts BALL_SOLDIER: Hyrule Castle's arena spawns one too),
// read from main.dol; its walk traced here (docs/measurements/adventure-world1.md "Room 6's iron-ball soldier": placed,
// it waits for its switch, room 6's 16, the gate's; from the tick after, it walks at the Link, its velocity eased 3/10 of
// the way each tick to 0.3 px/tick toward him). Its life is enemyparam.csv's 32, 24 in Hyrule Castle (its init: world 0
// stage 3, over the 16 it takes when 0x802DE814 says alone; TODO(measure): that 16 elsewhere). Fields: state "chase"
// walking at the nearest Link, "rest" with none (its ball reeled in); `angle` its ball's swing, `turn` its swing speed,
// `shot` its chain's length (1/256 px), `timer` its reel-in after a hit (nothing hurts it meanwhile), `frame` its walk
// frame (0-2).
/** Hyrule Castle's stage (AdventureStage.index) and the life its ball-and-chain soldiers take there. */
export const BALL_SOLDIER_CASTLE = { stage: 13, life: 24 } as const;

export function initBallSoldier(e: Enemy, stage: number): void {
  if (stage === BALL_SOLDIER_CASTLE.stage) e.life = BALL_SOLDIER_CASTLE.life;
  e.turn = BALL_SOLDIER.spin;
  e.state = "rest";
}

/** The nearest Link it walks at (0x801EEC98: any distance, invincible or not); -1 if none. */
function ballTarget(game: AdventureGame, e: Enemy): number {
  let best = -1, bestD = Infinity;
  game.players.forEach((p, i) => {
    if (!ballSoldierSees(game.battle.fighters[i]!)) return;
    const d = Math.hypot((p.x - e.x) / SUBPX, (p.y - e.y) / SUBPX);
    if (d < bestD) [best, bestD] = [i, d];
  });
  return best;
}

/** One tick of a ball-and-chain soldier: it walks at the nearest Link, its ball swinging round on its chain. */
export function stepBallSoldier(game: AdventureGame, e: Enemy, world: World): void {
  if (e.timer > 0) e.timer--;
  const p = game.players[ballTarget(game, e)];
  if (!p) {
    if (e.state !== "rest") setState(e, "rest");
  } else if (e.state !== "chase") setState(e, "chase");
  // Its velocity eases to its walk (a knock from a strike eases off the same way), then it moves.
  const [tx, ty] = p ? along(angleTo(e.x, e.y, p.x, p.y), BALL_SOLDIER.walk) : [0, 0];
  e.vx = easeTo(e.vx, tx, BALL_SOLDIER.ease, BALL_SOLDIER.maxEase);
  e.vy = easeTo(e.vy, ty, BALL_SOLDIER.ease, BALL_SOLDIER.maxEase);
  moveSoldier(e, world);
  if (e.vx || e.vy) e.facing = facingTo(e.vx, e.vy);
  e.frame = e.state === "chase" ? ballWalkFrame(e.tick) : 0;
  // The ball swings round; the chain lets out (or is reeled in).
  e.angle = (e.angle + e.turn) & 0xffff;
  const reach = e.state === "rest" || e.timer > 0 ? BALL_SOLDIER.reeled : BALL_SOLDIER.reach;
  e.shot = easeTo(e.shot, reach, BALL_SOLDIER.reelEase, BALL_SOLDIER.reelMax);
}

/** Where its chain starts (1/256 px). */
export const ironBallHand = (e: Enemy) => ballHandAt(e.x, e.y, e.frame);
/** Its ball's ground position (1/256 px; drawn BALL_SOLDIER.ballHeight px up). */
export const ironBallOf = (e: Enemy) => ballAt(ironBallHand(e), e.angle, e.shot);

/** Nothing hurts it while it reels its ball in after a hit (TODO(measure): main.dol keeps a per-Link mask). */
export const ballSoldierHurtable = (e: Enemy) => e.timer <= 0;

/** Struck and still standing: knocked 16 px/tick away from (x, y), its ball reeled in 30 ticks and swung faster. */
export function ballSoldierStruck(e: Enemy, x: number, y: number): void {
  let [kx, ky] = velocityAlong(e.x - x, e.y - y, BALL_SOLDIER.knock);
  if (!kx && !ky) ky = BALL_SOLDIER.knock; // (struck from its own spot)
  e.vx += kx;
  e.vy += ky;
  if (e.state === "chase" && e.turn < BALL_SOLDIER.spinMax) e.turn = Math.trunc((e.turn * BALL_SOLDIER.spinUp) / 10);
  e.timer = BALL_SOLDIER.reelTicks;
}

/** Its ball's box (1/256 px). */
export function ironBallBox(e: Enemy): { left: number; top: number; right: number; bottom: number } {
  const [x, y] = ironBallOf(e), h = BALL_SOLDIER.ballHalf * SUBPX;
  return { left: x - h, top: y - h, right: x + h, bottom: y + h };
}

/**
 * Link `i`'s sword meeting a ball (`meets` its box): it clanks (no harm either way), he recoils and is pushed 2 px/tick
 * away from the ball. True when it did (his sword strikes nothing else that tick: assumed, as in battle).
 */
export function ironBallClanks(game: AdventureGame, i: number, meets: (box: { left: number; top: number; right: number; bottom: number }) => boolean): boolean {
  for (const e of game.adventure.enemies) {
    if (e.type !== "SLR3" || e.state === "knock" || e.state === "die" || e.life <= 0 || !meets(ironBallBox(e))) continue;
    const p = game.players[i]!, f = game.battle.fighters[i]!, [bx, by] = ironBallOf(e);
    f.endCharge = 0;
    stopActing(p);
    p.action = "tink";
    [f.slideX, f.slideY] = velocityAlong(p.x - bx, p.y - by, BLOCK_PUSH_SPEED * SLIDE_SCALE);
    return true;
  }
  return false;
}
