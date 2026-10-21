import { describe, expect, it } from "vitest";
import { BOOTS } from "./attacks.ts";
import type { Fighter } from "./combat.ts";
import type { GameState } from "./game.ts";
import { STUN_INVINCIBLE_TICKS, STUN_TICKS } from "./combat.ts";
import { isRemoved, spawnEntity, TILE, ROOM_TILES_X } from "./entities.ts";
import { Button, SUBPX } from "./player.ts";
import { newSoldier } from "./strike.ts";
import type { ArenaProps } from "./props.ts";
import { switchOn } from "./switches.ts";
import { arena, run, start, until } from "./testarena.ts";

const fighter = (game: GameState, i: number): Fighter => game.battle!.fighters[i]!;
const x = (game: GameState, i: number) => game.players[i]!.x / SUBPX;

describe("the Pegasus Boots", () => {
  it("stand 10 ticks after the press, then dash 3 px a tick while the button is held", () => {
    const world = arena();
    const game = start(world, [{ x: 40, y: 100, facing: "right" }, { x: 40, y: 200, facing: "up" }]);
    fighter(game, 0).item = "boots";
    run(game, world, 1 + BOOTS.charge, [Button.Item, 0]);
    expect(x(game, 0)).toBe(40);
    run(game, world, 4, [Button.Item, 0]);
    expect(x(game, 0)).toBe(52);
    // Let go: he moves on that tick and the next, then stands.
    run(game, world, 4);
    expect(x(game, 0)).toBe(58);
    expect(fighter(game, 0).move).toBe("none");
  });

  it("hit a Link in the way for 3, and crash into a wall: thud switches near it, Links standing near it hop", () => {
    const world = arena([30, 10, 2, 6, "#"]);
    const dosn: ArenaProps = { actors: [{ id: "DOSN", x: 200, y: 100, params: 4 << 27 }], bushes: [] };
    const game = start(world, [{ x: 160, y: 100, facing: "right" }, { x: 200, y: 140, facing: "up" }, { x: 210, y: 100, facing: "up" }], dosn);
    fighter(game, 0).item = "boots";
    fighter(game, 2).hearts = 12;
    until(game, world, () => fighter(game, 2).mode === "hurt", 30, [Button.Item, 0, 0]);
    expect(fighter(game, 2).hearts).toBe(12 - BOOTS_DAMAGE);
    until(game, world, () => fighter(game, 0).move === "crash", 30, [Button.Item, 0, 0]);
    run(game, world, 2, [Button.Item, 0, 0]);
    expect(switchOn(game.battle!, 4)).toBe(true);
    expect(fighter(game, 1).move).toBe("jolt");
    until(game, world, () => fighter(game, 0).move === "none", 40);
    expect(x(game, 0)).toBeLessThan(240 - 7 - 1);
  });

  it("the dash strikes what a sword strikes: pots, orbs and bushes break, a soldier takes the dash's power", () => {
    const world = arena();
    const bush = Math.floor(100 / TILE) * ROOM_TILES_X + Math.floor(150 / TILE); // the bush tile at (150, 100)
    const game = start(world, [{ x: 40, y: 100, facing: "right" }, { x: 40, y: 200, facing: "up" }], { actors: [], bushes: [bush] });
    const b = game.battle!;
    const pot = spawnEntity(b, "pot", 80 * SUBPX, 100 * SUBPX);
    const orb = spawnEntity(b, "orb", 110 * SUBPX, 104 * SUBPX);
    const soldier = spawnEntity(b, "soldier", 200 * SUBPX, 100 * SUBPX, newSoldier(4)); // a 16-life one
    fighter(game, 0).item = "boots";
    run(game, world, 1 + BOOTS.charge, [Button.Item, 0]);
    expect(isRemoved(pot)).toBe(false); // standing: his boxes reach 32 px ahead, the pot is 40 off
    until(game, world, () => isRemoved(pot), 10, [Button.Item, 0]);
    until(game, world, () => isRemoved(orb), 15, [Button.Item, 0]);
    until(game, world, () => b.cut.includes(bush), 15, [Button.Item, 0]);
    until(game, world, () => soldier.phase === "stun", 30, [Button.Item, 0]);
    expect(soldier.hp).toBe(16 - 6); // power 6: a Link's 3, doubled for an enemy (strike.ts)
  });

  it("a crash with level-2 boots makes Links hop within 100 px, who land dizzy (the seed's stun)", () => {
    const world = arena([30, 10, 2, 6, "#"]);
    // P2 75 px from where P1 crashes (232, 100), P3 110 px off.
    const game = start(world, [{ x: 160, y: 100, facing: "right" }, { x: 232, y: 175, facing: "up" }, { x: 232, y: 210, facing: "up" }]);
    fighter(game, 0).item = "boots";
    fighter(game, 0).itemLevel = 2;
    until(game, world, () => fighter(game, 0).move === "crash", 40, [Button.Item, 0, 0]);
    run(game, world, 2);
    expect(fighter(game, 1).move).toBe("jolt");
    expect(fighter(game, 2).move).toBe("none");
    until(game, world, () => fighter(game, 1).mode === "stunned", 40);
    expect(fighter(game, 1).move).toBe("none");
    until(game, world, () => fighter(game, 1).mode === "active", STUN_TICKS + 2);
    expect(fighter(game, 1).invincible).toBe(STUN_INVINCIBLE_TICKS - 1);
  });
});

const BOOTS_DAMAGE = 3;
