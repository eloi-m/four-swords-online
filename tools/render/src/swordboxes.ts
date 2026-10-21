// Prints the sword's per-frame bounding boxes in player_sob.bin (opaque pixels of the palette-10 parts: blade, hilt
// and swoosh trail), relative to the sprite anchor, as the SWORD_BOXES literal in packages/sim/src/animations.ts.
//   node tools/render/src/swordboxes.ts [frame ranges, default 32-59 67-166 594-633]
import { readFileSync } from "node:fs";
import { decompressYaz0, loadSob, loadSpriteSheet, parseRarc, spriteBounds } from "@fso/formats";

const SWORD_PALETTE = 10;
const ranges = process.argv.length > 2 ? process.argv.slice(2) : ["32-59", "67-166", "594-633"];
const data = parseRarc(decompressYaz0(readFileSync("extracted/files/GC4Sword_usa/data.arc")));
const sheet = loadSpriteSheet(data, 8);
const frames = loadSob(data, "player_sob.bin");
const lines: string[] = [];
for (const range of ranges) {
  const [first, last = first] = range.split("-").map(Number) as [number, number?];
  for (let i = first; i <= last; i++) {
    const box = spriteBounds(sheet, frames[i]!, (p) => p.palette === SWORD_PALETTE);
    if (box) lines.push(`  ${i}: [${box.left}, ${box.top}, ${box.right}, ${box.bottom}],`);
  }
}
console.log(`{\n${lines.join("\n")}\n}`);
