// The Tower of Winds' giant-bomb Shadow Link and his bomb (giantbomb.ts): the traced timeline from his switch, the
// bomb's flight and fuse, hits shortening it, the blast that knocks out every Link on the TV but not one in a side room,
// a repeat, and determinism through clones and hashes.
import { describe, expect, it } from "vitest";
import { cloneGame, stepGame, type GameState } from "./game.ts";
import { BIG_BOMB, BIG_BOMB_FUSE, BIG_BOMB_GROW, BIG_BOMB_HIT, BIG_BOMB_SIZE, BOMB_HOLD, SHADOW, SHADOW_HEIGHT } from "./giantbomb.ts";
import { hashGame } from "./hash.ts";
import { MESSAGE } from "./messages.ts";
import { Button, SUBPX } from "./player.ts";
import type { ArenaProps } from "./props.ts";
import { sideRoomY } from "./siderooms.ts";
import { setSwitch } from "./switches.ts";
import { arena, run, start, until, worldFrom } from "./testarena.ts";

/** BBSL as the Tower of Winds lists it: at (256, 128) of a 320×240 test arena's own (160, 64), switch 21 (0xAA000000). */
const PROPS: ArenaProps = { actors: [{ id: "BBSL", x: 160, y: 64, params: 0xaa000000 }], bushes: [], sideRooms: 1 << 1 };
const shadowOf = (game: GameState) => game.battle!.entities.find((e) => e.kind === "shadowLink")!;
const bombOf = (game: GameState) => game.battle!.entities.find((e) => e.kind === "bigBomb" && e.hp >= 0);

/** A test arena and, below it, side room 1 (both open, walled). */
function twoRooms() {
  const room = (y: number) => Array.from({ length: 40 }, (_, x) => (x === 0 || y === 0 || x === 39 || y === 29 ? "#" : ".")).join("");
  const rows: string[] = [];
  for (let y = 0; y < sideRoomY(1) / 8 + 30; y++) rows.push(y < 30 ? room(y) : y < sideRoomY(1) / 8 ? "#".repeat(40) : room(y - sideRoomY(1) / 8));
  return worldFrom(rows);
}

describe("the giant-bomb Shadow Link", () => {
  const world = twoRooms();

  it("waits for his switch, then comes, rises, holds a bomb that grows and throws it, as traced", () => {
    const game = start(world, [{ x: 60, y: 200, facing: "right" }, { x: 260, y: 200, facing: "left" }], PROPS);
    const e = shadowOf(game);
    run(game, world, 100);
    expect(e.param).toBe(SHADOW.waiting);
    setSwitch(game.battle!, 21, true);
    const at: Record<string, number> = {};
    for (let t = 1; t <= 430; t++) {
      const before = e.param;
      stepGame(game, [], world);
      if (e.param !== before) at[Object.keys(SHADOW).find((k) => SHADOW[k as keyof typeof SHADOW] === e.param)!] = t;
    }
    // (Traced: states 2, 3, 4, 5, 6, 7, 8, 9 at frames 9, 69, 184, 216, 276, 356, 416, 426: 60, 115, 32, 60, 80, 60, 10.)
    expect(at).toEqual({ coming: 1, unseen: 2, sparkles: 62, rising: 177, hovering: 209, holding: 269, throwing: 349, fading: 409, away: 419 });
    expect(e.z).toBe(SHADOW_HEIGHT);
    const bomb = bombOf(game)!;
    expect(bomb).toBeDefined();
  });

  it("the bomb grows over his head, flies up and down onto the ground in 47 ticks, squashes, burns 600 ticks", () => {
    const game = start(world, [{ x: 60, y: 200, facing: "right" }, { x: 260, y: 200, facing: "left" }], PROPS);
    setSwitch(game.battle!, 21, true);
    until(game, world, () => bombOf(game) !== undefined, 300);
    const bomb = bombOf(game)!;
    expect([bomb.z, bomb.angle]).toEqual([SHADOW_HEIGHT + BOMB_HOLD, Math.trunc(BIG_BOMB_SIZE / BIG_BOMB_GROW)]); // (traced: 0.0094 on its first frame)
    run(game, world, BIG_BOMB_GROW - 1);
    expect([bomb.param, bomb.angle]).toEqual([BIG_BOMB.waiting, BIG_BOMB_SIZE]); // 0.75 (traced: +0x254)
    const flying = until(game, world, () => bomb.param === BIG_BOMB.flying, 20);
    expect(flying).toBe(8);
    expect(until(game, world, () => bomb.z === 0, 60)).toBe(47); // (traced: z 70.4 → 0 over frames 364-411)
    // Landing, it asks the TV's window for "A giant bomb! Escape to your Game Boy Advance!" (BBMB 0x80342E10).
    expect(game.battle!.messages).toEqual([{ id: MESSAGE.giantBomb, player: -1, tick: game.tick }]);
    until(game, world, () => bomb.param === BIG_BOMB.burning, 20);
    expect(bomb.timer).toBe(BIG_BOMB_FUSE);
  });

  it("goes off after its fuse: every Link on the TV out, one in a side room spared; a hit takes 60 off the fuse", () => {
    const game = start(world, [{ x: 60, y: 200, facing: "right" }, { x: 260, y: 200, facing: "left" }, { x: 100, y: 120, facing: "down" }], PROPS);
    setSwitch(game.battle!, 21, true);
    until(game, world, () => bombOf(game)?.param === BIG_BOMB.burning, 500);
    const bomb = bombOf(game)!;
    game.players[2]!.y += sideRoomY(1) * SUBPX; // P3 in the side room
    // P1 under the bomb, hitting it: 60 ticks off its fuse each time, then 15 it ignores hits.
    game.players[0]!.x = bomb.x - 30 * SUBPX;
    game.players[0]!.y = bomb.y;
    game.players[0]!.facing = "right";
    const t0 = bomb.timer;
    stepGame(game, [Button.Right], world);
    stepGame(game, [Button.Right | Button.Sword], world);
    until(game, world, () => bomb.timer < t0 - 30, 20);
    expect(bomb.timer).toBeGreaterThan(t0 - 2 - BIG_BOMB_HIT - 10);
    until(game, world, () => bomb.hp < 0, BIG_BOMB_FUSE);
    const b = game.battle!;
    expect(b.fighters.map((f) => f.hearts > 0)).toEqual([false, false, true]);
    expect(b.entities.some((e) => e.kind === "explosion")).toBe(true); // its flash
    expect(shadowOf(game).param).toBe(SHADOW.away);
  });

  it("comes back 300 ticks after his bomb is gone, once his switch is on again, with a new one", () => {
    const game = start(world, [{ x: 60, y: 200, facing: "right" }, { x: 260, y: 200, facing: "left" }], { ...PROPS, sideRooms: 0 });
    const e = shadowOf(game);
    setSwitch(game.battle!, 21, true);
    // Keep the Links out of the blast's way: send them to the side room.
    until(game, world, () => e.param === SHADOW.away, 500);
    game.players.forEach((p) => (p.y += sideRoomY(1) * SUBPX));
    until(game, world, () => e.param === SHADOW.resting, BIG_BOMB_FUSE + 100);
    setSwitch(game.battle!, 21, false);
    run(game, world, 320);
    expect(e.param).toBe(SHADOW.resting);
    setSwitch(game.battle!, 21, true);
    stepGame(game, [], world);
    expect(e.param).toBe(SHADOW.back);
    until(game, world, () => e.param === SHADOW.holding, 61);
    expect(bombOf(game)).toBeDefined();
  });

  it("is deterministic: a clone and a JSON copy replay to the same hashes", () => {
    const game = start(world, [{ x: 60, y: 200, facing: "right" }, { x: 260, y: 200, facing: "left" }], PROPS);
    setSwitch(game.battle!, 21, true);
    run(game, world, 330);
    const mid = cloneGame(game), copy = JSON.parse(JSON.stringify(game)) as GameState;
    const a: number[] = [], b: number[] = [], c: number[] = [];
    for (let t = 0; t < 800; t++) {
      const buttons = [t % 50 < 25 ? Button.Right : Button.Left, t % 7 ? 0 : Button.Sword];
      stepGame(game, buttons, world);
      stepGame(mid, buttons, world);
      stepGame(copy, buttons, world);
      a.push(hashGame(game));
      b.push(hashGame(mid));
      c.push(hashGame(copy));
    }
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });
});

void arena;
