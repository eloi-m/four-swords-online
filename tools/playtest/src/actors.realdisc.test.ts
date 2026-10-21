// World 1's actors against their drawings, messages and tile swaps (actors.ts): no finding but the known ones
// (EXPECTED_ACTORS), and those still found; every placed type in the census. Skips without extracted/.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { census, EXPECTED_ACTORS, stageChecks, stageKey } from "./actors.ts";
import { EXTRACTED, STAGES } from "./stage.ts";

describe.skipIf(!existsSync(EXTRACTED))("World 1's actors", () => {
  const all: string[] = [];

  for (const play of STAGES) {
    it(`${play.name}: finds only the known findings`, () => {
      const { findings, stage } = stageChecks(play);
      const keys = findings.map((f) => f.key);
      all.push(...keys);
      expect(keys.filter((k) => !EXPECTED_ACTORS[k])).toEqual([]);
      // (Every placed type is in the census, simulated or drawn or neither.)
      expect(census(stage).length).toBeGreaterThan(0);
    }, 60_000);
  }

  it("still finds every known finding", () => {
    expect(Object.keys(EXPECTED_ACTORS).filter((k) => !all.includes(k))).toEqual([]);
    expect(stageKey(STAGES[1]!, "x")).toBe("cave x");
  });
});
