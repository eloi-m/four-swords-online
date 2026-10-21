// Sprite frames pre-rendered into a packed atlas texture (software, via @fso/formats drawSprite), shown on quads.
import { createImage, drawSprite, spriteBounds, type SpriteFrame, type SpriteSheet } from "@fso/formats";
import * as THREE from "three";

const SPRITE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SPRITE_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform vec3 uAdd;
  varying vec2 vUv;
  void main() {
    vec4 color = texture2D(uMap, vUv);
    if (color.a < 0.5) discard;
    gl_FragColor = vec4(min(color.rgb + uAdd, 1.0), uOpacity);
  }
`;

/** Where a frame sits in the atlas (x, y, w, h in texels) and its top-left offset from the sprite anchor. */
export interface AtlasRect {
  x: number;
  y: number;
  w: number;
  h: number;
  dx: number;
  dy: number;
}

const ATLAS_WIDTH = 1024;
const PAD = 1; // transparent texels between frames

export class SpriteAtlas {
  readonly texture: THREE.DataTexture;
  readonly rects: AtlasRect[];

  /** Packs every frame, cropped to its opaque pixels, into rows of one texture (about 1024×512 for player_sob). */
  constructor(sheet: SpriteSheet, frames: SpriteFrame[], paletteMap?: (palette: number) => number) {
    const bounds = frames.map((frame) => spriteBounds(sheet, frame));
    const order = frames.map((_, i) => i).sort((a, b) => height(bounds[b]) - height(bounds[a]) || a - b);
    this.rects = frames.map(() => ({ x: 0, y: 0, w: 0, h: 0, dx: 0, dy: 0 }));
    let x = 0, y = 0, rowHeight = 0;
    for (const i of order) {
      const b = bounds[i];
      if (!b) continue;
      const w = b.right - b.left + 1, h = b.bottom - b.top + 1;
      if (x + w > ATLAS_WIDTH) {
        x = 0;
        y += rowHeight + PAD;
        rowHeight = 0;
      }
      this.rects[i] = { x, y, w, h, dx: b.left, dy: b.top };
      x += w + PAD;
      rowHeight = Math.max(rowHeight, h);
    }
    const image = createImage(ATLAS_WIDTH, y + rowHeight);
    frames.forEach((frame, i) => {
      const r = this.rects[i]!;
      if (r.w) drawSprite(image, sheet, frame, r.x - r.dx, r.y - r.dy, paletteMap);
    });
    // Rows bottom-up for WebGL.
    const rowBytes = image.width * 4;
    const flipped = new Uint8Array(image.data.length);
    for (let row = 0; row < image.height; row++) {
      flipped.set(image.data.subarray(row * rowBytes, (row + 1) * rowBytes), (image.height - 1 - row) * rowBytes);
    }
    this.texture = new THREE.DataTexture(flipped, image.width, image.height, THREE.RGBAFormat);
    this.texture.magFilter = this.texture.minFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;
  }

  get width(): number {
    return this.texture.image.width;
  }

  get height(): number {
    return this.texture.image.height;
  }

  /** UV rectangle [u0, v0, u1, v1] of a frame (v0 = bottom). */
  uv(frame: number): [number, number, number, number] {
    const r = this.rects[frame]!;
    return [r.x / this.width, 1 - (r.y + r.h) / this.height, (r.x + r.w) / this.width, 1 - r.y / this.height];
  }
}

function height(b: { top: number; bottom: number } | null | undefined): number {
  return b ? b.bottom - b.top + 1 : 0;
}

/** A quad showing one atlas frame, positioned by its sprite anchor in world pixels. */
export class SpriteMesh extends THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  private readonly atlas: SpriteAtlas;
  private frame = -1;
  /** Drawn this many times its size, about its anchor. */
  private size = 1;

  constructor(atlas: SpriteAtlas) {
    super(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({ vertexShader: SPRITE_VERTEX, fragmentShader: SPRITE_FRAGMENT, uniforms: { uMap: { value: atlas.texture }, uOpacity: { value: 1 }, uAdd: { value: new THREE.Vector3() } } }),
    );
    this.atlas = atlas;
    this.setFrame(0);
  }

  setFrame(frame: number): void {
    if (frame === this.frame) return;
    this.frame = frame;
    const [u0, v0, u1, v1] = this.atlas.uv(frame);
    const uv = this.geometry.getAttribute("uv") as THREE.BufferAttribute;
    // PlaneGeometry vertex order: top-left, top-right, bottom-left, bottom-right.
    uv.setXY(0, u0, v1);
    uv.setXY(1, u1, v1);
    uv.setXY(2, u0, v0);
    uv.setXY(3, u1, v0);
    uv.needsUpdate = true;
    const r = this.atlas.rects[frame]!;
    this.visible = r.w > 0;
    this.scale.set(Math.max(r.w, 1) * this.size, Math.max(r.h, 1) * this.size, 1);
  }

  /** Its size (1 = the frame's own), about its anchor: call before place. */
  setSize(size: number): void {
    if (size === this.size) return;
    this.size = size;
    const r = this.atlas.rects[this.frame]!;
    this.scale.set(Math.max(r.w, 1) * size, Math.max(r.h, 1) * size, 1);
  }

  /** Its opacity (1 = opaque, drawn as before; less: blended, not writing depth). */
  setOpacity(opacity: number): void {
    const u = this.material.uniforms.uOpacity!;
    if (u.value === opacity) return;
    u.value = opacity;
    const blended = opacity < 1;
    if (this.material.transparent !== blended) {
      this.material.transparent = blended;
      this.material.depthWrite = !blended;
      this.material.needsUpdate = true;
    }
  }

  /** A color added to its texels (0-1 a channel, clamped; GX's TEV add: the boomerang's pale afterimages). */
  setAdd(r: number, g: number, b: number): void {
    (this.material.uniforms.uAdd!.value as THREE.Vector3).set(r, g, b);
  }

  /** Places the frame's anchor at world pixel (x, y), at depth z. */
  place(x: number, y: number, z: number): void {
    const r = this.atlas.rects[this.frame]!, s = this.size;
    this.position.set(x + s * (r.dx + r.w / 2), -(y + s * (r.dy + r.h / 2)), z);
  }
}
