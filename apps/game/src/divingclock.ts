// The clock in a side view's water (sim waterclock.ts): main2D.arc's J2D screen scrn/main_diving.blo, the clock icon
// (Ptim01 over its shadow Ptim02, kk_timer_01) and two digits (Pt01, Pt02 over their shadows Ptk01, Ptk02,
// kk_rupyNum_0n), the seconds left shown from the first digit (Dolphin: "9" right of the clock). Drawn over the GBA
// picture where Dolphin's frames show it (Lake Hylia room 6's area 5 and Tingle's Tower room 3's passage alike: the
// clock's middle at about (279, 172) of the 608×448 frame); the file's own spot (Ndata00, 56 px lower) is moved by
// the game (not read).
import { findPane, type BloPane, type BloScreen } from "@fso/formats";
import { screenCamera, ScreenView, type ScreenAssets } from "@fso/render";
import * as THREE from "three";
import { SCREEN_H, SCREEN_W } from "./gbawindow.ts";

/** Where the file's clock is moved to (608×448 px; measured in Dolphin's frames). */
const SHIFT = { x: -4, y: -56 };

export class DivingClock {
  readonly scene = new THREE.Scene();
  readonly camera = screenCamera(SCREEN_W, SCREEN_H);
  private readonly view: ScreenView;
  private readonly digits: BloPane[][];
  private readonly texture = new Map<BloPane, string>();
  private readonly visible = new Map<BloPane, boolean>();
  /** The seconds shown (0: none), for tests. */
  shown = 0;

  constructor(screen: BloScreen, assets: ScreenAssets) {
    this.view = new ScreenView(screen, assets);
    const holder = new THREE.Group();
    holder.position.set(SHIFT.x, -SHIFT.y, 0);
    holder.add(this.view.object);
    this.scene.add(holder);
    const pane = (tag: string) => findPane(screen, tag);
    this.digits = [["Pt01", "Ptk01"], ["Pt02", "Ptk02"]].map((tags) => tags.map(pane).filter((p): p is BloPane => !!p));
  }

  /** Shows `seconds` (0: nothing to draw, false). */
  update(seconds: number): boolean {
    this.shown = seconds;
    if (seconds <= 0) return false;
    const text = String(seconds);
    this.digits.forEach((panes, i) => {
      const d = text[i];
      for (const p of panes) {
        this.setVisible(p, d !== undefined);
        if (d !== undefined) this.setTexture(p, `kk_rupyNum_0${d}.bti`);
      }
    });
    return true;
  }

  private setVisible(pane: BloPane, visible: boolean): void {
    if (this.visible.get(pane) === visible) return;
    this.visible.set(pane, visible);
    this.view.setPaneVisible(pane, visible);
  }

  private setTexture(pane: BloPane, name: string): void {
    if (this.texture.get(pane) === name) return;
    if (!this.view.setPaneTexture(pane, name)) console.warn(`diving clock texture ${name} not found`);
    this.texture.set(pane, name);
  }
}
