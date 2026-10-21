// Ties FSA's audio files together: JaiInit.baa (wave systems, banks, sound tables), Seqs/JaiSeqs.arc (BGM
// sequences by resource id), Waves/*.aw (raw sample data), and main.dol's stage BGM table.
// The game loads wave archives from AudioRes/Waves/ (the only path in main.dol); AudioRes/Banks/ holds older
// builds of three of the same archives and is never read.
import { type Dol, parseRarc } from "@fso/formats";
import { decodeWave, samplesInBytes } from "./adpcm.ts";
import { parseBaa } from "./baa.ts";
import { parseSoundTable, type SoundEntry } from "./bst.ts";
import { type Bank, parseIbnk } from "./ibnk.ts";
import { parseWsys, type WaveInfo, type WaveSystem } from "./wsys.ts";

export const AUDIO_ROOT = "GC4Sword_usa/AudioRes";
export const INIT_FILE = `${AUDIO_ROOT}/JaiInit.baa`;
export const SEQ_ARCHIVE = `${AUDIO_ROOT}/Seqs/JaiSeqs.arc`;
export const waveArchivePath = (archive: string) => `${AUDIO_ROOT}/Waves/${archive}`;

export interface AudioInit {
  /** Wave systems in BAA order, with the BAA "ws" flags (-1 or 0; meaning unknown). */
  waveSystems: (WaveSystem & { flags: number })[];
  /** Banks keyed by the bank id sequences select; each is bound to the wave system of the same BAA index. */
  banks: Map<number, { bank: Bank; wsys: WaveSystem }>;
  sounds: SoundEntry[];
  /** "bsc " sequence collection (sound-effect sequences), if present. */
  seqCollection?: Uint8Array;
}

export function loadAudioInit(baa: Uint8Array): AudioInit {
  const commands = parseBaa(baa);
  const waveSystems: AudioInit["waveSystems"] = [];
  const bankList: Bank[] = [];
  let bst: Uint8Array | undefined;
  let bstn: Uint8Array | undefined;
  let seqCollection: Uint8Array | undefined;
  for (const c of commands) {
    if (c.tag === "ws  " && "offset" in c) waveSystems.push({ ...parseWsys(baa.subarray(c.offset)), flags: c.flags | 0 });
    else if (c.tag === "bnk " && "offset" in c) bankList.push(parseIbnk(baa.subarray(c.offset)));
    else if ("start" in c && c.tag === "bst ") bst = baa.subarray(c.start, c.end);
    else if ("start" in c && c.tag === "bstn") bstn = baa.subarray(c.start, c.end);
    else if ("start" in c && c.tag === "bsc ") seqCollection = baa.subarray(c.start, c.end);
  }
  const banks = new Map<number, { bank: Bank; wsys: WaveSystem }>();
  bankList.forEach((bank, i) => {
    const wsys = waveSystems[i];
    if (wsys) banks.set(bank.id, { bank, wsys });
  });
  return { waveSystems, banks, sounds: bst ? parseSoundTable(bst, bstn) : [], seqCollection };
}

export interface SequenceFile {
  /** Resource id (RARC file id), as referenced by the sound table. */
  id: number;
  name: string;
  data: Uint8Array;
}

export function loadSequences(arc: Uint8Array): Map<number, SequenceFile> {
  const archive = parseRarc(arc);
  return new Map(archive.files.map((f) => [f.id, { id: f.id, name: f.path, data: f.data }]));
}

/**
 * Start offset of a sound effect's sequence in the "bsc" collection: "SC", u16 table count, u32 size, u32[count]
 * table offsets; each table is u32 n, u32[n] offsets. FSA's 7 tables match the 7 SE groups of the sound table
 * (same item counts), so sound effect (section 0, group g, index i) starts at table g, entry i. Each entry opens
 * a track with the effect and waits for it (shared code in the collection); SE banks are 128–131.
 */
export function seSequenceStart(collection: Uint8Array, group: number, index: number): number | undefined {
  if (collection[0] !== 0x53 || collection[1] !== 0x43) return undefined;
  const v = new DataView(collection.buffer, collection.byteOffset, collection.byteLength);
  if (group >= v.getUint16(2)) return undefined;
  const table = v.getUint32(8 + group * 4);
  return index < v.getUint32(table) ? v.getUint32(table + 4 + index * 4) : undefined;
}

/** Sound effects (section 0) with their start offset in the sequence collection. */
export function soundEffects(init: AudioInit): (SoundEntry & { start?: number })[] {
  return init.sounds
    .filter((s) => s.section === 0)
    .map((s) => ({ ...s, start: init.seqCollection ? seSequenceStart(init.seqCollection, s.group, s.index) : undefined }));
}

/** Synth master volume that reproduces Dolphin's output level for Lake Hylia's theme (one reference capture). */
export const REFERENCE_VOLUME = 0.34;

/**
 * Master volume for a BGM sound. Hypothesis: byte 2 of a sequence item is the sequence volume (55 for most BGM,
 * 60–65 for fanfares, 75–80 for the title, story and house themes); Lake Hylia's is 55.
 */
export function sequenceVolume(entry: SoundEntry): number {
  return (REFERENCE_VOLUME * (entry.item[2] ?? 55)) / 55;
}

/** BGM sound table (section 1) joined with the sequence files. */
export function bgmList(init: AudioInit, sequences: Map<number, SequenceFile>): (SoundEntry & { file?: SequenceFile })[] {
  return init.sounds
    .filter((s) => s.section === 1 && s.type === 0x11)
    .map((s) => ({ ...s, file: s.sequence !== undefined ? sequences.get(s.sequence) : undefined }));
}

/**
 * main.dol (G4SE01 rev 0) @0x804652F0: u32[39] sound ids (0x010000NN = BGM NN), indexed by the stage map CSV's
 * bgmId (field 4 of the first line). A second copy with 38 entries sits at 0x8046F1C8.
 */
export const STAGE_BGM_TABLE = 0x804652f0;
export const STAGE_BGM_COUNT = 39;

/**
 * bgmIds used by a stage, from its map CSV: field 4 of the first line (`mapNNN,x,y,bgmId,…`). Shadow Battle's
 * map500.csv instead has one line per arena room; its second field (24, or 16 for the fifth arena) is taken as the
 * room's bgmId (hypothesis: 24 → JA_BGM_BATTLE_ZAKO, 16 → JA_BGM_BOSS).
 */
export function stageBgmIds(csv: string): number[] {
  const lines = csv.split(/\r?\n/).filter((l) => l && !l.startsWith("end"));
  if (lines[0]?.startsWith("map")) return [Number(lines[0].split(",")[3])];
  return [...new Set(lines.map((l) => Number(l.split(",")[1])).filter((n) => Number.isInteger(n)))];
}

export function readStageBgmTable(dol: Dol): number[] {
  const raw = dol.read(STAGE_BGM_TABLE, STAGE_BGM_COUNT * 4);
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  return Array.from({ length: STAGE_BGM_COUNT }, (_, i) => v.getUint32(i * 4));
}

/** Decoded 16-bit samples for one wave, taken from its .aw archive. */
export function decodeWaveFromArchive(wave: WaveInfo, aw: Uint8Array): Int16Array {
  if (wave.offset + wave.size > aw.length) throw new Error(`${wave.archive}: wave ${wave.id} runs past the end`);
  // sampleCount can exceed the stored frames slightly; looping waves wrap before reaching the end.
  const count = Math.min(wave.sampleCount, samplesInBytes(wave.format, wave.size));
  return decodeWave(aw.subarray(wave.offset, wave.offset + wave.size), wave.format, count);
}
