// Actor markers: a dot at each actor's position and its 4-char ID above it, batched into two meshes per stage
// (labels come from one canvas atlas with a cell per ID). World units are room pixels, y down (negated in three.js).
import { actorPixel, type Actor, type ActorType } from "@fso/formats";
import * as THREE from "three";

export interface PlacedActor {
  room: number;
  actor: Actor;
  /** World position (room origin + actor position), in room pixels. */
  x: number;
  y: number;
}

const LABEL_W = 26, LABEL_H = 10, LABEL_GAP = 3; // world px; the label sits centered above the dot
const DOT = 4;
const CELL_W = 104, CELL_H = 40; // atlas px per label (4× the world size, so labels stay sharp when zoomed in)
const ATLAS_COLUMNS = 8;

/** Marker color by kind: enemies (killable per enemyparam.csv), player starts, warps, everything else. */
export function actorColor(id: string, type: ActorType | undefined): string {
  if (id === "PLAS") return "#6cf07a";
  if (id === "WARP" || id === "GLWP" || id === "TLWP" || id === "DWAP") return "#5ad8ff";
  if (type?.stats.dstr === 1) return "#ff6b5e";
  return "#ffd54a";
}

export function placeActors(rooms: { room: number; origin: { x: number; y: number }; actors: Actor[] }[], sublayer: number): PlacedActor[] {
  return rooms.flatMap(({ room, origin, actors }) =>
    actors
      .filter((a) => a.sublayer === sublayer)
      .map((actor) => {
        const p = actorPixel(actor);
        return { room, actor, x: origin.x + p.x, y: origin.y + p.y };
      }),
  );
}

/** Two meshes (dots, labels) for all placed actors, drawn at depth `z`. */
export function actorMarkers(placed: PlacedActor[], types: Map<string, ActorType> | null, z: number): THREE.Object3D[] {
  if (placed.length === 0) return [];
  const ids = [...new Set(placed.map((p) => p.actor.id))].sort();
  const cell = new Map(ids.map((id, i) => [id, i]));
  const rows = Math.ceil(ids.length / ATLAS_COLUMNS);
  const canvas = document.createElement("canvas");
  canvas.width = CELL_W * ATLAS_COLUMNS;
  canvas.height = CELL_H * rows;
  const ctx = canvas.getContext("2d")!;
  ctx.font = `bold ${CELL_H - 10}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ids.forEach((id, i) => {
    const x = (i % ATLAS_COLUMNS) * CELL_W, y = Math.floor(i / ATLAS_COLUMNS) * CELL_H;
    ctx.fillStyle = "rgba(10, 12, 16, 0.78)";
    ctx.fillRect(x, y, CELL_W, CELL_H);
    ctx.strokeStyle = actorColor(id, types?.get(id));
    ctx.lineWidth = 4;
    ctx.strokeRect(x + 2, y + 2, CELL_W - 4, CELL_H - 4);
    ctx.fillStyle = "#fff";
    ctx.fillText(id, x + CELL_W / 2, y + CELL_H / 2 + 1);
  });
  const atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;

  const n = placed.length;
  const labelPos = new Float32Array(n * 12), labelUv = new Float32Array(n * 8);
  const dotPos = new Float32Array(n * 12), dotColor = new Float32Array(n * 12);
  const index = new Uint32Array(n * 6);
  const color = new THREE.Color();
  placed.forEach((p, i) => {
    const quad = (out: Float32Array, x0: number, y0: number, x1: number, y1: number) =>
      out.set([x0, -y0, 0, x1, -y0, 0, x0, -y1, 0, x1, -y1, 0], i * 12);
    const top = p.y - LABEL_GAP - LABEL_H;
    quad(labelPos, p.x - LABEL_W / 2, top, p.x + LABEL_W / 2, top + LABEL_H);
    quad(dotPos, p.x - DOT / 2, p.y - DOT / 2, p.x + DOT / 2, p.y + DOT / 2);
    const c = cell.get(p.actor.id)!;
    const u0 = (c % ATLAS_COLUMNS) / ATLAS_COLUMNS, u1 = u0 + 1 / ATLAS_COLUMNS;
    const v1 = 1 - Math.floor(c / ATLAS_COLUMNS) / rows, v0 = v1 - 1 / rows;
    labelUv.set([u0, v1, u1, v1, u0, v0, u1, v0], i * 8);
    color.set(actorColor(p.actor.id, types?.get(p.actor.id)));
    for (let k = 0; k < 4; k++) dotColor.set([color.r, color.g, color.b], i * 12 + k * 3);
    index.set([0, 2, 1, 1, 2, 3].map((v) => v + i * 4), i * 6);
  });

  const labels = new THREE.BufferGeometry();
  labels.setAttribute("position", new THREE.BufferAttribute(labelPos, 3));
  labels.setAttribute("uv", new THREE.BufferAttribute(labelUv, 2));
  labels.setIndex(new THREE.BufferAttribute(index, 1));
  const dots = new THREE.BufferGeometry();
  dots.setAttribute("position", new THREE.BufferAttribute(dotPos, 3));
  dots.setAttribute("color", new THREE.BufferAttribute(dotColor, 3));
  dots.setIndex(new THREE.BufferAttribute(index.slice(), 1));

  const labelMesh = new THREE.Mesh(labels, new THREE.MeshBasicMaterial({ map: atlas, transparent: true, depthTest: false }));
  const dotMesh = new THREE.Mesh(dots, new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: false }));
  labelMesh.position.z = z;
  dotMesh.position.z = z + 0.1;
  labelMesh.renderOrder = dotMesh.renderOrder = 10;
  return [labelMesh, dotMesh];
}

/** The actor under a world point: its dot (within `radius` px) first, then its label box. */
export function actorAt(placed: PlacedActor[], x: number, y: number, radius: number): PlacedActor | null {
  let best: PlacedActor | null = null, bestD = radius * radius;
  for (const p of placed) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d <= bestD) [best, bestD] = [p, d];
  }
  if (best) return best;
  for (let i = placed.length - 1; i >= 0; i--) {
    const p = placed[i]!, top = p.y - LABEL_GAP - LABEL_H;
    if (Math.abs(x - p.x) <= LABEL_W / 2 && y >= top && y <= top + LABEL_H) return p;
  }
  return null;
}
