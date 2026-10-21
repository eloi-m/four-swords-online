// FSA sprites, GBA OAM-style.
// - SOB: u16 LE frame count, then count+1 u16 LE offsets; each frame is a run of 6-byte part attributes:
//   [s8 y][shape << 6][s8 x][size << 6 | vflip << 5 | hflip << 4][tile in page][palette << 4 | page].
//   Parts are drawn from last to first, so the first part ends up on top.
// - Sprite sheet: 16 pages × 256 parts (4bpp 8×8, 32 bytes each), 32 parts per row. A part at (page, tile) spanning
//   w×h blocks uses parts page * 256 + tile + by * 32 + bx.
import { dataView } from "../bytes.ts";
import type { RarcArchive } from "../rarc.ts";
import { decompressYaz0, isYaz0 } from "../yaz0.ts";
import { decodePalettes, PART_SIZE, type RgbaImage } from "./bg.ts";

export interface SpritePart {
  x: number;
  y: number;
  width: number; // in 8×8 blocks
  height: number;
  hflip: boolean;
  vflip: boolean;
  part: number; // index of the top-left 8×8 part in the sprite sheet
  palette: number;
}

export type SpriteFrame = SpritePart[];

const BLOCK_DIMENSIONS: Record<number, [number, number][]> = {
  0: [[1, 1], [2, 2], [4, 4], [8, 8]], // square
  1: [[2, 1], [4, 1], [4, 2], [8, 4]], // wide
  2: [[1, 2], [1, 4], [2, 4], [4, 8]], // tall
};

export function parseSob(bytes: Uint8Array): SpriteFrame[] {
  const view = dataView(bytes);
  const count = view.getUint16(0, true);
  const frames: SpriteFrame[] = [];
  for (let i = 0; i < count; i++) {
    const start = view.getUint16(2 + i * 2, true);
    const end = view.getUint16(4 + i * 2, true);
    const frame: SpriteFrame = [];
    for (let o = start; o + 6 <= end; o += 6) {
      const [width, height] = BLOCK_DIMENSIONS[bytes[o + 1]! >> 6]?.[bytes[o + 3]! >> 6] ?? [1, 1];
      frame.push({
        y: view.getInt8(o),
        x: view.getInt8(o + 2),
        width,
        height,
        hflip: (bytes[o + 3]! & 0x10) !== 0,
        vflip: (bytes[o + 3]! & 0x20) !== 0,
        part: (bytes[o + 5]! & 0x0f) * 256 + bytes[o + 4]!,
        palette: bytes[o + 5]! >> 4,
      });
    }
    frames.push(frame);
  }
  return frames;
}

export const SPRITE_SHEET_SIZE = 0x20000;

export interface SpriteSheet {
  chars: Uint8Array; // SPRITE_SHEET_SIZE bytes
  palettes: Uint8Array; // RGBA8 colors, 16 per palette: the file's 16 palettes, then 16-19 (addPlayerPalettes)
}

function file(archive: RarcArchive, path: string): Uint8Array {
  const found = archive.files.find((f) => f.path === path);
  if (!found) throw new Error(`${archive.rootName}: missing ${path}`);
  return isYaz0(found.data) ? decompressYaz0(found.data) : found.data;
}

/** Palette sets for sprites: TV (`cu_`, "cube"), GBA screen (`gb_`) and Dark World (`ura_`). */
export const SPRITE_PALETTES = {
  tv: "scl/cu_cl_obj_base_scl.szs",
  gba: "scl/gb_cl_obj_base_scl.szs",
  dark: "scl/ura_cl_obj_base_scl.szs",
} as const;

/** Player colors live in palettes 12-15 (green, red, blue, purple), then our own 16-19 (addPlayerPalettes). */
export const PLAYER_PALETTE_BASE = 12;

/**
 * Tunic colors for players 5-8, which the game doesn't have: yellow, cyan, white and black. Each is the four shades,
 * dark to light, that go in colors 11-14 of a copy of the green Link's palette 12 (its tunic; the other colors are the
 * outline, skin, hair and shield that every player shares). RGB, in the palettes' 5-bit steps.
 */
export const EXTRA_PLAYER_TUNICS: readonly (readonly number[])[] = [
  [0x8c7300, 0xd6ad00, 0xf7de31, 0xfff7a5],
  [0x007b84, 0x10bdc6, 0x5aefef, 0xb5ffff],
  [0x9494a5, 0xc6c6d6, 0xe7e7ef, 0xffffff],
  [0x212129, 0x39394a, 0x5a5a6b, 0x848494],
];
/** Players with a tunic color: the game's 4 and EXTRA_PLAYER_TUNICS. */
export const PLAYER_PALETTES = 4 + EXTRA_PLAYER_TUNICS.length;
const TUNIC_FIRST_COLOR = 11;
const PALETTE_BYTES = 16 * 4;

/** A sprite palette set (16 palettes) with the extra players' palettes 16-19 appended (EXTRA_PLAYER_TUNICS). */
export function addPlayerPalettes(palettes: Uint8Array): Uint8Array {
  const out = new Uint8Array((16 + EXTRA_PLAYER_TUNICS.length) * PALETTE_BYTES);
  out.set(palettes.subarray(0, 16 * PALETTE_BYTES));
  const green = palettes.subarray(PLAYER_PALETTE_BASE * PALETTE_BYTES, (PLAYER_PALETTE_BASE + 1) * PALETTE_BYTES);
  EXTRA_PLAYER_TUNICS.forEach((tunic, k) => {
    const at = (16 + k) * PALETTE_BYTES;
    out.set(green, at);
    tunic.forEach((rgb, c) => out.set([rgb >> 16, (rgb >> 8) & 0xff, rgb & 0xff, 0xff], at + (TUNIC_FIRST_COLOR + c) * 4));
  });
  return out;
}

/**
 * Palette remap for a player's sprites (0 to PLAYER_PALETTES - 1). SOB frames use palettes 7 and 15 as player-color
 * placeholders; the game substitutes 12 + player. Palette 7 is confirmed from Dolphin texture dumps; 15 is a
 * hypothesis (it matches the green Link's shield and tunic).
 */
export function playerPaletteMap(player: number): (palette: number) => number {
  return (palette) => (palette === 7 || palette === 15 ? PLAYER_PALETTE_BASE + player : palette);
}

/**
 * Assembles the 16-page object sprite sheet. `objectSheet` is the stage's object set (`gb_ch_obj_tr_sch<N>`),
 * probably the map layout's npcSheetId. The page layout follows FSALib and was confirmed against Dolphin's runtime
 * textures: pages 0-3 and 8-11 match its 256×256 C4 sprite pages exactly.
 */
export function loadSpriteSheet(data: RarcArchive, objectSheet: number, palette: string = SPRITE_PALETTES.tv): SpriteSheet {
  const chars = new Uint8Array(SPRITE_SHEET_SIZE);
  chars.set(file(data, "sch/gb_ch_obj_base_sch.szs").subarray(0, 0x7000), 0x00000);
  chars.set(file(data, `sch/gb_ch_obj_tr_sch${objectSheet.toString(16)}.szs`).subarray(0, 0x1000), 0x07000);
  chars.set(file(data, "sch/enemy_sch.szs").subarray(0, 0x8000), 0x08000);
  chars.set(file(data, "sch/gals2_sch.szs").subarray(0, 0x4000), 0x10000);
  chars.set(file(data, "sch/player_sch.szs").subarray(0, 0x4000), 0x14000);
  chars.set(file(data, "sch/gals_sch.szs").subarray(0, 0x8000), 0x18000);
  return { chars, palettes: addPlayerPalettes(decodePalettes(file(data, palette))) };
}

export function loadSob(data: RarcArchive, name: string): SpriteFrame[] {
  return parseSob(file(data, `sob/${name}`));
}

/**
 * Visits every opaque pixel of a frame in draw order (last part first), at offsets relative to the anchor.
 * `index` is the 4bpp color (1-15) within the part's palette.
 */
export function forEachSpritePixel(
  sheet: SpriteSheet,
  frame: SpriteFrame,
  visit: (x: number, y: number, part: SpritePart, index: number) => void,
): void {
  for (let i = frame.length - 1; i >= 0; i--) {
    const p = frame[i]!;
    for (let by = 0; by < p.height; by++) {
      for (let bx = 0; bx < p.width; bx++) {
        const charOffset = ((p.part + by * 32 + bx) % 4096) * 32;
        const ox = p.x + (p.hflip ? p.width - 1 - bx : bx) * PART_SIZE;
        const oy = p.y + (p.vflip ? p.height - 1 - by : by) * PART_SIZE;
        for (let py = 0; py < PART_SIZE; py++) {
          for (let px = 0; px < PART_SIZE; px++) {
            const byte = sheet.chars[charOffset + py * 4 + (px >> 1)]!;
            const index = px & 1 ? byte >> 4 : byte & 0x0f;
            if (index !== 0) visit(ox + (p.hflip ? PART_SIZE - 1 - px : px), oy + (p.vflip ? PART_SIZE - 1 - py : py), p, index);
          }
        }
      }
    }
  }
}

/** Inclusive bounds of a frame's opaque pixels relative to its anchor (optionally only some parts); null if empty. */
export function spriteBounds(
  sheet: SpriteSheet,
  frame: SpriteFrame,
  filter?: (part: SpritePart) => boolean,
): { left: number; top: number; right: number; bottom: number } | null {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  forEachSpritePixel(sheet, frame, (x, y, part) => {
    if (filter && !filter(part)) return;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  });
  return left === Infinity ? null : { left, top, right, bottom };
}

/** Draws a frame with its anchor at (x, y). `paletteMap` can remap part palettes (e.g. per-player colors). */
export function drawSprite(
  target: RgbaImage,
  sheet: SpriteSheet,
  frame: SpriteFrame,
  x: number,
  y: number,
  paletteMap?: (palette: number) => number,
): void {
  x = Math.round(x);
  y = Math.round(y);
  forEachSpritePixel(sheet, frame, (px, py, part, index) => {
    const tx = x + px, ty = y + py;
    if (tx < 0 || ty < 0 || tx >= target.width || ty >= target.height) return;
    const src = ((paletteMap ? paletteMap(part.palette) : part.palette) * 16 + index) * 4;
    target.data.set(sheet.palettes.subarray(src, src + 4), (ty * target.width + tx) * 4);
  });
}
