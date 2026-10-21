import { describe, expect, it } from "vitest";
import { decodeCommand, disassemble, formatCommand, formatListing } from "./bms.ts";
import { Bytes } from "./test-helpers.ts";

const cmd = (...bytes: number[]) => decodeCommand(Uint8Array.from(bytes), 0);

describe("BMS commands", () => {
  it("decodes notes, gate notes with variable-length durations and note-offs", () => {
    expect(cmd(0x3c, 0x01, 0x64)).toMatchObject({ kind: "note", length: 3, args: [60, 1, 100] });
    expect(cmd(0x3c, 0x80, 0x64, 0x85, 0x50)).toMatchObject({ kind: "gate", length: 5, args: [60, 100, 720, 0x80] });
    expect(cmd(0x83)).toMatchObject({ kind: "noteoff", length: 1, args: [3] });
    expect(formatCommand(cmd(0x3c, 0x80, 0x64, 0x10))).toBe("gate C4 vel 100 len 16 sweep");
  });

  it("decodes fixed-argument commands from the table", () => {
    expect(cmd(0xc1, 0x02, 0x00, 0x01, 0x23)).toMatchObject({ name: "opentrack", length: 5, args: [2, 0x123] });
    expect(cmd(0xd8, 0x62, 0x00, 0x78)).toMatchObject({ name: "regload", args: [0x62, 120] });
    expect(formatCommand(cmd(0xd8, 0x62, 0x00, 0x78))).toBe("regload timebase, 120");
    expect(cmd(0xe0, 0x00, 0x91)).toMatchObject({ name: "tempo", args: [145] });
    expect(cmd(0xb8, 0x00, 0x7f)).toMatchObject({ name: "param", args: [0, 127] });
    expect(cmd(0xf0, 0x87, 0x40)).toMatchObject({ name: "wait", length: 3, args: [960] });
    expect(cmd(0xdc, 0x0e, 0x26, 0x00, 0x00, 0xcc, 0x00)).toMatchObject({ name: "regtblload", args: [14, 38, 0xcc, 0], regMask: 8 });
    expect(cmd(0xfd, 0x68, 0x69, 0x25, 0x64, 0x00, 0x07)).toMatchObject({ name: "printf", text: "hi%d", args: [7], length: 7 });
    expect(cmd(0xa0)).toMatchObject({ kind: "unknown", length: 1 });
  });

  it("applies 0x9X register overrides to the selected arguments", () => {
    // 0x91: two masked arguments; mask 0x40 = second argument from a register.
    const c = cmd(0x91, 0x40, 0xc1, 0x03, 0x26);
    expect(c).toMatchObject({ name: "opentrack", length: 5, args: [3, 0x26], regMask: 2 });
    expect(formatCommand(c)).toBe("opentrack 3, r38");
  });
});

describe("BMS disassembly", () => {
  it("follows tracks, calls and jumps", () => {
    const seq = Uint8Array.from([
      0xc1, 0x00, 0x00, 0x00, 0x0f, // 00 opentrack 0, 0x0f
      0xe0, 0x00, 0x78, // 05 tempo 120
      0xf1, 0x30, // 08 waitbyte 48
      0xc7, 0x00, 0x00, 0x05, // 0a jmp 0x05
      0xee, // 0e unreachable garbage
      0xc3, 0x00, 0x00, 0x18, // 0f call 0x18
      0x3c, 0x01, 0x64, // 13 noteon C4 v1
      0x81, // 16 noteoff v1
      0xff, // 17 finish
      0xb8, 0x03, 0x40, // 18 param pan
      0xc5, // 1b ret
    ]);
    const listing = disassemble(seq);
    expect(listing.errors).toEqual([]);
    expect(listing.tracks.map((t) => [t.number, t.offset])).toEqual([[-1, 0], [0, 0x0f]]);
    expect(listing.commands.map((c) => c.offset)).toEqual([0, 5, 8, 0x0a, 0x0f, 0x13, 0x16, 0x17, 0x18, 0x1b]);
    expect(formatListing(listing)).toContain("; track 0 (opened at 0x000000)");
  });

  it("resolves tracks opened through a table of offsets", () => {
    const b = new Bytes();
    b.u8(0xdc, 0x0e, 0x26).u24(0x20).u8(0x00); // 00 regtblload u24 r38, [0x20 + r0]
    b.u8(0x91, 0x40, 0xc1, 0x00, 0x26); // 07 opentrack 0, r38
    b.u8(0xdc, 0x0e, 0x26).u24(0x26).u8(0x00); // 0c regtblload u24 r38, [0x26 + r0]
    b.u8(0x91, 0x40, 0xc1, 0x01, 0x26); // 13 opentrack 1, r38
    b.u8(0xff).pad(0x20); // 18 finish
    b.u24(0x2c, 0x2d, 0x2e, 0x2f).u8(0xff, 0xff, 0xff, 0xff); // two 2-entry tables, then four tracks
    const listing = disassemble(b.bytes());
    expect(listing.errors).toEqual([]);
    expect(listing.tracks.map((t) => [t.number, t.offset])).toEqual([[-1, 0], [0, 0x2c], [0, 0x2d], [1, 0x2e], [1, 0x2f]]);
  });
});
