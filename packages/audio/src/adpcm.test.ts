import { describe, expect, it } from "vitest";
import { decodeSamples, decodeWave, samplesInBytes, WaveFormat } from "./adpcm.ts";
import { decodeAst, parseAstHeader } from "./ast.ts";
import { Bytes } from "./test-helpers.ts";
import { encodeWav } from "./wav.ts";

describe("ADPCM", () => {
  it("decodes 4-bit residuals high nibble first, sign-extended, scaled by the header exponent", () => {
    const frame = [0x00, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef];
    expect([...decodeWave(Uint8Array.from(frame), WaveFormat.Adpcm4)]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, -8, -7, -6, -5, -4, -3, -2, -1]);
    frame[0] = 0x10; // scale exponent 1 doubles the step
    expect([...decodeWave(Uint8Array.from(frame), WaveFormat.Adpcm4).slice(0, 4)]).toEqual([0, 2, 4, 6]);
  });

  it("applies the predictor pair and clamps to 16 bits", () => {
    // Predictor 1 = (2048, 0): each sample adds the previous one.
    const ramp = Uint8Array.from([0x01, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11]);
    expect([...decodeWave(ramp, WaveFormat.Adpcm4)]).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    const loud = Uint8Array.from([0xf0, 0x78, 0x78, 0, 0, 0, 0, 0, 0]);
    expect([...decodeWave(loud, WaveFormat.Adpcm4).slice(0, 4)]).toEqual([32767, -32768, 32767, -32768]);
  });

  it("keeps history across calls so streams decode block by block", () => {
    const frames = Uint8Array.from([0x01, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x01, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11]);
    const history = { last: 0, penult: 0 };
    const out = new Int16Array(32);
    decodeSamples(frames, 0, WaveFormat.Adpcm4, 16, out, 0, history);
    expect(history).toEqual({ last: 16, penult: 15 });
    decodeSamples(frames, 9, WaveFormat.Adpcm4, 16, out, 16, history);
    expect(out[31]).toBe(32);
  });

  it("decodes 2-bit ADPCM and raw PCM", () => {
    expect([...decodeWave(Uint8Array.from([0x00, 0x1b, 0x1b, 0x1b, 0x1b]), WaveFormat.Adpcm2).slice(0, 4)]).toEqual([0, 4, -8, -4]);
    expect([...decodeWave(Uint8Array.from([0x80, 0x00, 0x7f, 0xff, 0x00, 0x01]), WaveFormat.Pcm16, 3)]).toEqual([-32768, 32767, 1]);
    expect([...decodeWave(Uint8Array.from([0x80, 0x7f]), WaveFormat.Pcm8, 2)]).toEqual([-32768, 32512]);
    expect(samplesInBytes(WaveFormat.Adpcm4, 19503)).toBe(2167 * 16);
  });
});

function ast(format: number, channels: number, samples: number, blocks: { history: number[]; data: number[][] }[]): Uint8Array {
  const blockSize = blocks[0]!.data[0]!.length;
  const b = new Bytes().text("STRM").u32(0).u8(0, format).u16(16, channels, 0xffff).u32(1000, samples, 1, samples, blockSize);
  b.pad(0x28).u8(0x7f).pad(0x40);
  for (const block of blocks) {
    const start = b.length;
    b.text("BLCK").u32(block.data[0]!.length);
    for (const h of block.history) b.u16(h & 0xffff);
    b.pad(start + 0x20);
    for (const ch of block.data) b.u8(...ch);
  }
  return b.bytes();
}

describe("AST streams", () => {
  it("parses the header and decodes interleaved PCM16 blocks", () => {
    const bytes = ast(1, 2, 4, [{ history: [], data: [[0, 1, 0, 2, 0, 3, 0, 4], [0xff, 0xff, 0, 0, 0, 0, 0, 0]] }]);
    expect(parseAstHeader(bytes)).toMatchObject({ format: 1, channels: 2, sampleRate: 1000, loop: true, loopStart: 1, volume: 1 });
    const s = decodeAst(bytes);
    expect([...s.data[0]!]).toEqual([1, 2, 3, 4]);
    expect([...s.data[1]!]).toEqual([-1, 0, 0, 0]);
  });

  it("checks each block's stored end-of-block ADPCM history", () => {
    const frame = [0x01, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11];
    const good = decodeAst(ast(0, 1, 32, [{ history: [16, 15], data: [frame] }, { history: [32, 31], data: [frame] }]));
    expect(good.historyMismatches).toBe(0);
    expect(good.data[0]![31]).toBe(32);
    expect(decodeAst(ast(0, 1, 16, [{ history: [0, 0], data: [frame] }])).historyMismatches).toBe(1);
  });
});

describe("WAV", () => {
  it("writes a 16-bit PCM RIFF header and interleaves channels", () => {
    const wav = encodeWav([Int16Array.from([1, 2]), Float32Array.from([1, -1])], 32000);
    const v = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
    expect([v.getUint16(22, true), v.getUint32(24, true), v.getUint32(40, true)]).toEqual([2, 32000, 8]);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)]).toEqual([1, 32767, 2, -32767]);
  });
});
