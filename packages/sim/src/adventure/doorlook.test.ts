// The open doors' tiles (doorlook.ts, main.dol's tables at 0x8046D598, 0x8046D628, 0x8046D688; the top layer's at
// 0x8046D718, 0x8046D728, 0x8046D738).
import { describe, expect, it } from "vitest";
import { doorOpenTiles, doorOpenTopTiles } from "./doorlook.ts";

describe("doorOpenTiles", () => {
  it("picks two tiles by kind and side for width 0", () => {
    expect(doorOpenTiles(0, 1, 0)).toEqual([0x350, 0x351]); // Lake Hylia room 2's cave door
    expect(doorOpenTiles(3, 1, 0)).toEqual([0x3b0, 0x3b1]); // room 3's house door
    expect(doorOpenTiles(0, 0, 0)).toEqual([0x342, 0x343]); // room 6's area 6 door
    expect(doorOpenTiles(8, 3, 0)).toEqual([0x3a6, 0x3b6]); // a curtain on a right-hand wall
  });

  it("gives four tiles for width 1 and six for width 2, jambs either end", () => {
    expect(doorOpenTiles(0, 1, 1)).toEqual([0x2ea, 0x2ee, 0x2ee, 0x2eb]);
    expect(doorOpenTiles(1, 3, 2)).toEqual([0x2ed, 0x2ff, 0x2ff, 0x2ff, 0x2ff, 0x2fd]);
  });

  it("has none for kinds 5-7, nor kinds past the wide tables", () => {
    for (const kind of [5, 6, 7]) expect(doorOpenTiles(kind, 0, 0)).toBeNull();
    expect(doorOpenTiles(3, 0, 2)).toBeNull();
    expect(doorOpenTiles(0, 0, 3)).toBeNull();
  });
});

describe("doorOpenTopTiles", () => {
  it("gives a cracked wall's lintel, and kind 4's, for width 0", () => {
    expect(doorOpenTopTiles(2, 1, 0)).toEqual([0x328, 0x329]); // Hyrule Castle room 5's garden wall (read in RAM)
    expect(doorOpenTopTiles(2, 3, 0)).toEqual([0x32f, 0x33f]); // room 9's area 3 wall, Tingle's Tower room 4's area 5
    expect(doorOpenTopTiles(4, 0, 0)).toEqual([0x39a, 0x39b]);
  });

  it("gives four tiles for a width-1 cracked wall, none for the other kinds and widths", () => {
    expect(doorOpenTopTiles(2, 2, 1)).toEqual([0x2c7, 0x2c8, 0x2c8, 0x2c9]);
    for (const kind of [0, 1, 3, 4, 8]) expect(doorOpenTopTiles(kind, 0, 1)).toBeNull();
    for (const kind of [0, 1, 3, 8]) expect(doorOpenTopTiles(kind, 0, 0)).toBeNull();
    expect(doorOpenTopTiles(2, 0, 2)).toBeNull();
  });
});
