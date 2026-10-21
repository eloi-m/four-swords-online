// Glue between the parsed init data and the synth: decodes the waves each bank needs from their .aw archives.
import { decodeWaveFromArchive, type AudioInit } from "./jaudio.ts";
import type { SampleData, SynthBank } from "./synth.ts";

/**
 * Builds synth banks for the given bank ids. `readArchive` returns the bytes of a .aw file by name (from
 * AudioRes/Waves/); only waves referenced by an instrument or drum are decoded.
 */
export async function buildSynthBanks(
  init: AudioInit,
  bankIds: number[],
  readArchive: (name: string) => Promise<Uint8Array> | Uint8Array,
): Promise<Map<number, SynthBank>> {
  const out = new Map<number, SynthBank>();
  const archives = new Map<string, Uint8Array>();
  for (const id of bankIds) {
    const entry = init.banks.get(id);
    if (!entry) continue;
    const used = new Set<number>();
    for (const program of entry.bank.programs.values()) {
      const regions = program.type === "inst" ? program.keys.flatMap((k) => k.velocities) : program.keys.flatMap((p) => p?.velocities ?? []);
      for (const r of regions) used.add(r.wave);
    }
    const waves = new Map<number, SampleData>();
    for (const wave of entry.wsys.waves) {
      if (!used.has(wave.id)) continue;
      let aw = archives.get(wave.archive);
      if (!aw) {
        aw = await readArchive(wave.archive);
        archives.set(wave.archive, aw);
      }
      waves.set(wave.id, {
        pcm: decodeWaveFromArchive(wave, aw),
        sampleRate: wave.sampleRate,
        baseKey: wave.baseKey,
        loop: wave.loop,
        loopStart: wave.loopStart,
        loopEnd: wave.loopEnd,
      });
    }
    out.set(id, { bank: entry.bank, waves });
  }
  return out;
}
