// BMG parsing on a hand-built file (no game data).
import { describe, expect, it } from "vitest";
import { bmgMessageById, bmgMessageText, bmgPages, bmgPlainText, bmgTagArgs, parseBmg, unknownBmgTags } from "./bmg.ts";

/** A MESGbmg1 file with INF1 (8-byte entries, id = index + 1) and DAT1 holding the given raw texts. */
function buildBmg(texts: number[][]): Uint8Array {
  const pad = (n: number) => (n + 31) & ~31;
  const data = [0]; // offset 0: the empty string
  const offsets = texts.map((t) => {
    const at = data.length;
    data.push(...t, 0);
    return at;
  });
  const infSize = pad(0x10 + texts.length * 8), datSize = pad(8 + data.length);
  const out = new Uint8Array(0x20 + infSize + datSize);
  const v = new DataView(out.buffer);
  out.set([..."MESGbmg1"].map((c) => c.charCodeAt(0)));
  v.setUint32(8, out.length);
  v.setUint32(12, 2);
  out[0x10] = 3;
  const inf = 0x20;
  out.set([..."INF1"].map((c) => c.charCodeAt(0)), inf);
  v.setUint32(inf + 4, infSize);
  v.setUint16(inf + 8, texts.length);
  v.setUint16(inf + 10, 8);
  offsets.forEach((o, i) => {
    v.setUint32(inf + 0x10 + i * 8, o);
    v.setUint16(inf + 0x14 + i * 8, i + 1);
  });
  const dat = inf + infSize;
  out.set([..."DAT1"].map((c) => c.charCodeAt(0)), dat);
  v.setUint32(dat + 4, datSize);
  out.set(data, dat + 8);
  return out;
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const color = (c: number) => [0x1a, 6, 2, 0, 0x1e, c];
const page = [0x1a, 5, 0, 0, 0];

describe("BMG", () => {
  it("splits texts into runs and tags, pages at 0.00 and drops the newline after a page", () => {
    const bmg = parseBmg(
      buildBmg([
        ascii("Lake Hylia"),
        [...ascii("You got "), ...color(1), ...ascii("bombs"), ...color(0), ...ascii("!"), ...page, ...ascii("\nUse them!"), ...page],
        [0x1a, 7, 3, 0, 3, 1, ...ascii(" left")], // a tag longer than its layout keeps its extra bytes
        [0x82, 0xa0, ...ascii("A"), 0x1a, 5, 9, 0, 1], // Shift-JIS あ, then an unknown tag
      ]),
    );
    expect(bmg.encoding).toBe(3);
    expect(bmg.blocks).toEqual(["INF1", "DAT1"]);
    expect(bmg.messages.map((m) => m.id)).toEqual([1, 2, 3, 4]);
    expect(bmg.messages[0]!.parts).toEqual([{ kind: "text", codes: ascii("Lake Hylia"), text: "Lake Hylia" }]);
    const got = bmg.messages[1]!;
    expect(got.parts.map((p) => p.kind)).toEqual(["text", "tag", "text", "tag", "text", "tag", "text", "tag"]);
    expect(bmgMessageText(got)).toBe("You got {color 1}bombs{color 0}!{page}\nUse them!{page}");
    expect(bmgPages(got).map((p) => bmgMessageText(p))).toEqual(["You got {color 1}bombs{color 0}!", "Use them!"]);
    expect(bmgPlainText(got)).toBe("You got bombs!\nUse them!");
    const number = bmg.messages[2]!.parts[0]!;
    expect(number.kind === "tag" && [number.key, bmgTagArgs(number)]).toEqual([0x30003, [1]]);
    const sjis = bmg.messages[3]!.parts[0]!;
    expect(sjis).toEqual({ kind: "text", codes: [0x82a0, 0x41], text: "あA" });
    expect(bmgMessageText(bmg.messages[3]!)).toBe("あA{9.01}");
    expect(unknownBmgTags(bmg)).toEqual([{ code: "9.01", count: 1, messages: [4] }]);
    expect(bmgMessageById(bmg, 2)).toBe(got);
  });
});
