// The pause screen's timeline (game2D.arc pause.blo, then main2D.arc warning_window.blo for "Leave this area?"), as
// the game plays it (Dolphin frame dumps of a Shadow Battle paused from a GBA: docs/measurements/screens.md "The pause screen
// in Dolphin"). Plain logic on its own 60 Hz clock, tested in node; pause.ts draws it, main.ts (local play: the sim
// stops meanwhile) and online.ts (the match goes on) drive it.
// - opening: the arena dims (pause.blo's Pblack, alpha 80) over 27 ticks from tick 2, and the plate drops in from
//   above from tick 15, landing 26 px low and settling (PLATE_IN);
// - the menu: Continue / Choose an Area / Choose a Game, the selected one lit and flanked by the cursor's swords, which
//   bounce down when the cursor moves (CURSOR_BOUNCE); up / down move it, A picks, B and Start are Continue;
// - Continue: from tick 16 the plate dips and flies up out of the frame (PLATE_OUT), the dim fades from tick 21 over
//   13 ticks, and play resumes once it is gone;
// - Choose an Area / Choose a Game: from tick 16 the plate falls out at the bottom (PLATE_FALL), and from tick 27 the
//   question (BMG 0x10B "Leave this area?" / 0x10C "Quit Shadow Battle?") drops in in the warning window
//   (CONFIRM_IN), No under the cursor; left / right pick, A answers, B is No. No: the window falls out (2 ticks
//   after) and the plate drops in again, the cursor on Continue (27 ticks after). Yes: the window falls out and the
//   frame fades to black, then the page goes to the menu (an area) or the home page (a game).

/** The menu's items, top to bottom. */
export const PAUSE_ITEMS = ["continue", "area", "game"] as const;
export type PauseItem = (typeof PAUSE_ITEMS)[number];
/** What the pause ends with, once its animation has played out. */
export type PauseOutcome = "continue" | "area" | "game";

/** The dim's alpha (pause.blo Pblack's own) and its ramps. */
export const DIM = { alpha: 80, inFrom: 2, inTicks: 27, outFrom: 21, outTicks: 13 } as const;
/**
 * The plate's offset below its place (screen px), one a tick from PLATE_IN_FROM (bottom edge in the dumps, 452 lines
 * scaled to 448): off the top, falling faster, 26 px past its place, back.
 */
export const PLATE_IN_FROM = 15;
export const PLATE_IN = [-354, -335, -315, -294, -272, -248, -222, -196, -169, -139, -109, -77, -44, -10, 26, 16, 9, 4, 1, 0] as const;
/** Continue: a dip, then up and away (off the top after the last entry). */
export const PLATE_OUT_FROM = 16;
export const PLATE_OUT = [9, 16, 22, 25, 26, 23, 15, 2, -16, -39, -68, -102, -141, -185, -235, -290, -349, -420] as const;
/** A choice: the plate falls out at the bottom. */
export const PLATE_FALL_FROM = 16;
export const PLATE_FALL = [5, 19, 44, 77, 120, 172, 236, 307, 390] as const;
/** The question's window drops in (offsets of its place, screen px), 26 ticks after the choice. */
export const CONFIRM_IN_FROM = 27;
export const CONFIRM_IN = [-300, -225, -161, -105, -59, -25, 0, 14, 20, 8, 2, 0] as const;
/** An answer: the window falls out (PLATE_FALL's law) from tick 2; after No the plate drops in again from tick 27. */
export const CONFIRM_OUT_FROM = 2;
export const RETURN_FROM = 27;
/** After Yes, the frame fades to black over this many ticks once the window is out, then the outcome. */
export const LEAVE_FADE = 25;
/** The cursor's swords jump to the new item and bounce down (px a tick from the move). */
export const CURSOR_BOUNCE = [0, 1, 2, 3, 5, 3, 2, 1, 0] as const;

export type PausePhase = "opening" | "menu" | "closing" | "choosing" | "confirm" | "answering" | "returning" | "leaving";

export interface PauseInput {
  up?: boolean;
  down?: boolean;
  left?: boolean;
  right?: boolean;
  /** A (pick) */
  a?: boolean;
  /** B (back) */
  b?: boolean;
  /** Start (Continue) */
  start?: boolean;
}

export interface PauseView {
  /** Black over the arena, 0-255 (Pblack's alpha). */
  dim: number;
  /** The plate's offset below its place (px), or null while it isn't shown. */
  plate: number | null;
  /** The lit item and the swords' bounce (px down). */
  cursor: number;
  bounce: number;
  /** The question's window: its offset below its place, or null. */
  confirm: number | null;
  /** The question asked, and the answer under the cursor (0 Yes, 1 No). */
  question: "area" | "game" | null;
  answer: 0 | 1;
  /** Black over everything (leaving after Yes), 0-1. */
  fade: number;
}

export class PauseState {
  phase: PausePhase = "opening";
  /** Ticks in the phase. */
  t = 0;
  cursor = 0;
  /** Ticks since the cursor last moved (for the bounce). */
  moved: number = CURSOR_BOUNCE.length;
  question: "area" | "game" | null = null;
  answer: 0 | 1 = 1;
  private yes = false;

  /** Whether the menu takes input (the plate is in, or the question is up). */
  get interactive(): boolean {
    return this.phase === "menu" || this.phase === "confirm";
  }

  /** One tick. Returns the outcome on the tick the pause is over (the screen gone, or the fade to black done). */
  step(input: PauseInput = {}): PauseOutcome | null {
    this.t++;
    this.moved++;
    switch (this.phase) {
      case "opening":
        if (this.t >= PLATE_IN_FROM + PLATE_IN.length) this.enter("menu");
        return null;
      case "menu":
        if (input.start || input.b) this.enter("closing");
        else if (input.up || input.down) this.move(input.up ? -1 : 1);
        else if (input.a) this.pick(PAUSE_ITEMS[this.cursor]!);
        return null;
      case "closing":
        return this.t >= DIM.outFrom + DIM.outTicks ? "continue" : null;
      case "choosing":
        if (this.t >= CONFIRM_IN_FROM + CONFIRM_IN.length) this.enter("confirm");
        return null;
      case "confirm":
        if (input.left || input.right) this.answer = input.left ? 0 : 1;
        else if (input.b) this.reply(false);
        else if (input.a) this.reply(this.answer === 0);
        return null;
      case "answering":
        if (this.t >= (this.yes ? CONFIRM_OUT_FROM + PLATE_FALL.length : RETURN_FROM)) {
          if (this.yes) this.enter("leaving");
          else {
            this.enter("returning");
            this.cursor = 0;
            this.question = null;
          }
        }
        return null;
      case "returning":
        if (this.t >= PLATE_IN.length) this.enter("menu");
        return null;
      case "leaving":
        return this.t >= LEAVE_FADE ? (this.question ?? "area") : null;
    }
  }

  /** Picks an item (A, or a click on it: then also while the plate is still landing). */
  pick(item: PauseItem): void {
    if (this.phase !== "menu" && this.phase !== "opening" && this.phase !== "returning") return;
    this.cursor = PAUSE_ITEMS.indexOf(item);
    if (item === "continue") this.enter("closing");
    else {
      this.question = item;
      this.answer = 1;
      this.enter("choosing");
    }
  }

  /** Answers the question (A on Yes / No, B, or a click). */
  reply(yes: boolean): void {
    if (this.phase !== "confirm" && this.phase !== "choosing") return;
    this.answer = yes ? 0 : 1;
    this.yes = yes;
    this.enter("answering");
  }

  /** Moves the cursor (up -1, down +1; it stops at the ends). */
  move(by: number): void {
    const to = Math.max(0, Math.min(PAUSE_ITEMS.length - 1, this.cursor + by));
    if (to === this.cursor) return;
    this.cursor = to;
    this.moved = 0;
  }

  /** Continue (Start, Esc, the on-screen pause button): closes from the menu. */
  resume(): void {
    if (this.phase === "menu" || this.phase === "opening" || this.phase === "returning") this.enter("closing");
    else if (this.phase === "confirm") this.reply(false);
  }

  view(): PauseView {
    const t = this.t, at = <T extends readonly number[]>(table: T, i: number, before: number | null, after: number | null) => (i < 0 ? before : i < table.length ? table[i]! : after);
    const view: PauseView = { dim: DIM.alpha, plate: 0, cursor: this.cursor, bounce: (CURSOR_BOUNCE as readonly number[])[this.moved] ?? 0, confirm: null, question: this.question, answer: this.answer, fade: 0 };
    switch (this.phase) {
      case "opening":
        view.dim = DIM.alpha * Math.min(1, Math.max(0, (t - DIM.inFrom + 1) / DIM.inTicks));
        view.plate = at(PLATE_IN, t - PLATE_IN_FROM, null, 0);
        break;
      case "closing":
        view.dim = DIM.alpha * (1 - Math.min(1, Math.max(0, (t - DIM.outFrom + 1) / DIM.outTicks)));
        view.plate = at(PLATE_OUT, t - PLATE_OUT_FROM, 0, null);
        break;
      case "choosing":
        view.plate = at(PLATE_FALL, t - PLATE_FALL_FROM, 0, null);
        view.confirm = at(CONFIRM_IN, t - CONFIRM_IN_FROM, null, 0);
        break;
      case "confirm":
        view.plate = null;
        view.confirm = 0;
        break;
      case "answering":
        view.plate = null;
        view.confirm = at(PLATE_FALL, t - CONFIRM_OUT_FROM, 0, null);
        break;
      case "returning":
        view.plate = at(PLATE_IN, t, null, 0);
        break;
      case "leaving":
        view.plate = null;
        view.fade = Math.min(1, t / LEAVE_FADE);
        break;
    }
    return view;
  }

  private enter(phase: PausePhase): void {
    this.phase = phase;
    this.t = 0;
  }
}
