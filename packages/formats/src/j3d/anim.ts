// J3D animations: BTK (texture SRT, TTK1), BRK (TEV color registers, TRK1), BPK (material colors, PAK1),
// BCK (joint transforms, ANK1), BTP (texture index, TPT1), plus keyframe sampling and texture matrix math.
//
// Ported from noclip.website's src/Common/JSYSTEM/J3D/J3DLoader.ts and J3DGraphAnimator.ts (MIT License,
// Copyright (c) 2017 Jasper St. Pierre, https://github.com/magcius/noclip.website). Adapted: plain data, no gl-matrix;
// frame control reduced to a pure function of the frame number so callers drive it from an explicit tick.
import { dataView } from "../bytes.ts";
import { readJ3dChunks, readNameTable, type J3dMatrix } from "./bmd.ts";

export const LoopMode = { ONCE: 0, ONCE_AND_RESET: 1, REPEAT: 2, MIRRORED_ONCE: 3, MIRRORED_REPEAT: 4 } as const;

export interface J3dKeyframe {
  time: number;
  value: number;
  tangentIn: number;
  tangentOut: number;
}

export type J3dTrack = J3dKeyframe[];

export interface AnimationBase {
  loopMode: number;
  /** Length in frames (the game advances one frame per 60 Hz tick at rate 1). */
  duration: number;
}

// Tracks are (count u16, first index u16, tangent mode u16) triples into a value table; each key is
// (time, value, tangent) or (time, value, tangentIn, tangentOut).
function readTrack(view: DataView, o: number, table: ArrayLike<number>, scale: number): J3dTrack {
  const count = view.getUint16(o), index = view.getUint16(o + 2), tangentMode = view.getUint16(o + 4);
  if (count === 1) return [{ time: 0, value: table[index]! * scale, tangentIn: 0, tangentOut: 0 }];
  const stride = tangentMode === 0 ? 3 : 4;
  const keys: J3dTrack = [];
  for (let i = 0; i < count; i++) {
    const k = index + i * stride;
    const tangentIn = table[k + 2]! * scale;
    keys.push({ time: table[k]!, value: table[k + 1]! * scale, tangentIn, tangentOut: stride === 3 ? tangentIn : table[k + 3]! * scale });
  }
  return keys;
}

function floats(view: DataView, offset: number, count: number): Float32Array {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getFloat32(offset + i * 4);
  return out;
}

function shorts(view: DataView, offset: number, count: number): Int16Array {
  const out = new Int16Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getInt16(offset + i * 2);
  return out;
}

function chunkOf(bytes: Uint8Array, magic: string, id: string): { view: DataView; data: Uint8Array } {
  const file = readJ3dChunks(bytes);
  if (file.magic !== magic) throw new Error(`expected ${magic}, got ${JSON.stringify(file.magic)}`);
  const chunk = file.chunks.find((c) => c.id === id);
  if (!chunk) throw new Error(`${magic}: missing ${id}`);
  // Chunk sizes are sometimes off by a few bytes (TTK1), so read from the whole remaining file.
  const data = bytes.subarray(chunk.offset);
  return { view: dataView(data), data };
}

// #region BTK
export interface TexSrtEntry {
  material: string;
  /** Texture matrix (= texgen) index in the material. */
  texMatrix: number;
  center: [number, number, number];
  scaleS: J3dTrack;
  scaleT: J3dTrack;
  rotation: J3dTrack; // half-turns (the Q rotation, as J3D uses)
  translationS: J3dTrack;
  translationT: J3dTrack;
}

export interface Btk extends AnimationBase {
  maya: boolean;
  entries: TexSrtEntry[];
}

export function parseBtk(bytes: Uint8Array): Btk {
  const { view, data } = chunkOf(bytes, "J3D1btk1", "TTK1");
  const rotationScale = Math.pow(2, view.getUint8(0x09)) / 0x7fff;
  const count = view.getUint16(0x0c) / 3;
  const s = floats(view, view.getUint32(0x28), view.getUint16(0x0e));
  const r = shorts(view, view.getUint32(0x2c), view.getUint16(0x10));
  const t = floats(view, view.getUint32(0x30), view.getUint16(0x12));
  const table = view.getUint32(0x14);
  const names = readNameTable(data, view.getUint32(0x1c));
  const matrixIndices = view.getUint32(0x20), centers = view.getUint32(0x24);
  const entries: TexSrtEntry[] = [];
  for (let i = 0; i < count; i++) {
    // Per entry: S, T, Q components, each (scale, rotation, translation) tracks of 6 bytes.
    const o = table + i * 9 * 6;
    const track = (component: number, kind: number) =>
      readTrack(view, o + (component * 3 + kind) * 6, kind === 0 ? s : kind === 1 ? r : t, kind === 1 ? rotationScale : 1);
    const c = centers + i * 12;
    entries.push({
      material: names[i] ?? "",
      texMatrix: view.getUint8(matrixIndices + i),
      center: [view.getFloat32(c), view.getFloat32(c + 4), view.getFloat32(c + 8)],
      scaleS: track(0, 0),
      translationS: track(0, 2),
      scaleT: track(1, 0),
      translationT: track(1, 2),
      rotation: track(2, 1),
    });
  }
  return { loopMode: view.getUint8(0x08), duration: view.getUint16(0x0a), maya: view.getUint32(0x5c) === 1, entries };
}
// #endregion

// #region BRK / BPK
/** Which register a color animation drives. */
export const ColorTarget = { TEV: "tev", KONST: "konst", MAT: "mat" } as const;

export interface ColorEntry {
  material: string;
  target: "tev" | "konst" | "mat";
  /** Register index: C0-C2 (+3, see docs) for "tev", K0-K3 for "konst", 0 for "mat". */
  index: number;
  r: J3dTrack;
  g: J3dTrack;
  b: J3dTrack;
  a: J3dTrack;
}

export interface ColorAnimation extends AnimationBase {
  entries: ColorEntry[];
}

export function parseBrk(bytes: Uint8Array): ColorAnimation {
  const { view, data } = chunkOf(bytes, "J3D1brk1", "TRK1");
  const u16 = (o: number) => view.getUint16(o), u32 = (o: number) => view.getUint32(o);
  const entries: ColorEntry[] = [];
  const group = (target: "tev" | "konst", count: number, table: number, names: string[], counts: number, offsets: number) => {
    const channels = [0, 1, 2, 3].map((c) => shorts(view, u32(offsets + c * 4), u16(counts + c * 2)));
    for (let i = 0; i < count; i++) {
      const o = table + i * 0x1c;
      const [r, g, b, a] = channels.map((values, c) => readTrack(view, o + c * 6, values, 1 / 255)) as [J3dTrack, J3dTrack, J3dTrack, J3dTrack];
      entries.push({ material: names[i] ?? "", target, index: view.getUint8(o + 0x18), r, g, b, a });
    }
  };
  group("tev", u16(0x0c), u32(0x20), readNameTable(data, u32(0x30)), 0x10, 0x38);
  group("konst", u16(0x0e), u32(0x24), readNameTable(data, u32(0x34)), 0x18, 0x48);
  return { loopMode: view.getUint8(0x08), duration: u16(0x0a), entries };
}

export function parseBpk(bytes: Uint8Array): ColorAnimation {
  const { view, data } = chunkOf(bytes, "J3D1bpk1", "PAK1");
  const u16 = (o: number) => view.getUint16(o), u32 = (o: number) => view.getUint32(o);
  const channels = [0, 1, 2, 3].map((c) => shorts(view, u32(0x24 + c * 4), u16(0x10 + c * 2)));
  const names = readNameTable(data, u32(0x20));
  const entries: ColorEntry[] = [];
  for (let i = 0; i < u16(0x0e); i++) {
    const o = u32(0x18) + i * 0x18;
    const [r, g, b, a] = channels.map((values, c) => readTrack(view, o + c * 6, values, 1 / 255)) as [J3dTrack, J3dTrack, J3dTrack, J3dTrack];
    entries.push({ material: names[i] ?? "", target: "mat", index: 0, r, g, b, a });
  }
  return { loopMode: view.getUint8(0x08), duration: u16(0x0c), entries };
}
// #endregion

// #region BCK
export interface JointTracks {
  scale: [J3dTrack, J3dTrack, J3dTrack];
  rotation: [J3dTrack, J3dTrack, J3dTrack]; // radians
  translation: [J3dTrack, J3dTrack, J3dTrack];
}

export interface Bck extends AnimationBase {
  joints: JointTracks[];
}

export function parseBck(bytes: Uint8Array): Bck {
  const { view } = chunkOf(bytes, "J3D1bck1", "ANK1");
  const rotationScale = (Math.pow(2, view.getUint8(0x09)) / 0x7fff) * Math.PI;
  const s = floats(view, view.getUint32(0x18), view.getUint16(0x0e));
  const r = shorts(view, view.getUint32(0x1c), view.getUint16(0x10));
  const t = floats(view, view.getUint32(0x20), view.getUint16(0x12));
  const table = view.getUint32(0x14);
  const joints: JointTracks[] = [];
  for (let i = 0; i < view.getUint16(0x0c); i++) {
    const o = table + i * 9 * 6;
    const track = (axis: number, kind: number) =>
      readTrack(view, o + (axis * 3 + kind) * 6, kind === 0 ? s : kind === 1 ? r : t, kind === 1 ? rotationScale : 1);
    joints.push({
      scale: [track(0, 0), track(1, 0), track(2, 0)],
      rotation: [track(0, 1), track(1, 1), track(2, 1)],
      translation: [track(0, 2), track(1, 2), track(2, 2)],
    });
  }
  return { loopMode: view.getUint8(0x08), duration: Math.max(1, view.getUint16(0x0a)), joints };
}
// #endregion

// #region BTP
export interface TexPatternEntry {
  material: string;
  texMap: number;
  /** TEX1 texture index per frame. */
  frames: number[];
}

export interface Btp extends AnimationBase {
  entries: TexPatternEntry[];
}

export function parseBtp(bytes: Uint8Array): Btp {
  const { view, data } = chunkOf(bytes, "J3D1btp1", "TPT1");
  const table = view.getUint32(0x10), indices = view.getUint32(0x14);
  const names = readNameTable(data, view.getUint32(0x1c));
  const entries: TexPatternEntry[] = [];
  for (let i = 0; i < view.getUint16(0x0c); i++) {
    const o = table + i * 8;
    const count = view.getUint16(o), first = view.getUint16(o + 2);
    entries.push({
      material: names[i] ?? "",
      texMap: view.getUint8(o + 4),
      frames: Array.from({ length: count }, (_, j) => view.getUint16(indices + (first + j) * 2)),
    });
  }
  return { loopMode: view.getUint8(0x08), duration: view.getUint16(0x0a), entries };
}
// #endregion

// #region Sampling
/** Hermite interpolation between keyframes, as J3D does (tangents are per frame). */
export function sampleTrack(track: J3dTrack, frame: number): number {
  if (track.length === 1) return track[0]!.value;
  const next = track.findIndex((k) => frame < k.time);
  if (next === 0) return track[0]!.value;
  if (next < 0) return track[track.length - 1]!.value;
  const k0 = track[next - 1]!, k1 = track[next]!;
  const length = k1.time - k0.time;
  const t = (frame - k0.time) / length;
  const s0 = k0.tangentOut * length, s1 = k1.tangentIn * length;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * k0.value + (t3 - 2 * t2 + t) * s0 + (-2 * t3 + 3 * t2) * k1.value + (t3 - t2) * s1;
}

/**
 * The animation frame shown `ticks` frames after the animation started at rate 1 (J3DFrameCtrl semantics for
 * start frame 0 and loop start 0). Callers pass their own 60 Hz tick count, never wall-clock time.
 */
export function animationFrame(animation: AnimationBase, ticks: number, rate = 1): number {
  const end = animation.duration;
  const t = ticks * rate;
  if (end <= 0) return 0;
  switch (animation.loopMode) {
    case LoopMode.ONCE:
      return t >= end ? end - 0.001 : Math.max(0, t);
    case LoopMode.ONCE_AND_RESET:
      return t >= end ? 0 : Math.max(0, t);
    case LoopMode.MIRRORED_ONCE:
      return t >= end ? Math.max(0, end - (t - end)) : Math.max(0, t);
    case LoopMode.MIRRORED_REPEAT: {
      const period = 2 * (end - 1);
      if (period <= 0) return 0;
      const p = ((t % period) + period) % period;
      return p <= end - 1 ? p : period - p;
    }
    default:
      return ((t % end) + end) % end;
  }
}

/** J3D "basic" texture SRT (rotation about the texture center), column-major 4×4 like three.js. */
export function texMatrixBasic(scaleS: number, scaleT: number, rotation: number, translationS: number, translationT: number, centerS: number, centerT: number): J3dMatrix {
  const theta = rotation * Math.PI, sin = Math.sin(theta), cos = Math.cos(theta);
  const m = identity();
  m[0] = scaleS * cos;
  m[4] = scaleS * -sin;
  m[12] = translationS + centerS - (m[0] * centerS + m[4] * centerT);
  m[1] = scaleT * sin;
  m[5] = scaleT * cos;
  m[13] = translationT + centerT - (m[1] * centerS + m[5] * centerT);
  return m;
}

/** Maya-style texture SRT (used when the model or BTK is flagged as Maya). */
export function texMatrixMaya(scaleS: number, scaleT: number, rotation: number, translationS: number, translationT: number): J3dMatrix {
  const theta = rotation * Math.PI, sin = Math.sin(theta), cos = Math.cos(theta);
  const m = identity();
  m[0] = scaleS * cos;
  m[4] = scaleS * sin;
  m[12] = scaleS * (-0.5 * cos - (0.5 * sin - 0.5) - translationS);
  m[1] = scaleT * -sin;
  m[5] = scaleT * cos;
  m[13] = scaleT * (-0.5 * cos + (0.5 * sin - 0.5) + translationT) + 1;
  return m;
}

/** Samples one BTK entry at `frame`. */
export function sampleTexSrt(btk: Btk, entry: TexSrtEntry, frame: number): J3dMatrix {
  const sS = sampleTrack(entry.scaleS, frame), sT = sampleTrack(entry.scaleT, frame);
  const r = sampleTrack(entry.rotation, frame);
  const tS = sampleTrack(entry.translationS, frame), tT = sampleTrack(entry.translationT, frame);
  return btk.maya ? texMatrixMaya(sS, sT, r, tS, tT) : texMatrixBasic(sS, sT, r, tS, tT, entry.center[0], entry.center[1]);
}

function identity(): J3dMatrix {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}
// #endregion
