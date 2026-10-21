// Lists the calls that pass given actor IDs as a constant argument (e.g. to the spawn-by-ID function), with the
// containing function, to find the code that creates an actor type (the player's item use for ARRW, HBMB…).
// Prints to stdout only (derived from the user's own main.dol).
//   node tools/dol/src/spawners.ts ARRW HBMB PCDM …
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { idValue, MainDol, SPAWN_BY_ID } from "./analysis.ts";

const extracted = process.env.EXTRACTED ?? "extracted";
const main = new MainDol(readFileSync(join(extracted, "sys/main.dol")));
const hex = (n: number) => `0x${n.toString(16)}`;
for (const id of process.argv.slice(2)) {
  const want = idValue(id);
  const hits = main.calls().filter((c) => c.regs.some((r) => r.k === "const" && r.v === want));
  console.log(`${id} (${hex(want)}): ${hits.length} calls`);
  for (const c of hits) {
    const args = c.regs.slice(3, 9).map((r) => main.show(r)).join(", ");
    console.log(`  ${hex(c.at)} in ${hex(c.func)} -> ${c.target === SPAWN_BY_ID ? "spawn" : c.target ? hex(c.target) : "indirect"} (${args})`);
  }
}
