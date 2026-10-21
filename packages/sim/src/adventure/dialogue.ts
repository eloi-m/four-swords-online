// Signs and people who talk (docs/formats/adventure.md "Signs and dialogue"): the Item button (the GC's A, which also uses the
// item) facing one opens its message (msgus.arc's _e.bmg) in a box on the TV, typed one character a frame, page by
// page; the same button turns a typed page, and closes the box after the last one.
//
// From main.dol:
// - Who talks to whom: a Link's point 16 px ahead (table 0x8046AE78 by facing: right, left, down, up) inside the
//   speaker's box (0x8024CD20) marks it; the Item button pressed that frame (pad A, 0x80245DB0) starts the talk (the
//   Link stands still, `d44`); the speaker's update then opens its message (0x8038C678, message id + an r8 style).
// - KNBN signs (init 0x8038FD08, update 0x8038FA58): message (params & 0xFFFF) + 0x12B; the sign is its tile (0x3C,
//   0x71 or 0x1C7, the last 32 px wide and tall; on any other tile it says nothing); box (x + 2, y) to (x + 14, y + 14)
//   (x + 30, y + 30 for 0x1C7) round its anchor; on the TV read from below facing up (the Link not above it), in side
//   views from any side; style 0x200 for tile 0x71, else 0x400. Tile 0x71 (the wooden sign, 25 placed) shows the
//   wooden board (hukidashi_wood.blo, measured); 0x3C (23 placed, stone tablets) the stone one (assumed).
// - JIJI villagers (init 0x8037C788, talk 0x8037C090): message (params & 0xFFF) + 0x12B; box ±8 px round the anchor
//   (-16, -16 to 16, 8 for the kinds (params >> 16) & 0xFF = 6, 11, 16, 25), from any side; the speech balloon
//   (hukidashi.blo). Kinds (params >> 12) & 3 other than 0 talk by themselves when a Link touches them (not done).
// - SNPC and NAVI (TODO(measure) their boxes): the same message rule as JIJI / KNBN. A message that's empty in the US
//   file isn't talked (some villagers'), unless its flow leads to one with text (below).
// - KEPO, the owl (Hyrule Castle room 0, Tingle's Tower room 11): it talks by itself, once, when a Link comes within
//   its reach (startOwlTalk, below); an
//   escort Zora greets the Link who meets it the same way (zoras.ts ESCORT_GREETING, through `Talk.after`).
// - A message with no text of its own that is only flow tags (branch4, ifFlag: docs/formats/j2d-and-bmg.md "Messages
//   (BMG)") shows the message it leads to (`MessageBook.resolve`); setFlag tags set the game's flags when a message opens.
//   Lake Hylia's old man (room 1: 1278 → 1303 → 1280 → 1277, one controller) and cave villager (room 58: 791 → 792,
//   one controller) are these; the ids and the rules: `MessageBook.resolve`.
// Measured in Dolphin (docs/measurements/adventure-world1.md "Signs and dialogue"; Lake Hylia room 3's sign): the box shows on the 6th
// tick after the press with the first character, one more each tick; the P1 badge (the player to press) shows once
// the page is typed; a press then closes the box 7 ticks later. The world goes on meanwhile (Octoroks kept walking);
// the Link reading stands. TODO(measure): a press while typing (here it finishes the page), the turn to a next page,
// the balloon's place over a speaker (here the screens' own layout, as the sign's box was measured).
import { bmgMessageById, bmgPageLength, bmgPages, bmgTagArgs, type Bmg, type BmgMessage, type BmgTag } from "@fso/formats";
import { Button, SUBPX, type Facing } from "../player.ts";
import { actorKey, currentArea, type AdventureGame } from "./adventure.ts";
import type { GearKind } from "./gear.ts";
import type { AdventureStage, AreaActor } from "./stage.ts";
import { switchOn } from "../switches.ts";

/** Message ids are a speaker's params plus this (main.dol: `addi r, r, 299`). */
export const MESSAGE_BASE = 0x12b;
/** Ticks from the press to the box showing its first character. */
export const TALK_OPEN_TICKS = 6;
/** Ticks from the closing press to the box gone. */
export const TALK_CLOSE_TICKS = 7;
/** The button that talks and turns pages: the GC's A, the sim's Item button (B is the sword, R the action). */
export const TALK_BUTTON = Button.Item;
/** How far ahead of a Link his talking point is (main.dol: 15.999 px). */
export const TALK_REACH = 16;

/** The box a message shows in: the speech balloon or a sign's board. */
export type TalkStyle = "balloon" | "wood" | "stone";

/** What a message's flow reads from the game: the players with a controller, and the flags set (flagKey). */
export interface FlowState {
  controllers: number;
  flags: readonly number[];
}

/** A game flag's key, from the BMG fields of setFlag and ifFlag (kind, then the flag). */
export const flagKey = (kind: number, flag: number): number => kind * 0x10000 + flag;

/** A message file as the talk reads it: page lengths (the typing), the flags a message sets, and where its flow leads. */
export interface MessageBook {
  /** The page lengths (BMG `bmgPageLength`) of a message; null for a message that isn't there or has no text. */
  pages(id: number): readonly number[] | null;
  /** The flags a message sets when it opens: its setFlag tags as [flag key, 1 set or 0 cleared]. */
  sets(id: number): readonly (readonly [number, number])[];
  /** The message to show for `id`: itself when it has text, else what its flow leads to; null when nothing does. */
  resolve(id: number, state: FlowState): number | null;
}

/** Flow tags the talk follows (BMG_TAGS' keys): branch4 (one of four messages), ifFlag (one of two), setFlag. */
const BRANCH4 = 0x20018, IF_FLAG = 0x20023, SET_FLAG = 0x20022;
/** The longest chain of flows followed (a loop shows nothing). */
const MAX_FLOW = 8;

/** A MessageBook of a message file (the US one: gc_four_swords_text_e.bmg); empty messages count as missing. */
export function messageBook(bmg: Bmg): MessageBook {
  const known = new Map<number, number[] | null>();
  const pages = (id: number) => {
    if (!known.has(id)) {
      const m = bmgMessageById(bmg, id);
      const lengths = m ? bmgPages(m).map(bmgPageLength) : [];
      known.set(id, lengths.some((n) => n > 0) ? lengths : null);
    }
    return known.get(id)!;
  };
  return {
    pages,
    sets(id) {
      const out: [number, number][] = [];
      for (const p of bmgMessageById(bmg, id)?.parts ?? []) {
        if (p.kind !== "tag" || p.key !== SET_FLAG) continue;
        const [kind = 0, flag = 0, value = 0] = bmgTagArgs(p);
        out.push([flagKey(kind, flag), value ? 1 : 0]);
      }
      return out;
    },
    resolve(id, state) {
      let at = id;
      for (let hop = 0; hop <= MAX_FLOW; hop++) {
        if (pages(at)) return at;
        const next = flowNext(bmgMessageById(bmg, at), state);
        if (next === null) return null;
        at = next;
      }
      return null;
    },
  };
}

/**
 * The message a flow-only message leads to. branch4 takes its message by the controllers: the first for one, the fourth
 * for four (assumed: docs/formats/j2d-and-bmg.md). ifFlag takes the first of its two when the flag is set, else the
 * second (the old man's chain: the set branch is his lecture, whose flag the formations drill sets; the unset one leads
 * on to his first talk, which sets the flag). The tags' numbers are message indices, so the id is the number + 1.
 */
function flowNext(m: BmgMessage | undefined, state: FlowState): number | null {
  const tag = m?.parts.find((p): p is BmgTag => p.kind === "tag" && (p.key === BRANCH4 || p.key === IF_FLAG));
  if (!tag) return null;
  const args = bmgTagArgs(tag);
  if (tag.key === BRANCH4) return args.length === 4 ? args[Math.max(1, Math.min(4, state.controllers)) - 1]! + 1 : null;
  if (args.length !== 4) return null;
  const set = state.flags.includes(flagKey(args[0]!, args[1]!));
  return args[set ? 2 : 3]! + 1;
}

/** An open message: who says it, which, the page on show and the ticks since it started typing. */
export interface Talk {
  /** The speaker's index in the room's actor list. */
  actor: number;
  message: number;
  style: TalkStyle;
  page: number;
  /** Ticks since the press (the first page) or since the page turned; the box types from TALK_OPEN_TICKS on. */
  tick: number;
  /** Ticks left until the box is gone (0 while it shows). */
  close: number;
  /** Messages this talk shows after this one closes, in order, without a press (an escort Zora's greeting). */
  after?: number[];
}

/** A speaker of the current area: the message it shows (after its flow), style and box (area px, inclusive), and whether a TV sign is read from below. */
export interface Speaker {
  actor: AreaActor;
  message: number;
  style: TalkStyle;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  fromBelow: boolean;
}

/** Sign tiles (KNBN's update): 0x3C and 0x71 one tile, 0x1C7 two by two (none placed); 0x71 is read on the wooden board. */
const SIGN_TILES: ReadonlySet<number> = new Set([0x3c, 0x71, 0x1c7]);
const BIG_SIGN = 0x1c7, WOODEN_SIGN = 0x71;
/** JIJI kinds with the big box. */
const BIG_JIJI: ReadonlySet<number> = new Set([6, 11, 16, 25]);

const AHEAD: Readonly<Record<Facing, readonly [number, number]>> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };

/** The game's state the flows read (dialogue.ts FlowState). */
export const flowState = (game: AdventureGame): FlowState => ({ controllers: game.adventure.controllers, flags: game.adventure.flags });

/** The current area's speakers (the ones with a message in `stage.messages`, after its flow: `MessageBook.resolve`). */
export function speakers(game: AdventureGame, stage: AdventureStage): Speaker[] {
  const area = currentArea(game, stage), book = stage.messages, out: Speaker[] = [], flow = flowState(game);
  const shown = (id: number) => book?.resolve(id, flow) ?? null;
  for (const a of area.actors) {
    if (a.id === "KNBN") {
      const tile = area.base ? area.base[(a.y >> 4) * 32 + (a.x >> 4)]! & 0x3ff : 0;
      const message = shown((a.params & 0xffff) + MESSAGE_BASE);
      if (!SIGN_TILES.has(tile) || message === null) continue;
      const size = tile === BIG_SIGN ? 32 : 16;
      out.push({ actor: a, message, style: tile === WOODEN_SIGN ? "wood" : "stone", x0: a.x + 2, y0: a.y, x1: a.x + size - 2, y1: a.y + size - 2, fromBelow: !area.sideView });
    } else if (a.id === "JIJI" || a.id === "SNPC") {
      const message = shown((a.params & 0xfff) + MESSAGE_BASE);
      if (((a.params >>> 12) & 3) !== 0 || message === null) continue;
      const big = a.id === "JIJI" && BIG_JIJI.has((a.params >>> 16) & 0xff);
      out.push({ actor: a, message, style: "balloon", x0: a.x - (big ? 16 : 8), y0: a.y - (big ? 16 : 8), x1: a.x + (big ? 16 : 8), y1: a.y + 8, fromBelow: false });
    } else if (a.id === "NAVI") {
      const message = shown((a.params & 0xffff) + MESSAGE_BASE);
      if (message !== null) out.push({ actor: a, message, style: "balloon", x0: a.x - 8, y0: a.y - 8, x1: a.x + 8, y1: a.y + 8, fromBelow: false });
    }
  }
  return out;
}

/** The speaker the leader faces (his talking point in its box), or null. */
export function facedSpeaker(game: AdventureGame, stage: AdventureStage): Speaker | null {
  const p = game.players[0]!, [dx, dy] = AHEAD[p.facing];
  const x = p.x / SUBPX + dx * TALK_REACH, y = p.y / SUBPX + dy * TALK_REACH;
  for (const s of speakers(game, stage)) {
    if (x < s.x0 || x > s.x1 || y < s.y0 || y > s.y1) continue;
    if (s.fromBelow && (p.facing !== "up" || p.y < s.actor.y * SUBPX)) continue;
    return s;
  }
  return null;
}

/**
 * The Item button pressed by the leader, standing, facing a speaker: its message opens. Returns his buttons with the
 * press used up (no item used; the button stays ignored until released).
 */
export function startTalk(game: AdventureGame, stage: AdventureStage, buttons: number): number {
  const a = game.adventure, p = game.players[0]!, f = game.battle.fighters[0]!, m = a.links[0]!;
  if (a.talk || !(buttons & ~p.held & TALK_BUTTON) || f.mode !== "active" || f.move !== "none" || p.action !== "none" || f.z > 0) return buttons;
  if (m.mode !== "walk" || f.carryEntity || a.keyLift > 0) return buttons;
  const s = facedSpeaker(game, stage);
  if (!s) return buttons;
  a.talk = { actor: s.actor.index, message: s.message, style: s.style, page: 0, tick: 0, close: 0 };
  setFlags(game, stage, s.message);
  a.ignore |= TALK_BUTTON;
  Object.assign(p, { moving: false, walkTicks: 0 });
  return buttons & ~TALK_BUTTON;
}

/**
 * A message opens: its setFlag tags set the game's flags. Taken at the opening (assumed; the tags stand at a message's
 * start or its end, and only the next talk reads them).
 */
function setFlags(game: AdventureGame, stage: AdventureStage, message: number): void {
  const flags = game.adventure.flags;
  for (const [key, on] of stage.messages?.sets(message) ?? []) {
    const at = flags.indexOf(key);
    if (on && at < 0) flags.push(key);
    else if (!on && at >= 0) flags.splice(at, 1);
  }
}

/** A talk closed: the next message of its queue opens (its tags set the flags), else nothing is on show. */
function nextTalk(game: AdventureGame, stage: AdventureStage, done: Talk): void {
  const [message, ...rest] = done.after ?? [];
  if (message === undefined) {
    game.adventure.talk = null;
    return;
  }
  game.adventure.talk = { actor: done.actor, message, style: done.style, page: 0, tick: 0, close: 0, ...(rest.length ? { after: rest } : {}) };
  setFlags(game, stage, message);
}

/** How many characters of the page on show are typed (0 before the box shows). */
export function talkTyped(talk: Talk): number {
  return Math.max(0, talk.tick - TALK_OPEN_TICKS + 1);
}

/** Whether the page on show is fully typed. */
export function pageTyped(talk: Talk, stage: AdventureStage): boolean {
  const length = stage.messages?.pages(talk.message)?.[talk.page] ?? 0;
  return talk.tick >= TALK_OPEN_TICKS && talkTyped(talk) >= length;
}

/**
 * A tick of an open message: the box types; the Item button finishes a page being typed (TODO(measure)), turns a
 * typed one or closes the box after the last. Returns the leader's buttons for the rest of the step (none: he stands).
 */
export function stepTalk(game: AdventureGame, stage: AdventureStage, buttons: number): number {
  const a = game.adventure, t = a.talk!;
  // A press held on is masked by `ignore` until it's released (stepAdventure), so any press here is a new one.
  const pressed = buttons & TALK_BUTTON;
  a.ignore |= pressed;
  if (t.close > 0) {
    if (--t.close === 0) nextTalk(game, stage, t);
    return 0;
  }
  t.tick++;
  if (pressed && t.tick > TALK_OPEN_TICKS) {
    const pages = stage.messages?.pages(t.message) ?? [];
    if (!pageTyped(t, stage)) t.tick = TALK_OPEN_TICKS - 1 + (pages[t.page] ?? 0);
    else if (t.page < pages.length - 1) Object.assign(t, { page: t.page + 1, tick: TALK_OPEN_TICKS - 1 });
    else t.close = TALK_CLOSE_TICKS;
  }
  return 0;
}

/** A speaker that talks by itself opens its message now (no press): the owl, an escort Zora meeting the Link (zoras.ts). */
export function openScripted(game: AdventureGame, stage: AdventureStage, actor: number, message: number, style: TalkStyle, after: number[] = []): void {
  game.adventure.talk = { actor, message, style, page: 0, tick: 0, close: 0, ...(after.length ? { after } : {}) };
  setFlags(game, stage, message);
}

/**
 * The owl (KEPO; main.dol: init 0x80219E4C, its talk 0x8021936C, the reach test 0x801D05F8) talks by itself, once, when
 * any Link comes within OWL_REACH × max((params >> 20) & 31, 1.5) px of it (inclusive: Hyrule Castle's 5, 80 px;
 * Tingle's Tower's 0, 24 px); the message is (params & 0xFFFF) + 0x12B. It doesn't (another state) with params bit 19
 * set, or once its switch (params >> 25) & 31, when not 0, is on. Measured in Dolphin: Hyrule Castle room 0 (walking up
 * x 256, the Links stopped at y 204.5, 79.3 px from the owl's (296, 136); its box at once, assumed) and Tingle's Tower
 * room 11 (the leader stopped 23.95 px from (280, 104), the step before 24.21; params bit 30 set: the camera pans to the
 * house and the owl flies in, the box's first character OWL_FLIGHT_TICKS after the stop). The Links stand from the next
 * tick until the message's last page is closed (in Dolphin they walked again within 3 ticks of the press; the sim's
 * close takes TALK_CLOSE_TICKS). OWL_STAGES: where it was measured; Lake Hylia's (room 0's would talk at once) wait for
 * its start's story intro, which isn't simulated.
 */
export const OWL_REACH = 16;
/** Ticks from the stop to the box's first character when the owl flies in (params bit 30): Tingle's Tower's, measured. */
export const OWL_FLIGHT_TICKS = 239;
/** Tingle's Tower (boss012) and Hyrule Castle (boss013). */
export const OWL_STAGES: ReadonlySet<number> = new Set([12, 13]);

/** The owl's talk: its message opens when a Link comes within its reach, held until it's read. */
export function startOwlTalk(game: AdventureGame, stage: AdventureStage): void {
  const a = game.adventure;
  if (!OWL_STAGES.has(stage.index) || a.talk || a.area !== 0) return;
  const owl = currentArea(game, stage).actors.find((x) => x.id === "KEPO" && !a.talked.includes(actorKey(a.room, x.index)));
  if (!owl || (owl.params >>> 19) & 1 || switchOn(game.battle, (owl.params >>> 25) & 31)) return;
  const reach = OWL_REACH * Math.max((owl.params >>> 20) & 31, 1.5);
  if (!game.players.some((p) => Math.hypot(p.x / SUBPX - owl.x, p.y / SUBPX - owl.y) <= reach)) return;
  const message = (owl.params & 0xffff) + MESSAGE_BASE;
  if (!(stage.messages?.pages(message)?.length)) return;
  a.talked.push(actorKey(a.room, owl.index));
  openScripted(game, stage, owl.index, message, "balloon");
  // Flying in: the first character OWL_FLIGHT_TICKS after the stop (this tick; stepTalk counts it, typing from TALK_OPEN_TICKS).
  if ((owl.params >>> 30) & 1) a.talk!.tick = TALK_OPEN_TICKS - 1 - OWL_FLIGHT_TICKS;
}

// --- an item got: the pose, then its message ---

/**
 * Items whose getting shows a message (measured: the lamp, from the Cave of No Return's pedestal): the Links hold it
 * up (player_sob 233 for 10 ticks, 234 for 4, 235 for 1, then 236), the message's box shows on the 97th tick after the
 * press, and they hold the pose until it's closed. TODO(measure): the other items' (Lake Hylia's boomerang showed none
 * in the traces made for it).
 */
export const GET_MESSAGES: Partial<Record<GearKind, number>> = { lamp: 0xdd, bow: 0xcb };
export const GET_TALK_TICK = 97 - TALK_OPEN_TICKS;
/** The pose's frames (until tick, frame; -1 standing) taking an item, and a chest's content (chests.ts); a key: the Links
 *  stand (its pose was not traced). */
export type GetPose = "item" | "chest" | "key";
const GET_FRAMES: Readonly<Record<GetPose, readonly (readonly [number, number])[]>> = {
  item: [[10, 233], [14, 234], [15, 235], [Infinity, 236]],
  chest: [[12, -1], [16, 238], [17, 239], [Infinity, 240]],
  key: [[Infinity, -1]],
};

/** Something was got (gear.ts' items, chests.ts' contents): its pose starts, and its message on GET_TALK_TICK. */
export function startGet(game: AdventureGame, message: number, pose: "item" | "chest"): void {
  game.adventure.get = { tick: 0, message, pose };
}

/**
 * The first key the Links get, brought back by the boomerang (gear.ts): its message (msgus 361, "It's a small key! Use the
 * R Button to lift it and carry it to a keyhole!") opens its box on the 9th tick after the key dropped at the Links' feet
 * (traced in Lake Hylia room 3: the key dropped at frame 267, the box's first frames at about 276). Typed a character a
 * tick as the signs are (TODO(measure): the typing speed); the Links stand until it's closed.
 */
export const KEY_MESSAGE = 361;
export const KEY_TALK_TICK = 9;
export function startKeyGet(game: AdventureGame): void {
  game.adventure.get = { tick: 0, message: KEY_MESSAGE, pose: "key", talkAt: KEY_TALK_TICK };
}

/** An item was got from a pedestal (gear.ts): its pose and message, when it has one. */
export function startItemGet(game: AdventureGame, kind: GearKind): void {
  const message = GET_MESSAGES[kind];
  if (message !== undefined) startGet(game, message, "item");
}

/** The pose of an item got, one tick: true while it lasts (the Links stand); its message opens on its tick. */
export function stepGet(game: AdventureGame): boolean {
  const a = game.adventure, g = a.get;
  if (!g) return false;
  const at = g.talkAt ?? GET_TALK_TICK;
  if (g.tick > at && !a.talk) {
    a.get = null;
    return false;
  }
  if (++g.tick === at) a.talk = { actor: -1, message: g.message, style: "balloon", page: 0, tick: 0, close: 0 };
  return true;
}

/** The pose frame of an item got (the Links hold it up), or -1. */
export function getFrame(game: AdventureGame): number {
  const g = game.adventure.get;
  if (!g) return -1;
  return GET_FRAMES[g.pose].find(([until]) => g.tick < until)![1];
}
