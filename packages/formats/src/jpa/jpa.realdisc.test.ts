// data.arc's particle.jpc (every JPA effect of the game); skipped when extracted/ is absent (e.g. in CI).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRarc } from "../rarc.ts";
import { decompressYaz0 } from "../yaz0.ts";
import { decodeJpaTexture, isJpac, JpaShape, parseJpac } from "./jpa.ts";

const root = new URL("../../../../extracted/files/GC4Sword_usa/", import.meta.url);
const present = existsSync(root);

describe.skipIf(!present)("real disc: particle.jpc", () => {
  const load = () => {
    const data = parseRarc(decompressYaz0(readFileSync(new URL("data.arc", root))));
    return data.files.find((f) => f.path === "particle.jpc")!.data;
  };

  it("parses every resource and texture of the container", () => {
    const bytes = load();
    expect(isJpac(bytes)).toBe(true);
    const jpc = parseJpac(bytes);
    expect(jpc.version).toBe("JPAC2-10");
    expect([jpc.resources.length, jpc.textures.length]).toEqual([1394, 265]);
    // Resource n has effect ID n.
    expect(jpc.resources.every((r, i) => r.id === i)).toBe(true);
    // Every texture slot points at a container texture, and every texture animation frame at a slot.
    for (const r of jpc.resources) {
      expect(r.textureIds.every((t) => t < jpc.textures.length)).toBe(true);
      const anim = r.baseShape.texIdxAnimData;
      if (anim) expect([...anim].every((s) => s < r.textureIds.length)).toBe(true);
      if (r.childShape) expect(r.childShape.texIdx).toBeLessThan(r.textureIds.length);
    }
    const count = (f: (r: (typeof jpc.resources)[number]) => boolean) => jpc.resources.filter(f).length;
    expect(count((r) => r.baseShape.shapeType === JpaShape.BILLBOARD)).toBe(1012);
    expect(count((r) => r.childShape !== null)).toBe(243);
    expect(count((r) => r.exTex !== null)).toBe(93);
    expect(count((r) => r.fields.length > 0)).toBe(658);
    expect(count((r) => r.keys.length > 0)).toBe(320);
    // The projected (screen-distortion) effects are exactly the ones flagged for FSA's draw group 1.
    expect(jpc.resources.filter((r) => r.baseShape.isEnableProjection).map((r) => r.id)).toEqual([...Array.from({ length: 20 }, (_, i) => 1346 + i), 1367]);
    expect(jpc.resources.filter((r) => r.dynamics.userFlags & 2).map((r) => r.id)).toEqual(Array.from({ length: 20 }, (_, i) => 1346 + i));
  });

  it("decodes every texture", () => {
    const jpc = parseJpac(load());
    for (const t of jpc.textures) {
      const img = decodeJpaTexture(t);
      expect([img.width, img.height]).toEqual([t.header.width, t.header.height]);
      expect(img.data.length).toBe(t.header.width * t.header.height * 4);
    }
    expect(jpc.textures.slice(31, 41).map((t) => t.name)).toEqual(Array.from({ length: 10 }, (_, i) => `AK_honoo00${i}`));
  });

  it("reads a flame (842) as the game data describes it", () => {
    const jpc = parseJpac(load());
    const r = jpc.resources[842]!;
    expect(r.baseShape.shapeType).toBe(JpaShape.DIR_BILLBOARD);
    expect(r.dynamics.emitterDirection).toEqual([0, 0, 1]);
    expect([...r.baseShape.texIdxAnimData!]).toEqual(Array.from({ length: 20 }, (_, i) => i >> 1));
    expect(r.textureIds.map((t) => jpc.textures[t]!.name)).toEqual(Array.from({ length: 10 }, (_, i) => `AK_honoo00${i}`));
  });
});
