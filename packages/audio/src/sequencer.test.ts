import { describe, expect, it } from "vitest";
import type { Bank } from "./ibnk.ts";
import { type SeqChannel, type SeqHost, Sequence, type Track } from "./sequencer.ts";
import { Synth } from "./synth.ts";

interface Event {
  at: number;
  type: string;
  key?: number;
  velocity?: number;
  timer?: number;
  track?: string;
}

class Recorder implements SeqHost {
  readonly events: Event[] = [];
  seq!: Sequence;
  subframe = 0;
  startChannel(track: Track, key: number, velocity: number, updateTimer: number): SeqChannel {
    this.events.push({ at: this.subframe, type: "on", key, velocity, timer: updateTimer, track: track.path });
    const events = this.events;
    const host = this;
    return {
      active: true,
      release() {
        events.push({ at: host.subframe, type: "off", key });
        (this as { active: boolean }).active = false;
      },
      retune() {},
      sweep() {},
    };
  }
  run(data: number[], subframes: number, each?: (i: number) => void): Sequence {
    this.seq = new Sequence(Uint8Array.from(data), this);
    for (this.subframe = 0; this.subframe < subframes && !this.seq.finished; this.subframe++) {
      each?.(this.subframe);
      this.seq.subframe();
    }
    return this.seq;
  }
}

describe("sequencer", () => {
  it("times notes from tempo and timebase (ticks/s = tempo × timebase / 60, 400 sub-frames/s)", () => {
    // tempo 120 × timebase 48 = 96 ticks/s: a 96-tick wait lasts one second.
    const r = new Recorder();
    const seq = r.run([0x3c, 0x01, 0x7f, 0xf1, 0x60, 0x81, 0xff], 1000);
    expect(r.events.map((e) => e.type)).toEqual(["on", "off"]);
    expect(r.events[0]).toMatchObject({ at: 0, key: 60, velocity: 127, track: "root" });
    expect(Math.abs(r.events[1]!.at - 400)).toBeLessThanOrEqual(1);
    expect(seq.finished).toBe(true);
  });

  it("changes tempo and timebase, and runs child tracks with transposition", () => {
    const r = new Recorder();
    r.run(
      [
        0xd8, 0x62, 0x00, 0x78, // regload timebase, 120
        0xe0, 0x00, 0xc8, // tempo 200 → 400 ticks/s, one tick per sub-frame
        0xc1, 0x01, 0x00, 0x00, 0x10, // opentrack 1, 0x10
        0xf1, 0x10, // waitbyte 16
        0xff, 0x00, // finish
        0xd8, 0x63, 0x00, 0x02, // 10 regload transpose, 2
        0xf1, 0x04, // waitbyte 4
        0x3c, 0x00, 0x64, 0x08, // gate C4 vel 100 len 8
        0xff,
      ],
      100,
    );
    const on = r.events.find((e) => e.type === "on")!;
    expect(on).toMatchObject({ key: 62, velocity: 100, track: "1", at: 4, timer: 8 });
  });

  it("loops, calls and branches on registers", () => {
    const r = new Recorder();
    r.run(
      [
        0xd8, 0x00, 0x00, 0x05, // regload r0, 5
        0xda, 0x01, 0x00, 0x00, 0x03, // reg add r0, 3 → 8 (flag = 8)
        0xc8, 0x01, 0x00, 0x00, 0x1c, // jmpf zero, 0x1c (not taken)
        0xcb, 0x00, 0x03, // loopstart 3
        0xc3, 0x00, 0x00, 0x1d, // call 0x1d
        0xf1, 0x02, // waitbyte 2
        0xcc, // loopend
        0xff, 0x00, 0x00, 0x00, // finish
        0xff, // 1c finish (branch target)
        0x40, 0x01, 0x50, 0x81, 0xc5, // 1d noteon E4 v1; noteoff; ret
      ],
      200,
    );
    expect(r.events.filter((e) => e.type === "on").map((e) => e.key)).toEqual([64, 64, 64]);
  });

  it("runs the port interrupt handler when the game writes port 0", () => {
    const r = new Recorder();
    const seq = r.run(
      [
        0xf3, 0x00, 0x00, 0x10, // setinttable 0x10
        0xf4, 0x00, 0x04, // setinterrupt (1 << 2): port 0 writes
        0xf1, 0x01, // 07 waitbyte 1
        0xc7, 0x00, 0x00, 0x07, // jmp 0x07
        0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1c, // 10 vectors 0–2 → 0x1c
        0x00, 0x00, 0x00,
        0xd0, 0x00, 0x01, // 1c readport 0, r1
        0xb8, 0x00, 0x40, // param volume
        0xf6, // reti
      ],
      60,
      (i) => i === 30 && r.seq.root.writePort(0, 9),
    );
    expect(seq.root.regs[1]).toBe(9);
    expect(seq.root.params[0]!.target).toBeCloseTo(0x4080 / 32767, 5);
  });
});

describe("synth", () => {
  it("plays an instrument at the right pitch and releases it", () => {
    // One cycle per 64 samples at 32 kHz = 500 Hz, base key 60, looped.
    const pcm = Int16Array.from({ length: 64 }, (_, i) => Math.round(16000 * Math.sin((2 * Math.PI * i) / 64)));
    const bank: Bank = {
      id: 0,
      version: 0,
      programs: new Map([
        [
          0,
          {
            type: "inst" as const,
            volume: 1,
            pitch: 1,
            oscillators: [
              {
                target: 0,
                rate: 1,
                attack: [{ mode: 0, time: 0, value: 32767 }, { mode: 14, time: 0, value: 0 }],
                release: [{ mode: 0, time: 60, value: 0 }, { mode: 15, time: 0, value: 0 }],
                scale: 1,
                vertex: 0,
              },
            ],
            keys: [{ highKey: 127, velocities: [{ highVelocity: 127, wsys: 0, wave: 0, volume: 1, pitch: 1 }] }],
          },
        ],
      ]),
    };
    const synth = new Synth({
      sampleRate: 32000,
      banks: new Map([[0, { bank, waves: new Map([[0, { pcm, sampleRate: 32000, baseKey: 60, loop: true, loopStart: 0, loopEnd: 64 }]]) }]]),
      masterVolume: 1,
    });
    // bank 0, prg 0, noteon C5 (key 72: one octave up → 1000 Hz), wait 48 ticks (0.5 s), noteoff, wait, finish.
    synth.play(Uint8Array.from([0xe2, 0x00, 0xe3, 0x00, 0x48, 0x01, 0x7f, 0xf1, 0x30, 0x81, 0xf1, 0x60, 0xff]));
    const left = new Float32Array(16000);
    const right = new Float32Array(16000);
    synth.render(left, right);
    let crossings = 0;
    for (let i = 1; i < left.length; i++) if (left[i - 1]! < 0 !== left[i]! < 0) crossings++;
    expect(crossings / 2 / 0.5).toBeCloseTo(1000, -1);
    const peak = Math.max(...left.map(Math.abs));
    expect(peak).toBeGreaterThan(0.3); // centre pan: 16000/32768 × sin(π/4)
    expect(peak).toBeLessThan(0.36);
    expect(synth.stats).toMatchObject({ notes: 1, missing: 0 });
    // Released at 0.5 s with a 60-tick (0.1 s) linear release: silent and freed afterwards.
    const tail = new Float32Array(8000);
    synth.render(tail, new Float32Array(8000));
    expect(Math.max(...tail.subarray(4000).map(Math.abs))).toBe(0);
    expect(synth.voices.length).toBe(0);
  });

  it("plays the DSP's built-in waveforms on programs 0xF0+ (no bank needed)", () => {
    const synth = new Synth({ sampleRate: 32000, banks: new Map(), masterVolume: 1 });
    // prg 0xF3 (25% pulse), noteon key 60 (≈ 523 Hz), wait 0.5 s, noteoff, wait, then prg 0xF2 (unknown), finish.
    const seq = [0xe3, 0xf3, 0x3c, 0x01, 0x7f, 0xf1, 0x30, 0x81, 0xf1, 0x30, 0xe3, 0xf2, 0x3c, 0x01, 0x7f, 0xf1, 0x10, 0xff];
    synth.play(Uint8Array.from(seq));
    const left = new Float32Array(16000);
    synth.render(left, new Float32Array(16000));
    let crossings = 0;
    let high = 0;
    for (let i = 1; i < left.length; i++) {
      if (left[i - 1]! < 0 !== left[i]! < 0) crossings++;
      if (left[i]! > 0) high++;
    }
    expect(crossings / 2 / 0.5).toBeCloseTo(523, -1);
    expect(high / left.length).toBeCloseTo(0.25, 1);
    const peak = Math.max(...left.map(Math.abs));
    expect(peak).toBeGreaterThan(0.34); // ±0.5 × sin(π/4)
    expect(peak).toBeLessThan(0.36);
    const tail = new Float32Array(32000);
    synth.render(tail, new Float32Array(32000));
    expect(synth.stats).toMatchObject({ notes: 2, oscPrograms: 2, missing: 1 });
    expect(Math.max(...tail.subarray(4000).map(Math.abs))).toBe(0);
  });
});
