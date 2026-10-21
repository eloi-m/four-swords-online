import { describe, expect, it } from "vitest";
import { cloneGame, createGame, stepGame } from "./game.ts";
import { Button, HITBOX, SUBPX, WALK_SPEED } from "./player.ts";
import { CELL, type World } from "./world.ts";

// 16×16-cell open world (128×128 px) with a wall column at cell x = 10 and a one-cell pillar at (4, 3).
function testWorld(): World {
  const widthCells = 16, heightCells = 16;
  const solid = new Uint8Array(widthCells * heightCells);
  for (let y = 0; y < heightCells; y++) solid[y * widthCells + 10] = 1;
  solid[3 * widthCells + 4] = 1;
  return { widthCells, heightCells, solid, surface: new Uint8Array(solid.length), rooms: Int16Array.from([0]) };
}

describe("sim", () => {
  it("turns on the first tick, then walks at WALK_SPEED on open floor", () => {
    const world = testWorld();
    const game = createGame(world, [{ x: 20, y: 60 }]);
    stepGame(game, [Button.Right], world);
    expect(game.players[0]!.x).toBe(20 * SUBPX);
    expect(game.players[0]!.facing).toBe("right");
    for (let i = 0; i < 9; i++) stepGame(game, [Button.Right], world);
    expect(game.players[0]!.x).toBe(20 * SUBPX + 9 * WALK_SPEED);
  });

  it("stops at walls", () => {
    const world = testWorld();
    const game = createGame(world, [{ x: 60, y: 100 }]);
    for (let i = 0; i < 100; i++) stepGame(game, [Button.Right], world);
    const right = Math.floor(game.players[0]!.x / SUBPX) + HITBOX.right; // right sensor
    expect(right).toBe(10 * CELL - 1);
  });

  it("slides around a corner within the nudge range", () => {
    const world = testWorld();
    // Walking up into the pillar at cell (4, 3) = x 32..39: the up-left corner sensor (x - 5) catches it, the middle
    // of the top side doesn't, so Link slides right (to x 45) and gets past; alongside the pillar his left sensor
    // (x - 7) pushes him out to x 47.
    const game = createGame(world, [{ x: 43, y: 50 }]);
    for (let i = 0; i < 20; i++) stepGame(game, [Button.Up], world);
    expect(Math.floor(game.players[0]!.x / SUBPX)).toBe(47);
    expect(Math.floor(game.players[0]!.y / SUBPX)).toBeLessThan(30); // got past the pillar
  });

  it("is deterministic", () => {
    const world = testWorld();
    const script = Array.from({ length: 300 }, (_, i) => [Button.Right | Button.Up, Button.Down, Button.Left, 0][(i >> 5) & 3]!);
    const run = () => {
      const game = createGame(world, [{ x: 40, y: 60 }]);
      const snaps = script.map((b) => cloneGame(stepGame(game, [b], world)));
      return JSON.stringify(snaps.at(-1));
    };
    expect(run()).toBe(run());
  });
});
