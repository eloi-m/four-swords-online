// The Tektite, the Stalfos, the Buzz Blob and the Poe on the real stages (skips without extracted/): their moves as
// main.dol has them (foes.ts), what the sword does to them, what they leave.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { Button, SUBPX } from "../player.ts";
import { createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import { hurtEnemy, type Enemy } from "./enemies.ts";
import { POE, STALFOS, TEKTITE } from "./foes.ts";
import { actorStats, AdventureStage } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("more of the adventure's enemies", () => {
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stageOf = (id: string) => new AdventureStage(new Stage(load(`Boss/${id}.arc`)), tileTypes, stats);
  const step = (game: AdventureGame, stage: AdventureStage, n = 1, buttons = 0) => {
    for (let i = 0; i < n; i++) stepAdventure(game, [buttons], stage);
  };
  const px = (v: number) => v / SUBPX;

  /** A stab from 16 px to its left (at its height), once it can be hurt; whether its life went down. */
  function stab(game: AdventureGame, stage: AdventureStage, e: Enemy): boolean {
    const p = game.players[0]!, f = game.battle.fighters[0]!;
    for (let k = 0; k < 400 && (e.invincible > 0 || e.state === "knock" || (e.state === "fly" && e.type !== "POOH") || f.mode !== "active" || f.move !== "none"); k++) step(game, stage);
    Object.assign(p, { x: e.x - (e.type === "POOH" && e.kind === 3 ? 20 : 16) * SUBPX, y: e.y - e.z, facing: "right", action: "none", actionTick: 0 });
    const life = e.life;
    step(game, stage, 1, Button.Sword);
    step(game, stage, 12);
    return e.life < life;
  }

  it("the Tektite waits, jumps 25 ticks (39 px up), lands; one stab kills a small one, which leaves a heart", () => {
    const stage = stageOf("boss031");
    const game = createAdventure(stage, { room: 5, x: 256, y: 300 });
    const t = game.adventure.enemies.find((e) => e.type === "TKTA")!;
    expect([t.state, t.life]).toEqual(["rest", TEKTITE.life]);
    let wait = 0;
    while (t.state === "rest") step(game, stage), wait++;
    expect(wait).toBeGreaterThanOrEqual(TEKTITE.firstWaitMin);
    expect(wait).toBeLessThan(TEKTITE.firstWaitMin + TEKTITE.firstWaitSpread + 1);
    let air = 0, top = 0;
    while (t.state === "fly") step(game, stage), air++, (top = Math.max(top, px(t.z)));
    expect(air).toBe(25);
    expect(top).toBe(39);
    expect(t.z).toBe(0);
    expect(stab(game, stage, t)).toBe(true);
    step(game, stage, 60);
    expect(game.adventure.enemies.includes(t)).toBe(false);
    expect(game.adventure.pickups.some((p) => p.type === "heart" && p.actor < 0)).toBe(true);
  });

  it("the Stalfos walks at 0.7 px/tick, dodges a sword press within 50 px (kind 1), takes two stabs", () => {
    const stage = stageOf("boss023");
    const game = createAdventure(stage, { room: 15, x: 256, y: 340 });
    const s = game.adventure.enemies.find((e) => e.type === "STAL")!;
    expect([s.kind, s.life]).toEqual([1, 8]);
    step(game, stage, 20);
    expect(s.state).toBe("walk");
    const x0 = s.x, y0 = s.y;
    step(game, stage, 10);
    if (s.state === "walk") expect(Math.max(Math.abs(s.x - x0), Math.abs(s.y - y0))).toBeGreaterThan(5 * SUBPX);
    // A press 30 px away: it jumps away from the Link, out of reach while in the air.
    for (let k = 0; k < 200 && s.state !== "walk"; k++) step(game, stage);
    const p = game.players[0]!;
    Object.assign(p, { x: s.x - 30 * SUBPX, y: s.y, facing: "right", action: "none", actionTick: 0 });
    step(game, stage, 1, Button.Sword);
    step(game, stage, 2);
    expect(s.state).toBe("fly");
    expect(s.z).toBeGreaterThan(0);
    expect(s.x).toBeGreaterThan(p.x + 30 * SUBPX);
    hurtEnemy(s, 4, p.x, p.y);
    expect(s.life).toBe(8);
    let hits = 0;
    for (let k = 0; k < 10 && s.life > 0; k++) if (stab(game, stage, s)) hits++;
    expect(hits).toBe(2);
    void STALFOS;
  });

  it("the Buzz Blob shocks the Link who strikes it and takes no harm from the sword; a blast kills it", () => {
    const stage = stageOf("boss030");
    const game = createAdventure(stage, { room: 5, x: 256, y: 300, hearts: 6 });
    const b = game.adventure.enemies.find((e) => e.type === "BZBR" && e.kind === 0)!;
    const f = game.battle.fighters[0]!, hearts = f.hearts;
    expect(stab(game, stage, b)).toBe(false);
    expect(f.hearts).toBe(hearts - 1);
    expect(b.state).toBe("spit");
    hurtEnemy(b, 4, b.x - 8 * SUBPX, b.y);
    step(game, stage, 60);
    expect(game.adventure.enemies.includes(b)).toBe(false);
  });

  it("the sand crab charges a Link level with it; the Armos wakes within 64 px and hops after him; the Mozo hops 15 px up; the rat runs 2 px/tick", () => {
    const coast = stageOf("boss020");
    const g = createAdventure(coast, { room: 0, x: 256, y: 160 });
    const crab = g.adventure.enemies.find((e) => e.type === "PEAC" && px(e.y) === 160)!;
    for (let k = 0; k < 200 && crab.state !== "chase"; k++) step(g, coast);
    expect(crab.state).toBe("chase");
    expect(Math.abs(crab.vx)).toBe(2 * SUBPX);
    expect(Math.sign(crab.vx)).toBe(Math.sign(g.players[0]!.x - crab.x));

    const ice = stageOf("boss071");
    const g2 = createAdventure(ice, { room: 1, x: 256, y: 192 });
    const armos = g2.adventure.enemies.find((e) => e.type === "AMOS")!;
    step(g2, ice, 30);
    expect(armos.state).toBe("hide");
    expect(stab(g2, ice, armos)).toBe(false); // (a statue: the stab wakes it, nothing more)
    for (let k = 0; k < 70 && armos.state !== "fly"; k++) step(g2, ice);
    expect(armos.state).toBe("fly");
    const d0 = Math.hypot(armos.x - g2.players[0]!.x, armos.y - g2.players[0]!.y);
    step(g2, ice, 40);
    expect(Math.hypot(armos.x - g2.players[0]!.x, armos.y - g2.players[0]!.y)).toBeLessThan(d0);

    const tower = stageOf("boss022");
    const g3 = createAdventure(tower, { room: 15 });
    const mozo = g3.adventure.enemies.find((e) => e.type === "MOZO")!;
    let top = 0;
    for (let k = 0; k < 120; k++) step(g3, tower), (top = Math.max(top, px(mozo.z)));
    expect(top).toBe(15);

    const temple = stageOf("boss053");
    const g4 = createAdventure(temple, { room: 14 });
    const rat = g4.adventure.enemies.find((e) => e.type === "NZMI")!;
    for (let k = 0; k < 120 && rat.state === "rest"; k++) step(g4, temple);
    const x0 = rat.x, y0 = rat.y;
    step(g4, temple);
    expect(Math.abs(rat.x - x0) + Math.abs(rat.y - y0)).toBe(2 * SUBPX);
    expect(stab(g4, temple, rat)).toBe(true);
    expect(rat.life).toBe(0);
  });

  it("the Poe floats 20 px up over the walls and dies to a stab; a ghost laughs the sword off", () => {
    const stage = stageOf("boss041");
    const game = createAdventure(stage, { room: 10, x: 256, y: 340 });
    const poe = game.adventure.enemies.find((e) => e.type === "POOH")!;
    step(game, stage, 60);
    expect(px(poe.z)).toBeGreaterThan(POE.bobZ - POE.bobAmp - 1);
    expect(px(poe.z)).toBeLessThan(POE.bobZ + POE.bobAmp + 1);
    expect(stab(game, stage, poe)).toBe(true);
    expect(poe.life).toBe(0);

    const haunted = stageOf("boss042");
    const g2 = createAdventure(haunted, { room: 3, x: 256, y: 340 });
    const ghost = g2.adventure.enemies.find((e) => e.type === "POOH" && e.kind === 3)!;
    step(g2, haunted, 30);
    // (The room is full of them: the Link out of their reach while he strikes this one.)
    for (const e of g2.adventure.enemies) if (e !== ghost) e.x = e.homeX = 480 * SUBPX;
    expect(stab(g2, haunted, ghost)).toBe(false);
    // Laughing, it fades out (out of reach) for 20 ticks, then back.
    expect(ghost.shot2).toBe(1);
    expect(ghost.speed).toBeLessThan(POE.solidAlpha);
    step(g2, haunted, 40);
    expect([ghost.shot2, ghost.life]).toEqual([0, POE.ghostLife]);
    expect(ghost.speed).toBeGreaterThan(POE.solidAlpha);
  });
});
