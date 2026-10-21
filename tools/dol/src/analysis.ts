// main.dol analysis used to map actor graphics (docs/formats/sprites-and-actors.md, "Actor lists" and "Actor graphics"):
// - a linear constant propagation that records what each call's argument registers hold,
// - the spawn-by-ID switch, resolved by simulating its compares for a given ID,
// - per-type reachability from the constructor and the type's own vtable methods to the sprite/texture draw calls,
// - cross-references for the battle constants (docs/measurements/battle-constants.md "Battle constants from main.dol"): callers of a
//   function, code reaching a static address (tables, float constants, globals), accesses to a struct field.
// Addresses are for G4SE01 rev 0.
import { Dol } from "@fso/formats";
import { decode, type Insn } from "./ppc.ts";

export const SPAWN_BY_ID = 0x801f9484;
export const OPERATOR_NEW = 0x8008440c;
export const BASE_VTABLE = 0x804a5770;
/** Functions that draw something, and which argument register holds the frame. */
export const DRAW_FUNCTIONS: Readonly<Record<number, { kind: string; frame: number }>> = {
  0x801f06f0: { kind: "sob", frame: 5 },
  0x801f02bc: { kind: "sob2", frame: 5 },
  0x801ef574: { kind: "sob3", frame: 4 },
  0x801ef830: { kind: "shadow", frame: 8 },
  0x802f86cc: { kind: "tvsob", frame: 6 },
  0x803075ac: { kind: "gba", frame: 6 },
  0x804030c4: { kind: "bti", frame: 4 },
  0x804032e8: { kind: "bti", frame: 4 },
  0x804031c4: { kind: "bti", frame: 4 },
  0x80403244: { kind: "bti", frame: 4 },
};

/** What a register holds at a call: a constant, a load from memory, or the instruction that computed it. */
export type Val =
  | { k: "const"; v: number; at: number }
  | { k: "load"; base: number; off: number; at: number }
  | { k: "other"; insn: string; at: number }
  | { k: "unknown" };

export interface Call {
  at: number;
  /** Callee, or 0 for an indirect call (bctrl). */
  target: number;
  func: number;
  regs: Val[];
}

const UNKNOWN: Val = { k: "unknown" };

export class MainDol {
  readonly dol: Dol;
  readonly r2: number;
  readonly r13: number;
  private starts: number[] | null = null;
  private allCalls: Call[] | null = null;

  constructor(bytes: Uint8Array) {
    this.dol = new Dol(bytes);
    // __init_registers sets r2/r13 with lis + ori right after the entry point.
    const found = new Map<number, number>();
    const entry = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0xe0);
    const hi = new Map<number, number>();
    for (let a = entry; a < entry + 0x400; a += 4) {
      const i = this.insn(a);
      if (i.op === "bl") {
        for (let b = i.target!, n = 0; n < 64; b += 4, n++) {
          const j = this.insn(b);
          if (j.op === "lis") hi.set(j.rd!, j.imm! << 16);
          else if (j.op === "ori" && hi.has(j.ra!) && (j.rd === 2 || j.rd === 13)) found.set(j.rd!, (hi.get(j.ra!)! | j.imm!) >>> 0);
          if (j.op === "blr") break;
        }
      }
      if (found.size === 2) break;
    }
    this.r2 = found.get(2) ?? 0;
    this.r13 = found.get(13) ?? 0;
  }

  get text() {
    return this.dol.sections.filter((s) => s.kind === "text");
  }

  isText(v: number): boolean {
    return this.text.some((s) => v >= s.address && v < s.address + s.size);
  }

  word(addr: number): number {
    const b = this.dol.read(addr, 4);
    return ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
  }

  insn(addr: number): Insn {
    return decode(this.word(addr), addr);
  }

  /** A printable C string at an address (3+ chars), or null. */
  cstring(addr: number): string | null {
    let bytes: Uint8Array;
    try {
      bytes = this.dol.read(addr, 64);
    } catch {
      return null;
    }
    let s = "";
    for (const c of bytes) {
      if (c === 0) break;
      if (c < 32 || c >= 127) return null;
      s += String.fromCharCode(c);
    }
    return s.length >= 3 ? s : null;
  }

  /** A static f32 / f64 at an address, or null outside the DOL. */
  f32(addr: number): number | null {
    try {
      const b = this.dol.read(addr, 4);
      return new DataView(b.buffer, b.byteOffset, 4).getFloat32(0);
    } catch {
      return null;
    }
  }

  f64(addr: number): number | null {
    try {
      const b = this.dol.read(addr, 8);
      return new DataView(b.buffer, b.byteOffset, 8).getFloat64(0);
    } catch {
      return null;
    }
  }

  /** What a load or store from a static address reads there now: a float for lfs/lfd, else the word (or string). */
  private staticValue(op: string, addr: number): string {
    if (op.startsWith("lfs") || op.startsWith("stfs")) {
      const f = this.f32(addr);
      return f === null ? "" : ` (${fmtFloat(f)})`;
    }
    if (op.startsWith("lfd") || op.startsWith("stfd")) {
      const f = this.f64(addr);
      return f === null ? "" : ` (${fmtFloat(f)})`;
    }
    if (op === "lwz" && addr < 0x804b2140) {
      try {
        const w = this.word(addr);
        const s = w >= 0x80000000 ? this.cstring(w) : null;
        return ` (0x${w.toString(16)}${s ? ` "${s}"` : ""})`;
      } catch {
        return "";
      }
    }
    return "";
  }

  /** Disassembly with lis/addi constants, SDA-relative addresses, static floats and strings resolved. */
  listing(start: number, count: number): string[] {
    const hi = new Map<number, number>();
    const lines: string[] = [];
    const starts = new Set(this.functionStarts());
    for (let a = start; a < start + count * 4; a += 4) {
      const i = this.insn(a);
      let note = "";
      if (i.op === "lis") hi.set(i.rd!, (i.imm! << 16) >>> 0);
      else if ((i.op === "addi" || i.op === "ori") && (hi.has(i.ra!) || i.ra === 2 || i.ra === 13)) {
        const base = i.ra === 2 ? this.r2 : i.ra === 13 ? this.r13 : hi.get(i.ra!)!;
        const v = (i.op === "addi" ? base + i.imm! : base | i.imm!) >>> 0;
        const cc = fourcc(v), s = v >= 0x80000000 ? this.cstring(v) : null;
        note = `= 0x${v.toString(16)}${cc ? ` '${cc}'` : ""}${s ? ` "${s}"` : ""}`;
        hi.set(i.rd!, v); // a table's base stays known for the loads that index it
      } else if (i.imm !== undefined && (i.ra === 2 || i.ra === 13 || (hi.has(i.ra!) && i.ra !== 0)) && /^(l|st)/.test(i.op) && !/^(lis|li)$/.test(i.op)) {
        const base = i.ra === 2 ? this.r2 : i.ra === 13 ? this.r13 : hi.get(i.ra!)!;
        const ea = (base + i.imm) >>> 0;
        note = `@0x${ea.toString(16)}${this.staticValue(i.op, ea)}`;
        if (/^l[bhw]/.test(i.op) && i.rd !== undefined) hi.delete(i.rd);
        if (/^(l[bhwf]|st[bhwf])\w*u$/.test(i.op) && i.ra !== 1) hi.set(i.ra!, ea); // update forms move the base
      } else if (i.op === "bl") note = `-> 0x${i.target!.toString(16)}`;
      else if (i.op === "li" && i.rd !== undefined) {
        hi.delete(i.rd);
        if (i.imm! >= 0x100) note = `= 0x${(i.imm! >>> 0).toString(16)}`;
      } else if (i.rd !== undefined && !/^(st|cmp|b)/.test(i.op)) hi.delete(i.rd);
      if (starts.has(a) && a !== start) lines.push(`-- function 0x${a.toString(16)}`);
      lines.push(`${a.toString(16)}  ${i.word.toString(16).padStart(8, "0")}  ${i.op.padEnd(8)} ${i.args}  ${note}`.trimEnd());
    }
    return lines;
  }

  /** The start of the next function after `addr` (so the end of the one containing it). */
  functionEnd(addr: number): number {
    const starts = this.functionStarts();
    let lo = 0, hi = starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid]! <= addr) lo = mid + 1;
      else hi = mid;
    }
    const next = starts[lo];
    const section = this.text.find((s) => addr >= s.address && addr < s.address + s.size)!;
    return Math.min(next ?? Infinity, section.address + section.size);
  }

  /** The whole function containing `addr`, listed. */
  functionListing(addr: number): string[] {
    const start = this.functionOf(addr);
    return this.listing(start, (this.functionEnd(start) - start) / 4);
  }

  /** Calls to `target` (direct `bl` only), with their argument registers. */
  callers(target: number): Call[] {
    return this.calls().filter((c) => c.target === target);
  }

  /**
   * Instructions whose effective address falls in [lo, hi): lis + addi/ori pairs and lis + D-form loads/stores
   * (tracked linearly in each function), and r2/r13-relative accesses. For data tables, float constants, globals.
   */
  xrefs(lo: number, hi = lo + 1): { at: number; func: number; text: string }[] {
    const out: { at: number; func: number; text: string }[] = [];
    const startSet = new Set(this.functionStarts());
    for (const s of this.text) {
      let regs = new Map<number, number>();
      let func = s.address;
      for (let a = s.address; a < s.address + s.size; a += 4) {
        if (startSet.has(a)) {
          func = a;
          regs = new Map();
        }
        const i = this.insn(a);
        let ea: number | null = null;
        if (i.op === "lis") regs.set(i.rd!, (i.imm! << 16) >>> 0);
        else if ((i.op === "addi" || i.op === "ori") && (regs.has(i.ra!) || i.ra === 2 || i.ra === 13)) {
          const base = i.ra === 2 ? this.r2 : i.ra === 13 ? this.r13 : regs.get(i.ra!)!;
          ea = (i.op === "addi" ? base + i.imm! : base | i.imm!) >>> 0;
          regs.set(i.rd!, ea);
        } else if (i.imm !== undefined && /^(l[bhwf]|st)/.test(i.op) && (i.ra === 2 || i.ra === 13 || regs.has(i.ra!))) {
          const base = i.ra === 2 ? this.r2 : i.ra === 13 ? this.r13 : regs.get(i.ra!)!;
          ea = (base + i.imm) >>> 0;
          if (/^l[bhw]/.test(i.op)) regs.delete(i.rd!);
        } else if (i.rd !== undefined && !/^(st|cmp|b|f|lf|psq)/.test(i.op)) regs.delete(i.rd);
        if (i.op === "bl") for (const r of [0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) regs.delete(r);
        if (ea !== null && ea >= lo && ea < hi) out.push({ at: a, func, text: `${i.op} ${i.args} @0x${ea.toString(16)}` });
      }
    }
    return out;
  }

  /** D-form loads and stores with a given displacement (a struct field), optionally only in [lo, hi) of the text. */
  fieldAccesses(offset: number, lo = 0, hi = 0xffffffff): { at: number; func: number; text: string }[] {
    const out: { at: number; func: number; text: string }[] = [];
    for (const s of this.text) {
      for (let a = Math.max(lo, s.address); a < Math.min(hi, s.address + s.size); a += 4) {
        const i = this.insn(a);
        if (i.imm === offset && /^(l[bhwf]|st|psq)/.test(i.op) && i.ra !== 1 && i.ra !== 2 && i.ra !== 13 && i.op !== "lis" && i.op !== "li")
          out.push({ at: a, func: this.functionOf(a), text: `${i.op} ${i.args}` });
      }
    }
    return out;
  }

  /** f32 constants in the small-data (r2) section equal to `value` (within 1e-6), with their users. */
  floatConstants(value: number): { addr: number; users: number[] }[] {
    const sdata2 = this.dol.sections.find((s) => s.kind === "data" && this.r2 >= s.address && this.r2 < s.address + s.size + 0x8000);
    if (!sdata2) return [];
    const out: { addr: number; users: number[] }[] = [];
    for (let a = sdata2.address; a + 4 <= sdata2.address + sdata2.size; a += 4) {
      const f = this.f32(a)!;
      if (Math.abs(f - value) <= 1e-6 * Math.max(1, Math.abs(value))) out.push({ addr: a, users: this.xrefs(a).map((x) => x.at) });
    }
    return out;
  }

  /** Function entry points: every bl target, plus text pointers in data sections that start like a function. */
  functionStarts(): number[] {
    if (this.starts) return this.starts;
    const starts = new Set<number>();
    for (const s of this.text) {
      for (let a = s.address; a < s.address + s.size; a += 4) {
        const w = this.word(a);
        if (w >>> 26 === 18 && w & 1) starts.add(this.insn(a).target!);
      }
    }
    for (const s of this.dol.sections.filter((x) => x.kind === "data")) {
      for (let a = s.address; a + 4 <= s.address + s.size; a += 4) {
        const w = this.word(a);
        if ((w & 3) === 0 && this.isText(w) && ["stwu", "mflr", "blr", "li", "lwz"].includes(this.insn(w).op)) starts.add(w);
      }
    }
    return (this.starts = [...starts].sort((a, b) => a - b));
  }

  functionOf(addr: number): number {
    const starts = this.functionStarts();
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= addr) lo = mid;
      else hi = mid - 1;
    }
    return starts[lo]!;
  }

  /** Every call in the text, with a linear (branch-unaware) constant propagation of r0-r12 up to it. */
  calls(): Call[] {
    if (this.allCalls) return this.allCalls;
    const startSet = new Set(this.functionStarts());
    const calls: Call[] = [];
    for (const s of this.text) {
      let regs: Val[] = new Array(32).fill(UNKNOWN);
      let func = s.address;
      for (let a = s.address; a < s.address + s.size; a += 4) {
        if (startSet.has(a)) {
          func = a;
          regs = new Array(32).fill(UNKNOWN);
        }
        const i = this.insn(a);
        const reg = (r: number) => regs[r]!;
        switch (i.op) {
          case "li":
            regs[i.rd!] = { k: "const", v: i.imm!, at: a };
            break;
          case "lis":
            regs[i.rd!] = { k: "const", v: (i.imm! << 16) >>> 0, at: a };
            break;
          case "addi": {
            const base = i.ra === 2 || i.ra === 13 ? { k: "const" as const, v: i.ra === 2 ? this.r2 : this.r13 } : reg(i.ra!);
            regs[i.rd!] = base.k === "const" ? { k: "const", v: (base.v + i.imm!) >>> 0, at: a } : { k: "other", insn: `${i.op} ${i.args}`, at: a };
            break;
          }
          case "ori": {
            const base = reg(i.ra!);
            regs[i.rd!] = base.k === "const" ? { k: "const", v: (base.v | i.imm!) >>> 0, at: a } : { k: "other", insn: `${i.op} ${i.args}`, at: a };
            break;
          }
          case "mr":
            regs[i.rd!] = reg(i.ra!);
            break;
          case "lwz":
          case "lhz":
          case "lha":
          case "lbz":
            regs[i.rd!] = { k: "load", base: i.ra!, off: i.imm!, at: a };
            break;
          case "bl":
          case "bctrl":
            calls.push({ at: a, target: i.op === "bl" ? i.target! : 0, func, regs: regs.slice(0, 13) });
            for (const r of [0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) regs[r] = UNKNOWN;
            break;
          default:
            if (i.rd !== undefined && !/^(st|cmp|b|f|lf|psq)/.test(i.op)) regs[i.rd] = { k: "other", insn: `${i.op} ${i.args}`, at: a };
            if (i.op === "lwzu" || i.op === "stwu") regs[i.ra!] = UNKNOWN;
        }
      }
    }
    return (this.allCalls = calls);
  }

  show(v: Val): string {
    if (v.k === "const") {
      const s = v.v >= 0x80000000 ? this.cstring(v.v) : null;
      const cc = fourcc(v.v);
      return s ? `"${s}"` : cc ? `'${cc}'` : v.v >= 0x80000000 ? `0x${v.v.toString(16)}` : String(v.v | 0);
    }
    if (v.k === "load") return `[r${v.base}+0x${v.off.toString(16)}]`;
    if (v.k === "other") return `{${v.insn}}@${v.at.toString(16)}`;
    return "?";
  }

  /** Simulates the spawn switch for one ID: the case's allocation size and constructor, or null. */
  resolveSpawn(id: string): { size: number; ctor: number } | null {
    const r = new Array<number>(32).fill(0);
    r[4] = idValue(id) | 0;
    let cr = { lt: false, gt: false, eq: true };
    let pc = SPAWN_BY_ID, size = 0;
    const compare = (a: number, b: number) => (cr = { lt: a < b, gt: a > b, eq: a === b });
    for (let steps = 0; steps < 4000; steps++) {
      const i = this.insn(pc);
      let next = pc + 4;
      switch (i.op) {
        case "lis": r[i.rd!] = (i.imm! << 16) | 0; break;
        case "addi": r[i.rd!] = (r[i.ra!]! + i.imm!) | 0; break;
        case "li": r[i.rd!] = i.imm!; if (i.rd === 3) size = i.imm!; break;
        case "ori": r[i.rd!] = r[i.ra!]! | i.imm!; break;
        case "mr": r[i.rd!] = r[i.ra!]!; break;
        case "lwz": r[i.rd!] = 0; break; // the slot being filled is empty
        case "cmpw": compare(r[i.ra!]!, r[i.rb!]!); break;
        case "cmpwi": compare(r[i.ra!]!, i.imm!); break;
        case "cmplwi": compare(r[i.ra!]! >>> 0, i.imm! >>> 0); break;
        case "cmplw": compare(r[i.ra!]! >>> 0, r[i.rb!]! >>> 0); break;
        case "b": next = i.target!; break;
        case "beq": if (cr.eq) next = i.target!; break;
        case "bne": if (!cr.eq) next = i.target!; break;
        case "blt": if (cr.lt) next = i.target!; break;
        case "bgt": if (cr.gt) next = i.target!; break;
        case "ble": if (!cr.gt) next = i.target!; break;
        case "bge": if (!cr.lt) next = i.target!; break;
        case "blr": return null;
        case "bl":
          if (i.target === OPERATOR_NEW) {
            for (let a = pc + 4; a < pc + 32; a += 4) {
              const x = this.insn(a);
              if (x.op === "bl") return { size, ctor: x.target! };
              if (x.op === "b") break;
            }
            return null;
          }
          break;
      }
      if (next === 0x801ff3b4) return null; // the switch's "unknown ID" exit
      pc = next;
    }
    return null;
  }

  /** The vtable a constructor installs last at +0 of the object. */
  vtableOf(ctor: number): number | null {
    let last: number | null = null;
    const regs = new Map<number, number>();
    for (let a = ctor; a < ctor + 800; a += 4) {
      const i = this.insn(a);
      if (i.op === "lis") regs.set(i.rd!, (i.imm! << 16) >>> 0);
      else if (i.op === "addi" && regs.has(i.ra!)) regs.set(i.rd!, (regs.get(i.ra!)! + i.imm!) >>> 0);
      else if (i.op === "stw" && i.imm === 0 && regs.has(i.rd!) && [3, 30, 31].includes(i.ra!)) {
        const v = regs.get(i.rd!)!;
        if (v >= 0x80400000 && v < 0x80540000) last = v;
      }
      if (i.op === "blr") break;
    }
    return last;
  }

  vtableMethods(vtable: number): number[] {
    const out: number[] = [];
    for (let a = vtable + 8; a < vtable + 8 + 4 * 80; a += 4) {
      const v = this.word(a);
      if (!this.isText(v)) break;
      out.push(v);
    }
    return out;
  }

  /**
   * Draw calls reachable from a type's constructor and own methods (not the base class's), following calls to
   * functions with at most `maxCallers` callers (to stay out of shared library code), up to `maxDepth`.
   */
  typeDraws(id: string, maxDepth = 4, maxCallers = 8) {
    const spawn = this.resolveSpawn(id);
    if (!spawn) return null;
    const vtable = this.vtableOf(spawn.ctor);
    const base = new Set(this.vtableMethods(BASE_VTABLE));
    const methods = vtable ? this.vtableMethods(vtable).filter((m) => !base.has(m)) : [];
    const byFunc = new Map<number, Call[]>(), callers = new Map<number, Set<number>>();
    for (const c of this.calls()) {
      (byFunc.get(c.func) ?? byFunc.set(c.func, []).get(c.func)!).push(c);
      (callers.get(c.target) ?? callers.set(c.target, new Set()).get(c.target)!).add(c.func);
    }
    const draws: { kind: string; at: number; func: number; depth: number; args: string }[] = [];
    const seen = new Set<number>();
    const queue: [number, number][] = [[spawn.ctor, 0], ...methods.map((m) => [m, 0] as [number, number])];
    while (queue.length) {
      const [f, depth] = queue.shift()!;
      const fn = this.functionOf(f);
      if (seen.has(fn)) continue;
      seen.add(fn);
      for (const call of byFunc.get(fn) ?? []) {
        const r = call.regs;
        if (call.target === 0) {
          // Resource lookups through the manager's vtable: r4 = 4-char kind ('SOB ', 'TIMG', 'SMP '), r5 = name.
          const kind = r[4]!, name = r[5]!;
          if (kind.k === "const" && fourcc(kind.v) && name.k === "const")
            draws.push({ kind: `res ${fourcc(kind.v)}`, at: call.at, func: fn, depth, args: this.show(name) });
          continue;
        }
        const draw = DRAW_FUNCTIONS[call.target];
        if (draw) {
          const args = [3, 4, 5, 6, 7, 8].map((n) => `r${n}=${this.show(r[n]!)}`).join(" ");
          draws.push({ kind: draw.kind, at: call.at, func: fn, depth, args: `frame r${draw.frame}; ${args}` });
          continue;
        }
        if (depth < maxDepth && (callers.get(call.target)?.size ?? 0) <= maxCallers) queue.push([call.target, depth + 1]);
      }
    }
    return { id, ...spawn, vtable, methods, draws };
  }
}

export function idValue(id: string): number {
  return ((id.charCodeAt(0) << 24) | (id.charCodeAt(1) << 16) | (id.charCodeAt(2) << 8) | id.charCodeAt(3)) >>> 0;
}

/** A float with at most 6 significant digits (0.1 rather than 0.10000000149). */
export function fmtFloat(f: number): string {
  return Number.isInteger(f) ? `${f}.0` : String(Number(f.toPrecision(6)));
}

export function fourcc(v: number): string | null {
  const s = String.fromCharCode((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  return /^[A-Z][A-Z0-9 ]{3}$/.test(s) ? s : null;
}

/** Finds live actor objects in a MEM1 dump by their vtable pointer (word 0 of each object). */
export function liveActors(mem1: Uint8Array, vtables: Map<number, string[]>): { addr: number; ids: string[]; screen: number; x: number; y: number }[] {
  const v = new DataView(mem1.buffer, mem1.byteOffset, mem1.byteLength);
  const out = [];
  for (let o = 0; o + 0x18 <= mem1.length; o += 4) {
    const ids = vtables.get(v.getUint32(o));
    if (ids) out.push({ addr: 0x80000000 + o, ids, screen: v.getUint32(o + 4), x: v.getFloat32(o + 12), y: v.getFloat32(o + 16) });
  }
  return out;
}
