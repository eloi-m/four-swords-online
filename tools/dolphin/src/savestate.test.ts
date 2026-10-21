import { describe, expect, it } from "vitest";
import { lz4Block } from "./savestate.ts";

describe("LZ4 block decoding", () => {
  it("handles literals, overlapping matches and extended lengths", () => {
    // "abc" literal + match(offset 3, length 4+15+2=21) + final literal "!"
    const block = Uint8Array.from([0x3f, 0x61, 0x62, 0x63, 0x03, 0x00, 0x02, 0x10, 0x21]);
    const out = new Uint8Array(25);
    expect(lz4Block(block, out, 0)).toBe(25);
    expect(new TextDecoder().decode(out)).toBe("abc".repeat(8) + "!");
  });
});
