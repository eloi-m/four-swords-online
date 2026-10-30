// Our sim at a Dolphin place (place.ts): the stage built as the apps build it, the Links put where Dolphin's stand, and
// what is in it as diff.ts bodies, in the px both sides share (an adventure room's own px, an arena's room px with its
// side rooms below it).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decompressYaz0, Dol, isYaz0, loadActorTypes, parseBmg, parseRarc, readTileTypes, Stage, type RarcArchive } from "@fso/formats";
import {
  applyRoundStart, arenaProps, buildArenaWorld, createBattle, SIDE_ROOM_STRIDE, stepGame, SUBPX, type AdventureRecord, type BattleRules, type Facing, type GameState, type RoundStart,
  type Spawn, type World,
} from "@fso/sim";
import { actorStats, ADVENTURE_HEARTS, ALONE_ROOMS, AdventureStage, GEAR_BY_NUMBER, messageBook, playedAlone, SHADOW_STATE, startAdventure, stepAdventure, type AdventureGame } from "@fso/sim/adventure";
import type { Body, ClipLink } from "./diff.ts";
import { UNDRAWN, type LiveActor, type LiveLink } from "./live.ts";
import { CELL_H, CELL_W, localPx, type Place } from "./recipe.ts";

export const FACINGS: readonly Facing[] = ["right", "left", "down", "up"];
/** A round state loads this many frames before the players get control (docs/measurements/battle-arenas.md). */
export const ROUND_STATE_LEAD = 10;
/** Link state 74: swimming, seen from above (docs/measurements/adventure-lake-hylia.md "Swimming"). */
const STATE_SWIM = 74;
/** Link state 1: a Link not in the round (2-3 player games). */
const STATE_ABSENT = 1;
/** The round states' rules (the game's defaults; no time limit, as the states were made). */
export const BATTLE_RULES: BattleRules = { hearts: 3, timeLimit: 0, wins: 3 };

function archives(extracted: string) {
  const archive = (path: string): RarcArchive => {
    const bytes = readFileSync(join(extracted, "files/GC4Sword_usa", path));
    return parseRarc(isYaz0(bytes) ? decompressYaz0(bytes) : bytes);
  };
  return { archive, tileTypes: readTileTypes(new Dol(readFileSync(join(extracted, "sys/main.dol")))) };
}

/** An adventure stage as apps/game builds it: played alone, the actors' stats, the English messages. */
export function loadAdventureStage(extracted: string, name: string): AdventureStage {
  const { archive, tileTypes } = archives(extracted);
  const stage = new AdventureStage(playedAlone(new Stage(archive(`Boss/${name}.arc`))), tileTypes, actorStats(loadActorTypes(archive("data.arc")) ?? new Map()));
  const bmg = archive("msgus.arc").files.find((f) => f.path.endsWith("_e.bmg"));
  if (bmg) stage.messages = messageBook(parseBmg(isYaz0(bmg.data) ? decompressYaz0(bmg.data) : bmg.data));
  return stage;
}

export interface Sim {
  kind: "adventure" | "battle";
  game: GameState;
  step(buttons: readonly number[]): void;
  bodies(): Body[];
  links(): ClipLink[];
}

/** Room px of a Dolphin position at a place: an adventure room's own, an arena's with its side rooms below it. */
export function placePx(place: Place, p: { x: number; y: number; screen: number }): { x: number; y: number } {
  if (place.arena) return p.screen >= 8 ? { x: p.x, y: p.y + (p.screen - 7) * SIDE_ROOM_STRIDE } : { x: p.x - CELL_W, y: p.y - CELL_H };
  return localPx(p, { cx: Math.floor(place.links[0]!.x / CELL_W), cy: Math.floor(place.links[0]!.y / CELL_H) });
}

/** Dolphin's actors at a place as bodies: an adventure's on the place's screen, an arena's on all its screens. */
export function dolphinBodies(place: Place, actors: readonly LiveActor[], room?: { cx: number; cy: number }): Body[] {
  const screen = place.area ? 7 + place.area : 0;
  return actors
    .filter((a) => (place.arena ? true : a.screen === screen))
    .filter((a) => place.arena || a.screen !== 0 || !room || (Math.floor(a.x / CELL_W) === room.cx && Math.floor(a.y / CELL_H) === room.cy))
    .map((a) => {
      const p = place.arena ? placePx(place, a) : localPx(a, room ?? { cx: 0, cy: 0 });
      return { kind: a.id, x: p.x, y: p.y };
    });
}

/** The grid room a place's room is played at: an off-grid room played alone at another's cell (room 8 at the Cave's room 9). */
export function gridRoom(stage: Pick<AdventureStage, "index" | "cellOf">, room: number): number {
  if (stage.cellOf(room)) return room;
  const at = Object.entries(ALONE_ROOMS[stage.index] ?? {}).find(([, alone]) => alone === room)?.[0];
  return at === undefined ? room : Number(at);
}

/**
 * Our adventure at a Dolphin place: its room entered at the leader's spot, then each Link put where Dolphin's stands;
 * given Dolphin's live actors, each shuttling hovering gem takes the state of Dolphin's from the same place (its spot,
 * way, timer and velocities: how long ago Dolphin's room was entered, and the way it drew at random). Given Dolphin's
 * Links (live.ts), each faces as his does, with his life, and the leader holds his item; given the room's switches
 * (live.ts), they are set (what the Links did before is not carried over: a block pushed stands at its start); a Link
 * swimming (state 74) swims on, carried by the current as much as Dolphin's is (live.ts drift). A place on a GBA screen
 * starts in that area of the room (#room's TV part otherwise), its px the area's own.
 * `record` is that start, for apps/game to replay (compare.ts).
 */
export function adventureSim(
  stage: AdventureStage, place: Place, live: readonly LiveActor[] = [], links: readonly (Pick<LiveLink, "facing" | "life" | "item"> & { state?: number; drift?: LiveLink["drift"] })[] = [],
  switches: number | null = null,
): Sim & { adventure: AdventureGame; cell: { cx: number; cy: number }; record: AdventureRecord } {
  const room = gridRoom(stage, place.room);
  const cell = stage.cellOf(room);
  if (!cell) throw new Error(`${place.stage} has no room ${place.room}`);
  if (place.area && !stage.hasArea(room, place.area)) throw new Error(`${place.stage} room ${place.room} has no area ${place.area}`);
  // Positions on the place's screen in the sim's px: the room's (its cell off) on the TV, the area's own on a GBA screen.
  const origin = place.area ? { cx: 0, cy: 0 } : cell, screen = place.area ? 7 + place.area : 0;
  const local = place.links.map((l) => localPx({ ...l, screen: place.area ? screen : l.screen }, origin));
  const carry = links[0] && { hearts: links.map((l) => l.life), maxHearts: ADVENTURE_HEARTS, gear: GEAR_BY_NUMBER[links[0].item] ?? "" };
  // The start as a replay record (@fso/sim replay.ts), so that apps/game replaying it (compare.ts's frames) starts the same.
  // Shadow Link in his entrance: Dolphin's state and its ticks (the scene holding the Links with it), a tick on: a
  // trace's first frame is the game's frame after the state's RAM (traced: his +0x24C 20 in cave-room4.sav, 21 there).
  const shadowTwin = live.find((a) => a.screen === 0 && a.fields?.state !== undefined && a.id.split("/").includes("SLK2"));
  const shadow = shadowTwin && shadowTwin.fields!.state! < SHADOW_STATE.ready ? { state: shadowTwin.fields!.state!, tick: shadowTwin.fields!.tick! + 1 } : null;
  const record: AdventureRecord = {
    kind: "adventure", stage: place.stage, room, ...(place.area ? { area: place.area } : {}), x: Math.round(local[0]!.x), y: Math.round(local[0]!.y), players: place.links.length,
    ...(carry ? { carry } : {}),
    ...(switches !== null ? { switches } : {}),
    ...(shadow ? { shadow } : {}),
    links: local.map((l, i) => {
      const facing = links[i] && FACINGS[links[i]!.facing];
      const swim = links[i]?.state === STATE_SWIM && { x: links[i]!.drift?.x ?? 0, y: links[i]!.drift?.y ?? 0 };
      return { x: l.x, y: l.y, ...(facing ? { facing } : {}), ...(swim ? { swim } : {}) };
    }),
    inputs: [], checkpoints: [], tick: 0, hash: 0,
  };
  const g = startAdventure(record, stage);
  // A leader walking (state 2) walks on, without the standing start's turning tick (player.ts stepPlayer; node only).
  if (links[0]?.state === 2) g.players[0]!.moving = true;
  const placedHere = stage.area(g.adventure.room, g.adventure.area).actors;
  const sub = (v: number) => Math.round(v * SUBPX);
  for (const it of g.adventure.pickups) {
    const home = placedHere.find((x) => x.index === it.actor);
    const twin = it.shuttle && home && live.find((a) => {
      const f = a.fields;
      return a.screen === screen && f?.homeX !== undefined && Math.hypot(f.homeX - origin.cx * CELL_W - home.x, f.homeY! - origin.cy * CELL_H - home.y) < 1;
    });
    if (!twin) continue;
    const f = twin.fields!, at = localPx(twin, origin);
    [it.x, it.y] = [sub(at.x), sub(at.y)];
    Object.assign(it.shuttle!, { dir: f.dir, timer: f.timer, vx: sub(f.vx!), vy: sub(f.vy!), tvx: sub(f.tvx!), tvy: sub(f.tvy!) });
  }
  const px = (v: number) => v / SUBPX;
  return {
    kind: "adventure",
    game: g,
    adventure: g,
    cell,
    record,
    step: (buttons) => stepAdventure(g, [buttons[0] ?? 0], stage),
    links: () => g.players.map((p, i) => ({ x: px(p.x), y: px(p.y), state: `${p.action}/${g.adventure.links[i]?.mode ?? ""}${moveOf(g.battle.fighters[i])}` })),
    bodies: () => {
      const a = g.adventure;
      const placed = stage.area(a.room, a.area).actors;
      const used = new Set<number>();
      const kindOf = (actor: number, own: string) => {
        if (actor >= 0) used.add(actor);
        return placed[actor]?.id ?? own;
      };
      const bodies: Body[] = [
        ...a.enemies.map((e) => ({ kind: kindOf(e.actor, e.type), x: px(e.x), y: px(e.y), state: e.state })),
        ...a.rocks.map((r) => ({ kind: kindOf(r.actor, r.type), x: px(r.x), y: px(r.y), state: r.state })),
        ...a.pickups.map((p) => ({ kind: kindOf(p.actor, p.from), x: px(p.x), y: px(p.y), state: p.type })),
      ];
      // What the sim keeps no object for stands where it is placed.
      placed.forEach((p, i) => used.has(i) || bodies.push({ kind: p.id, x: p.x, y: p.y, state: "placed" }));
      return bodies.filter((b) => !UNDRAWN.has(b.kind));
    },
  };
}

/** A Link's move (lifting, carrying, throwing, rolling…: carry.ts, roll.ts) after his state, when he has one. */
const moveOf = (f: { move: string } | undefined) => (f && f.move !== "none" ? `/${f.move}` : "");

/** Our entities' kinds as the game's actor types, where one matches. */
const ENTITY_TYPES: Readonly<Record<string, string>> = {
  orb: "CRTL", bomb: "HBMB", flame: "BLZ2", pot: "TUBO", pickup: "LSTI",
  soldier: "SLR1", bowSoldier: "SLR2", ballSoldier: "SLR3", captain: "SLR4", soldierArrow: "OKTM",
};

/**
 * Our battle at a Dolphin round state: the arena with its props, the Links in the round at Dolphin's starts (port
 * order), the countdown left so that control comes on the frame Dolphin's does (`lead` frames in).
 */
export function battleSim(extracted: string, place: Place, opts: { seed?: number; lead?: number; live?: { state: number; facing: number }[] } = {}): Sim & { world: World; start: RoundStart } {
  const { archive, tileTypes } = archives(extracted);
  const stage = new Stage(archive("Boss/boss500.arc"));
  const world = buildArenaWorld(stage, tileTypes, place.room);
  const playing = place.links.filter((_, i) => (opts.live?.[i]?.state ?? 0) !== STATE_ABSENT).slice(0, place.players ?? 4);
  const spawns: Spawn[] = playing.map((l, i) => ({ ...roundPx(placePx(place, l)), facing: FACINGS[opts.live?.[i]?.facing ?? 2]! }));
  const start: RoundStart = { spawns, countdown: opts.lead ?? ROUND_STATE_LEAD };
  const game = createBattle(place.room, spawns, BATTLE_RULES, arenaProps(stage, tileTypes, place.room), opts.seed ?? 1);
  applyRoundStart(game, start);
  const px = (v: number) => v / SUBPX;
  return {
    kind: "battle",
    game,
    world,
    start,
    step: (buttons) => stepGame(game, [...buttons], world),
    links: () => game.players.map((p, i) => ({ x: px(p.x), y: px(p.y), state: `${p.action}/${game.battle!.fighters[i]!.mode}${moveOf(game.battle!.fighters[i])}` })),
    bodies: () => {
      const b = game.battle!;
      // A prop's own entity (its switch, its bees, its flame, its soldier…) stands for it; what a prop makes (an orb,
      // an item, a spawner's soldier) is a thing of its own, and so is a socket's bomb (the game keeps both HBMBs).
      const live = new Set<number>();
      const things = b.entities.map((e) => {
        const prop = e.home >= 0 ? b.props.actors[e.home] : undefined;
        const kind = ENTITY_TYPES[e.kind] ?? prop?.id ?? e.kind;
        if (prop && prop.id === kind && e.kind !== "bomb") live.add(e.home);
        return { kind, x: px(e.x), y: px(e.y), state: `${e.kind} ${e.phase}` };
      });
      const props = b.props.actors.flatMap((a, i) => (live.has(i) ? [] : [{ kind: a.id, x: a.x, y: a.y, state: "prop" }]));
      return [...props, ...things].filter((x) => !UNDRAWN.has(x.kind));
    },
  };
}

const roundPx = (p: { x: number; y: number }) => ({ x: Math.round(p.x), y: Math.round(p.y) });
