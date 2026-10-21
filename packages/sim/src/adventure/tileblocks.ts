// Things of the Cave of No Return's rooms that are tiles or watch tiles:
// - movable blocks: base-layer tiles of types 0x35-0x38, each pushed one way (measured in room 7: 0x38 left, 0x37
//   right, 0x36 down; 0x35 assumed up). Room 7's fenced middle is shut by two of them (down, then left). The leader walks into one; on the 21st tick without progress he leans
//   on it (push.ts) and from the next tick it slides one tile (16 px) at 0.5 px/tick, the Link with it, if the tile
//   beyond is free floor (no enemy on it: assumed); then it stays: a lean on it again does nothing (measured in room 7,
//   a block goes once only; stepBlocks applies that to the Cave alone). The game reloads them with the room (here: when
//   the Links leave the area). (Room 7: four blocks pushed out onto four PONTs put the fire round the key's chest out.)
// - PONT "point check NPC" (init 0x802AB9DC, update 0x802AB238): it notes the tile under it; kind p & 31 = 3 sets its
//   switch (the top 5 bits) once that tile changes (a block pushed onto it, a pot lifted off it…), with a chime. Its
//   other kinds (0, 9…) aren't decoded.
// - FLME of kind 5 (params & 0xFF; init 0x8015EDF4 starts it at full size): a ring of fire that burns until its switch
//   is on, then shrinks away (room 7's round the key's chest: measured, gone ~25 ticks after the fourth block). Here
//   it blocks a ±40 px square round its anchor less 8 px up, the chest inside ±24 left open (TODO(measure): its box,
//   its burns).
import { SUBPX, type Facing } from "../player.ts";
import { setSwitch, switchOn } from "../switches.ts";
import { isSolidAt, type World } from "../world.ts";
import { currentArea, type AdventureGame } from "./adventure.ts";
import type { AdventureStage, AreaActor } from "./stage.ts";

/** The Cave of No Return's stage index (boss011): where a moved block stays put (stepBlocks). */
export const CAVE_STAGE = 11;
/** A block's slide: ticks (0.5 px/tick over a tile). */
export const BLOCK_SLIDE_TICKS = 32;
const BLOCK_STEP = SUBPX / 2;
/** Movable block tile types and the way each goes. */
export const BLOCK_WAYS: Readonly<Record<number, Facing>> = { 0x35: "up", 0x36: "down", 0x37: "right", 0x38: "left" };
const STEP: Readonly<Record<Facing, readonly [number, number]>> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };

/** A block moved in the current area: from and to (tile indices ty * 32 + tx), its tile, ticks into its slide. */
export interface MovedBlock {
  from: number;
  to: number;
  tile: number;
  tick: number;
}

/** The tiles the current area's moved blocks show (tile index → tile), for logic.ts' rewrites. */
export function blockTiles(game: AdventureGame, stage: AdventureStage, out: Map<number, number>): void {
  const base = currentArea(game, stage).base;
  if (!base) return;
  for (const b of game.adventure.blocks) {
    if (b.tick < BLOCK_SLIDE_TICKS) continue;
    // The floor it slid over goes where it was.
    out.set(b.from, base[b.to]! & 0x3ff);
    out.set(b.to, b.tile);
  }
}

/** The world with the sliding blocks' tiles solid at both ends. */
export function blockWorld(world: World, game: AdventureGame): World {
  const sliding = game.adventure.blocks.filter((b) => b.tick < BLOCK_SLIDE_TICKS);
  if (!sliding.length) return world;
  const solid = world.solid.slice();
  for (const b of sliding) {
    for (const i of [b.from, b.to]) {
      const tx = i % 32, ty = Math.floor(i / 32);
      for (let q = 0; q < 4; q++) solid[(ty * 2 + (q >> 1)) * world.widthCells + tx * 2 + (q & 1)] = 1;
    }
  }
  return { ...world, solid };
}

/**
 * After the leader's step: a block he leans on (push.ts) starts sliding the way he pushes if it goes that way and the
 * tile beyond is free; a sliding block moves on, and him with it.
 */
export function stepBlocks(game: AdventureGame, stage: AdventureStage, view: World, tiles: ReadonlyMap<number, number>): void {
  const a = game.adventure, p = game.players[0]!, area = currentArea(game, stage);
  for (const b of a.blocks) {
    if (b.tick >= BLOCK_SLIDE_TICKS) continue;
    b.tick++;
    const [dx, dy] = STEP[wayOf(b)];
    if (a.push.on) {
      p.x += dx * BLOCK_STEP;
      p.y += dy * BLOCK_STEP;
    }
  }
  if (!a.push.on || a.blocks.some((b) => b.tick < BLOCK_SLIDE_TICKS) || !area.base) return;
  const [dx, dy] = STEP[p.facing];
  const fx = Math.floor(p.x / SUBPX) + dx * 8, fy = Math.floor(p.y / SUBPX) + dy * 8;
  if (fx < 0 || fy < 0 || fx >= area.w || fy >= area.h) return;
  const from = (fy >> 4) * 32 + (fx >> 4);
  // A block that has moved stays moved (measured in the Cave's room 7: its tile still reads as a block where it stopped).
  // Hyrule Castle's room 1 blocks keep sliding again: its route's walk up relies on it, and that isn't measured.
  if (stage.index === CAVE_STAGE && a.blocks.some((b) => b.to === from)) return;
  const tile = tiles.get(from) ?? area.base[from]! & 0x3ff;
  if (BLOCK_WAYS[stage.typeOf(tile)] !== p.facing) return;
  const tx = (from % 32) + dx, ty = Math.floor(from / 32) + dy;
  if (tx < 0 || ty < 0 || tx >= 32 || ty >= area.h / 16) return;
  const to = ty * 32 + tx;
  const there = tiles.get(to) ?? area.base[to]! & 0x3ff;
  if (stage.typeOf(there) !== 0 || isSolidAt(view, tx * 16 + 8, ty * 16 + 8)) return;
  // Nor onto an enemy (assumed).
  const inside = (x: number, y: number) => Math.abs(x / SUBPX - (tx * 16 + 8)) < 16 && Math.abs(y / SUBPX - (ty * 16 + 8)) < 16;
  if (a.enemies.some((e) => e.life > 0 && inside(e.x, e.y))) return;
  a.blocks.push({ from, to, tile, tick: 0 });
}

const wayOf = (b: MovedBlock): Facing => (b.to === b.from + 1 ? "right" : b.to === b.from - 1 ? "left" : b.to > b.from ? "down" : "up");

/** Where a sliding block is drawn (area px, its top-left), or null when it's not sliding. */
export function slidingBlock(b: MovedBlock): { x: number; y: number } | null {
  if (b.tick >= BLOCK_SLIDE_TICKS) return null;
  const [dx, dy] = STEP[wayOf(b)];
  const k = (b.tick * 16) / BLOCK_SLIDE_TICKS;
  return { x: (b.from % 32) * 16 + dx * k, y: Math.floor(b.from / 32) * 16 + dy * k };
}

/** PONTs of kind 3 whose tile changed set their switches (`tiles`: logic.ts' rewrites, the arena's cut tiles). */
export function stepPoints(game: AdventureGame, stage: AdventureStage, tiles: ReadonlyMap<number, number>): void {
  const area = currentArea(game, stage), b = game.battle;
  if (!area.base) return;
  for (const pt of area.actors) {
    if (pt.id !== "PONT" || (pt.params & 31) !== 3) continue;
    const own = pt.params >>> 27;
    if (!own || switchOn(b, own)) continue;
    const i = (pt.y >> 4) * 32 + (pt.x >> 4), was = area.base[i]! & 0x3ff;
    if ((tiles.get(i) ?? was) !== was || b.cut.includes(i)) setSwitch(b, own, true);
  }
}

// --- rings of fire ---

export const RING_HALF = 40;
export const RING_HOLE = 24;
const RING_UP = 8;
const isRing = (a: AreaActor) => a.id === "FLME" && (a.params & 0xff) === 5;

/** The current area's rings of fire still burning (their switch off). */
export function burningRings(game: AdventureGame, stage: AdventureStage): AreaActor[] {
  return currentArea(game, stage).actors.filter((a) => isRing(a) && !switchOn(game.battle, a.params >>> 27));
}

/** The world with the burning rings solid (a square ring round their middle). */
export function ringWorld(world: World, game: AdventureGame, stage: AdventureStage): World {
  const rings = burningRings(game, stage);
  if (!rings.length) return world;
  const solid = world.solid.slice();
  for (const r of rings) {
    const cx = r.x, cy = r.y - RING_UP;
    for (let y = cy - RING_HALF; y < cy + RING_HALF; y += 8) {
      for (let x = cx - RING_HALF; x < cx + RING_HALF; x += 8) {
        if (Math.abs(x + 4 - cx) < RING_HOLE && Math.abs(y + 4 - cy) < RING_HOLE) continue;
        const gx = x >> 3, gy = y >> 3;
        if (gx >= 0 && gy >= 0 && gx < world.widthCells && gy < world.heightCells) solid[gy * world.widthCells + gx] = 1;
      }
    }
  }
  return { ...world, solid };
}

/** FLMEs the battle code doesn't animate in the adventure (rings of fire: here). */
export const isFireRing = isRing;
