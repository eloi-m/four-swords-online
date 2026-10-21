// The battle entities' enemy_both2_sob frames against the real lists; skipped when extracted/ is absent (e.g. in CI).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, loadSob, parseRarc } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { B2 } from "./entities.ts";

const root = new URL("../../../extracted/", import.meta.url);
const present = existsSync(new URL("files/GC4Sword_usa/data.arc", root));

describe.skipIf(!present)("real disc: battle entity sprites", () => {
  const data = present ? parseRarc(decompressYaz0(readFileSync(new URL("files/GC4Sword_usa/data.arc", root)))) : null!;
  const both2 = present ? loadSob(data, "enemy_both2_sob.bin") : null!;

  it("spins the boomerang through one graphic's four flips (104 is a creature's frame)", () => {
    const frames = B2.boomerang.map((f) => both2[f]!);
    for (const parts of frames) expect(parts).toHaveLength(1);
    const parts = frames.map((p) => p[0]!);
    expect(new Set(parts.map((p) => p.part)).size).toBe(1);
    expect(new Set(parts.map((p) => `${p.hflip}${p.vflip}`)).size).toBe(4);
    expect(both2[104]!.length).toBeGreaterThan(1);
  });

  it("draws arrows and seeds from small frames of their own", () => {
    for (const f of [...Object.values(B2.arrow), B2.seed]) expect(both2[f]).toHaveLength(1);
    // An arrow's four frames are one graphic, turned by flips.
    expect(new Set([B2.arrow.right, B2.arrow.left].map((f) => both2[f]![0]!.part)).size).toBe(1);
    expect(new Set([B2.arrow.down, B2.arrow.up].map((f) => both2[f]![0]!.part)).size).toBe(1);
  });
});
