// main.dol exploration (G4SE01 rev 0): actor graphics, battle constants. Prints to stdout only; the output is derived
// from the user's own game and is not meant to be committed.
//   node tools/dol/src/cli.ts dis <addr> [count]        disassembly with constants, static floats and strings resolved
//   node tools/dol/src/cli.ts spawn [IDs…]               spawn switch: ID -> object size, constructor, vtable
//   node tools/dol/src/cli.ts draws <IDs…>               draw calls reachable from each type's own methods
//   node tools/dol/src/cli.ts live <mem1> [IDs…]         live actor objects in a MEM1 dump (tools/dolphin ram.ts)
//   node tools/dol/src/cli.ts func <addr>                the whole function containing an address
//   node tools/dol/src/cli.ts callers <addr>             direct calls to a function, with their constant arguments
//   node tools/dol/src/cli.ts xref <addr> [len]          code whose effective address is in [addr, addr + len)
//   node tools/dol/src/cli.ts field <off> [lo] [hi]      loads/stores at displacement off (a struct field) in a range
//   node tools/dol/src/cli.ts float <value>              small-data float constants equal to a value, and their users
//   node tools/dol/src/cli.ts data <addr> [count] [f|h|b] static words as hex + f32 (or u16 halves / bytes)
// Options: EXTRACTED=<dir> (default extracted), DEPTH / CALLERS for `draws` (default 4 / 8).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decompressYaz0, loadActorTypes, parseRarc } from "@fso/formats";
import { fmtFloat, fourcc, liveActors, MainDol } from "./analysis.ts";

const extracted = process.env.EXTRACTED ?? "extracted";
const main = new MainDol(readFileSync(join(extracted, "sys/main.dol")));
const allIds = () => {
  const data = parseRarc(decompressYaz0(readFileSync(join(extracted, "files/GC4Sword_usa/data.arc"))));
  return [...(loadActorTypes(data)?.keys() ?? [])].sort();
};
const hex = (n: number | null) => (n === null ? "-" : `0x${n.toString(16)}`);

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case "dis":
    console.log(main.listing(Number.parseInt(args[0]!, 16), Number(args[1] ?? 64)).join("\n"));
    break;
  case "spawn": {
    const ids = args.length ? args : allIds();
    let resolved = 0;
    for (const id of ids) {
      const s = main.resolveSpawn(id);
      if (s) resolved++;
      console.log(id, s ? `size ${s.size} ctor ${hex(s.ctor)} vtable ${hex(main.vtableOf(s.ctor))}` : "not in the switch");
    }
    console.log(`${resolved} of ${ids.length} resolved`);
    break;
  }
  case "draws":
    for (const id of args) {
      const t = main.typeDraws(id, Number(process.env.DEPTH ?? 4), Number(process.env.CALLERS ?? 8));
      if (!t) {
        console.log(id, "not in the switch");
        continue;
      }
      console.log(`${id} ctor ${hex(t.ctor)} vtable ${hex(t.vtable)} own methods ${t.methods.map(hex).join(" ")}`);
      for (const d of t.draws) console.log(`  ${d.kind.padEnd(8)} @${hex(d.at)} in ${hex(d.func)} (depth ${d.depth}) ${d.args}`);
    }
    break;
  case "live": {
    const [mem1, ...ids] = args;
    const vtables = new Map<number, string[]>();
    for (const id of ids.length ? ids : allIds()) {
      const s = main.resolveSpawn(id);
      const vt = s ? main.vtableOf(s.ctor) : null;
      if (vt) vtables.set(vt, [...(vtables.get(vt) ?? []), id]);
    }
    for (const a of liveActors(readFileSync(mem1!), vtables))
      console.log(`${hex(a.addr)} ${a.ids.join("/")} screen ${a.screen} pos (${a.x.toFixed(1)}, ${a.y.toFixed(1)})`);
    break;
  }
  case "func":
    console.log(main.functionListing(Number.parseInt(args[0]!, 16)).join("\n"));
    break;
  case "callers":
    for (const c of main.callers(Number.parseInt(args[0]!, 16)))
      console.log(`${hex(c.at)} in ${hex(c.func)} (${c.regs.slice(3, 9).map((r, k) => `r${k + 3}=${main.show(r)}`).join(" ")})`);
    break;
  case "xref": {
    const lo = Number.parseInt(args[0]!, 16);
    for (const x of main.xrefs(lo, lo + Number(args[1] ?? 1))) console.log(`${hex(x.at)} in ${hex(x.func)}  ${x.text}`);
    break;
  }
  case "field": {
    const [off, lo, hi] = args.map((a) => Number.parseInt(a, 16));
    for (const x of main.fieldAccesses(off!, lo, hi)) console.log(`${hex(x.at)} in ${hex(x.func)}  ${x.text}`);
    break;
  }
  case "float":
    for (const c of main.floatConstants(Number(args[0]))) console.log(`${hex(c.addr)}: ${c.users.map(hex).join(" ") || "(no users)"}`);
    break;
  case "data": {
    const start = Number.parseInt(args[0]!, 16), count = Number(args[1] ?? 16), mode = args[2] ?? "f";
    for (let k = 0; k < count; k++) {
      const a = start + 4 * k, w = main.word(a);
      const extra =
        mode === "h" ? `${w >>> 16} ${w & 0xffff}` : mode === "b" ? [w >>> 24, (w >>> 16) & 255, (w >>> 8) & 255, w & 255].join(" ") : fmtFloat(main.f32(a)!);
      const cc = fourcc(w), s = w >= 0x80000000 ? main.cstring(w) : null;
      console.log(`${hex(a)}  ${w.toString(16).padStart(8, "0")}  ${w | 0}  ${extra}${cc ? ` '${cc}'` : ""}${s ? ` "${s}"` : ""}`);
    }
    break;
  }
  default:
    console.error("usage: cli.ts dis <addr> [count] | spawn [IDs] | draws <IDs> | live <mem1> [IDs] | func | callers | xref | field | float | data");
    process.exitCode = 1;
}
