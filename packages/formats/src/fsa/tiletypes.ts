// Tile behavior types. main.dol holds one big-endian u16 type per global tile index (the same 1024 tiles as the
// shared SPL). The table was located by correlating candidate arrays with community tile notes, then reading it from
// the game itself; the notes aren't shipped, and the type names and collision masks below are our own. Each mask is
// checked against the game where marked "verified".
import { dataView } from "../bytes.ts";
import type { Dol } from "../dol.ts";
import { TILE_COUNT } from "./bg.ts";

/** Address of the tile type table in G4SE01 rev 0. */
export const TILE_TYPE_TABLE = 0x8046cb88;

export function readTileTypes(dol: Dol): Uint16Array {
  const raw = dol.read(TILE_TYPE_TABLE, TILE_COUNT * 2);
  const v = dataView(raw);
  const types = new Uint16Array(TILE_COUNT);
  for (let i = 0; i < TILE_COUNT; i++) types[i] = v.getUint16(i * 2);
  return types;
}

export const TileType = {
  Floor: 0x00,
  Solid: 0x01,
  Background: 0x02,
  Pit: 0x03,
  DeepWater: 0x0d,
  DamagingPit: 0x0e,
  Fence: 0x20,
  Bush: 0x21,
  ShallowWater: 0x39,
  Ice: 0x50,
  Spikes: 0x51,
  Quicksand: 0x60,
  Ladder: 0x61,
} as const;

// Quadrant bits of a 16×16 tile: each 8×8 quadrant is solid or not.
export const TL = 1, TR = 2, BL = 4, BR = 8;
export const SOLID = TL | TR | BL | BR;
const TOP = TL | TR, BOTTOM = BL | BR, LEFT = TL | BL, RIGHT = TR | BR;

// Blocks of four types follow a fixed order; the first entry of each block is noted, not verified in-game yet.
const MASKS: Record<number, number> = {
  0x01: SOLID,
  0x04: TOP, 0x05: BOTTOM, 0x06: LEFT, 0x07: RIGHT, // stair and ledge edges
  0x08: BR, 0x09: BL, 0x0a: TR, 0x0b: TL, // sloped cliff corners (probably slide Link diagonally)
  0x10: TOP, 0x11: BOTTOM, 0x12: LEFT, 0x13: RIGHT, // cliff walls
  0x14: TL, 0x15: TR, 0x16: BL, 0x17: BR, // cliff corners
  0x1a: BL, 0x1b: BR, // tree trunk sides
  0x20: SOLID, 0x21: SOLID, 0x22: SOLID, 0x26: SOLID, // fence, bush, thorns, raised switch block
  0x28: TOP, 0x29: BOTTOM, 0x2a: LEFT, 0x2b: RIGHT, // door frames
  0x2e: LEFT, 0x2f: RIGHT,
  0x30: SOLID, 0x31: SOLID, 0x32: SOLID, 0x33: SOLID, 0x34: SOLID, 0x35: SOLID, 0x36: SOLID, 0x37: SOLID, 0x38: SOLID,
  0x40: SOLID, 0x41: SOLID, 0x42: SOLID, 0x43: SOLID, // steel ball spawners
  0x51: SOLID, 0x52: SOLID, 0x53: SOLID, // spikes, fragile blocks
  0x58: BR, 0x59: BL, 0x5a: TR, 0x5b: TL, 0x5c: BR, 0x5d: BL, 0x5e: TR, 0x5f: TL, // walls standing in water
};

/** Which quadrants of a tile block movement (0 = none). Unknown types are treated as open. */
export function solidMask(type: number): number {
  return MASKS[type] ?? 0;
}

export type Surface = "floor" | "pit" | "shallow" | "deep" | "ice" | "quicksand" | "ladder";

export function surfaceOf(type: number): Surface {
  if (type === TileType.Pit || type === TileType.DamagingPit) return "pit";
  if (type === TileType.DeepWater || type === 0x3b || type === 0x3e || (type >= 0x5c && type <= 0x5f)) return "deep";
  if (type === TileType.ShallowWater || (type >= 0x58 && type <= 0x5b)) return "shallow";
  if (type === TileType.Ice) return "ice";
  if (type === TileType.Quicksand) return "quicksand";
  if (type === TileType.Ladder) return "ladder";
  return "floor";
}
