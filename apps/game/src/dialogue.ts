// A sign's or a person's message on the TV (the sim's AdventureState.talk, @fso/sim/adventure dialogue.ts): main2D.arc's
// message boxes, hukidashi.blo (the speech balloon), hukidashi_wood.blo and hukidashi_stone.blo (the signs' boards),
// at the screens' own layout (Dolphin, Lake Hylia room 3's sign: the board centered at the bottom, its text box Tm01
// over the shadow copy Tm02, the P1 badge at its right once the page is typed). The page types one character a tick
// (bmgPageSlice); the arrow (P1ar) shows on a typed page with another after it (TODO(measure)). It only reads the state.
import { bmgMessageById, bmgPages, bmgPageSlice, findPane, type BloPane, type BloScreen, type Bmg } from "@fso/formats";
import { screenCamera, ScreenView, type ScreenAssets } from "@fso/render";
import { pageTyped, talkTyped, type AdventureStage, type TalkStyle } from "@fso/sim/adventure";
import type { AdventureGame } from "@fso/sim/adventure";
import * as THREE from "three";

export const BOX_W = 608;
export const BOX_H = 448;
/** The screen of each style, in main2D.arc's scrn/. */
export const BOX_SCREENS: Readonly<Record<TalkStyle, string>> = { balloon: "hukidashi.blo", wood: "hukidashi_wood.blo", stone: "hukidashi_stone.blo" };
/** The other players' badges (Ndata02-04) and the fifth one, never shown when playing alone. */
const OTHER_BADGES = ["Ndata02", "Ndata03", "Ndata04", "Ndata05"];

interface Box {
  view: ScreenView;
  scene: THREE.Scene;
  badge: BloPane | null;
  arrow: BloPane | null;
}

export class DialogueBox {
  readonly camera = screenCamera(BOX_W, BOX_H);
  private readonly boxes = new Map<TalkStyle, Box>();
  private readonly bmg: Bmg;
  private shownKey = "";
  /** What's on show (for tests): the style, message, page and the characters typed, or null. */
  shown: { style: TalkStyle; message: number; page: number; typed: number; done: boolean } | null = null;

  constructor(screens: Partial<Record<TalkStyle, BloScreen>>, assets: ScreenAssets, bmg: Bmg) {
    this.bmg = bmg;
    for (const [style, screen] of Object.entries(screens) as [TalkStyle, BloScreen][]) {
      const view = new ScreenView(screen, assets);
      const scene = new THREE.Scene();
      scene.add(view.object);
      for (const tag of OTHER_BADGES) {
        const pane = findPane(screen, tag);
        if (pane) view.setPaneVisible(pane, false);
      }
      this.boxes.set(style, { view, scene, badge: findPane(screen, "P1b02") ?? null, arrow: findPane(screen, "P1ar") ?? null });
    }
  }

  /** The scene to draw over the TV this frame, or null when no message shows. */
  update(game: AdventureGame, stage: AdventureStage): { scene: THREE.Scene; camera: THREE.OrthographicCamera } | null {
    const t = game.adventure.talk, typed = t ? talkTyped(t) : 0;
    const box = t && typed > 0 ? this.boxes.get(t.style) : undefined;
    const message = t ? bmgMessageById(this.bmg, t.message) : undefined;
    if (!t || !box || !message) {
      this.shown = null;
      return null;
    }
    const pages = bmgPages(message), page = pages[Math.min(t.page, pages.length - 1)] ?? [];
    const done = pageTyped(t, stage);
    this.shown = { style: t.style, message: t.message, page: t.page, typed, done };
    const key = `${t.style}:${t.message}:${t.page}:${typed}:${done}`;
    if (key !== this.shownKey) {
      this.shownKey = key;
      const parts = bmgPageSlice(page, typed);
      // The shadow copy first (drawn under), without the colors; then the text.
      box.view.setText("Tm02", parts, { colors: false });
      box.view.setText("Tm01", parts);
      if (box.badge) box.view.setPaneVisible(box.badge, done);
      if (box.arrow) box.view.setPaneVisible(box.arrow, done && t.page < pages.length - 1);
    }
    return { scene: box.scene, camera: this.camera };
  }
}
