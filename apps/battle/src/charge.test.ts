import { describe, expect, it } from "vitest";
import { CHARGE_FULL, glintFrame, sparkleAt } from "./charge.ts";

describe("sword charge", () => {
  it("fills on the game's counter 48", () => {
    expect(CHARGE_FULL).toBe(48);
  });

  it("slides the sparkle along the blade as the counter rises", () => {
    expect(sparkleAt("right", 1)).toEqual([6, 0]);
    expect(sparkleAt("left", 47)).toEqual([-19, 0]);
    // RAM: counter 47 facing down, 623 at the Link + (4, 15).
    expect(sparkleAt("down", 47)).toEqual([4, 15]);
    expect(sparkleAt("up", 24)).toEqual([-4, -14]);
  });

  it("plays the glint 683, 684, 685, 686, 683 over 11 ticks", () => {
    expect([0, 2, 3, 5, 7, 9, 10, 11].map(glintFrame)).toEqual([683, 683, 684, 685, 686, 683, 683, -1]);
    expect(glintFrame(-1)).toBe(-1);
  });
});
