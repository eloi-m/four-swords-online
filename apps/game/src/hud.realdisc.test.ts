// The adventure HUD's item box (hud.ts): the held item's icon pair shown, the others hidden. Skips without extracted/.
import { existsSync, readFileSync } from "node:fs";
import { decodeBti, decompressYaz0, findPane, isYaz0, parseBlo, parseBtiHeader, parseRarc, type RarcArchive } from "@fso/formats";
import type { ScreenAssets } from "@fso/render";
import type { AdventureGame, GearKind } from "@fso/sim/adventure";
import { describe, expect, it } from "vitest";
import { AdventureHud } from "./hud.ts";

const root = new URL("../../../extracted/", import.meta.url);
const present = existsSync(new URL("sys/main.dol", root));
const archive = (path: string) => {
  const bytes = readFileSync(new URL(`files/GC4Sword_usa/${path}`, root));
  return parseRarc(isYaz0(bytes) ? decompressYaz0(bytes) : bytes);
};
const file = (a: RarcArchive, path: string) => {
  const f = a.files.find((x) => x.path === path);
  return f ? (isYaz0(f.data) ? decompressYaz0(f.data) : f.data) : null;
};

describe.skipIf(!present)("real disc: the adventure HUD's item box", () => {
  const game2D = present ? archive("game2D.arc") : null!, main2D = present ? archive("main2D.arc") : null!;
  const assets: ScreenAssets = {
    texture(name) {
      for (const a of [game2D, main2D]) {
        const bytes = file(a, `timg/${name}`);
        if (bytes) return { image: decodeBti(bytes), header: parseBtiHeader(bytes) };
      }
      return null;
    },
  };
  const game = (gear: GearKind) => ({ adventure: { gear, gems: 0 }, battle: { fighters: [{ hearts: 12 }], rules: { hearts: 3 } } }) as unknown as AdventureGame;

  it("shows the lantern for the lamp, the bow's icon for the bow, none for nothing", () => {
    const screen = parseBlo(file(game2D, "scrn/main_adv.blo")!);
    const hud = new AdventureHud(screen, assets);
    const shown = (tag: string) => hud.view.panes.get(findPane(screen, tag)!)!.visible;
    hud.update(game(""));
    expect(hud.shown.icon).toBe(-1);
    expect(shown("Php1ii23")).toBe(false);
    hud.update(game("lamp"));
    expect(hud.shown.icon).toBe(11);
    expect([shown("Php1ii23"), shown("Php1ii24"), shown("Php1ii07")]).toEqual([true, true, false]);
    hud.update(game("bow"));
    expect(hud.shown.icon).toBe(3);
    expect([shown("Php1ii07"), shown("Php1ii08"), shown("Php1ii23")]).toEqual([true, true, false]);
  });
});
