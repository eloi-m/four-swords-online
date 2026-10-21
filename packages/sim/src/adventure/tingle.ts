// Tingle's first appearance (FTGL: Lake Hylia room 5's area 2, under the bridge, at (144, 112) under the two-Link rock
// RCK2 placed on the same spot). His actor (ctor 0x80317C38, vtable 0x804AADD8; init 0x80317B08, update 0x80317378 with
// its states 0-13 at +0x230 by the table 0x804AAE2C, their count at +0x238; draw 0x803172DC: both2 192 + the frame at
// +0x23C, on the GBA screen or on the TV by his screen +0x4). Read from main.dol, the numbers traced in Dolphin
// (`ref/adv/room5-river.sav`, actor-trace.ts: docs/measurements/adventure-lake-hylia.md "Tingle under the bridge"):
// - the rock holds him (rocks.ts heldUnderRocks): he's made once it's off the ground (traced: 68 ticks after the
//   lifting press, 2 after the rock's first height), lying where it was (frame 29);
// - 0: 50 ticks; then (0x80230C6C) a Link still carrying something has it taken (assumed gone: with the rock still
//   carried it was out of RAM by the next look), and 1: the scene takes the game (0x801F68E0, at once here): the Links
//   stand facing him (player_sob 60 right / 61 left, by which side of him they're on), the nearest one his listener;
// - 2: 60 ticks; 3, 4: 120 ticks, his first animation (frames 29 1 tick, 30 4, 21 50, 31 4, 32 8, 33 4, 34 8, then 21);
// - 5: his first message, msgus 1294 ("... ... ... / Huh?!", index 1293 in the code), 6: until it's closed; 7: the next
//   tick 1295 ("You... You've saved Tingle!"), which goes on in the same box with 1305 ("Oh, Mr. Fairy!" … "...Don't
//   follow me!") and 1302, his chant "Tingle / Tingle / Kooloo- / limpah!" (each a trailing branch: MessageBook.follows);
//   8: until it's closed: frame 20 while he talks, and in the chant each part's pose from its page's start (table
//   0x804AADB8 by the page's `part` tag: frames 21, 31, 32 / 21, 33, 34 / 21, 27, 28, 29, 28, 21, 35-37 three times, 21
//   / 29, 28, 30, 21); the chant's pages turn by themselves (dialogue.ts Talk.wait);
// - 9: his second animation (21, 26, 25, 24, 23, 6: 4 ticks each), then 10: up on his balloon (frames 0, 1, 2, 1:
//   4, 4, 6, 6 ticks once, then 10 each), the scene over (0x801F6884: the Links walk again), drifting right 0.4
//   px/tick and up 0.3 px/tick to 30.3 px; once his ±20 px box is off the GBA screen (traced: x 261.2, the screen
//   following the leader at x 121), 11: he's put on the TV, room 5 at (340, 152) (world (1364, 920)), 12: 60 ticks
//   unseen, 13: drifting right 0.6 px/tick, up 0.3 to 30.3 px again, gone off the TV 301 ticks later (traced, the TV's
//   camera on the room's middle), for good (0x801F35AC): back in area 2 he isn't there (traced).
// He gives nothing (the Force Gems' count unchanged, traced). Not simulated (TODO(measure)): his box against the Links
// (0x80239914 in states 0-8, -8 to 24 px across and -24 to 24 down; the Links stand meanwhile), his sounds (0x1000025
// when he's made, 0x50050 at the stop, 0x50051-0x50054 the chant's parts, 0x5001B on the TV), the chant's sparkles (JPA
// 629, 630), the balloon's "..." over the GBA screen while he talks, a Link apart in another area (the scene takes the
// Links of his screen only).
import { SUBPX, type Facing } from "../player.ts";
import { actorKey, currentArea, type AdventureGame } from "./adventure.ts";
import { flowState, openScripted } from "./dialogue.ts";
import type { AdventureStage } from "./stage.ts";

/** His states (+0x230). */
export const TINGLE_STATE = {
  made: 0, stop: 1, wait: 2, start: 3, look: 4, ask: 5, asked: 6, tell: 7, told: 8, rise: 9, fly: 10, off: 11, unseen: 12, away: 13,
} as const;

export const TINGLE = {
  /** Ticks from the lifting press to him (traced), state 0's, 2's, 4's. */
  reveal: 68,
  made: 50,
  wait: 60,
  look: 120,
  /** His messages (ids): the first, then the one his talk starts with (its box goes on: MessageBook.follows). */
  first: 1294,
  talk: 1295,
  /** On his balloon: px/tick (1/256 px) right on the GBA screen, on the TV, and up; how many ticks up (to 30.3 px). */
  drift: 102,
  tvDrift: 154,
  rise: 77,
  riseTicks: 101,
  /** His box's half size for the screen's test (px), the GBA screen's half width (px). */
  half: 20,
  screenHalf: 120,
  /** On the TV: where (room px), the ticks unseen, the ticks he flies there. */
  tvX: 340,
  tvY: 152,
  unseen: 60,
  tvTicks: 301,
};

/** The scene: where he is (`area`, px × 256), his state and its count, his frame (both2 192 + it), his animations. */
export interface Tingle {
  /** His index in room 5's actor list, the room and area he's in now (area 2, then 0: the TV). */
  actor: number;
  room: number;
  area: number;
  x: number;
  y: number;
  z: number;
  state: number;
  tick: number;
  frame: number;
  /** The table's animation (+0x240), its step (+0x244) and that step's ticks (+0x248). */
  anim: number;
  step: number;
  count: number;
  /** The chant's part on show (-1 none), its step and ticks (the talk animation, 0x80316E74). */
  part: number;
  partStep: number;
  partCount: number;
  /** The Link he talks to (+0x234), -1 none; the flight's ticks. */
  listener: number;
  flown: number;
}

/** [frame, ticks] (0 ticks: held), the table animations 0-3 (0x804715B8 …). */
const ANIMS: readonly (readonly (readonly [number, number])[])[] = [
  [[29, 1], [30, 4], [21, 50], [31, 4], [32, 8], [33, 4], [34, 8], [21, 0]],
  [[21, 4], [26, 4], [25, 4], [24, 4], [23, 4], [6, 4]],
  [[0, 4], [1, 4], [2, 6], [1, 6]],
  [[0, 10], [1, 10], [2, 10], [1, 10]],
];
/** The chant's parts: [frame, ticks] (-1 ticks: held), 0x804AADB8. */
const PARTS: readonly (readonly (readonly [number, number])[])[] = [
  [[21, 6], [31, 6], [32, -1]],
  [[21, 6], [33, 6], [34, -1]],
  [[21, 6], [27, 6], [28, 4], [29, 10], [28, 6], [21, 6], ...[0, 1, 2].flatMap(() => [[35, 3], [36, 3], [37, 3]] as [number, number][]), [21, -1]],
  [[29, 20], [28, 4], [30, 4], [21, -1]],
];
/** His frame before his first animation, while he talks outside the chant. */
const LYING = 29, TALKING = 20;
export const TINGLE_BASE_FRAME = 192;

/** The rock over him lifted (rocks.ts): he's made, the scene starts. */
export function revealTingle(game: AdventureGame, stage: AdventureStage, actor: number): void {
  const a = game.adventure;
  if (a.tingle || a.taken.includes(actorKey(a.room, actor))) return;
  const placed = currentArea(game, stage).actors.find((x) => x.index === actor);
  if (!placed) return;
  a.tingle = {
    actor, room: a.room, area: a.area, x: placed.x * SUBPX, y: placed.y * SUBPX, z: 0, state: TINGLE_STATE.made, tick: 0, frame: LYING,
    anim: 0, step: 0, count: 0, part: -1, partStep: 0, partCount: 0, listener: -1, flown: 0,
  };
}

/** Whether the scene holds the Links (states 1-9: they stand, or read his messages). */
export function tingleHolds(game: AdventureGame): boolean {
  const t = game.adventure.tingle;
  return !!t && t.state >= TINGLE_STATE.stop && t.state <= TINGLE_STATE.rise;
}

/** Whether he's on show in the area the game shows: his frame (both2) and where (area px, his height), or null. */
export function tingleShown(game: AdventureGame): { frame: number; x: number; y: number; z: number; area: number } | null {
  const t = game.adventure.tingle;
  if (!t || t.room !== game.adventure.room || t.state === TINGLE_STATE.off || t.state === TINGLE_STATE.unseen) return null;
  return { frame: TINGLE_BASE_FRAME + t.frame, x: t.x / SUBPX, y: t.y / SUBPX, z: t.z / SUBPX, area: t.area };
}

function setState(t: Tingle, state: number): void {
  t.state = state;
  t.tick = 0;
}

/** The scene's tick (before the Links move: what it holds them to is for this tick). */
export function stepTingle(game: AdventureGame, stage: AdventureStage): void {
  const a = game.adventure, t = a.tingle, S = TINGLE_STATE;
  if (!t) return;
  // The Links gone from his room: he's gone too (assumed; the game drops the room's actors).
  if (a.room !== t.room) {
    done(game, t);
    return;
  }
  t.tick++;
  switch (t.state) {
    case S.made:
      if (t.tick < TINGLE.made) break;
      // A rock still carried is taken from them (assumed gone).
      if (a.heavy && a.heavy.phase !== "throw") {
        const r = a.rocks[a.heavy.rock];
        if (r) {
          r.state = "gone";
          a.moved.push(actorKey(a.room, r.actor));
        }
        a.heavy = null;
      }
      setState(t, S.stop);
      break;
    case S.stop:
      // (The scene took the game at once here: 0x801F68E0.)
      stop(game, t);
      setState(t, S.wait);
      break;
    case S.wait:
      if (t.tick >= TINGLE.wait) setState(t, S.start);
      break;
    case S.start:
      setState(t, S.look);
      break;
    case S.look:
      if (t.tick >= TINGLE.look) setState(t, S.ask);
      break;
    case S.ask:
      // (Its box asked for on the second tick: traced.)
      if (t.tick < 2) break;
      openScripted(game, stage, t.actor, TINGLE.first, "balloon");
      setState(t, S.asked);
      break;
    case S.asked:
      if (!a.talk) setState(t, S.tell);
      break;
    case S.tell: {
      // His talk, and what it goes on with in the same box.
      const after: number[] = [], flow = flowState(game);
      for (let m = stage.messages?.follows(TINGLE.talk, flow) ?? null; m !== null && after.length < 8; m = stage.messages?.follows(m, flow) ?? null) after.push(m);
      openScripted(game, stage, t.actor, TINGLE.talk, "balloon", after, true);
      Object.assign(t, { part: -1, partStep: 0, partCount: 0 });
      setState(t, S.told);
      break;
    }
    case S.told:
      if (a.talk) break;
      Object.assign(t, { listener: -1, anim: 1, step: 0, count: 0 });
      setState(t, S.rise);
      break;
    case S.rise:
      if (t.anim < 2) break;
      setState(t, S.fly);
      fly(t, TINGLE.drift);
      break;
    case S.fly:
      fly(t, TINGLE.drift);
      // (Off the GBA screen: past its right edge, or no Link left in his area to see him, assumed.)
      if (a.area !== t.area || t.x - TINGLE.half * SUBPX > gbaRight(game) * SUBPX) setState(t, S.off);
      break;
    case S.off:
      Object.assign(t, { area: 0, x: TINGLE.tvX * SUBPX, y: TINGLE.tvY * SUBPX, z: 0, flown: 0 });
      setState(t, S.unseen);
      break;
    case S.unseen:
      if (t.tick >= TINGLE.unseen) setState(t, S.away);
      break;
    case S.away:
      fly(t, TINGLE.tvDrift);
      if (t.tick >= TINGLE.tvTicks) done(game, t);
      return;
  }
  animate(game, stage, t);
}

// The scene's stop (state 1): each Link stands facing him, the nearest his listener.
function stop(game: AdventureGame, t: Tingle): void {
  let best = Infinity;
  game.players.forEach((p, i) => {
    const facing: Facing = p.x > t.x ? "left" : "right";
    Object.assign(p, { facing, moving: false, walkTicks: 0 });
    const d = ((p.x - t.x) / SUBPX) ** 2 + ((p.y - t.y) / SUBPX) ** 2;
    if (d < best) [best, t.listener] = [d, i];
  });
}

/** On his balloon: `dx` right a tick, up to his height. */
function fly(t: Tingle, dx: number): void {
  t.flown++;
  t.x += dx;
  if (t.flown <= TINGLE.riseTicks) t.z += TINGLE.rise;
}

/** The GBA screen's right edge (area px): 240 px across, on the leader within the area (assumed: the app's camera). */
function gbaRight(game: AdventureGame): number {
  return game.players[0]!.x / SUBPX + TINGLE.screenHalf;
}

function done(game: AdventureGame, t: Tingle): void {
  const a = game.adventure, key = actorKey(t.room, t.actor);
  if (!a.taken.includes(key)) a.taken.push(key);
  a.tingle = null;
}

// His frame (end of the update): the chant's part animation while he talks (state 8), else the table's from state 3.
function animate(game: AdventureGame, stage: AdventureStage, t: Tingle): void {
  const S = TINGLE_STATE;
  if (t.state === S.told) {
    const part = chantPart(game, stage);
    if (part !== t.part) Object.assign(t, { part, partStep: 0, partCount: 0 });
    const steps = PARTS[part];
    if (!steps) {
      t.frame = TALKING;
      return;
    }
    const [frame, ticks] = steps[t.partStep]!;
    t.frame = frame;
    if (ticks >= 0 && ++t.partCount >= ticks) {
      t.partCount = 0;
      t.partStep = Math.min(t.partStep + 1, steps.length - 1);
    }
    return;
  }
  if (t.state < S.start) return;
  const steps = ANIMS[t.anim]!, [frame, ticks] = steps[t.step]!;
  t.frame = frame;
  if (ticks <= 0 || ++t.count < ticks) return;
  t.count = 0;
  if (++t.step < steps.length) return;
  t.step = 0;
  if (t.anim < 3) t.anim++;
}

/** The chant's part on show (the page's `part` tag), -1 outside it. */
function chantPart(game: AdventureGame, stage: AdventureStage): number {
  const talk = game.adventure.talk;
  if (!talk || talk.close > 0) return -1;
  return stage.messages?.parts(talk.message)[talk.page] ?? -1;
}
