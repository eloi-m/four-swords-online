// The rollback-safe effect layer on particle.jpc; skipped when extracted/ is absent (e.g. in CI).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, fsaParticlePlacement, parseJpac, parseRarc, type Jpac } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { JpaEffects, type JpaEffectSpec } from "./effects.ts";

const root = new URL("../../../../extracted/files/GC4Sword_usa/", import.meta.url);
const present = existsSync(root);

function load(): Jpac {
  const data = parseRarc(decompressYaz0(readFileSync(new URL("data.arc", root))));
  return parseJpac(data.files.find((f) => f.path === "particle.jpc")!.data);
}

const mapping = { zBase: 2, zScale: 1 / 1024 };
const explosion = (start: number): JpaEffectSpec[] =>
  [89, 90, 91].map((id) => ({ key: `boom:7:${id}`, start, placement: fsaParticlePlacement(id, 200, 150, 0, { layer: 1, sublayer: 1 })! }));
const positions = (fx: JpaEffects, key: string) => {
  const e = fx.emitterOf(key);
  return e ? [...e.base, ...e.children].flatMap((p) => [...p.position].map((v) => Math.round(v * 1e6) / 1e6)) : [];
};

describe.skipIf(!present)("real disc: JPA effects", () => {
  const jpc = present ? load() : null;

  it("shows the same particles at a tick however it got there (frames skipped, a rollback)", () => {
    const straight = new JpaEffects(jpc!, mapping);
    for (let t = 100; t <= 140; t++) straight.sync(t, t >= 110 ? explosion(110) : []);
    const skipped = new JpaEffects(jpc!, mapping);
    skipped.sync(100, []);
    skipped.sync(125, explosion(110));
    skipped.sync(140, explosion(110));
    const rewound = new JpaEffects(jpc!, mapping);
    for (let t = 100; t <= 132; t++) rewound.sync(t, t >= 110 ? explosion(110) : []);
    for (let t = 120; t <= 140; t++) rewound.sync(t, explosion(110));
    for (const id of [89, 90, 91]) {
      const want = positions(straight, `boom:7:${id}`);
      expect(want.length).toBeGreaterThan(0);
      expect(positions(skipped, `boom:7:${id}`)).toEqual(want);
      expect(positions(rewound, `boom:7:${id}`)).toEqual(want);
    }
  });

  it("drops an effect a rollback undid, replaces one whose start moved, lets an ended one play out", () => {
    const fx = new JpaEffects(jpc!, mapping);
    for (let t = 100; t <= 120; t++) fx.sync(t, explosion(110));
    // Rolled back to before the explosion: it's gone.
    fx.sync(105, []);
    expect(fx.emitterOf("boom:7:89")).toBeUndefined();
    // It happens 3 ticks later in the new timeline: a fresh emitter.
    for (let t = 106; t <= 118; t++) fx.sync(t, t >= 113 ? explosion(113) : []);
    const late = new JpaEffects(jpc!, mapping);
    for (let t = 113; t <= 118; t++) late.sync(t, explosion(113));
    expect(positions(fx, "boom:7:90")).toEqual(positions(late, "boom:7:90"));
    // Its entity ends: the emitters stay until their particles are gone.
    fx.sync(119, []);
    expect(fx.emitterOf("boom:7:89")).toBeDefined();
    for (let t = 120; t <= 400; t++) fx.sync(t, []);
    expect(fx.emitterCount).toBe(0);
  });

  it("warms an endless effect up instead of replaying its past, and makes queued flames at each spot", () => {
    const fx = new JpaEffects(jpc!, mapping);
    // A jet's idle flame (430) that started at tick 0, first seen at tick 10000.
    const jet = { key: "jet:3", start: 0, placement: fsaParticlePlacement(430, 256, 192, 0, { layer: 1, sublayer: 1, scale: 0.5 })! };
    fx.sync(10000, [jet]);
    expect(fx.emitterOf("jet:3")!.age).toBe(10001);
    expect(fx.emitterOf("jet:3")!.particleCount).toBeGreaterThan(0);
    // Eternal flames: 845 queued at two spots for a second makes particles around both.
    const flames = [10, 300].map((x) => ({ key: `flame:${x}`, start: 0, placement: fsaParticlePlacement(845, x, 100, 0)! }));
    for (let t = 1; t <= 60; t++) fx.sync(10000 + t, [jet, ...flames]);
    expect(fx.renderer.stats.particles).toBeGreaterThan(10);
    fx.dispose();
  });
});
