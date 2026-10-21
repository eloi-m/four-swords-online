// The games' audio player: the disc's BGM and sound effects, played by the @fso/audio synth in an AudioWorklet
// (synth.worklet.ts). `SynthAudio` loads the audio data and owns the AudioContext (started on the first user gesture);
// what to play, and when, is each app's (apps/battle sound.ts, apps/game sound.ts).
import {
  bgmList,
  buildSynthBanks,
  INIT_FILE,
  loadAudioInit,
  loadSequences,
  REFERENCE_VOLUME,
  SEQ_ARCHIVE,
  sequenceVolume,
  soundEffects,
  waveArchivePath,
  type SequenceFile,
  type SoundEntry,
  type SynthBank,
} from "@fso/audio";
import type { AudioCommand, AudioInit, AudioReport } from "./protocol.ts";
import workletUrl from "./synth.worklet.ts?worker&url";

const SAMPLE_RATE = 32000;

type Bgm = SoundEntry & { file?: SequenceFile };

export type AudioState = "loading" | "ready" | "starting" | "running" | "failed";

/** The parsed audio data (`SynthAudio.loadData`), the waves still decoding. */
export interface SynthData {
  init: ReturnType<typeof loadAudioInit>;
  sequences: Map<number, SequenceFile>;
  banks: Promise<Map<number, SynthBank>>;
}

export class SynthAudio {
  state: AudioState = "loading";
  stats: AudioReport | null = null;
  /** Every cue and BGM change, for tests (`sent`: the synth was running). */
  readonly log: { tick: number; name: string; sent: boolean }[] = [];
  error: string | null = null;
  protected readonly bgm: Bgm[];
  private readonly effects = new Map<string, number>();
  private readonly collection: Uint8Array;
  private readonly banks: Promise<Map<number, SynthBank>>;
  private readonly volumeKey: string;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private starting: Promise<void> | null = null;
  private wantedBgm: string | null = null;
  private startedAt = -1;
  private volumeValue = 0.8;
  private mutedValue = false;

  /** `volumeKey`: where the volume and mute setting are kept (localStorage). */
  constructor(data: SynthData, volumeKey: string) {
    const { init, sequences, banks } = data;
    this.bgm = bgmList(init, sequences);
    for (const e of soundEffects(init)) if (e.start !== undefined) this.effects.set(e.name, e.start);
    this.collection = init.seqCollection ?? new Uint8Array(0);
    this.banks = banks;
    this.volumeKey = volumeKey;
    try {
      const saved = JSON.parse(localStorage.getItem(volumeKey) ?? "null") as { volume?: number; muted?: boolean } | null;
      if (saved) {
        this.volumeValue = typeof saved.volume === "number" ? Math.min(1, Math.max(0, saved.volume)) : this.volumeValue;
        this.mutedValue = saved.muted === true;
      }
    } catch {}
    banks.then(
      () => this.state === "loading" && (this.state = "ready"),
      (e: Error) => ((this.state = "failed"), (this.error = e.message)),
    );
  }

  /** Parses the audio data and starts decoding the waves in the background (no AudioContext yet). */
  static async loadData(read: (path: string) => Promise<Uint8Array>): Promise<SynthData> {
    const init = loadAudioInit(await read(INIT_FILE));
    const sequences = loadSequences(await read(SEQ_ARCHIVE));
    const banks = buildSynthBanks(init, [...init.banks.keys()], (name) => read(waveArchivePath(name)));
    return { init, sequences, banks };
  }

  /** A BGM's name by its sound id (0x010000NN), or null. */
  bgmName(id: number | undefined): string | null {
    return this.bgm.find((b) => b.id === id)?.name ?? null;
  }

  /** Which of these sound effect and BGM names the disc lacks (should be none). */
  lacking(effects: readonly string[], bgm: readonly string[] = []): string[] {
    return [...effects.filter((n) => !this.effects.has(n)), ...bgm.filter((n) => !this.bgm.some((b) => b.name === n && b.file))];
  }

  /** Creates and resumes the AudioContext; call from a user gesture. Safe to call again. */
  start(): Promise<void> {
    // The context is created (and resumed) inside the gesture; the synth joins it once the waves are decoded.
    let context: AudioContext;
    try {
      context = this.context ??= new AudioContext({ sampleRate: SAMPLE_RATE });
    } catch (e) {
      this.state = "failed";
      this.error = (e as Error).message;
      return Promise.resolve();
    }
    const resume = context.state !== "running" ? context.resume() : Promise.resolve();
    this.starting ??= (async () => {
      this.state = "starting";
      const [banks] = await Promise.all([this.banks, context.audioWorklet.addModule(workletUrl)]);
      const init: AudioInit = { banks, collection: this.collection, gain: this.gain };
      const node = new AudioWorkletNode(context, "fso-synth", { numberOfInputs: 0, outputChannelCount: [2], processorOptions: init });
      node.port.onmessage = ({ data }: MessageEvent<AudioReport>) => (this.stats = data);
      node.onprocessorerror = () => ((this.state = "failed"), (this.error = "synth processor error"));
      node.connect(context.destination);
      this.node = node;
      this.state = "running";
      this.startedAt = performance.now();
      if (this.wantedBgm) this.sendBgm(this.wantedBgm);
    })().catch((e: Error) => {
      this.state = "failed";
      this.error = e.message;
      console.warn(`audio: ${e.message}`);
    });
    return Promise.all([this.starting, resume]).then(() => {});
  }

  get contextState(): string {
    return this.context?.state ?? "none";
  }

  /** Seconds the AudioContext has played, and when it started (performance.now() ms), for tests. */
  get time(): { played: number; startedAt: number } {
    return { played: this.context?.currentTime ?? 0, startedAt: this.startedAt };
  }

  get volume(): number {
    return this.volumeValue;
  }

  set volume(v: number) {
    this.volumeValue = Math.min(1, Math.max(0, v));
    this.applyGain();
  }

  get muted(): boolean {
    return this.mutedValue;
  }

  set muted(m: boolean) {
    this.mutedValue = m;
    this.applyGain();
  }

  /** Mutes for this page only (the #mute deep link), without changing the saved setting. */
  muteForSession(): void {
    this.mutedValue = true;
    this.applyGain(false);
  }

  private get gain(): number {
    return this.mutedValue ? 0 : this.volumeValue;
  }

  private applyGain(save = true): void {
    this.post({ type: "gain", value: this.gain });
    if (!save) return;
    try {
      localStorage.setItem(this.volumeKey, JSON.stringify({ volume: this.volumeValue, muted: this.mutedValue }));
    } catch {}
  }

  /** The BGM playing, or waiting for the context to run (null: none, or stopped). */
  get currentBgm(): string | null {
    return this.wantedBgm;
  }

  /** Plays a BGM by name (or stops it for null); remembered until the context runs. */
  playBgm(name: string | null, tick = 0): void {
    this.wantedBgm = name;
    this.log.push({ tick, name: name ?? "stopBgm", sent: !!this.node });
    if (this.node) this.sendBgm(name);
  }

  private sendBgm(name: string | null): void {
    const entry = name ? this.bgm.find((b) => b.name === name) : undefined;
    if (!entry?.file) {
      this.post({ type: "stopBgm" });
      return;
    }
    this.post({ type: "bgm", sequence: entry.file.data.slice(), volume: sequenceVolume(entry) });
  }

  /** Plays sound effects by name (dropped while the context isn't running). */
  playSe(names: readonly string[], tick = 0, tag: string | null = null): void {
    for (const name of names) {
      this.log.push({ tick, name, sent: !!this.node });
      const start = this.effects.get(name);
      if (start === undefined) console.warn(`audio: no sound effect ${name}`);
      else this.post({ type: "se", start, volume: REFERENCE_VOLUME, tag });
    }
  }

  stopSe(tag: string): void {
    this.post({ type: "stopSe", tag });
  }

  stopAll(): void {
    this.wantedBgm = null;
    this.post({ type: "stopAll" });
  }

  private post(command: AudioCommand): void {
    this.node?.port.postMessage(command);
  }
}
