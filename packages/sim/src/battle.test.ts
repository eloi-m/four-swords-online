import { MAP_GRID } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { linkFrame } from "./actions.ts";
import { PLAYER_ANIMATIONS } from "./animations.ts";
import { COUNTDOWN_TICKS, createBattle, restartBattle, RESULT_TICKS, ROUND_OVER_TICKS, standing, type BattleRules, type Spawn } from "./battle.ts";
import {
  DEAD_FRAME,
  DEATH_TICKS,
  FALL_SEQUENCE,
  FALL_TICKS,
  GUARD_TICKS,
  fighterFrame,
  fighterHeight,
  fighterVisible,
  FLASH_TICKS,
  HEART,
  HURT_TICKS,
  INVINCIBLE_TICKS,
  KNOCK_DEFAULT,
  KNOCKBACK_SPEED,
  KNOCKBACK_TICKS,
  LUNGE_DAMAGE,
  PIT_DAMAGE,
  RESPAWN_INVINCIBLE_TICKS,
  SWORD_DAMAGE,
} from "./combat.ts";
import { cloneGame, stepGame, type GameState } from "./game.ts";
import { Button, HITBOX, SUBPX, WALK_SPEED } from "./player.ts";
import { surfaceAt, type World } from "./world.ts";

// A world from ASCII rows, one character per 8×8 cell: '#' solid, 'O' pit, anything else floor.
function worldFrom(rows: string[]): World {
  const widthCells = rows[0]!.length, heightCells = rows.length;
  const solid = new Uint8Array(widthCells * heightCells), surface = new Uint8Array(widthCells * heightCells);
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c === "#") solid[y * widthCells + x] = 1;
      if (c === "O") surface[y * widthCells + x] = 1; // SURFACE_CODES[1] = "pit", checked below
    }),
  );
  const rooms = new Int16Array(MAP_GRID * MAP_GRID).fill(-1);
  rooms[0] = 0;
  const world = { widthCells, heightCells, solid, surface, rooms };
  if (rows.some((r) => r.includes("O"))) {
    const y = rows.findIndex((r) => r.includes("O"));
    expect(surfaceAt(world, rows[y]!.indexOf("O") * 8, y * 8)).toBe("pit");
  }
  return world;
}

/** An open 320×240 px arena with a wall border, plus extra walls/pits drawn with `paint(x, y, w, h, c)` (cells). */
function arena(...features: [x: number, y: number, w: number, h: number, c: string][]): World {
  const rows = Array.from({ length: 30 }, (_, y) => Array.from({ length: 40 }, (_, x): string => (x === 0 || y === 0 || x === 39 || y === 29 ? "#" : ".")));
  for (const [fx, fy, w, h, c] of features) for (let y = fy; y < fy + h; y++) for (let x = fx; x < fx + w; x++) rows[y]![x] = c;
  return worldFrom(rows.map((r) => r.join("")));
}

const RULES: BattleRules = { hearts: 2, timeLimit: 0, wins: 2 };

function start(world: World, spawns: Spawn[], rules = RULES): GameState {
  const game = createBattle(0, spawns, rules);
  for (let i = 0; i < COUNTDOWN_TICKS; i++) stepGame(game, [], world);
  expect(game.battle!.phase).toBe("play");
  return game;
}

const px = (v: number) => Math.floor(v / SUBPX);

/** Presses the sword for one tick (player `who`), then steps `after` more ticks with no input: from standing, a stab. */
function swing(game: GameState, world: World, who: number, after = 0): void {
  const inputs = game.players.map((_, i) => (i === who ? Button.Sword : 0));
  stepGame(game, inputs, world);
  for (let i = 0; i < after; i++) stepGame(game, [], world);
}

/** Steps with no input until `done` (at most `max` ticks); returns the ticks taken. */
function until(game: GameState, world: World, done: () => boolean, max = 600, inputs: number[] = []): number {
  for (let t = 0; ; t++) {
    if (done()) return t;
    if (t === max) throw new Error("condition never met");
    stepGame(game, inputs, world);
  }
}

describe("Shadow Battle combat", () => {
  it("ignores input during the countdown", () => {
    const world = arena();
    const game = createBattle(0, [{ x: 100, y: 100, facing: "right" }, { x: 200, y: 100, facing: "left" }], RULES);
    for (let i = 0; i < COUNTDOWN_TICKS - 1; i++) stepGame(game, [Button.Right | Button.Sword, 0], world);
    expect([game.players[0]!.x, game.players[0]!.action, game.battle!.phase]).toEqual([100 * SUBPX, "none", "countdown"]);
    stepGame(game, [Button.Right | Button.Sword, 0], world);
    expect(game.battle!.phase).toBe("play");
    stepGame(game, [Button.Right | Button.Sword, 0], world); // held since the countdown: no attack, the turn tick
    expect([game.players[0]!.action, game.players[0]!.x]).toEqual(["none", 100 * SUBPX]);
    stepGame(game, [Button.Right | Button.Sword, 0], world); // then walking
    expect(game.players[0]!.action).toBe("none");
    expect(game.players[0]!.x).toBe(100 * SUBPX + WALK_SPEED);
  });

  it("a sword hit costs hearts, knocks the victim away from the attacker, then control comes back", () => {
    const world = arena();
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 120, y: 100, facing: "right" }]);
    const [, victim] = game.players, fv = game.battle!.fighters[1]!;
    swing(game, world, 0);
    until(game, world, () => fv.mode === "hurt");
    expect(fv.hearts).toBe(2 * HEART - SWORD_DAMAGE);
    expect(fv.invincible).toBe(INVINCIBLE_TICKS);
    const x0 = victim!.x;
    // Measured: 1.5 px/tick away from the attacker while hopping (3.0 px/tick up, 0.25 down per tick), 25 ticks.
    for (let i = 0; i < KNOCKBACK_TICKS - 1; i++) stepGame(game, [], world);
    expect(PLAYER_ANIMATIONS.knockback.frames.right).toContain(fighterFrame(victim!, fv, linkFrame));
    expect([fv.mode, fighterHeight(fv) > 0]).toEqual(["hurt", true]);
    stepGame(game, [], world);
    expect([KNOCKBACK_TICKS, KNOCKBACK_SPEED]).toEqual([25, 384]);
    expect(victim!.x - x0).toBe(KNOCKBACK_TICKS * KNOCKBACK_SPEED);
    expect(victim!.y).toBe(100 * SUBPX);
    expect([fv.mode, fv.modeTick, fv.z]).toEqual(["active", 0, 0]); // landed
    stepGame(game, [0, Button.Left], world);
    expect(victim!.facing).toBe("left");
  });

  it("knockback stops at walls, and invincibility frames ignore hits until they run out", () => {
    // A wall at cells x 17-18 (px 136-151); the victim stands with his hitbox 2 px short of it.
    const world = arena([17, 1, 2, 28, "#"]);
    const game = start(world, [{ x: 108, y: 100, facing: "right" }, { x: 128, y: 100, facing: "up" }]);
    const victim = game.players[1]!, fv = game.battle!.fighters[1]!;
    swing(game, world, 0);
    until(game, world, () => fv.mode === "hurt");
    until(game, world, () => fv.mode === "active");
    expect(px(victim.x) + HITBOX.right).toBe(17 * 8 - 1); // pressed against the wall
    expect(fv.hearts).toBe(2 * HEART - SWORD_DAMAGE);

    // Still invincible: a second swing connects with nothing.
    expect(fv.invincible).toBeGreaterThan(20);
    swing(game, world, 0, 20);
    expect(fv.hearts).toBe(2 * HEART - SWORD_DAMAGE);
    expect(fighterVisible(fv)).not.toBe(fighterVisible({ ...fv, invincible: fv.invincible - FLASH_TICKS })); // blinking

    until(game, world, () => fv.invincible === 0);
    expect(fighterVisible(fv)).toBe(true);
    swing(game, world, 0);
    until(game, world, () => fv.mode === "hurt", 20);
    expect(fv.hearts).toBe(2 * HEART - 2 * SWORD_DAMAGE);
  });

  it("the shield blocks a stab from the front: both Links slide apart, pushed again while the sword still meets him", () => {
    const world = arena();
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 122, y: 100, facing: "left" }]);
    const [attacker, victim] = game.players, [fa, fv] = game.battle!.fighters;
    swing(game, world, 0);
    until(game, world, () => game.battle!.hits.length > 0, 20);
    expect(game.battle!.hits).toEqual([{ attacker: 0, victim: 1, blocked: true, damage: SWORD_DAMAGE }]);
    expect([fv!.mode, fv!.hearts, fv!.invincible, fv!.guard]).toEqual(["active", 2 * HEART, 0, GUARD_TICKS]);
    // Traced: 2 px/tick each for the 5 ticks the stab's box still meets his body (22 → 38 px apart), then × 0.9.
    const moves: number[] = [];
    for (let i = 0; i < 6; i++) {
      const x = victim!.x;
      stepGame(game, [], world);
      moves.push(victim!.x - x);
    }
    expect(moves.map((m) => Math.round(m / 25.6) / 10)).toEqual([2, 2, 2, 2, 2, 1.8]);
    expect(game.battle!.hits).toEqual([]); // the block was reported on its first tick only
    until(game, world, () => !fv!.slideX && !fa!.slideX, 40);
    // 26 px each in all (traced: 26.0).
    expect((100 * SUBPX - attacker!.x) / SUBPX).toBeCloseTo(26, 0);
    expect((victim!.x - 122 * SUBPX) / SUBPX).toBeCloseTo(26, 0);
    expect(fv!.hearts).toBe(2 * HEART);
  });

  it("the shield compares facings: facing against the attack's direction blocks it whatever the angle", () => {
    const world = arena();
    // Below-right of the attacker, farther down than across: still blocked by a shield facing left (traced).
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 114, y: 114, facing: "left" }]);
    game.players[1]!.x = 114.5 * SUBPX; // bodies just apart (they would push each other otherwise)
    game.players[1]!.y = 114.9 * SUBPX;
    swing(game, world, 0);
    until(game, world, () => game.battle!.hits.length > 0, 20);
    expect(game.battle!.hits[0]!.blocked).toBe(true);
    expect(game.battle!.fighters[1]!.slideY).toBeGreaterThan(0); // pushed along the line between them
  });

  it("two attacks meeting face to face clash: no damage, both recoil and slide apart", () => {
    const world = arena();
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 124, y: 100, facing: "left" }]);
    stepGame(game, [Button.Sword, Button.Sword], world);
    stepGame(game, [Button.Sword, Button.Sword], world);
    expect(game.battle!.hits).toEqual([{ attacker: 0, victim: 1, blocked: true, damage: 0, cause: "clash" }]);
    expect(game.players.map((p) => p.action)).toEqual(["tink", "tink"]);
    until(game, world, () => game.players.every((p) => p.action === "none"), 20);
    expect(game.battle!.fighters.map((f) => [f.hearts, f.mode])).toEqual([
      [2 * HEART, "active"],
      [2 * HEART, "active"],
    ]);
    expect(px(game.players[1]!.x) - px(game.players[0]!.x)).toBeGreaterThan(24 + 30);
  });

  it("a Link busy with a move has no shield: the stab gets through from the front", () => {
    const world = arena();
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 124, y: 100, facing: "left" }]);
    const fv = game.battle!.fighters[1]!;
    stepGame(game, [0, Button.Action], world); // nothing to lift (P1 is 24 px away), standing: an empty lift from P+3
    for (let i = 0; i < 3; i++) stepGame(game, [], world);
    expect(fv.move).toBe("emptyLift");
    swing(game, world, 0);
    until(game, world, () => fv.mode === "hurt", 20);
    expect(fv.hearts).toBe(2 * HEART - SWORD_DAMAGE);
  });

  it("a lunge hits twice as hard as a swing or a stab (attack power 8 against 4, halved between Links)", () => {
    const world = arena();
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 150, y: 100, facing: "down" }]);
    const fv = game.battle!.fighters[1]!;
    stepGame(game, [Button.Sword | Button.Right, 0], world); // from standing with the stick pushed: a lunge
    expect(game.players[0]!.action).toBe("lunge");
    until(game, world, () => fv.mode === "hurt", 40);
    expect([fv.hearts, game.battle!.hits[0]!.damage]).toEqual([2 * HEART - LUNGE_DAMAGE, LUNGE_DAMAGE]);
    expect([LUNGE_DAMAGE, SWORD_DAMAGE, fv.vz]).toEqual([4, 2, KNOCK_DEFAULT.hop]); // 4 damage: still the 3.0 hop
  });

  it("hits from behind or the side get through the shield", () => {
    const world = arena();
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 120, y: 100, facing: "down" }]);
    swing(game, world, 0);
    until(game, world, () => game.battle!.fighters[1]!.mode === "hurt", 20);
    expect(game.battle!.fighters[1]!.hearts).toBe(2 * HEART - SWORD_DAMAGE);
  });

  it("walking into a pit: 8 px in, the fall, a jump back out onto the edge, the pit's damage and 180 invincibility", () => {
    const world = arena([20, 1, 6, 28, "O"]); // pit at px 160-207
    const game = start(world, [{ x: 140, y: 100, facing: "right" }, { x: 60, y: 200, facing: "left" }]);
    const p = game.players[0]!, f = game.battle!.fighters[0]!;
    let ticks = 0;
    while (f.mode === "active" && ticks++ < 100) stepGame(game, [Button.Right], world);
    expect([f.mode, px(p.x), f.hearts]).toEqual(["falling", 168, 2 * HEART]); // the anchor crossed px 160
    stepGame(game, [Button.Right], world);
    stepGame(game, [Button.Right], world);
    expect(fighterFrame(p, f, linkFrame)).toBe(FALL_SEQUENCE.frames[0]);
    while (f.modeTick < FALL_TICKS - 1) stepGame(game, [Button.Right], world);
    // Landing on the edge he came from, 7 px past its last floor pixel (159; traced on the trick floor going left): the
    // damage, and 180 invincibility ticks counting this one.
    expect([f.mode, px(p.x), px(p.y), f.z, f.hearts, f.invincible]).toEqual(["falling", 152, 100, 0, 2 * HEART - PIT_DAMAGE, RESPAWN_INVINCIBLE_TICKS - 1]);
    stepGame(game, [Button.Right], world);
    expect(f.mode).toBe("active");
    expect(fighterVisible(f)).toBe(true); // the blink starts 5 ticks after it was set
    expect(fighterVisible({ ...f, invincible: RESPAWN_INVINCIBLE_TICKS - 5 })).toBe(false);
  });

  it("a hit can knock a Link into a pit: he falls in where he lands", () => {
    const world = arena([19, 1, 6, 28, "O"]); // pit from px 152
    const game = start(world, [{ x: 120, y: 100, facing: "right" }, { x: 140, y: 100, facing: "right" }]);
    const f = game.battle!.fighters[1]!;
    swing(game, world, 0);
    until(game, world, () => f.mode === "falling", 40);
    expect(f.hearts).toBe(2 * HEART - SWORD_DAMAGE);
    until(game, world, () => f.mode === "active", FALL_TICKS + 1);
    expect(f.hearts).toBe(2 * HEART - SWORD_DAMAGE - PIT_DAMAGE);
  });
});

describe("Shadow Battle rounds", () => {
  it("the last Link standing wins the round; the first to `wins` stars wins the match", () => {
    const world = arena();
    const game = start(world, [{ x: 100, y: 100, facing: "right" }, { x: 120, y: 100, facing: "up" }]);
    const b = game.battle!;
    for (const round of [1, 2]) {
      expect([b.round, b.phase]).toEqual([round, "play"]);
      b.fighters[1]!.hearts = SWORD_DAMAGE; // one hit from defeat
      expect(b.downs).toEqual([-1, -1]);
      swing(game, world, 0);
      until(game, world, () => b.phase === "roundOver", 20);
      expect([b.roundWinner, b.fighters[0]!.stars, standing(b)]).toEqual([0, round, [0]]);
      // The knockout's tick: the state right after the step that took his last heart (where roundOver's tick is 0).
      expect([b.downs, b.phaseTick]).toEqual([[-1, game.tick], 0]);
      const knockout = game.tick;
      const f = b.fighters[1]!;
      until(game, world, () => f.mode === "dying", HURT_TICKS + 1);
      expect(PLAYER_ANIMATIONS.death.frames).toContain(fighterFrame(game.players[1]!, f, linkFrame));
      until(game, world, () => f.mode === "dead", DEATH_TICKS + 1);
      expect([fighterFrame(game.players[1]!, f, linkFrame), fighterVisible(f)]).toEqual([-1, false]); // (the game leaves him lying on DEAD_FRAME)
      expect(DEAD_FRAME).toBe(195);
      until(game, world, () => b.phase !== "roundOver", ROUND_OVER_TICKS);
      // The match's last round ends with its result (the game's "PRESS START"), the others after the Total screen too.
      expect(game.tick - knockout).toBe(round === 1 ? ROUND_OVER_TICKS : RESULT_TICKS);
      if (round === 1) {
        // Next round: everyone back at their start with full hearts; stars carry over.
        expect(b.phase).toBe("countdown");
        expect(b.fighters.map((f) => [f.hearts, f.mode, f.stars])).toEqual([[2 * HEART, "active", 1], [2 * HEART, "active", 0]]);
        expect(game.players.map((p) => [px(p.x), px(p.y), p.facing])).toEqual([[100, 100, "right"], [120, 100, "up"]]);
        expect(b.downs).toEqual([-1, -1]);
        until(game, world, () => b.phase === "play", COUNTDOWN_TICKS);
      }
    }
    expect([b.phase, b.matchWinner]).toEqual(["matchOver", 0]);
    for (let i = 0; i < 100; i++) stepGame(game, [Button.Right, Button.Sword], world); // the match stays over
    expect(b.phase).toBe("matchOver");
    const again = restartBattle(game);
    expect([again.battle!.phase, again.battle!.round, again.battle!.fighters[0]!.stars]).toEqual(["countdown", 1, 0]);
  });

  it("falling with his last life, Link dies on the edge when he lands: the round ends then", () => {
    const world = arena([20, 1, 6, 28, "O"]);
    const game = start(world, [{ x: 140, y: 100, facing: "right" }, { x: 60, y: 200, facing: "left" }]);
    const f = game.battle!.fighters[0]!;
    f.hearts = PIT_DAMAGE;
    until(game, world, () => f.mode === "falling", 100, [Button.Right]);
    expect(game.battle!.phase).toBe("play");
    until(game, world, () => f.hearts === 0, FALL_TICKS);
    expect([game.battle!.phase, game.battle!.roundWinner, f.mode]).toEqual(["roundOver", 1, "falling"]);
    until(game, world, () => f.mode === "dead", DEATH_TICKS + 2);
  });

  it("without Vaati's bomb, at the time limit the most hearts wins, and a tie is a draw", () => {
    const world = arena();
    const spawns: Spawn[] = [{ x: 60, y: 60, facing: "right" }, { x: 200, y: 60, facing: "left" }, { x: 60, y: 160, facing: "right" }];
    const tie = start(world, spawns, { hearts: 4, timeLimit: 60, wins: 3, vaatiBomb: false });
    for (let i = 0; i < 59; i++) stepGame(tie, [], world);
    expect([tie.battle!.phase, tie.battle!.timeLeft]).toEqual(["play", 1]);
    stepGame(tie, [], world);
    expect([tie.battle!.phase, tie.battle!.roundWinner, tie.battle!.fighters.map((f) => f.stars)]).toEqual(["roundOver", -1, [0, 0, 0]]);

    const lead = start(world, spawns, { hearts: 4, timeLimit: 60, wins: 3, vaatiBomb: false });
    lead.battle!.fighters[0]!.hearts -= 1;
    lead.battle!.fighters[1]!.hearts -= 1;
    for (let i = 0; i < 60; i++) stepGame(lead, [], world);
    expect([lead.battle!.roundWinner, lead.battle!.fighters[2]!.stars]).toEqual([2, 1]);
  });

  it("a scripted 4-player match is deterministic and survives a JSON snapshot mid-way", () => {
    const world = arena([4, 14, 11, 3, "O"], [18, 12, 4, 4, "O"], [8, 20, 3, 3, "#"], [30, 6, 2, 8, "#"]);
    const spawns: Spawn[] = [
      { x: 80, y: 60, facing: "right" },
      { x: 240, y: 60, facing: "left" },
      { x: 80, y: 180, facing: "right" },
      { x: 240, y: 180, facing: "left" },
    ];
    const TICKS = 6000, FORK = 2500;
    // Bots: walk toward the nearest standing rival and swing when close, with some seeded noise.
    const bots = (game: GameState, seed: { s: number }) =>
      game.players.map((p, i) => {
        seed.s = (Math.imul(seed.s, 1103515245) + 12345) >>> 0;
        const noise = seed.s >>> 16;
        const rivals = standing(game.battle!).filter((j) => j !== i);
        if (!rivals.length) return 0;
        const d = (j: number) => Math.abs(game.players[j]!.x - p.x) + Math.abs(game.players[j]!.y - p.y);
        const t = game.players[rivals.reduce((a, j) => (d(j) < d(a) ? j : a))]!;
        const dx = px(t.x - p.x), dy = px(t.y - p.y);
        let b = 0;
        if (noise % 7 === 0) return [Button.Up, Button.Down, Button.Left, Button.Right][noise % 4]!;
        if (Math.abs(dx) > 14) b |= dx > 0 ? Button.Right : Button.Left;
        else if (Math.abs(dy) > 4) b |= dy > 0 ? Button.Down : Button.Up;
        if (Math.abs(dx) + Math.abs(dy) < 36 && noise % 3 === 0) b |= Button.Sword;
        return b;
      });
    const play = (game: GameState, seed: { s: number }, from: number, to: number, log: string[]) => {
      for (let t = from; t < to; t++) {
        stepGame(game, bots(game, seed), world);
        log.push(JSON.stringify(game));
      }
    };
    const run = () => {
      const game = createBattle(0, spawns, { hearts: 2, timeLimit: 30 * 60, wins: 2 });
      const seed = { s: 7 }, log: string[] = [];
      play(game, seed, 0, TICKS, log);
      return log;
    };
    const a = run();
    expect(a).toEqual(run());

    // Rollback-style: snapshot through JSON at FORK, carry on from the copy, and land on the same states.
    const game = createBattle(0, spawns, { hearts: 2, timeLimit: 30 * 60, wins: 2 });
    const seed = { s: 7 }, log: string[] = [];
    play(game, seed, 0, FORK, log);
    const copy = JSON.parse(JSON.stringify(cloneGame(game))) as GameState;
    play(copy, seed, FORK, TICKS, log);
    expect(log).toEqual(a);

    // The script actually exercises the rules.
    const states = a.map((s) => JSON.parse(s) as GameState);
    const final = states.at(-1)!.battle!;
    expect(states.some((s) => s.battle!.hits.some((h) => !h.blocked))).toBe(true);
    expect(states.some((s) => s.battle!.fighters.some((f) => f.mode === "falling"))).toBe(true);
    expect(final.round).toBeGreaterThan(1);
    expect(final.fighters.reduce((n, f) => n + f.stars, 0)).toBeGreaterThan(0);
  });
});
