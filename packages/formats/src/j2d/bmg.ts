// BMG message files ("MESGbmg1", msgus.arc bmg/gc_four_swords_text_e.bmg and _ek.bmg, msgjp.arc _jp/_jpk): every
// text the game prints through its message system. Layout (docs/formats/j2d-and-bmg.md "Messages (BMG)"):
//   0x20-byte header: magic, u32 file size, u32 block count, u8 encoding (3 = Shift-JIS in all four files), pad
//   blocks [u32 tag, u32 size (padded to 0x20)]:
//     INF1 u16 count, u16 entry size (8), u16 file id, u8 default color, pad; entries from +0x10:
//          u32 offset of the text in DAT1's data, u16 message id (index + 1 in FSA), u16 attributes (always 0)
//     DAT1 the texts, NUL-terminated; offset 0 is the empty string
//     MID1 (not in FSA's files) u16 count, u8 format, u8 info, 4 pad, u32 ids
// A text is Shift-JIS (one byte for ASCII, two for lead bytes 0x81-0x9F/0xE0-0xFC) with tags: 0x1A, u8 tag length
// (from the 0x1A), u8 group, u16 type, then length - 5 bytes of arguments. BMG_TAGS names the tags FSA uses.
import { ascii, dataView } from "../bytes.ts";

export type BmgConfidence = "confirmed" | "likely" | "hypothesis";

/** A run of characters: font codes (one byte, or lead << 8 | trail for Shift-JIS) and the same text decoded. */
export interface BmgText {
  kind: "text";
  codes: number[];
  text: string;
}

export interface BmgTag {
  kind: "tag";
  group: number;
  type: number;
  /** group << 16 | type, the key of BMG_TAGS. */
  key: number;
  args: Uint8Array;
}

export type BmgPart = BmgText | BmgTag;

export interface BmgMessage {
  index: number;
  /** The message number the game and the flow tags use (INF1; index + 1 in FSA). */
  id: number;
  /** INF1 entry bytes after the offset and id (u16 0 in every FSA message). */
  attributes: Uint8Array;
  /** Raw bytes of the text, without the terminating NUL. */
  bytes: Uint8Array;
  parts: BmgPart[];
}

export interface Bmg {
  encoding: number;
  fileId: number;
  defaultColor: number;
  entrySize: number;
  /** Block tags in file order, e.g. ["INF1", "DAT1"]. */
  blocks: string[];
  messages: BmgMessage[];
  /** MID1 ids by message index, when the file has a MID1 block. */
  mids?: number[];
}

export function isBmg(bytes: Uint8Array): boolean {
  return bytes.length >= 0x20 && ascii(bytes, 0, 8) === "MESGbmg1";
}

export function parseBmg(bytes: Uint8Array): Bmg {
  if (!isBmg(bytes)) throw new Error("not a MESGbmg1 file");
  const v = dataView(bytes);
  const bmg: Bmg = { encoding: bytes[0x10]!, fileId: 0, defaultColor: 0, entrySize: 0, blocks: [], messages: [] };
  if (bmg.encoding !== 0 && bmg.encoding !== 1 && bmg.encoding !== 3) throw new Error(`unsupported BMG encoding ${bmg.encoding}`);
  let inf = -1, dat = -1;
  let o = 0x20;
  const count = v.getUint32(0x0c);
  for (let i = 0; i < count && o + 8 <= bytes.length; i++) {
    const tag = ascii(bytes, o, 4), size = v.getUint32(o + 4);
    bmg.blocks.push(tag);
    if (tag === "INF1") inf = o;
    else if (tag === "DAT1") dat = o + 8;
    else if (tag === "MID1") {
      const n = v.getUint16(o + 8);
      bmg.mids = Array.from({ length: n }, (_, k) => v.getUint32(o + 0x10 + k * 4));
    }
    if (size < 8) throw new Error(`bad BMG block size ${size}`);
    o += size;
  }
  if (inf < 0 || dat < 0) throw new Error("BMG without INF1 or DAT1");
  const n = v.getUint16(inf + 8);
  bmg.entrySize = v.getUint16(inf + 10);
  bmg.fileId = v.getUint16(inf + 12);
  bmg.defaultColor = bytes[inf + 14]!;
  const twoByte = bmg.encoding === 3;
  for (let index = 0; index < n; index++) {
    const e = inf + 0x10 + index * bmg.entrySize;
    const start = dat + v.getUint32(e);
    let end = start;
    while (end < bytes.length && bytes[end] !== 0) end += bytes[end] === 0x1a ? Math.max(bytes[end + 1]!, 2) : twoByte && isLead(bytes[end]!) ? 2 : 1;
    const text = bytes.subarray(start, Math.min(end, bytes.length));
    bmg.messages.push({
      index,
      id: bmg.entrySize >= 6 ? v.getUint16(e + 4) : index,
      attributes: bytes.subarray(e + 6, e + bmg.entrySize),
      bytes: text,
      parts: parseBmgText(text, twoByte),
    });
  }
  return bmg;
}

const isLead = (b: number) => (b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc);

let decoder: TextDecoder | null | undefined;
function decodeText(bytes: number[]): string {
  if (decoder === undefined) {
    try {
      decoder = new TextDecoder("shift_jis");
    } catch {
      decoder = null;
    }
  }
  return decoder ? decoder.decode(new Uint8Array(bytes)) : String.fromCharCode(...bytes);
}

/** Splits one message's bytes into text runs and tags. `twoByte`: Shift-JIS lead bytes take two bytes. */
export function parseBmgText(bytes: Uint8Array, twoByte = true): BmgPart[] {
  const parts: BmgPart[] = [];
  let codes: number[] = [], raw: number[] = [];
  const flush = () => {
    if (codes.length) parts.push({ kind: "text", codes, text: decodeText(raw) });
    codes = [];
    raw = [];
  };
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    if (b === 0x1a) {
      flush();
      const length = Math.max(bytes[i + 1] ?? 0, 5);
      const group = bytes[i + 2] ?? 0, type = ((bytes[i + 3] ?? 0) << 8) | (bytes[i + 4] ?? 0);
      parts.push({ kind: "tag", group, type, key: (group << 16) | type, args: bytes.subarray(i + 5, i + length) });
      i += length;
    } else if (twoByte && isLead(b) && i + 1 < bytes.length) {
      codes.push((b << 8) | bytes[i + 1]!);
      raw.push(b, bytes[i + 1]!);
      i += 2;
    } else {
      codes.push(b);
      raw.push(b);
      i++;
    }
  }
  flush();
  return parts;
}

export interface BmgTagInfo {
  name: string;
  /** Argument layout, e.g. "u32 msg, u8": u8/u16/u32 fields, big-endian, with an optional label. */
  args: string;
  note: string;
  confidence: BmgConfidence;
}

const tag = (name: string, args: string, note: string, confidence: BmgConfidence): BmgTagInfo => ({ name, args, note, confidence });
const range = (from: number, to: number, info: (k: number) => BmgTagInfo): [number, BmgTagInfo][] =>
  Array.from({ length: to - from + 1 }, (_, k) => [from + k, info(from + k)]);

/**
 * Picture characters (group 1, types 0-10): the game puts two spaces in the text and draws a texture over them. The
 * textures, in main.dol's table order (0x80475E20; main2D.arc timg/): the four Links, the three Hylian letters of the
 * language exam, a heart full, 3/4, 1/2 and 1/4 (the fortune teller's readings).
 */
export const BMG_ICON_TEXTURES: readonly string[] = [
  "kk_linkGr_01.bti", "kk_linkRe_01.bti", "kk_linkBl_01.bti", "kk_linkPu_01.bti",
  "kk_angou_01.bti", "kk_angou_02.bti", "kk_angou_03.bti",
  "heart.bti", "heart_01.bti", "heart_02.bti", "heart_03.bti",
];

/** Group 1 types 0x10-0x13: the US font's arrow characters (main.dol sdata2 0x805432BC). */
export const BMG_ARROW_CODES: readonly number[] = [0xa7, 0xa8, 0xa6, 0xa5]; // up, down, left, right

/** Text colors of tag 2.1E (main.dol 0x80475D64, RGBA): 0 white, then the four players' colors. */
export const BMG_COLORS: readonly (readonly [number, number, number, number])[] = [
  [255, 255, 255, 255], [100, 255, 0, 255], [250, 80, 0, 255], [50, 210, 255, 255], [240, 100, 255, 255],
];

/** Units a number (group 3) may take from its argument (1-9), singular when the value is 1 (main.dol 0x8039C630). */
export const BMG_NUMBER_UNITS: readonly (readonly [string, string])[] = [
  ["", ""], [" Force Gem", " Force Gems"], [" Cucco", " Cuccos"], [" baddy", " baddies"], [" time", " times"],
  [" system", " systems"], [" thief", " thieves"], [" mole", " moles"], [" return", " returns"],
  [" Force Fairy", " Force Fairies"],
];

const NUMBER_NOTES = [
  "a player or controller number", "the time (printed elsewhere)", "a Force Gem price", "Force Gems held",
  "a reward", "a mini-game best time", "a combined record", "a record", "how many are left",
];

/**
 * The tags of FSA's message files, keyed by group << 16 | type. "confirmed" = read in main.dol's tag handler
 * (0x8039D770, which turns tags into J2DPrint text) or unambiguous in every use; "likely" = consistent in every use;
 * "hypothesis" = named from the texts around it. Flow tags (group 2) mostly drive the message system and print nothing.
 */
export const BMG_TAGS: ReadonlyMap<number, BmgTagInfo> = new Map<number, BmgTagInfo>([
  [0x00000, tag("page", "", "end of a box: waits for a button, the rest shows in a new box (a newline right after it is dropped)", "likely")],
  ...range(0x10000, 0x1000a, (k) =>
    tag("icon", "", `picture character ${k & 0xff}: ${BMG_ICON_TEXTURES[k & 0xff]} over two spaces`, "likely")),
  [0x1000b, tag("icon", "", "picture slot 11 (prints nothing; unused)", "confirmed")],
  [0x1000c, tag("icon", "", "picture slot 12 (prints nothing; unused)", "confirmed")],
  ...range(0x10010, 0x10013, (k) => tag("arrow", "", `${["up", "down", "left", "right"][k & 3]} arrow, font character 0x${BMG_ARROW_CODES[k & 3]!.toString(16)}`, "confirmed")),
  [0x20005, tag("then", "u32 msg", "continues with another message (at the start of a message)", "hypothesis")],
  [0x20006, tag("act", "u8, u8", "an NPC action or sound at this point", "hypothesis")],
  [0x20007, tag("branch", "u8 cond, u32 msg, u32 msg", "goes on with the first message if the current room's switch `cond` is on, else the second (message indices)", "confirmed")],
  ...range(0x20009, 0x2000c, () => tag("choice", "u32 msg, u8", "an answer leading to a message; 4 spaces for the cursor", "confirmed")),
  [0x2000d, tag("pay", "u32 amount, u8, u16", "takes Force Gems (\"100 Force Gems exactly.\")", "hypothesis")],
  [0x2000e, tag("fortune", "u8", "the fortune teller's reading", "hypothesis")],
  [0x20010, tag("branch", "u8 cond, u32 msg, u32 msg, u8", "goes on with one of two messages", "hypothesis")],
  ...range(0x20011, 0x20014, () => tag("choice", "", "an answer; 4 spaces for the cursor (unused)", "confirmed")),
  [0x20015, tag("wait", "u32 frames, u8", "pause before the next part (Tingle's chant, the language exam)", "hypothesis")],
  [0x20016, tag("voice", "u8", "the speaker's voice clip, at the start of NPC lines", "hypothesis")],
  [0x20017, tag("act", "u8", "an NPC action after a service", "hypothesis")],
  [0x20018, tag("branch4", "u32 msg, u32 msg, u32 msg, u32 msg", "one of four messages, by the controllers (the first for one; the sim assumes one): message indices", "hypothesis")],
  ...range(0x20019, 0x2001c, (k) => tag(`option${k - 0x20019}`, "u8", `answer slot ${k - 0x20019} (Yes/No, the vote): spaces for the cursor, as many as the runtime says`, "confirmed")),
  [0x2001d, tag("ifGems", "u32 amount, u32 msg, u32 msg", "branches on having enough Force Gems", "hypothesis")],
  [0x2001e, tag("color", "u8 color", "text color: 0 white, 1-4 the players' colors (BMG_COLORS)", "confirmed")],
  [0x2001f, tag("story", "", "at the start of story messages (maidens, Zelda, Kaepora Gaebora, Tingle)", "hypothesis")],
  [0x20022, tag("setFlag", "u8 kind, u16 flag, u8 value", "sets a game flag (value 1) or clears it (0): the old man's first talk sets 1/10, the formations drill's end 3/10", "likely")],
  [0x20023, tag("ifFlag", "u8 kind, u16 flag, u32 msg, u32 msg", "branches on a game flag: the first message if it's set, else the second (message indices)", "likely")],
  [0x20024, tag("give", "u8, u8 item, u8", "gives an item", "hypothesis")],
  [0x20025, tag("autoClose", "u32 frames", "the box closes by itself after a while", "hypothesis")],
  [0x20026, tag("timerStart", "u32 seconds, u8, u8", "starts a race timer (\"within 20 seconds\")", "hypothesis")],
  [0x20027, tag("timerStop", "", "stops the race timer (\"GOAL!\")", "hypothesis")],
  [0x20028, tag("timerEnd", "", "ends the race", "hypothesis")],
  [0x20029, tag("time", "", "prints the race time (\"Your time is...\")", "likely")],
  [0x2002a, tag("notice", "", "at the start of short notices", "hypothesis")],
  [0x2002b, tag("part", "u8", "a numbered part of Tingle's chant", "hypothesis")],
  [0x2002c, tag("branch", "u32 msg, u32 msg", "goes on with one of two messages", "hypothesis")],
  [0x2002d, tag("jingle", "", "a jingle or event mid-message", "hypothesis")],
  [0x2002e, tag("event", "", "an event at the start of a message", "hypothesis")],
  [0x2002f, tag("event", "u8", "an event at the start of a message", "hypothesis")],
  [0x20031, tag("event", "u8", "an event at the start of a message", "hypothesis")],
  [0x20032, tag("event", "", "an event at the start of a message", "hypothesis")],
  [0x20033, tag("ifItem", "u32 msg, u32 msg", "branches on an item (\"Do you have boots?\")", "hypothesis")],
  ...range(0x30000, 0x30008, (k) =>
    tag("number", "u8 unit", `number ${k & 0xff} (${NUMBER_NOTES[k & 0xff]}), then an optional unit (BMG_NUMBER_UNITS)`, "confirmed")),
]);

/** BMG_TAGS' entry for a tag, or undefined for a tag FSA's files don't use. */
export function bmgTagInfo(tag: BmgTag): BmgTagInfo | undefined {
  return BMG_TAGS.get(tag.key);
}

/** Argument values per the tag's layout (u8/u16/u32 fields), or the raw bytes for a tag without a known layout. */
export function bmgTagArgs(tag: BmgTag): number[] {
  const layout = bmgTagInfo(tag)?.args;
  if (!layout) return [...tag.args];
  const out: number[] = [];
  let o = 0;
  for (const field of layout.split(",")) {
    const size = field.trim().startsWith("u32") ? 4 : field.trim().startsWith("u16") ? 2 : 1;
    if (o + size > tag.args.length) break;
    let value = 0;
    for (let k = 0; k < size; k++) value = value * 256 + tag.args[o + k]!;
    out.push(value);
    o += size;
  }
  return out;
}

/** "2.1E" style name of a tag's group and type. */
export function bmgTagCode(tag: { group: number; type: number }): string {
  return `${tag.group}.${tag.type.toString(16).toUpperCase().padStart(2, "0")}`;
}

/** The message as text with tags written `{name args}` (`{2.1E 01}` for unknown tags), e.g. for search and display. */
export function bmgMessageText(message: BmgMessage | BmgPart[]): string {
  const parts = Array.isArray(message) ? message : message.parts;
  return parts
    .map((p) => {
      if (p.kind === "text") return p.text;
      const info = bmgTagInfo(p);
      const args = info ? bmgTagArgs(p).join(" ") : [...p.args].map((b) => b.toString(16).padStart(2, "0")).join(" ");
      return `{${info ? info.name : bmgTagCode(p)}${args ? ` ${args}` : ""}}`;
    })
    .join("");
}

/** The message's text only, tags dropped (pages joined by a newline). */
export function bmgPlainText(message: BmgMessage | BmgPart[]): string {
  return bmgPages(message)
    .map((page) => page.map((p) => (p.kind === "text" ? p.text : "")).join(""))
    .join("\n");
}

/** Splits a message at its page tags (0.00); a newline right after a page tag is dropped, as the boxes show it. */
export function bmgPages(message: BmgMessage | BmgPart[]): BmgPart[][] {
  const parts = Array.isArray(message) ? message : message.parts;
  const pages: BmgPart[][] = [[]];
  for (const p of parts) {
    if (p.kind === "tag" && p.key === 0) {
      pages.push([]);
      continue;
    }
    const page = pages.at(-1)!;
    if (p.kind === "text" && !page.length && pages.length > 1 && p.codes[0] === 0x0a) {
      if (p.codes.length > 1) page.push({ kind: "text", codes: p.codes.slice(1), text: p.text.slice(1) });
      continue;
    }
    page.push(p);
  }
  if (pages.length > 1 && !pages.at(-1)!.length) pages.pop();
  return pages;
}

/** Whether a tag takes a step of a box's typing: the ones that print something (pictures, arrows, numbers, answer spaces). */
const typedTag = (p: BmgTag) => p.group === 1 || p.group === 3 || (p.group === 2 && ((p.type >= 0x09 && p.type <= 0x0c) || (p.type >= 0x19 && p.type <= 0x1c)));

/**
 * How many steps a page takes to type out in a message box, one a frame (Dolphin, a sign: one character a frame): a
 * step per character (line breaks included) and per printing tag.
 */
export function bmgPageLength(page: BmgPart[]): number {
  return page.reduce((n, p) => n + (p.kind === "text" ? p.codes.length : typedTag(p) ? 1 : 0), 0);
}

/** A page's first `n` typing steps (bmgPageLength): what a box shows while it types; tags that print nothing are kept. */
export function bmgPageSlice(page: BmgPart[], n: number): BmgPart[] {
  const out: BmgPart[] = [];
  let left = n;
  for (const p of page) {
    if (p.kind === "text") {
      if (left <= 0) break;
      if (p.codes.length <= left) out.push(p);
      else out.push({ kind: "text", codes: p.codes.slice(0, left), text: [...p.text].slice(0, left).join("") });
      left -= p.codes.length;
    } else if (typedTag(p)) {
      if (left <= 0) break;
      out.push(p);
      left--;
    } else out.push(p);
  }
  return out;
}

/** Tags of a file that BMG_TAGS doesn't know, with how often and in which messages (first 5) they appear. */
export function unknownBmgTags(bmg: Bmg): { code: string; count: number; messages: number[] }[] {
  const found = new Map<number, { code: string; count: number; messages: number[] }>();
  for (const m of bmg.messages) {
    for (const p of m.parts) {
      if (p.kind !== "tag" || BMG_TAGS.has(p.key)) continue;
      const entry = found.get(p.key) ?? { code: bmgTagCode(p), count: 0, messages: [] };
      entry.count++;
      if (entry.messages.length < 5 && !entry.messages.includes(m.id)) entry.messages.push(m.id);
      found.set(p.key, entry);
    }
  }
  return [...found.values()];
}

/** The message with a given id (INF1's message number), or undefined. */
export function bmgMessageById(bmg: Bmg, id: number): BmgMessage | undefined {
  const guess = bmg.messages[id - 1];
  return guess?.id === id ? guess : bmg.messages.find((m) => m.id === id);
}

/**
 * Message ids of the texts Shadow Battle and its menus use (US and Japanese files share the ids), by what they say
 * in the US file. `arenas[room]` follows the sim's room order (0-4, then the Dark World's 5-9).
 */
export const BATTLE_MESSAGE_IDS = {
  arenas: [0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a],
  title: 0x40, // "Shadow Battle" (also 0xa6, the file menu's)
  description: 0x36, // "Defeat your rivals and prove who's the strongest Shadow Link of all!"
  players: [0x94, 0xa2, 0xa3, 0xa4], // "P1".."P4"
  versus: 0x95, // "Vs."
  entry: 0xa7, // "Entry"
  ok: 0xa8, // "OK?"
  start: 0xac, // "START!"
  handicap: 0xad, // "Handicap"
  records: 0xae, // "Records"
  wins: [0xaf, 0xb0, 0xb1, 0xb2], // "P1 WINS!".."P4 WINS!"
  tie: 0xb3, // "TIE!"
  time: 0xb4, // "TIME: {number 1}"
  results: 0x4b, // "Results"
  rules: 0xf8, // "Rules"
  ruleRows: { vaati: 0xf9, powerfulItems: 0xfa, damageRivals: 0xfb, darkWorldMatch: 0xfc },
  ruleValues: { yes: 0xfd, no: 0xfe, drop: 0xff, keep: 0x100, random: 0x101, p1ToP4: 0xf4, p2ToP4: 0xf5, end: 0xf6, quit: 0xf7 },
  newMap: 0x102, // "Congratulations on clearing Hyrulean Adventure! You got a new battle map!"
  lockedMap: 0x103, // "This appears once Hyrulean Adventure has been cleared!"
  // "Quit Shadow Battle?" + Yes/No answers; "Continue" / "Quit" are also the Total screen's buttons (Dolphin).
  pause: { leavePrompt: 0x10b, quitPrompt: 0x10c, continue: 0x10d, quit: 0x10e },
  down: 0x19b, // "P{number 0} down!": a knockout, in the message window (Dolphin)
  selectData: 0x118, // "Select Shadow Battle data"
  controllerRemoved: 0x3b, // "The Controller in Socket {number 0} was removed. Now returning to the title screen."
  insertControllers: 0xab, // "Insert {number 0} Controllers."
  rumble: { label: 0x38, on: 0x39, off: 0x3a },
} as const;

/** The battle texts of a message file as plain strings (newlines kept), keyed like BATTLE_MESSAGE_IDS. */
export function battleMessages(bmg: Bmg) {
  const text = (id: number) => {
    const m = bmgMessageById(bmg, id);
    return m ? bmgPlainText(m) : "";
  };
  const map = <T extends Record<string, number>>(ids: T) =>
    Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, text(id)])) as { [K in keyof T]: string };
  const ids = BATTLE_MESSAGE_IDS;
  return {
    arenas: ids.arenas.map(text),
    title: text(ids.title),
    description: text(ids.description),
    players: ids.players.map(text),
    versus: text(ids.versus),
    entry: text(ids.entry),
    ok: text(ids.ok),
    start: text(ids.start),
    handicap: text(ids.handicap),
    records: text(ids.records),
    wins: ids.wins.map(text),
    tie: text(ids.tie),
    /** "TIME: " without its number. */
    time: text(ids.time),
    results: text(ids.results),
    rules: text(ids.rules),
    ruleRows: map(ids.ruleRows),
    ruleValues: map(ids.ruleValues),
    newMap: text(ids.newMap),
    lockedMap: text(ids.lockedMap),
    pause: map(ids.pause),
    /** "P down!" without its number. */
    down: text(ids.down),
    selectData: text(ids.selectData),
    rumble: map(ids.rumble),
  };
}
