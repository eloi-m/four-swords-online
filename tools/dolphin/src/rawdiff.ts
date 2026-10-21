// Finds the fields of a per-frame RAM dump (trace.ts --raw) that change between frames, and prints their values over
// time. For locating actor fields: e.g. which words of the Link actor change when he lifts something.
//   node tools/dolphin/src/rawdiff.ts <dump.bin> <len hex> <frame a> <frame b> [--width 1|2|4] [--show f0-f1[/step]] [--only off,off]
//   Offsets whose value differs between frames a and b are listed; --show prints their values over a frame range.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { width: { type: "string", default: "4" }, show: { type: "string" }, only: { type: "string" }, float: { type: "boolean", default: false }, max: { type: "string", default: "200" } },
});
const [file, lenS, aS, bS] = positionals;
if (!file || !lenS || !aS || !bS) {
  console.error("usage: rawdiff <dump.bin> <len hex> <frame a> <frame b> [--width 4] [--show f0-f1] [--only o1,o2]");
  process.exit(1);
}
const buf = readFileSync(file), len = parseInt(lenS, 16), width = Number(values.width);
const frames = Math.floor(buf.length / len);
const at = (f: number, o: number) => {
  const base = f * len + o;
  if (width === 1) return buf[base]!;
  if (width === 2) return buf.readUInt16BE(base);
  return values.float ? buf.readFloatBE(base) : buf.readUInt32BE(base);
};
const fmt = (v: number) => (values.float ? v.toFixed(3) : width === 4 ? v.toString(16).padStart(8, "0") : v.toString(16));
const a = Number(aS), b = Number(bS);
let offsets: number[] = [];
if (values.only) offsets = values.only.split(",").map((s) => parseInt(s, 16));
else for (let o = 0; o + width <= len; o += width) if (at(a, o) !== at(b, o)) offsets.push(o);
console.log(`${frames} frames; ${offsets.length} offsets differ between ${a} and ${b}`);
for (const o of offsets.slice(0, Number(values.max))) {
  let line = `+${o.toString(16).padStart(4, "0")}: ${fmt(at(a, o))} -> ${fmt(at(b, o))}`;
  if (values.show) {
    const [range, stepS = "1"] = values.show.split("/");
    const [f0, f1] = range!.split("-").map(Number);
    const seq: string[] = [];
    let prev: number | null = null;
    for (let f = f0!; f <= Math.min(f1!, frames - 1); f += Number(stepS)) {
      const v = at(f, o);
      if (v !== prev) seq.push(`${f}:${fmt(v)}`);
      prev = v;
    }
    line += `   ${seq.join(" ")}`;
  }
  console.log(line);
}
