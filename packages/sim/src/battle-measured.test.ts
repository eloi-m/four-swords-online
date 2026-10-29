// Regression against the real game in Shadow Battle: replays the GBA keys each Link's player pressed (Dolphin RAM traces
// in dolphin-battle-traces.json, made with tools/dolphin trace.ts + fixture.ts --battle; docs/measurements/battle-combat.md "Battle
// measurements: combat" and "Side rooms") through the sim on the real arena, and compares every Link's position, height,
// sprite frame, life and invincibility frame by frame. The arenas have none of their props (no orbs, no hazards) but
// the Tower of Winds' side views and gates. Needs extracted/ (the arenas' collision); skips without it.
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { linkFrame, lungeHeight } from "./actions.ts";
import { buildArenaWorld } from "./arena.ts";
import { createBattle } from "./battle.ts";
import { fighterFrame, fighterVisible } from "./combat.ts";
import type { ItemKind } from "./entities.ts";
import { stepGame } from "./game.ts";
import { SUBPX, type Facing } from "./player.ts";
import { arenaProps, NO_PROPS, sideRoomsOf, stageWarps, type ArenaProps } from "./props.ts";
import type { World } from "./world.ts";

type Row = [buttons: number, x: number, y: number, z: number, sprite: number, state: number, life: number, invincible: number];
interface Case {
  name: string;
  script: string;
  room: number;
  players: number;
  start: { x: number; y: number; facing: number; life: number; item?: number; level?: number; sword?: number }[];
  frames: Row[][];
}
const fixture = JSON.parse(readFileSync(new URL("./dolphin-battle-traces.json", import.meta.url), "utf8")) as { cases: Case[] };

const FACINGS: readonly Facing[] = ["right", "left", "down", "up"];
/** Link +0xC10 → the sim's item (docs/measurements.md: 1 boots, 3 boomerang, 4 bow, 5 hammer, 6 Fire Rod, 8 bombs, 10 slingshot). */
const ITEMS: Readonly<Record<number, ItemKind>> = { 1: "boots", 3: "boomerang", 4: "bow", 5: "hammer", 6: "fireRod", 8: "bomb", 10: "slingshot" };
/** The blank frame the game draws while a Link blinks. */
const BLANK = 289;
const STATE_WALK = 2;

interface Result {
  /** Largest position error (px) and the frame it happened on. */
  pos: number;
  posAt: number;
  z: number;
  /** Frames (index, player) whose life / invincibility / sprite differ. */
  life: string[];
  invincible: string[];
  sprites: string[];
}

function replay(c: Case, world: World, props: ArenaProps, only?: readonly number[]): Result {
  const spawns = c.start.map((s) => ({ x: Math.round(s.x), y: Math.round(s.y), facing: FACINGS[s.facing]! }));
  const game = createBattle(c.room, spawns, { hearts: 3, timeLimit: 0, wins: 9 }, props, 1);
  const b = game.battle!;
  b.phase = "play";
  game.players.forEach((p, i) => {
    const s = c.start[i]!;
    p.x = Math.round(s.x * SUBPX);
    p.y = Math.round(s.y * SUBPX);
    p.facing = FACINGS[s.facing]!;
    b.fighters[i]!.hearts = s.life;
    if (s.item !== undefined && ITEMS[s.item]) b.fighters[i]!.item = ITEMS[s.item]!;
    // (The cases without a recorded level poked their item at level 1.)
    b.fighters[i]!.itemLevel = s.level || 1;
    b.fighters[i]!.swordLevel = s.sword || 1;
  });
  const r: Result = { pos: 0, posAt: 0, z: 0, life: [], invincible: [], sprites: [] };
  for (let t = 1; t < c.frames.length; t++) {
    const rows = c.frames[t]!;
    stepGame(game, rows.map((row) => row[0]), world);
    rows.forEach(([, x, y, z, sprite, state, life, invincible], i) => {
      if (only && !only.includes(i)) return;
      const p = game.players[i]!, f = b.fighters[i]!;
      const err = Math.max(Math.abs(p.x / SUBPX - x), Math.abs(p.y / SUBPX - y));
      if (err > r.pos) [r.pos, r.posAt] = [err, t];
      r.z = Math.max(r.z, Math.abs((f.z + lungeHeight(p)) / SUBPX - z));
      if (f.hearts !== life) r.life.push(`${t}:P${i + 1} ${f.hearts}≠${life}`);
      if (f.invincible !== invincible) r.invincible.push(`${t}:P${i + 1} ${f.invincible}≠${invincible}`);
      const shown = fighterVisible(f) ? fighterFrame(p, f, linkFrame) : BLANK;
      // On the tick Link stops the game still shows a walk frame (its walk state lingers a tick); the sim stands at once.
      const [, px, py] = c.frames[t - 1]![i]!;
      const stopTick = state === STATE_WALK && x === px && Math.abs(y - py) <= (c.room === 2 || c.room === 7 ? 0.5 : 0); // (side view: the jitter)
      if (shown !== sprite && !stopTick) r.sprites.push(`${t}:P${i + 1} ${shown}≠${sprite}`);
    });
  }
  return r;
}

const root = new URL("../../../extracted/", import.meta.url);
const boss500 = new URL("files/GC4Sword_usa/Boss/boss500.arc", root);
/**
 * What each case must match. Positions within `pos` px (the pushes' decay and the Links' pushes are rounded to 1/256 px
 * a tick), heights within 0.01 px, life and invincibility exactly, sprites exactly but for `sprites` known differences:
 * the tick a Link falls into
 * a pit still shows his walk frame, a carrier shows his carry pose on the tick his load wriggles free.
 */
const EXPECT: Readonly<Record<string, { pos?: number; sprites?: number; players?: number[]; props?: string[] }>> = {
  charge: { sprites: 1 },
  blockLunge: { pos: 0.02 },
  // P2, pushed away down-right, slides round the corner of the beehive tree's base by P2's start (combat.ts slideBy:
  // pushes slide round corners as walking does; 0.12 px off at most).
  clash: { pos: 0.13, sprites: 2 },
  escape: { sprites: 1 },
  throw3: { pos: 0.05 }, // the thrown Link pushed off the knocked-back one by 3 px: the pushes' rounding
  bump: { pos: 0.1 },
  // The pushes' rounding (0.1 px by the 14th tick) flips one tick's "bodies touch" test at the end of the roll (and so
  // the walk P2 shows on the tick after).
  roll: { pos: 0.8, sprites: 2 },
  pit: { sprites: 1 },
  pitUp: { sprites: 1 },
  // After the death animation the game leaves him lying (195) where the sim hides a dead Link: 30 ticks here.
  pitDeath: { sprites: 1 + 30 },
  // Side view (the Tower of Winds): standing, the game's Link jitters 0.5 px (its gravity against the ground, every
  // tick), where the sim's rests half a pixel over the ground. The gate: the game shows the walk out's last frame a tick
  // longer. The ladder is cut at its top, where the game's Link goes into his pushing pose (state 13, not modelled), and
  // starts again from his turn there (the pose costs him a tick).
  windsGate: { pos: 0.6, sprites: 1 },
  windsLadder: { pos: 0.6 },
  windsLadderDown: { pos: 0.6 },
  windsHit: { pos: 0.6 },
  // Sliding off the ledge's corner (3.3 and 2.2 px a frame in the game), 0.6 px apart at most.
  windsKnockOff: { pos: 0.7 },
  // Items (docs/measurements/battle-combat.md "Items, levels and the Four Sword"). A drawn arrow lets its Link go 0.3 px off along
  // both axes (not modelled); the knockback along a diagonal and the diagonal walk are 1/256 px rounded (1.0625 for
  // 1.0607 px/tick); walking into a stake P1 pushes it (670, 671: state 13, push.ts).
  bowDrawn: { pos: 0.31 },
  bowDrawnL1: { pos: 0.31 },
  bowWalk: { pos: 0.02 },
  slingDrawn3: { pos: 0.05 },
  bombL2: {},
  // A Link walking into a blast on its last hurting tick (bombs.ts EXPLOSION_HURT_TICKS; bombLateMiss: a tick later,
  // unhurt): the game still shows his walk frame on the tick he's hit, the sim his knockback pose's first.
  bombLate: { sprites: 1 },
  // The Tower of Flames' rim (arena.ts RIM): the game's Link stops with his side on it (x 409), the sim's 0.5 px short
  // of the 8 px cell; the case ends before the push state (state 13) would set in.
  flamesRim: { pos: 0.51 },
  // The Pegasus Boots (docs/measurements/battle-combat.md "The Pegasus Boots"): the knocked-back Link's diagonal rounding;
  // the crash into the beehive tree's canopy stops the sim's Link 0.5 px short (walls back him off in half pixels).
  bootsHit: { pos: 0.02 },
  bootsCrash: { pos: 0.51 },
  bootsJolt: { pos: 0.51 },
  // The blocked Link and the dasher pushed apart every tick of the contact, then the dasher carried off by his push once
  // the dash is over: the pushes' rounding over 40 ticks.
  bootsBlock: { pos: 0.09 },
  // The Fire Rod and the Magic Hammer (docs/measurements/battle-combat.md "The Magic Hammer and the Fire Rod, traced"):
  // the tick a pushed Link is set alight the game still shows his walk frame, the sim his pose before it; the tick a
  // burning Link is hurt by his own BLZE the game still shows his run; walking into a wall through the stream and while
  // flattened, the game's Link jitters (by 0.375 px) or stops half a pixel further (walls back him off in half pixels).
  fireSteer: { sprites: 1 },
  fireTree: { sprites: 1 },
  fireStream: { pos: 0.26 },
  hammerTap: { pos: 0.51 },
  // A plain pit (Above the Clouds' outer void): the 4 ticks before he falls, the game's walking Link shows his walk,
  // stops, stands and walks a step before he's put back and falls, where the sim's is drawn standing; a burning Link
  // shows his run on those ticks.
  cloudsPitLeft: { sprites: 2 },
  cloudsPitDown: { sprites: 2 },
  cloudsPitWait: { sprites: 2 },
  fireCloudsPit: { sprites: 4 },
  // Above the Clouds' colored panels (their RBPN props only; the cases start 8 frames in, where the round's panels
  // start counting): standing on one as it turned P2's color, and walking onto one of P2's color.
  cloudsRingStand: { sprites: 2, props: ["RBPN"] },
  cloudsRingWalk: { sprites: 2, props: ["RBPN"] },
};

describe.skipIf(!existsSync(boss500))("sim vs Dolphin Shadow Battle traces", () => {
  if (!existsSync(boss500)) return void it.skip("needs extracted/", () => {});
  const stage = new Stage(parseRarc(decompressYaz0(readFileSync(boss500))));
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const worlds = new Map<number, World>();
  const world = (room: number) => worlds.get(room) ?? worlds.set(room, buildArenaWorld(stage, tileTypes, room)).get(room)!;
  /** The arena's side views and warps (the Tower of Winds' TV is side view, its gates lead to its gallery). */
  const propsOf = (room: number): ArenaProps => {
    const { rooms, sideViews } = sideRoomsOf(stage, tileTypes, room);
    return sideViews & 1 ? { ...NO_PROPS, warps: stageWarps(stage, tileTypes, room), sideRooms: rooms, sideViews } : NO_PROPS;
  };

  for (const c of fixture.cases) {
    it(`${c.name}: ${c.script.length > 90 ? c.script.slice(0, 87) + "…" : c.script}`, () => {
      const want = EXPECT[c.name] ?? {};
      const props = want.props ? { ...propsOf(c.room), actors: arenaProps(stage, tileTypes, c.room).actors.filter((a) => want.props!.includes(a.id)) } : propsOf(c.room);
      const r = replay(c, world(c.room), props, want.players);
      expect(r.pos, `worst at frame ${r.posAt}`).toBeLessThan(want.pos ?? 0.015);
      expect(r.z).toBeLessThan(0.01);
      expect(r.life).toEqual([]);
      expect(r.invincible).toEqual([]);
      expect(r.sprites.length, r.sprites.slice(0, 8).join(" ")).toBeLessThanOrEqual(want.sprites ?? 0);
    });
  }
});
