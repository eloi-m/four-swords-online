// JUTResFont bitmap fonts ("FONTbfn1", msgus.arc font/*.bfn): 0x20-byte header (magic, u32 size, u32 block count),
// then blocks [u32 tag, u32 size, data]:
//   INF1 u16 encoding (0 one byte, 2 Shift-JIS), u16 ascent, descent, width, leading, default glyph
//   WID1 u16 first, last glyph, then per glyph u8 left bearing, u8 advance
//   MAP1 u16 mapping (0 linear, 1 Shift-JIS kanji, 2 table, 3 sorted code/glyph pairs), u16 first, last code,
//        u16 entry count, u16 entries[]
//   GLY1 u16 first, last glyph, u16 cell width, height, u32 sheet size, u16 GX format, u16 cells per row,
//        u16 rows, u16 sheet width, height, pad; sheets from +0x20
import { ascii, dataView } from "../bytes.ts";
import { decodeGxTexture, type DecodedTexture } from "../gx/bti.ts";

export interface BfnGlyphSheet {
  firstGlyph: number;
  lastGlyph: number;
  cellWidth: number;
  cellHeight: number;
  format: number;
  cellsPerRow: number;
  rows: number;
  sheetWidth: number;
  sheetHeight: number;
  sheets: Uint8Array[]; // raw GX data per sheet
}

export interface BfnMap {
  type: number;
  firstCode: number;
  lastCode: number;
  entries: number[];
}

export interface BfnGlyph {
  sheet: number; // index into BfnFont.sheets (flattened over GLY1 blocks)
  x: number; // cell rectangle in the sheet, in pixels
  y: number;
  width: number;
  height: number;
  bearing: number; // WID1 left bearing
  advance: number; // WID1 advance
}

export interface BfnFont {
  encoding: number;
  ascent: number;
  descent: number;
  width: number;
  leading: number;
  defaultGlyph: number;
  widths: { first: number; data: Uint8Array }[];
  maps: BfnMap[];
  glyphBlocks: BfnGlyphSheet[];
}

export function isBfn(bytes: Uint8Array): boolean {
  return bytes.length >= 0x20 && ascii(bytes, 0, 8) === "FONTbfn1";
}

export function parseBfn(bytes: Uint8Array): BfnFont {
  if (!isBfn(bytes)) throw new Error("not a FONTbfn1 font");
  const v = dataView(bytes);
  const font: BfnFont = {
    encoding: 0,
    ascent: 0,
    descent: 0,
    width: 0,
    leading: 0,
    defaultGlyph: 0,
    widths: [],
    maps: [],
    glyphBlocks: [],
  };
  let o = 0x20;
  const count = v.getUint32(0x0c);
  for (let i = 0; i < count && o + 8 <= bytes.length; i++) {
    const tag = ascii(bytes, o, 4);
    const size = v.getUint32(o + 4);
    switch (tag) {
      case "INF1":
        font.encoding = v.getUint16(o + 8);
        font.ascent = v.getUint16(o + 10);
        font.descent = v.getUint16(o + 12);
        font.width = v.getUint16(o + 14);
        font.leading = v.getUint16(o + 16);
        font.defaultGlyph = v.getUint16(o + 18);
        break;
      case "WID1": {
        const first = v.getUint16(o + 8), last = v.getUint16(o + 10);
        font.widths.push({ first, data: bytes.subarray(o + 12, o + 12 + (last - first + 1) * 2) });
        break;
      }
      case "MAP1": {
        const n = v.getUint16(o + 14);
        font.maps.push({
          type: v.getUint16(o + 8),
          firstCode: v.getUint16(o + 10),
          lastCode: v.getUint16(o + 12),
          entries: Array.from({ length: n * (v.getUint16(o + 8) === 3 ? 2 : 1) }, (_, k) => v.getUint16(o + 16 + k * 2)),
        });
        break;
      }
      case "GLY1": {
        const sheetSize = v.getUint32(o + 0x10);
        const sheetCount = Math.floor((size - 0x20) / sheetSize);
        font.glyphBlocks.push({
          firstGlyph: v.getUint16(o + 8),
          lastGlyph: v.getUint16(o + 10),
          cellWidth: v.getUint16(o + 12),
          cellHeight: v.getUint16(o + 14),
          format: v.getUint16(o + 0x14),
          cellsPerRow: v.getUint16(o + 0x16),
          rows: v.getUint16(o + 0x18),
          sheetWidth: v.getUint16(o + 0x1a),
          sheetHeight: v.getUint16(o + 0x1c),
          sheets: Array.from({ length: sheetCount }, (_, k) => bytes.subarray(o + 0x20 + k * sheetSize, o + 0x20 + (k + 1) * sheetSize)),
        });
        break;
      }
      default:
        throw new Error(`unknown BFN block ${JSON.stringify(tag)}`);
    }
    o += size;
  }
  return font;
}

/** Glyph index of a character code, or the font's default glyph. */
export function bfnGlyphIndex(font: BfnFont, code: number): number {
  for (const map of font.maps) {
    if (code < map.firstCode || code > map.lastCode) continue;
    switch (map.type) {
      case 0:
        return code - map.firstCode;
      case 1: {
        // Shift-JIS kanji in code order from 0x889F: 188 trail bytes per lead byte (0x40-0xFC without 0x7F).
        // Not used by FSA's fonts, untested.
        const sjisIndex = (c: number) => ((c >> 8) - 0x88) * 188 + (c & 0xff) - 0x40 - ((c & 0xff) >= 0x80 ? 1 : 0);
        return (map.entries[0] ?? 0) + sjisIndex(code) - sjisIndex(0x889f);
      }
      case 2:
        return map.entries[code - map.firstCode] ?? font.defaultGlyph;
      case 3: {
        let lo = 0, hi = map.entries.length / 2 - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1, c = map.entries[mid * 2]!;
          if (c === code) return map.entries[mid * 2 + 1]!;
          if (c < code) lo = mid + 1;
          else hi = mid - 1;
        }
        break;
      }
    }
  }
  return font.defaultGlyph;
}

export function bfnGlyph(font: BfnFont, code: number): BfnGlyph | null {
  const index = bfnGlyphIndex(font, code);
  let sheetBase = 0;
  for (const block of font.glyphBlocks) {
    if (index >= block.firstGlyph && index <= block.lastGlyph) {
      const cell = index - block.firstGlyph;
      const perSheet = block.cellsPerRow * block.rows;
      const inSheet = cell % perSheet;
      let bearing = 0, advance = font.width;
      for (const w of font.widths) {
        const k = (index - w.first) * 2;
        if (k >= 0 && k + 1 < w.data.length) {
          bearing = w.data[k]!;
          advance = w.data[k + 1]!;
        }
      }
      return {
        sheet: sheetBase + Math.floor(cell / perSheet),
        x: (inSheet % block.cellsPerRow) * block.cellWidth,
        y: Math.floor(inSheet / block.cellsPerRow) * block.cellHeight,
        width: block.cellWidth,
        height: block.cellHeight,
        bearing,
        advance,
      };
    }
    sheetBase += block.sheets.length;
  }
  return null;
}

/** Decodes every glyph sheet to RGBA8 (I4 sheets: intensity in RGB and alpha). */
export function decodeBfnSheets(font: BfnFont): DecodedTexture[] {
  return font.glyphBlocks.flatMap((b) => b.sheets.map((s) => decodeGxTexture(s, b.format, b.sheetWidth, b.sheetHeight)));
}
