// Arena hazards and switches, spawned from the room's actor list (props.ts) at the start of each round; the switch
// network that wires them is switches.ts (docs/formats/battle-arenas.md "Switches"; behaviors read from main.dol unless marked):
// - Tower of Flames: HBMB bombs in their sockets (lift one and it's lit; bombs.ts); four pots stand on floor switches
//   around the fire pit (SWTH): lift one, stand on the switch, and the two FLME flames pointing away from that corner
//   shoot out (through SWOR gates) for as long as someone stands there. BLZ2 eternal flames burn only while their
//   switch (14) is on: the floor switch of the room behind the north doors (a side room, siderooms.ts) sets it while
//   someone stands on it (room 6: two crystals there).
// - Above the Clouds: FBMR fire bars, one entity per arm, and the RBPN colored panels (panels.ts).
// - The Field: the TFLR trick floor opens into a pit while its switch (under a bush) is pressed; BEEE bees swarm
//   whoever is nearest when something disturbs their tree.
// - Hyrule Castle: SLR1 sword soldiers chase the nearest Link, more come out of GEN3 spawners (and bow soldiers, a
//   captain and a ball-and-chain soldier: castlesoldiers.ts); CIRC magic circles open
//   one at a time (their switches) and send a Link to the castle's dark side, a side room, for 10 s (siderooms.ts).
// - Tower of Winds: BBSL, the Shadow Link who drops a giant bomb on the TV once the gallery's crystals are lit
//   (giantbomb.ts); GEN3 bombchus (bombchus.ts) in its Dark World room.
// Damage values and knockbacks are the ones the actors' attack calls pass in main.dol (0x801F2B7C: damage, hit type;
// docs/measurements/battle-constants.md "Battle constants from main.dol"); everything marked TODO(measure) is a placeholder.
import type { BattleState } from "./battle.ts";
import { hurtbox, hurtFighter, KNOCK_HARD, KNOCK_SLOW, onGround, vulnerable, type Knock, type PixelBox } from "./combat.ts";
import { boxAround, boxesOverlap, cos4096, distance2, FACING_STEP, isRemoved, randomInt, removeEntity, setPhase, sin4096, spawnEntity, stepToward, TILE, tileIndexAt, TRIG_ONE, velocityAlong, type Entity } from "./entities.ts";
import type { GameState } from "./game.ts";
import { orbFirstDelay, spawnFromGenerator, stepOrbGenerator } from "./orbs.ts";
import { HEN_KIND, spawnHen, stepAngryCucco, stepHen } from "./hens.ts";
import { askMessage, MESSAGE } from "./messages.ts";
import { initialPanels, stepPanels } from "./panels.ts";
import { moveAxis, SUBPX, type Facing } from "./player.ts";
import type { Prop } from "./props.ts";
import { COVER_TILES } from "./arenatiles.ts";
import { ballSoldierContact, soldierContact, stepBallSoldier, stepBowSoldier, stepCaptain, stepSoldierArrow } from "./castlesoldiers.ts";
import { spawnShadowLink, stepBigBomb, stepShadowLink } from "./giantbomb.ts";
import { CIRCLE_SETTLE, screenAt, sideViewAt, stepCannon, takeIntoCircle } from "./siderooms.ts";
import { newSoldier, SOLDIER_FIRST_LOOK, SOLDIER_STUN_DECAY, SOLDIER_STUN_TICKS } from "./strike.ts";
import { LOGIC_TYPES, ownSwitch, setSwitch, spawnLogic, spawnCrystal, stepLogic, stepCrystal, switchOn, CRYSTAL_TYPES } from "./switches.ts";
import { surfaceAt, type World } from "./world.ts";

/** BLZ2 eternal flames: their init (0x802E57E0) sets attack power 1; hit type 7 (0.75 px/tick, a 4.0 hop). Traced
 *  (the Tower of Flames lit from its north room): 1 life, 0.75 px/tick away from the flame's middle, the 4.0 hop. */
export const FLAME_DAMAGE = 1;
export const FLAME_KNOCK: Knock = KNOCK_SLOW;
/**
 * FLME fire-pit jets: their init (0x8015EDF4) sets attack power 4 (kinds other than 4 and 5); hit type 9. Measured
 * (Tower of Flames, the bottom-right pot lifted and its switch stood on: the up and left jets): 4 damage, 60
 * invincibility frames, knocked 1.5 px/frame with a 4.0 hop (33 frames).
 */
export const JET_DAMAGE = 4;
export const JET_KNOCK: Knock = KNOCK_HARD;
export const FLAME_HALF = 8; // px: an eternal flame's burning box (BLZ2 update 0x802E4FD8)
/** The eternal flames (BLZ2 params 0x70000013) light while this switch is on. */
export const FLAME_SWITCH = 14;
/** FLME: the jet's size eases toward 1 (on) or 0 (off) by a tenth of the gap per frame, in 1/1000 (measured, +0x260). */
export const JET_SIZE_ONE = 1000;
export const JET_HURT_SIZE = 700; // it burns while its size is above 0.7: from the 12th frame after its switch
export const JET_LENGTH = 90; // px from the anchor along its direction (box table 0x80466130)
export const JET_HALF_WIDTH = 10; // px on either side
export const FIREBAR_DAMAGE = 2; // FBOB: atcp forced to 2 in its init (0x801BDA40), hit type 1 (0x801BD9D0)
// Measured Above the Clouds (speed class 2): 2 arms of 8 balls, 16 px apart from 48 px, back where they were after
// 1024 frames (64 units a frame), turning clockwise on screen from right and left.
export const FIREBAR_SPEEDS = [128, 256, 64] as const; // angle units per frame by the params' speed class
export const FIREBAR_RING = 16; // px between fireballs (and to the first ring)
export const FIREBALL_HALF = 8; // FBOB's box: ±8 px
/** FBMR arms start pointing right, left, down, up (game table 0x8053F800, turned into the sim's angles). */
const ARM_ANGLES = [0, 0x8000, 0x4000, 0xc000] as const;
export const TRAPDOOR_OPENING_TICKS = 8; // TFLR: the floor opens over 8 frames, then its tiles are pits
export const TRAPDOOR_MIN_OPEN_TICKS = 40; // …for at least 40 frames
export const TRAPDOOR_CLOSING_TICKS = 41; // closing (still a pit meanwhile)
export const TRAPDOOR_KEEP_OPEN = 20; // px: it doesn't close while a Link is this close to its middle
// main.dol's BEEE swarm (7 bees, 2–3 px/frame) wakes into a 3-px ring. In Dolphin neither a swing 56 px from The Field's
// tree nor bomb blasts 24–26 px away woke them: The Field's (kind 0) wake only for a Link within 80 px with Link +0xB9A
// (a charged hammer's pound: hammer.ts) or +0xB9C set (traced: a Pegasus Boots crash, for one tick); kind 1 for any
// Link within 64 px (strike.ts wakeBees).
export const BEE_SPEED = 512; // 2 px/tick at most (traced)
export const BEE_DAMAGE = 1; // BEEE's attack call (0x80344144) passes 1 (not its atcp 2), hit type 1 (traced: 1)
/**
 * The swarm, traced (The Field's tree, woken by a poke of Link +0xB9A, the hammer's flag): it rises out of the tree and
 * hovers 92 ticks (states 1 and 2), then flies at the nearest Link, re-aimed every 10 ticks, its speed easing 1/10 of
 * the way to 2 px/tick (0.2, 0.38, 0.54 …); a sting (1 life, the sword's knockback) and it buzzes where it stung 121
 * ticks (state 5), then flies at him again from a standstill. It was still at it 400 ticks on (going home: assumed).
 */
export const BEE_AIM_TICKS = 10;
export const BEE_BUZZ_TICKS = 121;
// SLR1, measured (Hyrule Castle, 4 soldiers after 2 idle Links, 117 aims): aimed 1.045 px/frame on average (0.74–1.24),
// re-aimed every 13 frames, 44° off the nearest Link on average (up to 90° either way), the velocity easing 0.3 of the
// way per frame; chases of 99–242 frames (+0x23C), each followed by a 30-frame stop and a 21-frame wind-up (states 1,
// 4, 5). They noticed Links 76 and 91 px away at once; others, patrolling, only when much nearer or after turning.
export const SOLDIER_SPEED = 268; // 1.047 px/tick
export const SOLDIER_AIM_TICKS = 13;
export const SOLDIER_WOBBLE = 0x4000; // up to 90° off
export const SOLDIER_CHASE_MIN = 100;
export const SOLDIER_CHASE_SPREAD = 144; // chases last 100–243 ticks
export const SOLDIER_STOP_TICKS = 30;
export const SOLDIER_WINDUP_TICKS = 21;
export const SOLDIER_FIRST_AIM = 21; // a chase's first ticks it stands (+0x240 counts down from 19), then aims
/**
 * The patrol and its sight (SLR1's states 1 and 3, read from main.dol's 0x80151348 / 0x80151748; it fits the trace's 68-
 * and 128-tick stands and the 76, 91 and 197 px it noticed Links at). Standing (state 3) it looks its way 8 ticks, then
 * steps through LOOKS[facing] every 15 ticks, round once or twice (+0x25C = 1 + rand); then it turns 90° either way and
 * walks (state 1) 50–99 ticks at 0.7 px/tick (+0x290), and stands again. It notices the nearest Link (a 4-way
 * direction from it, the dominant axis) when he's the way it looks within 100 px standing, or the way it walks within
 * 1000 (kinds 1–3; 100 for the others) walking: then the wind-up and the chase.
 */
export const SOLDIER_SIGHT = 100;
export const SOLDIER_WALK_SIGHT = 1000;
export const SOLDIER_PATROL_SPEED = 179; // 0.7 px/tick
export const SOLDIER_LOOK_TICKS = 15;
export const SOLDIER_WALK_MIN = 50;
export const SOLDIER_WALK_SPREAD = 50;
/** Where a standing soldier looks, by its facing, at each of its four looks (0x8049FB78). */
export const SOLDIER_LOOKS: Readonly<Record<Facing, readonly Facing[]>> = {
  right: ["right", "up", "right", "down"],
  left: ["left", "up", "left", "down"],
  down: ["down", "left", "down", "right"],
  up: ["up", "left", "up", "right"],
};
/** After a chase's stop it chases again with a Link this near, or patrols. TODO(measure) (state 7's rule wasn't read). */
export const SOLDIER_KEEP_SIGHT = 128;
export const SOLDIER_DAMAGE = 2; // SLR1: its atcp 2 (its attack call passes -100 = its own atcp), hit type 1
export const CIRCLE_GROW_TICKS = 50; // a magic circle opens (and closes) over 50 ticks: its size ±0.02 per tick
/** A magic circle that starts open (no switch) waits this long before it takes anyone (CIRC +0x248 at init). */
export const CIRCLE_FIRST_SETTLE = 120;
/** SWTH kind 8 holds its switch this long after release when its timer field is 0. */
export const SWITCH_DEFAULT_HOLD = 60;

/** Game direction order (0 right, 1 left, 2 down, 3 up), as in PLAS and the soldiers' tables. */
const GAME_DIRECTIONS: readonly Facing[] = ["right", "left", "down", "up"];

/** Resets the round's entities from the arena props: hazards in place, switches off, orb generators counting down. */
export function spawnArena(b: BattleState): void {
  b.entities = [];
  b.cut = [];
  b.switches = 0;
  b.panels = initialPanels(b);
  b.respawn = b.props.actors.map(() => 0);
  b.props.actors.forEach((prop, k) => {
    if (prop.id === "CRGN") b.respawn[k] = orbFirstDelay(prop);
    else spawnProp(b, k);
  });
}

/** (Re)creates the entity for arena prop `k`. */
export function spawnProp(b: BattleState, k: number): void {
  const prop = b.props.actors[k]!;
  const x = prop.x * SUBPX, y = prop.y * SUBPX;
  if ((LOGIC_TYPES as readonly string[]).includes(prop.id)) {
    spawnLogic(b, k);
    return;
  }
  if ((CRYSTAL_TYPES as readonly string[]).includes(prop.id)) {
    spawnCrystal(b, k);
    return;
  }
  switch (prop.id) {
    case "HBMB":
      spawnEntity(b, "bomb", x, y, { home: k });
      break;
    case "BLZ2":
      spawnEntity(b, "flame", x, y, { home: k });
      break;
    case "FLME":
      spawnEntity(b, "jet", x, y, { home: k, param: (prop.params >>> 16) & 3, facing: GAME_DIRECTIONS[(prop.params >>> 16) & 3]! });
      break;
    case "FBMR": {
      const arm = Math.min(3, (prop.params >>> 8) & 0xff);
      spawnEntity(b, "firebar", x, y, { home: k, param: arm, phase: "active", angle: ARM_ANGLES[arm] });
      break;
    }
    case "SWTH":
      spawnEntity(b, "switch", x, y, { home: k, param: ownSwitch(prop.params) });
      break;
    case "TFLR":
      spawnEntity(b, "trapdoor", x, y, { home: k, param: (prop.params >>> 7) & 31 });
      break;
    case "BEEE":
      spawnEntity(b, "bee", x, y, { home: k, z: 8 * SUBPX });
      break;
    case "NIWA":
      if ((prop.params & 15) === HEN_KIND) spawnHen(b, x, y, k); // (The Field's cave cucco; others: not in battle)
      break;
    case "SLR1":
      spawnEntity(b, "soldier", x, y, { home: k, ...newSoldier(prop.params) });
      break;
    case "CIRC":
      // `timer` = its size (0 closed … CIRCLE_GROW_TICKS open), `tick` its ticks at full size, `param` the ticks it stays
      // open after taking a Link, `hitMask` the players' latches (siderooms.ts takeIntoCircle). A circle without a switch
      // starts open.
      if (ownSwitch(prop.params)) spawnEntity(b, "circle", x, y, { home: k });
      else spawnEntity(b, "circle", x, y, { home: k, timer: CIRCLE_GROW_TICKS, tick: CIRCLE_SETTLE - CIRCLE_FIRST_SETTLE });
      break;
    case "CRGN":
      spawnFromGenerator(b, k);
      break;
    case "CNON":
      spawnEntity(b, "cannon", x, y, { home: k, phase: "active" });
      break;
    case "BBSL":
      spawnShadowLink(b, k, sideViewAt(b, y));
      break;
  }
}

/**
 * Generators, sockets and nests bring back their entity when its respawn timer runs out. Orb generators count only
 * while their switch (if any) is on, then watch what they made until it's gone (orbs.ts stepOrbGenerator).
 */
export function stepRespawns(b: BattleState): void {
  b.respawn.forEach((t, k) => {
    const prop = b.props.actors[k]!;
    if (prop.id === "CRGN") return stepOrbGenerator(b, k, prop, !ownSwitch(prop.params) || switchOn(b, ownSwitch(prop.params)));
    if (t > 0 && --b.respawn[k]! === 0) spawnProp(b, k);
  });
}

/** Fighters on the ground that a box touches. */
/** The Links who can be hurt whose body meets `box` (px). */
export function touching(state: GameState, box: PixelBox): number[] {
  const b = state.battle!;
  return b.fighters.flatMap((f, i) => (vulnerable(f) && onGround(f) && boxesOverlap(box, hurtbox(state.players[i]!)) ? [i] : []));
}

function burn(state: GameState, i: number, x: number, y: number, cause: string, damage: number, knock?: Knock): void {
  const b = state.battle!;
  const hit = hurtFighter(state.players[i]!, b.fighters[i]!, i, damage, x, y, knock ? { cause, knock } : { cause });
  if (hit) b.hits.push(hit);
}

/** Is a floor switch still hidden under its pot or bush? */
export function switchCovered(b: BattleState, prop: Prop): boolean {
  const index = tileIndexAt(prop.x, prop.y);
  if (b.cut.includes(index)) return false;
  return prop.tile !== undefined ? COVER_TILES.has(prop.tile) : b.props.bushes.includes(index) || (b.props.pots?.includes(index) ?? false);
}

/** The first Link standing on a switch (0x802A6BC4: his ±7 px body over its middle ±1 px, on the ground), or -1. */
function standingOn(state: GameState, e: Entity, narrow: boolean): number {
  const b = state.battle!;
  const cx = Math.floor(e.x / SUBPX) + TILE / 2, cy = Math.floor(e.y / SUBPX) + TILE / 2;
  return state.players.findIndex((p, i) => {
    const f = b.fighters[i]!;
    if (f.hearts <= 0 || (f.mode !== "active" && f.mode !== "recoil" && f.mode !== "hurt") || !onGround(f) || p.action === "spin") return false;
    const dx = cx - Math.floor(p.x / SUBPX), dy = cy - Math.floor(p.y / SUBPX);
    return Math.abs(dx) <= 8 && Math.abs(dy) <= 8 && (!narrow || Math.abs(dx) < 7);
  });
}

/**
 * SWTH floor switches (tile-bound: the anchor is its tile's top-left). Hidden under a pot or bush until that's lifted
 * or cut; then a Link standing on its middle turns its switch on. Kind (params & 31): 0, 2, 5, 6 on while stood on;
 * 8 held for its timer (params & 0x3E0 frames, 0 = 60) after the Link steps off; 1, 3 latch; 4, 7 on for good.
 * `e.phase` "active" while its switch is on because of it, `e.timer` the hold left.
 */
function stepSwitch(state: GameState, e: Entity): void {
  const b = state.battle!, prop = b.props.actors[e.home]!;
  if (switchCovered(b, prop)) return;
  const kind = prop.params & 31, n = e.param;
  const on = standingOn(state, e, kind === 2 || kind === 3) >= 0;
  if (on) {
    if (e.phase !== "active") {
      setPhase(e, "active");
      setSwitch(b, n, true);
    }
    e.timer = 0;
    return;
  }
  if (e.phase !== "active" || [1, 3, 4, 7].includes(kind)) return;
  if (kind === 8) {
    const hold = prop.params & 0x3e0 || SWITCH_DEFAULT_HOLD;
    if (++e.timer < hold) return;
  }
  setPhase(e, "rest");
  e.timer = 0;
  setSwitch(b, n, false);
}

/** The jet's size (0-1000) now: `e.timer`. */
export const jetSize = (e: Entity) => e.timer;

/**
 * FLME: out while its switch is on, easing in and out; it burns while on and big enough, knocking Links away from the
 * middle of its box (measured: a Link beside the upward jet at (239.5, 149.5) flew off along (-1.483, 0.225), away
 * from (256, 147), not from the anchor (256, 192)).
 */
function stepJet(state: GameState, e: Entity): void {
  const b = state.battle!, prop = b.props.actors[e.home]!;
  const on = switchOn(b, ownSwitch(prop.params));
  e.timer += Math.trunc(((on ? JET_SIZE_ONE : 0) - e.timer) / 10);
  if (on !== (e.phase === "active")) setPhase(e, on ? "active" : "rest");
  if (e.phase !== "active" || e.timer <= JET_HURT_SIZE) return;
  const [sx, sy] = FACING_STEP[e.facing], half = (JET_LENGTH / 2) * SUBPX;
  for (const i of touching(state, jetBox(e))) burn(state, i, e.x + sx * half, e.y + sy * half, "flame", JET_DAMAGE, JET_KNOCK);
}

/** The fire-pit flame's burning box (its full length: 0x80466130), from its anchor along its direction. */
export function jetBox(e: Entity, length = JET_LENGTH): PixelBox {
  const [sx, sy] = FACING_STEP[e.facing];
  const cx = Math.floor(e.x / SUBPX), cy = Math.floor(e.y / SUBPX);
  const x1 = cx + sx * length, y1 = cy + sy * length, w = JET_HALF_WIDTH;
  return { left: Math.min(cx, x1) - (sx ? 0 : w), right: Math.max(cx, x1) + (sx ? 0 : w), top: Math.min(cy, y1) - (sy ? 0 : w), bottom: Math.max(cy, y1) + (sy ? 0 : w) };
}

/** A fire-bar arm's fireballs (world 1/256 px): FBMR params & 0xFF balls, 16 px apart from ring ((params >> 20) & 15) + 1. */
export function fireballs(b: BattleState, e: Entity): { x: number; y: number }[] {
  const p = b.props.actors[e.home]?.params ?? 0;
  const count = Math.max(1, Math.min(16, p & 0xff)), first = ((p >>> 20) & 15) + 1;
  return Array.from({ length: count }, (_, k) => {
    const r = (first + k) * FIREBAR_RING;
    return { x: e.x + Math.trunc((r * SUBPX * cos4096(e.angle)) / TRIG_ONE), y: e.y + Math.trunc((r * SUBPX * sin4096(e.angle)) / TRIG_ONE) };
  });
}

/** A fire-bar arm's turn per frame (sim angles: 0 right, clockwise): its speed class, direction bit and reverse switch. */
export function firebarSpeed(b: BattleState, e: Entity): number {
  const p = b.props.actors[e.home]?.params ?? 0;
  const speed = FIREBAR_SPEEDS[Math.min(2, (p >>> 24) & 3)]!;
  const clockwise = ((p >>> 16) & 1) === 0; // the game's angle runs the other way: bit 16 clear = negated = clockwise here
  const reverse = switchOn(b, (p >>> 26) & 31);
  return clockwise !== reverse ? speed : -speed;
}

/**
 * TFLR trick floor (0x802ADC18): opens while its switch is on (8 frames, then its 4×4 tiles are a damaging pit for at
 * least 40 frames); once the switch is off and no Link is within 20 px of its middle it closes (41 frames, still a pit).
 * Phases: "rest" closed, "active" opening then open, "return" closing; `e.timer` > 0 while its tiles are pits.
 */
function stepTrapdoor(state: GameState, e: Entity): void {
  const b = state.battle!;
  const on = switchOn(b, e.param);
  e.tick++;
  switch (e.phase) {
    case "rest":
      if (on) setPhase(e, "active");
      break;
    case "active":
      if (e.tick >= TRAPDOOR_OPENING_TICKS) e.timer = 1;
      if (on || e.tick < TRAPDOOR_OPENING_TICKS + TRAPDOOR_MIN_OPEN_TICKS) break;
      if (!linkNear(state, e)) setPhase(e, "return");
      break;
    case "return":
      if (e.tick >= TRAPDOOR_CLOSING_TICKS) {
        e.timer = 0;
        setPhase(e, "rest");
      }
      break;
  }
}

function linkNear(state: GameState, e: Entity): boolean {
  const cx = Math.floor(e.x / SUBPX) + 2 * TILE, cy = Math.floor(e.y / SUBPX) + 2 * TILE;
  return state.players.some((p, i) => {
    const f = state.battle!.fighters[i]!;
    return f.mode !== "dead" && Math.abs(Math.floor(p.x / SUBPX) - cx) <= TRAPDOOR_KEEP_OPEN && Math.abs(Math.floor(p.y / SUBPX) - cy) <= TRAPDOOR_KEEP_OPEN;
  });
}

/** The angle (0-65535 = one turn clockwise from right, y down) from (fx, fy) toward (tx, ty), to 1/256 of a turn. */
export function angleTo(fx: number, fy: number, tx: number, ty: number): number {
  const dx = tx - fx, dy = ty - fy;
  let best = 0, bestDot = -Infinity;
  for (let a = 0; a < 0x10000; a += 0x100) {
    const dot = dx * cos4096(a) + dy * sin4096(a);
    if (dot > bestDot) (best = a), (bestDot = dot);
  }
  return best;
}

/** The nearest Link who can be hurt, on the same screen, within `range` px; -1 if none. */
export function nearestTarget(state: GameState, x: number, y: number, range: number): number {
  const b = state.battle!;
  let best = -1, bestD = range * range;
  state.players.forEach((p, i) => {
    const f = b.fighters[i]!;
    if (!vulnerable(f) || !onGround(f) || screenAt(p.y) !== screenAt(y)) return; // (not in another room)
    const d = distance2(p.x, p.y, x, y);
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

function stepBee(state: GameState, e: Entity): void {
  e.tick++;
  if (e.phase === "rest") return;
  if (e.phase === "chase") {
    // (`param`: ticks it hovers or buzzes on the spot; `angle`: its speed; (vx, vy): its heading, 256 long.)
    if (--e.timer <= 0) return setPhase(e, "return");
    if (e.param > 0) return void e.param--;
    if (e.tick % BEE_AIM_TICKS === 1 || e.target < 0) {
      e.target = nearestTarget(state, e.x, e.y, 1024);
      const p = state.players[e.target];
      if (!p) return setPhase(e, "return");
      [e.vx, e.vy] = velocityAlong(p.x - e.x, p.y - e.y, SUBPX);
    }
    e.angle += Math.round((BEE_SPEED - e.angle) / 10);
    e.x += Math.trunc((e.vx * e.angle) / SUBPX);
    e.y += Math.trunc((e.vy * e.angle) / SUBPX);
    if (e.vx) e.facing = e.vx > 0 ? "right" : "left";
    const b = state.battle!, hits = b.hits.length;
    for (const i of touching(state, boxAround(e.x, e.y, 4))) burn(state, i, e.x, e.y, "bee", BEE_DAMAGE);
    if (b.hits.length > hits) [e.param, e.angle] = [BEE_BUZZ_TICKS, 0];
    return;
  }
  // Going home.
  const [sx, sy] = stepToward(e.x, e.y, e.homeX, e.homeY);
  e.x += sx * (BEE_SPEED >> 1);
  e.y += sy * (BEE_SPEED >> 1);
  if (distance2(e.x, e.y, e.homeX, e.homeY) <= 1) {
    e.x = e.homeX;
    e.y = e.homeY;
    setPhase(e, "rest");
  }
}

/**
 * SLR1 sword soldiers (measured in Hyrule Castle: docs/measurements/battle-arenas.md "Battle measurements: arenas, orbs and camera").
 * Patrolling ("rest", `patrol`) until it notices a Link (`soldierSees`); then a wind-up ("active", SOLDIER_WINDUP_TICKS) and a chase of
 * 100–243 ticks ("chase", `e.timer`) that starts standing (SOLDIER_FIRST_AIM) and steers at any angle: every
 * SOLDIER_AIM_TICKS it aims at the nearest Link, give or take up to 90° (`e.angle`), and its velocity eases 3/10 of the
 * way there each tick; then it stops (SOLDIER_STOP_TICKS, its velocity halving each tick) and winds up again, or
 * patrols again when nobody is near. Struck and still standing, it's knocked away ("stun", strike.ts). (Measured: noticed on frame 47, moving from 89.)
 */
function stepSoldier(state: GameState, e: Entity, world: World): void {
  const b = state.battle!;
  e.tick++;
  if (e.phase === "stun") {
    e.vx = Math.trunc((e.vx * SOLDIER_STUN_DECAY) / 100);
    e.vy = Math.trunc((e.vy * SOLDIER_STUN_DECAY) / 100);
    moveAxis(e, world, e.vx, "x");
    moveAxis(e, world, e.vy, "y");
    if (e.tick >= SOLDIER_STUN_TICKS) {
      setPhase(e, "active");
      e.timer = SOLDIER_WINDUP_TICKS - 1; // (state 5's 20 ticks: no state 4 tick after a hit)
    }
    return;
  }
  if (e.phase === "rest") {
    patrol(b, e);
    e.target = soldierSees(state, e);
    if (e.target >= 0) {
      e.vx = e.vy = 0;
      setPhase(e, "active");
      e.timer = SOLDIER_WINDUP_TICKS - 1; // (this tick is its first)
    }
  } else if (e.phase === "active") {
    // Stopping (the velocity halves each tick), then the wind-up.
    e.vx = Math.trunc(e.vx / 2);
    e.vy = Math.trunc(e.vy / 2);
    if (--e.timer <= 0) {
      e.target = nearestTarget(state, e.x, e.y, SOLDIER_KEEP_SIGHT);
      if (e.target < 0) {
        setPhase(e, "rest");
        e.param = 1 << 2; // standing, one round of looks
        e.timer = SOLDIER_FIRST_LOOK;
      } else {
        setPhase(e, "chase");
        e.timer = SOLDIER_CHASE_MIN + randomInt(b, SOLDIER_CHASE_SPREAD);
      }
    }
  } else if (e.phase === "chase") {
    // It stands for its first ticks and aims on SOLDIER_FIRST_AIM, then every SOLDIER_AIM_TICKS; each aim steers it from
    // the next tick.
    const since = e.tick - SOLDIER_FIRST_AIM;
    if (since > 0) {
      const tx = Math.trunc((SOLDIER_SPEED * cos4096(e.angle)) / TRIG_ONE), ty = Math.trunc((SOLDIER_SPEED * sin4096(e.angle)) / TRIG_ONE);
      e.vx += Math.trunc(((tx - e.vx) * 3) / 10);
      e.vy += Math.trunc(((ty - e.vy) * 3) / 10);
    }
    if (since >= 0 && since % SOLDIER_AIM_TICKS === 0) {
      e.target = nearestTarget(state, e.x, e.y, 1024);
      const p = state.players[e.target];
      if (p) e.angle = (angleTo(e.x, e.y, p.x, p.y) + randomInt(b, SOLDIER_WOBBLE * 2 + 1) - SOLDIER_WOBBLE) & 0xffff;
    }
    if (--e.timer <= 0) {
      setPhase(e, "active");
      e.timer = SOLDIER_STOP_TICKS + SOLDIER_WINDUP_TICKS;
    }
  }
  if (e.vx || e.vy) {
    e.facing = Math.abs(e.vx) >= Math.abs(e.vy) ? (e.vx > 0 ? "right" : "left") : e.vy > 0 ? "down" : "up";
    // Soldiers don't walk into pits.
    const ahead = (v: number) => Math.sign(v) * 6;
    if (surfaceAt(world, Math.floor((e.x + e.vx) / SUBPX) + ahead(e.vx), Math.floor(e.y / SUBPX)) !== "pit") moveAxis(e, world, e.vx, "x");
    if (surfaceAt(world, Math.floor(e.x / SUBPX), Math.floor((e.y + e.vy) / SUBPX) + ahead(e.vy)) !== "pit") moveAxis(e, world, e.vy, "y");
  }
  for (const i of touching(state, boxAround(e.x, e.y, 7))) {
    const b = state.battle!;
    const hit = hurtFighter(state.players[i]!, b.fighters[i]!, i, SOLDIER_DAMAGE, e.x, e.y, { cause: "soldier", blockable: true });
    if (hit) b.hits.push(hit);
  }
}

/**
 * A resting soldier's patrol (`e.param`: its look 0–3, bits 2–3 the rounds of looks left, bit 4 walking; `e.timer` the
 * look's or the walk's ticks left).
 */
function patrol(b: BattleState, e: Entity): void {
  if (e.param & 16) {
    if (e.timer <= 0) {
      e.vx = e.vy = 0;
      e.param = (1 + randomInt(b, 2)) << 2;
      e.timer = SOLDIER_FIRST_LOOK;
    }
  } else if (e.timer <= 0) {
    const look = ((e.param & 3) + 1) & 3;
    let rounds = (e.param >> 2) & 3;
    if (rounds > 0) {
      if (look === 0) rounds--;
      e.param = look | (rounds << 2);
      e.timer = SOLDIER_LOOK_TICKS;
    } else {
      const sideways = e.facing === "right" || e.facing === "left";
      e.facing = sideways ? (randomInt(b, 2) ? "up" : "down") : randomInt(b, 2) ? "left" : "right";
      e.param = 16;
      e.timer = SOLDIER_WALK_MIN + randomInt(b, SOLDIER_WALK_SPREAD);
    }
  }
  if (e.param & 16) {
    const [sx, sy] = FACING_STEP[e.facing];
    e.vx = sx * SOLDIER_PATROL_SPEED;
    e.vy = sy * SOLDIER_PATROL_SPEED;
  }
  e.timer--;
}

/** The Link a patrolling soldier notices: the nearest, the way it looks (or walks) and near enough (`patrol`). */
function soldierSees(state: GameState, e: Entity): number {
  const i = nearestTarget(state, e.x, e.y, SOLDIER_WALK_SIGHT);
  const p = state.players[i];
  if (!p) return -1;
  const dx = Math.floor(p.x / SUBPX) - Math.floor(e.x / SUBPX), dy = Math.floor(p.y / SUBPX) - Math.floor(e.y / SUBPX);
  const way: Facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
  const walking = (e.param & 16) !== 0;
  if (way !== (walking ? e.facing : SOLDIER_LOOKS[e.facing][e.param & 3])) return -1;
  return walking || dx * dx + dy * dy <= SOLDIER_SIGHT * SOLDIER_SIGHT ? i : -1;
}

/** Is a magic circle open (a circle with a switch only opens while it's on: Hyrule Castle's take turns)? */
export function circleOpen(b: BattleState, e: Entity): boolean {
  const n = ownSwitch(b.props.actors[e.home]?.params ?? 0);
  return n === 0 || switchOn(b, n);
}

/** Do the eternal flames burn (BLZ2 waits for its switch, params bit 4)? */
export function flameLit(b: BattleState, e: Entity): boolean {
  const p = b.props.actors[e.home]?.params ?? 0;
  return ((p >>> 4) & 1) === 0 || switchOn(b, ownSwitch(p));
}

/** One tick of every hazard, switch, logic actor and critter in the arena, in actor-list order. */
export function stepHazards(state: GameState, world: World): void {
  const b = state.battle!;
  for (const e of b.entities) {
    if (isRemoved(e)) continue;
    switch (e.kind) {
      case "logic":
        stepLogic(b, e);
        break;
      case "crystal":
        stepCrystal(b, e);
        break;
      case "flame": {
        // It lights on the tick it sees its switch on and burns from the next (traced: a Link inside one hurt two ticks
        // after the switch word changed).
        const lit = flameLit(b, e), was = e.phase === "active";
        if (lit !== was) setPhase(e, lit ? "active" : "rest");
        if (lit && was) for (const i of touching(state, boxAround(e.x, e.y, FLAME_HALF))) burn(state, i, e.x, e.y, "flame", FLAME_DAMAGE, FLAME_KNOCK);
        break;
      }
      case "jet":
        stepJet(state, e);
        break;
      case "firebar":
        e.angle = (e.angle + firebarSpeed(b, e)) & 0xffff;
        for (const ball of fireballs(b, e)) {
          for (const i of touching(state, boxAround(ball.x, ball.y, FIREBALL_HALF))) burn(state, i, ball.x, ball.y, "firebar", FIREBAR_DAMAGE);
        }
        break;
      case "switch":
        stepSwitch(state, e);
        break;
      case "trapdoor":
        stepTrapdoor(state, e);
        break;
      case "bee":
        stepBee(state, e);
        break;
      case "hen":
        stepHen(state, e);
        break;
      case "angryCucco":
        stepAngryCucco(state, e);
        break;
      case "soldier":
        stepSoldier(state, e, world);
        break;
      case "bowSoldier":
        stepBowSoldier(state, e, world);
        soldierContact(state, e);
        break;
      case "captain":
        stepCaptain(state, e, world);
        soldierContact(state, e);
        break;
      case "ballSoldier":
        stepBallSoldier(state, e, world);
        ballSoldierContact(state, e);
        break;
      case "soldierArrow":
        stepSoldierArrow(state, e, world);
        break;
      case "circle":
        // It grows while open (its switch on, or for a while after it took someone) and shrinks when closed, 1/50 per
        // tick (CIRC update 0x8028AE2C); full size for CIRCLE_SETTLE ticks, it takes Links (siderooms.ts).
        e.timer = Math.max(0, Math.min(CIRCLE_GROW_TICKS, e.timer + (circleOpen(b, e) || e.param > 0 ? 1 : -1)));
        if (e.timer < CIRCLE_GROW_TICKS) {
          e.tick = 0;
          break;
        }
        // Full size for the first time this round, a castle circle (color 5) asks for its message (messages.ts;
        // `angle` 1 once it did).
        if (!e.angle && ((b.props.actors[e.home]?.params ?? 0) & 7) === 5) {
          e.angle = 1;
          askMessage(state, MESSAGE.darkWorld);
        }
        if (e.param > 0) e.param--;
        if (++e.tick > CIRCLE_SETTLE) takeIntoCircle(state, e);
        break;
      case "debris":
        if (--e.timer <= 0) removeEntity(e);
        break;
      case "cannon":
        stepCannon(state, e);
        break;
      case "shadowLink":
        stepShadowLink(state, e);
        break;
      case "bigBomb":
        stepBigBomb(state, e);
        break;
    }
  }
  stepPanels(state, world);
}
