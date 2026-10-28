// Slopes (tile types 0x08-0x0B, formats' slopeSolid): solid on one side of the tile's diagonal by pixel, so a Link
// walking straight into one slides along it by the corner sliding of player.ts (traced in Lake Hylia room 2's area 5:
// fourswitch.realdisc.test.ts replays it against Dolphin).
import { slopeSolid } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { Button, createPlayer, stepPlayer, SUBPX } from "./player.ts";
import { CELL, isSolidAt, slopeCell, type World } from "./world.ts";

/** A 64 × 64 px world: a 0x0A slope at (16, 16), walls above it (x ≥ 16, y < 16) and right of it (x ≥ 32). */
function slopeWorld(type = 0x0a): World {
  const w = 8, h = 8, solid = new Uint8Array(w * h), slopes = new Uint8Array(w * h);
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) if ((cy < 2 && cx >= 2) || cx >= 4) solid[cy * w + cx] = 1;
  const quadrants = { 0x08: 8, 0x09: 4, 0x0a: 2, 0x0b: 1 } as Record<number, number>;
  for (let q = 0; q < 4; q++) {
    const i = (2 + (q >> 1)) * w + 2 + (q & 1);
    if (quadrants[type]! & (1 << q)) solid[i] = 1;
    slopes[i] = slopeCell(type, q);
  }
  return { widthCells: w, heightCells: h, solid, surface: new Uint8Array(w * h), rooms: new Int16Array(64).fill(-1), slopes };
}

describe("slopes", () => {
  it("are solid on their diagonal and past it, by pixel", () => {
    // 0x08 bottom-right, 0x09 bottom-left, 0x0A top-right, 0x0B top-left (index type - 0x08).
    expect([slopeSolid(0, 7, 8), slopeSolid(0, 7, 7)]).toEqual([true, false]);
    expect([slopeSolid(1, 3, 3), slopeSolid(1, 4, 3)]).toEqual([true, false]);
    expect([slopeSolid(2, 3, 3), slopeSolid(2, 3, 4)]).toEqual([true, false]);
    expect([slopeSolid(3, 8, 7), slopeSolid(3, 8, 8)]).toEqual([true, false]);
    const world = slopeWorld();
    expect(world.slopes![2 * 8 + 2]).toBe(3); // the top-left quadrant: crossed
    expect(world.slopes![3 * 8 + 2]).toBe(0); // bottom-left: open
    expect([isSolidAt(world, 20, 18), isSolidAt(world, 18, 20), isSolidAt(world, 16 + CELL - 1, 16 + CELL - 1)]).toEqual([true, false, true]);
  });

  it("deflect a Link walking straight into one along the diagonal", () => {
    const world = slopeWorld(), p = createPlayer(20, 44, "up");
    const xs: number[] = [];
    for (let t = 0; t < 40; t++) {
      stepPlayer(p, Button.Up, world);
      xs.push(p.x / SUBPX);
    }
    // Slid left off the slope's face while climbing, then up past it (its top-left corner is at x 16).
    expect(Math.min(...xs)).toBeLessThan(16 - 4);
    expect(p.y / SUBPX).toBeLessThan(16);
  });
});
