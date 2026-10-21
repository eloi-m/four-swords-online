// Extracts a GameCube disc image (RVZ or ISO) into Dolphin's "Extract Entire Disc" layout:
//   <out>/sys/{boot.bin,bi2.bin,apploader.img,fst.bin,main.dol}, <out>/files/<fst paths>, <out>/disc.json
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { openDiscFile } from "@fso/disc/node";

const [discPath, outArg = "extracted"] = process.argv.slice(2);
if (!discPath) {
  console.error("usage: extract <disc.rvz|disc.iso> [outDir]");
  process.exit(1);
}
const out = resolve(outArg);
const disc = await openDiscFile(discPath);
console.log(`${disc.header.gameId} rev ${disc.header.revision}: ${disc.header.title}`);

await mkdir(join(out, "sys"), { recursive: true });
for (const [name, bytes] of Object.entries(await disc.readSystemFiles())) {
  await writeFile(join(out, "sys", name), bytes);
}

// Read in disc order so the RVZ group cache is hit sequentially.
const files = [...disc.files].sort((a, b) => a.offset - b.offset);
let bytes = 0;
for (const file of files) {
  const target = join(out, "files", file.path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, await disc.readFile(file));
  bytes += file.size;
}
await writeFile(join(out, "disc.json"), JSON.stringify({ header: disc.header, files: disc.files }, null, 2));
await disc.close();
console.log(`extracted ${files.length} files (${(bytes / 1e6).toFixed(1)} MB) to ${out}`);
