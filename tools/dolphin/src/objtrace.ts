// Prints an actor's position per frame from a per-frame RAM dump of it (trace.ts --raw <addr>:<len>): vtable, f32 x,
// y, z at +0xC, deltas, and optional extra u32 fields. Consecutive identical rows are collapsed.
//   node tools/dolphin/src/objtrace.ts <dump.bin> <len hex> [from] [to] [--fields 60,e0] [--room 512,384]
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { fields: { type: "string", default: "" }, floats: { type: "string", default: "" } } });
const [file, lenS, fromS = "0", toS] = positionals;
if (!file || !lenS) {
  console.error("usage: objtrace <dump.bin> <len hex> [from] [to] [--fields hexoff,…] [--floats hexoff,…]");
  process.exit(1);
}
const buf = readFileSync(file), len = parseInt(lenS, 16), frames = Math.floor(buf.length / len);
const fields = values.fields ? values.fields.split(",").map((s) => parseInt(s, 16)) : [];
const floats = values.floats ? values.floats.split(",").map((s) => parseInt(s, 16)) : [];
let prev: number[] | null = null, prevKey = "", repeat = 0, prevLine = "";
const flush = () => prevLine && console.log(`${String(repeat).padStart(3)} ${prevLine}`);
for (let f = Number(fromS); f <= Math.min(Number(toS ?? frames - 1), frames - 1); f++) {
  const o = f * len;
  const pos = [buf.readFloatBE(o + 0xc), buf.readFloatBE(o + 0x10), buf.readFloatBE(o + 0x14)];
  const d = prev ? pos.map((v, i) => v - prev![i]!) : [0, 0, 0];
  const extra = [
    ...fields.map((k) => `${k.toString(16)}=${buf.readUInt32BE(o + k).toString(16)}`),
    ...floats.map((k) => `${k.toString(16)}=${buf.readFloatBE(o + k).toFixed(3)}`),
  ].join(" ");
  const key = `${buf.readUInt32BE(o).toString(16)} ${d.map((v) => v.toFixed(3)).join(" ")} ${extra}`;
  const line = `${String(f).padStart(4)} ${buf.readUInt32BE(o).toString(16)} ${pos.map((v) => v.toFixed(3).padStart(9)).join(" ")}  d ${d.map((v) => v.toFixed(3).padStart(7)).join(" ")}  ${extra}`;
  if (key === prevKey) repeat++;
  else {
    flush();
    prevLine = line;
    prevKey = key;
    repeat = 1;
  }
  prev = pos;
}
flush();
