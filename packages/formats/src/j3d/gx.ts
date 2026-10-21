// GX (GameCube GPU) constants used by J3D files. Values follow the GameCube SDK / libogc names, as in noclip.website's
// src/gx/gx_enum.ts (MIT, https://github.com/magcius/noclip.website), rewritten as `as const` objects.

export const GxAttr = {
  PNMTXIDX: 0,
  TEX0MTXIDX: 1,
  TEX7MTXIDX: 8,
  POS: 9,
  NRM: 10,
  CLR0: 11,
  CLR1: 12,
  TEX0: 13,
  TEX7: 20,
  /** J3D serialization of NRM with binormal and tangent. */
  NBT: 25,
  NULL: 0xff,
} as const;

export const GxAttrType = { NONE: 0, DIRECT: 1, INDEX8: 2, INDEX16: 3 } as const;

/** Component types: U8…F32 for positions/normals/texcoords, RGB565…RGBA8 for colors. */
export const GxCompType = { U8: 0, S8: 1, U16: 2, S16: 3, F32: 4, RGB565: 0, RGB8: 1, RGBX8: 2, RGBA4: 3, RGBA6: 4, RGBA8: 5 } as const;

export const GxPrimitive = {
  QUADS: 0x80,
  QUAD_STRIP: 0x88,
  TRIANGLES: 0x90,
  TRIANGLE_STRIP: 0x98,
  TRIANGLE_FAN: 0xa0,
  LINES: 0xa8,
  LINE_STRIP: 0xb0,
  POINTS: 0xb8,
} as const;

export const GxCullMode = { NONE: 0, FRONT: 1, BACK: 2, ALL: 3 } as const;
export const GxCompare = { NEVER: 0, LESS: 1, EQUAL: 2, LEQUAL: 3, GREATER: 4, NEQUAL: 5, GEQUAL: 6, ALWAYS: 7 } as const;
export const GxAlphaOp = { AND: 0, OR: 1, XOR: 2, XNOR: 3 } as const;
export const GxBlendMode = { NONE: 0, BLEND: 1, LOGIC: 2, SUBTRACT: 3 } as const;
export const GxBlendFactor = { ZERO: 0, ONE: 1, SRCCLR: 2, INVSRCCLR: 3, SRCALPHA: 4, INVSRCALPHA: 5, DSTALPHA: 6, INVDSTALPHA: 7 } as const;

export const GxTevOp = {
  ADD: 0,
  SUB: 1,
  COMP_R8_GT: 8,
  COMP_R8_EQ: 9,
  COMP_GR16_GT: 10,
  COMP_GR16_EQ: 11,
  COMP_BGR24_GT: 12,
  COMP_BGR24_EQ: 13,
  COMP_RGB8_GT: 14,
  COMP_RGB8_EQ: 15,
} as const;
export const GxTevBias = { ZERO: 0, ADDHALF: 1, SUBHALF: 2 } as const;
export const GxTevScale = { SCALE_1: 0, SCALE_2: 1, SCALE_4: 2, DIVIDE_2: 3 } as const;

/** TEV color inputs. */
export const GxCC = {
  CPREV: 0,
  APREV: 1,
  C0: 2,
  A0: 3,
  C1: 4,
  A1: 5,
  C2: 6,
  A2: 7,
  TEXC: 8,
  TEXA: 9,
  RASC: 10,
  RASA: 11,
  ONE: 12,
  HALF: 13,
  KONST: 14,
  ZERO: 15,
} as const;
/** TEV alpha inputs. */
export const GxCA = { APREV: 0, A0: 1, A1: 2, A2: 3, TEXA: 4, RASA: 5, KONST: 6, ZERO: 7 } as const;

export const GxColorSrc = { REG: 0, VTX: 1 } as const;
export const GxTexGenType = { MTX3x4: 0, MTX2x4: 1, BUMP0: 2, BUMP7: 9, SRTG: 10 } as const;
export const GxTexGenSrc = {
  POS: 0,
  NRM: 1,
  BINRM: 2,
  TANGENT: 3,
  TEX0: 4,
  TEX7: 11,
  TEXCOORD0: 12,
  TEXCOORD6: 18,
  COLOR0: 19,
  COLOR1: 20,
} as const;
export const GxTexGenMatrix = { PNMTX0: 0, TEXMTX0: 30, IDENTITY: 60 } as const;
export const GxPostTexGenMatrix = { PTTEXMTX0: 64, PTIDENTITY: 125 } as const;

/** Rasterized color channel selected by a TEV order (after J3D's channel ID remap). */
export const GxRasChannel = { COLOR0A0: 0, COLOR1A1: 1, ALPHA_BUMP: 5, ALPHA_BUMP_N: 6, COLOR_ZERO: 7 } as const;
export const GX_TEXMAP_NULL = 0xff;
export const GX_TEXCOORD_NULL = 0xff;

export const GxIndTexMtx = { OFF: 0, M0: 1, M1: 2, M2: 3, S0: 5, S1: 6, S2: 7, T0: 9, T1: 10, T2: 11 } as const;
export const GxIndTexWrap = { OFF: 0, W256: 1, W128: 2, W64: 3, W32: 4, W16: 5, W0: 6 } as const;
export const GxIndTexBias = { NONE: 0, S: 1, T: 2, ST: 3, U: 4, SU: 5, TU: 6, STU: 7 } as const;
export const GxIndTexFormat = { F8: 0, F5: 1, F4: 2, F3: 3 } as const;
export const GxIndTexAlphaSel = { OFF: 0, S: 1, T: 2, U: 3 } as const;

export const GxWrap = { CLAMP: 0, REPEAT: 1, MIRROR: 2 } as const;
export const GxTexFilter = { NEAR: 0, LINEAR: 1, NEAR_MIP_NEAR: 2, LIN_MIP_NEAR: 3, NEAR_MIP_LIN: 4, LIN_MIP_LIN: 5 } as const;
