// Things the Links pick up in the adventure: Force Gems (RUPY, and HNRY hovering ones), small hearts (HART) and keys
// (KEY0). Placed in the room lists; once taken they stay taken for the stage (AdventureState.taken). Plain records in
// AdventureState.pickups, for the current area.
//
// From main.dol (docs/formats/sprites-and-actors.md "Force Gems"):
// - a Force Gem's type is its params' low byte; its look the table at 0x80471948 (types 0-7 enemy_both2, 8-11 the huge
//   ones in enemy_gc) and its worth the table at 0x804719D8 (RUPY's code indexes it by type): 1, 5, 20, 50, 100, 150,
//   200, 300, then 1000, 1500, 2000, 3000;
// - a hovering gem (HNRY) shows the gem of its params & 7 (table 0x804AB038), so it's worth that gem;
// - the stage's goal wants the four Links' gems to add up to 2000 (0x802F0404 compares their sum with 2000).
// - RYRN "Force Gem rain" (init 0x802A92FC, update 0x802A8284): kinds 0, 6 and 7 wait for their switch (and do nothing
//   if it's already on when the Links come in), kinds 3 and 12 start at once; then it makes (p >> 12) & 0xFF gems (0:
//   256), two a tick, each a green one (1) 80 times in 100, blue (5) 15, red (20) 5, dropped from 300-350 px up; kinds
//   6, 7 and 12 within ±8 × ((p >> 8) & 0xF) px (0: 64) of it, the others anywhere on the screen. (Its counts for two
//   or more players aren't used here.)
// - GOLD (init 0x8032A7B8, update 0x80329640) of kind (p >> 16) & 15 = 0 makes Force Gems worth p & 0xFFFF at once and
//   goes (Phantom Ganon's falls: 99 each, his end: 80; traced, docs/measurements/adventure-world1.md "Phantom Ganon"):
//   up to 100 tries, each the largest gem type (cap 11, lowered as it goes) not worth more than what's left, then a
//   type at random from 0 to it (below 20 left, a green one), taken off what's left; each gem leaves the GOLD's place
//   at its height flying (−1…1, −1…1) px a tick across and 2-4 px a tick up, falling 0.3 px/tick², stopping where it
//   lands (traced).
import { HEART } from "../combat.ts";
import { SUBPX } from "../player.ts";
import { switchOn } from "../switches.ts";
import { actorKey, currentArea, nextRandom, type AdventureGame, type AdventureState } from "./adventure.ts";
import { GEAR_BY_NUMBER, giveGear } from "./gear.ts";
import type { AdventureStage } from "./stage.ts";

/** A Force Gem's worth by type (main.dol 0x804719D8). */
export const GEM_VALUES: readonly number[] = [1, 5, 20, 50, 100, 150, 200, 300, 1000, 1500, 2000, 3000];
/** Its look by type: enemy_both2 frames for 0-7, enemy_gc for 8-11 (main.dol 0x80471948). */
export const GEM_FRAMES: readonly number[] = [1, 5, 9, 13, 17, 21, 25, 29, 1114, 1110, 1122, 1118];
/** HNRY's gem by params & 7 (main.dol 0x804AB038: frames 17, 21, 25, 29, 17, 9, 13, 5 = gem types 4-7, 4, 2, 3, 1). */
export const HOVERING_GEMS: readonly number[] = [4, 5, 6, 7, 4, 2, 3, 1];
/** The Force Gems the goal wants (the four Links' together; main.dol 0x802F0404). */
export const GEM_QUOTA = 2000;
/** The box a Link's body must meet to take it (RUPY's init: ±4 to ±16 by size). TODO(measure) per type. */
export const GEM_HALF = 6;
export const HUGE_GEM_HALF = 12;
export const PICKUP_HALF = 6;
/** How high a hovering gem floats. TODO(measure). */
export const HOVER_HEIGHT = 8 * SUBPX;
/** A rained gem falls from 300-350 px up (RYRN). RUPY's fall (traced: a gem dropped from 299 px onto a Link fell 1.3
 *  px the first tick, 0.3 more each tick, 13 px on the last of 41): from 1 px/tick, 0.3 px/tick² (77/256); its cap
 *  wasn't reached (TODO(measure)). */
export const RAIN_HEIGHT = 300;
export const RAIN_SPREAD = 50;
export const GEM_GRAVITY = 77;
export const GEM_FALL_START = SUBPX;
export const GEM_MAX_FALL = 16 * SUBPX;
/** A falling gem can be taken this close to the ground. TODO(measure). */
export const TAKE_HEIGHT = 12 * SUBPX;
/** RYRN: gems made per tick. */
export const RAIN_PER_TICK = 2;

export type PickupType = "gem" | "heart" | "key" | "item";

export interface Pickup {
  id: number;
  type: PickupType;
  /** The actor type it came from (RUPY, HNRY, HART, KEY0). */
  from: string;
  /** Its index in the room's actor list (-1: dropped at run time). */
  actor: number;
  x: number; // 1/256 px
  y: number;
  z: number;
  /** A gem's type (GEM_VALUES), a key's kind. */
  kind: number;
  /** A switch it waits for before it shows (the params' top 5 bits), 0 = none. TODO(measure): what makes it appear. */
  gate: number;
  /** Ticks since it appeared. */
  tick: number;
  /** Falling speed (1/256 px per tick, up) of a gem dropped from above; 0 once it's down. */
  vz: number;
  /** A gem flung out of a GOLD: its speed across while it's in the air (1/256 px per tick). */
  vx?: number;
  vy?: number;
  /** The boomerang bringing it back (its entity id), 0 when it lies where it is (gear.ts). */
  fetched?: number;
}

/** A RYRN Force Gem rain of the current area: waiting for its switch, raining, or done. */
export interface Rain {
  /** The RYRN's index in the room's actor list. */
  actor: number;
  state: "wait" | "rain" | "done";
  /** Gems made so far, and the number it makes. */
  made: number;
  total: number;
}

/** Actor types that are pickups (LSTI: an item lying there, params & 0x7F its number, gear.ts). */
export const PICKUP_TYPES: readonly string[] = ["RUPY", "HNRY", "HART", "KEY0", "LSTI"];

/** A key thrown and landed (doors.ts): where it lies, by its room's actorKey, 3 numbers a key (key, x, y; 1/256 px). */
export function layKey(a: AdventureState, key: number, x: number, y: number): void {
  a.taken = a.taken.filter((k) => k !== key);
  for (let i = 0; i < a.keysDown.length; i += 3) {
    if (a.keysDown[i] === key) {
      a.keysDown.splice(i, 3, key, x, y);
      return;
    }
  }
  a.keysDown.push(key, x, y);
}

/** Where a key lies if it was thrown and landed (layKey), or undefined. */
function keyDown(a: AdventureState, key: number): { x: number; y: number } | undefined {
  for (let i = 0; i < a.keysDown.length; i += 3) if (a.keysDown[i] === key) return { x: a.keysDown[i + 1]!, y: a.keysDown[i + 2]! };
  return undefined;
}

/** The current area's placed pickups not taken yet (a thrown key where it landed). */
export function spawnPickups(game: AdventureGame, stage: AdventureStage): void {
  const a = game.adventure;
  // A key still in the air when the Links leave its room lands where it is (its pickup goes with the room).
  const t = a.keyThrow;
  if (t) {
    if (t.key >= 0) layKey(a, t.key, t.x, t.y);
    a.keyThrow = null;
  }
  a.pickups = [];
  for (const actor of currentArea(game, stage).actors) {
    if (!PICKUP_TYPES.includes(actor.id) || a.taken.includes(actorKey(a.room, actor.index))) continue;
    const p = actor.params;
    let type: PickupType = "gem", kind = 0, z = 0;
    const down = actor.id === "KEY0" ? keyDown(a, actorKey(a.room, actor.index)) : undefined;
    switch (actor.id) {
      case "RUPY":
        kind = p & 0xff;
        if (kind >= GEM_VALUES.length) continue;
        break;
      case "HNRY":
        kind = HOVERING_GEMS[p & 7]!;
        z = HOVER_HEIGHT;
        break;
      case "HART":
        type = "heart";
        break;
      case "KEY0":
        type = "key";
        kind = p & 0xf;
        break;
      case "LSTI":
        type = "item";
        kind = p & 0x7f;
        break;
    }
    a.pickups.push({ id: a.nextId++, type, from: actor.id, actor: actor.index, x: down ? down.x : actor.x * SUBPX, y: down ? down.y : actor.y * SUBPX, z, kind, gate: p >>> 27, tick: 0, vz: 0 });
  }
  // The area's gem rains: one whose switch is already on has rained already.
  a.rains = [];
  for (const actor of currentArea(game, stage).actors) {
    if (actor.id !== "RYRN") continue;
    const p = actor.params >>> 0, kind = p & 0xff, sw = p >>> 27;
    const now = kind === 3 || kind === 12;
    a.rains.push({ actor: actor.index, state: now ? "rain" : sw && switchOn(game.battle, sw) ? "done" : "wait", made: 0, total: (p >>> 12) & 0xff || 256 });
  }
}

/** A Force Gem dropped at (x, y) (1/256 px) from `z` px up, of gem type `kind` (not one of the room's placed ones). */
export function dropGem(game: AdventureGame, x: number, y: number, z: number, kind: number): void {
  const a = game.adventure;
  a.pickups.push({ id: a.nextId++, type: "gem", from: "RUPY", actor: -1, x, y, z: z * SUBPX, kind, gate: 0, tick: 0, vz: z > 0 ? -GEM_FALL_START : 0 });
}

/** GOLD's gem types for a worth, from the game's own rule (see the file comment); `rand(n)` is 0…n−1. */
export function goldGems(worth: number, rand: (n: number) => number): number[] {
  const gems: number[] = [];
  let cap = GEM_VALUES.length - 1;
  for (let tries = 0; tries < 100 && worth > 0; tries++) {
    while (cap > 0 && GEM_VALUES[cap]! > worth) cap--;
    const kind = worth < 20 ? 0 : rand(cap + 1);
    if (GEM_VALUES[kind]! > worth) continue;
    worth -= GEM_VALUES[kind]!;
    gems.push(kind);
  }
  return gems;
}

/** A GOLD of kind 0 at (x, y) (1/256 px) `z` (1/256 px) up: Force Gems worth `worth` flung out of it. */
export function burstGems(game: AdventureGame, x: number, y: number, z: number, worth: number): void {
  const a = game.adventure;
  const rand = (n: number) => nextRandom(a) % n;
  for (const kind of goldGems(worth, rand)) {
    // Up 2-4 px a tick (the first tick's step before the fall's: stepPickups takes gravity off first).
    const vz = 2 * SUBPX + rand(2 * SUBPX) + GEM_GRAVITY;
    a.pickups.push({ id: a.nextId++, type: "gem", from: "RUPY", actor: -1, x, y, z: Math.max(1, z), kind, gate: 0, tick: 0, vz, vx: SUBPX - rand(2 * SUBPX + 1), vy: SUBPX - rand(2 * SUBPX + 1) });
  }
}

/** The area's gem rains, one tick. */
export function stepRains(game: AdventureGame, stage: AdventureStage): void {
  const a = game.adventure;
  if (!a.rains.length) return;
  const area = currentArea(game, stage);
  const rand = (n: number) => nextRandom(a) % n;
  for (const r of a.rains) {
    const actor = area.actors.find((x) => x.index === r.actor);
    if (!actor || r.state === "done") continue;
    const p = actor.params >>> 0, kind = p & 0xff, sw = p >>> 27;
    if (r.state === "wait") {
      if (!sw || !switchOn(game.battle, sw)) continue;
      r.state = "rain";
    }
    for (let k = 0; k < RAIN_PER_TICK && r.made < r.total; k++, r.made++) {
      const roll = rand(100), gem = roll < 5 ? 2 : roll < 20 ? 1 : 0;
      let x: number, y: number;
      if (kind === 6 || kind === 7 || kind === 12) {
        const hw = 8 * ((p >>> 8) & 0xf) || 64;
        x = actor.x + rand(hw * 2 + 1) - hw;
        y = actor.y + rand(hw * 2 + 1) - hw;
      } else {
        // Anywhere on the screen: around the leader (TODO(measure): the camera's own rectangle).
        const l = game.players[0]!;
        x = Math.floor(l.x / SUBPX) - 128 + rand(257);
        y = Math.floor(l.y / SUBPX) - 96 + rand(193);
      }
      x = Math.max(8, Math.min(area.w - 8, x));
      y = Math.max(8, Math.min(area.h - 8, y));
      dropGem(game, x * SUBPX, y * SUBPX, RAIN_HEIGHT + rand(RAIN_SPREAD), gem);
    }
    if (r.made >= r.total) r.state = "done";
  }
}

/** Whether a pickup shows (and can be taken) now: its switch, if any, is on. */
export function pickupShown(game: AdventureGame, p: Pickup): boolean {
  return !p.gate || ((game.battle.switches >>> p.gate) & 1) === 1;
}

/** The Links take what their bodies touch. */
export function stepPickups(game: AdventureGame): void {
  const a = game.adventure, b = game.battle;
  if (!a.pickups.length) return;
  let taken = false;
  for (const it of a.pickups) {
    // Keys are lifted, not taken by touch (doors.ts liftKey); a thrown one flies on its own (doors.ts stepKeyThrow).
    if (!pickupShown(game, it) || it.fetched || it.type === "key") continue;
    it.tick++;
    if (it.actor < 0 && it.z > 0) {
      // Falling to the ground.
      it.vz = Math.max(-GEM_MAX_FALL, it.vz - GEM_GRAVITY);
      it.z = Math.max(0, it.z + it.vz);
      if (it.vx || it.vy) (it.x += it.vx ?? 0), (it.y += it.vy ?? 0);
      if (it.z === 0) (it.vz = 0), (it.vx = it.vy = 0);
    }
    if (it.z > TAKE_HEIGHT && it.actor < 0) continue;
    const half = (it.type === "gem" && it.kind >= 8 ? HUGE_GEM_HALF : it.type === "gem" ? GEM_HALF : PICKUP_HALF) * SUBPX;
    const who = game.players.findIndex((p, i) => {
      const f = b.fighters[i]!;
      if (f.hearts <= 0 || (f.mode !== "active" && f.mode !== "hurt")) return false;
      const h = 7 * SUBPX;
      return Math.abs(p.x - it.x) <= half + h && Math.abs(p.y - it.y) <= half + h;
    });
    if (who < 0) continue;
    if (it.type === "gem") a.gems += GEM_VALUES[it.kind]!;
    else if (it.type === "item") giveGear(game, GEAR_BY_NUMBER[it.kind] ?? "");
    else if (it.type === "heart") {
      const f = b.fighters[who]!;
      f.hearts = Math.min(b.rules.hearts * HEART, f.hearts + HEART);
    } else a.keys++;
    if (it.actor >= 0) a.taken.push(actorKey(a.room, it.actor));
    it.tick = -1;
    taken = true;
  }
  if (taken) a.pickups = a.pickups.filter((p) => p.tick >= 0);
}

/** Whether the Links have the Force Gems the goal wants. */
export const quotaMet = (game: AdventureGame) => game.adventure.gems >= GEM_QUOTA;
