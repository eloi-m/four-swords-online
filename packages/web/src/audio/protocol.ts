// Messages between the page and the games' synth AudioWorklet (a SynthMixer from @fso/audio: BGM + an effect pool).
import type { MixerStats, SynthBank } from "@fso/audio";

export type AudioCommand =
  | { type: "bgm"; sequence: Uint8Array; volume: number }
  | { type: "stopBgm" }
  | { type: "se"; start: number; volume: number; tag: string | null }
  | { type: "stopSe"; tag: string }
  | { type: "gain"; value: number }
  | { type: "stopAll" };

/** processorOptions (structured-cloned once): the decoded banks and the sound-effect sequence collection. */
export interface AudioInit {
  banks: Map<number, SynthBank>;
  collection: Uint8Array;
  gain: number;
}

export interface AudioReport extends MixerStats {
  type: "stats";
}
