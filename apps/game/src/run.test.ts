import { describe, expect, it } from "vitest";
import type { AdventureCarry } from "@fso/sim/adventure";
import { carryFor, hashFor, loadRun, nextStage, saveCarry, saveRun, summary } from "./run.ts";

/** An in-memory sessionStorage. */
function memory(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } as unknown as Storage;
}
const CARRY: AdventureCarry = { hearts: [9, 5], maxHearts: 4, gear: "bow" };

describe("World 1 run", () => {
  it("chains the four stages then the end screen", () => {
    expect(nextStage("boss010")).toBe("boss011");
    expect(nextStage("boss011")).toBe("boss012");
    expect(nextStage("boss012")).toBe("boss013");
    expect(nextStage("boss013")).toBe("end");
    expect(nextStage("boss020")).toBeNull();
  });
  it("keeps the deep link's flags and drops the spawn", () => {
    expect(hashFor("stage=boss010&route&debug", "boss011")).toBe("stage=boss011&route&debug");
    expect(hashFor("stage=boss013&room=11&x=3&y=4&route", "end")).toBe("stage=end&route");
    expect(hashFor("", "boss011")).toBe("stage=boss011");
  });
  it("stores and sums the gems", () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    saveRun(s, { boss010: 100, boss011: 50 });
    const sum = summary(loadRun(s), (id) => id);
    expect(sum.total).toBe(150);
    expect(sum.rows.map((r) => r.gems)).toEqual(["100", "50", "-", "-"]);
    expect(loadRun({ getItem: () => "garbage" })).toEqual({});
  });
  it("hands the carry to the stage the clear went to, kept over a reload", () => {
    const s = memory();
    saveCarry(s, { stage: "boss011", carry: { ...CARRY } });
    expect(carryFor(s, "boss011", true)).toEqual(CARRY);
    expect(carryFor(s, "boss011", true)).toEqual(CARRY); // a reload of the stage
  });
  it("starts a stage fresh, and drops the carry, when it isn't the one it was handed to", () => {
    const s = memory();
    saveCarry(s, { stage: "boss011", carry: { ...CARRY } });
    expect(carryFor(s, "boss012", true)).toBeNull(); // the stage list's pick
    expect(carryFor(s, "boss011", true)).toBeNull(); // dropped by the one before
  });
  it("starts fresh with #run=off, whatever was handed on", () => {
    const s = memory();
    saveCarry(s, { stage: "boss011", carry: { ...CARRY } });
    expect(carryFor(s, "boss011", false)).toBeNull();
    expect(carryFor(s, "boss011", true)).toBeNull();
  });
  it("ends the carry with saveCarry(null), and reads nothing it can't check", () => {
    const s = memory();
    saveCarry(s, { stage: "boss011", carry: { ...CARRY } });
    saveCarry(s, null);
    expect(carryFor(s, "boss011", true)).toBeNull();
    s.setItem("fso-run-carry", JSON.stringify({ stage: "boss011", carry: { hearts: "9", maxHearts: 4, gear: "bow" } }));
    expect(carryFor(s, "boss011", true)).toBeNull();
    s.setItem("fso-run-carry", "garbage");
    expect(carryFor(s, "boss011", true)).toBeNull();
  });
});
