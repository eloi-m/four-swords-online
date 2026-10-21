import { describe, expect, it } from "vitest";
import { decodeBti, decodeGxTexture, GxFormat } from "./bti.ts";

const px = (tex: { width: number; data: Uint8Array }, x: number, y: number) =>
  [...tex.data.subarray((y * tex.width + x) * 4, (y * tex.width + x) * 4 + 4)];

describe("GX texture decoding", () => {
  it("I4: 8x8 blocks, high nibble first, intensity replicated to alpha", () => {
    const src = new Uint8Array(32);
    src[0] = 0xf0; // (0,0) = 15, (1,0) = 0
    src[4] = 0x08; // (0,1) = 0, (1,1) = 8
    const tex = decodeGxTexture(src, GxFormat.I4, 8, 8);
    expect(px(tex, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(px(tex, 1, 0)).toEqual([0, 0, 0, 0]);
    expect(px(tex, 1, 1)).toEqual([136, 136, 136, 136]);
  });

  it("RGB5A3: opaque RGB555 and translucent ARGB3444", () => {
    const src = new Uint8Array(32);
    const view = new DataView(src.buffer);
    view.setUint16(0, 0x8000 | (31 << 10)); // opaque red
    view.setUint16(2, (3 << 12) | 0xf00); // alpha 3/7, red 15
    const tex = decodeGxTexture(src, GxFormat.RGB5A3, 4, 4);
    expect(px(tex, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(tex, 1, 0)).toEqual([255, 0, 0, 109]);
  });

  it("CMPR: sub-blocks in Z order with GX 5/8-3/8 interpolation", () => {
    const src = new Uint8Array(32);
    const view = new DataView(src.buffer);
    view.setUint16(0, 0xffff); // c0 white
    view.setUint16(2, 0x0000); // c1 black; c0 > c1, so 4-color mode
    src[4] = 0b00_01_10_11; // row 0 of sub-block 0: c0, c1, 5/8 c0, 3/8 c0
    view.setUint16(8, 0xf800); // sub-block 1 (top-right): red
    const tex = decodeGxTexture(src, GxFormat.CMPR, 8, 8);
    expect(px(tex, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(px(tex, 1, 0)).toEqual([0, 0, 0, 255]);
    expect(px(tex, 2, 0)).toEqual([159, 159, 159, 255]);
    expect(px(tex, 3, 0)).toEqual([95, 95, 95, 255]);
    expect(px(tex, 4, 0)).toEqual([255, 0, 0, 255]);
  });

  it("reads the BTI header and image offset", () => {
    const file = new Uint8Array(0x20 + 32);
    const view = new DataView(file.buffer);
    view.setUint8(0, GxFormat.I8);
    view.setUint16(2, 8);
    view.setUint16(4, 4);
    view.setUint32(0x1c, 0x20);
    file[0x20] = 200;
    const tex = decodeBti(file);
    expect([tex.width, tex.height]).toEqual([8, 4]);
    expect(px(tex, 0, 0)).toEqual([200, 200, 200, 200]);
  });
});
