// The title screen's sky behind the home page, as the game draws it (main.dol: the title's loader 0x803A59E0, its draw
// 0x803A44D8, the environment manager's clouds and lightning 0x8016D398; docs/formats/j3d.md "The title screen's sky"):
// title.arc's six J3D quads (100×100 in their XZ plane) laid in the screen's 608×448 frame, each ×7 about (300, 250),
// at depths −513 … −993, far to near: the night sky's gradient (w_kumo5), far clouds (w_kumo4), the castle in the
// clouds (w_kumo3), two cloud banks (w_kumo2, w_kumo1) and a veil of mist (w_kumo), through an identity view and the
// 2D screen's orthographic projection. Their .btk scroll the clouds by the frame count; their .brk light them up when
// lightning strikes (`Lightning`: two kinds of strike at random times, each lighting its layers for 60 frames), and
// each strike is a JPA bolt (data.arc's particle.jpc: 648 near, 647 far, ×7) drawn after the clouds, behind the
// nearer ones. Loaded lazily by home.ts after the logo (the bolts once data.arc is in too); drawn in a canvas inside
// the page's fixed sky, over the static art, at 60 Hz while the page shows (reduced motion: one still frame). Without
// WebGL or the files, the static sky stays.
import { loadJ3dResource, parseJpac, type FsaParticlePlacement, type J3dResource, type RarcArchive } from "@fso/formats";
import { J3dModel, JpaEffects, type JpaEffectSpec } from "@fso/render";
import * as THREE from "three";

/** The models far to near (the game's list runs near to far, w_kumo first, 96 deeper each). */
export const SKY_MODELS = ["w_kumo5", "w_kumo4", "w_kumo3", "w_kumo2", "w_kumo1", "w_kumo"] as const;
const depthOf = (i: number) => -513 - 96 * (SKY_MODELS.length - 1 - i);
/** The quads' place: ×7 about (300, 250) of the screen, their XZ plane turned to face it (model z → screen y). */
const SCALE = 7, CENTER = { x: 300, y: 250 };
/** The screen the title is laid out in. */
export const SKY_W = 608, SKY_H = 448;
/** The page's sky art sits at "center 35%" (home.css): the live sky is fitted the same way. */
const ALIGN_Y = 0.35;
const TICK_MS = 1000 / 60;
/** Most ticks one frame catches up on (a slow frame); past that the clock is moved on instead. */
const MAX_CATCH_UP = 8;
/** The canvas's pixels: CSS px × at most 1 device px (the clouds are soft textures stretched 7×), long side ≤ 1600. */
const MAX_DPR = 1, MAX_SIDE = 1600;

export const STRIKE = {
  /** A strike lights its layers this many frames: the .brk's frame is 100 × the frames left / 60 (lit 24, fading 36). */
  frames: 60,
  /** The near strikes (effect 648) come every 0-309 frames, the far ones (647) every 0-179. */
  nearEvery: 310,
  farEvery: 180,
  near: 648,
  far: 647,
  /** Strikes under way at most (the game's four slots). */
  slots: 4,
  /** A bolt's place: the screen's (304, 224) + the strike's offset, at this depth (near: in front of the castle). */
  origin: { x: 304, y: 224 },
  depth: { 648: -657, 647: -849 } as Record<number, number>,
  /** The bolts' scale (the emitter's dynamics and particle scales, set every frame). */
  scale: 7,
} as const;

export interface Strike {
  /** The JPA effect (648 near, 647 far; 0 for a slot never used). */
  id: number;
  /** Frames left (60 when it strikes). */
  timer: number;
  /** Where, from the screen's (304, 224). */
  x: number;
  y: number;
  /** The frame it struck on. */
  start: number;
}

/**
 * The title's lightning, frame by frame as main.dol's 0x8016D398 runs it: two countdowns, each striking into the first
 * free one of four slots when it runs out and drawing its next wait (0-309 frames near, 0-179 far), with the game's
 * random generator (x × 0x19660D + 0x3C6EF35F, the top 23 bits as a float). `step` gives the frame the cloud layers'
 * .brk show: near strikes light the castle and the cloud banks (w_kumo1-3) and the far clouds, far strikes only the
 * far clouds (w_kumo4). Checked against Dolphin's RAM on the title (the slots, the waits, the .brk frames).
 */
export class Lightning {
  near: number;
  far: number;
  seed: number;
  readonly slots: Strike[] = Array.from({ length: STRIKE.slots }, () => ({ id: 0, timer: 0, x: 0, y: 0, start: 0 }));

  constructor(seed: number, near?: number, far?: number) {
    this.seed = seed >>> 0;
    // (the countdowns at the title's start aren't known: the first strikes come within the usual waits)
    this.near = near ?? Math.trunc(STRIKE.nearEvery * this.random());
    this.far = far ?? Math.trunc(STRIKE.farEvery * this.random());
  }

  /** The game's generator: a float in [0, 1). */
  random(): number {
    this.seed = (Math.imul(this.seed, 0x19660d) + 0x3c6ef35f) >>> 0;
    return (this.seed >>> 9) / 0x800000;
  }

  /** Frame `tick`: strikes when a countdown runs out; the .brk frames of the near-lit layers and of the far clouds. */
  step(tick: number): { near: number; far: number } {
    if (this.near > 0) this.near--;
    else {
      this.near = Math.trunc(STRIKE.nearEvery * this.random());
      const slot = this.slots.find((s) => s.timer === 0);
      if (slot) {
        const y = 48 * this.random() + 96;
        const x = 300 * this.random() - 150;
        Object.assign(slot, { id: STRIKE.near, timer: STRIKE.frames, x, y, start: tick });
      }
    }
    if (this.far > 0) this.far--;
    else {
      this.far = Math.trunc(STRIKE.farEvery * this.random());
      const slot = this.slots.find((s) => s.timer === 0);
      if (slot) {
        const y = 64 * this.random() - 64;
        const sign = this.random() > 0.5 ? -1 : 1;
        const x = (72 * this.random() + 48) * sign;
        Object.assign(slot, { id: STRIKE.far, timer: STRIKE.frames, x, y, start: tick });
      }
    }
    let near = 0, far = 0;
    for (const s of this.slots) {
      if (s.id === STRIKE.near) near = Math.max(near, s.timer);
      else if (s.id === STRIKE.far) far = Math.max(far, s.timer);
      if (s.timer > 0) s.timer--;
    }
    return { near: brkFrame(near), far: brkFrame(Math.max(near, far)) };
  }

  /** The strikes whose bolts may still show (the emitters end by themselves, well within the slot's 60 frames). */
  live(): Strike[] {
    return this.slots.filter((s) => s.id && s.timer > 0);
  }
}

/** A .brk (100 frames) frame for a strike's frames left: 100 as it strikes, 0 once it's over (integer, as the game). */
export function brkFrame(timer: number): number {
  return Math.trunc((timer * 100) / STRIKE.frames);
}

/** What the screen's frame shows of the sky in a `width` × `height` canvas: the 608×448 frame fitted to cover it. */
export function skyView(width: number, height: number): { left: number; right: number; top: number; bottom: number } {
  const s = Math.max(width / SKY_W, height / SKY_H);
  const w = width / s, h = height / s;
  const left = (SKY_W - w) / 2, top = (SKY_H - h) * ALIGN_Y;
  return { left, right: left + w, top, bottom: top + h };
}

/** A strike's bolt as createEffect and the environment manager place it (group 0's YZ swap; ×7; its depth). */
export function boltPlacement(s: Pick<Strike, "id" | "x" | "y">): FsaParticlePlacement {
  const k = STRIKE.scale;
  return {
    id: s.id,
    group: 0,
    translation: [STRIKE.origin.x + s.x, STRIKE.origin.y + s.y, STRIKE.depth[s.id] ?? 0],
    rotation: "swapYZ",
    dynamicsScale: [k, k, k],
    particleScale: [k, k],
    queued: false,
  };
}

export interface SkyState {
  /** "canvas" once the live sky is up, "image" when the static one stays. */
  mode: "canvas" | "image" | "loading";
  /** Frames drawn so far (the clouds' clock). */
  tick: number;
  /** Strikes so far. */
  strikes: number;
  /** The .brk frames last shown (near, far). */
  flash: [number, number];
  /** The bolts' particles are loaded (data.arc). */
  bolts: boolean;
}

/** The identity view (column-major) the title draws its models and particles through. */
const IDENTITY = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** The six models placed far to near, and the bolts. Scene: x right, y up (= −screen y), z toward the viewer. */
class Sky {
  readonly scene = new THREE.Scene();
  readonly models: J3dModel[];
  bolts: JpaEffects | null = null;

  constructor(resources: J3dResource[]) {
    this.models = resources.map((r, i) => {
      const model = new J3dModel(r.bmd, { btk: r.btk, brk: r.brk });
      // Base matrix [1 0 0 300 | 0 0 1 250 | 0 1 0 z] × scale 7 (the models' J3D base, read in RAM on the title), y up.
      model.object.matrix.set(SCALE, 0, 0, CENTER.x, 0, 0, -SCALE, -CENTER.y, 0, SCALE, 0, depthOf(i), 0, 0, 0, 1);
      model.object.matrixWorldNeedsUpdate = true;
      // Far to near: the opaque sky first (three.js draws opaque meshes first anyway), then the clouds back to front.
      model.setRenderOrder(i * 10);
      this.scene.add(model.object);
      return model;
    });
  }

  /** Particles from particle.jpc: drawn after every model (the game's order), depth-tested against them. */
  addBolts(jpcBytes: Uint8Array): void {
    this.bolts = new JpaEffects(parseJpac(jpcBytes), { zBase: 0, zScale: 1 }, IDENTITY);
    this.scene.add(this.bolts.group);
  }

  /**
   * The sky at frame `tick` of its clock, the lightning's .brk frames and the strikes under way. The bolts step twice a
   * frame (their particle group 0 is stepped by the particle manager, 0x8013DC44, and again by the title's draw), once
   * on the frame they strike (made in the draw): on a clock of half frames.
   */
  update(tick: number, flash: { near: number; far: number }, strikes: readonly Strike[]): void {
    this.models.forEach((m, i) => m.update(tick, { brk: SKY_MODELS[i] === "w_kumo4" ? flash.far : flash.near }));
    this.bolts?.sync(2 * tick, strikes.map((s): JpaEffectSpec => ({ key: `strike:${s.start}:${s.id}:${s.x}`, start: 2 * s.start, placement: boltPlacement(s) })));
  }

  dispose(): void {
    for (const m of this.models) m.dispose();
    this.bolts?.dispose();
  }
}

/** The live sky (test hooks: window.fsoSky). */
export interface LiveSky {
  /** Adds the lightning's bolts from data.arc (resolves to whether it could). */
  addBolts(data: RarcArchive | null): boolean;
}

/** Lays the live sky into `sky` (the page's fixed backdrop) from title.arc; resolves to it, or null without it. */
export async function liveSky(sky: HTMLElement, title: RarcArchive, state: SkyState, seed = (Math.random() * 2 ** 32) >>> 0): Promise<LiveSky | null> {
  const resources = SKY_MODELS.map((stem) => loadJ3dResource(title, stem));
  if (resources.some((r) => !r)) return null;
  const canvas = document.createElement("canvas");
  canvas.className = "sky-canvas";
  canvas.setAttribute("aria-hidden", "true");
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "low-power" });
  } catch {
    return null;
  }
  renderer.setClearColor(0x000000, 1);
  const world = new Sky(resources as J3dResource[]);
  const camera = new THREE.OrthographicCamera(0, SKY_W, 0, -SKY_H, 0, 2000);
  const lightning = new Lightning(seed);
  let flash = { near: 0, far: 0 };
  let strikes: readonly Strike[] = [];
  // The canvas's size, read again only when the window changes (no layout read every frame).
  let size = "";
  const resize = () => {
    const w = sky.clientWidth || window.innerWidth, h = sky.clientHeight || window.innerHeight;
    const ratio = Math.min(MAX_DPR, window.devicePixelRatio || 1, MAX_SIDE / Math.max(w, h, 1));
    if (size === `${w}×${h}@${ratio}`) return;
    size = `${w}×${h}@${ratio}`;
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    const v = skyView(w, h);
    Object.assign(camera, { left: v.left, right: v.right, top: -v.top, bottom: -v.bottom });
    camera.updateProjectionMatrix();
  };
  const draw = () => {
    world.update(state.tick, flash, strikes);
    renderer.render(world.scene, camera);
    state.flash = [flash.near, flash.far];
  };
  const advance = () => {
    state.tick++;
    const before = lightning.slots.map((s) => s.start);
    flash = lightning.step(state.tick);
    state.strikes += lightning.slots.filter((s, i) => s.start !== before[i]).length;
    strikes = lightning.live();
  };
  sky.append(canvas);
  resize();
  draw();
  // (a frame later, so the fade from the static sky runs)
  requestAnimationFrame(() => sky.classList.add("live"));
  state.mode = "canvas";
  window.addEventListener("resize", () => {
    resize();
    draw();
  });
  let paused = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // The clouds' clock: 60 ticks a second of time the sky is seen (a hidden page's rAF stops; with a dialog over the
  // page, whose backdrop blurs what's behind it, it waits too); it goes on where it was.
  let anchor = performance.now();
  const frame = (now: number) => {
    if (paused) return;
    if (document.querySelector("dialog[open]")) {
      anchor = now - state.tick * TICK_MS;
      requestAnimationFrame(frame);
      return;
    }
    const due = Math.floor((now - anchor) / TICK_MS);
    if (due > state.tick) {
      const steps = due - state.tick;
      if (steps > MAX_CATCH_UP) anchor += (steps - MAX_CATCH_UP) * TICK_MS;
      for (let n = Math.min(steps, MAX_CATCH_UP); n > 0; n--) advance();
      draw();
    }
    requestAnimationFrame(frame);
  };
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) anchor = performance.now() - state.tick * TICK_MS;
  });
  requestAnimationFrame(frame);
  (window as unknown as { fsoSky?: unknown }).fsoSky = {
    /**
     * Stops the clock and shows the sky at `tick` with the .brk frames and strikes given (tests, comparisons with
     * Dolphin); returns the drawn pixels (RGBA rows, bottom first, base64).
     */
    show(tick: number, near = 0, far = near, options: { layers?: string[]; strikes?: Strike[] } = {}) {
      paused = true;
      state.tick = tick;
      flash = { near, far };
      strikes = options.strikes ?? [];
      world.models.forEach((m, i) => (m.object.visible = !options.layers || options.layers.includes(SKY_MODELS[i]!)));
      if (world.bolts) world.bolts.group.visible = !options.layers || options.layers.includes("bolts");
      draw();
      const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const pixels = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return { width: w, height: h, rgba: base64(pixels) };
    },
    resume() {
      for (const m of world.models) m.object.visible = true;
      if (world.bolts) world.bolts.group.visible = true;
      paused = false;
      anchor = performance.now() - state.tick * TICK_MS;
      requestAnimationFrame(frame);
    },
    /** CPU time of one draw (ms), averaged over `n` (perf checks). */
    time(n = 60) {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) draw();
      renderer.getContext().finish();
      return (performance.now() - t0) / n;
    },
  };
  return {
    addBolts(data) {
      const file = data?.files.find((f) => f.path === "particle.jpc");
      if (!file || world.bolts) return !!world.bolts;
      try {
        world.addBolts(file.data);
      } catch {
        return false;
      }
      state.bolts = true;
      return true;
    },
  };
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
