// The open doors' tiles (doorlook.ts, main.dol's tables at 0x8046D598, 0x8046D628, 0x8046D688).
import { describe, expect, it } from "vitest";
import { doorOpenTiles } from "./doorlook.ts";

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
