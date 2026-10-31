// Actor checks for World 1's stages (Lake Hylia boss010, the Cave of No Return boss011, Tingle's Tower boss012, Hyrule
// Castle boss013): what the sim simulates against what apps/game draws.
//   node tools/playtest/src/actors.ts [stage…] [--captures] [--census]     (pnpm -s playtest:actors; a stage is its id
//   or lake, cave, tingle, castle; all four when none is named)
// The census (--census prints it): every placed actor type of the stage, simulated or not, and how apps/game draws it
// (EnemyView, a pickup, a still sprite from its actorPieces, its tile, an effect, or nothing): what isn't simulated at
// all is drawn only (a still sprite, a tile) or hidden.
// Static, every room and area (as played alone):
// - every actor the sim simulates has a drawing: its actorPieces resolve (a sprite's SOB frame exists, a bti piece's
//   file is in the stage's timg/), an enemy type has apps/game's EnemyView case, a tile-drawn one stands on a drawn
//   tile; hidden controllers (switch logic, warps) draw nothing by design;
// - every actor type is either simulated (named in packages/sim's code) or named in docs/ADVENTURE.md or
//   docs/BACKLOG.md (listed as not done);
// - every sign and person (KNBN, JIJI, SNPC, NAVI) has a message with printable text, or a flow (branch4, ifFlag) that
//   leads to one for every controller count (1-4, no flags set: the talk's MessageBook.resolve); a flow that leads
//   nowhere is a finding. It talks when faced (JIJI kinds that talk by themselves aren't done).
// Dynamic, along the stage's scripted route (lakehylia.ts, cavenoreturn.ts…), every other tick:
// - the tile swaps (rewrittenTiles: open doors, burnt stumps, PNPCs; tileOverrides: cut and lifted tiles, pressed
//   switches): an open door shows a walkable tile (not a wall, nor the void outside the room), no tile is swapped by
//   both, no swap lands outside the area's drawn rows;
// - the picture against the collision: a cell whose drawn tile is wall but walkable, or floor but solid, that wasn't
//   so when the Links came into the area;
// - the rocks and enemies on show have a drawing.
// Findings not listed in EXPECTED_ACTORS make the exit code 1; --captures writes the dynamic ones as captures.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTOR_SOB_FILES, actorLook, actorPieces, bmgMessageById, bmgPlainText, bmgTagArgs, bmgTagInfo, decompressYaz0, isHiddenUnsimulated, isYaz0, loadSob, parseBmg, solidMask,
  type ActorSob, type Bmg, type BmgTag, type SpriteFrame, type Stage,
} from "@fso/formats";
import { SUBPX, tileOverrides } from "@fso/sim";
import {
  actorKey, areaWorld, BLOCK_SLIDE_TICKS, BLOCK_WAYS, blockTiles, brokenTiles, burntTiles, colorBlocks, createAdventure, currentArea, doorCenter, doorLookTiles, ENEMY_TYPES, enemyShown, LEDGE_MASKS, MESSAGE_BASE, messageBook, openDoorTiles,
  drawnRewrites, PICKUP_TYPES, RoutePlayer, stepAdventure, type AdventureGame, type AdventureStage, type Area,
} from "@fso/sim/adventure";
import { findingId, writeCapture } from "./findings.ts";
import { archive, loadStage, stageArgs, STAGES, type PlayStage } from "./stage.ts";

const REPO = resolve(import.meta.dirname, "../../..");

/** A finding: its key (stable, for EXPECTED_ACTORS), what it is, and for the dynamic ones the route's buttons up to it. */
export interface ActorFinding {
  key: string;
  what: string;
  buttons?: number[];
}

// Known findings (by key) and what they are: reported, not fixed here.
export const EXPECTED_ACTORS: Readonly<Record<string, string>> = {
  // Room 6's raft is OBLF shape 20 (formats actorgraphics.ts): both 40 is a dark ball on the TV palette and Dolphin's
  // GBA window shows nothing there; its GBA-screen draw (0x80307AC8) isn't read, so it's left undrawn.
  "undrawn rock OBLF": "the raft's GBA-screen look not read (shape 20)",
  // Tingle's Tower room 10's flying floor tiles (sim traps.ts): their tile shows in the floor until they lift; lifted,
  // the game draws it on floor1_smp.bin, spinning (no SMP models in apps/game yet).
  "tingle undrawn enemy FLYO": "the flying tiles' look in the air not drawn (floor1_smp.bin)",
  // The open doors are drawn with the game's open tiles (doorlook.ts); their types (0x2A/0x2B: walkable quarters the
  // shut tiles' type 1 hasn't) aren't applied to the sim's collision, which keeps the door's wall (the warp takes the
  // Links through).
  "door picture 6/6/25": "doorlook.ts: the open tiles are drawn only, their types not applied to the collision",
  // The rest of World 1 (the stage's short name first), as bent.ts' classes: "finding (a)" a sim or view bug, "rule
  // (b)" unchecked, "drawn otherwise (c)" the check's own blind spot.
  "cave no look LWSW": "drawn otherwise (c): the candle is its tile (0x3D/0x1DE) and its light (apps/game light.ts); no lit flame sprite (actorgraphics.ts has no LWSW)",
  "cave no look RASN": "drawn otherwise (c): the staircase is its tiles",
  "castle no look RASN": "drawn otherwise (c): the staircase is its tiles",
  "castle no look SPBG": "drawn otherwise (c): the drawbridge is its tiles (logic.ts' bridges)",
  "castle no look THRN": "drawn otherwise (c): the spikes are tiles (logic.ts rewrittenTiles lowers them)",
  "castle no look FGAN": "drawn otherwise (c): Phantom Ganon is drawn by apps/game ganon.ts",
  "cave door picture 4/0/49": "rule (b): a kind-0 door without a switch (room 4's south door, the way in): forced open, it looks as shut and a cell by it is drawn floor but solid; whether it ever opens in play, and its open tiles (doorlook.ts), unchecked",
  "cave door look 4/0/49": "rule (b): as door picture 4/0/49 (it never looks open)",
  "cave door picture 6/0/18": "rule (b): as door picture 4/0/49 (room 6's south door, where the staircase lets the Links in)",
  "cave door look 6/0/18": "rule (b): as door picture 4/0/49",
  "cave door picture 11/0/12": "rule (b): as door picture 4/0/49 (room 11's south door)",
  "cave door look 11/0/12": "rule (b): as door picture 4/0/49",
  "castle door picture 3/2/23": "doorlook.ts: the open tiles are drawn only, their types not applied to the collision (the locked door the key opens; the warp takes the Links through)",
  "castle door picture 10/0/14": "doorlook.ts: the open tiles are drawn only, their types not applied to the collision (room 10's door the generator's kills open)",
  "castle picture 3/2/47": "doorlook.ts: as castle door picture 3/2/23, along the route",
  "castle picture 3/2/48": "doorlook.ts: as castle door picture 3/2/23, along the route",
  "castle picture 10/0/495": "doorlook.ts: as castle door picture 10/0/14, along the route",
  "castle picture 10/0/496": "doorlook.ts: as castle door picture 10/0/14, along the route",
};

/** The actor types packages/sim names in its code (a quoted four-letter id outside the tests). */
export function simulatedTypes(): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) for (const m of readFileSync(path, "utf8").matchAll(/"([A-Z][A-Z0-9]{3})"/g)) out.add(m[1]!);
    }
  };
  walk(join(REPO, "packages/sim/src"));
  return out;
}

/** The enemy types apps/game's EnemyView draws (its `case "XXXX"` labels). */
const drawnEnemies = (): Set<string> => new Set([...readFileSync(join(REPO, "apps/game/src/enemies.ts"), "utf8").matchAll(/case "([A-Z][A-Z0-9]{3})"/g)].map((m) => m[1]!));

/** The flow tags (a branch to other messages) in a message, as text. */
const flowTags = (parts: readonly { kind: string }[]): string[] =>
  parts
    .filter((p): p is BmgTag => p.kind === "tag")
    .filter((t) => /^(branch|if)/.test(bmgTagInfo(t)?.name ?? ""))
    .map((t) => `${bmgTagInfo(t)!.name}(${bmgTagArgs(t).join(", ")})`);

/** Every room and area of the stage (played alone). */
function areas(stage: AdventureStage): Area[] {
  const out: Area[] = [];
  for (const room of stage.rooms) for (let sub = 0; sub < 8; sub++) if (stage.hasArea(room, sub)) out.push(stage.area(room, sub));
  return out;
}

/** The static checks. */
export function staticChecks(stage: AdventureStage, source: Stage, bmg: Bmg): { findings: ActorFinding[]; notes: string[] } {
  const data = archive("data.arc");
  const sobs: Partial<Record<ActorSob, SpriteFrame[]>> = {};
  for (const [key, file] of Object.entries(ACTOR_SOB_FILES)) {
    try {
      sobs[key as ActorSob] = loadSob(data, file);
    } catch {
      // (Missing: its pieces don't resolve.)
    }
  }
  const timg = new Set(source.archive?.files.filter((f) => f.path.startsWith("timg/")).map((f) => f.path.slice(5)) ?? []);
  const dataTimg = new Set(data.files.filter((f) => f.path.startsWith("timg/")).map((f) => f.path.slice(5)));
  const simulated = simulatedTypes(), enemies = drawnEnemies(), book = messageBook(bmg);
  const docs = ["docs/ADVENTURE.md", "docs/BACKLOG.md"].map((f) => readFileSync(join(REPO, f), "utf8")).join("\n");
  const findings: ActorFinding[] = [], notes: string[] = [];
  const unsimulated = new Map<string, string[]>();
  for (const area of areas(stage)) {
    const where = `room ${area.room} area ${area.sublayer}`;
    for (const a of area.actors) {
      const at = `${a.id} #${a.index} at (${a.x}, ${a.y}) in ${where}`;
      if (!simulated.has(a.id)) {
        unsimulated.set(a.id, [...(unsimulated.get(a.id) ?? []), `${area.room}/${area.sublayer}`]);
        continue;
      }
      // Its drawing.
      if (ENEMY_TYPES.includes(a.id)) {
        if (!enemies.has(a.id)) findings.push({ key: `undrawn enemy ${a.id}`, what: `${at}: an enemy apps/game's EnemyView has no drawing for` });
      } else if (!PICKUP_TYPES.includes(a.id)) {
        const look = actorLook(a.id), pieces = actorPieces({ id: a.id, sublayer: area.sublayer, x: a.x / 8, y: a.y / 8, params: a.params });
        for (const p of pieces) {
          if (p.kind === "bti" && !(p.archive === "data" ? dataTimg : timg).has(p.file)) findings.push({ key: `missing texture ${a.id} ${p.file}`, what: `${at}: its texture timg/${p.file} isn't in ${p.archive === "data" ? "data.arc" : "the stage archive"}` });
          if (p.kind === "sprite" && !sobs[p.sob]?.[p.frame]) findings.push({ key: `missing frame ${a.id} ${p.sob} ${p.frame}`, what: `${at}: ${p.sob} frame ${p.frame} doesn't exist` });
        }
        if (!pieces.length && look?.draw === "tile") {
          const tile = area.base ? area.base[(a.y >> 4) * 32 + (a.x >> 4)]! & 0x3ff : 0;
          if (tile === 0 || tile === FILLER_TILE) findings.push({ key: `tile actor on nothing ${a.id} ${area.room}/${area.sublayer}/${a.index}`, what: `${at}: drawn by its tile, but its tile is empty (${tile})` });
        } else if (!pieces.length && look?.draw === "sprite" && look.confidence === "confirmed") notes.push(`${at}: simulated, draws nothing (its look, confirmed: ${look.note})`);
        else if (!pieces.length && look?.draw === "sprite") findings.push({ key: `no pieces ${a.id} ${area.room}/${area.sublayer}/${a.index}`, what: `${at}: a sprite actor whose pieces are empty (params ${(a.params >>> 0).toString(16)})` });
        else if (!look) findings.push({ key: `no look ${a.id}`, what: `${at}: simulated, with no entry in actorgraphics.ts` });
      }
      // Its message: what the talk shows for one to four controllers (no flags or switches set yet): the message, or what
      // its flow leads to.
      if (["KNBN", "JIJI", "SNPC", "NAVI"].includes(a.id)) {
        const id = (a.params & (a.id === "JIJI" || a.id === "SNPC" ? 0xfff : 0xffff)) + MESSAGE_BASE;
        const m = bmgMessageById(bmg, id), text = m ? bmgPlainText(m).trim() : "", flow = m ? flowTags(m.parts) : [];
        const shown = [1, 2, 3, 4].map((controllers) => book.resolve(id, { controllers, flags: [], switches: 0 }));
        const textOf = (k: number | null) => (k === null ? "" : bmgPlainText(bmgMessageById(bmg, k)!).trim());
        const key = `message ${a.id} ${area.room}/${area.sublayer}/${a.index}`;
        if (a.id === "KNBN") {
          const tile = area.base ? area.base[(a.y >> 4) * 32 + (a.x >> 4)]! & 0x3ff : 0;
          if (![0x3c, 0x71, 0x1c7].includes(tile)) {
            notes.push(`${at}: a sign on tile ${tile.toString(16)} says nothing (main.dol's rule)`);
            continue;
          }
        }
        if (!m) findings.push({ key, what: `${at}: message ${id} isn't in the message file` });
        else if (!text && !flow.length) findings.push({ key, what: `${at}: message ${id} has no text` });
        else if (!text && shown.includes(null)) findings.push({ key, what: `${at}: message ${id} is only a flow tag, ${flow.join(", ")}, and for ${shown.indexOf(null) + 1} controller(s) it leads to nothing with text (what picks the branch: docs/formats/j2d-and-bmg.md)` });
        else if (shown.some((k) => /[\u0000-\u0008\u000b-\u001f�]/.test(textOf(k)))) findings.push({ key, what: `${at}: message ${id} has unprintable characters` });
        else if (!text) notes.push(`${at}: message ${id} is only a flow tag, ${flow.join(", ")}: it leads to ${[...new Set(shown)].join(" / ")} ("${textOf(shown[0]!).replace(/\s+/g, " ").slice(0, 40)}…" for one controller)`);
        else if (flow.length) notes.push(`${at}: message ${id} branches (${flow.join(", ")}) after its text "${text.slice(0, 40)}…"`);
        if (a.id === "JIJI" && ((a.params >>> 12) & 3) !== 0) findings.push({ key: `self-talker ${area.room}/${area.sublayer}/${a.index}`, what: `${at}: a villager who talks by himself when touched (kind ${(a.params >>> 12) & 3}): not done` });
      }
    }
  }
  for (const [id, where] of unsimulated) {
    const look = actorLook(id), listed = new RegExp(`\\b${id}\\b`).test(docs);
    const drawn = isHiddenUnsimulated(stage.index, id) ? "hidden" : look?.draw ?? "unknown";
    const line = `${id} (${where.length}×: ${[...new Set(where)].join(", ")}; drawn: ${drawn})`;
    if (listed) notes.push(`not simulated, listed in the docs: ${line}`);
    else findings.push({ key: `unsimulated ${id}`, what: `not simulated and not listed in docs/ADVENTURE.md or docs/BACKLOG.md: ${line}; ${look?.note ?? ""}` });
  }
  return { findings, notes };
}

const FILLER_TILE = 0x00b;
/** Rows of a TV room's tiles (384 px). */
const TV_ROWS = 24;

/**
 * Every door of every area opened (its switch on, unlocked) in a game standing in its area: the tiles the open door
 * shows (openDoorTiles) are walkable ones from inside the room, and round the door the picture collides as the sim does.
 */
export function doorChecks(stage: AdventureStage): ActorFinding[] {
  const out: ActorFinding[] = [];
  for (const area of areas(stage)) {
    const doors = area.actors.filter((a) => a.id === "DOOR");
    if (!doors.length) continue;
    const report = (key: string, what: string) => void (out.some((f) => f.key === key) || out.push({ key, what }));
    const pictures: Map<number, number>[] = [];
    for (const open of [false, true]) {
      const game = createAdventure(stage, { room: area.room, players: 4 });
      game.adventure.area = area.sublayer;
      game.battle.switches = open ? -1 : 0;
      game.adventure.opened = open ? doors.map((d) => actorKey(area.room, d.index)) : [];
      // (The top layer's swaps by index + 1024: a bombed wall's lintel, doorlook.ts.)
      const top = new Map<number, number>();
      doorLookTiles(game, stage, new Map(), top);
      pictures.push(new Map([...drawnSwaps(game, stage, area), ...[...top].map(([i, t]) => [i + 1024, t] as const)]));
      if (!open) continue;
      // Open: the swaps' own checks, and the picture round each door against the collision.
      swapChecks(game, stage, area, report);
      const mismatches = pictureMismatches(game, stage, area), w = area.world.widthCells, world = areaWorld(game, stage);
      for (const d of doors) {
        const c = doorCenter(d);
        for (const cell of mismatches) {
          const x = (cell % w) * 8 + 4, y = Math.floor(cell / w) * 8 + 4;
          if (Math.abs(x - c.x) > 24 || Math.abs(y - c.y) > 24) continue;
          report(`door picture ${area.room}/${area.sublayer}/${d.index}`, `${doorName(area, d)} open: the cell (${x - 4}, ${y - 4}) is drawn ${world.solid[cell] === 1 ? "floor but solid" : "wall but walkable"}`);
        }
      }
    }
    // (A shut door is drawn by its tiles, which collide as a way through (a warp's box): the sim blocks its middle.)
    for (const d of doors) {
      const c = doorCenter(d), near = (i: number) => Math.abs((i % 32) * 16 + 8 - c.x) <= 24 && Math.abs(((i & 1023) >> 5) * 16 + 8 - c.y) <= 24;
      const changed = [...new Set([...pictures[0]!.keys(), ...pictures[1]!.keys()])].some((i) => near(i) && pictures[0]!.get(i) !== pictures[1]!.get(i));
      if (!changed) report(`door look ${area.room}/${area.sublayer}/${d.index}`, `${doorName(area, d)}: opened, it looks as it did shut (no tile of it changes)`);
    }
  }
  return out;
}

const doorName = (area: Area, d: Area["actors"][number]) => {
  const c = doorCenter(d);
  return `room ${area.room} area ${area.sublayer}, DOOR #${d.index} (kind ${d.params & 0x7f}${d.params >>> 27 ? `, switch ${d.params >>> 27}` : ""}) at (${c.x}, ${c.y})`;
};

/** The dynamic checks along the scripted route. */
export function routeChecks(stage: AdventureStage, play: PlayStage = STAGES[0]!): ActorFinding[] {
  const route = play.milestones.flatMap((m) => m.goals);
  const game = createAdventure(stage, { players: 4 }), player = new RoutePlayer(route), enemies = drawnEnemies();
  const buttons: number[] = [], found = new Map<string, ActorFinding>();
  let entered = "", baseline = new Set<number>();
  const report = (key: string, what: string) => {
    if (!found.has(key)) found.set(key, { key, what: `${what} (tick ${game.tick})`, buttons: buttons.slice() });
  };
  while (!player.done) {
    let b: number;
    try {
      b = player.next(game, stage);
    } catch (e) {
      // (The route stopped short (a fight changed under it): the checks end there; the route's own tests report it.)
      console.log(`note     ${play.name}'s route stops: ${(e as Error).message}`);
      break;
    }
    if (player.done) break;
    stepAdventure(game, [b], stage);
    buttons.push(b);
    const a = game.adventure;
    if (a.edge || a.warp || a.stairs || game.tick % 2) continue;
    const area = currentArea(game, stage), where = `room ${a.room} area ${a.area}`;
    const mismatches = pictureMismatches(game, stage, area);
    if (`${a.room}/${a.area}` !== entered) {
      [entered, baseline] = [`${a.room}/${a.area}`, mismatches];
      if (process.env.FSO_PLAYTEST_DEBUG) console.log(`entered ${entered} at ${game.tick}: ${mismatches.size} cells drawn otherwise than they collide, ${drawnSwaps(game, stage, area).size} swaps`);
    }
    for (const cell of mismatches) {
      if (baseline.has(cell)) continue;
      const cx = cell % area.world.widthCells, cy = Math.floor(cell / area.world.widthCells);
      const tile = (cy >> 1) * 32 + (cx >> 1), solid = areaWorld(game, stage).solid[cell] === 1;
      report(`picture ${a.room}/${a.area}/${tile}`, `${where}, tile (${(cx >> 1) * 16}, ${(cy >> 1) * 16}): drawn ${solid ? "floor" : "wall"} but ${solid ? "solid" : "walkable"}`);
    }
    swapChecks(game, stage, area, report);
    for (const r of a.rocks) {
      const actor = area.actors.find((x) => x.index === r.actor);
      if (r.state === "gone" || !actor) continue;
      if (!actorPieces({ id: actor.id, sublayer: area.sublayer, x: r.x / SUBPX / 8, y: r.y / SUBPX / 8, params: actor.params }).length) report(`undrawn rock ${actor.id}`, `${where}: the ${actor.id} rock #${r.actor} (${r.state}) has no drawing`);
    }
    for (const e of a.enemies) if (enemyShown(game, e) && !enemies.has(e.type)) report(`undrawn enemy ${e.type}`, `${where}: a ${e.type} on show that EnemyView doesn't draw`);
  }
  return [...found.values()];
}

/** The cells (area.world's, 8 px) where the drawn tile's collision isn't the sim's now. */
function pictureMismatches(game: AdventureGame, stage: AdventureStage, area: Area): Set<number> {
  const world = areaWorld(game, stage), w = area.world.widthCells, out = new Set<number>();
  const drawn = drawnSwaps(game, stage, area);
  // (The color blocks are sprites over the tiles (apps/game renderRocks), and a sliding block tile is one till it
  // stops (slidingBlock): the tiles under them, both while one slides, aren't compared.)
  const sprites = new Set<number>();
  for (const b of colorBlocks(game, stage)) for (const [tx, ty] of [[Math.floor(b.x / 16), Math.floor(b.y / 16)], [Math.ceil(b.x / 16), Math.ceil(b.y / 16)]] as const) sprites.add(ty * 32 + tx);
  for (const b of game.adventure.blocks) if (b.tick < BLOCK_SLIDE_TICKS) [b.from, b.to].forEach((i) => sprites.add(i));
  for (let cell = 0; cell < world.solid.length; cell++) {
    const cx = cell % w, cy = Math.floor(cell / w), tile = (cy >> 1) * 32 + (cx >> 1);
    if (sprites.has(tile)) continue;
    const swapped = drawn.get(tile);
    // An unswapped tile draws as the area was built (its collision as built); a swapped one by its type's mask.
    const picture = swapped === undefined ? area.world.solid[cell] === 1 : maskOf(stage, swapped) & (1 << ((cy & 1) * 2 + (cx & 1))) ? true : false;
    if (picture !== (world.solid[cell] === 1)) out.add(cell);
  }
  return out;
}

const maskOf = (stage: AdventureStage, tile: number) => {
  const type = stage.typeOf(tile);
  // (A movable block's tile (tileblocks.ts) is solid where it stands, pushed or not.)
  return BLOCK_WAYS[type] ? 0xf : LEDGE_MASKS[type] ?? solidMask(type);
};

/** The tiles apps/game draws in place of the base layer's: the battle's overrides, then the sim's rewrites over them
 *  (the lit crystals' own over a PNPC's: drawnRewrites), then the open doors' own (doorlook.ts). */
function drawnSwaps(game: AdventureGame, stage: AdventureStage, area: Area): Map<number, number> {
  const out = tileOverrides(game.battle, (i) => (area.base?.[i] ?? 0) & 0x3ff);
  for (const [i, t] of drawnRewrites(game, stage)) out.set(i, t);
  doorLookTiles(game, stage, out);
  return out;
}

/** The tile swaps' own checks. */
function swapChecks(game: AdventureGame, stage: AdventureStage, area: Area, report: (key: string, what: string) => void): void {
  const a = game.adventure, where = `room ${a.room} area ${a.area}`;
  const doors = new Map<number, number>();
  openDoorTiles(game, stage, doors);
  for (const [i, t] of doors) {
    if (t === 0 || t === FILLER_TILE) report(`door void ${a.room}/${a.area}/${i}`, `${where}: an open door's tile at (${(i % 32) * 16}, ${(i >> 5) * 16}) shows ${t ? "the filler" : "nothing"} (copied from outside the room)`);
    else if (maskOf(stage, t)) report(`door wall ${a.room}/${a.area}/${i}`, `${where}: an open door's tile at (${(i % 32) * 16}, ${(i >> 5) * 16}) shows a wall tile (${t.toString(16)})`);
  }
  const others = new Map<number, number>();
  burntTiles(game, others);
  brokenTiles(game, stage, others);
  blockTiles(game, stage, others);
  for (const [i, t] of others) if (t === 0 || t === FILLER_TILE) report(`void swap ${a.room}/${a.area}/${i}`, `${where}: a swapped tile at (${(i % 32) * 16}, ${(i >> 5) * 16}) shows ${t ? "the filler" : "nothing"}`);
  const overrides = tileOverrides(game.battle, (i) => (area.base?.[i] ?? 0) & 0x3ff), rewrites = drawnRewrites(game, stage);
  for (const [i, t] of overrides) {
    const r = rewrites.get(i);
    if (r !== undefined && r !== t) report(`double swap ${a.room}/${a.area}/${i}`, `${where}: tile (${(i % 32) * 16}, ${(i >> 5) * 16}) swapped by both the battle (${t.toString(16)}) and the adventure (${r.toString(16)})`);
  }
  const rows = a.area === 0 ? TV_ROWS : 32;
  for (const i of [...overrides.keys(), ...rewrites.keys()]) if (i >> 5 >= rows) report(`swap outside ${a.room}/${a.area}/${i}`, `${where}: a tile swap at row ${i >> 5}, outside the area's ${rows} rows`);
}

/** The message file (US). */
export function loadBmg(): Bmg {
  const file = archive("msgus.arc").files.find((f) => f.path.endsWith("_e.bmg"))!;
  return parseBmg(isYaz0(file.data) ? decompressYaz0(file.data) : file.data);
}

/**
 * How apps/game draws an actor type: EnemyView, the pickups, still sprites (its actorPieces), its tile, an effect, or
 * nothing; "hidden": not drawn on purpose, until simulated (HIDDEN_UNSIMULATED).
 */
export type DrawnAs = "enemy" | "pickup" | "sprite" | "tile" | "effect" | "hidden" | "nothing";

/** A placed actor type of a stage: how many, where (room/area), simulated or not, how apps/game draws it. */
export interface CensusRow {
  id: string;
  count: number;
  where: string[];
  simulated: boolean;
  drawn: DrawnAs;
  note: string;
}

/** Every actor type placed in the stage (as played alone), simulated or not, and how apps/game draws it. */
export function census(stage: AdventureStage): CensusRow[] {
  const simulated = simulatedTypes(), enemies = drawnEnemies(), rows = new Map<string, CensusRow>();
  for (const area of areas(stage)) {
    for (const a of area.actors) {
      const row = rows.get(a.id) ?? { id: a.id, count: 0, where: [], simulated: simulated.has(a.id), drawn: "nothing" as DrawnAs, note: actorLook(a.id)?.note ?? "" };
      rows.set(a.id, row);
      row.count++;
      const at = `${area.room}/${area.sublayer}`;
      if (!row.where.includes(at)) row.where.push(at);
      const look = actorLook(a.id);
      const drawn: DrawnAs = isHiddenUnsimulated(stage.index, a.id) ? "hidden"
        : ENEMY_TYPES.includes(a.id) ? (enemies.has(a.id) ? "enemy" : "nothing")
        : PICKUP_TYPES.includes(a.id) ? "pickup"
        : actorPieces({ id: a.id, sublayer: area.sublayer, x: a.x / 8, y: a.y / 8, params: a.params }).length ? "sprite"
        : look?.draw === "tile" ? "tile"
        : look?.draw === "effect" ? "effect"
        : "nothing";
      // (The strongest of its placements: a sprite for some params is a sprite.)
      const rank: readonly DrawnAs[] = ["nothing", "hidden", "effect", "tile", "pickup", "sprite", "enemy"];
      if (rank.indexOf(drawn) > rank.indexOf(row.drawn)) row.drawn = drawn;
    }
  }
  return [...rows.values()].sort((x, y) => x.id.localeCompare(y.id));
}

/** A finding's key on a stage (EXPECTED_ACTORS): Lake Hylia's as they were, the others' with the stage's short name first. */
export const stageKey = (play: PlayStage, key: string): string => (play.id === "boss010" ? key : `${play.aliases[0]} ${key}`);

/** All the checks of a stage: the findings (their keys stage-prefixed: stageKey) and the notes. */
export function stageChecks(play: PlayStage): { findings: ActorFinding[]; notes: string[]; stage: AdventureStage } {
  const { stage, source } = loadStage(play.id);
  const s = staticChecks(stage, source, loadBmg());
  const findings = [...s.findings, ...doorChecks(stage), ...routeChecks(stage, play)].map((f) => ({ ...f, key: stageKey(play, f.key) }));
  return { findings, notes: s.notes, stage };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), captures = args.includes("--captures"), showCensus = args.includes("--census");
  const started = performance.now();
  let fresh = 0, total = 0;
  for (const play of stageArgs(args.filter((a) => !a.startsWith("--"))).stages) {
    console.log(`— ${play.name} (${play.id})`);
    const { findings, notes, stage } = stageChecks(play);
    for (const n of notes) console.log(`note     ${n}`);
    if (showCensus) {
      for (const r of census(stage)) {
        console.log(`census   ${r.id} ×${r.count} ${r.simulated ? "simulated" : "NOT simulated"}, drawn: ${r.drawn} (${r.where.slice(0, 8).join(", ")}${r.where.length > 8 ? "…" : ""})${r.simulated ? "" : ` — ${r.note.slice(0, 120)}`}`);
      }
    }
    for (const f of findings) {
      const known = EXPECTED_ACTORS[f.key];
      if (!known) fresh++;
      total++;
      console.log(`${(known ? "expected" : "FINDING").padEnd(8)} ${f.what}${known ? ` [${known}]` : ""}`);
      if (captures && f.buttons) console.log(`         capture ${writeCapture(play, stage, f.buttons, `[playtest] actors: ${f.what}`, findingId(`actors ${f.key}`))}`);
    }
  }
  console.log(`${total} findings (${fresh} new) in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  if (fresh) process.exitCode = 1;
}

