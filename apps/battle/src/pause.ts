// The pause screen as the game shows it in Shadow Battle (pause-state.ts has the timeline; docs/formats/j2d-and-bmg.md "The
// pause screen"): game2D.arc pause.blo over the dimmed arena (its Pblack), the plate with PAUSE and Continue / Choose
// an Area / Choose a Game (textures: continue.bti, kk_pCselect_01, kk_pGselect_01), the lit one in gold and the
// others in brown (the file's Continue and choices: TEV C0/C1), the cursor's two ken_4 sword pairs flanking it; then
// for a choice, main2D.arc warning_window.blo resized to the game's question box (308×196 round (305, 225)) with BMG
// 0x10B "Leave this area?" / 0x10C "Quit Shadow Battle?" and the answer cursor (its Pwcur pair) on Yes or No.
// The page's #pause buttons lie see-through on the items and the answers (pointer and touch, screen readers, tests),
// with one of the site's own: Controls (the game has no remapping).
// Online (the match goes on: no freeze), the same plate is the match menu (online.ts): Continue, then the room's
// choices written in the message font in the items' colors, over the lobby's own buttons.
import { BATTLE_MESSAGE_IDS, bmgMessageById, findPane, type BloPane, type BloScreen, type BloTextBox, type BmgMessage, type Rgba } from "@fso/formats";
import { ScreenView } from "@fso/render";
import * as THREE from "three";
import { blackQuad, ORDER } from "./banners.ts";
import { HUD_H, HUD_W } from "./hud.ts";
import { PAUSE_ITEMS, PauseState, type PauseInput, type PauseItem, type PauseOutcome, type PauseView } from "./pause-state.ts";
import { MESSAGE_FONT, type ScreenFiles } from "./screen-files.ts";

/** The lit item's colors and the others' (pause.blo's Continue and its choices). */
const LIT: [Rgba, Rgba] = [[39, 16, 0, 0], [255, 237, 160, 255]];
const UNLIT: [Rgba, Rgba] = [[0, 0, 0, 0], [167, 76, 42, 255]];
/** The plate's place (pause.blo Ndata01) and the items' row under it (Ndata02's). */
const PLATE = { x: 305, y: 215 };
const ITEMS_Y = 22;
/** The swords sit this far out of an item's half width (left; the right pair 1 px nearer), 1 px below its middle. */
const SWORD_GAP = 35;
/** The question's box (the warning window resized: its outer frame), centered on the file's place (305, 225). */
export const CONFIRM_BOX = { w: 308, h: 196 };
const CONFIRM_AT = { x: 305, y: 225 };
/** The answer cursor's middle on Yes and on No, from the box's middle (frame dumps). */
const ANSWER_AT = [{ x: -35, y: 23 }, { x: 39, y: 23 }] as const;
/** The answer cursor's box (its two Pwcur squares, unturned and stretched over the word: Dolphin's light box). */
const ANSWER_SIZE = [{ w: 52, h: 33 }, { w: 40, h: 33 }] as const;
const BMG_LEAVE = BATTLE_MESSAGE_IDS.pause.leavePrompt, BMG_QUIT = BATTLE_MESSAGE_IDS.pause.quitPrompt;

interface Item {
  pane: BloPane;
  /** Its material (null for a text item: colored through its top and bottom colors). */
  material: number | null;
  y: number;
  width: number;
}

export interface PauseOptions {
  /** Online: the room's choices in place of the area and game items (null: not offered), and no freeze. */
  online?: { area: string | null; game: string };
}

export class PauseScreen {
  readonly group = new THREE.Group();
  /** The state, while the pause is up (null otherwise). */
  state: PauseState | null = null;
  /** What the last draw showed (tests). */
  last: PauseView | null = null;
  private readonly plate: ScreenView;
  private readonly confirm: ScreenView;
  private readonly screen: BloScreen;
  private readonly root: BloPane;
  private readonly dim: BloPane | null;
  private readonly items: Item[];
  private readonly swords: [BloPane | null, BloPane | null];
  private readonly confirmRoot: BloPane;
  private readonly cursors: BloPane[];
  private readonly fade = blackQuad();
  private readonly dom: HTMLElement | null;
  private readonly buttons: Record<"continue" | "area" | "game" | "yes" | "no", HTMLButtonElement | null>;
  private readonly shown = new Map<string, string>();
  private readonly offered: boolean[];
  private readonly questionTexts: Record<"area" | "game", BmgMessage | string>;
  /** Online: the lobby's buttons act themselves (and own their container); the choices don't ask. */
  private readonly online: boolean;
  private placed = "";

  constructor(files: ScreenFiles, dom: HTMLElement | null, options: PauseOptions = {}) {
    const screen = files.screen("game2D.arc", "pause.blo");
    const warning = files.screen("main2D.arc", "warning_window.blo");
    if (!screen || !warning) throw new Error("no game2D.arc scrn/pause.blo or main2D.arc scrn/warning_window.blo");
    this.screen = screen;
    const pane = (tag: string) => findPane(screen, tag);
    const texts = options.online ? onlineTexts(screen, warning, options.online) : null;
    this.plate = new ScreenView(screen, files.assetsFor("game2D.arc"));
    this.plate.object.renderOrder = ORDER.pause;
    this.root = pane("Ndata01")!;
    this.dim = pane("Pblack");
    // (kk_black is all 0, which the file's TEV turns into C0, clear: the game's dim is black at the pane's alpha.)
    if (this.dim?.kind === "picture") this.colors(this.plate, this.dim.material, [[0, 0, 0, 255], [0, 0, 0, 255]]);
    const item = (tag: string): Item => {
      const p = pane(tag)!;
      return { pane: p, material: p.kind === "picture" ? p.material : null, y: p.y, width: p.width };
    };
    this.items = [item("Pcntn01"), item(texts?.[0] ?? "Psc01"), item(texts?.[1] ?? "Psg01")];
    this.offered = [true, !options.online || options.online.area !== null, true];
    if (texts) for (const tag of ["Psc01", "Psg01"]) this.plate.setPaneVisible(pane(tag)!, false);
    this.swords = [pane("Pkenc01"), pane("Pkenc02")];
    // The swords' colors are set at runtime (the file's are clear): the texture as it is.
    for (const s of this.swords) if (s?.kind === "picture") this.colors(this.plate, s.material, [[0, 0, 0, 0], [255, 255, 255, 255]]);
    // The question: the warning window at the size the game gives it, the text centered.
    resizeWindow(warning, CONFIRM_BOX.w, CONFIRM_BOX.h);
    this.confirm = new ScreenView(warning, files.assetsFor("main2D.arc"));
    this.confirm.object.renderOrder = ORDER.pause + 1;
    this.confirmRoot = findPane(warning, "Ndata01")!;
    this.cursors = ["Pwcur01", "Pwcur02"].map((t) => findPane(warning, t)!).filter((p) => !!p);
    for (const c of this.cursors) if (c.kind === "picture") this.colors(this.confirm, c.material, [[255, 255, 255, 255], [255, 255, 255, 255]]);
    if (options.online) this.confirm.object.visible = false;
    this.questionTexts = files.bmg
      ? { area: bmgMessageById(files.bmg, BMG_LEAVE) ?? "Leave this area?", game: bmgMessageById(files.bmg, BMG_QUIT) ?? "Quit Shadow Battle?" }
      : { area: "Leave this area?\n\n  Yes      No", game: "Quit Shadow Battle?\n\n  Yes      No" };
    this.fade.renderOrder = ORDER.pause + 2;
    const fades = new THREE.Group();
    fades.renderOrder = ORDER.pause + 2;
    fades.add(this.fade);
    this.group.add(this.plate.object, this.confirm.object, fades);
    this.group.visible = false;
    this.dom = dom;
    this.online = !!options.online;
    const button = (id: string) => (dom?.querySelector<HTMLButtonElement>(`[data-pause="${id}"]`) ?? null);
    this.buttons = { continue: button("continue"), area: button("area"), game: button("game"), yes: button("yes"), no: button("no") };
    for (const [i, it] of PAUSE_ITEMS.entries()) {
      const b = this.buttons[it];
      if (!this.online) b?.addEventListener("click", () => this.state?.pick(it));
      b?.addEventListener("pointerenter", () => this.state?.interactive && this.state.phase === "menu" && this.offered[i] && this.cursorTo(i));
    }
    this.buttons.yes?.addEventListener("click", () => this.state?.reply(true));
    this.buttons.no?.addEventListener("click", () => this.state?.reply(false));
    this.buttons.yes?.addEventListener("pointerenter", () => this.state?.phase === "confirm" && (this.state.answer = 0));
    this.buttons.no?.addEventListener("pointerenter", () => this.state?.phase === "confirm" && (this.state.answer = 1));
  }

  get active(): boolean {
    return this.state !== null;
  }

  /** Online: whether the area item (the host's "End the match") is offered, and the two choices' words. */
  offer(area: boolean, texts?: { area: string; game: string }): void {
    this.offered[1] = area;
    if (!texts) return;
    [texts.area, texts.game].forEach((text, i) => {
      const it = this.items[i + 1]!;
      if (it.pane.kind === "textbox" && it.pane.text !== text && this.set(`text${i}`, text)) {
        it.pane.text = text;
        this.plate.setText(it.pane, text);
        this.shown.delete("cursor");
      }
    });
  }

  /** Opens the pause (Esc, Start, the on-screen pause button); again while it is up: Continue. */
  toggle(): void {
    if (this.state) this.state.resume();
    else this.state = new PauseState();
  }

  /** Closes it at once (the match ended, the page left it). */
  reset(): void {
    this.state = null;
    this.draw();
  }

  /**
   * One 60 Hz tick with this tick's fresh presses. Returns what the pause ended with, on the tick it is over (then the
   * pause is gone).
   */
  step(input: PauseInput): PauseOutcome | null {
    const s = this.state;
    if (!s) return null;
    // Online the room's choices act at once (the lobby's buttons: the match goes on, nothing to ask).
    if (this.online && s.phase === "menu" && input.a && s.cursor > 0) {
      this.state = null;
      return PAUSE_ITEMS[s.cursor]!;
    }
    // A cursor that would land on an item not offered (online, a guest) skips it.
    const before = s.cursor;
    const outcome = s.step(input);
    if (s.cursor !== before && !this.offered[s.cursor]) s.move(s.cursor > before ? 1 : -1);
    if (!this.offered[s.cursor]) s.cursor = before;
    if (outcome) this.state = null;
    return outcome;
  }

  /** Draws the state (or hides everything). */
  draw(): void {
    const s = this.state;
    const view = s ? s.view() : null;
    this.last = view;
    const on = !!view;
    if (this.set("on", String(on))) {
      this.group.visible = on;
      if (this.dom && !this.online) this.dom.hidden = !on;
    }
    if (!view) return;
    if (this.dim && this.set("dim", String(view.dim))) this.plate.setPaneAlpha(this.dim, view.dim);
    const plate = view.plate;
    if (this.set("plate", String(plate))) {
      this.plate.setPaneVisible(this.root, plate !== null);
      if (plate !== null) this.plate.setPanePosition(this.root, PLATE.x, PLATE.y + plate);
    }
    if (this.set("cursor", `${view.cursor}|${view.bounce}`)) {
      this.items.forEach((it, i) => {
        const colors = i === view.cursor ? LIT : UNLIT;
        if (it.material !== null) this.colors(this.plate, it.material, colors);
        else if (it.pane.kind === "textbox") this.textColor(it.pane, colors[1]);
      });
      const it = this.items[view.cursor]!, y = it.y + 1 + view.bounce;
      const [left, right] = this.swords;
      if (left) this.plate.setPanePosition(left, -(it.width / 2 + SWORD_GAP), y);
      if (right) this.plate.setPanePosition(right, it.width / 2 + SWORD_GAP - 1, y);
    }
    const confirm = view.confirm;
    if (this.set("confirm", `${confirm}|${view.question}`)) {
      this.confirm.object.visible = confirm !== null;
      if (confirm !== null) this.confirm.setPanePosition(this.confirmRoot, CONFIRM_AT.x, CONFIRM_AT.y + confirm);
      if (view.question && this.set("question", view.question)) this.confirm.setText("Twt01", this.questionTexts[view.question] ?? "", { optionSpaces: 0 });
    }
    if (confirm !== null && this.set("answer", String(view.answer))) {
      const at = ANSWER_AT[view.answer], size = ANSWER_SIZE[view.answer];
      for (const c of this.cursors) this.confirm.setPaneTransform(c, { x: at.x, y: at.y, rotateZ: 0, scaleX: size.w / c.width, scaleY: size.h / c.height });
    }
    if (this.set("fade", String(view.fade))) {
      this.fade.visible = view.fade > 0;
      this.fade.material.opacity = view.fade;
    }
    this.syncDom(view);
  }

  /** Lays the see-through buttons over the items and the answers (`frame`: the TV frame, CSS px). */
  place(frame: { x: number; y: number; w: number; h: number }): void {
    if (!this.dom || !this.state) return;
    const key = `${frame.x},${frame.y},${frame.w},${frame.h}`;
    if (key === this.placed) return;
    this.placed = key;
    const k = frame.w / HUD_W;
    const put = (b: HTMLElement | null, x: number, y: number, w: number, h: number) => {
      if (!b) return;
      b.style.setProperty("--x", `${frame.x + (x - w / 2) * k}px`);
      b.style.setProperty("--y", `${frame.y + (y - h / 2) * (frame.h / HUD_H)}px`);
      b.style.setProperty("--w", `${w * k}px`);
      b.style.setProperty("--h", `${h * (frame.h / HUD_H)}px`);
    };
    PAUSE_ITEMS.forEach((id, i) => {
      const it = this.items[i]!;
      put(this.buttons[id], PLATE.x, PLATE.y + ITEMS_Y + it.y, Math.max(it.width, 150) + 40, 34);
    });
    ANSWER_AT.forEach((at, i) => put(this.buttons[i ? "no" : "yes"], CONFIRM_AT.x + at.x, CONFIRM_AT.y + at.y, ANSWER_SIZE[i]!.w + 20, ANSWER_SIZE[i]!.h + 12));
    this.dom.style.setProperty("--frame-right", `${frame.x + frame.w}px`);
    this.dom.style.setProperty("--frame-bottom", `${frame.y + frame.h}px`);
  }

  dispose(): void {
    this.plate.dispose();
    this.confirm.dispose();
    this.fade.geometry.dispose();
    this.fade.material.dispose();
  }

  private cursorTo(i: number): void {
    const s = this.state!;
    if (s.cursor !== i) s.move(i - s.cursor);
  }

  /** Which buttons take pointers now (the plate's while it is in, the answers while the question is up). */
  private syncDom(view: PauseView): void {
    const s = this.state!;
    // (taking pointers from the start: a tap before the plate has landed picks the same item)
    const menu = s.phase === "menu" || s.phase === "opening" || s.phase === "returning";
    const key = `${menu}|${s.phase === "confirm"}|${view.cursor}|${view.answer}`;
    if (!this.set("dom", key)) return;
    PAUSE_ITEMS.forEach((id, i) => {
      const b = this.buttons[id];
      if (!b) return;
      b.hidden = !menu || !this.offered[i];
      b.classList.toggle("lit", i === view.cursor);
    });
    for (const [id, answer] of [["yes", 0], ["no", 1]] as const) {
      const b = this.buttons[id];
      if (!b) continue;
      b.hidden = s.phase !== "confirm";
      b.classList.toggle("lit", view.answer === answer);
    }
  }

  private colors(view: ScreenView, material: number, [c0, c1]: [Rgba, Rgba]): void {
    view.setMaterialTevColor(material, 0, c0);
    view.setMaterialTevColor(material, 1, c1);
  }

  /** A text item's color: its glyphs' gradient (both ends). */
  private textColor(pane: BloPane, color: Rgba): void {
    if (pane.kind !== "textbox") return;
    pane.topColor = color;
    pane.bottomColor = color;
    this.plate.setText(pane, pane.text);
  }

  private set(key: string, value: string): boolean {
    if (this.shown.get(key) === value) return false;
    this.shown.set(key, value);
    return true;
  }
}

/**
 * Online, the area and game items become text boxes in the message font (the room's choices: "End the match",
 * "Leave the match"), at the items' places; returns their tags. They are added to the screen before its view is
 * built, the plate's other text-free panes as they are.
 */
function onlineTexts(screen: BloScreen, warning: BloScreen, online: { area: string | null; game: string }): [string, string] {
  const items = findPane(screen, "Ndata02")!;
  const font = screen.fonts.length;
  screen.fonts.push({ type: 2, name: MESSAGE_FONT });
  // The warning window's text material (2 stages: lerp(C0, C1, glyph) × the glyphs' colors), white on clear.
  const source = findPane(warning, "Twt01");
  const template = source?.kind === "textbox" ? warning.materials[source.material] : undefined;
  const tags: [string, string] = ["Tonline1", "Tonline2"];
  if (!template) return tags;
  [online.area ?? "", online.game].forEach((text, i) => {
    const at = findPane(screen, i === 0 ? "Psc01" : "Psg01")!;
    const m = structuredClone(template);
    m.name = `mat_${tags[i]}`;
    m.font = font;
    m.tevColors = [[0, 0, 0, 0], [255, 255, 255, 255], ...m.tevColors.slice(2)];
    screen.materials.push(m);
    const bytes = new TextEncoder().encode(text);
    const box: BloTextBox = {
      block: "TBX2",
      kind: "textbox",
      tag: tags[i]!,
      id: 1000 + i,
      userTag: 0n,
      visible: true,
      anchor: 4,
      x: at.x,
      y: at.y,
      width: 260,
      height: 28,
      scaleX: 1,
      scaleY: 1,
      rotateX: 0,
      rotateY: 0,
      rotateZ: 0,
      children: [],
      materialId: 1000 + i,
      material: screen.materials.length - 1,
      charSpace: 0,
      lineSpace: 20,
      fontWidth: 20,
      fontHeight: 20,
      hBinding: 0,
      vBinding: 0,
      topColor: UNLIT[1],
      bottomColor: UNLIT[1],
      maxLength: bytes.length,
      textBytes: bytes,
      text,
    };
    items.children.push(box);
  });
  return tags;
}

/**
 * Resizes main2D's warning window (its outer frame Pwbb05 and parchment Pwb05, each with four 16 px border pictures
 * as children: right, left, bottom, top) to an outer box of `w` × `h` round its anchor, keeping the file's margins,
 * and fits the text box inside.
 */
function resizeWindow(screen: BloScreen, w: number, h: number): void {
  const outer = findPane(screen, "Pwbb05"), inner = findPane(screen, "Pwb05"), text = findPane(screen, "Twt01");
  if (!outer || !inner) return;
  const fit = (p: BloPane, pw: number, ph: number) => {
    p.width = pw;
    p.height = ph;
    p.x = -pw / 2;
    p.y = -ph / 2;
    for (const b of p.children) {
      if (b.width === 16 && b.x > 0) [b.x, b.height] = [pw, ph]; // right
      else if (b.width === 16) b.height = ph; // left
      else if (b.y > 0) [b.y, b.width] = [ph, pw + 32]; // bottom
      else b.width = pw + 32; // top
    }
  };
  const [mx, my] = [(outer.width - inner.width) / 2, (outer.height - inner.height) / 2];
  fit(outer, w - 32, h - 32);
  fit(inner, w - 32 - 2 * mx, h - 32 - 2 * my);
  if (text?.kind === "textbox") {
    text.width = inner.width;
    text.height = inner.height;
    text.hBinding = 0;
    text.vBinding = 0;
  }
}
