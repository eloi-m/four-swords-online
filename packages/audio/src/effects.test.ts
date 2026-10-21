import { describe, expect, it } from "vitest";
import { DSP_RATE, iirForRate, Reverb } from "./effects.ts";
import { IIR_OFF, iirCutoff, Sequence, type SeqHost, type Track } from "./sequencer.ts";
import { Bytes } from "./test-helpers.ts";

/** |H| at `hz` of y = b1·x[n−1] + b2·x[n−2] + a1·y[n−1] + a2·y[n−2]. */
function gain(c: Float64Array, hz: number, rate: number): number {
  const w = (2 * Math.PI * hz) / rate;
  const [b1, b2, a1, a2] = c as unknown as [number, number, number, number];
  const nr = b1 * Math.cos(w) + b2 * Math.cos(2 * w);
  const ni = -(b1 * Math.sin(w) + b2 * Math.sin(2 * w));
  const dr = 1 - a1 * Math.cos(w) - a2 * Math.cos(2 * w);
  const di = a1 * Math.sin(w) + a2 * Math.sin(2 * w);
  return Math.hypot(nr, ni) / Math.hypot(dr, di);
}
const db = (x: number) => 20 * Math.log10(x);

describe("IIR filter", () => {
  it("iircutoff 127 is the pass-through, lower cutoffs a low-pass", () => {
    expect(iirCutoff(127)).toBe(IIR_OFF);
    expect(iirForRate(IIR_OFF, DSP_RATE)).toBeNull();
    const muffle = iirForRate(iirCutoff(10), DSP_RATE)!;
    expect([...muffle].map((c) => Math.round(c * 0x8000))).toEqual([6202, 2415, 16602, 13584]);
    // Its response: bass up, treble down (the muffled music).
    expect(db(gain(muffle, 100, DSP_RATE))).toBeCloseTo(10, 0);
    expect(db(gain(muffle, 4000, DSP_RATE))).toBeLessThan(-12);
  });

  it("keeps the response below 16 kHz when the synth runs at another rate", () => {
    const at32 = iirForRate(iirCutoff(10), DSP_RATE)!;
    const at48 = iirForRate(iirCutoff(10), 48000)!;
    for (const hz of [0, 250, 1000, 4000]) expect(Math.abs(db(gain(at48, hz, 48000)) - db(gain(at32, hz, DSP_RATE)))).toBeLessThan(1.5);
  });

  it("is set by iircutoff and iirset", () => {
    const seq = new Bytes().u8(0xeb, 10).u8(0xf1, 1).u8(0xec).u16(0x4000, 0, 0x1000, 0xf000).u8(0xf1, 1).u8(0xeb, 200).u8(0xff).bytes();
    const host: SeqHost = { startChannel: () => null };
    const s = new Sequence(seq, host);
    const seen: Track["iir"][] = [];
    for (let i = 0; i < 2000 && !s.finished; i++) {
      s.subframe();
      if (seen.at(-1) !== s.root.iir) seen.push(s.root.iir);
    }
    expect(seen).toEqual([iirCutoff(10), [0x4000, 0, 0x1000, -0x1000]]);
  });
});

describe("reverb", () => {
  it("echoes a send every 160 ms (5122 DSP samples), halving, at ¾ of the line", () => {
    const reverb = new Reverb(DSP_RATE);
    const n = 3 * 5122 + 10;
    const send = new Float32Array(n);
    send[0] = 1;
    const outL = new Float32Array(n);
    const outR = new Float32Array(n);
    reverb.process(send, new Float32Array(n), outL, outR);
    const taps = [...outL.keys()].filter((i) => outL[i] !== 0);
    expect(taps).toEqual([5122, 10244, 15366]);
    expect(outL[5122]).toBeCloseTo(0.375, 3);
    expect(outL[10244]).toBeCloseTo(0.1875, 3);
    expect(outR.every((x) => x === 0)).toBe(true);
  });
});
