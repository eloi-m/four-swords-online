// Lifting, carrying, throwing and slamming (the Action button: R on the GameCube pad, read as the analog trigger).
// Measured in Dolphin (docs/measurements/battle-combat.md, "Lifting, throwing, rolling, damage and items"):
// - Link lifts what's under the point 16 px in front of him (he needs not touch it). The press tick P decides; the lift
//   plays from P+1 for 24 ticks while the load stays 16 px in front on the ground (15 ticks), then 12 px in front 8 px
//   up (8 ticks), then on his head; carrying starts on P+25, the load 18 px up, bobbing with the walk.
// - Carrying walks at walking speed, moving on the first input tick (no turn tick).
// - Action or Item while carrying throws (24 ticks): the load goes 6 px behind, back on his head, and leaves on the
//   11th tick along the facing: a bush at 4 px/tick from 20 px up, falling 0.1 px/tick² (breaks on its 20th tick,
//   80 px out); a bomb at 6 px/tick falling 0.15 (lands on its 16th tick, 96 px out, then bounces once).
// - Sword while carrying slams the load on the ground 16 px in front (22 ticks) and carries on.
// In Shadow Battle Links lift each other too (traced in battle, docs/measurements/battle-combat.md "Battle measurements: combat"):
// the lift and throw play as for a bush, the held Link 2 px higher and 2 px lower on the ground; he's held for as long
// as the carrier likes, and wriggles free on his 17th press of a direction. Thrown or wriggling free, he hops off
// along the carrier's facing at 3.3 px/tick from 18 px up (13 ticks, 42.9 px), bowls over the first other Link he
// flies into (projectiles.ts) and lands unhurt, or falls if he lands over a pit. Getting hurt or falling drops the load.
import { BOMB_FUSE } from "./bombs.ts";
import type { BattleState } from "./battle.ts";
import { hurtbox, stopActing, stunFighter, vulnerable, type Fighter } from "./combat.ts";
import { boxAround, boxesOverlap, entityById, FACING_STEP, isRemoved, pointInBox, setPhase, spawnEntity, TILE, tileIndexAt, ROOM_TILES_X, type Entity } from "./entities.ts";
import type { GameState } from "./game.ts";
import { CARRY, carryStep, HELD, LIFT, SLAM, sumTicks, THROW, THROW_RELEASE_TICK } from "./moveframes.ts";
import { Button, moveAxis, stepPlayer, SUBPX, type PlayerState } from "./player.ts";
import { sideViewAt } from "./siderooms.ts";
import { strikeAt } from "./strike.ts";
import type { World } from "./world.ts";

export const LIFT_REACH = 16; // px ahead of the anchor: the point that must be on the object (measured)
/**
 * Carrying a Link walks at 1.25 px/tick, 0.884 per axis on a diagonal (traced in The Field: 288.75, 287.5 … then
 * 213.23, 212.35 …); carrying a thing at walking speed, 1.5 (traced with the Tower of Flames' socket bomb).
 */
export const CARRY_LINK_SPEEDS = [320, 226] as const;
export const LIFT_TICKS = sumTicks(LIFT.ticks); // 24 (measured)
export const THROW_TICKS = sumTicks(THROW.ticks); // 24 (measured)
export const SLAM_TICKS = sumTicks(SLAM.ticks); // 22 (measured)
export const CARRY_HEIGHT = 18 * SUBPX; // the load over the carrier's anchor while carrying (measured)
export const HOLD_HEIGHT = CARRY_HEIGHT;
/** A held Link rides 2 px higher than a load (z 2, 10, 18 while lifted, 20 carried, 17, 19, 22 through the throw) and
 *  2 px lower on the ground (traced). */
export const HOLD_HEIGHT_LINK = CARRY_HEIGHT + 2 * SUBPX;
export const HOLD_LINK_RAISE = 2;
export const HOLD_LINK_DROP_Y = 2 * SUBPX;
/** A thrown or escaping Link's hop (traced alike): 3.3 px/tick along the carrier's facing, from z 18 with no vertical
 *  speed, falling 0.25 px/tick²: down on its 13th tick, 42.9 px out. The throw's release tick is the first; an escape
 *  hops from the tick after. */
export const LINK_FLIGHT = { speed: 845, height: 18 * SUBPX, gravity: 64 } as const;
/** Throwing: where the load leaves from, and how light things (a bush; orbs assumed alike) fly. */
export const THROW_HEIGHT = 20 * SUBPX; // measured
export const THROW_SPEED = 1024; // 4 px/tick (measured: a bush)
/** 0.1 px/tick² (measured: a bush) isn't a whole 1/256 px; 26 lands on the same tick (the 20th, 80 px out). */
export const THROW_GRAVITY = 26;
export const BOMB_THROW_SPEED = 1536; // 6 px/tick (measured; a pot too, falling as a bomb: traced)
/** 0.15 px/tick² (measured); 38 lands on the same tick (the 16th, 96 px out). */
export const BOMB_THROW_GRAVITY = 38;
/** A thrown pot on a side-view screen: 6 px/tick (measured on the Tower of Winds' TV; then falling 0.15 px/tick²). */
export const SIDE_THROW_SPEED = 1536;
/** A thrown bomb bounces once: 1.8 px/tick along, 3.0 up, falling 1.0 px/tick², 7 ticks (measured). */
export const BOMB_BOUNCE = { speed: 461, hop: 768 + 256, gravity: 256 }; // hop pre-adds a tick of gravity (vz -= g; z += vz)
/** A thrown Link lands unhurt, with no invincibility (traced, 2 and 3 players). */
export const THROWN_LAND_DAMAGE = 0;
/** A held Link is let go on his 17th new press of a direction (traced mashing one or two directions, 1 to 4 ticks
 *  apart; A presses don't count). He isn't let go otherwise: 500 ticks held traced. */
export const ESCAPE_PRESSES = 17;
const DIRECTIONS = Button.Up | Button.Down | Button.Left | Button.Right;
export const WALL_PROBE = 4; // thrown things stop at walls with a ±4 px box (measured: a bush)

/** Things Link can pick up. */
export const LIFTABLE = new Set(["bush", "pot", "bomb", "orb"]);
/** The box around an entity that the lift point must be in (a bomb's hit box is ±7 px: measured). */
export const LIFT_HALF = 7;

type Target = { link: number } | { entity: Entity } | { tile: number };

/** What Link `i` would lift right now, if anything. */
export function liftTarget(state: GameState, i: number): Target | null {
  const b = state.battle!, p = state.players[i]!, f = b.fighters[i]!;
  const [sx, sy] = FACING_STEP[p.facing];
  const x = Math.floor(p.x / SUBPX) + sx * LIFT_REACH, y = Math.floor(p.y / SUBPX) + sy * LIFT_REACH;
  const link = b.fighters.findIndex(
    (g, j) =>
      j !== i &&
      g.mode === "active" &&
      (g.move === "none" || g.move === "ready") &&
      g.invincible === 0 &&
      g.carryLink < 0 &&
      g.carryEntity === 0 &&
      pointInBox(x, y, hurtbox(state.players[j]!)),
  );
  if (link >= 0) return { link };
  const entity = b.entities.find((e) => LIFTABLE.has(e.kind) && e.phase === "rest" && e.z === 0 && !isRemoved(e) && pointInBox(x, y, boxAround(e.x, e.y, LIFT_HALF, LIFT_HALF)));
  if (entity) return { entity };
  const tile = tileIndexAt(x, y);
  if ((b.props.bushes.includes(tile) || b.props.pots?.includes(tile)) && !b.cut.includes(tile)) return { tile };
  return null;
}

function begin(f: Fighter, move: Fighter["move"], tick = 0): void {
  f.move = move;
  f.moveTick = tick;
}

/**
 * Lifts what's in front of Link `i` (on the press tick: the lift plays from the next one). Returns false when there's
 * nothing to lift.
 */
export function tryLift(state: GameState, i: number): boolean {
  const target = liftTarget(state, i);
  if (!target) return false;
  const b = state.battle!, f = b.fighters[i]!;
  state.players[i]!.walkTicks = 0; // (the carry's walk cycle starts over: traced, 704 on its first step)
  if ("link" in target) {
    liftLink(state, i, target.link);
    return true;
  }
  begin(f, "lift", -1);
  const e = "entity" in target ? target.entity : liftTile(b, target.tile);
  hold(e, i);
  if (e.kind === "bomb" && e.timer === 0) e.timer = BOMB_FUSE; // a socket bomb lights when it's picked up
  f.carryEntity = e.id;
  attachLoads(state);
  return true;
}

/** Link `i` lifts Link `j` (on the press tick: the lift plays from the next one). */
export function liftLink(state: GameState, i: number, j: number): void {
  const b = state.battle!, f = b.fighters[i]!, g = b.fighters[j]!;
  begin(f, "lift", -1);
  stopActing(state.players[j]!);
  begin(g, "held");
  g.heldBy = i;
  g.escape = 0;
  f.carryLink = j;
  attachLoads(state);
}

// A lifted bush or pot tile: the tile is cut on the press tick (bush 0x70 -> 0x79 in Lake Hylia, measured; a pot on a
// switch uncovers it: arenatiles.ts), and it becomes a bush or pot load.
function liftTile(b: BattleState, tile: number): Entity {
  b.cut.push(tile);
  const x = ((tile % ROOM_TILES_X) * TILE + TILE / 2) * SUBPX, y = (Math.floor(tile / ROOM_TILES_X) * TILE + TILE / 2) * SUBPX;
  return spawnEntity(b, b.props.pots?.includes(tile) ? "pot" : "bush", x, y, { param: tile });
}

function hold(e: Entity, owner: number): void {
  setPhase(e, "held");
  e.owner = owner;
  e.vx = e.vy = e.vz = 0;
}

/**
 * Where the load is (px ahead of the carrier along his facing, height in px) during each move: measured for the lift,
 * the carry, the throw and the slam (facing up; the other facings assumed alike).
 */
export function loadPose(p: PlayerState, f: Fighter): { ahead: number; z: number } {
  const t = f.moveTick, up = p.facing === "up";
  if (f.carryLink >= 0 && !f.carryEntity) {
    if (f.move === "slam" && t >= 0) return LINK_SLAM[Math.min(t, LINK_SLAM.length - 1)]!;
    const pose = loadPoseOf(p, f, t, up);
    return { ahead: pose.ahead, z: pose.z + HOLD_LINK_RAISE };
  }
  return loadPoseOf(p, f, t, up);
}

/** A held Link slammed down (traced facing right): 6 px behind 17 px up for 7 ticks, over the head at 19, down 16 px in
 *  front at 10 (the tick he lands on whoever is there), 4 for 8 ticks, 6 for 4, 10 for 1; then back on the head. */
const LINK_SLAM: readonly { ahead: number; z: number }[] = [
  ...Array<{ ahead: number; z: number }>(7).fill({ ahead: -6, z: 17 }),
  { ahead: 0, z: 19 },
  { ahead: 16, z: 10 },
  ...Array<{ ahead: number; z: number }>(8).fill({ ahead: 16, z: 4 }),
  ...Array<{ ahead: number; z: number }>(4).fill({ ahead: 16, z: 6 }),
  { ahead: 16, z: 10 },
];
/** The slam's tick the held Link comes down on (LINK_SLAM's 9th), and a load's (its 10th: measured with a bush). */
export const SLAM_LINK_TICK = 8;
export const SLAM_LOAD_TICK = 9;

function loadPoseOf(p: PlayerState, f: Fighter, t: number, up: boolean): { ahead: number; z: number } {
  switch (f.move) {
    case "lift":
      return t < 15 ? { ahead: 16, z: 0 } : t < 23 ? { ahead: 12, z: 8 } : { ahead: 0, z: 16 };
    case "throw":
      if (t < 0) break;
      return t < 7 ? { ahead: -6, z: up ? 11 : 15 } : t < 9 ? { ahead: 0, z: up ? 15 : 17 } : { ahead: 0, z: 20 };
    case "slam":
      // From behind (z 11) to the ground 16 px in front: z 8, then 2 for 8 ticks, 6 for 4, 8 for 1; then the head.
      if (t < 0) break;
      return t < 7 ? { ahead: -6, z: 11 } : t < 9 ? { ahead: 16, z: 8 } : t < 17 ? { ahead: 16, z: 2 } : t < 21 ? { ahead: 16, z: 6 } : { ahead: 16, z: 8 };
  }
  return { ahead: 0, z: CARRY_HEIGHT / SUBPX + CARRY.bob[carryStep(p)]! };
}

/** Throws what Link `i` carries along his facing (the throw's release tick). */
function release(state: GameState, i: number): void {
  const b = state.battle!, p = state.players[i]!, f = b.fighters[i]!;
  const [sx, sy] = FACING_STEP[p.facing];
  if (f.carryLink >= 0) {
    const g = b.fighters[f.carryLink]!, q = state.players[f.carryLink]!;
    f.carryLink = -1;
    q.x = p.x;
    q.y = p.y;
    launchLink(g, sx * LINK_FLIGHT.speed, sy * LINK_FLIGHT.speed, i, 0);
    q.facing = p.facing;
  } else if (f.carryEntity) {
    const e = entityById(b, f.carryEntity);
    f.carryEntity = 0;
    if (e && !isRemoved(e)) {
      const bomb = e.kind === "bomb", fast = bomb || e.kind === "pot"; // (traced: a pot flies as a bomb does)
      setPhase(e, "flying");
      e.x = p.x;
      e.y = p.y;
      e.z = THROW_HEIGHT;
      e.vx = sx * (fast ? BOMB_THROW_SPEED : THROW_SPEED);
      e.vy = sy * (fast ? BOMB_THROW_SPEED : THROW_SPEED);
      e.vz = 0;
      if (e.kind !== "pot") e.param = 0; // a bomb's bounce is still to come; a pot keeps its tile (its stone's look)
      e.hitMask = 1 << i;
      e.facing = p.facing;
      if (sideViewAt(b, p.y)) {
        // Side view (measured: a pot on the Tower of Winds' TV): its height becomes screen y, and it flies 6 px a tick
        // (TODO(measure): the bush, an orb and a bomb taken as the pot; a throw up or down), falling (projectiles.ts).
        const speed = e.kind === "bush" ? THROW_SPEED : SIDE_THROW_SPEED;
        e.y -= e.z;
        e.z = 0;
        e.vx = sx * speed;
        e.vy = sy * speed;
      }
    }
  }
}

/** Starts a Link's hop off his carrier from `height`: flying from this tick's flight pass (tick 0) or the next (-1). */
function launchLink(g: Fighter, vx: number, vy: number, thrower: number, tick: number, height = LINK_FLIGHT.height): void {
  begin(g, "thrown", tick);
  g.heldBy = -1;
  g.thrower = thrower;
  g.flyX = vx;
  g.flyY = vy;
  g.z = height;
  g.vz = 0;
}

/** Drops a load straight down (the carrier got hurt, fell, or the Link wriggled free). */
function dropLoad(state: GameState, f: Fighter): void {
  const b = state.battle!;
  if (f.carryLink >= 0) {
    const g = b.fighters[f.carryLink]!;
    launchLink(g, 0, 0, -1, 0, g.z); // TODO(measure): a carrier hurt or falling with a Link overhead
    f.carryLink = -1;
  }
  if (f.carryEntity) {
    const e = entityById(b, f.carryEntity);
    if (e && !isRemoved(e) && e.phase === "held") {
      setPhase(e, "flying");
      e.vx = e.vy = e.vz = 0;
      if (e.kind !== "pot") e.param = 1; // no bounce (a pot keeps its tile)
    }
    f.carryEntity = 0;
  }
}

/** One tick of lifting, carrying, throwing, slamming, being held or being thrown. Returns false for other moves. */
export function stepCarry(state: GameState, i: number, buttons: number, world: World): boolean {
  const b = state.battle!, p = state.players[i]!, f = b.fighters[i]!;
  const pressed = buttons & ~p.held;
  switch (f.move) {
    case "lift":
      p.held = buttons;
      if (++f.moveTick < LIFT_TICKS) return true;
      // The lift's last tick is the carry's first: he walks on it already (traced: state 18 and a step on one tick).
      begin(f, "carry");
    // falls through
    case "carry":
      p.held = buttons;
      if (pressed & (Button.Action | Button.Item)) begin(f, "throw", -1); // plays from the next tick
      else if (pressed & Button.Sword) begin(f, "slam", -1);
      // Carrying walks from the first input tick (no turn tick): at walking speed with a thing, slower with a Link.
      if (buttons & (Button.Up | Button.Down | Button.Left | Button.Right)) p.moving = true;
      stepPlayer(p, buttons, world, f.carryLink >= 0 ? CARRY_LINK_SPEEDS : undefined);
      return true;
    case "throw":
      p.held = buttons;
      if (++f.moveTick === THROW_RELEASE_TICK) release(state, i);
      if (f.moveTick >= THROW_TICKS) begin(f, "none");
      stopActing(p);
      return true;
    case "slam":
      p.held = buttons;
      stopActing(p);
      ++f.moveTick; // its load comes down in landSlams, once every Link moved
      if (f.moveTick >= SLAM_TICKS) begin(f, "carry");
      return true;
    case "held":
      // moveTick is the struggle animation's clock (moveframes.ts HELD): 6 ticks a frame, or the next frame at once
      // on a press of a direction (traced).
      p.held = buttons;
      if (pressed & DIRECTIONS) {
        f.escape++;
        f.moveTick = (Math.floor(f.moveTick / HELD.frameTicks) + 1) * HELD.frameTicks;
      } else f.moveTick++;
      if (f.escape >= ESCAPE_PRESSES) wriggleFree(state, i);
      return true;
    case "thrown":
      if (f.z === 0 && f.vz === 0 && f.moveTick > 0) {
        // Down since last tick (still in the hop's pose then): in control again from this one (traced).
        f.thrower = -1;
        begin(f, "none");
        stopActing(p);
        return false;
      }
      p.held = buttons; // flown by flyThrownLinks once every Link moved
      return true;
    default:
      return false;
  }
}

/** The slams' loads coming down this tick (after every Link moved, so whoever they land on is caught on that tick). */
export function landSlams(state: GameState): void {
  state.battle!.fighters.forEach((f, i) => {
    if (f.mode === "active" && f.move === "slam" && f.moveTick === (f.carryLink >= 0 ? SLAM_LINK_TICK : SLAM_LOAD_TICK)) slamDown(state, i);
  });
}

// The slam's load comes down 16 px in front: a held Link stuns the Link there (traced); another load gives what is there
// its thrown damage (TODO(measure) in battle).
function slamDown(state: GameState, i: number): void {
  const b = state.battle!, p = state.players[i]!, f = b.fighters[i]!;
  const [sx, sy] = FACING_STEP[p.facing];
  const x = p.x + sx * 16 * SUBPX, y = p.y + sy * 16 * SUBPX;
  if (f.carryLink >= 0) {
    // A held Link slammed onto another stuns him, without damage, as a slingshot seed does (traced: 90 ticks dizzy,
    // then 60 invincibility ticks); the held Link is unhurt and carried on.
    const box = boxAround(x, y, 6);
    state.players.forEach((q, j) => {
      const g = b.fighters[j]!;
      if (j === i || j === f.carryLink || !vulnerable(g) || !boxesOverlap(box, hurtbox(q))) return;
      if (stunFighter(q, g)) b.hits.push({ attacker: i, victim: j, blocked: false, damage: 0, cause: "slam" });
    });
    return;
  }
  const load = f.carryEntity ? entityById(b, f.carryEntity) : undefined;
  strikeAt(state, i, x, y, load?.kind ?? "", [i]);
}

// Wriggling free: the held Link hops off from where his carrier stands, along the carrier's facing (traced facing
// right and up), and the carrier's hands are empty from the next tick.
function wriggleFree(state: GameState, i: number): void {
  const b = state.battle!, f = b.fighters[i]!, p = state.players[i]!;
  const carrier = b.fighters[f.heldBy], c = state.players[f.heldBy];
  let vx = 0, vy = 0;
  if (carrier && c && carrier.carryLink === i) {
    carrier.carryLink = -1;
    if (carrier.move === "carry" || carrier.move === "lift" || carrier.move === "slam") begin(carrier, "none");
    const [sx, sy] = FACING_STEP[c.facing];
    [vx, vy] = [sx * LINK_FLIGHT.speed, sy * LINK_FLIGHT.speed];
    p.x = c.x;
    p.y = c.y;
    p.facing = c.facing;
  }
  launchLink(f, vx, vy, -1, -1);
}

/**
 * The thrown, dropped and escaping Links' hops, once every Link moved (so a throw's release flies on its own tick
 * whatever the players' order): along (flyX, flyY) against the walls, falling at LINK_FLIGHT.gravity; on landing he
 * stands facing the way he flew (traced), unhurt, or falls into the pit he landed over. With `bounce` (the adventure's
 * side views: traced in Hyrule Castle room 1's area 6) a wall sends him back at half the speed instead of stopping him.
 */
export function flyThrownLinks(state: GameState, world: World, bounce = false): void {
  state.battle!.fighters.forEach((f, i) => {
    if (f.mode !== "active" || f.move !== "thrown") return;
    const p = state.players[i]!;
    if (f.z === 0 && f.vz === 0 && f.moveTick > 0) return; // down: his own tick lets him go (stepCarry)
    if (++f.moveTick === 0) return; // wriggled free this tick: the hop starts next tick
    for (const axis of ["x", "y"] as const) {
      const v = axis === "x" ? f.flyX : f.flyY;
      if (!v) continue;
      const from = p[axis];
      moveAxis(p, world, v, axis);
      if (p[axis] - from === v) continue;
      if (bounce) {
        if (axis === "x") f.flyX = -Math.trunc(v / 2);
        else f.flyY = -Math.trunc(v / 2);
      } else f.flyX = f.flyY = 0; // a wall stops the flight
    }
    f.z += f.vz;
    f.vz -= LINK_FLIGHT.gravity;
    if (f.z > 0) return;
    f.z = f.vz = f.flyX = f.flyY = 0;
  });
}

/** A carrier's hands are full during these moves (a throw only until it lets go). */
function holding(f: Fighter): boolean {
  return f.mode === "active" && (f.move === "lift" || f.move === "carry" || f.move === "throw" || f.move === "slam");
}

/**
 * After every Link moved: loads follow their carrier along the measured paths, and a carrier who can't hold on any
 * more (hurt, falling, out) drops his. A load that's gone (a bomb that went off) frees the carrier's hands.
 */
export function attachLoads(state: GameState): void {
  const b = state.battle!;
  b.fighters.forEach((f, i) => {
    const p = state.players[i]!;
    const { ahead, z } = loadPose(p, f);
    const [sx, sy] = FACING_STEP[p.facing];
    const x = p.x + sx * ahead * SUBPX, y = p.y + sy * ahead * SUBPX;
    if (f.carryLink >= 0) {
      const g = b.fighters[f.carryLink]!, q = state.players[f.carryLink]!;
      if (g.move !== "held" || g.heldBy !== i) f.carryLink = -1;
      else if (!holding(f)) dropLoad(state, f);
      else {
        q.x = x;
        q.y = y + HOLD_LINK_DROP_Y;
        g.z = z * SUBPX;
      }
    }
    if (f.carryEntity) {
      const e = entityById(b, f.carryEntity);
      if (!e || isRemoved(e) || e.phase !== "held" || e.owner !== i) f.carryEntity = 0;
      else if (!holding(f)) dropLoad(state, f);
      else {
        e.x = x;
        e.y = y;
        e.z = z * SUBPX;
      }
    }
    const empty = f.carryLink < 0 && !f.carryEntity;
    if (empty && (f.move === "carry" || f.move === "lift" || f.move === "slam")) begin(f, "none");
  });
}

/** Is this Link holding something overhead? */
export function isCarrying(f: Fighter): boolean {
  return f.carryLink >= 0 || f.carryEntity !== 0;
}
