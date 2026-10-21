// The menus' words from the game's own messages (the US BMG, battleMessages(): docs/formats/j2d-and-bmg.md "Messages for
// Shadow Battle and the site"), as plain text for the page: the arena names, the Rules panel's title, START!, the
// results' "P1 WINS!", the pause's Continue and Yes / No. Our own labels the game has no message for (hearts, time
// limit, wins, the online lobby's, CPU levels, remapping) stay ours. Until the messages are read (setMenuMessages),
// or where one is missing or empty, the words are the fallbacks below (the page's own).
import { battleMessages, type Bmg } from "@fso/formats";
import { arenaName, ARENA_ROOMS } from "@fso/sim";

export interface MenuText {
  title: string;
  /** By room (the sim's order): "Tower of Flames\n(Dark World)" (the game's line break kept). */
  arenas: string[];
  rules: string;
  start: string;
  /** By player: "P1 WINS!". */
  wins: string[];
  /** The pause's Continue, its questions' answers, and the Total screen's Quit (its Continue is the pause's). */
  continue: string;
  quit: string;
  yes: string;
  no: string;
}

export const FALLBACK_TEXT: MenuText = {
  title: "Shadow Battle",
  arenas: ARENA_ROOMS.map((room) => arenaName(room).replace(/ \((.*)\)$/, "\n($1)")),
  rules: "Rules",
  start: "START!",
  wins: [0, 1, 2, 3].map((i) => `P${i + 1} WINS!`),
  continue: "Continue",
  quit: "Quit",
  yes: "Yes",
  no: "No",
};

/** The menus' words from a message file (null: none), each missing or empty one its fallback. */
export function menuTexts(bmg: Bmg | null): MenuText {
  if (!bmg) return FALLBACK_TEXT;
  const m = battleMessages(bmg);
  const or = (text: string, fallback: string) => (text.trim() ? text : fallback);
  const list = (texts: string[], fallbacks: string[]) => fallbacks.map((f, i) => or(texts[i] ?? "", f));
  const f = FALLBACK_TEXT;
  return {
    title: or(m.title, f.title),
    arenas: list(m.arenas, f.arenas),
    rules: or(m.rules, f.rules),
    start: or(m.start, f.start),
    wins: list(m.wins, f.wins),
    continue: or(m.pause.continue, f.continue),
    quit: or(m.pause.quit, f.quit),
    yes: or(m.ruleValues.yes, f.yes),
    no: or(m.ruleValues.no, f.no),
  };
}

let current = FALLBACK_TEXT;

/** Reads the menus' words from the US messages (ScreenFiles.bmg), once they're loaded. */
export function setMenuMessages(bmg: Bmg | null): void {
  current = menuTexts(bmg);
}

export function menuText(): MenuText {
  return current;
}

/** An arena's name and, for the Dark World's, the world on its own: the message's two lines. */
export function arenaLabel(room: number): { name: string; world: string | null } {
  const text = current.arenas[room] ?? arenaName(room);
  const [name, ...rest] = text.split("\n");
  const world = rest.join(" ").replace(/^\((.*)\)$/, "$1").trim();
  return { name: name!.trim(), world: world || null };
}

/** An arena's name on one line: "Tower of Flames (Dark World)". */
export function arenaTitle(room: number): string {
  const { name, world } = arenaLabel(room);
  return world ? `${name} (${world})` : name;
}
