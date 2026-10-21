// Checks against the real extracted disc; skipped when extracted/ is absent (e.g. in CI).
import { existsSync, readFileSync, statSync } from "node:fs";
import { Dol, decompressYaz0, parseRarc } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { decodeAst } from "./ast.ts";
import { disassemble } from "./bms.ts";
import { FX_LINE } from "./effects.ts";
import { bgmList, decodeWaveFromArchive, loadAudioInit, loadSequences, readStageBgmTable, soundEffects } from "./jaudio.ts";
import { buildSynthBanks } from "./player.ts";
import { iirCutoff } from "./sequencer.ts";
import { Synth } from "./synth.ts";

const root = new URL("../../../extracted/files/GC4Sword_usa/", import.meta.url);
const audio = new URL("AudioRes/", root);
const present = existsSync(audio);
const read = (url: URL) => new Uint8Array(readFileSync(url));

describe.skipIf(!present)("real disc: audio", () => {
  const init = present ? loadAudioInit(read(new URL("JaiInit.baa", audio))) : null!;
  const sequences = present ? loadSequences(read(new URL("Seqs/JaiSeqs.arc", audio))) : null!;

  it("JaiInit.baa holds 5 wave systems, 5 banks (one per wave system) and 840 sounds", () => {
    expect(init.waveSystems.map((w) => [w.id, w.archives[0], w.waves.length])).toEqual([
      [0, "4sword_0.aw", 67],
      [128, "defaultSE_0.aw", 23],
      [129, "2ndLoad_0.aw", 323],
      [130, "MiyagawaBank_0.aw", 56],
      [131, "NpcVoice_0.aw", 32],
    ]);
    expect([...init.banks].map(([id, { bank, wsys }]) => [id, bank.version, wsys.id, bank.programs.size])).toEqual([
      [0, 0, 0, 89],
      [128, 1, 128, 22],
      [129, 1, 129, 140],
      [130, 1, 130, 48],
      [131, 1, 131, 33],
    ]);
    expect(init.sounds.length).toBe(840);
  });

  it("wave data fits the Waves/ archives but not the stale Banks/ copies", () => {
    for (const w of init.waveSystems) {
      const end = Math.max(...w.waves.map((x) => x.offset + x.size));
      const waves = statSync(new URL(`Waves/${w.archives[0]}`, audio)).size;
      expect(end).toBeLessThanOrEqual(waves);
      expect(waves - end).toBeLessThan(32);
      const banks = new URL(`Banks/${w.archives[0]}`, audio);
      if (existsSync(banks)) expect(statSync(banks).size).toBeLessThan(end);
    }
  });

  it("decodes every looped wave bit-exactly: the stored loop history matches the decoder at the loop frame", () => {
    let checked = 0;
    for (const w of init.waveSystems) {
      const aw = read(new URL(`Waves/${w.archives[0]}`, audio));
      for (const wave of w.waves.filter((x) => x.loop && x.loopStart >= 16)) {
        const pcm = decodeWaveFromArchive(wave, aw);
        const frame = wave.loopStart & ~15;
        expect([pcm[frame - 1], pcm[frame - 2]]).toEqual([wave.loopLast, wave.loopPenult]);
        checked++;
      }
    }
    expect(checked).toBe(105);
  });

  it("decodes Stream/smw.ast (44.1 kHz stereo AFC) with every block's stored history matching", () => {
    const s = decodeAst(read(new URL("Stream/smw.ast", audio)));
    expect([s.format, s.channels, s.sampleRate, s.sampleCount, s.loopStart, s.blocks]).toEqual([0, 2, 44100, 3824000, 103424, 214]);
    expect(s.historyMismatches).toBe(0);
  });

  it("maps the 49 BGM sounds to sequences, and stages to BGM through main.dol's table", () => {
    const bgm = bgmList(init, sequences);
    expect(bgm.length).toBe(49);
    expect(bgm.every((b) => b.file)).toBe(true);
    expect(bgm[11]).toMatchObject({ name: "JA_BGM_WATER_FIELD", id: 0x0100000b, file: { name: "filed_w.bms" } });
    const table = readStageBgmTable(new Dol(read(new URL("../../sys/main.dol", root))));
    const stage = (name: string) => {
      const arc = parseRarc(decompressYaz0(read(new URL(`Boss/${name}.arc`, root))));
      const csv = new TextDecoder().decode(arc.files.find((f) => f.path === `map/map${name.slice(4)}.csv`)!.data);
      return bgm.find((b) => b.id === table[Number(csv.split(",")[3])])?.name;
    };
    expect(stage("boss010")).toBe("JA_BGM_WATER_FIELD"); // Lake Hylia (confirmed against a Dolphin audio dump)
    expect(stage("boss021")).toBe("JA_BGM_DARK_VILLAGE");
    expect(stage("boss080")).toBe("JA_BGM_TENKU");
  });

  it("disassembles all 52 sequences without unknown commands", () => {
    expect(sequences.size).toBe(52);
    for (const s of sequences.values()) {
      const listing = disassemble(s.data);
      expect(listing.errors, s.name).toEqual([]);
      const covered = listing.commands.reduce((n, c) => n + c.length, 0);
      // The rest is padding, jump/interrupt tables and dead "wait; finish" tails after endless loops.
      expect(covered / s.data.length, s.name).toBeGreaterThan(0.85);
    }
  });

  it("finds every sound effect's sequence in the bsc collection and plays them with the SE banks", async () => {
    const effects = soundEffects(init);
    expect(effects.length).toBe(791);
    expect(effects.every((e) => e.start !== undefined)).toBe(true);
    const banks = await buildSynthBanks(init, [...init.banks.keys()], (name) => read(new URL(`Waves/${name}`, audio)));
    const synth = new Synth({ sampleRate: 32000, banks });
    const left = new Float32Array(3200);
    for (const name of ["JA_SE_CURSOR_1", "JA_SE_LK_SWORD_WIELD", "JA_SE_OBJ_BOMB_BURST", "JA_SE_CHR_NIWATORI", "JA_SE_NPC_V_URANAIBAA"]) {
      synth.play(init.seqCollection!, effects.find((e) => e.name === name)!.start!);
      for (let i = 0; i < 20; i++) synth.render(left, new Float32Array(3200));
      expect(synth.stats.notes, name).toBeGreaterThanOrEqual(1);
      expect(synth.stats.missing, name).toBe(0);
      expect(synth.sequence?.errors, name).toEqual([]);
    }
  });

  it("plays Lake Hylia's theme for 10 s with every note finding an instrument", async () => {
    const banks = await buildSynthBanks(init, [0], (name) => read(new URL(`Waves/${name}`, audio)));
    const synth = new Synth({ sampleRate: 32000, banks });
    synth.play([...sequences.values()].find((s) => s.name === "filed_w.bms")!.data);
    const left = new Float32Array(32000);
    const right = new Float32Array(32000);
    let energy = 0;
    for (let i = 0; i < 10; i++) {
      synth.render(left, right);
      for (const x of left) energy += x * x;
    }
    expect(synth.sequence?.tempo).toBe(145);
    expect(synth.stats.notes).toBeGreaterThan(200);
    expect(synth.stats.missing).toBe(0);
    expect(Math.sqrt(energy / 320000)).toBeGreaterThan(0.01);
  });
  it("takes the IIR cutoff table and the FX lines from main.dol", () => {
    const dol = new Dol(read(new URL("../../sys/main.dol", root)));
    const table = new DataView(dol.read(0x8045c6b8, 128 * 8).slice().buffer);
    // A straight line from entry 0 to entry 127, within 1 LSB (the game's own rounding isn't quite a plain round).
    let worst = 0;
    for (let i = 0; i < 128; i++) for (let k = 0; k < 4; k++) worst = Math.max(worst, Math.abs(table.getInt16(i * 8 + k * 2) - iirCutoff(i)[k]!));
    expect(worst).toBe(1);
    const fx = new DataView(dol.read(0x80491600, 4 * 0x20).slice().buffer);
    for (let line = 0; line < 4; line++) {
      const o = line * 0x20;
      expect(fx.getUint8(o)).toBe(1);
      expect(fx.getUint32(o + 0x0c)).toBe(FX_LINE.frames);
      // One output (left for lines 0 and 2, right for 1 and 3) at FX_LINE.volume.
      expect([fx.getUint16(o + 4), fx.getUint16(o + 8)]).toEqual(line & 1 ? [0, FX_LINE.volume] : [FX_LINE.volume, 0]);
      const taps = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => fx.getInt16(o + 0x10 + k * 2));
      expect(taps).toEqual(taps.map((_, k) => (k === FX_LINE.tap ? FX_LINE.coefficient : 0)));
    }
  });

  it("muffles Lake Hylia's theme when the game sets the tracks' port 0", async () => {
    const banks = await buildSynthBanks(init, [0], (name) => read(new URL(`Waves/${name}`, audio)));
    const data = [...sequences.values()].find((s) => s.name === "filed_w.bms")!.data;
    // Energy above 2 kHz relative to all, by a first difference (a crude high-pass).
    const treble = (muffle: boolean) => {
      const synth = new Synth({ sampleRate: 32000, banks });
      synth.play(data);
      const left = new Float32Array(32000);
      const right = new Float32Array(32000);
      let all = 0;
      let high = 0;
      for (let i = 0; i < 6; i++) {
        if (muffle && i === 1) synth.setTrackPorts(0, 1);
        synth.render(left, right);
        if (i < 2) continue;
        for (let j = 1; j < left.length; j++) {
          all += left[j]! * left[j]!;
          high += (left[j]! - left[j - 1]!) ** 2;
        }
      }
      return high / all;
    };
    expect(treble(true) / treble(false)).toBeLessThan(0.3);
  });
});
