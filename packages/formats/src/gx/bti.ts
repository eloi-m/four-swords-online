// BTI textures (J3D "timg"): a 0x20-byte header followed by GX-tiled image data (and an optional palette).
// Decodes the base mip level to RGBA8. GX formats per the GameCube SDK / Dolphin's TextureDecoder.
import { dataView } from "../bytes.ts";

export const GxFormat = {
  I4: 0x0,
  I8: 0x1,
  IA4: 0x2,
  IA8: 0x3,
  RGB565: 0x4,
  RGB5A3: 0x5,
  RGBA8: 0x6,
  C4: 0x8,
  C8: 0x9,
  C14X2: 0xa,
  CMPR: 0xe,
} as const;

export const GxPaletteFormat = { IA8: 0, RGB565: 1, RGB5A3: 2 } as const;

export interface BtiHeader {
  format: number;
  width: number;
  height: number;
  wrapS: number;
  wrapT: number;
  paletteFormat: number;
  paletteCount: number;
  paletteOffset: number;
  minFilter: number;
  magFilter: number;
  mipCount: number;
  dataOffset: number;
}

export interface DecodedTexture {
  width: number;
  height: number;
  data: Uint8Array; // RGBA8, row-major, top row first
}

export function parseBtiHeader(bytes: Uint8Array, offset = 0): BtiHeader {
  const v = dataView(bytes);
  return {
    format: v.getUint8(offset),
    width: v.getUint16(offset + 0x02),
    height: v.getUint16(offset + 0x04),
    wrapS: v.getUint8(offset + 0x06),
    wrapT: v.getUint8(offset + 0x07),
    paletteFormat: v.getUint8(offset + 0x09),
    paletteCount: v.getUint16(offset + 0x0a),
    paletteOffset: v.getUint32(offset + 0x0c),
    minFilter: v.getUint8(offset + 0x14),
    magFilter: v.getUint8(offset + 0x15),
    mipCount: v.getUint8(offset + 0x18),
    dataOffset: v.getUint32(offset + 0x1c),
  };
}

/** Decodes a standalone .bti file (header at offset 0; offsets are relative to the header). */
export function decodeBti(bytes: Uint8Array): DecodedTexture {
  const h = parseBtiHeader(bytes);
  const palette = h.paletteCount
    ? decodePalette(bytes.subarray(h.paletteOffset, h.paletteOffset + h.paletteCount * 2), h.paletteFormat)
    : null;
  return decodeGxTexture(bytes.subarray(h.dataOffset), h.format, h.width, h.height, palette);
}

const BLOCK: Record<number, [number, number, number]> = {
  // format: [block width, block height, bytes per block]
  [GxFormat.I4]: [8, 8, 32],
  [GxFormat.I8]: [8, 4, 32],
  [GxFormat.IA4]: [8, 4, 32],
  [GxFormat.IA8]: [4, 4, 32],
  [GxFormat.RGB565]: [4, 4, 32],
  [GxFormat.RGB5A3]: [4, 4, 32],
  [GxFormat.RGBA8]: [4, 4, 64],
  [GxFormat.C4]: [8, 8, 32],
  [GxFormat.C8]: [8, 4, 32],
  [GxFormat.C14X2]: [4, 4, 32],
  [GxFormat.CMPR]: [8, 8, 32],
};

export function decodeGxTexture(
  src: Uint8Array,
  format: number,
  width: number,
  height: number,
  palette: Uint8Array | null = null,
): DecodedTexture {
  const block = BLOCK[format];
  if (!block) throw new Error(`unsupported GX texture format 0x${format.toString(16)}`);
  const [bw, bh, bytes] = block;
  const out = new Uint8Array(width * height * 4);
  const v = dataView(src);
  const put = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    if (x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = a;
  };
  const indexed = (x: number, y: number, index: number) => {
    if (!palette) throw new Error("paletted texture without a palette");
    const p = (index * 4) % palette.length;
    put(x, y, palette[p]!, palette[p + 1]!, palette[p + 2]!, palette[p + 3]!);
  };

  let o = 0;
  for (let by = 0; by < height; by += bh) {
    for (let bx = 0; bx < width; bx += bw) {
      switch (format) {
        case GxFormat.I4:
        case GxFormat.C4:
          for (let i = 0; i < 64; i++) {
            const byte = src[o + (i >> 1)]!;
            const value = i & 1 ? byte & 0xf : byte >> 4;
            const x = bx + (i & 7), y = by + (i >> 3);
            if (format === GxFormat.C4) indexed(x, y, value);
            else put(x, y, value * 17, value * 17, value * 17, value * 17);
          }
          break;
        case GxFormat.I8:
        case GxFormat.C8:
          for (let i = 0; i < 32; i++) {
            const value = src[o + i]!;
            const x = bx + (i & 7), y = by + (i >> 3);
            if (format === GxFormat.C8) indexed(x, y, value);
            else put(x, y, value, value, value, value);
          }
          break;
        case GxFormat.IA4:
          for (let i = 0; i < 32; i++) {
            const byte = src[o + i]!;
            const intensity = (byte & 0xf) * 17;
            put(bx + (i & 7), by + (i >> 3), intensity, intensity, intensity, (byte >> 4) * 17);
          }
          break;
        case GxFormat.IA8:
          for (let i = 0; i < 16; i++) {
            const alpha = src[o + i * 2]!, intensity = src[o + i * 2 + 1]!;
            put(bx + (i & 3), by + (i >> 2), intensity, intensity, intensity, alpha);
          }
          break;
        case GxFormat.RGB565:
        case GxFormat.RGB5A3:
          for (let i = 0; i < 16; i++) {
            const c = v.getUint16(o + i * 2);
            const [r, g, b, a] = format === GxFormat.RGB565 ? rgb565(c) : rgb5a3(c);
            put(bx + (i & 3), by + (i >> 2), r, g, b, a);
          }
          break;
        case GxFormat.C14X2:
          for (let i = 0; i < 16; i++) indexed(bx + (i & 3), by + (i >> 2), v.getUint16(o + i * 2) & 0x3fff);
          break;
        case GxFormat.RGBA8:
          for (let i = 0; i < 16; i++) {
            const a = src[o + i * 2]!, r = src[o + i * 2 + 1]!;
            const g = src[o + 32 + i * 2]!, b = src[o + 32 + i * 2 + 1]!;
            put(bx + (i & 3), by + (i >> 2), r, g, b, a);
          }
          break;
        case GxFormat.CMPR:
          for (let sub = 0; sub < 4; sub++) decodeDxt1(src, o + sub * 8, bx + (sub & 1) * 4, by + (sub >> 1) * 4, put);
          break;
      }
      o += bytes;
    }
  }
  return { width, height, data: out };
}

/** Decodes a GX palette (TLUT) to RGBA8. */
export function decodePalette(src: Uint8Array, format: number): Uint8Array {
  const v = dataView(src);
  const count = src.length >> 1;
  const out = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const c = v.getUint16(i * 2);
    const rgba =
      format === GxPaletteFormat.IA8
        ? [c & 0xff, c & 0xff, c & 0xff, c >> 8]
        : format === GxPaletteFormat.RGB565
          ? rgb565(c)
          : rgb5a3(c);
    out.set(rgba, i * 4);
  }
  return out;
}

function rgb565(c: number): [number, number, number, number] {
  const r = (c >> 11) & 0x1f, g = (c >> 5) & 0x3f, b = c & 0x1f;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2), 0xff];
}

function rgb5a3(c: number): [number, number, number, number] {
  if (c & 0x8000) {
    const r = (c >> 10) & 0x1f, g = (c >> 5) & 0x1f, b = c & 0x1f;
    return [(r << 3) | (r >> 2), (g << 3) | (g >> 2), (b << 3) | (b >> 2), 0xff];
  }
  const a = (c >> 12) & 0x7;
  return [((c >> 8) & 0xf) * 17, ((c >> 4) & 0xf) * 17, (c & 0xf) * 17, (a << 5) | (a << 2) | (a >> 1)];
}

// GX CMPR sub-block: DXT1 with big-endian colors; 2-bit indices, one byte per row, leftmost pixel in the top bits.
function decodeDxt1(
  src: Uint8Array,
  o: number,
  x0: number,
  y0: number,
  put: (x: number, y: number, r: number, g: number, b: number, a: number) => void,
): void {
  const c0 = (src[o]! << 8) | src[o + 1]!;
  const c1 = (src[o + 2]! << 8) | src[o + 3]!;
  const a = rgb565(c0), b = rgb565(c1);
  const colors: [number, number, number, number][] = [a, b];
  // GX hardware interpolates with 5/8 and 3/8 weights rather than DXT1's 2/3 and 1/3.
  if (c0 > c1) {
    colors.push(mix(a, b, 5, 3), mix(a, b, 3, 5));
  } else {
    colors.push(mix(a, b, 1, 1), [0, 0, 0, 0]);
  }
  for (let y = 0; y < 4; y++) {
    const row = src[o + 4 + y]!;
    for (let x = 0; x < 4; x++) {
      const [r, g, bl, al] = colors[(row >> (6 - x * 2)) & 3]!;
      put(x0 + x, y0 + y, r, g, bl, al);
    }
  }
}

function mix(
  a: [number, number, number, number],
  b: [number, number, number, number],
  wa: number,
  wb: number,
): [number, number, number, number] {
  const t = wa + wb;
  return [
    Math.floor((a[0] * wa + b[0] * wb) / t),
    Math.floor((a[1] * wa + b[1] * wb) / t),
    Math.floor((a[2] * wa + b[2] * wb) / t),
    0xff,
  ];
}
