// The adventure's enemy generators and kill counters (Shadow Battle's GEN3 is switches.ts, on the battle's own
// entities; the adventure runs its own on its enemies), read from main.dol and traced in Lake Hylia room 5's ambush
// (docs/measurements/adventure-enemies.md "Adventure: generators, kills and drops"):
// - GENE (init 0x802D06BC, update 0x802D010C): its switch in the params' top 5 bits; three enemy types (5 bits at
//   shifts 22, 17, 12: GENE_TYPES); (p >> 7) & 31 × 30 ticks between two (0: 10); p & 0x7F of them (0: 256). The tick
//   its switch is seen on it makes one, then one every interval, at (x + 8, y + 26); with the switch off it pauses.
//   The first type, unless 29 ticks before a spawn (intervals of 30 or more) a roll picks the third 10 times in 100 and
//   the second 30 (types 0-9 and 18 also show a puff then). Traced: room 5's 16 sword soldiers came one every 10 ticks
//   from the tick after the bridge's floor switch.
// - GEN3 (init 0x802EC4A8, update 0x802EC238): kind p & 0x7F (GEN3_TYPES, their params GEN3_PARAMS); the tick after
//   its switch comes on, a puff, and two ticks later the enemy at its anchor; then again every (p >> 7) & 0x1FF ticks,
//   (p >> 16) & 15 of them (0: no end). Then mode (p >> 20) & 15 0: done; 1: again once its switch went off and back
//   on (a mode-1 generator with 30 of its type about waits for that too).
// - SKIL (update 0x802ABCD8): turns its switch (top 5 bits) on for good once the room's kills reach p & 0xFF. The
//   stage keeps kills per screen (+0x6748, counted as an enemy that counts dies, 0x802D766C), from the room's start; mode
//   (p >> 22) & 31 0 adds up every screen's, the others count the SKIL's own screen (here: the room's, the same alone).
//   Traced: room 5's SKIL (16) opened the way west on the 16th kill.
// What they make that the adventure doesn't simulate (Hinox, Wizzrobes…) appears as nothing (and so never dies).
import { spawnBombchu, BOMBCHU_KIND } from "../bombchus.ts";
import { BOMB_FUSE } from "../bombs.ts";
import { isRemoved, spawnEntity } from "../entities.ts";
import { SUBPX } from "../player.ts";
import { setSwitch, switchOn } from "../switches.ts";
import { DEBRIS, DEBRIS_TICKS } from "../strike.ts";
import { currentArea, nextRandom, type AdventureGame } from "./adventure.ts";
import { dropHeart, spawnEnemy } from "./enemies.ts";
import { dropGem, HOVER_HEIGHT, HOVERING_GEMS } from "./pickups.ts";
import type { AdventureStage, AreaActor } from "./stage.ts";

/** GENE's types (its update's jump table 0x804A937C) and their params (0x8046DFE0; type 16: 20). */
export const GENE_TYPES: readonly string[] = ["HINO", "SLR1", "SLR1", "SLR1", "SLR1", "SLR1", "RUPY", "RUPY", "RUPY", "RUPY", "SLR1", "SLR1", "BMTY", "SLR1", "SLR1", "BMTY", "BMTY", "BMTY", "SLR1", "HNRY"];
export const GENE_PARAMS: readonly number[] = [0, 2, 0x10002, 4, 0x10004, 6, 0x30003, 0x30004, 0x30005, 0x30006, 0x40100, 0x10100, 3, 0x10102, 0x102, 4, 20, 0x103, 0x100, 0x71107];
/** GENE: ticks between spawns per unit of its field, and when it's 0. */
export const GENE_INTERVAL_UNIT = 30;
export const GENE_INTERVAL_ZERO = 10;
/** GENE: the roll for the next type, this many ticks before a spawn; the second's and the third's chances in 100. */
export const GENE_PICK_BEFORE = 29;
export const GENE_SECOND = 30;
export const GENE_THIRD = 10;
/** GENE: where its enemies appear (px from its anchor). */
export const GENE_SPAWN_DX = 8;
export const GENE_SPAWN_DY = 26;

/** GEN3's kinds (table 0x8046F398) and their params (0x8046F450). */
export const GEN3_TYPES: readonly string[] = [
  "STAL", "KETH", "SLR1", "SLR1", "DDGO", "GOMA", "DDRK", "BZBR", "SLR2", "PAME", "LPLK", "MIRA", "SLR4", "RIVR", "GDMN", "MOZO",
  "PEAC", "ROPE", "NZMI", "OKTA", "FAGN", "SLR3", "HBMB", "BMTY", "BMTY", "HINO", "SLR1", "SLR1", "SLR2", "SLR4", "Poon", "WIZR",
  "ZASL", "SLR3", "SLR1", "ZORA", "SLR1", "WIZR", "PAME", "PAME", "PAME", "PAME", "PAME", "HART", "DDGO", "KETH",
];
export const GEN3_PARAMS: readonly number[] = [
  0, 0, 0x100000, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 3, 0, 0x102, 0x1000004, 0x1000000, 0x1008800, 0, 5,
  0, 4, 0, 0, 6, 4, 3, 5, 7, 9, 1, 0, 0x12, 3,
];
/** GEN3: its puff the tick after its switch (or its interval), the enemy two ticks later. */
export const GEN3_PUFF_TICKS = 1;
export const GEN3_SPAWN_DELAY = 2;
/** GEN3 in mode 1 makes none while this many of its type are about. */
export const GEN3_MAX = 30;

export type GeneratorType = "GENE" | "GEN3" | "SKIL";

/** A generator or kill counter of the current area (AdventureState.gens). */
export interface Generator {
  type: GeneratorType;
  /** Its index in the room's actor list. */
  actor: number;
  /** GENE: 0 waiting for its switch, 1 making, 2 done; GEN3: 0 waiting, 1 counting to its puff, 2 to its spawn, 3 done,
   *  4 waiting for its switch to go off; SKIL: 0 counting, 1 done. */
  state: number;
  /** Ticks to the next step. */
  counter: number;
  /** Made so far (GENE), or left to make (GEN3). */
  made: number;
  /** GENE: the type (0-2) it makes next. */
  pick: number;
}

const field = (p: number, shift: number) => (p >>> shift) & 31;

/** The current area's generators and kill counters (all of them fresh: they start over with the area). */
export function spawnGenerators(game: AdventureGame, stage: AdventureStage): void {
  const a = game.adventure;
  a.gens = [];
  for (const actor of currentArea(game, stage).actors) {
    const p = actor.params >>> 0;
    if (actor.id === "GENE") a.gens.push({ type: "GENE", actor: actor.index, state: 0, counter: 1, made: 0, pick: 0 });
    else if (actor.id === "GEN3") a.gens.push({ type: "GEN3", actor: actor.index, state: 0, counter: 1, made: (p >>> 16) & 15, pick: 0 });
    else if (actor.id === "SKIL") a.gens.push({ type: "SKIL", actor: actor.index, state: 0, counter: 0, made: 0, pick: 0 });
  }
}

/** One tick of the area's generators and kill counters (after the enemies: the kills of this tick count). */
export function stepGenerators(game: AdventureGame, stage: AdventureStage): void {
  const a = game.adventure;
  if (!a.gens.length) return;
  const actors = currentArea(game, stage).actors;
  for (const g of a.gens) {
    const actor = actors.find((x) => x.index === g.actor);
    if (!actor) continue;
    if (g.type === "GENE") stepGene(game, stage, g, actor);
    else if (g.type === "GEN3") stepGen3(game, stage, g, actor);
    else if (g.state === 0) {
      const p = actor.params >>> 0;
      if (a.kills >= (p & 0xff)) {
        setSwitch(game.battle, p >>> 27, true);
        g.state = 1;
      }
    }
  }
}

function stepGene(game: AdventureGame, stage: AdventureStage, g: Generator, actor: AreaActor): void {
  if (g.state === 2) return;
  const p = actor.params >>> 0, sw = p >>> 27;
  if (sw && !switchOn(game.battle, sw)) {
    g.state = 0; // paused
    return;
  }
  g.state = 1;
  const types = [field(p, 22), field(p, 17), field(p, 12)];
  const count = p & 0x7f || 256, interval = field(p, 7) * GENE_INTERVAL_UNIT || GENE_INTERVAL_ZERO;
  const x = actor.x + GENE_SPAWN_DX, y = actor.y + GENE_SPAWN_DY;
  if (--g.counter === 0) {
    g.counter = interval;
    if (g.made >= count) {
      g.state = 2;
      return;
    }
    const type = types[g.pick]!;
    make(game, stage, GENE_TYPES[type] ?? "", GENE_PARAMS[type] ?? 0, x, y);
    if (++g.made >= count) g.state = 2;
  } else if (g.counter === GENE_PICK_BEFORE) {
    const r = nextRandom(game.adventure) % 100;
    g.pick = r < GENE_THIRD ? 2 : r < GENE_THIRD + GENE_SECOND ? 1 : 0;
    const type = types[g.pick]!;
    if (type <= 9 || type === 18) spawnEntity(game.battle, "debris", x * SUBPX, (y - 2) * SUBPX, { param: DEBRIS.smoke, timer: DEBRIS_TICKS });
  }
}

function stepGen3(game: AdventureGame, stage: AdventureStage, g: Generator, actor: AreaActor): void {
  const p = actor.params >>> 0, sw = p >>> 27, on = !sw || switchOn(game.battle, sw);
  const kind = p & 0x7f, type = GEN3_TYPES[kind] ?? "", mode = (p >>> 20) & 15;
  switch (g.state) {
    case 0:
      if (on) [g.state, g.counter] = [1, GEN3_PUFF_TICKS];
      return;
    case 1:
      if (--g.counter > 0) return;
      if (mode === 1 && game.adventure.enemies.filter((e) => e.type === type).length >= GEN3_MAX) {
        [g.state, g.made] = [4, (p >>> 16) & 15];
        return;
      }
      spawnEntity(game.battle, "debris", actor.x * SUBPX, actor.y * SUBPX, { param: DEBRIS.smoke, timer: DEBRIS_TICKS });
      [g.state, g.counter] = [2, GEN3_SPAWN_DELAY];
      return;
    case 2:
      if (--g.counter > 0) return;
      make(game, stage, type, GEN3_PARAMS[kind] ?? 0, actor.x, actor.y);
      g.counter = (p >>> 7) & 0x1ff;
      if (--g.made !== 0) {
        g.state = 1;
        if (g.counter === 0) g.counter = 1;
      } else if (mode === 1) [g.state, g.made] = [4, (p >>> 16) & 15];
      else g.state = 3;
      return;
    case 4:
      if (!on) g.state = 0;
      return;
  }
}

/** What a generator makes at (x, y), area px: an enemy, a Force Gem, a heart, or Shadow Battle's lit bomb or bombchu. */
function make(game: AdventureGame, stage: AdventureStage, type: string, params: number, x: number, y: number): void {
  const X = x * SUBPX, Y = y * SUBPX;
  switch (type) {
    case "RUPY":
      dropGem(game, X, Y, 0, params & 0xff);
      return;
    case "HNRY": {
      const kind = HOVERING_GEMS[params & 7]!;
      const a = game.adventure;
      a.pickups.push({ id: a.nextId++, type: "gem", from: "HNRY", actor: -1, x: X, y: Y, z: HOVER_HEIGHT, kind, gate: 0, tick: 0, vz: 0 });
      return;
    }
    case "HART":
      dropHeart(game, X, Y);
      return;
    case "HBMB":
      spawnEntity(game.battle, "bomb", X, Y, { timer: BOMB_FUSE });
      return;
    case "BMTY":
      // (GENE's type 16 only while there's none.)
      if (params === 20 && game.battle.entities.some((e) => e.kind === "bombchu" && !isRemoved(e))) return;
      spawnBombchu(game.battle, X, Y, (params & 15) === BOMBCHU_KIND.sideways ? BOMBCHU_KIND.sideways : BOMBCHU_KIND.anyway);
      return;
    default: {
      const e = spawnEnemy(game, stage, type, x, y, params);
      if (e) e.tick = -1; // (it acts from the next tick)
    }
  }
}
