// The minor Shadow Links: the one with a hammer here, the one who jumps (ZSLJ) further down.
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
import { isSolidAt, ROOM_H, ROOM_W, type World } from "../world.ts";
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
      stepSpin(game, e);
      break;
    case S.away:
      stepAway(e);
      break;
  }
}

// The two minor Shadow Links' shared states (their actors' common code: 0x8022149c sets them, 0x80221334 and
// 0x802212ac run them): 1 spinning in the dark smoke, then 2, off the TV, walking off past the room's side.
function stepSpin(game: AdventureGame, e: Enemy): void {
  const M = MINOR_SHADOW;
  if (e.tick % M.turnEvery === 0) e.facing = SPIN[(SPIN.indexOf(e.facing) + 1) % 4]!;
  if (e.tick < M.spin) return;
  // Done for the room: he doesn't come back (0x801F3604 counts him).
  const a = game.adventure;
  if (e.actor >= 0 && !a.taken.includes(actorKey(a.room, e.actor))) a.taken.push(actorKey(a.room, e.actor));
  const leave = LEAVE[(e.params >>> 4) & 3]!, [dx, dy] = STEP[leave];
  e.facing = leave;
  e.state = "hide";
  e.homeX = dx > 0 ? (ROOM_W + M.past) * SUBPX : dx < 0 ? -M.past * SUBPX : e.x;
  e.homeY = dy > 0 ? (ROOM_H + M.past) * SUBPX : dy < 0 ? -M.past * SUBPX : e.y;
  e.speed = 0;
  setState(e, MINOR_SHADOW_STATE.away);
}

function stepAway(e: Enemy): void {
  const M = MINOR_SHADOW;
  if (e.tick <= M.still) return;
  e.speed = Math.min(M.speed, e.speed + M.accel);
  const [dx, dy] = STEP[e.facing];
  const left = Math.abs(e.homeX - e.x) + Math.abs(e.homeY - e.y);
  if (left <= e.speed) {
    e.life = -1; // gone
    return;
  }
  e.x += dx * e.speed;
  e.y += dy * e.speed;
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

/** His frame (player_sob.bin) now, or -1 when he isn't on the TV (the jumping one's: jumpingShadowFrame). */
export function minorShadowFrame(e: Enemy): number {
  if (e.type === "ZSLJ") return jumpingShadowFrame(e);
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
  // (The jumping one has no hammer: only the smoke, his states 1 and 2 being ZSLH's.)
  if (e.type === "ZSLJ" && e.shot !== S.spin && e.shot !== S.away) return [];
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

// The jumping minor Shadow Link (ZSLJ: Lake Hylia's room 3, in the house's doorway; the Cave's and Hyrule Castle's are
// left unsimulated, formats fsa/unsimulated.ts). His actor (init 0x80220BD0 over the shared 0x802217C8, his own states
// 3-6 by the table 0x804A6974, 0-2 the shared ones; the update 0x801CDD58 is SLK2's; his draw 0x80220F54 is ZSLH's).
// Read from main.dol, the values traced in Dolphin (room 3 from `ref/save-adv-lake-room3.sav`, actor-trace.ts, frame
// dumps: docs/measurements/adventure-lake-hylia.md "The minor Shadow Link who jumps"):
// - 3, hopping in place facing down (ZSLH's hop), player_sob 62; a Link within 48 px of him (0x801D05F8: any of the
//   four) sets him off (+0x230 bit 0x4000), and on his next landing he jumps;
// - 4, the jump (sound 0x400C7): 4.5 px/tick up, 0.2 less each tick (44 ticks in the air, 48.4 px up at the top),
//   128/45 px a tick along params & 3 (0 right, 1 left, 2 down, 3 up; the other way after an odd number of jumps):
//   125.16 px aside (traced, room 3: x 400, 274.84, 400, 274.84), still frame 62 facing down;
// - 5, standing 12 ticks once down (6 if [0x8053AAF8]+0x7E is set: not seen), the jumps counted (+0x2BC); after 3
//   (+0x2C0: 3 + a random number below 1), 1 the spin and 2 away as ZSLH's (params (p >> 4) & 3 the side he leaves
//   by: room 3's 0x11 left, traced: gone 48 px past the left edge 488 ticks after the spin began); else 3 again,
//   hopping where he landed until a Link comes near again.
// The door's opening does nothing to him (no door in his code): the Link who brings the key is within 48 px of him
// before he reaches the door (traced: set off by the Link at (396, 167.5), he jumped 15 ticks later, the key went 15
// after that, the Link went in while he was in the air). Placed at (400, 112), he stands at (400, 120) from the first
// frame: out of the house's wall by his ±8 px box (assumed: pushed down, the way out there). Not simulated
// (TODO(measure)): a sword on him (state 0: 160 ticks turning every 8, then a puff 0x801CB434: never seen), his body
// against the Links, walls in his jump (none in room 3's), state 6 (a 120-tick leap: nothing sets it), his sounds.

export const JUMPING_SHADOW = {
  /** A Link this near (px) sets him off. */
  reach: 48,
  /** The jump: its ticks (4.5 px/tick up less 0.2 a tick: z = 0.1 t (44 - t) px), its run (128/45 px a tick). */
  jumpTicks: 44,
  run: { num: 128 * SUBPX, den: 45 },
  /** Standing once down (state 5); the jumps before he goes. */
  land: 12,
  jumps: 3,
  /** His box's half size (px): what pushes him out of a wall where he's placed. */
  half: 8,
};

/** His states (+0x248); 1 and 2 are ZSLH's (MINOR_SHADOW_STATE.spin, .away). */
export const JUMPING_SHADOW_STATE = { spin: 1, away: 2, hop: 3, jump: 4, land: 5 } as const;

const ALONG: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// His fields in the sim's enemy record: `shot` his state (+0x248), `tick` its ticks (+0x24C), `timer` the wait before
// his count starts, `kind` the way he jumps (params & 3, +0x2B8), `frame` the jumps so far (+0x2BC), (`homeX`,
// `homeY`) where the jump began, `flags` 1 set off (+0x230 bit 0x4000), 2 out of the wall where he's placed.

export function initJumpingShadow(e: Enemy): void {
  e.kind = e.params & 3;
  e.facing = "down";
  e.life = 1;
  e.atcp = 0;
  e.state = "stop";
  e.shot = JUMPING_SHADOW_STATE.hop;
  e.timer = MINOR_SHADOW.wait; // (ZSLH's, assumed: his count at the room change isn't traced)
  e.frame = 0;
  e.flags = 0;
}

/** Height (1/256 px) `t` ticks into his jump: 0.1 t (44 - t) px. */
const jumpHeight = (t: number) => Math.trunc((128 * t * (JUMPING_SHADOW.jumpTicks - t)) / 5);

/** Whether a Link is within `reach` px of him (0x801D05F8: any of the four). */
function linkNear(game: AdventureGame, e: Enemy): boolean {
  const r = JUMPING_SHADOW.reach * SUBPX;
  return game.players.some((p) => (p.x - e.x) ** 2 + (p.y - e.y) ** 2 < r * r);
}

export function stepJumpingShadow(game: AdventureGame, e: Enemy, world: World): void {
  const J = JUMPING_SHADOW, S = JUMPING_SHADOW_STATE;
  if (!(e.flags & 2)) {
    // Out of the wall his box's top is in, down (room 3: the doorway's sides, from y 112 to 120).
    e.flags |= 2;
    const x = Math.floor(e.x / SUBPX), h = J.half, inWall = () => [x - h, x, x + h - 1].some((cx) => isSolidAt(world, cx, Math.floor(e.y / SUBPX) - h));
    for (let n = 0; n < 2 * h && inWall(); n++) e.y += SUBPX;
  }
  if (e.timer > 0) {
    // Still, his count too, while the Links come in (as ZSLH).
    e.timer--;
    e.tick--;
    return;
  }
  switch (e.shot) {
    case S.hop: {
      const t = (e.tick - 1) % MINOR_SHADOW.hopTicks;
      e.z = hopHeight(t);
      if (linkNear(game, e)) e.flags |= 1;
      if (t === 0 && e.flags & 1) {
        e.flags &= ~1;
        e.homeX = e.x;
        e.homeY = e.y;
        setState(e, S.jump);
      }
      break;
    }
    case S.jump: {
      const t = Math.min(e.tick, J.jumpTicks), [dx, dy] = ALONG[e.kind]!;
      const run = Math.trunc((t * J.run.num) / J.run.den) * (e.frame & 1 ? -1 : 1);
      e.x = e.homeX + dx * run;
      e.y = e.homeY + dy * run;
      e.z = jumpHeight(t);
      if (t >= J.jumpTicks) {
        e.frame++;
        setState(e, S.land);
      }
      break;
    }
    case S.land:
      if (e.tick >= J.land) setState(e, e.frame >= J.jumps ? S.spin : S.hop);
      break;
    case S.spin:
      stepSpin(game, e);
      break;
    case S.away:
      stepAway(e);
      break;
  }
}

/** His frame (player_sob.bin) now: standing (60 + facing; 62 down), none once he walks away off the TV (-1). */
function jumpingShadowFrame(e: Enemy): number {
  return e.shot === JUMPING_SHADOW_STATE.away ? -1 : STAND_FRAMES[e.facing];
}

/**
 * The black afterimages both minor Shadow Links leave: their draw 0x80220F54 passes afterimage kind 14 in its sprite
 * parameters (+0x30), and the sprite drawer's tables (0x80471060…, docs/formats/sprites-and-actors.md "Afterimages")
 * give kind 14 every 4 frames, 20 frames' life, color × (0, 0, 0, 191), its own size: dark copies trailing his hops and
 * jumps (Dolphin frame dumps). None while he's off the TV (another draw, 0x801EF574).
 */
export const MINOR_SHADOW_AFTERIMAGE = { every: 4, life: 20, alpha: 191 / 255 } as const;
