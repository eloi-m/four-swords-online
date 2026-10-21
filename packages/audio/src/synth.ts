// Software synth for JAudio2 sequences: plays a Sequence with IBNK instruments and decoded WSYS samples, mixing to
// stereo float buffers. Pure TS so the same code renders offline (node) and in an AudioWorklet (browser).
// Modeled on JAudio2's channel update, done once per DSP sub-frame (1/400 s):
//   pitch  = instrument × region pitch × (wave rate / output rate) × oscillator pitch
//            × 2^(track bend + (key − base key + sweep) / 12 + vibrato)       (drum keys don't transpose)
//   volume = (velocity / 127)² × instrument × region volume × oscillator volume × track volume × (1 + tremolo)
//   pan    = 0.5 + (instrument pan − 0.5) + (oscillator pan − 0.5) + (track pan − 0.5), equal-power stereo law
//   reverb send = left/right volume × track fxmix (as the DSP's channel parameters show in RAM), into the FX lines
//            (effects.ts `Reverb`: the synth's own, or one shared by a mixer)
// Envelopes follow JAudio2's oscillator: tables of (curve, time, value) points in 1/600 s units (× rate), curves from
// 16-step lookup tables; release uses the release table or a "direct release" ramp.
// Programs 0xF0+ play the DSP's built-in waveforms instead of a wave (`oscWave`).
// The track's IIR filter (iircutoff, iirset) runs on each voice's resampled samples before the volumes (effects.ts).
// Not modeled: the DSP's resampling filter, the FIR filter (firset, unused), surround (dolby), voice priorities.
import { iirForRate, Reverb } from "./effects.ts";
import type { Bank, EnvelopePoint, Oscillator, Percussion } from "./ibnk.ts";
import { REFERENCE_VOLUME } from "./jaudio.ts";
import { type IirCoefficients, type SeqChannel, type SeqHost, Sequence, SUBFRAMES_PER_SECOND, type Track } from "./sequencer.ts";

export interface SampleData {
  pcm: Int16Array;
  sampleRate: number;
  baseKey: number;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
}

export interface SynthBank {
  bank: Bank;
  /** Decoded waves of the bank's wave system, by wave id. */
  waves: Map<number, SampleData>;
}

export interface SynthOptions {
  sampleRate: number;
  banks: Map<number, SynthBank>;
  masterVolume?: number;
  maxVoices?: number;
  /** Adds its own reverb return (default true); false leaves the sends in `sendLeft`/`sendRight` for a mixer's. */
  reverb?: boolean;
}

export interface SynthStats {
  notes: number;
  /** Notes that found no bank, program, key region or wave. */
  missing: number;
  /** Notes on the built-in waveform programs (0xF0+); those on an unknown waveform count as missing too. */
  oscPrograms: number;
  stolen: number;
  peakVoices: number;
}

// Curve tables (value falls from 1 to 0 across a segment), indexed by envelope mode.
const CURVES: Float32Array[] = [
  Float32Array.from({ length: 17 }, (_, i) => 1 - i / 16),
  Float32Array.from({ length: 17 }, (_, i) => (i === 16 ? 0 : Math.sqrt(1 - i / 16))),
  Float32Array.from({ length: 17 }, (_, i) => (i === 16 ? 0 : (1 - i / 16) ** 2)),
  Float32Array.from([
    1, 0.970489, 0.781274, 0.546281, 0.399792, 0.289315, 0.212104, 0.157476, 0.112613, 0.0817896, 0.0579852,
    0.0436415, 0.0308237, 0.0237129, 0.0152593, 0.00915555, 0,
  ]),
];

const OSC_STOP = 0;
const OSC_RUN = 1;
const OSC_HOLD = 2;
const OSC_RELEASE = 3;
const OSC_DIRECT = 4;

/** Oscillator ticks per sub-frame: 600 per second. */
const OSC_STEP = 600 / SUBFRAMES_PER_SECOND;

class Envelope {
  readonly data: Oscillator;
  state = OSC_STOP;
  private counter = 0;
  private value = 0;
  private from = 0;
  private to = 0;
  private point = 0;
  private mode = 0;
  directRelease = 0;

  constructor(data: Oscillator) {
    this.data = data;
    if (!data.attack?.length) {
      this.state = OSC_HOLD;
      this.value = 1;
      return;
    }
    this.to = data.attack[0]!.value / 32768;
    this.mode = data.attack[0]!.mode;
    this.state = OSC_RUN;
    this.update();
  }

  get output(): number {
    return this.value * this.data.scale + this.data.vertex;
  }

  get stopped(): boolean {
    return this.state === OSC_STOP;
  }

  get releasing(): boolean {
    return this.state === OSC_RELEASE || this.state === OSC_DIRECT;
  }

  advance(): void {
    if (this.state === OSC_STOP || this.state === OSC_HOLD) return;
    this.counter += OSC_STEP * this.data.rate;
    this.update();
  }

  release(): void {
    if (this.state === OSC_STOP) return;
    const table = this.data.release;
    if (!table?.length && !this.directRelease) {
      this.state = OSC_STOP;
      return;
    }
    this.counter = 0;
    this.from = this.value;
    this.point = 0;
    if (this.directRelease) {
      this.to = 0;
      this.mode = (this.directRelease >> 14) & 3;
      this.state = OSC_DIRECT;
    } else {
      this.to = table![0]!.value / 32768;
      this.mode = table![0]!.mode;
      this.state = OSC_RELEASE;
    }
    this.update();
  }

  private update(): void {
    if (this.state === OSC_DIRECT) {
      const time = this.directRelease & 0x3fff;
      if (this.counter < time) this.curve(time);
      else {
        this.value = this.to;
        this.state = OSC_STOP;
      }
      return;
    }
    if (this.state !== OSC_RUN && this.state !== OSC_RELEASE) return;
    const table: EnvelopePoint[] | null = this.state === OSC_RUN ? this.data.attack : this.data.release;
    if (!table) {
      this.state = OSC_HOLD;
      return;
    }
    for (let guard = 0; this.counter >= (table[this.point]?.time ?? 0); guard++) {
      if (guard > 256) {
        this.state = OSC_HOLD; // zero-length loop
        return;
      }
      this.counter -= table[this.point]?.time ?? 0;
      this.value = this.to;
      this.from = this.value;
      this.point++;
      const p = table[this.point];
      if (!p || p.mode === 15) {
        this.state = OSC_STOP;
        return;
      }
      if (p.mode === 14) {
        this.state = OSC_HOLD;
        return;
      }
      // A loop jumps to point `value` and ramps towards it (JAudio1 behavior; JAudio2 as decompiled keeps the old
      // target for that segment, which flattens looped tables. FSA's banks have no looped envelopes.)
      const q = p.mode === 13 ? table[(this.point = p.value)] : p;
      if (!q || q.mode === 15 || q.mode === 13) {
        this.state = OSC_STOP;
        return;
      }
      if (q.mode === 14) {
        this.state = OSC_HOLD;
        return;
      }
      this.mode = q.mode;
      this.to = q.value / 32768;
    }
    this.curve(table[this.point]!.time);
  }

  private curve(time: number): void {
    if (time <= 0) {
      this.value = this.to;
      return;
    }
    const table = CURVES[this.mode] ?? CURVES[0]!;
    const f = Math.min(16, (16 * this.counter) / time);
    const i = Math.min(15, Math.floor(f));
    const frac = f - i;
    const c = (1 - frac) * table[i]! + frac * table[i + 1]!;
    this.value = this.from * c + this.to * (1 - c);
  }
}

const STATIC_OSC: Oscillator = { target: 0, rate: 1, attack: null, release: null, scale: 1, vertex: 0 };
const NO_IIR = new Float64Array(4);

// The DSP's built-in waveforms (programs 0xF0+). JAudio2 hands program − 0xF0 to the DSP voice as its sample source
// type; the shapes are those of Dolphin's HLE of the JAudio/Zelda ucode (generated at the output rate, all three with
// a period of 2^17 / ratio samples, ratio in 4.12): 0 square (±0.5), 1 saw (0 → full scale, wrapping to −full),
// 3 pulse (+0.5 for the first quarter, −0.5 for the rest). Type 2 is unknown. We store one period of each as a
// looped table and resample it like a wave. Pitch 1 is 1000 Hz; a note starts at 16736 / 32000 at key 60 (≈ 523 Hz;
// the float 16736.016 is in main.dol's constants) with JAudio2's default envelope: no attack, release (curve 1, 10
// ticks, 0) then stop (the table sits in main.dol next to its oscillator record). The source types and shapes are
// *assumed* from Dolphin and JAudio2's known behavior, not measured on FSA.
const OSC_PERIOD = 4096;
const OSC_PITCH = 16736.016 / 32000;
const OSC_ENV: Oscillator = {
  target: 0,
  rate: 1,
  attack: null,
  release: [
    { mode: 1, time: 10, value: 0 },
    { mode: 15, time: 0, value: 0 },
  ],
  scale: 1,
  vertex: 0,
};
const OSC_SHAPES: Record<number, (phase: number) => number> = {
  0: (x) => (x < 0.5 ? 0x4000 : -0x4000),
  1: (x) => ((((x * 0x10000) | 0) << 16) >> 16),
  3: (x) => (x < 0.25 ? 0x4000 : -0x4000),
};
const oscWaves = new Map<number, SampleData>();

/** One period of a built-in DSP waveform (sample source type 0, 1 or 3) as a looped wave; null for unknown types. */
export function oscWave(type: number): SampleData | null {
  const shape = OSC_SHAPES[type];
  if (!shape) return null;
  let wave = oscWaves.get(type);
  if (!wave) {
    const pcm = Int16Array.from({ length: OSC_PERIOD }, (_, i) => shape(i / OSC_PERIOD));
    // One period lasts 32 samples at 32 kHz at pitch 1 (ratio 0x1000).
    wave = { pcm, sampleRate: (32000 * OSC_PERIOD) / 32, baseKey: 60, loop: true, loopStart: 0, loopEnd: OSC_PERIOD };
    oscWaves.set(type, wave);
  }
  return wave;
}

class Lfo {
  private phase = 0;
  private delay: number;
  constructor(delay: number) {
    this.delay = delay;
  }
  value(depth: number): number {
    return this.delay || !depth ? 0 : depth * Math.sin(2 * Math.PI * this.phase);
  }
  advance(pitch: number): void {
    if (this.delay) {
      this.delay--;
      return;
    }
    this.phase += pitch / 72;
    if (this.phase >= 1) this.phase -= 1;
  }
}

class Voice implements SeqChannel {
  readonly synth: Synth;
  readonly track: Track;
  readonly wave: SampleData;
  readonly started: number;
  active = true;
  private pos = 0;
  private step = 0;
  private key: number;
  private sweepValue = 0;
  private sweepTarget = 0;
  private sweepCount = 0;
  private velocity: number;
  private readonly baseVolume: number;
  private readonly basePitch: number;
  private readonly basePan: number;
  private readonly drum: boolean;
  private readonly envelopes: (Envelope | null)[];
  private updateTimer: number;
  private released = false;
  private readonly vibrato: Lfo;
  private readonly tremolo: Lfo;
  private gainL = 0;
  private gainR = 0;
  private targetL = 0;
  private targetR = 0;
  /** Reverb send level (the track's fxmix, which moves slowly: not ramped). */
  private fx = 0;
  private iirSource: IirCoefficients | null = null;
  private iir: Float64Array | null = null;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(synth: Synth, track: Track, wave: SampleData, init: VoiceInit) {
    this.synth = synth;
    this.track = track;
    this.wave = wave;
    this.started = synth.subframes;
    this.drum = init.drum;
    this.key = init.drum ? 0 : init.key - wave.baseKey;
    this.velocity = init.velocity;
    this.baseVolume = init.volume;
    this.basePitch = (init.pitch * wave.sampleRate) / synth.sampleRate;
    this.basePan = init.pan;
    this.updateTimer = init.updateTimer;
    this.envelopes = init.oscillators.map((o) => (o ? new Envelope(o) : null));
    const direct = track.directRelease || init.directRelease;
    if (direct && this.envelopes[0]) this.envelopes[0].directRelease = direct;
    this.vibrato = new Lfo(track.vibDelay);
    this.tremolo = new Lfo(track.tremDelay);
    this.pos = Math.min(track.skipSample, wave.pcm.length);
    this.begin();
  }

  /**
   * Sets the starting gains from the current track outputs, without a ramp. Called again once the sequencer has
   * finished the sub-frame that started the note, so param changes made just before the note apply to it.
   */
  begin(): void {
    this.compute();
    this.gainL = this.targetL;
    this.gainR = this.targetR;
  }

  release(directRelease: number): void {
    if (!this.active || this.released) return;
    this.released = true;
    if (!this.envelopes[0]) {
      this.active = false;
      return;
    }
    for (const env of this.envelopes) {
      if (!env) continue;
      if (directRelease && env === this.envelopes[0]) env.directRelease = directRelease;
      env.release();
    }
  }

  get releasing(): boolean {
    return this.released;
  }

  retune(key: number, velocity: number, updateTimer: number): void {
    if (!this.drum) this.key = key - this.wave.baseKey;
    this.velocity = velocity;
    this.updateTimer = updateTimer;
  }

  sweep(semitones: number, subframes: number): void {
    if (subframes === 0) this.sweepValue = semitones;
    else {
      this.sweepValue = 0;
      this.sweepTarget = semitones;
    }
    this.sweepCount = subframes;
  }

  /** Sub-frame update (JAudio2's DSP channel callback). */
  update(): void {
    if (!this.active) return;
    if (this.updateTimer && --this.updateTimer === 0) this.release(0);
    this.vibrato.advance(this.track.vibPitch);
    this.tremolo.advance(this.track.tremPitch);
    for (const env of this.envelopes) env?.advance();
    if (this.envelopes[0]?.stopped) {
      this.active = false;
      return;
    }
    this.compute();
    if (this.sweepCount) {
      this.sweepValue += (this.sweepTarget - this.sweepValue) / this.sweepCount;
      this.sweepCount--;
    }
  }

  private compute(): void {
    let volume = 1;
    let pitch = 1;
    let pan = 0.5;
    for (const env of this.envelopes) {
      if (!env) continue;
      const v = env.output;
      switch (env.data.target) {
        case 0:
          volume *= v;
          break;
        case 1:
          pitch *= v;
          break;
        case 2:
          pan += v - 0.5;
          break;
      }
    }
    const out = this.track.output;
    const vel = this.velocity / 127;
    volume *= vel * vel * this.baseVolume * out.volume * (1 + this.tremolo.value(this.track.tremDepth)) * this.synth.masterVolume;
    pan = Math.min(1, Math.max(0, pan + (this.basePan - 0.5) + (out.pan - 0.5)));
    const exponent = out.bend + (this.key + this.sweepValue) / 12 + this.vibrato.value(this.track.vibDepth);
    this.step = Math.max(0, this.basePitch * pitch * 2 ** exponent);
    volume = Math.max(0, volume);
    this.targetL = volume * Math.sin((1 - pan) * Math.PI * 0.5);
    this.targetR = volume * Math.sin(pan * Math.PI * 0.5);
    this.fx = Math.min(1, Math.max(0, out.fxmix));
    if (this.track.iir !== this.iirSource) {
      this.iirSource = this.track.iir;
      this.iir = iirForRate(this.iirSource, this.synth.sampleRate);
    }
  }

  /** Mixes `count` samples into the buffers (and the reverb sends), ramping the gains across the sub-frame. */
  render(left: Float32Array, right: Float32Array, sendL: Float32Array, sendR: Float32Array, offset: number, count: number, rampLength: number): void {
    if (!this.active || count <= 0) return;
    const pcm = this.wave.pcm;
    const loop = this.wave.loop && this.wave.loopEnd > this.wave.loopStart && this.wave.loopEnd <= pcm.length;
    const end = loop ? this.wave.loopEnd : pcm.length;
    const loopLength = this.wave.loopEnd - this.wave.loopStart;
    const dl = (this.targetL - this.gainL) / Math.max(1, rampLength);
    const dr = (this.targetR - this.gainR) / Math.max(1, rampLength);
    let gl = this.gainL;
    let gr = this.gainR;
    let pos = this.pos;
    const k = 1 / 32768;
    const fx = this.fx;
    const iir = this.iir;
    let { x1, x2, y1, y2 } = this;
    const [b1, b2, a1, a2] = (iir ?? NO_IIR) as unknown as [number, number, number, number];
    for (let i = 0; i < count; i++) {
      if (pos >= end) {
        if (!loop) {
          this.active = false;
          break;
        }
        while (pos >= end) pos -= loopLength;
      }
      const i0 = pos | 0;
      const frac = pos - i0;
      let i1 = i0 + 1;
      if (i1 >= end) i1 = loop ? this.wave.loopStart : i0;
      let s = (pcm[i0]! + (pcm[i1]! - pcm[i0]!) * frac) * k;
      if (iir) {
        // The DSP saturates the filter's output to 16 bits.
        const y = Math.min(1, Math.max(-1, b1 * x1 + b2 * x2 + a1 * y1 + a2 * y2));
        x2 = x1;
        x1 = s;
        y2 = y1;
        y1 = s = y;
      }
      if (Math.abs(this.targetL - gl) > Math.abs(dl)) gl += dl;
      else gl = this.targetL;
      if (Math.abs(this.targetR - gr) > Math.abs(dr)) gr += dr;
      else gr = this.targetR;
      left[offset + i]! += s * gl;
      right[offset + i]! += s * gr;
      if (fx) {
        sendL[offset + i]! += s * gl * fx;
        sendR[offset + i]! += s * gr * fx;
      }
      pos += this.step;
    }
    this.pos = pos;
    this.gainL = gl;
    this.gainR = gr;
    this.x1 = x1;
    this.x2 = x2;
    this.y1 = y1;
    this.y2 = y2;
  }
}

interface VoiceInit {
  key: number;
  velocity: number;
  volume: number;
  pitch: number;
  pan: number;
  drum: boolean;
  oscillators: (Oscillator | null)[];
  directRelease: number;
  updateTimer: number;
}

export class Synth implements SeqHost {
  readonly sampleRate: number;
  readonly banks: Map<number, SynthBank>;
  masterVolume: number;
  readonly maxVoices: number;
  sequence: Sequence | null = null;
  readonly voices: Voice[] = [];
  readonly stats: SynthStats = { notes: 0, missing: 0, oscPrograms: 0, stolen: 0, peakVoices: 0 };
  /** Sub-frames rendered so far. */
  subframes = 0;
  /** Called for every note that starts (UI, tests). */
  onNote?: (track: Track, key: number, velocity: number) => void;
  /** The reverb sends of the last render (what the voices fed the FX lines), the length of that render. */
  sendLeft = new Float32Array(0);
  sendRight = new Float32Array(0);
  /** The synth's own FX lines (null when a mixer runs shared ones from `sendLeft`/`sendRight`). */
  readonly reverb: Reverb | null;
  private readonly samplesPerSubframe: number;
  private clock = 0;
  private nextSubframe = 0;

  constructor(options: SynthOptions) {
    this.sampleRate = options.sampleRate;
    this.banks = options.banks;
    this.masterVolume = options.masterVolume ?? REFERENCE_VOLUME;
    this.maxVoices = options.maxVoices ?? 64;
    this.samplesPerSubframe = this.sampleRate / SUBFRAMES_PER_SECOND;
    this.reverb = options.reverb === false ? null : new Reverb(this.sampleRate);
  }

  /** Starts a sequence (a .bms file, or the "bsc" collection with a sound effect's start offset). */
  play(data: Uint8Array, start = 0): Sequence {
    this.stop();
    Object.assign(this.stats, { notes: 0, missing: 0, oscPrograms: 0, stolen: 0, peakVoices: 0 });
    this.subframes = 0;
    this.sequence = new Sequence(data, this, { start });
    return this.sequence;
  }

  stop(): void {
    this.sequence?.root.close();
    this.sequence = null;
    this.voices.length = 0;
  }

  /** Writes a port of the root track, the way the game talks to a playing sequence. */
  setPort(port: number, value: number): void {
    this.sequence?.root.writePort(port, value);
  }

  /**
   * Writes a port of every track below the root, the way the game writes the tracks' ports by mask. Port 0 = 1 is
   * the muffle switch of the 26 sequences with a port-0 interrupt (iircutoff 10 and, for some, vibrato); 0 undoes it.
   */
  setTrackPorts(port: number, value: number): void {
    const visit = (track: Track) => {
      for (const child of track.children) {
        if (!child?.running) continue;
        child.writePort(port, value);
        visit(child);
      }
    };
    if (this.sequence) visit(this.sequence.root);
  }

  get seconds(): number {
    return this.subframes / SUBFRAMES_PER_SECOND;
  }

  startChannel(track: Track, key: number, velocity: number, updateTimer: number): SeqChannel | null {
    this.stats.notes++;
    if (track.program >= 0xf0) {
      this.stats.oscPrograms++;
      const wave = oscWave(track.program - 0xf0);
      if (!wave) {
        this.stats.missing++;
        return null;
      }
      const init: VoiceInit = {
        key,
        velocity,
        volume: 1,
        pitch: OSC_PITCH,
        pan: 0.5,
        drum: false,
        oscillators: [track.oscillators[0] ?? OSC_ENV, track.oscillators[1] ?? null],
        directRelease: 0,
        updateTimer,
      };
      return this.addVoice(track, wave, init, key, velocity);
    }
    const entry = this.banks.get(track.bank);
    const program = entry?.bank.programs.get(track.program);
    if (!entry || !program) {
      this.stats.missing++;
      return null;
    }
    let init: VoiceInit;
    let waveId: number;
    if (program.type === "inst") {
      const region = program.keys.find((k) => key <= k.highKey);
      const vel = region?.velocities[0];
      if (!vel) {
        this.stats.missing++;
        return null;
      }
      waveId = vel.wave;
      init = {
        key,
        velocity,
        volume: program.volume * vel.volume,
        pitch: program.pitch * vel.pitch,
        pan: 0.5,
        drum: false,
        oscillators: [0, 1].map((i) => track.oscillators[i] ?? program.oscillators[i] ?? null),
        directRelease: 0,
        updateTimer,
      };
    } else {
      const perc: Percussion | undefined = program.keys[key];
      const vel = perc?.velocities[0];
      if (!perc || !vel) {
        this.stats.missing++;
        return null;
      }
      waveId = vel.wave;
      init = {
        key,
        velocity,
        volume: perc.volume * vel.volume,
        pitch: perc.pitch * vel.pitch,
        pan: perc.pan,
        drum: true,
        oscillators: [track.oscillators[0] ?? STATIC_OSC, track.oscillators[1] ?? null],
        directRelease: perc.release,
        updateTimer,
      };
    }
    const wave = entry.waves.get(waveId);
    if (!wave) {
      this.stats.missing++;
      return null;
    }
    return this.addVoice(track, wave, init, key, velocity);
  }

  private addVoice(track: Track, wave: SampleData, init: VoiceInit, key: number, velocity: number): Voice {
    if (this.voices.length >= this.maxVoices) {
      let victim = this.voices.findIndex((v) => v.releasing);
      if (victim < 0) victim = 0;
      this.voices[victim]!.active = false;
      this.voices.splice(victim, 1);
      this.stats.stolen++;
    }
    const voice = new Voice(this, track, wave, init);
    this.voices.push(voice);
    this.stats.peakVoices = Math.max(this.stats.peakVoices, this.voices.length);
    this.onNote?.(track, key, velocity);
    return voice;
  }

  private subframe(): void {
    for (const v of this.voices) v.update();
    this.sequence?.subframe();
    for (const v of this.voices) if (v.started === this.subframes) v.begin();
    for (let i = this.voices.length - 1; i >= 0; i--) if (!this.voices[i]!.active) this.voices.splice(i, 1);
    this.subframes++;
  }

  /** Renders the next `left.length` samples (added to silence) and advances the sequence. */
  render(left: Float32Array, right: Float32Array): void {
    left.fill(0);
    right.fill(0);
    const frames = left.length;
    if (this.sendLeft.length !== frames) {
      this.sendLeft = new Float32Array(frames);
      this.sendRight = new Float32Array(frames);
    } else {
      this.sendLeft.fill(0);
      this.sendRight.fill(0);
    }
    let t = 0;
    while (t < frames) {
      if (this.clock >= this.nextSubframe) {
        this.subframe();
        this.nextSubframe += this.samplesPerSubframe;
      }
      const n = Math.min(frames - t, Math.ceil(this.nextSubframe - this.clock));
      const ramp = Math.ceil(this.samplesPerSubframe);
      for (const v of this.voices) v.render(left, right, this.sendLeft, this.sendRight, t, n, ramp);
      t += n;
      this.clock += n;
    }
    this.reverb?.process(this.sendLeft, this.sendRight, left, right);
  }
}
