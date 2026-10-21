// J2D screens, "SCRNblo2" (J2D version 2, the JSystem 2D layout format FSA uses for every HUD and menu).
// File: 0x20-byte header ("SCRN" "blo2", u32 file size, u32 block count, "SVR1" + 0xFF padding), then blocks of
// [u32 tag, u32 size, data], each padded to 0x20 (headers) or 8 (panes) bytes:
//   INF1 screen size + background color · TEX1/FNT1 resource tables · MAT1 material table
//   PAN2/PIC2/WIN2/TBX2 panes, BGN1/END1 opening/closing a child list, EXT1 end.
// Field names follow JSystem's J2D (J2DPane, J2DPictureEx, J2DWindowEx, J2DTextBoxEx, J2DMaterialFactory); layouts
// were worked out from FSA's 82 screens (see docs/formats.md). All values are big-endian.
import { ascii, dataView } from "../bytes.ts";

export type Rgba = [number, number, number, number];

export interface BloResource {
  /** JUTResReference type: 2 = by name in the owning archive (every FSA screen uses 2). */
  type: number;
  name: string;
}

export interface BloTexGen {
  type: number; // GXTexGenType (1 = MTX2x4)
  source: number; // GXTexGenSrc (4 = TEX0 … )
  matrix: number; // GXTexMtx (0x3C = identity, 0x1E + 3n = TEXMTXn)
}

export interface BloTexMatrix {
  type: number;
  info: number;
  center: [number, number, number];
  scaleX: number;
  scaleY: number;
  rotation: number; // degrees
  translateX: number;
  translateY: number;
}

export interface BloTevOrder {
  texCoord: number; // 0xFF = none
  texMap: number; // 0xFF = none
  channel: number; // GXChannelID (4 = COLOR0A0, 0xFF = none)
}

export interface BloTevStage {
  colorIn: [number, number, number, number]; // GXTevColorArg a, b, c, d
  colorOp: number;
  colorBias: number;
  colorScale: number;
  colorClamp: boolean;
  colorReg: number;
  alphaIn: [number, number, number, number]; // GXTevAlphaArg a, b, c, d
  alphaOp: number;
  alphaBias: number;
  alphaScale: number;
  alphaClamp: boolean;
  alphaReg: number;
}

export interface BloAlphaCompare {
  comp0: number;
  ref0: number;
  op: number;
  comp1: number;
  ref1: number;
}

export interface BloBlend {
  type: number; // GXBlendMode (0 none, 1 blend, 2 logic, 3 subtract)
  source: number; // GXBlendFactor
  dest: number;
  logicOp: number;
}

export interface BloMaterial {
  name: string;
  flag: number; // material mode byte (1 in every FSA material)
  cullMode: number;
  /** Where the rasterized color comes from per channel: 0 = material color register, 1 = vertex (corner) colors. */
  colorChannels: number[];
  matColors: Rgba[]; // [0].a doubles as the pane alpha of Ex panes
  texGens: BloTexGen[];
  texMatrices: (BloTexMatrix | null)[];
  textures: (number | null)[]; // TEX1 indices, one per texture map
  font: number | null; // FNT1 index
  tevOrders: BloTevOrder[];
  tevColors: Rgba[]; // signed 10-bit TEV registers: [0] = C0, [1] = C1, [2] = C2, [3] = PREV (as in J3D)
  konstColors: Rgba[];
  kColorSels: number[];
  kAlphaSels: number[];
  tevStages: BloTevStage[];
  swapModes: { ras: number; tex: number }[];
  swapTables: [number, number, number, number][];
  alphaCompare: BloAlphaCompare;
  blend: BloBlend;
  dither: boolean;
  /** Indirect texturing, enabled on 25 effect materials (title logo, collection, results, GBA window); else null. */
  indirect: BloIndirect | null;
}

/** An indirect texture stage (GXSetIndTexOrder + GXSetIndTexCoordScale): the offset map and its coordinates. */
export interface BloIndTexStage {
  texCoord: number;
  texMap: number;
  scaleS: number; // GXIndTexScale: coordinates divided by 2^scale
  scaleT: number;
}

/** An indirect matrix (GXSetIndTexMtx): 2×3 offsets per texel of the map, times 2^scaleExp. */
export interface BloIndTexMatrix {
  matrix: [[number, number, number], [number, number, number]];
  scaleExp: number;
}

/** A TEV stage's use of the indirect stages (GXSetTevIndirect). matrix 0 = off. */
export interface BloIndTevStage {
  indStage: number;
  format: number; // GXIndTexFormat (0 = 8 bits)
  bias: number; // GXIndTexBiasSel (7 = STU)
  matrix: number; // GXIndTexMtxID (0 off, 1-3 = matrices 0-2, 5-7 S, 9-11 T)
  wrapS: number;
  wrapT: number;
  addPrev: boolean;
  utcLod: boolean;
  alphaSel: number;
}

export interface BloIndirect {
  stages: BloIndTexStage[];
  matrices: BloIndTexMatrix[];
  /** One per TEV stage of the material. */
  tevStages: BloIndTevStage[];
}

/** J2DBasePosition: where the pane's (x, y) sits on its box. 0 top-left … 4 center … 8 bottom-right (row-major 3×3). */
export type BloAnchor = number;

interface BloPaneBase {
  block: "PAN2" | "PIC2" | "WIN2" | "TBX2";
  /** Editor serial number of the pane (unique per screen, not in tree order). */
  id: number;
  tag: string; // pane name, e.g. "ROOT", "Pp4lf01"
  userTag: bigint;
  visible: boolean;
  anchor: BloAnchor;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number; // degrees; the only rotation FSA uses
  x: number; // position of the anchor point, relative to the parent's anchor point
  y: number;
  children: BloPane[];
}

export interface BloPlainPane extends BloPaneBase {
  kind: "pane";
}

/** Ex panes (picture, window, text box) carry a material and a second serial number used by the vertex tables. */
interface BloMaterialPane extends BloPaneBase {
  materialId: number; // serial number (counts pictures, windows and text boxes)
  material: number; // index into BloScreen.materials
}

export interface BloPicture extends BloMaterialPane {
  kind: "picture";
  /** Per-corner indices (TL, TR, BL, BR) of a screen-wide vertex list; *hypothesis*: targets of vertex color anims. */
  vertexIndices: [number, number, number, number];
  texCoords: [[number, number], [number, number], [number, number], [number, number]]; // TL, TR, BL, BR
  cornerColors: [Rgba, Rgba, Rgba, Rgba]; // TL, TR, BL, BR
}

export interface BloWindow extends BloMaterialPane {
  kind: "window";
  unknownColors: [Rgba, Rgba]; // always white in FSA
  frameMaterials: [number, number, number, number]; // TL, TR, BL, BR corner materials
  /** Two bits per corner (TL in the top bits): high bit = mirror horizontally, low bit = mirror vertically. */
  frameMirror: number;
  contentX: number;
  contentY: number;
  contentWidth: number;
  contentHeight: number;
  vertexIndices: [number, number, number, number];
  contentColors: [Rgba, Rgba, Rgba, Rgba];
}

export interface BloTextBox extends BloMaterialPane {
  kind: "textbox";
  charSpace: number;
  lineSpace: number;
  fontWidth: number;
  fontHeight: number;
  hBinding: number; // 0 center, 1 right, 2 left
  vBinding: number; // 0 center, 1 bottom, 2 top
  topColor: Rgba;
  bottomColor: Rgba;
  maxLength: number;
  /** Raw bytes of the initial text (Shift-JIS in Japanese screens; FSA's own escape sequences are not decoded). */
  textBytes: Uint8Array;
  text: string;
}

export type BloPane = BloPlainPane | BloPicture | BloWindow | BloTextBox;

export interface BloScreen {
  width: number;
  height: number;
  background: Rgba;
  textures: BloResource[];
  fonts: BloResource[];
  materials: BloMaterial[];
  root: BloPane;
}

const NONE = 0xffff;

export function isBlo2(bytes: Uint8Array): boolean {
  return bytes.length >= 0x20 && ascii(bytes, 0, 8) === "SCRNblo2";
}

export function parseBlo(bytes: Uint8Array): BloScreen {
  if (!isBlo2(bytes)) throw new Error(`not a SCRNblo2 screen (${JSON.stringify(ascii(bytes, 0, 8))})`);
  const v = dataView(bytes);
  const blockCount = v.getUint32(0x0c);
  const screen: BloScreen = {
    width: 0,
    height: 0,
    background: [0, 0, 0, 0],
    textures: [],
    fonts: [],
    materials: [],
    root: null as unknown as BloPane,
  };
  const stack: BloPane[][] = [];
  let siblings: BloPane[] = [];
  const top: BloPane[] = siblings;
  let o = 0x20;
  for (let i = 0; i < blockCount; i++) {
    const tag = ascii(bytes, o, 4);
    const size = v.getUint32(o + 4);
    if (size < 8 || o + size > bytes.length) throw new Error(`bad ${tag} block size ${size} at 0x${o.toString(16)}`);
    switch (tag) {
      case "INF1":
        screen.width = v.getUint16(o + 8);
        screen.height = v.getUint16(o + 10);
        screen.background = rgba(v, o + 12);
        break;
      case "TEX1":
        screen.textures = parseResources(bytes, o);
        break;
      case "FNT1":
        screen.fonts = parseResources(bytes, o);
        break;
      case "MAT1":
        screen.materials = parseMaterials(bytes, o);
        break;
      case "PAN2":
      case "PIC2":
      case "WIN2":
      case "TBX2":
        siblings.push(parsePane(bytes, o, tag));
        break;
      case "BGN1": {
        const parent = siblings.at(-1);
        if (!parent) throw new Error(`BGN1 without a pane at 0x${o.toString(16)}`);
        stack.push(siblings);
        siblings = parent.children;
        break;
      }
      case "END1":
        siblings = stack.pop() ?? top;
        break;
      case "EXT1":
        i = blockCount;
        break;
      default:
        throw new Error(`unknown BLO2 block ${JSON.stringify(tag)} at 0x${o.toString(16)}`);
    }
    o += size;
  }
  if (top.length !== 1) throw new Error(`expected one root pane, found ${top.length}`);
  screen.root = top[0]!;
  return screen;
}

/** Visits every pane depth first (parents before children). */
export function* walkPanes(pane: BloPane, depth = 0): Generator<{ pane: BloPane; depth: number }> {
  yield { pane, depth };
  for (const child of pane.children) yield* walkPanes(child, depth + 1);
}

export function findPane(screen: BloScreen, tag: string): BloPane | null {
  for (const { pane } of walkPanes(screen.root)) if (pane.tag === tag) return pane;
  return null;
}

function rgba(v: DataView, o: number): Rgba {
  return [v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3)];
}

// TEX1/FNT1: u16 count, u16 0xFFFF, u32 offset (from the block) of a J2DResReference: u16 count, u16 offsets[count]
// (relative to the J2DResReference), then per entry u8 type, u8 length, name[length] (not terminated).
function parseResources(bytes: Uint8Array, block: number): BloResource[] {
  const v = dataView(bytes);
  const count = v.getUint16(block + 8);
  const table = block + v.getUint32(block + 12);
  const out: BloResource[] = [];
  for (let i = 0; i < count; i++) {
    const entry = table + v.getUint16(table + 2 + i * 2);
    const length = v.getUint8(entry + 1);
    out.push({ type: v.getUint8(entry), name: ascii(bytes, entry + 2, length) });
  }
  return out;
}

// Pane header shared by every pane type (the "PAN2" block, or the "pan2" sub-block of PIC2/WIN2/TBX2), 0x48 bytes:
// tag, size, u16 0x40, u16 id, u8 visible, u8 anchor, 2 pad, u64 tag, u64 user tag, f32 width, height, scale x, y,
// rotate x, y, z, translate x, y, u32 0.
function parsePaneBase(bytes: Uint8Array, o: number, block: BloPaneBase["block"]): BloPaneBase {
  const v = dataView(bytes);
  return {
    block,
    id: v.getUint16(o + 0x0a),
    visible: v.getUint8(o + 0x0c) !== 0,
    anchor: v.getUint8(o + 0x0d),
    tag: ascii(bytes, o + 0x10 + firstNonZero(bytes, o + 0x10, 8), 8),
    userTag: v.getBigUint64(o + 0x18),
    width: v.getFloat32(o + 0x20),
    height: v.getFloat32(o + 0x24),
    scaleX: v.getFloat32(o + 0x28),
    scaleY: v.getFloat32(o + 0x2c),
    rotateX: v.getFloat32(o + 0x30),
    rotateY: v.getFloat32(o + 0x34),
    rotateZ: v.getFloat32(o + 0x38),
    x: v.getFloat32(o + 0x3c),
    y: v.getFloat32(o + 0x40),
    children: [],
  };
}

// Tags are u64s holding right-aligned ASCII ("\0\0\0\0ROOT").
function firstNonZero(bytes: Uint8Array, o: number, length: number): number {
  let i = 0;
  while (i < length && bytes[o + i] === 0) i++;
  return i;
}

function parsePane(bytes: Uint8Array, o: number, block: BloPaneBase["block"]): BloPane {
  const v = dataView(bytes);
  if (block === "PAN2") return { kind: "pane", ...parsePaneBase(bytes, o, block) };
  const base = parsePaneBase(bytes, o + 8, block);
  const q = o + 8 + v.getUint32(o + 8 + 4); // the type-specific part follows the pan2 sub-block
  const corners = (at: number) => [rgba(v, at), rgba(v, at + 4), rgba(v, at + 8), rgba(v, at + 12)] as BloPicture["cornerColors"];
  const indices = (at: number) =>
    [v.getUint16(at), v.getUint16(at + 2), v.getUint16(at + 4), v.getUint16(at + 6)] as [number, number, number, number];
  switch (block) {
    case "PIC2": {
      // u16 size (0x30), u16 material id, u16 material, 2 pad, u16 vertex[4], s16 texcoord[4][2] (8.8 fixed), rgba[4]
      const tc = (i: number): [number, number] => [v.getInt16(q + 0x10 + i * 4) / 256, v.getInt16(q + 0x12 + i * 4) / 256];
      return {
        kind: "picture",
        ...base,
        materialId: v.getUint16(q + 2),
        material: v.getUint16(q + 4),
        vertexIndices: indices(q + 8),
        texCoords: [tc(0), tc(1), tc(2), tc(3)],
        cornerColors: corners(q + 0x20),
      };
    }
    case "WIN2":
      // u16 size (0x40), 6 pad, rgba[2], u16 frame material[4], u8 mirror, pad, s16 content x, y, w, h,
      // u16 material id, u16 content material, 2 pad, u16 vertex[4], rgba content colors[4]
      return {
        kind: "window",
        ...base,
        unknownColors: [rgba(v, q + 8), rgba(v, q + 12)],
        frameMaterials: indices(q + 0x10),
        frameMirror: v.getUint8(q + 0x18),
        contentX: v.getInt16(q + 0x1a),
        contentY: v.getInt16(q + 0x1c),
        contentWidth: v.getInt16(q + 0x1e),
        contentHeight: v.getInt16(q + 0x20),
        materialId: v.getUint16(q + 0x22),
        material: v.getUint16(q + 0x24),
        vertexIndices: indices(q + 0x28),
        contentColors: corners(q + 0x30),
      };
    case "TBX2": {
      // u16 size, u16 material id, u16 material, s16 char space, s16 line space, u16 font w, h, u8 h/v binding,
      // rgba top, bottom, 4 pad, u16 max length, u16 length, text[length]
      const length = v.getUint16(q + 0x1e);
      const textBytes = bytes.slice(q + 0x20, q + 0x20 + length);
      return {
        kind: "textbox",
        ...base,
        materialId: v.getUint16(q + 2),
        material: v.getUint16(q + 4),
        charSpace: v.getInt16(q + 6),
        lineSpace: v.getInt16(q + 8),
        fontWidth: v.getUint16(q + 0x0a),
        fontHeight: v.getUint16(q + 0x0c),
        hBinding: v.getUint8(q + 0x0e),
        vBinding: v.getUint8(q + 0x0f),
        topColor: rgba(v, q + 0x10),
        bottomColor: rgba(v, q + 0x14),
        maxLength: v.getUint16(q + 0x1c),
        textBytes,
        text: decodeBloText(textBytes),
      };
    }
  }
}

/** Screen text is ASCII in the US screens and Shift-JIS in placeholders; falls back to Latin-1 without TextDecoder support. */
export function decodeBloText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("shift_jis").decode(bytes);
  } catch {
    return String.fromCharCode(...bytes);
  }
}

// MAT1: u16 count, u16 pad, then 23 u32 offsets (from the block) of: material init data (0xE8 each), u16 index remap,
// name table, indirect data (0x128 each), cull modes (u32), material colors (rgba), color channel counts (u8),
// color channel infos (4 bytes), tex gen counts (u8), tex gens (4), tex matrices (0x24), texture indices (u16),
// font indices (u16), TEV orders (4), TEV colors (s16 rgba), konst colors (rgba), TEV stage counts (u8),
// TEV stages (0x14), swap modes (4), swap tables (4), alpha compares (8), blends (4), dither (u8).
const MAT = {
  init: 0,
  remap: 1,
  names: 2,
  indirect: 3,
  cull: 4,
  matColor: 5,
  chanNum: 6,
  chanInfo: 7,
  texGenNum: 8,
  texGen: 9,
  texMtx: 10,
  texture: 11,
  font: 12,
  tevOrder: 13,
  tevColor: 14,
  kColor: 15,
  tevStageNum: 16,
  tevStage: 17,
  swapMode: 18,
  swapTable: 19,
  alphaComp: 20,
  blend: 21,
  dither: 22,
} as const;

// Material init data (0xE8 bytes): u8 flag, cull, color chan count, tex gen count, TEV stage count, dither, 2 bytes;
// u16 indices: mat color[2] @0x08, color chan[4] @0x0C, tex gen[8] @0x14, tex matrix[10] @0x24, texture[8] @0x38,
// font @0x48, konst color[4] @0x4A; u8 konst color sel[16] @0x52, konst alpha sel[16] @0x62; u16 TEV order[16] @0x72,
// TEV color[4] @0x92, TEV stage[16] @0x9A, swap mode[16] @0xBA, swap table[4] @0xDA, alpha compare @0xE2, blend @0xE4.
export const MATERIAL_INIT_SIZE = 0xe8;

function parseMaterials(bytes: Uint8Array, block: number): BloMaterial[] {
  const v = dataView(bytes);
  const count = v.getUint16(block + 8);
  const table = (index: number) => {
    const offset = v.getUint32(block + 0x0c + index * 4);
    return offset ? block + offset : 0;
  };
  const at = Object.fromEntries(Object.entries(MAT).map(([k, i]) => [k, table(i)])) as Record<keyof typeof MAT, number>;
  const names = parseNameTable(bytes, at.names);
  const u8 = (t: number, i: number) => v.getUint8(t + i);
  const idx = (m: number, off: number, n: number) => Array.from({ length: n }, (_, k) => v.getUint16(m + off + k * 2));

  const materials: BloMaterial[] = [];
  for (let i = 0; i < count; i++) {
    const m = at.init + v.getUint16(at.remap + i * 2) * MATERIAL_INIT_SIZE;
    const texGenNum = u8(at.texGenNum, u8(m, 3));
    const tevStageNum = u8(at.tevStageNum, u8(m, 4));
    const texGens = idx(m, 0x14, 8)
      .slice(0, texGenNum)
      .map((k) => {
        const e = at.texGen + k * 4;
        return { type: u8(e, 0), source: u8(e, 1), matrix: u8(e, 2) };
      });
    const texMatrices = idx(m, 0x24, 10).map((k) => (k === NONE ? null : texMatrix(v, at.texMtx + k * 0x24)));
    while (texMatrices.length && texMatrices.at(-1) === null) texMatrices.pop();
    const textures = idx(m, 0x38, 8).map((k) => (k === NONE ? null : v.getUint16(at.texture + k * 2)));
    while (textures.length && textures.at(-1) === null) textures.pop();
    const fontIndex = v.getUint16(m + 0x48);
    const tevOrders = idx(m, 0x72, 16)
      .slice(0, tevStageNum)
      .map((k) => {
        const e = at.tevOrder + k * 4;
        return { texCoord: u8(e, 0), texMap: u8(e, 1), channel: u8(e, 2) };
      });
    const tevStages = idx(m, 0x9a, 16)
      .slice(0, tevStageNum)
      .map((k) => tevStage(v, at.tevStage + k * 0x14));
    const swapModes = idx(m, 0xba, 16)
      .slice(0, tevStageNum)
      .map((k) => (k === NONE ? { ras: 0, tex: 0 } : { ras: u8(at.swapMode + k * 4, 0), tex: u8(at.swapMode + k * 4, 1) }));
    const swapTables = idx(m, 0xda, 4).map((k) => {
      const e = at.swapTable + (k === NONE ? 0 : k) * 4;
      return [u8(e, 0), u8(e, 1), u8(e, 2), u8(e, 3)] as [number, number, number, number];
    });
    const s10 = (e: number): Rgba => [v.getInt16(e), v.getInt16(e + 2), v.getInt16(e + 4), v.getInt16(e + 6)];
    const ac = at.alphaComp + v.getUint16(m + 0xe2) * 8;
    const bl = at.blend + v.getUint16(m + 0xe4) * 4;
    materials.push({
      name: names[i] ?? `material${i}`,
      flag: u8(m, 0),
      cullMode: v.getUint32(at.cull + u8(m, 1) * 4),
      colorChannels: idx(m, 0x0c, 4)
        .slice(0, u8(at.chanNum, u8(m, 2)) * 2)
        .map((k) => (k === NONE ? 0 : u8(at.chanInfo + k * 4, 1))),
      matColors: idx(m, 0x08, 2).map((k) => (k === NONE ? [255, 255, 255, 255] : rgba(v, at.matColor + k * 4))),
      texGens,
      texMatrices,
      textures,
      font: fontIndex === NONE || !at.font ? null : v.getUint16(at.font + fontIndex * 2),
      tevOrders,
      tevColors: idx(m, 0x92, 4).map((k) => (k === NONE ? [0, 0, 0, 0] : s10(at.tevColor + k * 8))),
      konstColors: idx(m, 0x4a, 4).map((k) => (k === NONE ? [255, 255, 255, 255] : rgba(v, at.kColor + k * 4))),
      kColorSels: Array.from(bytes.subarray(m + 0x52, m + 0x52 + tevStageNum)),
      kAlphaSels: Array.from(bytes.subarray(m + 0x62, m + 0x62 + tevStageNum)),
      tevStages,
      swapModes,
      swapTables,
      alphaCompare: { comp0: u8(ac, 0), ref0: u8(ac, 1), op: u8(ac, 2), comp1: u8(ac, 3), ref1: u8(ac, 4) },
      blend: { type: u8(bl, 0), source: u8(bl, 1), dest: u8(bl, 2), logicOp: u8(bl, 3) },
      dither: u8(at.dither, u8(m, 5)) !== 0,
      indirect: at.indirect ? indirectBlock(v, at.indirect + v.getUint16(at.remap + i * 2) * INDIRECT_SIZE, tevStageNum) : null,
    });
  }
  return materials;
}

// Indirect data (0x128 bytes per material, in remapped material order): u8 enabled, u8 stage count, 2 pad;
// 4 × (u8 tex coord, u8 tex map) orders; 3 × 0x1C matrices (f32 2×3 row-major, s8 scale exponent, 3 pad);
// 4 × (u8 scale s, u8 scale t); 16 × 0x0C TEV stages (u8 ind stage, format, bias, matrix, wrap s, wrap t, add prev,
// utc lod, alpha sel, 3 pad). J3D's MAT3 has the same blocks with orders and scales padded to 4 bytes (0x138).
export const INDIRECT_SIZE = 0x128;

function indirectBlock(v: DataView, o: number, tevStageNum: number): BloIndirect | null {
  if (v.getUint8(o) === 0) return null;
  const u8 = (at: number) => v.getUint8(o + at);
  const stages = Array.from({ length: Math.min(4, u8(1)) }, (_, k) => ({
    texCoord: u8(0x04 + k * 2),
    texMap: u8(0x05 + k * 2),
    scaleS: u8(0x60 + k * 2),
    scaleT: u8(0x61 + k * 2),
  }));
  const matrices = Array.from({ length: 3 }, (_, k): BloIndTexMatrix => {
    const e = o + 0x0c + k * 0x1c;
    const f = (n: number) => v.getFloat32(e + n * 4);
    return { matrix: [[f(0), f(1), f(2)], [f(3), f(4), f(5)]], scaleExp: v.getInt8(e + 0x18) };
  });
  const tevStages = Array.from({ length: tevStageNum }, (_, k): BloIndTevStage => {
    const e = 0x68 + k * 0x0c;
    return {
      indStage: u8(e),
      format: u8(e + 1),
      bias: u8(e + 2),
      matrix: u8(e + 3),
      wrapS: u8(e + 4),
      wrapT: u8(e + 5),
      addPrev: u8(e + 6) !== 0,
      utcLod: u8(e + 7) !== 0,
      alphaSel: u8(e + 8),
    };
  });
  return { stages, matrices, tevStages };
}

function texMatrix(v: DataView, e: number): BloTexMatrix {
  return {
    type: v.getUint8(e),
    info: v.getUint8(e + 1),
    center: [v.getFloat32(e + 4), v.getFloat32(e + 8), v.getFloat32(e + 12)],
    scaleX: v.getFloat32(e + 0x10),
    scaleY: v.getFloat32(e + 0x14),
    rotation: v.getFloat32(e + 0x18),
    translateX: v.getFloat32(e + 0x1c),
    translateY: v.getFloat32(e + 0x20),
  };
}

// TEV stage (0x14 bytes, as in J3D): pad, color a/b/c/d, op, bias, scale, clamp, reg, alpha a/b/c/d, op, bias, scale,
// clamp, reg, pad.
function tevStage(v: DataView, e: number): BloTevStage {
  const b = (i: number) => v.getUint8(e + i);
  return {
    colorIn: [b(1), b(2), b(3), b(4)],
    colorOp: b(5),
    colorBias: b(6),
    colorScale: b(7),
    colorClamp: b(8) !== 0,
    colorReg: b(9),
    alphaIn: [b(10), b(11), b(12), b(13)],
    alphaOp: b(14),
    alphaBias: b(15),
    alphaScale: b(16),
    alphaClamp: b(17) !== 0,
    alphaReg: b(18),
  };
}

// JUTNameTab: u16 count, u16 pad, then per entry u16 hash, u16 offset (from the table), zero-terminated names.
function parseNameTable(bytes: Uint8Array, o: number): string[] {
  if (!o) return [];
  const v = dataView(bytes);
  const count = v.getUint16(o);
  return Array.from({ length: count }, (_, i) => ascii(bytes, o + v.getUint16(o + 6 + i * 4)));
}
