// The PowerPC decoder on hand-made words, and the main.dol analysis on the real disc (skipped when absent).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MainDol } from "./analysis.ts";
import { decode } from "./ppc.ts";

describe("PowerPC decoder", () => {
  it("decodes the instructions the analysis relies on", () => {
    expect(decode(0x38a0002b, 0)).toMatchObject({ op: "li", rd: 5, imm: 43 });
    expect(decode(0x38a501f4, 0)).toMatchObject({ op: "addi", rd: 5, ra: 5, imm: 500 });
    expect(decode(0x3c608047, 0)).toMatchObject({ op: "lis", rd: 3, imm: 0x8047 });
    expect(decode(0x3863c890, 0)).toMatchObject({ op: "addi", rd: 3, ra: 3, imm: -14192 });
    expect(decode(0x4be74e59, 0x8037b898)).toMatchObject({ op: "bl", target: 0x801f06f0 });
    expect(decode(0x41823ed0, 0x801f94d8)).toMatchObject({ op: "beq", target: 0x801fd3a8 });
    expect(decode(0x7c1d0000, 0)).toMatchObject({ op: "cmpw", ra: 29, rb: 0 });
    expect(decode(0x901f0274, 0)).toMatchObject({ op: "stw", rd: 0, ra: 31, imm: 0x274 });
    expect(decode(0x4e800421, 0).op).toBe("bctrl");
    expect(decode(0x7fe3fb78, 0)).toMatchObject({ op: "mr", rd: 3, ra: 31 });
  });

  it("decodes the float and paired-single forms used by the game's physics", () => {
    expect(decode(0x6c008000, 0)).toMatchObject({ op: "xoris", rd: 0, ra: 0, imm: 0x8000 });
    expect(decode(0x4c411382, 0).op).toBe("cror");
    expect(decode(0xe03f035c, 0)).toMatchObject({ op: "psq_l", rd: 1, ra: 31, imm: 0x35c });
    expect(decode(0xe01f8364, 0)).toMatchObject({ op: "psq_l", ra: 31, imm: 0x364 });
    expect(decode(0x102107d8, 0).op).toBe("ps_muls0");
    expect(decode(0x1001002a, 0).op).toBe("ps_add");
  });

  it("prints each float form's own operands (fmul's C, the multiply-adds' C and B)", () => {
    const text = (w: number) => { const i = decode(w, 0); return `${i.op} ${i.args}`; };
    expect(text(0xec000072)).toBe("fmuls f0, f0, f1"); // FLME's box × 1.5: frC is f1, frB is 0
    expect(text(0xec4510fa)).toBe("fmadds f2, f5, f3, f2"); // BEEE: 0.5 × rand + 1.5
    expect(text(0xec23093c)).toBe("fnmsubs f1, f3, f4, f1"); // shadow alpha − 0.5 × z
    expect(text(0xfca03034)).toBe("frsqrte f5, f6");
    expect(text(0xfc200850)).toBe("fneg f1, f1");
    expect(text(0xfc00001e)).toBe("fctiwz f0, f0");
    expect(text(0xfc010040)).toBe("fcmpo cr0, f1, f0");
    expect(text(0x102107d8)).toBe("ps_muls0 f1, f1, f31");
    expect(text(0x104200b2)).toBe("ps_mul f2, f2, f2");
    expect(text(0x109c173a)).toBe("ps_madd f4, f28, f28, f2");
    expect(text(0x7c03042e)).toBe("lfsx f0, r3, r0");
  });
});

const dolPath = new URL("../../../extracted/sys/main.dol", import.meta.url);

describe.skipIf(!existsSync(dolPath))("real disc: main.dol analysis", () => {
  const main = existsSync(dolPath) ? new MainDol(readFileSync(dolPath)) : null!;

  it("finds the small-data base registers", () => {
    expect(main.r2.toString(16)).toBe("80542fa0");
    expect(main.r13.toString(16)).toBe("80541bc0");
  });

  it("resolves the spawn switch to constructors and vtables", () => {
    expect(main.resolveSpawn("FGAL")).toEqual({ size: 960, ctor: 0x801ffd58 });
    expect(main.resolveSpawn("KNBN")).toEqual({ size: 568, ctor: 0x80203610 });
    expect(main.vtableOf(0x801ffd58)).toBe(0x804ae4b0);
    expect(main.resolveSpawn("NULL")).toBeNull();
  });

  it("reaches each type's sprite draw calls", () => {
    const frames = (id: string) => main.typeDraws(id)!.draws.map((d) => d.args);
    expect(frames("CNON").some((a) => a.includes("addi r30, r3, 332"))).toBe(true);
    expect(frames("RCK2").some((a) => a.includes('r4="enemy_both2_sob.bin" r5=43'))).toBe(true);
    expect(main.typeDraws("KNBN")!.draws).toEqual([]); // a tile object
  });

  it("finds data tables, float constants and callers", () => {
    // CRGN's init reads its item tables through lis/addi pairs.
    expect(main.xrefs(0x80465000).map((x) => x.func)).toContain(0x801296fc);
    expect(main.f32(0x80540440)).toBeCloseTo(0.95); // the Links' push decay
    expect(main.floatConstants(0.95).find((c) => c.addr === 0x80540440)?.users).toContain(0x80287e9c);
    expect(main.callers(0x80238548).some((c) => c.func === 0x80232a0c)).toBe(true); // hurt a player, from the PvP pass
    expect(main.functionListing(0x80272184)).toHaveLength(2); // li r3, 4; blr
    expect(main.fieldAccesses(0x35c, 0x80287e00, 0x80287f00).length).toBeGreaterThan(0); // psq_l at +0x35c
  }, 60_000); // (slow when the machine is busy)
});
