// The minor Shadow Link with a hammer (ZSLH: Lake Hylia's room 4, Hyrule Castle's room 9). His actor (init 0x80222124,
// his own states 0-8 at +0x248 by the table 0x804A6B4C, their ticks at +0x24C; player_sob.bin's frame at +0x280; the
// update 0x801CDD58 is SLK2's). Read from main.dol, the values traced in Dolphin (`ref/adv/room4.sav`, actor-trace.ts:
// docs/measurements/adventure-lake-hylia.md "The minor Shadow Link with a hammer"):
// - his params: (p >> 8) & 3 what sets him off (0x802216E8): 0 his count reaching 60, 1 a Link within 96 px, 2 within
//   192, 3 his count reaching (p >> 12) & 0xFF; (p >> 4) & 3 the way he leaves (0 right, 1 left, 2 down, 3 up). Both
//   placed ones are kind 0 (Lake Hylia's 0x30, leaving up; Hyrule Castle's 0x10, leaving left);
// - 4, waiting (traced): he hops in place facing down, 2.5 px/tick up, 0.1 px/tick² down, 24 ticks a hop; set off,
//   he lands, then 5: raising the hammer (frames 307, 306, then 305; 32 ticks), 6: holding it up (379, 30 ticks; a
//   glint, JPA 203 and 204 at 22 px over him), 7: the blow (380, 381, then 384/385 shaking, then 386; 29 ticks): on its
//   3rd tick the hammer hits the ground 12 px ahead of him (JPA 571-575, 975 or 976 by the ground) and a shock wave
//   spreads from there, 8 px a tick for 20 ticks (0x800F802C): it stuns the Link in control it reaches on the ground
//   (hit type 11: a slingshot seed's, no harm: traced, a Link 4 px from it dizzy 90 ticks, the followers 125 px away
//   left alone), once a wave;
// - three blows, standing 120 ticks (state 3) between them; then 8, standing 60 ticks; then 1, spinning (his facing
//   turned every 4 ticks: down, right, up, left), in dark smoke (JPA 1046 and 1047 at his feet on its 70th tick),
//   115 ticks, the room's count of him done (0x801F3604); then 2: gone from the TV (drawn by another draw), 45 ticks
//   still, then he walks off toward 48 px past the room's side his params name, his speed up 0.1 px/tick a tick to
//   1 px/tick, and he's gone for good there (traced: room 4's, 192 px up in 242 ticks, gone on frame 981 of the
//   trace, about 16 s after the Links came in);
// - he and his count stand still while the Links walk into the room: his count's first tick came 31 ticks after the
//   room change began (traced), so in Lake Hylia he raises his hammer 103 ticks after it.
// He drops nothing and isn't an enemy to beat. Not simulated (TODO(measure)): a sword or anything else on him (passed
// through here), his body against the Links (none here), kinds 1-3 (Links near: unused in World 1), the camera
// widening once he's gone (Dolphin frames), his sounds (0x400C4, 0x400E6, 0x4004A).
import { onGround, stunFighter, vulnerable } from "../combat.ts";
import { isqrt } from "../entities.ts";
import { SUBPX, type Facing } from "../player.ts";
import { ROOM_H, ROOM_W } from "../world.ts";
import { actorKey, type AdventureGame } from "./adventure.ts";
import type { Enemy } from "./enemies.ts";

export const MINOR_SHADOW = {
  /** Ticks his count waits once he's there (the Links walking into the room: traced 31 from the change's start, the
   *  sim's enemies wait out the walk themselves). */
  wait: 4,
  /** Kind 0 sets him off once his count reaches this. */
  trigger: 60,
  /** A hop: 2.5 px/tick up, 0.1 px/tick² down: back down in 24 ticks. */
  hopTicks: 24,
  /** The raise (5), the hammer held up (6), the blow (7), ticks (traced). */
  raise: 32,
  hold: 30,
  blow: 29,
  /** The blow's tick that hits the ground, how far ahead (px). */
  hit: 3,
  ahead: 12,
  /** The shock wave: its radius grows this much a tick (px), for this many ticks. */
  waveStep: 8,
  waveTicks: 20,
  /** Blows, the standing between them (3), after the last (8). */
  blows: 3,
  rest: 120,
  after: 60,
  /** The spin (1): its length, a turn every this many ticks, the smoke's tick. */
  spin: 115,
  turnEvery: 4,
  smoke: 70,
  /** Off the TV (2): ticks before he walks, his walk's speed and its rise a tick (1/256 px), how far past the side. */
  still: 45,
  speed: SUBPX,
  accel: 26,
  past: 48,
};

/** His states (+0x248). */
export const MINOR_SHADOW_STATE = { spin: 1, away: 2, rest: 3, wait: 4, raise: 5, hold: 6, blow: 7, after: 8 } as const;

/** His frames (player_sob): standing 60 + facing (right, left, down, up), the raise's, held up, the blow's by tick. */
const STAND_FRAMES: Readonly<Record<Facing, number>> = { right: 60, left: 61, down: 62, up: 63 };
const RAISE_FRAMES = [307, 306, 305];
const HOLD_FRAME = 379;
const BLOW_FRAMES = [380, 381, 384, 385, 384, 385, 384, 385, 384, 384, 385, 385, 384, 384, 385, 385, 385, 385, 385, 386];
const SPIN: readonly Facing[] = ["down", "right", "up", "left"];
const LEAVE: readonly Facing[] = ["right", "left", "down", "up"];
const STEP: Readonly<Record<Facing, readonly [number, number]>> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };

// His fields in the sim's enemy record: `shot` his state (+0x248), `tick` its ticks (+0x24C), `timer` the wait before
// his count starts, `frame` the blows so far (+0x2B8), `speed` his walk's (+0x254), (`homeX`, `homeY`) where he walks
// off to (+0x2B0), `flags` the Links his wave reached (one bit each), `kind` what sets him off.

/** His state's number (+0x248). */
export const minorShadowState = (e: Enemy): number => e.shot;

export function initMinorShadow(e: Enemy): void {
  e.kind = (e.params >>> 8) & 3;
  e.facing = "down";
  e.life = 1;
  e.atcp = 0;
  e.state = "stop";
  e.shot = MINOR_SHADOW_STATE.wait;
  e.timer = MINOR_SHADOW.wait;
  e.frame = 0;
  e.flags = 0;
}

function setState(e: Enemy, state: number): void {
  e.shot = state;
  e.tick = 0;
}

/** Height (1/256 px) `t` ticks into a hop: 2.5 px/tick up, less 0.1 each tick (traced: 2.3, 4.4, 6.3 … 14.4 … 0). */
const hopHeight = (t: number) => Math.trunc((3200 * t - 128 * t * (t + 1)) / 5);

/** Whether he's been set off (0x802216E8): kind 0 at his count's 60th tick; the Links near or another count for the others. */
function setOff(game: AdventureGame, e: Enemy): boolean {
  switch (e.kind) {
    case 0:
      return e.tick >= MINOR_SHADOW.trigger;
    case 3:
      return e.tick >= ((e.params >>> 12) & 0xff);
    default: {
      const reach = e.kind === 1 ? 96 : 192;
      return game.players.some((p) => isqrt(Math.floor((p.x - e.x) / SUBPX) ** 2 + Math.floor((p.y - e.y) / SUBPX) ** 2) < reach);
    }
  }
}

export function stepMinorShadow(game: AdventureGame, e: Enemy): void {
  const M = MINOR_SHADOW, S = MINOR_SHADOW_STATE;
  if (e.timer > 0) {
    // Still, his count too, while the Links come in.
    e.timer--;
    e.tick--;
    return;
  }
  switch (e.shot) {
    case S.wait: {
      // A hop every 24 ticks, from his count's first; set off, he goes on once he's down.
      const t = (e.tick - 1) % M.hopTicks;
      e.z = hopHeight(t);
      if (t === 0 && setOff(game, e)) setState(e, S.raise);
      break;
    }
    case S.raise:
      if (e.tick >= M.raise) setState(e, S.hold);
      break;
    case S.hold:
      if (e.tick >= M.hold) setState(e, S.blow);
      break;
    case S.blow:
      if (e.tick === M.hit) e.flags = 0;
      if (e.tick > M.hit && e.tick <= M.hit + M.waveTicks) shockWave(game, e, (e.tick - M.hit) * M.waveStep);
      if (e.tick >= M.blow) {
        e.frame++;
        setState(e, e.frame >= M.blows ? S.after : S.rest);
      }
      break;
    case S.rest:
      if (e.tick >= M.rest) setState(e, S.raise);
      break;
    case S.after:
      if (e.tick >= M.after) setState(e, S.spin);
      break;
    case S.spin:
      if (e.tick % M.turnEvery === 0) e.facing = SPIN[(SPIN.indexOf(e.facing) + 1) % 4]!;
      if (e.tick >= M.spin) {
        // Done for the room: he doesn't come back (0x801F3604 counts him).
        const a = game.adventure;
        if (e.actor >= 0 && !a.taken.includes(actorKey(a.room, e.actor))) a.taken.push(actorKey(a.room, e.actor));
        const leave = LEAVE[(e.params >>> 4) & 3]!, [dx, dy] = STEP[leave];
        e.facing = leave;
        e.state = "hide";
        e.homeX = dx > 0 ? (ROOM_W + M.past) * SUBPX : dx < 0 ? -M.past * SUBPX : e.x;
        e.homeY = dy > 0 ? (ROOM_H + M.past) * SUBPX : dy < 0 ? -M.past * SUBPX : e.y;
        e.speed = 0;
        setState(e, S.away);
      }
      break;
    case S.away: {
      if (e.tick <= M.still) break;
      e.speed = Math.min(M.speed, e.speed + M.accel);
      const [dx, dy] = STEP[e.facing];
      const left = Math.abs(e.homeX - e.x) + Math.abs(e.homeY - e.y);
      if (left <= e.speed) {
        e.life = -1; // gone
        break;
      }
      e.x += dx * e.speed;
      e.y += dy * e.speed;
      break;
    }
  }
}

// The wave reaches the Link in control (the followers it left alone: traced) within `radius` px of where the hammer
// hit, on the ground, once.
function shockWave(game: AdventureGame, e: Enemy, radius: number): void {
  const [dx, dy] = STEP[e.facing];
  const cx = e.x + dx * MINOR_SHADOW.ahead * SUBPX, cy = e.y + dy * MINOR_SHADOW.ahead * SUBPX;
  const p = game.players[0], f = game.battle.fighters[0];
  if (!p || !f || e.flags & 1 || !vulnerable(f) || !onGround(f)) return;
  if (isqrt(Math.floor((p.x - cx) / SUBPX) ** 2 + Math.floor((p.y - cy) / SUBPX) ** 2) >= radius) return;
  e.flags |= 1;
  stunFighter(p, f);
}

/** His frame (player_sob.bin) now, or -1 when he isn't on the TV. */
export function minorShadowFrame(e: Enemy): number {
  const S = MINOR_SHADOW_STATE;
  switch (e.shot) {
    case S.raise:
      return RAISE_FRAMES[Math.min(e.tick, RAISE_FRAMES.length - 1)]!;
    case S.hold:
      return HOLD_FRAME;
    case S.blow:
      return BLOW_FRAMES[Math.min(e.tick, BLOW_FRAMES.length - 1)]!;
    case S.away:
      return -1;
    default:
      return STAND_FRAMES[e.facing];
  }
}

/** The effects he makes now (JPA ids at area px, z px), with the tick each started: the glint, the blow, the smoke. */
export function minorShadowEffects(game: AdventureGame, e: Enemy): { id: number; x: number; y: number; z: number; scale: number; start: number }[] {
  const S = MINOR_SHADOW_STATE, M = MINOR_SHADOW;
  const x = e.x / SUBPX, y = e.y / SUBPX, at = (t: number) => game.tick - e.tick + t;
  switch (e.shot) {
    case S.hold:
      return [203, 204].map((id) => ({ id, x, y: y - 22, z: e.z / SUBPX, scale: 1, start: at(0) }));
    case S.blow: {
      if (e.tick < M.hit) return [];
      const [dx, dy] = STEP[e.facing];
      const hx = x + dx * M.ahead, hy = y + dy * M.ahead;
      return ([[571, 1], [572, 1], [573, 5], [574, 2], [575, 2], [975, 2]] as const).map(([id, scale]) => ({ id, x: hx, y: hy, z: 0, scale, start: at(M.hit) }));
    }
    case S.spin:
      return e.tick < M.smoke ? [] : [1046, 1047].map((id) => ({ id, x, y, z: 0, scale: 1, start: at(M.smoke) }));
    case S.away:
      // (The smoke plays out while he stands still off the TV.)
      return e.tick <= M.still ? [1046, 1047].map((id) => ({ id, x, y, z: 0, scale: 1, start: game.tick - e.tick - (M.spin - M.smoke) })) : [];
    default:
      return [];
  }
}
