// three.js renderer for J2D "SCRNblo2" screens (packages/formats/src/j2d/blo.ts). Units are screen pixels in the
// screen's own space (608×448 for FSA): x right, y down; the root group flips y so a regular orthographic camera
// (screenCamera) shows it upright. Each pane becomes an Object3D carrying its local transform, so hiding a pane hides
// its subtree, as J2DPane::draw does. Drawables (picture quads, window parts, glyph quads) get a shader generated
// from their material's GX TEV setup, indirect stages included; the rasterized color is the pane's corner colors times
// the pane alpha (material color 0 alpha), since every FSA material takes its channel color from the vertices. Screen
// animations (screenanim.ts) drive panes and materials through the setPane* / setMaterial* methods.
import {
  type BfnFont,
  type BloMaterial,
  type BloPane,
  type BloScreen,
  type BloTexMatrix,
  type BloTextBox,
  type BloWindow,
  type BmgPart,
  type BtiHeader,
  type DecodedTexture,
  type PaneTransform,
  type Rgba,
} from "@fso/formats";
import * as THREE from "three";
import {
  contentParts,
  iconMaterial,
  layoutScreenText,
  partsNeedShiftJis,
  textBoxParts,
  type ScreenTextContent,
  type ScreenTextOptions,
  type TextGlyphQuad,
  type TextQuad,
} from "./screentext.ts";

export interface ScreenTexture {
  image: DecodedTexture;
  header?: BtiHeader; // wrap and filter modes; defaults: clamp, linear
}

export interface ScreenFont {
  font: BfnFont;
  sheets: DecodedTexture[];
}

export interface ScreenAssets {
  /** A texture named by the screen's TEX1 table (a file in the archive's timg/ folder). */
  texture(name: string): ScreenTexture | null;
  /**
   * A font named by FNT1; text boxes without a font are not drawn. `shiftJis` is set for text holding two-byte
   * Shift-JIS codes (the Japanese placeholder strings of many screens), which a viewer may show with a Japanese font.
   */
  font?(name: string, shiftJis: boolean): ScreenFont | null;
}

/** Orthographic camera showing the screen space [0, width] × [0, height]. */
export function screenCamera(width: number, height: number): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(0, width, 0, -height, -1, 1);
  camera.updateProjectionMatrix();
  return camera;
}

/** Scene graph of a screen. `object` holds one Object3D per pane (see `panes`) with the drawables beneath. */
export class ScreenView {
  readonly object = new THREE.Group();
  readonly panes = new Map<BloPane, THREE.Object3D>();
  /** Why a pane draws nothing or only in part (missing texture, font…), for the viewer's tree. */
  readonly notes = new Map<BloPane, string>();
  readonly screen: BloScreen;
  private readonly assets: ScreenAssets;
  private readonly textures = new Map<string, THREE.Texture | null>();
  private readonly fonts = new Map<string, { font: BfnFont; sheets: THREE.Texture[] } | null>();
  private readonly drawables = new Map<BloPane, THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[]>();
  /** The drawables of each material, for material animations (screenanim.ts). */
  private readonly byMaterial = new Map<BloMaterial, THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[]>();
  private readonly disposables: { dispose(): void }[] = [];
  private readonly textOrders = new Map<BloPane, number>();
  private order = 0;

  constructor(screen: BloScreen, assets: ScreenAssets) {
    this.screen = screen;
    this.assets = assets;
    // Panes only move through setPanePosition, so no matrix is recomputed per frame: the tree's world matrices are
    // computed on the first render and again below a moved pane (the HUD's 779 objects cost ~0.2 ms a frame otherwise).
    this.object.scale.y = -1;
    this.object.matrixAutoUpdate = false;
    this.object.updateMatrix();
    this.object.add(this.build(screen.root));
  }

  setPaneVisible(pane: BloPane, visible: boolean): void {
    const node = this.panes.get(pane);
    if (node) node.visible = visible;
  }

  /** Moves a pane's anchor point to (x, y) in its parent's space (children follow). */
  setPanePosition(pane: BloPane, x: number, y: number): void {
    const node = this.panes.get(pane);
    if (!node) return;
    node.matrix.copy(paneMatrix({ ...pane, x, y }));
    node.matrixWorldNeedsUpdate = true;
  }

  /** Pane alpha 0-255 (J2DPane::setAlpha); a file's initial value is its material's color 0 alpha. Not inherited. */
  setPaneAlpha(pane: BloPane, alpha: number): void {
    for (const mesh of this.drawables.get(pane) ?? []) mesh.material.uniforms.uAlpha!.value = alpha / 255;
  }

  /**
   * Replaces texture map `map` of a pane's own drawables with a texture looked up by file name, as the game does for
   * counters and item icons (e.g. main2D.arc timg/kk_rupynum_00-09.bti). Returns false if the texture isn't found.
   */
  setPaneTexture(pane: BloPane, name: string, map = 0): boolean {
    const texture = this.textureNamed(name);
    if (!texture) return false;
    for (const mesh of this.drawables.get(pane) ?? []) {
      mesh.material.uniforms[`uTex${map}`]!.value = texture;
      textureSize(mesh.material, map, texture);
    }
    return true;
  }

  /** A picture's corner colors TL, TR, BL, BR (J2DPicture::setCornerColor: its vertex colors). */
  setPaneCornerColors(pane: BloPane, colors: readonly [Rgba, Rgba, Rgba, Rgba]): void {
    if (pane.kind !== "picture") return;
    for (const mesh of this.drawables.get(pane) ?? []) {
      const attr = mesh.geometry.getAttribute("aColor") as THREE.BufferAttribute | undefined;
      if (!attr || attr.count !== 4) continue;
      colors.forEach((c, k) => (attr.array as Uint8Array).set(c, k * 4));
      attr.needsUpdate = true;
    }
  }

  // ---- What screen animations drive (screenanim.ts); each defaults to the file's value. ----

  /** A pane's position, scale and rotation in its parent's space (what a .bck joint sets); missing fields keep the file's. */
  setPaneTransform(pane: BloPane, transform: Partial<PaneTransform>): void {
    const node = this.panes.get(pane);
    if (!node) return;
    node.matrix.copy(paneMatrix({ ...pane, ...transform }));
    node.matrixWorldNeedsUpdate = true;
  }

  /** Texture matrix slot `slot` (TEXMTX0-9) of material `material` (what a .btk entry sets), on every drawable using it. */
  setMaterialTexMatrix(material: number, slot: number, matrix: BloTexMatrix): void {
    const m = this.screen.materials[material];
    if (!m) return;
    const value = texSrtMatrix(matrix);
    m.texGens.forEach((gen, i) => {
      if (gen.matrix !== TEXMTX0 + slot * 3) return;
      for (const mesh of this.byMaterial.get(m) ?? []) (mesh.material.uniforms[`uTexMtx${i}`]!.value as THREE.Matrix3).copy(value);
    });
  }

  /** TEV color register `index` (0-2 = C0-C2, 3 = PREV's start value) in 0-255 units (signed 10-bit), as a .brk sets it. */
  setMaterialTevColor(material: number, index: number, color: Rgba): void {
    const name = ["uC0", "uC1", "uC2", "uPrev"][index];
    if (name) this.setMaterialUniform(material, name, color);
  }

  /** Konst color `index` (K0-K3) in 0-255 units, as a .brk sets it. */
  setMaterialKonstColor(material: number, index: number, color: Rgba): void {
    if (index >= 0 && index < 4) this.setMaterialUniform(material, `uK${index}`, color);
  }

  /**
   * Material color 0 (what a .bpk sets). Every FSA material takes its rasterized color from the vertices, so only the
   * alpha shows: it is the pane alpha of the drawables using the material (as setPaneAlpha).
   */
  setMaterialColor(material: number, color: Rgba): void {
    const m = this.screen.materials[material];
    for (const mesh of (m && this.byMaterial.get(m)) || []) mesh.material.uniforms.uAlpha!.value = color[3] / 255;
  }

  private setMaterialUniform(material: number, name: string, color: Rgba): void {
    const m = this.screen.materials[material];
    for (const mesh of (m && this.byMaterial.get(m)) || []) (mesh.material.uniforms[name]!.value as THREE.Vector4).set(color[0] / 255, color[1] / 255, color[2] / 255, color[3] / 255);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const t of this.textures.values()) t?.dispose();
    for (const f of this.fonts.values()) f?.sheets.forEach((t) => t.dispose());
  }

  private build(pane: BloPane): THREE.Object3D {
    const node = new THREE.Object3D();
    node.name = pane.tag;
    node.visible = pane.visible;
    node.matrixAutoUpdate = false;
    node.matrix.copy(paneMatrix(pane));
    this.panes.set(pane, node);
    const [x0, y0] = paneOrigin(pane);
    const box = { x0, y0, x1: x0 + pane.width, y1: y0 + pane.height };
    if (pane.kind === "picture") {
      const m = this.screen.materials[pane.material]!;
      this.addQuad(node, pane, m, box, pane.texCoords, pane.cornerColors);
    } else if (pane.kind === "window") {
      this.addWindow(node, pane, box);
    } else if (pane.kind === "textbox") {
      this.addText(node, pane, box);
    }
    for (const child of pane.children) node.add(this.build(child));
    return node;
  }

  private texture(index: number | null): THREE.Texture | null {
    const name = index === null ? undefined : this.screen.textures[index]?.name;
    return name ? this.textureNamed(name) : null;
  }

  private textureNamed(name: string): THREE.Texture | null {
    if (!this.textures.has(name)) {
      const found = this.assets.texture(name);
      this.textures.set(name, found ? dataTexture(found.image, found.header) : null);
    }
    return this.textures.get(name)!;
  }

  private addQuad(
    node: THREE.Object3D,
    pane: BloPane,
    material: BloMaterial,
    box: { x0: number; y0: number; x1: number; y1: number },
    uv: [number, number][],
    colors: Rgba[],
    maps?: (THREE.Texture | null)[],
  ): void {
    const textures = maps ?? material.textures.map((t) => this.texture(t));
    if (!maps && textures.some((t, i) => !t && material.textures[i] !== null)) {
      const missing = material.textures.filter((t, i) => t !== null && !textures[i]).map((t) => this.screen.textures[t!]?.name);
      this.notes.set(pane, `missing ${missing.join(", ")}`);
    }
    const geometry = quadGeometry([box], [uv], [colors]);
    this.addMesh(node, pane, geometry, material, textures);
  }

  private addMesh(
    node: THREE.Object3D,
    pane: BloPane,
    geometry: THREE.BufferGeometry,
    material: BloMaterial,
    textures: (THREE.Texture | null)[],
  ): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
    const shader = tevMaterial(material, textures);
    const mesh = new THREE.Mesh(geometry, shader);
    mesh.matrixAutoUpdate = false; // at its pane's origin (identity)
    mesh.renderOrder = this.order++;
    mesh.frustumCulled = false;
    node.add(mesh);
    this.drawables.set(pane, [...(this.drawables.get(pane) ?? []), mesh]);
    this.byMaterial.set(material, [...(this.byMaterial.get(material) ?? []), mesh]);
    this.disposables.push(geometry, shader);
    return mesh;
  }

  // J2DWindow: the content rectangle (vertex colors), then the four corner textures at their own size, mirrored per
  // `frameMirror`, and the edges stretched from each corner texture's innermost texel row/column.
  private addWindow(node: THREE.Object3D, win: BloWindow, box: { x0: number; y0: number; x1: number; y1: number }): void {
    const { materials } = this.screen;
    const content = {
      x0: box.x0 + win.contentX,
      y0: box.y0 + win.contentY,
      x1: box.x0 + win.contentX + win.contentWidth,
      y1: box.y0 + win.contentY + win.contentHeight,
    };
    const white: Rgba[] = [[255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255]];
    const full: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]];
    this.addQuad(node, win, materials[win.material]!, content, full, win.contentColors);

    const corners = win.frameMaterials.map((index) => {
      const m = materials[index]!;
      const t = this.texture(m.textures[0] ?? null);
      const img = t?.image as { width: number; height: number } | undefined;
      return { m, t, w: img?.width ?? 16, h: img?.height ?? 16 };
    });
    if (corners.some((c) => !c.t)) this.notes.set(win, "missing frame texture");
    const [tl, tr, bl, br] = corners as [(typeof corners)[0], (typeof corners)[0], (typeof corners)[0], (typeof corners)[0]];
    const flip = (i: number) => ({ h: ((win.frameMirror >> (6 - i * 2)) & 2) !== 0, v: ((win.frameMirror >> (6 - i * 2)) & 1) !== 0 });
    // Texcoords of a part in the texture's own frame (quad TL, TR, BL, BR), then mirrored per the corner's bits:
    // a corner texture is drawn as a top-left corner unless mirrored.
    const uvs = (i: number, u0: number, u1: number, v0: number, v1: number): [number, number][] => {
      const f = flip(i);
      const u = (x: number) => (f.h ? 1 - x : x), v = (y: number) => (f.v ? 1 - y : y);
      return [[u(u0), v(v0)], [u(u1), v(v0)], [u(u0), v(v1)], [u(u1), v(v1)]];
    };
    const { x0, y0, x1, y1 } = box;
    const parts: [number, { x0: number; y0: number; x1: number; y1: number }, [number, number][]][] = [
      [0, { x0, y0, x1: x0 + tl.w, y1: y0 + tl.h }, uvs(0, 0, 1, 0, 1)],
      [1, { x0: x1 - tr.w, y0, x1, y1: y0 + tr.h }, uvs(1, 0, 1, 0, 1)],
      [2, { x0, y0: y1 - bl.h, x1: x0 + bl.w, y1 }, uvs(2, 0, 1, 0, 1)],
      [3, { x0: x1 - br.w, y0: y1 - br.h, x1, y1 }, uvs(3, 0, 1, 0, 1)],
      // edges: top/bottom stretch the innermost texel column of TL/BL, left/right the innermost row of TL/TR
      [0, { x0: x0 + tl.w, y0, x1: x1 - tr.w, y1: y0 + tl.h }, uvs(0, 1, 1, 0, 1)],
      [2, { x0: x0 + bl.w, y0: y1 - bl.h, x1: x1 - br.w, y1 }, uvs(2, 1, 1, 0, 1)],
      [0, { x0, y0: y0 + tl.h, x1: x0 + tl.w, y1: y1 - bl.h }, uvs(0, 0, 1, 1, 1)],
      [1, { x0: x1 - tr.w, y0: y0 + tr.h, x1, y1: y1 - br.h }, uvs(1, 0, 1, 1, 1)],
    ];
    for (const [corner, rect, uv] of parts) {
      if (rect.x1 <= rect.x0 || rect.y1 <= rect.y0) continue;
      const c = corners[corner]!;
      this.addQuad(node, win, c.m, rect, uv, white, [c.t, ...c.m.textures.slice(1).map((t) => this.texture(t))]);
    }
  }

  private font(index: number | null, shiftJis: boolean): { font: BfnFont; sheets: THREE.Texture[] } | null {
    const name = index === null ? undefined : this.screen.fonts[index]?.name;
    if (!name || !this.assets.font) return null;
    const key = `${name}${shiftJis ? "/sjis" : ""}`;
    if (!this.fonts.has(key)) {
      const found = this.assets.font(name, shiftJis);
      this.fonts.set(key, found ? { font: found.font, sheets: found.sheets.map((s) => dataTexture(s)) } : null);
    }
    return this.fonts.get(key)!;
  }

  // J2DTextBox: the text laid out by screentext.ts (J2DPrint's rules), one mesh per glyph sheet, plus the picture
  // characters of BMG messages. Meshes of a box share its draw order slot, so setText keeps the order.
  private addText(
    node: THREE.Object3D,
    tb: BloTextBox,
    box: { x0: number; y0: number; x1: number; y1: number },
    parts: BmgPart[] = textBoxParts(tb),
    options: ScreenTextOptions = {},
  ): void {
    const material = this.screen.materials[tb.material]!;
    if (!this.textOrders.has(tb)) this.textOrders.set(tb, this.order++);
    const loaded = this.font(material.font, partsNeedShiftJis(parts));
    if (!loaded) {
      this.notes.set(tb, material.font === null ? "no font" : `font ${this.screen.fonts[material.font]?.name} not loaded`);
      return;
    }
    const { font, sheets } = loaded;
    const layout = layoutScreenText(font, tb, parts, options);
    const at = (q: TextQuad) => ({ x0: box.x0 + q.x0, y0: box.y0 + q.y0, x1: box.x0 + q.x1, y1: box.y0 + q.y1 });
    const bySheet = new Map<number, TextGlyphQuad[]>();
    for (const g of layout.glyphs) if (sheets[g.sheet]) bySheet.set(g.sheet, [...(bySheet.get(g.sheet) ?? []), g]);
    const base = this.textOrders.get(tb)!;
    let k = 0;
    for (const [sheet, quads] of bySheet) {
      const img = sheets[sheet]!.image as { width: number; height: number };
      const uvs = quads.map(({ cell: c }): [number, number][] => {
        const [u0, v0, u1, v1] = [c.x / img.width, c.y / img.height, (c.x + c.width) / img.width, (c.y + c.height) / img.height];
        return [[u0, v0], [u1, v0], [u0, v1], [u1, v1]];
      });
      const geometry = quadGeometry(quads.map(at), uvs, quads.map((q) => q.colors));
      this.addMesh(node, tb, geometry, material, [sheets[sheet]!]).renderOrder = base + k++ * 1e-3;
    }
    const iconMat = layout.icons.length ? iconMaterial(material) : null;
    for (const icon of layout.icons) {
      const texture = this.textureNamed(icon.texture);
      if (!texture) {
        this.notes.set(tb, `missing ${icon.texture}`);
        continue;
      }
      const full: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]];
      this.addMesh(node, tb, quadGeometry([at(icon)], [full], [icon.colors]), iconMat!, [texture]).renderOrder = base + k++ * 1e-3;
    }
  }

  /**
   * Replaces a text box's text (the file's placeholder until then): plain text, a BMG message (one page of it, see
   * `options.page`) or its parts. Takes the pane or its tag; returns false if there is no such text box.
   */
  setText(pane: BloPane | string, content: ScreenTextContent, options: ScreenTextOptions = {}): boolean {
    const tb = typeof pane === "string" ? [...this.panes.keys()].find((p) => p.tag === pane) : pane;
    const node = tb && this.panes.get(tb);
    if (!tb || tb.kind !== "textbox" || !node) return false;
    const old = this.drawables.get(tb) ?? [];
    const alpha = old[0]?.material.uniforms.uAlpha!.value as number | undefined;
    for (const mesh of old) {
      node.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.drawables.delete(tb);
    this.notes.delete(tb);
    const [x0, y0] = paneOrigin(tb);
    this.addText(node, tb, { x0, y0, x1: x0 + tb.width, y1: y0 + tb.height }, contentParts(content, options.page), options);
    if (alpha !== undefined) for (const mesh of this.drawables.get(tb) ?? []) mesh.material.uniforms.uAlpha!.value = alpha;
    return true;
  }
}

/** Local origin of a pane's box: the anchor point sits at (0, 0), so the box starts at minus its anchor offset. */
export function paneOrigin(pane: BloPane): [number, number] {
  const ax = (pane.anchor % 3) / 2, ay = Math.floor(pane.anchor / 3) / 2;
  return [-ax * pane.width, -ay * pane.height];
}

/** Pane transform in its parent's space: translate to (x, y) (the anchor point), rotate about it, scale. */
export function paneMatrix(pane: BloPane): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeTranslation(pane.x, pane.y, 0);
  // Screen y points down: a positive J2D angle turns counterclockwise on screen.
  if (pane.rotateZ) m.multiply(new THREE.Matrix4().makeRotationZ(-THREE.MathUtils.degToRad(pane.rotateZ)));
  if (pane.rotateY) m.multiply(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(pane.rotateY)));
  if (pane.rotateX) m.multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(pane.rotateX)));
  return m.multiply(new THREE.Matrix4().makeScale(pane.scaleX, pane.scaleY, 1));
}

const WRAP = [THREE.ClampToEdgeWrapping, THREE.RepeatWrapping, THREE.MirroredRepeatWrapping] as const;

function dataTexture(image: DecodedTexture, header?: BtiHeader): THREE.DataTexture {
  const t = new THREE.DataTexture(image.data, image.width, image.height, THREE.RGBAFormat);
  t.wrapS = WRAP[header?.wrapS ?? 0] ?? THREE.ClampToEdgeWrapping;
  t.wrapT = WRAP[header?.wrapT ?? 0] ?? THREE.ClampToEdgeWrapping;
  // GX filters: 0 nearest, 1 linear, 2+ mipmapped variants (no mips are uploaded here).
  t.magFilter = header?.magFilter === 0 ? THREE.NearestFilter : THREE.LinearFilter;
  t.minFilter = header?.minFilter === 0 ? THREE.NearestFilter : THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function quadGeometry(
  rects: { x0: number; y0: number; x1: number; y1: number }[],
  uvs: [number, number][][],
  colors: Rgba[][],
): THREE.BufferGeometry {
  const position = new Float32Array(rects.length * 12);
  const uv = new Float32Array(rects.length * 8);
  const color = new Uint8Array(rects.length * 16);
  const index: number[] = [];
  rects.forEach((r, q) => {
    const corners = [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]] as const; // TL, TR, BL, BR
    corners.forEach(([x, y], k) => {
      position.set([x, y, 0], (q * 4 + k) * 3);
      uv.set(uvs[q]![k]!, (q * 4 + k) * 2);
      color.set(colors[q]![k]!, (q * 4 + k) * 4);
    });
    const b = q * 4;
    index.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(position, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("aColor", new THREE.BufferAttribute(color, 4, true));
  g.setIndex(index);
  return g;
}

// ---- GX TEV → GLSL -------------------------------------------------------------------------------------------------

const COLOR_ARGS = ["prev.rgb", "prev.aaa", "c0.rgb", "c0.aaa", "c1.rgb", "c1.aaa", "c2.rgb", "c2.aaa", "tex.rgb", "tex.aaa", "ras.rgb", "ras.aaa", "vec3(1.0)", "vec3(0.5)", "konst.rgb", "vec3(0.0)"];
const ALPHA_ARGS = ["prev.a", "c0.a", "c1.a", "c2.a", "tex.a", "ras.a", "konst.a", "0.0"];
const REGS = ["prev", "c0", "c1", "c2"];
const BIAS = ["0.0", "0.5", "-0.5", "0.0"];
const SCALE = ["1.0", "2.0", "4.0", "0.5"];
const SWIZZLE = "rgba";

function konstColor(sel: number): string {
  if (sel <= 7) return `vec3(${(8 - sel) / 8})`;
  if (sel >= 0x0c && sel <= 0x0f) return `uK${sel - 0x0c}.rgb`;
  if (sel >= 0x10 && sel <= 0x1f) return `uK${sel & 3}.${SWIZZLE[(sel - 0x10) >> 2]!.repeat(3)}`;
  return "vec3(1.0)";
}

function konstAlpha(sel: number): string {
  if (sel <= 7) return `${(8 - sel) / 8}`;
  if (sel >= 0x10 && sel <= 0x1f) return `uK${sel & 3}.${SWIZZLE[(sel - 0x10) >> 2]}`;
  return "1.0";
}

/**
 * The texture coordinates and whether the vertex color the material's TEV stages read. Only those are passed from the
 * vertex shader: drivers warn about outputs the fragment shader never reads (Firefox logs a warning per program).
 */
function tevInputs(m: BloMaterial): { coords: number[]; color: boolean } {
  const coords = new Set<number>();
  let color = m.tevStages.length === 0;
  m.tevStages.forEach((_, i) => {
    const order = m.tevOrders[i] ?? { texCoord: 0xff, texMap: 0xff, channel: 0xff };
    if (order.texMap < 8 && order.texCoord < 8) coords.add(order.texCoord);
    if (order.channel !== 0xff) color = true;
  });
  for (const s of m.indirect?.stages ?? []) if (s.texMap < 8 && s.texCoord < 8) coords.add(s.texCoord);
  return { coords: [...coords].sort((a, b) => a - b), color };
}

const float = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

// Indirect texturing, after noclip.website's src/gx/gx_material.ts (MIT License, Copyright (c) 2017 Jasper St. Pierre,
// https://github.com/magcius/noclip.website), as packages/render/src/j3d/gx-shader.ts ports it: each indirect stage
// reads its map's (A, B, G) as 8-bit (S, T, U); a TEV stage then adds `matrix × (STU + bias)` texels to its own texture
// coordinate. Dynamic (S/T) matrices and bump alpha are not emulated (no FSA screen uses them).
function indirectSamples(m: BloMaterial): string[] {
  return (m.indirect?.stages ?? []).map((s, i) => {
    if (s.texMap >= 8 || s.texCoord >= 8) return `  vec3 ind${i} = vec3(0.0);`;
    const scale = s.scaleS || s.scaleT ? ` * vec2(${float(1 / (1 << s.scaleS))}, ${float(1 / (1 << s.scaleT))})` : "";
    return `  vec3 ind${i} = 255.0 * texture2D(uTex${s.texMap}, vTex${s.texCoord}${scale}).abg;`;
  });
}

const INDIRECT_WRAP = [0, 256, 128, 64, 32, 16, 0];

/** Statement setting `tc` (texels) for TEV stage i when it uses the indirect stages, else null (a plain lookup). */
function indirectCoord(m: BloMaterial, i: number, texCoord: number, texMap: number): string | null {
  const t = m.indirect?.tevStages[i];
  if (!t || (t.matrix === 0 && !t.addPrev && !t.wrapS && !t.wrapT)) return null;
  const wrap = (c: string, mode: number) => (mode === 6 ? "0.0" : mode ? `mod(${c}, ${float(INDIRECT_WRAP[mode]!)})` : c);
  const scaled = `vTex${texCoord} * uTexSize${texMap}`;
  const base = t.wrapS || t.wrapT ? `vec2(${wrap(`(${scaled}).x`, t.wrapS)}, ${wrap(`(${scaled}).y`, t.wrapT)})` : scaled;
  let offset = "";
  if (t.matrix >= 1 && t.matrix <= 3 && t.indStage < (m.indirect?.stages.length ?? 0)) {
    const b = t.format === 0 ? "-128.0" : "1.0";
    const bias = ["", `vec3(${b}, 0.0, 0.0)`, `vec3(0.0, ${b}, 0.0)`, `vec3(${b}, ${b}, 0.0)`, `vec3(0.0, 0.0, ${b})`, `vec3(${b}, 0.0, ${b})`, `vec3(0.0, ${b}, ${b})`, `vec3(${b})`][t.bias];
    const c = bias ? `(ind${t.indStage} + ${bias})` : `ind${t.indStage}`;
    const k = (t.matrix - 1) * 2;
    offset = ` + vec2(dot(uIndMtx[${k}], ${c}), dot(uIndMtx[${k + 1}], ${c}))`;
  }
  return `tc ${t.addPrev ? "+=" : "="} ${base}${offset};`;
}

/** Fragment shader emulating the material's TEV stages (ops: add/subtract; compare modes treated as add). */
export function tevFragmentShader(m: BloMaterial): string {
  const lines: string[] = indirectSamples(m);
  m.tevStages.forEach((s, i) => {
    const order = m.tevOrders[i] ?? { texCoord: 0xff, texMap: 0xff, channel: 0xff };
    const swap = m.swapModes[i] ?? { ras: 0, tex: 0 };
    const sw = (table: number) => (m.swapTables[table] ?? [0, 1, 2, 3]).map((c) => SWIZZLE[c]).join("");
    const textured = order.texMap < 8 && order.texCoord < 8;
    const indirect = textured ? indirectCoord(m, i, order.texCoord, order.texMap) : null;
    if (indirect) lines.push(`  ${indirect}`);
    const coord = indirect ? `tc / uTexSize${order.texMap}` : `vTex${order.texCoord}`;
    const tex = textured ? `texture2D(uTex${order.texMap}, ${coord}).${sw(swap.tex)}` : "vec4(1.0)";
    const ras = order.channel === 0xff ? "vec4(0.0)" : `vColor.${sw(swap.ras)}`;
    const c = s.colorIn.map((a) => COLOR_ARGS[a]!);
    const a = s.alphaIn.map((x) => ALPHA_ARGS[x]!);
    const sign = (op: number) => (op & 1 ? "-" : "+");
    const clampC = (e: string) => (s.colorClamp ? `clamp(${e}, 0.0, 1.0)` : e);
    const clampA = (e: string) => (s.alphaClamp ? `clamp(${e}, 0.0, 1.0)` : e);
    lines.push(
      `  // stage ${i}`,
      `  tex = ${tex}; ras = ${ras};`,
      `  konst = vec4(${konstColor(m.kColorSels[i] ?? 0)}, ${konstAlpha(m.kAlphaSels[i] ?? 0)});`,
      `  ${REGS[s.colorReg & 3]}.rgb = ${clampC(`(${c[3]} ${sign(s.colorOp)} mix(${c[0]}, ${c[1]}, ${c[2]}) + ${BIAS[s.colorBias]}) * ${SCALE[s.colorScale]}`)};`,
      `  ${REGS[s.alphaReg & 3]}.a = ${clampA(`(${a[3]} ${sign(s.alphaOp)} mix(${a[0]}, ${a[1]}, ${a[2]}) + ${BIAS[s.alphaBias]}) * ${SCALE[s.alphaScale]}`)};`,
    );
  });
  const last = m.tevStages.at(-1);
  const out = last ? `vec4(${REGS[last.colorReg & 3]}.rgb, ${REGS[last.alphaReg & 3]}.a)` : "vColor";
  const samplers = Array.from({ length: 8 }, (_, i) => `uniform sampler2D uTex${i};`).join("\n");
  const inputs = tevInputs(m);
  const indirect = m.indirect ? `uniform vec3 uIndMtx[6];\n${Array.from({ length: 8 }, (_, i) => `uniform vec2 uTexSize${i};`).join("\n")}` : "";
  return /* glsl */ `
${samplers}
uniform vec4 uC0, uC1, uC2, uPrev, uK0, uK1, uK2, uK3;${indirect ? `\n${indirect}` : ""}
${inputs.color ? "varying vec4 vColor;" : ""}
${inputs.coords.map((i) => `varying vec2 vTex${i};`).join("\n")}
void main() {
  vec4 prev = uPrev, c0 = uC0, c1 = uC1, c2 = uC2, tex, ras, konst;${m.indirect ? "\n  vec2 tc = vec2(0.0);" : ""}
${lines.join("\n")}
  gl_FragColor = ${out};
}
`;
}

function tevVertexShader(m: BloMaterial): string {
  const { coords, color } = tevInputs(m);
  return /* glsl */ `
attribute vec4 aColor;
uniform float uAlpha;
${coords.map((i) => `uniform mat3 uTexMtx${i};\nvarying vec2 vTex${i};`).join("\n")}
${color ? "varying vec4 vColor;" : ""}
void main() {
${color ? "  vColor = vec4(aColor.rgb, aColor.a * uAlpha);" : ""}
${coords.map((i) => `  vTex${i} = (uTexMtx${i} * vec3(uv, 1.0)).xy;`).join("\n")}
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
}

const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE.needsUpdate = true;

// GX blend factors as source / destination factors.
const SRC_FACTOR = [THREE.ZeroFactor, THREE.OneFactor, THREE.DstColorFactor, THREE.OneMinusDstColorFactor, THREE.SrcAlphaFactor, THREE.OneMinusSrcAlphaFactor, THREE.DstAlphaFactor, THREE.OneMinusDstAlphaFactor];
const DST_FACTOR = [THREE.ZeroFactor, THREE.OneFactor, THREE.SrcColorFactor, THREE.OneMinusSrcColorFactor, THREE.SrcAlphaFactor, THREE.OneMinusSrcAlphaFactor, THREE.DstAlphaFactor, THREE.OneMinusDstAlphaFactor];

const TEXMTX0 = 0x1e, IDENTITY = 0x3c; // GXTexMtx: TEXMTXn = 0x1E + 3n

/**
 * J2D's texture SRT about `center` (the math of J3D's "basic" mode): s' = sx·(cos·(s − cx) − sin·(t − cy)) + cx + tx,
 * t' = sy·(sin·(s − cx) + cos·(t − cy)) + cy + ty, rotation in degrees. Only the effect materials (title logo, results,
 * collection, GBA window) have matrices other than the identity.
 */
export function texSrtMatrix(mtx: BloTexMatrix): THREE.Matrix3 {
  const [cx, cy] = mtx.center;
  const r = THREE.MathUtils.degToRad(mtx.rotation), cos = Math.cos(r), sin = Math.sin(r);
  const { scaleX: sx, scaleY: sy } = mtx;
  return new THREE.Matrix3().set(
    sx * cos, -sx * sin, cx + mtx.translateX - sx * (cos * cx - sin * cy),
    sy * sin, sy * cos, cy + mtx.translateY - sy * (sin * cx + cos * cy),
    0, 0, 1,
  );
}

/** Texture coordinate matrix of a texgen (identity for GX_IDENTITY). */
function texGenMatrix(m: BloMaterial, texCoord: number): THREE.Matrix3 {
  const gen = m.texGens[texCoord];
  if (!gen || gen.matrix === IDENTITY || gen.matrix < TEXMTX0) return new THREE.Matrix3();
  const mtx = m.texMatrices[(gen.matrix - TEXMTX0) / 3];
  return mtx ? texSrtMatrix(mtx) : new THREE.Matrix3();
}

/** Keeps uTexSize<map> (texels, for indirect offsets) in step with the texture bound to that map. */
function textureSize(material: THREE.ShaderMaterial, map: number, texture: THREE.Texture | null): void {
  const uniform = material.uniforms[`uTexSize${map}`];
  const image = texture?.image as { width: number; height: number } | undefined;
  if (uniform) (uniform.value as THREE.Vector2).set(image?.width ?? 1, image?.height ?? 1);
}

const s10 = (c: Rgba) => new THREE.Vector4(c[0] / 255, c[1] / 255, c[2] / 255, c[3] / 255);

/** ShaderMaterial for one drawable of a pane using `m`, with the given texture maps (index = GX texmap). */
export function tevMaterial(m: BloMaterial, maps: (THREE.Texture | null)[]): THREE.ShaderMaterial {
  const uniforms: Record<string, THREE.IUniform> = {
    uAlpha: { value: (m.matColors[0]?.[3] ?? 255) / 255 },
    uC0: { value: s10(m.tevColors[0] ?? [0, 0, 0, 0]) },
    uC1: { value: s10(m.tevColors[1] ?? [0, 0, 0, 0]) },
    uC2: { value: s10(m.tevColors[2] ?? [0, 0, 0, 0]) },
    uPrev: { value: s10(m.tevColors[3] ?? [0, 0, 0, 0]) },
  };
  for (let i = 0; i < 4; i++) uniforms[`uK${i}`] = { value: s10(m.konstColors[i] ?? [255, 255, 255, 255]) };
  for (let i = 0; i < 8; i++) {
    uniforms[`uTex${i}`] = { value: maps[i] ?? WHITE };
    uniforms[`uTexMtx${i}`] = { value: texGenMatrix(m, i) };
  }
  if (m.indirect) {
    // Rows of the three indirect matrices with their 2^scale folded in, and the maps' sizes in texels.
    uniforms.uIndMtx = { value: m.indirect.matrices.flatMap(({ matrix, scaleExp }) => matrix.map((row) => new THREE.Vector3(...row).multiplyScalar(2 ** scaleExp))) };
    for (let i = 0; i < 8; i++) {
      const image = maps[i]?.image as { width: number; height: number } | undefined;
      uniforms[`uTexSize${i}`] = { value: new THREE.Vector2(image?.width ?? 1, image?.height ?? 1) };
    }
  }
  const blend = m.blend;
  const material = new THREE.ShaderMaterial({
    vertexShader: tevVertexShader(m),
    fragmentShader: tevFragmentShader(m),
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  if (blend.type === 1) {
    material.blending = THREE.CustomBlending;
    material.blendSrc = SRC_FACTOR[blend.source] ?? THREE.SrcAlphaFactor;
    material.blendDst = DST_FACTOR[blend.dest] ?? THREE.OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  } else if (blend.type === 3) {
    material.blending = THREE.SubtractiveBlending;
  } else {
    material.blending = THREE.NoBlending;
  }
  return material;
}
