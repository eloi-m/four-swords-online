// The local match's end, over the game's own screens: "P1 WIN!" and "PRESS START" until a press (a key, a button of a
// player at this machine, a tap), then the Total screen (total.ts) with Continue / Quit. The page's #results stays the
// way in (Rematch / Menu, Enter / Esc, its title and standings for screen readers and tests), laid over the screen:
// its two buttons, see-through, on the J2D buttons, the cursor on the one last pointed at or picked with the arrows.
import { Button, type GameState } from "@fso/sim";
import { HUD_H, HUD_W } from "./hud.ts";
import { TOTAL, type ScreensView } from "./timeline.ts";
import { TOTAL_BUTTONS } from "./total.ts";

/** Ticks into the Total screen when the buttons work (the panel is in, the cursor's pulse about to start). */
export const BUTTONS_FROM = TOTAL.panel + TOTAL.panelSlide.length;
const PRESS = Button.Sword | Button.Item | Button.Action;

export class LocalResults {
  /** matchOver's tick at the press on "PRESS START", null before it. */
  pressed: number | null = null;
  /** Continue (0) or Quit (1). */
  cursor: 0 | 1 = 0;
  private last = 0;
  private readonly root: HTMLElement;
  private readonly buttons: [HTMLElement, HTMLElement];
  private placed = "";

  constructor(root: HTMLElement, rematch: HTMLElement, menu: HTMLElement) {
    this.root = root;
    this.buttons = [rematch, menu];
    this.buttons.forEach((b, i) => b.addEventListener("pointerenter", () => (this.cursor = i as 0 | 1)));
  }

  reset(): void {
    this.pressed = null;
    this.cursor = 0;
    this.last = 0;
    this.root.classList.remove("total");
  }

  /** At the match's end before the press: true once a key, button or tap has moved on. */
  press(game: GameState): void {
    const b = game.battle;
    if (b?.phase === "matchOver" && this.pressed === null && b.phaseTick >= 1) this.pressed = b.phaseTick;
  }

  /**
   * The local players' buttons this tick (what the sim gets): a new press of Sword, Item or Action is the press on
   * "PRESS START"; on the Total screen left / right move the cursor and those pick it. Returns the button picked.
   */
  buttonsDown(game: GameState, masks: readonly number[], view: ScreensView | null): "continue" | "quit" | null {
    const now = masks.reduce((a, m) => a | m, 0), fresh = now & ~this.last;
    this.last = now;
    if (!fresh || game.battle?.phase !== "matchOver") return null;
    if (this.pressed === null) {
      if (fresh & PRESS) this.press(game);
      return null;
    }
    if (!view?.total || view.total.s < BUTTONS_FROM) return null;
    if (fresh & Button.Left) this.cursor = 0;
    if (fresh & Button.Right) this.cursor = 1;
    return fresh & PRESS ? (this.cursor ? "quit" : "continue") : null;
  }

  /** Whether the Total screen's buttons are up (the moment #results shows over it). */
  buttonsUp(view: ScreensView): boolean {
    return !!view.total && view.total.leave === null && view.total.s >= BUTTONS_FROM;
  }

  /** Lays #results over the Total screen: its buttons on the J2D ones (`frame`: the TV frame, CSS px). */
  place(frame: { x: number; y: number; w: number; h: number }): void {
    this.root.classList.add("total");
    const key = `${frame.x},${frame.y},${frame.w},${frame.h}`;
    if (key === this.placed) return;
    this.placed = key;
    const sx = frame.w / HUD_W, sy = frame.h / HUD_H;
    [TOTAL_BUTTONS.continue, TOTAL_BUTTONS.quit].forEach((r, i) => {
      const s = this.buttons[i]!.style;
      s.setProperty("--x", `${frame.x + r.x * sx}px`);
      s.setProperty("--y", `${frame.y + r.y * sy}px`);
      s.setProperty("--w", `${r.w * sx}px`);
      s.setProperty("--h", `${r.h * sy}px`);
    });
  }
}
