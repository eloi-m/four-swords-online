import { describe, expect, it } from "vitest";
import { actorTable, clipDiff, countStatus, diffActors } from "./diff.ts";

describe("actor diff", () => {
  it("pairs actors of a kind, nearest first, within ±4 px as the same", () => {
    const dolphin = [
      { kind: "HNRY", x: 337.3, y: 176 },
      { kind: "RUPY", x: 100, y: 100 },
      { kind: "RUPY", x: 200, y: 100 },
      { kind: "PLAS", x: 50, y: 50 },
    ];
    const ours = [
      { kind: "RUPY", x: 203, y: 101 },
      { kind: "RUPY", x: 100, y: 100 },
      { kind: "HNRY", x: 312, y: 176, state: "gem" },
      { kind: "HBMB", x: 136, y: 248 },
    ];
    const rows = diffActors(dolphin, ours);
    expect(rows.map((r) => [r.kind, r.status])).toEqual([
      ["HNRY", "moved"],
      ["RUPY", "same"],
      ["RUPY", "same"],
      ["PLAS", "missing"],
      ["HBMB", "extra"],
    ]);
    expect(rows[0]!.dx).toBeCloseTo(-25.3);
    expect(rows[2]!.ours).toEqual({ kind: "RUPY", x: 203, y: 101 });
    expect(countStatus(rows)).toEqual({ same: 2, moved: 1, missing: 1, extra: 1 });
  });

  it("takes any of the IDs that share a vtable", () => {
    const rows = diffActors([{ kind: "SLR1/SLR2", x: 10, y: 10 }], [{ kind: "SLR2", x: 10, y: 14 }]);
    expect(rows).toEqual([{ kind: "SLR1/SLR2", status: "same", dolphin: { kind: "SLR1/SLR2", x: 10, y: 10 }, ours: { kind: "SLR2", x: 10, y: 14 }, dx: 0, dy: 4 }]);
  });

  it("tabulates the differences first", () => {
    const table = actorTable(diffActors([{ kind: "A", x: 0, y: 0 }, { kind: "B", x: 0, y: 0 }], [{ kind: "A", x: 0, y: 0 }]));
    expect(table.split("\n").slice(2)).toEqual(["| B | missing | (0.0, 0.0) | - |  |", "| A | same | (0.0, 0.0) | (0.0, 0.0) | 0.0, 0.0 |"]);
  });
});

describe("clip diff", () => {
  const at = (x: number, y = 0, state = "") => ({ x, y, state });
  it("finds the first frame a Link drifts past the tolerance", () => {
    const dolphin = [[at(0), at(10)], [at(1.5), at(10)], [at(3), at(10)], [at(4.5), at(10)]];
    const ours = [[at(0), at(10)], [at(1.5), at(10.5)], [at(3), at(8)], [at(3), at(10)]];
    const { worst, first } = clipDiff(dolphin, ours);
    expect(worst).toEqual([0, 0.5, 2, 1.5]);
    expect(first).toEqual({ frame: 2, link: 1, dolphin: at(10), ours: at(8), off: 2 });
    expect(clipDiff(dolphin, ours, 2).first).toBeNull();
    expect(clipDiff(dolphin, dolphin).first).toBeNull();
  });
});
