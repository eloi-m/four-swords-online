import { describe, expect, it } from "vitest";
import { gridRoom } from "./sim.ts";

const cave = { index: 11, cellOf: (room: number) => (room === 8 ? null : { cx: room % 4, cy: Math.floor(room / 4) }) };

describe("places in our sim", () => {
  it("plays an off-grid room alone at the cell it is loaded in", () => {
    expect(gridRoom(cave, 8)).toBe(9);
    expect(gridRoom(cave, 3)).toBe(3);
    expect(gridRoom({ ...cave, index: 10 }, 8)).toBe(8);
  });
});
