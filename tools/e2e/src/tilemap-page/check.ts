// Browser side of the GPU tilemap check (driven by ../tilemap.ts): renders room layers with packages/render's
// tilemap shader into a render target and compares them with packages/formats' software drawLayer, at several
// ticks (animated tiles), with and without the ground overlay, and after a runtime palette switch.
import {
  animateChars,
  applyOverlay,
  createImage,
  decompressYaz0,
  drawLayer,
  isYaz0,
  LAYER_PIXELS,
  loadOverlay,
  loadTileset,
  parseRarc,
  Stage,
  type RarcArchive,
  type Tileset,
} from "@fso/formats";
import { overlayTexture, ROOM_H, ROOM_W, roomQuad, TilemapTextures } from "@fso/render";
import * as THREE from "three";

export interface CheckResult {
  stage: string;
  case: string; // "plain", "overlay" or "dark palette"
  layers: number;
  pixels: number;
  mismatched: number;
  maxDiff: number;
}

const params = new URLSearchParams(location.search);
const stages = (params.get("stages") ?? "boss010").split(",");
const ticks = (params.get("ticks") ?? "0,10,25,1000").split(",").map(Number);

async function archive(path: string): Promise<RarcArchive> {
  const bytes = new Uint8Array(await (await fetch(`/game/${path}`)).arrayBuffer());
  return parseRarc(isYaz0(bytes) ? decompressYaz0(bytes) : bytes);
}

const renderer = new THREE.WebGLRenderer({ antialias: false });
const target = new THREE.WebGLRenderTarget(ROOM_W, ROOM_H, { depthBuffer: false });
const gpu = new Uint8Array(ROOM_W * ROOM_H * 4);

function renderGpu(mesh: THREE.Mesh, origin: { x: number; y: number }): Uint8Array {
  const scene = new THREE.Scene();
  scene.add(mesh);
  const camera = new THREE.OrthographicCamera(origin.x, origin.x + ROOM_W, -origin.y, -origin.y - ROOM_H, -10, 10);
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.readRenderTargetPixels(target, 0, 0, ROOM_W, ROOM_H, gpu);
  mesh.geometry.dispose();
  const material = mesh.material as THREE.ShaderMaterial;
  (material.uniforms.uLayer!.value as THREE.Texture).dispose();
  material.dispose();
  return gpu;
}

function compare(result: CheckResult, pixels: Uint8Array, expected: Uint8Array): void {
  result.layers++;
  for (let y = 0; y < ROOM_H; y++) {
    for (let x = 0; x < ROOM_W; x++) {
      const g = ((ROOM_H - 1 - y) * ROOM_W + x) * 4, s = (y * LAYER_PIXELS + x) * 4;
      let diff = 0;
      for (let c = 0; c < 4; c++) diff = Math.max(diff, Math.abs(pixels[g + c]! - expected[s + c]!));
      result.pixels++;
      if (diff) result.mismatched++;
      result.maxDiff = Math.max(result.maxDiff, diff);
    }
  }
}

async function run(): Promise<CheckResult[]> {
  const data = await archive("data.arc");
  const results: CheckResult[] = [];
  for (const name of stages) {
    const stage = new Stage(await archive(`Boss/${name}.arc`));
    const tileset = loadTileset(data, stage.layout.tilesetIndex);
    const overlay = loadOverlay(data, stage.layout.overlayTextureId);
    const filter = overlay ? overlayTexture(overlay) : null;
    const tiles = new TilemapTextures(tileset);
    const cases = (["plain", "overlay", "dark palette"] as const).filter((c) => c !== "overlay" || overlay);
    const byCase = new Map(cases.map((c) => [c, { stage: name, case: c, layers: 0, pixels: 0, mismatched: 0, maxDiff: 0 }]));
    const cells = stage.layout.rooms.flatMap((row, cy) => row.flatMap((room, cx) => (room === null ? [] : [{ room, cx, cy }])));
    for (const kase of cases) {
      const variant: Tileset = kase === "dark palette" ? loadTileset(data, stage.layout.tilesetIndex, "dark") : tileset;
      tiles.setPalettes(variant.palettes);
      for (const tick of ticks) {
        tiles.setTick(tick);
        const software: Tileset = { ...variant, chars: animateChars(variant.chars, variant.animations ?? [], tick) };
        for (const { room, cx, cy } of cells) {
          const origin = { x: cx * ROOM_W, y: cy * ROOM_H };
          for (const group of [1, 2] as const) {
            const layer = stage.layer(room, group);
            if (!layer) continue;
            const image = createImage(LAYER_PIXELS, LAYER_PIXELS);
            drawLayer(image, software, layer);
            // Origins are multiples of 128 px, so the room-local software overlay is also world-anchored.
            if (kase === "overlay") applyOverlay(image, overlay!);
            compare(byCase.get(kase)!, renderGpu(roomQuad(layer, tiles, kase === "overlay" ? filter : null, origin, 0), origin), image.data);
          }
        }
      }
    }
    tiles.dispose();
    filter?.dispose();
    results.push(...byCase.values());
    document.getElementById("log")!.textContent = JSON.stringify(results, null, 1);
  }
  return results;
}

const w = window as unknown as { tilemapCheck?: CheckResult[] | { error: string } };
run().then(
  (results) => (w.tilemapCheck = results),
  (error: Error) => (w.tilemapCheck = { error: `${error.message}\n${error.stack}` }),
);
