import { describe, expect, it } from "vitest";
import { decompressYaz0, isYaz0 } from "./yaz0.ts";

function yaz0(size: number, body: number[]): Uint8Array {
  const header = [0x59, 0x61, 0x7a, 0x30, size >>> 24, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff];
  return Uint8Array.from([...header, 0, 0, 0, 0, 0, 0, 0, 0, ...body]);
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("yaz0", () => {
  it("decodes literals and a short back-reference", () => {
    // 3 literals, then copy 6 bytes from distance 3.
    const input = yaz0(9, [0b1110_0000, 0x61, 0x62, 0x63, 0x40, 0x02]);
    expect(isYaz0(input)).toBe(true);
    expect(text(decompressYaz0(input))).toBe("abcabcabc");
  });

  it("decodes a long back-reference (3-byte form)", () => {
    // 1 literal, then copy 0x12 + 1 = 19 bytes from distance 1.
    const input = yaz0(20, [0b1000_0000, 0x61, 0x00, 0x00, 0x01]);
    expect(text(decompressYaz0(input))).toBe("a".repeat(20));
  });

  it("rejects non-Yaz0 input", () => {
    expect(() => decompressYaz0(new Uint8Array(16))).toThrow();
  });
});
