// GX material → GLSL ES 3.0 (three.js ShaderMaterial, glslVersion GLSL3): texgens, TEV stages (konst colors, swap
// tables, compare ops, overflow), indirect texturing, alpha test.
//
// Ported from noclip.website's src/gx/gx_material.ts (GX_Program) (MIT License, Copyright (c) 2017 Jasper St. Pierre,
// https://github.com/magcius/noclip.website). Adapted: our plain `J3dMaterial` data instead of GXMaterial, three.js
// uniforms instead of uniform buffers, and no GX lights (lit channels see no lights: color = material × ambient). Fog
// and dst alpha are not emitted.
import {
  GxAlphaOp,
  GxCA,
  GxCC,
  GxColorSrc,
  GxCompare,
  GxIndTexAlphaSel,
  GxIndTexBias,
  GxIndTexFormat,
  GxIndTexMtx,
  GxIndTexWrap,
  GxPostTexGenMatrix,
  GxRasChannel,
  GxTevBias,
  GxTevOp,
  GxTevScale,
  GxTexGenMatrix,
  GxTexGenSrc,
  GxTexGenType,
  GX_TEXMAP_NULL,
  type ColorChannel,
  type J3dMaterial,
  type SwapTable,
  type TevStage,
} from "@fso/formats";

export interface GxShaderOptions {
  /** Number of position matrices (uPosMtx) the shape uses; > 1 means a per-vertex aMtxIdx attribute. */
  matrixCount: number;
  /** Which vertex attributes the geometry provides. */
  hasColor: [boolean, boolean];
  hasNormal: boolean;
}

const float = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

function konstColor(sel: number): string {
  if (sel <= 7) return `vec3(${float((8 - sel) / 8)})`;
  const k = `uKonst[${sel & 3}]`;
  if (sel >= 0x0c && sel <= 0x0f) return `${k}.rgb`;
  if (sel >= 0x10 && sel <= 0x13) return `${k}.rrr`;
  if (sel >= 0x14 && sel <= 0x17) return `${k}.ggg`;
  if (sel >= 0x18 && sel <= 0x1b) return `${k}.bbb`;
  return `${k}.aaa`;
}

function konstAlpha(sel: number): string {
  if (sel <= 7) return float((8 - sel) / 8);
  const k = `uKonst[${sel & 3}]`;
  if (sel >= 0x10 && sel <= 0x13) return `${k}.r`;
  if (sel >= 0x14 && sel <= 0x17) return `${k}.g`;
  if (sel >= 0x18 && sel <= 0x1b) return `${k}.b`;
  return `${k}.a`;
}

const CHANNEL = ["r", "g", "b", "a"];
const swizzle = (table: SwapTable | null, channel: number) => CHANNEL[table ? table[channel]! : channel]!;
const colorSwizzle = (table: SwapTable | null) => `${swizzle(table, 0)}${swizzle(table, 1)}${swizzle(table, 2)}`;

/** Builds the vertex and fragment shaders of a J3D material. */
export function generateGxShader(material: J3dMaterial, options: GxShaderOptions): { vertexShader: string; fragmentShader: string } {
  const texGens = material.texGens;
  const tev = material.tevStages;
  const ind = material.indTexStages;
  const projected = (i: number) => texGens[i]!.type === GxTexGenType.MTX3x4;

  // #region Vertex
  const matSource = (chan: ColorChannel, i: number) =>
    chan.matColorSource === GxColorSrc.VTX ? (options.hasColor[i] ? `aColor${i}` : "vec4(1.0)") : `uMatColor[${i}]`;
  const ambSource = (chan: ColorChannel, i: number) =>
    chan.ambColorSource === GxColorSrc.VTX ? (options.hasColor[i] ? `aColor${i}` : "vec4(1.0)") : `uAmbColor[${i}]`;
  // No GX lights are emulated: a lit channel receives only its ambient term.
  const channel = (chan: ColorChannel, i: number) =>
    chan.lightingEnabled ? `(${matSource(chan, i)} * clamp(${ambSource(chan, i)}, 0.0, 1.0))` : matSource(chan, i);
  const lightChannels = [0, 1]
    .map((i) => {
      const c = material.lightChannels[i];
      if (!c) return `  vColor${i} = vec4(0.0);`;
      return `  vColor${i} = vec4((${channel(c.color, i)}).rgb, (${channel(c.alpha, i)}).a);`;
    })
    .join("\n");

  const texGenSource = (src: number): string => {
    if (src === GxTexGenSrc.POS) return "vec4(tPosition, 1.0)";
    if (src === GxTexGenSrc.NRM) return options.hasNormal ? "vec4(normal, 1.0)" : "vec4(0.0, 0.0, 1.0, 1.0)";
    if (src >= GxTexGenSrc.TEX0 && src <= GxTexGenSrc.TEX7) return `vec4(aTex${src - GxTexGenSrc.TEX0}, 1.0, 1.0)`;
    if (src >= GxTexGenSrc.TEXCOORD0 && src <= GxTexGenSrc.TEXCOORD6) return `vec4(tTexCoord${src - GxTexGenSrc.TEXCOORD0}, 1.0)`;
    if (src === GxTexGenSrc.COLOR0) return "vColor0";
    if (src === GxTexGenSrc.COLOR1) return "vColor1";
    return "vec4(0.0, 0.0, 1.0, 1.0)";
  };
  const texGenMatrix = (matrix: number, src: string): string => {
    if (matrix === GxTexGenMatrix.IDENTITY) return `${src}.xyz`;
    if (matrix >= GxTexGenMatrix.TEXMTX0) return `(uTexMtx[${(matrix - GxTexGenMatrix.TEXMTX0) / 3}] * ${src}).xyz`;
    return `(uPosMtx[0] * ${src}).xyz`;
  };
  const texGenLines = texGens
    .map((g, i) => {
      // J3D always routes texgen n through texture matrix n (see bmd.ts): BTK animations target it.
      const matrix = g.matrix === GxTexGenMatrix.IDENTITY || g.matrix >= GxTexGenMatrix.TEXMTX0 ? GxTexGenMatrix.TEXMTX0 + i * 3 : g.matrix;
      const src = texGenSource(g.source);
      let v: string;
      if (g.type === GxTexGenType.SRTG) v = `vec3(${src}.xy, 1.0)`;
      else if (g.type === GxTexGenType.MTX2x4) v = `vec3(${texGenMatrix(matrix, src)}.xy, 1.0)`;
      else if (g.type === GxTexGenType.MTX3x4) v = texGenMatrix(matrix, src);
      else v = `${src}.xyz`; // bump mapping: not emulated
      if (g.postMatrix !== GxPostTexGenMatrix.PTIDENTITY) v = `(${v})`;
      return `  vec3 tTexCoord${i} = ${v};\n  vTexCoord${i} = tTexCoord${i};`;
    })
    .join("\n");

  const posMtx = options.matrixCount > 1 ? "uPosMtx[int(aMtxIdx + 0.5)]" : "uPosMtx[0]";
  const varyings = (dir: "out" | "in") =>
    [`${dir} vec4 vColor0;`, `${dir} vec4 vColor1;`, ...texGens.map((_, i) => `${dir} highp vec3 vTexCoord${i};`)].join("\n");

  const vertexShader = /* glsl */ `
precision highp float;
uniform mat4 uPosMtx[${Math.max(1, options.matrixCount)}];
uniform mat4 uTexMtx[10];
uniform vec4 uMatColor[2];
uniform vec4 uAmbColor[2];
${options.matrixCount > 1 ? "in float aMtxIdx;" : ""}
${options.hasColor[0] ? "in vec4 aColor0;" : ""}
${options.hasColor[1] ? "in vec4 aColor1;" : ""}
${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `in vec2 aTex${i};`).join("\n")}
${varyings("out")}
void main() {
  vec4 tWorld = ${posMtx} * vec4(position, 1.0);
  vec3 tPosition = position;
${lightChannels}
${texGenLines}
  gl_Position = projectionMatrix * modelViewMatrix * tWorld;
}
`;
  // #endregion

  // #region Fragment
  const readTexCoord = (i: number) => (projected(i) ? `(vTexCoord${i}.xy / vTexCoord${i}.z)` : `vTexCoord${i}.xy`);
  const lastTexGen = texGens.length - 1;
  const clampCoord = (id: number) => Math.min(id, lastTexGen);

  const indStages = ind
    .map((s, i) => {
      if (s.texCoord > lastTexGen) return "";
      const scale = (v: number) => float(1 / (1 << v));
      const coord = s.scaleS || s.scaleT ? `${readTexCoord(s.texCoord)} * vec2(${scale(s.scaleS)}, ${scale(s.scaleT)})` : readTexCoord(s.texCoord);
      return `  vec3 tIndTexCoord${i} = 255.0 * texture(uTex${s.texMap}, ${coord}).abg;`;
    })
    .join("\n");

  const ras = (s: TevStage): string => {
    switch (s.channel) {
      case GxRasChannel.COLOR0A0:
        return "vColor0";
      case GxRasChannel.COLOR1A1:
        return "vColor1";
      case GxRasChannel.ALPHA_BUMP:
      case GxRasChannel.ALPHA_BUMP_N: {
        const comp = s.indTexAlphaSel === GxIndTexAlphaSel.S ? "x" : s.indTexAlphaSel === GxIndTexAlphaSel.T ? "y" : "z";
        const mask = s.indTexFormat === GxIndTexFormat.F5 ? "0xE0" : s.indTexFormat === GxIndTexFormat.F4 ? "0xF0" : "0xF8";
        const v = `TevMask(tIndTexCoord${s.indTexStage}.${comp} / 255.0, ${mask})`;
        return s.channel === GxRasChannel.ALPHA_BUMP ? `vec4(${v})` : `vec4(${v} * (255.0 / 248.0))`;
      }
      default:
        return "vec4(0.0)";
    }
  };

  const colorIn = (s: TevStage, input: number): string => {
    switch (input) {
      case GxCC.CPREV:
        return "tPrev.rgb";
      case GxCC.APREV:
        return "tPrev.aaa";
      case GxCC.C0:
        return "tReg0.rgb";
      case GxCC.A0:
        return "tReg0.aaa";
      case GxCC.C1:
        return "tReg1.rgb";
      case GxCC.A1:
        return "tReg1.aaa";
      case GxCC.C2:
        return "tReg2.rgb";
      case GxCC.A2:
        return "tReg2.aaa";
      case GxCC.TEXC:
        return `tTex.${colorSwizzle(s.texSwap)}`;
      case GxCC.TEXA:
        return `tTex.${swizzle(s.texSwap, 3).repeat(3)}`;
      case GxCC.RASC:
        return `clamp(${ras(s)}.${colorSwizzle(s.rasSwap)}, 0.0, 1.0)`;
      case GxCC.RASA:
        return `clamp(${ras(s)}.${swizzle(s.rasSwap, 3).repeat(3)}, 0.0, 1.0)`;
      case GxCC.ONE:
        return "vec3(1.0)";
      case GxCC.HALF:
        return "vec3(0.5)";
      case GxCC.KONST:
        return konstColor(s.konstColorSel);
      default:
        return "vec3(0.0)";
    }
  };

  const alphaIn = (s: TevStage, input: number): string => {
    switch (input) {
      case GxCA.APREV:
        return "tPrev.a";
      case GxCA.A0:
        return "tReg0.a";
      case GxCA.A1:
        return "tReg1.a";
      case GxCA.A2:
        return "tReg2.a";
      case GxCA.TEXA:
        return `tTex.${swizzle(s.texSwap, 3)}`;
      case GxCA.RASA:
        return `clamp(${ras(s)}.${swizzle(s.rasSwap, 3)}, 0.0, 1.0)`;
      case GxCA.KONST:
        return konstAlpha(s.konstAlphaSel);
      default:
        return "0.0";
    }
  };

  const register = (id: number) => ["tPrev", "tReg0", "tReg1", "tReg2"][id]!;

  const tevOp = (op: number, bias: number, scale: number, clampOut: boolean, a: string, b: string, c: string, d: string, zero: string): string => {
    let v: string;
    switch (op) {
      case GxTevOp.ADD:
      case GxTevOp.SUB: {
        v = `${op === GxTevOp.SUB ? "-" : ""}mix(${a}, ${b}, ${c}) + ${d}`;
        if (bias === GxTevBias.ADDHALF) v = `(${v}) + 0.5`;
        else if (bias === GxTevBias.SUBHALF) v = `(${v}) - 0.5`;
        if (scale === GxTevScale.SCALE_2) v = `(${v}) * 2.0`;
        else if (scale === GxTevScale.SCALE_4) v = `(${v}) * 4.0`;
        else if (scale === GxTevScale.DIVIDE_2) v = `(${v}) * 0.5`;
        break;
      }
      case GxTevOp.COMP_R8_GT:
        v = `((tA.r > tB.r) ? ${c} : ${zero}) + ${d}`;
        break;
      case GxTevOp.COMP_R8_EQ:
        v = `((tA.r == tB.r) ? ${c} : ${zero}) + ${d}`;
        break;
      case GxTevOp.COMP_GR16_GT:
        v = `((TevPack16(tA.rg) > TevPack16(tB.rg)) ? ${c} : ${zero}) + ${d}`;
        break;
      case GxTevOp.COMP_GR16_EQ:
        v = `((TevPack16(tA.rg) == TevPack16(tB.rg)) ? ${c} : ${zero}) + ${d}`;
        break;
      case GxTevOp.COMP_BGR24_GT:
        v = `((TevPack24(tA.rgb) > TevPack24(tB.rgb)) ? ${c} : ${zero}) + ${d}`;
        break;
      case GxTevOp.COMP_BGR24_EQ:
        v = `((TevPack24(tA.rgb) == TevPack24(tB.rgb)) ? ${c} : ${zero}) + ${d}`;
        break;
      case GxTevOp.COMP_RGB8_GT:
        v = `(TevPerCompGT(${a}, ${b}) * ${c}) + ${d}`;
        break;
      case GxTevOp.COMP_RGB8_EQ:
        v = `(TevPerCompEQ(${a}, ${b}) * ${c}) + ${d}`;
        break;
      default:
        throw new Error(`unsupported TEV op ${op}`);
    }
    return clampOut ? `clamp(${v}, 0.0, 1.0)` : `clamp(${v}, -4.0, 4.0)`;
  };

  const wrap = (coord: string, mode: number): string => {
    switch (mode) {
      case GxIndTexWrap.W0:
        return "0.0";
      case GxIndTexWrap.W256:
        return `mod(${coord}, 256.0)`;
      case GxIndTexWrap.W128:
        return `mod(${coord}, 128.0)`;
      case GxIndTexWrap.W64:
        return `mod(${coord}, 64.0)`;
      case GxIndTexWrap.W32:
        return `mod(${coord}, 32.0)`;
      case GxIndTexWrap.W16:
        return `mod(${coord}, 16.0)`;
      default:
        return coord;
    }
  };

  const simpleCoords = (s: TevStage) => s.indTexMatrix === GxIndTexMtx.OFF && !s.indTexAddPrev;

  const tevTexCoord = (s: TevStage): string => {
    let base = "";
    if (s.texCoord !== 0xff && s.texMap !== GX_TEXMAP_NULL && lastTexGen >= 0) {
      const scaled = `${readTexCoord(clampCoord(s.texCoord))}${simpleCoords(s) ? "" : ` * uTexSize[${s.texMap}]`}`;
      base = s.indTexWrapS === GxIndTexWrap.OFF && s.indTexWrapT === GxIndTexWrap.OFF ? scaled : `vec2(${wrap(`${scaled}.x`, s.indTexWrapS)}, ${wrap(`${scaled}.y`, s.indTexWrapT)})`;
    }
    let indirect = "";
    if (s.indTexMatrix !== GxIndTexMtx.OFF && s.indTexStage < ind.length) {
      const b = s.indTexFormat === GxIndTexFormat.F8 ? "-128.0" : "1.0";
      const biasVec = (() => {
        switch (s.indTexBias) {
          case GxIndTexBias.S:
            return ` + vec3(${b}, 0.0, 0.0)`;
          case GxIndTexBias.ST:
            return ` + vec3(${b}, ${b}, 0.0)`;
          case GxIndTexBias.SU:
            return ` + vec3(${b}, 0.0, ${b})`;
          case GxIndTexBias.T:
            return ` + vec3(0.0, ${b}, 0.0)`;
          case GxIndTexBias.TU:
            return ` + vec3(0.0, ${b}, ${b})`;
          case GxIndTexBias.U:
            return ` + vec3(0.0, 0.0, ${b})`;
          case GxIndTexBias.STU:
            return ` + vec3(${b})`;
          default:
            return "";
        }
      })();
      const coord = `(tIndTexCoord${s.indTexStage}${biasVec})`;
      const m = (s.indTexMatrix & 3) - 1;
      if (s.indTexMatrix <= GxIndTexMtx.M2) indirect = `IndMtx(${m}, ${coord})`;
      else if (s.indTexMatrix <= GxIndTexMtx.S2) indirect = `(uIndTexMtx[${m * 2}].w * ${readTexCoord(clampCoord(s.texCoord))} * ${coord}.xx)`;
      else indirect = `(uIndTexMtx[${m * 2}].w * ${readTexCoord(clampCoord(s.texCoord))} * ${coord}.yy)`;
    }
    const final = base && indirect ? `${base} + ${indirect}` : base || indirect;
    if (!final) return "";
    return s.indTexAddPrev ? `tTexCoord += ${final};` : `tTexCoord = ${final};`;
  };

  const texAccess = (s: TevStage): string => {
    if (s.texMap === GX_TEXMAP_NULL) return "vec4(1.0)";
    return `texture(uTex${s.texMap}, tTexCoord${simpleCoords(s) ? "" : ` / uTexSize[${s.texMap}]`})`;
  };

  const stages = tev
    .map(
      (s, i) => `
  // TEV stage ${i}
  ${tevTexCoord(s)}
  tTex = ${texAccess(s)};
  tA = TevOverflow(vec4(${colorIn(s, s.colorIn[0])}, ${alphaIn(s, s.alphaIn[0])}));
  tB = TevOverflow(vec4(${colorIn(s, s.colorIn[1])}, ${alphaIn(s, s.alphaIn[1])}));
  tC = TevOverflow(vec4(${colorIn(s, s.colorIn[2])}, ${alphaIn(s, s.alphaIn[2])}));
  tD = vec4(${colorIn(s, s.colorIn[3])}, ${alphaIn(s, s.alphaIn[3])});
  ${register(s.colorRegister)}.rgb = ${tevOp(s.colorOp, s.colorBias, s.colorScale, s.colorClamp, "tA.rgb", "tB.rgb", "tC.rgb", "tD.rgb", "vec3(0.0)")};
  ${register(s.alphaRegister)}.a = ${tevOp(s.alphaOp, s.alphaBias, s.alphaScale, s.alphaClamp, "tA.a", "tB.a", "tC.a", "tD.a", "0.0")};`,
    )
    .join("\n");

  const last = tev[tev.length - 1];
  const output = last
    ? register(last.colorRegister) === register(last.alphaRegister)
      ? register(last.colorRegister)
      : `vec4(${register(last.colorRegister)}.rgb, ${register(last.alphaRegister)}.a)`
    : "tPrev";

  const compare = (cmp: number, ref: number) => {
    const r = float(ref);
    switch (cmp) {
      case GxCompare.NEVER:
        return "false";
      case GxCompare.LESS:
        return `tOut.a < ${r}`;
      case GxCompare.EQUAL:
        return `tOut.a == ${r}`;
      case GxCompare.LEQUAL:
        return `tOut.a <= ${r}`;
      case GxCompare.GREATER:
        return `tOut.a > ${r}`;
      case GxCompare.NEQUAL:
        return `tOut.a != ${r}`;
      case GxCompare.GEQUAL:
        return `tOut.a >= ${r}`;
      default:
        return "true";
    }
  };
  const at = material.alphaTest;
  const alwaysPasses =
    (at.op === GxAlphaOp.OR && (at.compareA === GxCompare.ALWAYS || at.compareB === GxCompare.ALWAYS)) ||
    (at.op === GxAlphaOp.AND && at.compareA === GxCompare.ALWAYS && at.compareB === GxCompare.ALWAYS);
  const alphaOp = ["tTestA && tTestB", "tTestA || tTestB", "tTestA != tTestB", "tTestA == tTestB"][at.op] ?? "true";
  const alphaTest = alwaysPasses
    ? ""
    : `  bool tTestA = ${compare(at.compareA, at.referenceA)};\n  bool tTestB = ${compare(at.compareB, at.referenceB)};\n  if (!(${alphaOp})) discard;`;

  const fragmentShader = /* glsl */ `
precision highp float;
${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `uniform sampler2D uTex${i};`).join("\n")}
uniform vec2 uTexSize[8];
uniform vec4 uKonst[4];
uniform vec4 uColor[4]; // PREV, C0, C1, C2
uniform vec4 uIndTexMtx[6];
${varyings("in")}
layout(location = 0) out vec4 fragColor;

float TevOverflow(float a) { return float(int(a * 255.0) & 255) / 255.0; }
vec3 TevOverflow(vec3 a) { return vec3(TevOverflow(a.r), TevOverflow(a.g), TevOverflow(a.b)); }
vec4 TevOverflow(vec4 a) { return vec4(TevOverflow(a.r), TevOverflow(a.g), TevOverflow(a.b), TevOverflow(a.a)); }
float TevPack16(vec2 a) { return dot(a, vec2(1.0, 256.0)); }
float TevPack24(vec3 a) { return dot(a, vec3(1.0, 256.0, 256.0 * 256.0)); }
float TevPerCompGT(float a, float b) { return float(a > b); }
float TevPerCompEQ(float a, float b) { return float(a == b); }
vec3 TevPerCompGT(vec3 a, vec3 b) { return vec3(greaterThan(a, b)); }
vec3 TevPerCompEQ(vec3 a, vec3 b) { return vec3(equal(a, b)); }
float TevMask(float n, int mask) { return float(int(n * 255.0) & mask) / 255.0; }
vec2 IndMtx(int i, vec3 c) {
  vec4 r0 = uIndTexMtx[i * 2], r1 = uIndTexMtx[i * 2 + 1];
  return vec2(dot(r0.xyz, c), dot(r1.xyz, c));
}

void main() {
  vec4 tPrev = uColor[0];
  vec4 tReg0 = uColor[1];
  vec4 tReg1 = uColor[2];
  vec4 tReg2 = uColor[3];
${indStages}
  vec2 tTexCoord = vec2(0.0);
  vec4 tTex = vec4(0.0);
  vec4 tA, tB, tC, tD;
${stages}
  vec4 tOut = TevOverflow(${output});
${alphaTest}
  fragColor = tOut;
}
`;
  // #endregion
  return { vertexShader, fragmentShader };
}
