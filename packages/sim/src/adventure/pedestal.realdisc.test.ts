// Room 8's bow pedestal (the Cave of No Return, room 9's cell played alone): taking the bow puts the item held on the
// pedestal (Dolphin frame dumps: the lamp), the pose holds it up; the pedestal blocks the way; the island's chest opens
// with the Item button faced from below. Skips without extracted/.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, isYaz0, loadActorTypes, parseBmg, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { Button, SUBPX, type Facing } from "../player.ts";
import { actorKey, createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import { getFrame, messageBook } from "./dialogue.ts";
import { giveGear, PEDESTAL_DRAWN, PEDESTAL_DRAWN_TOP, pedestalTiles } from "./gear.ts";
import { actorStats, AdventureStage, playedAlone } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("room 8's bow pedestal (the Cave of No Return)", () => {
  if (!existsSync(root)) return void it.skip("needs extracted/", () => {});
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stage = new AdventureStage(playedAlone(new Stage(load("Boss/boss011.arc"))), tileTypes, actorStats(loadActorTypes(load("data.arc"))!));
  const bmg = load("msgus.arc").files.find((f) => f.path.endsWith("_e.bmg"))!.data;
  stage.messages = messageBook(parseBmg(isYaz0(bmg) ? decompressYaz0(bmg) : bmg));
  // The pedestal: tile (12, 11), (192, 176); the item's two top-layer tiles there and above.
  const PEDESTAL = 11 * 32 + 12;
  const at = (x: number, y: number, facing: Facing = "up") => createAdventure(stage, { players: 4, room: 9, x, y, facing });
  const step = (g: AdventureGame, buttons: number, n = 1) => {
    for (let i = 0; i < n; i++) stepAdventure(g, [buttons], stage);
  };
  const tiles = (g: AdventureGame) => {
    const out = new Map<number, number>();
    pedestalTiles(g, out);
    return [out.get(PEDESTAL), out.get(PEDESTAL - 32)];
  };
  /** Action facing the pedestal, then the message read on (Item) until the pose ends. */
  const take = (g: AdventureGame) => {
    step(g, Button.Action, 2);
    step(g, 0, 1);
    for (let i = 0; i < 600 && g.adventure.get; i++) step(g, i % 8 < 2 ? Button.Item : 0);
    step(g, 0, 10);
  };

  it("takes the bow, the lamp held going onto the pedestal; taken again, the lamp", () => {
    const g = at(204, 199);
    giveGear(g, "lamp");
    expect(tiles(g)).toEqual([undefined, undefined]);
    step(g, Button.Action, 2);
    expect(g.adventure.gear).toBe("bow");
    expect(g.adventure.get?.pose).toBe("item");
    // All four hold it up (player_sob 233 … 236).
    step(g, 0, 20);
    expect(getFrame(g)).toBe(236);
    expect(tiles(g)).toEqual([PEDESTAL_DRAWN + 2, PEDESTAL_DRAWN_TOP + 2]);
    for (let i = 0; i < 600 && g.adventure.get; i++) step(g, i % 8 < 2 ? Button.Item : 0);
    step(g, 0, 10);
    take(g);
    expect(g.adventure.gear).toBe("lamp");
    expect(tiles(g)).toEqual([PEDESTAL_DRAWN + 4, PEDESTAL_DRAWN_TOP + 4]);
  });

  it("taken holding nothing, the pedestal is left empty and gives nothing more", () => {
    const g = at(204, 199);
    take(g);
    expect(g.adventure.gear).toBe("bow");
    expect(tiles(g)).toEqual([0, 0]);
    expect(g.adventure.pedestals).toEqual([9 * 8192 + PEDESTAL, 0]);
    step(g, Button.Action, 2);
    expect(g.adventure.get).toBeNull();
  });

  it("blocks the way: walking up into it, the leader stops under it", () => {
    const g = at(204, 230);
    step(g, Button.Up, 60);
    expect(g.players[0]!.y / SUBPX).toBeGreaterThanOrEqual(199);
    expect(g.players[0]!.y / SUBPX).toBeLessThan(200);
  });

  it("the island's chest (256, 176) opens with the Item button, faced from below", () => {
    const g = at(264, 199);
    const chest = stage.area(9, 0).actors.find((a) => a.id === "TKRA")!;
    expect([chest.x, chest.y]).toEqual([256, 176]);
    // (Action there lifts nothing: Shadow Battle's empty lift.)
    step(g, Button.Action, 2);
    step(g, 0, 40);
    expect(g.adventure.opened).not.toContain(actorKey(9, chest.index));
    step(g, Button.Item, 2);
    step(g, 0, 10);
    expect(g.adventure.opened).toContain(actorKey(9, chest.index));
  });
});
