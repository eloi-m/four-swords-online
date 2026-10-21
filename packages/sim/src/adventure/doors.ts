// Doors (DOOR, init 0x802C7CC8, update 0x802C59D8: a 15-state machine, mostly not decoded) and keys.
// - params: kind p & 0x7F, side (p >> 7) & 31 (0-3), (p >> 12) & 31, (p >> 17) & 1, (p >> 18) & 1, the top 5 bits a
//   switch. Its box is ±8 px around its anchor + (12, 4) on side 0, + (12, 12) on sides 1 and 2, + (4, 12) on side 3.
// - kind 3 is locked: measured in Lake Hylia room 3 (the house's door, 0x83), a Link carrying the small key walked up
//   into it; once his body (±7) met the door's box the key went, he was held 16 ticks while it opened, then walked in.
// - keys are carried (traced there too): a key (KEY0, or one the boomerang brought) lies where it is until the leader,
//   facing it from 18 px, lifts it with the Action button (the GC's R): 16 ticks lifting (state 17), then he carries
//   it overhead (state 18, the carry frames) at walking speed; `AdventureState.keys` counts the keys carried. The sword
//   and the item do nothing meanwhile; the Action press throws it (`throwKey`: traced, see KEY_WINDUP_TICKS below; the
//   key's first message: dialogue.ts). A chest's key is carried at once.
// - a thrown key lies where it lands (`AdventureState.keysDown`, kept for the stage like the rocks) and is lifted the
//   same way. Pushing a key on the floor (walking into it, it slides away and stops at a wall) is not simulated.
// - kind 0 with a switch is shut until the switch is on (Lake Hylia's houses with a four-Link switch inside; the Cave
//   of No Return's stone doors, traced: room 6's opened once its two candles burned). Kind 1 (the Cave of No Return's
//   doors with a keyhole) is taken as locked like kind 3 (hypothesis). Kind 2 is a cracked wall a bomb's blast opens
//   (measured: Hyrule Castle room 5's (80, 256), side 1: walking up into it the Link was held at y 279; a bomb flower's
//   bomb thrown up at it from (96, 289) went off at its foot and he then walked up through its warp into area 5).
//   Assumed: the blast's box (±16, bombs.ts) meeting the door's opens it. Kind 8 is a curtain (Hyrule Castle room 10's
//   throne room) a sword cuts open: its state 2 (0x802C6C60) asks each Link whether his attack meets its box (0x8023B8E4
//   → 0x80274238) and opens (states 3, 5) when one does; measured: walking up into the one over the throne the Link
//   was held at y 39, and a swing up from there opened it on the swing's first tick, for good. The other kinds (5, 6;
//   kind 0 without a switch) aren't decoded: they stand open.
// Shut doors block their box; an opened locked door stays open for the stage (AdventureState.opened). The Cave of No
// Return's doors in a room's edge are also four solid stone tiles in the wall beside the anchor (along the side:
// x + 16 … x + 64 on the top and bottom sides, y + 16 … y + 64 on the left and right): an open door shows the tiles
// on the room's side of them instead (TODO(measure): the game's own open tiles, tables at 0x8046D598).
import { attackMeets } from "../attacks.ts";
import { linkAttack } from "./whirl.ts";
import { BLAST_HALF } from "../bombs.ts";
import { boxAround, boxesOverlap, isRemoved } from "../entities.ts";
import { CARRY, frameAt, LIFT, THROW } from "../moveframes.ts";
import { Button, SUBPX, type Facing } from "../player.ts";
import { switchOn } from "../switches.ts";
import { isSolidAt, type World } from "../world.ts";
import { actorKey, currentArea, type AdventureGame } from "./adventure.ts";
import { layKey, type Pickup } from "./pickups.ts";
import type { AdventureStage, AreaActor } from "./stage.ts";

/** The key's lift (traced: state 17 for 16 ticks), how far ahead it's reached (traced from 18 px below; TODO(measure)
 *  the limit) and how high it's carried (drawn). */
export const KEY_LIFT_TICKS = 16;
export const KEY_REACH = 20;
export const KEY_ACROSS = 8;
export const KEY_HEIGHT = 18;

/**
 * The key's throw (traced in Lake Hylia room 3 with the boomerang's key, docs/measurements/adventure-lake-hylia.md "The
 * key's throw"). The Action press starts the wind-up (THROW's pose, the release on its 10th tick); the key dips to 11 px
 * for 7 ticks, rises to 15 and 20 px (KEY_WINDUP_Z). From the 10th tick it flies from the Link's spot 20 px up: each tick
 * 6 px along his facing and a fall of 0.1 × k × (k − 1) px (k = its flight tick, 1 on the release), so on the 15th it is
 * on the floor 90 px on, no bounce. A wall stops it short (traced: the house's, from 122.5 to 118), and then it drifts
 * back ½ px a tick until it lands (traced once). The Link holds from the press until the landing (the throw states 22, 23).
 * Assumed: a flight passes low posts as the boomerang does; a throw in a side view or in water isn't played.
 */
export const KEY_WINDUP_TICKS = 10;
export const KEY_WINDUP_Z: readonly number[] = [11, 11, 11, 11, 11, 11, 11, 15, 15, 20];
export const KEY_THROW_HEIGHT = 20;
export const KEY_THROW_STEP = 6 * SUBPX;
export const KEY_FALL = 0.1;
export const KEY_REBOUND = SUBPX / 2;
/** The key's box half size, px (its leading edge is tested for walls). */
const KEY_HALF = 6;

/** The key the leader lifted last: its room's actorKey (-1: none placed, a chest's), its index, its kind. */
export interface CarriedKey {
  key: number;
  actor: number;
  kind: number;
}

/** A key being thrown: the key (as CarriedKey), ticks since the press, its pickup's id once released, where it is (1/256
 *  px), its unit step, whether a wall has stopped it (then it drifts back), the height it leaves from (px), and whether
 *  a hit knocked it out of the Link's hands (knockKeyOut: no wind-up, nobody held). */
export interface KeyThrow extends CarriedKey {
  tick: number;
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  back: boolean;
  height: number;
  dropped: boolean;
}

const TOWARD: Readonly<Record<Facing, readonly [number, number]>> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };

/** The Action press facing a key on the ground: the leader lifts it (true: the press is used). */
export function liftKey(game: AdventureGame, buttons: number): boolean {
  const a = game.adventure, l = game.players[0]!, f = game.battle.fighters[0]!;
  if (!(buttons & ~l.held & Button.Action) || a.keyLift || f.mode !== "active" || f.move !== "none" || l.action !== "none") return false;
  const [dx, dy] = TOWARD[l.facing];
  const k = a.pickups.findIndex((it) => {
    if (it.type !== "key" || it.fetched || it.z > 0 || (it.gate && !switchOn(game.battle, it.gate))) return false;
    const ahead = ((it.x - l.x) * dx + (it.y - l.y) * dy) / SUBPX, across = Math.abs(dx ? it.y - l.y : it.x - l.x) / SUBPX;
    return ahead > 0 && ahead <= KEY_REACH && across <= KEY_ACROSS;
  });
  if (k < 0) return false;
  const it = a.pickups[k]!;
  if (it.actor >= 0) a.taken.push(actorKey(a.room, it.actor));
  a.carried = { key: it.actor >= 0 ? actorKey(a.room, it.actor) : -1, actor: it.actor, kind: it.kind };
  a.pickups.splice(k, 1);
  a.keys++;
  a.keyLift = KEY_LIFT_TICKS;
  a.ignore |= Button.Action;
  Object.assign(l, { moving: false, walkTicks: 0 });
  return true;
}

/** Whether the leader is lifting a key this tick (he stands); counts the lift down. */
export function stepKeyLift(game: AdventureGame): boolean {
  const a = game.adventure;
  if (a.keyLift <= 0) return false;
  a.keyLift--;
  return true;
}

/** The buttons a Link carrying a key can use: walking only. */
export const carryingKey = (game: AdventureGame, buttons: number): number => (game.adventure.keys > 0 ? buttons & ~(Button.Sword | Button.Item | Button.Action) : buttons);

/** The leader's frame lifting, carrying or throwing a key (player_sob), or -1. */
export function keyFrame(game: AdventureGame): number {
  const a = game.adventure, p = game.players[0]!;
  if (a.keyThrow && !a.keyThrow.dropped) return THROW.frames[p.facing][frameAt(THROW.ticks, a.keyThrow.tick)]!;
  if (a.keys <= 0 || a.keyThrow) return -1;
  if (a.keyLift > 0) return LIFT.frames[p.facing][Math.min(3, Math.floor(((KEY_LIFT_TICKS - a.keyLift) * 4) / KEY_LIFT_TICKS))]!;
  return p.moving ? CARRY.walk[p.facing][Math.floor(p.walkTicks / 3) % 8]! : CARRY.stand[p.facing];
}

/** The carried key's height over the leader now (px; rising while he lifts it, dipping in the wind-up). */
export const keyHeight = (game: AdventureGame): number => {
  const a = game.adventure;
  if (a.keyThrow) return a.keyThrow.dropped ? KEY_HEIGHT : (KEY_WINDUP_Z[a.keyThrow.tick] ?? 0);
  return a.keys > 0 ? Math.round((KEY_HEIGHT * (KEY_LIFT_TICKS - a.keyLift)) / KEY_LIFT_TICKS) : 0;
};

/** The Links hold still while a key is thrown (the wind-up and the flight: the throw states hold until it lands). */
export const keyThrowHolds = (game: AdventureGame): boolean => game.adventure.keyThrow !== null && !game.adventure.keyThrow.dropped;

/** The Action press with a key carried, on his feet, facing no one: the throw starts (true: the press is used). */
export function throwKey(game: AdventureGame, buttons: number): boolean {
  const a = game.adventure, l = game.players[0]!, f = game.battle.fighters[0]!;
  if (a.keys <= 0 || a.keyThrow || a.keyLift || !(buttons & ~l.held & Button.Action) || f.mode !== "active" || f.move !== "none" || l.action !== "none") return false;
  const [dx, dy] = TOWARD[l.facing], c = a.carried ?? { key: -1, actor: -1, kind: 0 };
  a.keyThrow = { ...c, tick: 0, id: 0, x: l.x, y: l.y, dx, dy, back: false, height: KEY_THROW_HEIGHT, dropped: false };
  a.carried = null;
  a.ignore |= Button.Action;
  Object.assign(l, { moving: false, walkTicks: 0 });
  return true;
}

/** Whether a thrown key's leading edge, `s` 1/256 px on along its step, meets a solid (flying things' world). */
function keyBlocked(world: World, t: KeyThrow, s: number): boolean {
  const x = (t.x + t.dx * s) / SUBPX, y = (t.y + t.dy * s) / SUBPX;
  const ex = x + t.dx * KEY_HALF, ey = y + t.dy * KEY_HALF;
  for (const side of [-5, 0, 5]) {
    if (isSolidAt(world, t.dx ? ex : x + side, t.dy ? ey : y + side)) return true;
  }
  return false;
}

/**
 * One tick of a thrown key, before the Links move: the wind-up's ticks; on the 10th the release (the key's pickup made
 * at the Link's spot, one fewer carried), then the flight: 6 px along the step (in ½ px steps up to a wall), a rebound
 * back ½ px a tick off a wall, the fall. On the landing it lies where it is (layKey: kept for the stage). `world`: the
 * area's solids as flying things see them (flyingWorld).
 */
export function stepKeyThrow(game: AdventureGame, world: World): void {
  const a = game.adventure, t = a.keyThrow;
  if (!t) return;
  t.tick++;
  if (t.tick < KEY_WINDUP_TICKS) return;
  if (t.tick === KEY_WINDUP_TICKS) {
    a.keys--;
    const it: Pickup = { id: a.nextId++, type: "key", from: "KEY0", actor: t.actor, x: t.x, y: t.y, z: t.height * SUBPX, kind: t.kind, gate: 0, tick: 0, vz: 0 };
    a.pickups.push(it);
    t.id = it.id;
  }
  const it = a.pickups.find((p) => p.id === t.id);
  if (!it) {
    // A safety net: a room change lands a key in flight (spawnPickups), so its pickup is always there.
    a.keyThrow = null;
    return;
  }
  if (t.back) {
    t.x -= t.dx * KEY_REBOUND;
    t.y -= t.dy * KEY_REBOUND;
  } else {
    let s = KEY_THROW_STEP;
    while (s > 0 && keyBlocked(world, t, s)) s -= SUBPX / 2;
    t.x += t.dx * s;
    t.y += t.dy * s;
    if (s < KEY_THROW_STEP) t.back = true;
  }
  const k = t.tick - KEY_WINDUP_TICKS + 1, z = t.height - KEY_FALL * k * (k - 1);
  it.x = t.x;
  it.y = t.y;
  if (z > 0) {
    it.z = Math.round(z * SUBPX);
    return;
  }
  it.z = 0;
  if (t.key >= 0) layKey(a, t.key, t.x, t.y);
  a.keyThrow = null;
}

/**
 * A hit on the leader carrying a key (or lifting it) knocks it out of his hands (traced in the Cave of No Return's room
 * 1, a fireball trap's shot: docs/measurements/adventure-world1.md "The fireball traps"): from the next tick it flies
 * as a thrown key does, without the wind-up, from his spot at the carried height (18 px): 6 px a tick along his facing
 * (up there, his knockback going left), the same fall, stopped and drifting back off a wall; he's knocked back meanwhile.
 * Assumed: along his facing whatever the hit's way (one case seen), and so from any hit that isn't blocked.
 */
export function knockKeyOut(game: AdventureGame): void {
  const a = game.adventure, l = game.players[0]!;
  if (a.keys <= 0 || a.keyThrow || !game.battle.hits.some((h) => h.victim === 0 && !h.blocked)) return;
  const [dx, dy] = TOWARD[l.facing], c = a.carried ?? { key: -1, actor: -1, kind: 0 };
  a.keyThrow = { ...c, tick: KEY_WINDUP_TICKS - 1, id: 0, x: l.x, y: l.y, dx, dy, back: false, height: KEY_HEIGHT, dropped: true };
  a.carried = null;
  a.keyLift = 0;
}

/** Ticks a locked door takes to open once the key is in (measured: the Link was held 16 ticks). */
export const DOOR_OPEN_TICKS = 17;
/** A door's box half size (init: ±8). */
export const DOOR_HALF = 8;
/** The part of a shut door that blocks (doorWorld). */
const DOOR_BLOCK = 4;
const BODY_HALF = 7;

const SIDE_OFFSET: readonly (readonly [number, number])[] = [[12, 4], [12, 12], [12, 12], [4, 12]];

/**
 * A door's box middle (area px). (p >> 12) & 31 moves it along its wall 16 px a step (the Cave of No Return's doors
 * have 2: measured in its room 13, the Link carrying the key pushing right at y 140 by the door at (480, 128) opened
 * nothing, at y 172 it opened at once; Lake Hylia's have 0).
 */
export function doorCenter(a: AreaActor): { x: number; y: number } {
  const side = (a.params >>> 7) & 3, [dx, dy] = SIDE_OFFSET[side]!, along = ((a.params >>> 12) & 31) * 16;
  return side < 2 ? { x: a.x + dx + along, y: a.y + dy } : { x: a.x + dx, y: a.y + dy + along };
}

const doorKind = (a: AreaActor) => a.params & 0x7f;

/** Whether a door blocks the way now. */
export function doorShut(game: AdventureGame, a: AreaActor): boolean {
  const kind = doorKind(a), sw = a.params >>> 27;
  if (kind === 3 || kind === 1) return !game.adventure.opened.includes(actorKey(game.adventure.room, a.index)) || (game.adventure.opening?.actor === a.index && game.adventure.opening.tick < DOOR_OPEN_TICKS);
  if (kind === 0 && sw) return !switchOn(game.battle, sw);
  if (kind === CRACKED || kind === CURTAIN) return !game.adventure.opened.includes(actorKey(game.adventure.room, a.index));
  return false;
}

/** The curtain's kind (cut open by a sword). */
export const CURTAIN = 8;

/** A Link's sword meeting a curtain (kind 8) cuts it open, for good. */
function cutCurtains(game: AdventureGame, stage: AdventureStage): void {
  const a = game.adventure;
  for (const d of currentArea(game, stage).actors) {
    if (d.id !== "DOOR" || doorKind(d) !== CURTAIN || a.opened.includes(actorKey(a.room, d.index))) continue;
    const c = doorCenter(d), h = DOOR_HALF * SUBPX;
    const box = { left: c.x * SUBPX - h, top: c.y * SUBPX - h, right: c.x * SUBPX + h, bottom: c.y * SUBPX + h };
    const cut = game.players.some((p, i) => {
      const attack = game.battle.fighters[i]!.mode === "active" ? linkAttack(game, i) : null;
      return !!attack && attackMeets(attack, box);
    });
    if (cut) a.opened.push(actorKey(a.room, d.index));
  }
}

/** The cracked wall's kind (blown open by a bomb). */
export const CRACKED = 2;

/** Bombs' blasts open the cracked walls (kind 2) they meet, for good. */
function blastWalls(game: AdventureGame, stage: AdventureStage): void {
  const a = game.adventure;
  const blasts = game.battle.entities.filter((e) => e.kind === "explosion" && !isRemoved(e));
  if (!blasts.length) return;
  for (const d of currentArea(game, stage).actors) {
    if (d.id !== "DOOR" || doorKind(d) !== CRACKED || a.opened.includes(actorKey(a.room, d.index))) continue;
    const c = doorCenter(d), box = boxAround(c.x * SUBPX, c.y * SUBPX, DOOR_HALF);
    if (blasts.some((e) => boxesOverlap(box, boxAround(e.x, e.y, BLAST_HALF)))) a.opened.push(actorKey(a.room, d.index));
  }
}

/** The current area's doors that block the way now. */
export function shutDoors(game: AdventureGame, stage: AdventureStage): AreaActor[] {
  return currentArea(game, stage).actors.filter((a) => a.id === "DOOR" && doorShut(game, a));
}

/** A locked door takes a key from a Link touching it; an opening door counts its ticks. */
export function stepDoors(game: AdventureGame, stage: AdventureStage): void {
  const a = game.adventure;
  blastWalls(game, stage);
  cutCurtains(game, stage);
  if (a.opening) {
    if (++a.opening.tick >= DOOR_OPEN_TICKS) a.opening = null;
    return;
  }
  if (a.keys <= 0) return;
  for (const d of currentArea(game, stage).actors) {
    if (d.id !== "DOOR" || (doorKind(d) !== 3 && doorKind(d) !== 1) || a.opened.includes(actorKey(a.room, d.index))) continue;
    const c = doorCenter(d);
    const touching = game.players.some((p) => Math.abs(p.x / SUBPX - c.x) <= DOOR_HALF + BODY_HALF && Math.abs(p.y / SUBPX - c.y) <= DOOR_HALF + BODY_HALF);
    if (!touching) continue;
    a.keys--;
    a.opened.push(actorKey(a.room, d.index));
    a.opening = { actor: d.index, tick: 0 };
    return;
  }
}

const blocked = new WeakMap<World, Map<string, World>>();

/**
 * `world` with the shut doors solid: the 8 px cells under their middle ±4 px (measured: walking up into Lake Hylia's
 * house door the Link was held at y 119, the door's middle at 108; the sim's Link stops 7 px short of a wall).
 */
export function doorWorld(world: World, doors: readonly AreaActor[]): World {
  if (!doors.length) return world;
  const key = doors.map((d) => d.index).join(",");
  let cache = blocked.get(world);
  if (!cache) blocked.set(world, (cache = new Map()));
  const hit = cache.get(key);
  if (hit) return hit;
  const solid = world.solid.slice();
  for (const d of doors) {
    const c = doorCenter(d);
    // A cracked wall is its wall's tiles over the warp behind it: its box's width, 16 px up from 4 px below its middle
    // (measured: the Link held at y 279 under room 5's, middle 268); a curtain its box's width too (the Link held at
    // y 39 under room 10's area 2's, middle 28).
    const cracked = doorKind(d) === CRACKED, half = cracked || doorKind(d) === CURTAIN ? DOOR_HALF : DOOR_BLOCK;
    const x0 = (c.x - half) >> 3, x1 = (c.x + half - 1) >> 3;
    const y0 = (c.y - (cracked ? 12 : DOOR_BLOCK)) >> 3, y1 = (c.y + DOOR_BLOCK - 1) >> 3;
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if (cx >= 0 && cy >= 0 && cx < world.widthCells && cy < world.heightCells) solid[cy * world.widthCells + cx] = 1;
  }
  const out: World = { ...world, solid };
  if (cache.size > 16) cache.clear();
  cache.set(key, out);
  return out;
}

/** Along a side, the stones' first tile and step (tiles) from the anchor; where the open tile is taken from. */
const STONES: readonly { at: readonly [number, number]; step: readonly [number, number]; from: readonly [number, number] }[] = [
  { at: [1, 0], step: [1, 0], from: [0, 1] }, // 0: the bottom side
  { at: [1, 0], step: [1, 0], from: [0, -1] }, // 1: the top
  { at: [0, 1], step: [0, 1], from: [-1, 0] }, // 2: the left
  { at: [0, 1], step: [0, 1], from: [1, 0] }, // 3: the right
];

/** The tiles open doors show instead of their stones (tile index → tile), for logic.ts' rewrites. */
export function openDoorTiles(game: AdventureGame, stage: AdventureStage, out: Map<number, number>): void {
  const area = currentArea(game, stage), base = area.base;
  if (!base) return;
  for (const d of area.actors) {
    if (d.id !== "DOOR") continue;
    const kind = doorKind(d), sw = d.params >>> 27;
    const opens = (kind === 0 && sw > 0) || kind === 1 || kind === 3;
    if (!opens || doorShut(game, d)) continue;
    const s = STONES[(d.params >>> 7) & 3]!, tx = d.x >> 4, ty = d.y >> 4;
    // Only a door with stones (the Cave of No Return's) has floor on the room's side of them; others (Lake Hylia's
    // house doors) would show the wall behind (solid, type 1), so they keep their tiles (TODO(measure): their open look).
    const source = (k: number) => base[(ty + s.at[1] + k * s.step[1] + s.from[1]) * 32 + tx + s.at[0] + k * s.step[0] + s.from[0]];
    if ([0, 1, 2, 3].some((k) => { const t = source(k); return t !== undefined && stage.typeOf(t) === 1; })) continue;
    for (let k = 0; k < 4; k++) {
      const x = tx + s.at[0] + k * s.step[0], y = ty + s.at[1] + k * s.step[1], fx = x + s.from[0], fy = y + s.from[1];
      if (x < 0 || y < 0 || x >= 32 || y >= 32 || fx < 0 || fy < 0 || fx >= 32 || fy >= 32) continue;
      const i = y * 32 + x;
      if (stage.typeOf(base[i]!) !== 1) continue;
      out.set(i, base[fy * 32 + fx]! & 0x3ff);
    }
  }
}
