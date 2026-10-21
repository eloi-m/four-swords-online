// SynthMixer on the real disc's sound effects (skipped when extracted/ is absent): effects overlap instead of cutting
// each other, the pool recycles its oldest synth, and tagged effects can be stopped.
import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { loadAudioInit, soundEffects, type AudioInit } from "./jaudio.ts";
import { SynthMixer } from "./mixer.ts";
import { buildSynthBanks } from "./player.ts";
import type { SynthBank } from "./synth.ts";

const audio = new URL("../../../extracted/files/GC4Sword_usa/AudioRes/", import.meta.url);
const present = existsSync(audio);
const RATE = 32000;

describe.skipIf(!present)("real disc: SynthMixer", () => {
  let init: AudioInit;
  let banks: Map<number, SynthBank>;
  const start = (name: string) => soundEffects(init).find((e) => e.name === name)!.start!;
  const rms = (mixer: SynthMixer, seconds: number) => {
    const l = new Float32Array(256), r = new Float32Array(256);
    let sum = 0, n = 0;
    for (let i = 0; i < (seconds * RATE) / 256; i++) {
      mixer.render(l, r);
      for (let k = 0; k < 256; k++) sum += l[k]! * l[k]! + r[k]! * r[k]!;
      n += 512;
    }
    return Math.sqrt(sum / n);
  };

  beforeAll(async () => {
    init = loadAudioInit(new Uint8Array(readFileSync(new URL("JaiInit.baa", audio))));
    banks = await buildSynthBanks(init, [128, 129, 130, 131], (name) => new Uint8Array(readFileSync(new URL(`Waves/${name}`, audio))));
  });

  it("plays overlapping sound effects on separate synths", () => {
    const mixer = new SynthMixer({ sampleRate: RATE, banks, collection: init.seqCollection!, voices: 2 });
    expect(mixer.playSe(start("JA_SE_LK_SWORD_WIELD"), 0.34)).toBe(0);
    expect(rms(mixer, 0.02)).toBeGreaterThan(0);
    expect(mixer.playSe(start("JA_SE_LK_SHIELD"), 0.34)).toBe(1);
    rms(mixer, 0.05);
    const stats = mixer.stats;
    expect(stats.se.started).toBe(2);
    expect(stats.se.busy).toBe(2);
    expect(stats.se.notes).toBeGreaterThanOrEqual(2);
    expect(stats.se.missing).toBe(0);
    // A third effect with both synths busy takes the one that started first.
    expect(mixer.playSe(start("JA_SE_V_DAMAGE"), 0.34)).toBe(0);
    expect(rms(mixer, 2)).toBeGreaterThan(0);
    expect(mixer.stats.se.busy).toBe(0);
    expect(mixer.stats.se.notes).toBeGreaterThanOrEqual(3);
  });

  it("stops tagged effects and mutes with gain 0", () => {
    const mixer = new SynthMixer({ sampleRate: RATE, banks, collection: init.seqCollection! });
    mixer.playSe(start("JA_SE_LK_CHARGING"), 0.34, "charge:0");
    mixer.gain = 0;
    expect(rms(mixer, 0.1)).toBe(0);
    mixer.gain = 1;
    mixer.stopSe("charge:0");
    expect(mixer.stats.se.busy).toBe(0);
    expect(rms(mixer, 0.1)).toBe(0);
  });
});
