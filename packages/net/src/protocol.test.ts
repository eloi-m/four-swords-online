import { describe, expect, it } from "vitest";
import { decodePacket, emptyPacket, encodePacket, Flag, MAGIC, type Packet } from "./protocol.ts";

function full(): Packet {
  const p = emptyPacket();
  Object.assign(p, {
    flags: Flag.Bye,
    frame: 123456,
    confirmed: 123450,
    advantage: -2.5,
    ack: 99,
    ts: 0xfffffff0,
    echo: 42,
    echoDelay: 17,
    cuts: [
      { player: 2, frame: -1, held: -1 },
      { player: 3, frame: 5000, held: 4990 },
    ],
    rejoins: [{ player: 1, cut: 400, frame: 520 }],
    lost: [{ reporter: 1, target: 3, reporterGen: 0, targetGen: 520 }],
    relay: [{ player: 3, start: 4991, values: [1, 1, 2, 0xffff, 0, 0, 0, 0, 0, 0] }],
    inputs: { start: 100, values: [0, 0, 0, 5, 5, 0x7f, 0xffff, ...new Array(300).fill(9)] },
    hash: { frame: 90, hash: 0xdeadbeef },
    feed: { start: 7, players: [[1, 1, 2, 3], [0, 0, 0, 0], [8, 8, 8, 1]] },
  });
  return p;
}

describe("packet codec", () => {
  it("round-trips every section", () => {
    const p = full();
    const decoded = decodePacket(encodePacket(p));
    expect(decoded).toEqual({ ...p, flags: Flag.Bye | Flag.Inputs | Flag.Hash | Flag.Cuts | Flag.Rejoins | Flag.Lost | Flag.Relay | Flag.Feed });
  });

  it("round-trips an empty keepalive in 27 bytes", () => {
    const data = encodePacket(emptyPacket());
    expect(data.length).toBe(27);
    expect(data[0]).toBe(MAGIC);
    expect(decodePacket(data)).toEqual(emptyPacket());
  });

  it("run-length encodes held inputs", () => {
    const p = emptyPacket();
    p.inputs = { start: 0, values: new Array(64).fill(8) };
    expect(encodePacket(p).length).toBe(27 + 4 + 2 + 3);
    p.inputs = { start: 0, values: Array.from({ length: 64 }, (_, i) => i) };
    expect(encodePacket(p).length).toBe(27 + 4 + 2 + 64 * 3);
  });

  it("rejects malformed packets", () => {
    const good = encodePacket(full());
    expect(() => decodePacket(good.slice(0, good.length - 1))).toThrow();
    expect(() => decodePacket(new Uint8Array([...good, 0]))).toThrow(/trailing/);
    expect(() => decodePacket(new Uint8Array([0x00, ...good.slice(1)]))).toThrow(/not a netcode/);
    const p = emptyPacket();
    p.inputs = { start: 0, values: [1, 1] };
    const bad = encodePacket(p);
    bad[bad.length - 1] = 3; // a run longer than the count
    expect(() => decodePacket(bad)).toThrow(/run/);
    expect(() => decodePacket(new Uint8Array(0))).toThrow();
  });

  it("refuses inputs that are not u16", () => {
    const p = emptyPacket();
    p.inputs = { start: 0, values: [0x10000] };
    expect(() => encodePacket(p)).toThrow();
    p.inputs = { start: 0, values: [1.5] };
    expect(() => encodePacket(p)).toThrow();
  });
});
