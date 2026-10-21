// The pause screen's timeline against the Dolphin frame dumps (docs/measurements/screens.md "The pause screen in Dolphin").
import { describe, expect, it } from "vitest";
import { CONFIRM_IN, CONFIRM_IN_FROM, DIM, PLATE_FALL, PLATE_FALL_FROM, PLATE_IN, PLATE_IN_FROM, PLATE_OUT, PLATE_OUT_FROM, PauseState, RETURN_FROM } from "./pause-state.ts";

const run = (s: PauseState, ticks: number, input = {}) => {
  let out = null;
  for (let i = 0; i < ticks && !out; i++) out = s.step(input);
  return out;
};

describe("the pause screen", () => {
  it("dims the arena, then drops the plate in from above, landing past its place", () => {
    const s = new PauseState();
    expect(s.view()).toMatchObject({ dim: 0, plate: null });
    run(s, DIM.inFrom);
    expect(s.view().dim).toBeCloseTo(DIM.alpha / DIM.inTicks);
    run(s, PLATE_IN_FROM - DIM.inFrom);
    expect(s.view().plate).toBe(PLATE_IN[0]);
    run(s, 14);
    expect(s.view().plate).toBe(26); // 26 px low, then back
    run(s, PLATE_IN.length - 14);
    expect(s.phase).toBe("menu");
    expect(s.view()).toMatchObject({ dim: DIM.alpha, plate: 0, cursor: 0 });
  });

  it("moves the cursor (it stops at the ends) with a bounce, and Continue closes it: the plate dips and flies off", () => {
    const s = new PauseState();
    run(s, PLATE_IN_FROM + PLATE_IN.length);
    s.step({ up: true });
    expect(s.cursor).toBe(0);
    s.step({ down: true });
    expect(s.view()).toMatchObject({ cursor: 1, bounce: 0 });
    run(s, 4);
    expect(s.view().bounce).toBe(5);
    s.step({ down: true });
    s.step({ down: true });
    expect(s.cursor).toBe(2);
    s.step({ start: true });
    expect(s.phase).toBe("closing");
    run(s, PLATE_OUT_FROM);
    expect(s.view().plate).toBe(PLATE_OUT[0]);
    expect(run(s, 100)).toBe("continue");
  });

  it("asks before leaving: the plate falls out, the question drops in on No; No brings the plate back on Continue", () => {
    const s = new PauseState();
    run(s, PLATE_IN_FROM + PLATE_IN.length);
    s.step({ down: true });
    s.step({ a: true });
    expect([s.phase, s.question, s.answer]).toEqual(["choosing", "area", 1]);
    run(s, PLATE_FALL_FROM);
    expect(s.view().plate).toBe(PLATE_FALL[0]);
    run(s, CONFIRM_IN_FROM - PLATE_FALL_FROM);
    expect(s.view().confirm).toBe(CONFIRM_IN[0]);
    run(s, CONFIRM_IN.length);
    expect(s.phase).toBe("confirm");
    s.step({ b: true });
    expect(s.phase).toBe("answering");
    run(s, RETURN_FROM);
    expect([s.phase, s.cursor, s.question]).toEqual(["returning", 0, null]);
    expect(run(s, PLATE_IN.length)).toBeNull();
    expect(s.phase).toBe("menu");
  });

  it("Yes: the question falls out, the frame fades to black, then the outcome (the area select, or the home page)", () => {
    for (const [down, outcome] of [[1, "area"], [2, "game"]] as const) {
      const s = new PauseState();
      run(s, PLATE_IN_FROM + PLATE_IN.length);
      for (let i = 0; i < down; i++) s.step({ down: true });
      s.step({ a: true });
      run(s, CONFIRM_IN_FROM + CONFIRM_IN.length);
      s.step({ left: true });
      s.step({ a: true });
      expect(run(s, 200)).toBe(outcome);
    }
  });
});
