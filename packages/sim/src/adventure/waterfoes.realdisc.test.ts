// The river Zora, the side views' fish and the Hinox on the real stages (skips without extracted/): main.dol's
// readings (waterfoes.ts, hinox.ts).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, loadActorTypes, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { SUBPX } from "../player.ts";
import { createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import { hurtEnemy, spawnEnemies } from "./enemies.ts";
import { HINOX } from "./hinox.ts";
import { actorStats, AdventureStage } from "./stage.ts";
import { FIREBALL_KIND, PUKU, ZORA } from "./waterfoes.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("the adventure's Zoras, fish and Hinoxes", () => {
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const stageOf = (id: string) => new AdventureStage(new Stage(load(`Boss/${id}.arc`)), tileTypes, stats);
  const step = (game: AdventureGame, stage: AdventureStage, n = 1) => {
    for (let i = 0; i < n; i++) stepAdventure(game, [0], stage);
  };

  it("a river Zora hides, rises on deep water near its spot, looks, spits a fireball at the Link and dives", () => {
    const stage = stageOf("boss012");
    const game = createAdventure(stage, { room: 4, x: 256, y: 200, hearts: 20 });
    const zoras = game.adventure.enemies.filter((e) => e.type === "ZORA");
    expect(zoras.length).toBe(4);
    const z = zoras[0]!;
    expect([z.state, z.kind, z.life]).toEqual(["hide", 2, 4]);
    const seen = new Set<string>();
    let fireball = undefined;
    for (let t = 0; t < 1200 && !fireball; t++) {
      step(game, stage);
      seen.add(z.state);
      fireball = game.adventure.enemies.find((e) => e.type === "OKTM" && e.kind === FIREBALL_KIND);
    }
    expect([...seen]).toEqual(expect.arrayContaining(["hide", "rise", "fly", "rest", "spit"]));
    expect(fireball).toBeDefined();
    expect(Math.round(Math.hypot(fireball!.vx, fireball!.vy))).toBeGreaterThanOrEqual(ZORA.shotSpeed - 2);
    // Up it's hurt (frozen, not knocked back); under water nothing reaches it.
    const up = zoras.find((e) => e.state === "rest" || e.state === "spit");
    if (up) {
      const [x, y] = [up.x, up.y];
      hurtEnemy(up, 2, up.x - 8 * SUBPX, up.y, game);
      expect([up.life, up.state, up.x, up.y, up.grace]).toEqual([2, up.state, x, y, ZORA.freezeTicks]);
    }
  });

  it("a fish cruises round its home in a side-view area; nothing hurts it", () => {
    const stage = stageOf("boss012");
    const game = createAdventure(stage, { room: 7, x: 256, y: 300, hearts: 20 });
    // Its area 5 (a GBA side view): straight into it (its enemies made anew).
    const area = stage.area(7, 5);
    expect(area.actors.some((a) => a.id === "PUKU")).toBe(true);
    game.adventure.area = 5;
    game.adventure.enemies = [];
    spawnEnemies(game, stage);
    const fish = game.adventure.enemies.filter((e) => e.type === "PUKU");
    expect(fish.length).toBeGreaterThan(0);
    const f = fish[0]!;
    step(game, stage, 120);
    expect(f.state).toMatch(/walk|chase/);
    expect(Math.abs(f.x - f.homeX)).toBeLessThanOrEqual((PUKU.homeAcross + PUKU.homeSpread + 16) * SUBPX);
    hurtEnemy(f, 4, f.x - 8 * SUBPX, f.y, game);
    expect(f.life).toBe(4);
  });

  it("a Hinox walks, then attacks a Link ahead (a wind-up and a charge, or rocks); a sword takes life without knocking it back", () => {
    const stage = stageOf("boss030");
    const game = createAdventure(stage, { room: 6, x: 256, y: 300, hearts: 20 });
    const h = game.adventure.enemies.find((e) => e.type === "HINO")!;
    expect([h.life, h.state]).toEqual([48, "walk"]);
    // The Link 60 px ahead of it.
    Object.assign(game.players[0]!, { x: h.x, y: h.y + (h.facing === "down" ? 60 : -60) * SUBPX });
    const seen = new Set<string>();
    let rock = false;
    for (let t = 0; t < 400; t++) {
      step(game, stage);
      seen.add(h.state);
      rock ||= game.adventure.enemies.some((e) => e.type === "OIWA");
    }
    expect(seen.has("stop") || seen.has("spit")).toBe(true);
    if (seen.has("spit")) expect(rock).toBe(true);
    const [x, y, life] = [h.x, h.y, h.life];
    Object.assign(h, { invincible: 0 });
    hurtEnemy(h, 4, h.x - 8 * SUBPX, h.y, game);
    expect([h.life, h.state === "knock", h.x, h.y]).toEqual([life - 4, false, x, y]);
    expect(HINOX.blastDamage).toBe(32);
  });
});

