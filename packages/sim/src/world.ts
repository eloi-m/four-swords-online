// Static collision world for a stage: every room of the layout grid laid out contiguously
// (room cell (cx, cy) spans x = cx*512…+512, y = cy*384…+384 in world pixels), sampled in 8×8 cells.
import { LAYER_TILES, MAP_GRID, slopeIndex, slopeSolid, solidMask, surfaceOf, type Stage, type Surface } from "@fso/formats";

export const ROOM_W = 512;
export const ROOM_H = 384; // the playable/visible part: top 24 of 32 tile rows
export const CELL = 8;
const ROOM_CELLS_X = ROOM_W / CELL;
const ROOM_CELLS_Y = ROOM_H / CELL;

export const SURFACE_CODES: readonly Surface[] = ["floor", "pit", "shallow", "deep", "ice", "quicksand", "ladder"];

export interface World {
  readonly widthCells: number;
  readonly heightCells: number;
  /** 1 where an 8×8 cell blocks movement. Cells outside any room are blocked. */
  readonly solid: Uint8Array;
  /** Index into SURFACE_CODES per cell. */
  readonly surface: Uint8Array;
  /** Room number per layout cell (row-major MAP_GRID × MAP_GRID), -1 for none. */
  readonly rooms: Int16Array;
  /**
   * 1 where a cell is a plain pit (tile type 0x03), not a damaging one (0x0E, lava): what tells them apart for things
   * that cross the one and not the other (bombchus.ts). Only the battle arenas have it (arena.ts).
   */
  readonly plainPit?: Uint8Array;
  /**
   * 1 where a cell is one of Above the Clouds' colored panels (tile types 0x4C-0x4F, panels.ts): a Link on one isn't
   * clear of pits, whatever its color (combat.ts safeX). Only the battle arenas have it (arena.ts).
   */
  readonly panels?: Uint8Array;
  /**
   * 1 where a cell is an empty bomb socket on the rim (entities.ts battleWorld): walked over, but no edge a fall's jump
   * back out lands on (traced: past the Tower of Flames' socket at x 416-431, back at 409).
   */
  readonly ledges?: Uint8Array;
  /** Solid boxes on top of the cells, whole px, inclusive (the adventure's big rocks: they move by fifths of a px). */
  readonly boxes?: readonly { left: number; top: number; right: number; bottom: number }[];
  /**
   * Pits whose right and bottom edges reach a pixel past their tiles (whole px, inclusive, the tiles' extent): the
   * battle's open trick floors (entities.ts battleWorld; a fall's jump back out lands a pixel further, combat.ts).
   */
  readonly widePits?: readonly { left: number; top: number; right: number; bottom: number }[];
  /** The water's current per cell (adventure/swim.ts CURRENT_TILES' index + 1, 0 none): adventure areas only. */
  readonly currents?: Uint8Array;
  /** 1 where a cell is a river stone (spike tile type 0x51; adventure/swim.ts STONE_DAMAGE): adventure areas only. */
  readonly spikes?: Uint8Array;
  /**
   * The slopes' half-solid cells (tile types 0x08-0x0B, formats' slopeSolid): per cell, slopeCell's code (0 none). A
   * slope tile is solid on one side of its diagonal; `solid` holds the quadrant wholly on that side, this the two the
   * diagonal crosses, tested by pixel (isSolidAt).
   */
  readonly slopes?: Uint8Array;
}

export function buildWorld(stage: Pick<Stage, "layout" | "layer">, tileTypes: Uint16Array): World {
  const widthCells = MAP_GRID * ROOM_CELLS_X, heightCells = MAP_GRID * ROOM_CELLS_Y;
  const solid = new Uint8Array(widthCells * heightCells).fill(1);
  const surface = new Uint8Array(widthCells * heightCells);
  const rooms = new Int16Array(MAP_GRID * MAP_GRID).fill(-1);
  let slopes: Uint8Array | undefined;
  stage.layout.rooms.forEach((row, cy) =>
    row.forEach((room, cx) => {
      if (room === null) return;
      rooms[cy * MAP_GRID + cx] = room;
      const base = stage.layer(room, 1, 0);
      if (!base) return;
      for (let ty = 0; ty < ROOM_CELLS_Y / 2; ty++) {
        for (let tx = 0; tx < LAYER_TILES; tx++) {
          const type = tileTypes[base[ty * LAYER_TILES + tx]! & 0x3ff]!;
          const mask = solidMask(type), code = SURFACE_CODES.indexOf(surfaceOf(type));
          for (let q = 0; q < 4; q++) {
            const x = cx * ROOM_CELLS_X + tx * 2 + (q & 1), y = cy * ROOM_CELLS_Y + ty * 2 + (q >> 1);
            solid[y * widthCells + x] = mask & (1 << q) ? 1 : 0;
            surface[y * widthCells + x] = code;
            const slope = slopeCell(type, q);
            if (slope) (slopes ??= new Uint8Array(widthCells * heightCells))[y * widthCells + x] = slope;
          }
        }
      }
    }),
  );
  return { widthCells, heightCells, solid, surface, rooms, ...(slopes ? { slopes } : {}) };
}

export function isSolidAt(world: World, px: number, py: number): boolean {
  const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL);
  if (cx < 0 || cy < 0 || cx >= world.widthCells || cy >= world.heightCells) return true;
  if (world.boxes?.some((b) => px >= b.left && px <= b.right && py >= b.top && py <= b.bottom)) return true;
  const i = cy * world.widthCells + cx;
  if (world.solid[i] === 1) return true;
  const slope = world.slopes?.[i];
  return slope ? slopeSolid(slope - 1, px & 15, py & 15) : false;
}

/**
 * The slope cell code (1 + formats' slopeIndex) of quadrant `q` (TL, TR, BL, BR) of a tile of `type`: the two quadrants
 * its diagonal crosses, 0 for the others (solidMask has the one wholly solid) and for any other type.
 */
export function slopeCell(type: number, q: number): number {
  const slope = slopeIndex(type);
  return slope >= 0 && q !== 3 - slope && q !== slope ? slope + 1 : 0;
}

export function surfaceAt(world: World, px: number, py: number): Surface {
  const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL);
  if (cx < 0 || cy < 0 || cx >= world.widthCells || cy >= world.heightCells) return "floor";
  return SURFACE_CODES[world.surface[cy * world.widthCells + cx]!]!;
}

/** The layout cell containing a world position. */
export function roomCellAt(px: number, py: number): { cx: number; cy: number } {
  return { cx: Math.floor(px / ROOM_W), cy: Math.floor(py / ROOM_H) };
}

export function roomAt(world: World, px: number, py: number): number {
  const { cx, cy } = roomCellAt(px, py);
  if (cx < 0 || cy < 0 || cx >= MAP_GRID || cy >= MAP_GRID) return -1;
  return world.rooms[cy * MAP_GRID + cx]!;
}
