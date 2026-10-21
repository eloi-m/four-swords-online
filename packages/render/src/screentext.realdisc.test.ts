// Text layout of J2D text boxes with the US font and messages (needs extracted/): the message window's box, colors,
// picture characters, answer cursors and pages.
import { existsSync, readFileSync } from "node:fs";
import {
  bmgMessageById,
  BMG_COLORS,
  decompressYaz0,
  findPane,
  isYaz0,
  parseBfn,
  parseBlo,
  parseBmg,
  parseRarc,
  type BloTextBox,
} from "@fso/formats";
import { describe, expect, it } from "vitest";
import { contentParts, layoutScreenText, textBoxParts } from "./screentext.ts";

const root = new URL("../../../extracted/files/GC4Sword_usa/", import.meta.url);
const present = existsSync(root);
const unwrap = (b: Uint8Array) => (isYaz0(b) ? decompressYaz0(b) : b);
const file = (arc: string, path: string) =>
  unwrap(parseRarc(unwrap(new Uint8Array(readFileSync(new URL(arc, root))))).files.find((f) => f.path === path)!.data);

describe.skipIf(!present)("screen text layout (extracted/)", () => {
  const font = present ? parseBfn(file("msgus.arc", "font/rock_24_20_4i_e.bfn")) : null!;
  const bmg = present ? parseBmg(file("msgus.arc", "bmg/gc_four_swords_text_e.bmg")) : null!;
  const box = present ? (findPane(parseBlo(file("main2D.arc", "scrn/main_message_window.blo")), "Tmmt01") as BloTextBox) : null!;
  const balloon = present ? (findPane(parseBlo(file("main2D.arc", "scrn/hukidashi.blo")), "Tm01") as BloTextBox) : null!;

  it("the message window's placeholder: 2 left-aligned lines of 22×22 text, 19 px apart, inside the 468×40 box", () => {
    const layout = layoutScreenText(font, box, textBoxParts(box));
    expect(layout.lines).toBe(2);
    const rows = [...new Set(layout.glyphs.map((g) => g.y0))];
    expect(rows).toEqual([-0.5, 18.5]); // centered: (40 - (22 + 19)) / 2
    expect(Math.min(...layout.glyphs.map((g) => g.x0 + 0))).toBeLessThan(5);
    expect(layout.glyphs.every((g) => Math.abs(g.y1 - g.y0 - 22) < 1e-9 && Math.abs(g.x1 - g.x0 - 22) < 1e-9)).toBe(true);
    expect(layout.widths[0]).toBeLessThanOrEqual(box.width);
  });

  it("a BMG message: color tags recolor glyphs, pages split, the balloon fits three lines", () => {
    const got = bmgMessageById(bmg, 0xc8)!; // "You got {color 1}Pegasus Boots{color 0}!{page}…"
    const page0 = layoutScreenText(font, balloon, contentParts(got, 0));
    const green = BMG_COLORS[1];
    const colored = page0.glyphs.filter((g) => g.colors[0] === green);
    expect(colored).toHaveLength("PegasusBoots".length);
    expect(page0.glyphs.filter((g) => g.colors[0] !== green).every((g) => `${g.colors[0]}` === `${BMG_COLORS[0]}`)).toBe(true);
    expect(layoutScreenText(font, balloon, contentParts(got, 0), { colors: false }).glyphs.every((g) => g.colors[0] === balloon.topColor)).toBe(true);
    const page1 = layoutScreenText(font, balloon, contentParts(got, 1));
    expect(page1.lines).toBe(2); // the newline after the page tag is dropped
    for (let p = 0; p < 3; p++) {
      const layout = layoutScreenText(font, balloon, contentParts(got, p));
      expect(layout.glyphs.every((g) => g.y1 <= balloon.height + 1 && g.y0 >= -1)).toBe(true);
      expect(Math.max(...layout.widths)).toBeLessThanOrEqual(balloon.width);
    }
  });

  it("picture characters, arrows and answer cursors", () => {
    const test = layoutScreenText(font, balloon, contentParts(bmgMessageById(bmg, 0x12b)!)); // the font test page
    expect(test.icons.map((i) => i.texture)).toEqual([
      "kk_linkGr_01.bti", "kk_linkRe_01.bti", "kk_linkBl_01.bti", "kk_linkPu_01.bti", "kk_angou_01.bti", "kk_angou_02.bti",
      "kk_angou_03.bti", "heart.bti", "heart_01.bti", "heart_02.bti", "heart_03.bti",
    ]);
    const arrows = layoutScreenText(font, balloon, contentParts(bmgMessageById(bmg, 0x44b)!));
    const plain = layoutScreenText(font, balloon, contentParts("Then press \xa7, \xa8, \xa6, or \xa5."));
    expect(arrows.glyphs.filter((g) => g.sheet === 5 || g.sheet === 6).length).toBeGreaterThanOrEqual(4);
    expect(plain.glyphs).toHaveLength(15 + 4);
    const quit = bmgMessageById(bmg, 0x10c)!; // "Quit Shadow Battle?\n\n{option0}Yes    {option1}No"
    const two = layoutScreenText(font, balloon, contentParts(quit), { optionSpaces: 2 }).widths[2]!;
    const four = layoutScreenText(font, balloon, contentParts(quit), { optionSpaces: 4 }).widths[2]!;
    expect(four - two).toBeCloseTo(4 * 10 * (balloon.fontWidth / 24), 5);
  });
});
