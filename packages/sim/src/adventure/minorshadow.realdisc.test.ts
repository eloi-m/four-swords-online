// The minor Shadow Link with a hammer (minorshadow.ts) in Lake Hylia's room 4, the Links walking in from room 3 as in
// the Dolphin trace (docs/measurements/adventure-lake-hylia.md "The minor Shadow Link with a hammer"; skips without
// extracted/).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { Button, SUBPX } from "../player.ts";
import { actorKey, createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import { gatherOnLeader } from "./formation.ts";
import { MINOR_SHADOW_STATE as S, minorShadowFrame, minorShadowState } from "./minorshadow.ts";
import { actorStats, AdventureStage } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

/** Ticks from the room change's start (traced: the frame he's first there) to each step, and his whole show. */
const RAISE_AT = 103;
const BLOW = 32 + 30 + 29;
const AWAY_AT = RAISE_AT + 3 * BLOW + 2 * 120 + 60 + 115;
const GONE_AT = AWAY_AT + 242;

describe.skipIf(!existsSync(root))("Lake Hylia's minor Shadow Link (room 4)", () => {
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stage = new AdventureStage(new Stage(load("Boss/boss010.arc")), tileTypes, stats);
  const zslh = (g: AdventureGame) => g.adventure.enemies.find((e) => e.type === "ZSLH");

  /** The four walking left from room 3 (39, 220) as traced, until the room change; the tick it began. */
  const comeIn = () => {
    const game = createAdventure(stage, { room: 3, x: 39, y: 220, facing: "left", players: 4 });
    gatherOnLeader(game);
    stepAdventure(game, [0], stage);
    while (game.adventure.room !== 4) stepAdventure(game, [Button.Left], stage);
    return { game, start: game.tick };
  };

  it("hops in place, raises the hammer 103 ticks after the room change, three blows, spins and walks off unseen", () => {
    const { game, start } = comeIn();
    const states: [number, number][] = [];
    let last: number = S.wait;
    while (zslh(game) && game.tick - start < GONE_AT + 10) {
      stepAdventure(game, [0], stage);
      const e = zslh(game);
      const s = e ? minorShadowState(e) : -1;
      if (s !== last) states.push([s, game.tick - start]);
      last = s;
      // Hopping while he waits (up to 14.4 px), standing on the ground otherwise.
      if (e && s === S.wait) expect(e.z).toBeLessThanOrEqual(Math.ceil(14.4 * SUBPX));
    }
    expect(states).toEqual([
      [S.raise, RAISE_AT],
      [S.hold, RAISE_AT + 32],
      [S.blow, RAISE_AT + 62],
      [S.rest, RAISE_AT + BLOW],
      [S.raise, RAISE_AT + BLOW + 120],
      [S.hold, RAISE_AT + BLOW + 152],
      [S.blow, RAISE_AT + BLOW + 182],
      [S.rest, RAISE_AT + 2 * BLOW + 120],
      [S.raise, RAISE_AT + 2 * BLOW + 240],
      [S.hold, RAISE_AT + 2 * BLOW + 272],
      [S.blow, RAISE_AT + 2 * BLOW + 302],
      [S.after, RAISE_AT + 3 * BLOW + 240],
      [S.spin, RAISE_AT + 3 * BLOW + 300],
      [S.away, AWAY_AT],
      [-1, GONE_AT],
    ]);
    // Done for the room: back in, he isn't there.
    expect(game.adventure.taken).toContain(actorKey(4, stage.area(4, 0).actors.find((a) => a.id === "ZSLH")!.index));
  });

  it("his frames: standing 62, the raise 307-305, held up 379, the blow 380-386; none once off the TV", () => {
    const { game, start } = comeIn();
    const at = (t: number) => {
      while (game.tick - start < t) stepAdventure(game, [0], stage);
      return minorShadowFrame(zslh(game)!);
    };
    expect(at(RAISE_AT - 1)).toBe(62);
    expect([at(RAISE_AT), at(RAISE_AT + 1), at(RAISE_AT + 2), at(RAISE_AT + 31)]).toEqual([307, 306, 305, 305]);
    expect(at(RAISE_AT + 32)).toBe(379);
    expect([at(RAISE_AT + 62), at(RAISE_AT + 63), at(RAISE_AT + 65), at(RAISE_AT + 90)]).toEqual([380, 381, 385, 386]);
    expect(at(AWAY_AT)).toBe(-1);
  });

  it("the blow's wave stuns the Link in control near it (not the followers), no harm", () => {
    const { game, start } = comeIn();
    // Put up on his plateau below him with the others on him (the way up is through lifted stones): (256, 180), 24
    // px from where the hammer hits (256, 156), then walked up 10 px.
    while (game.tick - start < 40) stepAdventure(game, [0], stage);
    Object.assign(game.players[0]!, { x: 256 * SUBPX, y: 180 * SUBPX, facing: "up" });
    gatherOnLeader(game);
    while (game.players[0]!.y > 170 * SUBPX) stepAdventure(game, [Button.Up], stage);
    expect(game.players.every((p) => Math.abs(p.y / SUBPX - 175) < 8 && Math.abs(p.x / SUBPX - 256) < 8)).toBe(true);
    while (zslh(game) && minorShadowState(zslh(game)!) !== S.hold) stepAdventure(game, [0], stage);
    const blowAt = game.tick + 30 - zslh(game)!.tick;
    const f = game.battle.fighters[0]!, hearts = f.hearts;
    let stunnedAt = -1;
    while (game.tick < blowAt + 30) {
      stepAdventure(game, [0], stage);
      if (stunnedAt < 0 && f.mode === "stunned") stunnedAt = game.tick - blowAt;
    }
    // The hammer hits on the blow's 3rd tick; the wave is 16 px wide two ticks later.
    expect(stunnedAt).toBe(3 + 2);
    expect(f.hearts).toBe(hearts);
    expect(game.battle.fighters.slice(1).every((x) => x.mode !== "stunned")).toBe(true);
  });
});
