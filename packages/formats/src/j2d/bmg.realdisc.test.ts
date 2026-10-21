// The message files of the real extracted disc; skipped when extracted/ is absent (e.g. in CI).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { battleArenaName } from "../fsa/stage.ts";
import { parseRarc } from "../rarc.ts";
import { decompressYaz0, isYaz0 } from "../yaz0.ts";
import { bfnGlyphIndex, parseBfn } from "./bfn.ts";
import { battleMessages, BATTLE_MESSAGE_IDS, BMG_TAGS, bmgMessageById, bmgMessageText, bmgPlainText, parseBmg, unknownBmgTags, type Bmg } from "./bmg.ts";

const root = new URL("../../../../extracted/files/GC4Sword_usa/", import.meta.url);
const present = existsSync(root);
const unwrap = (b: Uint8Array) => (isYaz0(b) ? decompressYaz0(b) : b);
const file = (arc: string, path: string) => {
  const a = parseRarc(unwrap(new Uint8Array(readFileSync(new URL(arc, root)))));
  return unwrap(a.files.find((f) => f.path === path)!.data);
};
const FILES = [
  ["msgus.arc", "bmg/gc_four_swords_text_e.bmg"],
  ["msgus.arc", "bmg/gc_four_swords_text_ek.bmg"],
  ["msgjp.arc", "bmg/gc_four_swords_text_jp.bmg"],
  ["msgjp.arc", "bmg/gc_four_swords_text_jpk.bmg"],
] as const;

describe.skipIf(!present)("real disc: BMG messages", () => {
  const files = present ? FILES.map(([arc, path]) => parseBmg(file(arc, path))) : [];
  const [e, ek, jp, jpk] = files as [Bmg, Bmg, Bmg, Bmg];

  it("parses all four files: 2150 messages each, ids 1-2150, only tags BMG_TAGS knows", () => {
    for (const bmg of files) {
      expect(bmg.encoding).toBe(3);
      expect(bmg.blocks).toEqual(["INF1", "DAT1"]);
      expect(bmg.entrySize).toBe(8);
      expect(bmg.messages.map((m) => m.id)).toEqual(Array.from({ length: 2150 }, (_, i) => i + 1));
      expect(bmg.messages.every((m) => m.attributes.every((b) => b === 0))).toBe(true);
      expect(unknownBmgTags(bmg)).toEqual([]);
      // every tag's arguments fit its layout
      for (const m of bmg.messages)
        for (const p of m.parts) {
          if (p.kind !== "tag") continue;
          const layout = BMG_TAGS.get(p.key)!.args;
          const size = layout ? layout.split(",").reduce((n, f) => n + (f.trim().startsWith("u32") ? 4 : f.trim().startsWith("u16") ? 2 : 1), 0) : 0;
          // number tags take their unit byte only sometimes
          if (p.group === 3) expect(p.args.length).toBeLessThanOrEqual(size);
          else expect(p.args.length, `${m.id} ${bmgMessageText([p])}`).toBe(size);
        }
    }
  });

  it("the US texts are ASCII the US font draws; _ek uses Shift-JIS arrows; the Japanese ones fit the Japanese font", () => {
    const us = parseBfn(file("msgus.arc", "font/rock_24_20_4i_e.bfn"));
    const ja = parseBfn(file("msgjp.arc", "font/rock_24_20_4i_j.bfn"));
    const codes = (bmg: Bmg) => new Set(bmg.messages.flatMap((m) => m.parts.flatMap((p) => (p.kind === "text" ? p.codes : []))));
    expect([...codes(e)].every((c) => c === 0x0a || (c >= 0x20 && c < 0x7f))).toBe(true);
    expect([...codes(ek)].filter((c) => c > 0xff).sort()).toEqual([0x81a8, 0x81a9, 0x81aa, 0x81ab]);
    for (const c of codes(e)) if (c !== 0x0a) expect(bfnGlyphIndex(us, c)).toBe(c - 0x20);
    const jaCodes = [...codes(jp), ...codes(jpk)].filter((c) => c !== 0x0a);
    const missing = jaCodes.filter((c) => bfnGlyphIndex(ja, c) === ja.defaultGlyph && c !== 0x20);
    expect(missing.length).toBeLessThan(jaCodes.length / 100);
  });

  it("_ek / _jpk are the Game Boy Advance's texts: menus empty, the rest as on the TV with the GBA's wording", () => {
    // every message empty on the TV is empty on the GBA too; the GBA files leave out 617 / 627 more (menus, memory
    // card, mini-game and story texts)
    const empties = (bmg: Bmg) => new Set(bmg.messages.filter((m) => m.bytes.length === 0).map((m) => m.id));
    for (const [tv, gba, more] of [[e, ek, 617], [jp, jpk, 627]] as const) {
      const [a, b] = [empties(tv), empties(gba)];
      expect([...a].every((id) => b.has(id))).toBe(true);
      expect(b.size - a.size).toBe(more);
    }
    expect(bmgPlainText(bmgMessageById(ek, 0x41)!)).toBe(""); // "Tetra's Trackers" on the TV
    expect(bmgPlainText(bmgMessageById(e, 0x523)!)).toContain("Control Stick");
    expect(bmgPlainText(bmgMessageById(ek, 0x523)!)).toContain("+Control Pad");
    expect(bmgPlainText(bmgMessageById(jp, 0xc7)!)).toContain("手に入れた"); // kanji on the TV
    expect(bmgPlainText(bmgMessageById(jpk, 0xc7)!)).toContain("てにいれた"); // kana on the GBA
  });

  it("tags in context: colors, picture characters, arrows, answers and numbers", () => {
    expect(bmgMessageText(bmgMessageById(e, 0xc9)!)).toBe(
      "You got a {color 1}Heart Container{color 0}!\nYou're stronger, and your\nhearts have been refilled!",
    );
    expect(bmgMessageText(bmgMessageById(e, 0x44b)!)).toContain("{arrow}, {arrow}, {arrow}, or {arrow}");
    expect(bmgMessageText(bmgMessageById(e, 0x10c)!)).toBe("Quit Shadow Battle?\n\n{option0 0}Yes    {option1 0}No");
    expect(bmgMessageText(bmgMessageById(e, 0xb4)!)).toBe("TIME: {number}");
    expect(bmgMessageText(bmgMessageById(e, 0x494)!)).toContain("Together you collected\n{number 1}, so I'll\ngive you {number 9}!");
    const font = bmgMessageById(e, 0x12b)!; // the font test page lists the picture characters 0-10
    expect(font.parts.filter((p) => p.kind === "tag").map((p) => p.kind === "tag" && p.key)).toEqual(Array.from({ length: 11 }, (_, k) => 0x10000 + k));
  });

  it("battleMessages: the arenas match the sim's names; the results, rules and pause texts", () => {
    const b = battleMessages(e);
    expect(b.arenas.map((a) => a.replace("\n", " "))).toEqual(Array.from({ length: 10 }, (_, r) => battleArenaName(r)));
    expect(b.wins).toEqual(["P1 WINS!", "P2 WINS!", "P3 WINS!", "P4 WINS!"]);
    expect([b.title, b.tie, b.time, b.start, b.rules, b.results]).toEqual(["Shadow Battle", "TIE!", "TIME: ", "START!", "Rules", "Results"]);
    expect(b.ruleRows).toEqual({ vaati: "Vaati", powerfulItems: "Powerful Items", damageRivals: "Damage Rivals", darkWorldMatch: "Dark World Match" });
    expect(b.pause).toEqual({ leavePrompt: "Leave this area?\n\nYes    No", quitPrompt: "Quit Shadow Battle?\n\nYes    No", continue: "Continue", quit: "Quit" });
    expect(b.down).toBe("P down!");
    // the Japanese file has the same ids
    expect(bmgPlainText(bmgMessageById(jp, BATTLE_MESSAGE_IDS.title)!)).toBe("シャドウバトル");
  });
});
