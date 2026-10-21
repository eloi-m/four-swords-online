// Yaz0: Nintendo's LZ77 variant. Header "Yaz0", u32 decompressed size, 8 reserved bytes.
// Each code byte covers 8 chunks, MSB first: 1 = literal byte, 0 = back-reference.
import { dataView } from "./bytes.ts";

export function isYaz0(bytes: Uint8Array): boolean {
  return bytes.length >= 16 && bytes[0] === 0x59 && bytes[1] === 0x61 && bytes[2] === 0x7a && bytes[3] === 0x30;
}

export function decompressYaz0(src: Uint8Array): Uint8Array {
  if (!isYaz0(src)) throw new Error("not Yaz0 data");
  const size = dataView(src).getUint32(4);
  const dst = new Uint8Array(size);
  let s = 16;
  let d = 0;
  while (d < size) {
    const code = src[s++]!;
    for (let bit = 0x80; bit !== 0 && d < size; bit >>= 1) {
      if (code & bit) {
        dst[d++] = src[s++]!;
        continue;
      }
      const b1 = src[s++]!;
      const b2 = src[s++]!;
      let from = d - ((((b1 & 0x0f) << 8) | b2) + 1);
      let count = b1 >> 4 === 0 ? src[s++]! + 0x12 : (b1 >> 4) + 2;
      if (from < 0) throw new Error("Yaz0 back-reference before start of output");
      while (count-- > 0 && d < size) dst[d++] = dst[from++]!;
    }
  }
  return dst;
}
