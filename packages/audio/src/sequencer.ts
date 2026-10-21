// BMS interpreter: a tree of tracks stepped one sequence tick at a time, modeled on how JAudio2 behaves (written from
// documented behavior; see docs/formats.md). The host plays the notes: it is asked to start channels and it reports
// back when they end. Timing: the root track converts tempo (BPM) × timebase (ticks per beat) into ticks per DSP
// sub-frame (400 per second), accumulating fractions, so ticks/s = tempo × timebase / 60.
import { type BmsCommand, decodeCommand } from "./bms.ts";
import type { EnvelopePoint, Oscillator } from "./ibnk.ts";

export const SUBFRAMES_PER_SECOND = 400;

/** A playing note as seen by the sequencer; implemented by the synth. */
export interface SeqChannel {
  readonly active: boolean;
  /** Key-off; `directRelease` (oscillator ticks, top 2 bits = curve) overrides the instrument release when non-zero. */
  release(directRelease: number): void;
  /** Tied gate notes reuse the channel instead of retriggering. */
  retune(key: number, velocity: number, updateTimer: number): void;
  sweep(semitones: number, subframes: number): void;
}

export interface SeqHost {
  /** Starts a note with the track's current bank/program. `updateTimer` (sub-frames, 0 = none) auto-releases it. */
  startChannel(track: Track, key: number, velocity: number, updateTimer: number): SeqChannel | null;
  /** The game's sync callback (0xF9); its result lands in register 3. */
  syncCpu?(track: Track, value: number): number;
}

interface TimedParam {
  value: number;
  target: number;
  count: number;
}

/** Effective values after combining a track with its parents (what channels read every sub-frame). */
export interface TrackOutput {
  volume: number;
  /** Pitch bend in octaves. */
  bend: number;
  pan: number;
  fxmix: number;
  dolby: number;
}

/** IIR coefficients (s16, 1.15) as the DSP channel takes them; this one passes the input through. */
export type IirCoefficients = readonly [number, number, number, number];
export const IIR_OFF: IirCoefficients = [0x7fff, 0, 0, 0];
// JAudio2's cutoff table (main.dol 0x8045C6B8, 128 entries of 4 s16, what "iircutoff n" loads): a straight line from
// the most muffled set (entry 0) to the pass-through (entry 127): every value within 1 LSB of the rounded straight
// line (realdisc.test.ts checks all 512 against the game's), so the line stands in for the table.
const IIR_CUTOFF_0 = [3932, 2621, 18021, 14745];

/** The coefficients "iircutoff `cutoff`" selects (0 most muffled … 127 off). */
export function iirCutoff(cutoff: number): IirCoefficients {
  if (cutoff >= 127) return IIR_OFF;
  const t = Math.max(0, cutoff) / 127;
  return IIR_CUTOFF_0.map((c, i) => Math.round(c + (IIR_OFF[i]! - c) * t)) as unknown as IirCoefficients;
}

const STACK_SIZE = 8;
const MAX_COMMANDS_PER_TICK = 4096;

export class Track {
  readonly sequence: Sequence;
  readonly parent: Track | null;
  readonly children: (Track | null)[] = new Array(16).fill(null);
  readonly number: number;
  pos = 0;
  running = true;
  wait = 0;
  waitNote = false;
  readonly stack: { ret: number; loop: number }[] = [];
  readonly regs = new Uint16Array(14);
  readonly ports = new Uint16Array(16);
  /** volume, pitch, fxmix, pan, dolby, distFilter */
  readonly params: TimedParam[];
  readonly channels: (SeqChannel | null)[] = new Array(8).fill(null);
  transpose = 0;
  bank = 0;
  program = 0xf0;
  bendSense = 12;
  gateRate = 100;
  panPower = 1;
  directRelease = 0;
  skipSample = 0;
  noteOnPrio = 0x40;
  releasePrio = 0;
  latestKey = 60;
  tieNext = false;
  vibDepth = 0;
  vibPitch = 1;
  vibDelay = 0;
  tremDepth = 0;
  tremPitch = 1;
  tremDelay = 0;
  /** Oscillator overrides set by the sequence (envset / simpleadsr); null = use the instrument's. */
  readonly oscillators: (Oscillator | null)[] = [null, null];
  /** The channels' IIR filter (iircutoff / iirset); replaced, never mutated, so channels see a change by reference. */
  iir: IirCoefficients = IIR_OFF;
  readonly output: TrackOutput = { volume: 1, bend: 0, pan: 0.5, fxmix: 0, dolby: 0 };
  // Interrupts (0xF3–0xF8): vector table, enabled mask, pending mask, return address, timer.
  intrTable = 0;
  intrMask = 0;
  intrPending = 0;
  intrReturn = -1;
  intrTimer = 0;
  intrTimerReload = 0;
  intrTimerRepeat = 0;
  /** Commands executed so far (for tests and the UI). */
  commandCount = 0;

  constructor(sequence: Sequence, parent: Track | null, number: number, offset: number) {
    this.sequence = sequence;
    this.parent = parent;
    this.number = number;
    this.pos = offset;
    this.params = [1, 0, 0, 0.5, 0, 0].map((v) => ({ value: v, target: v, count: 0 }));
    if (parent) {
      this.bank = parent.bank;
      this.program = parent.program;
      this.noteOnPrio = parent.noteOnPrio;
      this.releasePrio = parent.releasePrio;
      this.skipSample = parent.skipSample;
    }
  }

  get root(): Track {
    return this.parent ? this.parent.root : this;
  }

  get transposeTotal(): number {
    return this.transpose + (this.parent ? this.parent.transposeTotal : 0);
  }

  /** Path such as "0/3" (child numbers from the root). */
  get path(): string {
    return this.parent ? (this.parent.parent ? `${this.parent.path}/${this.number}` : String(this.number)) : "root";
  }

  setParam(index: number, value: number, count: number): void {
    const p = this.params[index];
    if (!p) return;
    p.target = value;
    if (count === 0) p.value = value;
    p.count = count;
  }

  /** Port bits set by writes from outside (the game or the parent) and by the track's own exports. */
  portImports = 0;
  portExports = 0;

  /** A write from the game or the parent track (ports 0 and 1 raise interrupts 2 and 3). */
  writePort(port: number, value: number): void {
    this.ports[port & 15] = value;
    this.portImports |= 1 << (port & 15);
    if (port === 0 || port === 1) this.interrupt(port === 0 ? 2 : 3);
  }

  readImport(port: number): number {
    this.portImports &= ~(1 << (port & 15));
    return this.ports[port & 15]!;
  }

  writeExport(port: number, value: number): void {
    this.ports[port & 15] = value;
    this.portExports |= 1 << (port & 15);
  }

  /** A read from the game or a child track. */
  readExport(port: number): number {
    this.portExports &= ~(1 << (port & 15));
    return this.ports[port & 15]!;
  }

  interrupt(type: number): void {
    if (this.intrMask & (1 << type)) this.intrPending |= 1 << type;
  }

  close(): void {
    for (let i = 0; i < 16; i++) {
      this.children[i]?.close();
      this.children[i] = null;
    }
    for (let v = 0; v < 8; v++) {
      this.channels[v]?.release(0);
      this.channels[v] = null;
    }
    this.running = false;
  }

  noteStopped(voice: number): boolean {
    const c = this.channels[voice];
    if (c && !c.active) this.channels[voice] = null;
    return !this.channels[voice];
  }
}

export interface SequenceOptions {
  /** Where the root track starts (a sound effect's entry point inside the "bsc" collection). Default 0. */
  start?: number;
  /** Called for every executed command (debugging, coverage). */
  onCommand?: (track: Track, cmd: BmsCommand) => void;
}

export class Sequence {
  readonly data: Uint8Array;
  readonly host: SeqHost;
  readonly root: Track;
  readonly options: SequenceOptions;
  tempo = 120;
  timebase = 48;
  /** Ticks per sub-frame, and the fractional tick accumulator. */
  private rate = 0;
  private acc = 1;
  ticks = 0;
  finished = false;
  /** Decode errors (bad offsets); the track that hit one is stopped. */
  readonly errors: string[] = [];
  /** State of the seeded generator behind "reg rand" (the game's own generator isn't modeled). */
  private seed = 0x1234567;

  /** Deterministic 23-bit pseudo-random numbers (xorshift), so renders are reproducible. */
  random(): number {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed >>> 9;
  }

  constructor(data: Uint8Array, host: SeqHost, options: SequenceOptions = {}) {
    this.data = data;
    this.host = host;
    this.options = options;
    this.root = new Track(this, null, -1, options.start ?? 0);
    this.updateTempo();
  }

  get ticksPerSecond(): number {
    return (this.tempo * this.timebase) / 60;
  }

  private updateTempo(): void {
    this.rate = this.ticksPerSecond / SUBFRAMES_PER_SECOND;
  }

  /** Advances one DSP sub-frame (1/400 s): runs as many sequence ticks as the tempo asks for. */
  subframe(): void {
    if (this.finished) return;
    while (this.acc >= 1) {
      this.acc -= 1;
      if (!this.tick(this.root)) {
        this.root.close();
        this.finished = true;
        break;
      }
      this.ticks++;
    }
    this.acc += this.rate;
    this.updateOutputs(this.root, null, 1);
  }

  private updateOutputs(track: Track, parent: TrackOutput | null, panScale: number): void {
    const [volume, pitch, fxmix, pan, dolby] = track.params.map((p) => p.value) as [number, number, number, number, number];
    const out = track.output;
    const bend = (pitch * track.bendSense) / 3;
    const panOffset = (pan - 0.5) * track.panPower * panScale;
    out.volume = volume * volume * (parent ? parent.volume : 1);
    out.bend = bend + (parent ? parent.bend : 0);
    out.pan = (parent ? parent.pan : 0.5) + panOffset;
    out.fxmix = fxmix + (parent ? parent.fxmix : 0);
    out.dolby = dolby + (parent ? parent.dolby : 0);
    for (const child of track.children) if (child?.running) this.updateOutputs(child, out, panScale * track.panPower);
  }

  /** One sequence tick for a track and its children. Returns false when the track finished. */
  private tick(track: Track): boolean {
    let alive = this.tickSelf(track);
    for (const p of track.params) {
      if (p.count) {
        p.value += (p.target - p.value) / p.count;
        p.count--;
      }
    }
    if (!alive) return false;
    for (let i = 0; i < 16; i++) {
      const child = track.children[i];
      if (child?.running && !this.tick(child)) {
        child.close();
        track.children[i] = null;
      }
    }
    alive = track.running;
    return alive;
  }

  private tickSelf(track: Track): boolean {
    track.interrupt(6);
    if (track.intrTimer) {
      if (--track.intrTimer === 0) {
        track.interrupt(5);
        if (track.intrTimerRepeat) {
          if (--track.intrTimerRepeat) track.intrTimer = track.intrTimerReload;
        } else track.intrTimer = track.intrTimerReload;
      }
    }
    if (track.waitNote) {
      if (!track.noteStopped(0)) return true;
      track.waitNote = false;
    }
    if (track.wait > 0) track.wait--;
    this.checkInterrupt(track);
    let guard = 0;
    while ((track.wait === 0 || track.intrReturn >= 0) && !track.waitNote) {
      if (++guard > MAX_COMMANDS_PER_TICK) {
        track.wait = 1; // a loop without waits: stall rather than hang
        break;
      }
      try {
        if (!this.step(track)) return false;
      } catch (error) {
        this.errors.push(`track ${track.path} at 0x${track.pos.toString(16)}: ${(error as Error).message}`);
        return false;
      }
    }
    return true;
  }

  private checkInterrupt(track: Track): void {
    if (track.intrReturn >= 0) return;
    const ready = track.intrMask & track.intrPending;
    if (!ready) return;
    const i = 31 - Math.clz32(ready & -ready);
    track.intrPending &= ~(1 << i);
    track.intrReturn = track.pos;
    track.pos = this.get24(track.intrTable + i * 3);
  }

  private get24(p: number): number {
    const d = this.data;
    return ((d[p] ?? 0) << 16) | ((d[p + 1] ?? 0) << 8) | (d[p + 2] ?? 0);
  }

  private readReg(track: Track, r: number): number {
    if (r < 0x40) {
      const g = track.regs;
      if (r < 14) return g[r]!;
      switch (r) {
        case 32:
          return ((g[0]! & 0xff) << 8) | (g[1]! & 0xff);
        case 33:
          return ((g[4]! << 16) | g[5]!) >>> 0;
        case 34:
          return g[4]! >> 8;
        case 35:
          return g[4]! & 0xff;
        case 36:
          return g[5]! >> 8;
        case 37:
          return g[5]! & 0xff;
        case 38:
        case 39:
        case 40:
          return ((g[(r - 35) * 2]! << 16) | g[(r - 35) * 2 + 1]!) >>> 0;
        case 41:
          return ((g[10]! << 16) | g[11]!) >>> 0; // (sic) the game reads the r40 pair here
      }
      return 0;
    }
    if (r < 0x50) return track.ports[r - 0x40]!;
    switch (r) {
      case 0x60: {
        let mask = 0;
        track.children.forEach((c, i) => {
          if (c?.running) mask |= 1 << i;
        });
        return mask;
      }
      case 0x61:
        return track.stack.at(-1)?.loop ?? 0;
      case 0x62:
        return this.timebase;
      case 0x63:
        return track.transpose & 0xffff;
      case 0x64:
        return track.bendSense;
      case 0x65:
        return track.gateRate;
      case 0x66:
        return track.skipSample;
      case 0x67:
        return track.bank;
      case 0x68:
        return track.program;
      case 0x69:
        return Math.round(track.panPower * 32767);
      case 0x6b:
        return track.noteOnPrio;
      case 0x6c:
        return track.releasePrio;
      case 0x6d:
        return track.directRelease;
    }
    return 0;
  }

  private writeReg(track: Track, r: number, value: number): void {
    const g = track.regs;
    g[3] = value;
    if (r < 0x40) {
      if (r < 14) g[r] = r <= 2 ? value & 0xff : value;
      else if (r === 32) [g[0], g[1]] = [(value >> 8) & 0xff, value & 0xff];
      else if (r === 33) [g[4], g[5]] = [value >>> 16, value];
      else if (r === 34) g[4] = (g[4]! & 0xff) | ((value & 0xff) << 8);
      else if (r === 35) g[4] = (g[4]! & 0xff00) | (value & 0xff);
      else if (r === 36) g[5] = (g[5]! & 0xff) | ((value & 0xff) << 8);
      else if (r === 37) g[5] = (g[5]! & 0xff00) | (value & 0xff);
      else if (r >= 38 && r <= 41) [g[(r - 35) * 2], g[(r - 35) * 2 + 1]] = [value >>> 16, value];
      return;
    }
    if (r < 0x50) {
      track.ports[r - 0x40] = value;
      return;
    }
    const signed = (value << 16) >> 16;
    switch (r) {
      case 0x62:
        this.timebase = value;
        this.updateTempo();
        break;
      case 0x63:
        track.transpose = (value << 24) >> 24;
        break;
      case 0x64:
        track.bendSense = value & 0xff;
        break;
      case 0x65:
        track.gateRate = value & 0xff;
        break;
      case 0x66:
        track.skipSample = value;
        break;
      case 0x67:
        track.bank = value & 0xff;
        break;
      case 0x68:
        track.program = value & 0xff;
        break;
      case 0x69:
        track.panPower = value / 32767;
        break;
      case 0x6a:
        track.releasePrio = (value >> 8) & 0xff;
        track.noteOnPrio = value & 0xff;
        break;
      case 0x6b:
        track.noteOnPrio = value & 0xff;
        break;
      case 0x6c:
        track.releasePrio = value & 0xff;
        break;
      case 0x6d:
        track.directRelease = value;
        break;
      case 0x6e:
        track.vibDepth = signed / 1524;
        break;
      case 0x6f:
        track.vibDepth = signed / 12192;
        break;
      case 0x70:
        track.tremDepth = signed / 256;
        break;
      case 0x71:
        track.vibPitch = signed / 64;
        break;
      case 0x72:
        track.tremPitch = signed / 64;
        break;
      case 0x73:
        track.vibDelay = value;
        break;
      case 0x74:
        track.tremDelay = value;
        break;
    }
  }

  private condition(track: Track, cond: number): boolean {
    const f = track.regs[3]!;
    switch (cond) {
      case 0:
        return true;
      case 1:
        return f === 0;
      case 2:
        return f !== 0;
      case 3:
        return f === 1;
      case 4:
        return f >= 0x8000;
      case 5:
        return f < 0x8000;
    }
    return false;
  }

  private readEnvelope(offset: number): EnvelopePoint[] {
    const d = this.data;
    const points: EnvelopePoint[] = [];
    for (let p = offset; p + 6 <= d.length; p += 6) {
      const s16 = (o: number) => ((d[o]! << 24) >> 16) | d[o + 1]!;
      const point = { mode: s16(p), time: s16(p + 2), value: s16(p + 4) };
      points.push(point);
      if (point.mode > 10) break;
    }
    return points;
  }

  private noteOn(track: Track, voice: number, key: number, velocity: number): void {
    key += track.transposeTotal;
    track.channels[voice]?.release(0);
    track.channels[voice] = this.host.startChannel(track, key, velocity, 0);
  }

  private gateOn(track: Track, key: number, velocity: number, ticks: number, flags: number): void {
    key += track.transposeTotal;
    if (track.gateRate !== 100) ticks *= track.gateRate / 100;
    const subframes = Math.floor(ticks / this.rate);
    const timer = flags & 6 ? 0 : subframes;
    const start = flags & 1 ? track.latestKey : key;
    const current = track.channels[0];
    if (!track.tieNext || !current?.active) {
      current?.release(0);
      track.channels[0] = this.host.startChannel(track, start, velocity, timer);
    } else current.retune(start, velocity, timer);
    if (flags & 1) track.channels[0]?.sweep(key - start, subframes);
    track.tieNext = (flags & 2) !== 0;
    track.latestKey = key;
  }

  /** Executes one command. Returns false on finish. */
  private step(track: Track): boolean {
    const cmd = decodeCommand(this.data, track.pos);
    track.pos += cmd.length;
    track.commandCount++;
    this.options.onCommand?.(track, cmd);
    const a = cmd.args.map((x, i) => ((cmd.regMask >> i) & 1 ? this.readReg(track, x) : x));
    // Reg-typed arguments name a register; a few commands want the index itself.
    const raw = cmd.args;
    switch (cmd.kind) {
      case "note":
        this.noteOn(track, a[1]!, a[0]!, a[2]!);
        return true;
      case "gate": {
        const [key, velocity, duration, flags] = a as [number, number, number, number];
        this.gateOn(track, key, velocity, duration, (flags & 0x80 ? 1 : 0) | (flags & 0x40 ? 2 : 0) | (duration ? 0 : 4));
        if (duration) track.wait = duration;
        else track.waitNote = true;
        return true;
      }
      case "noteoff":
        if (a[0]) {
          track.channels[a[0]]?.release(0);
          track.channels[a[0]] = null;
        }
        return true;
      case "unknown":
        return true;
    }
    switch (cmd.name) {
      case "noteon":
        this.noteOn(track, a[1]! & 7, a[0]!, a[2]!);
        break;
      case "noteoff":
        track.channels[a[0]! & 7]?.release(0);
        track.channels[a[0]! & 7] = null;
        break;
      case "note": {
        const [flags, key, velocity, duration] = a as [number, number, number, number];
        this.gateOn(track, key, velocity, duration, (flags & 0x80 ? 1 : 0) | (flags & 0x40 ? 2 : 0) | (duration ? 0 : 4));
        if (duration) track.wait = duration;
        else track.waitNote = true;
        break;
      }
      case "setlastnote":
        if (a[0]! < 256) track.latestKey = a[0]! + track.transposeTotal;
        break;
      case "param":
      case "paramt": {
        const b = a[1]! & 0xff;
        const s = ((b << 24) >> 16) | (b & 0x80 ? 0 : b << 1);
        track.setParam(a[0]!, s / 32767, cmd.name === "paramt" ? a[2]! : 0);
        break;
      }
      case "param16":
      case "param16t":
        track.setParam(a[0]!, ((a[1]! << 16) >> 16) / 32767, cmd.name === "param16t" ? a[2]! : 0);
        break;
      case "opentrack": {
        const n = a[0]! & 15;
        track.children[n]?.close();
        const child = new Track(this, track, n, a[1]!);
        track.children[n] = child;
        break;
      }
      case "closetrack":
        track.children[a[0]! & 15]?.close();
        track.children[a[0]! & 15] = null;
        break;
      case "call":
      case "callf":
      case "calltable": {
        const target = cmd.name === "call" ? a[0]! : cmd.name === "callf" ? a[1]! : this.get24(a[1]! + a[0]! * 3);
        if (cmd.name === "callf" && !this.condition(track, a[0]!)) break;
        if (track.stack.length < STACK_SIZE) {
          track.stack.push({ ret: track.pos, loop: 0 });
          track.pos = target;
        }
        break;
      }
      case "ret":
      case "retf":
        if (cmd.name === "retf" && !this.condition(track, a[0]!)) break;
        if (track.stack.length) track.pos = track.stack.pop()!.ret;
        break;
      case "jmp":
        track.pos = a[0]!;
        break;
      case "jmpf":
        if (this.condition(track, a[0]!)) track.pos = a[1]!;
        break;
      case "jmptable":
        track.pos = this.get24(a[1]! + a[0]! * 3);
        break;
      case "loopstart":
        if (track.stack.length < STACK_SIZE) track.stack.push({ ret: track.pos, loop: a[0]! });
        break;
      case "loopend": {
        const top = track.stack.at(-1);
        if (!top) break;
        if (top.loop) top.loop--;
        if (!top.loop) track.stack.pop();
        else track.pos = top.ret;
        break;
      }
      case "readport":
        this.writeReg(track, raw[1]!, track.readImport(a[0]!));
        break;
      case "writeport":
        track.writeExport(a[0]!, a[1]!);
        break;
      case "checkportin":
        track.regs[3] = (track.portImports >> (a[0]! & 15)) & 1;
        break;
      case "checkportout":
        track.regs[3] = (track.portExports >> (a[0]! & 15)) & 1;
        break;
      case "parentwriteport":
        track.parent?.writePort(a[0]!, a[1]!);
        break;
      case "childwriteport":
        track.children[(a[0]! >> 4) & 15]?.writePort(a[0]! & 15, a[1]!);
        break;
      case "parentreadport":
        if (track.parent) this.writeReg(track, raw[1]!, track.parent.readExport(a[0]!));
        break;
      case "childreadport": {
        const child = track.children[(a[0]! >> 4) & 15];
        if (child) this.writeReg(track, raw[1]!, child.readExport(a[0]! & 15));
        break;
      }
      case "regload":
        this.writeReg(track, raw[0]!, a[1]!);
        break;
      case "reg": {
        const [op, r, value] = [a[0]!, raw[1]!, a[2]!];
        const cur = this.readReg(track, r);
        let out = value;
        let dest = r;
        switch (op) {
          case 1:
            out = cur + value;
            break;
          case 2:
            out = cur - value;
            break;
          case 3:
            out = cur - value;
            dest = 3;
            break;
          case 4:
            out = cur * value;
            dest = 33;
            break;
          case 5:
            out = cur & value;
            break;
          case 6:
            out = cur | value;
            break;
          case 7:
            out = cur ^ value;
            break;
          case 8:
            out = value ? this.random() % value : 0;
            break;
          case 9:
            out = cur << value;
            break;
          case 10:
            out = cur >>> value;
            break;
        }
        this.writeReg(track, dest, out & 0xffffffff);
        break;
      }
      case "reguni":
        if (a[0] === 11) this.writeReg(track, raw[1]!, -this.readReg(track, raw[1]!) & 0xffff);
        break;
      case "regtblload": {
        const [op, table, index] = [a[0]!, a[2]!, a[3]!];
        const d = this.data;
        const at = (o: number) => d[o] ?? 0;
        let value = 0;
        if (op === 12) value = at(table + index);
        else if (op === 13) value = (at(table + index * 2) << 8) | at(table + index * 2 + 1);
        else if (op === 14) value = this.get24(table + index * 3);
        else if (op === 15 || op === 16) {
          const o = op === 15 ? table + index * 4 : table + index;
          value = ((at(o) << 24) | (at(o + 1) << 16) | (at(o + 2) << 8) | at(o + 3)) >>> 0;
        }
        this.writeReg(track, raw[1]!, value);
        break;
      }
      case "tempo":
        this.tempo = a[0]!;
        this.updateTempo();
        break;
      case "bankprg":
        track.bank = (a[0]! >> 8) & 0xff;
        track.program = a[0]! & 0xff;
        break;
      case "bank":
        track.bank = a[0]! & 0xff;
        break;
      case "prg":
        track.program = a[0]! & 0xff;
        break;
      case "envset": {
        const n = a[0]! & 1;
        const base = track.oscillators[n] ?? { target: n, rate: 1, attack: null, release: null, scale: 1, vertex: 0 };
        track.oscillators[n] = { ...base, attack: this.readEnvelope(a[1]!), release: null };
        break;
      }
      case "simpleadsr": {
        const [attack, decay, sustainTime, sustain] = a.map((x) => (x << 16) >> 16) as [number, number, number, number];
        track.oscillators[0] = {
          target: 0,
          rate: 1,
          attack: [
            { mode: 0, time: attack, value: 0x7fff },
            { mode: 0, time: decay, value: 0x7fff },
            { mode: 0, time: sustainTime, value: sustain },
            { mode: 14, time: 0, value: 0 },
          ],
          release: null,
          scale: 1,
          vertex: 0,
        };
        track.directRelease = a[4]!;
        break;
      }
      case "iircutoff":
        // The game ignores cutoffs past the table (n >= 128).
        if (a[0]! < 128) track.iir = iirCutoff(a[0]!);
        break;
      case "iirset":
        track.iir = a.slice(0, 4).map((x) => (x << 16) >> 16) as unknown as IirCoefficients;
        break;
      // Not modeled: firset (an 8-tap FIR; no FSA sequence uses it, nor does Dolphin's DSP emulation) and busconnect.
      case "wait":
      case "waitbyte":
        track.wait = a[0]!;
        break;
      case "setinttable":
        track.intrTable = a[0]!;
        break;
      case "setinterrupt":
        track.intrMask |= a[0]!;
        break;
      case "disinterrupt":
        track.intrMask &= ~a[0]!;
        break;
      case "reti":
        if (track.intrReturn >= 0) {
          track.pos = track.intrReturn;
          track.intrReturn = -1;
        }
        this.checkInterrupt(track);
        break;
      case "clri":
        track.intrReturn = -1;
        this.checkInterrupt(track);
        break;
      case "inttimer":
        track.intrTimerRepeat = a[0]!;
        track.intrTimer = track.intrTimerReload = a[1]!;
        break;
      case "synccpu":
        track.regs[3] = this.host.syncCpu ? this.host.syncCpu(track, a[0]!) : 0xffff;
        break;
      case "finish":
        return false;
    }
    return true;
  }
}
