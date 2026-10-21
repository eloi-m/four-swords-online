// The on-screen controls: a DOM overlay above the game's canvas for touch screens. A thumb stick on the left, Sword,
// Item and Action on the right, a pause button at the top (touch.css). Pointer Events with touch-action: none, every
// finger tracked by pointer id (TouchPad, touch.ts), placed by layoutControls (touch-layout.ts) beside the TV frame or
// over it. A ButtonSource: attach it to the player it drives (LocalInput.attach). It shows while the page says a match
// is on screen (`show`) and the settings allow it: "auto" = on touch screens, i.e. (pointer: coarse) or once a finger
// has touched the page. The #touch=on|off|auto deep link overrides the saved mode for the page.
import "./touch.css";
import type { ButtonSource } from "./buttons.ts";
import { TOUCH_BUTTONS, TouchPad, type TouchButton } from "./touch.ts";
import { layoutControls, type ControlsLayout, type Insets, type Rect } from "./touch-layout.ts";
import { loadTouchSettings, saveTouchSettings, TOUCH_MODES, type TouchMode, type TouchSettings } from "./touch-settings.ts";

const HAPTIC_MS = 12;

export interface TouchControlsOptions {
  /** The overlay goes right after this element: under the page's later screens and dialogs, which then cover it. */
  after: Element;
  /** What the pause button does (what Esc does); no pause button without it. */
  pause?: () => void;
}

export class TouchControls implements ButtonSource {
  readonly label = "On-screen controls";
  readonly pad = new TouchPad();
  readonly root: HTMLElement;
  /** The current placement (for tests). */
  layout: ControlsLayout | null = null;
  private readonly stickZone: HTMLElement;
  private readonly buttonZone: HTMLElement;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly buttonEls = new Map<TouchButton, HTMLElement>();
  private readonly pauseEl: HTMLButtonElement;
  private readonly probe: HTMLElement;
  private readonly coarse: MediaQueryList | null;
  private settingsValue: TouchSettings = loadTouchSettings();
  private modeOverride: TouchMode | null;
  private wanted = false;
  private padWanted = true;
  private sawTouch = false;
  private frame: Rect | null = null;
  private placed = "";
  private insetsCache: Insets | null = null;

  constructor(options: TouchControlsOptions) {
    const mode = new URLSearchParams(location.hash.slice(1)).get("touch") as TouchMode | null;
    this.modeOverride = mode && TOUCH_MODES.includes(mode) ? mode : null;
    this.coarse = typeof matchMedia === "function" ? matchMedia("(pointer: coarse)") : null;
    const root = (this.root = document.createElement("div"));
    root.className = "fso-touch";
    root.hidden = true;
    root.innerHTML =
      `<div class="fso-touch-zone" data-zone="stick"></div><div class="fso-touch-zone" data-zone="buttons"></div>` +
      `<div class="fso-touch-base"><div class="fso-touch-knob"></div></div>` +
      TOUCH_BUTTONS.map((b) => `<div class="fso-touch-button" data-action="${b}">${b}</div>`).join("") +
      `<button class="fso-touch-pause" aria-label="Pause" title="Pause (Esc)"></button><div class="fso-touch-insets"></div>`;
    options.after.insertAdjacentElement("afterend", root);
    const $ = (selector: string) => root.querySelector<HTMLElement>(selector)!;
    this.stickZone = $('[data-zone="stick"]');
    this.buttonZone = $('[data-zone="buttons"]');
    this.base = $(".fso-touch-base");
    this.knob = $(".fso-touch-knob");
    for (const b of TOUCH_BUTTONS) this.buttonEls.set(b, $(`[data-action="${b}"]`));
    this.pauseEl = $(".fso-touch-pause") as HTMLButtonElement;
    this.probe = $(".fso-touch-insets");

    this.zone(this.stickZone, (id, x, y) => (this.pad.stickDown(id, x, y), 0));
    this.zone(this.buttonZone, (id, x, y) => this.pad.buttonDown(id, x, y));
    const pause = options.pause;
    this.pauseEl.hidden = !pause;
    this.pauseEl.addEventListener("click", () => {
      this.pauseEl.blur();
      pause?.();
    });
    // "auto" shows the controls once a finger touches the page (a touch laptop, a tablet with a trackpad).
    window.addEventListener(
      "pointerdown",
      (e) => {
        if (e.pointerType !== "touch" || this.sawTouch) return;
        this.sawTouch = true;
        this.update();
      },
      { capture: true },
    );
    this.coarse?.addEventListener?.("change", () => this.update());
    const release = () => {
      this.pad.reset();
      this.draw();
    };
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", () => document.hidden && release());
    window.addEventListener("resize", () => {
      this.insetsCache = null;
      this.place(this.frame ?? undefined);
    });
    this.update();
  }

  get settings(): TouchSettings {
    return { ...this.settingsValue };
  }

  /** New settings: saved, and applied at once (they also end a #touch= override). */
  set settings(s: TouchSettings) {
    this.settingsValue = { ...s };
    this.modeOverride = null;
    saveTouchSettings(this.settingsValue);
    this.update();
  }

  /** The mode in effect: the saved one, or the page's #touch= override. */
  get mode(): TouchMode {
    return this.modeOverride ?? this.settingsValue.mode;
  }

  /** Whether the controls are in use on this device (shown whenever a match is on screen). */
  get active(): boolean {
    const mode = this.mode;
    return mode === "on" || (mode === "auto" && (this.sawTouch || this.coarse?.matches === true));
  }

  /** Whether the overlay is on screen now. */
  get visible(): boolean {
    return this.wanted && this.active;
  }

  /** Whether this browser can vibrate on presses (Android's Chrome and Firefox; not iOS). */
  static get canVibrate(): boolean {
    return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  }

  /** The page's call: whether a match is on screen. `pad: false` keeps only the pause button (a spectator). */
  show(on: boolean, pad = true): void {
    if (on === this.wanted && pad === this.padWanted) return;
    this.wanted = on;
    this.padWanted = pad;
    this.update();
  }

  sample(): number {
    return this.visible && this.padWanted ? this.pad.sample() : (this.pad.sample(), 0);
  }

  /**
   * Places the controls around the TV `frame` (CSS px in the window; the whole window if not letterboxed). Cheap when
   * nothing moved: call it every frame, as the HUD's place().
   */
  place(frame?: Rect): void {
    this.frame = frame ?? null;
    const f = frame ?? { x: 0, y: 0, w: innerWidth, h: innerHeight };
    if (!this.visible) return;
    const insets = (this.insetsCache ??= this.insets());
    const size = this.settingsValue.size;
    const key = [innerWidth, innerHeight, f.x, f.y, f.w, f.h, insets.top, insets.right, insets.bottom, insets.left, size].map((v) => Math.round(v)).join();
    if (key === this.placed) return;
    this.placed = key;
    const layout = (this.layout = layoutControls({ w: innerWidth, h: innerHeight }, f, insets, size));
    this.root.dataset.placement = layout.placement;
    const box = (el: HTMLElement, r: Rect) => Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    box(this.stickZone, layout.stickZone);
    box(this.buttonZone, layout.buttonZone);
    box(this.pauseEl, layout.pause);
    const s = layout.stick;
    Object.assign(this.base.style, { width: `${2 * s.r}px`, height: `${2 * s.r}px` });
    for (const b of layout.buttons) {
      const el = this.buttonEls.get(b.action)!;
      box(el, { x: b.x - b.r, y: b.y - b.r, w: 2 * b.r, h: 2 * b.r });
      el.style.fontSize = `${Math.round(b.r * 0.42)}px`;
    }
    this.pad.stickBase = s;
    this.pad.buttons = layout.buttons;
    this.draw();
  }

  private update(): void {
    const visible = this.visible;
    this.root.hidden = !visible;
    for (const el of [this.stickZone, this.buttonZone, this.base, ...this.buttonEls.values()]) el.hidden = !this.padWanted;
    this.root.style.setProperty("--fso-touch-opacity", String(this.settingsValue.opacity));
    if (!visible || !this.padWanted) this.pad.reset();
    this.placed = "";
    if (visible) this.place(this.frame ?? undefined);
    this.draw();
  }

  /** Wires a zone's pointers into the pad: `down` returns the buttons newly pressed (for haptics). */
  private zone(el: HTMLElement, down: (id: number, x: number, y: number) => number): void {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (e.pointerType === "touch") this.sawTouch = true;
      try {
        el.setPointerCapture(e.pointerId); // (implicit for touch; a mouse needs it to get its pointerup)
      } catch {}
      this.buzz(down(e.pointerId, e.clientX, e.clientY));
      this.draw();
    });
    el.addEventListener("pointermove", (e) => {
      if (!this.pad.touching) return;
      this.buzz(this.pad.move(e.pointerId, e.clientX, e.clientY));
      this.draw();
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
      el.addEventListener(type, (e) => {
        this.pad.up(e.pointerId);
        this.draw();
      });
    }
    // No scrolling, zooming, text selection or long-press menus from the controls (iOS Safari needs the touch events).
    el.addEventListener("touchstart", (e) => e.cancelable && e.preventDefault(), { passive: false });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private buzz(pressed: number): void {
    if (!pressed || !this.settingsValue.haptics || !TouchControls.canVibrate) return;
    // Chrome refuses (with a console warning) before the page's first tap.
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    navigator.vibrate(HAPTIC_MS);
  }

  private draw(): void {
    const pad = this.pad, s = pad.stick, rest = pad.stickBase;
    const x = s ? s.ox : rest.x, y = s ? s.oy : rest.y, off = pad.stickOffset;
    this.base.style.transform = `translate(${x - rest.r}px, ${y - rest.r}px)`;
    this.base.classList.toggle("active", s !== null);
    this.knob.style.transform = `translate(${off.x}px, ${off.y}px)`;
    for (const [action, el] of this.buttonEls) el.classList.toggle("pressed", pad.isPressed(action));
  }

  /** The safe-area insets (env(safe-area-inset-*), non-zero with viewport-fit=cover on notched phones). */
  private insets(): Insets {
    const style = getComputedStyle(this.probe);
    const px = (v: string) => parseFloat(v) || 0;
    return { top: px(style.paddingTop), right: px(style.paddingRight), bottom: px(style.paddingBottom), left: px(style.paddingLeft) };
  }
}
