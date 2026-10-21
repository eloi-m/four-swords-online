import { describe, expect, it } from "vitest";
import { encodePad, HEADER_SIZE, portBits, readDtmPolls, writeDtm } from "./dtm.ts";
import { gbaPad, parsePorts, parseScript, toPolls, toPortStates } from "./script.ts";

describe("DTM writer", () => {
  it("writes a 256-byte header and one 8-byte state per poll", () => {
    const dtm = writeDtm([{}, { stickX: 255 }], { gameId: "G4SE01", fromSaveState: true });
    const view = new DataView(dtm.buffer);
    expect(dtm.length).toBe(HEADER_SIZE + 16);
    expect(String.fromCharCode(...dtm.subarray(0, 3))).toBe("DTM");
    expect(dtm[3]).toBe(0x1a);
    expect(String.fromCharCode(...dtm.subarray(4, 10))).toBe("G4SE01");
    expect(dtm[0x0b]).toBe(1); // GC pad 1
    expect(dtm[0x0c]).toBe(1); // from savestate
    expect(view.getBigUint64(0x15, true)).toBe(2n); // input count
    expect(dtm[0x89]).toBe(0); // bSaveConfig off: use the current settings
    expect(readDtmPolls(dtm).map((p) => p[4])).toEqual([128, 255]);
    expect(dtm[0xa1]).toBe(0); // no GBA
  });

  it("marks integrated GBA ports in the header (controllers and GBAControllers)", () => {
    const bits = portBits(["gba", "gc", "none", "gba"]);
    expect(bits).toEqual({ controllers: 0b1011, gbas: 0b1001 });
    const dtm = writeDtm([{}, {}, {}], { gameId: "G4SE01", fromSaveState: false, ...bits, frames: 7 });
    expect(dtm[0x0b]).toBe(0b1011);
    expect(dtm[0x0c]).toBe(0);
    expect(dtm[0xa1]).toBe(0b1001);
    expect(new DataView(dtm.buffer).getBigUint64(0x0d, true)).toBe(7n); // frameCount
  });

  it("packs ControllerState bitfields LSB first, with is_connected set", () => {
    const s = encodePad({ start: true, b: true, right: true, stickY: 1 });
    expect(s[0]).toBe(0b101); // Start, B
    expect(s[1]).toBe(0b0100_0010); // DPadRight, is_connected
    expect([...s.subarray(2)]).toEqual([0, 0, 128, 1, 128, 128]);
  });
});

describe("trace scripts", () => {
  it("parses segments into per-poll inputs", () => {
    const segments = parseScript("2 idle; 1 up-right+B; 1 stick=10,20+dpad-left");
    expect(segments.map((s) => s.frames)).toEqual([2, 1, 1]);
    expect(segments[1]!.input).toEqual({ b: true, stickX: 218, stickY: 218 });
    expect(segments[2]!.input).toEqual({ stickX: 10, stickY: 20, left: true });
    expect(toPolls(segments, 2)).toHaveLength(8);
  });

  it("takes one input per player (p1:… p2:…), a bare spec being player 1's", () => {
    const [s] = parseScript("3 p2:A p4:left+START");
    expect(s!.inputs).toEqual([{}, { a: true }, {}, { start: true, stickX: 1, stickY: 128 }]);
    expect(s!.input).toEqual({});
    expect(parseScript("1 right")[0]!.inputs[0]).toEqual({ stickX: 255, stickY: 128 });
    expect(() => parseScript("1 p5:A")).toThrow();
  });

  it("interleaves the plugged ports per poll, GBA ports on the D-pad", () => {
    const states = toPortStates(parseScript("1 p1:up+B p2:SELECT+R"), 2, parsePorts("gba,gc,none"));
    expect(states).toHaveLength(4); // 2 polls × 2 plugged ports
    expect(states[0]).toEqual({ up: true, down: false, left: false, right: false, b: true });
    expect(states[1]).toEqual({ z: true, r: true, triggerR: 255 });
    expect(states[2]).toEqual(states[0]);
    expect(encodePad(states[0]!)[0]! & 0x40).toBe(0x40); // DPadUp
    expect(gbaPad({ stickX: 218, stickY: 38 })).toMatchObject({ right: true, down: true, up: false, left: false });
    expect(() => parsePorts("gba,gamecube")).toThrow();
  });

  it("presses the analog trigger with the shoulder buttons (FSA reads R's analog value)", () => {
    expect(parseScript("1 R; 1 L+A")[0]!.input).toEqual({ r: true, triggerR: 255 });
    expect(parseScript("1 L+A")[0]!.input).toEqual({ l: true, triggerL: 255, a: true });
  });
});
