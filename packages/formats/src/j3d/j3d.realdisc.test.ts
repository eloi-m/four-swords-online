// J3D files of the real disc; skipped when extracted/ is absent (e.g. in CI).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasCloudShadows, loadJ3dResource, stageEffectPlacements } from "../fsa/effects.ts";
import { Stage } from "../fsa/stage.ts";
import { isRarc, parseRarc } from "../rarc.ts";
import { decompressYaz0, isYaz0 } from "../yaz0.ts";
import { parseBck, parseBpk, parseBrk, parseBtk } from "./anim.ts";
import { parseBmd } from "./bmd.ts";

const root = new URL("../../../../extracted/files/GC4Sword_usa/", import.meta.url);
const present = existsSync(root);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(path, root))));
const unwrap = (b: Uint8Array) => (isYaz0(b) ? decompressYaz0(b) : b);

describe.skipIf(!present)("real disc: J3D", () => {
  it("parses every BMD/BTK/BRK/BCK/BPK in the stage, battle and shared archives", () => {
    const counts: Record<string, number> = {};
    const archives = ["data.arc", "title.arc", ...readdirSync(new URL("Boss/", root)).filter((n) => n.endsWith(".arc")).map((n) => `Boss/${n}`)];
    for (const path of archives) {
      const bytes = readFileSync(new URL(path, root));
      const raw = isYaz0(bytes) ? decompressYaz0(bytes) : bytes;
      if (!isRarc(raw)) continue;
      for (const f of parseRarc(raw).files) {
        const ext = f.path.split(".").pop()!;
        if (!f.path.startsWith("j3d/")) continue;
        const bytes = unwrap(f.data);
        if (ext === "bmd") {
          const bmd = parseBmd(bytes);
          expect(bmd.shapes.every((s) => s.materialIndex >= 0 && s.indices.length % 3 === 0)).toBe(true);
          expect(bmd.textures.every((t) => t.image.data.length === t.width * t.height * 4)).toBe(true);
        } else if (ext === "btk") parseBtk(bytes);
        else if (ext === "brk") parseBrk(bytes);
        else if (ext === "bck") parseBck(bytes);
        else if (ext === "bpk") parseBpk(bytes);
        else continue;
        counts[ext] = (counts[ext] ?? 0) + 1;
      }
    }
    // Every j3d/ file of data.arc, title.arc and the Boss/ archives (boss991 nests its files one level deeper).
    expect(counts).toEqual({ bmd: 104, btk: 93, brk: 66 });
  });

  it("reads the Lake Hylia waterfall and the cloud filter as the game data describes them", () => {
    const taki = loadJ3dResource(load("Boss/boss010.arc"), "taki_a")!;
    expect(taki.bmd.joints.map((j) => [j.name, j.parent])).toEqual([["taki_A", -1], ["b_moya", 0], ["c_takisita", 0], ["d_taki", 0]]);
    expect(taki.bmd.materials.map((m) => [m.name, m.tevStages.length])).toEqual([["lambert2", 3], ["lambert2_v_x", 5], ["lambert2(2)", 3]]);
    expect(taki.bmd.textures.map((t) => t.name)).toEqual(["moya_kesi", "moya_2", "taki_9", "kage_1", "taki_1", "taki_noize_1"]);
    expect(taki.btk[0]!.duration).toBe(1200);
    const cloud = loadJ3dResource(load("data.arc"), "cloudshadowfilter00")!;
    const shape = cloud.bmd.shapes[0]!;
    expect([shape.vertexCount, shape.indices.length / 3]).toEqual([4, 2]);
    expect([...shape.position.subarray(0, 3)].map((v) => v + 0)).toEqual([51.20000076293945, 0, 51.20000076293945]);
    const brk = cloud.brk[0]!.entries[0]!;
    expect([brk.material, brk.target, brk.index, Math.round(brk.a[1]!.value * 255)]).toEqual(["filter", "tev", 2, 64]);
  });

  it("places Lake Hylia's effects where the game's RAM showed them", () => {
    const stage = new Stage(load("Boss/boss010.arc"));
    const placements = stageEffectPlacements(stage).map((p) => [p.model, p.room, ...p.translation, p.status]);
    expect(placements).toEqual([
      ["taki_b", 58, 1664, 992, 1024, "confirmed"],
      ["taki_a", 7, 1760, 480, 0, "confirmed"],
      ["niji_a", 7, 1760, 2528, 2048, "confirmed"],
      ["morninglight00", 0, 2816, 3328, 1536, "confirmed"],
    ]);
    // Room 6's SEV2 makes room 7's waterfall and rainbow again (one room up): drawn from either room, not from room 1.
    expect(stageEffectPlacements(stage).map((p) => p.also ?? [])).toEqual([[], [6], [6], []]);
    expect(hasCloudShadows(stage)).toBe(true);
  });
});
