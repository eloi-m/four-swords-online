// JAudio sample formats, as numbered by the WSYS wave records. All are mono, big-endian, 16 samples per frame.
// ADPCM ("AFC", decoded by the DSP): each frame starts with a header byte whose high nibble is a scale exponent
// and low nibble an index into a fixed table of 16 predictor pairs; then 16 signed 4-bit (9-byte frames) or
// 2-bit (5-byte frames) residuals, most significant first. sample = (r·2^(scale+11|13) + c1·s[-1] + c2·s[-2]) >> 11.
// The predictor table is the standard one (the game ships it as JASystem::DSPInterface::DSPADPCM_FILTER).

export const WaveFormat = { Adpcm4: 0, Adpcm2: 1, Pcm8: 2, Pcm16: 3 } as const;
export type WaveFormat = (typeof WaveFormat)[keyof typeof WaveFormat];

/** Bytes per 16-sample frame, indexed by format. */
export const FRAME_BYTES: readonly number[] = [9, 5, 16, 32];
export const FRAME_SAMPLES = 16;

const COEFS = new Int16Array([
  0, 0, 2048, 0, 0, 2048, 1024, 1024, 4096, -2048, 3584, -1536, 3072, -1024, 4608, -2560,
  4200, -2248, 4800, -2300, 5120, -3072, 2048, -2048, 1024, -1024, -1024, 1024, -1024, 0, -2048, 0,
]);

/** Decoder history: the two previous output samples. */
export interface AdpcmHistory {
  last: number;
  penult: number;
}

export function frameBytes(format: number): number {
  const n = FRAME_BYTES[format];
  if (n === undefined) throw new Error(`unknown wave format ${format}`);
  return n;
}

/** Samples held by `bytes` bytes of data in this format (whole frames only). */
export function samplesInBytes(format: number, bytes: number): number {
  return Math.floor(bytes / frameBytes(format)) * FRAME_SAMPLES;
}

const clamp16 = (v: number) => (v > 32767 ? 32767 : v < -32768 ? -32768 : v);

/**
 * Decodes `count` samples starting at `src[offset]` into `out[outOffset..]`. ADPCM formats keep their predictor
 * state in `history` (updated in place) so a stream can be decoded block by block.
 */
export function decodeSamples(
  src: Uint8Array,
  offset: number,
  format: number,
  count: number,
  out: Int16Array,
  outOffset = 0,
  history: AdpcmHistory = { last: 0, penult: 0 },
): void {
  const frame = frameBytes(format);
  let p = offset;
  let o = outOffset;
  const end = outOffset + count;
  if (format === WaveFormat.Pcm16) {
    for (; o < end && p + 1 < src.length; p += 2) out[o++] = ((src[p]! << 24) >> 16) | src[p + 1]!;
  } else if (format === WaveFormat.Pcm8) {
    for (; o < end && p < src.length; p++) out[o++] = ((src[p]! << 24) >> 24) * 256;
  } else {
    const bits = format === WaveFormat.Adpcm4 ? 4 : 2;
    const perByte = 8 / bits;
    const signShift = 32 - bits;
    let { last, penult } = history;
    while (o < end && p + frame <= src.length) {
      const header = src[p]!;
      const step = (bits === 4 ? 2048 : 8192) << (header >> 4);
      const c1 = COEFS[(header & 15) * 2]!;
      const c2 = COEFS[(header & 15) * 2 + 1]!;
      for (let i = 1; i < frame && o < end; i++) {
        const byte = src[p + i]!;
        for (let j = perByte - 1; j >= 0 && o < end; j--) {
          const r = ((byte >> (j * bits)) << signShift) >> signShift;
          const s = clamp16((r * step + c1 * last + c2 * penult) >> 11);
          penult = last;
          last = s;
          out[o++] = s;
        }
      }
      p += frame;
    }
    history.last = last;
    history.penult = penult;
  }
  out.fill(0, o, end);
}

/** Decodes a whole mono wave (e.g. one .aw entry) to 16-bit PCM. */
export function decodeWave(src: Uint8Array, format: number, sampleCount = samplesInBytes(format, src.length)): Int16Array {
  const out = new Int16Array(sampleCount);
  decodeSamples(src, 0, format, sampleCount, out);
  return out;
}

export function pcmToFloat(pcm: Int16Array, gain = 1): Float32Array {
  const out = new Float32Array(pcm.length);
  const k = gain / 32768;
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i]! * k;
  return out;
}
