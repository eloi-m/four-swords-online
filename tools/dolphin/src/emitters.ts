// Lists FSA's live JPA emitters in a MEM1 dump (ram.ts, or trace.ts --dump <frame>:80000000:1800000), group by group:
// effect id, translation, dynamics and particle scale, maxFrame, status and rotation (docs/formats/jpa.md "JPA particles").
//   node tools/dolphin/src/emitters.ts <mem1>
import { readFileSync } from "node:fs";

const [path] = process.argv.slice(2);
if (!path) {
  console.error("usage: emitters <mem1>");
  process.exit(1);
}
const mem = readFileSync(path);
const u32 = (a: number) => mem.readUInt32BE((a >>> 0) - 0x80000000);
const f32 = (a: number) => mem.readFloatBE((a >>> 0) - 0x80000000);
const inRam = (a: number) => a >= 0x80000000 && a < 0x81800000;

// The particle manager [[0x8053AB10] + 0x28]; its emitter manager +0xC; that one's group lists (head, tail, count).
const manager = u32(u32(u32(0x8053ab10) + 0x28) + 0xc);
const lists = u32(manager);
const camera = u32(u32(0x8053ab10) + 0x24);
console.log(`view translation (${f32(camera + 0x10).toFixed(2)}, ${f32(camera + 0x20).toFixed(2)}), zoom ${f32(camera + 0x858).toFixed(4)}`);
for (let g = 0; g < 11; g++) {
  const count = u32(lists + 12 * g + 8);
  if (!count) continue;
  console.log(`group ${g}: ${count}`);
  // Each emitter's link (+0x58): object, list, prev, next.
  for (let link = u32(lists + 12 * g), n = 0; inRam(link) && n < count; link = u32(link + 0xc), n++) {
    const e = u32(link), res = u32(e + 0xe8);
    const id = inRam(res) ? mem.readUInt16BE(res - 0x80000000 + 0x3c) : -1;
    const v = (o: number, k: number) => Array.from({ length: k }, (_, i) => +f32(e + o + 4 * i).toFixed(2)).join(", ");
    console.log(
      `  ${id} at (${v(0xa4, 3)}) dyn (${v(0x98, 3)}) scale (${v(0xb0, 2)}) maxFrame ${u32(e + 0x24)} status 0x${u32(e + 0xf4).toString(16)}` +
        ` rot [${v(0x68, 3)} | ${v(0x78, 3)} | ${v(0x88, 3)}]`,
    );
  }
}
