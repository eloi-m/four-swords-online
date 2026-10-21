// Shadow Battle arenas (boss500): each arena is one room, simulated on its own with the room's top-left at world
// (0, 0) and everything outside it solid, so nobody walks into the next arena of the stage grid. Its side rooms (the
// GBA screens: siderooms.ts) lie below it in the same world, each its sublayer's base layer at sideRoomY.
import { actorPixel, battleArenaName, LAYER_TILES, solidMask, surfaceOf, TileType, type Stage } from "@fso/formats";
import type { Spawn } from "./battle.ts";
import { SUBPX, type Facing } from "./player.ts";
import { DOOR_TILES, sideRoomsOf, stageWarps } from "./props.ts";
import { DOOR_STYLES, HOLE_STYLE, sideRoomY } from "./siderooms.ts";
import { buildWorld, CELL, ROOM_H, ROOM_W, SURFACE_CODES, type World } from "./world.ts";

export const ARENA_W = ROOM_W;
export const ARENA_H = ROOM_H;
/** boss500 rooms: 0-4 = the five arenas, 5-9 = their Dark World variants (hypothesis, see docs/formats.md). */
export const ARENA_ROOMS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export function arenaName(room: number): string {
  return battleArenaName(room) ?? `Room ${room}`;
}

/**
 * Actors that block their 16×16 tile. `TOMI` ("transparent NPC wall" in enemyparam.csv) sits tile-aligned in the
 * Field's lake, next to the stakes. TODO(measure) their real extent.
 */
export const WALL_ACTORS: readonly string[] = ["TOMI"];

/**
 * Collision type 0x0C: the Tower of Flames' rim (tile 0x85 round its floor, the void beyond it), a wall (traced: a Link
 * walking right from his start stopped with his body's side on it, at x 409, and walking down at y 233; formats'
 * solidMask leaves the type open). Applied to the arenas' TV only; the type is all over the adventure's stages too,
 * untested there. The Dark World tower has no rim.
 */
export const RIM = 0x0c;

/**
 * Collision for one arena room, alone at the world origin, and its side rooms below it (the top 24 tile rows of each
 * sublayer's base layer at siderooms.ts sideRoomY; the rows between them stay solid).
 */
export function buildArenaWorld(stage: Stage, tileTypes: Uint16Array, room: number): World {
  const world = buildWorld({ layout: { ...stage.layout, rooms: [[room]] }, layer: (r, group, sublayer) => stage.layer(r, group, sublayer) }, tileTypes);
  for (const actor of stage.actors(room)) {
    if (actor.sublayer !== 0 || !WALL_ACTORS.includes(actor.id)) continue;
    for (let q = 0; q < 4; q++) world.solid[(actor.y + (q >> 1)) * world.widthCells + actor.x + (q & 1)] = 1; // positions are in 8 px cells
  }
  const { rooms } = sideRoomsOf(stage, tileTypes, room);
  const plainPit = new Uint8Array(world.widthCells * world.heightCells);
  for (let k = 0; k < 8; k++) {
    const base = k === 0 || rooms & (1 << k) ? stage.layer(room, 1, k) : null;
    const top = sideRoomY(k) / CELL;
    if (!base || top + ROOM_H / CELL > world.heightCells) continue;
    for (let ty = 0; ty < ROOM_H / 16; ty++) {
      for (let tx = 0; tx < LAYER_TILES; tx++) {
        const type = tileTypes[base[ty * LAYER_TILES + tx]! & 0x3ff]!;
        const mask = solidMask(type), code = SURFACE_CODES.indexOf(surfaceOf(type));
        for (let q = 0; q < 4; q++) {
          const i = (top + ty * 2 + (q >> 1)) * world.widthCells + tx * 2 + (q & 1);
          plainPit[i] = type === TileType.Pit ? 1 : 0;
          if (k === 0 && type === RIM) world.solid[i] = 1;
          if (k === 0) continue; // (the TV: buildWorld's)
          world.solid[i] = mask & (1 << q) ? 1 : 0;
          world.surface[i] = code;
        }
      }
    }
  }
  Object.assign(world, { plainPit });
  // A door is open under its box (the Tower of Flames' doors and the side rooms' ways out are walked straight into),
  // but The Field's house door: its tiles (0x19C/0x19D, type 1) stop a Link at y 183 until he has pushed them open
  // (traced: siderooms.ts openDoors).
  for (const w of stageWarps(stage, tileTypes, room)) {
    if (w.style === HOLE_STYLE) {
      // A hole's tile is no pit: the hole takes a Link who gets onto it (siderooms.ts), without the pit's damage.
      const tx = Math.floor(w.x / 16), ty = Math.floor(w.y / 16);
      for (let q = 0; q < 4; q++) world.surface[(ty * 2 + (q >> 1)) * world.widthCells + tx * 2 + (q & 1)] = SURFACE_CODES.indexOf("floor");
      continue;
    }
    if (!DOOR_STYLES.has(w.style)) continue;
    // The Field's house door stays shut until a Link pushes it open (siderooms.ts openDoors: its tiles are cut then).
    const tv = stage.layer(room, 1, 0);
    if (w.y < ROOM_H && tv && DOOR_TILES.has(tv[Math.floor(w.y / 16) * LAYER_TILES + Math.floor(w.x / 16)]! & 0x3ff)) continue;
    const x0 = Math.floor((w.x * SUBPX + w.left) / SUBPX / CELL), x1 = Math.floor((w.x * SUBPX + w.right) / SUBPX / CELL);
    const y0 = Math.floor((w.y * SUBPX + w.top) / SUBPX / CELL), y1 = Math.floor((w.y * SUBPX + w.bottom) / SUBPX / CELL);
    for (let y = Math.max(0, y0); y <= Math.min(world.heightCells - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(world.widthCells - 1, x1); x++) world.solid[y * world.widthCells + x] = 0;
  }
  return world;
}

/** Where a start faces: sideways toward the arena's middle, where the rival next to him stands. TODO(measure) */
export function startFacing(x: number): Facing {
  return x < ARENA_W / 2 ? "right" : "left";
}

/**
 * The room's player starts: `PLAS` actors on the TV screen, whose parameter low byte is the player index (0-3).
 * They sit on tile centers; Link's anchor goes there.
 */
export function arenaSpawns(stage: Stage, room: number): Spawn[] {
  const spawns: Spawn[] = [];
  for (const actor of stage.actors(room)) {
    if (actor.id !== "PLAS" || actor.sublayer !== 0) continue;
    const { x, y } = actorPixel(actor);
    spawns[actor.params & 0xff] = { x, y, facing: startFacing(x) };
  }
  return spawns.filter((s) => s !== undefined);
}

/**
 * Eight starts from an arena's four (arenaSpawns), for a battle of more than 4: the four, then for each one a start
 * halfway beyond it, away from the middle of the four, facing the same way. Fit for The Field and Hyrule Castle (rooms
 * 0, 3, 5, 8) only: on the towers and Above the Clouds the new ones land in walls or pits.
 */
export function moreSpawns(spawns: readonly Spawn[]): Spawn[] {
  const n = spawns.length;
  const cx = Math.floor(spawns.reduce((sum, s) => sum + s.x, 0) / n), cy = Math.floor(spawns.reduce((sum, s) => sum + s.y, 0) / n);
  return [...spawns, ...spawns.map((s) => ({ x: s.x + ((s.x - cx) >> 1), y: s.y + ((s.y - cy) >> 1), facing: s.facing }))];
}
