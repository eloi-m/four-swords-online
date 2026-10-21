// BMS sequence bytecode, JAudio2 dialect (FSA's Seqs/JaiSeqs.arc and the "bsc " sequence collection). Big-endian.
//   00–7F  note: key = opcode, u8 flags (low 3 bits = voice 1–7; 0 = a gate note on voice 0 whose MIDI-style
//          variable-length duration follows the velocity; bit 7 = sweep from the last key, bit 6 = tie), u8 velocity
//   80–8F  note off, voice = opcode & 7
//   90–9F  register override: u8 mask (MSB first: the first (opcode & 7) + 1 arguments are read as a register
//          index instead of an immediate), then any A0–FF command
//   A0–FF  commands with fixed arguments, from the table below; B0 is an escape to an extended table
// The argument table (count and u8/u16/u24/register types per command) was read from FSA's own main.dol (the
// sequence parser's command table at 0x80491E54); it matches Twilight Princess's JAudio2 except that 0xE7 has no
// arguments in FSA. Command names are ours.
import { dataView } from "@fso/formats";

export const ArgType = { U8: 0, U16: 1, U24: 2, Reg: 3 } as const;

interface CommandSpec {
  name: string;
  types: number[];
}

const spec = (name: string, ...types: number[]): CommandSpec => ({ name, types });
const { U8, U16, U24, Reg } = ArgType;

/** Commands 0xA0–0xFF. Entries without a spec are unused (they decode as one-byte unknowns). */
export const COMMANDS: Record<number, CommandSpec> = {
  0xb1: spec("noteon", U8, U8, U8),
  0xb2: spec("noteoff", U8),
  0xb3: spec("note", U8, U8, U8, U16),
  0xb4: spec("setlastnote", U8),
  0xb8: spec("param", U8, U8),
  0xb9: spec("param16", U8, U16),
  0xba: spec("paramt", U8, U8, U16),
  0xbb: spec("param16t", U8, U16, U16),
  0xc1: spec("opentrack", U8, U24),
  0xc2: spec("closetrack", U8),
  0xc3: spec("call", U24),
  0xc4: spec("callf", U8, U24),
  0xc5: spec("ret"),
  0xc6: spec("retf", U8),
  0xc7: spec("jmp", U24),
  0xc8: spec("jmpf", U8, U24),
  0xc9: spec("jmptable", Reg, U24),
  0xca: spec("calltable", Reg, U24),
  0xcb: spec("loopstart", U16),
  0xcc: spec("loopend"),
  0xd0: spec("readport", U8, U8),
  0xd1: spec("writeport", U8, Reg),
  0xd2: spec("checkportin", U8),
  0xd3: spec("checkportout", U8),
  0xd4: spec("parentwriteport", U8, Reg),
  0xd5: spec("childwriteport", U8, Reg),
  0xd6: spec("parentreadport", U8, U8),
  0xd7: spec("childreadport", U8, U8),
  0xd8: spec("regload", U8, U16),
  0xd9: spec("reg", U8, U8, Reg),
  0xda: spec("reg", U8, U8, U16),
  0xdb: spec("reguni", U8, U8),
  0xdc: spec("regtblload", U8, U8, U24, Reg),
  0xe0: spec("tempo", U16),
  0xe1: spec("bankprg", U16),
  0xe2: spec("bank", U8),
  0xe3: spec("prg", U8),
  0xe7: spec("unk_e7"),
  0xe8: spec("envset", U8, U24),
  0xe9: spec("simpleadsr", U16, U16, U16, U16, U16),
  0xea: spec("busconnect", U8, U16),
  0xeb: spec("iircutoff", U8),
  0xec: spec("iirset", U16, U16, U16, U16),
  0xed: spec("firset", U24),
  0xf0: spec("wait"),
  0xf1: spec("waitbyte", U8),
  0xf3: spec("setinttable", U24),
  0xf4: spec("setinterrupt", U16),
  0xf5: spec("disinterrupt", U16),
  0xf6: spec("reti"),
  0xf7: spec("clri"),
  0xf8: spec("inttimer", U8, U16),
  0xf9: spec("synccpu", U16),
  0xfd: spec("printf"),
  0xfe: spec("nop"),
  0xff: spec("finish"),
};

const EXT_COMMANDS: Record<number, CommandSpec> = { 0x01: spec("dump") };

/** Named registers above 0x40 (readReg/writeReg targets). */
export const REGISTER_NAMES: Record<number, string> = {
  0x60: "children", 0x61: "loopcount", 0x62: "timebase", 0x63: "transpose", 0x64: "bendsense", 0x65: "gaterate",
  0x66: "skipsample", 0x67: "bank", 0x68: "prg", 0x69: "panpower", 0x6a: "prio", 0x6b: "noteonprio",
  0x6c: "releaseprio", 0x6d: "directrelease", 0x6e: "vibdepth", 0x6f: "vibdepthmidi", 0x70: "tremdepth",
  0x71: "vibpitch", 0x72: "trempitch", 0x73: "vibdelay", 0x74: "tremdelay",
};

export const PARAM_NAMES = ["volume", "pitch", "fxmix", "pan", "dolby", "distfilter"];

export type BmsKind = "note" | "gate" | "noteoff" | "command" | "unknown";

export interface BmsCommand {
  offset: number;
  length: number;
  opcode: number;
  kind: BmsKind;
  name: string;
  /** Argument values; register arguments hold the register index. */
  args: number[];
  /** Bit i set when argument i is a register index (register override or a Reg-typed argument). */
  regMask: number;
  /** printf format string. */
  text?: string;
}

function readVlq(bytes: Uint8Array, p: number): [value: number, length: number] {
  let b = bytes[p]!;
  if (!(b & 0x80)) return [b, 1];
  let value = b & 0x7f;
  for (let i = 1; i < 4; i++) {
    b = bytes[p + i]!;
    value = (value << 7) | (b & 0x7f);
    if (!(b & 0x80)) return [value, i + 1];
  }
  return [0, 4];
}

/** Decodes the command at `offset`. Throws past the end of the data. */
export function decodeCommand(bytes: Uint8Array, offset: number): BmsCommand {
  if (offset >= bytes.length) throw new Error(`BMS offset 0x${offset.toString(16)} is past the end`);
  const op = bytes[offset]!;
  if (op < 0x80) {
    const flags = bytes[offset + 1]!;
    const velocity = bytes[offset + 2]!;
    const voice = flags & 7;
    if (voice) return { offset, length: 3, opcode: op, kind: "note", name: "noteon", args: [op, voice, velocity], regMask: 0 };
    const [duration, n] = readVlq(bytes, offset + 3);
    return { offset, length: 3 + n, opcode: op, kind: "gate", name: "gate", args: [op, velocity, duration, flags], regMask: 0 };
  }
  if (op < 0x90) return { offset, length: 1, opcode: op, kind: "noteoff", name: "noteoff", args: [op & 7], regMask: 0 };
  let p = offset + 1;
  let overrideTypes = 0;
  let regMask = 0;
  let cmd = op;
  if (op < 0xa0) {
    let mask = bytes[p++]!;
    for (let i = 0; i < (op & 7) + 1; i++, mask <<= 1) {
      if (mask & 0x80) {
        overrideTypes |= 3 << (i * 2);
        regMask |= 1 << i;
      }
    }
    cmd = bytes[p++]!;
    if (cmd < 0xa0) return { offset, length: p - offset, opcode: op, kind: "unknown", name: `override_${hex(cmd)}`, args: [], regMask };
  }
  let command: CommandSpec | undefined;
  if (cmd === 0xb0) command = EXT_COMMANDS[bytes[p++]!];
  else command = COMMANDS[cmd];
  if (!command) return { offset, length: p - offset, opcode: cmd, kind: "unknown", name: `unk_${hex(cmd)}`, args: [], regMask };
  const v = dataView(bytes);
  const args: number[] = [];
  command.types.forEach((baseType, i) => {
    const type = baseType | ((overrideTypes >> (i * 2)) & 3);
    if (type === Reg) regMask |= 1 << i;
    if (type === U16) args.push(v.getUint16(p));
    else if (type === U24) args.push((v.getUint16(p) << 8) | bytes[p + 2]!);
    else args.push(bytes[p]!);
    p += type === U16 ? 2 : type === U24 ? 3 : 1;
  });
  let text: string | undefined;
  if (cmd === 0xf0) {
    const [value, n] = readVlq(bytes, p);
    args.push(value);
    p += n;
  } else if (cmd === 0xfd) {
    text = "";
    while (p < bytes.length && bytes[p]) text += String.fromCharCode(bytes[p++]!);
    p++;
    const formats = (text.match(/%[dxsrR]/g) ?? []).length;
    for (let i = 0; i < formats; i++) args.push(bytes[p++]!);
  }
  return { offset, length: p - offset, opcode: cmd, kind: "command", name: command.name, args, regMask, text };
}

const hex = (n: number, width = 2) => n.toString(16).padStart(width, "0");

/** Offsets this command can continue to: fallthrough and/or branch targets (tracks are listed separately). */
export function successors(cmd: BmsCommand): { next: boolean; targets: number[]; track?: number } {
  const end = cmd.offset + cmd.length;
  if (cmd.kind !== "command") return { next: true, targets: [] };
  const reg = (i: number) => (cmd.regMask >> i) & 1;
  switch (cmd.name) {
    case "jmp":
      return { next: false, targets: reg(0) ? [] : [cmd.args[0]!] };
    case "jmptable":
      return { next: false, targets: [] };
    case "jmpf":
    case "callf":
      return { next: true, targets: reg(1) ? [] : [cmd.args[1]!] };
    case "call":
      return { next: true, targets: reg(0) ? [] : [cmd.args[0]!] };
    case "opentrack":
      return { next: true, targets: [], track: reg(1) ? undefined : cmd.args[1] };
    case "ret":
    case "finish":
      return { next: false, targets: [] };
    default:
      return { next: end > cmd.offset, targets: [] };
  }
}

export interface BmsTrack {
  /** Track number given to opentrack (-1 for the root). */
  number: number;
  offset: number;
  /** Offset of the opentrack command (or -1). */
  openedAt: number;
}

export interface BmsListing {
  commands: BmsCommand[];
  tracks: BmsTrack[];
  labels: Set<number>;
  /** Offsets where decoding stopped on an unknown command or ran past the end. */
  errors: number[];
}

/**
 * Follows control flow from offset 0 (and every opened track) to find the reachable commands. Tracks opened
 * through a register loaded from a table of 24-bit offsets ("regtblload u24 rX, [table + rY]" then
 * "opentrack n, rX", the way FSA's field themes pick a variant from a port) are resolved to every table entry;
 * the entry count is guessed from the spacing between such tables. Interrupt vectors (setinttable) are followed
 * for every interrupt a setinterrupt enables.
 */
export function disassemble(bytes: Uint8Array): BmsListing {
  const seen = new Map<number, BmsCommand>();
  const labels = new Set<number>([0]);
  const tracks: BmsTrack[] = [{ number: -1, offset: 0, openedAt: -1 }];
  const trackStarts = new Set<number>([0]);
  const errors: number[] = [];
  const tableBases = new Set<number>();
  const dynamicOpens: { at: number; number: number; table: number }[] = [];
  const interruptTables = new Set<number>();
  let interruptMask = 0;
  const queue = [0];
  const openTrack = (number: number, offset: number, at: number) => {
    labels.add(offset);
    if (trackStarts.has(offset)) return;
    trackStarts.add(offset);
    tracks.push({ number, offset, openedAt: at });
    queue.push(offset);
  };
  const walk = () => {
    while (queue.length) {
      let p = queue.pop()!;
      const tables = new Map<number, number>();
      while (!seen.has(p)) {
        if (p >= bytes.length) {
          errors.push(p);
          break;
        }
        const cmd = decodeCommand(bytes, p);
        seen.set(p, cmd);
        if (cmd.kind === "unknown") {
          errors.push(p);
          break;
        }
        if (cmd.name === "regtblload" && cmd.args[0] === 14 && !((cmd.regMask >> 2) & 1)) {
          tables.set(cmd.args[1]!, cmd.args[2]!);
          tableBases.add(cmd.args[2]!);
        }
        if (cmd.name === "opentrack" && (cmd.regMask >> 1) & 1 && tables.has(cmd.args[1]!)) {
          dynamicOpens.push({ at: p, number: cmd.args[0]!, table: tables.get(cmd.args[1]!)! });
        }
        if (cmd.name === "setinttable" && !cmd.regMask) interruptTables.add(cmd.args[0]!);
        if (cmd.name === "setinterrupt" && !cmd.regMask) interruptMask |= cmd.args[0]!;
        const s = successors(cmd);
        for (const t of s.targets) {
          labels.add(t);
          queue.push(t);
        }
        if (s.track !== undefined) openTrack(cmd.args[0]!, s.track, p);
        if (!s.next) break;
        p += cmd.length;
      }
    }
  };
  walk();
  const bases = [...tableBases].sort((a, b) => a - b);
  const gaps = bases.slice(1).map((b, i) => b - bases[i]!).filter((g) => g > 0);
  const entries = gaps.length ? Math.max(1, Math.floor(Math.min(...gaps) / 3)) : 1;
  for (const open of dynamicOpens) {
    for (let k = 0; k < entries && open.table + 3 * k + 3 <= bytes.length; k++) {
      const q = open.table + 3 * k;
      const target = (bytes[q]! << 16) | (bytes[q + 1]! << 8) | bytes[q + 2]!;
      if (target < bytes.length) openTrack(open.number, target, open.at);
    }
  }
  // Interrupt handlers: the vectors of every enabled interrupt.
  for (const table of interruptTables) {
    for (let i = 0; i < 16; i++) {
      if (!((interruptMask >> i) & 1) || table + 3 * i + 3 > bytes.length) continue;
      const q = table + 3 * i;
      const target = (bytes[q]! << 16) | (bytes[q + 1]! << 8) | bytes[q + 2]!;
      if (target < bytes.length) {
        labels.add(target);
        queue.push(target);
      }
    }
  }
  walk();
  const commands = [...seen.values()].sort((a, b) => a.offset - b.offset);
  return { commands, tracks, labels, errors };
}

/** Operations of the "reg" command (0xD9/0xDA): register = f(register, operand). */
export const REG_OPS = ["set", "add", "sub", "cmp", "mul", "and", "or", "xor", "rand", "shl", "shr"];

const registerName = (r: number) => (REGISTER_NAMES[r] ? `${REGISTER_NAMES[r]}` : r >= 0x40 && r < 0x50 ? `port${r - 0x40}` : `r${r}`);

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (key: number) => `${NOTE_NAMES[key % 12]}${Math.floor(key / 12) - 1}`;

/** One-line text form of a command, e.g. `opentrack 2, 0x000452` or `noteon C4 v1 vel 100`. */
export function formatCommand(cmd: BmsCommand): string {
  const a = cmd.args;
  const arg = (i: number) => ((cmd.regMask >> i) & 1 ? `r${hex(a[i]!)}` : String(a[i]));
  switch (cmd.kind) {
    case "note":
      return `noteon ${noteName(a[0]!)} v${a[1]} vel ${a[2]}`;
    case "gate": {
      const flags = (a[3]! & 0x80 ? " sweep" : "") + (a[3]! & 0x40 ? " tie" : "");
      return `gate ${noteName(a[0]!)} vel ${a[1]} len ${a[2]}${flags}`;
    }
    case "noteoff":
      return `noteoff v${a[0]}`;
    case "unknown":
      return cmd.name;
  }
  switch (cmd.name) {
    case "opentrack":
      return `opentrack ${arg(0)}, ${(cmd.regMask >> 1) & 1 ? registerName(a[1]!) : `0x${hex(a[1]!, 6)}`}`;
    case "regtblload":
      return `regtblload ${["u8", "u16", "u24", "u32", "u32raw"][a[0]! - 12] ?? a[0]} ${registerName(a[1]!)}, [0x${hex(a[2]!, 6)} + ${arg(3)}]`;
    case "call":
    case "jmp":
      return `${cmd.name} 0x${hex(a[0]!, 6)}`;
    case "callf":
    case "jmpf":
      return `${cmd.name} ${["always", "zero", "nonzero", "one", "neg", "pos"][a[0]!] ?? a[0]}, 0x${hex(a[1]!, 6)}`;
    case "param":
    case "param16":
    case "paramt":
    case "param16t":
      return `${cmd.name} ${PARAM_NAMES[a[0]!] ?? a[0]}, ${a.slice(1).map((_, i) => arg(i + 1)).join(", ")}`;
    case "regload":
      return `regload ${registerName(a[0]!)}, ${arg(1)}`;
    case "readport":
      return `readport ${arg(0)}, ${registerName(a[1]!)}`;
    case "reg":
      return `reg ${REG_OPS[a[0]!] ?? a[0]} ${registerName(a[1]!)}, ${arg(2)}`;
    case "printf":
      return `printf ${JSON.stringify(cmd.text)}${a.length ? ", " + a.join(", ") : ""}`;
    default:
      return a.length ? `${cmd.name} ${a.map((_, i) => arg(i)).join(", ")}` : cmd.name;
  }
}

/** Text listing with offsets and labels. */
export function formatListing(listing: BmsListing): string {
  const trackAt = new Map(listing.tracks.map((t) => [t.offset, t]));
  const lines: string[] = [];
  for (const cmd of listing.commands) {
    const track = trackAt.get(cmd.offset);
    if (track) lines.push(track.number < 0 ? "; root track" : `; track ${track.number} (opened at 0x${hex(track.openedAt, 6)})`);
    else if (listing.labels.has(cmd.offset)) lines.push(`L_${hex(cmd.offset, 6)}:`);
    lines.push(`  ${hex(cmd.offset, 6)}  ${formatCommand(cmd)}`);
  }
  for (const e of listing.errors) lines.push(`; decode stopped at 0x${hex(e, 6)}`);
  return lines.join("\n");
}
