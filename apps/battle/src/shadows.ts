// Sprite shadows as main.dol draws them (docs/formats/battle-arenas.md "Shadows"; the Link's in 0x80264998, the actors' through
// 0x801EF830). They lie on the ground at the sprite's (x, y), whatever its height, under the sprite:
// - A Link's shadow is his own current player_sob frame squashed 0.9 × 0.5 about its anchor and drawn at height -5,
//   which the renderer turns into a further 192 / 197 scale and 5 px lower, as a flat (40, 40, 40) silhouette at
//   opacity 159 (max(79, 159 - z / 2) in the air).
// - Actors pass a shadow spec to their draw call: kage_sob.bin frame 0 (a 12×6 ellipse: bombs, item pickups) or 1
//   (6×4: bees, heart pickups), texture colors (41, 41, 41), opacity 223 (max(159, 223 - z / 2) in the air), not drawn
//   on ground types 0x02 (background), 0x03 (pit) or 0x0E (damaging pit).
// Also here: sprites drawn above the ground grow by 192 / (192 - min(z, 96)) about their anchor (the renderer's
// perspective for anything at a height).
import type { SpriteAtlas } from "@fso/render";
import * as THREE from "three";

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The sprite's pixels (same alpha test as packages/render sprites.ts), in its own colors or a flat one, see-through.
const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uFlat;
  uniform float uUseFlat;
  uniform float uOpacity;
  uniform vec3 uTint;
  varying vec2 vUv;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    if (t.a < 0.5) discard;
    gl_FragColor = vec4(mix(min(t.rgb * uTint, 1.0), uFlat, uUseFlat), uOpacity);
  }
`;

/** The Link shadow's flat color and opacities (0-255). */
export const LINK_SHADOW = { color: [40, 40, 40] as const, opacity: 159, minOpacity: 79, scaleX: 0.9, scaleY: 0.5, height: -5 };
/** Actor shadows (kage_sob.bin): the frame per kind, opacities (0-255). */
export const ACTOR_SHADOW = { opacity: 223, minOpacity: 159 };
/** Ground types that show no actor shadow. */
export const NO_SHADOW_GROUND: ReadonlySet<number> = new Set([0x02, 0x03, 0x0e]);

/** The renderer's growth of a sprite at height z (px) about its anchor. */
export const heightScale = (z: number) => (z === 0 ? 1 : 192 / (192 - Math.min(z, 96)));

/**
 * Scales an atlas sprite already placed with its anchor at world pixel (x, y) by `s` about that anchor (1 resets it:
 * pooled sprite meshes keep their last scale when the frame doesn't change).
 */
export function growAboutAnchor(mesh: THREE.Mesh, atlas: SpriteAtlas, frame: number, x: number, y: number, s: number): void {
  const r = atlas.rects[frame];
  if (!r || r.w === 0) return;
  mesh.scale.set(r.w * s, r.h * s, 1);
  mesh.position.x = x + s * (r.dx + r.w / 2);
  mesh.position.y = -(y + s * (r.dy + r.h / 2));
}

/** A see-through copy of an atlas frame, scaled about its anchor. */
export class ShadowSprite extends THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  private readonly atlas: SpriteAtlas;
  private frame = -1;

  constructor(atlas: SpriteAtlas, flat: readonly [number, number, number] | null) {
    super(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          uMap: { value: atlas.texture },
          uFlat: { value: new THREE.Vector3(...(flat ?? [0, 0, 0]).map((c) => c / 255)) },
          uUseFlat: { value: flat ? 1 : 0 },
          uOpacity: { value: 1 },
          uTint: { value: new THREE.Vector3(1, 1, 1) },
        },
        transparent: true,
        depthWrite: false,
      }),
    );
    this.atlas = atlas;
  }

  setFrame(frame: number): void {
    if (frame === this.frame) return;
    this.frame = frame;
    const [u0, v0, u1, v1] = this.atlas.uv(frame);
    const uv = this.geometry.getAttribute("uv") as THREE.BufferAttribute;
    uv.setXY(0, u0, v1);
    uv.setXY(1, u1, v1);
    uv.setXY(2, u0, v0);
    uv.setXY(3, u1, v0);
    uv.needsUpdate = true;
  }

  /** Multiplies the frame's red, green and blue (a color matrix's diagonal: BBSL fading, scene.ts). */
  setTint(r: number, g: number, b: number): void {
    (this.material.uniforms.uTint!.value as THREE.Vector3).set(r, g, b);
  }

  /** The frame's anchor at world pixel (x, y), scaled (sx, sy) about it, at depth z, with an opacity 0-255. */
  place(x: number, y: number, z: number, sx: number, sy: number, opacity: number): void {
    const r = this.atlas.rects[this.frame];
    this.visible = !!r && r.w > 0 && opacity > 0;
    if (!r || !this.visible) return;
    this.scale.set(r.w * sx, r.h * sy, 1);
    this.position.set(x + sx * (r.dx + r.w / 2), -(y + sy * (r.dy + r.h / 2)), z);
    this.material.uniforms.uOpacity!.value = opacity / 255;
  }
}

/** A Link's shadow for his height z (px): where, how big, how dark. */
export function linkShadow(x: number, y: number, z: number): { x: number; y: number; sx: number; sy: number; opacity: number } {
  const k = heightScale(LINK_SHADOW.height); // 192 / 197
  const opacity = z > 0 ? Math.max(LINK_SHADOW.minOpacity, LINK_SHADOW.opacity - z / 2) : LINK_SHADOW.opacity;
  return { x, y: y - LINK_SHADOW.height, sx: LINK_SHADOW.scaleX * k, sy: LINK_SHADOW.scaleY * k, opacity };
}

/** An actor shadow's opacity for the actor's height z (px). */
export const actorShadowOpacity = (z: number) => (z > 0 ? Math.max(ACTOR_SHADOW.minOpacity, ACTOR_SHADOW.opacity - z / 2) : ACTOR_SHADOW.opacity);
