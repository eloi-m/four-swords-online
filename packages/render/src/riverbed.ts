// The river bed under the water: what shows through palette 13's half-transparent water colors where a room's SWEV
// actor sets bit 19 (The Field's lake in Shadow Battle, every Lake Hylia room but 4 and 10). main.dol's environment
// manager (flag +0x1C7) draws it with 0x8016CB14 as one screen quad before the BG layers (docs/formats/stages-and-tiles.md
// "River bed"):
// - three textures, all data.arc I4 BTIs that wrap and filter linearly: map 0 `kawazoko.bti` (128², "river bottom"),
//   map 1 `kumo_env.bti` (128², the clouds), map 2 `noize_kawazoko_1.bti` (64²) as an indirect texture;
// - texture coordinates from the camera center (cx, cy), in world px, and the manager's frame counter f:
//   kawazoko s = x / 128, t = y / 128 (world-anchored); kumo_env s = cx / 1024 + (x − cx) / 256 − (f & 0xFFF) / 4096,
//   t = cy / 768 + (y − cy) / 192 − (f & 0xFFF) / 4096; the noise s = x / 256 − (f & 0x3FF) / 1024, t = y / 256 − cy / 768;
// - both TEV stages warped by the noise (GXSetTevIndWarp, signed: (n − 128) × 0.02 texels on s and t alike);
// - stage 0 lerp(C0, C1, kawazoko) with C0 = (0, 80, 120), C1 = (56, 96, 168); stage 1 adds C0's alpha × kumo_env, C0's
//   alpha being min(level × 120 / 47, 120), level the cloud shadows' (+0x1EC, 47 in daylight); alpha 1 (opaque).
// The BG layers then blend over it with their palette's alpha: palette 13's colors 8-10 are RGB5A3 at runtime, their
// alpha 4/7 (0x92) and their RGB cut to 4 bits (`riverBedPalettes`); the rest stays opaque.
import { decodeBti, type RarcArchive, type Stage } from "@fso/formats";
import * as THREE from "three";
import { ROOM_H, ROOM_W } from "./rooms.ts";

/** SWEV's params bit that turns the river bed on (→ the manager's +0x1C7). */
export const RIVER_BED_BIT = 19;
/** The water palette and its half-transparent colors. */
export const WATER_PALETTE = 13;
export const WATER_COLORS = [8, 9, 10] as const;
/** RGB5A3's 3-bit alpha 4, expanded to 8 bits. */
export const WATER_ALPHA = 0x92;

/** Does room `room` of `stage` draw the river bed (its TV SWEV actor's params bit 19)? */
export function hasRiverBed(stage: Stage, room: number): boolean {
  return stage.actors(room).some((a) => a.id === "SWEV" && a.sublayer === 0 && ((a.params >>> RIVER_BED_BIT) & 1) === 1);
}

/** A copy of 16 RGBA8 palettes (decodePalettes) with palette 13's water colors as the runtime TLUT has them. */
export function riverBedPalettes(palettes: Uint8Array): Uint8Array {
  const out = new Uint8Array(palettes);
  for (const c of WATER_COLORS) {
    const at = (WATER_PALETTE * 16 + c) * 4;
    for (let k = 0; k < 3; k++) out[at + k] = (out[at + k]! >> 4) * 17;
    out[at + 3] = WATER_ALPHA;
  }
  return out;
}

const VERTEX = /* glsl */ `
  varying vec2 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = vec2(world.x, -world.y);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uBed;
  uniform sampler2D uClouds;
  uniform sampler2D uNoise;
  uniform vec2 uOrigin;
  uniform vec2 uCam;
  uniform float uFrame;
  uniform float uCloud;
  varying vec2 vWorld;
  void main() {
    vec2 w = vWorld + uOrigin;
    float n = texture2D(uNoise, vec2(w.x / 256.0 - mod(uFrame, 1024.0) / 1024.0, w.y / 256.0 - uCam.y / 768.0)).r;
    vec2 warp = vec2((floor(n * 255.0 + 0.5) - 128.0) * 0.02 / 128.0);
    float bed = texture2D(uBed, w / 128.0 + warp).r;
    vec2 c = vec2(uCam.x / 1024.0 + (w.x - uCam.x) / 256.0, uCam.y / 768.0 + (w.y - uCam.y) / 192.0) - mod(uFrame, 4096.0) / 4096.0;
    float cloud = texture2D(uClouds, c + warp).r;
    vec3 color = mix(vec3(0.0, 80.0, 120.0), vec3(56.0, 96.0, 168.0), bed) / 255.0 + uCloud * cloud;
    gl_FragColor = vec4(min(color, 1.0), 1.0);
  }
`;

const MARGIN = 1024; // the quad covers the rooms shown and far around them

function repeatTexture(archive: RarcArchive, path: string): THREE.DataTexture | null {
  const file = archive.files.find((f) => f.path === path);
  if (!file) return null;
  const image = decodeBti(file.data);
  // Rows top-down with flipY off: texture row n is sampled at t = n / height, as GX's t grows downwards.
  const texture = new THREE.DataTexture(image.data, image.width, image.height, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The river bed as one quad under the BG layers (drawn first: opaque, render order −20), for a TV view whose tile
 * layers use `riverBedPalettes`. `show` places it, `update` follows the camera every frame.
 */
export class RiverBed {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null;
  /** Some `quad` shares the material (update runs even with `mesh` hidden). */
  private used = false;

  constructor(data: RarcArchive) {
    const [bed, clouds, noise] = ["timg/kawazoko.bti", "timg/kumo_env.bti", "timg/noize_kawazoko_1.bti"].map((p) => repeatTexture(data, p));
    if (!bed || !clouds || !noise) {
      this.mesh = null;
      return;
    }
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          uBed: { value: bed },
          uClouds: { value: clouds },
          uNoise: { value: noise },
          uOrigin: { value: new THREE.Vector2() },
          uCam: { value: new THREE.Vector2() },
          uFrame: { value: 0 },
          uCloud: { value: 0 },
        },
      }),
    );
    this.mesh.renderOrder = -20;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /**
   * Shows it under an area `w` × `h` px from (0, 0) (world px = area px + `origin`, the room's grid cell as the
   * texture mappings see it), at depth `z` (below the base layer).
   */
  show(origin: { x: number; y: number }, z: number, w = ROOM_W, h = ROOM_H): void {
    if (!this.mesh) return;
    this.mesh.scale.set(w + 2 * MARGIN, h + 2 * MARGIN, 1);
    this.mesh.position.set(w / 2, -h / 2, z);
    (this.mesh.material.uniforms.uOrigin!.value as THREE.Vector2).set(origin.x, origin.y);
    this.mesh.visible = true;
  }

  hide(): void {
    if (this.mesh) this.mesh.visible = false;
  }

  /**
   * Another quad with the same material, over `w` × `h` world px from (`x`, `y`) at depth `z`, for a view that lays
   * several rooms out at their world places (apps/game: one per room with the river bed; the texture mappings see
   * world px, the origin left at 0). `update` moves them all.
   */
  quad(x: number, y: number, w: number, h: number, z: number): THREE.Mesh | null {
    if (!this.mesh) return null;
    const mesh = new THREE.Mesh(this.mesh.geometry, this.mesh.material);
    mesh.scale.set(w, h, 1);
    mesh.position.set(x + w / 2, -(y + h / 2), z);
    mesh.renderOrder = this.mesh.renderOrder;
    mesh.frustumCulled = false;
    this.used = true;
    return mesh;
  }

  /** Per frame: the camera center (area px), the environment's frame counter and the cloud shadows' level (0-255). */
  update(camera: { x: number; y: number }, frame: number, cloudLevel: number): void {
    if (!this.mesh || (!this.mesh.visible && !this.used)) return;
    const u = this.mesh.material.uniforms, origin = u.uOrigin!.value as THREE.Vector2;
    (u.uCam!.value as THREE.Vector2).set(camera.x + origin.x, camera.y + origin.y);
    u.uFrame!.value = frame;
    u.uCloud!.value = Math.min(Math.floor((cloudLevel * 120) / 47), 120) / 255;
  }

  dispose(): void {
    if (!this.mesh) return;
    for (const t of ["uBed", "uClouds", "uNoise"]) (this.mesh.material.uniforms[t]!.value as THREE.Texture).dispose();
    this.mesh.material.dispose();
    this.mesh.geometry.dispose();
  }
}
