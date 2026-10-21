// Tingle's first appearance (tingle.ts) under Lake Hylia's bridge, played by the stage's route (lakehylia.ts) up to
// room 5's river: the two-Link rock lifted off him, his messages in order, his flight off the GBA screen onto the TV,
// and nothing there when the Links swim back in (docs/measurements/adventure-lake-hylia.md "Tingle under the bridge";
// skips without extracted/).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, isYaz0, loadActorTypes, parseBmg, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { Button } from "../player.ts";
import { actorKey, cloneAdventure, createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import { messageBook } from "./dialogue.ts";
import { holdUntil, RoutePlayer, type Goal } from "./drive.ts";
import { LAKE_HYLIA_MILESTONES } from "./lakehylia.ts";
import { actorStats, AdventureStage } from "./stage.ts";
import { TINGLE, TINGLE_STATE as S, tingleShown } from "./tingle.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("Tingle under Lake Hylia's bridge", () => {
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stage = new AdventureStage(new Stage(load("Boss/boss010.arc")), tileTypes, stats);
  const bmg = load("msgus.arc").files.find((f) => f.path.endsWith("_e.bmg"))!.data;
  stage.messages = messageBook(parseBmg(isYaz0(bmg) ? decompressYaz0(bmg) : bmg));
  const ftgl = stage.area(5, 2).actors.find((a) => a.id === "FTGL")!;

  const play = (game: AdventureGame, goals: readonly Goal[], each?: (g: AdventureGame) => void) => {
    const player = new RoutePlayer(goals);
    while (!player.done) {
      const buttons = player.next(game, stage);
      if (player.done) break;
      stepAdventure(game, [buttons], stage);
      each?.(game);
    }
  };

  // The route to room 5's river, then its milestone under the bridge, watching the scene.
  const game = createAdventure(stage, { players: 4 });
  for (let n = 0; n < 6; n++) play(game, LAKE_HYLIA_MILESTONES[n]!.goals);
  const messages: number[] = [], states: [number, number][] = [], frames = new Set<number>();
  let lifted = -1, made = -1, held = 0, back: AdventureGame | null = null, area = game.adventure.area;
  play(game, LAKE_HYLIA_MILESTONES[6]!.goals, (g) => {
    const a = g.adventure, t = a.tingle;
    if (lifted < 0 && a.heavy && a.area === 2) lifted = g.tick;
    if (made < 0 && t) made = g.tick;
    if (t && t.state !== states.at(-1)?.[1]) states.push([g.tick, t.state]);
    if (a.talk && a.talk.message !== messages.at(-1)) messages.push(a.talk.message);
    if (t?.state === S.told) frames.add(t.frame);
    if (t && t.state >= S.stop && t.state <= S.rise && g.players[0]!.moving) held++;
    // Out from under the bridge, a copy to swim back in.
    if (area === 2 && a.area === 0 && !a.warp && !back) back = cloneAdventure(g);
    if (!a.warp) area = a.area;
  });
  const at = (state: number) => states.find(([, s]) => s === state)?.[0] ?? -1;

  it("is made under the rock 68 ticks after the lifting press, lying there", () => {
    expect(lifted).toBeGreaterThan(0);
    expect(made - lifted).toBe(TINGLE.reveal);
    expect(states[0]![1]).toBe(S.made);
  });

  it("stops the Links 50 ticks later and talks 234 ticks after he's made (traced)", () => {
    expect(at(S.stop) - made).toBe(50);
    expect(at(S.asked) - made).toBe(572 - 338);
    expect(held).toBe(0);
  });

  it("shows his messages in order: 1294, then 1295, 1305 and the chant 1302 in one box", () => {
    expect(messages).toEqual([1294, 1295, 1305, 1302]);
    // His chant's poses (both2 192 + 31-37) and his talking frame.
    for (const f of [20, 31, 32, 33, 34, 35, 36, 37]) expect(frames.has(f)).toBe(true);
  });

  it("floats off the GBA screen and onto the TV, then is gone for good", () => {
    expect(at(S.fly) - at(S.rise)).toBe(24);
    expect(at(S.off)).toBeGreaterThan(at(S.fly));
    expect(at(S.unseen)).toBe(at(S.off) + 1);
    expect(game.adventure.tingle).toBeNull();
    expect(game.adventure.taken).toContain(actorKey(5, ftgl.index));
  });

  it("isn't there when the Links swim back under the bridge", () => {
    expect(back).not.toBeNull();
    const g = back!;
    play(g, [holdUntil("back under the bridge", Button.Left, (x) => x.adventure.area === 2 && !x.adventure.warp, 400)]);
    for (let i = 0; i < 400; i++) {
      stepAdventure(g, [0], stage);
      const shown = tingleShown(g);
      expect(shown === null || shown.area !== 2).toBe(true);
      expect(g.adventure.tingle === null || g.adventure.tingle.state >= S.off).toBe(true);
    }
  });
});
