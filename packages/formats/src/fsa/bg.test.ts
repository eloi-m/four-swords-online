import { describe, expect, it } from "vitest";
import { createImage, decodeLayer, decodePalettes, drawTile, tilesetId, type Tileset } from "./bg.ts";

describe("FSA background graphics", () => {
  it("maps tileset indices to file IDs", () => {
    expect(tilesetId(0)).toBe("a");
    expect(tilesetId(12)).toBe("m");
    expect(tilesetId(26)).toBe("1a");
  });

  it("decodes BGR555 palettes, color 0 transparent", () => {
    const scl = Uint8Array.from([0xff, 0x7f, 0x1f, 0x00]); // white, red
    const rgba = decodePalettes(scl);
    expect([...rgba.subarray(0, 4)]).toEqual([255, 255, 255, 0]);
    expect([...rgba.subarray(4, 8)]).toEqual([255, 0, 0, 255]);
  });

  it("reassembles layers from four 16x16 quadrants", () => {
    const raw = new Uint8Array(2048);
    const view = new DataView(raw.buffer);
    for (let q = 0; q < 4; q++) view.setUint16(q * 0x200, q + 1, true); // first tile of each quadrant
    const tiles = decodeLayer(raw);
    expect([tiles[0], tiles[16], tiles[16 * 32], tiles[16 * 32 + 16]]).toEqual([1, 2, 3, 4]);
  });

  it("draws parts with palette and flips", () => {
    const chars = new Uint8Array(0x8000);
    chars[0] = 0x21; // part 0, row 0: pixel 0 = color 1, pixel 1 = color 2
    const palettes = new Uint8Array(256 * 4);
    palettes.set([10, 0, 0, 255, 20, 0, 0, 255], (16 + 1) * 4); // palette 1, colors 1 and 2
    const parts = new Uint16Array(0x400 * 4);
    parts[0] = 0x1000 | 0x400; // tile 0 top-left: palette 1, horizontal flip, part 0
    const tileset: Tileset = { chars, parts, palettes };
    const image = createImage(16, 16);
    drawTile(image, tileset, 0, 0, 0);
    expect(image.data[7 * 4]).toBe(10); // pixel 0 mirrored to x = 7
    expect(image.data[6 * 4]).toBe(20);
    expect(image.data[3]).toBe(0); // x = 0 untouched (color 0 is transparent)
  });
});
