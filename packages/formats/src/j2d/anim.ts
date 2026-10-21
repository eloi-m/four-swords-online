// J2D screen animations: J3D animation files (J3D1bck1 / btk1 / brk1 / bpk1, parsed by ../j3d/anim.ts) played on a
// BLO2 screen. How their tracks bind to a screen was worked out from FSA's 22 files (docs/formats/j2d-and-bmg.md "Screen
// animations"):
//   .bck  pane transforms: joint n drives the pane whose id (pane header +0x0A) is n. The panes were laid out in a 3D
//         tool's XZ plane, so x = T.x, y = T.z, scale = (S.x, S.z) and the pane's rotate z = R.y (degrees); T.y holds
//         editor depths that J2D ignores. Every pane of the file is a joint, the root included.
//   .btk  texture SRT: entry → the material of that name, texture matrix slot `texMatrix` (the texgen's TEXMTXn).
//   .brk  TEV registers: entry → material by name; "tev" n = C0-C2 (tevColors[n]), "konst" n = konstColors[n].
//   .bpk  material color 0 by material name; its alpha is the pane alpha of Ex panes.
import { parseBck, parseBpk, parseBrk, parseBtk, sampleTrack, type Bck, type Btk, type ColorAnimation, type ColorEntry, type JointTracks, type TexSrtEntry } from "../j3d/anim.ts";
import { ascii } from "../bytes.ts";
import { walkPanes, type BloPane, type BloScreen, type BloTexMatrix, type Rgba } from "./blo.ts";

export type ScreenAnimation =
  | { kind: "transform"; name: string; data: Bck }
  | { kind: "texSrt"; name: string; data: Btk }
  | { kind: "tevReg"; name: string; data: ColorAnimation }
  | { kind: "color"; name: string; data: ColorAnimation };

export type ScreenAnimationKind = ScreenAnimation["kind"];

const KINDS: Record<string, ScreenAnimationKind> = {
  J3D1bck1: "transform",
  J3D1btk1: "texSrt",
  J3D1brk1: "tevReg",
  J3D1bpk1: "color",
};

/** File extensions of the screen animations FSA ships (next to the screens, in scrn/). */
export const SCREEN_ANIMATION_EXTENSIONS = [".bck", ".btk", ".brk", ".bpk"] as const;

/**
 * The animation files that go with a screen, by FSA's naming: `<screen>.<ext>` and `<screen>_NN.<ext>` (title.btk for
 * title.blo; collect.brk, collect.btk, collect_02.btk and collect_03.btk for collect.blo). Names may carry folders.
 */
export function screenAnimationNames(screenName: string, names: string[]): string[] {
  const base = (n: string) => n.slice(n.lastIndexOf("/") + 1).toLowerCase();
  const stem = base(screenName).replace(/\.blo$/, "");
  return names.filter((n) => {
    const m = /^(.*?)(?:_\d+)?\.(bck|btk|brk|bpk)$/.exec(base(n));
    return m?.[1] === stem;
  });
}

export function isScreenAnimation(bytes: Uint8Array): boolean {
  return bytes.length >= 0x20 && ascii(bytes, 0, 8) in KINDS;
}

/** Parses a .bck / .btk / .brk / .bpk file by its magic. */
export function parseScreenAnimation(bytes: Uint8Array, name = ""): ScreenAnimation {
  const magic = ascii(bytes, 0, 8);
  switch (KINDS[magic]) {
    case "transform":
      return { kind: "transform", name, data: parseBck(bytes) };
    case "texSrt":
      return { kind: "texSrt", name, data: parseBtk(bytes) };
    case "tevReg":
      return { kind: "tevReg", name, data: parseBrk(bytes) };
    case "color":
      return { kind: "color", name, data: parseBpk(bytes) };
    default:
      throw new Error(`not a screen animation (${JSON.stringify(magic)})`);
  }
}

/** Length in frames and the file's loop mode (J3D LoopMode), whatever the kind. */
export function screenAnimationTiming(animation: ScreenAnimation): { duration: number; loopMode: number } {
  return { duration: animation.data.duration, loopMode: animation.data.loopMode };
}

/** What an animation's tracks drive on one screen. */
export interface ScreenAnimationBinding {
  /** .bck: per joint, the pane it moves (null when no pane has that id). */
  panes: (BloPane | null)[];
  /** .btk / .brk / .bpk: per entry, the index of its material in BloScreen.materials, or -1. */
  materials: number[];
  /** Tracks that drive nothing on this screen, described for tools and tests. */
  unbound: string[];
}

export function bindScreenAnimation(screen: BloScreen, animation: ScreenAnimation): ScreenAnimationBinding {
  const unbound: string[] = [];
  if (animation.kind === "transform") {
    const byId = new Map<number, BloPane>();
    for (const { pane } of walkPanes(screen.root)) byId.set(pane.id, pane);
    const panes = animation.data.joints.map((_, i) => byId.get(i) ?? null);
    panes.forEach((p, i) => p || unbound.push(`joint ${i}: no pane with id ${i}`));
    return { panes, materials: [], unbound };
  }
  const byName = new Map(screen.materials.map((m, i) => [m.name, i]));
  const materials = animation.data.entries.map((entry, i) => {
    const index = byName.get(entry.material) ?? -1;
    if (index < 0) unbound.push(`entry ${i}: no material ${entry.material}`);
    else if (animation.kind === "texSrt") {
      const slot = (entry as TexSrtEntry).texMatrix;
      if (!screen.materials[index]!.texMatrices[slot]) unbound.push(`entry ${i}: ${entry.material} has no texture matrix ${slot}`);
    }
    return index;
  });
  return { panes: [], materials, unbound };
}

/** The part of a pane a .bck joint sets. */
export interface PaneTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotateZ: number; // degrees
}

const DEGREES = 180 / Math.PI;

/** A .bck joint at `frame` as a pane transform (x = T.x, y = T.z, scale S.x / S.z, rotate z = R.y). */
export function samplePaneTransform(joint: JointTracks, frame: number): PaneTransform {
  return {
    x: sampleTrack(joint.translation[0], frame),
    y: sampleTrack(joint.translation[2], frame),
    scaleX: sampleTrack(joint.scale[0], frame),
    scaleY: sampleTrack(joint.scale[2], frame),
    rotateZ: sampleTrack(joint.rotation[1], frame) * DEGREES,
  };
}

/** A .btk entry at `frame` as a BLO texture matrix (rotation in degrees; the .btk's half-turns × 180). */
export function sampleScreenTexSrt(entry: TexSrtEntry, frame: number, base?: BloTexMatrix | null): BloTexMatrix {
  return {
    type: base?.type ?? 1,
    info: base?.info ?? 0,
    center: entry.center,
    scaleX: sampleTrack(entry.scaleS, frame),
    scaleY: sampleTrack(entry.scaleT, frame),
    rotation: sampleTrack(entry.rotation, frame) * 180,
    translateX: sampleTrack(entry.translationS, frame),
    translateY: sampleTrack(entry.translationT, frame),
  };
}

/** A .brk / .bpk entry at `frame` in 0-255 units (TEV registers are signed 10-bit and may leave 0-255). */
export function sampleScreenColor(entry: ColorEntry, frame: number): Rgba {
  return [entry.r, entry.g, entry.b, entry.a].map((t) => sampleTrack(t, frame) * 255) as Rgba;
}
