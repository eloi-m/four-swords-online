// Text of J2D text boxes (TBX2), laid out like JSystem's J2DPrint, from a box's own placeholder text or a BMG message
// (packages/formats/src/j2d/bmg.ts) with its tags: colors, picture characters, arrows, the spaces answer cursors take,
// numbers. Pure layout (no three.js), so it is tested in node; screen.ts turns the quads into meshes.
// Rules (docs/formats/j2d-and-bmg.md "2D screens", "Messages (BMG)"): glyph cells scaled to fontWidth × fontHeight (x by the GLY1
// cell width, y by ascent + descent), advance × that scale + charSpace, lines lineSpace apart, the block placed in the
// box by the h/v binding; vertex colors top → bottom from the box's gradient until a color tag sets both to one color.
import {
  BMG_ARROW_CODES,
  BMG_COLORS,
  BMG_ICON_TEXTURES,
  BMG_NUMBER_UNITS,
  bfnGlyph,
  bmgPages,
  bmgTagArgs,
  parseBmgText,
  type BfnFont,
  type BloMaterial,
  type BloTextBox,
  type BmgMessage,
  type BmgPart,
  type BmgTag,
  type Rgba,
} from "@fso/formats";

/** A text box's text: plain text (character codes ≤ 0xFF, "\n" between lines), a BMG message or one page of it. */
export type ScreenTextContent = string | BmgMessage | BmgPart[];

export interface ScreenTextOptions {
  /** Which page of a multi-page message (split at its page tags); default 0. */
  page?: number;
  /** Apply color tags (default true). The game draws a box's shadow copy (Tm02, Tmmt02…) without them. */
  colors?: boolean;
  /** Text printed for a number (group 3) or the race time (2.29); default "0" plus the tag's unit, "0:00". */
  insert?: (tag: BmgTag) => string | undefined;
  /** Spaces an answer slot tag (2.19-2.1C) leaves for the cursor: a runtime value, 2 by default (guess). */
  optionSpaces?: number;
}

export interface TextQuad {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  colors: [Rgba, Rgba, Rgba, Rgba]; // TL, TR, BL, BR
}

export interface TextGlyphQuad extends TextQuad {
  sheet: number;
  /** Cell rectangle in the sheet, in pixels. */
  cell: { x: number; y: number; width: number; height: number };
}

export interface TextIconQuad extends TextQuad {
  /** Picture character number (BMG_ICON_TEXTURES). */
  icon: number;
  texture: string;
}

export interface TextLayout {
  glyphs: TextGlyphQuad[];
  icons: TextIconQuad[];
  lines: number;
  /** Width of each line in screen pixels. */
  widths: number[];
}

type Item = { kind: "glyph"; code: number; colors: [Rgba, Rgba] } | { kind: "icon"; icon: number; colors: [Rgba, Rgba] };

/** A box's placeholder text (ASCII, or Shift-JIS in Japanese screens) as BMG parts. */
export function textBoxParts(tb: BloTextBox): BmgPart[] {
  return parseBmgText(tb.textBytes, hasShiftJis(tb.textBytes));
}

/** BMG parts of plain text or a message page. */
export function contentParts(content: ScreenTextContent, page = 0): BmgPart[] {
  if (typeof content === "string") {
    const codes = [...content].map((c) => c.charCodeAt(0));
    return codes.length ? [{ kind: "text", codes, text: content }] : [];
  }
  const pages = bmgPages(content);
  return pages[Math.min(Math.max(page, 0), pages.length - 1)] ?? [];
}

/** Whether a text uses two-byte codes (and wants a Japanese font). */
export function partsNeedShiftJis(parts: BmgPart[]): boolean {
  return parts.some((p) => p.kind === "text" && p.codes.some((c) => c > 0xff));
}

/** The text a BMG tag prints (numbers, the race time), by default. */
export function defaultInsert(tag: BmgTag): string | undefined {
  if (tag.group === 3) {
    const unit = BMG_NUMBER_UNITS[bmgTagArgs(tag)[0] ?? 0] ?? ["", ""];
    return `0${unit[1]}`;
  }
  if (tag.key === 0x20029) return "0:00";
  return undefined;
}

const SJIS_ARROWS = new Map([[0x81aa, 0xa7], [0x81ab, 0xa8], [0x81a9, 0xa6], [0x81a8, 0xa5]]); // ↑ ↓ ← → in Shift-JIS

/**
 * Lays out text in a text box: glyph quads per sheet cell and picture characters, in the box's local space (origin
 * at the box's top-left corner, y down).
 */
export function layoutScreenText(font: BfnFont, tb: BloTextBox, parts: BmgPart[], options: ScreenTextOptions = {}): TextLayout {
  const gradient: [Rgba, Rgba] = [tb.topColor, tb.bottomColor];
  let colors = gradient;
  const lines: Item[][] = [[]];
  const push = (code: number) => {
    if (code === 0x0a) lines.push([]);
    else if (code >= 0x20) lines.at(-1)!.push({ kind: "glyph", code, colors });
  };
  const pushText = (text: string) => [...text].forEach((c) => push(c.charCodeAt(0)));
  const usFont = font.encoding !== 2;
  for (const part of parts) {
    if (part.kind === "text") {
      for (const c of part.codes) push(usFont && c > 0xff ? (SJIS_ARROWS.get(c) ?? c) : c);
      continue;
    }
    const k = part.key;
    if (k === 0x2001e) {
      // "\x1bCC[color]\x1bGM[0]": one color, no gradient
      const c = BMG_COLORS[part.args[0] ?? 0];
      if (options.colors !== false && c) colors = [c as Rgba, c as Rgba];
    } else if (k >= 0x10000 && k <= 0x1000a) {
      lines.at(-1)!.push({ kind: "icon", icon: k & 0xff, colors });
    } else if (k >= 0x10010 && k <= 0x10013) {
      push(usFont ? BMG_ARROW_CODES[k & 3]! : [0x81aa, 0x81ab, 0x81a9, 0x81a8][k & 3]!);
    } else if ((k >= 0x20009 && k <= 0x2000c) || (k >= 0x20011 && k <= 0x20014)) {
      pushText("    ");
    } else if (k >= 0x20019 && k <= 0x2001c) {
      pushText(" ".repeat(options.optionSpaces ?? 2));
    } else {
      const text = options.insert?.(part) ?? defaultInsert(part);
      if (text) pushText(text);
    }
  }

  const cellW = font.glyphBlocks[0]?.cellWidth ?? font.width;
  const cellH = font.ascent + font.descent || (font.glyphBlocks[0]?.cellHeight ?? tb.fontHeight);
  const sx = tb.fontWidth / cellW, sy = tb.fontHeight / cellH;
  const space = (bfnGlyph(font, 0x20)?.advance ?? font.width) * sx;
  const advance = (item: Item) =>
    item.kind === "icon" ? 2 * space + tb.charSpace : (bfnGlyph(font, item.code)?.advance ?? font.width) * sx;
  const widths = lines.map((line) => line.reduce((w, item, i) => w + advance(item) + (i ? tb.charSpace : 0), 0));
  const textHeight = tb.fontHeight + tb.lineSpace * (lines.length - 1);
  const top = tb.vBinding === 2 ? 0 : tb.vBinding === 1 ? tb.height - textHeight : (tb.height - textHeight) / 2;
  const layout: TextLayout = { glyphs: [], icons: [], lines: lines.length, widths };
  lines.forEach((line, row) => {
    const w = widths[row]!;
    let x = tb.hBinding === 2 ? 0 : tb.hBinding === 1 ? tb.width - w : (tb.width - w) / 2;
    const y = top + row * tb.lineSpace;
    line.forEach((item, i) => {
      if (i) x += tb.charSpace;
      const [c0, c1] = item.colors;
      const quadColors: [Rgba, Rgba, Rgba, Rgba] = [c0, c0, c1, c1];
      if (item.kind === "icon") {
        // Two spaces wide; the picture (a J2DPicture in the game) drawn as a square of the font height over them.
        const size = tb.fontHeight, cx = x + advance(item) / 2;
        layout.icons.push({
          icon: item.icon,
          texture: BMG_ICON_TEXTURES[item.icon]!,
          x0: cx - size / 2,
          y0: y,
          x1: cx + size / 2,
          y1: y + size,
          colors: [[255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255]],
        });
      } else {
        const g = bfnGlyph(font, item.code);
        if (g && item.code !== 0x20) {
          const gx = x - g.bearing * sx;
          layout.glyphs.push({
            sheet: g.sheet,
            cell: { x: g.x, y: g.y, width: g.width, height: g.height },
            x0: gx,
            y0: y,
            x1: gx + g.width * sx,
            y1: y + g.height * sy,
            colors: quadColors,
          });
        }
      }
      x += advance(item);
    });
  });
  return layout;
}

/**
 * The material of a picture character: the text box's material with a single "texture × vertex color" stage, so the
 * picture keeps its own colors (the game draws them as separate J2DPictures).
 */
export function iconMaterial(text: BloMaterial): BloMaterial {
  return {
    ...text,
    textures: [null],
    tevOrders: [{ texCoord: 0, texMap: 0, channel: 4 }],
    tevStages: [
      {
        colorIn: [15, 8, 10, 15], // mix(0, tex, ras) = tex × ras
        colorOp: 0,
        colorBias: 0,
        colorScale: 0,
        colorClamp: true,
        colorReg: 0,
        alphaIn: [7, 4, 5, 7],
        alphaOp: 0,
        alphaBias: 0,
        alphaScale: 0,
        alphaClamp: true,
        alphaReg: 0,
      },
    ],
    swapModes: [],
    kColorSels: [],
    kAlphaSels: [],
    texGens: [],
  };
}

const isLead = (b: number) => (b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc);

export function hasShiftJis(bytes: Uint8Array): boolean {
  for (let i = 0; i + 1 < bytes.length; i++) if (isLead(bytes[i]!) && bytes[i + 1]! >= 0x40) return true;
  return false;
}
