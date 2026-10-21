// The message window's requests (messages.ts): logged with the tick of the state they're made in, cloned and hashed
// with the state, forgotten once nothing can show them but for the {notice} ones.
import { describe, expect, it } from "vitest";
import { createBattle } from "./battle.ts";
import { cloneGame, stepGame } from "./game.ts";
import { hashGame } from "./hash.ts";
import { askMessage, MESSAGE, MESSAGE_KEEP } from "./messages.ts";
import { spawnEntity } from "./entities.ts";
import { PICKUP_TICKS } from "./orbs.ts";
import { SUBPX } from "./player.ts";
import { sideRoomY } from "./siderooms.ts";
import { worldFrom } from "./testarena.ts";

describe("message requests", () => {
  const world = worldFrom(Array.from({ length: 30 }, () => ".".repeat(40)));
  const spawns = [
    { x: 60, y: 100, facing: "down" as const },
    { x: 200, y: 100, facing: "down" as const },
  ];

  it("are made on the step's resulting tick, belong to the state, and go after MESSAGE_KEEP ticks but for notices", () => {
    const game = createBattle(0, spawns);
    const before = hashGame(game);
    expect(game.battle!.messages).toBeUndefined();
    askMessage(game, MESSAGE.darkWorld);
    askMessage(game, MESSAGE.crystalBall, 1);
    expect(game.battle!.messages).toEqual([
      { id: MESSAGE.darkWorld, player: -1, tick: game.tick + 1 },
      { id: MESSAGE.crystalBall, player: 1, tick: game.tick + 1 },
    ]);
    expect(hashGame(game)).not.toBe(before);
    const copy = cloneGame(game);
    askMessage(copy, MESSAGE.giantBomb);
    expect(game.battle!.messages).toHaveLength(2); // (the clone has its own list)
    for (let t = 0; t <= MESSAGE_KEEP + 1; t++) stepGame(game, [0, 0], world);
    expect(game.battle!.messages).toEqual([{ id: MESSAGE.darkWorld, player: -1, tick: 1 }]);
  });

  it("an orb's content taken in a side room names its taker; on the TV, or a generator's item, asks nothing", () => {
    const rows = Array.from({ length: sideRoomY(1) / 8 + 30 }, () => ".".repeat(40));
    const tall = worldFrom(rows);
    const game = createBattle(0, [spawns[0]!, { x: 200, y: sideRoomY(1) + 100, facing: "down" }]);
    const b = game.battle!;
    b.phase = "play";
    spawnEntity(b, "pickup", 60 * SUBPX, 100 * SUBPX, { item: "bow", timer: PICKUP_TICKS }); // (on the TV, under P1)
    spawnEntity(b, "pickup", 200 * SUBPX, (sideRoomY(1) + 100) * SUBPX, { item: "bow", timer: PICKUP_TICKS, home: 3 }); // (a generator's)
    stepGame(game, [0, 0], tall);
    expect(b.fighters.map((f) => f.item)).toEqual(["bow", "bow"]);
    expect(b.messages).toBeUndefined();
    spawnEntity(b, "pickup", 200 * SUBPX, (sideRoomY(1) + 100) * SUBPX, { item: "boomerang", timer: PICKUP_TICKS });
    stepGame(game, [0, 0], tall);
    expect([b.fighters[1]!.item, b.messages]).toEqual(["boomerang", [{ id: MESSAGE.crystalBall, player: 1, tick: game.tick }]]);
  });
});
