// Extracts MEM1 (24 MiB main RAM) from a Dolphin savestate of FSA, using main.dol's code as the locating signature.
//   node tools/dolphin/src/ram.ts <state.sav> <out.mem1> [extractedDir]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findMem1, readSavestate } from "./savestate.ts";

const [statePath, out, extracted = "extracted"] = process.argv.slice(2);
if (!statePath || !out) {
  console.error("usage: ram <state.sav> <out.mem1> [extractedDir]");
  process.exit(1);
}
const state = readSavestate(readFileSync(statePath));
const dol = readFileSync(join(extracted, "sys/main.dol"));
// Text section 1: file offset and load address from the DOL header; 256 bytes of code as the signature.
const textOffset = dol.readUInt32BE(4), textAddress = dol.readUInt32BE(0x48 + 4);
const mem1 = findMem1(state.payload, dol.subarray(textOffset + 0x1000, textOffset + 0x1100), textAddress + 0x1000);
writeFileSync(out, mem1);
console.log(`${state.gameId} · ${state.version} · payload ${state.payload.length} bytes · MEM1 -> ${out}`);
console.log(`MEM1 game ID at 0x80000000: ${String.fromCharCode(...mem1.subarray(0, 6))}`);
