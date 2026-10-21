// Bombchus (bombchus.ts, BMTY): the spawners' directions, running and bouncing, arming, the bite, the fuse and the
// blast, what sets one off, a crystal ball's three, crawling in side view, and determinism through clones and hashes.
import { describe, expect, it } from "vitest";
import { BLAST_BOMBCHU } from "./bombs.ts";
import { BOMBCHU_ARM, BOMBCHU_BLAST_TICKS, BOMBCHU_DAMAGE, BOMBCHU_FUSE, BOMBCHU_KIND, BOMBCHU_SPEED, spawnBombchu } from "./bombchus.ts";
import { KNOCK_DEFAULT } from "./combat.ts";
import { isqrt, spawnEntity, type Entity } from "./entities.ts";
import { cloneGame, stepGame, type GameState } from "./game.ts";
import { hashGame } from "./hash.ts";
import { addCpus, cpuInputs } from "./cpu.ts";
import { breakOrb } from "./orbs.ts";
import { Button, SUBPX } from "./player.ts";
import type { ArenaProps } from "./props.ts";
import { GEN3_SPAWN_TICK, setSwitch, switchOn } from "./switches.ts";
import { arena, px, RULES, run, start, until } from "./testarena.ts";
import type { World } from "./world.ts";

const HP = RULES.hearts * 4;
const chus = (game: GameState) => game.battle!.entities.filter((e) => e.kind === "bombchu" && e.hp >= 0);
const speed = (e: Entity) => isqrt(e.vx * e.vx + e.vy * e.vy);

/** The Tower of Flames' kind of spawner (0x17, switch 30) at (160, 120), and the Dark Tower of Winds' (0x18, 17). */
const SPAWNERS: ArenaProps = {
  actors: [
    { id: "GEN3", x: 160, y: 120, params: 0xf0110097 },
    { id: "GEN3", x: 100, y: 60, params: 0x88110098 },
  ],
  bushes: [],
};

describe("bombchus", () => {
  const world = arena();

  it("come out of GEN3 spawners: 0x17 at 2.5 px a tick along any angle, 0x18 left or right, 2 ticks after the puff", () => {
    const game = start(world, [{ x: 40, y: 200, facing: "right" }, { x: 280, y: 200, facing: "left" }], SPAWNERS);
    setSwitch(game.battle!, 30, true);
    setSwitch(game.battle!, 17, true);
    run(game, world, GEN3_SPAWN_TICK); // (the switch seen on the next tick, the puff on the one after)
    expect(chus(game)).toEqual([]);
    stepGame(game, [], world);
    const [any, side] = chus(game);
    expect(Math.abs(speed(any!) - BOMBCHU_SPEED)).toBeLessThanOrEqual(2);
    expect([Math.abs(side!.vx), side!.vy]).toEqual([BOMBCHU_SPEED, 0]);
    expect(any!.timer).toBe(BOMBCHU_FUSE - 1); // (traced: 299 on its first tick)
    // Many seeds: the angles cover every way.
    const ways = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const g = start(world, [{ x: 40, y: 200, facing: "right" }, { x: 280, y: 200, facing: "left" }], SPAWNERS, RULES, seed);
      setSwitch(g.battle!, 30, true);
      run(g, world, GEN3_SPAWN_TICK + 1);
      const e = chus(g)[0]!;
      ways.add(`${Math.sign(e.vx)},${Math.sign(e.vy)}`);
    }
    expect(ways.size).toBeGreaterThanOrEqual(4);
  });

  it("run straight and bounce off walls (the blocked way reversed) and plain pits, and cross lava", () => {
    // A plain pit (type 0x03) at x 200-215; lava (0x0E) at x 120-135: both pits to a Link, only the first to a bombchu.
    const pitWorld: World = Object.assign(arena([25, 1, 2, 28, "O"], [15, 1, 2, 28, "O"]), {});
    const plain = new Uint8Array(pitWorld.widthCells * pitWorld.heightCells);
    for (let y = 1; y < 29; y++) for (const x of [25, 26]) plain[y * pitWorld.widthCells + x] = 1;
    Object.assign(pitWorld, { plainPit: plain });
    const game = start(pitWorld, [{ x: 40, y: 200, facing: "right" }, { x: 40, y: 40, facing: "left" }]);
    const e = spawnBombchu(game.battle!, 60 * SUBPX, 120 * SUBPX, BOMBCHU_KIND.sideways, BOMBCHU_SPEED, 0);
    until(game, pitWorld, () => e.vx < 0, 80);
    expect(px(e.x)).toBeGreaterThan(136); // over the lava, then turned back at the plain pit's edge
    expect(px(e.x)).toBeLessThan(200 - 7);
    until(game, pitWorld, () => e.vx > 0, 80); // and at the wall
    expect(px(e.x)).toBeLessThan(20);
    expect(e.vy).toBe(0);
  });

  it("let out of a crystal ball, it turns a quarter (×0.7) at its first wall, then bounces", () => {
    const game = start(world, [{ x: 40, y: 200, facing: "right" }, { x: 40, y: 40, facing: "left" }]);
    const e = spawnBombchu(game.battle!, 280 * SUBPX, 120 * SUBPX, BOMBCHU_KIND.orb, BOMBCHU_SPEED, 0);
    until(game, world, () => e.vy !== 0, 40);
    expect([e.vx, e.vy]).toEqual([Math.trunc((-BOMBCHU_SPEED * 7) / 10), Math.trunc((BOMBCHU_SPEED * 7) / 10)]);
  });

  it("is harmless for its first 30 ticks, then bites a Link it meets for 2 (the sword's knockback) and runs on", () => {
    const game = start(world, [{ x: 100, y: 120, facing: "down" }, { x: 40, y: 40, facing: "left" }]);
    const e = spawnBombchu(game.battle!, 100 * SUBPX, 120 * SUBPX, BOMBCHU_KIND.sideways, 0, 0); // standing under him
    const f = game.battle!.fighters[0]!;
    run(game, world, BOMBCHU_ARM);
    expect(f.hearts).toBe(HP);
    stepGame(game, [], world);
    expect([f.hearts, f.mode, f.pushX * f.pushX + f.pushY * f.pushY]).toEqual([HP - BOMBCHU_DAMAGE, "hurt", KNOCK_DEFAULT.speed ** 2]);
    expect(e.hp).toBeGreaterThanOrEqual(0); // still there
  });

  it("blows up when its 300-tick fuse runs out: ±16 px, 2 a hit, for all its 32 ticks; crystals don't light for it", () => {
    const props: ArenaProps = { actors: [{ id: "ONOF", x: 144, y: 104, params: 0x480020c0 }], bushes: [] };
    const game = start(world, [{ x: 40, y: 200, facing: "right" }, { x: 40, y: 40, facing: "left" }], props);
    const e = spawnBombchu(game.battle!, 160 * SUBPX, 120 * SUBPX, BOMBCHU_KIND.sideways, 0, 0);
    run(game, world, BOMBCHU_FUSE - 1);
    expect(e.hp).toBeGreaterThanOrEqual(0);
    stepGame(game, [], world);
    const blast = game.battle!.entities.find((x) => x.kind === "explosion")!;
    expect([e.hp < 0, blast.param & BLAST_BOMBCHU, blast.timer]).toEqual([true, BLAST_BOMBCHU, BOMBCHU_BLAST_TICKS]);
    // A Link walking into it late still gets hurt (a bomb's hurts only its first ticks).
    game.players[1]!.x = 160 * SUBPX;
    game.players[1]!.y = 136 * SUBPX;
    run(game, world, 20);
    expect(game.battle!.fighters[1]!.hearts).toBe(HP - BOMBCHU_DAMAGE);
    expect(switchOn(game.battle!, 9)).toBe(false); // (ONOF looks for bombs by name: main.dol 0x801F2718)
  });

  it("goes off when a sword hits it once armed, not before; of two armed ones meeting, the newer goes", () => {
    const game = start(world, [{ x: 100, y: 120, facing: "right" }, { x: 40, y: 40, facing: "left" }]);
    const e = spawnBombchu(game.battle!, 120 * SUBPX, 120 * SUBPX, BOMBCHU_KIND.sideways, 0, 0); // out of his body's reach
    stepGame(game, [Button.Sword], world); // a stab: the press standing
    run(game, world, 20);
    expect(e.hp).toBeGreaterThanOrEqual(0); // not armed yet
    run(game, world, BOMBCHU_ARM);
    stepGame(game, [Button.Sword], world);
    until(game, world, () => e.hp < 0, 12);
    const g2 = start(world, [{ x: 40, y: 200, facing: "right" }, { x: 40, y: 40, facing: "left" }]);
    const a = spawnBombchu(g2.battle!, 40 * SUBPX, 120 * SUBPX, BOMBCHU_KIND.sideways, BOMBCHU_SPEED, 0);
    const b = spawnBombchu(g2.battle!, 280 * SUBPX, 120 * SUBPX, BOMBCHU_KIND.sideways, -BOMBCHU_SPEED, 0);
    until(g2, world, () => a.hp < 0 || b.hp < 0, 80); // (meeting once both are armed)
    expect([a.hp >= 0, b.hp < 0]).toEqual([true, true]); // b, the newer, went first (a goes in its blast after)
  });

  it("from a crystal ball: one along the throw, two more fanning out from a throw along an axis", () => {
    const game = start(world, [{ x: 40, y: 200, facing: "right" }, { x: 40, y: 40, facing: "left" }]);
    const orb = spawnEntity(game.battle!, "orb", 160 * SUBPX, 120 * SUBPX, { item: "bombchu", phase: "flying" });
    breakOrb(game.battle!, orb, 4 * SUBPX, 0);
    const out = chus(game).map((e) => [e.vx, e.vy, e.param & 15]);
    expect(out).toEqual([
      [4 * SUBPX, 0, BOMBCHU_KIND.orb],
      [Math.trunc((4 * SUBPX * 7) / 10), Math.trunc((4 * SUBPX * 7) / 10), BOMBCHU_KIND.fan],
      [Math.trunc((4 * SUBPX * 7) / 10), -Math.trunc((4 * SUBPX * 7) / 10), BOMBCHU_KIND.fan],
    ]);
    expect(game.battle!.entities.some((e) => e.kind === "pickup")).toBe(false);
  });

  it("in side view, falls until it lands, then crawls along the floor, up the wall and along the ceiling", () => {
    // A side-view room: a floor at y 200, a wall at x 296, the ceiling at y 8.
    const side = arena();
    const game = start(side, [{ x: 40, y: 192, facing: "right" }, { x: 60, y: 192, facing: "left" }], { actors: [], bushes: [], sideViews: 1 });
    const e = spawnBombchu(game.battle!, 200 * SUBPX, 150 * SUBPX, BOMBCHU_KIND.sideways, BOMBCHU_SPEED, 0);
    until(game, side, () => e.facing === "down" && e.vy === 0 && e.y > 200 * SUBPX, 40); // on the floor (y 232)
    expect(px(e.y)).toBe(232 - 1 - 7); // its box (-7, -4)-(7, 7) on the floor
    until(game, side, () => e.facing === "right", 60); // its surface the wall on its right…
    expect(e.vy).toBeLessThan(0); // …climbing it
    until(game, side, () => e.facing === "up", 200); // along the ceiling
    expect(e.vx).toBeLessThan(0);
  });

  it("is deterministic: a clone and a JSON copy replay to the same hashes", () => {
    const game = start(world, [{ x: 100, y: 120, facing: "down" }, { x: 200, y: 160, facing: "left" }], SPAWNERS, RULES, 9);
    setSwitch(game.battle!, 30, true);
    setSwitch(game.battle!, 17, true);
    run(game, world, 40);
    const mid = cloneGame(game), copy = JSON.parse(JSON.stringify(game)) as GameState;
    const script = (t: number) => [t % 30 < 15 ? Button.Right : Button.Down | Button.Sword, t % 20 < 10 ? Button.Left : Button.Up];
    const a: number[] = [], b: number[] = [], c: number[] = [];
    for (let t = 0; t < 400; t++) {
      stepGame(game, script(t), world);
      stepGame(mid, script(t), world);
      stepGame(copy, script(t), world);
      a.push(hashGame(game));
      b.push(hashGame(mid));
      c.push(hashGame(copy));
    }
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("a CPU goes round armed bombchus in its way and out of their blasts, and still beats its rival", () => {
    for (const level of ["easy", "normal", "hard"] as const) {
      const game = addCpus(start(world, [{ x: 260, y: 120, facing: "left" }, { x: 60, y: 120, facing: "right" }]), [{ player: 1, level }]);
      // Three still ones across the way, armed at once.
      for (const y of [104, 120, 136]) spawnBombchu(game.battle!, 160 * SUBPX, y * SUBPX, BOMBCHU_KIND.sideways, 0, 0).tick = BOMBCHU_ARM;
      const bitten = () => game.battle!.hits.filter((h) => h.victim === 1 && h.cause === "bombchu").length;
      let bites = 0;
      for (let t = 0; t < 6000 && game.battle!.phase !== "matchOver"; t++) {
        stepGame(game, cpuInputs(game, world, [0]), world);
        bites += bitten();
      }
      expect([level, bites]).toEqual([level, 0]);
      expect(game.battle!.matchWinner).toBe(1);
    }
  });
});

// (The real arenas: winds.realdisc.test.ts has the Tower of Flames' eight and the Dark Tower of Winds' two.)
