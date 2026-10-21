// A small PowerPC (Gekko) instruction decoder for exploring main.dol: the integer, branch, load/store and common float
// opcodes, enough to follow constants into calls. Written from the PowerPC architecture manual; paired-single and
// rarer instructions decode as placeholders.
export interface Insn {
  addr: number;
  word: number;
  op: string;
  args: string;
  /** Destination register (or crf for compares, BO for conditional branches). */
  rd?: number;
  ra?: number;
  rb?: number;
  /** Immediate (signed for arithmetic/D-form offsets, unsigned for logical ops and lis). */
  imm?: number;
  target?: number;
  link?: boolean;
}

const s16 = (v: number) => (v & 0x8000 ? v - 0x10000 : v);
const hex = (v: number) => (v < 0 ? `-0x${(-v).toString(16)}` : `0x${v.toString(16)}`);
const CR_TRUE = ["lt", "gt", "eq", "so"], CR_FALSE = ["ge", "le", "ne", "ns"];

const X31: Record<number, string> = {
  0: "cmpw", 8: "subfc", 10: "addc", 11: "mulhwu", 19: "mfcr", 20: "lwarx", 23: "lwzx", 24: "slw", 26: "cntlzw", 28: "and",
  32: "cmplw", 40: "subf", 54: "dcbst", 55: "lwzux", 60: "andc", 75: "mulhw", 86: "dcbf", 87: "lbzx", 104: "neg",
  119: "lbzux", 124: "nor", 136: "subfe", 138: "adde", 144: "mtcrf", 151: "stwx", 183: "stwux", 200: "subfze",
  202: "addze", 215: "stbx", 235: "mullw", 266: "add", 279: "lhzx", 284: "eqv", 316: "xor", 339: "mfspr", 343: "lhax",
  407: "sthx", 412: "orc", 444: "or", 459: "divwu", 467: "mtspr", 470: "dcbi", 491: "divw", 535: "lfsx", 536: "srw",
  598: "sync", 599: "lfdx", 663: "stfsx", 727: "stfdx", 792: "sraw", 824: "srawi", 922: "extsh", 954: "extsb", 982: "icbi",
  1014: "dcbz",
};
const LOGICAL31 = new Set([24, 26, 28, 60, 124, 284, 316, 412, 444, 536, 792, 824, 922, 954]);
const D_FORM: Record<number, [string, boolean]> = {
  32: ["lwz", false], 33: ["lwzu", false], 34: ["lbz", false], 35: ["lbzu", false], 36: ["stw", false], 37: ["stwu", false],
  38: ["stb", false], 39: ["stbu", false], 40: ["lhz", false], 41: ["lhzu", false], 42: ["lha", false], 43: ["lhau", false],
  44: ["sth", false], 45: ["sthu", false], 46: ["lmw", false], 47: ["stmw", false], 48: ["lfs", true], 49: ["lfsu", true],
  50: ["lfd", true], 51: ["lfdu", true], 52: ["stfs", true], 53: ["stfsu", true], 54: ["stfd", true], 55: ["stfdu", true],
};
const FLOAT_A: Record<number, string> = { 18: "fdiv", 20: "fsub", 21: "fadd", 23: "fsel", 24: "fres", 25: "fmul", 26: "frsqrte", 28: "fmsub", 29: "fmadd", 30: "fnmsub", 31: "fnmadd" };
const FLOAT_X: Record<number, string> = { 0: "fcmpu", 12: "frsp", 14: "fctiw", 15: "fctiwz", 32: "fcmpo", 40: "fneg", 72: "fmr", 136: "fnabs", 264: "fabs", 583: "mffs", 711: "mtfsf" };
const CR_OPS: Record<number, string> = { 33: "crnor", 129: "crandc", 193: "crxor", 225: "crnand", 257: "crand", 289: "creqv", 417: "crorc", 449: "cror" };
// Paired singles (opcode 4): A-form by the low 5 bits of the extended opcode, X-form by all 10.
const PS_A: Record<number, string> = {
  10: "ps_sum0", 11: "ps_sum1", 12: "ps_muls0", 13: "ps_muls1", 14: "ps_madds0", 15: "ps_madds1", 18: "ps_div", 20: "ps_sub",
  21: "ps_add", 23: "ps_sel", 24: "ps_res", 25: "ps_mul", 26: "ps_rsqrte", 28: "ps_msub", 29: "ps_madd", 30: "ps_nmsub", 31: "ps_nmadd",
};
const PS_X: Record<number, string> = { 0: "ps_cmpu0", 40: "ps_neg", 72: "ps_mr", 136: "ps_nabs", 264: "ps_abs", 528: "ps_merge00", 560: "ps_merge01", 592: "ps_merge10", 624: "ps_merge11" };
const s12 = (v: number) => (v & 0x800 ? v - 0x1000 : v);

export function decode(word: number, addr: number): Insn {
  const opcd = word >>> 26;
  const rd = (word >>> 21) & 31, ra = (word >>> 16) & 31, rb = (word >>> 11) & 31;
  const uimm = word & 0xffff, simm = s16(uimm);
  const I = (op: string, args: string, extra: Partial<Insn> = {}): Insn => ({ addr, word, op, args, ...extra });
  switch (opcd) {
    case 7: return I("mulli", `r${rd}, r${ra}, ${simm}`, { rd, ra, imm: simm });
    case 8: return I("subfic", `r${rd}, r${ra}, ${simm}`, { rd, ra, imm: simm });
    case 10: return I("cmplwi", `cr${rd >> 2}, r${ra}, ${hex(uimm)}`, { rd: rd >> 2, ra, imm: uimm });
    case 11: return I("cmpwi", `cr${rd >> 2}, r${ra}, ${simm}`, { rd: rd >> 2, ra, imm: simm });
    case 12: return I("addic", `r${rd}, r${ra}, ${simm}`, { rd, ra, imm: simm });
    case 13: return I("addic.", `r${rd}, r${ra}, ${simm}`, { rd, ra, imm: simm });
    case 14: return ra === 0 ? I("li", `r${rd}, ${simm}`, { rd, ra, imm: simm }) : I("addi", `r${rd}, r${ra}, ${simm}`, { rd, ra, imm: simm });
    case 15: return ra === 0 ? I("lis", `r${rd}, ${hex(uimm)}`, { rd, ra, imm: uimm }) : I("addis", `r${rd}, r${ra}, ${hex(uimm)}`, { rd, ra, imm: uimm });
    case 16: {
      const bo = rd, bi = ra, target = (word & 2 ? s16(word & 0xfffc) : addr + s16(word & 0xfffc)) >>> 0;
      let name = "bc";
      if ((bo & 0x14) === 0x14) name = "b";
      else if ((bo & 0x1c) === 0x0c) name = `b${CR_TRUE[bi & 3]}`;
      else if ((bo & 0x1c) === 0x04) name = `b${CR_FALSE[bi & 3]}`;
      else if (bo === 16) name = "bdnz";
      else if (bo === 18) name = "bdz";
      return I(name + (word & 1 ? "l" : ""), `cr${bi >> 2}, 0x${target.toString(16)}`, { target, link: !!(word & 1), rd: bo, ra: bi });
    }
    case 18: {
      let li = word & 0x03fffffc;
      if (li & 0x02000000) li -= 0x04000000;
      const target = (word & 2 ? li : addr + li) >>> 0;
      return I(word & 1 ? "bl" : "b", `0x${target.toString(16)}`, { target, link: !!(word & 1) });
    }
    case 19: {
      const xo = (word >>> 1) & 0x3ff, lk = word & 1 ? "l" : "";
      if (xo === 16) return I(rd === 20 ? `blr${lk}` : `bclr${lk}`, `${rd}, ${ra}`, { rd, ra });
      if (xo === 528) return I(rd === 20 ? `bctr${lk}` : `bcctr${lk}`, `${rd}, ${ra}`, { rd, ra });
      if (CR_OPS[xo]) return I(CR_OPS[xo]!, `${rd}, ${ra}, ${rb}`);
      return I(xo === 150 ? "isync" : `cr.${xo}`, "");
    }
    case 20: return I("rlwimi", `r${ra}, r${rd}, ${rb}, ${(word >>> 6) & 31}, ${(word >>> 1) & 31}`, { rd: ra, ra: rd });
    case 21: return I(`rlwinm${word & 1 ? "." : ""}`, `r${ra}, r${rd}, ${rb}, ${(word >>> 6) & 31}, ${(word >>> 1) & 31}`, { rd: ra, ra: rd, imm: rb });
    case 23: return I("rlwnm", `r${ra}, r${rd}, r${rb}`, { rd: ra, ra: rd });
    case 24: return word === 0x60000000 ? I("nop", "") : I("ori", `r${ra}, r${rd}, ${hex(uimm)}`, { rd: ra, ra: rd, imm: uimm });
    case 25: return I("oris", `r${ra}, r${rd}, ${hex(uimm)}`, { rd: ra, ra: rd, imm: uimm });
    case 26: return I("xori", `r${ra}, r${rd}, ${hex(uimm)}`, { rd: ra, ra: rd, imm: uimm });
    case 27: return I("xoris", `r${ra}, r${rd}, ${hex(uimm)}`, { rd: ra, ra: rd, imm: uimm });
    case 28: return I("andi.", `r${ra}, r${rd}, ${hex(uimm)}`, { rd: ra, ra: rd, imm: uimm });
    case 29: return I("andis.", `r${ra}, r${rd}, ${hex(uimm)}`, { rd: ra, ra: rd, imm: uimm });
    case 31: {
      const xo = (word >>> 1) & 0x3ff, name = X31[xo] ?? `x31.${xo}`;
      if (xo === 444 && rd === rb) return I("mr", `r${ra}, r${rd}`, { rd: ra, ra: rd });
      if (xo === 339 || xo === 467) {
        const spr = (rb << 5) | ra, sprName = spr === 8 ? "lr" : spr === 9 ? "ctr" : `spr${spr}`;
        return I(`${xo === 339 ? "mf" : "mt"}${sprName}`, `r${rd}`, { rd });
      }
      if (xo === 0 || xo === 32) return I(name, `cr${rd >> 2}, r${ra}, r${rb}`, { rd: rd >> 2, ra, rb });
      if (LOGICAL31.has(xo)) return I(name + (word & 1 ? "." : ""), `r${ra}, r${rd}, ${xo === 824 ? rb : `r${rb}`}`, { rd: ra, ra: rd, rb });
      // lfsx / lfdx / stfsx / stfdx move a float register.
      return I(name, `${xo === 535 || xo === 599 || xo === 663 || xo === 727 ? "f" : "r"}${rd}, r${ra}, r${rb}`, { rd, ra, rb });
    }
    case 56:
    case 57:
    case 60:
    case 61: {
      // psq_l / psq_lu / psq_st / psq_stu: 12-bit displacement, W bit (one float instead of two), quantization register.
      const name = ["psq_l", "psq_lu", "", "", "psq_st", "psq_stu"][opcd - 56]!;
      const d = s12(word & 0xfff), w = (word >>> 15) & 1, q = (word >>> 12) & 7;
      return I(name, `f${rd}, ${hex(d)}(r${ra}), ${w}, qr${q}`, { rd, ra, imm: d });
    }
    case 59:
    case 63: {
      const xa = (word >>> 1) & 31, a = FLOAT_A[xa], x = FLOAT_X[(word >>> 1) & 0x3ff];
      const name = a ? a + (opcd === 59 ? "s" : "") : x ?? `f${opcd}.${(word >>> 1) & 0x3ff}`;
      // A-form operands: fmul D, A, C; the multiply-adds and fsel D, A, C, B; fres / frsqrte D, B; the rest D, A, B.
      const rc = (word >>> 6) & 31;
      // X-form: the compares crD, A, B; mffs D; frsp, fctiw(z), fneg, fmr, fnabs, fabs D, B.
      const xo = (word >>> 1) & 0x3ff;
      const xArgs = xo === 0 || xo === 32 ? `cr${rd >> 2}, f${ra}, f${rb}` : xo === 583 ? `f${rd}` : xo === 711 ? `${(word >>> 17) & 0xff}, f${rb}` : x ? `f${rd}, f${rb}` : `f${rd}, f${ra}, f${rb}`;
      const args = !a ? xArgs : xa === 25 ? `f${rd}, f${ra}, f${rc}` : xa === 23 || xa >= 28 ? `f${rd}, f${ra}, f${rc}, f${rb}` : xa === 24 || xa === 26 ? `f${rd}, f${rb}` : `f${rd}, f${ra}, f${rb}`;
      return I(name, args, { rd, ra, rb });
    }
    case 4: {
      const xo = (word >>> 1) & 0x3ff, rc = (word >>> 6) & 31;
      if (PS_X[xo]) {
        // ps_cmpu0 crD, A, B; ps_neg / ps_mr / ps_nabs / ps_abs D, B; the merges D, A, B.
        const args = xo === 0 ? `cr${rd >> 2}, f${ra}, f${rb}` : xo < 528 ? `f${rd}, f${rb}` : `f${rd}, f${ra}, f${rb}`;
        return I(PS_X[xo]!, args, { rd, ra, rb });
      }
      const a = PS_A[xo & 31];
      // Like the scalar A-form: the multiplies D, A, C; the multiply-adds, sums and ps_sel D, A, C, B; res / rsqrte D, B.
      if (a) {
        const args = /muls[01]$|mul$/.test(a) ? `f${rd}, f${ra}, f${rc}` : /madds|madd$|msub$|sel$|sum/.test(a) ? `f${rd}, f${ra}, f${rc}, f${rb}` : /res$|rsqrte$/.test(a) ? `f${rd}, f${rb}` : `f${rd}, f${ra}, f${rb}`;
        return I(a, args, { rd, ra, rb });
      }
      return I("ps", `${xo}`);
    }
    default: {
      const d = D_FORM[opcd];
      if (d) return I(d[0], `${d[1] ? "f" : "r"}${rd}, ${hex(simm)}(r${ra})`, { rd, ra, imm: simm });
      return I(".long", `0x${word.toString(16).padStart(8, "0")}`);
    }
  }
}
