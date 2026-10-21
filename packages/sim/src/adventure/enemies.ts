// The adventure's enemies: the current area's placed enemies (adventure.ts spawns them when the Links come in), stepped
// once a tick after the Links moved. Plain records in AdventureState.enemies.
//
// Common to every enemy (main.dol's enemy code and Dolphin traces, docs/measurements/adventure-lake-hylia.md "Adventure: enemies"):
// - life and contact damage are the type's enemyparam.csv `life` and `atcp` (read from the disc: AdventureStage.stats);
//   touching an enemy hurts a Link by its atcp with the sword's knockback (hit type 1: 0x801F2B7C(actor, -100, …, 1)).
// - Link's attacks take their attack power off its life (attacks.ts: a swing or stab 4, a lunge or spin 8, the
//   charging sword 2; measured: one stab killed a life-4 Octorok), and knock it away from him at 15.66 px/tick, the
//   speed × 0.78 each tick (measured), up to 24 ticks.
// - out of life it's knocked back the same, then lies dying 30 ticks (measured: the Octorok's actor lived 30 ticks
//   after its knockback), and goes up in a puff. Then it counts as a kill for the room (SKIL, generators.ts: the stage's
//   per-screen kill counters, 0x802D766C) and may leave something (dropFor).
// - one whose params' top 5 bits name a switch shows (and moves) only once that switch is on (as WARPs, PNPCs and
//   Force Gems read them; assumed for enemies, TODO(measure)).
// Per type below. Every value marked TODO(measure) is a placeholder.
import { attackMeets, type SubBox } from "../attacks.ts";
import { linkAttack } from "./whirl.ts";
import { BALL_KNOCK } from "../castlesoldiers.ts";
import { hurtFighter, KNOCK_HARD, KNOCK_SLOW, onGround, vulnerable } from "../combat.ts";
import { cos4096, isRemoved, removeEntity, sin4096, spawnEntity, TRIG_ONE, velocityAlong } from "../entities.ts";
import { angleTo } from "../hazards.ts";
import { moveAxis, SUBPX, type Facing } from "../player.ts";
import { DEBRIS, DEBRIS_TICKS, THROWN_DAMAGE } from "../strike.ts";
import { isSolidAt, ROOM_H, ROOM_W, surfaceAt, type World } from "../world.ts";
import { actorKey, currentArea, nextRandom, type AdventureGame } from "./adventure.ts";
import { dropGem } from "./pickups.ts";
import { ARROW_KIND, BALL_SOLDIER, ballSoldierHurtable, ballSoldierStruck, BOWMAN, bowmanHurtable, CAPTAIN, clearLine, initBallSoldier, initBowman, initCaptain, initSwordSoldier, ironBallBox, ironBallClanks, shieldStops, SOLDIER, soldierAfterKnock, soldierKnocked, soldierStruck, SPEAR_KIND, spearBox, stepBallSoldier, stepBowman, stepCaptain, stepSwordSoldier } from "./soldiers.ts";
import { armosHalf, armosHurtable, BONE_KIND, BUZZ, CRAB, initArmos, initBuzzBlob, initCrab, initMozo, initPoe, initRat, initStalfos, initTektite, MOZO, POE, poeLaugh, poeSolid, RAT, shock, STALFOS, stalfosHurtable, stepArmos, stepBuzzBlob, stepCrab, stepMozo, stepPoe, stepRat, stepStalfos, stepTektite, TEKTITE } from "./foes.ts";
import type { AdventureStage } from "./stage.ts";
import { initPame, initRope, initZol, PAME, pameBig, pameDeathGems, pameHarms, pameStruck, pameUpright, stepPame, stepRope, stepZol, walkerAfterKnock, walkerKnocked, WALKERS } from "./walkers.ts";
import { heldUnderRocks, RCK2_REVEAL_TICKS } from "./rocks.ts";
import { revealTingle } from "./tingle.ts";
import { FIREBALL_KIND, hurtZora, initPuku, initZora, PUKU, pukuHalf, stepFireball, stepPuku, stepZora, ZORA, ZORA_SHOT, zoraUp } from "./waterfoes.ts";
import { initRaisedStalfos, initWizzrobe, isCaster, RAISED_STALFOS, raisedStalfosHit, raisedStalfosHurtable, raisedStalfosHurts, stepRaisedStalfos, stepWizzrobe, wizzrobeDies, wizzrobeHurt, wizzrobeHurts, wizzrobeSolid, WIZZROBE, WIZZROBE_BOLTS, type WizzrobeHooks } from "./wizzrobe.ts";
import { initShadowLink, shadowAfterKnock, shadowBeaten, shadowForm, shadowHurtable, shadowMatches, shadowParries, shadowStruck, SHADOW, stepShadowLink } from "./shadowlink.ts";
import { initMinorShadow, stepMinorShadow } from "./minorshadow.ts";
import { bladeClanks, bladeHalf, FIRE_TRAP, FIRE_TRAP_KIND, initBladeTrap, initFireTrap, stepBladeTrap, stepFireTrap } from "./traps.ts";
import { dropHinoxRock, HINOX, HINOX_ROCK, hinoxBox, hinoxContact, initHinox, rockHurts, ROCK_KIND, stepHinox, stepHinoxRock, strikeHinox } from "./hinox.ts";

export type EnemyState = "walk" | "spit" | "fly" | "rest" | "stop" | "chase" | "hide" | "knock" | "die" | "patrol" | "turn" | "look" | "notice" | "rise" | "dive" | "change";

export interface Enemy {
  id: number;
  /** The actor type, e.g. "OKTA" (and "OKTM" for an Octorok's rock). */
  type: string;
  /** Its index in the room's actor list (-1: spawned at run time). */
  actor: number;
  /** Its variant (params low byte or nibble, per type). */
  kind: number;
  x: number; // 1/256 px, area coordinates
  y: number;
  z: number;
  vx: number; // 1/256 px per tick
  vy: number;
  /** Up (1/256 px per tick), for the ones that jump. */
  vz: number;
  /** Per type: the velocity it eases toward (Tektite +0x258/+0x25C, Stalfos +0x26C/+0x270). */
  tvx: number;
  tvy: number;
  /** Per type: ticks it can't be hurt or hurt a Link (Stalfos kind 3's +0x240). */
  grace: number;
  facing: Facing;
  state: EnemyState;
  /** Ticks in the state. */
  tick: number;
  /** Per type: the walk's countdown (Octorok +0x234), the flight's or the rest's (Keese +0x238), the chase's. */
  timer: number;
  /** Per type: the next shot's countdowns (Octorok +0x238, +0x23C). */
  shot: number;
  shot2: number;
  /** Per type: a heading (0-65535 = one turn clockwise from right, y down) and its step per tick (a soldier: its
   *  chase's speed, 1/256 px per tick). */
  angle: number;
  turn: number;
  /** Per type: an animation frame and its countdown (Keese wings +0x258, +0x234). */
  frame: number;
  frameTimer: number;
  /** Per type: its speed (1/256 px per tick; a soldier's base speed, +0x290). */
  speed: number;
  /** Where it was placed (1/256 px). */
  homeX: number;
  homeY: number;
  /** The switch it waits for before it shows (0 = none). */
  gate: number;
  /** Its params as placed (or made). */
  params: number;
  /** A soldier's captain's group (its params' top byte; 0 none), and its captain once found (its id; 0 not looked
   *  for yet, -1 none, -2 gone: soldiers.ts). */
  group: number;
  leader: number;
  /** 1: it may leave a small heart (Keese params bit 8). */
  drop: number;
  /** Per type: flag bits (a sword soldier's: soldiers.ts SOLDIER_AT_ONCE…). */
  flags: number;
  /** The Link who struck it last (-1 none): its kill counts for his streak (+0x10C). */
  hitBy: number;
  life: number;
  atcp: number;
  /** Ticks during which Link's attacks don't land again (one hit per swing). */
  invincible: number;
}

/** The enemy types the adventure animates (others stay static sprites, apps/game). */
export const ENEMY_TYPES: readonly string[] = ["OKTA", "KETH", "SLR1", "SLR2", "SLR4", "TKTA", "STAL", "BZBR", "POOH", "MOZO", "NZMI", "PEAC", "AMOS", "ROPE", "ZASL", "PAME", "ZORA", "PUKU", "HINO", "WIZR", "SLK2", "SLR3", "ZSLH", "FBGE", "TRAP"];

/** Knocked back by Link's attacks (measured on an Octorok hit by a stab): 15.66 px/tick, × 0.78 a tick, ≤ 24 ticks. */
export const ENEMY_KNOCK_SPEED = 4009;
export const ENEMY_KNOCK_DECAY = 200; // / 256 = 0.78
export const ENEMY_KNOCK_TICKS = 24;
/** The knockback ends once it's slower than this (the traced one stopped after 8 ticks, at 2.75 px/tick). TODO(measure). */
export const ENEMY_KNOCK_STOP = 2 * SUBPX;
export const ENEMY_DYING_TICKS = 30;
/** A thrown bush, pot or rock on an enemy, a bomb's blast, an arrow. TODO(measure): the game's values on enemies. */
export const BLAST_DAMAGE = 4;
export const ARROW_ENEMY_DAMAGE = 2;

// The Octorok (OKTA; main.dol update 0x8013FD50, init 0x80140920; measured in Lake Hylia room 3):
export const OCTOROK = {
  /** Its box: ±8 px (init). */
  half: 8,
  /** Walking: 1 px/tick, the velocity easing 0.3 of the way each tick (+0x25C, +0x26C). */
  speed: SUBPX,
  ease: 3, // / 10
  /** A walk lasts 50 + rand(100) ticks, then it turns; a wall turns it at once (keeping the count): always to the
   *  other axis, either way at random. */
  walkMin: 50,
  walkSpread: 100,
  /** Kind 0 spits rocks (kinds 3, Lake Hylia's, never do): when Link is ahead and its counters are out it stops, and
   *  spits a rock at 3 px/tick. The counters restart at 100 + rand(100) and half that. TODO(measure): the spit's timing
   *  (the code steps a 4-frame pose every 8 ticks, 20 ticks before the first rock). */
  shotMin: 100,
  shotSpread: 100,
  spitTicks: 20,
  spitAfter: 8,
  rockSpeed: 3 * SUBPX,
  rockHalf: 4,
};

// The Keese (KETH; main.dol update 0x8015CCF8, init 0x8015D844; not traced: no savestate has one). Its params: kind =
// p & 0xF, bit 8 = it may leave a small heart (+0x25E).
export const KEESE = {
  /** Its box. TODO(measure) (the init sets ±8 and ±12 extents; which one is the body isn't settled). */
  half: 6,
  /** Resting (state 0) it wakes when the nearest Link is within 60 px and its rest is over. */
  wake: 60,
  /** It takes off heading straight away from that Link (its angle + 0x8000) and turns toward him by up to 0x300 a tick
   *  (0x801F714C), flying at 0.7 px/tick (its velocity easing 0.3 of the way there each tick, by up to 1 px/tick). */
  turn: 0x300,
  speed: 179, // 0.7 px/tick
  ease: 3, // / 10
  maxEase: SUBPX,
  /** It flies 50 + rand(50) ticks, then lands once its wings are down (frame 2), and rests 20 + rand(20) ticks. */
  flyMin: 50,
  flySpread: 50,
  restMin: 20,
  restSpread: 20,
  /** Its wings: 3 frames of 6 ticks (+0x258, +0x234): both2 341, 342, 343 (343 = folded, at rest). */
  wingTicks: 6,
  /** Kind 3 patrols while resting, back and forth on one axis (either at random): its velocity aims at 1.2 px/tick ×
   *  sin of an angle that steps 512 + rand(512) a tick, either way. */
  patrolSpeed: 307, // 1.2 px/tick
  patrolStepMin: 512,
  patrolStepSpread: 512,
};

const STEP: Readonly<Record<Facing, readonly [number, number]>> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
const DIRECTIONS: readonly Facing[] = ["right", "left", "down", "up"];

const random = (game: AdventureGame, n: number) => nextRandom(game.adventure) % n;

/** The current area's placed enemies (the types in ENEMY_TYPES). */
export function spawnEnemies(game: AdventureGame, stage: AdventureStage): void {
  const area = currentArea(game, stage);
  // (What a two-Link rock holds comes out once it's lifted: rocks.ts heldUnderRocks.)
  const held = heldUnderRocks(game, area.actors);
  // (The minor Shadow Link doesn't come back once he's left: minorshadow.ts.)
  const gone = (a: { id: string; index: number }) => a.id === "ZSLH" && game.adventure.area === 0 && game.adventure.taken.includes(actorKey(game.adventure.room, a.index));
  for (const a of area.actors) if (ENEMY_TYPES.includes(a.id) && !held.has(a.index) && !gone(a)) spawnEnemy(game, stage, a.id, a.x, a.y, a.params, a.index);
}

/**
 * A new enemy of `type` at (x, y), area px, with its params: placed in the room (`actor` = its index in the room's list)
 * or made at run time by a generator (generators.ts, -1). Null for a type the adventure doesn't simulate.
 */
export function spawnEnemy(game: AdventureGame, stage: AdventureStage, type: string, x: number, y: number, params: number, actor = -1): Enemy | null {
  if (!ENEMY_TYPES.includes(type)) return null;
  const stats = stage.stats.get(type);
  const p = params >>> 0;
  // (A captain's spear and its stand-in are part of the captain here.)
  if (type === "SLR4" && ((p & 0xff) === SPEAR_KIND || (p & 0xff) === 8)) return null;
  const e = newEnemy(game, type, x * SUBPX, y * SUBPX, { actor, kind: p & 0xff, life: stats?.life ?? 1, atcp: stats?.atcp ?? 0, gate: actor >= 0 ? p >>> 27 : 0, params: p });
  switch (type) {
    case "OKTA":
      // A random facing and walk (init 0x80140920).
      e.facing = DIRECTIONS[random(game, 4)]!;
      e.timer = OCTOROK.walkMin + random(game, OCTOROK.walkSpread);
      e.shot = OCTOROK.shotMin + random(game, OCTOROK.shotSpread);
      break;
    case "KETH":
      e.kind = p & 0xf;
      e.drop = (p >>> 8) & 1;
      e.state = "rest";
      e.frame = 2;
      if (e.kind === 3) {
        // Which axis (+0x24C), and the patrol's step either way (+0x254).
        e.shot = random(game, 2);
        const step = KEESE.patrolStepMin + random(game, KEESE.patrolStepSpread);
        e.turn = random(game, 2) ? step : -step;
      }
      break;
    case "SLR1":
      initSwordSoldier(game, stage, e, p);
      break;
    case "SLR2":
      initBowman(game, e, p);
      e.gate = 0;
      break;
    case "SLR4":
      initCaptain(game, e, p);
      e.gate = 0;
      break;
    case "SLR3":
      initBallSoldier(e, stage.index);
      break;
    case "TKTA":
      initTektite(game, e, p);
      break;
    case "STAL":
      initStalfos(game, e, p);
      break;
    case "BZBR":
      initBuzzBlob(game, e, p);
      break;
    case "MOZO":
      initMozo(e);
      break;
    case "NZMI":
      initRat(game, e, p);
      break;
    case "PEAC":
      initCrab(game, e);
      break;
    case "AMOS":
      initArmos(e, p);
      e.gate = 0; // (its switch wakes kind 2: not a gate)
      break;
    case "POOH":
      // (Kind 8 is a trigger, not an enemy.)
      if ((p & 0xff) === 8) {
        game.adventure.enemies.pop();
        return null;
      }
      initPoe(game, e, p);
      if ((e.kind & ~3) !== 4) e.gate = 0; // (only kinds 4-7 wait for their switch)
      break;
    case "ROPE":
      initRope(game, e);
      e.gate = 0;
      break;
    case "ZASL":
      initZol(game, e, p);
      e.gate = 0;
      break;
    case "PAME":
      initPame(game, e, p);
      e.gate = 0;
      break;
    case "ZORA":
      initZora(game, e, p);
      e.gate = 0;
      break;
    case "PUKU":
      initPuku(game, e, p);
      e.gate = 0;
      break;
    case "HINO":
      initHinox(game, e);
      e.gate = 0;
      break;
    case "WIZR":
      initWizzrobe(game, e, p);
      break;
    case "SLK2":
      initShadowLink(e);
      break;
    case "ZSLH":
      initMinorShadow(e);
      e.gate = 0;
      break;
    case "FBGE":
      if (!initFireTrap(e)) {
        game.adventure.enemies.pop();
        return null;
      }
      break;
    case "TRAP":
      initBladeTrap(e);
      break;
  }
  return e;
}

function newEnemy(game: AdventureGame, type: string, x: number, y: number, fields: Partial<Enemy>): Enemy {
  const a = game.adventure;
  const e: Enemy = {
    id: a.nextId++, type, actor: -1, kind: 0, x, y, z: 0, vx: 0, vy: 0, vz: 0, tvx: 0, tvy: 0, grace: 0, facing: "down", state: "walk", tick: 0, timer: 0, shot: 0, shot2: 0,
    angle: 0, turn: 0, frame: 0, frameTimer: 0, speed: 0, homeX: x, homeY: y, gate: 0, params: 0, group: 0, leader: 0, drop: 0, flags: 0, hitBy: -1, life: 1, atcp: 0, invincible: 0, ...fields,
  };
  a.enemies.push(e);
  return e;
}

function setState(e: Enemy, state: EnemyState): void {
  e.state = state;
  e.tick = 0;
}

/** An enemy's box's half size, px. */
function halfOf(e: Enemy): number {
  switch (e.type) {
    case "OKTM":
      return e.kind === FIREBALL_KIND ? ZORA_SHOT.half : e.kind === FIRE_TRAP_KIND ? FIRE_TRAP.half : e.kind === BONE_KIND || e.kind === ARROW_KIND ? STALFOS.boneHalf : OCTOROK.rockHalf;
    case "ZORA":
      return ZORA.half;
    case "PUKU":
      return pukuHalf(e);
    case "HINO":
      return -HINOX.box.left;
    case "OIWA":
      return HINOX_ROCK.half;
    case "SLR2":
      return BOWMAN.half;
    case "SLR4":
      return CAPTAIN.half;
    case "SLR3":
      return BALL_SOLDIER.half;
    case "KETH":
      return KEESE.half;
    case "SLR1":
      return SOLDIER.half;
    case "TKTA":
      return e.kind & 1 ? TEKTITE.bigHalf : TEKTITE.half;
    case "STAL":
      return e.turn ? STALFOS.bigHalf : STALFOS.half;
    case "WIZR":
      return WIZZROBE_BOLTS.includes(e.kind) ? WIZZROBE.boltHalf : WIZZROBE.half;
    case "BZBR":
      return BUZZ.half;
    case "SLK2":
      return SHADOW.half;
    case "POOH":
      return e.kind === 3 || e.kind === 7 ? POE.ghostHalf : POE.half;
    case "MOZO":
      return MOZO.half;
    case "NZMI":
      return RAT.half;
    case "PEAC":
      return CRAB.half;
    case "AMOS":
      return armosHalf(e);
    case "PAME":
      return pameBig(e) ? PAME.bigHalf : PAME.half;
    case "TRAP":
      return bladeHalf(e);
    default:
      return OCTOROK.half;
  }
}

/** An enemy's box (1/256 px, inclusive), z px above its ground point (as the game's box tests take it). */
export function enemyBox(e: Enemy): SubBox {
  if (e.type === "HINO") return hinoxBox(e);
  const h = halfOf(e) * SUBPX, y = e.y - e.z;
  return { left: e.x - h, top: y - h, right: e.x + h, bottom: y + h };
}

/** Whether an enemy is there: its switch, if any, is on. */
export function enemyShown(game: AdventureGame, e: Enemy): boolean {
  return !e.gate || ((game.battle.switches >>> e.gate) & 1) === 1;
}

/** Whether an enemy can be hurt or hurt a Link now. */
export const enemyActive = (e: Enemy) => e.state !== "die" && e.life > 0;
/** Whether it counts for "all enemies beaten" (ZNSW): not a shot, a thrown rock, a Wizzrobe's spell, the minor Shadow Link
 *  or a trap. */
export const countsAsEnemy = (e: Enemy) => e.type !== "OKTM" && e.type !== "OIWA" && e.type !== "ZSLH" && e.type !== "FBGE" && e.type !== "TRAP" && !(e.type === "WIZR" && !isCaster(e));

export function stepEnemies(game: AdventureGame, stage: AdventureStage, world: World): void {
  const a = game.adventure;
  for (const e of a.enemies) {
    if (!enemyShown(game, e)) continue;
    // One made this tick by a generator acts from the next (traced: room 5's soldiers).
    if (e.tick < 0) {
      e.tick = 0;
      continue;
    }
    if (e.invincible > 0) e.invincible--;
    e.tick++;
    switch (e.state) {
      case "knock":
        stepKnock(e, world);
        break;
      case "die":
        if (e.tick >= (e.type === "SLK2" ? SHADOW.spin : ENEMY_DYING_TICKS)) die(game, stage, e);
        break;
      default:
        if (e.type === "OKTA") stepOctorok(game, stage, e, world);
        else if (e.type === "OKTM") stepRock(e, world);
        else if (e.type === "KETH") stepKeese(game, e, world);
        else if (e.type === "SLR1") stepSwordSoldier(game, e, world);
        else if (e.type === "SLR2") stepBowman(game, e, world, (x, y, vx, vy) => spawnArrow(game, stage, x, y, vx, vy), (x, y) => bushAt(game, stage, x, y));
        else if (e.type === "SLR4") stepCaptain(game, e, world);
        else if (e.type === "SLR3") stepBallSoldier(game, e, world);
        else if (e.type === "TKTA") stepTektite(game, e, world);
        else if (e.type === "STAL") {
          // (A Wizzrobe's raised Stalfos: falling in, collapsed, going for good.)
          if (e.kind === RAISED_KIND && stepRaisedStalfos(game, e, a.enemies.some((w) => isCaster(w) && w.life > 0))) continue;
          stepStalfos(game, e, world, (s, vx, vy) => spawnBone(game, stage, s, vx, vy));
        } else if (e.type === "WIZR") stepWizzrobe(game, e, world, wizzrobeHooks(game, stage));
        else if (e.type === "BZBR") stepBuzzBlob(game, e, world, (x0, y0, x1, y1) => clearLine(world, x0, y0, x1, y1), (x, y) => stage.tileTypeAt(currentArea(game, stage), x, y));
        else if (e.type === "POOH") stepPoe(game, e);
        else if (e.type === "MOZO") stepMozo(game, e, world, (x, y) => stage.tileTypeAt(currentArea(game, stage), x, y));
        else if (e.type === "PEAC") stepCrab(game, e, world, (x0, y0, x1, y1) => clearLine(world, x0, y0, x1, y1));
        else if (e.type === "AMOS") stepArmos(game, e, world, (n) => n > 0 && ((game.battle.switches >>> n) & 1) === 1);
        else if (e.type === "NZMI") {
          stepRat(game, e, world, e.grace > 0);
          e.grace = 0;
        } else if (e.type === "ROPE") stepRope(game, e, world);
        else if (e.type === "ZORA") stepZora(game, e, (x, y) => stage.tileTypeAt(currentArea(game, stage), x, y), (vx, vy) => newEnemy(game, "OKTM", e.x, e.y, { kind: FIREBALL_KIND, state: "fly", vx, vy, atcp: ZORA_SHOT.damage, life: 1 }));
        else if (e.type === "PUKU") {
          const area = currentArea(game, stage);
          stepPuku(game, e, world, (x, y) => stage.tileTypeAt(area, x, y), { left: 0, top: 0, right: area.w, bottom: area.h });
        } else if (e.type === "HINO") stepHinox(game, e, world, (x, y, z) => newEnemy(game, "OIWA", x, y, { kind: ROCK_KIND, z, state: "fly", atcp: HINOX_ROCK.damage, life: 1 }).id, (id) => a.enemies.find((x) => x.id === id));
        else if (e.type === "OIWA") stepHinoxRock(e);
        else if (e.type === "SLK2") stepShadowLink(game, stage, e, world);
        else if (e.type === "ZSLH") stepMinorShadow(game, e);
        else if (e.type === "FBGE") stepFireTrap(game, e, (vx, vy) => newEnemy(game, "OKTM", e.x, e.y, { kind: FIRE_TRAP_KIND, state: "fly", vx, vy, atcp: FIRE_TRAP.damage, life: 1, tick: -1 }));
        else if (e.type === "TRAP") stepBladeTrap(game, e, world);
        else if (e.type === "ZASL") stepZol(game, e, world);
        else if (e.type === "PAME") {
          stepPame(game, e, world, e.grace);
          e.grace = 0;
        }
    }
  }
  playerAttacks(game, world);
  arenaAttacks(game);
  contact(game);
  stepScores(game);
  revealHeld(game, stage);
  if (a.enemies.some((e) => e.life < 0)) a.enemies = a.enemies.filter((e) => e.life >= 0);
}

// Up in a puff: a kill for the room's count (generators.ts SKIL), and what it leaves (dropFor); a Keese with its heart
// bit also leaves a small heart one time in two (0x8015CDE8).
function die(game: AdventureGame, stage: AdventureStage, e: Enemy): void {
  e.life = -1;
  spawnEntity(game.battle, "debris", e.x, e.y, { param: DEBRIS.smoke, timer: DEBRIS_TICKS });
  if (e.type === "OKTM") return;
  if (e.type === "SLR1") soldierStruck(game, e);
  game.adventure.kills++;
  if (e.hitBy >= 0) scoreKill(game, e.hitBy);
  dropFor(game, stage.stats.get(e.type)?.dasu ?? 0, e.x, e.y);
  if (e.drop && random(game, 2) === 0) dropHeart(game, e.x, e.y);
  // Their own drops: a Tektite's (0x80154A10), a kind 9 Poe's heart (else a magic jar, not simulated).
  if (e.type === "TKTA") {
    if (e.kind & 1) dropGem(game, e.x, e.y, 0, TEKTITE.bigGem);
    else dropHeart(game, e.x, e.y);
  }
  if (e.type === "POOH" && e.kind === 9 && random(game, 10) < POE.heartIn10) dropHeart(game, e.x, e.y);
  if (e.type === "PAME") pameDeathGems(e, (x, y, type) => dropGem(game, x, y, 0, type));
  if (e.type === "HINO") dropHinoxRock(e, game.adventure.enemies.find((r) => r.id === e.leader));
  if (e.type === "WIZR") wizzrobeDies(game, e, wizzrobeHooks(game, stage));
  // A kind 1 captain takes its group with it.
  if (e.type === "SLR4" && e.kind === 1) for (const s of game.adventure.enemies) if (s.leader === e.id && enemyActive(s)) [s.life, s.state, s.tick] = [0, "die", 0];
}

/** What a lifted two-Link rock held comes out RCK2_REVEAL_TICKS ticks after it left the ground (rocks.ts): its enemies,
 *  Tingle (tingle.ts). */
function revealHeld(game: AdventureGame, stage: AdventureStage): void {
  for (const r of game.adventure.rocks) {
    if (!r.held.length || !((r.state === "held" && r.z > 0) || r.state === "flying")) continue;
    if (++r.reveal < RCK2_REVEAL_TICKS) continue;
    for (const actor of currentArea(game, stage).actors) {
      if (!r.held.includes(actor.index)) continue;
      if (ENEMY_TYPES.includes(actor.id)) spawnEnemy(game, stage, actor.id, actor.x, actor.y, actor.params, actor.index);
      else if (actor.id === "FTGL") revealTingle(game, stage, actor.index);
    }
    r.held = [];
  }
}

/** A Stalfos a Wizzrobe raised (STAL params 5). */
const RAISED_KIND = 5;

/** What a Wizzrobe makes: its spells (WIZR kinds 10-31), raised Stalfos; an ice ball (BOIB) here a harmless shot
 *  through walls (TODO(measure): the Link's state 81 it causes); POPOs and its fire bolt's flames (BLZE) not simulated. */
function wizzrobeHooks(game: AdventureGame, stage: AdventureStage): WizzrobeHooks {
  return {
    spawn(type, params, x, y, z) {
      if (type === "WIZR") {
        const e = newEnemy(game, "WIZR", x, y, { kind: params, params, z, atcp: stage.stats.get("WIZR")?.atcp ?? 2, life: 1 });
        initWizzrobe(game, e, params);
        return e;
      }
      if (type === "BOIB") return newEnemy(game, "OKTM", x, y, { kind: ICE_KIND, state: "fly", atcp: 0, life: 1 });
      if (type === "STAL") {
        const e = spawnEnemy(game, stage, "STAL", Math.floor(x / SUBPX), Math.floor(y / SUBPX), params);
        if (!e) return null;
        e.z = z;
        initRaisedStalfos(e);
        return e;
      }
      return null;
    },
    dropGem: (x, y, type) => dropGem(game, x, y, 0, type),
    setSwitch: (n) => {
      game.battle.switches = (game.battle.switches | (1 << n)) >>> 0;
    },
  };
}
/** OKTM's kind for a Wizzrobe's ice ball (flying through walls). */
const ICE_KIND = 4;

// --- the kill streak (SCRE; init 0x80393BF4, update 0x803939E0, its reward 0x80393514) ---
// Every enemy a Link kills adds one to his count (+0xC74, at most 9999; the common death code 0x801F4F28), and makes a
// SCRE that follows him 90 ticks (its "+n" display), then rewards each multiple of ten the count went past since the
// last one (the per-Link table at 0x80529FE0): a red Force Gem (20) for 10 and 20, a 50 for 30-50, a fairy from 60
// (not simulated), and one more red one for passing 15; each falls onto him from 300 px up at 1 px/tick (traced in
// room 5's ambush: red gems 90 ticks after the 10th and the 15th soldier killed, one Link, none hurt). The counts are
// the stage's (the game zeroes them at a stage event, 0x802DBD60, not looked into).
export const STREAK = {
  delay: 91, // (its 90-tick count, out on its 91st tick)
  height: 300,
  cap: 100,
  /** The extra red gem's count. */
  bonus: 15,
};
/** The gem (type) for the k-th multiple of ten; -1 a fairy (not simulated). */
const streakGem = (k: number) => (k <= 2 ? 2 : k <= 5 ? 3 : -1);

/** A pending SCRE: its Link, his count, the count at the one before, ticks so far. */
export interface Score {
  link: number;
  count: number;
  prev: number;
  tick: number;
}

function scoreKill(game: AdventureGame, link: number): void {
  const s = game.adventure.streak;
  s.kills[link] = Math.min(9999, (s.kills[link] ?? 0) + 1);
  const count = Math.min(STREAK.cap, s.kills[link]!);
  s.scores.push({ link, count, prev: s.seen[link] ?? 0, tick: 0 });
  s.seen[link] = count;
}

/** The streaks' pending rewards, one tick. */
function stepScores(game: AdventureGame): void {
  const s = game.adventure.streak;
  if (!s.scores.length) return;
  for (const sc of s.scores) {
    if (++sc.tick < STREAK.delay) continue;
    const p = game.players[sc.link];
    if (!p) continue;
    const gems: number[] = [];
    for (let k = Math.floor(sc.prev / 10) + 1; k <= Math.floor(sc.count / 10); k++) gems.push(streakGem(k));
    if (sc.count >= STREAK.bonus && sc.prev < STREAK.bonus) gems.push(2);
    for (const g of gems) if (g >= 0) dropGem(game, p.x, p.y, STREAK.height, g);
  }
  s.scores = s.scores.filter((sc) => sc.tick < STREAK.delay);
}

// --- drops ---
// What an enemy leaves as it dies (the common enemy code 0x801F4F28 calls 0x801F52A4 when its type's enemyparam.csv
// `dasu` isn't 0; traced on room 5's soldiers, dasu 4: 6 drops in 12 kills, 3 red gems, a blue, a green, a heart): with
// its class's chance (0x80469D48), one of eight codes at random from its row (0x80469D78), each a number of small hearts
// or Force Gems of one type. One thing lies where the enemy died; several lie 16 px off it, every one of a kind at the
// same angle (360° × which kind / their number: the game's own spread). The game's multiplayer-only rules around it
// (+0x7E: a crystal ball, the room's last enemy's 100-gem) don't apply alone.

/** Per class: the chance of a drop. */
export const DROP_CHANCE: readonly number[] = [1, 0.5, 0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 1, 1, 1];
/** Per class: the eight codes one is picked from. */
export const DROP_TABLE: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [1, 1, 1, 1, 3, 1, 1, 3],
  [2, 2, 2, 2, 1, 2, 2, 1],
  [4, 3, 4, 5, 4, 3, 4, 4],
  [5, 4, 5, 4, 5, 1, 5, 3],
  [7, 7, 7, 8, 7, 7, 8, 7],
  [1, 1, 2, 4, 1, 1, 1, 3],
  [4, 3, 1, 9, 3, 9, 3, 1],
  [1, 2, 5, 3, 11, 1, 5, 11],
  [10, 10, 10, 10, 10, 10, 10, 10],
  [12, 12, 12, 12, 12, 12, 12, 12],
  [13, 13, 13, 13, 13, 13, 13, 13],
];
/** The codes (0x801F52A4's switch, table 0x804A57C4): small hearts, then [count, gem type] per kind of Force Gem. */
export const DROP_CODES: readonly { hearts: number; gems: readonly (readonly [number, number])[] }[] = [
  { hearts: 0, gems: [] },
  { hearts: 1, gems: [] },
  { hearts: 2, gems: [] },
  { hearts: 0, gems: [[1, 0]] },
  { hearts: 0, gems: [[1, 1]] },
  { hearts: 0, gems: [[1, 2]] },
  { hearts: 0, gems: [[1, 3]] },
  { hearts: 0, gems: [[1, 4]] },
  { hearts: 0, gems: [[1, 5]] },
  { hearts: 0, gems: [[5, 0]] },
  { hearts: 0, gems: [[10, 0]] },
  { hearts: 0, gems: [[5, 1]] },
  { hearts: 0, gems: [[10, 1]] },
  { hearts: 0, gems: [[20, 0], [20, 1]] },
];
/** Several things of a kind lie this far off where it died (px). */
export const DROP_SPREAD = 16;

/** The drop of an enemy of class `dasu` dying at (x, y), 1/256 px. */
export function dropFor(game: AdventureGame, dasu: number, x: number, y: number): void {
  const chance = DROP_CHANCE[dasu], row = DROP_TABLE[dasu];
  if (!dasu || chance === undefined || !row) return;
  if (chance < 1 && random(game, Math.round(1 / chance)) !== 0) return;
  const code = DROP_CODES[row[random(game, row.length)]!]!;
  const kinds: [number, number][] = []; // [count, gem type or -1 for a heart]
  if (code.hearts) kinds.push([code.hearts, -1]);
  for (const [n, type] of code.gems) kinds.push([n, type]);
  kinds.forEach(([n, type], k) => {
    let at = [x, y];
    if (n > 1) {
      const angle = Math.trunc((0x10000 * k) / n) & 0xffff;
      at = [x + Math.trunc((DROP_SPREAD * SUBPX * cos4096(angle)) / TRIG_ONE), y + Math.trunc((DROP_SPREAD * SUBPX * sin4096(angle)) / TRIG_ONE)];
    }
    for (let i = 0; i < n; i++) {
      if (type < 0) dropHeart(game, at[0]!, at[1]!);
      else dropGem(game, at[0]!, at[1]!, 0, type);
    }
  });
}

/** A small heart left at (x, y), 1/256 px. */
export function dropHeart(game: AdventureGame, x: number, y: number): void {
  const a = game.adventure;
  a.pickups.push({ id: a.nextId++, type: "heart", from: "HART", actor: -1, x, y, z: 0, kind: 0, gate: 0, tick: 0, vz: 0 });
}

/**
 * A cut or broken bush (GRAS's drop, 0x802CEC10, for the bushes the sword cuts: params 0): 21 times in 100 (rand(100)
 * in 40-60) it leaves something, a green Force Gem when that number is odd, a small heart when it's even.
 * TODO(measure): its odds (a dozen bushes cut in Dolphin left three hearts).
 */
export function dropFromBush(game: AdventureGame, x: number, y: number): void {
  const r = random(game, 100);
  if (r < BUSH_DROP_LOW || r > BUSH_DROP_HIGH) return;
  if (r & 1) dropGem(game, x, y, 0, 0);
  else dropHeart(game, x, y);
}
/** The debris a bush leaves (strike.ts DEBRIS.bush), which adventure.ts looks for. */
export const BUSH_DEBRIS = DEBRIS.bush;
export const BUSH_DROP_LOW = 40;
export const BUSH_DROP_HIGH = 60;

function stepKnock(e: Enemy, world: World): void {
  moveAxis(e, world, e.vx, "x");
  moveAxis(e, world, e.vy, "y");
  e.vx = Math.trunc((e.vx * ENEMY_KNOCK_DECAY) / SUBPX);
  e.vy = Math.trunc((e.vy * ENEMY_KNOCK_DECAY) / SUBPX);
  if (e.tick < ENEMY_KNOCK_TICKS && e.vx * e.vx + e.vy * e.vy >= ENEMY_KNOCK_STOP * ENEMY_KNOCK_STOP) return;
  e.vx = e.vy = 0;
  if (e.life <= 0) return setState(e, "die");
  // Back to what it does (a sword soldier chases on or winds up again; a Keese flies on; a Tektite falls, or jumps at
  // once; a Stalfos picks a walk; a Buzz Blob wanders).
  const after: Partial<Record<string, EnemyState>> = { WIZR: "rest", SLR2: "chase", KETH: "fly", TKTA: e.z > 0 ? "fly" : "rest", STAL: "rest", PEAC: "rest", AMOS: "fly" };
  // (The snake, the Zol and the PAME carry on where they were, their count kept.)
  if (WALKERS.includes(e.type)) e.state = walkerAfterKnock(e);
  else if (e.type === "SLK2") setState(e, shadowAfterKnock(e));
  else setState(e, e.type === "SLR1" ? soldierAfterKnock(e) : (after[e.type] ?? "walk"));
  if (e.type === "KETH") e.timer = KEESE.flyMin;
  if (e.type === "TKTA" || e.type === "STAL") e.timer = 0;
  if (e.type === "PEAC") e.timer = CRAB.hitStop;
  if (e.type === "SLR2") [e.shot2, e.shot] = [Math.max(e.shot2, BOWMAN.engageMin), Math.max(e.shot, BOWMAN.firstShot)];
}

/** The nearest Link a enemy can go for (vulnerable, on the ground) within `range` px, or -1. */
function nearestLink(game: AdventureGame, x: number, y: number, range: number): number {
  let best = -1, bestD = range * range;
  game.players.forEach((p, i) => {
    const f = game.battle.fighters[i]!;
    if (!vulnerable(f) || !onGround(f)) return;
    const dx = Math.floor((p.x - x) / SUBPX), dy = Math.floor((p.y - y) / SUBPX), d = dx * dx + dy * dy;
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/** `angle` turned toward `target` by up to `step` (both 0-65535), the short way round (0x801F714C). */
function turnToward(angle: number, target: number, step: number): number {
  const d = ((target - angle + 0x8000) & 0xffff) - 0x8000;
  return (angle + Math.max(-step, Math.min(step, d))) & 0xffff;
}

/** `v` eased `ease`/10 of the way to `target`, by at most `max` (0x801F71A4); at least 1/256 px, so it gets there. */
function easeTo(v: number, target: number, ease: number, max: number): number {
  const d = target - v, step = Math.trunc((d * ease) / 10) || Math.sign(d);
  return v + Math.max(-max, Math.min(max, step));
}

// --- the Octorok ---

function stepOctorok(game: AdventureGame, stage: AdventureStage, e: Enemy, world: World): void {
  if (e.timer > 0) e.timer--;
  if (e.shot > 0) e.shot--;
  if (e.shot2 > 0) e.shot2--;
  if (e.state === "spit") {
    e.vx = e.vy = 0;
    if (e.tick === OCTOROK.spitTicks) spitRock(game, stage, e);
    if (e.tick >= OCTOROK.spitTicks + OCTOROK.spitAfter) {
      e.shot = OCTOROK.shotMin + random(game, OCTOROK.shotSpread);
      e.shot2 = e.shot >> 1;
      setState(e, "walk");
    }
    return;
  }
  const [dx, dy] = STEP[e.facing];
  e.vx += Math.trunc(((dx * OCTOROK.speed - e.vx) * OCTOROK.ease) / 10);
  e.vy += Math.trunc(((dy * OCTOROK.speed - e.vy) * OCTOROK.ease) / 10);
  const x0 = e.x, y0 = e.y;
  moveAxis(e, world, e.vx, "x");
  moveAxis(e, world, e.vy, "y");
  const blocked = (e.vx !== 0 && e.x - x0 !== e.vx) || (e.vy !== 0 && e.y - y0 !== e.vy);
  if (blocked || e.timer === 0) {
    // Always onto the other axis, either way (0x801400C0).
    e.vx = e.vy = 0;
    const vertical = e.facing === "up" || e.facing === "down";
    e.facing = vertical ? (random(game, 2) ? "left" : "right") : random(game, 2) ? "up" : "down";
    if (e.timer === 0) e.timer = OCTOROK.walkMin + random(game, OCTOROK.walkSpread);
  }
  if (e.kind === 0 && e.shot === 0 && e.shot2 === 0 && linkAhead(game, e)) setState(e, "spit");
}

/** A Link straight ahead along its facing, within its box's width. TODO(measure) the game's test (0x801EEC98). */
function linkAhead(game: AdventureGame, e: Enemy): boolean {
  const [dx, dy] = STEP[e.facing];
  return game.players.some((p, i) => {
    const f = game.battle.fighters[i]!;
    if (!vulnerable(f)) return false;
    const ax = (p.x - e.x) * dx + (p.y - e.y) * dy, across = Math.abs(dx ? p.y - e.y : p.x - e.x);
    return ax > 0 && across <= OCTOROK.half * SUBPX;
  });
}

function spitRock(game: AdventureGame, stage: AdventureStage, e: Enemy): void {
  const [dx, dy] = STEP[e.facing];
  newEnemy(game, "OKTM", e.x + dx * OCTOROK.half * SUBPX, e.y + dy * OCTOROK.half * SUBPX, {
    facing: e.facing,
    state: "fly",
    vx: dx * OCTOROK.rockSpeed,
    vy: dy * OCTOROK.rockSpeed,
    atcp: stage.stats.get("OKTM")?.atcp ?? e.atcp,
    life: 1,
  });
}

// The rock flies straight on until a wall (or a Link) stops it.
// (A Stalfos's bone, kind 2, goes after 300 ticks; an arrow, kind 1, too, and flies through walls its first 5 ticks.)
function stepRock(e: Enemy, world: World): void {
  if (e.kind === FIREBALL_KIND || e.kind === FIRE_TRAP_KIND || e.kind === ICE_KIND) return stepFireball(e, world);
  e.x += e.vx;
  e.y += e.vy;
  const solid = isSolidAt(world, Math.floor(e.x / SUBPX), Math.floor(e.y / SUBPX)) && !(e.kind === ARROW_KIND && e.tick <= BOWMAN.arrowThrough);
  if (solid || e.tick > (e.kind === BONE_KIND ? STALFOS.boneTicks : e.kind === ARROW_KIND ? BOWMAN.arrowTicks : 600)) e.life = -1;
}

/** A bow soldier's arrow (OKTM kind 1) from (x, y), 1/256 px. */
function spawnArrow(game: AdventureGame, stage: AdventureStage, x: number, y: number, vx: number, vy: number): void {
  newEnemy(game, "OKTM", x, y, { kind: ARROW_KIND, state: "fly", vx, vy, facing: vx > 0 ? "right" : vx < 0 ? "left" : vy > 0 ? "down" : "up", atcp: stage.stats.get("OKTM")?.atcp ?? 2, life: 1 });
}

/** An uncut bush (tile type 0x21) at area px (x, y)? */
function bushAt(game: AdventureGame, stage: AdventureStage, x: number, y: number): boolean {
  const tile = (y >> 4) * 32 + (x >> 4);
  return stage.tileTypeAt(currentArea(game, stage), x, y) === BUSH_TILE_TYPE && !game.battle.cut.includes(tile);
}
const BUSH_TILE_TYPE = 0x21;

// --- the Keese ---

function stepKeese(game: AdventureGame, e: Enemy, world: World): void {
  const target = nearestLink(game, e.x, e.y, 1024);
  const p = game.players[target];
  let tx = 0, ty = 0; // the velocity it eases to
  const wings = () => {
    if (e.frameTimer > 0) return;
    e.frame = e.frame >= 2 ? 0 : e.frame + 1;
    e.frameTimer = KEESE.wingTicks;
  };
  if (e.state === "rest") {
    if (e.kind === 3) {
      // Patrolling back and forth on its axis, wings beating.
      const v = Math.trunc((KEESE.patrolSpeed * sin4096(e.angle)) / TRIG_ONE);
      if (e.shot === 0) tx = v;
      else ty = v;
      e.angle = (e.angle + e.turn) & 0xffff;
      wings();
    }
    if (e.timer === 0 && p) {
      const dx = Math.floor((p.x - e.x) / SUBPX), dy = Math.floor((p.y - e.y) / SUBPX);
      if (dx * dx + dy * dy < KEESE.wake * KEESE.wake) {
        // Off it goes, away from the Link at first.
        e.angle = (angleTo(e.x, e.y, p.x, p.y) + 0x8000) & 0xffff;
        e.timer = KEESE.flyMin + random(game, KEESE.flySpread);
        setState(e, "fly");
      }
    }
  } else {
    tx = Math.trunc((KEESE.speed * cos4096(e.angle)) / TRIG_ONE);
    ty = Math.trunc((KEESE.speed * sin4096(e.angle)) / TRIG_ONE);
    if (p) e.angle = turnToward(e.angle, angleTo(e.x, e.y, p.x, p.y), KEESE.turn);
    wings();
    // It lands once its flight is over and its wings are folded, where there's ground (TODO(measure): the game's
    // check, its vtable +0x4C).
    if (e.timer === 0 && e.frame === 2 && !isSolidAt(world, Math.floor(e.x / SUBPX), Math.floor(e.y / SUBPX))) {
      e.timer = KEESE.restMin + random(game, KEESE.restSpread);
      tx = ty = 0;
      setState(e, "rest");
    }
  }
  e.vx = easeTo(e.vx, tx, KEESE.ease, KEESE.maxEase);
  e.vy = easeTo(e.vy, ty, KEESE.ease, KEESE.maxEase);
  // It flies over walls; it stays on the screen (TODO(measure)).
  e.x = Math.max(0, Math.min(world.widthCells * 8 * SUBPX - 1, e.x + e.vx));
  e.y = Math.max(0, Math.min(world.heightCells * 8 * SUBPX - 1, e.y + e.vy));
  if (e.vx || e.vy) e.facing = Math.abs(e.vx) >= Math.abs(e.vy) ? (e.vx > 0 ? "right" : "left") : e.vy > 0 ? "down" : "up";
  if (e.frameTimer > 0) e.frameTimer--;
  if (e.timer > 0) e.timer--;
}

// --- hits ---

const boxesMeet = (a: SubBox, b: SubBox) => a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;

/** Knocks an enemy back from (x, y) with `damage` off its life (`game`: a sword soldier's attack slots, soldiers.ts). */
export function hurtEnemy(e: Enemy, damage: number, x: number, y: number, game?: AdventureGame): void {
  if (!enemyActive(e) || e.invincible > 0 || !hurtable(e)) return;
  if (e.type === "SLR1") {
    if (game) soldierStruck(game, e);
    soldierKnocked(e);
  }
  if (WALKERS.includes(e.type)) walkerKnocked(e);
  // A Wizzrobe's orb or beam goes; a raised Stalfos loses hit points, not life.
  if (e.type === "WIZR" && game) wizzrobeHurt(game, e);
  if (e.type === "STAL" && e.kind === RAISED_KIND) {
    raisedStalfosHit(e, damage);
    damage = 0;
  }
  // A Zora freezes, a Hinox stands its ground while they live.
  if (e.type === "ZORA" && hurtZora(e, damage)) return;
  if (e.type === "HINO" && e.life > damage) {
    e.life -= damage;
    e.invincible = ENEMY_KNOCK_TICKS;
    if (game) strikeHinox(game, e, game.adventure.enemies.find((r) => r.id === e.leader));
    return;
  }
  if (e.type === "OKTM") {
    e.life = -1;
    return;
  }
  // A ball-and-chain soldier is knocked off its walk and reels its ball in (out of life, knocked and dying as any).
  if (e.type === "SLR3" && e.life > damage) {
    e.life -= damage;
    ballSoldierStruck(e, x, y);
    return;
  }
  // (Shadow Link counts hits; his dark form's last one changes him.)
  if (e.type === "SLK2") damage = Math.min(damage, 1);
  e.life = Math.max(0, e.life - damage);
  if (e.type === "SLK2" && game && shadowBeaten(game, e)) return;
  const fell = e.type === "SLK2" && shadowForm(e) === 2 && e.state !== "rest";
  if (e.type === "SLK2") shadowStruck(e, x, y);
  // A bush archer is never knocked back.
  if (e.type === "SLR2" && e.kind === 3) {
    e.invincible = ENEMY_KNOCK_TICKS;
    if (e.life <= 0) setState(e, "die");
    return;
  }
  let [vx, vy] = velocityAlong(e.x - x, e.y - y, ENEMY_KNOCK_SPEED);
  if (vx === 0 && vy === 0) [vx, vy] = [0, ENEMY_KNOCK_SPEED];
  e.vx = vx;
  e.vy = vy;
  e.invincible = fell ? SHADOW.fallGrace : ENEMY_KNOCK_TICKS;
  setState(e, "knock");
}

const hittable = (game: AdventureGame, e: Enemy) => enemyActive(e) && e.invincible <= 0 && enemyShown(game, e) && hurtable(e);

/** Per type, when nothing hurts it: a hidden Tektite, a Stalfos in the air, an unseen Poe or a ghost one. */
function hurtable(e: Enemy): boolean {
  switch (e.type) {
    case "ZSLH":
      return false; // (the minor Shadow Link: what a sword does to him isn't known, minorshadow.ts)
    case "FBGE":
    case "TRAP":
      return false; // (traps.ts: nothing beats them; a sword clanks on a blade trap)
    case "TKTA":
      return e.state !== "hide";
    case "STAL":
      return stalfosHurtable(e) && (e.kind !== RAISED_KIND || raisedStalfosHurtable(e));
    case "WIZR":
      return wizzrobeSolid(e);
    case "POOH":
      return poeSolid(e) && e.kind !== 3 && e.kind !== 7;
    case "AMOS":
      return armosHurtable(e);
    case "PAME":
      return !pameUpright(e);
    case "ZORA":
      return zoraUp(e);
    case "PUKU":
    case "OIWA":
      return false;
    case "OKTM":
      return e.kind !== FIREBALL_KIND && e.kind !== FIRE_TRAP_KIND;
    case "SLR2":
      return bowmanHurtable(e);
    case "SLR3":
      return ballSoldierHurtable(e);
    case "SLK2":
      return shadowHurtable(e);
    default:
      return true;
  }
}

/** A Stalfos's bone (OKTM kind 2) from where it landed, `vx`, `vy` toward the Link. */
function spawnBone(game: AdventureGame, stage: AdventureStage, s: Enemy, vx: number, vy: number): void {
  newEnemy(game, "OKTM", s.x, s.y, { kind: BONE_KIND, state: "fly", z: STALFOS.boneZ, vx, vy, atcp: stage.stats.get("OKTM")?.atcp ?? s.atcp, life: 1 });
}

// Link's sword on enemies (attacks.ts: the attack's two boxes against the enemy's box).
function playerAttacks(game: AdventureGame, world: World): void {
  const b = game.battle;
  game.players.forEach((p, i) => {
    const f = b.fighters[i]!;
    if (f.mode !== "active" || (f.move !== "none" && f.move !== "ready")) return;
    const attack = linkAttack(game, i);
    // A sword meeting an iron ball clanks on it.
    if (!attack || ironBallClanks(game, i, (box) => attackMeets(attack, box)) || bladeClanks(game, i, (box) => attackMeets(attack, box))) return;
    for (const e of game.adventure.enemies) {
      // A Buzz Blob shocks the Link who strikes it; a ghost Poe laughs it off.
      if (e.type === "BZBR" && enemyActive(e) && enemyShown(game, e) && e.state !== "hide" && attackMeets(attack, enemyBox(e))) {
        shock(game, e, i);
        continue;
      }
      if (e.type === "POOH" && (e.kind === 3 || e.kind === 7) && poeSolid(e) && attackMeets(attack, enemyBox(e))) {
        poeLaugh(e);
        continue;
      }
      // A PAME upright: a big one's shell turns the sword, a small walking one is kicked away.
      if (e.type === "PAME" && enemyActive(e) && enemyShown(game, e) && e.invincible <= 0 && attackMeets(attack, enemyBox(e)) && !pameStruck(game, world, e, i)) continue;
      // Shadow Link: only the sword of his tunic's color, past his shield and his own sword; another's he jumps over
      // (down, it gets him up).
      if (e.type === "SLK2" && (!enemyActive(e) || shadowParries(game, e, i, attack, enemyBox(e)))) continue;
      if (!hittable(game, e) || !attackMeets(attack, enemyBox(e))) continue;
      e.hitBy = i;
      // A captain's shield stops the sword of the Link it faces: no harm, pushed back.
      hurtEnemy(e, e.type === "SLR4" && shieldStops(e, p.x, p.y) ? 0 : attack.power, p.x, p.y, game);
    }
  });
}

// The arena's things on enemies: thrown loads, blasts, arrows (battle entities, entities.ts).
function arenaAttacks(game: AdventureGame): void {
  const b = game.battle;
  for (const x of b.entities) {
    if (isRemoved(x)) continue;
    const thrown = x.phase === "flying" && (x.kind === "bush" || x.kind === "pot" || x.kind === "orb");
    const shot = x.kind === "arrow" && x.phase === "flying";
    const blast = x.kind === "explosion";
    if (!thrown && !shot && !blast) continue;
    const h = (blast ? 16 : 4) * SUBPX;
    const box = { left: x.x - h, top: x.y - h, right: x.x + h, bottom: x.y + h };
    for (const e of game.adventure.enemies) {
      if (!hittable(game, e) || !boxesMeet(box, enemyBox(e)) || (e.type === "SLK2" && !shadowMatches(game, e, x.owner))) continue;
      if (x.owner >= 0) e.hitBy = x.owner;
      // A Hinox: only a blast hurts it (the bomb's atcn); the rest strikes it.
      if (e.type === "HINO" && !blast) strikeHinox(game, e, game.adventure.enemies.find((r) => r.id === e.leader));
      else hurtEnemy(e, e.type === "HINO" ? HINOX.blastDamage : blast ? BLAST_DAMAGE : shot ? ARROW_ENEMY_DAMAGE : Math.max(THROWN_DAMAGE[x.kind] ?? 1, 2), x.x, x.y, game);
      if (thrown || shot) removeEntity(x);
      if (thrown) spawnEntity(b, "debris", x.x, x.y, { param: x.kind === "pot" ? DEBRIS.pot : DEBRIS.bush, timer: DEBRIS_TICKS });
      if (!blast) break;
    }
  }
}

/** A captain's spear: its atcp (hit type 1) by the box ahead of it; lunging, 4 (hit type 3). */
function spears(game: AdventureGame): void {
  const b = game.battle;
  for (const e of game.adventure.enemies) {
    if (e.type !== "SLR4" || !enemyActive(e) || e.state === "knock" || !enemyShown(game, e)) continue;
    const box = spearBox(e);
    game.players.forEach((p, i) => {
      const f = b.fighters[i]!, h = 7 * SUBPX;
      if (!vulnerable(f) || !onGround(f) || !boxesMeet(box, { left: p.x - h, top: p.y - h, right: p.x + h, bottom: p.y + h })) return;
      const lunge = e.state === "fly";
      const hit = hurtFighter(p, f, i, lunge ? CAPTAIN.lungeDamage : e.atcp, e.x, e.y, { cause: "soldier", blockable: true, ...(lunge ? { knock: KNOCK_HARD } : {}) });
      if (hit) b.hits.push(hit);
    });
  }
}

/** A ball-and-chain soldier's ball: 2 (hit type 3) to a Link it touches. */
function ironBalls(game: AdventureGame): void {
  const b = game.battle;
  for (const e of game.adventure.enemies) {
    if (e.type !== "SLR3" || !enemyActive(e) || e.state === "knock" || !enemyShown(game, e)) continue;
    const box = ironBallBox(e), x = (box.left + box.right) >> 1, y = (box.top + box.bottom) >> 1;
    game.players.forEach((p, i) => {
      const f = b.fighters[i]!, h = 7 * SUBPX;
      if (!vulnerable(f) || !onGround(f) || !boxesMeet(box, { left: p.x - h, top: p.y - h, right: p.x + h, bottom: p.y + h })) return;
      const hit = hurtFighter(p, f, i, BALL_SOLDIER.ballDamage, x, y, { cause: "soldier", knock: BALL_KNOCK });
      if (hit) b.hits.push(hit);
    });
  }
}

/** Enemies hurt the Links they touch by their atcp (hit type 1: the sword's knockback, away from the enemy). */
function contact(game: AdventureGame): void {
  const b = game.battle;
  spears(game);
  ironBalls(game);
  for (const e of game.adventure.enemies) {
    if (!enemyActive(e) || e.state === "knock" || e.atcp <= 0 || !enemyShown(game, e)) continue;
    // Not while it's hidden or in a Stalfos's air (or grace); Shadow Link hurts with his sword (shadowlink.ts), not by touch.
    if (e.state === "hide" || e.type === "SLK2" || (e.type === "STAL" && !stalfosHurtable(e)) || (e.type === "AMOS" && e.state !== "fly") || (e.type === "PAME" && !pameHarms(e)) || (e.type === "ZORA" && !zoraUp(e)) || (e.type === "OIWA" && !rockHurts(e)) || (e.type === "WIZR" && !wizzrobeHurts(e)) || (e.type === "STAL" && e.kind === RAISED_KIND && !raisedStalfosHurts(e))) continue;
    const box = enemyBox(e);
    game.players.forEach((p, i) => {
      const f = b.fighters[i]!;
      if (!vulnerable(f) || !onGround(f)) return;
      const h = 7 * SUBPX;
      if (!boxesMeet(box, { left: p.x - h, top: p.y - h, right: p.x + h, bottom: p.y + h })) return;
      // A Buzz Blob shocks (hit type 10) instead.
      if (e.type === "BZBR") return shock(game, e, i);
      // A lunging captain: 4, hit type 3.
      if (e.type === "SLR4" && e.state === "fly") {
        const hit = hurtFighter(p, f, i, CAPTAIN.lungeDamage, e.x, e.y, { cause: "soldier", knock: KNOCK_HARD });
        if (hit) b.hits.push(hit);
        return;
      }
      // A Hinox: charging 4 (hit type 3); its rock 2 (hit type 6).
      if (e.type === "HINO" || e.type === "OIWA") {
        const c = e.type === "HINO" ? hinoxContact(e) : { damage: e.atcp, knock: KNOCK_HARD };
        const hit = hurtFighter(p, f, i, c.damage, e.x, e.y, { cause: e.type === "OIWA" ? "rock" : "enemy", ...(c.knock ? { knock: c.knock } : {}) });
        if (hit) b.hits.push(hit);
        if (hit && e.type === "OIWA") e.life = -1;
        return;
      }
      // A rock or a soldier's sword is stopped by a shield facing it (assumed, as Shadow Battle's shots and soldiers).
      const blockable = e.type === "OKTM" || e.type === "SLR1";
      // (A big rat's bite: hit type 4.)
      const knock = e.type === "NZMI" && e.kind === 1 ? KNOCK_SLOW : undefined;
      const hit = hurtFighter(p, f, i, e.atcp, e.x, e.y, { cause: e.type === "OKTM" ? "rock" : e.type === "SLR1" ? "soldier" : "enemy", blockable, ...(knock ? { knock } : {}) });
      if (hit) b.hits.push(hit);
      if (hit && e.type === "NZMI") e.grace = 1; // (a bite: the rat runs off)
      if (e.type === "PAME") e.grace |= 1 << i; // (a sliding one bounces off him)
      if (hit && e.type === "PUKU") e.vz = 1; // (a big one's charge ends on a bite)
      if (e.type === "OKTM") e.life = -1;
    });
  }
}
