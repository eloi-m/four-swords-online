// The adventure's items (Link +0xC10: 1 Pegasus Boots, 2 lamp, 3 boomerang, 4 bow, 5 hammer, 6 Fire Rod, 7 Roc's
// Feather, 8 bombs, 9 shovel, 10 slingshot), the leader's (AdventureState.gear). Those Shadow Battle has (bombs, bow,
// boomerang, slingshot) are the battle code's (items.ts, projectiles.ts: the fighter's `item`); the adventure adds:
// - where they come from: a pedestal tile (0x017) faced with the Action button (traced in Lake Hylia room 2's cave: R
//   from (125, 87) facing up gave the boomerang, no actor involved; the item is the one drawn over the
//   pedestal, PEDESTAL_DRAWN, or PEDESTAL_ITEMS), and LSTI, an item lying on the ground (params & 0x7F), taken by walking onto it;
// - the boomerang fetches what it touches (traced: thrown at room 3's key behind the posts it flew over them, took the
//   key and dropped it at Link's feet), and doesn't hook the other Links;
// - the Fire Rod (traced, room 3): a pose of 18 ticks, the fireball leaving on the 12th tick 8 px ahead at 1 px/tick,
//   speeding up to 2 px/tick (0.3 of the way each tick); it bursts on a wall. Burning a tree stump (tile 0xFA) burns
//   the stumps touching it too (traced: one shot burned all six round room 3's rock), which become 0x5A (passable)
//   once the fire's out. TODO(measure): its range, the blue gems the stumps dropped, torches, enemies;
// - the bow's arrows (bow.ts): over the candle stands, alight from a lit torch, on candles and crystals.
// Things a Link throws or shoots never hurt the other Links in the adventure.
import { attackMeets } from "../attacks.ts";
import { boxAround, boxesOverlap, FACING_STEP, isRemoved, type Entity } from "../entities.ts";
import { setSwitch } from "../switches.ts";
import { Button, SUBPX, type Facing } from "../player.ts";
import { isSolidAt, type World } from "../world.ts";
import { currentArea, type AdventureGame } from "./adventure.ts";
import { startItemGet, startKeyGet } from "./dialogue.ts";
import type { AdventureStage, Area } from "./stage.ts";
import { linkAttack } from "./whirl.ts";

export type GearKind = "" | "boots" | "lamp" | "boomerang" | "bow" | "hammer" | "fireRod" | "feather" | "bombs" | "shovel" | "slingshot";
/** Link +0xC10's numbers. */
export const GEAR_BY_NUMBER: readonly GearKind[] = ["", "boots", "lamp", "boomerang", "bow", "hammer", "fireRod", "feather", "bombs", "shovel", "slingshot"];
/** What the battle code does for an item (Fighter.item). */
const BATTLE_ITEM: Partial<Record<GearKind, "boomerang" | "bow" | "bomb" | "slingshot">> = { boomerang: "boomerang", bow: "bow", bombs: "bomb", slingshot: "slingshot" };
/**
 * The items a stage's pedestals give whatever they draw (traced: Lake Hylia's boomerang). Every other pedestal gives
 * the item drawn on it (PEDESTAL_DRAWN): the Cave of No Return's draw the lamp (rooms 0, 6 ×2, 13 and its copy 10)
 * but room 8's, on an island across a pit, the bow (0x2B; room 8 is played at room 9's cell alone: stage.ts
 * ALONE_ROOMS).
 */
export const PEDESTAL_ITEMS: Readonly<Record<number, readonly GearKind[]>> = { 10: ["boomerang"] };
export const PEDESTAL_TILE = 0x017;
/**
 * Elsewhere a pedestal gives the item drawn on it: the top layer's tile over it is 0x27 + the item's number (Lake
 * Hylia's boomerang 0x2A, the Cave of No Return's lamps 0x29; Hyrule Castle room 5's gatehouse: 0x2F bombs on the
 * left, 0x2B the bow on the right, both traced: R facing each gave item 8, then 4, to all four, holding nothing).
 * Its upper half is the top layer's tile above, 0x17 + the item's number. Taking an item puts the one held on the
 * pedestal (frame dumps, room 8: the bow taken holding the lamp left the lamp drawn there, and taking that again the bow;
 * AdventureState.pedestals); one taken holding nothing leaves it empty (assumed: both top tiles cleared). Assumed too:
 * the swap shows on the press's tick (the Links stand in front of it while they hold the item up). Not done: the Item
 * button facing a pedestal, which drops the item held (traced: "You dropped your item!", +0xC10 to 0).
 */
export const PEDESTAL_DRAWN = 0x27;
export const PEDESTAL_DRAWN_TOP = 0x17;
/** The Action press reaches a pedestal this far in front (the lift's reach). */
const PEDESTAL_REACH = 16;

export const STUMP_TILE = 0x0fa;
export const BURNT_STUMP_TILE = 0x05a;
export const FIRE_POSE_TICKS = 18;
export const FIRE_RELEASE_TICK = 12;
export const FIRE_OUT = 8;
export const FIRE_START_SPEED = 261; // 1.02 px/tick
export const FIRE_SPEED = 2 * SUBPX;
export const FIRE_EASE = 3; // / 10 of the way to FIRE_SPEED each tick
export const FIRE_LIFETIME = 90; // TODO(measure): it was still flying after 73 ticks
export const BURN_TICKS = 60; // fire on the stumps until they're burnt (frame dumps: about a second)

export interface FireBolt {
  x: number;
  y: number;
  facing: Facing;
  speed: number;
  tick: number;
}

/** Gives the leader an item (the battle code's own ones go into his fighter too). */
export function giveGear(game: AdventureGame, kind: GearKind): void {
  game.adventure.gear = kind;
  const f = game.battle.fighters[0]!;
  f.item = BATTLE_ITEM[kind] ?? "";
}

/** The item a stage's pedestal gives the Links holding `held` (PEDESTAL_ITEMS: the next one), or "" for none. */
export function pedestalItem(stage: number, held: GearKind): GearKind {
  const items = PEDESTAL_ITEMS[stage] ?? [];
  const next = items[(items.indexOf(held) + 1) % Math.max(1, items.length)] ?? "";
  return next === held ? "" : next;
}

/** The item drawn on the pedestal at tile `tile` of `area` (PEDESTAL_DRAWN), or "" for none. */
export function drawnPedestalItem(area: Area, tile: number): GearKind {
  const drawn = area.top ? (area.top[tile]! & 0x3ff) - PEDESTAL_DRAWN : 0;
  return GEAR_BY_NUMBER[drawn] ?? "";
}

/** The item on the pedestal at tile `tile` of the current area: the one put there (AdventureState.pedestals), else its
 *  stage's (PEDESTAL_ITEMS, the held item `held` decides) or the one drawn. */
function pedestalHolds(game: AdventureGame, stage: AdventureStage, area: Area, tile: number, held: GearKind): GearKind {
  const a = game.adventure, at = pedestalAt(a.pedestals, tileKey(a.room, a.area, tile));
  if (at >= 0) return GEAR_BY_NUMBER[a.pedestals[at + 1]!] ?? "";
  return PEDESTAL_ITEMS[stage.index] ? pedestalItem(stage.index, held) : drawnPedestalItem(area, tile);
}

const pedestalAt = (list: readonly number[], key: number): number => {
  for (let k = 0; k < list.length; k += 2) if (list[k] === key) return k;
  return -1;
};

/** The top-layer tiles the pedestals taken from show (tile index → tile: the item put there, 0 for none), for the view. */
export function pedestalTiles(game: AdventureGame, out: Map<number, number>): void {
  const a = game.adventure, base = tileKey(a.room, a.area, 0);
  for (let k = 0; k < a.pedestals.length; k += 2) {
    const key = a.pedestals[k]!;
    if (key < base || key >= base + 1024) continue;
    const tile = key - base, n = a.pedestals[k + 1]!;
    out.set(tile, n ? PEDESTAL_DRAWN + n : 0);
    if (tile >= 32) out.set(tile - 32, n ? PEDESTAL_DRAWN_TOP + n : 0);
  }
}

/** The Action button facing a pedestal: its item. Returns true when the press was used. */
export function takeFromPedestal(game: AdventureGame, stage: AdventureStage, buttons: number): boolean {
  const p = game.players[0]!, f = game.battle.fighters[0]!;
  if (!(buttons & ~p.held & Button.Action) || f.mode !== "active" || f.move !== "none" || p.action !== "none") return false;
  const [sx, sy] = FACING_STEP[p.facing];
  const x = Math.floor(p.x / SUBPX) + sx * PEDESTAL_REACH, y = Math.floor(p.y / SUBPX) + sy * PEDESTAL_REACH;
  const area = currentArea(game, stage);
  if (!area.base || x < 0 || y < 0 || x >= area.w || y >= area.h || (area.base[(y >> 4) * 32 + (x >> 4)]! & 0x3ff) !== PEDESTAL_TILE) return false;
  const a = game.adventure, tile = (y >> 4) * 32 + (x >> 4), held = a.gear;
  const item = pedestalHolds(game, stage, area, tile, held);
  if (!item || item === held) return false;
  // The item held goes onto the pedestal.
  const key = tileKey(a.room, a.area, tile), at = pedestalAt(a.pedestals, key);
  if (at >= 0) a.pedestals[at + 1] = GEAR_BY_NUMBER.indexOf(held);
  else a.pedestals.push(key, GEAR_BY_NUMBER.indexOf(held));
  giveGear(game, item);
  startItemGet(game, item);
  game.adventure.ignore |= Button.Action;
  return true;
}

/** A crystal's box for the sword (px each way: main.dol, ONOF's update 0x802CB230 → 0x8023BA68 against the sword's two
 *  boxes while the attack is live; the cross formation's whirl in Hyrule Castle room 58 lit its four on the traced
 *  ticks with it: whirl.ts). */
export const CRYSTAL_SWORD_HALF = 5;

/**
 * The sword lights a crystal (ONOF) it hits, or puts out a toggle one that's lit (in the adventure the sword does what
 * a blast does in Shadow Battle: switches.ts stepCrystal; traced: the guides' "hit the switch to make a bridge" in Lake
 * Hylia's cave). TODO(measure): the lockout.
 */
export function swordOnCrystals(game: AdventureGame): void {
  const b = game.battle;
  const crystals = b.entities.filter((e) => e.kind === "crystal" && !isRemoved(e));
  if (!crystals.length) return;
  const h = CRYSTAL_SWORD_HALF * SUBPX;
  game.players.forEach((p, i) => {
    const f = b.fighters[i]!;
    if (f.mode !== "active") return;
    const attack = linkAttack(game, i);
    // (A swing on its second tick; a spin all along, its boxes turning: each crystal it meets.)
    if (!attack || (p.action !== "spin" && p.actionTick !== 2)) return;
    for (const e of crystals) {
      if (attackMeets(attack, { left: e.x - h, top: e.y - h, right: e.x + h, bottom: e.y + h })) lightCrystal(game, e);
    }
  });
}

/** A Link's attack (the sword, an arrow: bow.ts) on a crystal: lights it, or puts out a toggle one that's lit. */
export function lightCrystal(game: AdventureGame, e: Entity): void {
  const b = game.battle, prop = b.props.actors[e.home];
  if (!prop || e.param === 1) return;
  const own = prop.params >>> 27, kind = (prop.params >>> 12) & 7;
  if (e.phase === "active") {
    if (kind === 1 || kind === 3) {
      e.phase = "rest";
      setSwitch(b, own, false);
    }
    return;
  }
  e.phase = "active";
  e.tick = 0;
  setSwitch(b, own, true);
  if (kind === 0 || kind === 4) e.param = 1;
  else if (kind === 2) e.timer = prop.params & 0xfff;
}

/** Before the arena's things move: nothing a Link throws or shoots may hit another Link. */
export function friendlyFire(game: AdventureGame): void {
  const all = (1 << game.players.length) - 1;
  for (const e of game.battle.entities) if (e.owner >= 0 && !isRemoved(e)) e.hitMask |= all;
}

/** After the arena's things moved: the boomerang takes the pickups it touches, and brings them back. */
export function boomerangFetch(game: AdventureGame): void {
  const a = game.adventure, b = game.battle;
  for (const it of a.pickups) {
    if (it.fetched) {
      const e = b.entities.find((x) => x.id === it.fetched);
      if (e && !isRemoved(e)) {
        it.x = e.x;
        it.y = e.y;
        continue;
      }
      // Back: at the thrower's feet, where he takes it.
      const p = game.players[0]!;
      it.fetched = 0;
      it.x = p.x;
      it.y = p.y;
      it.z = 0;
      // The first key the Links get shows its message (dialogue.ts); the Links stand until it's closed.
      if (it.type === "key" && !a.keyTold) {
        a.keyTold = true;
        startKeyGet(game);
      }
      continue;
    }
    const e = b.entities.find((x) => x.kind === "boomerang" && !isRemoved(x) && boxesOverlap(boxAround(x.x, x.y, 4), boxAround(it.x, it.y, 6)));
    if (!e || b.entities.some((x) => x.id === e.id && a.pickups.some((q) => q.fetched === x.id))) continue;
    it.fetched = e.id;
    it.z = 0;
    e.phase = "return";
  }
}

/** The world the arena's flying things see: low posts (tile 0x073) don't stop them (traced: the boomerang). */
export function flyingWorld(world: World, game: AdventureGame, stage: AdventureStage): World {
  const area = currentArea(game, stage);
  const base = area.base;
  if (!base) return world;
  let posts = lowPosts.get(area);
  if (!posts) {
    posts = [];
    for (let i = 0; i < base.length; i++) if ((base[i]! & 0x3ff) === 0x073) posts.push(i);
    lowPosts.set(area, posts);
  }
  if (!posts.length) return world;
  let hit = flying.get(world);
  if (hit) return hit;
  const solid = world.solid.slice();
  for (const i of posts) {
    const tx = i % 32, ty = Math.floor(i / 32);
    for (let q = 0; q < 4; q++) {
      const cx = tx * 2 + (q & 1), cy = ty * 2 + (q >> 1);
      if (cx < world.widthCells && cy < world.heightCells) solid[cy * world.widthCells + cx] = 0;
    }
  }
  hit = { ...world, solid };
  flying.set(world, hit);
  return hit;
}
const lowPosts = new WeakMap<object, number[]>();
const flying = new WeakMap<World, World>();

/** The Item button with the Fire Rod: the pose starts (true: the tick is the pose's). */
export function useFireRod(game: AdventureGame, buttons: number): boolean {
  const a = game.adventure, p = game.players[0]!, f = game.battle.fighters[0]!;
  if (a.gear !== "fireRod" || a.pose > 0 || !(buttons & ~p.held & Button.Item) || f.mode !== "active" || f.move !== "none" || p.action !== "none") return false;
  a.pose = 1;
  p.moving = false;
  p.walkTicks = 0;
  p.held = buttons;
  return true;
}

/** The Fire Rod's pose, one tick (true while it lasts: the leader doesn't walk). */
export function stepFirePose(game: AdventureGame, buttons: number): boolean {
  const a = game.adventure, p = game.players[0]!;
  if (a.pose <= 0 || a.gear !== "fireRod") return false;
  p.held = buttons;
  if (a.pose === FIRE_RELEASE_TICK) {
    const [sx, sy] = FACING_STEP[p.facing];
    a.bolts.push({ x: p.x + sx * FIRE_OUT * SUBPX, y: p.y + sy * FIRE_OUT * SUBPX, facing: p.facing, speed: FIRE_START_SPEED, tick: 0 });
  }
  if (++a.pose > FIRE_POSE_TICKS) a.pose = 0;
  return true;
}

/** The Fire Rod's pose frame (player_sob, traced: right 395-399, left 401-406, up 413-417; down assumed 407-412). */
export function firePoseFrame(game: AdventureGame): number {
  const a = game.adventure;
  if (a.pose <= 0 || a.gear !== "fireRod") return -1;
  const base = { right: 395, left: 401, down: 407, up: 413 }[game.players[0]!.facing];
  return base + Math.min(4, Math.floor((a.pose - 1) / 4));
}

/** Fireballs fly and burst; stumps they reach catch fire, then burn away. */
export function stepFire(game: AdventureGame, stage: AdventureStage, world: World): void {
  const a = game.adventure;
  for (const bolt of a.bolts) {
    bolt.tick++;
    bolt.speed += Math.trunc(((FIRE_SPEED - bolt.speed) * FIRE_EASE) / 10);
    const [sx, sy] = FACING_STEP[bolt.facing];
    bolt.x += sx * bolt.speed;
    bolt.y += sy * bolt.speed;
    const x = Math.floor(bolt.x / SUBPX), y = Math.floor(bolt.y / SUBPX);
    if (bolt.tick > FIRE_LIFETIME) bolt.tick = -1;
    else if (isSolidAt(world, x, y)) {
      igniteStumps(game, stage, x, y);
      bolt.tick = -1;
    }
  }
  if (a.bolts.some((b) => b.tick < 0)) a.bolts = a.bolts.filter((b) => b.tick >= 0);
  // Fires burning out.
  for (let i = 0; i < a.fires.length; i += 2) {
    if (++a.fires[i + 1]! < BURN_TICKS) continue;
    a.burnt.push(a.fires[i]!);
    a.fires.splice(i, 2);
    i -= 2;
  }
}

/** The stump at (x, y), if any, and those touching it, catch fire. */
function igniteStumps(game: AdventureGame, stage: AdventureStage, x: number, y: number): void {
  const a = game.adventure, base = currentArea(game, stage).base;
  if (!base) return;
  const tileAt = (i: number) => base[i]! & 0x3ff;
  const start = (y >> 4) * 32 + (x >> 4);
  if (tileAt(start) !== STUMP_TILE) return;
  const key = (i: number) => tileKey(a.room, a.area, i);
  const burning = (i: number) => a.burnt.includes(key(i)) || a.fires.some((v, k) => k % 2 === 0 && v === key(i));
  const todo = [start];
  while (todo.length) {
    const i = todo.pop()!;
    if (burning(i)) continue;
    a.fires.push(key(i), 0);
    const tx = i % 32, ty = Math.floor(i / 32);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = tx + dx, ny = ty + dy, j = ny * 32 + nx;
        if (nx >= 0 && ny >= 0 && nx < 32 && ny < 32 && tileAt(j) === STUMP_TILE && !burning(j)) todo.push(j);
      }
    }
  }
}

/** The tiles the burnt stumps show (tile index → tile), for logic.ts' rewrites. */
export function burntTiles(game: AdventureGame, out: Map<number, number>): void {
  const a = game.adventure, base = tileKey(a.room, a.area, 0);
  for (const key of a.burnt) if (key >= base && key < base + 1024) out.set(key - base, BURNT_STUMP_TILE);
}

/** A tile's key in AdventureState.burnt / fires: room, area and tile index. */
export const tileKey = (room: number, area: number, tile: number) => room * 8192 + area * 1024 + tile;
