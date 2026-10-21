// Treasure chests (TKRA, update 0x802EB314): a chest is a tile, 0x30 closed (PNPCs write it to make one appear) and
// 0x10 open. Opening one sends its content up (IMUP, the item rising out: its draw 0x80159C28 shows contents 0-7 as
// the Force Gems of those types, 8-11 the huge ones, 16-25 as enemy_both2 45-54, i.e. 16 a small key, 17 the big key,
// 20 a heart) and gives it. Contents placed in the 32 stages: 4 (98 chests), 0x14 (71), 3, 2, 6, 0x10, 1, 0x15, 0x2E…
// Measured in Dolphin (the Cave of No Return's room 7, docs/measurements/adventure-world1.md "Adventure: the Cave of No Return"): the
// Item button (the GC's A) facing it and touching it (pushing against it; from 6 px off nothing happened) opens it,
// from below only (room 13's key chest: touching it from its left, A lit the lamp instead; from below it opened):
// the lid opens, the Link holds the content up from the 12th tick (player_sob 238 ×4, 239, then 240) and its
// message ("You got a small key! Carry it to a keyhole!") types from the 97th tick; a key is then carried overhead.
// In a side view it opens from the side (measured: Hyrule Castle room 5's area 5, the Link pushing left against its
// chest, A: the pose, the key carried once its message was read).
// Contents other than Force Gems, keys and hearts give nothing yet; which contents say something is assumed (keys and
// gems of 50 and more: their messages 0xD2, 0xD7…).
import { HEART } from "../combat.ts";
import { Button, SUBPX, type Facing } from "../player.ts";
import { actorKey, currentArea, type AdventureGame } from "./adventure.ts";
import { startGet, TALK_BUTTON } from "./dialogue.ts";
import { rewrittenTiles } from "./logic.ts";
import { GEM_VALUES } from "./pickups.ts";
import type { AdventureStage, AreaActor } from "./stage.ts";

export const CHEST_TILE = 0x30;
export const OPEN_CHEST_TILE = 0x10;
/** A chest opens for a Link this close to its middle, facing it (measured: touching it at 15 px opened it, 21 didn't). */
export const CHEST_REACH = 16;
/** Its content's message by content (keys and the bigger Force Gems, msgus.arc _e.bmg). */
export const CHEST_MESSAGES: Readonly<Record<number, number>> = { 3: 0xd7, 4: 0xd8, 5: 0xd9, 6: 0xda, 7: 0xdb, 8: 0xe7, 9: 0x110, 10: 0x111, 11: 0x112, 16: 0xd2 };
/** Ticks the content shows over the chest (IMUP). TODO(measure). */
export const REVEAL_TICKS = 60;
export const KEY_CONTENT = 16;
export const BIG_KEY_CONTENT = 17;
export const HEART_CONTENT = 20;

const TOWARD: Readonly<Record<Facing, readonly [number, number]>> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };

const tileIndex = (a: AreaActor) => (a.y >> 4) * 32 + (a.x >> 4);

/** The tile a chest's place shows now (its PNPCs' rewrites, else the base layer). */
function tileAt(game: AdventureGame, stage: AdventureStage, a: AreaActor, rewritten: ReadonlyMap<number, number>): number {
  const i = tileIndex(a);
  return rewritten.get(i) ?? (currentArea(game, stage).base?.[i] ?? 0) & 0x3ff;
}

/** Whether a chest is there to open: not opened yet, and its tile is a closed chest. */
export function chestClosed(game: AdventureGame, stage: AdventureStage, a: AreaActor, rewritten = rewrittenTiles(game, stage)): boolean {
  return !game.adventure.opened.includes(actorKey(game.adventure.room, a.index)) && tileAt(game, stage, a, rewritten) === CHEST_TILE;
}

/**
 * The leader opens the chest he faces from below (from the side in a side view) when the Item button is pressed touching it; returns his buttons with that press
 * used up (no item used; the button stays ignored until released: AdventureState.ignore).
 */
export function openChest(game: AdventureGame, stage: AdventureStage, buttons: number): number {
  const a = game.adventure, p = game.players[0]!, f = game.battle.fighters[0]!;
  if (!(buttons & ~p.held & TALK_BUTTON) || f.mode !== "active" || f.move !== "none" || p.action !== "none") return buttons;
  if (p.facing !== "up" && !(currentArea(game, stage).sideView && (p.facing === "left" || p.facing === "right"))) return buttons;
  const [dx, dy] = TOWARD[p.facing];
  const x = p.x / SUBPX, y = p.y / SUBPX;
  const rewritten = rewrittenTiles(game, stage);
  for (const actor of currentArea(game, stage).actors) {
    if (actor.id !== "TKRA") continue;
    const cx = actor.x + 8, cy = actor.y + 8;
    const ahead = (cx - x) * dx + (cy - y) * dy, across = Math.abs(dx ? cy - y : cx - x);
    if (ahead <= 0 || ahead > CHEST_REACH || across > 10 || !chestClosed(game, stage, actor, rewritten)) continue;
    a.opened.push(actorKey(a.room, actor.index));
    const content = actor.params & 0xff;
    give(game, content);
    a.reveal = { content, x: cx, y: cy, tick: 0 };
    if (CHEST_MESSAGES[content] !== undefined) startGet(game, CHEST_MESSAGES[content]!, "chest");
    a.ignore |= TALK_BUTTON;
    return buttons & ~TALK_BUTTON;
  }
  return buttons;
}

function give(game: AdventureGame, content: number): void {
  const a = game.adventure, b = game.battle;
  if (content < GEM_VALUES.length) a.gems += GEM_VALUES[content]!;
  else if (content === KEY_CONTENT || content === BIG_KEY_CONTENT) a.keys++;
  else if (content === HEART_CONTENT) for (const f of b.fighters) f.hearts = b.rules.hearts * HEART;
}

/** The content showing over an opened chest, one tick. */
export function stepReveal(game: AdventureGame): void {
  const r = game.adventure.reveal;
  if (r && ++r.tick >= REVEAL_TICKS) game.adventure.reveal = null;
}
