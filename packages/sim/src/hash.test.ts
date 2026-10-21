import { describe, expect, it } from "vitest";
import { cloneGame, createGame, stepGame } from "./game.ts";
import { hashGame, hashState } from "./hash.ts";
import { Button } from "./player.ts";
import type { World } from "./world.ts";

function openWorld(): World {
  const widthCells = 32, heightCells = 32;
  const solid = new Uint8Array(widthCells * heightCells);
  for (let y = 0; y < heightCells; y++) solid[y * widthCells + 20] = 1;
  return { widthCells, heightCells, solid, surface: new Uint8Array(solid.length), rooms: Int16Array.from([0]) };
}

describe("hashGame", () => {
  it("is stable: a known value for a known state (change deliberately if GameState changes)", () => {
    expect(hashState({ b: [1, 2, 3], a: "link", c: true, d: 0.5 })).toMatchInlineSnapshot(`579763624`);
  });

  it("ignores key order and undefined fields, but not types or values", () => {
    expect(hashState({ a: 1, b: 2 })).toBe(hashState({ b: 2, a: 1 }));
    expect(hashState({ a: 1, b: undefined })).toBe(hashState({ a: 1 }));
    const variants = [{ a: 1 }, { a: "1" }, { a: true }, { a: [1] }, { a: 1.5 }, { a: 2 }, { b: 1 }, { a: null }, { a: {} }, [], {}, 0, ""];
    expect(new Set(variants.map(hashState)).size).toBe(variants.length);
    expect(hashState(Int16Array.from([1, 2]))).not.toBe(hashState([1, 2]));
  });

  it("follows the game: equal for clones, different after divergent steps", () => {
    const world = openWorld();
    const a = createGame(world, [{ x: 40, y: 40 }, { x: 80, y: 40 }]);
    const b = cloneGame(a);
    expect(hashGame(a)).toBe(hashGame(b));
    for (let i = 0; i < 30; i++) {
      stepGame(a, [Button.Right, Button.Down], world);
      stepGame(b, [Button.Right, i === 29 ? Button.Up : Button.Down], world);
    }
    expect(hashGame(a)).not.toBe(hashGame(b));
    stepGame(a, [Button.Sword, 0], world);
    // cloneGame doesn't keep createGame's key order (so JSON.stringify differs): the sorted walk doesn't care.
    const c = cloneGame(a);
    expect(hashGame(c)).toBe(hashGame(a));
  });

  it("refuses non-serializable state", () => {
    expect(() => hashState({ f: () => 1 })).toThrow();
  });
});
