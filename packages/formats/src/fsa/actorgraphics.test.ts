import { describe, expect, it } from "vitest";
import { ACTOR_LOOKS, actorLook, actorPieces, drawActorPieces, JIJI_VARIANTS, piecesSobs, type ActorSpritePiece } from "./actorgraphics.ts";
import type { Actor } from "./actors.ts";
import { createImage } from "./bg.ts";
import { SPRITE_SHEET_SIZE, type SpriteSheet } from "./sprites.ts";

const actor = (id: string, params = 0): Actor => ({ id, sublayer: 0, x: 10, y: 10, params });
const sprites = (a: Actor) => actorPieces(a) as ActorSpritePiece[];

describe("actor graphics", () => {
  it("draws the four Lake Hylia girls in their spawn column", () => {
    expect(sprites(actor("FGAL", 0x80000000)).map((p) => [p.sob, p.frame, p.dx, p.dy])).toEqual([
      ["both2", 910, 0, 0],
      ["both2", 910, 0, 16],
      ["both2", 910, 0, 32],
      ["both2", 910, 0, 48],
    ]);
  });

  it("picks JIJI variants from params byte 2", () => {
    const look = (params: number) => sprites(actor("JIJI", params)).map((p) => `${p.sob}:${p.frame}`);
    expect(JIJI_VARIANTS).toHaveLength(54);
    expect(look(0x000003d3)).toEqual(["both2:902"]); // old man (room 1, GBA area 2)
    expect(look(0x00070000)).toEqual(["gc:213"]);
    expect(look(0x000e0100)).toEqual(["both:211"]); // base 195 + 16 facing down
    expect(look(0x002a0345)).toEqual(["both2:789"]);
    expect(look(0x00150000)).toEqual([]); // variant 21 isn't drawn
    expect(look(0x00ff0000)).toEqual(["both2:902"]); // out of range -> variant 0, as the game does
  });

  it("maps params to gem, soldier, octorok and block looks", () => {
    expect(sprites(actor("RUPY", 0x88100002))[0]).toMatchObject({ sob: "both2", frame: 9 });
    expect(sprites(actor("RUPY", 9))[0]).toMatchObject({ sob: "gc", frame: 1110 });
    expect(actorPieces(actor("RUPY", 12))).toEqual([]);
    expect(sprites(actor("HNRY", 0x1005))[0]).toMatchObject({ frame: 9 });
    expect(sprites(actor("SLR1", 0x01000000))[0]).toEqual({ kind: "sprite", sob: "both", frame: 155, dx: 0, dy: 0, palettes: { 2: 2 } });
    expect(sprites(actor("SLR1", 2))[0]).toMatchObject({ sob: "both2", frame: 512, palettes: { 2: 4, 8: 4 } });
    expect(sprites(actor("SLR1", 6))[0]).toMatchObject({ sob: "both", palettes: { 2: 8 } });
    expect(sprites(actor("OKTA", 3))[0]).toMatchObject({ sob: "gc", frame: 8, palettes: { 3: 3 } });
    expect(sprites(actor("OKTA", 1))[0]).toMatchObject({ frame: 1102, palettes: { 3: 4 } });
    expect(sprites(actor("OKTA", 2))[0]).toMatchObject({ frame: 8, palettes: { 3: 5 } });
    expect(sprites(actor("BLCK", 0x8000000b))[0]).toMatchObject({ sob: "both", frame: 7 });
    expect(sprites(actor("BLCK", 0x20))[0]).toMatchObject({ frame: 74 });
    expect(sprites(actor("BLCK", 0))[0]).toMatchObject({ frame: 69 });
    expect(sprites(actor("YAJI", 0x08000081))[0]).toMatchObject({ sob: "both", frame: 17 });
    expect(sprites(actor("RCK2"))[0]).toMatchObject({ frame: 43, dy: 8 });
    expect(actorPieces(actor("LSTI", 0x86))).toEqual([]); // hidden under a rock
    expect(actorPieces(actor("SNPC", 0x1f0))).toEqual([]);
    expect(sprites(actor("SNPC", 0x20000))[0]).toMatchObject({ sob: "both", frame: 195 });
  });

  it("lays out the goal's four pads", () => {
    expect(sprites(actor("GOL2", 0x80000082)).map((p) => [p.frame, p.dx, p.dy])).toEqual([
      [603, 0, 0],
      [603, 32, 0],
      [603, 64, 0],
      [603, 96, 0],
    ]);
  });

  it("draws player starts as Link in the player's colors", () => {
    expect(sprites(actor("PLAS", 2))[0]).toEqual({ kind: "sprite", sob: "player", frame: 16, dx: 0, dy: 0, palettes: { 7: 14, 15: 14 } });
    expect(sprites(actor("PLAS", 0x133))[0]).toMatchObject({ frame: 8, palettes: { 7: 15 } }); // facing left, purple
    expect(sprites(actor("PLAS", 0x10))[0]).toMatchObject({ frame: 24 }); // facing up
  });

  it("has pieces exactly for drawn types", () => {
    for (const [id, look] of Object.entries(ACTOR_LOOKS)) {
      if (look.draw === "sprite") expect(look.pieces, id).toBeDefined();
      if (look.draw === "tile" || look.draw === "hidden") expect(look.pieces, id).toBeUndefined();
      expect(look.note.length, id).toBeGreaterThan(0);
    }
    expect(actorLook("WARP")?.draw).toBe("hidden");
    expect(actorLook("KNBN")?.draw).toBe("tile");
    expect(actorLook("????")).toBeNull();
    expect(actorPieces(actor("????"))).toEqual([]);
    expect([...piecesSobs(actorPieces(actor("FGAL")))]).toEqual(["both2"]);
  });

  it("draws pieces in software with palette substitutions", () => {
    const chars = new Uint8Array(SPRITE_SHEET_SIZE);
    chars[5 * 32] = 0x01; // part 5, pixel (0, 0) = color 1
    const palettes = new Uint8Array(256 * 4);
    palettes.set([10, 20, 30, 255], (3 * 16 + 1) * 4);
    palettes.set([40, 50, 60, 255], (5 * 16 + 1) * 4);
    const sheet: SpriteSheet = { chars, palettes };
    const frame = [{ x: 0, y: 0, width: 1, height: 1, hflip: false, vflip: false, part: 5, palette: 3 }];
    const image = createImage(4, 4);
    // OKTA kind 2 recolors palette 3 as palette 5; the anchor is at (1, 2).
    drawActorPieces(image, sheet, { gc: Object.assign([], { 8: frame }) }, actorPieces(actor("OKTA", 2)), 1, 2);
    expect([...image.data.subarray((2 * 4 + 1) * 4, (2 * 4 + 1) * 4 + 4)]).toEqual([40, 50, 60, 255]);
  });
});
