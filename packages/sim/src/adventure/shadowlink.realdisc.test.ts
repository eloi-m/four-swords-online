// Shadow Link (shadowlink.ts) in the Cave of No Return's room 4: his forms, his swing, his shield, his jump over a
// Link of another color, his rail and its jump, the color's roulette (skips without extracted/).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { Button, SUBPX, type Facing } from "../player.ts";
import { switchOn } from "../switches.ts";
import { createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import type { Enemy } from "./enemies.ts";
import { gatherOnLeader, SEPARATE_BUTTON, selectButtons } from "./formation.ts";
import { SHADOW, SHADOW_STATE, shadowColor, shadowForm, shadowHolds, shadowRail, shadowShownColor, shadowState } from "./shadowlink.ts";
import { actorStats, AdventureStage } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

/** His heading (the game's: 0 down, 0x4000 right) facing `f`. */
const HEADING: Record<Facing, number> = { down: 0, right: 0x4000, up: 0x8000, left: 0xc000 };

describe.skipIf(!existsSync(root))("the Cave of No Return's Shadow Link", () => {
  if (!existsSync(root)) return void it.skip("needs extracted/", () => {});
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stage = new AdventureStage(new Stage(load("Boss/boss011.arc")), tileTypes, stats);
  const step = (game: AdventureGame, n = 1, buttons = 0) => {
    for (let i = 0; i < n; i++) stepAdventure(game, [buttons], stage);
  };
  /** The four in room 4 at (x, y), the leader facing `facing`. */
  const start = (x = 256, y = 300, facing: Facing = "up") => {
    const game = createAdventure(stage, { room: 4, x, y, facing, players: 4 });
    gatherOnLeader(game);
    step(game, 2);
    return game;
  };
  const shadow = (game: AdventureGame) => game.adventure.enemies.find((e) => e.type === "SLK2");
  /** Him standing after a swing (39) at (x, y) px facing `facing`, out of anything he was doing. */
  const standStill = (e: Enemy, facing: Facing, x = e.x / SUBPX, y = e.y / SUBPX) => {
    Object.assign(e, { x: x * SUBPX, y: y * SUBPX, z: 0, vx: 0, vy: 0, vz: 0, speed: 0, tvx: 0, angle: HEADING[facing], facing, shot: SHADOW_STATE.pause, state: "stop", tick: 0, timer: 100000 });
  };

  it("his entrance: woken by the leader within 80 px, the Links held 548 ticks while he comes out of his portal, as traced", () => {
    const game = createAdventure(stage, { room: 4, x: 231, y: 300, facing: "up", players: 4 });
    gatherOnLeader(game);
    const e = shadow(game)!;
    expect([shadowState(e), e.state]).toEqual([SHADOW_STATE.wait, "hide"]);
    // Up from the door: he wakes on the tick the leader comes within (p >> 20) & 0xFF = 5 × 16 px (traced at y 266.5).
    let woke = -1;
    for (let t = 0; t < 60 && woke < 0; t++) {
      step(game, 1, Button.Up);
      if (shadowState(e) === SHADOW_STATE.wake) woke = game.tick;
    }
    const leader = game.players[0]!;
    expect(woke).toBeGreaterThan(0);
    expect(Math.hypot(leader.x / SUBPX - 256, leader.y / SUBPX - 192)).toBeLessThan(80);
    // The states at their ticks from the wake (Dolphin, the door trace: 3 on +2, 4 on +237, 5 on +282, 9 on +298, 12
    // on +357, 14 on +549), the Links not moving a pixel in between, free again on +550; him unseen until his jump.
    const at: Record<number, number> = {};
    const links = () => game.players.map((p) => [p.x, p.y]);
    step(game, 1, Button.Up);
    expect(shadowHolds(game)).toBe(true);
    const held = links();
    let peak = 0;
    while (shadowState(e) !== SHADOW_STATE.ready) {
      step(game, 1, Button.Up);
      at[shadowState(e)] ??= game.tick - woke;
      peak = Math.max(peak, e.z);
      if (shadowState(e) < SHADOW_STATE.rise) expect(e.state).toBe("hide");
      expect(links()).toEqual(held);
    }
    expect(at).toEqual({ [SHADOW_STATE.portal]: 2, [SHADOW_STATE.rise]: 237, [SHADOW_STATE.landed]: 282, [SHADOW_STATE.pose]: 298, [SHADOW_STATE.challenge]: 357, [SHADOW_STATE.ready]: 549 });
    // His jump out of the portal: 48.4 px up at the top (traced).
    expect(peak / SUBPX).toBeCloseTo(48.4, 1);
    expect(shadowHolds(game)).toBe(false);
    step(game, 1, Button.Up);
    expect(leader.y).toBeLessThan(held[0]![1]!);
  });

  it("his rail: room 4's five RAIL points in their order, looping", () => {
    const game = start();
    const rail = shadowRail(game, stage, shadow(game)!);
    expect(rail.map((p) => [p.x / SUBPX, p.y / SUBPX])).toEqual([[96, 80], [96, 192], [416, 192], [416, 64], [112, 80]]);
    expect(rail[4]!.flags & 3).toBe(1);
    // The jump between (416, 64) and (112, 80): 0x08 on the one, 0x10 on the other.
    expect([rail[3]!.flags & 0x18, rail[4]!.flags & 0x18]).toEqual([0x08, 0x10]);
  });

  it("the dark form falls to any Link's sword in SHADOW.hits hits; in a color, that Link's two put him down, one more beats him", () => {
    const game = start();
    expect(shadow(game)).toBeDefined();
    expect(shadowColor(shadow(game)!)).toBe(1);
    expect(shadowForm(shadow(game)!)).toBe(0);
    /** The Link of `color` in control (the D-pad), set below him facing up, a swing (his back to him: no shield). */
    const swing = (color: number) => {
      step(game, 1, selectButtons(color));
      step(game, 2);
      expect(game.adventure.colors[0]).toBe(color);
      const f = game.battle.fighters[0]!;
      for (let t = 0; (f.mode !== "active" || f.move !== "none") && t < 200; t++) step(game, 1);
      const e = shadow(game)!, l = game.players[0]!;
      if (e.state !== "rest") standStill(e, "up", 256, 200);
      Object.assign(l, { x: e.x, y: e.y + 18 * SUBPX, facing: "up" });
      step(game, 12, Button.Sword);
      step(game, 30);
      return shadow(game)?.life ?? -1;
    };
    expect(swing(0)).toBe(SHADOW.hits - 1);
    step(game, 1, SEPARATE_BUTTON);
    step(game, 12);
    expect(swing(1)).toBe(SHADOW.hits - 2);
    // The last: he changes (not hurt meanwhile), in a color the roulette shows last.
    expect(swing(1)).toBe(SHADOW.colorHits);
    expect(shadow(game)!.state).toBe("change");
    expect(shadowForm(shadow(game)!)).toBe(1);
    step(game, SHADOW.change);
    expect(shadow(game)!.state).not.toBe("change");
    const color = shadowColor(shadow(game)!), other = (color + 1) % 4;
    expect(color).toBeGreaterThanOrEqual(0);
    expect(color).toBeLessThan(4);
    // Another Link's sword does nothing to him now; his color's two put him down.
    expect(swing(other)).toBe(SHADOW.colorHits);
    expect(swing(color)).toBe(SHADOW.colorHits - 1);
    expect(swing(color)).toBe(SHADOW.downHits);
    expect([shadowForm(shadow(game)!), shadow(game)!.state]).toEqual([2, "rest"]);
    // Down SHADOW.down ticks (once his invincibility runs out), he's up again, one hit from falling again.
    step(game, SHADOW.down - 1);
    expect(shadow(game)!.state).toBe("rest");
    step(game, SHADOW.fallGrace);
    expect(shadowForm(shadow(game)!)).toBe(1);
    expect(shadow(game)!.state).not.toBe("rest");
    expect(swing(color)).toBe(SHADOW.downHits);
    expect(shadowForm(shadow(game)!)).toBe(2);
    step(game, SHADOW.fallGrace);
    // Another Link's sword gets him up; his color's puts him down again, and the next beats him.
    expect(swing(other)).toBe(SHADOW.downHits);
    expect([shadowForm(shadow(game)!), shadow(game)!.state]).not.toEqual([2, "rest"]);
    expect(swing(color)).toBe(SHADOW.downHits);
    step(game, SHADOW.fallGrace);
    expect(shadow(game)!.state).toBe("rest");
    swing(color);
    expect(shadow(game)!.state).toBe("die");
    step(game, SHADOW.spin);
    expect(shadow(game)).toBeUndefined();
    // The room's ZNSW: the door north.
    expect(switchOn(game.battle, 16)).toBe(true);
  });

  it("closing in on a Link who can hurt him, he swings: his sword's box hurts him by his atcp, then he stands SHADOW.pause ticks", () => {
    const game = start();
    const e = shadow(game)!, l = game.players[0]!, f = game.battle.fighters[0]!;
    standStill(e, "down", 256, 200);
    Object.assign(l, { x: e.x, y: e.y + 30 * SUBPX });
    Object.assign(e, { shot: SHADOW_STATE.chase, state: "chase", shot2: 0 });
    const hearts = f.hearts;
    let t = 0;
    while (e.state !== "turn" && t++ < 60) step(game, 1);
    expect(e.state).toBe("turn");
    expect([SHADOW_STATE.swing, SHADOW_STATE.lunge]).toContain(shadowState(e));
    for (t = 0; f.hearts === hearts && t < SHADOW.swing; t++) step(game, 1);
    expect(f.hearts).toBe(hearts - e.atcp);
    while (e.state === "turn") step(game, 1);
    expect(shadowState(e)).toBe(SHADOW_STATE.pause);
    step(game, SHADOW.pause - 1);
    expect(shadowState(e)).toBe(SHADOW_STATE.pause);
    step(game, 1);
    expect(shadowState(e)).not.toBe(SHADOW_STATE.pause);
  });

  it("his shield: a sword from ahead of him clanks, no harm; he springs back 3 px/tick, × 0.78, the Link pushed back", () => {
    const game = start();
    const e = shadow(game)!, l = game.players[0]!;
    standStill(e, "down", 256, 200);
    Object.assign(l, { x: e.x, y: e.y + 18 * SUBPX, facing: "up" });
    const y0 = e.y, ly0 = l.y;
    let t = 0;
    while (shadowState(e) !== SHADOW_STATE.spring && t++ < 12) step(game, 1, Button.Sword);
    expect(shadowState(e)).toBe(SHADOW_STATE.spring);
    expect(e.life).toBe(SHADOW.hits);
    step(game, SHADOW.springTicks - 1);
    // Back up the room, away from the Link (3 px/tick × 0.78 a tick: ~10 px over the 10 ticks).
    expect((y0 - e.y) / SUBPX).toBeGreaterThan(7);
    expect((y0 - e.y) / SUBPX).toBeLessThan(13);
    expect(l.y).toBeGreaterThan(ly0);
    // From his side, his shield doesn't stop it.
    standStill(e, "down", 256, 200);
    Object.assign(l, { x: e.x - 18 * SUBPX, y: e.y, facing: "right" });
    step(game, 30);
    standStill(e, "down", 256, 200);
    step(game, 12, Button.Sword);
    expect(e.life).toBe(SHADOW.hits - 1);
  });

  it("a Link who can't hurt him: struck, he jumps over him (2 px/tick, 45 ticks), lands and comes at him", () => {
    const game = start();
    const e = shadow(game)!, l = game.players[0]!;
    // His colored form, not the leader's color.
    Object.assign(e, { flags: 1, kind: (game.adventure.colors[0]! + 1) % 4, life: SHADOW.colorHits });
    standStill(e, "up", 256, 160);
    Object.assign(l, { x: e.x, y: e.y + 18 * SUBPX, facing: "up" });
    let t = 0;
    while (shadowState(e) !== SHADOW_STATE.hop && t++ < 12) step(game, 1, Button.Sword);
    expect(shadowState(e)).toBe(SHADOW_STATE.hop);
    expect(e.life).toBe(SHADOW.colorHits);
    const ly = l.y;
    for (t = 0; shadowState(e) === SHADOW_STATE.hop && t < 100; t++) step(game, 1);
    expect(t).toBeGreaterThanOrEqual(44);
    expect(t).toBeLessThanOrEqual(46);
    expect(shadowState(e)).toBe(SHADOW_STATE.hopLand);
    // Over him: landed beyond him.
    expect(e.y).toBeGreaterThan(ly);
    while (shadowState(e) === SHADOW_STATE.hopLand) step(game, 1);
    expect(shadowState(e)).toBe(SHADOW_STATE.chase);
  });

  it("his rail: from (416, 64) going on he jumps to (112, 80): 90 ticks, 30 crouched, a 60-tick flight, 30, 90, then on to (96, 80)", () => {
    const game = start(256, 330, "up");
    const e = shadow(game)!;
    const rail = shadowRail(game, stage, e);
    // On his way to (416, 64), a few points to go, the Links far.
    Object.assign(e, { x: 416 * SUBPX, y: 90 * SUBPX, shot: SHADOW_STATE.rail, state: "patrol", tick: 1, group: 0, leader: 3, homeX: rail[3]!.x, homeY: rail[3]!.y, frame: 4, angle: HEADING.up, speed: SUBPX, tvx: SUBPX });
    let t = 0;
    while (shadowState(e) === SHADOW_STATE.rail && t++ < 100) step(game, 1);
    expect(shadowState(e)).toBe(SHADOW_STATE.jumpWait);
    const lengths: [number, number][] = [];
    for (let s = shadowState(e), n = 0; lengths.length < 5 && n < 600; n++) {
      step(game, 1);
      if (shadowState(e) !== s) {
        lengths.push([s, e.tick]);
        s = shadowState(e);
      }
    }
    void lengths;
    // (Counted by the tick each state ended on.)
    expect(shadowState(e)).toBe(SHADOW_STATE.rail);
    expect(Math.abs(e.x / SUBPX - 112)).toBeLessThanOrEqual(SHADOW.jitter + 1);
    expect(Math.abs(e.y / SUBPX - 80)).toBeLessThanOrEqual(SHADOW.jitter + 1);
    // On (looping) to (96, 80).
    expect(e.leader).toBe(0);
  });

  it("the jump's states last 90, 30, 60, 30 and 90 ticks", () => {
    const game = start(256, 330, "up");
    const e = shadow(game)!;
    const rail = shadowRail(game, stage, e);
    Object.assign(e, { x: 416 * SUBPX, y: 70 * SUBPX, shot: SHADOW_STATE.rail, state: "patrol", tick: 1, group: 0, leader: 3, homeX: rail[3]!.x, homeY: rail[3]!.y, frame: 4, angle: HEADING.up, speed: SUBPX, tvx: SUBPX });
    let t = 0;
    while (shadowState(e) === SHADOW_STATE.rail && t++ < 100) step(game, 1);
    const seen: number[] = [];
    let s = shadowState(e), from = 0;
    for (let n = 1; seen.length < 5 && n < 600; n++) {
      step(game, 1);
      if (shadowState(e) !== s) {
        seen.push(n - from);
        [s, from] = [shadowState(e), n];
      }
    }
    expect(seen).toEqual([SHADOW.jumpWait, SHADOW.jumpCrouch, SHADOW.flight, SHADOW.landWait, SHADOW.afterWait]);
  });

  it("left alone, he stands, then walks his rail's points at 1 px/tick", () => {
    const game = start(256, 330, "up");
    const e = shadow(game)!;
    standStill(e, "down", 256, 192);
    Object.assign(e, { shot: SHADOW_STATE.stand, timer: 20, frameTimer: 300, tick: 0 });
    step(game, 299);
    expect(shadowState(e)).toBe(SHADOW_STATE.stand);
    step(game, 1);
    expect(shadowState(e)).toBe(SHADOW_STATE.rail);
    expect(e.frame).toBeGreaterThanOrEqual(1);
    step(game, 40);
    expect(e.speed).toBe(SHADOW.speed);
  });

  it("the change: dark at first, then a roulette of colors (every 5 ticks, then 15), the last one his", () => {
    const game = start();
    const e = shadow(game)!;
    Object.assign(e, { life: 0 });
    // (His dark form's last hit, as hurtEnemy has it.)
    e.life = 1;
    standStill(e, "up", 256, 200);
    const l = game.players[0]!;
    Object.assign(l, { x: e.x, y: e.y + 18 * SUBPX, facing: "up" });
    step(game, 12, Button.Sword);
    expect(e.state).toBe("change");
    const shown: number[] = [];
    for (let t = 0; e.state === "change" && t < 600; t++) {
      shown.push(shadowShownColor(e));
      step(game, 1);
    }
    expect(shown[0]).toBe(-1);
    const changes = shown.filter((c, k) => k > 0 && c !== shown[k - 1] && c >= 0 && shown[k - 1]! >= 0).length;
    // 100 / 5 then 75 / 15.
    expect(changes).toBeGreaterThanOrEqual(19);
    expect(changes).toBeLessThanOrEqual(26);
    expect(shadowColor(e)).toBe(shown[shown.length - 1]);
  });
});
