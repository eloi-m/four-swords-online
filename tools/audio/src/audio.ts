// FSA audio tool: inventory of AudioRes, WAV dumps of waves and the AST stream, BMS listings, offline renders.
//   node tools/audio/src/audio.ts inventory
//   node tools/audio/src/audio.ts stages                       stage → bgmId → BGM sound → sequence
//   node tools/audio/src/audio.ts waves <wsys id> [first=0] [count=8]
//   node tools/audio/src/audio.ts ast [seconds]
//   node tools/audio/src/audio.ts bms <sequence>               sequence = file name, BGM index or JA_BGM_* name
//   node tools/audio/src/audio.ts render <sequence | JA_SE_* name> [seconds=60] [port0=0] [dry | muffle]
//     ("dry": no reverb return, into <name>-dry.wav; "muffle": every track's port 0 set to 1 after 1 s, <name>-muffle.wav)
// Reads extracted/ (see docs/README.md) and writes WAVs to out/audio/ (gitignored: never commit them).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bgmList,
  buildSynthBanks,
  decodeAst,
  decodeWaveFromArchive,
  disassemble,
  encodeWav,
  formatListing,
  loadAudioInit,
  loadSequences,
  readStageBgmTable,
  REFERENCE_VOLUME,
  sequenceVolume,
  soundEffects,
  stageBgmIds,
  Synth,
  type SequenceFile,
} from "@fso/audio";
import { decompressYaz0, Dol, parseRarc } from "@fso/formats";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const files = join(repo, "extracted/files/GC4Sword_usa");
const audioRes = join(files, "AudioRes");
const out = join(repo, "out/audio");
const read = (path: string) => new Uint8Array(readFileSync(path));
const FORMATS = ["ADPCM4", "ADPCM2", "PCM8", "PCM16"];

if (!existsSync(audioRes)) {
  console.error(`missing ${audioRes}: extract the disc first (see README.md)`);
  process.exit(1);
}

const init = loadAudioInit(read(join(audioRes, "JaiInit.baa")));
const sequences = loadSequences(read(join(audioRes, "Seqs/JaiSeqs.arc")));
const bgm = bgmList(init, sequences);

function findSequence(query: string): SequenceFile {
  const byName = [...sequences.values()].find((s) => s.name === query || s.name === `${query}.bms`);
  if (byName) return byName;
  const entry = /^\d+$/.test(query) ? bgm.find((b) => b.index === Number(query)) : bgm.find((b) => b.name === query);
  if (entry?.file) return entry.file;
  throw new Error(`no sequence "${query}" (try a .bms name, a BGM index or a JA_BGM_* name)`);
}

function stageBgm(): { stage: string; bgmId: number; sound?: (typeof bgm)[number] }[] {
  const table = readStageBgmTable(new Dol(read(join(repo, "extracted/sys/main.dol"))));
  const rows = [];
  for (const f of readdirSync(join(files, "Boss")).filter((f) => /^boss\d+\.arc$/.test(f)).sort()) {
    const arc = parseRarc(decompressYaz0(read(join(files, "Boss", f))));
    const csv = arc.files.find((x) => /^map\/map\d+\.csv$/.test(x.path));
    for (const bgmId of csv ? stageBgmIds(new TextDecoder().decode(csv.data)) : []) {
      const id = table[bgmId];
      const stage = f === "boss500.arc" ? "boss500 (Shadow Battle, per-room field: hypothesis)" : f.replace(".arc", "");
      rows.push({ stage, bgmId, sound: id === undefined ? undefined : bgm.find((b) => b.id === id) });
    }
  }
  return rows;
}

function inventory(): void {
  console.log("AudioRes files:");
  const walk = (dir: string, prefix = "") => {
    for (const name of readdirSync(dir).sort()) {
      if (name === "CVS") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, `${prefix}${name}/`);
      else console.log(`  ${(prefix + name).padEnd(28)} ${statSync(path).size.toString().padStart(9)} bytes`);
    }
  };
  walk(audioRes);
  console.log("\nWave systems (JaiInit.baa \"ws\"; archives are loaded from Waves/):");
  for (const w of init.waveSystems) {
    const byFormat = FORMATS.map((f, i) => [f, w.waves.filter((x) => x.format === i).length] as const).filter(([, n]) => n);
    const rates = [...new Set(w.waves.map((x) => x.sampleRate))].sort((a, b) => a - b);
    const size = (dir: string) => (existsSync(join(audioRes, dir, w.archives[0]!)) ? statSync(join(audioRes, dir, w.archives[0]!)).size : 0);
    const end = Math.max(...w.waves.map((x) => x.offset + x.size));
    console.log(
      `  ws ${String(w.id).padStart(3)} flags ${w.flags} ${w.archives.join(",").padEnd(18)} ${String(w.waves.length).padStart(3)} waves ` +
        `(${byFormat.map(([f, n]) => `${n} ${f}`).join(", ")}; ${w.waves.filter((x) => x.loop).length} looped) rates ${rates.join("/")} Hz; ` +
        `data ends at ${end} (Waves/ ${size("Waves")}, Banks/ ${size("Banks") || "absent"})`,
    );
  }
  console.log("\nInstrument banks (\"bnk\"; each uses the wave system at the same BAA index):");
  for (const [id, { bank, wsys }] of init.banks) {
    const programs = [...bank.programs];
    const drums = programs.filter(([, p]) => p.type === "drums").map(([n]) => n);
    console.log(
      `  bank ${String(id).padStart(3)} IBNK v${bank.version} → ws ${wsys.id}: ${programs.length} programs` +
        `${drums.length ? ` (drum sets at ${drums.join(", ")})` : ""}`,
    );
  }
  const sections = new Map<string, number>();
  for (const s of init.sounds) sections.set(`${s.sectionName}/${s.groupName}`, (sections.get(`${s.sectionName}/${s.groupName}`) ?? 0) + 1);
  console.log(`\nSound table (bst/bstn): ${init.sounds.length} sounds`);
  for (const [k, n] of sections) console.log(`  ${k.padEnd(24)} ${n}`);
  console.log(`\nSequence collection (bsc): ${init.seqCollection?.length ?? 0} bytes (sound-effect sequences)`);
  console.log(`\nBGM (section 1): sound id → Seqs/JaiSeqs.arc resource`);
  for (const b of bgm) {
    const volume = b.item[2]!;
    console.log(`  ${String(b.index).padStart(2)} ${b.name.padEnd(22)} 0x${b.id.toString(16).padStart(8, "0")} → #${String(b.sequence).padEnd(3)} ${b.file?.name ?? "?"} (slot ${b.slot}, item byte 2 = ${volume})`);
  }
  const unused = [...sequences.values()].filter((s) => !bgm.some((b) => b.file === s));
  console.log(`  not in the sound table: ${unused.map((s) => s.name).join(", ") || "none"}`);
  const ast = read(join(audioRes, "Stream/smw.ast"));
  const h = decodeAst(ast);
  console.log(
    `\nStream/smw.ast: ${h.format === 0 ? "AFC ADPCM" : "PCM16"}, ${h.channels} ch, ${h.sampleRate} Hz, ${(h.sampleCount / h.sampleRate).toFixed(1)} s, ` +
      `loop ${h.loop ? `${h.loopStart}–${h.loopEnd}` : "off"}, ${h.blocks} blocks, history mismatches ${h.historyMismatches}. ` +
      `No file in the game references it.`,
  );
}

function dumpWaves(wsysId: number, first: number, count: number): void {
  const wsys = init.waveSystems.find((w) => w.id === wsysId);
  if (!wsys) throw new Error(`no wave system ${wsysId}`);
  mkdirSync(join(out, "waves"), { recursive: true });
  const archives = new Map<string, Uint8Array>();
  for (const wave of wsys.waves.slice(first, first + count)) {
    let aw = archives.get(wave.archive);
    if (!aw) archives.set(wave.archive, (aw = read(join(audioRes, "Waves", wave.archive))));
    const pcm = decodeWaveFromArchive(wave, aw);
    const name = `${wave.archive.replace(".aw", "")}_${String(wave.id).padStart(3, "0")}.wav`;
    writeFileSync(join(out, "waves", name), encodeWav([pcm], wave.sampleRate));
    console.log(
      `${name}: ${FORMATS[wave.format]} ${wave.sampleRate} Hz, ${pcm.length} samples (${(pcm.length / wave.sampleRate).toFixed(2)} s), ` +
        `base key ${wave.baseKey}${wave.loop ? `, loop ${wave.loopStart}–${wave.loopEnd}` : ""}`,
    );
  }
}

function dumpAst(seconds: number): void {
  const s = decodeAst(read(join(audioRes, "Stream/smw.ast")));
  const frames = Math.min(s.sampleCount, Math.round(seconds * s.sampleRate));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "smw.wav"), encodeWav(s.data.map((c) => c.subarray(0, frames)), s.sampleRate));
  console.log(`out/audio/smw.wav: ${s.channels} ch ${s.sampleRate} Hz, ${(frames / s.sampleRate).toFixed(1)} s`);
}

/** A BGM sequence, or a sound effect (JA_SE_* name) inside the "bsc" collection. */
function findTarget(query: string): { name: string; data: Uint8Array; start: number; volume: number } {
  if (query.startsWith("JA_SE_")) {
    const se = soundEffects(init).find((s) => s.name === query);
    if (se?.start === undefined || !init.seqCollection) throw new Error(`no sound effect "${query}"`);
    return { name: se.name, data: init.seqCollection, start: se.start, volume: REFERENCE_VOLUME };
  }
  const seq = findSequence(query);
  const entry = bgm.find((b) => b.file === seq);
  return { name: seq.name.replace(".bms", ""), data: seq.data, start: 0, volume: entry ? sequenceVolume(entry) : REFERENCE_VOLUME };
}

async function render(query: string, seconds: number, port0: number, mode: string): Promise<void> {
  const dry = mode === "dry";
  const target = findTarget(query);
  const sampleRate = 32000;
  const banks = await buildSynthBanks(init, [...init.banks.keys()], (name) => read(join(audioRes, "Waves", name)));
  const synth = new Synth({ sampleRate, banks, masterVolume: target.volume, reverb: !dry });
  synth.play(target.data, target.start);
  if (port0) synth.setPort(0, port0);
  let frames = Math.round(seconds * sampleRate);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const block = 1024;
  let finished = false;
  for (let i = 0; i < frames; i += block) {
    if (mode === "muffle" && i === block * Math.round(sampleRate / block)) synth.setTrackPorts(0, 1);
    const n = Math.min(block, frames - i);
    synth.render(left.subarray(i, i + n), right.subarray(i, i + n));
    if (synth.sequence?.finished && synth.voices.length === 0) {
      frames = i + n;
      finished = true;
      break;
    }
  }
  let peak = 0;
  for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!));
  const fade = finished ? 0 : Math.min(frames, sampleRate * 2);
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    left[frames - 1 - i]! *= g;
    right[frames - 1 - i]! *= g;
  }
  mkdirSync(out, { recursive: true });
  const name = mode === "dry" || mode === "muffle" ? `${target.name}-${mode}` : target.name;
  writeFileSync(join(out, `${name}.wav`), encodeWav([left.subarray(0, frames), right.subarray(0, frames)], sampleRate));
  const q = synth.sequence;
  console.log(
    `out/audio/${name}.wav: ${(frames / sampleRate).toFixed(1)} s at ${sampleRate} Hz · tempo ${q?.tempo} × timebase ${q?.timebase} · ${synth.stats.notes} notes ` +
      `(${synth.stats.missing} missing, ${synth.stats.oscPrograms} osc programs, ${synth.stats.stolen} stolen, peak ${synth.stats.peakVoices} voices) · peak ${peak.toFixed(2)}`,
  );
}

const [command = "inventory", ...args] = process.argv.slice(2);
switch (command) {
  case "inventory":
    inventory();
    break;
  case "stages":
    for (const row of stageBgm())
      console.log(`${row.stage} bgmId ${String(row.bgmId).padStart(2)} → ${row.sound ? `${row.sound.name} (${row.sound.file?.name})` : "?"}`);
    break;
  case "waves":
    dumpWaves(Number(args[0] ?? 0), Number(args[1] ?? 0), Number(args[2] ?? 8));
    break;
  case "ast":
    dumpAst(Number(args[0] ?? 1e9));
    break;
  case "bms": {
    const seq = findSequence(args[0] ?? "chijou.bms");
    console.log(`; ${seq.name} (#${seq.id}, ${seq.data.length} bytes)`);
    console.log(formatListing(disassemble(seq.data)));
    break;
  }
  case "render":
    await render(args[0] ?? "filed_w.bms", Number(args[1] ?? 60), Number(args[2] ?? 0), args[3] ?? "");
    break;
  default:
    console.error(`unknown command ${command}`);
    process.exit(1);
}
