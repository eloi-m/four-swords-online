// Dolphin savestate reader (format per Dolphin's Source/Core/Core/State.{h,cpp}): a 24-byte legacy header, a version
// cookie and string, a 16-byte extended header, then the DoState payload as LZ4 blocks, each prefixed by an s32
// compressed length. Only states with the extended header (Dolphin 5.0-19xxx and later) are supported.

export interface Savestate {
  gameId: string;
  version: string;
  payload: Uint8Array; // uncompressed DoState stream
}

export function readSavestate(file: Uint8Array): Savestate {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const gameId = String.fromCharCode(...file.subarray(0, 6));
  if (view.getUint32(8, true) !== 0) throw new Error("legacy LZO savestates are not supported");
  const versionLength = view.getUint32(0x1c, true);
  const version = new TextDecoder().decode(file.subarray(0x20, 0x20 + versionLength));
  let o = 0x20 + versionLength;
  const compression = view.getUint16(o + 2, true);
  const size = Number(view.getBigUint64(o + 8, true));
  o += 16;
  if (compression === 0) return { gameId, version, payload: file.subarray(o, o + size) };
  if (compression !== 1) throw new Error(`unknown savestate compression ${compression}`);
  const payload = new Uint8Array(size);
  let written = 0;
  while (written < size) {
    const length = view.getInt32(o, true);
    o += 4;
    written += lz4Block(file.subarray(o, o + length), payload, written);
    o += length;
  }
  return { gameId, version, payload };
}

/** Decodes one raw LZ4 block into `out` at `start`; returns the number of bytes written. */
export function lz4Block(src: Uint8Array, out: Uint8Array, start: number): number {
  let s = 0;
  let d = start;
  while (s < src.length) {
    const token = src[s++]!;
    let literals = token >> 4;
    if (literals === 15) for (let b = 255; b === 255; literals += b) b = src[s++]!;
    out.set(src.subarray(s, s + literals), d);
    s += literals;
    d += literals;
    if (s >= src.length) break; // the last sequence has literals only
    const offset = src[s]! | (src[s + 1]! << 8);
    s += 2;
    let match = (token & 15) + 4;
    if ((token & 15) === 15) for (let b = 255; b === 255; match += b) b = src[s++]!;
    let from = d - offset;
    for (let i = 0; i < match; i++) out[d++] = out[from++]!;
  }
  return d - start;
}

export const MEM1_BASE = 0x80000000;
export const MEM1_SIZE = 0x01800000; // 24 MiB

/** Finds MEM1 in the payload by locating a known run of bytes that the game keeps at a known address. */
export function findMem1(payload: Uint8Array, signature: Uint8Array, signatureAddress: number): Uint8Array {
  const at = indexOf(payload, signature);
  if (at < 0) throw new Error("MEM1 signature not found in savestate");
  const start = at - (signatureAddress - MEM1_BASE);
  if (start < 0 || start + MEM1_SIZE > payload.length) throw new Error("MEM1 signature at an impossible offset");
  return payload.subarray(start, start + MEM1_SIZE);
}

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  const first = needle[0]!;
  outer: for (let i = haystack.indexOf(first); i >= 0 && i <= haystack.length - needle.length; i = haystack.indexOf(first, i + 1)) {
    for (let j = 1; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
