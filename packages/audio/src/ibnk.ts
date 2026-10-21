// IBNK instrument banks. Header: "IBNK", u32 size, u32 bank id (what a sequence selects), u32 version. FSA uses both
// versions: the music bank (id 0) is version 0, the sound-effect banks (128–131) are version 1. Offsets are
// relative to "IBNK".
// Version 0: "BANK" at 0x20, then u32[240] program offsets: 0–127 melodic "INST", 228–239 drum sets "PER2"/"PERC".
//   INST: 0x08 f32 volume, 0x0C f32 pitch, 0x10 u32[2] oscillators, 0x18 u32[2] random + u32[2] sense effects,
//     0x28 u32 key region count, 0x2C u32[] key regions: u8 high key, pad, u32 n, u32[n] velocity regions:
//     u8 high velocity, pad, u32 wave (WSYS id << 16 | wave id), f32 volume, f32 pitch.
//   Oscillator: u8 target (0 volume, 1 pitch, 2 pan, 3 fx, 4 dolby), f32 rate, u32 attack table, u32 release
//     table, f32 scale (width), f32 vertex (base). Tables are s16 (mode, time, value) points; modes 0–3 are curves
//     (linear, square, square root, "sample cell"), 13 loops to point `value`, 14 holds, 15 stops.
//   PER2: 0x88 u32[128] per-key entries (f32 volume, f32 pitch, u32[2] random effects, 0x10 u32 n, 0x14 u32[n]
//     velocity regions), 0x288 s8[128] pan, 0x308 u16[128] release.
// Version 1: chunks from 0x20 ("ENVT" raw envelope tables, "OSCT", "RAND", "SENS", "INST", "PMAP", "PERC",
//   "LIST"), each u32 tag + u32 size, 4-aligned. OSCT: u32 n, n × "Osci" records (u8 target, f32 rate,
//   u32 attack/release offsets into the ENVT data, f32 scale, f32 vertex). LIST: u32 n, u32[n] program offsets to
//   "Inst" (u32 n + oscillator indices, u32 n + effect indices, u32 key region count, key regions: u32 high key << 24,
//   u32 n, n × {u32 high velocity << 24, u32 wave, f32 volume, f32 pitch}; then f32 volume, f32 pitch) or "Perc"
//   (u32 n, u32[n] → "Pmap": f32 volume, f32 pitch, u8 pan, u16 release, u32 n + effects, u32 n + velocity regions).
// JAudio2 only plays the first velocity region of each key region; the rest are parsed for completeness.
import { ascii, dataView } from "@fso/formats";

export interface EnvelopePoint {
  mode: number;
  time: number;
  value: number;
}

export const EnvelopeMode = { Linear: 0, Square: 1, SquareRoot: 2, SampleCell: 3, Loop: 13, Hold: 14, Stop: 15 } as const;
export const OscTarget = { Volume: 0, Pitch: 1, Pan: 2, Fxmix: 3, Dolby: 4 } as const;

export interface Oscillator {
  target: number;
  rate: number;
  attack: EnvelopePoint[] | null;
  release: EnvelopePoint[] | null;
  scale: number;
  vertex: number;
}

export interface VelocityRegion {
  highVelocity: number;
  wsys: number;
  wave: number;
  volume: number;
  pitch: number;
}

export interface KeyRegion {
  highKey: number;
  velocities: VelocityRegion[];
}

export interface Instrument {
  type: "inst";
  volume: number;
  pitch: number;
  oscillators: Oscillator[];
  keys: KeyRegion[];
}

export interface Percussion {
  volume: number;
  pitch: number;
  /** 0 = left, 0.5 = centre, 1 = right. */
  pan: number;
  /** Release time (oscillator ticks, 600 per second) when the note is let go. */
  release: number;
  velocities: VelocityRegion[];
}

export interface DrumSet {
  type: "drums";
  /** Indexed by key. */
  keys: (Percussion | undefined)[];
}

export type Program = Instrument | DrumSet;

export interface Bank {
  id: number;
  version: number;
  programs: Map<number, Program>;
}

export function parseIbnk(bytes: Uint8Array): Bank {
  if (ascii(bytes, 0, 4) !== "IBNK") throw new Error("not an IBNK bank");
  const v = dataView(bytes);
  const version = v.getUint32(0x0c);
  const bank: Bank = { id: v.getUint32(8), version, programs: new Map() };
  if (version === 0) parseVersion0(bytes, v, bank);
  else if (version === 1) parseVersion1(bytes, v, bank);
  else throw new Error(`unknown IBNK version ${version}`);
  return bank;
}

function readEnvelope(v: DataView, offset: number): EnvelopePoint[] {
  const points: EnvelopePoint[] = [];
  for (let p = offset; p + 6 <= v.byteLength; p += 6) {
    const point = { mode: v.getInt16(p), time: v.getInt16(p + 2), value: v.getInt16(p + 4) };
    points.push(point);
    if (point.mode > 10) break;
  }
  return points;
}

function velocityRegion(v: DataView, o: number): VelocityRegion {
  const wave = v.getUint32(o + 4);
  return { highVelocity: v.getUint8(o), wsys: wave >>> 16, wave: wave & 0xffff, volume: v.getFloat32(o + 8), pitch: v.getFloat32(o + 12) };
}

function parseVersion0(bytes: Uint8Array, v: DataView, bank: Bank): void {
  if (ascii(bytes, 0x20, 4) !== "BANK") throw new Error("IBNK v0 without BANK");
  const osc = (o: number): Oscillator => {
    const attack = v.getUint32(o + 8);
    const release = v.getUint32(o + 12);
    return {
      target: v.getUint8(o),
      rate: v.getFloat32(o + 4),
      attack: attack ? readEnvelope(v, attack) : null,
      release: release ? readEnvelope(v, release) : null,
      scale: v.getFloat32(o + 16),
      vertex: v.getFloat32(o + 20),
    };
  };
  const velocities = (count: number, table: number) =>
    Array.from({ length: count }, (_, i) => velocityRegion(v, v.getUint32(table + i * 4)));
  for (let program = 0; program < 240; program++) {
    const o = v.getUint32(0x24 + program * 4);
    if (!o) continue;
    const tag = ascii(bytes, o, 4);
    if (tag === "INST") {
      const oscillators = [0, 1].map((i) => v.getUint32(o + 0x10 + i * 4)).filter((x) => x).map(osc);
      const keys: KeyRegion[] = [];
      for (let k = 0; k < v.getUint32(o + 0x28); k++) {
        const r = v.getUint32(o + 0x2c + k * 4);
        keys.push({ highKey: v.getUint8(r), velocities: velocities(v.getUint32(r + 4), r + 8) });
      }
      bank.programs.set(program, { type: "inst", volume: v.getFloat32(o + 8), pitch: v.getFloat32(o + 12), oscillators, keys });
    } else if (tag === "PER2" || tag === "PERC") {
      const keys: (Percussion | undefined)[] = [];
      for (let key = 0; key < 128; key++) {
        const p = v.getUint32(o + 0x88 + key * 4);
        if (!p) continue;
        keys[key] = {
          volume: v.getFloat32(p),
          pitch: v.getFloat32(p + 4),
          pan: tag === "PER2" ? v.getInt8(o + 0x288 + key) / 127 : 0.5,
          release: tag === "PER2" ? v.getUint16(o + 0x308 + key * 2) : 1000,
          velocities: velocities(v.getUint32(p + 0x10), p + 0x14),
        };
      }
      bank.programs.set(program, { type: "drums", keys });
    }
  }
}

function parseVersion1(bytes: Uint8Array, v: DataView, bank: Bank): void {
  const chunks = new Map<string, number>();
  const end = Math.min(v.getUint32(4), bytes.length);
  for (let c = 0x20; c + 8 <= end; ) {
    const size = v.getUint32(c + 4);
    const tag = ascii(bytes, c, 4);
    if (!tag) break;
    chunks.set(tag, c + 8);
    c = (c + 0xb + size) & ~3;
  }
  const envt = chunks.get("ENVT");
  const osct = chunks.get("OSCT");
  const list = chunks.get("LIST");
  if (envt === undefined || osct === undefined || list === undefined) throw new Error("IBNK v1 is missing ENVT/OSCT/LIST");
  const oscillators: Oscillator[] = [];
  for (let i = 0; i < v.getUint32(osct); i++) {
    const o = osct + 4 + i * 0x1c;
    if (ascii(bytes, o, 4) !== "Osci") throw new Error("bad OSCT record");
    oscillators.push({
      target: v.getUint8(o + 4),
      rate: v.getFloat32(o + 8),
      attack: readEnvelope(v, envt + v.getUint32(o + 0x0c)),
      release: readEnvelope(v, envt + v.getUint32(o + 0x10)),
      scale: v.getFloat32(o + 0x14),
      vertex: v.getFloat32(o + 0x18),
    });
  }
  const velocities = (p: number, count: number) => Array.from({ length: count }, (_, i) => velocityRegion(v, p + i * 16));
  for (let program = 0; program < v.getUint32(list); program++) {
    const o = v.getUint32(list + 4 + program * 4);
    if (!o) continue;
    const tag = ascii(bytes, o, 4);
    if (tag === "Inst") {
      const oscStart = o + 8;
      const oscIndices = Array.from({ length: v.getUint32(o + 4) }, (_, i) => v.getUint32(oscStart + i * 4));
      let p = oscStart + oscIndices.length * 4;
      p += 4 + v.getUint32(p) * 4; // effects (not used by the player)
      const keyCount = v.getUint32(p);
      p += 4;
      const keys: KeyRegion[] = [];
      for (let k = 0; k < keyCount; k++) {
        const n = v.getUint32(p + 4);
        keys.push({ highKey: v.getUint8(p), velocities: velocities(p + 8, n) });
        p += 8 + n * 16;
      }
      bank.programs.set(program, {
        type: "inst",
        volume: v.getFloat32(p),
        pitch: v.getFloat32(p + 4),
        oscillators: oscIndices.map((i) => oscillators[i]!).filter((x) => x),
        keys,
      });
    } else if (tag === "Perc") {
      const keys: (Percussion | undefined)[] = [];
      for (let key = 0; key < v.getUint32(o + 4); key++) {
        const p = v.getUint32(o + 8 + key * 4);
        if (!p || ascii(bytes, p, 4) !== "Pmap") continue;
        const effects = v.getUint32(p + 0x10);
        const q = p + 0x14 + effects * 4;
        keys[key] = {
          volume: v.getFloat32(p + 4),
          pitch: v.getFloat32(p + 8),
          pan: v.getUint8(p + 0x0c) / 127,
          release: v.getUint16(p + 0x0e),
          velocities: velocities(q + 4, v.getUint32(q)),
        };
      }
      bank.programs.set(program, { type: "drums", keys });
    }
  }
}
