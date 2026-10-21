// Checkpoint A helper: fits the camera transform (uniform scale + offset) that maps our room render onto a
// Dolphin frame dump, then writes a side-by-side image [Dolphin | ours, resampled | |diff| × 4].
//   node tools/render/src/compare.ts <our-room.png> <dolphin-frame.png> <out.png> [scale x0 y0 initial guess]
// The Dolphin frame also contains sprites, HUD and the ground overlay texture, so the residual is never zero;
// it is a measure of how well tile layout and palette colors agree.
import { readFileSync, writeFileSync } from "node:fs";
import { decodePng, encodePng } from "./png.ts";

type Image = { width: number; height: number; data: Uint8Array };

const [oursPath, framePath, out = "out/compare.png", ...guess] = process.argv.slice(2);
if (!oursPath || !framePath) {
  console.error("usage: compare <our-room.png> <dolphin-frame.png> [out.png] [scale x0 y0]");
  process.exit(1);
}
const ours = decodePng(readFileSync(oursPath));
const frame = decodePng(readFileSync(framePath));

const luma = (img: Image, i: number) => 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;

function cost(s: number, x0: number, y0: number, step: number): number {
  let sum = 0;
  let n = 0;
  for (let fy = 0; fy < frame.height; fy += step) {
    const oy = Math.floor(y0 + fy / s);
    if (oy < 0 || oy >= ours.height) return Infinity;
    for (let fx = 0; fx < frame.width; fx += step) {
      const ox = Math.floor(x0 + fx / s);
      if (ox < 0 || ox >= ours.width) return Infinity;
      sum += Math.abs(luma(frame, (fy * frame.width + fx) * 4) - luma(ours, (oy * ours.width + ox) * 4));
      n++;
    }
  }
  return sum / n;
}

// Coarse-to-fine local search around the initial guess.
let [s, x0, y0] = guess.length === 3 ? guess.map(Number) as [number, number, number] : [2.1, 226, 30];
let best = cost(s, x0, y0, 8);
for (const [ds, dxy, step, radius] of [[0.01, 1, 8, 12], [0.002, 0.25, 4, 6], [0.0005, 0.0625, 2, 4]] as const) {
  let improved = true;
  while (improved) {
    improved = false;
    const center: [number, number, number] = [s, x0, y0];
    for (let i = -radius; i <= radius; i++) {
      for (let j = -radius; j <= radius; j++) {
        for (let k = -radius; k <= radius; k++) {
          const c = cost(center[0] + i * ds, center[1] + j * dxy, center[2] + k * dxy, step);
          if (c < best) {
            best = c;
            [s, x0, y0] = [center[0] + i * ds, center[1] + j * dxy, center[2] + k * dxy];
            improved = true;
          }
        }
      }
    }
  }
}
const finalCost = cost(s, x0, y0, 1);

// Side-by-side output.
const w = frame.width, h = frame.height;
const sheet = new Uint8Array(w * 3 * h * 4);
for (let fy = 0; fy < h; fy++) {
  for (let fx = 0; fx < w; fx++) {
    const f = (fy * w + fx) * 4;
    const o = (Math.floor(y0 + fy / s) * ours.width + Math.floor(x0 + fx / s)) * 4;
    for (let c = 0; c < 3; c++) {
      const a = frame.data[f + c]!, b = ours.data[o + c]!;
      sheet[(fy * w * 3 + fx) * 4 + c] = a;
      sheet[(fy * w * 3 + w + fx) * 4 + c] = b;
      sheet[(fy * w * 3 + 2 * w + fx) * 4 + c] = Math.min(255, Math.abs(a - b) * 4);
    }
    for (let p = 0; p < 3; p++) sheet[(fy * w * 3 + p * w + fx) * 4 + 3] = 255;
  }
}
writeFileSync(out, encodePng(w * 3, h, sheet));
console.log(
  `fit: scale ${s.toFixed(4)}, room origin (${x0.toFixed(2)}, ${y0.toFixed(2)}), ` +
    `visible ${(w / s).toFixed(1)}x${(h / s).toFixed(1)} room px; mean |luma diff| ${finalCost.toFixed(2)} -> ${out}`,
);
