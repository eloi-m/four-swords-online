// World 1's puzzles off the scripted routes (bent.ts, world1.ts): every variant ends as the scripted run does, or is a
// known result (EXPECTED: findings reported with captures, the puzzles' rules, the variants that aren't fair); the
// scripted routes' own stuck Links are the known ones. Skips without extracted/.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXPECTED, expectedProblem, milestonesPlayed, PUZZLES, playScenario, playVariant, puzzlesOf, SCENARIOS, SCRIPTED_STUCK, stageOf, variants } from "./bent.ts";
import { runRoute, type RouteRun } from "./play.ts";
import { EXTRACTED, loadStage, STAGES } from "./stage.ts";

for (const play of STAGES) {
  describe.skipIf(!existsSync(EXTRACTED))(`${play.name}'s bent routes`, () => {
    const { stage } = existsSync(EXTRACTED) ? loadStage(play.id) : ({} as ReturnType<typeof loadStage>);
    let run: RouteRun;
    const route = () => (run ??= runRoute(stage, play.milestones, milestonesPlayed(play)));

    it("plays the scripted route with only the known stuck Links", () => {
      const seen = route().stuck.flatMap((list, n) => list.map((s) => `${play.id}:${n}:${s.link}:${s.why}`));
      expect(seen.filter((k) => !SCRIPTED_STUCK.includes(k))).toEqual([]);
    }, 60_000); // (1-3 s alone; over the default 5 s in the whole suite's parallel run)

    for (const p of puzzlesOf(play)) {
      it(`${p.key}: ${p.name}`, () => {
        const vs = variants(p);
        expect(vs.length).toBeGreaterThanOrEqual(play.id === "boss010" ? 6 : 2);
        const unexpected = vs.map((v) => playVariant(stage, route(), p, v)).filter((r) => !r.ok && !expectedProblem(r.puzzle, r.variant));
        expect(unexpected.map((r) => `${r.variant}: ${r.problems.join("; ")}`)).toEqual([]);
      }, 60_000);
    }

    it("plays its scenarios", () => {
      for (const s of SCENARIOS.filter((x) => stageOf(x) === play)) expect(typeof playScenario(stage, route(), s).shows).toBe("boolean");
    });
  });
}

describe("the known results", () => {
  it("lists only variants that exist", () => {
    const names = new Set(PUZZLES.flatMap((p) => variants(p).map((v) => `${p.key} / ${v.name}`)));
    expect(Object.keys(EXPECTED).filter((k) => !names.has(k))).toEqual([]);
  });

  it("names each puzzle once", () => {
    expect(new Set(PUZZLES.map((p) => p.key)).size).toBe(PUZZLES.length);
  });
});
