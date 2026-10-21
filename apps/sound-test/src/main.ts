// Sound test: plays FSA's BGM sequences and sound effects. The page parses the audio init data and decodes every
// bank's waves; an AudioWorklet runs the sequencer and the software synth (see @fso/audio synth.ts). window.soundTest
// exposes play/playSe/stop/renderOffline and the latest stats for tools/e2e/src/sound.ts.
import {
  type AudioInit,
  bgmList,
  buildSynthBanks,
  INIT_FILE,
  loadAudioInit,
  loadSequences,
  readStageBgmTable,
  REFERENCE_VOLUME,
  SEQ_ARCHIVE,
  sequenceVolume,
  soundEffects,
  stageBgmIds,
  type SoundEntry,
  type SequenceFile,
  type SynthBank,
  waveArchivePath,
} from "@fso/audio";
import { decompressYaz0, Dol, isYaz0, parseRarc } from "@fso/formats";
import { type AssetStore, describeManifest, openServerStore, SYS_DOL } from "@fso/web";
import type { SynthCommand, SynthInit, SynthReport } from "./protocol.ts";
import workletUrl from "./synth.worklet.ts?worker&url";

const SAMPLE_RATE = 32000;

type Bgm = SoundEntry & { file?: SequenceFile };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  status: $<HTMLParagraphElement>("data-status"),
  controls: $<HTMLElement>("controls"),
  play: $<HTMLButtonElement>("play"),
  stop: $<HTMLButtonElement>("stop"),
  volume: $<HTMLInputElement>("volume"),
  port0: $<HTMLInputElement>("port0"),
  muffle: $<HTMLInputElement>("muffle"),
  stats: $<HTMLPreElement>("stats"),
  table: $<HTMLTableElement>("bgm"),
  se: $<HTMLSelectElement>("se"),
  playSe: $<HTMLButtonElement>("play-se"),
};

let bgm: Bgm[] = [];
let effects: (SoundEntry & { start?: number })[] = [];
let collection: Uint8Array | null = null;
let banks: Map<number, SynthBank> | null = null;
let context: AudioContext | null = null;
let node: AudioWorkletNode | null = null;
let selected = 11; // JA_BGM_WATER_FIELD, Lake Hylia's theme
let playing = -1;
let stats: SynthReport | null = null;
let ready = false;
const errors: string[] = [];

function setStatus(text: string, error = false): void {
  ui.status.textContent = text;
  ui.status.classList.toggle("error", error);
}

function playCommand(index: number): Extract<SynthCommand, { type: "play" }> {
  const entry = bgmEntry(index);
  if (!entry?.file) throw new Error(`no sequence for BGM ${index}`);
  return {
    type: "play",
    channel: "bgm",
    sequence: entry.file.data.slice(),
    start: 0,
    volume: sequenceVolume(entry) * Number(ui.volume.value),
    port0: ui.port0.checked ? 1 : 0,
  };
}

/** Plays a sound effect (JA_SE_* name) from the "bsc" collection on the second synth, over the BGM. */
async function playSe(name = ui.se.value): Promise<void> {
  const effect = effects.find((e) => e.name === name);
  if (!effect || effect.start === undefined || !collection) throw new Error(`no sound effect ${name}`);
  const synth = await ensureAudio();
  const command: SynthCommand = { type: "play", channel: "se", sequence: collection, start: effect.start, volume: REFERENCE_VOLUME * Number(ui.volume.value), port0: 0 };
  synth.port.postMessage(command);
}

let starting: Promise<AudioWorkletNode> | null = null;

async function ensureAudio(): Promise<AudioWorkletNode> {
  if (!banks) throw new Error("the game files are not loaded");
  const setup = async () => {
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    void ctx.resume(); // while still in the click or tap (iOS starts audio only from a user gesture)
    await ctx.audioWorklet.addModule(workletUrl);
    const init: SynthInit = { banks: banks! };
    const synth = new AudioWorkletNode(ctx, "fso-synth", { numberOfInputs: 0, outputChannelCount: [2], processorOptions: init });
    synth.port.onmessage = ({ data }: MessageEvent<SynthReport>) => showStats(data);
    synth.onprocessorerror = () => report(new Error("synth processor error"));
    synth.connect(ctx.destination);
    context = ctx;
    node = synth;
    return synth;
  };
  starting ??= setup().catch((error) => {
    starting = null;
    throw error;
  });
  const synth = await starting;
  if (context!.state !== "running") await context!.resume();
  return synth;
}

const bgmEntry = (index: number) => bgm.find((b) => b.index === index);

async function play(index = selected): Promise<void> {
  selected = index;
  const synth = await ensureAudio();
  synth.port.postMessage(playCommand(index));
  playing = index;
  highlight();
}

function stop(): void {
  node?.port.postMessage({ type: "stop", channel: "bgm" } satisfies SynthCommand);
  playing = -1;
  highlight();
}

/** Renders a BGM with an OfflineAudioContext (no audio device needed) and measures it. */
async function renderOffline(index: number, seconds: number): Promise<{ rms: number; peak: number; stats: SynthReport | null }> {
  if (!banks) throw new Error("the game files are not loaded");
  const offline = new OfflineAudioContext(2, Math.round(seconds * SAMPLE_RATE), SAMPLE_RATE);
  await offline.audioWorklet.addModule(workletUrl);
  const init: SynthInit = { banks, play: playCommand(index) };
  const synth = new AudioWorkletNode(offline, "fso-synth", { numberOfInputs: 0, outputChannelCount: [2], processorOptions: init });
  let last: SynthReport | null = null;
  synth.port.onmessage = ({ data }: MessageEvent<SynthReport>) => (last = data);
  synth.connect(offline.destination);
  const buffer = await offline.startRendering();
  await new Promise((r) => setTimeout(r, 100));
  let sum = 0;
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    for (const x of buffer.getChannelData(c)) {
      sum += x * x;
      peak = Math.max(peak, Math.abs(x));
    }
  }
  return { rms: Math.sqrt(sum / (buffer.length * buffer.numberOfChannels)), peak, stats: last };
}

function showStats(report: SynthReport): void {
  stats = report;
  const entry = bgmEntry(playing);
  const tracks = Object.entries(report.tracks)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([path, n]) => `${path}:${n}`)
    .join(" ");
  ui.stats.textContent = entry
    ? `${entry.name} (${entry.file?.name})\n${report.seconds.toFixed(1)} s · tempo ${report.tempo} × timebase ${report.timebase} · tick ${report.ticks}\n` +
      `notes ${report.notes} (missing ${report.missing}) · voices ${report.voices} (peak ${report.peakVoices})\n` +
      `tracks with notes ${report.noteTracks}\n${tracks}`
    : "BGM stopped";
  ui.stats.textContent += `\nsound effects: ${report.se.notes} notes (missing ${report.se.missing}) · voices ${report.se.voices}`;
  if (!report.playing && playing >= 0) {
    playing = -1;
    highlight();
  }
}

function highlight(): void {
  for (const row of ui.table.tBodies[0]!.rows) {
    const index = Number(row.dataset.index);
    row.classList.toggle("selected", index === selected);
    row.classList.toggle("playing", index === playing);
  }
}

function fillTable(): void {
  const body = ui.table.tBodies[0]!;
  body.replaceChildren(
    ...bgm.map((entry) => {
      const row = document.createElement("tr");
      row.dataset.index = String(entry.index);
      for (const text of [String(entry.index), entry.name.replace(/^JA_BGM_/, ""), entry.file?.name ?? "?", ""]) {
        const cell = document.createElement("td");
        cell.textContent = text;
        row.append(cell);
      }
      row.addEventListener("click", () => void play(entry.index).catch(report));
      return row;
    }),
  );
  ui.table.hidden = false;
  highlight();
}

/** Stage → BGM from main.dol's table and each stage's map CSV (filled in after the list is shown). */
async function fillStages(store: AssetStore): Promise<void> {
  if (!store.manifest.files.includes(SYS_DOL)) return;
  const table = readStageBgmTable(new Dol(await store.read(SYS_DOL)));
  const byBgm = new Map<number, string[]>();
  for (const path of store.manifest.files.filter((f) => /\/Boss\/boss\d+\.arc$/.test(f)).sort()) {
    const bytes = await store.read(path);
    const arc = parseRarc(isYaz0(bytes) ? decompressYaz0(bytes) : bytes);
    const csv = arc.files.find((f) => /^map\/map\d+\.csv$/.test(f.path));
    const name = path.match(/(boss\d+)\.arc$/)![1]!;
    for (const bgmId of csv ? stageBgmIds(new TextDecoder().decode(csv.data)) : []) {
      const entry = bgm.find((b) => b.id === table[bgmId]);
      if (!entry) continue;
      const list = byBgm.get(entry.index) ?? [];
      list.push(name === "boss500" ? "boss500 (Shadow Battle?)" : name);
      byBgm.set(entry.index, list);
    }
  }
  for (const row of ui.table.tBodies[0]!.rows) row.cells[3]!.textContent = (byBgm.get(Number(row.dataset.index)) ?? []).join(" ");
}

function fillEffects(init: AudioInit): void {
  collection = init.seqCollection ?? null;
  effects = soundEffects(init).filter((e) => e.start !== undefined);
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const e of effects) {
    let group = groups.get(e.groupName);
    if (!group) {
      group = document.createElement("optgroup");
      group.label = e.groupName;
      groups.set(e.groupName, group);
    }
    group.append(new Option(e.name.replace(/^JA_SE_/, ""), e.name));
  }
  ui.se.replaceChildren(...groups.values());
}

async function useStore(store: AssetStore): Promise<void> {
  setStatus("Loading audio…");
  const init = loadAudioInit(await store.read(INIT_FILE));
  const sequences = loadSequences(await store.read(SEQ_ARCHIVE));
  bgm = bgmList(init, sequences);
  banks = await buildSynthBanks(init, [...init.banks.keys()], (name) => store.read(waveArchivePath(name)));
  const waves = [...banks.values()].reduce((n, b) => n + b.waves.size, 0);
  fillEffects(init);
  setStatus(`${describeManifest(store.manifest)} · ${bgm.length} BGM, ${effects.length} sound effects, ${waves} waves`);
  ui.controls.hidden = false;
  fillTable();
  ready = true;
  void fillStages(store).catch(report);
}

function report(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  errors.push(message);
  setStatus(message, true);
}

ui.play.addEventListener("click", () => void play().catch(report));
ui.stop.addEventListener("click", stop);
ui.volume.addEventListener("input", () => {
  const entry = bgmEntry(playing);
  if (entry) node?.port.postMessage({ type: "volume", channel: "bgm", value: sequenceVolume(entry) * Number(ui.volume.value) } satisfies SynthCommand);
  node?.port.postMessage({ type: "volume", channel: "se", value: REFERENCE_VOLUME * Number(ui.volume.value) } satisfies SynthCommand);
});
ui.playSe.addEventListener("click", () => void playSe().catch(report));
ui.port0.addEventListener("change", () =>
  node?.port.postMessage({ type: "port", port: 0, value: ui.port0.checked ? 1 : 0 } satisfies SynthCommand),
);
ui.muffle.addEventListener("change", () =>
  node?.port.postMessage({ type: "port", port: 0, value: ui.muffle.checked ? 1 : 0, tracks: true } satisfies SynthCommand),
);

const api = {
  get ready() {
    return ready;
  },
  get bgm() {
    return bgm.map((b) => ({ index: b.index, name: b.name, file: b.file?.name }));
  },
  get effects() {
    return effects.map((e) => e.name);
  },
  get stats() {
    return stats;
  },
  get audioState() {
    return context?.state ?? "none";
  },
  errors,
  play,
  playSe,
  stop,
  renderOffline,
};
(window as unknown as { soundTest: typeof api }).soundTest = api;

await openServerStore().then(useStore).catch(report);
