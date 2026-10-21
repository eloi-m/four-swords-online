// The JPA simulation on every effect of particle.jpc; skipped when extracted/ is absent (e.g. in CI).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, parseJpac, parseRarc, type Jpac } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { FSA_VIEW } from "./draw.ts";
import { JpaDrawContext, JpaEmitter } from "./emitter.ts";

const root = new URL("../../../../extracted/files/GC4Sword_usa/", import.meta.url);
const present = existsSync(root);

function load(): Jpac {
  const data = parseRarc(decompressYaz0(readFileSync(new URL("data.arc", root))));
  return parseJpac(data.files.find((f) => f.path === "particle.jpc")!.data);
}

const positions = (e: JpaEmitter) => [...e.base, ...e.children].flatMap((p) => [...p.position]);

describe.skipIf(!present)("real disc: JPA simulation", () => {
  const jpc = present ? load() : null;

  it("steps every effect for 3 s with finite particles and draw matrices", () => {
    const ctx = new JpaDrawContext({ view: FSA_VIEW });
    let drawn = 0, peak = 0;
    for (const res of jpc!.resources) {
      const e = new JpaEmitter(res, res.id * 7919);
      e.translation.set([100, 200, 0]);
      for (let t = 0; t < 180 && e.step(); t++) {
        peak = Math.max(peak, e.particleCount);
        if (t % 30 !== 29) continue;
        expect(positions(e).every(Number.isFinite), `effect ${res.id} at frame ${t}`).toBe(true);
        for (const child of [false, true]) {
          if (child && !res.childShape) continue;
          ctx.begin(e, child);
          for (const p of child ? e.children : e.base) {
            const d = ctx.particle(e, p);
            if (!d) continue;
            drawn++;
            expect([...d.posMtx, ...d.prm, ...d.texS].every(Number.isFinite), `effect ${res.id} draw`).toBe(true);
          }
        }
      }
      e.dispose();
    }
    expect(drawn).toBeGreaterThan(10000);
    expect(peak).toBeLessThan(2000);
  }, 30_000); // all 1394 effects × 180 ticks

  it("replays the same particles from the same seed", () => {
    const run = (seed: number) => {
      const e = new JpaEmitter(jpc!.resources[842]!, seed);
      for (let t = 0; t < 40; t++) e.step();
      const out = positions(e);
      e.dispose();
      return out;
    };
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  });

  it("ends one-shot emitters once their particles are gone, and keeps endless ones going", () => {
    // 855: grass bits (12 at once, maxFrame 1, 30 frames of life); 842: a flame (maxFrame 0).
    const once = new JpaEmitter(jpc!.resources[855]!, 1);
    let frames = 0;
    while (once.step()) frames++;
    expect(frames).toBeGreaterThan(20);
    expect(frames).toBeLessThan(40);
    const flame = new JpaEmitter(jpc!.resources[842]!, 1);
    for (let t = 0; t < 600; t++) expect(flame.step()).toBe(true);
    expect(flame.base.length).toBeGreaterThan(0);
    flame.becomeInvalid();
    let left = 0;
    while (flame.step()) left++;
    expect(left).toBeLessThanOrEqual(61);
    once.dispose();
    flame.dispose();
  });
});
