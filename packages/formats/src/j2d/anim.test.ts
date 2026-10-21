// Screen animation binding and sampling on synthetic data (the real files: anim.realdisc.test.ts).
import { describe, expect, it } from "vitest";
import type { J3dTrack } from "../j3d/anim.ts";
import { bindScreenAnimation, samplePaneTransform, sampleScreenColor, sampleScreenTexSrt, screenAnimationNames, type ScreenAnimation } from "./anim.ts";
import type { BloMaterial, BloPane, BloScreen } from "./blo.ts";

const constant = (value: number): J3dTrack => [{ time: 0, value, tangentIn: 0, tangentOut: 0 }];
const linear = (t0: number, v0: number, t1: number, v1: number): J3dTrack => {
  const slope = (v1 - v0) / (t1 - t0);
  return [{ time: t0, value: v0, tangentIn: slope, tangentOut: slope }, { time: t1, value: v1, tangentIn: slope, tangentOut: slope }];
};
const pane = (id: number, tag: string, children: BloPane[] = []): BloPane =>
  ({ kind: "pane", block: "PAN2", id, tag, userTag: 0n, visible: true, anchor: 0, width: 4, height: 4, scaleX: 1, scaleY: 1, rotateX: 0, rotateY: 0, rotateZ: 0, x: 0, y: 0, children }) as BloPane;
const material = (name: string, slots: number): BloMaterial =>
  ({ name, texMatrices: Array.from({ length: slots }, () => ({ type: 1, info: 0, center: [0.5, 0.5, 0.5], scaleX: 1, scaleY: 1, rotation: 0, translateX: 0, translateY: 0 })) }) as unknown as BloMaterial;
const screen = { root: pane(0, "ROOT", [pane(2, "Nb", [pane(1, "Na")])]), materials: [material("mat_A_v", 1), material("mat_B_v", 2)] } as unknown as BloScreen;

describe("screen animations", () => {
  it("finds a screen's files by name", () => {
    const files = ["scrn/collect.btk", "scrn/collect_02.btk", "scrn/collect.brk", "scrn/collect2.btk", "scrn/total_star.bck", "scrn/total.brk", "scrn/collect.blo"];
    expect(screenAnimationNames("scrn/collect.blo", files)).toEqual(["scrn/collect.btk", "scrn/collect_02.btk", "scrn/collect.brk"]);
    expect(screenAnimationNames("total.blo", files)).toEqual(["scrn/total.brk"]);
    expect(screenAnimationNames("result_2p.blo", ["result_2p.btk", "result_3p.btk"])).toEqual(["result_2p.btk"]);
  });

  it("binds .bck joints to pane ids and other entries to material names", () => {
    const joint = { scale: [constant(1), constant(1), constant(1)], rotation: [constant(0), constant(0), constant(0)], translation: [constant(0), constant(0), constant(0)] };
    const bck: ScreenAnimation = { kind: "transform", name: "x.bck", data: { loopMode: 0, duration: 10, joints: [joint, joint, joint, joint] } } as ScreenAnimation;
    const b = bindScreenAnimation(screen, bck);
    expect(b.panes.map((p) => p?.tag ?? null)).toEqual(["ROOT", "Na", "Nb", null]);
    expect(b.unbound).toEqual(["joint 3: no pane with id 3"]);
    const entry = (m: string, texMatrix: number) => ({ material: m, texMatrix, center: [0.5, 0.5, 0.5], scaleS: constant(1), scaleT: constant(1), rotation: constant(0), translationS: constant(0), translationT: constant(0) });
    const btk = { kind: "texSrt", name: "x.btk", data: { loopMode: 2, duration: 10, maya: false, entries: [entry("mat_B_v", 1), entry("mat_A_v", 1), entry("mat_C_v", 0)] } } as ScreenAnimation;
    const t = bindScreenAnimation(screen, btk);
    expect(t.materials).toEqual([1, 0, -1]);
    expect(t.unbound).toEqual(["entry 1: mat_A_v has no texture matrix 1", "entry 2: no material mat_C_v"]);
  });

  it("samples a joint as a pane in the XZ plane, texture SRT in degrees and colors in 0-255", () => {
    const joint = {
      scale: [linear(0, 1, 10, 2), constant(7), constant(0.5)] as [J3dTrack, J3dTrack, J3dTrack],
      rotation: [constant(1), linear(0, 0, 10, Math.PI), constant(1)] as [J3dTrack, J3dTrack, J3dTrack],
      translation: [linear(0, 0, 10, 100), constant(-14), linear(0, 50, 10, 70)] as [J3dTrack, J3dTrack, J3dTrack],
    };
    const t = samplePaneTransform(joint, 5);
    expect(t.x).toBeCloseTo(50);
    expect(t.y).toBeCloseTo(60);
    expect([t.scaleX, t.scaleY]).toEqual([1.5, 0.5]);
    expect(t.rotateZ).toBeCloseTo(90);
    const srt = sampleScreenTexSrt({ material: "m", texMatrix: 0, center: [0.5, 0.5, 0.5], scaleS: constant(4.6), scaleT: constant(1), rotation: constant(1.878), translationS: linear(0, 3.8, 60, -3.8), translationT: constant(0) }, 30);
    expect(srt.rotation).toBeCloseTo(338.04, 1);
    expect(srt.translateX).toBeCloseTo(0);
    expect(sampleScreenColor({ material: "m", target: "tev", index: 1, r: constant(1), g: constant(0.5), b: constant(0), a: linear(0, 0, 10, 1) }, 5)).toEqual([255, 127.5, 0, 127.5]);
  });
});
