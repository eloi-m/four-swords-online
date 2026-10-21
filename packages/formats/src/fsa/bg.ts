// FSA background graphics, GBA-style and little-endian:
// - SCH: 4bpp 8×8 "parts", 32 bytes each, low nibble = left pixel. The char sheet holds 1024 parts:
//   0x0000-0x5FFF tileset (`bg_<id>_sch`), 0x6000-0x6FFF shared (`bg_base_sch`), 0x7000-0x7FFF empty (as seen in Dolphin).
//   Animated tiles overwrite slices of it at runtime (bganim.ts).
// - SCL: 16 palettes × 16 colors, BGR555 (bits 0-4 red, 5-9 green, 10-14 blue). Color 0 is transparent.
// - SPL: 1024 16×16 tiles, each 4 parts (TL, TR, BL, BR) as u16 `PPPP VH CCCCCCCCCC`
//   (palette, vertical flip, horizontal flip, part index).
// - Layer: 32×32 u16 tile indices, stored as four 16×16 quadrants (TL, TR, BL, BR).
import { dataView } from "../bytes.ts";
import type { CharAnimation } from "./bganim.ts";

export const PART_SIZE = 8;
export const TILE_SIZE = 16;
export const LAYER_TILES = 32;
export const LAYER_PIXELS = LAYER_TILES * TILE_SIZE;
export const TILE_COUNT = 0x400;
export const CHAR_SHEET_SIZE = 0x8000;

const TILESET_CHARS_SIZE = 0x6000;
const BASE_CHARS_OFFSET = 0x6000;
const BASE_CHARS_SIZE = 0x1000;

/** Tileset IDs as used in file names: 0-25 = a-z, 26 = 1a, 27 = 1b. */
export function tilesetId(index: number): string {
  return index < 26 ? String.fromCharCode(0x61 + index) : `1${String.fromCharCode(0x61 + index - 26)}`;
}

/** Expands SCL colors to RGBA8. Color 0 of every palette gets alpha 0. */
export function decodePalettes(scl: Uint8Array): Uint8Array {
  const view = dataView(scl);
  const count = scl.length >> 1;
  const rgba = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const c = view.getUint16(i * 2, true);
    rgba[i * 4] = expand5(c & 0x1f);
    rgba[i * 4 + 1] = expand5((c >> 5) & 0x1f);
    rgba[i * 4 + 2] = expand5((c >> 10) & 0x1f);
    rgba[i * 4 + 3] = i % 16 === 0 ? 0 : 0xff;
  }
  return rgba;
}

function expand5(v: number): number {
  return (v << 3) | (v >> 2);
}

export function buildCharSheet(tilesetSch: Uint8Array, baseSch: Uint8Array): Uint8Array {
  const sheet = new Uint8Array(CHAR_SHEET_SIZE);
  sheet.set(tilesetSch.subarray(0, TILESET_CHARS_SIZE), 0);
  sheet.set(baseSch.subarray(0, BASE_CHARS_SIZE), BASE_CHARS_OFFSET);
  return sheet;
}

export function decodeTileParts(spl: Uint8Array): Uint16Array {
  const view = dataView(spl);
  const parts = new Uint16Array(TILE_COUNT * 4);
  for (let i = 0; i < parts.length; i++) parts[i] = view.getUint16(i * 2, true);
  return parts;
}

/** Returns 32×32 tile indices in row-major order. */
export function decodeLayer(raw: Uint8Array): Uint16Array {
  if (raw.length < LAYER_TILES * LAYER_TILES * 2) throw new Error("tile layer too short");
  const view = dataView(raw);
  const tiles = new Uint16Array(LAYER_TILES * LAYER_TILES);
  for (let q = 0; q < 4; q++) {
    const qx = (q & 1) * 16;
    const qy = (q >> 1) * 16;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        tiles[(qy + y) * LAYER_TILES + qx + x] = view.getUint16((q * 0x100 + y * 16 + x) * 2, true);
      }
    }
  }
  return tiles;
}

export interface Tileset {
  chars: Uint8Array; // CHAR_SHEET_SIZE bytes of 4bpp parts
  parts: Uint16Array; // TILE_COUNT × 4 packed parts
  palettes: Uint8Array; // 256 RGBA8 colors
  animations?: CharAnimation[]; // runtime char sheet updates (see animateChars)
}

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array; // RGBA8, row-major
}

export function createImage(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

/** Draws a layer at (ox, oy); transparent pixels leave the target untouched. */
export function drawLayer(target: RgbaImage, tileset: Tileset, layer: Uint16Array, ox = 0, oy = 0): void {
  for (let ty = 0; ty < LAYER_TILES; ty++) {
    for (let tx = 0; tx < LAYER_TILES; tx++) {
      drawTile(target, tileset, layer[ty * LAYER_TILES + tx]!, ox + tx * TILE_SIZE, oy + ty * TILE_SIZE);
    }
  }
}

export function drawTile(target: RgbaImage, tileset: Tileset, tile: number, x: number, y: number): void {
  const base = (tile & (TILE_COUNT - 1)) * 4;
  for (let p = 0; p < 4; p++) {
    drawPart(target, tileset, tileset.parts[base + p]!, x + (p & 1) * PART_SIZE, y + (p >> 1) * PART_SIZE);
  }
}

function drawPart(target: RgbaImage, tileset: Tileset, packed: number, x: number, y: number): void {
  const charOffset = (packed & 0x3ff) * 32;
  const hflip = (packed & 0x400) !== 0;
  const vflip = (packed & 0x800) !== 0;
  const palette = (packed >> 12) * 16;
  const { chars, palettes } = tileset;
  for (let py = 0; py < PART_SIZE; py++) {
    const ty = y + (vflip ? PART_SIZE - 1 - py : py);
    if (ty < 0 || ty >= target.height) continue;
    for (let px = 0; px < PART_SIZE; px++) {
      const tx = x + (hflip ? PART_SIZE - 1 - px : px);
      if (tx < 0 || tx >= target.width) continue;
      const byte = chars[charOffset + py * 4 + (px >> 1)]!;
      const index = px & 1 ? byte >> 4 : byte & 0x0f;
      if (index === 0) continue;
      const src = (palette + index) * 4;
      const dst = (ty * target.width + tx) * 4;
      target.data[dst] = palettes[src]!;
      target.data[dst + 1] = palettes[src + 1]!;
      target.data[dst + 2] = palettes[src + 2]!;
      target.data[dst + 3] = palettes[src + 3]!;
    }
  }
}
