import { describe, expect, it } from "vitest";
import { ADAPT_DOWN_CHECKS, ADAPT_SLACK, AdaptiveFrames } from "./adapt.ts";

/** Runs `ticks` ticks of a constant (or per-tick) need; returns the value after each move. */
function run(a: AdaptiveFrames, ticks: number, need: number | ((tick: number) => number), canLower = true): number[] {
  const moves: number[] = [];
  for (let t = 0; t < ticks; t++) if (a.update(typeof need === "number" ? need : need(t), canLower) !== 0) moves.push(a.value);
  return moves;
}

describe("adaptive frames (the input delay's and the spectator buffer's rule)", () => {
  it("climbs one frame per interval to the need's ceiling, and stays there", () => {
    const a = new AdaptiveFrames(2, 1, 8, 30);
    expect(run(a, 600, 4.2)).toEqual([3, 4, 5]);
    expect(a.target).toBeCloseTo(4.2, 5);
  });

  it("doesn't flap on a need wandering within the hysteresis band", () => {
    const a = new AdaptiveFrames(5, 1, 8, 30);
    // Between 4 − ADAPT_SLACK (+ a little) and 5: one frame less could be too few, more isn't needed.
    const low = 4 - ADAPT_SLACK + 0.01;
    expect(run(a, 6000, (t) => low + ((Math.sin(t / 50) + 1) / 2) * (5 - low))).toEqual([]);
  });

  it("goes down only after ADAPT_DOWN_CHECKS checks in a row with a frame to spare, and not under its minimum", () => {
    const a = new AdaptiveFrames(5, 3, 8, 30);
    run(a, 1, 2); // (smoothing starts from the first need)
    const moves: number[] = [];
    for (let t = 1; t < 1000; t++) if (a.update(2) !== 0) moves.push(t);
    expect(moves.length).toBe(2);
    expect(moves[0]).toBe(30 * ADAPT_DOWN_CHECKS - 1);
    expect(a.value).toBe(3);
  });

  it("holds a move down while the caller can't take it, and forgets an unknown need", () => {
    const a = new AdaptiveFrames(5, 1, 8, 10);
    expect(run(a, 200, 1, false)).toEqual([]);
    expect(run(a, 15, 1)).toEqual([4]);
    a.update(NaN);
    expect(a.target).toBeNaN();
    expect(run(a, 100, NaN)).toEqual([]);
  });

  it("stays within [min, max]", () => {
    const a = new AdaptiveFrames(2, 1, 6, 5);
    expect(run(a, 500, 20)).toEqual([3, 4, 5, 6]);
    expect(run(a, 500, 0)).toEqual([5, 4, 3, 2, 1]);
  });
});
