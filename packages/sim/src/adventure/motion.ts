// What a Link does in the adventure besides the battle code's walking, sword, lifting and items: swimming (swim.ts) and
// jumping down ledges (ledge.ts). One record per Link in AdventureState.links, index-aligned with the players; while a
// Link swims or jumps the adventure moves him itself instead of combat.ts stepFighter.
import { WALK_SPEED, type Facing, type PlayerState } from "../player.ts";
import type { AdventureGame } from "./adventure.ts";
import { CANNON_FRAME, SHOT_FRAME } from "./cannon.ts";
import { keyFrame } from "./doors.ts";
import { DROP_FRAME, FALLS_FRAME } from "./falls.ts";
import { WAITING_FRAME } from "./formation.ts";
import { firePoseFrame } from "./gear.ts";
import { lampPoseFrame } from "./lamp.ts";
import { getFrame } from "./dialogue.ts";
import { heavyFrame } from "./rocks.ts";

export type MotionMode = "walk" | "wade" | "swim" | "ashore" | "jump" | "land" | "cannon" | "shot" | "fall";

export interface LinkMotion {
  /** walk: the battle code moves him; wade: the tick he walked into deep water (still drawn walking); swim: in deep
   *  water; ashore: the tick he got out (still drawn swimming); jump: off a ledge; land: its last tick; cannon: in a
   *  side view's cannon; shot: shot up from it (cannon.ts: vx, vy his speed); fall: over a waterfall (falls.ts: tick
   *  counts the drop at its foot down, 0 while waiting at the top's screen bottom). */
  mode: MotionMode;
  /** Ticks in the mode; while swimming, the stroke's animation tick (0-23). */
  tick: number;
  /** Swimming: the speed (SWIM_UNIT per px/tick) and the direction it's along (DIRS index, -1 none); vx counts a dive
   *  down. Jumping: from (ox, oy) by (vx, vy) every `span` ticks (1/256 px). */
  speed: number;
  dir: number;
  vx: number;
  vy: number;
  ox: number;
  oy: number;
  span: number;
  /** Swimming in a side view (sideview.ts). */
  side: boolean;
  /** Ticks the leader walked into a ledge without getting anywhere (ledge.ts). */
  ledge: number;
  /** In a side view, ticks since he walked off a ledge (sideview.ts WALK_OFF; 0 on the ground). */
  air: number;
  /** A follower in a side view off the ground: he plays the Link ahead's last ticks instead of the trail, until he's on
   *  him (sideview.ts stepSideFollower). */
  chase: boolean;
  /** Swimming: the water's current carrying him (swim.ts stepCurrent), SWIM_UNIT per px/tick. */
  cx: number;
  cy: number;
}

export function createMotion(): LinkMotion {
  return { mode: "walk", tick: 0, speed: 0, dir: -1, vx: 0, vy: 0, ox: 0, oy: 0, span: 1, side: false, ledge: 0, air: 0, chase: false, cx: 0, cy: 0 };
}

/** The 8 directions clockwise from right (y down), as unit steps per axis (diagonals 1/√2: 181/256). */
export const DIRS: readonly (readonly [number, number])[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
export const DIAGONAL = 181; // 256 / √2

/** The DIRS index of a stick direction (-1 for none). */
export function dirOf(dx: number, dy: number): number {
  return DIRS.findIndex(([x, y]) => x === Math.sign(dx) && y === Math.sign(dy));
}

export function dirOfFacing(f: Facing): number {
  return { right: 0, down: 2, left: 4, up: 6 }[f];
}

/** A walking step's length along one axis (1/256 px): what a Link blocked by nothing moves in a tick. */
export const FULL_STEP = WALK_SPEED;

/**
 * The four-Link switch's snap pose (logic.ts stepFourSwitch), traced: sprite 232 for 45 ticks, 220-231 two ticks each,
 * 232 again to the end, 95 ticks in all.
 */
export const FOUR_SNAP_FRAME = 232;
export const FOUR_SNAP_TICKS = 95;
const FOUR_SNAP_HOLD = 45;
const FOUR_SNAP_RISE = 220;

/** The snap pose's sprite `tick` ticks in. */
export function fourSnapFrame(tick: number): number {
  const k = tick - FOUR_SNAP_HOLD;
  return k >= 0 && k < 24 ? FOUR_SNAP_RISE + (k >> 1) : FOUR_SNAP_FRAME;
}

/** The player_sob frame a Link's adventure motion shows (motionFrame), the heavy lift's and the Fire Rod's first. */
export function adventureFrame(game: AdventureGame, i: number): number {
  const w = game.adventure.warp;
  if (w?.whirl) {
    if (w.tick <= 50) return 962 + Math.min(10, Math.floor(w.tick / 5)); // spinning down (traced 962-972)
    return SIDE_SWIM_FRAMES.down + (Math.floor(w.tick / SWIM_FRAME_TICKS) % 4);
  }
  if (game.adventure.fourSnap >= 0) return fourSnapFrame(game.adventure.fourSnap);
  const heavy = heavyFrame(game, i);
  if (heavy >= 0) return heavy;
  const got = getFrame(game);
  if (got >= 0) return got;
  if (i === 0) {
    const key = keyFrame(game);
    if (key >= 0) return key;
    const fire = firePoseFrame(game);
    if (fire >= 0) return fire;
    const lamp = lampPoseFrame(game);
    if (lamp >= 0) return lamp;
  } else if (game.adventure.formation === "apart" && !game.players[i]!.moving) return WAITING_FRAME;
  return motionFrame(game.adventure.links[i], game.players[i]!);
}

/** The player_sob frame a Link's adventure motion shows, or -1 when it's the battle code's to draw. */
export function motionFrame(m: LinkMotion | undefined, p: PlayerState): number {
  if (!m) return -1;
  switch (m.mode) {
    case "swim":
      if (m.side) return (p.moving ? SIDE_SWIM_FRAMES[p.facing] : SIDE_SWIM_FRAMES.down) + Math.floor(m.tick / SWIM_FRAME_TICKS);
      if (m.vx > 0 && DIVE_TICKS - m.vx >= DIVE_SHOW_AFTER) return DIVE_FRAMES[Math.floor(m.tick / SWIM_FRAME_TICKS)]!;
      return SWIM_FRAMES[p.facing] + Math.floor(m.tick / SWIM_FRAME_TICKS);
    case "ashore":
      return SWIM_FRAMES[p.facing] + Math.floor(m.tick / SWIM_FRAME_TICKS);
    case "jump":
      return m.tick > 0 ? JUMP_FRAMES[p.facing] : -1; // the tick it starts shows the walk going on
    case "land":
      return JUMP_FRAMES[p.facing]; // the tick he lands on still shows the jump
    case "cannon":
      return CANNON_FRAME;
    case "shot":
      return SHOT_FRAME;
    case "fall":
      return m.tick > 0 ? DROP_FRAME : FALLS_FRAME;
    default:
      return -1;
  }
}

/** Swimming in a side view (state 75, traced: left 532-535, down and still 540-543, up 548-551; right assumed). */
export const SIDE_SWIM_FRAMES: Readonly<Record<Facing, number>> = { right: 528, left: 532, down: 540, up: 548 };
/** Swimming (state 74, traced): 4 frames per facing, 6 ticks each. */
export const SWIM_FRAMES: Readonly<Record<Facing, number>> = { right: 488, left: 492, down: 496, up: 500 };
export const SWIM_FRAME_TICKS = 6;
/** Diving (B in deep water, traced): under water from DIVE_SHOW_AFTER ticks after the press (504-507 whatever the
 *  facing), up again DIVE_TICKS after it. */
export const DIVE_TICKS = 300;
export const DIVE_SHOW_AFTER = 7;
export const DIVE_FRAMES: readonly number[] = [504, 505, 506, 507];
/** Jumping off a ledge (state 56, traced): the facing's first walk frame throughout. */
export const JUMP_FRAMES: Readonly<Record<Facing, number>> = { right: 0, left: 8, down: 16, up: 24 };
