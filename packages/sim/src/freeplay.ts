// Free play: up to 8 Links on stage 4-2's field (four screens of a graveyard, walled all round), with no rounds and no
// damage (battle.ts rules.free), until someone starts a real battle. The map is a plain World from the origin, built
// from the stage like any other; every peer online builds the same one and the same spawns from the same inputs.
//
// It runs with NO_PROPS (no bushes to cut or lift, no orbs, no hazards), and must: the props' tiles are indexed
// ty * 32 + tx (entities.ts tileIndexAt, battleWorld's patches, carry.ts, strike.ts), one room wide at the origin, so on
// this map two rooms wide they would name the wrong tiles.
import type { Stage } from "@fso/formats";
import { createBattle, DEFAULT_RULES, type Spawn } from "./battle.ts";
import { PIT_PROBE } from "./combat.ts";
import { cos4096, sin4096, TRIG_ONE } from "./entities.ts";
import type { GameState } from "./game.ts";
import { HITBOX } from "./player.ts";
import { NO_PROPS } from "./props.ts";
import { buildWorld, CELL, isSolidAt, ROOM_H, ROOM_W, roomAt, SURFACE_CODES, surfaceAt, type World } from "./world.ts";

export const FREE_STAGE = "boss042";
/** Rows of room numbers: stage 4-2's field, rows 3-4 and columns 0-1 of its layout grid. */
export const FREE_ROOMS: readonly (readonly number[])[] = [
  [3, 4],
  [1, 2],
];
export const FREE_W = FREE_ROOMS[0]!.length * ROOM_W;
export const FREE_H = FREE_ROOMS.length * ROOM_H;
/** Links free play places are at least this far apart (Manhattan, px). */
export const FREE_SPACING = 32;

const PIT = SURFACE_CODES.indexOf("pit");

/** The free-play map: FREE_ROOMS from the origin (FREE_W × FREE_H px, solid all round), from `Boss/${FREE_STAGE}.arc`. */
export function freeWorld(stage: Pick<Stage, "layout" | "layer">, tileTypes: Uint16Array): World {
  const layout = { ...stage.layout, rooms: FREE_ROOMS.map((row) => [...row]) };
  return buildWorld({ layout, layer: (room, group, sublayer) => stage.layer(room, group, sublayer) }, tileTypes);
}

const walkable = (world: World, cell: number) => world.solid[cell] === 0 && world.surface[cell] !== PIT;

/** Labels the walkable cells 4-connected to `start` that are still 0 in `labels` with `label`; returns how many. */
function fill(world: World, start: number, labels: Uint8Array | Int32Array, label: number): number {
  if (labels[start] !== 0 || !walkable(world, start)) return 0;
  const w = world.widthCells, stack = [start];
  labels[start] = label;
  let n = 0;
  while (stack.length) {
    const cell = stack.pop()!, x = cell % w;
    n++;
    for (const next of [x > 0 ? cell - 1 : -1, x < w - 1 ? cell + 1 : -1, cell - w, cell + w]) {
      if (next < 0 || next >= labels.length || labels[next] !== 0 || !walkable(world, next)) continue;
      labels[next] = label;
      stack.push(next);
    }
  }
  return n;
}

const cellAt = (world: World, x: number, y: number) => {
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  return cx < 0 || cy < 0 || cx >= world.widthCells || cy >= world.heightCells ? -1 : cy * world.widthCells + cx;
};

/**
 * The walkable island around (x, y) px: 1 per 8 px cell of `world` that a Link can walk to from there, else 0 (cells
 * neither solid nor pit, 4-connected; a gap one cell wide counts, though Link's body needs two). All 0 when (x, y)
 * isn't walkable itself.
 */
export function islandAt(world: World, x: number, y: number): Uint8Array {
  const out = new Uint8Array(world.widthCells * world.heightCells), cell = cellAt(world, x, y);
  if (cell >= 0) fill(world, cell, out, 1);
  return out;
}

/** Whether a Link can stand with his anchor at (x, y) px: no wall under his hitbox, no pit under him. */
export function standsAt(world: World, x: number, y: number): boolean {
  return (
    [HITBOX.left, HITBOX.right].every((dx) => [HITBOX.top, HITBOX.bottom].every((dy) => !isSolidAt(world, x + dx, y + dy))) &&
    surfaceAt(world, x + PIT_PROBE.x, y + PIT_PROBE.y) !== "pit"
  );
}

const apart = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) >= FREE_SPACING;

/**
 * Up to `count` spots (px) for Links to stand on (standsAt), found in rings around `center` (every 8 px out to 240 px,
 * 16 directions each): at least FREE_SPACING apart, and all on one island (islandAt), the center's or else the first
 * spot's, so the Links can reach each other. Short of spots, the rest are the center. Integer math only: the same
 * spots on every machine.
 */
export function openSpots(world: World, center: { x: number; y: number }, count: number): { x: number; y: number }[] {
  const start = cellAt(world, center.x, center.y);
  let island = start >= 0 && walkable(world, start) ? islandAt(world, center.x, center.y) : null;
  const out: { x: number; y: number }[] = [];
  for (let r = 0; r < 240 && out.length < count; r += 8) {
    for (let a = 0; a < 16 && out.length < count; a++) {
      const spot = { x: center.x + Math.round((r * cos4096(a << 12)) / TRIG_ONE), y: center.y + Math.round((r * sin4096(a << 12)) / TRIG_ONE) };
      if (!standsAt(world, spot.x, spot.y) || !out.every((p) => apart(p, spot))) continue;
      island ??= islandAt(world, spot.x, spot.y);
      if (island[cellAt(world, spot.x, spot.y)] === 1) out.push(spot);
    }
  }
  while (out.length < count) out.push({ ...center });
  return out;
}

/**
 * Where `count` Links start free play on the free world: openSpots around the cell of the map's largest walkable
 * island nearest the map's middle, facing down.
 */
export function freeSpawns(world: World, count: number): Spawn[] {
  const w = world.widthCells, labels = new Int32Array(w * world.heightCells);
  let largest = 0, size = 0;
  for (let cell = 0, next = 1; cell < labels.length; cell++) {
    const n = fill(world, cell, labels, next);
    if (n === 0) continue;
    if (n > size) [largest, size] = [next, n];
    next++;
  }
  const mx = FREE_W / 2 / CELL, my = FREE_H / 2 / CELL;
  let center = { x: FREE_W / 2, y: FREE_H / 2 }, best = Infinity;
  for (let cell = 0; cell < labels.length; cell++) {
    if (labels[cell] !== largest) continue;
    const cx = cell % w, cy = Math.floor(cell / w), d = (cx - mx) ** 2 + (cy - my) ** 2;
    if (d < best) [best, center] = [d, { x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 }];
  }
  return openSpots(world, center, count).map((s) => ({ ...s, facing: "down" }));
}

/**
 * Frame 0 of free play with `players` Links (1-8) on freeWorld: the default rules made free (hearts shown, never
 * lost), no props; `seed` seeds the battle's random generator. `kept[i]`, when set, is where player i stands already
 * (free play restarting for someone who joined or left, the others staying put), unless a Link couldn't stand there;
 * the other players take the first freeSpawns FREE_SPACING away from every kept Link. GameState.room is the first
 * Link's room.
 */
export function createFreePlay(world: World, players: number, seed = 1, kept: readonly (Spawn | null | undefined)[] = []): GameState {
  const stay = Array.from({ length: players }, (_, i) => {
    const s = kept[i];
    return s && standsAt(world, s.x, s.y) ? { x: s.x, y: s.y, facing: s.facing } : null;
  });
  const taken = stay.filter((s) => s !== null);
  // (a kept Link may stand near several of the spawns: enough of them that each newcomer still finds one)
  const open = freeSpawns(world, players + 4 * taken.length).filter((s) => taken.every((t) => apart(t, s)));
  const spawns = stay.map((s) => s ?? open.shift() ?? { ...taken[0]! });
  const state = createBattle(-1, spawns, { ...DEFAULT_RULES, free: true }, NO_PROPS, seed);
  state.room = roomAt(world, spawns[0]!.x, spawns[0]!.y);
  return state;
}
