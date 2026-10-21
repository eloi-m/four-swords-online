// Renders one room of a stage (TV sublayer 0: base layer then top layer) to a PNG.
//   node tools/render/src/room.ts <stage e.g. boss010> <room> <out.png> [extractedDir]
// ACTORS=1 draws the actors' sprites between the two layers (docs/formats/sprites-and-actors.md, "Actor graphics"). SUBLAYER=1-7 renders a
// GBA-screen area (a house or cave) instead, with the tileset's GBA palettes (PALETTE=tv for the TV ones).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACTOR_SOB_FILES,
  actorPieces,
  actorPixel,
  createImage,
  decodeBti,
  decompressYaz0,
  Dol,
  drawActorPieces,
  drawLayer,
  LAYER_PIXELS,
  LAYER_TILES,
  loadSob,
  loadSpriteSheet,
  loadTileset,
  parseRarc,
  readTileTypes,
  solidMask,
  Stage,
  surfaceOf,
  type ActorSob,
  type SpriteFrame,
} from "@fso/formats";
import { encodePng } from "./png.ts";

const [stageName = "boss010", roomArg = "0", out = "out/room.png", extracted = "extracted"] = process.argv.slice(2);
const root = join(extracted, "files/GC4Sword_usa");
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(join(root, path))));

const stage = new Stage(load(`Boss/${stageName}.arc`));
const data = load("data.arc");
const room = Number.parseInt(roomArg, 10);
const sublayer = Number(process.env.SUBLAYER ?? 0);
const tileset = loadTileset(data, stage.tilesetIndexOf(room), sublayer && process.env.PALETTE !== "tv" ? "gba" : "tv");
const image = createImage(LAYER_PIXELS, LAYER_PIXELS);
const base = stage.layer(room, 1, sublayer);
if (base) drawLayer(image, tileset, base);
if (process.env.ACTORS) {
  const sheet = loadSpriteSheet(data, stage.layout.npcSheetId);
  const sobs: Partial<Record<ActorSob, SpriteFrame[]>> = {};
  for (const [key, file] of Object.entries(ACTOR_SOB_FILES)) sobs[key as ActorSob] = loadSob(data, file);
  const texture = (file: string) => {
    const found = stage.archive.files.find((f) => f.path === `timg/${file}`);
    return found ? decodeBti(found.data) : null;
  };
  // Pieces are drawn by their anchor's y (textures first), so lower ones overlap higher ones as in the game.
  const pieces = stage.actors(room).filter((a) => a.sublayer === sublayer).flatMap((actor) => {
    const p = actorPixel(actor);
    return actorPieces(actor).map((piece) => ({ piece, x: p.x, y: p.y, order: piece.kind === "bti" ? -1 : p.y + piece.dy }));
  });
  pieces.sort((a, b) => a.order - b.order);
  for (const { piece, x, y } of pieces) drawActorPieces(image, sheet, sobs, [piece], x, y, texture);
}
const top = stage.layer(room, 2, sublayer);
// A GBA area whose VWMD has a top mode (params bits 12-13) blends its top layer over the rest as the GBA does
// (packages/sim logic.ts TOP_MODE_BLEND, the same table: color × eva / 16 + under × evb / 16); TOP=1 draws it as it is.
const TOP_MODE_BLEND = [null, { eva: 8, evb: 15 }, { eva: 0, evb: 14 }, null];
const view = sublayer ? stage.actors(room).find((a) => a.id === "VWMD" && a.sublayer === sublayer) : undefined;
const blend = view && !process.env.TOP ? TOP_MODE_BLEND[(view.params >>> 12) & 3] : null;
if (top && blend) {
  const layer = createImage(LAYER_PIXELS, LAYER_PIXELS);
  drawLayer(layer, tileset, top);
  for (let i = 0; i < layer.data.length; i += 4) {
    if (!layer.data[i + 3]) continue;
    for (let c = 0; c < 3; c++) image.data[i + c] = Math.min(255, Math.floor((layer.data[i + c]! * blend.eva + image.data[i + c]! * blend.evb) / 16));
  }
} else if (top) drawLayer(image, tileset, top);
// COLLISION=1 tints each 8×8 quadrant by the base layer's tile type: red = solid, blue = water, black = pit.
if (process.env.COLLISION) {
  const types = readTileTypes(new Dol(readFileSync(join(extracted, "sys/main.dol"))));
  const base = stage.layer(room, 1, sublayer)!;
  for (let ty = 0; ty < LAYER_TILES; ty++) for (let tx = 0; tx < LAYER_TILES; tx++) {
    const type = types[base[ty * LAYER_TILES + tx]! & 0x3ff]!, mask = solidMask(type), surface = surfaceOf(type);
    for (let q = 0; q < 4; q++) {
      const tint = mask & (1 << q) ? [255, 0, 0] : surface === "deep" || surface === "shallow" ? [0, 80, 255] : surface === "pit" ? [0, 0, 0] : null;
      if (!tint) continue;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const i = ((ty * 16 + (q >> 1) * 8 + y) * image.width + tx * 16 + (q & 1) * 8 + x) * 4;
        for (let c = 0; c < 3; c++) image.data[i + c] = Math.round(image.data[i + c]! * 0.55 + tint[c]! * 0.45);
      }
    }
  }
}
writeFileSync(out, encodePng(image.width, image.height, image.data));
console.log(`${stageName} room ${room} (tileset ${stage.tilesetIndexOf(room)}) -> ${out}`);
