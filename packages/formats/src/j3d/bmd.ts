// J3D models (BMD, magic "J3D2bmd3"): scene graph (INF1), vertex arrays (VTX1), skinning envelopes (EVP1), draw
// matrices (DRW1), joints (JNT1), shapes with GX display lists (SHP1), GX materials (MAT3) and textures (TEX1).
//
// Chunk layouts ported from noclip.website's src/Common/JSYSTEM/J3D/J3DLoader.ts (MIT License,
// Copyright (c) 2017 Jasper St. Pierre, https://github.com/magcius/noclip.website). Adapted: plain data output instead
// of GfxDevice objects, display lists decoded to flat per-vertex arrays, textures decoded with our own GX decoder.
import { ascii, dataView } from "../bytes.ts";
import { decodeGxTexture, decodePalette, type DecodedTexture } from "../gx/bti.ts";
import { GxAttr, GxAttrType, GxCompType, GxPrimitive, GxRasChannel, GxTexGenMatrix, GxPostTexGenMatrix } from "./gx.ts";

/** RGBA, each channel 0..1 (color registers may go outside that range: they are signed 10-bit on the GPU). */
export type GxColor = [number, number, number, number];

export interface J3dChunk {
  id: string;
  offset: number;
  size: number;
  data: Uint8Array;
}

/** Splits a J3D file (BMD, BTK, BRK…) into its chunks. */
export function readJ3dChunks(bytes: Uint8Array): { magic: string; chunks: J3dChunk[] } {
  const view = dataView(bytes);
  const magic = ascii(bytes, 0, 8);
  if (!magic.startsWith("J3D")) throw new Error(`not a J3D file (${JSON.stringify(magic)})`);
  const count = view.getUint32(0x0c);
  const chunks: J3dChunk[] = [];
  let offset = 0x20;
  for (let i = 0; i < count && offset + 8 <= bytes.length; i++) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4);
    chunks.push({ id, offset, size, data: bytes.subarray(offset, Math.min(bytes.length, offset + size)) });
    offset += size;
  }
  return { magic, chunks };
}

/** J3D name table (ResNTAB): u16 count, u16 pad, then (u16 hash, u16 offset) pairs; offsets relative to the table. */
export function readNameTable(bytes: Uint8Array, offset: number): string[] {
  const view = dataView(bytes);
  const count = view.getUint16(offset);
  const names: string[] = [];
  for (let i = 0; i < count; i++) names.push(ascii(bytes, offset + view.getUint16(offset + 4 + i * 4 + 2), 255));
  return names;
}

// #region INF1
export const HierarchyNodeType = { END: 0x00, OPEN: 0x01, CLOSE: 0x02, JOINT: 0x10, MATERIAL: 0x11, SHAPE: 0x12 } as const;

export interface HierarchyNode {
  type: number;
  value: number;
}

function readInf1(chunk: Uint8Array): { loadFlags: number; vertexCount: number; hierarchy: HierarchyNode[] } {
  const view = dataView(chunk);
  const loadFlags = view.getUint16(0x08);
  const vertexCount = view.getUint32(0x10);
  const hierarchy: HierarchyNode[] = [];
  for (let o = view.getUint32(0x14); o + 4 <= chunk.length; o += 4) {
    const type = view.getUint16(o), value = view.getUint16(o + 2);
    if (type === HierarchyNodeType.END) break;
    hierarchy.push({ type, value });
  }
  return { loadFlags, vertexCount, hierarchy };
}
// #endregion

// #region VTX1
export interface VertexAttrFormat {
  compCnt: number;
  compType: number;
  compShift: number;
}

interface Vtx1 {
  formats: Map<number, VertexAttrFormat>;
  arrays: Map<number, Uint8Array>;
}

// Order of the VTX1 array offset table.
const VTX1_ARRAYS = [GxAttr.POS, GxAttr.NRM, GxAttr.NBT, GxAttr.CLR0, GxAttr.CLR1, 13, 14, 15, 16, 17, 18, 19, 20];

function readVtx1(chunk: Uint8Array): Vtx1 {
  const view = dataView(chunk);
  const formats = new Map<number, VertexAttrFormat>();
  for (let o = view.getUint32(0x08); ; o += 0x10) {
    const attr = view.getUint32(o);
    if (attr === GxAttr.NULL) break;
    formats.set(attr, { compCnt: view.getUint32(o + 4), compType: view.getUint32(o + 8), compShift: view.getUint8(o + 0x0c) });
  }
  // Array sizes aren't stored: each array runs until the next non-zero offset (or the end of the chunk).
  const offsets = VTX1_ARRAYS.map((_, i) => view.getUint32(0x0c + i * 4));
  const arrays = new Map<number, Uint8Array>();
  offsets.forEach((start, i) => {
    if (!start) return;
    const end = offsets.slice(i + 1).find((o) => o !== 0) ?? chunk.length;
    arrays.set(VTX1_ARRAYS[i]!, chunk.subarray(start, end));
  });
  return { formats, arrays };
}
// #endregion

// #region EVP1 / DRW1
export interface J3dEnvelope {
  joints: number[];
  weights: number[];
}

/** Column-major 4×4 (like three.js `Matrix4.elements`). */
export type J3dMatrix = Float32Array;

function readEvp1(chunk: Uint8Array): { envelopes: J3dEnvelope[]; inverseBinds: J3dMatrix[] } {
  const view = dataView(chunk);
  const count = view.getUint16(0x08);
  const countTable = view.getUint32(0x0c), indexTable = view.getUint32(0x10);
  const weightTable = view.getUint32(0x14), bindTable = view.getUint32(0x18);
  const envelopes: J3dEnvelope[] = [];
  let k = 0, maxJoint = -1;
  for (let i = 0; i < count; i++) {
    const n = view.getUint8(countTable + i);
    const envelope: J3dEnvelope = { joints: [], weights: [] };
    for (let j = 0; j < n; j++, k++) {
      const joint = view.getUint16(indexTable + k * 2);
      envelope.joints.push(joint);
      envelope.weights.push(view.getFloat32(weightTable + k * 4));
      maxJoint = Math.max(maxJoint, joint);
    }
    envelopes.push(envelope);
  }
  const inverseBinds: J3dMatrix[] = [];
  for (let i = 0; i <= maxJoint && bindTable; i++) inverseBinds.push(readMtx34(view, bindTable + i * 0x30));
  return { envelopes, inverseBinds };
}

/** A row-major 3×4 matrix, as stored on disc, to a column-major 4×4. */
function readMtx34(view: DataView, o: number): J3dMatrix {
  const m = new Float32Array(16);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) m[col * 4 + row] = view.getFloat32(o + (row * 4 + col) * 4);
  m[15] = 1;
  return m;
}

export const DrawMatrixKind = { JOINT: 0, ENVELOPE: 1 } as const;

export interface J3dDrawMatrix {
  kind: number;
  /** Joint index (kind JOINT) or envelope index (kind ENVELOPE). */
  index: number;
}

function readDrw1(chunk: Uint8Array): J3dDrawMatrix[] {
  const view = dataView(chunk);
  const count = view.getUint16(0x08);
  const kinds = view.getUint32(0x0c), data = view.getUint32(0x10);
  return Array.from({ length: count }, (_, i) => ({ kind: view.getUint8(kinds + i), index: view.getUint16(data + i * 2) }));
}
// #endregion

// #region JNT1
export interface J3dJoint {
  name: string;
  /** Parent joint index from the INF1 hierarchy, -1 for a root. */
  parent: number;
  calcFlags: number;
  scale: [number, number, number];
  /** Euler angles in radians, applied X then Y then Z (J3D order). */
  rotation: [number, number, number];
  translation: [number, number, number];
  radius: number;
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
}

function readJnt1(chunk: Uint8Array): J3dJoint[] {
  const view = dataView(chunk);
  const count = view.getUint16(0x08);
  const table = view.getUint32(0x0c), remap = view.getUint32(0x10);
  const names = readNameTable(chunk, view.getUint32(0x14));
  const joints: J3dJoint[] = [];
  for (let i = 0; i < count; i++) {
    const o = table + view.getUint16(remap + i * 2) * 0x40;
    const f = (at: number) => view.getFloat32(o + at);
    const angle = (at: number) => (view.getInt16(o + at) / 0x7fff) * Math.PI;
    joints.push({
      name: names[i] ?? `joint${i}`,
      parent: -1,
      calcFlags: view.getUint8(o + 0x02),
      scale: [f(0x04), f(0x08), f(0x0c)],
      rotation: [angle(0x10), angle(0x12), angle(0x14)],
      translation: [f(0x18), f(0x1c), f(0x20)],
      radius: f(0x24),
      bboxMin: [f(0x28), f(0x2c), f(0x30)],
      bboxMax: [f(0x34), f(0x38), f(0x3c)],
    });
  }
  return joints;
}
// #endregion

// #region SHP1
export const ShapeMtxType = { MTX: 0, BBOARD: 1, YBBOARD: 2, MULTI: 3 } as const;

/**
 * A shape's triangles, decoded from its display lists into flat per-vertex arrays (one entry per display list vertex).
 * `drawMatrix[v]` is the DRW1 matrix the vertex is transformed by.
 */
export interface J3dShape {
  mtxType: number;
  materialIndex: number;
  radius: number;
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
  vertexCount: number;
  position: Float32Array; // xyz
  normal: Float32Array | null; // xyz
  color: (Float32Array | null)[]; // [CLR0, CLR1], rgba 0..1
  texCoord: (Float32Array | null)[]; // TEX0..TEX7, st
  drawMatrix: Uint16Array;
  /** Triangle list indices into the vertex arrays. */
  indices: Uint32Array;
}

interface AttrDecl {
  attr: number;
  type: number;
}

const componentSize = (compType: number) => (compType === GxCompType.U8 || compType === GxCompType.S8 ? 1 : compType === GxCompType.F32 ? 4 : 2);

function colorSize(compType: number): number {
  switch (compType) {
    case GxCompType.RGB565:
    case GxCompType.RGBA4:
      return 2;
    case GxCompType.RGB8:
    case GxCompType.RGBA6:
      return 3;
    default:
      return 4;
  }
}

/** Byte size of one element of an attribute's array. */
function elementSize(attr: number, format: VertexAttrFormat): number {
  if (attr === GxAttr.POS) return componentSize(format.compType) * (format.compCnt === 0 ? 2 : 3);
  if (attr === GxAttr.NRM) return componentSize(format.compType) * (format.compCnt === 0 ? 3 : 9);
  if (attr === GxAttr.CLR0 || attr === GxAttr.CLR1) return colorSize(format.compType);
  return componentSize(format.compType) * (format.compCnt === 0 ? 1 : 2);
}

function readComponent(view: DataView, o: number, compType: number): number {
  switch (compType) {
    case GxCompType.U8:
      return view.getUint8(o);
    case GxCompType.S8:
      return view.getInt8(o);
    case GxCompType.U16:
      return view.getUint16(o);
    case GxCompType.S16:
      return view.getInt16(o);
    default:
      return view.getFloat32(o);
  }
}

function readColor(view: DataView, o: number, compType: number, out: Float32Array, at: number): void {
  let r: number, g: number, b: number, a = 255;
  switch (compType) {
    case GxCompType.RGB565: {
      const c = view.getUint16(o);
      r = ((c >> 11) & 0x1f) * (255 / 31);
      g = ((c >> 5) & 0x3f) * (255 / 63);
      b = (c & 0x1f) * (255 / 31);
      break;
    }
    case GxCompType.RGB8:
    case GxCompType.RGBX8:
      [r, g, b] = [view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2)];
      break;
    case GxCompType.RGBA4: {
      const c = view.getUint16(o);
      [r, g, b, a] = [((c >> 12) & 15) * 17, ((c >> 8) & 15) * 17, ((c >> 4) & 15) * 17, (c & 15) * 17];
      break;
    }
    case GxCompType.RGBA6: {
      const c = (view.getUint8(o) << 16) | (view.getUint8(o + 1) << 8) | view.getUint8(o + 2);
      [r, g, b, a] = [(c >> 18) & 63, (c >> 12) & 63, (c >> 6) & 63, c & 63].map((v) => v * (255 / 63)) as [number, number, number, number];
      break;
    }
    default:
      [r, g, b, a] = [view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3)];
  }
  out[at] = r / 255;
  out[at + 1] = g / 255;
  out[at + 2] = b / 255;
  out[at + 3] = a / 255;
}

function readShp1(chunk: Uint8Array, vtx1: Vtx1): J3dShape[] {
  const view = dataView(chunk);
  const count = view.getUint16(0x08);
  const initTable = view.getUint32(0x0c);
  const declTable = view.getUint32(0x18), matrixTable = view.getUint32(0x1c);
  const displayLists = view.getUint32(0x20), mtxInitTable = view.getUint32(0x24), drawInitTable = view.getUint32(0x28);
  const shapes: J3dShape[] = [];

  for (let s = 0; s < count; s++) {
    const o = initTable + s * 0x28;
    const mtxType = view.getUint8(o);
    const groupCount = view.getUint16(o + 0x02);
    const declOffset = view.getUint16(o + 0x04);
    const mtxInit = view.getUint16(o + 0x06);
    const drawInit = view.getUint16(o + 0x08);
    const f = (at: number) => view.getFloat32(o + at);

    const decls: AttrDecl[] = [];
    for (let d = declTable + declOffset; ; d += 8) {
      const attr = view.getUint32(d);
      if (attr === GxAttr.NULL) break;
      decls.push({ attr: attr === GxAttr.NBT ? GxAttr.NRM : attr, type: view.getUint32(d + 4) });
    }
    const has = (attr: number) => decls.some((d) => d.attr === attr);

    // First pass: count vertices and collect the draw commands.
    const draws: { primitive: number; count: number; offset: number; group: number }[] = [];
    let vertexCount = 0;
    const vertexSize = decls.reduce((n, d) => {
      if (d.type === GxAttrType.INDEX8) return n + 1;
      if (d.type === GxAttrType.INDEX16) return n + 2;
      if (d.type === GxAttrType.DIRECT) {
        if (d.attr <= GxAttr.TEX7MTXIDX) return n + 1;
        return n + elementSize(d.attr, vtx1.formats.get(d.attr)!);
      }
      return n;
    }, 0);
    const groups: { table: number[] }[] = [];
    for (let g = 0; g < groupCount; g++) {
      const dl = drawInitTable + (drawInit + g) * 8;
      const size = view.getUint32(dl), start = displayLists + view.getUint32(dl + 4);
      const mtx = mtxInitTable + (mtxInit + g) * 8;
      const useCount = view.getUint16(mtx + 2), first = view.getUint32(mtx + 4);
      groups.push({ table: Array.from({ length: useCount }, (_, i) => view.getUint16(matrixTable + (first + i) * 2)) });
      for (let p = start; p < start + size; ) {
        const cmd = view.getUint8(p);
        if (cmd === 0) {
          p++;
          continue;
        }
        const primitive = cmd & 0xf8;
        if (primitive < GxPrimitive.QUADS) throw new Error(`SHP1: unexpected display list command 0x${cmd.toString(16)}`);
        const n = view.getUint16(p + 1);
        draws.push({ primitive, count: n, offset: p + 3, group: g });
        vertexCount += n;
        p += 3 + n * vertexSize;
      }
    }

    const shape: J3dShape = {
      mtxType,
      materialIndex: -1,
      radius: f(0x0c),
      bboxMin: [f(0x10), f(0x14), f(0x18)],
      bboxMax: [f(0x1c), f(0x20), f(0x24)],
      vertexCount,
      position: new Float32Array(vertexCount * 3),
      normal: has(GxAttr.NRM) ? new Float32Array(vertexCount * 3) : null,
      color: [GxAttr.CLR0, GxAttr.CLR1].map((a) => (has(a) ? new Float32Array(vertexCount * 4) : null)),
      texCoord: Array.from({ length: 8 }, (_, i) => (has(GxAttr.TEX0 + i) ? new Float32Array(vertexCount * 2) : null)),
      drawMatrix: new Uint16Array(vertexCount),
      indices: new Uint32Array(0),
    };

    // Second pass: decode vertices. Matrix slots persist across groups when a group's table says 0xFFFF.
    const slots = new Array<number>(10).fill(0);
    const indices: number[] = [];
    let v = 0, currentGroup = -1;
    for (const draw of draws) {
      if (draw.group !== currentGroup) {
        currentGroup = draw.group;
        groups[currentGroup]!.table.forEach((m, i) => {
          if (m !== 0xffff) slots[i] = m;
        });
      }
      const first = v;
      let p = draw.offset;
      for (let i = 0; i < draw.count; i++, v++) {
        let slot = 0;
        for (const decl of decls) {
          let src: DataView, at: number;
          if (decl.attr <= GxAttr.TEX7MTXIDX) {
            // Matrix indices are always direct u8s, in units of matrix rows (3 per 3×4 matrix).
            const value = view.getUint8(p++);
            if (decl.attr === GxAttr.PNMTXIDX) slot = value / 3;
            continue;
          }
          const format = vtx1.formats.get(decl.attr)!;
          if (decl.type === GxAttrType.DIRECT) {
            src = view;
            at = p;
            p += elementSize(decl.attr, format);
          } else {
            const index = decl.type === GxAttrType.INDEX8 ? view.getUint8(p) : view.getUint16(p);
            p += decl.type === GxAttrType.INDEX8 ? 1 : 2;
            const array = vtx1.arrays.get(decl.attr === GxAttr.NRM && !vtx1.arrays.has(GxAttr.NRM) ? GxAttr.NBT : decl.attr)!;
            src = dataView(array);
            at = index * elementSize(decl.attr, format);
          }
          readAttribute(shape, decl.attr, format, src, at, v);
        }
        shape.drawMatrix[v] = slots[slot] ?? 0;
      }
      triangulate(draw.primitive, first, draw.count, indices);
    }
    shape.indices = Uint32Array.from(indices);
    shapes.push(shape);
  }
  return shapes;
}

function readAttribute(shape: J3dShape, attr: number, format: VertexAttrFormat, src: DataView, at: number, v: number): void {
  if (attr === GxAttr.CLR0 || attr === GxAttr.CLR1) {
    readColor(src, at, format.compType, shape.color[attr - GxAttr.CLR0]!, v * 4);
    return;
  }
  const size = componentSize(format.compType);
  // Normals always use a fixed exponent (6 for 8-bit, 14 for 16-bit) whatever the VAT says.
  const shift = format.compType === GxCompType.F32 ? 0 : attr === GxAttr.NRM ? (size === 1 ? 6 : 14) : format.compShift;
  const scale = 1 / (1 << shift);
  const c = (i: number) => readComponent(src, at + i * size, format.compType) * scale;
  if (attr === GxAttr.POS) {
    shape.position[v * 3] = c(0);
    shape.position[v * 3 + 1] = c(1);
    shape.position[v * 3 + 2] = format.compCnt === 0 ? 0 : c(2);
  } else if (attr === GxAttr.NRM) {
    shape.normal![v * 3] = c(0);
    shape.normal![v * 3 + 1] = c(1);
    shape.normal![v * 3 + 2] = c(2);
  } else {
    const tex = shape.texCoord[attr - GxAttr.TEX0]!;
    tex[v * 2] = c(0);
    tex[v * 2 + 1] = format.compCnt === 0 ? 0 : c(1);
  }
}

/** Appends a GX primitive as triangles, keeping GX's winding (clockwise = front, as noclip's loader does). */
function triangulate(primitive: number, first: number, count: number, out: number[]): void {
  switch (primitive) {
    case GxPrimitive.TRIANGLES:
      for (let i = 0; i + 2 < count; i += 3) out.push(first + i, first + i + 1, first + i + 2);
      break;
    case GxPrimitive.QUADS:
    case GxPrimitive.QUAD_STRIP:
      for (let i = 0; i + 3 < count; i += 4) out.push(first + i, first + i + 1, first + i + 2, first + i, first + i + 2, first + i + 3);
      break;
    case GxPrimitive.TRIANGLE_STRIP:
      for (let i = 2; i < count; i++) out.push(first + i - 2, first + i - (~i & 1), first + i - (i & 1));
      break;
    case GxPrimitive.TRIANGLE_FAN:
      for (let i = 2; i < count; i++) out.push(first, first + i - 1, first + i);
      break;
    default:
      // Lines and points aren't drawn.
      break;
  }
}
// #endregion

// #region MAT3
export interface ColorChannel {
  lightingEnabled: boolean;
  matColorSource: number;
  ambColorSource: number;
  litMask: number;
  diffuseFunction: number;
  attenuationFunction: number;
}

export interface LightChannel {
  color: ColorChannel;
  alpha: ColorChannel;
}

export interface TexGen {
  type: number;
  source: number;
  /** GX texgen matrix: 60 = identity, 30 + 3n = TEXMTXn. J3D pairs texgen n with texture matrix n. */
  matrix: number;
  normalize: boolean;
  postMatrix: number;
}

/** A material's texture matrix: SRT parameters plus the mapping mode (`info & 0x3f`) and effect matrix. */
export interface TexMatrix {
  projection: number;
  info: number;
  center: [number, number, number];
  scale: [number, number];
  /** Rotation in half-turns (value × π = radians). */
  rotation: number;
  translation: [number, number];
  effectMatrix: J3dMatrix;
  /** The texgen asks for the identity matrix: the SRT above is ignored unless a BTK animates this matrix. */
  identity: boolean;
}

export type SwapTable = [number, number, number, number];

export interface TevStage {
  colorIn: [number, number, number, number];
  colorOp: number;
  colorBias: number;
  colorScale: number;
  colorClamp: boolean;
  colorRegister: number;
  alphaIn: [number, number, number, number];
  alphaOp: number;
  alphaBias: number;
  alphaScale: number;
  alphaClamp: boolean;
  alphaRegister: number;
  texCoord: number;
  texMap: number;
  channel: number;
  konstColorSel: number;
  konstAlphaSel: number;
  rasSwap: SwapTable | null;
  texSwap: SwapTable | null;
  // SetTevIndirect
  indTexStage: number;
  indTexFormat: number;
  indTexBias: number;
  indTexMatrix: number;
  indTexWrapS: number;
  indTexWrapT: number;
  indTexAddPrev: boolean;
  indTexAlphaSel: number;
}

export interface IndTexStage {
  texCoord: number;
  texMap: number;
  scaleS: number;
  scaleT: number;
}

export interface AlphaTest {
  compareA: number;
  referenceA: number;
  op: number;
  compareB: number;
  referenceB: number;
}

export interface Blend {
  mode: number;
  srcFactor: number;
  dstFactor: number;
  logicOp: number;
}

export interface J3dMaterial {
  name: string;
  /** J3D material mode: 1 = opaque, 2 = masked (alpha test), 4 = translucent (drawn in the XLU pass). */
  mode: number;
  cullMode: number;
  lightChannels: LightChannel[];
  texGens: TexGen[];
  texMatrices: (TexMatrix | null)[];
  /** Per GX texture map slot (0-7): TEX1 texture index, or -1. */
  textures: number[];
  matColors: [GxColor, GxColor];
  ambColors: [GxColor, GxColor];
  konstColors: [GxColor, GxColor, GxColor, GxColor];
  /** TEV color registers C0, C1, C2 (and a fourth J3D entry, see docs). */
  tevColors: [GxColor, GxColor, GxColor, GxColor];
  tevStages: TevStage[];
  indTexStages: IndTexStage[];
  /** Indirect matrices as [a, b, tx, scale, c, d, ty, 0] with the 2^exponent scale already applied. */
  indTexMatrices: Float32Array[];
  alphaTest: AlphaTest;
  blend: Blend;
  zMode: { test: boolean; func: number; write: boolean };
}

const WHITE: GxColor = [1, 1, 1, 1];
const TRANSPARENT: GxColor = [0, 0, 0, 0];

const channelControl = (enable: boolean, ambSrc: number, matSrc: number, litMask: number, diffFn: number, attnFn: number): ColorChannel => ({
  lightingEnabled: enable,
  ambColorSource: ambSrc,
  matColorSource: matSrc,
  litMask,
  diffuseFunction: diffFn,
  attenuationFunction: attnFn,
});

function readMat3(chunk: Uint8Array): J3dMaterial[] {
  const view = dataView(chunk);
  const count = view.getUint16(0x08);
  const entries = view.getUint32(0x0c), remap = view.getUint32(0x10);
  const nameOffset = view.getUint32(0x14);
  const names = readNameTable(chunk, nameOffset);
  const off = (at: number) => view.getUint32(at);
  const indirect = off(0x18), cullModes = off(0x1c), matColors = off(0x20), chanNums = off(0x24), chans = off(0x28);
  const ambColors = off(0x2c), texGenTable = off(0x38), texMtxTable = off(0x40);
  const texNos = off(0x48), tevOrders = off(0x4c), tevColors = off(0x50), konstColors = off(0x54);
  const tevStageTable = off(0x5c), swapModes = off(0x60), swapTables = off(0x64);
  const alphaComps = off(0x6c), blends = off(0x70), zModes = off(0x74);

  const u8 = (o: number) => view.getUint8(o), u16 = (o: number) => view.getUint16(o), s16 = (o: number) => view.getInt16(o);
  const colorU8 = (o: number): GxColor => [u8(o) / 255, u8(o + 1) / 255, u8(o + 2) / 255, u8(o + 3) / 255];
  const colorS16 = (o: number): GxColor => [s16(o) / 255, s16(o + 2) / 255, s16(o + 4) / 255, s16(o + 6) / 255];

  const materials: J3dMaterial[] = [];
  for (let i = 0; i < count; i++) {
    const m = entries + u16(remap + i * 2) * 0x14c;
    const optional = <T>(at: number, read: (index: number) => T, fallback: T): T => (u16(at) === 0xffff ? fallback : read(u16(at)));

    const lightChannels: LightChannel[] = [];
    const chanCount = u8(chanNums + u8(m + 0x02));
    const readChannel = (index: number): ColorChannel => {
      const o = chans + index * 8;
      const afn = u8(o + 4);
      // J3D stores the attenuation function as 0 = specular, 1 = spot, 2 = none.
      return channelControl(u8(o) !== 0, u8(o + 5), u8(o + 1), u8(o + 2), u8(o + 3), afn > 1 ? 2 : afn);
    };
    const noChannel = channelControl(false, 0, 0, 0, 0, 2);
    for (let j = 0; j < chanCount; j++) {
      lightChannels.push({
        color: optional(m + 0x0c + j * 4, readChannel, noChannel),
        alpha: optional(m + 0x0c + j * 4 + 2, readChannel, noChannel),
      });
    }

    const texMatrices: (TexMatrix | null)[] = [];
    for (let j = 0; j < 10; j++) {
      const index = s16(m + 0x48 + j * 2);
      texMatrices.push(texMtxTable && index >= 0 ? readTexMatrix(view, texMtxTable + index * 0x64) : null);
    }

    const texGens: TexGen[] = [];
    for (let j = 0; j < 8; j++) {
      const index = s16(m + 0x28 + j * 2);
      if (index < 0) continue;
      const o = texGenTable + index * 4;
      const matrix = u8(o + 2);
      // As in noclip: texgen n always uses TEXMTXn so that BTK animations apply even when the file says identity.
      const texMatrix = texMatrices[j];
      if (matrix === GxTexGenMatrix.IDENTITY && texMatrix) texMatrix.identity = true;
      texGens[j] = { type: u8(o), source: u8(o + 1), matrix, normalize: false, postMatrix: GxPostTexGenMatrix.PTIDENTITY };
    }

    const textures: number[] = [];
    for (let j = 0; j < 8; j++) textures.push(u16(m + 0x84 + j * 2) === 0xffff ? -1 : u16(texNos + u16(m + 0x84 + j * 2) * 2));

    const konst = [0, 1, 2, 3].map((j) => optional(m + 0x94 + j * 2, (k) => colorU8(konstColors + k * 4), WHITE)) as J3dMaterial["konstColors"];
    const regs = [0, 1, 2, 3].map((j) => optional(m + 0xdc + j * 2, (k) => colorS16(tevColors + k * 8), TRANSPARENT)) as J3dMaterial["tevColors"];

    // Indirect texturing: one 0x138-byte entry per material, in material order.
    const ind = indirect + i * 0x138;
    const hasIndirect = indirect !== nameOffset && u8(ind) === 1;
    const indTexStages: IndTexStage[] = [];
    const indTexMatrices: Float32Array[] = [];
    if (hasIndirect) {
      const n = u8(ind + 1);
      for (let j = 0; j < n; j++) {
        const order = ind + 0x04 + j * 4;
        const scale = ind + 0x04 + 0x10 + 0x1c * 3 + j * 4;
        indTexStages.push({ texCoord: u8(order), texMap: u8(order + 1), scaleS: u8(scale), scaleT: u8(scale + 1) });
      }
      for (let j = 0; j < 3; j++) {
        const o = ind + 0x04 + 0x10 + j * 0x1c;
        const k = Math.pow(2, view.getInt8(o + 0x18));
        const p = (n: number) => view.getFloat32(o + n * 4) * k;
        indTexMatrices.push(new Float32Array([p(0), p(1), p(2), k, p(3), p(4), p(5), 0]));
      }
    }

    const tevStages: TevStage[] = [];
    for (let j = 0; j < 16; j++) {
      const index = s16(m + 0xe4 + j * 2);
      if (index < 0) continue;
      const t = tevStageTable + index * 0x14;
      const order = tevOrders + u16(m + 0xbc + j * 2) * 4;
      const stage: TevStage = {
        colorIn: [u8(t + 1), u8(t + 2), u8(t + 3), u8(t + 4)],
        colorOp: u8(t + 5),
        colorBias: u8(t + 6),
        colorScale: u8(t + 7),
        colorClamp: u8(t + 8) !== 0,
        colorRegister: u8(t + 9),
        alphaIn: [u8(t + 0x0a), u8(t + 0x0b), u8(t + 0x0c), u8(t + 0x0d)],
        alphaOp: u8(t + 0x0e),
        alphaBias: u8(t + 0x0f),
        alphaScale: u8(t + 0x10),
        alphaClamp: u8(t + 0x11) !== 0,
        alphaRegister: u8(t + 0x12),
        texCoord: u8(order),
        texMap: u8(order + 1),
        channel: rasChannel(u8(order + 2)),
        konstColorSel: u8(m + 0x9c + j),
        konstAlphaSel: u8(m + 0xac + j),
        rasSwap: null,
        texSwap: null,
        indTexStage: 0,
        indTexFormat: 0,
        indTexBias: 0,
        indTexMatrix: 0,
        indTexWrapS: 0,
        indTexWrapT: 0,
        indTexAddPrev: false,
        indTexAlphaSel: 0,
      };
      const swap = u16(m + 0x104 + j * 2);
      if (swap !== 0xffff) {
        const table = (sel: number): SwapTable => {
          const o = swapTables + u16(m + 0x124 + sel * 2) * 4;
          return [u8(o), u8(o + 1), u8(o + 2), u8(o + 3)];
        };
        stage.rasSwap = table(u8(swapModes + swap * 4));
        stage.texSwap = table(u8(swapModes + swap * 4 + 1));
      }
      if (hasIndirect) {
        const o = ind + 0x04 + 0x10 + 0x1c * 3 + 0x10 + j * 0x0c;
        Object.assign(stage, {
          indTexStage: u8(o),
          indTexFormat: u8(o + 1),
          indTexBias: u8(o + 2),
          indTexMatrix: u8(o + 3),
          indTexWrapS: u8(o + 4),
          indTexWrapT: u8(o + 5),
          indTexAddPrev: u8(o + 6) !== 0,
          indTexAlphaSel: u8(o + 8),
        });
      }
      tevStages[j] = stage;
    }

    const a = alphaComps + u16(m + 0x146) * 8;
    const b = blends + u16(m + 0x148) * 4;
    const z = zModes + u8(m + 0x06) * 4;
    materials.push({
      name: names[i] ?? `material${i}`,
      mode: u8(m),
      cullMode: view.getUint32(cullModes + u8(m + 0x01) * 4),
      lightChannels,
      texGens: dense(texGens),
      texMatrices,
      textures,
      matColors: [0, 1].map((j) => optional(m + 0x08 + j * 2, (k) => colorU8(matColors + k * 4), WHITE)) as J3dMaterial["matColors"],
      ambColors: [0, 1].map((j) => optional(m + 0x14 + j * 2, (k) => colorU8(ambColors + k * 4), WHITE)) as J3dMaterial["ambColors"],
      konstColors: konst,
      tevColors: regs,
      tevStages: dense(tevStages),
      indTexStages,
      indTexMatrices,
      alphaTest: { compareA: u8(a), referenceA: u8(a + 1) / 255, op: u8(a + 2), compareB: u8(a + 3), referenceB: u8(a + 4) / 255 },
      blend: { mode: u8(b), srcFactor: u8(b + 1), dstFactor: u8(b + 2), logicOp: u8(b + 3) },
      zMode: { test: u8(z) !== 0, func: u8(z + 1), write: u8(z + 2) !== 0 },
    });
  }
  return materials;
}

/** Arrays with holes (unused texgen / TEV slots) must not happen in practice; fail loudly if they do. */
function dense<T>(items: T[]): T[] {
  for (let i = 0; i < items.length; i++) if (items[i] === undefined) throw new Error("MAT3: sparse texgen/TEV stage list");
  return items;
}

/** J3D TEV order channel IDs (GX_COLOR0…GX_COLOR_NULL) to the rasterizer channel the TEV reads. */
function rasChannel(id: number): number {
  switch (id) {
    case 0:
    case 2:
    case 4:
      return GxRasChannel.COLOR0A0;
    case 1:
    case 3:
    case 5:
      return GxRasChannel.COLOR1A1;
    case 7:
      return GxRasChannel.ALPHA_BUMP;
    case 8:
      return GxRasChannel.ALPHA_BUMP_N;
    default:
      return GxRasChannel.COLOR_ZERO;
  }
}

function readTexMatrix(view: DataView, o: number): TexMatrix {
  const f = (at: number) => view.getFloat32(o + at);
  const effect = new Float32Array(16);
  // Stored row-major 4×4.
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) effect[col * 4 + row] = f(0x24 + (row * 4 + col) * 4);
  return {
    projection: view.getUint8(o),
    info: view.getUint8(o + 1),
    center: [f(0x04), f(0x08), f(0x0c)],
    scale: [f(0x10), f(0x14)],
    rotation: view.getInt16(o + 0x18) / 0x7fff,
    translation: [f(0x1c), f(0x20)],
    effectMatrix: effect,
    identity: false,
  };
}
// #endregion

// #region TEX1
export interface J3dTexture {
  name: string;
  format: number;
  width: number;
  height: number;
  wrapS: number;
  wrapT: number;
  minFilter: number;
  magFilter: number;
  mipCount: number;
  lodBias: number;
  /** Base mip level, RGBA8. */
  image: DecodedTexture;
}

function readTex1(chunk: Uint8Array): J3dTexture[] {
  const view = dataView(chunk);
  const count = view.getUint16(0x08);
  const headers = view.getUint32(0x0c);
  const names = readNameTable(chunk, view.getUint32(0x10));
  const decoded = new Map<number, DecodedTexture>();
  const textures: J3dTexture[] = [];
  for (let i = 0; i < count; i++) {
    const h = headers + i * 0x20;
    const format = view.getUint8(h), width = view.getUint16(h + 2), height = view.getUint16(h + 4);
    const paletteFormat = view.getUint8(h + 9), paletteCount = view.getUint16(h + 0x0a), paletteOffset = view.getUint32(h + 0x0c);
    // BTI headers inside TEX1 use offsets relative to the header itself; textures sharing data share an offset.
    const dataOffset = h + view.getUint32(h + 0x1c);
    let image = decoded.get(dataOffset);
    if (!image) {
      const palette = paletteCount ? decodePalette(chunk.subarray(h + paletteOffset, h + paletteOffset + paletteCount * 2), paletteFormat) : null;
      image = decodeGxTexture(chunk.subarray(dataOffset), format, width, height, palette);
      decoded.set(dataOffset, image);
    }
    textures.push({
      name: names[i] ?? `texture${i}`,
      format,
      width,
      height,
      wrapS: view.getUint8(h + 6),
      wrapT: view.getUint8(h + 7),
      minFilter: view.getUint8(h + 0x14),
      magFilter: view.getUint8(h + 0x15),
      mipCount: view.getUint8(h + 0x18),
      lodBias: view.getInt16(h + 0x1a) / 100,
      image,
    });
  }
  return textures;
}
// #endregion

export interface Bmd {
  magic: string;
  loadFlags: number;
  hierarchy: HierarchyNode[];
  joints: J3dJoint[];
  drawMatrices: J3dDrawMatrix[];
  envelopes: J3dEnvelope[];
  inverseBinds: J3dMatrix[];
  shapes: J3dShape[];
  materials: J3dMaterial[];
  textures: J3dTexture[];
  /** Shapes in scene-graph order, as drawn. */
  drawOrder: number[];
}

export function isBmd(bytes: Uint8Array): boolean {
  const m = ascii(bytes, 0, 8);
  return m === "J3D2bmd3" || m === "J3D2bdl4";
}

export function parseBmd(bytes: Uint8Array): Bmd {
  if (!isBmd(bytes)) throw new Error(`not a BMD model (${JSON.stringify(ascii(bytes, 0, 8))})`);
  const { magic, chunks } = readJ3dChunks(bytes);
  const chunk = (id: string) => {
    const found = chunks.find((c) => c.id === id);
    if (!found) throw new Error(`BMD: missing ${id}`);
    return found.data;
  };
  const inf1 = readInf1(chunk("INF1"));
  const vtx1 = readVtx1(chunk("VTX1"));
  const evp1 = readEvp1(chunk("EVP1"));
  const bmd: Bmd = {
    magic,
    loadFlags: inf1.loadFlags,
    hierarchy: inf1.hierarchy,
    joints: readJnt1(chunk("JNT1")),
    drawMatrices: readDrw1(chunk("DRW1")),
    envelopes: evp1.envelopes,
    inverseBinds: evp1.inverseBinds,
    shapes: readShp1(chunk("SHP1"), vtx1),
    materials: readMat3(chunk("MAT3")),
    textures: readTex1(chunk("TEX1")),
    drawOrder: [],
  };

  // Walk the scene graph: joint nesting gives parents; a shape uses the last material seen.
  const stack: number[] = [];
  let lastJoint = -1, material = -1;
  for (const node of inf1.hierarchy) {
    if (node.type === HierarchyNodeType.OPEN) stack.push(lastJoint);
    else if (node.type === HierarchyNodeType.CLOSE) lastJoint = stack.pop() ?? -1;
    else if (node.type === HierarchyNodeType.JOINT) {
      const joint = bmd.joints[node.value];
      if (joint) joint.parent = stack.length ? stack[stack.length - 1]! : -1;
      lastJoint = node.value;
    } else if (node.type === HierarchyNodeType.MATERIAL) material = node.value;
    else if (node.type === HierarchyNodeType.SHAPE) {
      const shape = bmd.shapes[node.value];
      if (shape) shape.materialIndex = material;
      bmd.drawOrder.push(node.value);
    }
  }
  return bmd;
}
