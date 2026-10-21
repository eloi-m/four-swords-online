// Hyrule Castle's bow soldiers, captain and ball-and-chain soldier in Shadow Battle (castlesoldiers.ts): their GEN3
// spawners, an arrow, the captain's lunge, shield and death, the ball's swing and clank, the soldier's death.
import { describe, expect, it } from "vitest";
import { BALL_KNOCK, BALL_SOLDIER, BALL_SOLDIER_DAMAGE, ballClanks, ballOf, BOWMAN, CAPTAIN, newBallSoldier, newBowSoldier, newCaptain, SOLDIER_ARROW_DAMAGE } from "./castlesoldiers.ts";
import { HEART, SWORD_DAMAGE, type Fighter } from "./combat.ts";
import { isRemoved, spawnEntity, type Entity } from "./entities.ts";
import type { GameState } from "./game.ts";
import { SUBPX } from "./player.ts";
import type { ArenaProps, Prop } from "./props.ts";
import { DEBRIS, strikeEntity } from "./strike.ts";
import { GEN3_SPAWN_TICK, setSwitch } from "./switches.ts";
import { arena, run, RULES, start, until } from "./testarena.ts";

const props = (...actors: Prop[]): ArenaProps => ({ actors, bushes: [] });
const of = (game: GameState, kind: Entity["kind"]) => game.battle!.entities.filter((e) => e.kind === kind && e.hp >= 0);
const fighter = (game: GameState, i: number): Fighter => game.battle!.fighters[i]!;
const FULL = RULES.hearts * HEART;
const FAR = { x: 300, y: 220, facing: "up" } as const;
/** The castle's spawners' kinds on switches 7 (an archer) and 9 (the captain); mode 1 as the arenas' generators. */
const BOW_GEN3: Prop = { id: "GEN3", x: 112, y: 120, params: ((7 << 27) | 0x00110008) >>> 0 };
const CAPTAIN_GEN3: Prop = { id: "GEN3", x: 200, y: 120, params: ((9 << 27) | 0x0011001d) >>> 0 };
/** The castle's ball-and-chain soldier's spawner: kind 0x15 on switch 10. */
const BALL_GEN3: Prop = { id: "GEN3", x: 160, y: 120, params: ((10 << 27) | 0x00110015) >>> 0 };

describe("Hyrule Castle's bow soldiers, captain and ball-and-chain soldier", () => {
  it("come out of their GEN3 spawners when the switch rises: an archer with 12 life, a captain with 24", () => {
    const world = arena();
    const game = start(world, [{ x: 40, y: 40, facing: "down" }, FAR], props(BOW_GEN3, CAPTAIN_GEN3));
    run(game, world, 30);
    expect([of(game, "bowSoldier").length, of(game, "captain").length]).toEqual([0, 0]);
    setSwitch(game.battle!, 7, true);
    run(game, world, GEN3_SPAWN_TICK + 1);
    const [archer] = of(game, "bowSoldier");
    expect([of(game, "bowSoldier").length, archer!.hp]).toEqual([1, BOWMAN.life]);
    expect(Math.hypot(archer!.x / SUBPX - 112, archer!.y / SUBPX - 120)).toBeLessThan(2); // (walking off from there)
    expect(of(game, "captain")).toEqual([]);
    setSwitch(game.battle!, 9, true);
    run(game, world, GEN3_SPAWN_TICK + 1);
    const [captain] = of(game, "captain");
    expect([of(game, "captain").length, captain!.hp]).toEqual([1, 2 * CAPTAIN.life[0]!]);
    expect(Math.hypot(captain!.x / SUBPX - 200, captain!.y / SUBPX - 120)).toBeLessThan(2);
    // Once per rising edge.
    run(game, world, 30);
    expect([of(game, "bowSoldier").length, of(game, "captain").length]).toEqual([1, 1]);
  });

  it("an archer that sees a Link closes in and shoots: the arrow takes 2 (and a sword knocks it out)", () => {
    const world = arena();
    // P1 sideways (his shield doesn't face the arrow) 60 px below an archer looking down.
    const game = start(world, [{ x: 160, y: 160, facing: "left" }, FAR]);
    const b = game.battle!;
    const archer = spawnEntity(b, "bowSoldier", 160 * SUBPX, 100 * SUBPX, { ...newBowSoldier(b, 0), facing: "down" });
    run(game, world, 1);
    expect(archer.phase).toBe("chase");
    until(game, world, () => of(game, "soldierArrow").length > 0, 200);
    const [arrow] = of(game, "soldierArrow");
    expect([arrow!.vx, arrow!.vy]).toEqual([0, BOWMAN.arrowSpeed]);
    expect(archer.y).toBeLessThan(100 * SUBPX); // (backing off toward 70 px above him, shooting when its first shot is due)
    until(game, world, () => fighter(game, 0).mode === "hurt", 60);
    expect(b.hits.find((h) => h.victim === 0)).toMatchObject({ damage: SOLDIER_ARROW_DAMAGE, cause: "arrow", attacker: -1 });
    expect(fighter(game, 0).hearts).toBe(FULL - SOLDIER_ARROW_DAMAGE);
    expect(of(game, "soldierArrow")).toEqual([]);
    // An arrow struck out of the air is gone.
    const loose = spawnEntity(b, "soldierArrow", 100 * SUBPX, 40 * SUBPX, { phase: "flying", vx: BOWMAN.arrowSpeed });
    expect(strikeEntity(b, loose, SWORD_DAMAGE, 90 * SUBPX, 40 * SUBPX)).toBe(true);
    expect(isRemoved(loose)).toBe(true);
  });

  it("an arrow stops at a wall after its first 5 ticks", () => {
    const world = arena([20, 1, 1, 28, "#"]); // a wall at x 160-167
    const game = start(world, [{ x: 40, y: 220, facing: "up" }, FAR]);
    const arrow = spawnEntity(game.battle!, "soldierArrow", 120 * SUBPX, 40 * SUBPX, { phase: "flying", facing: "right", vx: BOWMAN.arrowSpeed });
    until(game, world, () => isRemoved(arrow) || !game.battle!.entities.includes(arrow), 40);
    expect(arrow.x / SUBPX).toBeGreaterThanOrEqual(160);
    expect(arrow.x / SUBPX).toBeLessThan(168);
  });

  it("the captain winds up 47 ticks for a Link within 80 px, then lunges: 4", () => {
    const world = arena();
    const game = start(world, [{ x: 160, y: 160, facing: "left" }, FAR]);
    const b = game.battle!;
    const captain = spawnEntity(b, "captain", 160 * SUBPX, 100 * SUBPX, newCaptain(b, 0x01008800));
    run(game, world, 1);
    expect([captain.phase, captain.facing]).toEqual(["active", "down"]);
    run(game, world, CAPTAIN.windupTicks - 1);
    expect([captain.phase, captain.y]).toEqual(["active", 100 * SUBPX]);
    run(game, world, 1);
    expect([captain.phase, captain.vy]).toEqual(["lunge", CAPTAIN.lungeSpeed]);
    until(game, world, () => fighter(game, 0).mode === "hurt", 20);
    expect(b.hits.find((h) => h.victim === 0)).toMatchObject({ damage: CAPTAIN.lungeDamage, cause: "soldier" });
    until(game, world, () => captain.phase === "hold", 20);
    run(game, world, CAPTAIN.holdTicks);
    expect(captain.phase).toBe("chase");
  });

  it("the captain's shield stops a sword from ahead (he's pushed back); struck from behind six stabs kill him", () => {
    const world = arena();
    const game = start(world, [{ x: 40, y: 220, facing: "up" }, FAR]);
    const b = game.battle!;
    const captain = spawnEntity(b, "captain", 160 * SUBPX, 100 * SUBPX, { ...newCaptain(b, 0x01008800), facing: "left" });
    const life = captain.hp;
    // From ahead (his left): no harm, knocked away.
    expect(strikeEntity(b, captain, SWORD_DAMAGE, 140 * SUBPX, 100 * SUBPX, true)).toBe(true);
    expect([captain.hp, captain.phase, captain.vx > 0]).toEqual([life, "stun", true]);
    // From behind: 2 × the stab each.
    const stab = () => ((captain.phase = "rest"), (captain.facing = "left"), strikeEntity(b, captain, SWORD_DAMAGE, 180 * SUBPX, 100 * SUBPX, true));
    for (let n = 0; n < 5; n++) stab();
    expect(captain.hp).toBe(life - 5 * 2 * SWORD_DAMAGE);
    stab();
    expect(isRemoved(captain)).toBe(true);
    expect(b.entities.some((e) => e.kind === "debris" && e.param === DEBRIS.soldier)).toBe(true);
  });

  it("a Link's sword strokes beat an archer (12 life: three stabs)", () => {
    const world = arena();
    const game = start(world, [{ x: 40, y: 220, facing: "up" }, FAR]);
    const b = game.battle!;
    const archer = spawnEntity(b, "bowSoldier", 160 * SUBPX, 100 * SUBPX, newBowSoldier(b, 0));
    for (let n = 0; n < 2; n++) {
      archer.phase = "rest";
      strikeEntity(b, archer, SWORD_DAMAGE, 140 * SUBPX, 100 * SUBPX, true);
    }
    expect([archer.hp, archer.phase]).toEqual([BOWMAN.life - 8, "stun"]);
    run(game, world, 30); // (knocked away, then back at it)
    expect(archer.phase).not.toBe("stun");
    archer.phase = "rest";
    strikeEntity(b, archer, SWORD_DAMAGE, 140 * SUBPX, 100 * SUBPX, true);
    expect(isRemoved(archer)).toBe(true);
  });

  it("the ball-and-chain soldier comes out of its GEN3 when switch 10 rises (32 life) and walks at the nearest Link, swinging", () => {
    const world = arena();
    const game = start(world, [{ x: 280, y: 120, facing: "left" }, { x: 40, y: 220, facing: "up" }], props(BALL_GEN3));
    run(game, world, 30);
    expect(of(game, "ballSoldier")).toEqual([]);
    setSwitch(game.battle!, 10, true);
    run(game, world, GEN3_SPAWN_TICK + 1);
    const [soldier] = of(game, "ballSoldier");
    expect([of(game, "ballSoldier").length, soldier!.hp, soldier!.phase]).toEqual([1, BALL_SOLDIER.life, "chase"]);
    // The chain lets out to 70 px (3 px a tick at most), the ball swinging round 400 units a tick; he walks at P1, 0.3 px/tick.
    const x0 = soldier!.x, a0 = soldier!.angle;
    run(game, world, 30);
    expect(soldier!.homeX).toBe(BALL_SOLDIER.reach);
    expect(soldier!.angle).toBe((a0 + 30 * BALL_SOLDIER.spin) & 0xffff);
    expect(soldier!.x - x0).toBeGreaterThanOrEqual(30 * BALL_SOLDIER.walk - SUBPX);
    expect(Math.abs(soldier!.vx - BALL_SOLDIER.walk)).toBeLessThanOrEqual(2);
    const [bx, by] = ballOf(soldier!);
    expect(Math.hypot(bx - soldier!.x, by - soldier!.y) / SUBPX).toBeGreaterThan(60);
  });

  it("its ball hurts a Link by 2 and knocks him 6 px/tick (hit type 3); its body by 2", () => {
    const world = arena();
    const game = start(world, [{ x: 228, y: 120, facing: "up" }, FAR]);
    const b = game.battle!;
    // The ball swings out to the right toward P1, 70 px off the soldier's hand (8 px left of him).
    const soldier = spawnEntity(b, "ballSoldier", 160 * SUBPX, 120 * SUBPX, { ...newBallSoldier(), homeX: BALL_SOLDIER.reach, angle: 0xff00 });
    until(game, world, () => fighter(game, 0).mode === "hurt", 10);
    expect(b.hits.find((h) => h.victim === 0)).toMatchObject({ damage: BALL_SOLDIER.ballDamage, cause: "soldier", attacker: -1 });
    expect(fighter(game, 0).hearts).toBe(FULL - BALL_SOLDIER.ballDamage);
    expect(Math.abs(Math.hypot(fighter(game, 0).pushX, fighter(game, 0).pushY) - BALL_KNOCK.speed)).toBeLessThan(2);
    // The body: P2 walked into him.
    const p2 = game.players[1]!;
    [p2.x, p2.y] = [soldier.x - 4 * SUBPX, soldier.y];
    run(game, world, 1);
    expect(b.hits.find((h) => h.victim === 1)).toMatchObject({ damage: BALL_SOLDIER_DAMAGE, cause: "soldier" });
  });

  it("a sword meeting the ball clanks: the Link recoils, pushed away, and the soldier takes nothing", () => {
    const world = arena();
    const game = start(world, [{ x: 240, y: 120, facing: "left" }, FAR]);
    const b = game.battle!;
    const soldier = spawnEntity(b, "ballSoldier", 160 * SUBPX, 120 * SUBPX, { ...newBallSoldier(), homeX: BALL_SOLDIER.reach });
    const [bx, by] = ballOf(soldier).map((v) => Math.floor(v / SUBPX)) as [number, number];
    game.players[0]!.action = "swing";
    expect(ballClanks(game, 0, { left: bx - 2, top: by - 2, right: bx + 2, bottom: by + 2 })).toBe(true);
    expect(game.players[0]!.action).toBe("tink");
    expect(fighter(game, 0).slideX).toBeGreaterThan(0); // (P1 is right of the ball)
    expect(soldier.hp).toBe(BALL_SOLDIER.life);
    expect(ballClanks(game, 0, { left: bx + 20, top: by + 20, right: bx + 24, bottom: by + 24 })).toBe(false);
  });

  it("struck, he's knocked away, reels the ball in and swings faster (twice at most); eight stabs kill him", () => {
    const world = arena();
    const game = start(world, [{ x: 40, y: 220, facing: "up" }, FAR]);
    const b = game.battle!;
    const soldier = spawnEntity(b, "ballSoldier", 160 * SUBPX, 100 * SUBPX, { ...newBallSoldier(), phase: "chase", homeX: BALL_SOLDIER.reach });
    const speeds: number[] = [];
    for (let n = 1; n < 8; n++) {
      expect(strikeEntity(b, soldier, SWORD_DAMAGE, 140 * SUBPX, 100 * SUBPX, true)).toBe(true);
      expect(soldier.hp).toBe(BALL_SOLDIER.life - n * 2 * SWORD_DAMAGE);
      if (n === 1) {
        expect(soldier.vx).toBe(BALL_SOLDIER.knock); // (16 px/tick away from the stab, on his walk's 0)
        // Struck again at once: nothing (he's reeling the ball in).
        strikeEntity(b, soldier, SWORD_DAMAGE, 140 * SUBPX, 100 * SUBPX, true);
        expect(soldier.hp).toBe(BALL_SOLDIER.life - 2 * SWORD_DAMAGE);
        run(game, world, 6);
        expect(soldier.x).toBeGreaterThan(220 * SUBPX); // (16, 15, 14 … px: the knock eases off 1 px a tick)
        run(game, world, 20);
        expect(soldier.homeX).toBe(BALL_SOLDIER.reeled); // (3 px a tick at most)
        run(game, world, BALL_SOLDIER.reelTicks - 26);
      } else run(game, world, BALL_SOLDIER.reelTicks);
      speeds.push(soldier.param);
    }
    expect(speeds.slice(0, 3)).toEqual([760, 1444, 1444]);
    strikeEntity(b, soldier, SWORD_DAMAGE, 140 * SUBPX, 100 * SUBPX, true);
    expect(isRemoved(soldier)).toBe(true);
    expect(b.entities.some((e) => e.kind === "debris" && e.param === DEBRIS.soldier)).toBe(true);
  });
});
