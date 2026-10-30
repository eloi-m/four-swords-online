// Shadow Link (SLK2, "シャドウリンク２": the Cave of No Return's room 4). His actor (init 0x801C544C, update 0x801CDD58,
// a Link's own state machine: the state's tick 0x801C3098 by the table 0x804A448C, its start 0x801C3B7C by 0x804A45B4;
// player_sob.bin's frames). Read from main.dol (values marked traced were seen in Dolphin: measurements/adventure-world1.md
// "Room 4's Shadow Link"; his state at +0x248):
// - his params: (p >> 5) & 7 a kind the init gives per-kind flags for 1-3 (room 4's is 1, red: his shield's emblem);
//   p & 31 a skill level 0-8 whose flags (+0x524, 0x802157B8) pick his moves: room 4's is 0 (0x48: the swing; no
//   spin attacks, no jumps of his own, no swing at once from up close); (p >> 8) & 15 the RAIL actors he walks
//   (theirs: (q >> 8) & 0xFF, the point's index (q >> 16) & 0xFF, its flags q & 0xFF); (p >> 20) & 0xFF × 16 px a
//   reach (10 when 0);
// - his life is 1000, put back every tick while he can't be hurt (+0x244 → +0x108); a form is beaten once it's down by
//   the form's damage (+0x568, 0x8021D020: 12, 8 then 1 from the table at 0x8046A748; a sword hit takes 4), checked when
//   his invincibility after the hit runs out (0x801C2960); his form (+0x564) is set by 0x8021CDE4, which puts his life
//   back;
// - the Link whose sword lands is the one whose index is his color (+0x560; 4 the dark form: any Link), 0x801CAED4;
//   the color is a roulette's (state 44, 0x802153A8): a new color other than the shown one every 5 ticks for 100
//   ticks, then every 15 for 75, and it stays on the last (traced: green and purple after the red Link's hits);
// - enemyparam.csv: contact 2 (atcp), drop class 5 (a 100 or a 150 Force Gem, always).
// What he does (the states by their numbers; read, the values traced in Dolphin where marked):
// - his entrance (kinds 1-3; read from main.dol and traced from room 11's door, measurements/adventure-world1.md
//   "Shadow Link's entrance"): 0, unseen, until the Link in control comes within (p >> 20) & 0xFF × 16 px of him (80
//   in room 4) with the four on his screen; 1, the scene takes the game (0x801F68E0) the next tick: the Links stand
//   still where they are, not a step or a frame of theirs moves, until 14's start ends it (0x801F6884); 2 for a tick;
//   3, the dark portal at his spot (JPA 1043-1045), 235 ticks; 4, he jumps out of it (up 4.5 px/tick, 0.2 down a
//   tick, at most 4 down: 45 ticks); 5 for 15, then 9 for 60; 12, "Defeat Shadow Link!" (BMG 0x19C) on the message
//   window, until it's gone (191 ticks); 14, the Links free again, standing as in 15 for 5 + rand(26) ticks. In
//   states 3-12 the camera frames him alone (its special focus) under the letterbox bars (apps/game camera.ts);
// - 15, standing: 15-30 ticks (+0x250), then a Link within 70-100 px (+0x5A4) sends him walking his rail (17), or
//   after 300-600 ticks (+0x5A0, traced 312 and 579) he walks 1-12 of its points anyway (+0x55D);
// - 17, his rail: at the next point (jittered ±16 px each way, the exact point where that's a wall: 0x801C8C84) at
//   1 px/tick (+0.1 a tick up, −0.2 down: traced), his heading straight at it, or turning 0x500 a tick toward it
//   after a corner; within 10 px he takes the next point the way he goes (+0x359, looping on the last point's flags
//   & 3 = 1), one off his count; out of points and no Link within 120-200 px (+0x5A8) he stands (15); a Link within
//   60 px (and his chase's cool-down +0x598 out) he goes at (27); every 30 ticks a Link within 100 px about ahead
//   (±0.3 of a half-turn) turns him back along the rail (0x801C8B50);
// - 18-22, a jump between two points (a point with flag 0x10 ahead going forward, 0x08 going back: 0x800FD548; room 4's
//   (416, 64) ↔ (112, 80), traced): 90 ticks standing (2 with a Link within 32 px), 30 crouched, then a 60-tick
//   flight to the point (6 px/tick up, 0.2 down), 30 landing, 90 standing (traced: 90, 30, 60, 30, 90), and on;
// - 27, at a Link: 65-80 px (+0x5AC) away he gives up (15 three times in five, else 17); his heading re-aimed at
//   the Link ±45° every 20-40 ticks, 0xAAA at most a time (traced); a Link that can hurt him (his color, or any when
//   dark) within 50 px, in sight within 64, his swing's cool-down +0x597 out: at him (34); now and then (5 in 100 a
//   tick) back to his rail from within 32 px of a point he faces (+0x598 = 120);
// - 34, closing in: 5-20 ticks at him; within 20-40 px (+0x5B0, from its 2nd tick) he swings (35, or 36 two times
//   in five: a lunge); out of 64 px or the time out, he stands (15) or walks his rail (17, three in ten);
// - 35, his swing (traced): 16 ticks, his sword's box 8-24 px ahead, ±8 across, from its 3rd tick to its 8th and
//   from its 11th to its 16th; it hurts only a Link who can hurt him, by 2 (0x801CA274); then 39, 90 ticks standing
//   (traced), then at the Link again (34, seven times in ten, his swing's cool-down out) or 27 with a 60-tick one;
// - his shield (0x801CA564), in states 14, 15, 17, 27, 32 and 34-40: a box 7-9 px ahead of him (±8 across); the sword
//   of a Link who can hurt him meeting it, the Link ahead of him (the larger axis, 0x801D0020), clanks: no harm, the
//   Link pushed back (hit type 13 of 0: 1 px/tick, traced), he springs back (32) 3 px/tick away from the Link, × 0.78
//   a tick, 10 ticks (traced), then as after a swing. His sword meeting that Link's sword in a swing does the same;
// - a sword from a Link who can't hurt him on his body (states 14-22, 27-40, 46): he dodges (42), then jumps over
//   that Link (28: 2 px/tick toward him, 4.5 px/tick up, 0.2 down: 45 ticks; traced ~45), lands (31, 10-30 ticks)
//   and goes at him (27); down (46), that gets him up (the colored form again);
// - first he's dark (his shield's emblem red): 3 sword hits beat that form, from any Link (traced: +0x108 1000 → 996
//   → 992 → 988, each knocking him back 24 ticks), then he changes, not hurt (43 120 ticks, a jump (29, 30), the
//   roulette (44) and 45 74 ticks: ~454 in all, traced), in a Link's colors; then only the sword of that color lands;
// - the colored form: 2 hits of his color (the second's invincibility 48 ticks) and he's down (state 46) for 600
//   ticks: one more hit of his color then beats him (knocked back 24 ticks, he spins 160 ticks and is gone; the room's
//   ZNSW 2 ticks later); left down 600 ticks, or struck by another Link's sword while down, he's up again, and one hit
//   of his color puts him down again (all traced).
// The sim: those states and forms (hits counted, not his life), the Link he goes for the one in control (traced: the
// Links apart, only the red one in control counted for his ranges), his swing's box and the clanks as above.
// Assumed (TODO(measure)): the 36 lunge (as 35 with a 2 px/tick step forward over its first 8 ticks), how he joins
// his rail from elsewhere (the nearest point, or the one after it when he's past it: 0x801C844C isn't decoded), his
// looking about while he stands, the change's jump (in place) and its crouch (25 ticks), a Link's shield against his
// sword (none).
import { attackMeets, type SubBox, type SwordAttack } from "../attacks.ts";
import { hurtFighter, onGround, SLIDE_SCALE, stopActing, vulnerable } from "../combat.ts";
import { cos4096, isqrt, sin4096, TRIG_ONE, velocityAlong } from "../entities.ts";
import { angleTo } from "../hazards.ts";
import { moveAxis, SUBPX, type Facing } from "../player.ts";
import { isSolidAt, type World } from "../world.ts";
import { currentArea, nextRandom, type AdventureGame } from "./adventure.ts";
import type { Enemy, EnemyState } from "./enemies.ts";
import type { AdventureStage } from "./stage.ts";

export const SHADOW = {
  /** His box: a Link's body (±7). TODO(measure). */
  half: 7,
  /** His walk: 1 px/tick, reached by +0.1 px/tick a tick, stopping −0.2 a tick (traced; 1/256 px). */
  speed: SUBPX,
  accel: 26,
  decel: 51,
  /** Standing (15): 15 + rand(16) ticks, then a Link within 70 + rand(31) px; or after 300 + rand(301). */
  stand: 15,
  standRand: 16,
  wake: 70,
  wakeRand: 31,
  idle: 300,
  idleRand: 301,
  /** His rail (17): no Link within 120 + rand(81) px and no points left, he stands; a Link within 60 px, at him. */
  rest: 120,
  restRand: 81,
  notice: 60,
  /** A point reached within this (px); its target jittered by up to this each way (px). */
  arrive: 10,
  jitter: 16,
  /** After a corner his heading turns this much a tick (65536 a turn). */
  corner: 0x500,
  /** Every this many ticks a Link within `turnBack` px about ahead (this fraction of a half-turn) turns him back. */
  turnEvery: 30,
  turnBack: 100,
  turnCone: 0.3,
  /** The jump between two rail points (18-22): standing, crouched, the flight (ticks; 2 for the first two and the
   *  last two with a Link within `near` px), up at 6 px/tick, 0.2 px/tick² down. */
  jumpWait: 90,
  jumpCrouch: 30,
  flight: 60,
  landWait: 30,
  afterWait: 90,
  near: 32,
  flightUp: 6 * SUBPX,
  /** At a Link (27): this far (65 + rand(16) px) he gives up; within `close` px of a Link who can hurt him, in sight
   *  within `sight`, at him (34); his heading re-aimed every 20 + rand(21) ticks, by ±0x2000, 0xAAA at most. */
  chase: 65,
  chaseRand: 16,
  close: 50,
  sight: 64,
  aimEvery: 20,
  aimRand: 21,
  aimSpread: 0x2000,
  aimTurn: 0xaaa,
  /** Back to his rail from within this of a point (px), 5 ticks in 100; then no chase for `railCool` ticks; none for
   *  `railCheck` ticks after he left it. */
  railNear: 32,
  railCool: 120,
  railCheck: 30,
  /** Closing in (34): 5 + rand(16) ticks; swings within 20 + rand(21) px. */
  approach: 5,
  approachRand: 16,
  swingAt: 20,
  swingAtRand: 21,
  /** His swing (35): its length, his sword's box (px ahead, across) and the ticks it's out (traced). */
  swing: 16,
  swordNear: 8,
  swordFar: 24,
  swordAcross: 8,
  swordOut: [[2, 7], [10, 15]] as readonly (readonly [number, number])[],
  /** The lunge (36): a step forward this fast over its first ticks (assumed). */
  lunge: 2 * SUBPX,
  lungeTicks: 8,
  /** Standing after his swing (traced: 90 ticks); then at the Link again 7 times in 10, else a 60-tick cool-down. */
  pause: 90,
  swingCool: 60,
  /** His shield: a box this far ahead of him (px), ±8 across. */
  shieldNear: 7,
  shieldFar: 9,
  shieldAcross: 8,
  /** A clank: he springs back at 3 px/tick, × 0.78 a tick, 10 ticks; the Link pushed back 1 px/tick (traced). */
  spring: 3 * SUBPX,
  springDecay: 200, // /256 ≈ 0.78
  springTicks: 10,
  push: SUBPX,
  /** Jumping over a Link (28): 2 px/tick, 4.5 up; landing (31) 10 + rand(21) ticks. */
  hop: 2 * SUBPX,
  hopUp: 1152,
  land: 10,
  landRand: 21,
  /** Sword hits that beat a form (traced): the dark one (any Link's), the colored one, and him down. */
  hits: 3,
  colorHits: 2,
  downHits: 1,
  /** The change from the dark form (traced: ~454 ticks): standing, crouched, a 60-tick jump, the roulette, standing. */
  change: 454,
  changeStand: 120,
  changeCrouch: 25,
  changeJump: 60,
  roulette: 175,
  /** The roulette: a new color every 5 ticks for 100, then every 15. */
  rouletteFast: 5,
  rouletteFastFor: 100,
  rouletteSlow: 15,
  /** Invincible after the colored form's last hit (traced: 48; 24 after the others), then down this long (traced). */
  fallGrace: 48,
  down: 600,
  /** Ticks he spins once beaten, before he's gone (traced: 160). */
  spin: 160,
  /** The reach the existing tests know: his swing's box's far end (px). */
  reach: 24,
};

/** His entrance (states 0-14), read from main.dol and traced in Dolphin. */
export const SHADOW_INTRO = {
  /** His params' (p >> 20) & 0xFF × this px is how near the Link in control wakes him (10 × 16 when 0). */
  wakeUnit: 16,
  wakeDefault: 10,
  /** The dark portal (3): 235 ticks (160 when his group has a place to come out at: none in World 1). */
  portal: 235,
  /** His jump out of it (4), in 1/1280 px: up 4.5 px/tick, 0.2 px/tick less each tick, at most 4 down. */
  riseUp: 5760,
  riseFall: 256,
  riseMost: 5120,
  /** Landed (5), then posed (9). */
  landed: 15,
  pose: 60,
  /** 12: "Defeat Shadow Link!" (BMG 0x19C) on the message window from its start; it's free again this many ticks on
   *  (traced: 191, the window's slide in, stay and slide out). */
  message: 0x19c,
  window: 191,
  /** 14: standing 5 + rand(26) ticks, then as in 15. */
  ready: 5,
  readyRand: 26,
};

/** His states (+0x248) the sim plays. */
export const SHADOW_STATE = {
  wait: 0,
  wake: 1,
  taken: 2,
  portal: 3,
  rise: 4,
  landed: 5,
  pose: 9,
  challenge: 12,
  ready: 14,
  stand: 15,
  rail: 17,
  jumpWait: 18,
  jumpCrouch: 19,
  jumpFly: 20,
  jumpLand: 21,
  jumpAfter: 22,
  chase: 27,
  hop: 28,
  hopLand: 31,
  spring: 32,
  knock: 33,
  approach: 34,
  swing: 35,
  lunge: 36,
  pause: 39,
  beaten: 41,
  dodge: 42,
  change: 43,
  roulette: 44,
  down: 46,
} as const;

// His fields in the sim's enemy record: `shot` his state (+0x248), `tick` its ticks (+0x24C), `timer` its length
// (+0x250), `speed` (+0x254) easing to `tvx` (+0x258), `angle` his heading (+0x33C: 0 down, 0x4000 right, as the game
// has it), `leader` his rail point (+0x35B), `group` its way (+0x359: 0 on, 1 back), `frame` the points left
// (+0x55D), (`homeX`, `homeY`) where he heads on his rail (+0x32C), `shot2` four cool-downs a byte each (+0x597 his
// swing's, +0x598 the chase's, +0x599 the rail check's, and the re-aim count), `turn` the re-aim period and a
// corner flag, `tvy` his ranges a byte each (+0x5A4, +0x5A8, +0x5AC, +0x5B0), `frameTimer` his standing's time-out
// (+0x5A0), `grace` the change's roulette count, `hitBy` the Link he jumps over.

/** His form: 0 the dark one (any Link's sword), 1 the colored one (only the sword of his color), 2 him down (the same). */
export const shadowForm = (e: Enemy): number => e.flags;

/** His color in the colored form (0 green, 1 red, 2 blue, 3 purple); in the dark form his shield's emblem. */
export const shadowColor = (e: Enemy): number => (e.flags ? e.kind : (e.params >>> 5) & 3);

/** His state's number (+0x248: SHADOW_STATE). */
export const shadowState = (e: Enemy): number => e.shot;

/** Whether his entrance has him in states 0-13 (unseen, the scene, the challenge). */
export const shadowEntering = (e: Enemy): boolean => e.type === "SLK2" && e.shot >= SHADOW_STATE.wait && e.shot < SHADOW_STATE.ready;

/** Whether a Shadow Link's entrance holds the Links: from the scene's take (state 1's tick) to 14's start. */
export const shadowHolds = (game: AdventureGame): boolean =>
  game.adventure.enemies.some((e) => shadowEntering(e) && e.shot >= SHADOW_STATE.taken);

/** Whether he's on the camera's special focus and asks for the letterbox bars (states 3-12: 0x801C283C). */
export const shadowOnStage = (e: Enemy): boolean => shadowEntering(e) && e.shot >= SHADOW_STATE.portal && e.shot <= SHADOW_STATE.challenge;

/** Whether he hands the camera his point (and its boss mode, +0x178): from state 14 on, but 23 (0x801C283C). */
export const shadowFollowed = (e: Enemy): boolean => e.type === "SLK2" && e.shot >= SHADOW_STATE.ready && e.shot !== 23;

/** The message window's "Defeat Shadow Link!" asked for: the tick of the step that asked (GameState.tick after it). */
export function shadowChallenge(game: AdventureGame): { id: number; tick: number } | null {
  const e = game.adventure.enemies.find((x) => x.type === "SLK2" && x.shot === SHADOW_STATE.challenge);
  return e ? { id: SHADOW_INTRO.message, tick: game.tick - e.tick } : null;
}

/** Puts him at a state of his entrance and its ticks (a Dolphin place's: tools/dolphin sim.ts); false past it. */
export function enterShadowAt(e: Enemy, state: number, tick: number): boolean {
  if (state < SHADOW_STATE.wait || state >= SHADOW_STATE.ready) return false;
  setState(e, state);
  e.tick = tick;
  return true;
}

/** In the change: the color its roulette shows now (-1 before it starts: dark). */
export function shadowShownColor(e: Enemy): number {
  if (e.state === "change") return e.kind < 4 ? e.kind : -1;
  return shadowForm(e) ? e.kind : -1;
}

// A byte of a packed field.
const byte = (v: number, k: number) => (v >>> (8 * k)) & 0xff;
const withByte = (v: number, k: number, b: number) => ((v & ~(0xff << (8 * k))) | ((b & 0xff) << (8 * k))) >>> 0;
const COOL_SWING = 0, COOL_CHASE = 1, COOL_RAIL = 2, AIM_COUNT = 3;
const RANGE_WAKE = 0, RANGE_REST = 1, RANGE_CHASE = 2, RANGE_SWING = 3;
const cool = (e: Enemy, k: number) => byte(e.shot2, k);
const setCool = (e: Enemy, k: number, v: number) => (e.shot2 = withByte(e.shot2, k, v));
const range = (e: Enemy, k: number) => byte(e.tvy, k);
const setRange = (e: Enemy, k: number, v: number) => (e.tvy = withByte(e.tvy, k, v));
const CORNER = 0x100;

const random = (game: AdventureGame, n: number) => nextRandom(game.adventure) % n;
/** rand() < p, p a fraction. */
const chance = (game: AdventureGame, p: number) => random(game, 1000) < Math.round(p * 1000);

/** The game's heading (0 down, 0x4000 right) toward (dx, dy). */
const headingTo = (dx: number, dy: number) => (0x4000 - angleTo(0, 0, dx, dy)) & 0xffff;
const headingVelocity = (h: number, speed: number): [number, number] => [Math.trunc((speed * sin4096(h)) / TRIG_ONE), Math.trunc((speed * cos4096(h)) / TRIG_ONE)];
/** His facing from his heading (0x801F681C). */
function facingOf(h: number): Facing {
  const a = h & 0xffff;
  if (a >= 0x2000 && a < 0x6000) return "right";
  if (a >= 0x6000 && a < 0xa000) return "up";
  if (a >= 0xa000 && a < 0xe000) return "left";
  return "down";
}
const signed16 = (a: number) => ((a & 0xffff) << 16) >> 16;
/** `from` turned toward `to` by `step` at most (65536 a turn). */
const turnToward = (from: number, to: number, step: number) => {
  const d = signed16(to - from);
  return (from + Math.max(-step, Math.min(step, d))) & 0xffff;
};
/** Height (1/256 px) `t` ticks into a jump up at `vz` (1/256 px/tick), 0.2 px/tick² down (−0x3FE8(r2) = −0.2). */
const arc = (vz: number, t: number) => Math.trunc((vz * t * 5 - 128 * t * t) / 5);
const dist = (e: Enemy, x: number, y: number) => isqrt(Math.floor((x - e.x) / SUBPX) ** 2 + Math.floor((y - e.y) / SUBPX) ** 2);

export function initShadowLink(e: Enemy): void {
  e.life = SHADOW.hits;
  e.kind = (e.params >>> 5) & 3;
  e.flags = 0;
  e.speed = e.tvx = 0;
  e.angle = 0;
  e.shot2 = 0;
  e.tvy = 0;
  e.group = 0;
  e.leader = 0;
  e.hitBy = -1;
  // Kinds 1-3 make an entrance (the init's flags 0x4000, 0x2000 for 1 and 2: 0x801C5490); the others start standing
  // after a swing (assumed: none in World 1).
  const kind = (e.params >>> 5) & 7;
  if (kind >= 1 && kind <= 3) return setState(e, SHADOW_STATE.wait);
  setState(e, SHADOW_STATE.pause);
  e.timer = SHADOW.pause;
}

/** Whether Link `i`'s attack (or arrow) can hurt him: any Link's on the dark form, the colored one's of his color only. */
export function shadowMatches(game: AdventureGame, e: Enemy, i: number): boolean {
  return i >= 0 && (shadowForm(e) === 0 || (game.adventure.colors[i] ?? i) === shadowColor(e));
}

/** Whether a sword or a shot can hurt him now: states 14-22, 27-40 and 46 (0x801CA564), not while he changes. */
export const shadowHurtable = (e: Enemy): boolean => {
  const s = e.shot;
  return e.state !== "change" && ((s >= 14 && s <= 22) || (s >= 27 && s <= 40) || s === SHADOW_STATE.down || e.state === "knock" || e.state === "rest");
};

/** Whether his shield is up (states 14, 15, 17, 27, 32, 34-40). */
const shielding = (e: Enemy) => e.state !== "knock" && e.state !== "rest" && e.state !== "die" && e.state !== "change" && [14, 15, 17, 27, 32, 34, 35, 36, 37, 38, 39, 40].includes(e.shot);

/** A box (1/256 px) `near`-`far` px ahead of him along his facing, ±`across`. */
function aheadBox(e: Enemy, near: number, far: number, across: number): SubBox {
  const [n, f, a] = [near * SUBPX, far * SUBPX, across * SUBPX];
  switch (e.facing) {
    case "right":
      return { left: e.x + n, top: e.y - a, right: e.x + f, bottom: e.y + a };
    case "left":
      return { left: e.x - f, top: e.y - a, right: e.x - n, bottom: e.y + a };
    case "down":
      return { left: e.x - a, top: e.y + n, right: e.x + a, bottom: e.y + f };
    default:
      return { left: e.x - a, top: e.y - f, right: e.x + a, bottom: e.y - n };
  }
}

/** His shield's box (1/256 px). */
export const shadowShieldBox = (e: Enemy): SubBox => aheadBox(e, SHADOW.shieldNear, SHADOW.shieldFar, SHADOW.shieldAcross);
/** His sword's box while it's out in a swing (1/256 px), else null. */
export function shadowSwordBox(e: Enemy): SubBox | null {
  if ((e.shot !== SHADOW_STATE.swing && e.shot !== SHADOW_STATE.lunge) || e.state !== "turn") return null;
  if (!SHADOW.swordOut.some(([a, b]) => e.tick >= a && e.tick <= b)) return null;
  return aheadBox(e, SHADOW.swordNear, SHADOW.swordFar, SHADOW.swordAcross);
}

/** The side of him a point is on, by the larger axis (ties up or down: 0x801D0020). */
const sideOf = (e: Enemy, x: number, y: number): Facing => (Math.abs(x - e.x) > Math.abs(y - e.y) ? (x >= e.x ? "right" : "left") : y >= e.y ? "down" : "up");

/**
 * Link `i`'s sword `attack` meeting him (`body` his box) before it may hurt him: true when it does nothing more. A Link who can hurt him: his shield ahead of him (the Link ahead) or his sword in a swing clanks it
 * (he springs back, the Link's pushed back). A Link who can't: on his body, he dodges and jumps over that Link (down,
 * he's up again).
 */
export function shadowParries(game: AdventureGame, e: Enemy, i: number, attack: SwordAttack, body: SubBox): boolean {
  const p = game.players[i]!, f = game.battle.fighters[i]!;
  if (!shadowMatches(game, e, i)) {
    // (Not again while he's over him: one jump a swing, assumed.)
    if (!shadowHurtable(e) || e.invincible > 0 || e.shot === SHADOW_STATE.hop || !attackMeets(attack, body)) return true;
    if (e.state === "rest") {
      e.flags = 1;
      e.life = SHADOW.downHits;
    }
    startHop(e, p.x, p.y);
    return true;
  }
  const sword = shadowSwordBox(e);
  const clank = (shielding(e) && sideOf(e, p.x, p.y) === e.facing && attackMeets(attack, shadowShieldBox(e))) || (sword !== null && attackMeets(attack, sword));
  if (!clank) return false;
  // The Link pushed back (hit type 13 of 0), his sword recoiling; he springs back from him.
  f.endCharge = 0;
  stopActing(p);
  p.action = "tink";
  [f.slideX, f.slideY] = velocityAlong(p.x - e.x, p.y - e.y, SHADOW.push * SLIDE_SCALE);
  springBack(e, p.x, p.y);
  return true;
}

/** A sword he can't take: he dodges (42) and, on the ground (at once: traced), jumps over the Link at (x, y) (28). */
function startHop(e: Enemy, x: number, y: number): void {
  e.angle = headingTo(x - e.x, y - e.y);
  e.facing = facingOf(e.angle);
  setState(e, SHADOW_STATE.hop);
  e.vz = SHADOW.hopUp;
  e.speed = e.tvx = 0;
  [e.vx, e.vy] = headingVelocity(e.angle, SHADOW.hop);
}

function springBack(e: Enemy, x: number, y: number): void {
  let [vx, vy] = velocityAlong(e.x - x, e.y - y, SHADOW.spring);
  if (!vx && !vy) [vx, vy] = headingVelocity(e.angle + 0x8000, SHADOW.spring);
  setState(e, SHADOW_STATE.spring);
  [e.vx, e.vy] = [vx, vy];
  e.timer = SHADOW.springTicks;
}

/**
 * A form's last hit: the dark form's, he changes (true: no knockback), his color a roulette's; the colored form's,
 * he's knocked back and falls (down once his invincibility runs out). The last hit while down beats him (false, his
 * life 0: knocked back, then he spins SHADOW.spin ticks).
 */
export function shadowBeaten(game: AdventureGame, e: Enemy): boolean {
  if (e.life > 0) return false;
  if (shadowForm(e) === 0) {
    e.flags = 1;
    e.kind = 4;
    e.life = SHADOW.colorHits;
    e.vx = e.vy = 0;
    e.speed = e.tvx = 0;
    setState(e, SHADOW_STATE.change);
    void game;
    return true;
  }
  if (shadowForm(e) === 1) {
    e.flags = 2;
    e.life = SHADOW.downHits;
  }
  return false;
}

/** Struck from (x, y) (1/256 px): knocked back (33) he faces where it came from (his heading the knockback's + 0x8000:
 *  traced), as he still does when it's over. */
export function shadowStruck(e: Enemy, x: number, y: number): void {
  e.shot = SHADOW_STATE.knock;
  if (x !== e.x || y !== e.y) e.angle = headingTo(x - e.x, y - e.y);
  e.facing = facingOf(e.angle);
}

/** After his knockback (traced: at the Links again, 27, and closing in at once when one's near): down (the colored
 *  form's last hit) or at the Links. */
export const shadowAfterKnock = (e: Enemy): EnemyState => {
  if (shadowForm(e) === 2) {
    e.shot = SHADOW_STATE.down;
    return "rest";
  }
  e.shot = SHADOW_STATE.chase;
  startChase(e, null);
  return "chase";
};

/** The sim's state for each of his (enemies.ts's generic code reads it). */
function simState(s: number): EnemyState {
  switch (s) {
    case SHADOW_STATE.wait:
    case SHADOW_STATE.wake:
    case SHADOW_STATE.taken:
    case SHADOW_STATE.portal:
      return "hide";
    case SHADOW_STATE.rise:
      return "fly";
    case SHADOW_STATE.rail:
      return "patrol";
    case SHADOW_STATE.chase:
    case SHADOW_STATE.approach:
      return "chase";
    case SHADOW_STATE.swing:
    case SHADOW_STATE.lunge:
      return "turn";
    case SHADOW_STATE.spring:
      return "dive";
    case SHADOW_STATE.jumpFly:
    case SHADOW_STATE.hop:
      return "fly";
    case SHADOW_STATE.jumpLand:
    case SHADOW_STATE.hopLand:
    case SHADOW_STATE.dodge:
      return "look";
    case SHADOW_STATE.change:
    case SHADOW_STATE.roulette:
      return "change";
    case SHADOW_STATE.down:
      return "rest";
    default:
      return "stop";
  }
}

function setState(e: Enemy, s: number): void {
  e.shot = s;
  e.state = simState(s);
  e.tick = 0;
}

// --- the Link he goes for (the one in control) ---

interface Target {
  i: number;
  x: number;
  y: number;
  d: number;
}
function leaderTarget(game: AdventureGame, e: Enemy): Target | null {
  const p = game.players[0], f = game.battle.fighters[0];
  if (!p || !f || f.hearts <= 0 || f.mode === "dead" || f.mode === "dying") return null;
  return { i: 0, x: p.x, y: p.y, d: dist(e, p.x, p.y) };
}

// --- his rail ---

interface RailPoint {
  x: number;
  y: number;
  flags: number;
}
/** His rail's points in order (1/256 px), from the area's RAIL actors of his rail number. */
export function shadowRail(game: AdventureGame, stage: AdventureStage, e: Enemy): RailPoint[] {
  const id = (e.params >>> 8) & 15;
  return currentArea(game, stage)
    .actors.filter((a) => a.id === "RAIL" && ((a.params >>> 8) & 0xff) === id)
    .sort((a, b) => ((a.params >>> 16) & 0xff) - ((b.params >>> 16) & 0xff))
    .map((a) => ({ x: a.x * SUBPX, y: a.y * SUBPX, flags: a.params & 0xff }));
}
/** The point `n` steps on from `at` (0x800FD818): looping when the last point's flags & 3 is 1, else held at the ends. */
function railStep(rail: readonly RailPoint[], at: number, n: number): number {
  const count = rail.length, loop = (rail[count - 1]!.flags & 3) === 1;
  const k = at + n;
  if (k < 0) return loop ? count + k : 0;
  if (k >= count) return loop ? k - count : count - 1;
  return k;
}
/** Where he heads for point `at`: jittered ±16 px each way unless that's a wall (0x801C8C84). */
function railTarget(game: AdventureGame, world: World, e: Enemy, rail: readonly RailPoint[], at: number): void {
  const pt = rail[at]!;
  const jx = pt.x + (random(game, 2 * SHADOW.jitter + 1) - SHADOW.jitter) * SUBPX, jy = pt.y + (random(game, 2 * SHADOW.jitter + 1) - SHADOW.jitter) * SUBPX;
  [e.homeX, e.homeY] = isSolidAt(world, jx / SUBPX, jy / SUBPX) ? [pt.x, pt.y] : [jx, jy];
}
/** A jump point ahead (0x800FD548): the point he heads for has flag 0x10 going on, 0x08 going back. */
const jumpAhead = (rail: readonly RailPoint[], e: Enemy) => (rail[e.leader]!.flags & (e.group ? 0x08 : 0x10)) !== 0;

function startRail(game: AdventureGame, world: World, e: Enemy, rail: readonly RailPoint[]): void {
  setState(e, SHADOW_STATE.rail);
  e.tvx = SHADOW.speed;
  setRange(e, RANGE_REST, SHADOW.rest + random(game, SHADOW.restRand));
  e.turn &= ~CORNER;
  if (!rail.length) return;
  // The nearest point, or the one after it when he's past it (assumed: 0x801C844C).
  let best = 0, bestD = Infinity;
  rail.forEach((pt, k) => {
    const d = (pt.x - e.x) ** 2 + (pt.y - e.y) ** 2;
    if (d < bestD) [best, bestD] = [k, d];
  });
  const next = rail[railStep(rail, best, e.group ? -1 : 1)]!, at = rail[best]!;
  const past = (e.x - at.x) * (next.x - at.x) + (e.y - at.y) * (next.y - at.y) > 0;
  e.leader = past ? railStep(rail, best, e.group ? -1 : 1) : best;
  railTarget(game, world, e, rail, e.leader);
  e.angle = headingTo(e.homeX - e.x, e.homeY - e.y);
}

/** Standing (15), or 14 after his entrance (only its time differs: 0x801C4020). */
function startStand(game: AdventureGame, e: Enemy, state: number = SHADOW_STATE.stand): void {
  setState(e, state);
  e.tvx = 0;
  e.timer = state === SHADOW_STATE.ready ? SHADOW_INTRO.ready + random(game, SHADOW_INTRO.readyRand) : SHADOW.stand + random(game, SHADOW.standRand);
  setRange(e, RANGE_WAKE, SHADOW.wake + random(game, SHADOW.wakeRand));
  e.frameTimer = SHADOW.idle + random(game, SHADOW.idleRand);
}

function startChase(e: Enemy, game: AdventureGame | null, from = 0): void {
  setState(e, SHADOW_STATE.chase);
  e.tvx = SHADOW.speed;
  if (game) setRange(e, RANGE_CHASE, SHADOW.chase + random(game, SHADOW.chaseRand));
  else if (!range(e, RANGE_CHASE)) setRange(e, RANGE_CHASE, SHADOW.chase);
  setCool(e, AIM_COUNT, 0);
  e.turn = (e.turn & ~0xff) | 1;
  if (from === SHADOW_STATE.rail) setCool(e, COOL_RAIL, SHADOW.railCheck);
}

function startApproach(game: AdventureGame, e: Enemy): void {
  setState(e, SHADOW_STATE.approach);
  e.timer = SHADOW.approach + random(game, SHADOW.approachRand);
  e.tvx = SHADOW.speed;
  setRange(e, RANGE_SWING, SHADOW.swingAt + random(game, SHADOW.swingAtRand));
}

/** After a swing or a spring back: at the Link again (7 times in 10, the cool-down out, a Link in sight) or a chase. */
function afterSwing(game: AdventureGame, e: Enemy, t: Target | null): void {
  if (!cool(e, COOL_SWING) && t && t.d <= SHADOW.sight && chance(game, 0.7)) return startApproach(game, e);
  setCool(e, COOL_SWING, SHADOW.swingCool);
  startChase(e, game);
}

/** Gives up closing in: stands (7 times in 10) or walks his rail. */
function giveUp(game: AdventureGame, world: World, e: Enemy, rail: readonly RailPoint[]): void {
  if (chance(game, 0.7)) startStand(game, e);
  else startRail(game, world, e, rail);
}

/** Eases his speed toward `tvx` and walks along his heading (walls stop him). */
function walk(e: Enemy, world: World): void {
  if (e.speed < e.tvx) e.speed = Math.min(e.tvx, e.speed + SHADOW.accel);
  else if (e.speed > e.tvx) e.speed = Math.max(e.tvx, e.speed - SHADOW.decel);
  const [vx, vy] = headingVelocity(e.angle, e.speed);
  moveAxis(e, world, vx, "x");
  moveAxis(e, world, vy, "y");
}

/** A tick of his. */
export function stepShadowLink(game: AdventureGame, stage: AdventureStage, e: Enemy, world: World): void {
  // His cool-downs (0x801C3034).
  for (const k of [COOL_SWING, COOL_CHASE, COOL_RAIL]) if (cool(e, k)) setCool(e, k, cool(e, k) - 1);
  const rail = shadowRail(game, stage, e);
  const t = leaderTarget(game, e);
  e.facing = facingOf(e.angle);
  if (shadowEntering(e)) return stepEntrance(game, e, t);
  switch (e.shot) {
    case SHADOW_STATE.change:
      return stepChange(game, e);
    case SHADOW_STATE.down:
      // Down: the count starts once his invincibility runs out; up again after it, one hit from falling again.
      if (e.invincible > 0) e.tick = 0;
      if (e.tick < SHADOW.down) return;
      e.flags = 1;
      e.life = SHADOW.downHits;
      startChase(e, game);
      return;
    case SHADOW_STATE.ready:
    case SHADOW_STATE.stand:
      walk(e, world);
      if (e.tick >= e.timer && t && t.d <= range(e, RANGE_WAKE)) return startRail(game, world, e, rail);
      if (e.tick >= e.frameTimer) {
        e.frame = 1 + random(game, 12);
        startRail(game, world, e, rail);
      }
      return;
    case SHADOW_STATE.rail:
      return stepRail(game, world, e, rail, t);
    case SHADOW_STATE.jumpWait:
    case SHADOW_STATE.jumpCrouch:
    case SHADOW_STATE.jumpLand:
    case SHADOW_STATE.jumpAfter: {
      e.speed = 0;
      if (e.tick < e.timer) return;
      const after: Partial<Record<number, number>> = { [SHADOW_STATE.jumpWait]: SHADOW_STATE.jumpCrouch, [SHADOW_STATE.jumpCrouch]: SHADOW_STATE.jumpFly, [SHADOW_STATE.jumpLand]: SHADOW_STATE.jumpAfter };
      const next = after[e.shot];
      if (next === undefined) return startRail(game, world, e, rail);
      setState(e, next);
      if (next === SHADOW_STATE.jumpCrouch) e.timer = t && t.d <= SHADOW.near ? 2 : SHADOW.jumpCrouch;
      else if (next === SHADOW_STATE.jumpAfter) e.timer = t && t.d <= SHADOW.near ? 2 : SHADOW.afterWait;
      else {
        // The flight: to his target in 60 ticks, 6 px/tick up.
        e.vx = Math.trunc((e.homeX - e.x) / SHADOW.flight);
        e.vy = Math.trunc((e.homeY - e.y) / SHADOW.flight);
        e.vz = SHADOW.flightUp;
        e.angle = headingTo(e.vx, e.vy);
      }
      return;
    }
    case SHADOW_STATE.jumpFly:
    case SHADOW_STATE.hop:
      return stepFlight(game, world, e, t);
    case SHADOW_STATE.hopLand:
      if (e.tick >= e.timer) startChase(e, game);
      return;
    case SHADOW_STATE.chase:
      return stepChase(game, world, e, rail, t);
    case SHADOW_STATE.approach:
      return stepApproach(game, world, e, rail, t);
    case SHADOW_STATE.swing:
    case SHADOW_STATE.lunge:
      return stepSwing(game, world, e, t);
    case SHADOW_STATE.spring:
      moveAxis(e, world, (e.vx = Math.trunc((e.vx * SHADOW.springDecay) / 256)), "x");
      moveAxis(e, world, (e.vy = Math.trunc((e.vy * SHADOW.springDecay) / 256)), "y");
      if (e.tick < e.timer) return;
      e.vx = e.vy = 0;
      return afterSwing(game, e, t);
    default:
      // 39: standing after his swing.
      e.speed = 0;
      if (e.tick >= e.timer) afterSwing(game, e, t);
  }
}

/**
 * His entrance (0x801C30BC…, the group's coordinator 0x801C0DCC, which moves him on at the start of the next frame:
 * the sim moves him on the tick before, or sets the tick as its update would have it). The scene's take happens at
 * once (the Links on foot; a load carried isn't taken from them here, assumed).
 */
function stepEntrance(game: AdventureGame, e: Enemy, t: Target | null): void {
  const I = SHADOW_INTRO, S = SHADOW_STATE;
  switch (e.shot) {
    case S.wait: {
      // Kind 3 comes in with the others' scene (the coordinator's 0x801C27A8, assumed alone); 1 and 2 wake by the Link
      // in control within reach, the four on his screen (0x801CD228: none left in another area).
      if (((e.params >>> 5) & 7) === 3) {
        if (shadowHolds(game)) setState(e, S.taken);
        return;
      }
      const reach = (((e.params >>> 20) & 0xff) || I.wakeDefault) * I.wakeUnit * SUBPX;
      const p = game.players[0];
      if (t && p && !game.adventure.away && (p.x - e.x) ** 2 + (p.y - e.y) ** 2 < reach ** 2) setState(e, S.wake);
      return;
    }
    case S.wake:
      // The scene takes the game (the Links moved this tick already; from the next they stand).
      return setState(e, S.taken);
    case S.taken:
      return setState(e, S.portal);
    case S.portal:
      if (e.tick >= I.portal) setState(e, S.rise);
      return;
    case S.rise: {
      // Its height a tick on: the sum of the speeds so far (4.5 px/tick less 0.2 each tick, at most 4 down).
      const k = e.tick, unclamped = Math.min(k, Math.floor((I.riseUp + I.riseMost) / I.riseFall));
      const z5 = I.riseUp * unclamped - (I.riseFall * unclamped * (unclamped + 1)) / 2 - I.riseMost * (k - unclamped);
      e.z = Math.max(0, Math.trunc(z5 / 5));
      if (k > 1 && z5 <= 0) setState(e, S.landed);
      return;
    }
    case S.landed:
      // Ready at its end (+0x230 0x8000); the coordinator poses him on the next frame.
      if (e.tick <= I.landed) return;
      setState(e, S.pose);
      e.tick = 1;
      return;
    case S.pose:
      if (e.tick >= I.pose) setState(e, S.challenge);
      return;
    default:
      // 12: until the message window is free again; then 14 (the coordinator's, on the next frame: its tick 1).
      if (e.tick <= I.window) return;
      startStand(game, e, S.ready);
      e.tick = 1;
  }
}

function stepRail(game: AdventureGame, world: World, e: Enemy, rail: readonly RailPoint[], t: Target | null): void {
  if (!e.frame && (!t || t.d > range(e, RANGE_REST))) return startStand(game, e);
  if (!cool(e, COOL_CHASE) && t && t.d <= SHADOW.notice) return startChase(e, game, SHADOW_STATE.rail);
  if (!rail.length) return startStand(game, e);
  // Every 30 ticks a Link about ahead turns him back (0x801C8B50).
  if (e.tick % SHADOW.turnEvery === 0 && t && t.d <= SHADOW.turnBack && Math.abs(signed16(e.angle - headingTo(t.x - e.x, t.y - e.y))) <= SHADOW.turnCone * 0x8000) {
    e.group ^= 1;
    e.leader = railStep(rail, e.leader, e.group ? -1 : 1);
    railTarget(game, world, e, rail, e.leader);
    e.angle = headingTo(e.homeX - e.x, e.homeY - e.y);
    e.turn &= ~CORNER;
  }
  const to = headingTo(e.homeX - e.x, e.homeY - e.y);
  e.angle = e.turn & CORNER ? turnToward(e.angle, to, SHADOW.corner) : to;
  e.facing = facingOf(e.angle);
  walk(e, world);
  if (dist(e, e.homeX, e.homeY) > SHADOW.arrive) return;
  // A point: one off his count, the next one his way; a jump to it, or on.
  if (e.frame) e.frame--;
  e.leader = railStep(rail, e.leader, e.group ? -1 : 1);
  railTarget(game, world, e, rail, e.leader);
  e.turn |= CORNER;
  if (jumpAhead(rail, e)) {
    setState(e, SHADOW_STATE.jumpWait);
    e.speed = e.tvx = 0;
    e.timer = t && t.d <= SHADOW.near ? 2 : SHADOW.jumpWait;
    e.angle = headingTo(e.homeX - e.x, e.homeY - e.y);
  }
}

function stepFlight(game: AdventureGame, world: World, e: Enemy, t: Target | null): void {
  // (Over a Link, walls stop him: traced; between rail points, nothing does: assumed.)
  if (e.shot === SHADOW_STATE.hop) {
    moveAxis(e, world, e.vx, "x");
    moveAxis(e, world, e.vy, "y");
  } else {
    e.x += e.vx;
    e.y += e.vy;
  }
  e.z = Math.max(0, arc(e.vz, e.tick));
  if (e.z > 0 || e.tick < 1) return;
  e.z = e.vz = 0;
  e.vx = e.vy = 0;
  if (e.shot === SHADOW_STATE.jumpFly) {
    setState(e, SHADOW_STATE.jumpLand);
    e.timer = t && t.d <= SHADOW.near ? 2 : SHADOW.landWait;
  } else {
    setState(e, SHADOW_STATE.hopLand);
    e.timer = SHADOW.land + random(game, SHADOW.landRand);
  }
}

function stepChase(game: AdventureGame, world: World, e: Enemy, rail: readonly RailPoint[], t: Target | null): void {
  if (!t || t.d > range(e, RANGE_CHASE)) {
    if (chance(game, 0.6)) return startStand(game, e);
    return startRail(game, world, e, rail);
  }
  const f = game.battle.fighters[t.i]!;
  if (!cool(e, COOL_SWING) && shadowMatches(game, e, t.i) && t.d <= SHADOW.close && t.d <= SHADOW.sight && vulnerable(f)) return startApproach(game, e);
  // Now and then back to his rail, from near a point he faces.
  if (!cool(e, COOL_RAIL) && rail.length) {
    const near = rail.findIndex((pt) => dist(e, pt.x, pt.y) <= SHADOW.railNear);
    if (near >= 0 && Math.abs(signed16(e.angle - headingTo(rail[near]!.x - e.x, rail[near]!.y - e.y))) <= SHADOW.turnCone * 0x8000 && chance(game, 0.05)) {
      setCool(e, COOL_CHASE, SHADOW.railCool);
      return startRail(game, world, e, rail);
    }
  }
  // Re-aimed at the Link every 20-40 ticks (±45°, 0xAAA at most).
  const n = cool(e, AIM_COUNT) + 1;
  setCool(e, AIM_COUNT, n);
  if (n >= (e.turn & 0xff)) {
    setCool(e, AIM_COUNT, 0);
    e.turn = (e.turn & ~0xff) | (SHADOW.aimEvery + random(game, SHADOW.aimRand));
    const aim = headingTo(t.x - e.x, t.y - e.y) + random(game, 2 * SHADOW.aimSpread + 1) - SHADOW.aimSpread;
    e.angle = turnToward(e.angle, aim & 0xffff, SHADOW.aimTurn);
  }
  e.facing = facingOf(e.angle);
  walk(e, world);
}

function stepApproach(game: AdventureGame, world: World, e: Enemy, rail: readonly RailPoint[], t: Target | null): void {
  if (!t || !shadowMatches(game, e, t.i) || e.tick >= e.timer) return giveUp(game, world, e, rail);
  if (e.tick > 1 && t.d <= range(e, RANGE_SWING)) {
    setState(e, chance(game, 0.6) ? SHADOW_STATE.swing : SHADOW_STATE.lunge);
    e.speed = e.tvx = 0;
    e.angle = headingTo(t.x - e.x, t.y - e.y);
    e.facing = facingOf(e.angle);
    e.hitBy = -1;
    return;
  }
  if (t.d > SHADOW.sight) return giveUp(game, world, e, rail);
  e.angle = headingTo(t.x - e.x, t.y - e.y);
  e.facing = facingOf(e.angle);
  walk(e, world);
}

/** His swing: his sword's box hurts the Link who can hurt him (once a swing), a lunge steps forward first. */
function stepSwing(game: AdventureGame, world: World, e: Enemy, t: Target | null): void {
  if (e.shot === SHADOW_STATE.lunge && e.tick <= SHADOW.lungeTicks) {
    const [vx, vy] = headingVelocity(e.angle, SHADOW.lunge);
    moveAxis(e, world, vx, "x");
    moveAxis(e, world, vy, "y");
  }
  const box = shadowSwordBox(e);
  if (box && e.hitBy < 0) {
    game.players.forEach((p, i) => {
      const f = game.battle.fighters[i]!, h = 7 * SUBPX;
      if (e.hitBy >= 0 || !shadowMatches(game, e, i) || !vulnerable(f) || !onGround(f)) return;
      if (p.x + h < box.left || p.x - h > box.right || p.y + h < box.top || p.y - h > box.bottom) return;
      const hit = hurtFighter(p, f, i, e.atcp, e.x, e.y, { cause: "enemy" });
      if (hit) game.battle.hits.push(hit);
      e.hitBy = i;
    });
  }
  if (e.tick < SHADOW.swing - 1) return;
  setState(e, SHADOW_STATE.pause);
  e.timer = SHADOW.pause;
  void t;
}

/** The change from the dark form: standing, a crouch, a jump in place, the roulette of colors, standing. */
function stepChange(game: AdventureGame, e: Enemy): void {
  const jumpAt = SHADOW.changeStand + SHADOW.changeCrouch, rouletteAt = jumpAt + SHADOW.changeJump;
  e.z = e.tick > jumpAt && e.tick < rouletteAt ? Math.max(0, arc(SHADOW.flightUp, e.tick - jumpAt)) : 0;
  const r = e.tick - rouletteAt;
  if (r >= 0 && r < SHADOW.roulette) {
    // A new color, not the one shown, every 5 ticks for 100, then every 15 (0x802153A8, 0x801CD580).
    if (r === 0 || (r <= SHADOW.rouletteFastFor ? r % SHADOW.rouletteFast === 0 : (r - SHADOW.rouletteFastFor) % SHADOW.rouletteSlow === 0)) {
      const shown = e.kind & 3;
      e.kind = r === 0 && e.kind === 4 ? random(game, 4) : (shown + 1 + random(game, 3)) & 3;
    }
  }
  if (e.tick >= SHADOW.change) startChase(e, game);
}
