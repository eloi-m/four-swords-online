// What the arena's actors ask the TV's message window for (main2D main_message_window.blo, main.dol's message function
// 0x8043D67C, called with the BMG id − 1): apps/battle timeline.ts shows them as the game's message manager would (one
// window: a request while it's up is dropped). Only the requests the state can't tell afterwards are logged here: a
// Hyrule Castle magic circle reaching full size for the first time in its round ("You got 10 Dark World seconds!",
// CIRC 0x8028AF6C, color 5 only: its +0x260 is set at init for that color and cleared by the call), the content of an
// orb taken on a GBA screen ("P1 nabbed a crystal ball!", CRTL 0x803218A0: the actor's screen ≥ 8, multiplayer) and the
// giant bomb landing ("A giant bomb! Escape to your Game Boy Advance!", BBMB 0x80342E10, its kind 0). The knockouts'
// "P2 down!" and Vaati's "30 seconds left!" / "Vaati arrives in 10 seconds!" follow from `downs` and `timeLeft`.
import type { BattleState } from "./battle.ts";
import type { GameState } from "./game.ts";

export interface BattleMessage {
  /** The BMG message id. */
  id: number;
  /** The player its {number 0} names, -1 for none. */
  player: number;
  /** GameState.tick right after the step that asked for it. */
  tick: number;
}

/** The BMG ids. */
export const MESSAGE = {
  darkWorld: 0xe8, // "{notice}You got 10 Dark World seconds!"
  crystalBall: 0x1a2, // "P{number 0} nabbed a crystal ball!"
  giantBomb: 0x1a9, // "A giant bomb! Escape to\nyour Game Boy Advance!"
  angryCuccos: 0x1b7, // "Angry Cuccos! Run away!" (hens.ts: The Field's cave cucco's tenth hit, NIWA 0x803303C8)
} as const;

/**
 * Requests older than this are dropped (the window is up 191 ticks a message: the oldest that can still matter is a
 * request two windows back), but for {notice} messages, which the game shows once (a flag of the save file, set when one
 * is shown: here once a match) and so are kept for the whole match.
 */
export const MESSAGE_KEEP = 400;
export const NOTICE_MESSAGES: ReadonlySet<number> = new Set([MESSAGE.darkWorld]);

/** Logs a request made during this step. */
export function askMessage(state: GameState, id: number, player = -1): void {
  const b = state.battle!;
  (b.messages ??= []).push({ id, player, tick: state.tick + 1 });
}

/** Forgets the requests nothing can show any more (after the step's tick++). */
export function pruneMessages(state: GameState): void {
  const b: BattleState = state.battle!;
  const list = b.messages;
  const keep = (m: BattleMessage) => NOTICE_MESSAGES.has(m.id) || state.tick - m.tick <= MESSAGE_KEEP;
  if (!list || list.every(keep)) return;
  const kept = list.filter(keep);
  if (kept.length) b.messages = kept;
  else delete b.messages;
}
