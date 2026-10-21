// What a stage hands on to the next one of a run (adventure.ts carryOf and applyCarry): the Links' hearts and the
// leader's item, out and in. Plain fighters and a leader's gear, no stage data needed.
import { describe, expect, it } from "vitest";
import { createFighter } from "../combat.ts";
import { applyCarry, carryOf, type AdventureCarry, type AdventureGame } from "./adventure.ts";
import type { GearKind } from "./gear.ts";

const SPAWN = { x: 0, y: 0, facing: "down" as const };
/** A game of Links at these hearts (quarter hearts), a maximum of 4 hearts, and the leader's gear. */
function gameWith(hearts: number[], gear: GearKind = ""): AdventureGame {
  const fighters = hearts.map((h) => createFighter(h, SPAWN));
  return { tick: 0, players: [], battle: { rules: { hearts: 4 }, fighters }, adventure: { gear } } as unknown as AdventureGame;
}

describe("a stage's carry into the next one", () => {
  it("carries each Link's current hearts, the maximum and the leader's item", () => {
    expect(carryOf(gameWith([10, 10, 10, 10], "bow"))).toEqual({ hearts: [10, 10, 10, 10], maxHearts: 4, gear: "bow" });
    expect(carryOf(gameWith([16]))).toEqual({ hearts: [16], maxHearts: 4, gear: "" });
  });

  it("carries a Link out of hearts at the maximum, as it gets up with it", () => {
    expect(carryOf(gameWith([0, 6])).hearts).toEqual([16, 6]);
  });

  it("puts the hearts and the item into a new game's Links", () => {
    const next = gameWith([16, 16, 16, 16]);
    applyCarry(next, { hearts: [9, 5, 1, 12], maxHearts: 4, gear: "bow" });
    expect(next.battle.fighters.map((f) => f.hearts)).toEqual([9, 5, 1, 12]);
    expect(next.adventure.gear).toBe("bow");
    expect(next.battle.fighters[0]!.item).toBe("bow"); // the battle's own item for a bow (giveGear)
  });

  it("round-trips: what a stage ends with is what the next one starts with", () => {
    const end = gameWith([7, 3], "boomerang");
    const carry = carryOf(end);
    const start = gameWith([16, 16]);
    applyCarry(start, carry);
    expect(carryOf(start)).toEqual(carry);
    expect(start.battle.fighters[0]!.item).toBe("boomerang");
  });

  it("carries an item the battle doesn't have as the leader's gear only", () => {
    const next = gameWith([16]);
    applyCarry(next, { hearts: [16], maxHearts: 4, gear: "lamp" });
    expect(next.adventure.gear).toBe("lamp");
    expect(next.battle.fighters[0]!.item).toBe("");
  });

  it("clamps hearts to the maximum and to at least one quarter, and gives full hearts to a Link the carry lacks", () => {
    const next = gameWith([16, 16, 16]);
    const carry: AdventureCarry = { hearts: [40, 0], maxHearts: 4, gear: "" };
    applyCarry(next, carry);
    expect(next.battle.fighters.map((f) => f.hearts)).toEqual([16, 1, 16]);
  });
});
