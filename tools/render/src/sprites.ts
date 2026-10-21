// Renders every frame of a SOB file into a numbered grid (cell index = frame index, row-major).
//   node tools/render/src/sprites.ts <sob name e.g. player_sob.bin> <out.png> [objectSheet] [palette file] [columns]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createImage, decompressYaz0, drawSprite, loadSob, loadSpriteSheet, parseRarc, playerPaletteMap, SPRITE_PALETTES } from "@fso/formats";
import { encodePng } from "./png.ts";

// Optional: FIRST=<n> COUNT=<n> SCALE=<n> MAP=7:12,15:13 environment variables select, enlarge and remap palettes.
const [sob = "player_sob.bin", out = "out/sprites.png", sheetArg = "8", palette = SPRITE_PALETTES.tv as string, colsArg = "32"] =
  process.argv.slice(2);
const first = Number(process.env.FIRST ?? 0), scale = Number(process.env.SCALE ?? 1);
const remap = new Map((process.env.MAP ?? "").split(",").filter(Boolean).map((pair) => pair.split(":").map(Number) as [number, number]));
const player = playerPaletteMap(Number(process.env.PLAYER ?? 0)); // 0 green, 1 red, 2 blue, 3 purple
const data = parseRarc(decompressYaz0(readFileSync(join("extracted/files/GC4Sword_usa/data.arc"))));
const sheet = loadSpriteSheet(data, Number.parseInt(sheetArg, 16), palette);
const all = loadSob(data, sob);
const frames = all.slice(first, first + Number(process.env.COUNT ?? all.length));
const CELL = 48, cols = Number(colsArg), rows = Math.ceil(frames.length / cols);
const image = createImage(cols * CELL, rows * CELL);
// checkerboard cells so frame bounds are visible
for (let i = 0; i < cols * rows; i++) {
  const cx = (i % cols) * CELL, cy = Math.floor(i / cols) * CELL, shade = (i + Math.floor(i / cols)) % 2 ? 60 : 72;
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) image.data.set([shade, shade, shade + 8, 255], ((cy + y) * image.width + cx + x) * 4);
}
frames.forEach((frame, i) =>
  drawSprite(image, sheet, frame, (i % cols) * CELL + CELL / 2, Math.floor(i / cols) * CELL + CELL * 0.7, (p) => remap.get(p) ?? player(p)),
);
const scaled = { width: image.width * scale, height: image.height * scale, data: new Uint8Array(image.data.length * scale * scale) };
for (let y = 0; y < scaled.height; y++) for (let x = 0; x < scaled.width; x++) {
  const s = (Math.floor(y / scale) * image.width + Math.floor(x / scale)) * 4;
  scaled.data.set(image.data.subarray(s, s + 4), (y * scaled.width + x) * 4);
}
writeFileSync(out, encodePng(scaled.width, scaled.height, scaled.data));
console.log(`${sob}: frames ${first}-${first + frames.length - 1} -> ${out} (${cols} per row, ${CELL}px cells, x${scale})`);
