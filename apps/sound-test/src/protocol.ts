// Messages between the page and the synth AudioWorklet. The worklet mixes two synths: "bgm" and "se".
import type { SynthBank, SynthStats } from "@fso/audio";

export type SynthChannel = "bgm" | "se";

export type SynthCommand =
  | { type: "play"; channel: SynthChannel; sequence: Uint8Array; start: number; volume: number; port0: number }
  | { type: "stop"; channel: SynthChannel }
  /** `tracks`: every track below the root (the game's per-track writes, e.g. the muffle switch) instead of the root. */
  | { type: "port"; port: number; value: number; tracks?: boolean }
  | { type: "volume"; channel: SynthChannel; value: number };

/** Passed as processorOptions (structured-cloned once): the decoded banks, and optionally a first sequence. */
export interface SynthInit {
  banks: Map<number, SynthBank>;
  play?: Extract<SynthCommand, { type: "play" }>;
}

/** Stats of the BGM synth, plus the sound-effect synth's voice and note counts. */
export interface SynthReport extends SynthStats {
  type: "stats";
  seconds: number;
  playing: boolean;
  tempo: number;
  timebase: number;
  ticks: number;
  voices: number;
  /** Sounding voices per track path. */
  tracks: Record<string, number>;
  /** Tracks that started at least one note since the last play. */
  noteTracks: number;
  volume: number;
  se: { notes: number; missing: number; voices: number };
}
