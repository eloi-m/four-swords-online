// The item held up over the Links while an item got from a pedestal shows its pose (enemies.ts heldUpLook).
import type { AdventureGame, GearKind } from "@fso/sim/adventure";
import { describe, expect, it } from "vitest";
import { heldUpLook } from "./enemies.ts";

const game = (gear: GearKind, get: { tick: number; pose: string } | null) => ({ adventure: { gear, get: get && { message: 0, ...get } } }) as unknown as AdventureGame;

describe("heldUpLook", () => {
  it("draws the item got (enemy_both2 64 + its number) for the item pose only", () => {
    expect(heldUpLook(game("bow", { tick: 20, pose: "item" }))).toEqual({ sob: "both2", frame: 68 });
    expect(heldUpLook(game("lamp", { tick: 0, pose: "item" }))).toEqual({ sob: "both2", frame: 66 });
    expect(heldUpLook(game("bow", null))).toBeNull();
    expect(heldUpLook(game("bow", { tick: 20, pose: "chest" }))).toBeNull();
  });
});
