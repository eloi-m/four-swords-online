// A BGM synth plus a pool of sound-effect synths, mixed into one stereo output. Each Synth runs a single sequence and
// cuts the previous one on play(), while a game fires many sound effects at once (a swing over a hit over the BGM),
// so every effect gets a synth of its own: an idle one, else the one that started longest ago. Effects can carry a
// tag to be stopped later (looping effects such as a sword charge). Pure TS: runs inside an AudioWorklet
// (apps/battle) and in node. All synths feed one reverb, as all channels share the DSP's FX lines.
import { Reverb } from "./effects.ts";
import type { SynthBank } from "./synth.ts";
import { Synth } from "./synth.ts";

export interface MixerOptions {
  sampleRate: number;
  banks: Map<number, SynthBank>;
  /** The "bsc" sound-effect sequence collection (AudioInit.seqCollection); effects are started by offset. */
  collection?: Uint8Array;
  /** Sound effects that can sound at once (default 8). */
  voices?: number;
}

export interface MixerStats {
  seconds: number;
  bgm: { playing: boolean; notes: number; missing: number; voices: number };
  se: { started: number; notes: number; missing: number; voices: number; busy: number };
}

export class SynthMixer {
  readonly bgm: Synth;
  readonly se: Synth[];
  /** Output gain applied after mixing (user volume; 0 mutes). */
  gain = 1;
  collection: Uint8Array | null;
  private readonly started: number[];
  private readonly tags: (string | null)[];
  private seStarted = 0;
  private seNotes = 0;
  private seMissing = 0;
  private scratch = [new Float32Array(128), new Float32Array(128), new Float32Array(128), new Float32Array(128)];
  private readonly reverb: Reverb;
  private samples = 0;

  constructor(options: MixerOptions) {
    const { sampleRate, banks } = options;
    this.bgm = new Synth({ sampleRate, banks, reverb: false });
    this.se = Array.from({ length: options.voices ?? 8 }, () => new Synth({ sampleRate, banks, reverb: false }));
    this.reverb = new Reverb(sampleRate);
    this.started = this.se.map(() => -Infinity);
    this.tags = this.se.map(() => null);
    this.collection = options.collection ?? null;
  }

  playBgm(sequence: Uint8Array, volume: number, port0 = 0): void {
    this.bgm.masterVolume = volume;
    this.bgm.play(sequence, 0);
    if (port0) this.bgm.setPort(0, port0);
  }

  stopBgm(): void {
    this.bgm.stop();
  }

  get bgmPlaying(): boolean {
    const seq = this.bgm.sequence;
    return !!seq && !(seq.finished && this.bgm.voices.length === 0);
  }

  /** Starts a sound effect at `start` in the collection. Returns the pool slot used. */
  playSe(start: number, volume: number, tag: string | null = null): number {
    if (!this.collection) return -1;
    let slot = this.se.findIndex((s) => !busy(s));
    if (slot < 0) slot = this.started.indexOf(Math.min(...this.started));
    const synth = this.se[slot]!;
    this.retire(synth);
    synth.masterVolume = volume;
    synth.play(this.collection, start);
    this.started[slot] = this.samples;
    this.tags[slot] = tag;
    this.seStarted++;
    return slot;
  }

  /** Stops the effects started with `tag`. */
  stopSe(tag: string): void {
    this.se.forEach((synth, i) => {
      if (this.tags[i] !== tag) return;
      this.retire(synth);
      synth.stop();
      this.tags[i] = null;
    });
  }

  stopAll(): void {
    this.bgm.stop();
    for (const synth of this.se) {
      this.retire(synth);
      synth.stop();
    }
    this.tags.fill(null);
  }

  get stats(): MixerStats {
    const live = this.se.reduce((n, s) => ({ notes: n.notes + s.stats.notes, missing: n.missing + s.stats.missing }), { notes: 0, missing: 0 });
    return {
      seconds: this.samples / this.bgm.sampleRate,
      bgm: { playing: this.bgmPlaying, notes: this.bgm.stats.notes, missing: this.bgm.stats.missing, voices: this.bgm.voices.length },
      se: {
        started: this.seStarted,
        notes: this.seNotes + live.notes,
        missing: this.seMissing + live.missing,
        voices: this.se.reduce((n, s) => n + s.voices.length, 0),
        busy: this.se.filter(busy).length,
      },
    };
  }

  /** Renders the next `left.length` samples (replacing their contents). */
  render(left: Float32Array, right: Float32Array): void {
    const n = left.length;
    if (this.scratch[0]!.length !== n) this.scratch = Array.from({ length: 4 }, () => new Float32Array(n));
    const [l, r, sendL, sendR] = this.scratch as [Float32Array, Float32Array, Float32Array, Float32Array];
    this.bgm.render(left, right);
    sendL.set(this.bgm.sendLeft);
    sendR.set(this.bgm.sendRight);
    for (const synth of this.se) {
      if (!busy(synth)) continue;
      synth.render(l, r);
      const sl = synth.sendLeft;
      const sr = synth.sendRight;
      for (let i = 0; i < n; i++) {
        left[i]! += l[i]!;
        right[i]! += r[i]!;
        sendL[i]! += sl[i]!;
        sendR[i]! += sr[i]!;
      }
    }
    this.reverb.process(sendL, sendR, left, right);
    if (this.gain !== 1) {
      for (let i = 0; i < left.length; i++) {
        left[i]! *= this.gain;
        right[i]! *= this.gain;
      }
    }
    this.samples += left.length;
  }

  // Keeps the note counts of a synth that is about to be reused (play() resets them).
  private retire(synth: Synth): void {
    this.seNotes += synth.stats.notes;
    this.seMissing += synth.stats.missing;
    Object.assign(synth.stats, { notes: 0, missing: 0 });
  }
}

function busy(synth: Synth): boolean {
  const seq = synth.sequence;
  return !!seq && !(seq.finished && synth.voices.length === 0);
}
