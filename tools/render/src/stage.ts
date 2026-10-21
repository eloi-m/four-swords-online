// Renders every room of a stage at its grid position (TV view, 512×384 per room) to one PNG.
//   node tools/render/src/stage.ts <stage e.g. boss010> <out.png> [scale divisor, default 2] [extractedDir]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createImage, decompressYaz0, drawLayer, LAYER_PIXELS, loadTileset, parseRarc, Stage } from "@fso/formats";
import { encodePng } from "./png.ts";

const TV_HEIGHT = 384; // the TV shows the top 24 of the 32 tile rows

const [stageName = "boss010", out = "out/stage.png", divArg = "2", extracted = "extracted"] = process.argv.slice(2);
const root = join(extracted, "files/GC4Sword_usa");
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(join(root, path))));
const stage = new Stage(load(`Boss/${stageName}.arc`));
const tileset = loadTileset(load("data.arc"), stage.layout.tilesetIndex);
const div = Number.parseInt(divArg, 10);

const cells = stage.layout.rooms.flatMap((row, y) => row.map((room, x) => ({ room, x, y }))).filter((c) => c.room !== null);
const minX = Math.min(...cells.map((c) => c.x)), maxX = Math.max(...cells.map((c) => c.x));
const minY = Math.min(...cells.map((c) => c.y)), maxY = Math.max(...cells.map((c) => c.y));
const roomW = Math.floor(LAYER_PIXELS / div), roomH = Math.floor(TV_HEIGHT / div);
const map = createImage((maxX - minX + 1) * roomW, (maxY - minY + 1) * roomH);

for (const { room, x, y } of cells) {
  const image = createImage(LAYER_PIXELS, LAYER_PIXELS);
  for (const group of [1, 2] as const) {
    const layer = stage.layer(room!, group, 0);
    if (layer) drawLayer(image, tileset, layer);
  }
  const ox = (x - minX) * roomW, oy = (y - minY) * roomH;
  for (let py = 0; py < roomH; py++) {
    for (let px = 0; px < roomW; px++) {
      const src = (py * div * LAYER_PIXELS + px * div) * 4;
      map.data.set(image.data.subarray(src, src + 4), ((oy + py) * map.width + ox + px) * 4);
    }
  }
}
writeFileSync(out, encodePng(map.width, map.height, map.data));
console.log(`${stageName}: ${cells.length} rooms -> ${out} (${map.width}x${map.height})`);
