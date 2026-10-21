// Generates the GX shaders of every J3D material on the disc (skipped without extracted/): no unsupported TEV op or
// input may throw, and each TEV stage must be emitted.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { decompressYaz0, isRarc, isYaz0, parseBmd, parseRarc } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { generateGxShader } from "./gx-shader.ts";

const root = new URL("../../../../extracted/files/GC4Sword_usa/", import.meta.url);

describe.skipIf(!existsSync(root))("real disc: GX shader generation", () => {
  it("builds shaders for every J3D material", () => {
    let materials = 0;
    for (const path of ["data.arc", "title.arc", ...readdirSync(new URL("Boss/", root)).filter((n) => n.endsWith(".arc")).map((n) => `Boss/${n}`)]) {
      const bytes = readFileSync(new URL(path, root));
      const raw = isYaz0(bytes) ? decompressYaz0(bytes) : bytes;
      if (!isRarc(raw)) continue;
      for (const f of parseRarc(raw).files) {
        if (!f.path.startsWith("j3d/") || !f.path.endsWith(".bmd")) continue;
        const bmd = parseBmd(isYaz0(f.data) ? decompressYaz0(f.data) : f.data);
        for (const shape of bmd.shapes) {
          const material = bmd.materials[shape.materialIndex]!;
          const { vertexShader, fragmentShader } = generateGxShader(material, {
            matrixCount: new Set(shape.drawMatrix).size,
            hasColor: [!!shape.color[0], !!shape.color[1]],
            hasNormal: !!shape.normal,
          });
          expect(vertexShader).toContain("gl_Position");
          expect(fragmentShader.match(/\/\/ TEV stage/g)?.length ?? 0).toBe(material.tevStages.length);
          materials++;
        }
      }
    }
    expect(materials).toBeGreaterThan(200);
  });
});
