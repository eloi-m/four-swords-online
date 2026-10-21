import { describe, expect, it } from "vitest";
import { linkFrame } from "./actions.ts";
import { BLAST_HALF, BLAST_KNOCK, BOMB_DAMAGE, BOMB_FUSE, bombFlashing, EXPLOSION_HURT_TICKS, EXPLOSION_TICKS } from "./bombs.ts";
import { LIFT_TICKS } from "./carry.ts";
import { fighterFrame, HEART, SHOVE_STOP_TICKS, PIN_DAMAGE, PIN_TICKS, SWORD_DAMAGE, vulnerable, type Fighter } from "./combat.ts";
import { spawnEntity, type Entity } from "./entities.ts";
import type { GameState } from "./game.ts";
import { CUCCO_STEAL, CUCCO_TURN, spawnCucco } from "./cucco.ts";
import { EPONA_MOUNT_TICKS, EPONA_TICKS, startRide, TRAMPLE_DAMAGE } from "./epona.ts";
import { BOMB_PLACE_DISTANCE, isDrawn, USE_TICKS } from "./items.ts";
import { RIDE, USE, USE_RELEASE_TICK } from "./moveframes.ts";
import { giveItem, maskItems, ORB_FIRST_TICKS, ORB_HEAD_START, ORB_ITEMS, ORB_LIFETIME, ORB_RESPAWN_TICKS, ORB_SHORT_TICKS, PICKUP_TICKS } from "./orbs.ts";
import { Button, SUBPX } from "./player.ts";
import { ARROW_DAMAGE, ARROW_SPEED, ARROW_STUCK_TICKS, BOOMERANG_RETURN_SPEED, BOOMERANG_SPEED, DRAWN_SEED_DAMAGE, SEED_DAMAGE, SEED_SIDE, SEED_SPEED, SEED_TICKS } from "./projectiles.ts";
import type { ArenaProps } from "./props.ts";
import { arena, press, px, run, RULES, start, until } from "./testarena.ts";

const FULL = RULES.hearts * HEART;
const of = (game: GameState, kind: Entity["kind"]) => game.battle!.entities.filter((e) => e.kind === kind);
const fighter = (game: GameState, i: number): Fighter => game.battle!.fighters[i]!;

describe("item orbs", () => {
  const props: ArenaProps = { actors: [{ id: "CRGN", x: 160, y: 100, params: 1 }], bushes: [] };

  it("appear at their generator, break under the sword, and give their item to whoever touches it", () => {
    const world = arena();
    const game = start(world, [{ x: 142, y: 100, facing: "right" }, { x: 60, y: 200, facing: "up" }], props, RULES, 1234);
    expect(of(game, "orb")).toEqual([]);
    run(game, world, ORB_FIRST_TICKS - 1);
    expect(of(game, "orb")).toEqual([]);
    run(game, world, 1);
    const [orb] = of(game, "orb");
    expect([px(orb!.x), px(orb!.y), orb!.home]).toEqual([160, 100, 0]);
    expect(ORB_ITEMS).toContain(orb!.item);
    orb!.item = "bow"; // (a heart would heal on the spot instead of being held)
    press(game, world, 0, Button.Sword); // a stab
    until(game, world, () => of(game, "pickup").length > 0, 10);
    const [pickup] = of(game, "pickup");
    expect([pickup!.item, pickup!.timer <= PICKUP_TICKS]).toEqual(["bow", true]);
    expect(game.battle!.respawn[0]).toBe(0); // its generator notices on the next tick
    run(game, world, 1);
    expect(game.battle!.respawn[0]).toBe(ORB_RESPAWN_TICKS);
    until(game, world, () => fighter(game, 0).item !== "", 40, [Button.Right]);
    expect(fighter(game, 0).item).toBe("bow");
    expect(of(game, "pickup")).toEqual([]);
  });

  it("the item inside depends only on the battle's seed, drawn from the multiplayer roulette", () => {
    const world = arena();
    const items = (seed: number) => {
      const game = start(world, [{ x: 60, y: 100, facing: "right" }, { x: 60, y: 200, facing: "up" }], props, RULES, seed);
      run(game, world, ORB_FIRST_TICKS);
      return of(game, "orb")[0]!.item;
    };
    expect(items(5)).toBe(items(5));
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(items))).toEqual(new Set(["carrot", "cucco", "bombchu"]));
  });

  it("the generators' item masks and the roulette, as main.dol's tables have them", () => {
    expect(maskItems(0x1e2)).toEqual(["slingshot", "boomerang", "bow", "bomb"]); // Tower of Flames, Above the Clouds
    expect(maskItems(0x8a2)).toEqual(["slingshot", "bow"]); // Tower of Winds (+ Roc's Feather)
    expect(maskItems(0x1182)).toEqual(["bow", "bomb", "boots"]); // The Field
    expect(maskItems(0x9e2)).toEqual(["slingshot", "boomerang", "bow", "bomb"]); // the Dark Clouds (+ Roc's Feather)
    expect(maskItems(0x97e2)).toEqual(["slingshot", "boomerang", "bow", "bomb", "fireRod", "hammer", "boots", "fourSword"]); // the castle's GBA rooms
    expect(maskItems(0x1)).toEqual(["slingshot"]); // an empty mask
    expect(ORB_ITEMS).toEqual(["carrot", "cucco", "bombchu", "cucco", "bombchu", "cucco", "bombchu"]); // table 4
  });

  it("a kind-2 generator leaves an item from its mask on the ground, and waits until it's gone", () => {
    const world = arena();
    const items: ArenaProps = { actors: [{ id: "CRGN", x: 160, y: 100, params: 0x1e2 }], bushes: [] };
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 60, y: 200, facing: "up" }], items, RULES, 77);
    run(game, world, ORB_SHORT_TICKS - ORB_HEAD_START - 1);
    expect(of(game, "pickup")).toEqual([]);
    run(game, world, 1);
    const [pickup] = of(game, "pickup");
    // (Its 600 ticks count the one it appears on, like the game's LSTI: 599 left.)
    expect([px(pickup!.x), pickup!.home, pickup!.timer, of(game, "orb").length]).toEqual([160, 0, PICKUP_TICKS - 1, 0]);
    expect(maskItems(0x1e2)).toContain(pickup!.item);
    run(game, world, 100);
    expect(game.battle!.respawn[0]).toBe(0); // nothing new while it lies there
    // Walking onto it only pushes it on; Action facing it takes it.
    until(game, world, () => px(game.players[0]!.x) >= 160 - 13, 60, [Button.Right]);
    expect(fighter(game, 0).item).toBe("");
    press(game, world, 0, Button.Action);
    expect([of(game, "pickup").length, game.battle!.respawn[0]]).toEqual([0, 0]);
    run(game, world, 1);
    expect(game.battle!.respawn[0]).toBe(ORB_SHORT_TICKS); // it noticed a tick later
    until(game, world, () => fighter(game, 0).item !== "", 50);
    expect([fighter(game, 0).item, fighter(game, 0).itemLevel]).toEqual([pickup!.item, pickup!.param]);
  });

  it("an orb nobody picks up goes away, and its generator starts over", () => {
    const world = arena();
    const game = start(world, [{ x: 60, y: 100, facing: "right" }, { x: 60, y: 200, facing: "up" }], props);
    // Measured (The Field): an orb on frame 458 lies there 899 frames (its first counts), the next comes on 1958.
    run(game, world, ORB_FIRST_TICKS + ORB_LIFETIME - 2);
    expect(of(game, "orb")).toHaveLength(1);
    run(game, world, 1);
    expect([of(game, "orb").length, game.battle!.respawn[0]]).toEqual([0, 0]);
    run(game, world, 1);
    expect(game.battle!.respawn[0]).toBe(ORB_RESPAWN_TICKS); // the generator noticed
    run(game, world, ORB_RESPAWN_TICKS - 1);
    expect(of(game, "orb")).toHaveLength(0);
    run(game, world, 1);
    expect(of(game, "orb")).toHaveLength(1); // ORB_LIFETIME + ORB_RESPAWN_TICKS after the first
  });

  it("can be lifted and thrown; it breaks where it lands", () => {
    const world = arena();
    const game = start(world, [{ x: 144, y: 100, facing: "right" }, { x: 60, y: 200, facing: "up" }], props);
    run(game, world, ORB_FIRST_TICKS);
    until(game, world, () => of(game, "orb")[0]!.phase === "rest", 40); // (it drops into place first)
    of(game, "orb")[0]!.x = 160 * SUBPX; // (and drifts)
    of(game, "orb")[0]!.y = 100 * SUBPX;
    of(game, "orb")[0]!.item = "carrot"; // (it lies where the orb broke)
    press(game, world, 0, Button.Action);
    expect(of(game, "orb")[0]!.phase).toBe("held");
    run(game, world, LIFT_TICKS + 1);
    press(game, world, 0, Button.Action);
    until(game, world, () => of(game, "pickup").length > 0, 40);
    expect(px(of(game, "pickup")[0]!.x)).toBe(144 + 80);
  });

  it("a heart heals one heart on the spot", () => {
    const world = arena();
    const game = start(world, [{ x: 60, y: 100, facing: "right" }, { x: 60, y: 200, facing: "up" }]);
    fighter(game, 0).hearts = FULL - 6;
    spawnEntity(game.battle!, "pickup", 70 * SUBPX, 100 * SUBPX, { item: "heart", timer: PICKUP_TICKS });
    run(game, world, 4, [Button.Right]);
    expect([fighter(game, 0).hearts, fighter(game, 0).item]).toEqual([FULL - 6 + HEART, ""]);
  });
});

describe("bombs", () => {
  it("Item puts a lit bomb down 13 px in front with no pose; the blast hurts everyone within ±16 px", () => {
    const world = arena();
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 125, y: 100, facing: "up" }]);
    giveItem(fighter(game, 0), "bomb");
    press(game, world, 0, Button.Item);
    const [bomb] = of(game, "bomb");
    expect([fighter(game, 0).move, bomb!.phase, bomb!.timer, bomb!.owner, px(bomb!.x)]).toEqual(["none", "rest", BOMB_FUSE - 1, 0, 100 + BOMB_PLACE_DISTANCE]);
    for (let n = 0; n < 2; n++) {
      run(game, world, 1);
      press(game, world, 0, Button.Item);
    }
    expect(of(game, "bomb").length).toBe(2); // two at a time
    run(game, world, 30, [Button.Left]); // the bomber walks away
    until(game, world, () => of(game, "explosion").length > 0, BOMB_FUSE);
    expect(fighter(game, 1).hearts).toBe(FULL);
    run(game, world, 1); // the blast hurts from the tick after it appears (traced)
    expect(fighter(game, 1).hearts).toBe(FULL - BOMB_DAMAGE);
    expect([fighter(game, 1).mode, fighter(game, 1).vz, fighter(game, 1).pushX]).toEqual(["hurt", BLAST_KNOCK.hop, BLAST_KNOCK.speed]);
    expect(fighter(game, 0).hearts).toBe(FULL);
    expect(game.battle!.hits).toContainEqual({ attacker: 0, victim: 1, blocked: false, damage: BOMB_DAMAGE, cause: "bomb" });
    run(game, world, EXPLOSION_TICKS); // the second bomb went off with the first one (in its blast)
    expect(of(game, "explosion")).toEqual([]);
    expect(BLAST_HALF).toBe(16);
  });

  it("a bomb can be lifted and thrown: 6 px/tick for 16 ticks, one bounce, then it lies there burning", () => {
    const world = arena();
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 60, y: 200, facing: "up" }]);
    giveItem(fighter(game, 0), "bomb");
    press(game, world, 0, Button.Item);
    press(game, world, 0, Button.Action);
    expect(fighter(game, 0).move).toBe("lift");
    run(game, world, LIFT_TICKS + 1);
    press(game, world, 0, Button.Action);
    until(game, world, () => of(game, "bomb")[0]!.phase === "flying", 12);
    const bomb = of(game, "bomb")[0]!;
    const from = bomb.x - bomb.vx;
    expect(1 + until(game, world, () => bomb.param === 2, 20)).toBe(16); // lands on its 16th tick, 96 px out
    expect(px(bomb.x - from)).toBe(96);
    expect(until(game, world, () => bomb.phase === "rest", 20)).toBe(7); // the bounce
    expect([bomb.z, bomb.timer > 0, px(bomb.x) - 100]).toEqual([0, true, 96 + 12]);
  });

  it("a bomb that goes off in your hands hurts you", () => {
    const world = arena();
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 60, y: 200, facing: "up" }]);
    giveItem(fighter(game, 0), "bomb");
    press(game, world, 0, Button.Item);
    press(game, world, 0, Button.Action);
    until(game, world, () => fighter(game, 0).mode === "hurt", BOMB_FUSE + 2);
    expect([fighter(game, 0).hearts, fighter(game, 0).carryEntity]).toEqual([FULL - BOMB_DAMAGE, 0]);
  });

  it("a blast sets off the bombs its box meets at once, in a chain, and cuts bushes", () => {
    const world = arena();
    const props: ArenaProps = {
      actors: [
        { id: "HBMB", x: 200, y: 100, params: 0x101 },
        { id: "HBMB", x: 212, y: 100, params: 0x101 },
        { id: "HBMB", x: 224, y: 100, params: 0x101 },
        { id: "HBMB", x: 251, y: 100, params: 0x101 }, // 27 px on: ±10 against ±16 doesn't meet
      ],
      bushes: [7 * 32 + 12], // tile (192, 112), within 16 px of the first bomb
    };
    const game = start(world, [{ x: 60, y: 100, facing: "right" }, { x: 60, y: 200, facing: "up" }], props);
    const bombs = of(game, "bomb");
    expect(bombs.map((b) => b.timer)).toEqual([0, 0, 0, 0]); // socket bombs aren't lit
    bombs[0]!.timer = 1;
    run(game, world, 1);
    expect(of(game, "explosion").map((e) => e.tick)).toEqual([1, 1, 1]); // the same tick (traced)
    expect(of(game, "bomb").map((b) => px(b.x))).toEqual([251]);
    run(game, world, 1);
    expect(game.battle!.cut).toEqual([7 * 32 + 12]);
    run(game, world, EXPLOSION_HURT_TICKS);
    expect(of(game, "bomb").length).toBe(1); // the blasts stop setting bombs off with their hurting ticks
    expect(bombFlashing(BOMB_FUSE - 1)).toBe(false);
    // The flash (HBMB +0x24C, traced): fuse 91–84 lit, 83–76 not …, then every 4 ticks from 46.
    const lit = (fuse: number) => bombFlashing(fuse + 1);
    expect([100, 92, 91, 84, 83, 76, 75, 52, 51, 47, 46, 43, 42, 38, 3, 2, 0].map(lit)).toEqual(
      [false, false, true, true, false, false, true, true, false, false, true, true, false, true, true, false, false],
    );
  });
});

describe("shooting items", () => {
  it("the bow: a 14-tick pose, the arrow leaves on the 7th tick at 5 px/tick; it hurts from the side, the shield stops it", () => {
    const world = arena();
    const game = start(world, [{ x: 60, y: 100, facing: "right" }, { x: 160, y: 100, facing: "up" }]);
    giveItem(fighter(game, 0), "bow");
    press(game, world, 0, Button.Item);
    expect(fighter(game, 0).move).toBe("use");
    run(game, world, USE_RELEASE_TICK);
    expect(of(game, "arrow")).toEqual([]);
    expect(fighterFrame(game.players[0]!, fighter(game, 0), linkFrame)).toBe(USE.bow.frames.right[1]); // the drawn bow (335)
    run(game, world, 1);
    const [arrow] = of(game, "arrow");
    expect([arrow!.vx, arrow!.vy, px(arrow!.x), px(arrow!.y)]).toEqual([ARROW_SPEED, 0, 65, 96]); // at Link + (5, -4), flying from the next tick
    until(game, world, () => fighter(game, 1).mode === "hurt", 40);
    expect(fighter(game, 1).hearts).toBe(FULL - ARROW_DAMAGE);
    expect(of(game, "arrow")).toEqual([]);
    run(game, world, USE_TICKS.bow);
    expect(fighter(game, 0).move).toBe("none");

    const blocked = start(world, [{ x: 60, y: 100, facing: "right" }, { x: 160, y: 100, facing: "left" }]);
    giveItem(fighter(blocked, 0), "bow");
    press(blocked, world, 0, Button.Item);
    until(blocked, world, () => fighter(blocked, 1).guard > 0, 40);
    expect([fighter(blocked, 1).hearts, fighter(blocked, 1).mode]).toEqual([FULL, "active"]);
  });

  it("an arrow that misses sticks in the wall for 35 ticks", () => {
    const world = arena();
    const game = start(world, [{ x: 60, y: 100, facing: "right" }, { x: 60, y: 200, facing: "up" }]);
    giveItem(fighter(game, 0), "bow");
    press(game, world, 0, Button.Item);
    until(game, world, () => of(game, "arrow")[0]?.phase === "rest", 80);
    expect(px(of(game, "arrow")[0]!.x)).toBeLessThan(312);
    run(game, world, ARROW_STUCK_TICKS);
    expect(of(game, "arrow")).toEqual([]);
  });

  it("the slingshot fires one seed that comes down after 19 ticks; a seed stuns a Link", () => {
    const world = arena();
    const game = start(world, [{ x: 60, y: 100, facing: "right" }, { x: 140, y: 104, facing: "up" }]);
    giveItem(fighter(game, 0), "slingshot");
    press(game, world, 0, Button.Item);
    run(game, world, USE_RELEASE_TICK + 1);
    expect(of(game, "seed").map((s) => [s.vx, s.vy, s.param])).toEqual([[SEED_SPEED, 0, 0]]);
    until(game, world, () => fighter(game, 1).mode === "stunned", SEED_TICKS);
    expect([fighter(game, 1).hearts, SEED_DAMAGE]).toEqual([FULL, 0]); // traced: a quick seed only stuns
    run(game, world, SEED_TICKS + 1);
    expect(of(game, "seed")).toEqual([]); // (how long the stun lasts: battle-measured.test.ts, the "seed" trace)
  });

  it("held, the bow and the slingshot draw: the Link walks, the shot leaves when it's let go; drawn shots", () => {
    const world = arena();
    // The bow at level 1 draws in 54 ticks (pose ticks 7…54 of the counter), at level 2 in 30.
    expect([isDrawn({ item: "bow", itemLevel: 1 }, 52), isDrawn({ item: "bow", itemLevel: 1 }, 53)]).toEqual([false, true]);
    expect([isDrawn({ item: "bow", itemLevel: 2 }, 28), isDrawn({ item: "bow", itemLevel: 2 }, 29)]).toEqual([false, true]);
    expect([isDrawn({ item: "slingshot", itemLevel: 2 }, 52), isDrawn({ item: "slingshot", itemLevel: 2 }, 53)]).toEqual([false, true]);
    const game = start(world, [{ x: 60, y: 100, facing: "right" }, { x: 160, y: 100, facing: "up" }]);
    giveItem(fighter(game, 0), "bow", undefined, 2);
    run(game, world, 10, [Button.Item]);
    run(game, world, 10, [Button.Item | Button.Down]);
    expect([game.players[0]!.facing, game.players[0]!.y]).toEqual(["right", 100 * SUBPX + 10 * 288]); // the charge's 1.125 px/tick
    run(game, world, 10, [Button.Item | Button.Up]);
    expect(of(game, "arrow")).toEqual([]);
    run(game, world, 1); // let go on the pose's 31st tick: drawn
    expect(of(game, "arrow").map((a) => a.param)).toEqual([1]);
    until(game, world, () => fighter(game, 1).mode === "pinned", 40);
    expect([fighter(game, 1).hearts, fighter(game, 1).invincible]).toEqual([FULL - PIN_DAMAGE, 180]);
    const arrow = of(game, "arrow")[0]!;
    run(game, world, 3);
    expect([game.players[1]!.x, game.players[1]!.facing]).toEqual([arrow.x - arrow.vx, "left"]); // riding the arrow
    run(game, world, PIN_TICKS);
    expect(fighter(game, 1).mode).toBe("active");

    // A level-2 drawn shot from the slingshot: three seeds, 45° apart; a drawn seed hurts.
    const sling = start(world, [{ x: 60, y: 100, facing: "right" }, { x: 120, y: 100, facing: "up" }]);
    giveItem(fighter(sling, 0), "slingshot", undefined, 2);
    run(sling, world, 54, [Button.Item]);
    run(sling, world, 1);
    expect(of(sling, "seed").map((s) => [s.vx, s.vy])).toEqual([[SEED_SPEED, 0], [SEED_SIDE, -SEED_SIDE], [SEED_SIDE, SEED_SIDE]]);
    until(sling, world, () => fighter(sling, 1).mode === "hurt", 20);
    expect(fighter(sling, 1).hearts).toBe(FULL - DRAWN_SEED_DAMAGE);
  });

  it("the boomerang goes out about 115 px, homes back to its thrower, and fetches an item on the way", () => {
    const world = arena();
    const game = start(world, [{ x: 60, y: 100, facing: "right" }, { x: 60, y: 200, facing: "up" }]);
    giveItem(fighter(game, 0), "boomerang");
    press(game, world, 0, Button.Item);
    run(game, world, USE_RELEASE_TICK + 1);
    press(game, world, 0, Button.Item); // one at a time
    expect(of(game, "boomerang").length).toBe(1);
    const boomerang = of(game, "boomerang")[0]!;
    until(game, world, () => boomerang.phase === "return", 80);
    expect(px(boomerang.x) - 60).toBeGreaterThan(100); // 6 + 4 × 6 + 79.8 (the slowdown) + 6.6 (the ×0.9)
    expect(px(boomerang.x) - 60).toBeLessThan(120);
    until(game, world, () => boomerang.hp < 0, 60);
    expect(BOOMERANG_RETURN_SPEED).toBe(1485);

    const fetch = start(world, [{ x: 60, y: 100, facing: "right" }, { x: 60, y: 200, facing: "up" }]);
    giveItem(fighter(fetch, 0), "boomerang");
    spawnEntity(fetch.battle!, "pickup", 110 * SUBPX, 100 * SUBPX, { item: "bow", timer: PICKUP_TICKS, param: 1 }); // (a generator's)
    press(fetch, world, 0, Button.Item);
    until(fetch, world, () => of(fetch, "pickup").length === 0, 40);
    until(fetch, world, () => of(fetch, "boomerang").length === 0, 60);
    expect(fighter(fetch, 0).item).toBe("bow");
  });

  it("the Four Sword levels the sword up for the round (+1 damage), the item in hand kept", () => {
    const world = arena();
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 116, y: 100, facing: "up" }]);
    giveItem(fighter(game, 0), "bow");
    giveItem(fighter(game, 0), "fourSword");
    expect([fighter(game, 0).item, fighter(game, 0).swordLevel]).toEqual(["bow", 2]);
    press(game, world, 0, Button.Sword);
    until(game, world, () => fighter(game, 1).mode === "hurt", 10);
    expect(fighter(game, 1).hearts).toBe(FULL - SWORD_DAMAGE - 1); // traced: a level-2 stab takes 3
  });

  it("the level-2 boomerang flies 3 px/tick faster", () => {
    const world = arena();
    const game = start(world, [{ x: 30, y: 100, facing: "right" }, { x: 60, y: 200, facing: "up" }]);
    giveItem(fighter(game, 0), "boomerang", undefined, 2);
    press(game, world, 0, Button.Item);
    run(game, world, USE_RELEASE_TICK + 1);
    const boomerang = of(game, "boomerang")[0]!;
    expect([boomerang.param, boomerang.timer]).toEqual([BOOMERANG_SPEED + 768, BOOMERANG_RETURN_SPEED + 768]);
    until(game, world, () => boomerang.phase === "return", 80);
    expect(px(boomerang.x) - 30).toBeGreaterThan(220); // traced: about 234 px
  });
});

describe("an orb's cucco and Epona", () => {
  /** An orb holding `item`, carried by P1 and thrown along his facing. */
  const throwOrb = (game: GameState, world: ReturnType<typeof arena>, item: "cucco" | "carrot") => {
    const p = game.players[0]!, [sx, sy] = [p.facing === "right" ? 16 : 0, p.facing === "up" ? -16 : 0];
    spawnEntity(game.battle!, "orb", p.x + sx * SUBPX, p.y + sy * SUBPX, { item, timer: ORB_LIFETIME });
    press(game, world, 0, Button.Action);
    run(game, world, LIFT_TICKS + 1);
    press(game, world, 0, Button.Action);
  };

  it("the cucco flies from the broken orb to the first rival in player order, takes 4 life and brings it back, up to 16", () => {
    const world = arena();
    const game = start(world, [{ x: 60, y: 100, facing: "right" }, { x: 200, y: 140, facing: "up" }, { x: 60, y: 200, facing: "up" }]);
    fighter(game, 1).hearts = FULL - 2; // (not the leader, nor the nearest: traced, P2 all the same)
    throwOrb(game, world, "cucco");
    until(game, world, () => of(game, "cucco").length > 0, 40);
    const [cucco] = of(game, "cucco");
    expect([cucco!.owner, cucco!.vx > Math.abs(cucco!.vy)]).toEqual([0, true]); // on the way the orb flew, turning
    until(game, world, () => fighter(game, 1).mode === "hurt", 200);
    expect([cucco!.target, fighter(game, 1).hearts, game.battle!.hits.at(-1)?.cause]).toEqual([1, FULL - 2 - CUCCO_STEAL, "cucco"]);
    expect(Math.hypot(cucco!.vx, cucco!.vy)).toBeGreaterThan(2.8 * SUBPX); // up to 3 px/tick
    until(game, world, () => fighter(game, 0).hearts > FULL, 300);
    expect(fighter(game, 0).hearts).toBe(FULL + CUCCO_STEAL); // traced: 12 → 16
    until(game, world, () => of(game, "cucco").length === 0, 40);
  });

  it("the cucco's heading turns toward its rival by 22.5° at most, every 2 to 9 ticks (main.dol)", () => {
    const world = arena();
    const game = start(world, [{ x: 60, y: 100, facing: "right" }, { x: 160, y: 200, facing: "up" }]);
    const cucco = spawnCucco(game.battle!, 100 * SUBPX, 100 * SUBPX, 0, SUBPX, 0); // flying right, its rival down-right
    const turns: [number, number][] = []; // (tick, heading change) at each re-aim (its counter set again)
    for (let t = 0, h = cucco.homeX, n = cucco.homeY; t < 40; t++) {
      run(game, world, 1);
      if (cucco.homeY > n) turns.push([t, (((cucco.homeX - h) & 0xffff) << 16) >> 16]);
      [h, n] = [cucco.homeX, cucco.homeY];
    }
    expect(turns.length).toBeGreaterThan(3);
    for (const [, d] of turns) expect(Math.abs(d)).toBeLessThanOrEqual(CUCCO_TURN);
    expect(turns.some(([, d]) => Math.abs(d) === CUCCO_TURN)).toBe(true);
    turns.slice(1).forEach(([t], k) => expect(t - turns[k]![0]).toBeGreaterThanOrEqual(2));
    turns.slice(1).forEach(([t], k) => expect(t - turns[k]![0]).toBeLessThanOrEqual(9));
  });

  it("the carrot: touched, Epona: a 56-tick mount, then the gallop on the way he faces, 360 ticks in all", () => {
    const world = arena();
    const game = start(world, [{ x: 60, y: 100, facing: "up" }, { x: 200, y: 200, facing: "left" }]);
    spawnEntity(game.battle!, "pickup", 60 * SUBPX, 90 * SUBPX, { item: "carrot", timer: PICKUP_TICKS });
    run(game, world, 1);
    expect(fighter(game, 0).move).toBe("ride");
    expect(fighterFrame(game.players[0]!, fighter(game, 0), linkFrame)).toBe(RIDE.mount[0]);
    const x0 = game.players[0]!.x;
    run(game, world, EPONA_MOUNT_TICKS - 1, [Button.Right]);
    expect([game.players[0]!.x, game.players[0]!.facing]).toEqual([x0, "right"]); // still mounting
    run(game, world, 11);
    expect(game.players[0]!.x - x0).toBe(7 * 768 + 717 + 666 + 614 + 563); // on and on, no stick needed
    expect(fighterFrame(game.players[0]!, fighter(game, 0), linkFrame)).toBe(RIDE.base.right + 1);
    until(game, world, () => fighter(game, 0).escape > 0, 200); // into the east wall: back and a stand
    expect(game.players[0]!.facing).toBe("left");
    run(game, world, EPONA_TICKS);
    expect([fighter(game, 0).move, fighter(game, 0).item]).toEqual(["none", ""]);
  });

  it("Epona tramples whoever she runs into", () => {
    const world = arena();
    const game = start(world, [{ x: 60, y: 100, facing: "right" }, { x: 140, y: 100, facing: "left" }]);
    startRide(game.players[0]!, fighter(game, 0));
    until(game, world, () => fighter(game, 1).mode === "hurt", EPONA_MOUNT_TICKS + 40);
    expect([fighter(game, 1).hearts, fighter(game, 0).hearts]).toEqual([FULL - TRAMPLE_DAMAGE, FULL]);
    // Traced (state 16): shoved on 6 px a tick on the ground until a wall stops him, then bounced back 2 px a tick
    // with a 4.0 hop, down 33 ticks later.
    const q = game.players[1]!, g = fighter(game, 1), x0 = q.x;
    run(game, world, 1);
    expect([g.z, g.shove]).toEqual([0, 1]);
    expect(q.x - x0).toBeGreaterThanOrEqual(6 * SUBPX); // (traced 6.5 on the first tick: the Links' own push on top)
    until(game, world, () => g.z > 0, 100);
    expect(g.shove).toBe(0);
    const wall = q.x + 2 * SUBPX;
    let air = 1;
    while (g.mode === "hurt" && air < 60) run(game, world, 1), air++;
    expect([air, wall - q.x]).toEqual([33, 33 * 2 * SUBPX]);
    // A rider can't be hit (traced: a stab through him did nothing).
    expect(fighter(game, 0).move === "ride" ? vulnerable(fighter(game, 0)) : false).toBe(false);
  });

  it("a Link trampled against a wall stays shoved there while Epona is on him", () => {
    const world = arena();
    const game = start(world, [{ x: 200, y: 100, facing: "right" }, { x: 300, y: 100, facing: "left" }]);
    startRide(game.players[0]!, fighter(game, 0));
    until(game, world, () => fighter(game, 1).mode === "hurt", EPONA_MOUNT_TICKS + 60);
    const g = fighter(game, 1);
    // Traced: stopped by the wall at once, he stays shoved against it while she pushes on (19 ticks there), then 3 more.
    let held = 0;
    while (g.shove && held < 60) run(game, world, 1), held++;
    expect(held).toBeGreaterThan(SHOVE_STOP_TICKS + 8); // (she slides round him as the Links push each other)
    run(game, world, 1);
    expect(g.z).toBeGreaterThan(0);
  });
});
