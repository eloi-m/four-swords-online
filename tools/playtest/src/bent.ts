// Bent routes: World 1's puzzles played off the scripted routes (packages/sim lakehylia.ts, cavenoreturn.ts,
// tingletower.ts, hyrulecastle.ts; the last three's puzzles in world1.ts). For each puzzle, the
// milestone it's in is played from its start (a clone of the scripted run there) with its goals changed one way at a
// time: the Link stopping 1-3 px off the scripted spot each side, letting go of the stick mid-push, standing idle for
// IDLE_TICKS, another formation, coming at the spot from another side, leaving the area and coming back halfway
// through. After each: the milestone still ends (its goals within their limits), no Link got stuck (play.ts), the
// puzzle's own check holds, and what the puzzles leave behind (rocks, switches, gear…) matches the scripted run's.
//   node tools/playtest/src/bent.ts [stage…] [puzzle key…] [--captures] [--trace "<puzzle> / <variant>" [from] [every]]
// (pnpm -s playtest:bent; a stage is its id or lake, cave, tingle, castle; all four when none is named). --captures writes the findings as captures (findings.ts) for `pnpm -s capture:replay <id>`.
import { fileURLToPath } from "node:url";
import { Button, SUBPX } from "@fso/sim";
import {
  areaWorld, BLOCK_SLIDE_TICKS, cloneAdventure, face, findPath, formation, GATHER_BUTTON, goTo, press, reachable, RoutePlayer,
  sequence, standable, stepAdventure, travelTo, wait, waitUntil, walkTo, type AdventureGame, type AdventureStage, type Goal, type StickFormation,
} from "@fso/sim/adventure";
import { findingId, writeCapture } from "./findings.ts";
import { playGoals, runRoute, type RouteRun, type Stuck } from "./play.ts";
import { loadStage, stageArgs, stageNamed, type PlayStage } from "./stage.ts";
import { WORLD_1_EXPECTED, WORLD_1_PUZZLES, WORLD_1_SCENARIOS, WORLD_1_STUCK } from "./world1.ts";

const { Up, Down, Left, Right, Action } = Button;

// Known results: variants (`key / variant`) that may fail today, and why. "finding:" ones are sim bugs or doubts
// reported with a capture (findings.ts); "rule:" ones fail by a rule of the puzzle the sim has (from the guides or
// measured), the game's own answer unchecked; "route:" ones fail by the driver or a rolled outcome, not the puzzle.
const FOUR_ON_SWITCH = "rule: a four-Link switch's catch takes the four Links' bodies all in its ±15 px box (traced, logic.ts stepFourSwitch: the box formation; the wide, long and cross can't fit in it)";
const PUSH_FORMATION = "rule: only the wide formation's four pushers move it (the guides' way; other formations unchecked in Dolphin)";
const TWO_LIFTERS = "rule: a two-Link rock needs a second Link's lift point (16 px ahead) in its box: this formation puts none there";
const RAFT_FORMATION = "rule: the raft goes with the four Links on it (the box formation)";
/** A C-stick formation walks as one: a follower in his place that meets a wall holds the leader (traced in room 3;
 *  formation.ts holdFormation). The driver's walk, made for the route's formation, stands there. */
const FORMATION_HELD = "rule: in a C-stick formation a follower against a wall holds the leader (traced, holdFormation): the bent walk stands there";
export const EXPECTED: Readonly<Record<string, string>> = {
  "key-lift / away and back":
    "rule: back in room 3 the Octoroks are there again and strike the leader carrying the key: the hit knocks it out of his hands (traced in the Cave of No Return, doors.ts knockKeyOut); the variant walks on to the door without it",
  "boomerang-key / y -3 px": "route: the leader's walk to the spot stops 1.6 px east of it (walkToward's still watch), after the room 3 Octoroks fight's gather; the key drops where he stands, 22 px from the lift point (400, 219): past its reach",
  "boulder / from another side": "route: coming round from the west the followers step on room 2's floor switch 17 (the gems at (216, 280) and (152, 344))",
  "boulder / box formation": PUSH_FORMATION,
  "boulder / long formation": PUSH_FORMATION,
  "boulder / cross formation": PUSH_FORMATION,
  "cave-stone / y +2 px": "rule: the leader stops at x 351.96, his lift point 16 px ahead (measured) at 367.96, 0.04 px short of the stone's tile: the route's spot (352) is on the edge of the reach",
  "cave-stone / y +3 px": "rule: as y +2 px (the lift point short of the stone's tile)",
  "cave-switch / y +3 px":
    "rule: the leader stops at y 99.6, the box formation's bottom Links at 115.6: their bodies (±7) end 0.1 px past the switch's box (±15 round (128, 93.5), traced: logic.ts stepFourSwitch), so it isn't pressed",
  "cave-switch / wide formation": FOUR_ON_SWITCH,
  "cave-switch / long formation": FOUR_ON_SWITCH,
  "cave-switch / cross formation": FOUR_ON_SWITCH,
  "house-rock / from another side": `${FORMATION_HELD} (the column's lower Links on the back room's table, the leader at x 120.6)`,
  "plateau-rock / cross formation": `${FORMATION_HELD} (the cross's bottom Link on room 4's wall, the leader at (214.3, 107.3))`,
  "bridge-rock / from another side": `${FORMATION_HELD} (the column on the ledge's wall, the leader at (95.4, 105.6))`,
  "block / away and back": `${FORMATION_HELD} (the wide row back in area 6, the leader at (440.5, 54.4))`,
  "raft / from another side": `${FORMATION_HELD} (the box round area 6's walls, the leader at (455.0, 58.4))`,
  "house-rock / cross formation": TWO_LIFTERS,
  "house-rock / away and back": "rule: a carried two-Link rock keeps its Links in the back room (no door, edge or stairs; rocks.ts heavyLifted), and a lifter held by the wall at x 149 holds the leader (holdCarry, unchecked in Dolphin): the walk west with the rock stops at x 149.8, so the detour never leaves (the watch's still report)",
  "hole-rock / long formation": TWO_LIFTERS,
  "hole-rock / cross formation": TWO_LIFTERS,
  "plateau-switch / wide formation": FOUR_ON_SWITCH,
  "plateau-switch / long formation": FOUR_ON_SWITCH,
  "plateau-switch / cross formation": FOUR_ON_SWITCH,
  "plateau-rock / idle 120 ticks": "route (inferred): the walk's stop before room 4's north exit (travelTo (56, 24), tolerance 1.5) is at the exit's edge; after the snap the leader leaves at x 57.0 and the exit isn't taken (an exact stop there might clear it: unverified)",
  "plateau-rock / wide formation": TWO_LIFTERS,
  "plateau-rock / y -1 px": "route: the trail into room 5's pocket puts a follower on its south bank's floor switch (80, 336), switch 1 (the scripted run's passes beside it)",
  "plateau-rock / y -2 px": "route: the trail into room 5's pocket puts a follower on its south bank's floor switch (80, 336), switch 1 (the scripted run's passes beside it)",
  "plateau-rock / from another side": "route: as y -1 px (the trail into room 5's pocket puts a follower on its south bank's floor switch 1 at (80, 336); the four-Link switch's traced snap, 2026-10-28, moved the route's timing there)",
  "pocket-stone / from another side": "route: coming round from below, a follower steps on room 5's floor switch 1 at (80, 336) (it starts the generator at (304, 208))",
  "block / cross formation": PUSH_FORMATION,
  "raft / wide formation": RAFT_FORMATION,
  "raft / long formation": RAFT_FORMATION,
  "raft / cross formation": RAFT_FORMATION,
  ...WORLD_1_EXPECTED,
};

export const expectedProblem = (puzzle: string, variant: string): string | undefined => EXPECTED[`${puzzle} / ${variant}`];

/** Ticks a variant stands idle. */
export const IDLE_TICKS = 120;
/** Ticks a variant lets go of the stick mid-push. */
export const LET_GO_TICKS = 30;
/** Ticks another formation is given to take its shape (in place of a route's wait for its own). */
export const SETTLE_TICKS = 40;
/** How far off the scripted spot the offset variants stop (px, each side). */
export const OFFSETS = [1, 2, 3] as const;

/** A puzzle in a milestone, and how its goals may be bent (goal indices in the milestone's goals). */
export interface Puzzle {
  key: string;
  /** Its stage's id (boss010 when left out). */
  stage?: string;
  milestone: number;
  name: string;
  /**
   * The goal that walks the leader onto the puzzle's spot: replaced by one stopping off it along `axes`. `nudge`: the
   * scripted goal first, then a straight step off the spot (the way there kept: the path finder's grid doesn't know the
   * color blocks, and a spot beside pots may not be on it); `make` builds the goal for an off spot instead (a swim, a
   * side view's hold); `side`: a side view (no "from another side").
   * `pushes`: the route's push at goal `at` moves the block at (x, y). An off spot's walk can lean on that block on the
   * way there (a block goes once only), so the push goal also ends once the block has slid (pushedBefore).
   */
  spot?: {
    at: number;
    x: number;
    y: number;
    axes: readonly ("x" | "y")[];
    travel?: boolean;
    nudge?: boolean;
    make?: (x: number, y: number) => Goal;
    side?: boolean;
    pushes?: { at: number; x: number; y: number };
  };
  /** A goal holding the stick (a push) let go of `after` ticks into it, for LET_GO_TICKS. */
  hold?: { at: number; after: number };
  /** Where the idle variant stands IDLE_TICKS (before this goal). */
  idle?: number;
  /** The formation goal, and the others to try instead (`settle`: the route's wait for its own shape, made a plain wait). */
  formation?: { at: number; alts: readonly StickFormation[]; settle?: number };
  /** Leaving the area and coming back: goals played before goal `at` (or `after` ticks into it, as a let-go). */
  detour?: { at: number; after?: number; goals: () => Goal[] };
  /** Play the milestone only up to this goal (its fights left out: their outcome is rolled, not the puzzle's). */
  until?: number;
  /** The puzzle's own outcome, checked once the milestone (or its goals up to `until`) is over. */
  check: (g: AdventureGame) => boolean;
}


/** Y: the others come back and trail the leader. */
const together = (): Goal[] => [press(GATHER_BUTTON, 1, 0), waitUntil("together", (g) => g.adventure.formation === "trail", 120)];

/** The stage a puzzle (or scenario) is in. */
export const stageOf = (p: { stage?: string }): PlayStage => stageNamed(p.stage ?? "boss010")!;

/** Lake Hylia's puzzles, in route order. */
const LAKE_HYLIA_PUZZLES: readonly Puzzle[] = [
  {
    key: "boulder",
    milestone: 1,
    name: "room 2's boulder pushed into the river (wide formation)",
    spot: { at: 0, x: 232, y: 320, axes: ["x"] },
    hold: { at: 3, after: 40 },
    idle: 2,
    formation: { at: 2, alts: ["box", "long", "cross"] },
    // Back east into room 1 halfway up the push, and in again (the boulder comes back to its place with the Links).
    detour: { at: 3, after: 60, goals: () => [...together(), travelTo(232, 330), travelTo(470, 310), goTo(Right, 1), goTo(Left, 2), travelTo(232, 320), face(Up), formation("wide")] },
    check: (g) => g.adventure.sunk.length > 0,
  },
  {
    key: "cave-stone",
    milestone: 2,
    name: "room 2: the stone at the cave's mouth lifted and thrown back",
    spot: { at: 2, x: 352, y: 120, axes: ["y"] },
    idle: 5,
    // Up into room 3 holding the stone, and back: the stone is at the cave's mouth again (the area's things come back
    // with the Links), the one carried is thrown away first.
    detour: {
      at: 5,
      goals: () => [
        walkTo(312, 120), walkTo(312, 56), walkTo(272, 40), goTo(Up, 3), goTo(Down, 2), walkTo(312, 56), walkTo(312, 120), walkTo(352, 120),
        face(Left), press(Action, 2, 40), press(Right, 6, 2), press(Action, 2, 30),
      ],
    },
    check: (g) => g.adventure.gear === "boomerang",
  },
  {
    key: "cave-switch",
    milestone: 2,
    name: "room 2's cave: the box formation onto its four-Link switch (YNSW), the door",
    spot: { at: 16, x: 128, y: 96, axes: ["x", "y"] },
    idle: 16,
    formation: { at: 15, alts: ["wide", "long", "cross"] },
    // Back out of the cave from beside the switch, and in again (the stone at its mouth back in the way: lifted again).
    detour: {
      at: 15,
      goals: () => [
        walkTo(120, 190), walkTo(104, 208), walkTo(104, 272), walkTo(118, 290), walkTo(122, 320), walkTo(128, 340), goTo(Down, 2, 0),
        walkTo(386, 120), face(Left), press(Action, 2, 30), face(Right), press(Action, 2, 40), walkTo(384, 120), goTo(Up, 2, 5),
        walkTo(122, 320), walkTo(118, 290), walkTo(104, 272), walkTo(104, 208), walkTo(120, 190), walkTo(120, 150),
      ],
    },
    check: (g) => g.adventure.gear === "boomerang",
  },
  {
    key: "boomerang-key",
    milestone: 3,
    name: "room 3: the boomerang fetches the key over the posts",
    spot: { at: 5, x: 400, y: 200, axes: ["y"] },
    idle: 6,
    check: (g) => g.adventure.gear === "fireRod",
  },
  {
    key: "key-lift",
    milestone: 3,
    name: "room 3: the key lifted from beside it and carried to the house's locked door",
    // (The goal indices of milestone 3 are after its first three goals (the Octoroks fought, the Links gathered) and the
    // key's message's four: lakehylia.ts.)
    spot: { at: 13, x: 400, y: 219, axes: ["x", "y"] },
    idle: 17,
    // Down into room 2 with the key, and back.
    detour: { at: 17, goals: () => [travelTo(272, 360), goTo(Down, 2), goTo(Up, 3), travelTo(400, 219)] },
    check: (g) => g.adventure.gear === "fireRod",
  },
  {
    key: "house-rock",
    milestone: 3,
    name: "the house's back room: the two-Link rock lifted by the column of Links, the Fire Rod",
    spot: { at: 26, x: 154, y: 92, axes: ["y"] },
    idle: 30,
    formation: { at: 25, alts: ["wide", "box", "cross"] },
    // Out of the back room into the house's front room carrying the rock, and back (the rock still held?).
    detour: { at: 30, goals: () => [walkTo(146, 100), walkTo(48, 100), goTo(Down, 3, 2), goTo(Up, 3, 3), walkTo(48, 100), walkTo(146, 100), formation("long"), walkTo(154, 92), face(Right), press(Action, 2, 4), waitUntil("lifted again", (g) => g.adventure.heavy?.phase === "carry", 120)] },
    check: (g) => g.adventure.gear === "fireRod",
  },
  {
    key: "stumps",
    milestone: 4,
    name: "room 3: the Fire Rod burns the stumps round the two-Link rock",
    spot: { at: 5, x: 224, y: 232, axes: ["x"] },
    idle: 6,
    check: (g) => g.adventure.burnt.length >= 6,
  },
  {
    key: "hole-rock",
    milestone: 4,
    name: "room 3: the two-Link rock lifted off the hole (wide formation), the side-view cave's crystal",
    spot: { at: 11, x: 218, y: 214, axes: ["x"] },
    idle: 15,
    formation: { at: 9, alts: ["long", "box", "cross"] },
    // Down into room 2 once the stumps are burnt, and back.
    detour: { at: 9, goals: () => [travelTo(272, 360), goTo(Down, 2), goTo(Up, 3), travelTo(224, 250)] },
    check: (g) => g.adventure.room === 3 && g.adventure.area === 0 && g.adventure.burnt.length >= 6,
  },
  {
    key: "crystal",
    milestone: 4,
    name: "room 3's side-view cave: the crystal struck from the ledge, its bridge",
    spot: { at: 25, x: 40, y: 56, axes: ["x"] },
    idle: 26,
    check: (g) => g.adventure.room === 3 && g.adventure.area === 0,
  },
  {
    key: "plateau-switch",
    milestone: 5,
    name: "room 4: the box formation on the four-Link switch (YNSW at (320, 144)), the gem rain",
    spot: { at: 21, x: 320, y: 144, axes: ["x", "y"], travel: true },
    idle: 22,
    formation: { at: 22, alts: ["wide", "long", "cross"] },
    detour: { at: 21, goals: () => [travelTo(320, 200), travelTo(320, 264), travelTo(360, 264), travelTo(320, 200), travelTo(320, 160)] },
    check: (g) => g.adventure.room === 5 && g.adventure.links[0]!.mode === "swim",
  },
  {
    key: "plateau-rock",
    milestone: 5,
    name: "room 4: the two-Link rock in the way west lifted by the column of Links",
    spot: { at: 36, x: 198, y: 108, axes: ["y"] },
    idle: 40,
    formation: { at: 35, alts: ["wide", "box", "cross"] },
    check: (g) => g.adventure.room === 5 && g.adventure.links[0]!.mode === "swim",
  },
  {
    key: "pocket-stone",
    milestone: 5,
    name: "room 5's pocket: the stone lifted off the way to the ledge",
    spot: { at: 44, x: 72, y: 330, axes: ["x"], travel: true },
    idle: 46,
    detour: { at: 44, goals: () => [goTo(Down, 4), goTo(Up, 5)] },
    check: (g) => g.adventure.room === 5 && g.adventure.links[0]!.mode === "swim",
  },
  {
    key: "bridge-rock",
    milestone: 6,
    name: "under room 5's bridge: the two-Link rock on the ledge lifted by the column of Links",
    spot: { at: 8, x: 122, y: 103, axes: ["y"] },
    idle: 12,
    formation: { at: 7, alts: ["wide", "box", "cross"] },
    check: (g) => g.adventure.room === 7,
  },
  {
    key: "cannons",
    milestone: 7,
    name: "room 7's caves: the cannons",
    spot: { at: 6, x: 32, y: 104.8, axes: ["x"] },
    idle: 3,
    check: (g) => g.adventure.room === 58,
  },
  {
    key: "apart-switches",
    milestone: 8,
    name: "room 58's caves: the four Links apart on the middle room's four switches, the bridge",
    spot: { at: 10, x: 264, y: 264, axes: ["x", "y"], travel: true },
    idle: 10,
    // With three on their switches, the leader out of the cave and back in.
    detour: { at: 10, goals: () => [travelTo(240, 470), goTo(Down, 58, 0), travelTo(272, 60), goTo(Up, 58, 5)] },
    check: (g) => g.adventure.gems >= 500 && g.adventure.formation === "trail",
  },
  {
    key: "east-bridge",
    milestone: 8,
    name: "room 58's caves: switch 17 held by one Link while the leader crosses alone",
    spot: { at: 28, x: 312, y: 200, axes: ["x", "y"], travel: true },
    idle: 31,
    check: (g) => g.adventure.formation === "trail" && g.players[0]!.x > 380 * SUBPX,
  },
  {
    key: "block",
    milestone: 10,
    name: "room 6's area 6: the block pushed south by the wide formation",
    spot: { at: 1, x: 374, y: 52, axes: ["x"], travel: true },
    hold: { at: 3, after: 30 },
    idle: 2,
    formation: { at: 2, alts: ["box", "long", "cross"] },
    detour: { at: 3, after: 20, goals: () => [travelTo(464, 52), travelTo(374, 52), formation("wide")] },
    check: (g) => g.adventure.room === 6 && g.adventure.area === 0,
  },
  {
    key: "raft",
    milestone: 10,
    name: "room 6's area 6: the raft across the pit (box formation on it)",
    spot: { at: 5, x: 340, y: 80, axes: ["x", "y"], travel: true },
    idle: 5,
    formation: { at: 4, alts: ["wide", "long", "cross"] },
    check: (g) => g.adventure.room === 6 && g.adventure.area === 0,
  },
  {
    key: "garden-stone",
    milestone: 11,
    name: "room 6's garden: the grey stone lifted, the hole under a bush",
    spot: { at: 6, x: 298, y: 328, axes: ["y"] },
    idle: 8,
    check: (g) => g.players[0]!.x < 100 * SUBPX,
  },
  {
    key: "ambush-switch",
    milestone: 12,
    name: "room 5's bridge switch: shut in, sixteen soldiers, the way west again",
    spot: { at: 4, x: 264, y: 304, axes: ["x", "y"], travel: true },
    idle: 5,
    until: 6,
    check: (g) => ((g.battle.switches >>> 4) & 1) === 1,
  },
  {
    key: "bush-switches",
    milestone: 12,
    name: "room 5's north bank: the four Links apart on the four switches under bushes, the chests",
    spot: { at: 31, x: 360, y: 56, axes: ["x", "y"], travel: true },
    idle: 31,
    // With three on their switches, the leader west into room 9 and back.
    detour: { at: 31, goals: () => [travelTo(224, 70), travelTo(24, 72), goTo(Left, 9), goTo(Right, 5), travelTo(224, 70), travelTo(296, 72)] },
    check: (g) => g.adventure.room === 9 && g.adventure.gems >= 1300,
  },
  {
    key: "room9-switch",
    milestone: 13,
    name: "room 9: the floor switch shuts the way in, the soldiers, the way west",
    spot: { at: 0, x: 472, y: 88, axes: ["x", "y"], travel: true },
    idle: 1,
    until: 3,
    check: (g) => ((g.battle.switches >>> 18) & 1) === 1,
  },
];

/** World 1's puzzles, stage by stage in route order. */
export const PUZZLES: readonly Puzzle[] = [...LAKE_HYLIA_PUZZLES, ...WORLD_1_PUZZLES];

/** A goal played as is, but let go of (no buttons) for `ticks` ticks once it has run `after` ticks. */
export function letGo(goal: Goal, after: number, ticks: number): Goal {
  let inner = 0;
  return {
    name: `${goal.name} (let go ${ticks} ticks after ${after})`,
    limit: goal.limit + ticks,
    next(g, s, t) {
      if (t === 0) inner = 0;
      if (t >= after && t < after + ticks) return 0;
      return goal.next(g, s, inner++);
    },
  };
}

/** A goal played as is, but interrupted `after` ticks into it by other goals played to their end. */
export function interrupt(goal: Goal, after: number, goals: readonly Goal[]): Goal {
  let inner = 0, index = 0, start = 0, phase = 0;
  return {
    name: `${goal.name} (interrupted after ${after})`,
    limit: goal.limit + goals.reduce((n, g) => n + g.limit, 0),
    next(g, s, t) {
      if (t === 0) [inner, index, start, phase] = [0, 0, 0, 0];
      if (phase === 0 && inner >= after) [phase, start] = [1, t];
      while (phase === 1) {
        const sub = goals[index];
        if (!sub) {
          phase = 2;
          break;
        }
        const out = sub.next(g, s, t - start);
        if (out !== true) return out;
        index++;
        start = t;
      }
      return goal.next(g, s, inner++);
    },
  };
}

/**
 * Travels first to a point about 40 px from (x, y) on another side than the leader comes from (standable, reachable;
 * the one most opposite), then on: the spot's own goal follows.
 */
export function approachFromElsewhere(x: number, y: number): Goal {
  let inner: Goal | null = null;
  return {
    name: `round to another side of (${x}, ${y})`,
    limit: 2400,
    next(g, s, t) {
      if (t === 0) {
        const p = g.players[0]!, px = p.x / SUBPX, py = p.y / SUBPX, world = areaWorld(g, s);
        const can = reachable(world, Math.round(px), Math.round(py));
        const from = Math.atan2(py - y, px - x);
        let best: [number, number] | null = null, bestScore = -Infinity;
        for (const [dx, dy] of [[40, 0], [-40, 0], [0, 40], [0, -40], [32, 32], [-32, 32], [32, -32], [-32, -32]] as const) {
          const cx = x + dx, cy = y + dy;
          if (!standable(world, cx, cy) || !can(cx, cy) || !findPath(world, cx, cy, Math.round(x), Math.round(y))) continue;
          const angle = Math.abs(Math.atan2(dy, dx) - from), score = Math.min(angle, 2 * Math.PI - angle);
          if (score > bestScore) [best, bestScore] = [[cx, cy], score];
        }
        inner = best ? travelTo(best[0], best[1]) : null;
      }
      return inner ? inner.next(g, s, t) : true;
    },
  };
}

/**
 * A walk that also ends once the leader stops moving for BLOCKED_TICKS (a wall or a rock between him and the point):
 * the spot off the scripted one is as close as he gets to it.
 */
export function walkToward(goal: Goal): Goal {
  let still = 0, x = 0, y = 0, held = false;
  return {
    name: goal.name,
    limit: goal.limit,
    next(g, s, t) {
      const p = g.players[0]!;
      // (Still only while the stick was held: a message closing or a pose can hold him a while.)
      if (t === 0) still = 0;
      else still = p.x === x && p.y === y && held ? still + 1 : 0;
      [x, y] = [p.x, p.y];
      if (still >= BLOCKED_TICKS) return true;
      const out = goal.next(g, s, t);
      held = out !== true && (out & (Up | Down | Left | Right)) !== 0;
      return out;
    },
  };
}

/** Ticks without moving that end walkToward. */
const BLOCKED_TICKS = 40;

/**
 * A route's push goal that also ends once the block at (x, y) has slid, whoever moved it: a walk onto an off spot can
 * lean on the block on the way (the sim's lean after 21 blocked ticks), and then the scripted push has been made.
 * Until it has slid the goal goes on holding its stick, as the scripted push does.
 */
export function pushedBefore(push: Goal, x: number, y: number): Goal {
  const from = (y >> 4) * 32 + (x >> 4);
  return {
    name: push.name,
    limit: push.limit,
    next(g, s, t) {
      const out = push.next(g, s, t);
      const b = g.adventure.blocks.find((q) => q.from === from);
      return b && b.tick >= BLOCK_SLIDE_TICKS ? true : out;
    },
  };
}

/** One way of bending a puzzle: its name and the milestone's goals bent. */
export interface Variant {
  name: string;
  goals: Goal[];
}

/** The puzzle's variants (6-14 each). */
export function variants(p: Puzzle): Variant[] {
  const base = stageOf(p).milestones[p.milestone]!.goals.slice(0, p.until);
  const out: Variant[] = [];
  const bent = (name: string, change: (goals: Goal[]) => void) => {
    const goals = base.slice();
    change(goals);
    out.push({ name, goals });
  };
  if (p.spot) {
    const { at, x, y, axes, travel, make, side, nudge, pushes } = p.spot;
    for (const axis of axes) {
      for (const d of OFFSETS) {
        for (const sign of [-1, 1]) {
          const tx = axis === "x" ? x + sign * d : x, ty = axis === "y" ? y + sign * d : y;
          // (Within 0.75 px: a step is 1.5 px straight, 1.06 px each way diagonally.)
          const walk = () =>
            make ? make(tx, ty)
            : nudge ? sequence(`to (${x}, ${y}), then (${tx}, ${ty})`, [base[at]!, walkTo(tx, ty, 0.75)])
            : travel ? travelTo(tx, ty, { tol: 0.75, exact: true })
            : walkTo(tx, ty, 0.75);
          bent(`${axis} ${sign < 0 ? "-" : "+"}${d} px`, (goals) => {
            goals[at] = walkToward(walk());
            if (pushes) goals[pushes.at] = pushedBefore(goals[pushes.at]!, pushes.x, pushes.y);
          });
        }
      }
    }
    if (!side) bent("from another side", (goals) => goals.splice(at, 0, approachFromElsewhere(x, y)));
  }
  if (p.hold) {
    const { at, after } = p.hold;
    bent(`let go ${after} ticks in`, (goals) => void (goals[at] = letGo(goals[at]!, after, LET_GO_TICKS)));
    bent(`let go ${after * 2} ticks in`, (goals) => void (goals[at] = letGo(goals[at]!, after * 2, LET_GO_TICKS)));
  }
  if (p.idle !== undefined) bent(`idle ${IDLE_TICKS} ticks`, (goals) => goals.splice(p.idle!, 0, wait(IDLE_TICKS)));
  for (const alt of p.formation?.alts ?? []) {
    bent(`${alt} formation`, (goals) => {
      goals[p.formation!.at] = formation(alt);
      if (p.formation!.settle !== undefined) goals[p.formation!.settle] = wait(SETTLE_TICKS);
    });
  }
  if (p.detour) {
    const { at, after, goals: detour } = p.detour;
    bent("away and back", (goals) => {
      if (after === undefined) goals.splice(at, 0, ...detour());
      else goals[at] = interrupt(goals[at]!, after, detour());
    });
  }
  return out;
}

/** What the puzzles leave behind, to compare with the scripted run's (the Force Gems and enemies left out: rolled). */
export function leftBehind(g: AdventureGame): Record<string, unknown> {
  const a = g.adventure, sorted = (v: number[]) => [...v].sort((x, y) => x - y);
  const rooms: Record<number, number> = {};
  // (The room the Links are in keeps its switches in `switches`; a saved copy of it is from an earlier visit.)
  for (let i = 0; i < a.roomSwitches.length; i += 2) if (a.roomSwitches[i] !== a.room) rooms[a.roomSwitches[i]!] = a.roomSwitches[i + 1]!;
  return {
    where: `room ${a.room} area ${a.area}`,
    gear: a.gear,
    keys: a.keys,
    sunk: a.sunk.slice(),
    moved: sorted(a.moved),
    burnt: sorted(a.burnt),
    opened: sorted(a.opened),
    rewritten: sorted(a.rewritten),
    switches: g.battle.switches >>> 0,
    roomSwitches: rooms,
    rocks: a.rocks.map((r) => `${r.type}#${r.actor} ${r.state} (${r.x >> 8}, ${r.y >> 8})`).sort(),
    // (The current area's: the blocks and color blocks pushed, the escort Zora's area.)
    blocks: a.blocks.map((b) => `${b.from}>${b.to}`).sort(),
    colorBlocks: sorted(a.colorBlocks.filter((_, i) => i % 2 === 0)),
    escort: a.escort ? `${a.escort.room}/${a.escort.area}` : null,
    cleared: a.cleared > 0,
  };
}

const STUCK_WHY: Readonly<Record<Stuck["why"], string>> = {
  wall: "in a wall",
  still: "not moving with the stick held",
  lifter: "left behind by the two-Link rock he lifts",
  carried: "carrying a two-Link rock out of its area",
};

/** A variant's outcome. */
export interface BentResult {
  puzzle: string;
  variant: string;
  ok: boolean;
  /** What went wrong: the milestone not finished, a Link stuck, the puzzle's check, what differs from the scripted run. */
  problems: string[];
  /** The buttons from the stage's start to the end of the variant (the scripted route's, then the variant's). */
  buttons: number[];
  ticks: number;
  stuck: Stuck[];
  /** Where a capture of it should stop (an index in `buttons`): a little after the first Link stuck, else the end. */
  captureAt: number;
}

/** Ticks a capture runs on past a Link stuck. */
const CAPTURE_AFTER = 30;

const ends = new WeakMap<RouteRun, Map<string, AdventureGame>>();

/** The scripted run where the puzzle's goals end (its milestone's end, or its goal `until`). */
function scriptedEnd(stage: AdventureStage, run: RouteRun, p: Puzzle): AdventureGame {
  if (p.until === undefined) return run.ends[p.milestone]!;
  let cache = ends.get(run);
  if (!cache) ends.set(run, (cache = new Map()));
  let end = cache.get(p.key);
  if (!end) {
    end = cloneAdventure(run.starts[p.milestone]!.game);
    playGoals(end, stage, stageOf(p).milestones[p.milestone]!.goals.slice(0, p.until));
    cache.set(p.key, end);
  }
  return end;
}

/** Plays one variant from its milestone's start in the scripted run. */
export function playVariant(stage: AdventureStage, run: RouteRun, p: Puzzle, v: Variant): BentResult {
  const start = run.starts[p.milestone]!, game = cloneAdventure(start.game);
  const played = playGoals(game, stage, v.goals);
  const problems: string[] = [];
  if (!played.done) problems.push(`not finished: ${played.error} (${game.adventure.gems} gems)`);
  const scripted = new Set(run.stuck[p.milestone]!.map((s) => `${s.link}:${s.why}:${s.room}:${s.area}`));
  const stuck = played.stuck.filter((s) => !scripted.has(`${s.link}:${s.why}:${s.room}:${s.area}`));
  for (const s of stuck) problems.push(`Link ${s.link} ${STUCK_WHY[s.why]} at tick ${s.tick}, room ${s.room} area ${s.area} (${s.x.toFixed(1)}, ${s.y.toFixed(1)})`);
  if (played.done) {
    if (!p.check(game)) problems.push(`the puzzle's check fails (room ${game.adventure.room} area ${game.adventure.area}, ${game.adventure.gems} gems)`);
    const want = leftBehind(scriptedEnd(stage, run, p)), got = leftBehind(game);
    for (const k of Object.keys(want)) {
      if (JSON.stringify(want[k]) !== JSON.stringify(got[k])) problems.push(`${k}: ${JSON.stringify(got[k])}, scripted ${JSON.stringify(want[k])}`);
    }
  }
  const buttons = [...start.buttons, ...played.buttons];
  const first = stuck.length ? Math.min(...stuck.map((s) => s.tick)) : null;
  const captureAt = first === null ? buttons.length : Math.min(buttons.length, start.buttons.length + first - start.game.tick + CAPTURE_AFTER);
  return { puzzle: p.key, variant: v.name, ok: problems.length === 0, problems, buttons, ticks: played.buttons.length, stuck, captureAt };
}

/** Every variant of a stage's puzzles (all of them by default). */
export function playBent(play: PlayStage, stage: AdventureStage, run: RouteRun, keys?: readonly string[]): BentResult[] {
  const out: BentResult[] = [];
  for (const p of puzzlesOf(play)) {
    if (keys?.length && !keys.includes(p.key)) continue;
    for (const v of variants(p)) out.push(playVariant(stage, run, p, v));
  }
  return out;
}

/** A stage's puzzles. */
export const puzzlesOf = (play: PlayStage): Puzzle[] => PUZZLES.filter((p) => stageOf(p) === play);

/** How many milestones a stage's checks play its route through (up to its last puzzle's or scenario's). */
export const milestonesPlayed = (play: PlayStage): number =>
  Math.max(...[...puzzlesOf(play), ...SCENARIOS.filter((s) => stageOf(s) === play)].map((p) => p.milestone)) + 1;

/** A thing seen while bending a route, played on its own from a milestone's start. */
export interface Scenario {
  key: string;
  /** Its stage's id (boss010 when left out). */
  stage?: string;
  milestone: number;
  note: string;
  goals: () => Goal[];
  /** Holds once the game is in the state reported (a finding while it does). */
  shows: (g: AdventureGame) => boolean;
}

/** Things seen while bending the routes, played on their own from a milestone's start. */
export const SCENARIOS: readonly Scenario[] = [
  {
    key: "lift-a-follower",
    milestone: 1,
    note: "the Action button facing a follower lifts him (the battle's lift of a Link) in the adventure, one player with four Links: the game's answer unchecked (Dolphin)",
    goals: () => [walkTo(440, 288), face(Right), press(Action, 2, 30)],
    shows: (g) => g.battle.fighters.some((f, i) => i > 0 && f.move === "held"),
  },
  ...WORLD_1_SCENARIOS,
];

/** A scenario played: whether it shows what it reports, and the buttons from the stage's start. */
export function playScenario(stage: AdventureStage, run: RouteRun, s: Scenario): { shows: boolean; buttons: number[] } {
  const start = run.starts[s.milestone]!, game = cloneAdventure(start.game);
  const played = playGoals(game, stage, s.goals());
  return { shows: s.shows(game), buttons: [...start.buttons, ...played.buttons] };
}

/** The scripted routes' own stuck Links, known (`<stage id>:<milestone>:<Link>:<why>`). (Was: Lake Hylia's followers
 *  walking back up into room 58's bank after its ledge hop, fixed in ledge.ts stepJump.) */
export const SCRIPTED_STUCK: readonly string[] = [...WORLD_1_STUCK];

/** Prints a variant's ticks (every `every`, from `from` ticks into it): where the Links are, what they do. */
export function traceVariant(stage: AdventureStage, run: RouteRun, p: Puzzle, v: Variant, from = 0, every = 10): void {
  const game = cloneAdventure(run.starts[p.milestone]!.game), player = new RoutePlayer(v.goals);
  for (let t = 0; !player.done && t < 20000; t++) {
    let b: number;
    try {
      b = player.next(game, stage);
    } catch (e) {
      console.log((e as Error).message);
      break;
    }
    if (player.done) break;
    stepAdventure(game, [b], stage);
    if (t < from || t % every) continue;
    const a = game.adventure;
    const links = game.players.map((q, i) => `${(q.x / SUBPX).toFixed(1)},${(q.y / SUBPX).toFixed(1)}${a.links[i]!.mode === "walk" ? "" : ` ${a.links[i]!.mode}`}${game.battle.fighters[i]!.move === "none" ? "" : ` ${game.battle.fighters[i]!.move}`}`);
    const rocks = a.rocks.filter((r) => r.state !== "rest").map((r) => `${r.type} ${r.state} ${(r.x / SUBPX).toFixed(0)},${(r.y / SUBPX).toFixed(0)}`);
    console.log(`${String(t).padStart(5)} g${player.index} ${player.current.slice(0, 28).padEnd(28)} b${b.toString(16).padStart(4)} r${a.room}/${a.area} ${a.formation}${a.away ? " away" : ""} sw ${(game.battle.switches >>> 0).toString(16)} | ${links.join(" | ")}${a.heavy ? ` heavy ${a.heavy.phase}` : ""}${rocks.length ? ` | ${rocks.join(", ")}` : ""}`);
  }
}

/** A finding's capture id on a stage: Lake Hylia's as they were, the others' with the stage's short name first. */
const stageFindingId = (play: PlayStage, name: string) => findingId(play.id === "boss010" ? name : `${play.aliases[0]} ${name}`);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), captures = args.includes("--captures");
  const trace = args.indexOf("--trace");
  const { stages, rest } = stageArgs(args.filter((a, i) => !a.startsWith("--") && (trace < 0 || i < trace) && args[i - 1] !== "--goals"));
  if (trace >= 0) {
    const [key, name] = args[trace + 1]!.split(" / "), from = Number(args[trace + 2] ?? 0), every = Number(args[trace + 3] ?? 10);
    // ("m<n> / scripted": milestone n of the stage named first (Lake Hylia by default) as scripted.)
    const m = /^m(\d+)$/.exec(key!);
    const p: Puzzle = m ? { key: key!, stage: stages[0]!.id, milestone: Number(m[1]), name: key!, check: () => true } : PUZZLES.find((q) => q.key === key)!;
    const play = stageOf(p), { stage } = loadStage(play.id);
    const v = name === "scripted" ? { name, goals: play.milestones[p.milestone]!.goals.slice() } : variants(p).find((w) => w.name === name)!;
    traceVariant(stage, runRoute(stage, play.milestones, p.milestone + 1), p, v, from, every);
    process.exit(0);
  }
  // --goals [milestone]: the stage's milestones and their goals by index (what a puzzle's `at`s point at).
  const goals = args.indexOf("--goals");
  if (goals >= 0) {
    const only = args[goals + 1] === undefined ? null : Number(args[goals + 1]);
    for (const play of stages) {
      play.milestones.forEach((m, n) => {
        if (only !== null && only !== n) return;
        console.log(`${play.id} m${n}: ${m.name}`);
        m.goals.forEach((g, i) => console.log(`  ${String(i).padStart(3)} ${g.name}`));
      });
    }
    process.exit(0);
  }
  const started = performance.now();
  const all: BentResult[] = [];
  for (const play of stages) {
    const { stage } = loadStage(play.id);
    const run = runRoute(stage, play.milestones, milestonesPlayed(play));
    const results = playBent(play, stage, run, rest);
    all.push(...results);
    console.log(`— ${play.name} (${play.id}): ${results.length} variants`);
    for (const r of results) {
      const known = expectedProblem(r.puzzle, r.variant);
      const mark = r.ok ? "ok" : known ? "expected" : "FINDING";
      console.log(`${mark.padEnd(8)} ${r.puzzle} / ${r.variant} (${r.ticks} ticks)${r.ok ? "" : `: ${r.problems.join("; ")}`}`);
      // Captures of the findings (new ones, and known ones reported as findings), cut a little after a Link got stuck.
      if (captures && !r.ok && (!known || known.startsWith("finding"))) {
        const id = findingId(`bent ${r.puzzle} ${r.variant}`);
        console.log(`         capture ${writeCapture(play, stage, r.buttons.slice(0, r.captureAt), `[playtest] bent route ${r.puzzle} / ${r.variant}: ${known ?? r.problems.join("; ")}`, id)}`);
      }
    }
    if (rest.length) continue;
    // The scripted route's own stuck Links, and the scenarios.
    run.stuck.forEach((list, n) => {
      for (const s of list) {
        const known = SCRIPTED_STUCK.includes(`${play.id}:${n}:${s.link}:${s.why}`);
        console.log(`${(known ? "expected" : "FINDING").padEnd(8)} scripted milestone ${n}: Link ${s.link} ${STUCK_WHY[s.why]} at tick ${s.tick}, room ${s.room} area ${s.area} (${s.x.toFixed(1)}, ${s.y.toFixed(1)})`);
        if (!known) process.exitCode = 1;
      }
      if (captures && list.length) {
        const start = run.starts[n]!, at = start.buttons.length + Math.min(...list.map((s) => s.tick)) - start.game.tick + CAPTURE_AFTER;
        const buttons = [...start.buttons, ...playGoals(cloneAdventure(start.game), stage, play.milestones[n]!.goals).buttons];
        const note = `[playtest] ${play.name}'s scripted route, milestone ${n}: ${list.map((s) => `Link ${s.link} ${STUCK_WHY[s.why]} at (${s.x.toFixed(1)}, ${s.y.toFixed(1)})`).join("; ")}`;
        console.log(`         capture ${writeCapture(play, stage, buttons.slice(0, at), note, stageFindingId(play, `scripted milestone ${n} stuck`))}`);
      }
    });
    for (const s of SCENARIOS.filter((x) => stageOf(x) === play)) {
      const { shows, buttons } = playScenario(stage, run, s);
      console.log(`${(shows ? "expected" : "gone").padEnd(8)} scenario ${s.key}: ${s.note}`);
      if (captures && shows) console.log(`         capture ${writeCapture(play, stage, buttons, `[playtest] ${s.key}: ${s.note}`, findingId(s.key))}`);
    }
  }
  const bad = all.filter((r) => !r.ok && !expectedProblem(r.puzzle, r.variant));
  console.log(`${all.length} variants of ${new Set(all.map((r) => r.puzzle)).size} puzzles in ${((performance.now() - started) / 1000).toFixed(1)} s: ${all.filter((r) => r.ok).length} ok, ${all.length - all.filter((r) => r.ok).length - bad.length} expected, ${bad.length} new`);
  if (bad.length) process.exitCode = 1;
}

