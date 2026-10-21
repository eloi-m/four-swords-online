// The menu's Controls dialog: every action's keys for each keyboard layout (a layout is a player slot: P1 and P2 when
// keyboards come first), and the gamepad buttons (the same for every pad; the left stick always moves). Click a cell
// and press the new key or button to replace it, "+" to add one; Backspace clears, Esc (or the cell again) cancels. A
// key does one thing: taking it elsewhere removes it from where it was. Saved in localStorage (@fso/input
// loadBindings / saveBindings). Then the on-screen controls: shown on touch screens, always or never, their size and
// opacity, vibration (TouchControls settings, saved for every page).
import {
  ACTION_NAMES,
  ACTIONS,
  copyBindings,
  DEFAULT_BINDINGS,
  DEFAULT_TOUCH_SETTINGS,
  keyLabel,
  padLabel,
  saveBindings,
  TOUCH_OPACITY,
  TOUCH_SIZE,
  type Bindings,
  type InputAction,
  type LocalInput,
  type TouchMode,
  type TouchSettings,
} from "@fso/input";
import { TouchControls } from "@fso/input/touch";
import "./controls.css";

/** Keys the pages use themselves (menus, zoom, mute, netplay stats), not for playing. */
const RESERVED = new Set(["Escape", "Enter", "Tab", "KeyV", "KeyM", "Backquote", "F5", "F11", "F12"]);

type Target = { column: number; action: InputAction; add: boolean };

export class ControlsDialog {
  private readonly input: LocalInput;
  private readonly touch: TouchControls | null;
  private readonly changed: () => void;
  private readonly root: HTMLElement;
  private readonly table: HTMLTableSectionElement;
  private readonly hint: HTMLElement;
  private readonly touchForm: HTMLElement;
  private draft: Bindings;
  private touchDraft: TouchSettings;
  private waiting: Target | null = null;
  private padBaseline = new Set<string>();
  private frame = 0;

  /** `changed` runs after new bindings are saved and applied. */
  constructor(input: LocalInput, changed: () => void, touch: TouchControls | null = null) {
    this.input = input;
    this.touch = touch;
    this.changed = changed;
    this.draft = copyBindings(input.bindings);
    this.touchDraft = touch?.settings ?? { ...DEFAULT_TOUCH_SETTINGS };
    const range = (id: string, { min, max }: { min: number; max: number }) => `<input id="${id}" type="range" min="${min}" max="${max}" step="0.05" />`;
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div id="controls-dialog" class="screen overlay" hidden>
        <div class="controls-panel frame">
          <h2 class="frame-title controls-title">Controls</h2>
          <section class="controls-keys">
            <h3 class="controls-sub">Keyboards and gamepads</h3>
            <p class="note">Click a key to change it, then press the new key or gamepad button (<kbd>+</kbd> adds one more).
            <kbd>Backspace</kbd> clears, <kbd>Esc</kbd> cancels. Keyboard 1 and 2 are P1 and P2 (after the gamepads with
            "Gamepads first"); online you play with keyboard 1, the first gamepad or the on-screen controls.</p>
            <table class="bindings">
              <thead><tr><th></th><th>Keyboard 1</th><th>Keyboard 2</th><th>Gamepads</th></tr></thead>
              <tbody></tbody>
            </table>
            <p id="controls-hint" class="note">&nbsp;</p>
          </section>
          <section class="controls-touch" id="controls-touch">
            <h3 class="controls-sub">On-screen controls</h3>
            <p class="note">A stick and the Sword, Item and Action buttons, for P1 (online: your Link), and a pause button.</p>
            <div class="touch-modes" role="radiogroup" aria-label="Show the on-screen controls">
              <label><input type="radio" name="touch-mode" value="auto" /> On touch screens</label>
              <label><input type="radio" name="touch-mode" value="on" /> Always</label>
              <label><input type="radio" name="touch-mode" value="off" /> Never</label>
            </div>
            <div class="touch-sliders">
              <label>Size ${range("touch-size", TOUCH_SIZE)}</label>
              <label>Opacity ${range("touch-opacity", TOUCH_OPACITY)}</label>
              <label class="check" id="touch-haptics-row"><input id="touch-haptics" type="checkbox" /> Vibrate on presses</label>
            </div>
          </section>
          <div class="buttons">
            <button id="controls-defaults">Defaults</button>
            <button id="controls-cancel">Cancel</button>
            <button id="controls-done" class="primary">Done</button>
          </div>
        </div>
      </div>`,
    );
    this.root = document.getElementById("controls-dialog")!;
    this.table = this.root.querySelector("tbody")!;
    this.hint = document.getElementById("controls-hint")!;
    this.touchForm = document.getElementById("controls-touch")!;
    this.touchForm.hidden = !touch;
    document.getElementById("touch-haptics-row")!.hidden = !TouchControls.canVibrate;
    this.touchForm.addEventListener("input", () => this.readTouch());
    this.touchForm.addEventListener("change", () => this.readTouch());
    document.getElementById("controls-defaults")!.addEventListener("click", () => {
      this.draft = copyBindings(DEFAULT_BINDINGS);
      this.touchDraft = { ...DEFAULT_TOUCH_SETTINGS };
      this.stopWaiting();
      this.draw();
    });
    document.getElementById("controls-cancel")!.addEventListener("click", () => this.close(false));
    document.getElementById("controls-done")!.addEventListener("click", () => this.close(true));
    this.table.addEventListener("click", (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>("[data-column]");
      if (!cell) return;
      const t = { column: Number(cell.dataset.column), action: cell.dataset.action as InputAction, add: cell.classList.contains("add") };
      const w = this.waiting;
      // Tapping the waiting cell again cancels (there's no Esc key on a phone).
      if (w && w.column === t.column && w.action === t.action && w.add === t.add) this.stopWaiting();
      else this.wait(t);
    });
    // While open, the dialog has the keyboard: nothing reaches the menu (Enter would start a match) or the game.
    window.addEventListener("keydown", (e) => this.key(e), { capture: true });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.draft = copyBindings(this.input.bindings);
    this.touchDraft = this.touch?.settings ?? { ...DEFAULT_TOUCH_SETTINGS };
    this.stopWaiting();
    this.draw();
    this.root.hidden = false;
  }

  close(save: boolean): void {
    this.stopWaiting();
    this.root.hidden = true;
    if (!save) return;
    saveBindings(this.draft);
    this.input.bindings = copyBindings(this.draft);
    if (this.touch) this.touch.settings = this.touchDraft;
    this.changed();
  }

  private key(e: KeyboardEvent): void {
    if (!this.isOpen) return;
    e.stopImmediatePropagation();
    if (e.repeat) return e.preventDefault();
    const t = this.waiting;
    if (!t) {
      if (e.code === "Escape") this.close(false);
      return; // Tab and Space keep working on the buttons
    }
    e.preventDefault();
    if (e.code === "Escape") return this.stopWaiting();
    if (t.column === 2) return; // waiting for a gamepad button
    if (e.code === "Backspace" || e.code === "Delete") return this.assign(t, null);
    if (RESERVED.has(e.code)) {
      this.hint.textContent = `${keyLabel(e.code)} is taken by the game's menus and shortcuts; pick another key.`;
      return;
    }
    this.assign(t, e.code);
  }

  private wait(t: Target): void {
    this.stopWaiting();
    this.waiting = t;
    const who = t.column === 2 ? "a button on a gamepad" : "a key";
    this.hint.textContent = `${ACTION_NAMES[t.action]}, ${t.column === 2 ? "gamepads" : `keyboard ${t.column + 1}`}: press ${who}… (Esc cancels${t.column === 2 ? "" : ", Backspace clears"})`;
    this.draw();
    if (t.column !== 2) return;
    // Gamepads have no events for buttons: poll, and take the first button that goes down.
    this.padBaseline = this.pressedButtons();
    const poll = () => {
      if (this.waiting !== t) return;
      const now = this.pressedButtons();
      for (const id of now) {
        if (this.padBaseline.has(id)) continue;
        return this.assign(t, Number(id.split(":")[1]));
      }
      this.padBaseline = new Set([...this.padBaseline].filter((id) => now.has(id)));
      this.frame = requestAnimationFrame(poll);
    };
    this.frame = requestAnimationFrame(poll);
  }

  private pressedButtons(): Set<string> {
    const out = new Set<string>();
    for (const pad of navigator.getGamepads?.() ?? []) pad?.buttons.forEach((b, i) => b.pressed && out.add(`${pad.index}:${i}`));
    return out;
  }

  private stopWaiting(): void {
    this.waiting = null;
    cancelAnimationFrame(this.frame);
    this.hint.innerHTML = "&nbsp;";
    if (this.isOpen) this.draw();
  }

  /** Binds `value` (a key code, a pad button, or null to clear) to the waiting cell. */
  private assign(t: Target, value: string | number | null): void {
    const d = this.draft;
    if (t.column === 2) {
      if (typeof value === "number") for (const a of ACTIONS) d.gamepad[a] = d.gamepad[a].filter((i) => i !== value);
      d.gamepad[t.action] = value === null ? [] : t.add ? [...d.gamepad[t.action], value as number] : [value as number];
    } else {
      if (typeof value === "string") for (const layout of d.keyboards) for (const a of ACTIONS) layout[a] = layout[a].filter((c) => c !== value);
      const layout = d.keyboards[t.column]!;
      layout[t.action] = value === null ? [] : t.add ? [...layout[t.action], value as string] : [value as string];
    }
    this.stopWaiting();
  }

  private readTouch(): void {
    const value = (id: string) => (document.getElementById(id) as HTMLInputElement);
    const mode = this.touchForm.querySelector<HTMLInputElement>('input[name="touch-mode"]:checked')?.value as TouchMode | undefined;
    this.touchDraft = {
      mode: mode ?? this.touchDraft.mode,
      size: Number(value("touch-size").value),
      opacity: Number(value("touch-opacity").value),
      haptics: value("touch-haptics").checked,
    };
  }

  private draw(): void {
    const d = this.draft, w = this.waiting;
    const cell = (column: number, action: InputAction, labels: string[]) => {
      const here = w !== null && w.column === column && w.action === action;
      const replacing = here && !w.add, adding = here && w.add;
      const keys = labels.length ? labels.map((l) => `<kbd>${escapeHtml(l)}</kbd>`).join(" ") : `<span class="none">none</span>`;
      return (
        `<td><button class="binding${replacing ? " waiting" : ""}" data-column="${column}" data-action="${action}">${replacing ? "press…" : keys}</button>` +
        `<button class="binding add${adding ? " waiting" : ""}" data-column="${column}" data-action="${action}" title="Add another">${adding ? "press…" : "+"}</button></td>`
      );
    };
    this.table.innerHTML = ACTIONS.map(
      (a) =>
        `<tr><th>${ACTION_NAMES[a]}</th>${d.keyboards.map((layout, k) => cell(k, a, layout[a].map(keyLabel))).join("")}` +
        `${cell(2, a, [...d.gamepad[a].map(padLabel), ...(ACTIONS.indexOf(a) < 4 ? ["stick"] : [])])}</tr>`,
    ).join("");
    const t = this.touchDraft;
    for (const radio of this.touchForm.querySelectorAll<HTMLInputElement>('input[name="touch-mode"]')) radio.checked = radio.value === t.mode;
    (document.getElementById("touch-size") as HTMLInputElement).value = String(t.size);
    (document.getElementById("touch-opacity") as HTMLInputElement).value = String(t.opacity);
    (document.getElementById("touch-haptics") as HTMLInputElement).checked = t.haptics;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
