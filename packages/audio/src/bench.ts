// What the battle's AudioWorklet costs: the SynthMixer rendering a battle BGM with a steady rain of sound effects
// (a swing, a hit, a bomb… every few frames, all 8 effect synths busy), timed per 128-frame render quantum, the unit
// an AudioWorklet's process() handles. At 32 kHz a quantum lasts 4 ms of audio; the audio thread must stay well under.
//   pnpm --filter @fso/audio bench [seconds=60]      (needs extracted/)
import { existsSync, readFileSync } from "node:fs";
import { bgmList, loadAudioInit, loadSequences, sequenceVolume, soundEffects, REFERENCE_VOLUME } from "./jaudio.ts";
import { SynthMixer } from "./mixer.ts";
import { buildSynthBanks } from "./player.ts";

const root = new URL("../../../extracted/files/GC4Sword_usa/AudioRes/", import.meta.url);
if (!existsSync(root)) {
  console.error("needs the extracted disc in extracted/ (pnpm --filter @fso/extract extract <disc>)");
  process.exit(1);
}
const SECONDS = Number(process.argv[2] ?? 60);
const RATE = 32000, QUANTUM = 128;
const init = loadAudioInit(new Uint8Array(readFileSync(new URL("JaiInit.baa", root))));
const sequences = loadSequences(new Uint8Array(readFileSync(new URL("Seqs/JaiSeqs.arc", root))));
const banks = await buildSynthBanks(init, [...init.banks.keys()], (name) => new Uint8Array(readFileSync(new URL(`Waves/${name}`, root))));
const effects = new Map(soundEffects(init).flatMap((e) => (e.start === undefined ? [] : [[e.name, e.start] as const])));
// The cues apps/battle/src/sound.ts plays most in a brawl.
const RAIN = ["JA_SE_LK_SWORD_WIELD", "JA_SE_CHR_ENEMY_DAMAGE", "JA_SE_LK_SHIELD", "JA_SE_OBJ_BOMB_BURST", "JA_SE_LK_TAMEGIRI", "JA_SE_LK_THROW", "JA_SE_V_DAMAGE", "JA_SE_OBJ_FIREBLAST"];

for (const name of ["JA_BGM_BATTLE_ZAKO", "JA_BGM_BOSS"]) {
  const bgm = bgmList(init, sequences).find((b) => b.name === name);
  if (!bgm?.file) throw new Error(`no ${name}`);
  const mixer = new SynthMixer({ sampleRate: RATE, banks, collection: init.seqCollection! });
  mixer.playBgm(bgm.file.data.slice(), sequenceVolume(bgm));
  const left = new Float32Array(QUANTUM), right = new Float32Array(QUANTUM);
  const times: number[] = [];
  const quanta = Math.round((SECONDS * RATE) / QUANTUM);
  let voices = 0;
  for (let q = 0; q < quanta; q++) {
    // An effect every ~50 ms (every 12 quanta), cycling through the list.
    if (q % 12 === 0) mixer.playSe(effects.get(RAIN[(q / 12) % RAIN.length]!)!, REFERENCE_VOLUME);
    const t0 = performance.now();
    mixer.render(left, right);
    times.push(performance.now() - t0);
    if (q % 100 === 0) voices = Math.max(voices, mixer.stats.bgm.voices + mixer.stats.se.voices);
  }
  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const at = (p: number) => times[Math.floor(times.length * p)]!;
  const budget = (QUANTUM / RATE) * 1000;
  console.log(
    `${name} + an effect every 50 ms, ${SECONDS} s (${quanta} quanta, up to ${voices} voices): µs per 128-frame quantum ` +
      `mean ${(mean * 1000).toFixed(0)}, p99 ${(at(0.99) * 1000).toFixed(0)}, max ${(times.at(-1)! * 1000).toFixed(0)} ` +
      `= ${((mean / budget) * 100).toFixed(1)} % of the ${budget} ms real-time budget (p99 ${((at(0.99) / budget) * 100).toFixed(1)} %)`,
  );
}
