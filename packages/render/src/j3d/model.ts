// three.js instance of a J3D model (BMD): one mesh per shape with a generated GX material, joint and draw matrices,
// and BTK/BRK/BPK/BCK/BTP animations sampled at an explicit 60 Hz tick (never the wall clock).
//
// Structure follows noclip.website's src/Common/JSYSTEM/J3D/J3DGraphBase.ts and J3DGraphAnimator.ts (MIT License,
// Copyright (c) 2017 Jasper St. Pierre, https://github.com/magcius/noclip.website): joint matrices (basic scaling
// rule), envelope skinning, texture matrix modes, color register clamping. Adapted to three.js objects and uniforms.
import {
  animationFrame,
  DrawMatrixKind,
  GxBlendFactor,
  GxBlendMode,
  GxCompare,
  GxTexFilter,
  GxWrap,
  sampleTexSrt,
  sampleTrack,
  texMatrixBasic,
  texMatrixMaya,
  type Bck,
  type Bmd,
  type Btk,
  type Btp,
  type ColorAnimation,
  type GxColor,
  type J3dMaterial,
  type J3dShape,
  type J3dTexture,
} from "@fso/formats";
import * as THREE from "three";
import { generateGxShader } from "./gx-shader.ts";

export interface J3dAnimations {
  /** Texture SRT animations (several may drive different materials). */
  btk?: Btk[];
  /** TEV color register / konst animations. */
  brk?: ColorAnimation[];
  /** Material color animations. */
  bpk?: ColorAnimation[];
  /** Joint animation. */
  bck?: Bck;
  /** Texture pattern animation. */
  btp?: Btp;
}

/**
 * Frames to show instead of the tick's, per animation kind: the game setting an animation's frame itself (title.arc's
 * clouds flash with their .brk at a frame worked out from the lightning, not from time). Used as is (no looping).
 */
export type J3dFrames = Partial<Record<keyof J3dAnimations, number>>;

interface ShapeDraw {
  shape: J3dShape;
  material: J3dMaterial;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** DRW1 indices behind uPosMtx[i]. */
  matrices: number[];
}

// GX blend factors → WebGL. As source factor, GX's SRCCLR/INVSRCCLR mean the destination color, and vice versa.
export function blendFactor(factor: number, source: boolean): THREE.BlendingDstFactor {
  switch (factor) {
    case GxBlendFactor.ZERO:
      return THREE.ZeroFactor;
    case GxBlendFactor.ONE:
      return THREE.OneFactor;
    case GxBlendFactor.SRCCLR:
      return source ? THREE.DstColorFactor : THREE.SrcColorFactor;
    case GxBlendFactor.INVSRCCLR:
      return source ? THREE.OneMinusDstColorFactor : THREE.OneMinusSrcColorFactor;
    case GxBlendFactor.SRCALPHA:
      return THREE.SrcAlphaFactor;
    case GxBlendFactor.INVSRCALPHA:
      return THREE.OneMinusSrcAlphaFactor;
    case GxBlendFactor.DSTALPHA:
      return THREE.DstAlphaFactor;
    default:
      return THREE.OneMinusDstAlphaFactor;
  }
}

/** GxCompare → three.js depth function. */
export const DEPTH_FUNC: Record<number, THREE.DepthModes> = {
  [GxCompare.NEVER]: THREE.NeverDepth,
  [GxCompare.LESS]: THREE.LessDepth,
  [GxCompare.EQUAL]: THREE.EqualDepth,
  [GxCompare.LEQUAL]: THREE.LessEqualDepth,
  [GxCompare.GREATER]: THREE.GreaterDepth,
  [GxCompare.NEQUAL]: THREE.NotEqualDepth,
  [GxCompare.GEQUAL]: THREE.GreaterEqualDepth,
  [GxCompare.ALWAYS]: THREE.AlwaysDepth,
};

export const wrapMode = (w: number): THREE.Wrapping => (w === GxWrap.REPEAT ? THREE.RepeatWrapping : w === GxWrap.MIRROR ? THREE.MirroredRepeatWrapping : THREE.ClampToEdgeWrapping);

/** A TEX1 texture as a three.js texture. Row 0 of the image is sampled at t = 0, like GX. */
export function j3dTexture(texture: J3dTexture): THREE.DataTexture {
  const { width, height, data } = texture.image;
  const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  t.wrapS = wrapMode(texture.wrapS);
  t.wrapT = wrapMode(texture.wrapT);
  t.magFilter = texture.magFilter === GxTexFilter.NEAR ? THREE.NearestFilter : THREE.LinearFilter;
  t.minFilter = texture.minFilter === GxTexFilter.NEAR ? THREE.NearestFilter : THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

const WHITE_TEXTURE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE_TEXTURE.needsUpdate = true;

const vec4 = (c: GxColor) => new THREE.Vector4(c[0], c[1], c[2], c[3]);
const clampColor = (v: THREE.Vector4, lo: number, hi: number) => v.set(...(v.toArray().map((x) => Math.min(hi, Math.max(lo, x))) as [number, number, number, number]));

function geometryOf(shape: J3dShape, matrices: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(shape.position, 3));
  if (shape.normal) g.setAttribute("normal", new THREE.BufferAttribute(shape.normal, 3));
  shape.color.forEach((c, i) => c && g.setAttribute(`aColor${i}`, new THREE.BufferAttribute(c, 4)));
  shape.texCoord.forEach((t, i) => t && g.setAttribute(`aTex${i}`, new THREE.BufferAttribute(t, 2)));
  if (matrices.length > 1) {
    const index = new Float32Array(shape.vertexCount);
    for (let v = 0; v < shape.vertexCount; v++) index[v] = matrices.indexOf(shape.drawMatrix[v]!);
    g.setAttribute("aMtxIdx", new THREE.BufferAttribute(index, 1));
  }
  g.setIndex(new THREE.BufferAttribute(shape.indices, 1));
  g.computeBoundingSphere();
  return g;
}

function materialOf(material: J3dMaterial, shape: J3dShape, matrices: number[], textures: THREE.DataTexture[]): THREE.ShaderMaterial {
  const { vertexShader, fragmentShader } = generateGxShader(material, {
    matrixCount: matrices.length,
    hasColor: [!!shape.color[0], !!shape.color[1]],
    hasNormal: !!shape.normal,
  });
  const uniforms: Record<string, THREE.IUniform> = {
    uPosMtx: { value: matrices.map(() => new THREE.Matrix4()) },
    uTexMtx: { value: Array.from({ length: 10 }, () => new THREE.Matrix4()) },
    uMatColor: { value: material.matColors.map(vec4) },
    uAmbColor: { value: material.ambColors.map(vec4) },
    uKonst: { value: material.konstColors.map(vec4) },
    // PREV starts white (as noclip does); C0-C2 come from the material.
    uColor: { value: [new THREE.Vector4(1, 1, 1, 1), ...material.tevColors.slice(0, 3).map(vec4)] },
    uIndTexMtx: { value: Array.from({ length: 6 }, (_, i) => {
      const m = material.indTexMatrices[i >> 1];
      return m ? new THREE.Vector4(...m.subarray((i & 1) * 4, (i & 1) * 4 + 4)) : new THREE.Vector4();
    }) },
    uTexSize: { value: Array.from({ length: 8 }, () => new THREE.Vector2(1, 1)) },
  };
  for (let i = 0; i < 8; i++) {
    const t = textures[material.textures[i] ?? -1] ?? WHITE_TEXTURE;
    uniforms[`uTex${i}`] = { value: t };
    (uniforms.uTexSize!.value as THREE.Vector2[])[i]!.set(t.image.width, t.image.height);
  }
  const m = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader, fragmentShader, uniforms });
  const blend = material.blend;
  m.transparent = blend.mode !== GxBlendMode.NONE || material.mode === 4;
  if (blend.mode === GxBlendMode.BLEND) {
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = blendFactor(blend.srcFactor, true) as THREE.BlendingSrcFactor;
    m.blendDst = blendFactor(blend.dstFactor, false);
  } else if (blend.mode === GxBlendMode.SUBTRACT) {
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.ReverseSubtractEquation;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneFactor;
  } else {
    // NONE, and logic ops (not emulated): replace.
    m.blending = THREE.NoBlending;
  }
  // Keep the framebuffer's alpha as is: GX blends color only (alpha updates are off for these materials).
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  m.blendEquationAlpha = THREE.AddEquation;
  m.depthTest = material.zMode.test;
  m.depthWrite = material.zMode.write;
  m.depthFunc = DEPTH_FUNC[material.zMode.func] ?? THREE.LessEqualDepth;
  // Cull modes are ignored: FSA's effects are flat and our 2D placement flattens (and may mirror) them anyway.
  m.side = THREE.DoubleSide;
  return m;
}

/**
 * A J3D model instance. Add `object` to a scene, place it with `object.matrix` (matrixAutoUpdate is off), and call
 * `update(tick)` with the number of 60 Hz ticks since the animations started.
 */
export class J3dModel {
  readonly bmd: Bmd;
  readonly object = new THREE.Group();
  readonly textures: THREE.DataTexture[];
  private readonly draws: ShapeDraw[] = [];
  private animations: J3dAnimations = {};
  private frames: J3dFrames = {};
  private readonly jointMatrices: THREE.Matrix4[];
  private readonly drawMatrices: THREE.Matrix4[];

  constructor(bmd: Bmd, animations: J3dAnimations = {}) {
    this.bmd = bmd;
    this.object.matrixAutoUpdate = false;
    this.textures = bmd.textures.map(j3dTexture);
    this.jointMatrices = bmd.joints.map(() => new THREE.Matrix4());
    this.drawMatrices = bmd.drawMatrices.map(() => new THREE.Matrix4());
    bmd.drawOrder.forEach((shapeIndex, order) => {
      const shape = bmd.shapes[shapeIndex]!;
      const material = bmd.materials[shape.materialIndex]!;
      const matrices = [...new Set(shape.drawMatrix)].sort((a, b) => a - b);
      const mesh = new THREE.Mesh(geometryOf(shape, matrices), materialOf(material, shape, matrices, this.textures));
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false; // vertices move by uniform matrices; the geometry bounds don't know them
      mesh.renderOrder = order;
      mesh.name = `${material.name}/${shapeIndex}`;
      this.object.add(mesh);
      this.draws.push({ shape, material, mesh, matrices });
    });
    this.setAnimations(animations);
  }

  setAnimations(animations: J3dAnimations): void {
    this.animations = animations;
    this.update(0);
  }

  /** Base render order of the model's meshes (three.js sorts transparent objects by it before depth). */
  setRenderOrder(base: number): void {
    this.draws.forEach((d, i) => (d.mesh.renderOrder = base + i));
  }

  /**
   * Shows the model `tick` 60 Hz frames after its animations started (each animation loops by its own rules), or at
   * the `frames` given for some kinds.
   */
  update(tick: number, frames: J3dFrames = {}): void {
    this.frames = frames;
    this.calcJoints(tick);
    for (const draw of this.draws) {
      const u = draw.mesh.material.uniforms;
      (u.uPosMtx!.value as THREE.Matrix4[]).forEach((m, i) => m.copy(this.drawMatrices[draw.matrices[i]!]!));
      this.calcTexMatrices(draw.material, u.uTexMtx!.value as THREE.Matrix4[], tick);
      this.calcColors(draw.material, u, tick);
      this.calcTexPattern(draw.material, u, tick);
    }
  }

  /** The frame of an animation of `kind` at `tick` (or the one set for that kind). */
  private frameOf(kind: keyof J3dAnimations, animation: Parameters<typeof animationFrame>[0], tick: number): number {
    return this.frames[kind] ?? animationFrame(animation, tick);
  }

  dispose(): void {
    for (const d of this.draws) {
      d.mesh.geometry.dispose();
      d.mesh.material.dispose();
    }
    for (const t of this.textures) t.dispose();
  }

  private calcJoints(tick: number): void {
    const bck = this.animations.bck;
    const frame = bck ? this.frameOf("bck", bck, tick) : 0;
    const local = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const t = new THREE.Vector3(), s = new THREE.Vector3();
    this.bmd.joints.forEach((joint, i) => {
      const tracks = bck?.joints[i];
      if (tracks) {
        s.set(...(tracks.scale.map((k) => sampleTrack(k, frame)) as [number, number, number]));
        e.set(...(tracks.rotation.map((k) => sampleTrack(k, frame)) as [number, number, number]), "ZYX");
        t.set(...(tracks.translation.map((k) => sampleTrack(k, frame)) as [number, number, number]));
      } else {
        s.set(...joint.scale);
        e.set(...joint.rotation, "ZYX");
        t.set(...joint.translation);
      }
      // J3D applies X, then Y, then Z rotations: R = Rz·Ry·Rx (three.js order "ZYX").
      local.compose(t, q.setFromEuler(e), s);
      const parent = joint.parent >= 0 ? this.jointMatrices[joint.parent] : null;
      this.jointMatrices[i]!.copy(parent ? parent.clone().multiply(local) : local);
    });
    this.bmd.drawMatrices.forEach((d, i) => {
      const dst = this.drawMatrices[i]!;
      if (d.kind === DrawMatrixKind.JOINT) {
        dst.copy(this.jointMatrices[d.index] ?? new THREE.Matrix4());
        return;
      }
      // Envelope: weighted sum of joint × inverse bind matrices.
      const env = this.bmd.envelopes[d.index]!;
      const sum = new Array<number>(16).fill(0);
      env.joints.forEach((j, k) => {
        const m = this.jointMatrices[j]!.clone().multiply(new THREE.Matrix4().fromArray(this.bmd.inverseBinds[j]!));
        m.elements.forEach((v, n) => (sum[n]! += v * env.weights[k]!));
      });
      dst.fromArray(sum);
    });
  }

  private calcTexMatrices(material: J3dMaterial, out: THREE.Matrix4[], tick: number): void {
    material.texMatrices.forEach((tm, i) => {
      const dst = out[i]!;
      let animated: Float32Array | null = null;
      for (const btk of this.animations.btk ?? []) {
        const entry = btk.entries.find((e) => e.material === material.name && e.texMatrix === i);
        if (entry) animated = sampleTexSrt(btk, entry, this.frameOf("btk", btk, tick));
      }
      if (animated) dst.fromArray(animated);
      else if (!tm || tm.identity) dst.identity();
      else {
        const maya = (tm.info & 0x80) !== 0;
        const [sS, sT] = tm.scale, [tS, tT] = tm.translation, [cS, cT] = tm.center;
        dst.fromArray(maya ? texMatrixMaya(sS, sT, tm.rotation, tS, tT) : texMatrixBasic(sS, sT, tm.rotation, tS, tT, cS, cT));
      }
      // Mapping modes other than "none" (environment/projection maps) aren't emulated; FSA's effects use none.
    });
  }

  private calcColors(material: J3dMaterial, u: Record<string, THREE.IUniform>, tick: number): void {
    const konst = u.uKonst!.value as THREE.Vector4[];
    const regs = u.uColor!.value as THREE.Vector4[];
    const mat = u.uMatColor!.value as THREE.Vector4[];
    material.konstColors.forEach((c, i) => konst[i]!.set(...c));
    material.tevColors.slice(0, 3).forEach((c, i) => regs[i + 1]!.set(...c));
    material.matColors.forEach((c, i) => mat[i]!.set(...c));
    for (const [kind, anim] of [...(this.animations.brk ?? []).map((a) => ["brk", a] as const), ...(this.animations.bpk ?? []).map((a) => ["bpk", a] as const)]) {
      const frame = this.frameOf(kind, anim, tick);
      for (const e of anim.entries) {
        if (e.material !== material.name) continue;
        const v = [e.r, e.g, e.b, e.a].map((k) => sampleTrack(k, frame)) as [number, number, number, number];
        if (e.target === "konst" && konst[e.index]) konst[e.index]!.set(...v);
        else if (e.target === "tev" && e.index < 3) regs[e.index + 1]!.set(...v);
        else if (e.target === "mat") mat[0]!.set(...v);
      }
    }
    // Konst colors are 8-bit; TEV registers are signed 10-bit (-1024…1023 / 256).
    konst.forEach((v) => clampColor(v, 0, 1));
    regs.slice(1).forEach((v) => clampColor(v, -1024 / 256, 1023 / 256));
  }

  private calcTexPattern(material: J3dMaterial, u: Record<string, THREE.IUniform>, tick: number): void {
    const btp = this.animations.btp;
    if (!btp) return;
    const frame = Math.floor(this.frameOf("btp", btp, tick));
    for (const e of btp.entries) {
      if (e.material !== material.name) continue;
      const index = e.frames[Math.min(e.frames.length - 1, Math.max(0, frame))]!;
      const t = this.textures[index];
      if (t && u[`uTex${e.texMap}`]) u[`uTex${e.texMap}`]!.value = t;
    }
  }
}
