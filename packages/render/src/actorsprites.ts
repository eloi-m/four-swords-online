// Static actor sprites (docs/formats/sprites-and-actors.md, "Actor graphics"): every SOB piece of every placed actor in one atlas and one
// batched mesh, plus a quad per stage BTI piece. Pieces are ordered by their anchor's y so lower ones are drawn over
// higher ones, as in the game. World units are room pixels, y down (negated in three.js space), like the tilemap.
import {
  piecePaletteMap,
  type ActorPiece,
  type ActorSob,
  type DecodedTexture,
  type SpriteFrame,
  type SpriteSheet,
} from "@fso/formats";
import * as THREE from "three";
import { SpriteAtlas } from "./sprites.ts";

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Colors are written as decoded (no color-space conversion), like the tile and Link sprite shaders.
const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  void main() {
    vec4 color = texture2D(uMap, vUv);
    if (color.a < 0.5) discard;
    gl_FragColor = vec4(color.rgb, 1.0);
  }
`;

export interface ActorSpriteSources {
  sheet: SpriteSheet;
  /** Loaded SOB lists (`loadSob(data, ACTOR_SOB_FILES[key])`); pieces from missing lists are skipped. */
  sobs: Partial<Record<ActorSob, SpriteFrame[]>>;
  /** Decoded BTI by file name (the stage's `timg/<file>`, data.arc's with `archive` "data"), for texture pieces. */
  texture?: (file: string, archive?: "data") => DecodedTexture | null;
}

/** An actor's pieces anchored at a world position (room origin + actor position). */
export interface PlacedPieces {
  x: number;
  y: number;
  pieces: readonly ActorPiece[];
}

const material = (map: THREE.Texture) =>
  new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: { uMap: { value: map } } });

function quadGeometry(
  quads: { x0: number; y0: number; x1: number; y1: number; uv: [number, number, number, number]; z?: number }[],
): THREE.BufferGeometry {
  const pos = new Float32Array(quads.length * 12), uvs = new Float32Array(quads.length * 8), index = new Uint32Array(quads.length * 6);
  quads.forEach((q, i) => {
    // Later quads sit very slightly in front, so the draw order also holds with depth testing.
    const z = (q.z ?? 0) + i * 1e-5;
    pos.set([q.x0, -q.y0, z, q.x1, -q.y0, z, q.x0, -q.y1, z, q.x1, -q.y1, z], i * 12);
    const [u0, v0, u1, v1] = q.uv;
    uvs.set([u0, v1, u1, v1, u0, v0, u1, v0], i * 8);
    index.set([0, 2, 1, 1, 2, 3].map((v) => v + i * 4), i * 6);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

function btiTexture(tex: DecodedTexture): THREE.DataTexture {
  // Rows bottom-up for WebGL.
  const row = tex.width * 4, flipped = new Uint8Array(tex.data.length);
  for (let y = 0; y < tex.height; y++) flipped.set(tex.data.subarray(y * row, (y + 1) * row), (tex.height - 1 - y) * row);
  const t = new THREE.DataTexture(flipped, tex.width, tex.height, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

export interface ActorSpriteOptions {
  /**
   * Depth added per pixel of a piece's anchor y, so the pieces sort against other sprites placed at
   * z + y × depthPerPixel (apps/battle draws its Links at 2 + y / 1024). Default 0: every piece at `z`.
   */
  depthPerPixel?: number;
}

/**
 * Meshes for static actors at depth `z` (the viewer puts them between the base layer at 1 and the top layer at 2).
 * Returns an empty list when nothing is drawable.
 */
export function actorSpriteMeshes(src: ActorSpriteSources, placed: readonly PlacedPieces[], z: number, options: ActorSpriteOptions = {}): THREE.Mesh[] {
  const perPixel = options.depthPerPixel ?? 0;
  // One atlas frame per distinct (list, frame, palette substitutions).
  const keys = new Map<string, number>();
  const frames: SpriteFrame[] = [];
  const frameOf = (piece: Extract<ActorPiece, { kind: "sprite" }>): number | null => {
    const frame = src.sobs[piece.sob]?.[piece.frame];
    if (!frame) return null;
    const key = `${piece.sob}/${piece.frame}/${JSON.stringify(piece.palettes ?? {})}`;
    let slot = keys.get(key);
    if (slot === undefined) {
      const remap = piecePaletteMap(piece);
      keys.set(key, (slot = frames.length));
      frames.push(remap ? frame.map((part) => ({ ...part, palette: remap(part.palette) })) : frame);
    }
    return slot;
  };
  const sprites: { x: number; y: number; slot: number; size: number }[] = [];
  const textures: { x: number; y: number; file: string; archive?: "data" }[] = [];
  for (const p of placed) {
    for (const piece of p.pieces) {
      if (piece.kind === "bti") {
        textures.push({ x: p.x + piece.dx, y: p.y + piece.dy, file: piece.file, ...(piece.archive ? { archive: piece.archive } : {}) });
        continue;
      }
      const slot = frameOf(piece);
      if (slot !== null) sprites.push({ x: p.x + piece.dx, y: p.y + piece.dy, slot, size: piece.size ?? 1 });
    }
  }
  // Each piece is ordered by its own anchor (stable), so e.g. a rock drawn 8 px low covers what hides under it.
  sprites.sort((a, b) => a.y - b.y);

  const meshes: THREE.Mesh[] = [];
  if (sprites.length) {
    const atlas = new SpriteAtlas(src.sheet, frames);
    const quads = sprites.flatMap(({ x, y, slot, size }) => {
      const r = atlas.rects[slot]!;
      if (!r.w) return [];
      // (A scaled piece grows about its anchor.)
      const x0 = x + r.dx * size, y0 = y + r.dy * size;
      return [{ x0, y0, x1: x0 + r.w * size, y1: y0 + r.h * size, uv: atlas.uv(slot), z: y * perPixel }];
    });
    const mesh = new THREE.Mesh(quadGeometry(quads), material(atlas.texture));
    mesh.position.z = z;
    mesh.name = "actor sprites";
    meshes.push(mesh);
  }
  const cache = new Map<string, THREE.DataTexture | null>();
  for (const t of textures) {
    const key = `${t.archive ?? "stage"}/${t.file}`;
    if (!cache.has(key)) {
      const decoded = src.texture?.(t.file, t.archive) ?? null;
      cache.set(key, decoded ? btiTexture(decoded) : null);
    }
    const tex = cache.get(key);
    if (!tex) continue;
    const { width: w, height: h } = tex.image;
    const x0 = Math.round(t.x - w / 2), y0 = Math.round(t.y - h / 2);
    const mesh = new THREE.Mesh(quadGeometry([{ x0, y0, x1: x0 + w, y1: y0 + h, uv: [0, 0, 1, 1] }]), material(tex));
    mesh.position.z = z - 0.01; // under the sprites
    mesh.name = `actor texture ${t.file}`;
    meshes.push(mesh);
  }
  return meshes;
}
