// J2D screen animations (.bck/.btk/.brk/.bpk) and indirect materials from the real extracted disc; skipped when
// extracted/ is absent (e.g. in CI).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRarc, type RarcArchive } from "../rarc.ts";
import { decompressYaz0, isYaz0 } from "../yaz0.ts";
import { bindScreenAnimation, parseScreenAnimation, samplePaneTransform, sampleScreenTexSrt, screenAnimationNames, type ScreenAnimation } from "./anim.ts";
import { findPane, parseBlo, walkPanes, type BloScreen } from "./blo.ts";

const root = new URL("../../../../extracted/files/GC4Sword_usa/", import.meta.url);
const present = existsSync(root);

const archives = new Map<string, RarcArchive>();
function load(path: string): RarcArchive {
  let a = archives.get(path);
  if (!a) archives.set(path, (a = parseRarc(decompressYaz0(readFileSync(new URL(path, root))))));
  return a;
}
const data = (a: RarcArchive, path: string) => {
  const f = a.files.find((x) => x.path === path);
  return f && (isYaz0(f.data) ? decompressYaz0(f.data) : f.data);
};
const screen = (archive: string, name: string): BloScreen => parseBlo(data(load(archive), `scrn/${name}`)!);
const animation = (archive: string, name: string): ScreenAnimation => parseScreenAnimation(data(load(archive), `scrn/${name}`)!, name);

// Every screen animation on the disc and the screen it drives. main.dol names all of them but adv_entry.bck,
// total.bck, total.brk and result1.arc's (whose screens it doesn't name either).
const BINDINGS: [archive: string, animation: string, screen: string][] = [
  ["entry.arc", "entry_arrow_anim.bck", "entry_arrow_anim.blo"],
  ["entry.arc", "entry_connect_anim.bck", "entry_connect_anim.blo"],
  ["game2D.arc", "collect.brk", "collect.blo"],
  ["game2D.arc", "collect.btk", "collect.blo"],
  ["game2D.arc", "collect_02.btk", "collect.blo"],
  ["game2D.arc", "collect_03.btk", "collect.blo"],
  ["game2D.arc", "gameover.bck", "gameover.blo"],
  ["main2D.arc", "main_gba_window.btk", "main_gba_window.blo"],
  ["main2D.arc", "main_gba_window_s.btk", "main_gba_window_s.blo"],
  ["map1.arc", "map.bck", "map.blo"],
  ["map1.arc", "map.bpk", "map.blo"],
  ["result.arc", "total.brk", "total.blo"],
  ["result.arc", "total_star.bck", "total_star.blo"],
  ["result.arc", "total_star.brk", "total_star.blo"],
  ["result1.arc", "result_1p_anim.bck", "result_1p_anim.blo"],
  ["result1.arc", "result_1p_anim.btk", "result_1p_anim.blo"],
  ["result2.arc", "result_2p.btk", "result_2p.blo"],
  ["result2.arc", "result_3p.btk", "result_3p.blo"],
  ["result2.arc", "result_4p.btk", "result_4p.blo"],
  ["title.arc", "title.btk", "title.blo"],
];
const KIND_BY_EXTENSION = { bck: "transform", btk: "texSrt", brk: "tevReg", bpk: "color" } as const;

describe.skipIf(!present)("real disc: J2D screen animations", () => {
  it("parses all 22 animations and binds every track of the 20 that fit a screen", () => {
    let count = 0;
    for (const path of ["entry.arc", "game2D.arc", "main2D.arc", "map1.arc", "result.arc", "result1.arc", "result2.arc", "title.arc"]) {
      for (const file of load(path).files.filter((f) => /^scrn\/.*\.(bck|btk|brk|bpk)$/.test(f.path))) {
        const name = file.path.slice(5);
        const a = animation(path, name);
        expect(a.kind).toBe(KIND_BY_EXTENSION[name.split(".").pop() as keyof typeof KIND_BY_EXTENSION]);
        expect(a.data.duration).toBeGreaterThan(0);
        count++;
      }
    }
    expect(count).toBe(22);
    for (const [archive, name, scrn] of BINDINGS) {
      const binding = bindScreenAnimation(screen(archive, scrn), animation(archive, name));
      expect(binding.unbound, `${name} on ${scrn}`).toEqual([]);
    }
  });

  it("finds a screen's animations by name", () => {
    const pairs: string[] = [];
    for (const path of ["entry.arc", "game2D.arc", "main2D.arc", "map1.arc", "result.arc", "result1.arc", "result2.arc", "title.arc"]) {
      const files = load(path).files.map((f) => f.path);
      for (const blo of files.filter((f) => f.endsWith(".blo")))
        for (const name of screenAnimationNames(blo, files)) pairs.push(`${path}:${name.slice(5)}:${blo.slice(5)}`);
    }
    const leftovers = ["entry.arc:adv_entry.bck:adv_entry.blo", "result.arc:total.bck:total.blo"];
    expect(pairs.sort()).toEqual([...BINDINGS.map((b) => b.join(":")), ...leftovers].sort());
  });

  it("two leftover .bck files fit no shipped screen", () => {
    // adv_entry.bck: 132 joints, adv_entry.blo 102 panes; total.bck: 228 joints, total.blo 232 panes (joint 1 at
    // (561, 50) where Ndata03 sits at (305, 225)). main.dol doesn't name either file.
    expect(bindScreenAnimation(screen("entry.arc", "adv_entry.blo"), animation("entry.arc", "adv_entry.bck")).unbound).toHaveLength(30);
    const total = animation("result.arc", "total.bck");
    expect(total.kind === "transform" && samplePaneTransform(total.data.joints[1]!, 0)).toMatchObject({ x: 561, y: 50 });
  });

  it("a .bck joint n is pane id n, laid in the XZ plane: the screens are snapshots of their animation", () => {
    // gameover.blo was saved at frame 103 of gameover.bck: x = T.x, y = T.z, rotate z = R.y (mod 360).
    const blo = screen("game2D.arc", "gameover.blo");
    const bck = animation("game2D.arc", "gameover.bck");
    if (bck.kind !== "transform") throw new Error(bck.kind);
    const binding = bindScreenAnimation(blo, bck);
    for (let i = 2; i <= 9; i++) {
      const pane = binding.panes[i]!;
      expect(pane.tag).toBe(`Pgo0${i - 1}`);
      const t = samplePaneTransform(bck.data.joints[i]!, 103);
      expect(t.x).toBeCloseTo(pane.x, 1);
      expect(t.y).toBeCloseTo(pane.y, 1);
      expect(((((t.rotateZ - pane.rotateZ) % 360) + 540) % 360) - 180).toBeCloseTo(0, 1);
    }
    // entry_arrow_anim.blo at frame 4: the arrow squashed by S.x / S.z.
    const arrow = animation("entry.arc", "entry_arrow_anim.bck");
    if (arrow.kind !== "transform") throw new Error(arrow.kind);
    const par = findPane(screen("entry.arc", "entry_arrow_anim.blo"), "Par00")!;
    expect(par.id).toBe(2);
    const t = samplePaneTransform(arrow.data.joints[2]!, 4);
    expect([t.x, t.y, t.scaleX, t.scaleY].map((v) => +v.toFixed(3))).toEqual([par.x, par.y, par.scaleX, par.scaleY].map((v) => +v.toFixed(3)));
  });

  it("a .btk entry drives texture matrix slot n of the named material, rotation in half-turns", () => {
    const blo = screen("title.arc", "title.blo");
    const btk = animation("title.arc", "title.btk");
    if (btk.kind !== "texSrt") throw new Error(btk.kind);
    expect([btk.data.duration, btk.data.loopMode, btk.data.entries.length]).toEqual([60, 2, 1]);
    const entry = btk.data.entries[0]!;
    const logo = blo.materials[bindScreenAnimation(blo, btk).materials[0]!]!;
    expect([logo.name, entry.texMatrix]).toEqual(["mat_Ptlogo01_v", 1]);
    const file = logo.texMatrices[1]!, sampled = sampleScreenTexSrt(entry, 30);
    expect([sampled.scaleX, sampled.scaleY]).toEqual([file.scaleX, file.scaleY].map((v) => Math.fround(v)));
    expect(sampled.rotation).toBeCloseTo(file.rotation, 1); // 338°
  });

  it("decodes the 25 indirect materials: one stage, an 8-bit offset map through matrix 0 = ½·2^e", () => {
    const found: string[] = [];
    for (const [archive, name] of [
      ["game2D.arc", "collect.blo"], ["main2D.arc", "main_gba_window_s.blo"], ["result2.arc", "result_2p.blo"],
      ["result2.arc", "result_3p.blo"], ["result2.arc", "result_4p.blo"], ["title.arc", "title.blo"],
    ] as const) {
      const s = screen(archive, name);
      for (const m of s.materials) {
        if (!m.indirect) continue;
        found.push(`${name}:${m.name}`);
        const { stages, matrices, tevStages } = m.indirect;
        expect(stages).toHaveLength(1);
        expect(stages[0]!.texMap).toBeLessThan(m.textures.length);
        expect(matrices[0]!.matrix).toEqual([[0.5, 0, 0], [0, 0.5, 0]]);
        expect([0, -1, -2]).toContain(matrices[0]!.scaleExp);
        const used = tevStages.filter((t) => t.matrix !== 0);
        expect(used).toHaveLength(1);
        expect(used[0]).toMatchObject({ indStage: 0, format: 0, bias: 7, matrix: 1, wrapS: 0, wrapT: 0, addPrev: false });
      }
    }
    expect(found).toHaveLength(25);
    const title = screen("title.arc", "title.blo").materials.find((m) => m.name === "mat_Ptlogo01_v")!;
    expect(title.indirect!.stages[0]).toEqual({ texCoord: 2, texMap: 2, scaleS: 0, scaleT: 0 });
    expect(title.indirect!.tevStages[0]!.matrix).toBe(1); // stage 0 samples kk_test_01 shifted by kk_titleLogoInd_01
    // No other screen enables indirect texturing.
    const all = [...walkPanes(screen("game2D.arc", "main_bat.blo").root)];
    expect(all.length).toBeGreaterThan(0);
    expect(screen("game2D.arc", "main_bat.blo").materials.some((m) => m.indirect)).toBe(false);
  });
});
