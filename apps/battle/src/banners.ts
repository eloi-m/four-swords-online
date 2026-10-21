// Shadow Battle's own screens over the arena, as the game draws them (timeline.ts says when; docs/formats/j2d-and-bmg.md "Shadow
// Battle's round screens" says what), all J2D in the HUD's 608×448 space:
// - the intro: main2D kk_rival_01 "Be the last one standing!" (gold: black/white (0,0,0,0)/(255,210,0)) drawn 413×38
//   about (304, 225), and data.arc go.bti "Go!" ((80,40,40,0)/(255,80,80)) 256×128 about (328, 164), both scaled and
//   faded by the game's numbers (main.dol's Game draw 0x80136934);
// - the message window: main2D main_message_window.blo with a BMG message ("P{number 0} down!" 0x19B, "You got 10 Dark
//   World seconds!" 0xE8, "A giant bomb! Escape to your Game Boy Advance!" 0x1A9…; its black plate's alpha 0, the text
//   centered, as the game shows it), sliding in from the bottom, or from the top when a Link would be under it
//   (timeline.ts messageWindow, messageAtTop);
// - the result: main2D kk_1Pwin_01…kk_4Pwin_01 (gold (255,210,0) to red (212,34,0) corner colors) or kk_draw_01 (pink
//   (255,170,210) to blue (4,36,130)) at (179.5, 173), their own size (the message manager's draw 0x8043DB58); P5-P8 of
//   free play's battles, which have no texture, get "P5 WIN!" in the message font with the same colors;
// - main2D pressstart.blo 42 px higher than in its file, pulsing, at the match's end;
// - the time limit's last seconds: main2D kk_rupyNum_05…01 at 2× (96×96 at (268, 165)), yellow on olive;
// - black over the whole frame for the fades.
// The Total screen is total.ts. Presentation only: everything comes from screensView(state).
import { BATTLE_MESSAGE_IDS, bmgMessageById, findPane, type BloPane, type BloScreen, type BmgMessage, type BmgTag, type Rgba } from "@fso/formats";
import { ScreenView } from "@fso/render";
import * as THREE from "three";
import { HUD_H, HUD_W } from "./hud.ts";
import { MESSAGE_FONT, type ScreenFiles } from "./screen-files.ts";
import { pictureMaterial, pictureScreen, textMaterial, type PictureSpec, type TextSpec } from "./pictures.ts";
import { MESSAGE_PLACE, messageAtTop, type MessageView, type ScreensView } from "./timeline.ts";

/** Draw order in the HUD scene (the HUD's own screen is 0): these, then the Total screen, then the fades. */
export const ORDER = { ranks: 5, banners: 10, message: 11, press: 12, total: 20, pause: 25, fade: 30 } as const;

const GOLD: Rgba = [255, 210, 0, 255];
const RED: Rgba = [212, 34, 0, 255];
const PINK: Rgba = [255, 170, 210, 255];
const BLUE: Rgba = [4, 36, 130, 255];
const CLEAR: Rgba = [0, 0, 0, 0];
const BMG_DOWN = BATTLE_MESSAGE_IDS.down; // "P{number 0} down!"
/** "PRESS START": the game draws pressstart.blo this much higher than its file (frame dumps). */
export const PRESS_START_DY = -42;
const MESSAGE_TEXT_DX = -4, MESSAGE_TEXT_DY = -1;
/** The result banners' top left (the message manager's draw: J2DPicture::draw(179.5, 173)). */
const RESULT_AT = { x: 179.5, y: 173 };

export class BattleScreens {
  /** Add to the HUD's scene: everything here draws in its 608×448 space, over the HUD. */
  readonly group = new THREE.Group();
  readonly pictures: ScreenView;
  private readonly message: ScreenView | null;
  private readonly press: ScreenView | null;
  private readonly fade: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly panes = new Map<string, BloPane>();
  private readonly messageRoot: BloPane | null;
  private readonly pressRoot: BloPane | null;
  private readonly bmg: ScreenFiles["bmg"];
  /** Where each message shown went (keyed by its request: decided once, from the Links on its first tick seen). */
  private readonly places = new Map<string, boolean>();
  /** What is shown, to touch the views only on changes (the HUD's habit). */
  private readonly shown = new Map<string, string>();
  /** What the last update showed (tests). */
  last: ScreensView | null = null;

  constructor(files: ScreenFiles) {
    const main2D = files.assetsFor("main2D.arc");
    const template = files.screen("game2D.arc", "main_bat.blo");
    const box = files.screen("main2D.arc", "main_message_window.blo");
    const picture = template ? pictureMaterial(template) : null;
    if (!picture) throw new Error("no picture material to copy (game2D.arc scrn/main_bat.blo)");
    const specs: (PictureSpec | TextSpec)[] = [
      { tag: "rival", texture: "kk_rival_01.bti", x: 304, y: 225, width: 413, height: 38, white: GOLD },
      { tag: "go", texture: "go.bti", x: 328, y: 164, width: 256, height: 128, black: [80, 40, 40, 0], white: [255, 80, 80, 255] },
      ...[1, 2, 3, 4].map((n): PictureSpec => ({ tag: `win${n}`, texture: `kk_${n}Pwin_01.bti`, ...RESULT_AT, width: 249, height: 60, anchor: 0, colors: [GOLD, GOLD, RED, RED] })),
      { tag: "draw", texture: "kk_draw_01.bti", ...RESULT_AT, width: 221, height: 68, anchor: 0, colors: [PINK, PINK, BLUE, BLUE] },
      ...[1, 2, 3, 4, 5].map((n): PictureSpec => ({ tag: `digit${n}`, texture: `kk_rupyNum_0${n}.bti`, x: 268, y: 165, width: 96, height: 96, anchor: 0, black: [80, 80, 0, 255], white: [255, 255, 0, 255] })),
      // Free play's P5-P8: the banner's place and colors, the message font (a black copy 3 px down-right first).
      ...[5, 6, 7, 8].flatMap((n): TextSpec[] =>
        [3, 0].map((d) => ({
          kind: "text",
          tag: `win${n}${d ? "shadow" : ""}`,
          text: `P${n} WIN!`,
          x: 304 + d,
          y: 203 + d,
          width: 400,
          height: 60,
          fontWidth: 50,
          fontHeight: 50,
          top: d ? [0, 0, 0, 255] : GOLD,
          bottom: d ? [0, 0, 0, 255] : RED,
        })),
      ),
    ];
    const screen = pictureScreen(specs, { picture, text: box ? textMaterial(box) : null, font: MESSAGE_FONT });
    this.pictures = this.addView(screen, main2D, ORDER.banners);
    for (const pane of screen.root.children) {
      this.panes.set(pane.tag, pane);
      this.pictures.setPaneVisible(pane, false);
    }
    // The message window: without its black text plate, the text centered.
    this.bmg = files.bmg;
    if (box) {
      const plate = findPane(box, "Pmmtp");
      for (const tag of ["Tmmt01", "Tmmt02"]) {
        const tb = findPane(box, tag);
        if (tb?.kind !== "textbox") continue;
        tb.hBinding = 0;
        // The game's line sits 4 px left of our centering and 1 px up (frame dumps of "P2 down!").
        tb.x += MESSAGE_TEXT_DX;
        tb.y += MESSAGE_TEXT_DY;
      }
      this.message = this.addView(box, main2D, ORDER.message);
      if (plate) this.message.setPaneAlpha(plate, 0);
      this.messageRoot = box.root;
      this.message.object.visible = false;
    } else [this.message, this.messageRoot] = [null, null];
    const press = files.screen("main2D.arc", "pressstart.blo");
    if (press) {
      this.press = this.addView(press, main2D, ORDER.press);
      this.pressRoot = press.root;
      this.press.setPanePosition(press.root, press.root.x, press.root.y + PRESS_START_DY);
      this.press.object.visible = false;
    } else [this.press, this.pressRoot] = [null, null];
    this.fade = blackQuad();
    this.fade.renderOrder = ORDER.fade;
    const fades = new THREE.Group();
    fades.renderOrder = ORDER.fade;
    fades.add(this.fade);
    this.group.add(fades);
  }

  /**
   * Draws `view`. `links`: where the Links on the TV stand on the 608×448 screen (ArenaView.screenLinks), for the side
   * the message window comes in from.
   */
  update(view: ScreensView, links?: { points: readonly ({ x: number; y: number } | null)[]; px16: number }): void {
    this.last = view;
    const intro = view.intro;
    this.picture("rival", intro?.rival ?? null);
    this.picture("go", intro?.go ?? null);
    for (const n of [1, 2, 3, 4]) this.picture(`win${n}`, view.result === n - 1 ? {} : null);
    this.picture("draw", view.result === -1 ? {} : null);
    for (const n of [5, 6, 7, 8]) for (const tag of [`win${n}`, `win${n}shadow`]) this.picture(tag, view.result === n - 1 ? {} : null);
    for (const n of [1, 2, 3, 4, 5]) this.picture(`digit${n}`, view.digit === n ? {} : null);
    this.showMessage(view.message, links);
    if (this.press && this.set("press", String(view.press))) {
      this.press.object.visible = view.press > 0;
      for (const pane of this.pressPanes()) this.press.setPaneAlpha(pane, 255 * view.press);
    }
    if (this.set("fade", String(view.fade))) {
      this.fade.visible = view.fade > 0;
      this.fade.material.opacity = view.fade;
    }
  }

  /**
   * Tags of the pictures shown (tests): "rival", "go", "win1"…"win8", "draw", "digit1"…, "message:P2 down!" (its text on
   * one line), "message-top" when it's at the top, "press".
   */
  visible(): string[] {
    const tags = [...this.panes.values()].filter((p) => this.shown.get(p.tag) && this.shown.get(p.tag) !== "").map((p) => p.tag).filter((t) => !t.endsWith("shadow"));
    const message = this.shown.get("message");
    if (message) {
      const [text, , top] = message.split("|");
      tags.push(`message:${text}`);
      if (top === "top") tags.push("message-top");
    }
    if (this.press?.object.visible) tags.push("press");
    return tags;
  }

  dispose(): void {
    this.pictures.dispose();
    this.message?.dispose();
    this.press?.dispose();
    this.fade.geometry.dispose();
    this.fade.material.dispose();
  }

  private addView(screen: BloScreen, assets: ReturnType<ScreenFiles["assetsFor"]>, order: number): ScreenView {
    const view = new ScreenView(screen, assets);
    view.object.renderOrder = order;
    this.group.add(view.object);
    return view;
  }

  /** Shows a picture at a scale (about its anchor) and alpha, or hides it (null). */
  private picture(tag: string, state: { scale?: number; alpha?: number } | null): void {
    const pane = this.panes.get(tag);
    if (!pane) return;
    const key = state ? `${state.scale ?? 1}|${state.alpha ?? 255}` : "";
    if (!this.set(tag, key)) return;
    this.pictures.setPaneVisible(pane, !!state);
    if (!state) return;
    const scale = state.scale ?? 1;
    this.pictures.setPaneTransform(pane, { scaleX: scale, scaleY: scale });
    this.pictures.setPaneAlpha(pane, state.alpha ?? 255);
  }

  private showMessage(m: MessageView | null, links?: { points: readonly ({ x: number; y: number } | null)[]; px16: number }): void {
    const message = this.message, root = this.messageRoot;
    if (!message || !root) return;
    const bmg = m && this.bmg ? bmgMessageById(this.bmg, m.id) : undefined;
    const text = m ? (bmg ? messageLine(bmg, m.player) : m.id === BMG_DOWN ? `P${m.player + 1} down!` : "") : "";
    // Top or bottom: decided as it's placed (the Links where they stand then; first seen, for a page joining late).
    const key = m ? `${m.id}:${m.player}:${m.tick}` : "";
    if (!m) this.places.clear(); // (nothing up: the next one is placed anew)
    else if (!this.places.has(key)) this.places.set(key, !!links && messageAtTop(links.points, links.px16));
    const top = !!m && this.places.get(key)!;
    if (!this.set("message", m && text ? `${text}|${m.offset}|${top ? "top" : "bottom"}` : "")) return;
    message.object.visible = !!m && !!text;
    if (!m || !text) return;
    if (this.shown.get("messageText") !== key) {
      this.shown.set("messageText", key);
      const insert = (tag: BmgTag) => (tag.group === 3 ? String(m.player + 1) : undefined);
      for (const tag of ["Tmmt01", "Tmmt02"]) message.setText(tag, bmg ?? text, { insert, colors: tag === "Tmmt01" });
    }
    // At the top its frame's top is 13 px down (MESSAGE_PLACE); it slides in from beyond the edge it's at.
    const y = top ? MESSAGE_PLACE.top - MESSAGE_PLACE.bottom - m.offset : m.offset;
    message.setPanePosition(root, root.x, root.y + y);
  }

  private pressPanes(): BloPane[] {
    const root = this.pressRoot;
    return root ? root.children.flatMap(function all(p: BloPane): BloPane[] {
      return [p, ...p.children.flatMap(all)];
    }) : [];
  }

  private set(key: string, value: string): boolean {
    if (this.shown.get(key) === value) return false;
    this.shown.set(key, value);
    return true;
  }
}

/** Black over the whole 608×448 frame (in the J2D screen's y-up camera space: screenCamera). */
export function blackQuad(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(HUD_W, HUD_H), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
  mesh.position.set(HUD_W / 2, -HUD_H / 2, 0);
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

/** A message's text on one line, {number 0} as the player's number (tests and the window's change detection). */
function messageLine(message: BmgMessage, player: number): string {
  return message.parts
    .map((p) => (p.kind === "text" ? p.text : p.group === 3 && p.type === 0 ? String(player + 1) : ""))
    .join("")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}
