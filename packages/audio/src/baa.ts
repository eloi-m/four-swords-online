// BAA ("AA_<" … ">_AA"): JAudio2's audio init archive (FSA's AudioRes/JaiInit.baa). A list of big-endian commands,
// each a 4-char tag and u32 arguments; offsets are absolute in the file:
//   "ws  " id, offset, flags   wave system (WSYS)      "bnk " id, offset       instrument bank (IBNK)
//   "bst " start, end          sound table             "bstn" start, end       sound name table
//   "bsc " start, end          sequence collection     "bms " id, start, end   one sequence
//   "bmsa" id, "bsft" offset, "bl_<" a, b / ">_bl", "vbnk" a, b, "dsqb" a (1 arg), "sect" 4 bytes
import { ascii, dataView } from "@fso/formats";

export type BaaCommand =
  | { tag: "ws  "; id: number; offset: number; flags: number }
  | { tag: "bnk "; id: number; offset: number }
  | { tag: "bst " | "bstn" | "bsc "; start: number; end: number }
  | { tag: "bms "; id: number; start: number; end: number }
  | { tag: string; args: number[] };

const ARGS: Record<string, number> = {
  "ws  ": 3, "bnk ": 2, "bst ": 2, "bstn": 2, "bsc ": 2, "bms ": 3, bmsa: 1, bsft: 1, "bl_<": 2, ">_bl": 0,
  vbnk: 2, dsqb: 1, sect: 1,
};

export function isBaa(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && ascii(bytes, 0, 4) === "AA_<";
}

export function parseBaa(bytes: Uint8Array): BaaCommand[] {
  if (!isBaa(bytes)) throw new Error("not a BAA archive");
  const v = dataView(bytes);
  const out: BaaCommand[] = [];
  let p = 4;
  while (p + 4 <= bytes.length) {
    const tag = ascii(bytes, p, 4);
    if (tag === ">_AA") return out;
    const n = ARGS[tag];
    if (n === undefined) throw new Error(`unknown BAA command "${tag}" at 0x${p.toString(16)}`);
    const args = Array.from({ length: n }, (_, i) => v.getUint32(p + 4 + i * 4));
    p += 4 + n * 4;
    const [a = 0, b = 0, c = 0] = args;
    if (tag === "ws  ") out.push({ tag, id: a, offset: b, flags: c });
    else if (tag === "bnk ") out.push({ tag, id: a, offset: b });
    else if (tag === "bst " || tag === "bstn" || tag === "bsc ") out.push({ tag, start: a, end: b });
    else if (tag === "bms ") out.push({ tag, id: a, start: b, end: c });
    else out.push({ tag, args });
  }
  throw new Error("BAA archive has no end marker");
}
