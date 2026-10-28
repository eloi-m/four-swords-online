import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRarc } from "../rarc.ts";
import { decompressYaz0 } from "../yaz0.ts";
import { animateChars, charAnimationFrame, loadCharAnimations, type CharAnimation } from "./bganim.ts";
import { loadTileset } from "./stage.ts";

describe("animated background tiles", () => {
  const frames = (n: number) => Array.from({ length: n }, (_, i) => new Uint8Array(4).fill(i + 1));

  it("steps on the 10th frame, then every period, wrapping around", () => {
    const water: CharAnimation = { dest: 0, frames: frames(8), first: 10, period: 10 };
    expect([0, 9, 10, 19, 20, 79, 80, 89, 90].map((t) => charAnimationFrame(water, t))).toEqual([-1, -1, 1, 1, 2, 7, 0, 0, 1]);
    const slow: CharAnimation = { dest: 0, frames: frames(8), first: 10, period: 20 };
    expect([10, 29, 30, 50].map((t) => charAnimationFrame(slow, t))).toEqual([1, 1, 2, 3]);
  });

  it("applies frames over a copy of the sheet", () => {
    const chars = new Uint8Array(8);
    const out = animateChars(chars, [{ dest: 2, frames: frames(4), first: 10, period: 10 }], 25);
    expect([...out]).toEqual([0, 0, 3, 3, 3, 3, 0, 0]);
    expect([...animateChars(chars, [{ dest: 2, frames: frames(4), first: 10, period: 10 }], 5)]).toEqual([...chars]);
    expect(chars.every((b) => b === 0)).toBe(true);
  });
});

const root = new URL("../../../../extracted/files/GC4Sword_usa/", import.meta.url);

describe.skipIf(!existsSync(root))("real disc: animated background tiles", () => {
  if (!existsSync(root)) return void it.skip("needs extracted/", () => {});
  const data = parseRarc(decompressYaz0(readFileSync(new URL("data.arc", root))));
  const water = data.files.find((f) => f.path === "sch/bg_anim_b_sch.bin")!.data;

  it("Lake Hylia (tileset m) animates the water parts 0x1C0-0x1FF from bg_anim_b, 8 frames of 10 ticks", () => {
    const [anim, ...rest] = loadCharAnimations(data, 12);
    expect(rest).toEqual([]);
    expect([anim!.dest, anim!.frames.length, anim!.frames[0]!.length, anim!.period]).toEqual([0x3800, 8, 0x800, 10]);
    expect(anim!.frames[3]).toEqual(water.subarray(0x1800, 0x2000));
    // Before the first copy the tileset's own parts show; they are the water's frame 0 except part 0x1CF.
    const own = loadTileset(data, 12).chars.subarray(0x3800, 0x4000);
    const differing = new Set<number>();
    for (let i = 0; i < 0x800; i++) if (own[i] !== anim!.frames[0]![i]) differing.add(0x1c0 + (i >> 5));
    expect([...differing]).toEqual([0x1cf]);
  });

  it("tileset q uses the second half of bg_anim_b; l, s, w, k, v, y and 1b also animate bg_anim slices", () => {
    expect(loadCharAnimations(data, 16)[0]!.frames[0]).toEqual(water.subarray(0x4000, 0x4800));
    const extra = (index: number) => loadCharAnimations(data, index).slice(1).map((a) => [a.dest, a.frames.length, a.frames[0]!.length, a.period]);
    expect(extra(11)).toEqual([[0x5800, 8, 0x400, 20]]); // l
    expect(extra(18)).toEqual([[0x1c00, 8, 0x400, 10]]); // s
    expect(extra(10)).toEqual([[0x5c00, 4, 0x400, 10]]); // k
    expect(extra(27)).toEqual([[0x5800, 4, 0x800, 10]]); // 1b
    expect(extra(0)).toEqual([]);
  });
});
