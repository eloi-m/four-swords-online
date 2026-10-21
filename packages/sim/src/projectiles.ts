// Things flying through the arena. Measured in Dolphin (docs/measurements/battle-combat.md) unless marked TODO(measure):
// - thrown loads: a bush flies 4 px/tick from 20 px up falling 0.1 px/tick² and breaks where it lands or where a
//   ±4 px box meets a wall; a bomb flies 6 px/tick falling 0.15, bounces once (1.8 along, 3.0 up, 1.0 px/tick²) and
//   lies still, burning (carry.ts has the constants); a pot flies as the bomb and breaks where it lands (traced in
//   the Tower of Flames). Orbs are assumed to fly like the bush.
// - arrows: 5 px/tick straight, no range limit; they stick in the wall they hit for 35 ticks.
// - the boomerang: 6 px/tick for 4 ticks, slowing by 0.2 per tick to 1.8, then ×0.9 per tick while ≥ 1 (about 115 px
//   out), then back to its thrower at 5.8 px/tick, homing; at level 2 3 px/tick faster both ways (traced in battle).
//   In battle it also fetches released items (TODO(measure)).
// - slingshot seeds: 5 px/tick, down after 19 ticks (95 px; the bounce isn't modelled), arcing up to 6 px (SEED_ARC);
//   a drawn seed flies on to the wall on the ground (traced; its bounce back off it isn't modelled either).
// On Links in Shadow Battle (traced, docs/measurements/battle-combat.md "Battle measurements: combat" and "Items, levels and the Four
// Sword"): a quick arrow takes 1 life with the sword's knockback away from the arrow; a drawn one (items.ts) 2, and
// carries the Link along (combat.ts pinFighter); a quick seed stuns (combat.ts stunFighter), a drawn one takes 1 with
// the sword's knockback; the boomerang hooks the Link and drags him to its thrower (combat.ts hookFighter); a thrown
// Link bowls over the first other Link he meets.
import { bodyBox, subBoxesOverlap } from "./attacks.ts";
import type { BattleState } from "./battle.ts";
import { BOMB_BOUNCE, BOMB_THROW_GRAVITY, THROW_GRAVITY, WALL_PROBE } from "./carry.ts";
import { hookFighter, hurtbox, hurtFighter, KNOCK_SLOW, PIN_CARRY_TICKS, pinFighter, stunFighter, vulnerable, type Fighter, type PixelBox } from "./combat.ts";
import { boxAround, boxesOverlap, distance2, FACING_STEP, isRemoved, removeEntity, setPhase, spawnEntity, velocityAlong, type Entity, type EntityKind } from "./entities.ts";
import type { GameState } from "./game.ts";
import { breakOrb, giveItem, takenByHand } from "./orbs.ts";
import { SUBPX, type Facing, type PlayerState } from "./player.ts";
import { FALL_HALF, fallStep, sameScreen, screenAt, SIDE_GRAVITY, sideRoomY, sideViewAt } from "./siderooms.ts";
import { DEBRIS, DEBRIS_TICKS, strikeEntity, struckBy, THROWN_DAMAGE } from "./strike.ts";
import { isSolidAt, type World } from "./world.ts";

/**
 * THCL "attack when a player is thrown": its atcp 2 (0x8029D4A8 passes it in multiplayer), hit type 4 (0.75 px/tick, a
 * 4.0 hop); it rides with the thrown Link and hits the first other Link (not the thrower), then goes away, the thrown
 * Link flying on (traced: 2 life, 0.75 and 4.0, on a Link 14.5 px ahead but not at 17.8).
 */
export const THROWN_LINK_DAMAGE = THROWN_DAMAGE.link!;
/** THCL's box: ±8 px around the thrown Link (between the traced 14.5 px hit and 17.8 px miss, with the ±7 px body). */
export const THROWN_LINK_HALF = 8;
export { THROWN_DAMAGE };

export const ARROW_SPEED = 1280; // 5 px/tick (measured)
export const ARROW_STUCK_TICKS = 35; // stuck in the wall (measured)
export const ARROW_DAMAGE = 1; // a quick shot (traced; main.dol ARRW 0x80165E84: 1, type 1, and 2 drawn: PIN_DAMAGE)
export const SEED_SPEED = 1280; // 5 px/tick (measured)
export const SEED_TICKS = 19; // a quick seed lands 95 px out (measured)
/** The level-2 drawn shot's side seeds: 3.5 px/tick on both axes, 45° off the middle one (traced). */
export const SEED_SIDE = 896;
export const SEED_DAMAGE = 0; // a quick seed only stuns (traced; main.dol PCDM 0x80324380: type 11)
export const DRAWN_SEED_DAMAGE = 1; // a drawn one (traced: 1, the sword's knockback; PCDM kind 0: 1, type 1)
export const BOOMERANG_SPEED = 1536; // 6 px/tick for its first 4 ticks (measured)
export const BOOMERANG_FAST_TICKS = 4;
export const BOOMERANG_SLOWDOWN = 51; // 0.2 px/tick per tick (measured; 51.2 in 1/256 px)
export const BOOMERANG_CRUISE = 461; // down to 1.8 px/tick, then ×0.9 per tick while ≥ 1 px/tick (measured)
export const BOOMERANG_RETURN_SPEED = 1485; // 5.8 px/tick, homing (measured)
/** A level-2 boomerang flies 3 px/tick faster: 9 out, 8.8 back (traced in battle). */
export const BOOMERANG_LEVEL2 = 768;
export const BOOMERANG_DAMAGE = 0; // it hooks the Link instead (traced; main.dol: state 66, 0x8025AA8C)
/** Arrows, the boomerang and drawn seeds fly on the ground: their height (+0x14) stays 0, and the game draws them at their
 *  position, the sprite's own offset putting them at chest height (traced: ARRW, PCDM kind 0, the boomerang). */
export const SHOT_HEIGHT = 0;
/** A quick seed is lobbed (traced: PCDM kind 1's height 1.044, 1.988, 2.831 … up to 5.98 on its 11th tick): up at
 *  1.0438 px/tick on its first tick, falling 0.1 px/tick². 1/256 px by its tick (1 = the tick it shows where it
 *  appeared). Drawing only: it hits as on the ground. */
export const seedArc = (tick: number): number => Math.max(0, Math.round(SUBPX * (1.0438 * tick - 0.05 * tick * (tick - 1))));
export const SHOT_LIFETIME = 600; // safety net: a shot that never hits anything goes away

const SHOTS = new Set<EntityKind>(["arrow", "seed"]);
const THROWABLES = new Set<EntityKind>(["pot", "bush", "orb", "bomb"]);
const SHOT_HALF = 3;
/** A seed hits a Link from 15 px away: ±8 px around it (traced: a quick seed and a drawn one, the drawn one knocking
 *  the Link along the line from 15 px behind and 4 px above his anchor). */
export const SEED_HALF = 8;
const inclusiveBox = (x: number, y: number, h: number): PixelBox => {
  const px = Math.floor(x / SUBPX), py = Math.floor(y / SUBPX);
  return { left: px - h, top: py - h, right: px + h, bottom: py + h };
};

const px = (v: number) => Math.floor(v / SUBPX);

function blocked(world: World, x: number, y: number): boolean {
  return isSolidAt(world, px(x), px(y));
}

/** Does a ±WALL_PROBE px box around (x, y) touch a wall? */
function wallAround(world: World, x: number, y: number): boolean {
  const cx = px(x), cy = px(y), r = WALL_PROBE;
  return isSolidAt(world, cx - r, cy - r) || isSolidAt(world, cx + r, cy - r) || isSolidAt(world, cx - r, cy + r) || isSolidAt(world, cx + r, cy + r);
}

/** The first fighter a flying thing overlapping `box` hits (not its owner, not someone it already hit). */
function victimOf(state: GameState, e: Entity, box: PixelBox): number {
  const b = state.battle!;
  const owner = e.owner >= 0 ? b.fighters[e.owner]! : null;
  return b.fighters.findIndex(
    (f, i) => i !== e.owner && !(e.hitMask & (1 << i)) && vulnerable(f) && boxesOverlap(box, hurtbox(state.players[i]!)),
  );
}

function hitLink(state: GameState, e: Entity, i: number, damage: number, cause: string, blockable: boolean): boolean {
  const b = state.battle!;
  e.hitMask |= 1 << i;
  // Shots knock away from where they are (traced: an arrow 5 px behind and 4 px above the Link's anchor knocked him
  // along that line); thrown loads from where they came from.
  const shot = e.kind === "arrow" || e.kind === "seed";
  const hit = hurtFighter(state.players[i]!, b.fighters[i]!, i, damage, shot ? e.x : e.x - e.vx * 4, shot ? e.y : e.y - e.vy * 4, { attacker: e.owner, cause, blockable });
  if (hit) b.hits.push(hit);
  return hit !== null;
}

/** Breaks a thrown load where it landed or hit something; a bomb lies there, still burning. */
function land(b: BattleState, e: Entity): void {
  const [vx, vy] = [e.vx, e.vy];
  e.z = e.vz = e.vx = e.vy = 0;
  switch (e.kind) {
    case "orb":
      breakOrb(b, e, vx, sideViewAt(b, e.y) ? 0 : vy);
      return;
    case "pot":
    case "bush":
      removeEntity(e);
      spawnEntity(b, "debris", e.x, e.y, { param: e.kind === "pot" ? DEBRIS.pot : DEBRIS.bush, timer: DEBRIS_TICKS });
      return;
    default:
      setPhase(e, "rest");
  }
}

/** A flying load meets a Link or a thing: returns true when that ends its flight (a bomb only stops and drops). */
function thrownHits(state: GameState, e: Entity): boolean {
  const b = state.battle!, bomb = e.kind === "bomb";
  const box = boxAround(e.x, e.y, 5);
  const damage = THROWN_DAMAGE[e.kind] ?? 0;
  const victim = victimOf(state, e, box);
  if (victim >= 0) {
    if (damage > 0) hitLink(state, e, victim, damage, "thrown", true);
    else e.hitMask |= 1 << victim;
    if (bomb) e.vx = e.vy = 0; // bounces off and drops
    else return land(b, e), true;
  }
  for (const other of struckBy(b, box)) {
    if (other === e) continue;
    strikeEntity(b, other, Math.max(1, damage), e.x, e.y);
    if (!bomb) return land(b, e), true;
  }
  return false;
}

/**
 * A load flying on a side-view screen (siderooms.ts SIDE_GRAVITY): its height went into screen y when it left the hand
 * (measured: a pot), and it falls as it flies, a bush 0.1 px/tick² (as on the ground), the rest 0.15 (measured: a pot),
 * until it lands on the ground under it or hits a wall. TODO(measure): a thrown bomb's bounce here (none).
 */
function stepThrownSide(state: GameState, e: Entity, world: World): void {
  const b = state.battle!, bomb = e.kind === "bomb";
  e.tick++;
  if (e.z > 0) [e.y, e.z, e.vz] = [e.y - e.z, 0, 0]; // (dropped from overhead)
  if (e.vx) {
    const nx = e.x + e.vx;
    if (wallAround(world, nx, e.y)) {
      e.vx = 0;
      if (!bomb) return land(b, e);
    } else e.x = nx;
  }
  if ((e.vx || e.vy) && thrownHits(state, e)) return;
  // A ceiling; the room's top edge is none (traced: a bomb come out of Above the Clouds' hole rose 3.7 px past it), but
  // here nothing leaves its screen that way: it stops at the edge.
  const top = sideRoomY(screenAt(e.y)) * SUBPX;
  if (e.vy < 0 && px(e.y + e.vy) - FALL_HALF >= top / SUBPX && isSolidAt(world, px(e.x), px(e.y + e.vy) - FALL_HALF)) e.vy = 0;
  const landed = fallStep(world, e, e.kind === "bush" ? THROW_GRAVITY : SIDE_GRAVITY);
  if (e.y < top) [e.y, e.vy] = [top, 0];
  if (landed) land(b, e);
}

// A bomb's `param`: 0 thrown (it will bounce), 1 dropped (no bounce), 2 bouncing.
function stepThrown(state: GameState, e: Entity, world: World): void {
  const b = state.battle!;
  if (sideViewAt(b, e.y)) return stepThrownSide(state, e, world);
  const bomb = e.kind === "bomb";
  e.tick++;
  if (e.vx || e.vy) {
    const nx = e.x + e.vx, ny = e.y + e.vy;
    if (wallAround(world, nx, ny)) {
      e.vx = e.vy = 0; // stopped by the wall
      if (!bomb) return land(b, e);
    } else {
      e.x = nx;
      e.y = ny;
    }
  }
  e.vz -= bomb ? (e.param === 2 ? BOMB_BOUNCE.gravity : BOMB_THROW_GRAVITY) : e.kind === "pot" ? BOMB_THROW_GRAVITY : THROW_GRAVITY;
  e.z += e.vz;
  if ((e.vx || e.vy) && thrownHits(state, e)) return;
  if (e.z > 0) return;
  e.z = 0;
  if (bomb && e.param === 0) {
    e.param = 2;
    e.vz = BOMB_BOUNCE.hop;
    const [sx, sy] = [Math.sign(e.vx), Math.sign(e.vy)];
    e.vx = sx * BOMB_BOUNCE.speed;
    e.vy = sy * BOMB_BOUNCE.speed;
  } else land(b, e);
}

/**
 * A drawn arrow carries the Link it hit (combat.ts pinFighter; traced): from the tick after the hit he's moved onto the
 * arrow's position before it moves on (15/16 of the way on that first tick, then onto it), 13 ticks, facing the
 * shooter.
 */
function carryPinned(state: GameState, e: Entity): void {
  const p = state.players[e.target], f = state.battle!.fighters[e.target];
  if (!p || !f || f.mode !== "pinned" || f.modeTick < 1 || f.modeTick > PIN_CARRY_TICKS) {
    if (!f || f.mode !== "pinned" || f.modeTick > PIN_CARRY_TICKS) e.target = -1;
    return;
  }
  if (f.modeTick === 1) {
    const [sx, sy] = FACING_STEP[e.facing];
    p.facing = sx > 0 ? "left" : sx < 0 ? "right" : sy > 0 ? "up" : "down";
    p.x += Math.trunc(((e.x - p.x) * 15) / 16);
    p.y += Math.trunc(((e.y - p.y) * 15) / 16);
  } else [p.x, p.y] = [e.x, e.y];
}

function stepShot(state: GameState, e: Entity, world: World): void {
  const b = state.battle!;
  e.tick++;
  if (e.phase === "rest") {
    if (--e.timer <= 0) removeEntity(e); // an arrow stuck in the wall
    return;
  }
  if (e.target >= 0) carryPinned(state, e);
  // It shows where it appeared on its first tick and flies from the next (traced: an arrow shot at a Link 55 px away
  // hit him on its 10th tick, 5 px behind and 4 px above his anchor).
  if (e.tick > 1) {
    e.x += e.vx;
    e.y += e.vy;
  }
  const drawn = (e.param & SHOT_DRAWN) !== 0;
  if (e.kind === "seed" && !drawn) e.z = seedArc(e.tick);
  if (blocked(world, e.x, e.y)) {
    e.target = -1;
    if (e.kind !== "arrow") return removeEntity(e);
    e.x -= e.vx; // it sticks in the wall
    e.y -= e.vy;
    setPhase(e, "rest");
    e.timer = ARROW_STUCK_TICKS;
    return;
  }
  if ((e.kind === "seed" && !drawn && e.tick > SEED_TICKS) || e.tick > SHOT_LIFETIME) return removeEntity(e);
  const box = e.kind === "seed" ? inclusiveBox(e.x, e.y, SEED_HALF) : boxAround(e.x, e.y, SHOT_HALF);
  const victim = victimOf(state, e, box);
  if (victim >= 0) {
    if (e.kind === "seed" && drawn) hitLink(state, e, victim, DRAWN_SEED_DAMAGE, "seed", true);
    else if (e.kind === "seed") {
      e.hitMask |= 1 << victim;
      if (stunFighter(state.players[victim]!, b.fighters[victim]!)) b.hits.push({ attacker: e.owner, victim, blocked: false, damage: 0, cause: "seed" });
    } else if (drawn) {
      // It flies on with him (the hit Link's bit stays in hitMask).
      e.hitMask |= 1 << victim;
      const hit = pinFighter(state.players[victim]!, b.fighters[victim]!, victim, e.x, e.y, { attacker: e.owner, cause: "arrow" });
      if (hit) b.hits.push(hit);
      if (hit && !hit.blocked) {
        e.target = victim;
        return;
      }
    } else hitLink(state, e, victim, ARROW_DAMAGE, "arrow", true);
    return removeEntity(e);
  }
  const target = struckBy(b, box)[0];
  if (target) {
    strikeEntity(b, target, e.kind === "seed" ? SEED_DAMAGE : ARROW_DAMAGE, e.x, e.y);
    removeEntity(e);
  }
}

/** It hooks a Link whose body its ±12 px box meets (traced: 10.6 and 9.2 px short of his body hooked him, 12.2 not). */
export const BOOMERANG_HOOK_HALF = 12;
/** It's caught once its step back ends this close to its thrower (traced: 12.8 and 14.4 px caught, 18.6 not). */
export const BOOMERANG_CATCH = 16; // px

// The boomerang keeps its speed (1/256 px per tick) in `param` on the way out, its speed back in `timer`. Hooking a
// Link turns it straight back by its speed out (`param` negated for that one step), then home at the level-1 speed
// back (traced, either level). Caught, it shows at its thrower ("rest") for a tick, then it's gone.
function stepBoomerang(state: GameState, e: Entity, world: World): void {
  const b = state.battle!;
  const owner = e.owner >= 0 ? state.players[e.owner] : undefined;
  e.tick++;
  if (e.phase === "rest") return removeEntity(e);
  if (e.phase === "flying" && e.tick === 1) {
    // It shows where it appeared on its first tick, as shots do (traced: 206, then 212 at level 1; 209, 218 at 2).
  } else if (e.phase === "flying") {
    const [sx, sy] = FACING_STEP[e.facing];
    const speed = e.param;
    e.vx = sx * speed;
    e.vy = sy * speed;
    e.x += e.vx;
    e.y += e.vy;
    if (e.tick >= BOOMERANG_FAST_TICKS) {
      e.param = e.param > BOOMERANG_CRUISE ? Math.max(BOOMERANG_CRUISE, e.param - BOOMERANG_SLOWDOWN) : Math.trunc((e.param * 9) / 10);
    }
    // Its last step under 1 px/tick, then a tick still, then home (traced: 310.43, 311.39, 311.39, 305.59).
    if (blocked(world, e.x, e.y) || speed < SUBPX) {
      if (blocked(world, e.x, e.y)) {
        e.x -= e.vx;
        e.y -= e.vy;
      }
      setPhase(e, "return");
      e.param = 0;
    }
  } else if (e.tick === 1 && e.param === 0) {
    // (the tick still)
  } else {
    if (!owner || b.fighters[e.owner]!.hearts <= 0 || e.tick > SHOT_LIFETIME) return removeEntity(e);
    // Gone through a door or a hole (siderooms.ts thingWarps), it comes back the same way: home to where it came out,
    // and once its step ends within three steps of it, back where it went in (traced through The Field's house door:
    // 12.4 px short at level 1, 23.6 at level 2; 18.2 and 41 not), homing on its thrower from there. (Its thrower
    // gone through a door himself: it doesn't follow him into another room.)
    const away = !sameScreen(owner, e);
    const through = away && e.warpX !== 0 && screenAt(e.homeY) !== screenAt(e.y) && screenAt(e.homeY) === screenAt(owner.y);
    if (away && !through) return removeEntity(e);
    const [gx, gy] = through ? [e.warpX, e.warpY] : [owner.x, owner.y];
    const speed = e.timer || BOOMERANG_RETURN_SPEED;
    if (e.param < 0) {
      const [sx, sy] = FACING_STEP[e.facing];
      [e.vx, e.vy] = [sx * e.param, sy * e.param];
      e.param = 0;
    } else [e.vx, e.vy] = velocityAlong(gx - e.x, gy - e.y, speed);
    e.x += e.vx;
    e.y += e.vy;
    const back = through && distance2(e.x, e.y, gx, gy) < (3 * speed * 3 * speed) / (SUBPX * SUBPX);
    if (back) [e.x, e.y, e.warpX, e.warpY] = [e.homeX, e.homeY, 0, 0]; // (shown there for a tick: traced)
    if (!through && distance2(e.x, e.y, owner.x, owner.y) < BOOMERANG_CATCH ** 2) {
      // Caught: a fetched item goes to the thrower.
      if (e.item) giveItem(b.fighters[e.owner]!, e.item, b, e.angle || 1);
      e.item = "";
      [e.x, e.y] = [owner.x, owner.y];
      setPhase(e, "rest");
      return;
    }
  }
  const box = boxAround(e.x, e.y, 4);
  const victim = victimOf(state, e, boxAround(e.x, e.y, BOOMERANG_HOOK_HALF));
  if (victim >= 0) {
    e.hitMask |= 1 << victim;
    if (hookFighter(state.players[victim]!, b.fighters[victim]!, e.owner)) b.hits.push({ attacker: e.owner, victim, blocked: false, damage: 0, cause: "boomerang" });
    if (e.phase === "flying") {
      setPhase(e, "return");
      e.param = -e.param;
      e.timer = BOOMERANG_RETURN_SPEED;
    }
  }
  for (const other of struckBy(b, box)) strikeEntity(b, other, BOOMERANG_DAMAGE, e.x, e.y);
  if (!e.item) {
    const pickup = b.entities.find((o) => takenByHand(o) && !isRemoved(o) && boxesOverlap(box, boxAround(o.x, o.y, 6)));
    if (pickup) {
      e.item = pickup.item;
      e.angle = pickup.param; // (its level)
      removeEntity(pickup);
      if (e.phase === "flying") setPhase(e, "return");
    }
  }
}

/** Moves everything that flies, and resolves what it hits. */
export function stepProjectiles(state: GameState, world: World, arrowWorld: World = world): void {
  const b = state.battle!;
  for (const e of b.entities) {
    if (isRemoved(e)) continue;
    if (THROWABLES.has(e.kind) && e.phase === "flying") stepThrown(state, e, world);
    else if (SHOTS.has(e.kind)) stepShot(state, e, e.kind === "arrow" ? arrowWorld : world);
    else if (e.kind === "boomerang") stepBoomerang(state, e, world);
  }
  thrownLinkHits(state);
}

/** A thrown Link bowls over the first Link he flies into (THCL), then flies on (traced). */
function thrownLinkHits(state: GameState): void {
  const b = state.battle!;
  b.fighters.forEach((f: Fighter, j) => {
    if (f.move !== "thrown" || f.thrower < 0 || (f.flyX === 0 && f.flyY === 0)) return;
    const pj: PlayerState = state.players[j]!;
    const h = THROWN_LINK_HALF * SUBPX, box = { left: pj.x - h, top: pj.y - h, right: pj.x + h, bottom: pj.y + h };
    const k = b.fighters.findIndex((g, i) => i !== j && i !== f.thrower && vulnerable(g) && subBoxesOverlap(box, bodyBox(state.players[i]!)));
    if (k < 0) return;
    const hit = hurtFighter(state.players[k]!, b.fighters[k]!, k, THROWN_LINK_DAMAGE, pj.x, pj.y, { attacker: f.thrower, cause: "thrown", knock: KNOCK_SLOW });
    if (hit) b.hits.push(hit);
    f.thrower = -1; // THCL is spent
  });
}

/**
 * Where an arrow or a seed appears, relative to Link (px): measured facing down (0, +5), left (-5, -4), right (5, -4)
 * and up (-2, -5: an arrow and a seed shot up into The Field's house door).
 */
export const SHOT_SPAWN: Readonly<Record<Facing, readonly [number, number]>> = { right: [5, -4], left: [-5, -4], down: [0, 5], up: [-2, -5] };

/** Arrow and seed flags (Entity.param): drawn (main.dol's kind 0: items.ts). */
export const SHOT_DRAWN = 1;

/**
 * Launches a shot from a Link: arrows and seeds at SHOT_SPAWN (`param` their SHOT_ flags), others `out` px ahead (the
 * boomerang 6, measured; `param` its level). A boomerang keeps its speed out in `param` and back in `timer`.
 */
export function shoot(b: BattleState, kind: EntityKind, owner: number, p: PlayerState, vx: number, vy: number, out = 8, param = 0): Entity {
  const [fx, fy] = FACING_STEP[p.facing];
  const [dx, dy] = kind === "arrow" || kind === "seed" ? SHOT_SPAWN[p.facing] : [fx * out, fy * out];
  const faster = kind === "boomerang" && param >= 2 ? BOOMERANG_LEVEL2 : 0;
  return spawnEntity(b, kind, p.x + dx * SUBPX, p.y + dy * SUBPX, {
    owner,
    vx,
    vy,
    z: SHOT_HEIGHT,
    facing: p.facing,
    phase: "flying",
    hitMask: 1 << owner,
    param: kind === "boomerang" ? BOOMERANG_SPEED + faster : param,
    timer: kind === "boomerang" ? BOOMERANG_RETURN_SPEED + faster : 0,
  });
}
