// Searches a RAM dump (trace.ts --dump) for ASCII IDs, u32 values or float (x, y) pairs near a position.
//   node tools/dolphin/src/memfind.ts <dump.bin> <base hex> ascii GRAS
//   node tools/dolphin/src/memfind.ts <dump.bin> <base hex> u32 804a6f38
//   node tools/dolphin/src/memfind.ts <dump.bin> <base hex> xy <x> <y> <radius>     (f32 x followed by f32 y)
//   node tools/dolphin/src/memfind.ts <dump.bin> <base hex> hexdump <addr hex> <len hex>
import { readFileSync } from "node:fs";

const [file, baseS, mode, ...args] = process.argv.slice(2);
if (!file || !baseS || !mode) {
  console.error("usage: memfind <dump.bin> <base hex> ascii|u32|xy|hexdump …");
  process.exit(1);
}
const buf = readFileSync(file), base = parseInt(baseS, 16);
const hex = (v: number) => "0x" + (v >>> 0).toString(16).padStart(8, "0");
const hits: string[] = [];
if (mode === "ascii" || mode === "u32") {
  const needle = mode === "ascii" ? Buffer.from(args[0]!, "latin1") : Buffer.from(args[0]!.padStart(8, "0"), "hex");
  for (let o = buf.indexOf(needle); o >= 0; o = buf.indexOf(needle, o + 1)) hits.push(hex(base + o));
} else if (mode === "xy") {
  const [x, y, r] = args.map(Number) as [number, number, number];
  for (let o = 0; o + 8 <= buf.length; o += 4) {
    const fx = buf.readFloatBE(o), fy = buf.readFloatBE(o + 4);
    if (Math.abs(fx - x) <= r && Math.abs(fy - y) <= r) hits.push(`${hex(base + o)} ${fx.toFixed(3)} ${fy.toFixed(3)} ${buf.readFloatBE(o + 8).toFixed(3)}`);
  }
} else if (mode === "hexdump") {
  const addr = parseInt(args[0]!, 16), len = parseInt(args[1] ?? "100", 16);
  for (let o = addr - base; o < addr - base + len; o += 16) {
    const words = [0, 4, 8, 12].map((i) => buf.readUInt32BE(o + i).toString(16).padStart(8, "0"));
    const text = [...buf.subarray(o, o + 16)].map((c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : ".")).join("");
    const floats = [0, 4, 8, 12].map((i) => {
      const f = buf.readFloatBE(o + i);
      return Math.abs(f) > 1e-3 && Math.abs(f) < 1e6 ? f.toFixed(2) : "";
    });
    console.log(`${hex(base + o)} +${(o - (addr - base)).toString(16).padStart(4, "0")}  ${words.join(" ")}  ${text}  ${floats.join(" ")}`);
  }
}
for (const h of hits.slice(0, 200)) console.log(h);
if (hits.length) console.log(`${hits.length} hits`);
