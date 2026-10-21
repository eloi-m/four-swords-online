import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, loadSob, loadSpriteSheet, parseRarc, spriteBounds, type SpriteFrame } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { CHARGE, LUNGE, PLAYER_ANIMATIONS, PLAYER_FRAME_COUNT, SPIN, STAB, SWING, SWORD_BOXES, type AnimationEntry } from "./animations.ts";

const framesOf = (entry: AnimationEntry): readonly number[] =>
  Array.isArray(entry.frames) ? entry.frames : Object.values(entry.frames).flat();
const DIRS = ["right", "left", "down", "up"] as const;

describe("player animation tables", () => {
  it("classify every frame of player_sob.bin", () => {
    const all = Object.values(PLAYER_ANIMATIONS as Record<string, AnimationEntry>).flatMap(framesOf);
    expect(all.every((f) => Number.isInteger(f) && f >= 0 && f < PLAYER_FRAME_COUNT)).toBe(true);
    expect(new Set(all).size).toBe(PLAYER_FRAME_COUNT);
  });

  it("give every animated frame a duration and every sword frame a box", () => {
    const attacks = [SWING, STAB, LUNGE, SPIN];
    for (const dir of DIRS) {
      for (const a of attacks) expect(a.frames[dir].length).toBe(a.ticks.length);
      expect(CHARGE.walk[dir].length).toBe(CHARGE.walkTicks.length);
      const charge = [CHARGE.stand[dir], ...CHARGE.walk[dir]];
      for (const f of [...attacks.flatMap((a) => a.frames[dir]), ...charge, ...charge.map((f) => f + CHARGE.glowOffset)]) {
        expect(SWORD_BOXES[f], `frame ${f}`).toBeDefined();
      }
    }
    expect([...attacks.flatMap((a) => a.ticks), ...CHARGE.walkTicks].every((t) => Number.isInteger(t) && t > 0)).toBe(true);
  });
});

const dataArc = new URL("../../../extracted/files/GC4Sword_usa/data.arc", import.meta.url);

describe.skipIf(!existsSync(dataArc))("player animation tables against the real player_sob.bin", () => {
  const data = parseRarc(decompressYaz0(readFileSync(dataArc)));
  const frames = loadSob(data, "player_sob.bin");
  const sheet = loadSpriteSheet(data, 8);
  const same = (a: SpriteFrame, b: SpriteFrame) =>
    JSON.stringify(a.map((p) => JSON.stringify(p)).sort()) === JSON.stringify(b.map((p) => JSON.stringify(p)).sort());

  it("SWORD_BOXES are the bounds of the palette-10 (sword) parts", () => {
    expect(frames.length).toBe(PLAYER_FRAME_COUNT);
    for (const [frame, box] of Object.entries(SWORD_BOXES)) {
      const b = spriteBounds(sheet, frames[Number(frame)]!, (p) => p.palette === 10);
      expect(b && [b.left, b.top, b.right, b.bottom], `frame ${frame}`).toEqual(box);
    }
  });

  it("glowing charge frames differ from their normal frame only in the sword", () => {
    for (const dir of DIRS) {
      for (const f of [CHARGE.stand[dir], ...CHARGE.walk[dir], ...PLAYER_ANIMATIONS.chargeWalkBack.frames[dir].filter((f) => f % 2 === 1)]) {
        const body = (i: number) => frames[i]!.filter((p) => p.palette !== 10);
        expect(same(body(f), body(f + CHARGE.glowOffset)), `frame ${f}`).toBe(true);
        expect(same(frames[f]!, frames[f + CHARGE.glowOffset]!), `frame ${f}`).toBe(false);
      }
    }
  });

  it("stand frames repeat the walk cycles' first frames; the stand-alone spin reuses the spin cycle", () => {
    for (const [i, dir] of DIRS.entries()) expect(same(frames[PLAYER_ANIMATIONS.stand.frames[dir][0]]!, frames[i * 8]!)).toBe(true);
    for (const [spin, cycle] of [[221, 144], [223, 147], [224, 148], [225, 149], [226, 150], [227, 143], [228, 144]]) {
      expect(same(frames[spin!]!, frames[cycle!]!)).toBe(true);
    }
  });
});
