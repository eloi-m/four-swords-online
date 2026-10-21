// The menus' words (menu-text.ts): each from its message id in the US file (skipped when extracted/ is absent), and
// the fallbacks without the file or for a missing message.
import { existsSync, readFileSync } from "node:fs";
import { BATTLE_MESSAGE_IDS, bmgMessageById, bmgPlainText, decompressYaz0, isYaz0, parseBmg, parseRarc, type Bmg } from "@fso/formats";
import { arenaName, ARENA_ROOMS } from "@fso/sim";
import { afterEach, describe, expect, it } from "vitest";
import { archiveFile } from "./screen-files.ts";
import { arenaLabel, arenaTitle, FALLBACK_TEXT, menuText, menuTexts, setMenuMessages } from "./menu-text.ts";

const arc = new URL("../../../extracted/files/GC4Sword_usa/msgus.arc", import.meta.url);
const present = existsSync(arc);

afterEach(() => setMenuMessages(null));

describe("menu text without the messages", () => {
  it("is the page's own words; the arenas' names are the sim's", () => {
    expect(menuTexts(null)).toBe(FALLBACK_TEXT);
    setMenuMessages(null);
    expect(ARENA_ROOMS.map(arenaTitle)).toEqual(ARENA_ROOMS.map(arenaName));
    expect(arenaLabel(6)).toEqual({ name: "Tower of Flames", world: "Dark World" });
    expect(arenaLabel(1)).toEqual({ name: "Tower of Flames", world: null });
    expect(menuText().wins[1]).toBe("P2 WINS!");
  });

  it("falls back for a message the file lacks or leaves empty", () => {
    const empty: Bmg = { encoding: 3, blocks: ["INF1", "DAT1"], entrySize: 8, messages: [] } as unknown as Bmg;
    expect(menuTexts(empty)).toEqual(FALLBACK_TEXT);
  });
});

describe.skipIf(!present)("real disc: menu text from the US messages", () => {
  const bytes = present ? new Uint8Array(readFileSync(arc)) : null!;
  const bmg = present ? parseBmg(archiveFile(parseRarc(isYaz0(bytes) ? decompressYaz0(bytes) : bytes), "bmg/gc_four_swords_text_e.bmg")!) : null!;
  const text = (id: number) => bmgPlainText(bmgMessageById(bmg, id)!);

  it("maps each word to its message id", () => {
    const t = menuTexts(bmg);
    const ids = BATTLE_MESSAGE_IDS;
    expect(t.title).toBe(text(ids.title));
    expect(t.arenas).toEqual(ids.arenas.map(text));
    expect(t.rules).toBe(text(ids.rules));
    expect(t.start).toBe(text(ids.start));
    expect(t.wins).toEqual(ids.wins.map(text));
    expect(t.continue).toBe(text(ids.pause.continue));
    expect(t.quit).toBe(text(ids.pause.quit));
    expect([t.yes, t.no]).toEqual([text(ids.ruleValues.yes), text(ids.ruleValues.no)]);
    // what they say in the US file
    expect([t.title, t.rules, t.start, t.wins[0], t.continue, t.quit, t.yes, t.no]).toEqual(["Shadow Battle", "Rules", "START!", "P1 WINS!", "Continue", "Quit", "Yes", "No"]);
  });

  it("splits the arenas' two lines into the name and the world; on one line they're the sim's names", () => {
    setMenuMessages(bmg);
    expect(arenaLabel(9)).toEqual({ name: "Above the Clouds", world: "Dark World" });
    expect(arenaLabel(0)).toEqual({ name: "The Field", world: null });
    expect(ARENA_ROOMS.map(arenaTitle)).toEqual(ARENA_ROOMS.map(arenaName));
  });
});
