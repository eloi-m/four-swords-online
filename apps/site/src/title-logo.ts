// The home page's logo as the title screen draws it: title.arc's title.blo logo panes (the logo, and over it the
// indirect material whose bluish glint runs across the letters' bevels) with title.btk played once every 546 ticks,
// the first 128 ticks after it shows (Dolphin: the glint ran on frames 128, 680 and 1218 of the title screen, docs/
// measurements/screens.md "J2D screens in Dolphin"). Loaded lazily by home.ts once the static logo is up, so the page stays
// light: three.js and the J2D renderer come with this chunk. It draws in a canvas laid over the static logo, and only
// while the glint runs; without WebGL, the files or with reduced motion, the static logo stays.
import { decodeBti, decompressYaz0, isYaz0, parseBlo, parseBtiHeader, parseScreenAnimation, type RarcArchive } from "@fso/formats";
import { ScreenAnimator, ScreenView, type ScreenAssets } from "@fso/render";
import * as THREE from "three";

/** The logo's box in title.blo (Ptlogo01 / Ptlogo02: 440×264 at (85, 51)). */
const BOX = { x: 85, y: 51, w: 440, h: 264 };
const LOGO = /^Ptlogo0[12]$/;
export const GLINT = { first: 128, every: 546, frames: 60 } as const;
const TICK_MS = 1000 / 60;

export interface LogoState {
  /** "canvas" once the live logo is up, "image" when it fell back to the static one. */
  mode: "canvas" | "image" | "loading";
  glints: number;
  frame: number;
}

/** Lays the live logo over `img` (inside `slot`); resolves to whether it did. */
export async function liveLogo(slot: HTMLElement, img: HTMLImageElement, title: RarcArchive, state: LogoState): Promise<boolean> {
  const file = (path: string) => {
    const f = title.files.find((x) => x.path.toLowerCase() === path.toLowerCase());
    return f ? (isYaz0(f.data) ? decompressYaz0(f.data) : f.data) : null;
  };
  const blo = file("scrn/title.blo"), btk = file("scrn/title.btk");
  if (!blo || !btk) return false;
  const screen = parseBlo(blo);
  const assets: ScreenAssets = {
    texture(name) {
      const bytes = file(`timg/${name}`);
      return bytes ? { image: decodeBti(bytes), header: parseBtiHeader(bytes) } : null;
    },
  };
  const canvas = document.createElement("canvas");
  canvas.className = "logo-canvas";
  canvas.setAttribute("aria-hidden", "true");
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, premultipliedAlpha: true });
  } catch {
    return false;
  }
  renderer.setClearColor(0x000000, 0);
  const view = new ScreenView(screen, assets);
  for (const pane of screen.root.children) if (!LOGO.test(pane.tag)) view.setPaneVisible(pane, false);
  const scene = new THREE.Scene();
  scene.add(view.object);
  // The logo's box of the 608×448 screen (the view flips y).
  const camera = new THREE.OrthographicCamera(BOX.x, BOX.x + BOX.w, -BOX.y, -(BOX.y + BOX.h), -1, 1);
  const animator = new ScreenAnimator(view);
  const glint = animator.add(parseScreenAnimation(btk, "title.btk"), { playing: false });
  const draw = (frame: number) => {
    glint.seek(frame);
    animator.apply();
    const w = img.clientWidth, h = img.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
    }
    renderer.render(scene, camera);
    state.frame = frame;
  };
  slot.append(canvas);
  draw(0);
  slot.classList.add("live");
  state.mode = "canvas";
  window.addEventListener("resize", () => draw(state.frame));
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  // The glint's schedule on a 60 Hz count of real time; between glints nothing is drawn.
  const start = performance.now();
  const next = (n: number) => start + (GLINT.first + n * GLINT.every) * TICK_MS;
  const run = (n: number) => {
    const t0 = next(n);
    const frame = (now: number) => {
      const f = Math.floor((now - t0) / TICK_MS);
      if (f >= GLINT.frames) {
        draw(0);
        state.glints = n + 1;
        window.setTimeout(() => run(n + 1), Math.max(0, next(n + 1) - performance.now() - 50));
        return;
      }
      if (f >= 0 && f !== state.frame) draw(f);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };
  window.setTimeout(() => run(0), Math.max(0, next(0) - performance.now() - 50));
  return true;
}
