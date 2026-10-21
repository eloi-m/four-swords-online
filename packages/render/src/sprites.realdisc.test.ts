// The Links' sprite atlases for players 1-8 on the real sprite sheet (needs extracted/): players 5-8's made-up tunics
// (@fso/formats addPlayerPalettes) cover every pixel player 1's does, in colors of their own.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, isYaz0, loadSob, loadSpriteSheet, parseRarc, PLAYER_PALETTES, playerPaletteMap } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { SpriteAtlas } from "./sprites.ts";

const data = new URL("../../../extracted/files/GC4Sword_usa/data.arc", import.meta.url);

describe.skipIf(!existsSync(data))("Link sprite atlases per player (extracted/)", () => {
  it("players 5-8 have no holes where player 1 is drawn, and tunics unlike players 1-4's and each other's", () => {
    const raw = readFileSync(data);
    const archive = parseRarc(isYaz0(raw) ? decompressYaz0(raw) : raw);
    const sheet = loadSpriteSheet(archive, 8), frames = loadSob(archive, "player_sob.bin");
    const texels = Array.from({ length: PLAYER_PALETTES }, (_, p) => new SpriteAtlas(sheet, frames, playerPaletteMap(p)).texture.image.data as Uint8Array);
    const rgba = (p: number, i: number) => texels[p]![i]! << 24 | texels[p]![i + 1]! << 16 | texels[p]![i + 2]! << 8 | texels[p]![i + 3]!;
    expect(PLAYER_PALETTES).toBe(8);
    let tunic = 0;
    const holes: string[] = [], alike: string[] = [];
    for (let i = 0; i < texels[0]!.length; i += 4) {
      for (let p = 4; p < 8; p++) if (texels[p]![i + 3] !== texels[0]![i + 3]) holes.push(`player ${p + 1} texel ${i / 4}`);
      if (rgba(0, i) === rgba(1, i)) continue; // not a player-colored texel
      tunic++;
      for (let p = 4; p < 8; p++) for (let q = 0; q < 8; q++) if (q !== p && rgba(p, i) === rgba(q, i)) alike.push(`players ${p + 1} and ${q + 1} texel ${i / 4}`);
    }
    expect(holes.slice(0, 5)).toEqual([]);
    expect(alike.slice(0, 5)).toEqual([]);
    expect(tunic).toBeGreaterThan(10_000);
  });
});
