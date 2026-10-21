// AST streams ("STRM"), played by JAudio's ARAM streamer. 0x40-byte big-endian header:
//   0x04 u32 data size (all blocks), 0x09 u8 format (0 = AFC ADPCM4, 1 = PCM16), 0x0A u16 bits (16),
//   0x0C u16 channels, 0x0E u16 loop flag, 0x10 u32 sample rate, 0x14 u32 sample count,
//   0x18 u32 loop start, 0x1C u32 loop end, 0x20 u32 block size (bytes per channel), 0x28 u8 volume (0x7F = 1.0).
// Then blocks: "BLCK", u32 bytes per channel, 6 × (s16 last, s16 penult) ADPCM decoder history at the END of the
// block (checked: our decoder reproduces every stored pair of smw.ast), padding to 0x20, then each channel's data in
// turn. The last block is shorter. Channels decode continuously from zero history across blocks.
import { ascii, dataView } from "@fso/formats";
import { type AdpcmHistory, decodeSamples, FRAME_SAMPLES, frameBytes, WaveFormat } from "./adpcm.ts";

export interface AstHeader {
  format: number;
  channels: number;
  sampleRate: number;
  sampleCount: number;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  blockSize: number;
  volume: number;
}

export interface AstStream extends AstHeader {
  data: Int16Array[];
  blocks: number;
  /** Channel blocks whose stored end-of-block ADPCM history disagrees with our decoder (0 = bit-exact decode). */
  historyMismatches: number;
}

export function isAst(bytes: Uint8Array): boolean {
  return bytes.length >= 0x40 && ascii(bytes, 0, 4) === "STRM";
}

export function parseAstHeader(bytes: Uint8Array): AstHeader {
  if (!isAst(bytes)) throw new Error("not an AST stream");
  const v = dataView(bytes);
  return {
    format: v.getUint8(0x09),
    channels: v.getUint16(0x0c),
    sampleRate: v.getUint32(0x10),
    sampleCount: v.getUint32(0x14),
    loop: v.getUint16(0x0e) !== 0,
    loopStart: v.getUint32(0x18),
    loopEnd: v.getUint32(0x1c),
    blockSize: v.getUint32(0x20),
    volume: v.getUint8(0x28) / 127,
  };
}

export function decodeAst(bytes: Uint8Array): AstStream {
  const header = parseAstHeader(bytes);
  if (header.format > 1) throw new Error(`unknown AST format ${header.format}`);
  const format = header.format === 0 ? WaveFormat.Adpcm4 : WaveFormat.Pcm16;
  const v = dataView(bytes);
  const data = Array.from({ length: header.channels }, () => new Int16Array(header.sampleCount));
  const history: AdpcmHistory[] = data.map(() => ({ last: 0, penult: 0 }));
  let offset = 0x40;
  let sample = 0;
  let blocks = 0;
  let historyMismatches = 0;
  while (sample < header.sampleCount && offset + 0x20 <= bytes.length) {
    if (ascii(bytes, offset, 4) !== "BLCK") throw new Error(`missing BLCK at 0x${offset.toString(16)}`);
    const size = v.getUint32(offset + 4);
    const perBlock = format === WaveFormat.Pcm16 ? Math.floor(size / 2) : Math.floor(size / frameBytes(format)) * FRAME_SAMPLES;
    const count = Math.min(perBlock, header.sampleCount - sample);
    for (let c = 0; c < header.channels; c++) {
      decodeSamples(bytes, offset + 0x20 + c * size, format, count, data[c]!, sample, history[c]);
      if (format === WaveFormat.Adpcm4 && c < 6) {
        const h = history[c]!;
        if (v.getInt16(offset + 8 + c * 4) !== h.last || v.getInt16(offset + 10 + c * 4) !== h.penult) historyMismatches++;
      }
    }
    offset += 0x20 + size * header.channels;
    sample += count;
    blocks++;
  }
  return { ...header, data, blocks, historyMismatches };
}
