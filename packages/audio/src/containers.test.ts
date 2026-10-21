import { describe, expect, it } from "vitest";
import { parseBaa } from "./baa.ts";
import { parseSoundTable } from "./bst.ts";
import { parseIbnk } from "./ibnk.ts";
import { seSequenceStart } from "./jaudio.ts";
import { Bytes } from "./test-helpers.ts";
import { parseWsys } from "./wsys.ts";

describe("BAA", () => {
  it("lists commands until the end marker", () => {
    const b = new Bytes().text("AA_<").text("ws  ").u32(0, 0x40, 0xffffffff).text("bnk ").u32(128, 0x80).text("bst ").u32(0x100, 0x110);
    b.text("bms ").u32(3, 0x200, 0x280).text(">_AA");
    expect(parseBaa(b.bytes())).toEqual([
      { tag: "ws  ", id: 0, offset: 0x40, flags: 0xffffffff },
      { tag: "bnk ", id: 128, offset: 0x80 },
      { tag: "bst ", start: 0x100, end: 0x110 },
      { tag: "bms ", id: 3, start: 0x200, end: 0x280 },
    ]);
    expect(() => parseBaa(new Bytes().text("AA_<").text("zzzz").bytes())).toThrow(/unknown/);
  });
});

describe("WSYS", () => {
  it("reads wave records and their ids from the scene tables", () => {
    const b = new Bytes().text("WSYS").u32(0x170, 5, 0).u32(0x20, 0x40).pad(0x20);
    b.text("WINF").u32(1, 0x60).pad(0x40);
    b.text("WBCT").u32(0, 1, 0x110).pad(0x60);
    b.text("test_0.aw", 0x70).u32(1, 0xe0).pad(0xe0);
    b.u8(0xff, 0, 60, 0).f32(32000).u32(0x20, 18, 0xffffffff, 16, 32, 32).u16(5, 4).pad(0x110);
    b.text("SCNE").u32(0, 0, 0x130, 0x150, 0x160).pad(0x130);
    b.text("C-DF").u32(1, 0x140).pad(0x140).u32(7).pad(0x150);
    b.text("C-EX").u32(0).pad(0x160).text("C-ST").u32(0).pad(0x170);
    const wsys = parseWsys(b.bytes());
    expect(wsys.id).toBe(5);
    expect(wsys.archives).toEqual(["test_0.aw"]);
    expect(wsys.byId.get(7)).toEqual({
      id: 7, archive: "test_0.aw", format: 0, baseKey: 60, sampleRate: 32000, offset: 0x20, size: 18,
      loop: true, loopStart: 16, loopEnd: 32, sampleCount: 32, loopLast: 5, loopPenult: 4,
    });
  });
});

describe("IBNK", () => {
  it("parses version 0 instruments, oscillators and PER2 drum sets", () => {
    const b = new Bytes().text("IBNK").u32(0x980, 3, 0).pad(0x20).text("BANK");
    for (let p = 0; p < 240; p++) b.u32(p === 2 ? 0x400 : p === 228 ? 0x500 : 0);
    b.pad(0x400).text("INST").u32(0).f32(0.5, 2).u32(0x440, 0, 0, 0, 0, 0, 2, 0x460, 0x470).pad(0x440);
    b.u8(0, 0, 0, 0).f32(1).u32(0x4a0, 0x4c0).f32(1, 0).pad(0x460);
    b.u8(59, 0, 0, 0).u32(1, 0x4e0).pad(0x470).u8(127, 0, 0, 0).u32(1, 0x4f0).pad(0x4a0);
    b.u16(0, 0, 32767, 14, 0, 0).pad(0x4c0).u16(3, 100, 0, 15, 0, 0).pad(0x4e0);
    b.u8(127, 0, 0, 0).u32(1).f32(1, 1).u8(127, 0, 0, 0).u32(2).f32(0.25, 0.5).pad(0x500);
    b.text("PER2").pad(0x588);
    for (let k = 0; k < 128; k++) b.u32(k === 36 ? 0x940 : 0);
    for (let k = 0; k < 128; k++) b.u8(k === 36 ? 127 : 0);
    for (let k = 0; k < 128; k++) b.u16(k === 36 ? 500 : 0);
    b.pad(0x940).f32(0.8, 1.5).u32(0, 0, 1, 0x960).pad(0x960).u8(127, 0, 0, 0).u32(3).f32(1, 1).pad(0x980);
    const bank = parseIbnk(b.bytes());
    expect([bank.id, bank.version, [...bank.programs.keys()]]).toEqual([3, 0, [2, 228]]);
    const inst = bank.programs.get(2)!;
    if (inst.type !== "inst") throw new Error("expected an instrument");
    expect([inst.volume, inst.pitch, inst.keys.map((k) => k.highKey)]).toEqual([0.5, 2, [59, 127]]);
    expect(inst.keys[1]!.velocities[0]).toEqual({ highVelocity: 127, wsys: 0, wave: 2, volume: 0.25, pitch: 0.5 });
    expect(inst.oscillators[0]!.attack).toEqual([{ mode: 0, time: 0, value: 32767 }, { mode: 14, time: 0, value: 0 }]);
    expect(inst.oscillators[0]!.release).toEqual([{ mode: 3, time: 100, value: 0 }, { mode: 15, time: 0, value: 0 }]);
    const drums = bank.programs.get(228)!;
    if (drums.type !== "drums") throw new Error("expected drums");
    expect(drums.keys[36]).toEqual({ volume: 0.800000011920929, pitch: 1.5, pan: 1, release: 500, velocities: [{ highVelocity: 127, wsys: 0, wave: 3, volume: 1, pitch: 1 }] });
  });

  it("parses version 1 chunked banks (ENVT/OSCT/LIST with Inst and Perc)", () => {
    const b = new Bytes().text("IBNK").u32(0x110, 128, 1).pad(0x20);
    b.text("ENVT").u32(12).u16(0, 0, 32767, 14, 0, 0).pad(0x34);
    b.text("OSCT").u32(0x20).u32(1).text("Osci").u8(0, 0, 0, 0).f32(1).u32(0, 0).f32(1, 0).pad(0x5c);
    b.text("LIST").u32(12).u32(2, 0x80, 0xc0).pad(0x70);
    b.text("INST").u32(0x98).pad(0x80);
    b.text("Inst").u32(1, 0, 0, 1, 0x7f000000, 1, 0x7f000000, (0x80 << 16) | 5).f32(0.5, 2, 0.75, 1.25).pad(0xc0);
    b.text("Perc").u32(2, 0, 0xe0).pad(0xe0);
    b.text("Pmap").f32(0.9, 1.1).u8(127, 0).u16(300).u32(0, 1, 0x7f000000, (0x80 << 16) | 6).f32(1, 1).pad(0x110);
    const bank = parseIbnk(b.bytes());
    expect([bank.id, bank.version]).toEqual([128, 1]);
    const inst = bank.programs.get(0)!;
    if (inst.type !== "inst") throw new Error("expected an instrument");
    expect([inst.volume, inst.pitch, inst.oscillators.length]).toEqual([0.75, 1.25, 1]);
    expect(inst.keys).toEqual([{ highKey: 127, velocities: [{ highVelocity: 127, wsys: 0x80, wave: 5, volume: 0.5, pitch: 2 }] }]);
    expect(inst.oscillators[0]!.attack?.length).toBe(2);
    const drums = bank.programs.get(1)!;
    if (drums.type !== "drums") throw new Error("expected drums");
    expect(drums.keys[0]).toBeUndefined();
    expect(drums.keys[1]).toMatchObject({ pan: 1, release: 300, velocities: [{ wave: 6 }] });
  });
});

describe("sequence collection", () => {
  it("indexes sound effects by group and index", () => {
    const b = new Bytes().u8(0x53, 0x43).u16(2).u32(0x40, 0x10, 0x18).pad(0x10).u32(1, 0x30).u32(2, 0x31, 0x38).pad(0x40);
    expect([seSequenceStart(b.bytes(), 0, 0), seSequenceStart(b.bytes(), 1, 1), seSequenceStart(b.bytes(), 1, 2), seSequenceStart(b.bytes(), 2, 0)]).toEqual([
      0x30, 0x38, undefined, undefined,
    ]);
  });
});

describe("BST / BSTN", () => {
  it("joins sound items with their names and decodes sequence items", () => {
    const bst = new Bytes().text("BST ").u32(0, 0x01000000, 0x20).pad(0x20).u32(1, 0x28).u32(1, 0x30);
    bst.u32(2, 0, (0x11 << 24) | 0x40, (0x10 << 24) | 0x4c).pad(0x40).u8(1, 0x40, 0x37, 0).u32(0, 0x01000024).u8(2, 0x7e, 0x64, 0).u32(0);
    const bstn = new Bytes().text("BSTN").u32(0, 0x01000000, 0x20).pad(0x20).u32(1, 0x28).u32(1, 0x60, 0x34);
    bstn.u32(2, 0x64, 0x68, 0x74).pad(0x60).text("BGM\0G0\0\0JA_BGM_TEST\0").pad(0x74).text("JA_SE_X\0");
    const sounds = parseSoundTable(bst.bytes(), bstn.bytes());
    expect(sounds.map((s) => [s.id, s.type, s.name, s.groupName, s.sectionName, s.sequence, s.slot])).toEqual([
      [0, 0x11, "JA_BGM_TEST", "G0", "BGM", 0x24, 1],
      [1, 0x10, "JA_SE_X", "G0", "BGM", undefined, undefined],
    ]);
  });
});
