// The battle's particle effects driven by real rounds; skipped when extracted/ is absent (e.g. in CI).
import { existsSync, readFileSync } from "node:fs";
import { actorPixel, decompressYaz0, Dol, parseRarc, readTileTypes, Stage } from "@fso/formats";
import {
  arenaProps,
  arenaSpawns,
  BIG_BOMB,
  buildArenaWorld,
  Button,
  COUNTDOWN_TICKS,
  createBattle,
  explode,
  setSwitch,
  SHADOW,
  sideRoomY,
  stepGame,
  SUBPX,
  type GameState,
  type World,
} from "@fso/sim";
import { describe, expect, it } from "vitest";
import { CHARGE_FULL, SWORD_CHARGE } from "./charge.ts";
import { BATTLE_PARTICLES, BattleParticles, embersAt, lifeRanks } from "./particles.ts";

const root = new URL("../../../extracted/", import.meta.url);
const present = existsSync(new URL("sys/main.dol", root));

describe.skipIf(!present)("real disc: battle particles", () => {
  const stage = present ? new Stage(parseRarc(decompressYaz0(readFileSync(new URL("files/GC4Sword_usa/Boss/boss500.arc", root))))) : null!;
  const data = present ? parseRarc(decompressYaz0(readFileSync(new URL("files/GC4Sword_usa/data.arc", root)))) : null!;
  const tileTypes = present ? readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root)))) : null!;
  const round = (room: number): { game: GameState; world: World } => {
    const world = buildArenaWorld(stage, tileTypes, room);
    const game = createBattle(room, arenaSpawns(stage, room).slice(0, 2), { hearts: 3, timeLimit: 0, wins: 3 }, arenaProps(stage, tileTypes, room), 7);
    return { game, world };
  };
  const step = (r: { game: GameState; world: World }, fx: BattleParticles, n: number) => {
    for (let i = 0; i < n; i++) {
      r.game = stepGame(r.game, [0, 0], r.world);
      fx.update(r.game);
    }
  };

  it("burns the fire pit's four idle flames, then a jet while its switch is on, then its dying flame", () => {
    const fx = new BattleParticles(data);
    const r = round(1);
    step(r, fx, COUNTDOWN_TICKS + 30);
    expect(fx.stats).toMatchObject({ emitters: 4 });
    expect(fx.stats.particles).toBeGreaterThan(20);
    // A jet comes out (the switch network drives it in a round; here its state is set by hand: the effects only read
    // it), then goes back in, its size easing down a tenth of the way per tick.
    const jet = r.game.battle!.entities.find((e) => e.kind === "jet")!;
    const frame = (phase: "active" | "rest", size: number) => {
      r.game.tick++;
      Object.assign(jet, { phase, timer: size });
      fx.update(r.game);
    };
    const idle = fx.stats.particles;
    for (let t = 0; t < 30; t++) frame("active", 1000 - Math.round(1000 * 0.9 ** (t + 1)));
    const on = fx.stats.particles;
    let size = 1000;
    for (let t = 0; t < 150; t++) frame("rest", (size -= Math.trunc(size / 10)));
    expect(on).toBeGreaterThan(idle + 30);
    // The jet's flame has played out; its dying flame (429) replaced the idle one.
    expect(fx.stats.emitters).toBe(4);
  });

  it("follows the fire bars' balls with their flames and sparks", () => {
    const fx = new BattleParticles(data);
    const r = round(4);
    step(r, fx, COUNTDOWN_TICKS + 41);
    const balls = r.game.battle!.entities.filter((e) => e.kind === "firebar").length * 8;
    expect(fx.stats.emitters).toBe(balls * 2 + 1); // and the heat haze's resident emitter (1357, queued at each ball)
    expect(fx.stats.draws).toBe(4); // 414's flames, their children, 412's sparks, the haze
    expect(fx.distorting).toBe(true);
  });

  it("sparks where a sword hits a Link, and splashes when a Link sinks into the lava", () => {
    const fx = new BattleParticles(data);
    const world = buildArenaWorld(stage, tileTypes, 1);
    const layer = stage.layer(1, 1)!;
    fx.reset("arena 1", (x, y) => tileTypes[layer[(y >> 4) * 32 + (x >> 4)]! & 0x3ff]!);
    const r = { game: createBattle(1, arenaSpawns(stage, 1).slice(0, 2), { hearts: 3, timeLimit: 0, wins: 3 }, arenaProps(stage, tileTypes, 1), 7), world };
    step(r, fx, COUNTDOWN_TICKS + 5);
    const b = r.game.battle!, base = fx.stats.emitters;
    // P1's sword hits P2 this tick (the sim lists it in `hits`; P2 is knocked back from it).
    r.game.tick++;
    b.hits = [{ attacker: 0, victim: 1, blocked: false, damage: 2 }];
    Object.assign(b.fighters[1]!, { mode: "hurt", modeTick: 0 });
    fx.update(r.game);
    expect(fx.stats.emitters).toBe(base + 3); // 586, 587 and the knockback's dust (979)
    // A bomb's blast has a cause: no sword sparks, the dust alone.
    r.game.tick++;
    b.hits = [{ attacker: -1, victim: 0, blocked: false, damage: 4, cause: "bomb" }];
    Object.assign(b.fighters[0]!, { mode: "hurt", modeTick: 0 });
    Object.assign(b.fighters[1]!, { mode: "active", modeTick: 0 });
    fx.update(r.game);
    expect(fx.stats.emitters).toBe(base + 4); // the first hit's effects play out
    Object.assign(b.fighters[0]!, { mode: "active", modeTick: 0 });
    for (let t = 0; t < 80; t++) {
      r.game.tick++;
      fx.update(r.game);
    }
    // P1 falls into the fire pit (lava): nothing for 40 ticks, then the glow and the drops.
    Object.assign(r.game.players[0]!, { x: 264 * SUBPX, y: 200 * SUBPX });
    b.hits = [];
    for (let t = 0; t <= 45; t++) {
      r.game.tick++;
      Object.assign(b.fighters[0]!, { mode: "falling", modeTick: t });
      fx.update(r.game);
      if (t === 39) expect(fx.stats.emitters).toBe(base);
    }
    expect(fx.stats.emitters).toBe(base + 2);
  });

  it("burns a Link knocked back by fire, trails dust behind a roll, puffs where he lands, marks a change of rank", () => {
    const fx = new BattleParticles(data);
    const r = round(1);
    step(r, fx, COUNTDOWN_TICKS + 5);
    const b = r.game.battle!, base = fx.stats.emitters;
    const ids = () => [...new Set(fx.liveIds())].sort((m, n) => m - n);
    const frame = (n = 1) => {
      for (let t = 0; t < n; t++) {
        r.game.tick++;
        fx.update(r.game);
      }
    };
    // P2, facing left, knocked back by a jet: the two flames of his facing (583, 579) and the dust; he's lost life to
    // P1, so his rank drops (933 over him).
    r.game.players[1]!.facing = "left";
    b.hits = [{ attacker: -1, victim: 1, blocked: false, damage: 4, cause: "flame" }];
    Object.assign(b.fighters[1]!, { mode: "hurt", modeTick: 0, hearts: b.fighters[1]!.hearts - 4, z: 0 });
    frame();
    b.hits = [];
    expect(ids()).toEqual(expect.arrayContaining([579, 583, 933, BATTLE_PARTICLES.dust.trail]));
    expect(fx.stats.emitters).toBe(base + 4);
    // In the air for 10 ticks, then down: the knockback ends (the flames and the dust play out), dust where he lands.
    for (let t = 1; t <= 10; t++) {
      Object.assign(b.fighters[1]!, { modeTick: t, z: 256 });
      frame();
    }
    Object.assign(b.fighters[1]!, { mode: "active", modeTick: 0, z: 0 });
    frame();
    expect(ids()).toContain(BATTLE_PARTICLES.dust.landing);
    // P1 loses as much: P2 is no longer behind (934 replaces his 933) and P1 is behind nobody still (no change for P1).
    b.fighters[0]!.hearts -= 4;
    frame(8);
    expect(fx.liveIds().filter((id) => id === 934).length).toBe(1);
    expect(fx.liveIds()).not.toContain(933);
    // P1 rolls: the dust follows him.
    const trails = () => fx.liveIds().filter((id) => id === BATTLE_PARTICLES.dust.trail).length;
    const before = trails();
    Object.assign(b.fighters[0]!, { move: "roll", moveTick: 0 });
    frame();
    expect(trails()).toBe(before + 1);
    Object.assign(b.fighters[0]!, { move: "none", moveTick: 0 });
    frame(200);
    expect(fx.stats.emitters).toBe(base);
  });

  it("burns a Link jumping out of the lava, and keeps the Tower of Flames' embers at half the camera's place", () => {
    const fx = new BattleParticles(data);
    const world = buildArenaWorld(stage, tileTypes, 1);
    const layer = stage.layer(1, 1)!;
    fx.reset("arena 1", (x, y) => tileTypes[layer[(y >> 4) * 32 + (x >> 4)]! & 0x3ff]!, [], { embers: true });
    const r = { game: createBattle(1, arenaSpawns(stage, 1).slice(0, 2), { hearts: 3, timeLimit: 0, wins: 3 }, arenaProps(stage, tileTypes, 1), 7), world };
    const view = { x: 256, y: 192 };
    for (let i = 0; i < COUNTDOWN_TICKS + 5; i++) {
      r.game = stepGame(r.game, [0, 0], r.world);
      fx.update(r.game, view);
    }
    expect(fx.liveIds()).toContain(BATTLE_PARTICLES.embers);
    expect(embersAt(256, 192)).toEqual({ x: -128, y: -96 }); // world (384, 288): half the camera's (768, 576)
    const b = r.game.battle!;
    Object.assign(r.game.players[0]!, { x: 264 * SUBPX, y: 200 * SUBPX, facing: "up" });
    Object.assign(b.fighters[0]!, { pushX: 0, pushY: 2 * SUBPX });
    for (let t = 0; t < 70; t++) {
      r.game.tick++;
      Object.assign(b.fighters[0]!, { mode: "falling", modeTick: t });
      if (t >= 60) r.game.players[0]!.y += 2 * SUBPX; // the jump out moves him
      fx.update(r.game, view);
      if (t === 59) expect(fx.liveIds()).not.toContain(585);
    }
    expect(fx.liveIds()).toEqual(expect.arrayContaining([585, 581, 681, 682]));
  });

  it("ranks the Links by life as the HUD does", () => {
    expect(lifeRanks([12, 12])).toEqual([0, 0]);
    expect(lifeRanks([12, 8, 10, 8])).toEqual([0, 2, 1, 2]);
  });

  it("blows up a bomb with the game's three explosion effects, which play out after the blast", () => {
    const fx = new BattleParticles(data);
    const r = round(1);
    step(r, fx, COUNTDOWN_TICKS + 5);
    const bomb = r.game.battle!.entities.find((e) => e.kind === "bomb")!;
    explode(r.game.battle!, bomb);
    step(r, fx, 1);
    const fuses = r.game.battle!.entities.filter((e) => e.kind === "bomb" && e.timer > 0).length;
    expect(fx.stats.emitters).toBe(4 + 3 * r.game.battle!.entities.filter((e) => e.kind === "explosion").length + 2 * fuses);
    // Socket bombs nearby go off too (the sim's chain): three effects each.
    let booms = 0;
    for (let t = 0; t < 40; t++) {
      step(r, fx, 1);
      booms = Math.max(booms, r.game.battle!.entities.filter((e) => e.kind === "explosion").length);
    }
    expect(booms).toBeGreaterThan(1);
    step(r, fx, 400);
    expect(fx.stats.emitters).toBe(4);
    expect(r.game.battle!.entities.some((e) => e.kind === "explosion")).toBe(false);
    expect(Number.isFinite(bomb.x / SUBPX)).toBe(true);
  });

  it("the Tower of Winds: its gates glow; the Shadow Link's sparkles; the giant bomb's landing, fuse and blast", () => {
    const fx = new BattleParticles(data);
    const r = round(2);
    const gates = stage
      .actors(2)
      .filter((a) => a.id === "SVGT")
      .map((a) => ({ id: a.id, params: a.params, x: actorPixel(a).x, y: actorPixel(a).y + sideRoomY(a.sublayer) }));
    expect(gates.length).toBe(4); // by the TV's four gates (the gallery's have none)
    fx.reset("arena 2", () => 0, gates);
    step(r, fx, COUNTDOWN_TICKS + 5);
    expect(fx.stats.emitters).toBe(gates.length * 2); // 1095 and 1096 at each
    const b = r.game.battle!, his = () => b.entities.find((e) => e.kind === "shadowLink")!;
    setSwitch(b, 21, true);
    while (his().param !== SHADOW.sparkles) step(r, fx, 1);
    expect(fx.stats.emitters).toBe(gates.length * 2 + 3); // 1048-1050
    const bomb = () => b.entities.find((e) => e.kind === "bigBomb");
    while (bomb()?.param !== BIG_BOMB.squashing) step(r, fx, 1);
    expect(fx.stats.emitters).toBe(gates.length * 2 + 1); // the landing's dust (the sparkles played out)
    while (bomb()?.param !== BIG_BOMB.burning) step(r, fx, 1);
    step(r, fx, 1);
    expect(fx.stats.emitters).toBe(gates.length * 2 + 1 + 2); // its fuse: 57, 58
    while (bomb()) step(r, fx, 1);
    expect(fx.stats.emitters).toBe(gates.length * 2 + 6); // the blast: 51-56 (the fuse's went with the bomb)
  });
  it("charges a sword: the sparkle along the blade, then the burst and the glow at its tip (as in Dolphin's RAM)", () => {
    const fx = new BattleParticles(data);
    const r = round(1);
    step(r, fx, COUNTDOWN_TICKS + 5);
    const p = r.game.players[0]!, f = r.game.battle!.fighters[0]!;
    p.facing = "down";
    const hold = (buttons: number) => {
      r.game = stepGame(r.game, [buttons, 0], r.world);
      fx.update(r.game);
    };
    const listed = (prefix: string) => fx.listed.filter((s) => s.key.startsWith(prefix)).map((s) => [s.placement.id, ...s.placement.translation]);
    // The stab, then the charge: its counter is the sim's actionTick (Dolphin: 1 on state 8's first frame).
    while (r.game.players[0]!.action !== "charge") hold(Button.Sword);
    const q = () => r.game.players[0]!;
    expect(q().actionTick).toBe(1);
    const x = q().x / SUBPX, y = q().y / SUBPX;
    expect(listed("charge:0:")).toEqual([[SWORD_CHARGE.sparkle, x + 4, y + 2 + 128, 128]]);
    while (q().actionTick < CHARGE_FULL - 1) hold(Button.Sword);
    // RAM, frame 66 (counter 47, Link at (712, 664) facing down): 623 at (716, 807, 128).
    expect(listed("charge:0:")).toEqual([[623, x + 4, y + 15 + 128, 128]]);
    expect(listed("charged:")).toEqual([]);
    hold(Button.Sword);
    // Counter 48 (frame 67 on): 203, 204 at (716, 1450, 770), 626 at (716, 545, -128); 623 stops and plays out.
    expect(listed("charge:0:")).toEqual([]);
    expect(listed("charged:0:")).toEqual([
      [203, x + 4, y + 18 + 768, 770],
      [204, x + 4, y + 18 + 768, 770],
      [626, x + 4, y + 9 - 128, -128],
    ]);
    expect(fx.liveIds()).toEqual(expect.arrayContaining([623, 203, 204, 626]));
    // With the Four Sword the glow is 627; let go, it spins and they all stop.
    f.swordLevel = 2;
    hold(Button.Sword);
    expect(listed("charged:0:").map(([id]) => id)).toEqual([203, 204, 627]);
    hold(0);
    hold(0);
    expect(q().action).toBe("spin");
    expect(listed("charged:")).toEqual([]);
  });
});
