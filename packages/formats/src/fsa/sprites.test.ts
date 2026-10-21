import { describe, expect, it } from "vitest";
import { createImage } from "./bg.ts";
import { addPlayerPalettes, drawSprite, EXTRA_PLAYER_TUNICS, parseSob, playerPaletteMap, SPRITE_SHEET_SIZE, type SpriteSheet } from "./sprites.ts";

describe("SOB sprites", () => {
  it("parses frames of OAM-style parts", () => {
    // 1 frame, 1 part: y=-8, square, x=-4, size 1 (2×2 blocks) + hflip, tile 3 on page 10, palette 7
    const sob = Uint8Array.from([1, 0, 6, 0, 12, 0, 0xf8, 0x00, 0xfc, 0x50, 3, 0x7a]);
    const [frame] = parseSob(sob);
    expect(frame).toEqual([{ x: -4, y: -8, width: 2, height: 2, hflip: true, vflip: false, part: 10 * 256 + 3, palette: 7 }]);
  });

  it("draws parts with the player palette substitution", () => {
    const chars = new Uint8Array(SPRITE_SHEET_SIZE);
    chars[5 * 32] = 0x01; // part 5, pixel (0,0) = color 1
    const palettes = new Uint8Array(256 * 4);
    palettes.set([1, 2, 3, 255], (12 * 16 + 1) * 4); // palette 12 (green player), color 1
    const sheet: SpriteSheet = { chars, palettes };
    const image = createImage(8, 8);
    drawSprite(image, sheet, [{ x: 0, y: 0, width: 1, height: 1, hflip: false, vflip: false, part: 5, palette: 7 }], 0, 0, playerPaletteMap(0));
    expect([...image.data.subarray(0, 4)]).toEqual([1, 2, 3, 255]);
  });

  it("players 5-8 get palettes 16-19: the green Link's, with their own tunic in colors 11-14", () => {
    const palettes = Uint8Array.from({ length: 256 * 4 }, (_, i) => i & 0xff);
    const out = addPlayerPalettes(palettes);
    expect(out.length).toBe(20 * 16 * 4);
    expect(out.subarray(0, 256 * 4)).toEqual(palettes);
    const green = palettes.subarray(12 * 64, 13 * 64);
    EXTRA_PLAYER_TUNICS.forEach((tunic, k) => {
      const palette = out.subarray((16 + k) * 64, (17 + k) * 64);
      for (let c = 0; c < 16; c++) {
        const rgb = tunic[c - 11];
        expect([...palette.subarray(c * 4, c * 4 + 4)]).toEqual(rgb === undefined ? [...green.subarray(c * 4, c * 4 + 4)] : [rgb >> 16, (rgb >> 8) & 0xff, rgb & 0xff, 255]);
      }
      expect(playerPaletteMap(4 + k)(7)).toBe(16 + k);
    });
    expect(new Set(EXTRA_PLAYER_TUNICS.flat()).size).toBe(16);
  });
});
