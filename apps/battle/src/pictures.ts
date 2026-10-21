// J2D pictures and text boxes the game makes in code rather than in a screen file (J2DPicture / J2DTextBox built from
// a texture or a font: "Be the last one standing!", "Go!", "P1 WIN!", the time limit's digits), as a screen of their
// own so ScreenView draws them like any pane: a material copied from a real screen's ordinary one (two TEV stages,
// lerp(C0, C1, texture) then × the corner colors, i.e. J2DPicture's black / white and its vertex colors).
import { walkPanes, type BloMaterial, type BloPane, type BloPicture, type BloScreen, type BloTextBox, type Rgba } from "@fso/formats";

const WHITE: Rgba = [255, 255, 255, 255];
const CLEAR: Rgba = [0, 0, 0, 0];

export interface PictureSpec {
  kind?: "picture";
  tag: string;
  /** A texture file name (the assets' lookup). */
  texture: string;
  /** Where the anchor sits (screen px), the box's size, and the anchor (J2DBasePosition; 4 = center, the default). */
  x: number;
  y: number;
  width: number;
  height: number;
  anchor?: number;
  /** J2DPicture's black and white: what the texture's 0 and 1 become (TEV C0 / C1). */
  black?: Rgba;
  white?: Rgba;
  /** Corner colors TL, TR, BL, BR (a vertical gradient: J2DPicture::setCornerColor). */
  colors?: [Rgba, Rgba, Rgba, Rgba];
  visible?: boolean;
}

export interface TextSpec {
  kind: "text";
  tag: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  anchor?: number;
  fontWidth: number;
  fontHeight: number;
  charSpace?: number;
  /** J2DTextBox's top and bottom colors (the glyphs' vertical gradient). */
  top: Rgba;
  bottom: Rgba;
  black?: Rgba;
  white?: Rgba;
  visible?: boolean;
}

/** An ordinary picture material of a screen (2 stages: lerp(C0, C1, TEXC) then × RASC), to copy. */
export function pictureMaterial(screen: BloScreen): BloMaterial | null {
  return screen.materials.find((m) => m.tevStages.length === 2 && m.textures.filter((t) => t !== null).length === 1 && !m.indirect && sameArgs(m.tevStages[0]!.colorIn, [2, 4, 8, 15])) ?? null;
}

/** A text box's material (its font and TEV), to copy: the first text box of the screen. */
export function textMaterial(screen: BloScreen): BloMaterial | null {
  for (const { pane } of walkPanes(screen.root)) if (pane.kind === "textbox") return screen.materials[pane.material] ?? null;
  return null;
}

/**
 * A 608×448 screen of `specs`, children of its root in order (later ones draw on top). `picture` is a material to copy
 * for pictures (pictureMaterial), `text` one for text boxes with `font` its font file (textMaterial).
 */
export function pictureScreen(specs: (PictureSpec | TextSpec)[], materials: { picture: BloMaterial; text?: BloMaterial | null; font?: string }): BloScreen {
  const screen: BloScreen = { width: 608, height: 448, background: CLEAR, textures: [], fonts: [], materials: [], root: pane("ROOT", 0, 0, 608, 448, 0) };
  if (materials.font) screen.fonts.push({ type: 2, name: materials.font });
  for (const spec of specs) {
    const id = screen.root.children.length + 1;
    if (spec.kind === "text") {
      if (!materials.text || !materials.font) continue;
      const m = copyMaterial(materials.text, spec.tag, spec.black ?? CLEAR, spec.white ?? WHITE);
      m.font = 0;
      screen.materials.push(m);
      const bytes = new TextEncoder().encode(spec.text);
      const box: BloTextBox = {
        ...pane(spec.tag, spec.x, spec.y, spec.width, spec.height, spec.anchor ?? 4),
        block: "TBX2",
        kind: "textbox",
        id,
        visible: spec.visible ?? true,
        materialId: id,
        material: screen.materials.length - 1,
        charSpace: spec.charSpace ?? 0,
        lineSpace: spec.fontHeight,
        fontWidth: spec.fontWidth,
        fontHeight: spec.fontHeight,
        hBinding: 0,
        vBinding: 0,
        topColor: spec.top,
        bottomColor: spec.bottom,
        maxLength: bytes.length,
        textBytes: bytes,
        text: spec.text,
      };
      screen.root.children.push(box);
      continue;
    }
    screen.textures.push({ type: 2, name: spec.texture });
    const m = copyMaterial(materials.picture, spec.tag, spec.black ?? CLEAR, spec.white ?? WHITE);
    m.textures = [screen.textures.length - 1, ...m.textures.slice(1).map(() => null)];
    screen.materials.push(m);
    const picture: BloPicture = {
      ...pane(spec.tag, spec.x, spec.y, spec.width, spec.height, spec.anchor ?? 4),
      block: "PIC2",
      kind: "picture",
      id,
      visible: spec.visible ?? true,
      materialId: id,
      material: screen.materials.length - 1,
      vertexIndices: [0, 0, 0, 0],
      texCoords: [[0, 0], [1, 0], [0, 1], [1, 1]],
      cornerColors: spec.colors ?? [WHITE, WHITE, WHITE, WHITE],
    };
    screen.root.children.push(picture);
  }
  return screen;
}

function pane(tag: string, x: number, y: number, width: number, height: number, anchor: number): BloPane {
  return {
    block: "PAN2",
    kind: "pane",
    id: 0,
    tag,
    userTag: 0n,
    visible: true,
    anchor: anchor as BloPane["anchor"],
    width,
    height,
    scaleX: 1,
    scaleY: 1,
    rotateX: 0,
    rotateY: 0,
    rotateZ: 0,
    x,
    y,
    children: [],
  };
}

function copyMaterial(template: BloMaterial, tag: string, black: Rgba, white: Rgba): BloMaterial {
  const m = structuredClone(template);
  m.name = `mat_${tag}`;
  m.tevColors = [black, white, ...m.tevColors.slice(2)];
  m.matColors = [WHITE, ...m.matColors.slice(1)];
  return m;
}

function sameArgs(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
