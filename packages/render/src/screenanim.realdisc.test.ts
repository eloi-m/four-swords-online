// Screen animations driving a ScreenView, in node (the pane matrices and material uniforms are plain three.js objects,
// no WebGL needed), with the real disc's screens; skipped without extracted/.
import { existsSync, readFileSync } from "node:fs";
import {
  decompressYaz0,
  findPane,
  isYaz0,
  parseBlo,
  parseRarc,
  parseScreenAnimation,
  sampleScreenTexSrt,
  walkPanes,
  type BloPane,
  type RarcArchive,
} from "@fso/formats";
import type * as THREE from "three";
import { describe, expect, it } from "vitest";
import { paneMatrix, ScreenView, tevFragmentShader, texSrtMatrix } from "./screen.ts";
import { ScreenAnimator } from "./screenanim.ts";

const root = new URL("../../../extracted/files/GC4Sword_usa/", import.meta.url);
const archives = new Map<string, RarcArchive>();
function file(archive: string, path: string): Uint8Array {
  let a = archives.get(archive);
  if (!a) archives.set(archive, (a = parseRarc(decompressYaz0(readFileSync(new URL(archive, root))))));
  const f = a.files.find((x) => x.path === path)!;
  return isYaz0(f.data) ? decompressYaz0(f.data) : f.data;
}
function setup(archive: string, screen: string) {
  const blo = parseBlo(file(archive, `scrn/${screen}`));
  const view = new ScreenView(blo, { texture: () => null });
  return { blo, view, animator: new ScreenAnimator(view) };
}
const anim = (archive: string, name: string) => parseScreenAnimation(file(archive, `scrn/${name}`), name);
type Mesh = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
const meshesOf = (view: ScreenView, pane: BloPane) => view.panes.get(pane)!.children.filter((c): c is Mesh => (c as Mesh).isMesh);
const close = (a: ArrayLike<number>, b: ArrayLike<number>, digits = 2) => Array.from(a).forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));

describe.skipIf(!existsSync(root))("real disc: screen animations on a ScreenView", () => {
  it("a .bck moves the panes by id; removing it puts them back", () => {
    const { blo, view, animator } = setup("game2D.arc", "gameover.blo");
    const player = animator.add(anim("game2D.arc", "gameover.bck"), { playing: false });
    const letters = [...walkPanes(blo.root)].map((p) => p.pane).filter((p) => p.tag.startsWith("Pgo"));
    expect(letters).toHaveLength(8);
    // gameover.blo is frame 103 of its animation.
    player.seek(103);
    animator.apply();
    for (const pane of letters) close(view.panes.get(pane)!.matrix.elements, paneMatrix(pane).elements, 1);
    // Frame 0: the letters wait 270 px above their line (Pgo01 at x 169).
    player.seek(0);
    animator.apply();
    const first = view.panes.get(findPane(blo, "Pgo01")!)!.matrix.elements;
    close([first[12]!, first[13]!], [169, -270.116]);
    animator.remove(player);
    for (const pane of letters) close(view.panes.get(pane)!.matrix.elements, paneMatrix(pane).elements, 4);
  });

  it("a .btk sets the texture matrix of its material, and loops by the file's mode", () => {
    const { blo, view, animator } = setup("title.arc", "title.blo");
    const btk = anim("title.arc", "title.btk");
    if (btk.kind !== "texSrt") throw new Error(btk.kind);
    const player = animator.add(btk);
    const logo = meshesOf(view, findPane(blo, "Ptlogo01")!)[0]!;
    const uniform = () => (logo.material.uniforms.uTexMtx1!.value as THREE.Matrix3).elements;
    animator.step(30);
    expect(player.frame).toBe(30);
    close(uniform(), texSrtMatrix(sampleScreenTexSrt(btk.data.entries[0]!, 30)).elements, 4);
    animator.step(40); // REPEAT: 70 → 10
    expect(player.frame).toBe(10);
    close(uniform(), texSrtMatrix(sampleScreenTexSrt(btk.data.entries[0]!, 10)).elements, 4);
    player.stop();
    animator.step(5);
    expect(player.frame).toBe(10);
    // texgen 0 (the logo itself) keeps its identity matrix.
    close((logo.material.uniforms.uTexMtx0!.value as THREE.Matrix3).elements, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("a .brk sets TEV registers and a .bpk the pane alpha", () => {
    const star = setup("result.arc", "total_star.blo");
    const brk = star.animator.add(anim("result.arc", "total_star.brk"), { frame: 89, playing: false });
    expect(brk.frame).toBe(89);
    const glint = meshesOf(star.view, findPane(star.blo, "Pstarli")!)[0]!;
    expect((glint.material.uniforms.uC1!.value as THREE.Vector4).w).toBeCloseTo(100 / 255, 3); // alpha key 89: 100
    const map = setup("map1.arc", "map.blo");
    const player = map.animator.add(anim("map1.arc", "map.bpk"), { playing: false });
    const dot = meshesOf(map.view, findPane(map.blo, "P21")!)[0]!;
    expect(dot.material.uniforms.uAlpha!.value).toBeCloseTo(1, 3);
    player.seek(179);
    map.animator.apply();
    expect(dot.material.uniforms.uAlpha!.value).toBeCloseTo(0, 3);
    map.animator.remove(player);
    expect(dot.material.uniforms.uAlpha!.value).toBeCloseTo(map.blo.materials.find((m) => m.name === "mat_P21_v")!.matColors[0]![3] / 255, 3);
  });

  it("emits indirect stages for the 25 indirect materials only", () => {
    let indirect = 0;
    for (const [archive, screen] of [
      ["title.arc", "title.blo"], ["result2.arc", "result_4p.blo"], ["main2D.arc", "main_gba_window_s.blo"], ["game2D.arc", "main_bat.blo"],
    ] as const) {
      for (const m of parseBlo(file(archive, `scrn/${screen}`)).materials) {
        const glsl = tevFragmentShader(m);
        expect(glsl.includes("uIndMtx")).toBe(!!m.indirect);
        if (!m.indirect) continue;
        indirect++;
        expect(glsl).toContain("vec3 ind0 = 255.0 * texture2D(");
        expect(glsl).toMatch(/tc = vTex\d \* uTexSize\d \+ vec2\(dot\(uIndMtx\[0\], \(ind0 \+ vec3\(-128\.0\)\)\)/);
      }
    }
    expect(indirect).toBe(1 + 8 + 1);
  });
});
