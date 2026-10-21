// Draws JPA particles with three.js: one instanced quad mesh per resource part (base or child particles), shared by
// every emitter of that resource, so a frame costs a draw call per effect kind, not per emitter or particle. Each
// instance carries its quad's matrix, texture matrix, colors and texture layer (texture animation frames are the
// layers of one array texture). The fragment shader is JPA's fixed TEV setup: stage 0's color and alpha inputs from
// BSP1, an optional second texture (ETX1) multiplied in, an optional indirect texture offsetting the coordinates, the
// alpha compare; blending and the Z mode are the material's. Stripes are rebuilt as triangles each frame.
// The screen-distortion effects (projected, BEM1 user flag 1: heat haze, ripples) draw a copy of the frame instead of
// their first texture (the game's "AK_kagerouSwap00" stand-in), at their own place on screen, shifted by their
// indirect texture and cut out by their second (the mask): their meshes are in `distortion`, drawn by the caller after
// it copied the frame into `frame` (only while one shows: `distorting`).
//
// Scene convention: particles are simulated in the game's world (FSA: x right, y down, z up, in pixels) and drawn
// through the game's view matrix (`FSA_VIEW`: view x = x, view y = y − z, view z = y), then `mapping` turns view space
// into the scene: x → x − origin.x, y → −(y − origin.y) (the TV's projection flips y, so billboards come out the way
// the game shows them), z → zBase + view z × zScale (the depth the game sorts by: bigger y in front).
//
// TEV and material setup after noclip.website's src/Common/JSYSTEM/JPA.ts (JPAResourceData.createMaterial) (MIT
// License, Copyright (c) 2017 Jasper St. Pierre, https://github.com/magcius/noclip.website).
import {
  decodeJpaTexture,
  GxAlphaOp,
  GxBlendMode,
  GxCompare,
  GxTexFilter,
  JPA_BLEND_FACTOR,
  JPA_BLEND_MODE,
  JPA_COMPARE,
  JPA_TEV_ALPHA_IN,
  JPA_TEV_COLOR_IN,
  JpaIndTexMode,
  type DecodedTexture,
  type Jpac,
  type JpaResource,
  type JpaTexture,
} from "@fso/formats";
import * as THREE from "three";
import { blendFactor, DEPTH_FUNC, wrapMode } from "../j3d/model.ts";
import { isCross, isStripe, JpaDrawContext, shapeDrawn, type JpaCamera, type JpaEmitter, type JpaParticle } from "./emitter.ts";
import { m4identity, type M4 } from "./math.ts";

/** FSA's TV view matrix without the camera's translation (column-major): view = (x, y − z, y). */
export const FSA_VIEW: M4 = (() => {
  const m = m4identity(new Float64Array(16));
  m[6] = 1; // view z += y
  m[9] = -1; // view y −= z
  m[10] = 0;
  return m;
})();

export interface JpaSceneMapping {
  origin?: { x: number; y: number };
  /** Scene z = zBase + view z × zScale. */
  zBase: number;
  zScale: number;
}

const STRIDE = 28; // floats per instance: 3 matrix rows, 2 texture rows, prm, env, layer, pad

const VERTEX_INSTANCED = /* glsl */ `
in vec4 iRow0;
in vec4 iRow1;
in vec4 iRow2;
in vec3 iTexS;
in vec3 iTexT;
in vec4 iPrm;
in vec4 iEnv;
in float iLayer;
out vec2 vUv;
out vec2 vUvRaw;
flat out vec4 vPrm;
flat out vec4 vEnv;
flat out float vLayer;
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 scene = vec3(dot(iRow0, p), dot(iRow1, p), dot(iRow2, p));
  vec3 st = vec3(uv, 1.0);
  vUv = vec2(dot(iTexS, st), dot(iTexT, st));
  vUvRaw = uv;
  vPrm = iPrm;
  vEnv = iEnv;
  vLayer = iLayer;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(scene, 1.0);
}
`;

const VERTEX_STRIPE = /* glsl */ `
in vec2 aUvRaw;
in vec4 aPrm;
in vec4 aEnv;
in float aLayer;
out vec2 vUv;
out vec2 vUvRaw;
flat out vec4 vPrm;
flat out vec4 vEnv;
flat out float vLayer;
void main() {
  vUv = uv;
  vUvRaw = aUvRaw;
  vPrm = aPrm;
  vEnv = aEnv;
  vLayer = aLayer;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const COLOR_IN: Record<string, string> = { zero: "vec3(0.0)", one: "vec3(1.0)", texc: "t.rgb", c0: "vPrm.rgb", c1: "vEnv.rgb" };
const ALPHA_IN: Record<string, string> = { zero: "0.0", texa: "t.a", a0: "vPrm.a" };

function compare(op: number, ref: number): string {
  const r = (ref / 255).toFixed(6);
  switch (op) {
    case GxCompare.NEVER:
      return "false";
    case GxCompare.LESS:
      return `a < ${r}`;
    case GxCompare.EQUAL:
      return `abs(a - ${r}) < 0.002`;
    case GxCompare.LEQUAL:
      return `a <= ${r}`;
    case GxCompare.GREATER:
      return `a > ${r}`;
    case GxCompare.NEQUAL:
      return `abs(a - ${r}) >= 0.002`;
    case GxCompare.GEQUAL:
      return `a >= ${r}`;
    default:
      return "true";
  }
}

interface ShaderKey {
  colorIn: number;
  alphaIn: number;
  alphaCompare: number;
  ref0: number;
  ref1: number;
  second: boolean;
  indirect: boolean;
  /** Sample the frame's copy at the fragment's place on screen (the distortion effects). */
  frame?: boolean;
}

/** The frame copy's size in the game (the TV's EFB), the unit of a distortion's indirect offsets. */
const FRAME_SIZE = "vec2(608.0, 448.0)";

function fragmentShader(k: ShaderKey): string {
  const [ca, cb, cc, cd] = JPA_TEV_COLOR_IN[k.colorIn] ?? JPA_TEV_COLOR_IN[0];
  const [aa, ab, ac, ad] = JPA_TEV_ALPHA_IN[k.alphaIn] ?? JPA_TEV_ALPHA_IN[0];
  const opA = JPA_COMPARE[k.alphaCompare & 7]!, logic = (k.alphaCompare >> 3) & 3, opB = JPA_COMPARE[(k.alphaCompare >> 5) & 7]!;
  const always = (logic === GxAlphaOp.OR && (opA === GxCompare.ALWAYS || opB === GxCompare.ALWAYS)) || (logic === GxAlphaOp.AND && opA === GxCompare.ALWAYS && opB === GxCompare.ALWAYS);
  const join = ["tA && tB", "tA || tB", "tA != tB", "tA == tB"][logic]!;
  return /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uTex;
uniform vec2 uTexSize;
uniform sampler2D uTex2;
uniform sampler2D uInd;
uniform vec4 uIndMtx[2];
uniform sampler2D uFrame;
uniform vec4 uViewport;
in vec2 vUv;
in vec2 vUvRaw;
flat in vec4 vPrm;
flat in vec4 vEnv;
flat in float vLayer;
layout(location = 0) out vec4 fragColor;
void main() {
  vec2 uv = vUv;
${k.frame ? `  // (GX's t grows down the screen, GL's up.)
  uv = (gl_FragCoord.xy - uViewport.xy) / uViewport.zw;
${k.indirect ? `  vec3 ind = 255.0 * texture(uInd, vUvRaw).abg - 128.0;
  uv += vec2(dot(uIndMtx[0].xyz, ind), -dot(uIndMtx[1].xyz, ind)) / ${FRAME_SIZE};` : ""}
  vec4 t = texture(uFrame, uv);` : `${k.indirect ? `  vec3 ind = 255.0 * texture(uInd, vUvRaw).abg - 128.0;
  uv += vec2(dot(uIndMtx[0].xyz, ind), dot(uIndMtx[1].xyz, ind)) / uTexSize;` : ""}
  vec4 t = texture(uTex, vec3(uv, vLayer));`}
  vec3 color = clamp(${COLOR_IN[cd]} + mix(${COLOR_IN[ca]}, ${COLOR_IN[cb]}, ${COLOR_IN[cc]}), 0.0, 1.0);
  float a = clamp(${ALPHA_IN[ad]} + mix(${ALPHA_IN[aa]}, ${ALPHA_IN[ab]}, ${ALPHA_IN[ac]}), 0.0, 1.0);
${k.second ? `  vec4 t2 = texture(uTex2, vUvRaw);
  color *= t2.rgb;
  a *= t2.a;` : ""}
${always ? "" : `  bool tA = ${compare(opA, k.ref0)};\n  bool tB = ${compare(opB, k.ref1)};\n  if (!(${join})) discard;`}
  fragColor = vec4(color, a);
}
`;
}

/** One resource part's GPU state: material, its textures and the instanced (or stripe) mesh. */
interface Part {
  resource: JpaResource;
  child: boolean;
  /** Texture slot → array layer. */
  layers: Map<number, number>;
  material: THREE.ShaderMaterial;
  mesh: THREE.Mesh;
  stripe: boolean;
  data: Float32Array;
  count: number;
  /** Stripe vertices: position (3), uv (2), raw uv (2), prm (4), env (4), layer (1). */
  vertices: number;
  indices: number;
  index: Uint32Array;
  used: boolean;
  /** A screen-distortion effect (in `distortion`). */
  distort: boolean;
}

const STRIPE_STRIDE = 16;

function quadGeometry(cross: boolean): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  const n0 = 25, n1 = -25;
  const position = cross ? [0, n0, n0, 0, n1, n0, 0, n0, n1, 0, n1, n1] : [n0, n0, 0, n0, n1, 0, n1, n0, 0, n1, n1, 0];
  g.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([1, 0, 1, 1, 0, 0, 0, 1], 2));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  return g;
}

function setInstanceBuffer(g: THREE.InstancedBufferGeometry, data: Float32Array): void {
  const buffer = new THREE.InstancedInterleavedBuffer(data, STRIDE);
  buffer.setUsage(THREE.DynamicDrawUsage);
  const attr = (name: string, size: number, offset: number) => g.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, size, offset));
  attr("iRow0", 4, 0);
  attr("iRow1", 4, 4);
  attr("iRow2", 4, 8);
  attr("iTexS", 3, 12);
  attr("iTexT", 3, 15);
  attr("iPrm", 4, 18);
  attr("iEnv", 4, 22);
  attr("iLayer", 1, 26);
  // three.js caps the instances drawn at the count it saw when it first bound the geometry (_maxInstanceCount, set
  // once): a grown buffer would otherwise still draw only its first size's worth (the last emitters' particles lost).
  (g as THREE.InstancedBufferGeometry & { _maxInstanceCount?: number })._maxInstanceCount = data.length / STRIDE;
}

function setStripeBuffers(g: THREE.BufferGeometry, data: Float32Array, index: Uint32Array): void {
  const buffer = new THREE.InterleavedBuffer(data, STRIPE_STRIDE);
  buffer.setUsage(THREE.DynamicDrawUsage);
  const attr = (name: string, size: number, offset: number) => g.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, size, offset));
  attr("position", 3, 0);
  attr("uv", 2, 3);
  attr("aUvRaw", 2, 5);
  attr("aPrm", 4, 7);
  attr("aEnv", 4, 11);
  attr("aLayer", 1, 15);
  const indexAttr = new THREE.BufferAttribute(index, 1);
  indexAttr.setUsage(THREE.DynamicDrawUsage);
  g.setIndex(indexAttr);
}

/**
 * Draws emitters' particles. Add `group` to the scene; call `draw(emitters)` once per rendered frame (it only reads
 * the emitters). `stats` counts the last frame's draws and particles.
 */
export class JpaRenderer {
  readonly group = new THREE.Group();
  /** The screen-distortion effects' meshes: draw them after copying the frame into `frame` (see the top). */
  readonly distortion = new THREE.Group();
  /** The frame's copy and where the frame is in the drawing buffer (x, y from its bottom left, width, height: px). */
  readonly frame = { uFrame: { value: WHITE as THREE.Texture }, uViewport: { value: new THREE.Vector4(0, 0, 1, 1) } };
  /** A distortion effect showed in the last `draw`. */
  distorting = false;
  readonly jpac: Jpac;
  readonly mapping: Required<JpaSceneMapping>;
  readonly stats = { draws: 0, particles: 0 };
  /** Base render order of the meshes (three.js sorts transparent meshes by it before depth). */
  renderOrder = 500;
  private readonly camera: JpaCamera;
  private readonly decoded = new Map<number, DecodedTexture>();
  private readonly arrays = new Map<string, THREE.DataArrayTexture>();
  private readonly plain = new Map<number, THREE.DataTexture>();
  private readonly parts = new Map<string, Part>();
  private order = 0;

  constructor(jpac: Jpac, mapping: JpaSceneMapping, view: M4 = FSA_VIEW) {
    this.jpac = jpac;
    this.mapping = { origin: mapping.origin ?? { x: 0, y: 0 }, zBase: mapping.zBase, zScale: mapping.zScale };
    this.camera = { view };
    this.group.name = "particles";
  }

  /** Draws the particles of `emitters` (in their order) this frame. */
  draw(emitters: Iterable<JpaEmitter>): void {
    for (const part of this.parts.values()) {
      part.count = part.vertices = part.indices = 0;
      part.used = false;
    }
    const ctx = new JpaDrawContext(this.camera);
    this.stats.particles = 0;
    for (const e of emitters) {
      if (!e.particleCount) continue;
      const b = e.res.baseShape;
      const child = e.res.childShape && !b.isNoDrawChild && e.supportedChild;
      if (child && b.isDrawParentAhead) this.drawPart(e, true, ctx);
      if (!b.isNoDrawParent && shapeDrawn(b.shapeType)) this.drawPart(e, false, ctx);
      if (child && !b.isDrawParentAhead) this.drawPart(e, true, ctx);
    }
    this.stats.draws = 0;
    this.distorting = false;
    for (const part of this.parts.values()) {
      const g = part.mesh.geometry;
      if (part.stripe) {
        part.mesh.visible = part.indices > 0;
        if (part.mesh.visible) {
          (g.index!.array as Uint32Array).set(part.index.subarray(0, part.indices));
          upload(g.index!, part.indices);
          upload((g.getAttribute("position") as THREE.InterleavedBufferAttribute).data, part.vertices * STRIPE_STRIDE);
          g.setDrawRange(0, part.indices);
        }
      } else {
        part.mesh.visible = part.count > 0;
        if (part.mesh.visible) {
          upload((g.getAttribute("iRow0") as THREE.InterleavedBufferAttribute).data, part.count * STRIDE);
          (g as THREE.InstancedBufferGeometry).instanceCount = part.count;
        }
      }
      if (part.mesh.visible) this.stats.draws++;
      if (part.mesh.visible && part.distort) this.distorting = true;
    }
  }

  private drawPart(e: JpaEmitter, child: boolean, ctx: JpaDrawContext): void {
    const particles = child ? e.children : e.base;
    if (!particles.length) return;
    const part = this.part(e.res, child);
    if (!part) return;
    part.used = true;
    ctx.begin(e, child);
    if (part.stripe) return this.drawStripe(part, e, particles, ctx);
    const forward = e.res.baseShape.isDrawForwardAhead, n = particles.length;
    for (let i = 0; i < n; i++) {
      const d = ctx.particle(e, particles[forward ? i : n - 1 - i]!);
      if (!d) continue;
      if (part.count * STRIDE >= part.data.length) this.grow(part);
      const o = part.count++ * STRIDE, f = part.data, m = d.posMtx;
      const { origin, zBase, zScale } = this.mapping;
      f[o] = m[0]!;
      f[o + 1] = m[4]!;
      f[o + 2] = m[8]!;
      f[o + 3] = m[12]! - origin.x;
      f[o + 4] = -m[1]!;
      f[o + 5] = -m[5]!;
      f[o + 6] = -m[9]!;
      f[o + 7] = origin.y - m[13]!;
      f[o + 8] = zScale * m[2]!;
      f[o + 9] = zScale * m[6]!;
      f[o + 10] = zScale * m[10]!;
      f[o + 11] = zBase + zScale * m[14]!;
      f.set(d.texS, o + 12);
      f.set(d.texT, o + 15);
      f.set(d.prm, o + 18);
      f.set(d.env, o + 22);
      f[o + 26] = part.layers.get(d.texIdx) ?? 0;
      this.stats.particles++;
    }
  }

  // A stripe is drawn with its emitter's colors (not each particle's) and one texture matrix: scrolling with the
  // emitter's age, else the tiling (children: plain).
  private drawStripe(part: Part, e: JpaEmitter, particles: readonly JpaParticle[], ctx: JpaDrawContext): void {
    const b = e.res.baseShape, c = e.res.childShape;
    const prm = part.child ? c!.colorPrm : e.colorPrm, env = part.child ? c!.colorEnv : e.colorEnv;
    const layer = part.layers.get(part.child ? c!.texIdx : b.texIdxAnimData && b.isGlobalTexAnm ? e.texAnmIdx : b.texIdx) ?? 0;
    const rows = part.child ? { s: [1, 0, 0], t: [0, 1, 0] } : b.isEnableTexScrollAnm ? scrollRows(b, e.age) : { s: [b.tilingS, 0, 0], t: [0, b.tilingT, 0] };
    const ts = rows.s, tt = rows.t;
    const start = part.vertices, { origin, zBase, zScale } = this.mapping;
    const strips: number[][] = [[], []];
    ctx.stripe(e, particles, (x, y, z, s, t, strip) => {
      if ((part.vertices + 1) * STRIPE_STRIDE > part.data.length) this.grow(part);
      const o = part.vertices * STRIPE_STRIDE, f = part.data;
      f[o] = x - origin.x;
      f[o + 1] = origin.y - y;
      f[o + 2] = zBase + zScale * z;
      f[o + 3] = ts[0]! * s + ts[1]! * t + ts[2]!;
      f[o + 4] = tt[0]! * s + tt[1]! * t + tt[2]!;
      f[o + 5] = s;
      f[o + 6] = t;
      for (let k = 0; k < 4; k++) {
        f[o + 7 + k] = prm[k]! * e.globalColorPrm[k]!;
        f[o + 11 + k] = env[k]! * e.globalColorEnv[k]!;
      }
      f[o + 15] = layer;
      strips[strip]!.push(part.vertices++);
    });
    for (const v of strips) {
      for (let i = 0; i + 3 < v.length; i += 2) {
        if (part.indices + 6 > part.index.length) this.grow(part);
        part.index.set([v[i]!, v[i + 1]!, v[i + 2]!, v[i + 2]!, v[i + 1]!, v[i + 3]!], part.indices);
        part.indices += 6;
      }
    }
    if (part.vertices > start) this.stats.particles += particles.length;
  }

  private grow(part: Part): void {
    const g = part.mesh.geometry;
    if (part.stripe) {
      const data = new Float32Array(Math.max(256 * STRIPE_STRIDE, part.data.length * 2));
      data.set(part.data);
      const index = new Uint32Array(Math.max(384, part.index.length * 2));
      index.set(part.index);
      part.data = data;
      part.index = index;
      setStripeBuffers(g, data, new Uint32Array(index.length));
    } else {
      const data = new Float32Array(part.data.length * 2);
      data.set(part.data);
      part.data = data;
      setInstanceBuffer(g as THREE.InstancedBufferGeometry, data);
    }
  }

  private part(res: JpaResource, child: boolean): Part | null {
    const key = `${res.id}:${child ? "c" : "b"}`;
    let part = this.parts.get(key);
    if (part) return part;
    const b = res.baseShape, c = res.childShape;
    const shape = child ? c!.shapeType : b.shapeType;
    // Projected textures: the distortion effects' frame copy; the others (group 5's screen space) aren't drawn yet.
    const distort = b.isEnableProjection && !child && (res.dynamics.userFlags & 2) !== 0;
    if (!shapeDrawn(shape) || (b.isEnableProjection && !distort)) return null;
    const slots = child ? [c!.texIdx] : b.texIdxAnimData ? [...new Set(b.texIdxAnimData)] : [b.texIdx];
    const array = this.arrayTexture(res, slots);
    if (!array) return null;
    const layers = new Map(slots.map((s, i) => [s, i]));
    const etx = child ? null : res.exTex;
    const second = etx && etx.secondTextureIndex >= 0 ? this.plainTexture(res, etx.secondTextureIndex) : null;
    const indirect = etx && etx.indTextureMode === JpaIndTexMode.NORMAL ? this.plainTexture(res, etx.indTextureId) : null;
    const stripe = isStripe(shape);
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: stripe ? VERTEX_STRIPE : VERTEX_INSTANCED,
      fragmentShader: fragmentShader({ colorIn: b.colorInSelect, alphaIn: b.alphaInSelect, alphaCompare: b.alphaCompareFlags, ref0: b.alphaRef0, ref1: b.alphaRef1, second: !!second, indirect: !!indirect, frame: distort }),
      uniforms: {
        uTex: { value: array },
        uTexSize: { value: new THREE.Vector2(array.image.width, array.image.height) },
        uTex2: { value: second ?? WHITE },
        uInd: { value: indirect ?? WHITE },
        uIndMtx: { value: [0, 4].map((o) => (etx ? new THREE.Vector4(...etx.indTextureMatrix.subarray(o, o + 4)) : new THREE.Vector4())) },
        ...this.frame,
      },
      side: THREE.DoubleSide,
      transparent: true,
    });
    const mode = JPA_BLEND_MODE[b.blendModeFlags & 3] ?? GxBlendMode.NONE;
    if (mode === GxBlendMode.BLEND) {
      material.blending = THREE.CustomBlending;
      material.blendEquation = THREE.AddEquation;
      material.blendSrc = blendFactor(JPA_BLEND_FACTOR[(b.blendModeFlags >> 2) & 0xf] ?? 1, true) as THREE.BlendingSrcFactor;
      material.blendDst = blendFactor(JPA_BLEND_FACTOR[(b.blendModeFlags >> 6) & 0xf] ?? 0, false);
    } else material.blending = THREE.NoBlending; // none, and logic ops (not emulated)
    // GX blends color only: the framebuffer's alpha stays.
    material.blendSrcAlpha = THREE.ZeroFactor;
    material.blendDstAlpha = THREE.OneFactor;
    material.blendEquationAlpha = THREE.AddEquation;
    material.depthTest = (b.zModeFlags & 1) !== 0;
    material.depthFunc = DEPTH_FUNC[JPA_COMPARE[(b.zModeFlags >> 1) & 7]!] ?? THREE.LessEqualDepth;
    material.depthWrite = ((b.zModeFlags >> 4) & 1) !== 0;
    let geometry: THREE.BufferGeometry;
    let data: Float32Array;
    const index = new Uint32Array(stripe ? 384 : 0);
    if (stripe) {
      geometry = new THREE.BufferGeometry();
      data = new Float32Array(256 * STRIPE_STRIDE);
      setStripeBuffers(geometry, data, new Uint32Array(index.length));
    } else {
      geometry = quadGeometry(isCross(shape));
      data = new Float32Array(64 * STRIDE);
      setInstanceBuffer(geometry as THREE.InstancedBufferGeometry, data);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    mesh.name = `jpa ${res.id}${child ? " child" : ""}`;
    // Children drawn before their parents stay before them.
    mesh.renderOrder = this.renderOrder + this.order++ * 2 + (child && b.isDrawParentAhead ? 0 : 1);
    (distort ? this.distortion : this.group).add(mesh);
    part = { resource: res, child, layers, material, mesh, stripe, data, count: 0, vertices: 0, indices: 0, index, used: false, distort };
    this.parts.set(key, part);
    return part;
  }

  private texture(index: number): DecodedTexture | null {
    let t = this.decoded.get(index);
    const source: JpaTexture | undefined = this.jpac.textures[index];
    if (!t && source) this.decoded.set(index, (t = decodeJpaTexture(source)));
    return t ?? null;
  }

  /** The resource's texture slots as the layers of one array texture (frames share the first one's size). */
  private arrayTexture(res: JpaResource, slots: number[]): THREE.DataArrayTexture | null {
    const ids = slots.map((s) => res.textureIds[s] ?? -1);
    const key = ids.join(",");
    let array = this.arrays.get(key);
    if (array) return array;
    const images = ids.map((i) => this.texture(i));
    const first = images[0];
    const header = this.jpac.textures[ids[0]!]?.header;
    if (!first || !header) return null;
    const { width, height } = first, size = width * height * 4;
    const data = new Uint8Array(size * images.length);
    images.forEach((img, layer) => {
      if (!img) return;
      if (img.width === width && img.height === height) data.set(img.data, layer * size);
      else
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const sx = Math.floor((x * img.width) / width), sy = Math.floor((y * img.height) / height);
            data.set(img.data.subarray((sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4), layer * size + (y * width + x) * 4);
          }
    });
    array = new THREE.DataArrayTexture(data, width, height, images.length);
    array.format = THREE.RGBAFormat;
    applySampler(array, header);
    array.needsUpdate = true;
    this.arrays.set(key, array);
    return array;
  }

  private plainTexture(res: JpaResource, slot: number): THREE.DataTexture | null {
    const id = res.textureIds[slot] ?? -1;
    let t = this.plain.get(id);
    if (t) return t;
    const img = this.texture(id), header = this.jpac.textures[id]?.header;
    if (!img || !header) return null;
    t = new THREE.DataTexture(img.data, img.width, img.height, THREE.RGBAFormat);
    applySampler(t, header);
    t.needsUpdate = true;
    this.plain.set(id, t);
    return t;
  }

  /** Frees GPU state of resources no emitter drew in the last frame (call now and then, e.g. between rounds). */
  prune(): void {
    for (const [key, part] of this.parts) {
      if (part.used) continue;
      part.mesh.geometry.dispose();
      part.material.dispose();
      part.mesh.removeFromParent();
      this.parts.delete(key);
    }
  }

  dispose(): void {
    for (const part of this.parts.values()) {
      part.mesh.geometry.dispose();
      part.material.dispose();
    }
    for (const t of [...this.arrays.values(), ...this.plain.values()]) t.dispose();
    this.parts.clear();
    this.arrays.clear();
    this.plain.clear();
    this.group.clear();
    this.distortion.clear();
  }
}

/** Sends the first `count` values of a dynamic buffer this frame (not its whole capacity). */
function upload(buffer: THREE.InterleavedBuffer | THREE.BufferAttribute, count: number): void {
  buffer.clearUpdateRanges();
  buffer.addUpdateRange(0, count);
  buffer.needsUpdate = true;
}

function scrollRows(b: JpaResource["baseShape"], tick: number): { s: number[]; t: number[] } {
  const offS = 0.5 * b.tilingS, offT = 0.5 * b.tilingT;
  const ts = b.texInitTransX + tick * b.texIncTransX + offS, tt = b.texInitTransY + tick * b.texIncTransY + offT;
  const ss = b.texInitScaleX + tick * b.texIncScaleX, st = b.texInitScaleY + tick * b.texIncScaleY;
  const rot = ((b.texInitRot + tick * b.texIncRot) * Math.PI * 2) / 0xffff;
  const sin = Math.sin(rot), cos = Math.cos(rot);
  return {
    s: [b.tilingS * ss * cos, b.tilingS * ss * -sin, offS + ss * (sin * tt - cos * ts)],
    t: [b.tilingT * st * sin, b.tilingT * st * cos, offT - st * (sin * ts + cos * tt)],
  };
}

function applySampler(t: THREE.Texture, header: { wrapS: number; wrapT: number; minFilter: number; magFilter: number }): void {
  t.wrapS = wrapMode(header.wrapS);
  t.wrapT = wrapMode(header.wrapT);
  t.magFilter = header.magFilter === GxTexFilter.NEAR ? THREE.NearestFilter : THREE.LinearFilter;
  t.minFilter = header.minFilter === GxTexFilter.NEAR ? THREE.NearestFilter : THREE.LinearFilter;
  t.generateMipmaps = false;
}

const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE.needsUpdate = true;
