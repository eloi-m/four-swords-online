// three.js helpers for stage rooms (tile layers themselves are in tilemap.ts). World units are room pixels: x grows
// right, y grows down, and y is negated when placed in three.js space. Colors pass through untouched (no color space
// conversion), so they stay exact 8-bit values.
import { LAYER_PIXELS, LAYER_TILES, solidMask, surfaceOf, TILE_SIZE, type DecodedTexture } from "@fso/formats";
import * as THREE from "three";

export const ROOM_W = LAYER_PIXELS;
export const ROOM_H = 384; // the TV shows the top 24 of 32 tile rows
const TV_ROWS = ROOM_H / TILE_SIZE;

export interface Point {
  x: number;
  y: number;
}

export const NO_FILTER = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
NO_FILTER.needsUpdate = true;
NO_FILTER.userData.shared = true;

/** The ground overlay texture, repeated in world space (see packages/formats/src/fsa/overlay.ts). */
export function overlayTexture(overlay: DecodedTexture): THREE.DataTexture {
  // With flipY off, data row n is sampled at v = n / height, i.e. room pixel row n, since room y grows downwards.
  const texture = new THREE.DataTexture(overlay.data, overlay.width, overlay.height, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Collision overlay from a base layer: red = solid quadrant, cyan = water, black = pit. */
export function collisionQuad(layer: Uint16Array, tileTypes: Uint16Array, origin: Point, z: number): THREE.Mesh {
  const pixels = new Uint8Array(ROOM_W * ROOM_H * 4);
  for (let ty = 0; ty < TV_ROWS; ty++) {
    for (let tx = 0; tx < LAYER_TILES; tx++) {
      const type = tileTypes[layer[ty * LAYER_TILES + tx]! & 0x3ff]!;
      const mask = solidMask(type), surface = surfaceOf(type);
      for (let q = 0; q < 4; q++) {
        const rgba = mask & (1 << q)
          ? [255, 40, 40, 110]
          : surface === "deep" || surface === "shallow"
            ? [0, 230, 255, 90]
            : surface === "pit"
              ? [0, 0, 0, 150]
              : null;
        if (!rgba) continue;
        for (let y = 0; y < 8; y++) {
          const row = ROOM_H - 1 - (ty * TILE_SIZE + (q >> 1) * 8 + y);
          for (let x = 0; x < 8; x++) pixels.set(rgba, (row * ROOM_W + tx * TILE_SIZE + (q & 1) * 8 + x) * 4);
        }
      }
    }
  }
  const texture = new THREE.DataTexture(pixels, ROOM_W, ROOM_H, THREE.RGBAFormat);
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_H), material);
  mesh.position.set(origin.x + ROOM_W / 2, -(origin.y + ROOM_H / 2), z);
  return mesh;
}

/** Removes and frees every child of a group (geometries, materials, and the textures they reference, except shared ones). */
export function disposeChildren(group: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>();
  for (const child of [...group.children]) {
    group.remove(child);
    if (child instanceof THREE.Mesh || child instanceof THREE.Sprite || child instanceof THREE.LineLoop) {
      child.geometry.dispose();
      const material = child.material as THREE.Material & {
        map?: THREE.Texture | null;
        uniforms?: Record<string, { value: unknown }>;
      };
      if (material.map) textures.add(material.map);
      for (const uniform of Object.values(material.uniforms ?? {})) {
        if (uniform.value instanceof THREE.Texture && !uniform.value.userData.shared) textures.add(uniform.value);
      }
      material.dispose();
    }
  }
  for (const texture of textures) texture.dispose();
}
