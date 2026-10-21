// AudioWorklet processor for the games (battle, adventure): the @fso/audio SynthMixer (BGM sequence + a pool of
// sound-effect sequences) on the audio thread. Commands come from synth-audio.ts; stats go back every ~80 ms and after
// each command.
import { SynthMixer } from "@fso/audio";
import type { AudioCommand, AudioInit, AudioReport } from "./protocol.ts";

// AudioWorkletGlobalScope names (not in the DOM typings).
declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class SynthProcessor extends AudioWorkletProcessor {
  private readonly mixer: SynthMixer;
  private calls = 0;

  constructor(options: { processorOptions: AudioInit }) {
    super();
    const { banks, collection, gain } = options.processorOptions;
    this.mixer = new SynthMixer({ sampleRate, banks, collection });
    this.mixer.gain = gain;
    this.port.onmessage = (event: MessageEvent<AudioCommand>) => this.command(event.data);
  }

  private command(c: AudioCommand): void {
    switch (c.type) {
      case "bgm":
        this.mixer.playBgm(c.sequence, c.volume);
        break;
      case "stopBgm":
        this.mixer.stopBgm();
        break;
      case "se":
        this.mixer.playSe(c.start, c.volume, c.tag);
        break;
      case "stopSe":
        this.mixer.stopSe(c.tag);
        break;
      case "gain":
        this.mixer.gain = c.value;
        break;
      case "stopAll":
        this.mixer.stopAll();
        break;
    }
    this.report();
  }

  private report(): void {
    this.port.postMessage({ type: "stats", ...this.mixer.stats } satisfies AudioReport);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const left = out?.[0];
    if (!left) return true;
    this.mixer.render(left, out[1] ?? new Float32Array(left.length));
    if (++this.calls % 20 === 0) this.report();
    return true;
  }
}

registerProcessor("fso-synth", SynthProcessor);
