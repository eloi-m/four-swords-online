// AudioWorklet processor: runs the @fso/audio software synth (BMS sequencer + sample mixer) on the audio thread.
// Two synths share the banks: one for the BGM sequence, one for sound effects, mixed together.
import { Synth } from "@fso/audio";
import type { SynthChannel, SynthCommand, SynthInit, SynthReport } from "./protocol.ts";

// AudioWorkletGlobalScope names (not in the DOM typings).
declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class SynthProcessor extends AudioWorkletProcessor {
  private readonly synths: Record<SynthChannel, Synth>;
  private readonly noteTracks = new Set<string>();
  private scratch = [new Float32Array(128), new Float32Array(128)];
  private calls = 0;

  constructor(options: { processorOptions: SynthInit }) {
    super();
    const { banks, play } = options.processorOptions;
    this.synths = { bgm: new Synth({ sampleRate, banks }), se: new Synth({ sampleRate, banks }) };
    this.synths.bgm.onNote = (track) => this.noteTracks.add(track.path);
    if (play) this.command(play);
    this.port.onmessage = (event: MessageEvent<SynthCommand>) => this.command(event.data);
  }

  private command(c: SynthCommand): void {
    switch (c.type) {
      case "play": {
        const synth = this.synths[c.channel];
        synth.masterVolume = c.volume;
        synth.play(c.sequence, c.start);
        if (c.port0) synth.setPort(0, c.port0);
        if (c.channel === "bgm") this.noteTracks.clear();
        break;
      }
      case "stop":
        this.synths[c.channel].stop();
        break;
      case "port":
        if (c.tracks) this.synths.bgm.setTrackPorts(c.port, c.value);
        else this.synths.bgm.setPort(c.port, c.value);
        break;
      case "volume":
        this.synths[c.channel].masterVolume = c.value;
        break;
    }
    this.report();
  }

  private report(): void {
    const { bgm, se } = this.synths;
    const tracks: Record<string, number> = {};
    for (const v of bgm.voices) tracks[v.track.path] = (tracks[v.track.path] ?? 0) + 1;
    const seq = bgm.sequence;
    const report: SynthReport = {
      type: "stats",
      seconds: bgm.seconds,
      playing: !!seq && !(seq.finished && bgm.voices.length === 0),
      tempo: seq?.tempo ?? 0,
      timebase: seq?.timebase ?? 0,
      ticks: seq?.ticks ?? 0,
      voices: bgm.voices.length,
      tracks,
      noteTracks: this.noteTracks.size,
      volume: bgm.masterVolume,
      ...bgm.stats,
      se: { notes: se.stats.notes, missing: se.stats.missing, voices: se.voices.length },
    };
    this.port.postMessage(report);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const left = out?.[0];
    if (!left) return true;
    const right = out[1] ?? new Float32Array(left.length);
    if (this.scratch[0]!.length !== left.length) this.scratch = [new Float32Array(left.length), new Float32Array(left.length)];
    const [seLeft, seRight] = this.scratch as [Float32Array, Float32Array];
    this.synths.bgm.render(left, right);
    this.synths.se.render(seLeft, seRight);
    for (let i = 0; i < left.length; i++) {
      left[i]! += seLeft[i]!;
      right[i]! += seRight[i]!;
    }
    if (++this.calls % 25 === 0) this.report();
    return true;
  }
}

registerProcessor("fso-synth", SynthProcessor);
