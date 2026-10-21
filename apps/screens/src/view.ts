// three.js canvas for one J2D screen: background, the screen's ScreenView, a selection outline and pane picking.
import { walkPanes, type BloPane, type BloScreen } from "@fso/formats";
import { paneOrigin, pixelRatio, ScreenView, type ScreenAssets } from "@fso/render";
import * as THREE from "three";

export type Background = "checker" | "screen" | "black" | "gray" | "none";

const BACKGROUND_FRAGMENT = /* glsl */ `
  uniform int uMode;
  uniform vec3 uColor;
  void main() {
    vec3 c = uColor;
    if (uMode == 0) {
      vec2 cell = floor(gl_FragCoord.xy / 12.0);
      c = mod(cell.x + cell.y, 2.0) < 1.0 ? vec3(0.42) : vec3(0.58);
    }
    gl_FragColor = vec4(c, 1.0);
  }
`;

export class ScreenCanvas {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera();
  private readonly canvas: HTMLCanvasElement;
  private readonly background: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private outline: THREE.LineLoop | null = null;
  private view: ScreenView | null = null;
  private screen: BloScreen | null = null;
  private zoom: number | "fit" = "fit";
  private dirty = true;
  onPick: (pane: BloPane | null) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(pixelRatio());
    this.renderer.setClearColor(0x14161a);
    this.background = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        vertexShader: "void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: BACKGROUND_FRAGMENT,
        uniforms: { uMode: { value: 0 }, uColor: { value: new THREE.Color(0, 0, 0) } },
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.background.renderOrder = -1;
    this.scene.add(this.background);
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener("click", (e) => this.onPick(this.pick(e.clientX, e.clientY)));
    const loop = () => {
      if (this.dirty) this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  show(screen: BloScreen, assets: ScreenAssets): ScreenView {
    if (this.view) {
      this.scene.remove(this.view.object);
      this.view.dispose();
    }
    this.highlight(null);
    this.screen = screen;
    this.view = new ScreenView(screen, assets);
    this.scene.add(this.view.object);
    this.background.scale.set(screen.width, screen.height, 1);
    this.background.position.set(screen.width / 2, -screen.height / 2, 0);
    this.resize();
    return this.view;
  }

  setBackground(mode: Background): void {
    const u = this.background.material.uniforms;
    u.uMode!.value = mode === "checker" ? 0 : 1;
    this.background.visible = mode !== "none";
    const bg = this.screen?.background ?? [0, 0, 0, 0];
    const rgb = mode === "screen" ? bg.slice(0, 3).map((c) => c / 255) : mode === "gray" ? [0.5, 0.5, 0.5] : [0, 0, 0];
    (u.uColor!.value as THREE.Color).setRGB(rgb[0]!, rgb[1]!, rgb[2]!);
    this.invalidate();
  }

  setZoom(zoom: number | "fit"): void {
    this.zoom = zoom;
    this.resize();
  }

  invalidate(): void {
    this.dirty = true;
  }

  /** Outlines a pane's box (in its own transformed space). */
  highlight(pane: BloPane | null): void {
    if (this.outline) {
      this.scene.remove(this.outline);
      this.outline.geometry.dispose();
      this.outline = null;
    }
    const node = pane && this.view?.panes.get(pane);
    if (pane && node) {
      node.updateWorldMatrix(true, false);
      const [x0, y0] = paneOrigin(pane);
      const points = [
        [x0, y0],
        [x0 + pane.width, y0],
        [x0 + pane.width, y0 + pane.height],
        [x0, y0 + pane.height],
      ].map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(node.matrixWorld));
      this.outline = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: 0xff3df2, depthTest: false }),
      );
      this.outline.renderOrder = 1e6;
      this.scene.add(this.outline);
    }
    this.invalidate();
  }

  /** Topmost drawn pane (picture, window or text box) under a client position. */
  pick(clientX: number, clientY: number): BloPane | null {
    if (!this.view || !this.screen) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector3(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1, 0);
    const world = ndc.unproject(this.camera);
    const shown = (pane: BloPane): boolean => {
      for (let n: THREE.Object3D | null = this.view!.panes.get(pane) ?? null; n; n = n.parent) if (!n.visible) return false;
      return true;
    };
    const panes = [...walkPanes(this.screen.root)].map((p) => p.pane).reverse();
    for (const pane of panes) {
      if (pane.kind === "pane" || !shown(pane)) continue;
      const node = this.view.panes.get(pane)!;
      node.updateWorldMatrix(true, false);
      const local = world.clone().applyMatrix4(node.matrixWorld.clone().invert());
      const [x0, y0] = paneOrigin(pane);
      if (local.x >= x0 && local.x <= x0 + pane.width && local.y >= y0 && local.y <= y0 + pane.height) return pane;
    }
    return null;
  }

  /** Renders the screen alone at 1:1 (current background, no outline) and returns it as a PNG data URL. */
  capture(): string {
    const sw = this.screen?.width ?? 608, sh = this.screen?.height ?? 448;
    const target = new THREE.WebGLRenderTarget(sw, sh);
    const camera = new THREE.OrthographicCamera(0, sw, 0, -sh, -10, 10);
    const outline = this.outline;
    if (outline) outline.visible = false;
    const clear = this.renderer.getClearAlpha();
    if (!this.background.visible) this.renderer.setClearAlpha(0);
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, camera);
    this.renderer.setClearAlpha(clear);
    const pixels = new Uint8Array(sw * sh * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, sw, sh, pixels);
    this.renderer.setRenderTarget(null);
    target.dispose();
    if (outline) outline.visible = true;
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d")!;
    const image = ctx.createImageData(sw, sh);
    for (let y = 0; y < sh; y++) image.data.set(pixels.subarray((sh - 1 - y) * sw * 4, (sh - y) * sw * 4), y * sw * 4);
    ctx.putImageData(image, 0, 0);
    this.invalidate();
    return canvas.toDataURL("image/png");
  }

  private resize(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    const sw = this.screen?.width ?? 608, sh = this.screen?.height ?? 448;
    const zoom = this.zoom === "fit" ? Math.min(w / sw, h / sh) * 0.96 : this.zoom;
    const cx = sw / 2, cy = -sh / 2;
    Object.assign(this.camera, { left: cx - w / zoom / 2, right: cx + w / zoom / 2, top: cy + h / zoom / 2, bottom: cy - h / zoom / 2, near: -10, far: 10 });
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  private draw(): void {
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
  }
}
