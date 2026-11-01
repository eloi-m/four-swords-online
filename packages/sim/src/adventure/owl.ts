// The owl (KEPO) flying in to its perch when a Link comes within its reach (dialogue.ts startOwlTalk), standing there
// through its talk, and flying off once it's read.
//
// From main.dol (its state entry 0x80219AFC, its draw 0x8021AF28): an owl starts in state 2 (or 0/3) drawing nothing,
// unless its params' bit 19 is set (state 6: on its perch from the start, and it doesn't talk). Set off (state 4), it is
// put where the line from its perch at angle -0x5556 (up and left; 0x5556, up and right, when the perch is in the
// room's left half: then drawn mirrored) leaves the room, 60 px further on (0x801CBB98), 35 px up, and flies to its perch,
// 0.1 px/tick faster each tick up to 1.5; there (state 5) it lands (enemy_gc_sob 604 + its pose: animation 0x2E), sinking
// 0.5 px a tick to 16 px up; 47 ticks on (state 8) its message opens; it stands (state 9: 633, the head 634 21 px over
// it) until the box is closed, takes off (state 11: the landing played backwards, rising 0.8 px a tick from its 24th
// tick) and flies off the same way at angle 0x2AAA (down and right; -0x2AAA mirrored) to 60 px out of the room.
// Flying it flaps (poses 2-5) three times and glides (poses 0, 1) every 96 ticks. Its draw adds 6 px to its y.
// Traced in Dolphin (docs/measurements/adventure-world1.md "The owl's flight"): Tingle's Tower room 11 (from (48.4,
// -30.1), on the perch 186 ticks on, the box's first character 239 ticks after the stop as measured before) and Hyrule
// Castle room 0 (from (9.1, -30.1), 228 ticks on, its state 8 at 275: the box's first character 281 ticks after the
// stop, derived).
import { ROOM_H, ROOM_W } from "../world.ts";
import type { AdventureGame } from "./adventure.ts";

/** An owl on its way in, on its perch, or on its way off (room px; ticks counted from the one it was set off on). */
export interface OwlFlight {
  /** Its index in the room's actor list, and the room. */
  actor: number;
  room: number;
  /** Ticks since it was set off (0 that tick). */
  tick: number;
  /** Where it flies in from, its perch, and where it flies off to. */
  fromX: number;
  fromY: number;
  homeX: number;
  homeY: number;
  toX: number;
  toY: number;
  /** Ticks to the perch (`tick` then). */
  arrive: number;
  /** The tick (of `tick`) it takes off, once its message is closed; -1 before. */
  leave: number;
  /** Its perch in the room's left half: it comes from the right, and is drawn mirrored. */
  mirror: boolean;
}

/** Its height flying and on its perch, and the margin out of the room it flies from and to (0x801CBB98's). */
export const OWL_FLYING_Z = 35;
export const OWL_PERCHED_Z = 16;
const OWL_MARGIN = 60;
/** Its landing's ticks (state 5: animation 0x2E), and its take-off's (the same, backwards). */
export const OWL_LANDING_TICKS = 47;
/** The landing's poses (604 + pose) from these ticks into it; the take-off plays them backwards. */
const LANDING_POSES: readonly (readonly [number, number])[] = [[0, 6], [4, 7], [8, 8], [15, 9], [20, 10], [24, 11], [29, 12], [33, 13], [37, 14]];
/** One flight cycle (96 ticks): three flaps (poses 2-5) and a glide (0, 1). */
const FLAP: readonly (readonly [number, number])[] = [[0, 2], [7, 3], [11, 4], [15, 5]];
const OWL_FLAP_TICKS = 22;
const OWL_GLIDE_TICKS = 15;
const OWL_CYCLE = 3 * OWL_FLAP_TICKS + 2 * OWL_GLIDE_TICKS;

/** A main.dol angle (0x10000 a turn; 0 down, 0x4000 right) as its sine table gives it: 2048 steps. */
function heading(angle: number): { x: number; y: number } {
  const t = ((((angle & 0xffff) >> 5) & 0x7ff) * 2 * Math.PI) / 2048;
  return { x: Math.sin(t), y: Math.cos(t) };
}

/** Where the line from (x, y) along `angle` leaves the room, OWL_MARGIN px further on. */
function outOfRoom(x: number, y: number, angle: number): { x: number; y: number } {
  const d = heading(angle);
  const tx = d.x > 0 ? (ROOM_W - x) / d.x : d.x < 0 ? -x / d.x : Infinity;
  const ty = d.y > 0 ? (ROOM_H - y) / d.y : d.y < 0 ? -y / d.y : Infinity;
  const t = Math.min(tx, ty) + OWL_MARGIN;
  return { x: x + d.x * t, y: y + d.y * t };
}

/** The distance flown in its first n ticks (0.1 px/tick faster each tick, up to 1.5). */
function flown(n: number): number {
  return n <= 15 ? (n * (n + 1)) / 20 : 12 + (n - 15) * 1.5;
}

/**
 * Ticks to its perch: the first that ends within OWL_NEAR px of it, or past it (traced: Hyrule Castle's arrived 0.02 px
 * short, Tingle's Tower's went on from 0.63; the game's own test not read).
 */
const OWL_NEAR = 0.5;
function ticksFor(distance: number): number {
  let n = 0;
  while (distance - flown(n) >= OWL_NEAR) n++;
  return n;
}

/** Sets an owl off from its perch (x, y) in the current room, the tick a Link came within its reach. */
export function setOwlOff(game: AdventureGame, actor: number, x: number, y: number): OwlFlight {
  const mirror = x <= ROOM_W / 2;
  const from = outOfRoom(x, y, mirror ? 0x5556 : -0x5556);
  const to = outOfRoom(x, y, mirror ? -0x2aaa : 0x2aaa);
  const owl: OwlFlight = {
    actor, room: game.adventure.room, tick: 0, fromX: from.x, fromY: from.y, homeX: x, homeY: y, toX: to.x, toY: to.y,
    arrive: ticksFor(Math.sqrt((x - from.x) ** 2 + (y - from.y) ** 2)), leave: -1, mirror,
  };
  game.adventure.owl = owl;
  return owl;
}

/** Ticks from setting off to its message's first request (state 8). */
export const owlTalkTicks = (owl: OwlFlight): number => owl.arrive + OWL_LANDING_TICKS;

/**
 * The owl's tick: on until it's flown out of the room (or the Links have left the room). It takes off on the 4th tick
 * after the press that closes its message (traced: state 11 then).
 */
export function stepOwl(game: AdventureGame, closing: boolean): void {
  const a = game.adventure, owl = a.owl;
  if (!owl) return;
  if (owl.room !== a.room) return void (a.owl = null);
  owl.tick++;
  if (owl.leave < 0 && closing) owl.leave = owl.tick + 3;
  if (owl.leave >= 0 && owlLook(owl) === null) a.owl = null;
}

/** What the owl shows: where (room px; z its height), its pose (enemy_gc_sob 604 + pose), or perched (633 and 634). */
export interface OwlLook {
  x: number;
  y: number;
  z: number;
  pose: number | "perched";
  mirror: boolean;
}

const poseAt = (table: readonly (readonly [number, number])[], k: number) => table.reduce((p, [at, pose]) => (k >= at ? pose : p), table[0]![1]);

/** The flight's pose c ticks into it (the first cycle starts at c 0; before it, the pose it had standing: 1). */
function flightPose(c: number): number {
  if (c < 0) return 1;
  const k = c % OWL_CYCLE;
  if (k >= 3 * OWL_FLAP_TICKS) return k < 3 * OWL_FLAP_TICKS + OWL_GLIDE_TICKS ? 0 : 1;
  return poseAt(FLAP, k % OWL_FLAP_TICKS);
}

/** The owl as it shows on its tick, or null once it has flown out of the room. */
export function owlLook(owl: OwlFlight): OwlLook | null {
  const t = owl.tick, m = owl.mirror;
  if (t < owl.arrive) {
    const d = Math.sqrt((owl.homeX - owl.fromX) ** 2 + (owl.homeY - owl.fromY) ** 2), s = flown(t) / d;
    return { x: owl.fromX + (owl.homeX - owl.fromX) * s, y: owl.fromY + (owl.homeY - owl.fromY) * s, z: OWL_FLYING_Z, pose: flightPose(t - 1), mirror: m };
  }
  const home = { x: owl.homeX, y: owl.homeY, mirror: m };
  if (t < owl.arrive + OWL_LANDING_TICKS) {
    const k = t - owl.arrive;
    return { ...home, z: Math.max(OWL_PERCHED_Z, OWL_FLYING_Z - 0.5 * k), pose: poseAt(LANDING_POSES, k) };
  }
  if (owl.leave < 0 || t < owl.leave) return { ...home, z: OWL_PERCHED_Z, pose: "perched" };
  if (t < owl.leave + OWL_LANDING_TICKS) {
    const k = t - owl.leave;
    return { ...home, z: k < 24 ? OWL_PERCHED_Z : Math.min(OWL_FLYING_Z, OWL_PERCHED_Z + 0.8 * (k - 23)), pose: poseAt(LANDING_POSES, OWL_LANDING_TICKS - 1 - k) };
  }
  const n = t - owl.leave - OWL_LANDING_TICKS;
  const d = Math.sqrt((owl.toX - owl.homeX) ** 2 + (owl.toY - owl.homeY) ** 2), s = flown(n);
  if (s >= d) return null;
  return { x: owl.homeX + ((owl.toX - owl.homeX) * s) / d, y: owl.homeY + ((owl.toY - owl.homeY) * s) / d, z: OWL_FLYING_Z, pose: flightPose(n), mirror: m };
}
