// Big rocks: RCK2, lifted by two Links together, and RCK3, Lake Hylia's boulder that the Links push into the river.
// They're actors with a box that blocks the Links (main.dol: RCK2's init sets ±14 px, RCK3's ±31.5 px), kept as plain
// records of the current area (AdventureState.rocks); what became of them stays for the stage (AdventureState.moved).
//
// Pushed blocks (traced in Lake Hylia: room 2's boulder RCK3 north, room 6's cave block BLCK south; docs/measurements/adventure-lake-hylia.md
// "Adventure: swimming, ledges, formations"): the four Links in the wide formation walking into it push (each stuck 20
// ticks first), and on the 31st tick against it it moves, 0.2 px/tick, the Links with it 2 ticks behind, in legs of
// 12, 16, 16 and 20 px with 9 still ticks between: 64 px, its own size, and that's all. The boulder then sinks when
// it's over deep water, a crossing (its box walkable); the block turns its switch on (the params' top 5 bits: room 6's
// starts its raft, raft.ts). The leader alone pushed the boulder nowhere.
// BLCK blocks (init 0x8028D5D0, update 0x8028C7D0): their size is ((p & 3) + 1) × 16 px (Lake Hylia's 64, the Cave
// of No Return's 32 and 64); they move only with (p & 3) + 1 Links pushing (two for 32 px, four for 64), at 0.5 px/tick
// × 0.7 (32 and 48 px) or × 0.4 (64 px), their size's length, once (the save keeps the way it went; params bit 8 lets
// it go again, unused in World 1). With params bit 10 set the way is fixed by (p >> 2) & 3: right, left, down, up
// (table 0x8046C180) for the big ones, and for a 32 px block the axis (0 = across, 1 = up or down); without it, any
// way (Lake Hylia's). Measured in the Cave of No Return's room 13: a 32 px block didn't move for the leader alone; the
// four in the wide formation pushed one 32 px in two legs of 16 at ~0.35 px/tick, 12 still ticks between
// (BLOCK_SMALL); the one in the east column (params 0xC05) went down when pushed from above.
//
// The two-Link rock (traced in room 3 once its stumps had burned): two Links side by side facing it, whose lift points
// (16 px ahead) are on its box, lift it together on an Action press (the others' presses are empty lifts). Which two
// (main.dol, RCK2's update 0x8034CEB0): the Links whose lift points are in the 32 px square round it, by facing; with
// two or more one way, the two nearest it (any of the four, not only the leader). It asks nothing of the gap between
// them: two Links stacked on one spot would lift it as one on screen. In the game the formation's walk keeps that from
// happening (the four walk as one, a follower stopped by the rock holding the leader: formation.ts holdFormation); the
// sim once let the box walk right into it leave the leader on his blocked second Link, the pair lifting it. A long lift
// (state 17, 86 ticks: 700/701 by turns, then 702 and 703, facing up) with the rock rising onto them, then they carry
// it (state 18); Action again throws it: 4 px/tick along their facing for 12 ticks, falling, and it breaks.
// Carried, the pair walks together (assumed, unchecked in Dolphin): each lifter keeps the place beside the leader he
// lifted from, a wall holds him there (stepCarried), and the leader's walk can't open the gap past CARRY_SLACK (holdCarry);
// neither Link leaves the area or jumps, and the formations and switches of Link are kept, until it's thrown (heavyLifted:
// the room edges, doors and stairs are shut to them, the ledges too).
//
// The throne (STBL, Hyrule Castle room 10's area 2: a plain object of main.dol's base actor class, its look and box
// otherwise unread; traced, `w1-013-room10-throne`): a 64 px block over the door it hides, pushed like the boulder by
// the four in the long formation walking into its side: held at x 218 from the 7th tick of walking, the leader moved
// with it from the 29th, legs of 12, 16, 16 and 20 px at 0.2 px/tick, standing 12 ticks between them (the sim's
// within 4 ticks of that over the whole 64 px); then it stays. Its box: ±31 round its listed point (the leader held at
// x 218 on its left, at y 102.3 below it). Assumed: four Links needed (the leader alone pushing up moved it nowhere,
// but that was toward the wall), any way but into a wall.
//
// The raft (OBLF "OBJ lift", traced in room 6's area 6, `a6`…`a8`): a 32 × 32 floor over the pit, walkable. Once its
// switch is on (the block's) and the four Links stand on it, it sinks 3 px over 30 ticks (state 5), glides left 1
// px/tick (state 1) to x 142, and rises 3 px over 30 ticks (state 6), the Links riding it a tick behind; then it stays.
import { CARRY, LIFT, THROW } from "../moveframes.ts";
import { Button, SUBPX, type Facing } from "../player.ts";
import { setSwitch, switchOn } from "../switches.ts";
import { CELL, SURFACE_CODES, surfaceAt, type World } from "../world.ts";
import { actorKey, currentArea, type AdventureGame } from "./adventure.ts";
import { dashTo } from "./formation.ts";
import type { AdventureStage, AreaActor } from "./stage.ts";

export type RockType = "RCK2" | "RCK3" | "BLCK" | "OBLF" | "STBL";
export const ROCK_TYPES: readonly RockType[] = ["RCK2", "RCK3", "BLCK", "OBLF", "STBL"];
/** Half the box's side, px (the actors' inits; BLCK assumed like RCK3, the same 64 px block; OBLF its 32 px top). */
export const ROCK_HALF: Readonly<Record<RockType, number>> = { RCK2: 14, RCK3: 31.5, BLCK: 31.5, OBLF: 16, STBL: 31 };
/** The raft: its sink and rise (3 px over 30 ticks each), its glide (1 px/tick, left) and where it stops. TODO(measure):
 *  where the stop (x 142, from 352) comes from. */
export const RAFT_SINK = 3 * SUBPX;
export const RAFT_SINK_TICKS = 30;
export const RAFT_SPEED = SUBPX;
export const RAFT_STOP_X = 142;
/** The raft takes a Link standing this close (px, both axes) to its anchor's left of middle (traced: the four in the
 *  box formation at x 339.5-355.5, y 79.8-95.8 went with it at (352, 88); one at (361.5, 95.8) didn't). TODO(measure). */
export const RAFT_RIDE = 12;
export const RAFT_RIDE_DX = -4;
/** The legs a pushed block moves (px, traced alike for both). */
export const PUSH_LEGS: readonly number[] = [12, 16, 16, 20];
/** A 32 px block's push (measured): its legs, speed (1/256 px/tick), still ticks between legs. */
export const BLOCK_SMALL = { legs: [16, 16], speed: 90, pause: 12 } as const;
/** A rock's half size (px): BLCK's from its params. */
export function rockHalf(r: { type: RockType; params: number }): number {
  return r.type === "BLCK" ? ((r.params & 3) + 1) * 8 - 0.5 : ROCK_HALF[r.type];
}
const smallBlock = (r: { type: RockType; params: number }) => r.type === "BLCK" && (r.params & 3) < 3;
/** The Links a block takes: a BLCK's size in 16 px tiles, the boulder's four. */
const pushersNeeded = (r: { type: RockType; params: number }) => (r.type === "BLCK" ? (r.params & 3) + 1 : BOULDER_PUSHERS);
const BLOCK_WAYS: readonly Facing[] = ["right", "left", "down", "up"];
/** Whether a rock goes the way `f` (BLCK params bit 10: the way, or a 32 px block's axis, from bits 2-3). */
function rockGoes(r: { type: RockType; params: number }, f: Facing): boolean {
  if (r.type !== "BLCK" || !(r.params & 0x400)) return true;
  const way = (r.params >>> 2) & 3, i = BLOCK_WAYS.indexOf(f);
  return (r.params & 3) === 1 ? i >> 1 === way : i === way;
}
/** Links that must push the boulder together. */
export const BOULDER_PUSHERS = 4;
/** Ticks against it before it moves (the 31st moves it), its speed (1/5 px/tick), the legs and the still ticks. */
export const BOULDER_PUSH_TICKS = 30;
export const BOULDER_STEP_FIFTHS = 1;
export const BOULDER_PAUSE_TICKS = 9;
export const BOULDER_LAG_TICKS = 2;
/** The throne's: ticks against it before it moves, still ticks between legs (fitted to the trace, above). */
export const THRONE_PUSH_TICKS = 21;
export const THRONE_PAUSE_TICKS = 11;
/** A Link touches a face this close to it (px between his leading sensor and the box). */
const TOUCH = 2;
/** The two-Link rock: Links that must lift it, the lift's ticks, the throw (4 px/tick, 12 ticks), the lift's reach. */
export const HEAVY_LIFTERS = 2;
export const HEAVY_LIFT_TICKS = 86;
export const HEAVY_THROW_SPEED = 4 * SUBPX;
export const HEAVY_THROW_TICKS = 12;
export const HEAVY_CARRY_HEIGHT = 18 * SUBPX;
const LIFT_REACH = 16;
/** Half the square round a two-Link rock its lifters' points must be in (1/256 px; main.dol: ±16, not its ±14 box). */
const LIFT_BOX = 16 * SUBPX;
/** How far (1/256 px, per axis) the leader's walk may open the gap to a lifter's place while carrying (a step and a bit). */
export const CARRY_SLACK = 2 * SUBPX;

export interface Rock {
  /** Its index in the room's actor list. */
  actor: number;
  type: RockType;
  /** Its anchor, 1/256 px (area coordinates). */
  x: number;
  y: number;
  /** rest: where it stands (blocking); moving: being pushed; set: pushed all the way (blocking, for good); sunk: in
   *  the water, walked on; held: lifted or carried; flying: thrown; gone: broken. */
  state: "rest" | "moving" | "set" | "sunk" | "held" | "flying" | "gone";
  /** The actor's params. */
  params: number;
  /** Its height while held or thrown (1/256 px). */
  z: number;
  /** Ticks it's been pushed against (before it moves). */
  push: number;
  /** The way it's pushed (a unit step), the leg's start (1/256 px), which leg (PUSH_LEGS), ticks moved in it, still
   *  ticks left. */
  dx: number;
  dy: number;
  ox: number;
  oy: number;
  leg: number;
  moved: number;
  pause: number;
  /** Where it was the last ticks (x, y, x, y…, the latest first): its pushers follow it two ticks behind. */
  hist: number[];
  /** A two-Link rock: the actors it holds (their indices; heldUnderRocks) and the ticks it's been up (their count). */
  held: number[];
  reveal: number;
}

// What lies under a two-Link rock (RCK2's room-loaded hook 0x8034D99C, which the stage loader 0x802D8328 calls once the
// room's actors are made): it takes out of play up to 8 actors of its screen whose placed point lies in [x − 16, x + 16)
// × [y − 16, y + 16) round its anchor (any actors: Lake Hylia room 4's Zol, the entry after it at its own spot, wasn't
// alive at the room's start); lifted, a count of 3 runs while it's up or thrown, and at 0 they're made again at their
// placed points with their params (0x8034D8F0: their init afresh). Read from main.dol. Here: the enemies it holds.
export const RCK2_HOLD_HALF = 16;
export const RCK2_HOLD_MAX = 8;
export const RCK2_REVEAL_TICKS = 3;
/** The lift's ticks with the rock still on the ground (traced under Lake Hylia's bridge: 8 px up on the 66th tick after
 *  the press, 16 two ticks on, on their heads, 18 px, at the carry): what it holds comes out 3 ticks later. */
export const RCK2_UP_TICKS = 66;

/** The actors (their indices) held under the area's two-Link rocks still in place, each by its rock's index. */
export function heldUnderRocks(game: AdventureGame, actors: readonly AreaActor[]): Map<number, number> {
  const a = game.adventure, held = new Map<number, number>();
  for (const rock of actors) {
    if (rock.id !== "RCK2" || a.moved.includes(actorKey(a.room, rock.index))) continue;
    let n = 0;
    for (const x of actors) {
      if (x === rock || x.id === "RCK2" || held.has(x.index) || n >= RCK2_HOLD_MAX) continue;
      if (x.x >= rock.x - RCK2_HOLD_HALF && x.x < rock.x + RCK2_HOLD_HALF && x.y >= rock.y - RCK2_HOLD_HALF && x.y < rock.y + RCK2_HOLD_HALF) {
        held.set(x.index, rock.index);
        n++;
      }
    }
  }
  return held;
}

/** The current area's rocks: those sunk where they sank, those lifted away gone. */
export function spawnRocks(game: AdventureGame, stage: AdventureStage): void {
  const a = game.adventure;
  a.rocks = [];
  for (const actor of currentArea(game, stage).actors) {
    if (!(ROCK_TYPES as readonly string[]).includes(actor.id)) continue;
    const key = actorKey(a.room, actor.index);
    const rock: Rock = { actor: actor.index, type: actor.id as RockType, params: actor.params >>> 0, x: actor.x * SUBPX, y: actor.y * SUBPX, state: "rest", z: 0, push: 0, dx: 0, dy: 0, ox: 0, oy: 0, leg: 0, moved: 0, pause: 0, hist: [], held: [], reveal: 0 };
    for (let k = 0; k < a.sunk.length; k += 4) if (a.sunk[k] === key) Object.assign(rock, { x: a.sunk[k + 1]!, y: a.sunk[k + 2]!, state: a.sunk[k + 3] ? "set" : "sunk" });
    if (a.moved.includes(key)) rock.state = "gone";
    a.rocks.push(rock);
  }
  for (const [index, by] of heldUnderRocks(game, currentArea(game, stage).actors)) a.rocks.find((r) => r.actor === by)?.held.push(index);
}

const STEP: Readonly<Record<Facing, readonly [number, number]>> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
const HELD: Readonly<Record<Facing, number>> = { up: Button.Up, down: Button.Down, left: Button.Left, right: Button.Right };

/** The Links pushing a rock's face along the leader's facing, if the leader walks that way. */
function pushers(game: AdventureGame, r: Rock, buttons: number): number[] {
  const l = game.players[0]!, [dx, dy] = STEP[l.facing];
  if (!(buttons & HELD[l.facing])) return [];
  if (!rockGoes(r, l.facing)) return [];
  const h = rockHalf(r) * SUBPX;
  return game.players.flatMap((p, i) => {
    const f = game.battle.fighters[i]!, m = game.adventure.links[i];
    if (p.facing !== l.facing || f.mode !== "active" || f.move !== "none" || (m && m.mode !== "walk")) return [];
    // His leading side's middle sensor against the face, his body across it.
    const lead = dx ? p.x + dx * 7 * SUBPX : p.y + dy * 7 * SUBPX;
    const face = dx ? r.x - dx * h : r.y - dy * h;
    const gap = (face - lead) * (dx || dy);
    const across = dx ? Math.abs(p.y - r.y) : Math.abs(p.x - r.x);
    return gap >= -SUBPX && gap <= TOUCH * SUBPX && across <= h ? [i] : [];
  });
}

/**
 * The heavy lift going on: the rock (its index in AdventureState.rocks), its lifters (a bit each), its tick, and each
 * Link's place beside the leader (x, y pairs, 1/256 px, from where they stood when it was lifted: the carry keeps them).
 */
export interface HeavyLift {
  rock: number;
  lifters: number;
  tick: number;
  phase: "lift" | "carry" | "throw";
  places: number[];
}

/** The Action press facing a two-Link rock with another Link beside: they lift it (true: the press is used). */
export function tryHeavyLift(game: AdventureGame, buttons: number): boolean {
  const a = game.adventure, l = game.players[0]!, f = game.battle.fighters[0]!;
  if (a.heavy || !(buttons & ~l.held & Button.Action) || f.mode !== "active" || f.move !== "none" || l.action !== "none") return false;
  const [dx, dy] = STEP[l.facing];
  for (let k = 0; k < a.rocks.length; k++) {
    const r = a.rocks[k]!;
    if (r.type !== "RCK2" || r.state !== "rest") continue;
    // main.dol (RCK2's update 0x8034CEB0): each Link whose lift point is in [x − 16, x + 16) × [y − 16, y + 16) round
    // the rock is counted by his facing; two or more one way and the two nearest the rock (by their anchors) lift
    // it, whichever Links they are; nothing asks them to stand apart (two on one spot would do: the formation's walk
    // keeps them apart, formation.ts holdFormation).
    const near: number[] = [];
    game.players.forEach((p, i) => {
      const g = game.battle.fighters[i]!, m = a.links[i];
      if (p.facing !== l.facing || g.mode !== "active" || g.move !== "none" || (m && m.mode !== "walk")) return;
      const x = p.x + dx * LIFT_REACH * SUBPX, y = p.y + dy * LIFT_REACH * SUBPX;
      if (x >= r.x - LIFT_BOX && x < r.x + LIFT_BOX && y >= r.y - LIFT_BOX && y < r.y + LIFT_BOX) near.push(i);
    });
    if (near.length < Math.min(HEAVY_LIFTERS, game.players.length)) continue;
    const far = (i: number) => (game.players[i]!.x - r.x) ** 2 + (game.players[i]!.y - r.y) ** 2;
    while (near.length > HEAVY_LIFTERS) near.splice(near.indexOf(near.reduce((m, i) => (far(i) > far(m) ? i : m))), 1);
    const lifters = near.reduce((s, i) => s | (1 << i), 0);
    a.heavy = { rock: k, lifters, tick: 0, phase: "lift", places: game.players.flatMap((p) => [p.x - l.x, p.y - l.y]) };
    r.state = "held";
    a.ignore |= Button.Action;
    for (let i = 0; i < game.players.length; i++) if (lifters & (1 << i)) Object.assign(game.players[i]!, { moving: false, walkTicks: 0 });
    return true;
  }
  return false;
}

/** Whether Link `i` is held by the heavy lift this tick (lifting: he can't move; carrying he walks as usual). */
export const heavyHolds = (game: AdventureGame, i: number) => {
  const h = game.adventure.heavy;
  return !!h && (h.lifters & (1 << i)) !== 0 && (h.phase === "lift" || h.phase === "throw");
};

/** A two-Link rock lifted, carried or thrown: its Links stay in their area and don't jump until it's thrown. */
export const heavyLifted = (game: AdventureGame): boolean => !!game.adventure.heavy;

/** Whether Link `i` is one of the lifters while the rock is carried (the carry keeps him in his place: stepCarried). */
export const carriesRock = (game: AdventureGame, i: number): boolean => {
  const h = game.adventure.heavy;
  return !!h && h.phase === "carry" && (h.lifters & (1 << i)) !== 0;
};

/** A lifter's tick in the carry: he dashes to his place beside the leader, against the walls (holdCarry keeps the leader
 *  from walking off from him). */
export function stepCarried(game: AdventureGame, i: number, world: World): void {
  const h = game.adventure.heavy!, p = game.players[i]!, l = game.players[0]!;
  const x0 = p.x, y0 = p.y;
  dashTo(p, world, l.x + h.places[2 * i]!, l.y + h.places[2 * i + 1]!);
  p.facing = l.facing;
  p.moving = p.x !== x0 || p.y !== y0;
  p.walkTicks = p.moving ? p.walkTicks + 1 : 0;
}

/**
 * The leader's walk while the rock is carried, from where he stood (x0, y0): an axis of it that takes him more than
 * CARRY_SLACK farther from a lifter's place is undone, so a lifter held by a wall holds the leader too (he can still
 * walk back toward him, or along the wall). The lifters then step to their places (stepCarried).
 */
export function holdCarry(game: AdventureGame, x0: number, y0: number): void {
  const h = game.adventure.heavy;
  if (!h || h.phase !== "carry") return;
  const l = game.players[0]!;
  game.players.forEach((p, i) => {
    if (!i || !carriesRock(game, i)) return;
    const ox = h.places[2 * i]!, oy = h.places[2 * i + 1]!;
    if (Math.abs(l.x + ox - p.x) > CARRY_SLACK && Math.abs(l.x + ox - p.x) > Math.abs(x0 + ox - p.x)) l.x = x0;
    if (Math.abs(l.y + oy - p.y) > CARRY_SLACK && Math.abs(l.y + oy - p.y) > Math.abs(y0 + oy - p.y)) l.y = y0;
  });
}

/** The heavy lift's tick (after the Links moved): the rock rides on its lifters; an Action press throws it. */
export function stepHeavy(game: AdventureGame, buttons: number, pressed: number): void {
  const a = game.adventure, h = a.heavy;
  if (!h) return;
  const r = a.rocks[h.rock];
  if (!r) {
    a.heavy = null;
    return;
  }
  h.tick++;
  const lifters = game.players.filter((_, i) => h.lifters & (1 << i));
  const mx = Math.round(lifters.reduce((s, p) => s + p.x, 0) / lifters.length), my = Math.round(lifters.reduce((s, p) => s + p.y, 0) / lifters.length);
  if (h.phase === "lift") {
    // It stays put, then slides onto them and up (traced: off the ground from 65 ticks in, on their heads, 18 px up, at the carry).
    const k = Math.min(1, Math.max(0, h.tick - RCK2_UP_TICKS) / (HEAVY_LIFT_TICKS - RCK2_UP_TICKS));
    r.x += Math.round((mx - r.x) * k);
    r.y += Math.round((my - r.y) * k);
    r.z = Math.round(HEAVY_CARRY_HEIGHT * k);
    if (h.tick >= HEAVY_LIFT_TICKS) Object.assign(h, { phase: "carry", tick: 0 });
    return;
  }
  if (h.phase === "carry") {
    r.x = mx;
    r.y = my;
    r.z = HEAVY_CARRY_HEIGHT;
    if (!(pressed & Button.Action)) return;
    const [dx, dy] = STEP[game.players[0]!.facing];
    Object.assign(h, { phase: "throw", tick: 0 });
    r.state = "flying";
    r.dx = dx;
    r.dy = dy;
    a.ignore |= Button.Action;
    return;
  }
  // Thrown: on 4 px/tick, coming down, broken on the 12th tick.
  r.x += r.dx * HEAVY_THROW_SPEED;
  r.y += r.dy * HEAVY_THROW_SPEED;
  r.z = Math.max(0, HEAVY_CARRY_HEIGHT - Math.round((HEAVY_CARRY_HEIGHT * h.tick * h.tick) / (HEAVY_THROW_TICKS * HEAVY_THROW_TICKS)));
  if (h.tick < HEAVY_THROW_TICKS) return;
  r.state = "gone";
  a.moved.push(actorKey(a.room, r.actor));
  a.heavy = null;
  void buttons;
}

/** A lifter's frame during the heavy lift (player_sob), or -1. */
export function heavyFrame(game: AdventureGame, i: number): number {
  const h = game.adventure.heavy, p = game.players[i]!;
  if (!h || !(h.lifters & (1 << i))) return -1;
  const dir = ({ right: 0, left: 1, down: 2, up: 3 } as const)[p.facing];
  if (h.phase === "lift") {
    const b = LIFT.frames[p.facing][0]!;
    return h.tick < 66 ? b + (Math.floor(h.tick / 6) & 1) : h.tick < 72 ? b + 2 : b + 3;
  }
  if (h.phase === "throw") return THROW.frames[p.facing][Math.min(6, Math.floor(h.tick / 2))]!;
  void dir;
  return p.moving ? CARRY.walk[p.facing][Math.floor(p.walkTicks / 3) % 8]! : CARRY.stand[p.facing];
}

/** The boulders' tick (after the Links moved): pushed, they move and take their pushers along; then they sink. */
export function stepRocks(game: AdventureGame, world: World, buttons: number): void {
  for (const r of game.adventure.rocks) {
    if (r.type === "OBLF") {
      stepRaft(game, r);
      continue;
    }
    if (r.type === "RCK2" || (r.state !== "rest" && r.state !== "moving")) continue;
    const who = pushers(game, r, buttons);
    const enough = who.length >= Math.min(pushersNeeded(r), game.players.length);
    const legs = smallBlock(r) ? BLOCK_SMALL.legs : PUSH_LEGS;
    const [dx, dy] = STEP[game.players[0]!.facing];
    if (r.state === "rest") {
      r.push = enough ? r.push + 1 : 0;
      if (r.push <= (r.type === "STBL" ? THRONE_PUSH_TICKS : BOULDER_PUSH_TICKS)) continue;
      // Let go and pushed again the same way, it goes on with the leg it was in (TODO(measure): the game's own way; this
      // keeps it to its 64 px, so the boulder still ends in the river's gap); otherwise its legs start.
      if ((r.leg > 0 || r.moved > 0) && dx === r.dx && dy === r.dy) {
        r.hist = Array.from({ length: 2 * (BOULDER_LAG_TICKS + 2) }, (_, k) => (k & 1 ? r.y : r.x));
        r.state = "moving";
      } else beginLeg(r, dx, dy, 0);
    }
    if (!enough || dx !== r.dx || dy !== r.dy) {
      // Let go: it stays where it is (TODO(measure): whether it slides on).
      r.state = "rest";
      r.push = 0;
      continue;
    }
    if (r.pause > 0) {
      if (--r.pause === 0) beginLeg(r, r.dx, r.dy, r.leg + 1);
    } else {
      r.moved++;
      const along = Math.min(legs[r.leg]! * SUBPX, smallBlock(r) ? r.moved * BLOCK_SMALL.speed : Math.round((r.moved * BOULDER_STEP_FIFTHS * SUBPX) / 5));
      r.x = r.ox + r.dx * along;
      r.y = r.oy + r.dy * along;
      if (along >= legs[r.leg]! * SUBPX) {
        if (r.leg < legs.length - 1) r.pause = smallBlock(r) ? BLOCK_SMALL.pause : r.type === "STBL" ? THRONE_PAUSE_TICKS : BOULDER_PAUSE_TICKS;
        else {
          // All the way: sunk in the water (the boulder), or set where it is, its switch on.
          const a = game.adventure, sink = r.type === "RCK3" && overWater(world, r.x / SUBPX, r.y / SUBPX, rockHalf(r));
          r.state = sink ? "sunk" : "set";
          a.sunk.push(actorKey(a.room, r.actor), r.x, r.y, sink ? 0 : 1);
          if (!sink) setSwitch(game.battle, r.params >>> 27, true);
          // Nothing to push any more: the leader stands a tick, then walks on (traced).
          Object.assign(a.push, { on: false, ticks: 0, release: 0 });
          const l = game.players[0]!;
          l.moving = false;
          l.walkTicks = 0;
        }
      }
    }
    // The pushers take the step it took two ticks before (traced).
    r.hist.unshift(r.x, r.y);
    r.hist.length = 2 * (BOULDER_LAG_TICKS + 2);
    const sx = r.hist[2 * BOULDER_LAG_TICKS]! - r.hist[2 * BOULDER_LAG_TICKS + 2]!, sy = r.hist[2 * BOULDER_LAG_TICKS + 1]! - r.hist[2 * BOULDER_LAG_TICKS + 3]!;
    for (const i of who) {
      game.players[i]!.x += sx;
      game.players[i]!.y += sy;
    }
  }
}

/** Is Link `i` standing on the raft's top (RAFT_RIDE)? */
function onRaft(game: AdventureGame, r: Rock, i: number): boolean {
  const p = game.players[i]!, f = game.battle.fighters[i]!;
  return f.mode === "active" && Math.abs(p.x - (r.x + RAFT_RIDE_DX * SUBPX)) <= RAFT_RIDE * SUBPX && Math.abs(p.y - r.y) <= RAFT_RIDE * SUBPX;
}

/** The raft's tick: waiting for its switch and its riders, then sinking (leg 0), gliding (1), rising (2), the riders a
 *  tick behind it. */
function stepRaft(game: AdventureGame, r: Rock): void {
  if (r.state === "rest") {
    if (!switchOn(game.battle, r.params >>> 27) || !game.players.every((_, i) => onRaft(game, r, i))) return;
    beginLeg(r, 0, 1, 0);
    r.hist = [r.x, r.y];
    return;
  }
  if (r.state !== "moving") return;
  // The riders take its last tick's step (traced a tick behind).
  const sx = r.x - r.hist[0]!, sy = r.y - r.hist[1]!;
  for (let i = 0; i < game.players.length; i++) {
    if (!onRaft(game, r, i)) continue;
    game.players[i]!.x += sx;
    game.players[i]!.y += sy;
  }
  r.hist = [r.x, r.y];
  r.moved++;
  if (r.leg === 0 || r.leg === 2) {
    r.y = r.oy + (r.leg === 0 ? 1 : -1) * Math.round((RAFT_SINK * r.moved) / RAFT_SINK_TICKS);
    if (r.moved < RAFT_SINK_TICKS) return;
    if (r.leg === 2) {
      r.state = "set";
      return;
    }
    beginLeg(r, -1, 0, 1);
    return;
  }
  r.x = Math.max(RAFT_STOP_X * SUBPX, r.ox - r.moved * RAFT_SPEED);
  if (r.x === RAFT_STOP_X * SUBPX) {
    const hist = r.hist;
    beginLeg(r, 0, -1, 2);
    r.hist = hist;
  }
}

/** Starts leg `leg` (PUSH_LEGS) along (dx, dy). */
function beginLeg(r: Rock, dx: number, dy: number, leg: number): void {
  if (r.state !== "moving") r.hist = Array.from({ length: 2 * (BOULDER_LAG_TICKS + 2) }, (_, k) => (k & 1 ? r.y : r.x));
  r.state = "moving";
  r.dx = dx;
  r.dy = dy;
  r.ox = r.x;
  r.oy = r.y;
  r.moved = 0;
  r.leg = leg;
}

function overWater(world: World, x: number, y: number, h: number): boolean {
  for (const [px, py] of [[x - h, y - h], [x + h, y - h], [x - h, y + h], [x + h, y + h]] as const) if (surfaceAt(world, Math.floor(px), Math.floor(py)) !== "deep") return false;
  return true;
}

const blocked = new WeakMap<World, Map<string, World>>();
const FLOOR = SURFACE_CODES.indexOf("floor");

/** `world` with the standing rocks' boxes solid (whole px) and the sunk ones' ground walkable (the 8 px cells). */
export function rockWorld(world: World, rocks: readonly Rock[]): World {
  const shown = rocks.filter((r) => r.state !== "gone");
  if (!shown.length) return world;
  const key = shown.map((r) => `${r.type}${r.state}${r.x},${r.y}`).join(";");
  let cache = blocked.get(world);
  if (!cache) blocked.set(world, (cache = new Map()));
  const hit = cache.get(key);
  if (hit) return hit;
  const boxes = [...(world.boxes ?? [])];
  let surface = world.surface;
  for (const r of shown) {
    const h = rockHalf(r), x = r.x / SUBPX, y = r.y / SUBPX;
    // A sunk boulder and the raft are floor.
    if (r.state !== "sunk" && r.type !== "OBLF") {
      if (r.state === "held" || r.state === "flying") continue;
      boxes.push({ left: Math.floor(x - h), top: Math.floor(y - h), right: Math.floor(x + h), bottom: Math.floor(y + h) });
      continue;
    }
    if (surface === world.surface) surface = world.surface.slice();
    const x0 = Math.floor((x - h) / CELL), x1 = Math.ceil((x + h) / CELL) - 1;
    const y0 = Math.floor((y - h) / CELL), y1 = Math.ceil((y + h) / CELL) - 1;
    for (let cy = Math.max(0, y0); cy <= Math.min(world.heightCells - 1, y1); cy++) {
      for (let cx = Math.max(0, x0); cx <= Math.min(world.widthCells - 1, x1); cx++) surface[cy * world.widthCells + cx] = FLOOR;
    }
  }
  const out: World = { ...world, surface, boxes };
  if (cache.size > 64) cache.clear();
  cache.set(key, out);
  return out;
}
