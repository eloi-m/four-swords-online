// GPU tilemap: each room layer is a quad whose fragment shader looks up tile → part → 4bpp pixel → palette color,
// so animated tiles and palette changes only touch small shared textures. Per tileset: parts (64×64 R16UI, tile × 4
// parts), chars (128×512 R8UI, 1024 parts of 8×8, 16 per row like the GameCube's C4 texture), palette (256×1 RGBA8).
// Per room layer: 32×32 R16UI tile indices. Output colors are exact 8-bit palette values (times the ground overlay);
// a palette color's alpha blends it over what is drawn before (the river bed under the water: riverbed.ts), unfiltered.
import {
  CHAR_SHEET_SIZE,
  charAnimationFrame,
  LAYER_TILES,
  OVERLAY_BASE,
  OVERLAY_GAIN,
  OVERLAY_SIZE,
  TILE_COUNT,
  type CharAnimation,
  type Tileset,
} from "@fso/formats";
import * as THREE from "three";
import { NO_FILTER, ROOM_H, ROOM_W, type Point } from "./rooms.ts";

const CHARS_W = 128;
const CHARS_H = (CHAR_SHEET_SIZE * 2) / CHARS_W;
const PARTS_W = 64;

const VERTEX = /* glsl */ `
  uniform vec2 uSize;
  out vec2 vPixel;
  void main() {
    vPixel = vec2(uv.x, 1.0 - uv.y) * uSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp usampler2D;
  uniform usampler2D uLayer;
  uniform usampler2D uParts;
  uniform usampler2D uChars;
  uniform sampler2D uPalette;
  uniform sampler2D uFilter;
  uniform float uFilterOn;
  uniform vec2 uOrigin;
  uniform vec2 uBlend;
  uniform vec3 uTint;
  in vec2 vPixel;
  layout(location = 0) out vec4 fragColor;
  void main() {
    ivec2 p = ivec2(floor(vPixel));
    uint tile = texelFetch(uLayer, p >> 4, 0).r & ${TILE_COUNT - 1}u;
    int slot = int(tile) * 4 + ((p.y >> 2) & 2) + ((p.x >> 3) & 1);
    uint packed = texelFetch(uParts, ivec2(slot % ${PARTS_W}, slot / ${PARTS_W}), 0).r;
    int part = int(packed & 0x3ffu);
    ivec2 q = p & 7;
    if ((packed & 0x400u) != 0u) q.x = 7 - q.x;
    if ((packed & 0x800u) != 0u) q.y = 7 - q.y;
    uint index = texelFetch(uChars, ivec2((part & 15) * 8 + q.x, (part >> 4) * 8 + q.y), 0).r;
    if (index == 0u) discard;
    vec4 color = texelFetch(uPalette, ivec2(int(packed >> 12) * 16 + int(index), 0), 0);
    float f = texture(uFilter, (uOrigin + vPixel) / ${OVERLAY_SIZE}.0).r;
    // (Not on the river bed's half-transparent water: Dolphin, the overlay poked black, leaves it as it was.)
    float k = mix(1.0, ${OVERLAY_BASE.toFixed(4)} + ${OVERLAY_GAIN.toFixed(4)} * f, color.a < 1.0 ? 0.0 : uFilterOn);
    fragColor = vec4(color.rgb * k * uTint, color.a);
    // A GBA alpha blend (blendLayer): color × EVA / 16 + what is under it × EVB / 16.
    if (uBlend.x >= 0.0) fragColor = vec4(color.rgb * uBlend.x, 1.0 - uBlend.y);
  }
`;

function integerTexture(data: Uint8Array | Uint16Array, width: number, height: number): THREE.DataTexture {
  const wide = data instanceof Uint16Array;
  const texture = new THREE.DataTexture(data, width, height, THREE.RedIntegerFormat, wide ? THREE.UnsignedShortType : THREE.UnsignedByteType);
  texture.internalFormat = wide ? "R16UI" : "R8UI";
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/** Writes 4bpp sheet bytes (starting at sheet offset `offset`) into the one-index-per-texel chars image. */
function unpackChars(src: Uint8Array, offset: number, pixels: Uint8Array): void {
  for (let i = 0; i < src.length; i++) {
    const o = offset + i, part = o >> 5;
    const at = (((part >> 4) << 3) + ((o >> 2) & 7)) * CHARS_W + ((part & 15) << 3) + ((o & 3) << 1);
    pixels[at] = src[i]! & 15;
    pixels[at + 1] = src[i]! >> 4;
  }
}

/**
 * The shared textures of one tileset. Call `setTick` with the simulation tick (60 Hz) to show animated tiles, and
 * `setPalettes` to switch palettes (TV, GBA, Dark World…) without rebuilding rooms.
 */
export class TilemapTextures {
  readonly parts: THREE.DataTexture;
  readonly chars: THREE.DataTexture;
  readonly palette: THREE.DataTexture;
  private readonly sheet: Uint8Array;
  private readonly pixels: Uint8Array;
  private readonly animations: CharAnimation[];
  private readonly shown: number[];

  constructor(tileset: Tileset) {
    this.sheet = tileset.chars;
    this.animations = tileset.animations ?? [];
    this.shown = this.animations.map(() => -1);
    this.pixels = new Uint8Array(CHARS_W * CHARS_H);
    unpackChars(this.sheet, 0, this.pixels);
    this.chars = integerTexture(this.pixels, CHARS_W, CHARS_H);
    this.parts = integerTexture(new Uint16Array(tileset.parts), PARTS_W, (TILE_COUNT * 4) / PARTS_W);
    this.palette = new THREE.DataTexture(new Uint8Array(tileset.palettes), 256, 1, THREE.RGBAFormat);
    this.palette.magFilter = this.palette.minFilter = THREE.NearestFilter;
    this.palette.needsUpdate = true;
    for (const texture of [this.chars, this.parts, this.palette]) texture.userData.shared = true;
  }

  /** Shows the char sheet as it is at `tick`. Returns true when something changed (the view needs a redraw). */
  setTick(tick: number): boolean {
    let changed = false;
    this.animations.forEach((animation, i) => {
      const frame = charAnimationFrame(animation, tick);
      if (frame === this.shown[i]) return;
      const size = animation.frames[0]!.length;
      const src = frame < 0 ? this.sheet.subarray(animation.dest, animation.dest + size) : animation.frames[frame]!;
      unpackChars(src, animation.dest, this.pixels);
      this.shown[i] = frame;
      changed = true;
    });
    if (changed) this.chars.needsUpdate = true;
    return changed;
  }

  /** Replaces the 16 palettes (256 RGBA8 colors, as decodePalettes returns). */
  setPalettes(palettes: Uint8Array): void {
    (this.palette.image.data as Uint8Array).set(palettes.subarray(0, 256 * 4));
    this.palette.needsUpdate = true;
  }

  dispose(): void {
    for (const texture of [this.chars, this.parts, this.palette]) texture.dispose();
  }
}

/**
 * One tile layer of a room (the 24 visible rows: a 512×384 quad; a GBA-screen area uses all 32, `rows`) with its
 * top-left at `origin`, at depth `z`.
 */
export function roomQuad(layer: Uint16Array, textures: TilemapTextures, filter: THREE.Texture | null, origin: Point, z: number, rows = ROOM_H / 16): THREE.Mesh {
  const height = rows * 16;
  const material = layerMaterial(integerTexture(new Uint16Array(layer), LAYER_TILES, LAYER_TILES), textures, filter, origin, ROOM_W, height);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, height), material);
  mesh.position.set(origin.x + ROOM_W / 2, -(origin.y + height / 2), z);
  return mesh;
}

/**
 * One tile on its own (a 16×16 quad centered on the mesh's position, which the caller sets): a tile lifted off the
 * floor, drawn as the layers draw it (no ground overlay).
 */
export function tileQuad(tile: number, textures: TilemapTextures): THREE.Mesh {
  const material = layerMaterial(integerTexture(new Uint16Array([tile]), 1, 1), textures, null, { x: 0, y: 0 }, 16, 16);
  return new THREE.Mesh(new THREE.PlaneGeometry(16, 16), material);
}

function layerMaterial(layer: THREE.DataTexture, textures: TilemapTextures, filter: THREE.Texture | null, origin: Point, width: number, height: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uLayer: { value: layer },
      uParts: { value: textures.parts },
      uChars: { value: textures.chars },
      uPalette: { value: textures.palette },
      uFilter: { value: filter ?? NO_FILTER },
      uFilterOn: { value: filter ? 1 : 0 },
      uOrigin: { value: new THREE.Vector2(origin.x, origin.y) },
      uSize: { value: new THREE.Vector2(width, height) },
      uBlend: { value: new THREE.Vector2(-1, 0) },
      uTint: { value: new THREE.Color(1, 1, 1) },
    },
    // Opaque colors replace what's under them, as before; the river bed's half-transparent water blends over it. The
    // frame's alpha stays 1 where a tile is (src + dst: the lighting pass and the page's compositing read it).
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
  });
}

/** Multiplies a layer made by roomQuad by a colour (0-255 a channel; white leaves it as it is). */
export function tintLayer(mesh: THREE.Mesh, r: number, g: number, b: number): void {
  ((mesh.material as THREE.ShaderMaterial).uniforms.uTint!.value as THREE.Color).setRGB(r / 255, g / 255, b / 255, THREE.LinearSRGBColorSpace);
}

/**
 * Draws a layer made by roomQuad as the GBA's alpha blend over what is drawn before it (`eva`, `evb` in 16ths: color ×
 * eva / 16 + under × evb / 16, clamped), or as before with null. A blended layer goes with the transparent objects
 * (after the sprites, not writing depth), so the sprites under it are blended too.
 */
export function blendLayer(mesh: THREE.Mesh, blend: { eva: number; evb: number } | null): void {
  const material = mesh.material as THREE.ShaderMaterial, on = blend !== null;
  (material.uniforms.uBlend!.value as THREE.Vector2).set(on ? blend.eva / 16 : -1, on ? blend.evb / 16 : 0);
  if (material.transparent === on) return;
  material.transparent = on;
  material.depthWrite = !on;
  material.blendSrc = on ? THREE.OneFactor : THREE.SrcAlphaFactor;
  material.blendSrcAlpha = on ? THREE.ZeroFactor : THREE.OneFactor;
  material.needsUpdate = true;
}
