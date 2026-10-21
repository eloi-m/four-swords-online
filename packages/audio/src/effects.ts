// The DSP effects JAudio2 drives in FSA: the per-channel IIR filter (the sequences' iircutoff/iirset) and the reverb
// (the FX lines fed by each channel's fxmix send). Both as FSA's DSP ucode does them, by the description of Dolphin's
// HLE of that ucode (its "Zelda" ucode family, which lists FSA), with FSA's parameters read from main.dol and RAM:
// - IIR: y[n] = c0·x[n−1] + c1·x[n−2] + c2·y[n−1] + c3·y[n−2] on a channel's resampled input, before its volumes, the
//   four coefficients in 1.15, saturated to 16 bits. (0x7FFF, 0, 0, 0) passes the input through (a sample late).
// - Reverb: FSA's four FX lines (main.dol 0x80491600, 4 × 0x20 bytes: enable, output volumes, buffer length, 8 FIR
//   taps; the same values sit in the live DSP parameter block at 0x807F5100) are all alike: a circular buffer of 64
//   DSP frames (64 × 80 samples at 32 kHz = 160 ms), read back through an 8-tap FIR whose only tap (index 6 = 2
//   samples later, 0x3FFF = ½) both feeds the buffer back and goes to the output at 0x6000 (¾). Lines 0 and 1 are
//   the buffers channels send to (0x0DC0 left, 0x0E20 right, each at the channel's dry volume × fxmix); lines 2 and
//   3 take nothing from music or effects in the captures read, so they're left out.
import type { IirCoefficients } from "./sequencer.ts";

/** The DSP's output rate: filter coefficients and the reverb delay are defined at this rate. */
export const DSP_RATE = 32000;
/** Samples per DSP frame (one sequencer sub-frame, 1/400 s, at 32 kHz). */
const DSP_FRAME = 80;
/** FSA's FX line set-up (main.dol 0x80491600; all four lines alike). */
export const FX_LINE = { frames: 64, tap: 6, coefficient: 0x3fff, volume: 0x6000 } as const;
/** Tap 6 of the 8 (whose window starts 8 samples back, in the previous block) lags the block by 2 samples. */
const FX_TAP_DELAY = 8 - FX_LINE.tap;
const FX_FEEDBACK = FX_LINE.coefficient / 0x8000;
const FX_OUTPUT = FX_LINE.volume / 0x8000;

/**
 * The IIR's coefficients as floats for `sampleRate`. At the DSP rate they're the game's; at another rate the poles and
 * the zero are moved to the same frequencies (p → p^(32000 / rate), signs kept) and the DC gain kept, which keeps the
 * response below 16 kHz close. Returns null for the pass-through.
 */
export function iirForRate(c: IirCoefficients, sampleRate: number): Float64Array | null {
  if (c[0] === 0x7fff && !c[1] && !c[2] && !c[3]) return null;
  const [b1, b2, a1, a2] = c.map((x) => x / 0x8000) as [number, number, number, number];
  const disc = a1 * a1 + 4 * a2;
  if (sampleRate === DSP_RATE || disc < 0 || !b1) return Float64Array.of(b1, b2, a1, a2);
  const r = DSP_RATE / sampleRate;
  const move = (p: number) => Math.sign(p) * Math.abs(p) ** r;
  const p1 = move((a1 + Math.sqrt(disc)) / 2);
  const p2 = move((a1 - Math.sqrt(disc)) / 2);
  const zero = move(-b2 / b1);
  const n1 = p1 + p2;
  const n2 = -p1 * p2;
  const k = ((b1 + b2) / (1 - a1 - a2)) * ((1 - n1 - n2) / (1 - zero));
  return Float64Array.of(k, -k * zero, n1, n2);
}

/** FX lines 0 and 1 (left and right): a feedback delay fed by the channels' sends, added to the output. */
export class Reverb {
  private readonly left: Float32Array;
  private readonly right: Float32Array;
  private pos = 0;

  constructor(sampleRate: number) {
    const delay = Math.round(((FX_LINE.frames * DSP_FRAME + FX_TAP_DELAY) * sampleRate) / DSP_RATE);
    this.left = new Float32Array(delay);
    this.right = new Float32Array(delay);
  }

  /** Feeds the sends in and adds the returns to the output. */
  process(sendLeft: Float32Array, sendRight: Float32Array, outLeft: Float32Array, outRight: Float32Array): void {
    const { left, right } = this;
    const n = left.length;
    let pos = this.pos;
    for (let i = 0; i < outLeft.length; i++) {
      const l = left[pos]! * FX_FEEDBACK;
      const r = right[pos]! * FX_FEEDBACK;
      outLeft[i]! += l * FX_OUTPUT;
      outRight[i]! += r * FX_OUTPUT;
      left[pos] = l + sendLeft[i]!;
      right[pos] = r + sendRight[i]!;
      if (++pos === n) pos = 0;
    }
    this.pos = pos;
  }

  clear(): void {
    this.left.fill(0);
    this.right.fill(0);
  }
}
