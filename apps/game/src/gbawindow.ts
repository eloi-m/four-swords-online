// The GBA window: when playing alone with a controller, the game shows a GBA-screen area (a house, a cave) in a Game
// Boy Advance SP frame over the TV, main2D.arc's J2D screen scrn/main_gba_window.blo (Dolphin, Lake Hylia's house:
// the GBA's 240×160 picture at about 1.35× in the frame's black screen, pane Psp01). It grows open and shrinks shut
// about its middle (TODO(measure): the curve; a growth over ~16 frames was seen in frame dumps).
import { findPane, type BloPane, type BloScreen } from "@fso/formats";
import { paneMatrix, paneOrigin, screenCamera, ScreenView, type ScreenAssets } from "@fso/render";
import * as THREE from "three";

export const SCREEN_W = 608;
export const SCREEN_H = 448;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class GbaWindow {
  readonly scene = new THREE.Scene();
  readonly camera = screenCamera(SCREEN_W, SCREEN_H);
  readonly view: ScreenView;
  /** The GBA picture's place in the 608×448 frame, fully open. */
  readonly screen: Rect;
  private readonly holder = new THREE.Group();
  private readonly center: { x: number; y: number };

  constructor(blo: BloScreen, assets: ScreenAssets) {
    this.view = new ScreenView(blo, assets);
    this.holder.matrixAutoUpdate = false;
    this.holder.add(this.view.object);
    this.scene.add(this.holder);
    this.screen = paneRect(blo, "Psp01") ?? { x: 142, y: 138, w: 324, h: 216 };
    this.center = { x: this.screen.x + this.screen.w / 2, y: this.screen.y + this.screen.h / 2 };
    // "Z Close": the game's way back to the TV view, which isn't there.
    const close = findPane(blo, "Ndata02");
    if (close) this.view.setPaneVisible(close, false);
  }

  /** How open (0-1): the frame scaled about the picture's middle. Returns the picture's rect then. */
  open(k: number): Rect {
    const { x, y } = this.center;
    this.holder.matrix.makeTranslation(x, -y, 0).multiply(new THREE.Matrix4().makeScale(k, k, 1)).multiply(new THREE.Matrix4().makeTranslation(-x, y, 0));
    this.holder.matrixWorldNeedsUpdate = true;
    const s = this.screen;
    return { x: x - (s.w * k) / 2, y: y - (s.h * k) / 2, w: s.w * k, h: s.h * k };
  }
}

/** A pane's box in screen space (its parents' transforms applied; no rotation in this screen). */
function paneRect(blo: BloScreen, tag: string): Rect | null {
  const walk = (pane: BloPane, m: THREE.Matrix4): Rect | null => {
    const here = m.clone().multiply(paneMatrix(pane));
    if (pane.tag === tag) {
      const [x0, y0] = paneOrigin(pane);
      const a = new THREE.Vector3(x0, y0, 0).applyMatrix4(here), b = new THREE.Vector3(x0 + pane.width, y0 + pane.height, 0).applyMatrix4(here);
      return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    }
    for (const child of pane.children) {
      const found = walk(child, here);
      if (found) return found;
    }
    return null;
  };
  return walk(blo.root, new THREE.Matrix4());
}
