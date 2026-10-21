import { describe, expect, it } from "vitest";
import { boltPlacement, brkFrame, Lightning, SKY_H, SKY_W, skyView, STRIKE } from "./title-sky.ts";

describe("the title screen's lightning", () => {
  it("shows the .brk frame of a strike's frames left, as the game (lit while ≥ 59, then fading)", () => {
    expect([60, 59, 39, 36, 35, 1, 0].map(brkFrame)).toEqual([100, 98, 65, 60, 58, 1, 0]);
  });

  // A Dolphin trace of the title (docs/measurements/screens.md "The title screen's sky in Dolphin"): its countdowns at 19 and
  // 80, two near strikes under way (39 and 1 frames left); the near strike came on frame 19, the far one on 80.
  const traced = () => {
    const l = new Lightning(0xa9725521, 19, 80);
    Object.assign(l.slots[0]!, { id: STRIKE.near, timer: 39 });
    Object.assign(l.slots[1]!, { id: STRIKE.near, timer: 1 });
    return l;
  };

  it("strikes when a countdown runs out, into the first free slot, and lights the layers as traced", () => {
    const l = traced();
    const frames = Array.from({ length: 100 }, (_, t) => ({ t, ...l.step(t), slots: l.slots.map((s) => ({ ...s })) }));
    // The trace's .brk frames: 65 then 63 (39, 38 frames left), 100 on the near strike, 100 on the far clouds only on
    // the far one, 98 a frame later.
    expect([frames[0]!.near, frames[1]!.near, frames[19]!.near, frames[19]!.far]).toEqual([65, 63, 100, 100]);
    expect([frames[79]!.near, frames[79]!.far, frames[80]!.near, frames[80]!.far, frames[81]!.far]).toEqual([0, 0, 0, 100, 98]);
    // Slot 1 (free since frame 1) takes the near strike, slot 0 (free since 39) the far one.
    expect(frames[19]!.slots[1]).toMatchObject({ id: STRIKE.near, timer: 59, start: 19 });
    expect(frames[80]!.slots[0]).toMatchObject({ id: STRIKE.far, timer: 59, start: 80 });
    // Where strikes land: near ones x −150…150, y 96…144; far ones 48…120 px either side, y −64…0.
    const near = frames[19]!.slots[1]!, far = frames[80]!.slots[0]!;
    expect(near.x).toBeGreaterThanOrEqual(-150);
    expect(near.x).toBeLessThan(150);
    expect(near.y).toBeGreaterThanOrEqual(96);
    expect(near.y).toBeLessThan(144);
    expect(Math.abs(far.x)).toBeGreaterThanOrEqual(48);
    expect(Math.abs(far.x)).toBeLessThan(120);
    expect(far.y).toBeGreaterThanOrEqual(-64);
    expect(far.y).toBeLessThan(0);
  });

  it("strikes again within its waits (near every 0-309 frames, far every 0-179), never more than four at once", () => {
    const l = new Lightning(12345);
    const starts: Record<number, number[]> = { [STRIKE.near]: [], [STRIKE.far]: [] };
    for (let t = 0; t < 20_000; t++) {
      const before = l.slots.map((s) => s.start);
      l.step(t);
      l.slots.forEach((s, i) => s.start !== before[i] && starts[s.id]!.push(t));
      expect(l.live().length).toBeLessThanOrEqual(STRIKE.slots);
    }
    for (const [id, every] of [[STRIKE.near, STRIKE.nearEvery], [STRIKE.far, STRIKE.farEvery]] as const) {
      const gaps = starts[id]!.slice(1).map((t, i) => t - starts[id]![i]!);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(every);
      expect(gaps.length).toBeGreaterThan(20_000 / every);
    }
  });

  it("places a bolt as the environment manager does: (304, 224) + the strike, at its depth, ×7", () => {
    expect(boltPlacement({ id: STRIKE.near, x: -12, y: 144 })).toMatchObject({ translation: [292, 368, -657], rotation: "swapYZ", dynamicsScale: [7, 7, 7], particleScale: [7, 7] });
    expect(boltPlacement({ id: STRIKE.far, x: -84, y: -56 }).translation).toEqual([220, 168, -849]);
  });
});

describe("the title screen's frame on the page", () => {
  it("covers the canvas, centered across, 35% down", () => {
    expect(skyView(SKY_W, SKY_H)).toEqual({ left: 0, right: SKY_W, top: 0, bottom: SKY_H });
    const wide = skyView(1600, 900);
    expect(wide.left).toBe(0);
    expect(wide.right).toBe(SKY_W);
    expect(wide.bottom - wide.top).toBeCloseTo((SKY_W * 900) / 1600);
    expect(wide.top).toBeCloseTo((SKY_H - (SKY_W * 900) / 1600) * 0.35);
    const tall = skyView(400, 800);
    expect(tall.top).toBe(0);
    expect(tall.bottom).toBe(SKY_H);
    expect((tall.left + tall.right) / 2).toBeCloseTo(SKY_W / 2);
  });
});
