// Decodes every BTI texture inside an archive to PNGs for browsing.
//   node tools/render/src/textures.ts <archive path under GC4Sword_usa, e.g. data.arc> <outDir> [name filter regex]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { decodeBti, decompressYaz0, isYaz0, parseRarc } from "@fso/formats";
import { encodePng } from "./png.ts";

const [archivePath = "data.arc", out = "out/timg", filter = ".", extracted = "extracted"] = process.argv.slice(2);
const bytes = readFileSync(join(extracted, "files/GC4Sword_usa", archivePath));
const archive = parseRarc(isYaz0(bytes) ? decompressYaz0(bytes) : bytes);
mkdirSync(out, { recursive: true });
let count = 0;
for (const file of archive.files) {
  if (!file.path.endsWith(".bti") || !new RegExp(filter).test(file.path)) continue;
  try {
    const tex = decodeBti(isYaz0(file.data) ? decompressYaz0(file.data) : file.data);
    writeFileSync(join(out, `${basename(file.path, ".bti")}.png`), encodePng(tex.width, tex.height, tex.data));
    count++;
  } catch (error) {
    console.warn(`${file.path}: ${(error as Error).message}`);
  }
}
console.log(`${count} textures -> ${out}`);
