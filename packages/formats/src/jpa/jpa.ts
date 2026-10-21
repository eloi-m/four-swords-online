// JPA particle effects ("JParticle", container version JPAC2-10, the Twilight Princess / Galaxy one): FSA keeps every
// effect in data.arc's particle.jpc. A container holds resources (one emitter each, made of BEM1 dynamics, BSP1 base
// shape, ESP1 extra shape, ETX1 extra texture, SSP1 child shape, FLD1 fields, KFA1 key curves and the TDB1 texture
// table), then TEX1 blocks (named BTI textures).
//
// Ported from noclip.website's src/Common/JSYSTEM/JPA.ts (MIT License, Copyright (c) 2017 Jasper St. Pierre,
// https://github.com/magcius/noclip.website): the block layouts and what each field means. Adapted: plain data objects,
// `as const` tables instead of enums, colors as RGBA in 0–1, angles in radians, JPAC2-10 only.
import { ascii, dataView } from "../bytes.ts";
import { decodeBti, parseBtiHeader, type BtiHeader, type DecodedTexture } from "../gx/bti.ts";

export type Vec3 = [number, number, number];
/** RGBA, each 0–1. */
export type JpaColor = [number, number, number, number];

/** Where the emitter spawns particles (BEM1 flags >> 8 & 7). */
export const JpaVolume = { CUBE: 0, SPHERE: 1, CYLINDER: 2, TORUS: 3, POINT: 4, CIRCLE: 5, LINE: 6 } as const;
/** BEM1 flags. */
export const JpaEmitFlag = { FIXED_DENSITY: 0x01, FIXED_INTERVAL: 0x02, INHERIT_SCALE: 0x04, FOLLOW_EMITTER: 0x08, FOLLOW_EMITTER_CHILD: 0x10 } as const;
/** How a particle quad is oriented. */
export const JpaShape = {
  POINT: 0,
  LINE: 1,
  BILLBOARD: 2,
  DIRECTION: 3,
  DIRECTION_CROSS: 4,
  STRIPE: 5,
  STRIPE_CROSS: 6,
  ROTATION: 7,
  ROTATION_CROSS: 8,
  DIR_BILLBOARD: 9,
  Y_BILLBOARD: 10,
} as const;
/** What a directional shape points along. */
export const JpaDir = { VEL: 0, POS: 1, POS_INV: 2, EMITTER_DIR: 3, PREV_PARTICLE: 4 } as const;
export const JpaRot = { Y: 0, X: 1, Z: 2, XYZ: 3, Y_JIGGLE: 4 } as const;
export const JpaPlane = { XY: 0, XZ: 1, X: 2 } as const;
/** How an animation table index follows the particle's age. */
export const JpaCalcIdx = { NORMAL: 0, REPEAT: 1, REVERSE: 2, MERGE: 3, RANDOM: 4 } as const;
export const JpaScaleAnm = { NORMAL: 0, REPEAT: 1, REVERSE: 2 } as const;
export const JpaIndTexMode = { OFF: 0, NORMAL: 1, SUB: 2 } as const;
export const JpaField = { GRAVITY: 0, AIR: 1, MAGNET: 2, NEWTON: 3, VORTEX: 4, RANDOM: 5, DRAG: 6, CONVECTION: 7, SPIN: 8 } as const;
/** What a field adds its force to. */
export const JpaFieldAdd = { FIELD_ACCEL: 0, BASE_VELOCITY: 1, FIELD_VELOCITY: 2 } as const;
/** FLD1 status flags (flags >> 16). */
export const JpaFieldFlag = { LOCAL_SPACE: 0x02, AIR_DRAG: 0x04, FADE_USE_EN_TIME: 0x08, FADE_USE_DIS_TIME: 0x10, FADE_USE_FADE_IN: 0x20, FADE_USE_FADE_OUT: 0x40, FADE_MASK: 0x78 } as const;
/** Which emitter parameter a KFA1 curve drives. */
export const JpaKeyType = {
  RATE: 0,
  VOLUME_SIZE: 1,
  VOLUME_SWEEP: 2,
  VOLUME_MIN_RAD: 3,
  LIFE_TIME: 4,
  MOMENT: 5,
  INITIAL_VEL_OMNI: 6,
  INITIAL_VEL_AXIS: 7,
  INITIAL_VEL_DIR: 8,
  SPREAD: 9,
  SCALE: 10,
} as const;

/** BEM1: the emitter and how particles move. */
export interface JpaDynamics {
  flags: number;
  /** BEM1 +0x0C, for the game (FSA: bit 0 = its emitter callback, bit 1 = draw group 1). */
  userFlags: number;
  volumeType: number;
  emitterScale: Vec3;
  /** Radians, applied X then Y then Z. */
  emitterRotation: Vec3;
  emitterTranslation: Vec3;
  /** Normalized. */
  emitterDirection: Vec3;
  initialVelOmni: number;
  initialVelAxis: number;
  initialVelRandom: number;
  initialVelDir: number;
  spread: number;
  initialVelRatio: number;
  rate: number;
  rateRandom: number;
  lifeTimeRandom: number;
  volumeSweep: number;
  volumeMinRad: number;
  airResist: number;
  momentRandom: number;
  /** Frames the emitter emits for (0 = forever). */
  maxFrame: number;
  /** Frames before the emitter starts. */
  startFrame: number;
  lifeTime: number;
  volumeSize: number;
  divNumber: number;
  /** Emits every rateStep + 1 frames. */
  rateStep: number;
}

/** BSP1: how base particles are drawn (shape, TEV inputs, blending, texture and color animation). */
export interface JpaBaseShape {
  shapeType: number;
  dirType: number;
  rotType: number;
  planeType: number;
  baseSize: [number, number];
  tilingS: number;
  tilingT: number;
  isDrawForwardAhead: boolean;
  isDrawParentAhead: boolean;
  isNoDrawParent: boolean;
  isNoDrawChild: boolean;
  /** TEV stage 0 color inputs, an index into the fixed table of JPA (see jpaTevColorIn). */
  colorInSelect: number;
  alphaInSelect: number;
  /** GX blend: mode bits 0-1, source factor bits 2-5, destination factor bits 6-9 (indices of JPA's table). */
  blendModeFlags: number;
  /** Alpha compare: op A bits 0-2, logic op bits 3-4, op B bits 5-7. */
  alphaCompareFlags: number;
  alphaRef0: number;
  alphaRef1: number;
  /** Z mode: test bit 0, compare bits 1-3, update bit 4. */
  zModeFlags: number;
  anmRandom: number;
  isGlobalTexAnm: boolean;
  texCalcIdxType: number;
  /** The texture slot (TDB1 index) when there's no texture animation. */
  texIdx: number;
  /** Texture slots per frame, or null. */
  texIdxAnimData: Uint8Array | null;
  texIdxLoopOfsMask: number;
  isEnableProjection: boolean;
  isEnableTexScrollAnm: boolean;
  texInitTransX: number;
  texInitTransY: number;
  texInitScaleX: number;
  texInitScaleY: number;
  texInitRot: number;
  texIncTransX: number;
  texIncTransY: number;
  texIncScaleX: number;
  texIncScaleY: number;
  texIncRot: number;
  isGlobalColorAnm: boolean;
  colorCalcIdxType: number;
  colorPrm: JpaColor;
  colorEnv: JpaColor;
  /** One color per frame 0…colorAnimMaxFrame (keys interpolated), or null. */
  colorPrmAnimData: JpaColor[] | null;
  colorEnvAnimData: JpaColor[] | null;
  colorAnimMaxFrame: number;
  colorLoopOfsMask: number;
}

/** ESP1: scale, alpha and rotation over a particle's life. */
export interface JpaExtraShape {
  isEnableScale: boolean;
  isDiffXY: boolean;
  scaleAnmTypeX: number;
  scaleAnmTypeY: number;
  isEnableRotate: boolean;
  isEnableAlpha: boolean;
  isEnableSinWave: boolean;
  pivotX: number;
  pivotY: number;
  scaleInTiming: number;
  scaleOutTiming: number;
  scaleInValueX: number;
  scaleOutValueX: number;
  scaleInValueY: number;
  scaleOutValueY: number;
  scaleOutRandom: number;
  scaleAnmMaxFrameX: number;
  scaleAnmMaxFrameY: number;
  scaleIncreaseRateX: number;
  scaleIncreaseRateY: number;
  scaleDecreaseRateX: number;
  scaleDecreaseRateY: number;
  alphaInTiming: number;
  alphaOutTiming: number;
  alphaInValue: number;
  alphaBaseValue: number;
  alphaOutValue: number;
  alphaIncreaseRate: number;
  alphaDecreaseRate: number;
  alphaWaveFrequency: number;
  alphaWaveRandom: number;
  alphaWaveAmplitude: number;
  /** Radians. */
  rotateAngle: number;
  rotateAngleRandom: number;
  /** Radians per frame. */
  rotateSpeed: number;
  rotateSpeedRandom: number;
  rotateDirection: number;
}

/** ETX1: an indirect texture and a second texture. */
export interface JpaExTex {
  indTextureMode: number;
  /** 2×4 indirect matrix rows (the scale exponent applied; [3] of the first row holds the scale). */
  indTextureMatrix: Float32Array;
  indTextureId: number;
  /** Texture slot of the second texture, or −1. */
  secondTextureIndex: number;
}

/** SSP1: the child particles base particles spawn. */
export interface JpaChildShape {
  shapeType: number;
  dirType: number;
  rotType: number;
  planeType: number;
  isInheritedScale: boolean;
  isInheritedAlpha: boolean;
  isInheritedRGB: boolean;
  isEnableField: boolean;
  isEnableScaleOut: boolean;
  isEnableAlphaOut: boolean;
  isEnableRotate: boolean;
  posRandom: number;
  baseVel: number;
  baseVelRandom: number;
  velInfRate: number;
  gravity: number;
  globalScale2D: [number, number];
  inheritScale: number;
  inheritAlpha: number;
  inheritRGB: number;
  colorPrm: JpaColor;
  colorEnv: JpaColor;
  /** Fraction of the parent's life after which it spawns children. */
  timing: number;
  life: number;
  rate: number;
  step: number;
  texIdx: number;
  /** Radians per frame. */
  rotateSpeed: number;
}

/** FLD1: a force acting on particles. */
export interface JpaFieldBlock {
  type: number;
  addType: number;
  statusFlags: number;
  position: Vec3;
  direction: Vec3;
  /** Gravity, air, magnet, Newton, random, drag, convection. */
  magnitude: number;
  /** Air: the speed cap; Newton: the squared reference distance; convection: the radius. */
  refDistance: number;
  /** Vortex and spin. */
  innerSpeed: number;
  outerSpeed: number;
  fadeIn: number;
  fadeOut: number;
  enTime: number;
  disTime: number;
  cycle: number;
  fadeInRate: number;
  fadeOutRate: number;
}

/** KFA1: a Hermite curve over the emitter's age driving one parameter. */
export interface JpaKeyBlock {
  keyType: number;
  /** Four floats per key: frame, value, tangent in, tangent out. */
  keyValues: Float32Array;
  isLoopEnable: boolean;
}

export interface JpaResource {
  /** The effect ID the game asks for. */
  id: number;
  dynamics: JpaDynamics;
  baseShape: JpaBaseShape;
  extraShape: JpaExtraShape | null;
  exTex: JpaExTex | null;
  childShape: JpaChildShape | null;
  fields: JpaFieldBlock[];
  keys: JpaKeyBlock[];
  /** TDB1: the resource's texture slots → container texture indices. */
  textureIds: number[];
}

export interface JpaTexture {
  name: string;
  header: BtiHeader;
  /** The BTI (header + data; its offsets are relative to the header). */
  bti: Uint8Array;
}

export interface Jpac {
  version: string;
  resources: JpaResource[];
  textures: JpaTexture[];
}

export function isJpac(bytes: Uint8Array): boolean {
  return ascii(bytes, 0, 8) === "JPAC2-10";
}

/** Parses a JPAC2-10 container. */
export function parseJpac(bytes: Uint8Array): Jpac {
  const version = ascii(bytes, 0, 8);
  if (version !== "JPAC2-10") throw new Error(`not a JPAC2-10 container: ${version}`);
  const view = dataView(bytes);
  const resourceCount = view.getUint16(0x08);
  const textureCount = view.getUint16(0x0a);
  const textureOffset = view.getUint32(0x0c);
  const resources: JpaResource[] = [];
  let offset = 0x10;
  for (let i = 0; i < resourceCount; i++) {
    const start = offset;
    const blockCount = view.getUint16(offset + 0x02);
    offset += 0x08;
    for (let b = 0; b < blockCount; b++) offset += view.getUint32(offset + 0x04);
    resources.push(parseResource(bytes.subarray(start, offset)));
  }
  const textures: JpaTexture[] = [];
  offset = textureOffset;
  for (let i = 0; i < textureCount; i++) {
    if (ascii(bytes, offset, 4) !== "TEX1") throw new Error(`TEX1 expected at 0x${offset.toString(16)}`);
    const size = view.getUint32(offset + 0x04);
    const bti = bytes.subarray(offset + 0x20, offset + size);
    textures.push({ name: ascii(bytes, offset + 0x0c, 0x14), header: parseBtiHeader(bti), bti });
    offset += size;
  }
  return { version, resources, textures };
}

/** Decodes a container texture to RGBA8. */
export function decodeJpaTexture(texture: JpaTexture): DecodedTexture {
  return decodeBti(texture.bti);
}

const TURN = Math.PI * 2;
const DEG = Math.PI / 180;
const rgba8 = (v: number): JpaColor => [(v >>> 24) / 255, ((v >>> 16) & 0xff) / 255, ((v >>> 8) & 0xff) / 255, (v & 0xff) / 255];
const vec3 = (view: DataView, at: number): Vec3 => [view.getFloat32(at), view.getFloat32(at + 4), view.getFloat32(at + 8)];

/** Bakes a color key table (u16 frame, u32 RGBA8 per key) into one color per frame 0…duration. */
function colorTable(view: DataView, at: number, count: number, duration: number): JpaColor[] {
  const keys = Array.from({ length: count }, (_, i) => ({ frame: view.getUint16(at + i * 6), color: rgba8(view.getUint32(at + i * 6 + 2)) }));
  const out: JpaColor[] = [];
  for (let f = 0; f <= duration; f++) {
    let k = 0;
    while (k + 1 < keys.length && keys[k + 1]!.frame <= f) k++;
    const a = keys[k]!, b = keys[k + 1];
    if (!b || f <= a.frame) out.push([...a.color]);
    else {
      const t = (f - a.frame) / (b.frame - a.frame);
      out.push(a.color.map((c, i) => c + (b.color[i]! - c) * t) as JpaColor);
    }
  }
  return out;
}

function parseDynamics(view: DataView, o: number): JpaDynamics {
  const flags = view.getUint32(o + 0x08);
  const d = vec3(view, o + 0x28);
  const len = Math.hypot(...d) || 1;
  return {
    flags,
    userFlags: view.getUint32(o + 0x0c),
    volumeType: (flags >>> 8) & 0x07,
    emitterScale: vec3(view, o + 0x10),
    emitterTranslation: vec3(view, o + 0x1c),
    emitterDirection: [d[0] / len, d[1] / len, d[2] / len],
    initialVelOmni: view.getFloat32(o + 0x34),
    initialVelAxis: view.getFloat32(o + 0x38),
    initialVelRandom: view.getFloat32(o + 0x3c),
    initialVelDir: view.getFloat32(o + 0x40),
    spread: view.getFloat32(o + 0x44),
    initialVelRatio: view.getFloat32(o + 0x48),
    rate: view.getFloat32(o + 0x4c),
    rateRandom: view.getFloat32(o + 0x50),
    lifeTimeRandom: view.getFloat32(o + 0x54),
    volumeSweep: view.getFloat32(o + 0x58),
    volumeMinRad: view.getFloat32(o + 0x5c),
    airResist: view.getFloat32(o + 0x60),
    momentRandom: view.getFloat32(o + 0x64),
    emitterRotation: [view.getInt16(o + 0x68) * DEG, view.getInt16(o + 0x6a) * DEG, view.getInt16(o + 0x6c) * DEG],
    maxFrame: view.getInt16(o + 0x6e),
    startFrame: view.getInt16(o + 0x70),
    lifeTime: view.getInt16(o + 0x72),
    volumeSize: view.getInt16(o + 0x74),
    divNumber: view.getInt16(o + 0x76),
    rateStep: view.getUint8(o + 0x78),
  };
}

function parseBaseShape(bytes: Uint8Array, view: DataView, o: number): JpaBaseShape {
  const flags = view.getUint32(o + 0x08);
  const shapeType = flags & 0x0f;
  const texFlags = view.getUint8(o + 0x1e);
  const texIdxAnimCount = view.getUint8(o + 0x1f);
  const colorFlags = view.getUint8(o + 0x21);
  const colorAnimMaxFrame = view.getUint16(o + 0x24);
  const isEnableTexScrollAnm = ((flags >>> 24) & 1) !== 0;
  let extra = o + 0x34;
  const scroll = isEnableTexScrollAnm ? Array.from({ length: 10 }, (_, i) => view.getFloat32(extra + i * 4)) : new Array<number>(10).fill(0);
  if (isEnableTexScrollAnm) extra += 0x28;
  const texIdxAnimData = texFlags & 1 ? bytes.slice(extra, extra + texIdxAnimCount) : null;
  const colorPrmAnimData = (colorFlags >>> 1) & 1 ? colorTable(view, o + view.getUint16(o + 0x0c), view.getUint8(o + 0x22), colorAnimMaxFrame) : null;
  const colorEnvAnimData = (colorFlags >>> 3) & 1 ? colorTable(view, o + view.getUint16(o + 0x0e), view.getUint8(o + 0x23), colorAnimMaxFrame) : null;
  const cross = shapeType === JpaShape.DIRECTION_CROSS || shapeType === JpaShape.ROTATION_CROSS;
  return {
    shapeType,
    dirType: (flags >>> 4) & 0x07,
    rotType: (flags >>> 7) & 0x07,
    planeType: cross ? JpaPlane.X : (flags >>> 10) & 0x01,
    isGlobalColorAnm: ((flags >>> 12) & 1) !== 0,
    isGlobalTexAnm: ((flags >>> 14) & 1) !== 0,
    colorInSelect: (flags >>> 15) & 0x07,
    alphaInSelect: (flags >>> 18) & 0x01,
    isEnableProjection: ((flags >>> 20) & 1) !== 0,
    isDrawForwardAhead: ((flags >>> 21) & 1) !== 0,
    isDrawParentAhead: ((flags >>> 22) & 1) !== 0,
    isEnableTexScrollAnm,
    tilingS: (flags >>> 25) & 1 ? 2 : 1,
    tilingT: (flags >>> 26) & 1 ? 2 : 1,
    isNoDrawParent: ((flags >>> 27) & 1) !== 0,
    isNoDrawChild: ((flags >>> 28) & 1) !== 0,
    baseSize: [view.getFloat32(o + 0x10), view.getFloat32(o + 0x14)],
    blendModeFlags: view.getUint16(o + 0x18),
    alphaCompareFlags: view.getUint8(o + 0x1a),
    alphaRef0: view.getUint8(o + 0x1b),
    alphaRef1: view.getUint8(o + 0x1c),
    zModeFlags: view.getUint8(o + 0x1d),
    texCalcIdxType: (texFlags >>> 2) & 0x07,
    texIdx: view.getUint8(o + 0x20),
    texIdxAnimData,
    colorCalcIdxType: (colorFlags >>> 4) & 0x07,
    colorPrm: rgba8(view.getUint32(o + 0x26)),
    colorEnv: rgba8(view.getUint32(o + 0x2a)),
    colorPrmAnimData,
    colorEnvAnimData,
    colorAnimMaxFrame,
    anmRandom: view.getUint8(o + 0x2e),
    colorLoopOfsMask: view.getUint8(o + 0x2f),
    texIdxLoopOfsMask: view.getUint8(o + 0x30),
    texInitTransX: scroll[0]!,
    texInitTransY: scroll[1]!,
    texInitScaleX: scroll[2]!,
    texInitScaleY: scroll[3]!,
    texInitRot: scroll[4]!,
    texIncTransX: scroll[5]!,
    texIncTransY: scroll[6]!,
    texIncScaleX: scroll[7]!,
    texIncScaleY: scroll[8]!,
    texIncRot: scroll[9]!,
  };
}

function parseExtraShape(view: DataView, o: number): JpaExtraShape {
  const flags = view.getUint32(o + 0x08);
  const f = (at: number) => view.getFloat32(o + at);
  const scaleInTiming = f(0x0c), scaleOutTiming = f(0x10);
  const scaleInValueX = f(0x14), scaleOutValueX = f(0x18), scaleInValueY = f(0x1c), scaleOutValueY = f(0x20);
  const alphaInTiming = f(0x2c), alphaOutTiming = f(0x30);
  const alphaInValue = f(0x34), alphaBaseValue = f(0x38), alphaOutValue = f(0x3c);
  return {
    isEnableScale: (flags & 1) !== 0,
    isDiffXY: ((flags >>> 1) & 1) !== 0,
    scaleAnmTypeX: (flags >>> 8) & 0x03,
    scaleAnmTypeY: (flags >>> 10) & 0x03,
    pivotX: (flags >>> 12) & 0x03,
    pivotY: (flags >>> 14) & 0x03,
    isEnableAlpha: ((flags >>> 16) & 1) !== 0,
    isEnableSinWave: ((flags >>> 17) & 1) !== 0,
    isEnableRotate: ((flags >>> 24) & 1) !== 0,
    scaleInTiming,
    scaleOutTiming,
    scaleInValueX,
    scaleOutValueX,
    scaleInValueY,
    scaleOutValueY,
    scaleOutRandom: f(0x24),
    scaleAnmMaxFrameX: view.getUint16(o + 0x28),
    scaleAnmMaxFrameY: view.getUint16(o + 0x2a),
    scaleIncreaseRateX: scaleInTiming > 0 ? (1 - scaleInValueX) / scaleInTiming : 1,
    scaleIncreaseRateY: scaleInTiming > 0 ? (1 - scaleInValueY) / scaleInTiming : 1,
    scaleDecreaseRateX: scaleOutTiming < 1 ? (scaleOutValueX - 1) / (1 - scaleOutTiming) : 1,
    scaleDecreaseRateY: scaleOutTiming < 1 ? (scaleOutValueY - 1) / (1 - scaleOutTiming) : 1,
    alphaInTiming,
    alphaOutTiming,
    alphaInValue,
    alphaBaseValue,
    alphaOutValue,
    alphaIncreaseRate: alphaInTiming > 0 ? (alphaBaseValue - alphaInValue) / alphaInTiming : 1,
    alphaDecreaseRate: alphaOutTiming < 1 ? (alphaOutValue - alphaBaseValue) / (1 - alphaOutTiming) : 1,
    alphaWaveFrequency: f(0x40),
    alphaWaveRandom: f(0x44),
    alphaWaveAmplitude: f(0x48),
    rotateAngle: (f(0x4c) * TURN) / 0xffff,
    rotateAngleRandom: (f(0x50) * TURN) / 0xffff,
    rotateSpeed: (f(0x54) * TURN) / 0xffff,
    rotateSpeedRandom: f(0x58),
    rotateDirection: f(0x5c),
  };
}

function parseChildShape(view: DataView, o: number): JpaChildShape {
  const flags = view.getUint32(o + 0x08);
  const shapeType = flags & 0x0f;
  const cross = shapeType === JpaShape.DIRECTION_CROSS || shapeType === JpaShape.ROTATION_CROSS;
  const f = (at: number) => view.getFloat32(o + at);
  return {
    shapeType,
    dirType: (flags >>> 4) & 0x07,
    rotType: (flags >>> 7) & 0x07,
    planeType: cross ? JpaPlane.X : (flags >>> 10) & 0x01,
    isInheritedScale: ((flags >>> 16) & 1) !== 0,
    isInheritedAlpha: ((flags >>> 17) & 1) !== 0,
    isInheritedRGB: ((flags >>> 18) & 1) !== 0,
    isEnableField: ((flags >>> 21) & 1) !== 0,
    isEnableScaleOut: ((flags >>> 22) & 1) !== 0,
    isEnableAlphaOut: ((flags >>> 23) & 1) !== 0,
    isEnableRotate: ((flags >>> 24) & 1) !== 0,
    posRandom: f(0x0c),
    baseVel: f(0x10),
    baseVelRandom: f(0x14),
    velInfRate: f(0x18),
    gravity: f(0x1c),
    globalScale2D: [f(0x20), f(0x24)],
    inheritScale: f(0x28),
    inheritAlpha: f(0x2c),
    inheritRGB: f(0x30),
    colorPrm: rgba8(view.getUint32(o + 0x34)),
    colorEnv: rgba8(view.getUint32(o + 0x38)),
    timing: f(0x3c),
    life: view.getUint16(o + 0x40),
    rate: view.getUint16(o + 0x42),
    step: view.getUint8(o + 0x44),
    texIdx: view.getUint8(o + 0x45),
    // An angle step in 0x10000-per-turn units, like ESP1's.
    rotateSpeed: (view.getUint16(o + 0x46) * TURN) / 0x10000,
  };
}

function parseExTex(view: DataView, o: number): JpaExTex {
  const flags = view.getUint32(o + 0x08);
  const scale = 2 ** view.getInt8(o + 0x24);
  const p = Array.from({ length: 6 }, (_, i) => view.getFloat32(o + 0x0c + i * 4) * scale);
  return {
    indTextureMode: flags & 0x01,
    indTextureMatrix: new Float32Array([p[0]!, p[1]!, p[2]!, scale, p[3]!, p[4]!, p[5]!, 0]),
    indTextureId: view.getUint8(o + 0x25),
    secondTextureIndex: (flags >>> 8) & 1 ? view.getUint8(o + 0x26) : -1,
  };
}

function parseField(view: DataView, o: number): JpaFieldBlock {
  const flags = view.getUint32(o + 0x08);
  const type = flags & 0x0f;
  const f = (at: number) => view.getFloat32(o + at);
  const param1 = f(0x24), param2 = f(0x28), param3 = f(0x2c);
  const fadeIn = f(0x30), fadeOut = f(0x34), enTime = f(0x38), disTime = f(0x3c);
  const usesMagnitude = type !== JpaField.VORTEX && type !== JpaField.SPIN;
  return {
    type,
    addType: (flags >>> 8) & 0x03,
    statusFlags: flags >>> 16,
    position: vec3(view, o + 0x0c),
    direction: vec3(view, o + 0x18),
    magnitude: usesMagnitude ? param1 : 0,
    refDistance: type === JpaField.NEWTON ? param3 ** 2 : type === JpaField.AIR ? param2 : type === JpaField.CONVECTION ? param3 : -1,
    innerSpeed: type === JpaField.VORTEX || type === JpaField.SPIN ? param1 : -1,
    outerSpeed: type === JpaField.VORTEX ? param2 : -1,
    fadeIn,
    fadeOut,
    enTime,
    disTime,
    cycle: view.getUint8(o + 0x40),
    fadeInRate: fadeIn > enTime ? 1 / (fadeIn - enTime) : 1,
    fadeOutRate: fadeOut < disTime ? 1 / (disTime - fadeOut) : 1,
  };
}

function parseResource(bytes: Uint8Array): JpaResource {
  const view = dataView(bytes);
  const id = view.getUint16(0x00);
  const blockCount = view.getUint16(0x02);
  const fieldCount = view.getUint8(0x04);
  const keyCount = view.getUint8(0x05);
  const textureCount = view.getUint8(0x06);
  let dynamics: JpaDynamics | null = null;
  let baseShape: JpaBaseShape | null = null;
  let extraShape: JpaExtraShape | null = null;
  let exTex: JpaExTex | null = null;
  let childShape: JpaChildShape | null = null;
  const fields: JpaFieldBlock[] = [];
  const keys: JpaKeyBlock[] = [];
  let textureIds: number[] | null = null;
  let o = 0x08;
  for (let b = 0; b < blockCount; b++) {
    const tag = ascii(bytes, o, 4);
    const size = view.getUint32(o + 0x04);
    switch (tag) {
      case "BEM1":
        dynamics = parseDynamics(view, o);
        break;
      case "BSP1":
        baseShape = parseBaseShape(bytes, view, o);
        break;
      case "ESP1":
        extraShape = parseExtraShape(view, o);
        break;
      case "SSP1":
        childShape = parseChildShape(view, o);
        break;
      case "ETX1":
        exTex = parseExTex(view, o);
        break;
      case "FLD1":
        fields.push(parseField(view, o));
        break;
      case "KFA1": {
        const count = view.getUint8(o + 0x09);
        keys.push({
          keyType: view.getUint8(o + 0x08),
          isLoopEnable: view.getUint8(o + 0x0b) !== 0,
          keyValues: Float32Array.from({ length: count * 4 }, (_, i) => view.getFloat32(o + 0x0c + i * 4)),
        });
        break;
      }
      case "TDB1":
        textureIds = Array.from({ length: textureCount }, (_, i) => view.getUint16(o + 0x08 + i * 2));
        break;
      default:
        throw new Error(`resource ${id}: unknown block ${tag}`);
    }
    o += size;
  }
  if (!dynamics || !baseShape || !textureIds) throw new Error(`resource ${id}: BEM1, BSP1 or TDB1 missing`);
  if (fields.length !== fieldCount || keys.length !== keyCount) throw new Error(`resource ${id}: block counts disagree`);
  return { id, dynamics, baseShape, extraShape, exTex, childShape, fields, keys, textureIds };
}

/** The TEV stage-0 color inputs (a, b, c, d) per BSP1 colorInSelect, by name: out = d + mix(a, b, c). */
export const JPA_TEV_COLOR_IN = [
  ["zero", "texc", "one", "zero"],
  ["zero", "c0", "texc", "zero"],
  ["c0", "one", "texc", "zero"],
  ["c1", "c0", "texc", "zero"],
  ["zero", "texc", "c0", "c1"],
  ["zero", "zero", "zero", "c0"],
] as const;
/** The TEV stage-0 alpha inputs per BSP1 alphaInSelect. */
export const JPA_TEV_ALPHA_IN = [
  ["zero", "texa", "a0", "zero"],
  ["zero", "zero", "zero", "a0"],
] as const;
/** BSP1 blend factor indices → GX blend factors (GxBlendFactor values). */
export const JPA_BLEND_FACTOR = [0, 1, 2, 3, 2, 3, 4, 5, 6, 7] as const;
/** BSP1 blend mode indices → GxBlendMode (none, blend, logic). */
export const JPA_BLEND_MODE = [0, 1, 2] as const;
/**
 * BSP1 alpha compare and Z compare indices → GxCompare values. JPA's order is never, less, lequal, equal, nequal,
 * gequal, greater, always (GX's: never, less, equal, lequal, greater, nequal, gequal, always). Its alpha logic ops
 * (and, or, xor, xnor) are GxAlphaOp's order.
 */
export const JPA_COMPARE = [0, 1, 3, 2, 5, 6, 4, 7] as const;
