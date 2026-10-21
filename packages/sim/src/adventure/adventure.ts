// The Hyrulean Adventure: a stage's rooms one at a time, the current room (or the GBA-screen area the Links went
// into) simulated as a Shadow Battle arena in `GameState.battle` (docs/ADVENTURE.md "Design"), plus what the stage
// remembers in `adventure`: where the Links are, what they collected, the enemies. Plain data advanced by
// stepAdventure, deterministic, cloned by cloneAdventure, hashed by hashGame like any game state.
//
// Measured in Dolphin (docs/measurements/adventure-lake-hylia.md "Adventure: rooms and doors"):
// - room changes on all four sides: the leader within ROOM_EDGE px of a side with a room beyond walks on by himself
//   (rooms.ts; the up and down ones traced like left and right), the other Links stacked onto him;
// - doors and other warps (WARP actors: params byte 0 & 7 = the area they lead to, bytes 1 and 2 its 16 px box's
//   top-left in 8 px units, byte 3 the style): the box is passable, and the leader walking within 12 px of its
//   middle goes through: 39 ticks walking on at 0.5 px/tick (state 28), then he stands in the middle of the other box
//   for 31 ticks and walks out 40 ticks at 0.5 px/tick (state 29) before control returns. A GBA-screen area with no
//   warp of its own at a door leads back through the warp that led in (a house's door).
import { cloneBattle, createBattle, type BattleState } from "../battle.ts";
import { landSlams } from "../carry.ts";
import { createFighter, HEART, hurtFighter, KNOCK_SLOW, makeInvincible, stepFighter, vulnerable, type Fighter } from "../combat.ts";
import { battleWorld, entityById, isRemoved, spawnEntity, type Entity } from "../entities.ts";
import type { GameState } from "../game.ts";
import { moveHook } from "../moves.ts";
import { Button, createPlayer, moveAxis, SUBPX, type Facing, type PlayerState } from "../player.ts";
import { useItem } from "../items.ts";
import { ROOM_EDGE, ROOM_WALK_DIVISOR, ROOM_WALK_LEAD, ROOM_WALK_TICKS, stepRoomTransition, type RoomTransition } from "../rooms.ts";
import { stepArena, stepStrikes } from "../arenastep.ts";
import { LAUNCH_FALL_MAX, LAUNCH_GRAVITY, LAUNCH_SHOW_TICK, LAUNCH_TV_TICK, LAUNCH_Z } from "../siderooms.ts";
import { ROOM_H, ROOM_W, type World } from "../world.ts";
import { catchInCannon, stepCannon } from "./cannon.ts";
import { fallsWaiting, startFallsDrop, stepFallsDrop, stepFallsTop, stepTileFalls } from "./falls.ts";
import { BUSH_DEBRIS, dropFromBush, spawnEnemies, stepEnemies, type Enemy, type Score } from "./enemies.ts";
import { spawnGenerators, stepGenerators, type Generator } from "./generators.ts";
import { newSlots, type SoldierSlots } from "./soldiers.ts";
import { FORMATION_BUTTONS, gatherDone, gatherOnLeader, holdFormation, pickApart, pickFormation, recordTrail, resetTrails, shareHearts, stepFollower, stepFormationFollower, type FormationKind } from "./formation.ts";
import { openChest, stepReveal } from "./chests.ts";
import { startOwlTalk, startTalk, stepGet, stepTalk, type GetPose, type Talk } from "./dialogue.ts";
import { arrowWorld, stepArrows } from "./bow.ts";
import { stepLampPose, useLamp } from "./lamp.ts";
import { gateWorld, startStairs, stepGates, stepStairs, type StairsTrip } from "./stairs.ts";
import { blockWorld, ringWorld, stepBlocks, stepPoints, type MovedBlock } from "./tileblocks.ts";
import { colorBlockWorld, stepColorBlocks } from "./colorblocks.ts";
import { spawnGanon, stepGanon, type Ganon } from "./phantomganon.ts";
import { carryingKey, doorWorld, keyThrowHolds, knockKeyOut, liftKey, shutDoors, stepDoors, stepKeyLift, stepKeyThrow, throwKey, type CarriedKey, type KeyThrow } from "./doors.ts";
import { rewriteWorld, rewrittenTiles, savedSwitches, saveSwitches, stepLogic } from "./logic.ts";
import { barrierWorld, stepZoras, type Escort } from "./zoras.ts";
import { spawnPickups, stepPickups, stepRains, type Pickup, type Rain } from "./pickups.ts";
import { boomerangFetch, flyingWorld, giveGear, swordOnCrystals, friendlyFire, stepFire, stepFirePose, takeFromPedestal, useFireRod, type FireBolt, type GearKind } from "./gear.ts";
import { followHop, noteLadder, noteLedge, startJump, startLadderClimb, stepJump } from "./ledge.ts";
import { createMotion, type LinkMotion } from "./motion.ts";
import { notePush, pushIdle, stepPush } from "./push.ts";
import { carriesRock, heavyHolds, heavyLifted, holdCarry, rockWorld, spawnRocks, stepCarried, stepHeavy, stepRocks, tryHeavyLift, type HeavyLift, type Rock } from "./rocks.ts";
import type { AdventureStage, Area, Door } from "./stage.ts";
import { flyLinks, sideLiftLink, stepSideCarry } from "./sidecarry.ts";
import { pullHandle, spawnPulls, stepPulls } from "./pullswitch.ts";
import { holdLever, spawnLevers, stepLevers, type Lever } from "./lever.ts";
import { stepSideView } from "./sideview.ts";
import { anchorInDeepWater, enterWater, stepSwim, STONE_DAMAGE, SWIM_ANIMATION_TICKS } from "./swim.ts";
import { startCrossSpin, stepCrossSpin, stepCrossSpinFollower, type CrossSpin } from "./whirl.ts";

/** Hearts a Link starts the adventure with (the Lake Hylia savestate: 16 life, 4 hearts). TODO(measure) per stage. */
export const ADVENTURE_HEARTS = 4;
/** Warps: within this many px of a warp box's middle (on both axes) the leader goes through (measured: 274.6 below a
 *  door's middle at 264 went, 276.1 didn't; inside, 125 above 136 went, 123.5 didn't). */
export const WARP_REACH = 12;
export const WARP_SPEED = SUBPX / 2; // 0.5 px/tick through a door, both ways (measured)
export const WARP_IN_TICKS = 39; // walking in (state 28)
export const WARP_STILL_TICKS = 31; // standing in the new area's door (the first of them shows the walk going on)
export const WARP_OUT_TICKS = 40; // walking out (state 29)
export const WARP_TICKS = WARP_IN_TICKS + WARP_STILL_TICKS + WARP_OUT_TICKS;
/** The walk cycle runs at 2 ticks per frame through doors, as in a room change's auto-walk (measured). */
const WARP_FRAME_TICKS = 2;
/** A Link out of hearts gets up again here with this many invincibility ticks. TODO(measure): the game over. */
export const REVIVE_INVINCIBLE_TICKS = 180;

/** Going through a warp: `tick` counts from 1 on the tick after the leader reached it. */
export interface WarpTrip {
  /** Where it leads: the area and its box's top-left (area px). */
  area: number;
  x: number;
  y: number;
  facing: Facing;
  tick: number;
  /** The box gone through (area px, top-left), for renderers. */
  fromX: number;
  fromY: number;
  /** Down a whirlpool (stepWhirl), not through a door. */
  whirl?: boolean;
  /** Up a side view's water shaft out of its top (stepRise). */
  rise?: boolean;
  /** Through a door of a side view's wall (styles 0x15, 0x16): 1 = from a side view (no walking in), 2 = into one (no
   *  walking out). */
  side?: number;
  /** Shot out of a side view's top edge by a cannon (stepLaunch): out of the hole it leads to, flying, steered at
   *  (vx, vy) (1/256 px per tick). */
  launch?: boolean;
  vx?: number;
  vy?: number;
  /** Shot up out of a side view's top edge into another side view (stepShotInto): the shot's speed then (1/256 px per
   *  tick, up). */
  shotVy?: number;
}

export interface AdventureState {
  /** The stage (boss0WS: 10 × W + S). */
  stage: number;
  /** The current room, and the area in it: 0 = the TV screen, 1-7 = a GBA-screen area (a house, a cave). */
  room: number;
  area: number;
  /** Where the Links came into this area (area px), where a Link out of hearts gets up again. */
  entryX: number;
  entryY: number;
  entryFacing: Facing;
  /** Walking into the next room (rooms.ts), while it lasts; the Links are already in the new room's coordinates. */
  edge: RoomTransition | null;
  /** Going through a door or another warp, while it lasts. */
  warp: WarpTrip | null;
  /** Down a staircase into another room, while it lasts (stairs.ts). */
  stairs: StairsTrip | null;
  /** Doors rising (stairs.ts): the actor's key (actorKey), the tick it started; key, tick… */
  gates: number[];
  /** Drawbridges lowering (logic.ts SPBG): the actor's key, the tick its switch was seen on; key, tick… */
  bridges: number[];
  /** The current area's blocks pushed (tileblocks.ts). */
  blocks: MovedBlock[];
  /** The current area's color blocks pushed (colorblocks.ts): actor index, ticks into its slide; index, ticks… */
  colorBlocks: number[];
  /** The current area's pull switches (pullswitch.ts): actor index, how far out, the tick last pulled; index, … */
  pulls: number[];
  /** The room's boss, Phantom Ganon (phantomganon.ts), and the rooms whose boss is beaten. */
  ganon: Ganon | null;
  beatenBosses: number[];
  /** The current area's chain levers (lever.ts), and the one the leader holds (an index in it, -1 none). */
  levers: Lever[];
  grab: number;
  /** Force Gems collected. */
  gems: number;
  /** Keys carried (doors.ts), and the ticks left of one's lift. */
  keys: number;
  keyLift: number;
  /** Placed things already taken (Force Gems, keys…): room × 4096 + the actor's index in the room's list. */
  taken: number[];
  /** Chests opened, by the same key. */
  opened: number[];
  /** Speakers that talk by themselves, once (the owl, the escort Zora: dialogue.ts), by the same key. */
  talked: number[];
  /** PNPCs whose tile stays for good once written, and spikes lowered for good (THRN; logic.ts), by the same key. */
  rewritten: number[];
  /** Each room's switches as the Links left it: room, switches, room, switches… (logic.ts). */
  roomSwitches: number[];
  /** A FOCS the camera is going to (logic.ts): its index in the room's list, where it is, ticks so far. */
  focus: { actor: number; x: number; y: number; tick: number } | null;
  /** A locked door opening (doors.ts): its index in the room's list, ticks so far. */
  opening: { actor: number; tick: number } | null;
  /** What an opened chest shows rising out of it (chests.ts): its content, where (area px), ticks so far. */
  reveal: { content: number; x: number; y: number; tick: number } | null;
  /** Buttons ignored until released (a press used up by a chest). */
  ignore: number;
  /** A sign or a person's message on show (dialogue.ts). */
  talk: Talk | null;
  /** The players with a controller (AdventureStart.controllers): a message's branch4 takes its message by it (dialogue.ts). */
  controllers: number;
  /** The game flags set by messages (setFlag; dialogue.ts): flagKey's keys. */
  flags: number[];
  /** An item got: its pose's ticks and the message it shows (dialogue.ts). */
  get: { tick: number; message: number; pose: GetPose; talkAt?: number } | null;
  /** The tick the stage was cleared on (the goal with the quota: logic.ts), 0 before. */
  cleared: number;
  /** The current area's enemies (enemies.ts). */
  enemies: Enemy[];
  /** The sword soldiers' attack slots (soldiers.ts). */
  slots: SoldierSlots;
  /** Per Link, enemies killed this stage and the count at the last reward, and the rewards to come (enemies.ts
   *  STREAK; the current area's). */
  streak: { kills: number[]; seen: number[]; scores: Score[] };
  /** The current area's enemy generators and kill counters (generators.ts). */
  gens: Generator[];
  /** Enemies killed in the room since the Links came in (SKIL). */
  kills: number;
  /** The newest battle entity whose bush debris was looked at for a drop (enemies.ts dropFromBush). */
  bushSeen: number;
  /** The current area's Force Gems, hearts and keys still to take (pickups.ts). */
  pickups: Pickup[];
  /** The current area's Force Gem rains (pickups.ts). */
  rains: Rain[];
  /** Per Link but the last, the points it passed that the Link behind it is still to walk (formation.ts), 1/256 px. */
  trails: number[][];
  /** The leader's push (push.ts): ticks walking without progress, pushing, its animation tick, ticks since the stick
   *  was released, the standing tick after a turned push. */
  push: { ticks: number; on: boolean; tick: number; release: number; idle: number };
  /** The current area's big rocks (rocks.ts). */
  rocks: Rock[];
  /** The two-Link rock being lifted, carried or thrown (rocks.ts). */
  heavy: HeavyLift | null;
  /** A carried key being thrown (doors.ts), the key last lifted (for a throw), and the keys thrown and landed, for the
   *  stage: key, x, y (1/256 px), … (pickups.ts layKey). */
  keyThrow: KeyThrow | null;
  carried: CarriedKey | null;
  keysDown: number[];
  /** Whether the first key the Links got has shown its message (dialogue.ts). */
  keyTold: boolean;
  /** Rocks lifted away for good, by the same key as `taken`. */
  moved: number[];
  /** Boulders sunk in the water for good: key, x, y (1/256 px), key, x, y… */
  sunk: number[];
  /** The leader's item (gear.ts), the Fire Rod's pose tick (0: none), its fireballs, the stumps burning (tile key,
   *  ticks…) and burnt (tile keys: gear.ts tileKey). */
  gear: GearKind;
  pose: number;
  bolts: FireBolt[];
  fires: number[];
  burnt: number[];
  /** The pedestals whose item was taken (gear.ts): tile key, the item now on it (Link +0xC10's number, 0 none)… */
  pedestals: number[];
  /** Fragile blocks broken (zoras.ts), by tile key (gear.ts tileKey). */
  broken: number[];
  /** The escort Zora following the Links (zoras.ts), and the ticks every arrival point of the room has waited. */
  escort: Escort | null;
  fairy: number;
  /** The followers' formation (formation.ts): the trail, one picked with the C stick, apart or being called back. */
  formation: FormationKind;
  /** The cross formation's spin attack under way (whirl.ts). */
  crossSpin: CrossSpin | null;
  /** Which Link (its tunic: 0 green, 1 red, 2 blue, 3 purple) is in each slot; slot 0 is the one in control. */
  colors: number[];
  /** Ticks the leader has swum over a waterfall's lip (falls.ts). */
  falls: number;
  /** Per Link, swimming and ledge jumps (motion.ts). */
  links: LinkMotion[];
  /** The Links apart left in another area when the one in control went through a door or a room change (formation.ts):
   *  that area, where they stand (x, y per follower, 1/256 px) and the bushes and pots cut there (`cut`, the arena's:
   *  kept while they're there, so the area doesn't regrow them when he comes back); meanwhile they're parked out of
   *  the way (AWAY_PX). */
  away: { room: number; area: number; at: number[]; cut: number[] } | null;
  /** Ledge jumps the leader made that followers are still to make where he did (ledge.ts): from (x, y) to (tx, ty),
   *  1/256 px; `left` = a bit per follower still to jump. */
  hops: { x: number; y: number; tx: number; ty: number; left: number; drop?: boolean }[];
  /** Ticks into the four-Link switch's snap pose (logic.ts catchFour, motion.ts), -1 when none. */
  fourSnap: number;
  nextId: number;
  /** The adventure's random generator (xorshift32), which also seeds each area's arena. */
  rng: number;
}

/** A game state in the adventure: the current area's arena is always there. */
export interface AdventureGame extends GameState {
  adventure: AdventureState;
  battle: BattleState;
}

export interface AdventureStart {
  /** Start in this room (the stage's start room by default)… */
  room?: number;
  /**
   * …at this room px (the room's PLAS starts, else its middle, by default): all the Links, stacked on the leader as a
   * door or a room change stacks them (followers walk their trail through walls, so they mustn't start elsewhere).
   */
  x?: number;
  y?: number;
  facing?: Facing;
  /** Links: 1 (the leader alone, the default) to 4. */
  players?: number;
  /** Players with a controller, 1 to 4: 1 by default, the one-player adventure (its four Links follow the leader's buttons). */
  controllers?: number;
  hearts?: number;
  /** What the stage before it in a run ended with (carryOf): the Links' hearts and the leader's item. */
  carry?: AdventureCarry;
  seed?: number;
}

/**
 * What a stage hands on to the next one of a run (apps/game run.ts): each Link's hearts (quarter hearts, as
 * Fighter.hearts; the Links' hearts are one shared meter in the formation, so they match), the maximum (whole hearts,
 * the battle's rules.hearts) and the leader's item (gear.ts). Not the Force Gems (the run keeps them per stage) nor the
 * keys (the stage's locked doors). Assumed, not measured: the game carries the hearts it has at the end of a stage.
 */
export interface AdventureCarry {
  hearts: number[];
  maxHearts: number;
  gear: GearKind;
}

/** The carry a finished stage hands on: a Link out of hearts carries the maximum, as the Link gets up with it (revive). */
export function carryOf(game: AdventureGame): AdventureCarry {
  const max = game.battle.rules.hearts;
  return { hearts: game.battle.fighters.map((f) => (f.hearts > 0 ? f.hearts : max * HEART)), maxHearts: max, gear: game.adventure.gear };
}

/** Puts a carry into a new game's Links (up to the maximum, a Link missing from it at full hearts) and its leader's item. */
export function applyCarry(game: AdventureGame, carry: AdventureCarry): void {
  const max = game.battle.rules.hearts * HEART;
  game.battle.fighters.forEach((f, i) => {
    f.hearts = Math.max(1, Math.min(max, carry.hearts[i] ?? max));
  });
  giveGear(game, carry.gear);
}

/** A thing's key in `taken` / `opened`. */
export const actorKey = (room: number, index: number) => room * 4096 + index;

/** A new adventure on `stage`. */
export function createAdventure(stage: AdventureStage, opts: AdventureStart = {}): AdventureGame {
  const start = stage.start();
  const room = opts.room !== undefined && stage.cellOf(opts.room) ? opts.room : start.room;
  const count = Math.max(1, Math.min(4, opts.players ?? 1));
  const spawns = Array.from({ length: count }, (_, i) => {
    const s = room === start.room ? (start.spawns[i] ?? start.spawns[0]!) : { x: ROOM_W / 2, y: ROOM_H / 2, facing: "down" as Facing };
    return opts.x !== undefined && opts.y !== undefined ? { x: opts.x, y: opts.y, facing: opts.facing ?? s.facing } : { ...s, facing: opts.facing ?? s.facing };
  });
  const hearts = opts.carry?.maxHearts ?? opts.hearts ?? ADVENTURE_HEARTS;
  const leader = spawns[0]!;
  const adventure: AdventureState = {
    stage: stage.index,
    room,
    area: 0,
    entryX: leader.x,
    entryY: leader.y,
    entryFacing: leader.facing,
    edge: null,
    warp: null,
    stairs: null,
    gates: [],
    bridges: [],
    blocks: [],
    colorBlocks: [],
    pulls: [],
    ganon: null,
    beatenBosses: [],
    levers: [],
    grab: -1,
    gems: 0,
    keys: 0,
    keyLift: 0,
    taken: [],
    opened: [],
    talked: [],
    rewritten: [],
    roomSwitches: [],
    focus: null,
    opening: null,
    reveal: null,
    ignore: 0,
    talk: null,
    controllers: Math.max(1, Math.min(4, opts.controllers ?? 1)),
    flags: [],
    get: null,
    cleared: 0,
    enemies: [],
    slots: newSlots(),
    streak: { kills: spawns.map(() => 0), seen: spawns.map(() => 0), scores: [] },
    gens: [],
    kills: 0,
    bushSeen: 0,
    pickups: [],
    rains: [],
    trails: [],
    push: { ticks: 0, on: false, tick: 0, release: 0, idle: 0 },
    rocks: [],
    heavy: null,
    keyThrow: null,
    carried: null,
    keysDown: [],
    keyTold: false,
    moved: [],
    sunk: [],
    gear: "",
    pose: 0,
    bolts: [],
    fires: [],
    burnt: [],
    pedestals: [],
    broken: [],
    escort: null,
    fairy: 0,
    formation: "trail",
    crossSpin: null,
    colors: spawns.map((_, i) => i),
    falls: 0,
    links: spawns.map(() => createMotion()),
    hops: [],
    fourSnap: -1,
    away: null,
    nextId: 1,
    rng: (opts.seed ?? 1) >>> 0 || 1,
  };
  const players = spawns.map((s) => createPlayer(s.x, s.y, s.facing));
  const fighters = spawns.map((s) => createFighter(hearts * HEART, s));
  const game = { tick: 0, room, players, adventure } as AdventureGame;
  game.battle = areaArena(stage.area(room, 0), fighters, hearts, nextRandom(adventure));
  if (opts.carry) applyCarry(game, opts.carry);
  resetTrails(game);
  spawnEnemies(game, stage);
  spawnGanon(game, stage);
  spawnGenerators(game, stage);
  spawnPickups(game, stage);
  spawnRocks(game, stage);
  spawnPulls(game, stage);
  spawnLevers(game, stage);
  return game;
}

/** xorshift32 step of the adventure's generator. */
export function nextRandom(a: AdventureState): number {
  let x = a.rng | 0 || 0x6d2b79f5;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  a.rng = x >>> 0;
  return a.rng;
}

/** An area's arena: its props live (bushes, switches, bombs, hazards), the Links' fighters carried over. */
function areaArena(area: Area, fighters: Fighter[], hearts: number, seed: number): BattleState {
  const spawns = fighters.map((f) => ({ x: f.spawnX, y: f.spawnY, facing: f.spawnFacing }));
  const b = createBattle(area.room, spawns, { hearts, timeLimit: 0, wins: 1, free: true }, area.props, seed).battle!;
  delete b.rules.free; // free play undoes damage in stepBattle only; the adventure never calls it
  b.phase = "play";
  b.fighters = fighters;
  return b;
}

/** The area the Links are in. */
export function currentArea(game: AdventureGame, stage: AdventureStage): Area {
  return stage.area(game.adventure.room, game.adventure.area);
}

/** The current area's collision with this arena's changes (cut bushes, open trapdoors), the PNPCs' tiles and the shut doors. */
export function areaWorld(game: AdventureGame, stage: AdventureStage): World {
  const world = rewriteWorld(battleWorld(currentArea(game, stage).world, game.battle), rewrittenTiles(game, stage), stage);
  return barrierWorld(colorBlockWorld(ringWorld(blockWorld(gateWorld(rockWorld(doorWorld(world, shutDoors(game, stage)), game.adventure.rocks), game, stage), game), game, stage), game, stage), game, stage);
}

/** Advances the adventure one 60 Hz tick; `inputs` are the players' button masks (the leader's first). */
export function stepAdventure(game: AdventureGame, inputs: readonly number[], stage: AdventureStage): AdventureGame {
  const a = game.adventure, b = game.battle;
  b.hits = [];
  // A press used up (a chest) stays ignored until it's released.
  const held = inputs[0] ?? 0;
  a.ignore &= held;
  if (a.ignore) inputs = [held & ~a.ignore, ...inputs.slice(1)];
  // Cleared: the Links stand where they are; so while a boss holds them (Phantom Ganon's demo lock).
  if (a.cleared || a.ganon?.lock) inputs = inputs.map(() => 0);
  // The owl talks by itself when the Links come up to it (dialogue.ts).
  startOwlTalk(game, stage);
  // A message on show: the leader stands while it types and turns its pages; an item got: the pose first (dialogue.ts).
  if (a.talk) inputs = [stepTalk(game, stage, inputs[0] ?? 0), ...inputs.slice(1)];
  if (stepGet(game)) inputs = [0, ...inputs.slice(1)];
  // A key thrown flies on, whatever the leader does (doors.ts stepKeyThrow).
  if (a.keyThrow) stepKeyThrow(game, flyingWorld(areaWorld(game, stage), game, stage));
  if (a.edge) stepEdge(game, stage, inputs);
  else if (a.warp) stepWarp(game, stage, inputs);
  else if (a.stairs) {
    stepStairs(game, stage, inputs);
    if (!a.stairs) resetTrails(game);
  } else {
    const view = areaWorld(game, stage), area = currentArea(game, stage);
    const moves = moveHook(game);
    const hearts = b.fighters[0]!.hearts;
    const leader = game.players[0]!, m = a.links[0]!;
    const pressedNow = (inputs[0] ?? 0) & ~leader.held;
    // (A two-Link rock lifted keeps its Links' places: no formation, apart or switch of Link until it's thrown.)
    if (!heavyLifted(game)) {
      pickFormation(game, inputs[0] ?? 0, leader.held);
      pickApart(game, inputs[0] ?? 0, leader.held);
    }
    // The other Links follow first (the second one sees where the leader stood: measured), in order; knocked back or
    // falling they play that out instead. In a C-stick formation they move with him, after him (traced: in step).
    const rigid = a.formation !== "trail";
    if (!rigid && !a.away) for (let i = 1; i < game.players.length; i++) stepOther(game, i, view, area.sideView);
    if (m.mode === "ashore") m.mode = "walk";
    if (stepFallsDrop(game) || fallsWaiting(game, inputs[0] ?? 0)) {
      // Over a waterfall: dropping into the pool, or waiting at the falls' foot for Down (falls.ts).
      for (const f of b.fighters) tickFighter(f);
    } else if (m.mode === "fall") {
      // (Down: the room change below.)
    } else if (stepJump(game, 0, view)) {
      // In the air (the tick after the landing is an ordinary standing one).
    } else if (area.sideView) {
      tickFighter(b.fighters[0]!);
      if (downed(b.fighters[0]!)) {
        // Struck in a side view (a Keese, a fish): the knockback's hop plays out, then he's back (else he stayed
        // "hurt"); out of hearts, he dies (revive).
        stepFighter(leader, b.fighters[0]!, 0, view);
      } else if (stepSideCarry(game, inputs[0] ?? 0, view) || sideLiftLink(game, inputs[0] ?? 0)) {
        // (Another Link lifted, carried or thrown: sidecarry.ts.)
      } else if (sideLift(game, inputs[0] ?? 0)) {
        // (A pot beside him lifted and thrown away.)
      } else if (m.mode === "walk" && openChest(game, stage, inputs[0] ?? 0) !== (inputs[0] ?? 0)) {
        // (A chest beside him opened: chests.ts.)
      } else if (m.mode === "walk" && !m.air && (inputs[0] ?? 0) & ~leader.held & Button.Item && b.fighters[0]!.item === "bomb") {
        // A bomb put down in front of him, as on the TV (assumed: it stays where it's put).
        useItem(game, 0);
        leader.held = inputs[0] ?? 0;
      } else if (!stepCannon(game, area, inputs[0] ?? 0, view)) {
        const y0 = leader.y;
        stepSideView(m, leader, inputs[0] ?? 0, view);
        catchInCannon(game, area, y0);
      }
    } else if (m.mode === "swim" || m.mode === "wade") {
      tickFighter(b.fighters[0]!);
      // Struck in the water (a Zora's fireball): the knockback plays out as in a side view, then he swims on (else he
      // stayed "hurt" and swam no more).
      if (downed(b.fighters[0]!)) stepFighter(leader, b.fighters[0]!, 0, view);
      else if (m.mode === "swim" && startLadderClimb(game, stage, area, inputs[0] ?? 0)) {
        // (Out of the water up a ladder's foot: ledge.ts.)
      } else {
        let stone: readonly [number, number] | null = null;
        const y0 = leader.y;
        if (stepSwim(m, leader, inputs[0] ?? 0, view, (s) => (stone ??= s)) && stone) strikeOnStone(game, stone);
        noteLadder(game, stage, area, y0, inputs[0] ?? 0);
      }
    } else if (stepCrossSpin(game, view) || stepKeyLift(game) || stepFirePose(game, inputs[0] ?? 0) || stepLampPose(game, stage, inputs[0] ?? 0) || heavyHolds(game, 0) || keyThrowHolds(game) || pullHandle(game, stage, inputs[0] ?? 0) || holdLever(game, stage, inputs[0] ?? 0)) {
      tickFighter(b.fighters[0]!);
      leader.held = inputs[0] ?? 0;
    } else if (heavyLifted(game) || !startJump(game, stage, area, view, 0, inputs[0] ?? 0)) {
      let input = carryingKey(game, openChest(game, stage, startTalk(game, stage, inputs[0] ?? 0)));
      if (takeFromPedestal(game, stage, input) || (a.heavy?.phase === "carry" && input & ~leader.held & Button.Action)) input &= ~Button.Action;
      if (throwKey(game, inputs[0] ?? 0)) {
        tickFighter(b.fighters[0]!);
        leader.held = inputs[0] ?? 0;
      } else if (liftKey(game, input)) {
        tickFighter(b.fighters[0]!);
        leader.held = input;
      } else if (tryHeavyLift(game, input)) {
        tickFighter(b.fighters[0]!);
        leader.held = input;
      } else if (useFireRod(game, input) || useLamp(game, input)) {
        tickFighter(b.fighters[0]!);
      } else if (pushIdle(game, input) || stepPush(game, input, view)) {
        // Leaning on a wall: his invincibility runs on (as in Shadow Battle's push), else he'd blink on, unhurt.
        tickFighter(b.fighters[0]!);
      } else {
        const x0 = leader.x, y0 = leader.y;
        stepFighter(leader, b.fighters[0]!, input, view, moves);
        holdCarry(game, x0, y0);
        if (!heavyLifted(game) && !a.away) holdFormation(game, view, x0, y0);
        notePush(game, x0, y0);
        noteLedge(game, stage, area, 0, x0, y0, input);
      }
      if (!area.sideView && enterWater(m, leader, view)) Object.assign(a.push, { on: false, ticks: 0, release: 0, idle: 0 });
    }
    // (The cross formation's spin let go: the whirl, the followers' first tick of it next.)
    startCrossSpin(game);
    if (rigid && !a.away) for (let i = 1; i < game.players.length; i++) stepOther(game, i, view, area.sideView);
    flyLinks(game, view, area.sideView);
    gatherDone(game);
    if (a.area === 0) {
      stepFallsTop(game, area);
      stepTileFalls(game, stage, area);
    }
    stepRocks(game, view, inputs[0] ?? 0);
    const tiles = rewrittenTiles(game, stage);
    stepBlocks(game, stage, view, tiles);
    stepColorBlocks(game, stage, view);
    stepPoints(game, stage, tiles);
    stepPulls(game, stage);
    stepHeavy(game, inputs[0] ?? 0, pressedNow);
    recordTrail(game, 0);
    landSlams(game);
    swordOnCrystals(game);
    friendlyFire(game);
    // (Generators see a switch set this tick on the next: traced, room 5's first soldier the tick after its switch.)
    stepGenerators(game, stage);
    const flyers = flyingWorld(view, game, stage);
    stepArena(game, flyers, true, arrowWorld(flyers, game, stage));
    boomerangFetch(game);
    stepArrows(game, stage);
    stepFire(game, stage, view);
    stepEnemies(game, stage, view);
    stepGanon(game, view);
    stepLogic(game, stage);
    stepZoras(game, stage);
    stepLevers(game, stage, inputs[0] ?? 0);
    stepDoors(game, stage);
    stepGates(game, stage);
    stepReveal(game);
    stepRains(game, stage);
    stepPickups(game);
    stepStrikes(game);
    bushDrops(game);
    // (A hit on the leader carrying a key knocks it out of his hands: doors.ts.)
    knockKeyOut(game);
    shareHearts(b.fighters, hearts, b.rules.hearts * HEART);
    revive(game);
    // Apart, the one in control leaves the area alone (traced through a door; room changes assumed alike).
    if (a.formation !== "gather" && !startEdge(game, stage, inputs[0] ?? 0) && !startStairs(game, stage)) startWarp(game, stage, inputs[0] ?? 0);
  }
  game.tick++;
  return game;
}

/** Bushes cut or broken this tick (their debris) may leave something (enemies.ts dropFromBush). */
function bushDrops(game: AdventureGame): void {
  const a = game.adventure;
  for (const e of game.battle.entities) {
    if (e.id <= a.bushSeen) continue;
    if (e.kind === "debris" && e.param === BUSH_DEBRIS) dropFromBush(game, e.x, e.y);
  }
  a.bushSeen = game.battle.nextId - 1;
}

/** The swimming leader run into a river stone: struck by it, away from the sensor that ran into it (swim.ts STONE_DAMAGE). */
function strikeOnStone(game: AdventureGame, sensor: readonly [number, number]): void {
  const p = game.players[0]!, f = game.battle.fighters[0]!, m = game.adventure.links[0]!;
  if (!vulnerable(f) || !hurtFighter(p, f, 0, STONE_DAMAGE, p.x + sensor[0], p.y + sensor[1], { cause: "stone", knock: KNOCK_SLOW })) return;
  m.cx = m.cy = 0;
  m.speed = 0;
}

/** Struck (the knockback's hop), dying or dead: the battle's fighter step plays it out, not the walk, swim or side view's. */
const downed = (f: Fighter) => f.mode === "hurt" || f.mode === "dying" || f.mode === "dead";

// The Links out of hearts (one of them dead) get up again where they came into the area, hearts full. TODO(measure):
// the game's game over (Force Gems lost, a fairy).
function revive(game: AdventureGame): void {
  const a = game.adventure, b = game.battle;
  if (!b.fighters.some((f) => f.mode === "dead")) return;
  b.fighters.forEach((f, i) => {
    const p = game.players[i]!;
    Object.assign(f, createFighter(b.rules.hearts * HEART, { x: a.entryX, y: a.entryY, facing: a.entryFacing }), { item: f.item });
    Object.assign(p, createPlayer(a.entryX, a.entryY, a.entryFacing), { held: p.held });
    makeInvincible(f, REVIVE_INVINCIBLE_TICKS);
    a.links[i] = createMotion();
  });
  a.hops = [];
  a.away = null;
  resetTrails(game);
}

/** The Links in the area with the one in control (all of them unless the others were left apart elsewhere). */
export const present = (game: AdventureGame): PlayerState[] => (game.adventure.away ? game.players.slice(0, 1) : game.players);

/** Where the Links left in another area are parked (px, both axes): far off, nothing reaches them. */
export const AWAY_PX = -8192;

/** The one in control leaves the area: the Links apart stay in it (parked, AdventureState.away). */
function leaveApart(game: AdventureGame): void {
  const a = game.adventure;
  if (a.formation !== "apart" || a.away) return;
  const others = game.players.slice(1);
  a.away = { room: a.room, area: a.area, at: others.flatMap((p) => [p.x, p.y]), cut: [...game.battle.cut] };
  for (const p of others) Object.assign(p, { x: AWAY_PX * SUBPX, y: AWAY_PX * SUBPX, moving: false, walkTicks: 0 });
}

/** Back in the area the Links apart were left in: they're there again, where they stood. */
function rejoinApart(game: AdventureGame): void {
  const a = game.adventure, w = a.away;
  if (!w || w.room !== a.room || w.area !== a.area) return;
  game.players.slice(1).forEach((p, k) => Object.assign(p, { x: w.at[k * 2]!, y: w.at[k * 2 + 1]! }));
  a.away = null;
  resetTrails(game);
}

/** A follower's tick: a ledge jump or its landing, swimming or walking the trail, or the battle code's knockback. */
function stepOther(game: AdventureGame, i: number, view: World, sideView: boolean): void {
  const m = game.adventure.links[i]!, p = game.players[i]!, f = game.battle.fighters[i]!;
  if (m.mode === "ashore") m.mode = "walk";
  if (m.mode === "fall") return; // over a waterfall with the leader (falls.ts)
  if (stepJump(game, i, view)) {
    recordTrail(game, i);
    return;
  }
  if (heavyHolds(game, i)) {
    tickFighter(f);
    return;
  }
  if (f.mode === "active" && f.move === "none") {
    tickFighter(f);
    if (carriesRock(game, i)) {
      // A lifter of the carried rock keeps his place beside the leader, whatever the formation (rocks.ts).
      stepCarried(game, i, view);
      recordTrail(game, i);
    } else if (game.adventure.formation !== "trail") {
      if (game.adventure.crossSpin) stepCrossSpinFollower(game, i, view);
      else stepFormationFollower(game, i, view);
      recordTrail(game, i);
      if (game.adventure.formation in FORMATION_BUTTONS) mirrorSword(game, i);
    } else stepFollower(game, i, m.mode === "swim" || m.mode === "wade");
    if (followHop(game, i)) return;
  } else stepFighter(p, f, 0, view);
  if (sideView) {
    // Following the trail: swimming where it goes through the water.
    const wet = anchorInDeepWater(view, p);
    m.mode = wet ? "swim" : "walk";
    m.side = wet;
    if (wet) m.tick = (m.tick + 1) % SWIM_ANIMATION_TICKS;
    return;
  }
  if (m.mode === "wade") m.mode = "swim";
  if (m.mode === "swim") {
    m.tick = (m.tick + 1) % SWIM_ANIMATION_TICKS;
    if (!anchorInDeepWater(view, p)) {
      m.mode = "ashore";
      p.moving = false;
      p.walkTicks = 0;
    }
  } else enterWater(m, p, view);
}

const SWORD_ACTIONS: ReadonlySet<string> = new Set(["swing", "stab", "charge", "spin"]);

/**
 * In a C-stick formation a follower's sword does what the leader's does (traced in the cross, Hyrule Castle room 58:
 * the four swing, charge and spin together, on the same ticks, each with his own facing's boxes; the cross faces out,
 * the other formations his way).
 */
function mirrorSword(game: AdventureGame, i: number): void {
  const l = game.players[0]!, p = game.players[i]!;
  if (SWORD_ACTIONS.has(l.action)) Object.assign(p, { action: l.action, actionTick: l.actionTick, facing: game.adventure.formation === "cross" ? p.facing : l.facing });
  else if (SWORD_ACTIONS.has(p.action)) Object.assign(p, { action: "none", actionTick: 0 });
}

/** What stepFighter does for a fighter the adventure moves itself: the invincibility runs down. */
function tickFighter(f: Fighter): void {
  if (f.invincible > 0) f.invincible--;
}

// --- room changes ---

/** Starts a room change when the leader is within ROOM_EDGE px of a side of the TV screen with a room beyond. */
function startEdge(game: AdventureGame, stage: AdventureStage, buttons: number): boolean {
  const a = game.adventure, p = game.players[0]!, f = game.battle.fighters[0]!, m = a.links[0]!;
  // (A two-Link rock lifted or carried keeps its Links in the area: rocks.ts heavyLifted.)
  if (a.area !== 0 || heavyLifted(game) || f.mode !== "active" || (f.move !== "none" && f.move !== "ready" && f.move !== "carry")) return false;
  if (m.mode === "jump" || m.mode === "land" || (m.mode === "fall" && (m.tick > 0 || !(buttons & Button.Down)))) return false;
  const cell = stage.cellOf(a.room);
  if (!cell) return false;
  const x = p.x / SUBPX, y = p.y / SUBPX;
  const sides = [
    { dx: 1, dy: 0, d: ROOM_W - x },
    { dx: -1, dy: 0, d: x },
    { dx: 0, dy: 1, d: ROOM_H - y },
    { dx: 0, dy: -1, d: y },
  ];
  for (const { dx, dy, d } of sides) {
    if (d > ROOM_EDGE) continue;
    // Swimming, only toward the side (traced: gliding to 16 px from the top didn't change rooms; pressing up did).
    if (m.mode === "swim" && !(buttons & (dx > 0 ? Button.Right : dx < 0 ? Button.Left : dy > 0 ? Button.Down : Button.Up))) continue;
    const room = stage.roomAtCell(cell.cx + dx, cell.cy + dy);
    if (room < 0) continue;
    leaveApart(game);
    const speed = Math.round((d * SUBPX + ROOM_WALK_LEAD * SUBPX) / ROOM_WALK_DIVISOR);
    a.edge = { room, dx, dy, speed, tick: 0 };
    const shiftX = -dx * ROOM_W * SUBPX, shiftY = -dy * ROOM_H * SUBPX;
    // The other Links are stacked onto the leader (measured), and everyone's in the new room's coordinates.
    p.x += shiftX;
    p.y += shiftY;
    gatherOnLeader(game);
    enterArea(game, stage, room, 0, shiftX, shiftY);
    // Where the auto-walk ends.
    a.entryX = Math.floor((p.x + dx * speed * ROOM_WALK_TICKS) / SUBPX);
    a.entryY = Math.floor((p.y + dy * speed * ROOM_WALK_TICKS) / SUBPX);
    a.entryFacing = p.facing;
    return true;
  }
  return false;
}

function stepEdge(game: AdventureGame, stage: AdventureStage, inputs: readonly number[]): void {
  const a = game.adventure, leader = game.players[0]!;
  // Input is ignored during the auto-walk; a button held through it isn't a new press.
  game.players.forEach((p, i) => (p.held = inputs[i] ?? 0));
  const going = stepRoomTransition(leader, a.edge!);
  gatherOnLeader(game);
  if (!going) {
    a.edge = null;
    startFallsDrop(game, currentArea(game, stage));
  }
}

/**
 * Moves the Links into `room`'s area `sublayer`: its arena replaces the old one (the old area's things are gone; a
 * carried load comes along, shifted by (shiftX, shiftY)), its enemies appear.
 */
export function enterArea(game: AdventureGame, stage: AdventureStage, room: number, sublayer: number, shiftX: number, shiftY: number): void {
  const a = game.adventure, old = game.battle;
  const area = stage.area(room, sublayer);
  // The room's switches are kept (logic.ts); a GBA-screen area shares its room's.
  saveSwitches(game, a.room, old.switches);
  const newRoom = room !== a.room;
  a.focus = null;
  a.room = room;
  a.area = sublayer;
  game.room = room;
  const fighters = old.fighters;
  fighters.forEach((f, i) => {
    const p = game.players[i]!;
    f.spawnX = Math.floor(p.x / SUBPX);
    f.spawnY = Math.floor(p.y / SUBPX);
    f.spawnFacing = p.facing;
  });
  const next = areaArena(area, fighters, old.rules.hearts, nextRandom(a));
  // An area the Links apart are still in keeps the bushes and pots cut there (away.cut); any other area reloads uncut.
  if (a.away && a.away.room === room && a.away.area === sublayer) next.cut = [...a.away.cut];
  // Loads held overhead come along (measured: a room change keeps the carried bush).
  fighters.forEach((f, i) => {
    if (!f.carryEntity) return;
    const e = entityById(old, f.carryEntity);
    if (!e || isRemoved(e)) {
      f.carryEntity = 0;
      return;
    }
    const copy: Entity = spawnEntity(next, e.kind, e.x + shiftX, e.y + shiftY, { ...e, id: next.nextId, x: e.x + shiftX, y: e.y + shiftY, home: -1, owner: i });
    f.carryEntity = copy.id;
  });
  next.switches = (next.switches | savedSwitches(game, room)) >>> 0;
  game.battle = next;
  a.enemies = [];
  a.streak.scores = [];
  a.blocks = [];
  a.colorBlocks = [];
  a.bushSeen = 0;
  if (newRoom) a.kills = 0;
  spawnEnemies(game, stage);
  spawnGanon(game, stage);
  spawnGenerators(game, stage);
  spawnPickups(game, stage);
  spawnRocks(game, stage);
  spawnPulls(game, stage);
  spawnLevers(game, stage);
  rejoinApart(game);
}

// --- side views ---

/**
 * Action standing beside a pot in a side view (left or right, at his body's height): the pot goes (Tingle's Tower room
 * 7's area 5; the lift and the throw aren't played: assumed, the battle's side-room pots fly off the screen's edge).
 */
function sideLift(game: AdventureGame, buttons: number): boolean {
  const l = game.players[0]!, b = game.battle, m = game.adventure.links[0]!;
  if (!(buttons & ~l.held & Button.Action) || m.mode !== "walk" || (l.facing !== "left" && l.facing !== "right")) return false;
  const x = Math.floor(l.x / SUBPX) + (l.facing === "left" ? -12 : 12), y = Math.floor(l.y / SUBPX);
  const tile = (y >> 4) * 32 + (x >> 4);
  if (!b.props.pots?.includes(tile) || b.cut.includes(tile)) return false;
  b.cut.push(tile);
  l.held = buttons;
  return true;
}

// --- warps ---

/** Goes through a warp when the leader, walking, is within WARP_REACH px of its box's middle. */
function startWarp(game: AdventureGame, stage: AdventureStage, buttons: number): boolean {
  const a = game.adventure, p = game.players[0]!, f = game.battle.fighters[0]!, m = a.links[0]!;
  if (f.mode !== "active" || (f.move !== "none" && f.move !== "carry") || p.action !== "none" || heavyLifted(game)) return false;
  // Walking into a door; swimming into a water warp (the whirlpool takes a Link even gliding: traced). In a side view
  // a wall's door takes him when Up is pressed in it (walking past it doesn't: traced), its top edge a Link shot up.
  // (Swimming in a side view, Up at a shaft's top: SWIM_WARP_STYLES' 0x0F.)
  const area = currentArea(game, stage), swimming = m.mode === "swim" && (!m.side || (buttons & Button.Up) !== 0), shot = m.mode === "shot";
  if (!swimming && !shot && (m.mode !== "walk" || !(area.sideView ? buttons & Button.Up : p.moving))) return false;
  const x = Math.floor(p.x / SUBPX), y = Math.floor(p.y / SUBPX);
  // Come out of a whirlpool (Tingle's Tower's tree house pool), it doesn't take him back (until he comes in again).
  const landed = (d: Door) => d.style === WHIRLPOOL_STYLE && Math.abs(a.entryX - (d.x + 8)) <= 24 && Math.abs(a.entryY - (d.y + 8)) <= 24;
  const door = area.doors.find(
    (d) => !landed(d) && Math.abs(x - (d.x + 8)) < (d.style === LAUNCH_STYLE ? LAUNCH_REACH : WARP_REACH) && Math.abs(y - (d.y + 8)) < (d.style === SHAFT_STYLE ? SHAFT_REACH : WARP_REACH) && (!d.gate || switchSet(game.battle, d.gate)) && (!swimming || SWIM_WARP_STYLES.has(d.style) || d.style === 0) && (swimming || d.style !== WHIRLPOOL_STYLE) && shot === (d.style === LAUNCH_STYLE),
  );
  if (!door || !stage.hasArea(a.room, door.to.area)) return false;
  leaveApart(game);
  if (shot) {
    a.warp = { area: door.to.area, x: door.to.x, y: door.to.y, facing: p.facing, tick: 0, fromX: door.x, fromY: door.y, launch: true };
    if (stage.area(a.room, door.to.area).sideView) a.warp.shotVy = m.vy;
    return true;
  }
  if (SIDE_DOOR_STYLES.has(door.style)) {
    const into = stage.area(a.room, door.to.area).sideView;
    a.warp = { area: door.to.area, x: door.to.x, y: door.to.y, facing: area.sideView ? "down" : p.facing, tick: 0, fromX: door.x, fromY: door.y, side: (area.sideView ? 1 : 0) | (into ? 2 : 0) };
    if (area.sideView) p.facing = "up";
    return true;
  }
  if (door.style === WHIRLPOOL_STYLE) {
    a.warp = { area: door.to.area, x: door.to.x, y: door.to.y, facing: p.facing, tick: 0, fromX: door.x, fromY: door.y, whirl: true };
    return true;
  }
  if (door.style === SHAFT_STYLE) {
    a.warp = { area: door.to.area, x: door.to.x, y: door.to.y, facing: "up", tick: 0, fromX: door.x, fromY: door.y, rise: true };
    return true;
  }
  // Styles 0x19 and 0x1A go up and down whatever way he walked in (traced: room 3's hole, walked into from below, is
  // gone down: he comes out walking down).
  const facing: Facing = door.style === 0x19 ? "up" : door.style === 0x1a || door.style === HOLE_STYLE ? "down" : p.facing;
  a.warp = { area: door.to.area, x: door.to.x, y: door.to.y, facing, tick: 0, fromX: door.x, fromY: door.y };
  return true;
}

const switchSet = (b: BattleState, n: number) => ((b.switches >>> n) & 1) === 1;

const STEP: Readonly<Record<Facing, readonly [number, number]>> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };

/**
 * Doors in a side view's walls (traced in Lake Hylia room 7's area 5): from the TV the leader walks in (up) as through
 * any door and arrives in the side view standing in the door; from the side view (Up in the door) he's lined up with its
 * middle and stands there the 39 ticks, then comes out on the TV walking down. Style 0x16 is a top edge only a cannon's
 * shot goes through (LAUNCH_STYLE).
 */
const SIDE_DOOR_STYLES: ReadonlySet<number> = new Set([0x15]);
export const LAUNCH_STYLE = 0x16;
/** How far across a top edge's warp takes a shot (its box, init 0x802290A8: ±24 × ±8; Hyrule Castle room 10's area 6:
 *  the cannon at x 72 under the warp at (48, 0), middle 56). */
export const LAUNCH_REACH = 24;

/** Water warps: the bridge's sides (0x1B, 0x1C: under Lake Hylia's bridge), the whirlpool (0x0E) and the top of a
 *  side view's water shaft (0x0F: Tingle's Tower's underwater passage up out of it, stepRise). */
const SWIM_WARP_STYLES: ReadonlySet<number> = new Set([0x1b, 0x1c, 0x0e, 0x0f]);
export const WHIRLPOOL_STYLE = 0x0e;
/** A hole under a bush (Tingle's Tower room 7's, into its side-view passage): they come out going down (assumed). */
export const HOLE_STYLE = 0x04;
/**
 * The whirlpool (traced in Lake Hylia room 6): 50 ticks spinning down at its middle (state 38, 962-972), then in the
 * area at the target box's middle 56 ticks still (state 39), 32 ticks sinking 1 px/tick, then swimming (side view).
 */
export const WHIRL_SPIN_TICKS = 50;
export const WHIRL_STILL_TICKS = 56;
export const WHIRL_SINK_TICKS = 32;
export const WHIRL_TICKS = WHIRL_SPIN_TICKS + WHIRL_STILL_TICKS + WHIRL_SINK_TICKS;

/**
 * The top of a side view's water shaft (style 0x0F; traced in Tingle's Tower room 3, `w1-boss012-passage`, area 5's
 * shaft at (208, 0) up into the tree house): swimming up with Up held, the tick his y came within SHAFT_REACH of the
 * box's middle (22.9 under 8) he rose 0.5 px/tick (state 40) for SHAFT_RISE_TICKS, then stood at the target box's
 * middle (the tree house pool's whirlpool, (136, 136); state 41) for SHAFT_STILL_TICKS and swam from the next tick (on
 * the TV: it didn't take him back down), the others appearing beside him then.
 */
export const SHAFT_STYLE = 0x0f;
export const SHAFT_REACH = 15;
export const SHAFT_RISE_TICKS = 66;
export const SHAFT_STILL_TICKS = 69;

function stepRise(game: AdventureGame, stage: AdventureStage, w: WarpTrip): void {
  const a = game.adventure, leader = game.players[0]!, t = w.tick;
  leader.action = "none";
  leader.moving = false;
  if (t <= SHAFT_RISE_TICKS) {
    leader.x = (w.fromX + 8) * SUBPX;
    leader.y -= SUBPX / 2;
    return;
  }
  if (t === SHAFT_RISE_TICKS + 1) {
    for (const p of present(game)) {
      p.x = (w.x + 8) * SUBPX;
      p.y = (w.y + 8) * SUBPX;
    }
    enterArea(game, stage, a.room, w.area, 0, 0);
    a.entryX = w.x + 8;
    a.entryY = w.y + 8;
    a.entryFacing = leader.facing;
  }
  gatherOnLeader(game);
  if (t >= SHAFT_RISE_TICKS + 1 + SHAFT_STILL_TICKS) {
    a.warp = null;
    for (const m of a.links) Object.assign(m, { mode: "swim", side: false, speed: 0, dir: -1, tick: 0 });
  }
}

function stepWhirl(game: AdventureGame, stage: AdventureStage, w: WarpTrip): void {
  const a = game.adventure, leader = game.players[0]!, t = w.tick;
  leader.action = "none";
  leader.moving = false;
  if (t <= WHIRL_SPIN_TICKS) {
    leader.x = (w.fromX + 8) * SUBPX;
    leader.y = (w.fromY + 8) * SUBPX;
  } else if (t === WHIRL_SPIN_TICKS + 1) {
    for (const p of present(game)) {
      p.x = (w.x + 8) * SUBPX;
      p.y = (w.y + 8) * SUBPX;
    }
    enterArea(game, stage, a.room, w.area, 0, 0);
    a.entryX = w.x + 8;
    a.entryY = w.y + 8;
    a.entryFacing = leader.facing;
    Object.assign(a.links[0]!, { mode: "swim", side: true, tick: 0 });
  } else if (t > WHIRL_SPIN_TICKS + WHIRL_STILL_TICKS) leader.y += SUBPX;
  gatherOnLeader(game);
  if (t >= WHIRL_TICKS) a.warp = null;
}

/**
 * Out of the hole a cannon's shot leads to (from a side view's top edge, LAUNCH_STYLE), as Shadow Battle's side rooms
 * do it (siderooms.ts, measured there): gone 18 ticks, then at the hole hidden to the 77th, then flying up out of it
 * (z) and down until he's down. The adventure's flight (measured: Hyrule Castle room 5, out of the tower's top onto
 * the TV's hole (96, 32)): z up 7 px the first tick, 0.25 less each tick, falling at most 6 (58 ticks, 102.8 px at the
 * top); from the next tick the stick steers him along each axis on its own as in the cannon's shot (0.57 px the first
 * tick, 0.1 more each, up to 1.6: a diagonal 1.6 on both), into walls as walking; let go of, he flies straight up
 * and lands back in the hole, down into the side view again.
 */
export const LAUNCH_OUT_VZ = 7 * SUBPX;
export const LAUNCH_STEER_START = 146; // 0.57 px/tick
export const LAUNCH_STEER_STEP = 26; // 0.1 px/tick per tick
export const LAUNCH_STEER_MAX = 410; // 1.6 px/tick
/**
 * Shot up out of a side view's top edge into another side view (Hyrule Castle room 10's areas 7 → 6; traced,
 * `w1-013-room10-area7`): the next tick he's at the target box's middle, held there 20 ticks, then he flies on up with
 * the speed he left with (8.5 px/tick there), slowing as a cannon's shot does (cannon.ts), steered the same way.
 */
export const SHOT_INTO_HOLD_TICKS = 20;

function stepShotInto(game: AdventureGame, stage: AdventureStage, w: WarpTrip): void {
  const a = game.adventure, leader = game.players[0]!;
  leader.moving = false;
  if (w.tick === 1) {
    for (const p of present(game)) Object.assign(p, { x: (w.x + 8) * SUBPX, y: (w.y + 8) * SUBPX });
    enterArea(game, stage, a.room, w.area, 0, 0);
    a.entryX = w.x + 8;
    a.entryY = w.y + 8;
    a.entryFacing = leader.facing;
  }
  gatherOnLeader(game);
  if (w.tick < SHOT_INTO_HOLD_TICKS) return;
  Object.assign(a.links[0]!, { mode: "shot", tick: 0, vx: 0, vy: w.shotVy ?? 0 });
  a.warp = null;
}

function stepLaunchOut(game: AdventureGame, stage: AdventureStage, w: WarpTrip, buttons: number): void {
  const a = game.adventure, leader = game.players[0]!, f = game.battle.fighters[0]!, t = w.tick;
  if (w.shotVy !== undefined) return stepShotInto(game, stage, w);
  leader.moving = false;
  if (t === LAUNCH_TV_TICK) {
    for (const p of present(game)) Object.assign(p, { x: (w.x + 8) * SUBPX, y: (w.y + 8) * SUBPX });
    enterArea(game, stage, a.room, w.area, 0, 0);
    a.entryX = w.x + 8;
    a.entryY = w.y + 24;
    a.entryFacing = "down";
    f.z = LAUNCH_Z;
  } else if (t === LAUNCH_SHOW_TICK) f.vz = LAUNCH_OUT_VZ;
  else if (t > LAUNCH_SHOW_TICK) {
    const view = areaWorld(game, stage);
    const dx = (buttons & Button.Right ? 1 : 0) - (buttons & Button.Left ? 1 : 0), dy = (buttons & Button.Down ? 1 : 0) - (buttons & Button.Up ? 1 : 0);
    const steer = (d: number, v: number) => (!d ? 0 : Math.sign(v) !== d ? d * LAUNCH_STEER_START : d * Math.min(LAUNCH_STEER_MAX, Math.abs(v) + LAUNCH_STEER_STEP));
    if (t > LAUNCH_SHOW_TICK + 1) {
      w.vx = steer(dx, w.vx ?? 0);
      w.vy = steer(dy, w.vy ?? 0);
      if (dx || dy) leader.facing = dx ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
      moveAxis(leader, view, w.vx, "x");
      moveAxis(leader, view, w.vy, "y");
    }
    f.z += f.vz;
    f.vz = Math.max(-LAUNCH_FALL_MAX, f.vz - LAUNCH_GRAVITY);
  }
  gatherOnLeader(game);
  if (t > LAUNCH_SHOW_TICK && f.z <= 0) {
    Object.assign(f, { z: 0, vz: 0 });
    Object.assign(a.links[0]!, { mode: "walk", tick: 0, vx: 0, vy: 0 });
    a.warp = null;
  }
}

/** Is the leader out of sight on his way out of a cannon's top edge (gone, or still in the hole)? */
export const launchHidden = (game: AdventureGame): boolean => !!game.adventure.warp?.launch && game.adventure.warp.tick < LAUNCH_SHOW_TICK;

function stepWarp(game: AdventureGame, stage: AdventureStage, inputs: readonly number[]): void {
  const a = game.adventure, w = a.warp!, leader = game.players[0]!;
  game.players.forEach((p, i) => (p.held = inputs[i] ?? 0));
  const t = ++w.tick;
  if (w.whirl) return stepWhirl(game, stage, w);
  if (w.rise) return stepRise(game, stage, w);
  if (w.launch) return stepLaunchOut(game, stage, w, inputs[0] ?? 0);
  const [sx, sy] = STEP[w.facing];
  const side = w.side ?? 0;
  const walk = (k: number) => {
    leader.moving = true;
    leader.walkTicks = Math.floor((k * 3) / WARP_FRAME_TICKS);
    leader.x += sx * WARP_SPEED;
    leader.y += sy * WARP_SPEED;
  };
  leader.action = "none";
  leader.actionTick = 0;
  if (side & 1 && t <= WARP_IN_TICKS) {
    // In a side view's door: lined up with its middle, standing (traced: x 33 → 32, the walk frames going on).
    if (t === 1) leader.x = (w.fromX + 8) * SUBPX;
    leader.facing = "up";
    leader.moving = true;
    leader.walkTicks = Math.floor((t * 3) / WARP_FRAME_TICKS);
  } else if (side & 2 && t > WARP_IN_TICKS + WARP_STILL_TICKS) {
    // Out into a side view: he stands in the door (traced).
    leader.moving = false;
    leader.walkTicks = 0;
  } else if (t <= WARP_IN_TICKS) {
    leader.facing = w.facing;
    // Lined up with the door's middle from the first tick (measured: x 253.1 → 256).
    if (t === 1) {
      if (sx === 0) leader.x = (w.fromX + 8) * SUBPX;
      else leader.y = (w.fromY + 8) * SUBPX;
    }
    walk(t);
  } else if (t === WARP_IN_TICKS + 1) {
    const cx = (w.x + 8) * SUBPX, cy = (w.y + 8) * SUBPX;
    leader.facing = w.facing;
    leader.walkTicks = Math.floor((t * 3) / WARP_FRAME_TICKS);
    for (const p of present(game)) {
      p.x = cx;
      p.y = cy;
    }
    enterArea(game, stage, a.room, w.area, 0, 0);
    a.entryX = w.x + 8 + (side & 2 ? 0 : sx * 20);
    a.entryY = w.y + 8 + (side & 2 ? 0 : sy * 20);
    a.entryFacing = w.facing;
  } else if (t <= WARP_IN_TICKS + WARP_STILL_TICKS) {
    leader.moving = true;
    leader.walkTicks = 1; // the facing's first walk frame
  } else walk(t - WARP_IN_TICKS - WARP_STILL_TICKS);
  gatherOnLeader(game);
  // The last tick still walks; control returns on the next (measured). Out in water, he swims.
  if (t >= WARP_TICKS) {
    a.warp = null;
    const m = a.links[0]!, area = currentArea(game, stage);
    if (!area.sideView && anchorInDeepWater(areaWorld(game, stage), leader)) Object.assign(m, { mode: "swim", side: false, speed: 0, dir: -1 });
    else if (m.mode === "swim" && !m.side) m.mode = "walk";
  }
}

// --- snapshots ---

/** Deep copy (rollback, replays, tests). */
export function cloneAdventure(game: AdventureGame): AdventureGame {
  const a = game.adventure;
  return {
    tick: game.tick,
    room: game.room,
    players: game.players.map((p: PlayerState) => ({ ...p })),
    battle: cloneBattle(game.battle),
    adventure: {
      ...a,
      edge: a.edge ? { ...a.edge } : null,
      warp: a.warp ? { ...a.warp } : null,
      stairs: a.stairs ? { ...a.stairs } : null,
      gates: [...a.gates],
      bridges: [...a.bridges],
      blocks: a.blocks.map((x) => ({ ...x })),
      colorBlocks: [...a.colorBlocks],
      pulls: [...a.pulls],
      ganon: a.ganon ? { ...a.ganon, ball: a.ganon.ball ? { ...a.ganon.ball } : null, shards: a.ganon.shards.map((x) => ({ ...x })) } : null,
      beatenBosses: [...a.beatenBosses],
      levers: a.levers.map((x) => ({ ...x })),
      taken: [...a.taken],
      opened: [...a.opened],
      talked: [...a.talked],
      rewritten: [...a.rewritten],
      roomSwitches: [...a.roomSwitches],
      focus: a.focus ? { ...a.focus } : null,
      opening: a.opening ? { ...a.opening } : null,
      reveal: a.reveal ? { ...a.reveal } : null,
      talk: a.talk ? { ...a.talk } : null,
      flags: [...a.flags],
      get: a.get ? { ...a.get } : null,
      enemies: a.enemies.map((e) => ({ ...e })),
      slots: { ...a.slots, links: [...a.slots.links] },
      streak: { kills: [...a.streak.kills], seen: [...a.streak.seen], scores: a.streak.scores.map((s) => ({ ...s })) },
      gens: a.gens.map((g) => ({ ...g })),
      pickups: a.pickups.map((p) => ({ ...p })),
      rains: a.rains.map((r) => ({ ...r })),
      trails: a.trails.map((t) => [...t]),
      colors: [...a.colors],
      falls: a.falls,
      push: { ...a.push },
      rocks: a.rocks.map((r) => ({ ...r, hist: [...r.hist], held: [...r.held] })),
      heavy: a.heavy ? { ...a.heavy, places: [...a.heavy.places] } : null,
      keyThrow: a.keyThrow ? { ...a.keyThrow } : null,
      carried: a.carried ? { ...a.carried } : null,
      keysDown: [...a.keysDown],
      keyTold: a.keyTold,
      moved: [...a.moved],
      sunk: [...a.sunk],
      bolts: a.bolts.map((x) => ({ ...x })),
      fires: [...a.fires],
      burnt: [...a.burnt],
      pedestals: [...a.pedestals],
      broken: [...a.broken],
      escort: a.escort ? { ...a.escort } : null,
      crossSpin: a.crossSpin ? { ...a.crossSpin, at: [...a.crossSpin.at] } : null,
      links: a.links.map((m) => ({ ...m })),
      hops: a.hops.map((h) => ({ ...h })),
      away: a.away ? { ...a.away, at: [...a.away.at], cut: [...a.away.cut] } : null,
    },
  };
}
