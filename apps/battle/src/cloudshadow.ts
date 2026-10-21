// Cloud shadows drifting over the ground of The Field and Hyrule Castle, as main.dol's environment manager draws them
// (drawer 0x8016ADE0; docs/formats/battle-arenas.md "Cloud shadows"): data.arc timg/kumo_env.bti (I4) as a black layer whose alpha
// is the texture's intensity times the manager's +0x1EC level, over the base layer and every sprite but under the top
// layer. The level comes from the room's SWEV bit 21: 47 × (the stage light when SWEV starts) / 255, reached one step
// per frame from 0. Texture coordinates are world-anchored, one repeat per room (s = x / 512, t = y / 384), and drift
// by 1/2048 of a repeat per frame (the manager's frame counter & 0x7FF).
import { decodeBti, type RarcArchive, type Stage } from "@fso/formats";
import { ROOM_H, ROOM_W } from "@fso/render";
import * as THREE from "three";
import { LTEV_KINDS } from "./lights.ts";

/** The cloud shadows' level (0-255) in a boss500 room, 0 for none. */
export function cloudShadowLevel(stage: Stage, room: number): number {
  const actors = stage.actors(room).filter((a) => a.sublayer === 0);
  const swev = actors.findIndex((a) => a.id === "SWEV");
  if (swev < 0 || !((actors[swev]!.params >>> 21) & 1)) return 0;
  // SWEV reads the stage light in its init: an LTEV listed before it has already set its level (actors start in list order).
  const ltev = actors.findIndex((a) => a.id === "LTEV");
  const light = ltev >= 0 && ltev < swev ? (LTEV_KINDS[actors[ltev]!.params & 0xff]?.[3] ?? 255) : 255;
  return Math.floor((47 * light) / 255);
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
  uniform sampler2D uClouds;
  uniform float uLevel;
  uniform float uDrift;
  varying vec2 vWorld;
  void main() {
    float i = texture2D(uClouds, vWorld / vec2(${ROOM_W}.0, ${ROOM_H}.0) - uDrift).r;
    gl_FragColor = vec4(0.0, 0.0, 0.0, i * uLevel);
  }
`;

export class CloudShadow {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null;
  private level = 0;

  constructor(data: RarcArchive) {
    const file = data.files.find((f) => f.path === "timg/kumo_env.bti");
    if (!file) {
      this.mesh = null;
      return;
    }
    const image = decodeBti(file.data);
    // Rows top-down with flipY off: texture row n is sampled at t = n / height, as GX's t grows downwards.
    const texture = new THREE.DataTexture(image.data, image.width, image.height, THREE.RGBAFormat);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_W, ROOM_H),
      new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: { uClouds: { value: texture }, uLevel: { value: 0 }, uDrift: { value: 0 } },
        transparent: true,
        depthWrite: false, // the top layer (drawn nearer) still hides it; the sprites under it are shaded
      }),
    );
    this.mesh.visible = false;
  }

  /** A new arena: its level and the depth to draw at (above the sprites, below the top layer). */
  show(stage: Stage, room: number, z: number): void {
    this.level = cloudShadowLevel(stage, room);
    if (!this.mesh) return;
    this.mesh.position.set(ROOM_W / 2, -ROOM_H / 2, z);
    this.mesh.visible = this.level > 0;
  }

  /**
   * Another quad with the same material over the room whose top left is world px (`x`, `y`), at depth `z`, for a view
   * that lays its rooms out on the stage grid (apps/game); the room's `level` (cloudShadowLevel) becomes the shared one.
   */
  quad(x: number, y: number, z: number, level: number): THREE.Mesh | null {
    if (!this.mesh || level <= 0) return null;
    this.level = Math.max(this.level, level);
    const mesh = new THREE.Mesh(this.mesh.geometry, this.mesh.material);
    mesh.position.set(x + ROOM_W / 2, -(y + ROOM_H / 2), z);
    return mesh;
  }

  /** No cloud shadows (free play's map). */
  hide(): void {
    this.level = 0;
    if (this.mesh) this.mesh.visible = false;
  }

  /** The level (0-255) `tick` frames into the arena (it rises one step a frame). */
  levelAt(tick: number): number {
    return Math.min(this.level, tick);
  }

  /** Per frame: the environment's frame counter (the battle's tick). */
  update(tick: number): void {
    if (!this.mesh || !this.level) return;
    const u = this.mesh.material.uniforms;
    u.uLevel!.value = this.levelAt(tick) / 255;
    u.uDrift!.value = (tick & 0x7ff) / 2048;
  }
}
