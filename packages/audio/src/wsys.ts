// WSYS wave systems: which .aw wave archive holds each wave, and how to play it. Offsets are relative to "WSYS".
//   0x00 "WSYS", u32 size, u32 id (the high half of an instrument's wave reference), u32 wave table size,
//   0x10 u32 WINF offset, 0x14 u32 WBCT offset.
//   WINF: u32 count, u32[count] → wave groups: char[0x70] .aw file name, u32 n, u32[n] → wave records (0x2C bytes):
//     u8 ?, u8 format (adpcm.ts), u8 base key, pad, f32 sample rate, u32 offset in .aw, u32 byte size,
//     u32 loop flag (0 or -1), u32 loop start, u32 loop end (samples), u32 sample count,
//     s16 last, s16 penult (ADPCM history at the loop start, used when jumping back), runtime fields.
//   WBCT: u32 ?, u32 count, u32[count] → "SCNE" scene per group: 0x0C → "C-DF": u32 n, u32[n] → u32 whose low half
//     is the wave id of the group's n-th record ("C-EX"/"C-ST" at 0x10/0x14 are empty in FSA).
import { ascii, dataView } from "@fso/formats";

export interface WaveInfo {
  id: number;
  archive: string;
  format: number;
  baseKey: number;
  sampleRate: number;
  offset: number;
  size: number;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  sampleCount: number;
  loopLast: number;
  loopPenult: number;
}

export interface WaveSystem {
  id: number;
  archives: string[];
  waves: WaveInfo[];
  byId: Map<number, WaveInfo>;
}

export function parseWsys(bytes: Uint8Array): WaveSystem {
  if (ascii(bytes, 0, 4) !== "WSYS") throw new Error("not a WSYS wave system");
  const v = dataView(bytes);
  const winf = v.getUint32(0x10);
  const wbct = v.getUint32(0x14);
  if (ascii(bytes, winf, 4) !== "WINF" || ascii(bytes, wbct, 4) !== "WBCT") throw new Error("bad WSYS tables");
  const groups = v.getUint32(winf + 4);
  if (v.getUint32(wbct + 8) !== groups) throw new Error("WSYS: WINF and WBCT group counts differ");
  const archives: string[] = [];
  const waves: WaveInfo[] = [];
  for (let g = 0; g < groups; g++) {
    const group = v.getUint32(winf + 8 + g * 4);
    const archive = ascii(bytes, group, 0x70);
    archives.push(archive);
    const count = v.getUint32(group + 0x70);
    const scene = v.getUint32(wbct + 12 + g * 4);
    const cdf = v.getUint32(scene + 0x0c);
    if (ascii(bytes, scene, 4) !== "SCNE" || ascii(bytes, cdf, 4) !== "C-DF") throw new Error("bad WSYS scene");
    if (v.getUint32(cdf + 4) !== count) throw new Error("WSYS: C-DF count differs from the wave group");
    for (let i = 0; i < count; i++) {
      const w = v.getUint32(group + 0x74 + i * 4);
      waves.push({
        id: v.getUint32(v.getUint32(cdf + 8 + i * 4)) & 0xffff,
        archive,
        format: v.getUint8(w + 1),
        baseKey: v.getUint8(w + 2),
        sampleRate: v.getFloat32(w + 4),
        offset: v.getUint32(w + 8),
        size: v.getUint32(w + 0x0c),
        loop: v.getUint32(w + 0x10) !== 0,
        loopStart: v.getUint32(w + 0x14),
        loopEnd: v.getUint32(w + 0x18),
        sampleCount: v.getUint32(w + 0x1c),
        loopLast: v.getInt16(w + 0x20),
        loopPenult: v.getInt16(w + 0x22),
      });
    }
  }
  return { id: v.getUint32(8), archives, waves, byId: new Map(waves.map((w) => [w.id, w])) };
}
