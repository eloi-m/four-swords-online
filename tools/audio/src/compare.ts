// Compares an offline render with a Dolphin DSP audio dump (Dolphin.DSP.DumpAudio=True writes
// Dump/Audio/<id>_<date>_dspdump.wav, 16-bit stereo at 32028 Hz; the header sizes stay unset if Dolphin is killed).
// Both are reduced to chroma (12 pitch classes per 64 ms frame); the dump is slid along the render to find the
// best-matching offset, then the match is re-scored with the chroma rotated ±2 semitones (pitch check) and per
// quarter of the dump (tempo drift check).
//   node tools/audio/src/compare.ts <render.wav> <dspdump.wav>
import { readFileSync } from "node:fs";

interface Pcm {
  rate: number;
  mono: Float32Array;
}

function readWav(path: string): Pcm {
  const b = readFileSync(path);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 12;
  let rate = 0;
  let channels = 1;
  while (p + 8 <= b.length) {
    const id = b.toString("latin1", p, p + 4);
    const size = v.getUint32(p + 4, true);
    if (id === "fmt ") {
      channels = v.getUint16(p + 10, true);
      rate = v.getUint32(p + 12, true);
    } else if (id === "data") {
      const end = Math.min(b.length, size > 0 && p + 8 + size <= b.length ? p + 8 + size : b.length);
      const frames = Math.floor((end - p - 8) / (2 * channels));
      const mono = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let s = 0;
        for (let c = 0; c < channels; c++) s += v.getInt16(p + 8 + (i * channels + c) * 2, true);
        mono[i] = s / channels / 32768;
      }
      return { rate, mono };
    }
    p += 8 + size + (size & 1);
  }
  throw new Error(`${path}: no data chunk`);
}

const N = 4096;
const HOP_SECONDS = 0.064;

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(a * k);
        const wi = Math.sin(a * k);
        const xr = re[i + k + len / 2]! * wr - im[i + k + len / 2]! * wi;
        const xi = re[i + k + len / 2]! * wi + im[i + k + len / 2]! * wr;
        re[i + k + len / 2] = re[i + k]! - xr;
        im[i + k + len / 2] = im[i + k]! - xi;
        re[i + k] = re[i + k]! + xr;
        im[i + k] = im[i + k]! + xi;
      }
    }
  }
}

function chroma(pcm: Pcm): Float32Array[] {
  const hop = Math.round(pcm.rate * HOP_SECONDS);
  const frames: Float32Array[] = [];
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let start = 0; start + N <= pcm.mono.length; start += hop) {
    for (let i = 0; i < N; i++) {
      re[i] = pcm.mono[start + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
      im[i] = 0;
    }
    fft(re, im);
    const c = new Float32Array(12);
    for (let k = 1; k < N / 2; k++) {
      const f = (k * pcm.rate) / N;
      if (f < 100 || f > 4000) continue;
      const pc = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12 + 9) % 12;
      c[pc]! += Math.sqrt(re[k]! * re[k]! + im[k]! * im[k]!);
    }
    let norm = 0;
    for (let i = 0; i < 12; i++) norm += c[i]! * c[i]!;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < 12; i++) c[i]! /= norm;
    frames.push(c);
  }
  return frames;
}

function similarity(a: Float32Array[], b: Float32Array[], lag: number, from = 0, to = b.length, rotate = 0): number {
  let sum = 0;
  let n = 0;
  for (let i = from; i < to && lag + i < a.length; i++) {
    const x = a[lag + i]!;
    const y = b[i]!;
    let d = 0;
    for (let k = 0; k < 12; k++) d += x[(k + rotate + 12) % 12]! * y[k]!;
    sum += d;
    n++;
  }
  return n ? sum / n : 0;
}

const [renderPath, dumpPath] = process.argv.slice(2);
if (!renderPath || !dumpPath) {
  console.error("usage: compare <render.wav> <dspdump.wav>");
  process.exit(1);
}
const render = chroma(readWav(renderPath));
const dumpPcm = readWav(dumpPath);
// Skip the first second of the dump (savestate load).
const skip = Math.round(1 / HOP_SECONDS);
const dump = chroma(dumpPcm).slice(skip);
if (dump.length > render.length) {
  console.error(`the render (${(render.length * HOP_SECONDS).toFixed(1)} s) must be longer than the dump (${(dump.length * HOP_SECONDS).toFixed(1)} s after 1 s)`);
  process.exit(1);
}
let best = { lag: 0, score: -1 };
for (let lag = 0; lag + dump.length <= render.length; lag++) {
  const score = similarity(render, dump, lag);
  if (score > best.score) best = { lag, score };
}
const baseline = [...Array(20).keys()].map((i) => similarity(render, dump, Math.floor((i * (render.length - dump.length)) / 20))).sort((a, b) => a - b)[10]!;
console.log(`dump: ${(dumpPcm.mono.length / dumpPcm.rate).toFixed(1)} s at ${dumpPcm.rate} Hz; render: ${(render.length * HOP_SECONDS).toFixed(1)} s`);
console.log(`best offset in render: ${(best.lag * HOP_SECONDS).toFixed(2)} s, chroma similarity ${best.score.toFixed(3)} (median over offsets ${baseline.toFixed(3)})`);
console.log(`transposed: ${[-2, -1, 0, 1, 2].map((r) => `${r > 0 ? "+" : ""}${r}: ${similarity(render, dump, best.lag, 0, dump.length, r).toFixed(3)}`).join("  ")}`);
const q = Math.floor(dump.length / 4);
console.log(`per quarter at that offset: ${[0, 1, 2, 3].map((i) => similarity(render, dump, best.lag, i * q, (i + 1) * q).toFixed(3)).join("  ")}`);

// Loudness and spectral balance over the aligned span, per octave band (dump relative to render, in dB).
const renderPcm = readWav(renderPath);
const bands = [62.5, 125, 250, 500, 1000, 2000, 4000, 8000];
function bandEnergy(pcm: Pcm, startSeconds: number, seconds: number): { rms: number; bands: number[] } {
  const start = Math.round(startSeconds * pcm.rate);
  const end = Math.min(pcm.mono.length, start + Math.round(seconds * pcm.rate));
  let sq = 0;
  for (let i = start; i < end; i++) sq += pcm.mono[i]! ** 2;
  const out = new Array(bands.length).fill(0);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let s = start; s + N <= end; s += N) {
    for (let i = 0; i < N; i++) {
      re[i] = pcm.mono[s + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const f = (k * pcm.rate) / N;
      const b = bands.findIndex((lo) => f >= lo && f < lo * 2);
      if (b >= 0) out[b] += re[k]! ** 2 + im[k]! ** 2;
    }
  }
  return { rms: Math.sqrt(sq / Math.max(1, end - start)), bands: out };
}
const span = dump.length * HOP_SECONDS;
const ours = bandEnergy(renderPcm, best.lag * HOP_SECONDS, span);
const theirs = bandEnergy(dumpPcm, skip * HOP_SECONDS, span);
const db = (x: number) => (10 * Math.log10(x)).toFixed(1);
console.log(`RMS: dump ${theirs.rms.toFixed(4)}, render ${ours.rms.toFixed(4)} (dump/render ${db((theirs.rms / ours.rms) ** 2)} dB)`);
const total = (x: number[]) => x.reduce((a, b) => a + b, 0);
console.log(
  `band balance, dump vs render (dB, level-matched): ${bands.map((lo, i) => `${lo}Hz ${db((theirs.bands[i]! / total(theirs.bands)) / (ours.bands[i]! / total(ours.bands)))}`).join("  ")}`,
);
