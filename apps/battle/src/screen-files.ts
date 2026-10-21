// The game files Shadow Battle's own screens are drawn from (banners.ts, total.ts): the screen archives' scrn/ and
// timg/ folders (game2D, main2D, result), data.arc's "Go!", the US message file and its font (msgus.arc). Decoded
// once, looked up case-insensitively (screens name textures in other cases than the files).
import {
  decodeBfnSheets,
  decodeBti,
  decompressYaz0,
  isYaz0,
  parseBfn,
  parseBlo,
  parseBmg,
  parseBtiHeader,
  parseScreenAnimation,
  type Bmg,
  type BloScreen,
  type DecodedTexture,
  type RarcArchive,
  type ScreenAnimation,
} from "@fso/formats";
import type { ScreenAssets, ScreenFont, ScreenTexture } from "@fso/render";

export const MESSAGE_FONT = "rock_24_20_4i_e.bfn";

export class ScreenFiles {
  /** The US messages (gc_four_swords_text_e.bmg), or null without msgus.arc. */
  readonly bmg: Bmg | null;
  private readonly archives: Map<string, RarcArchive>;
  private readonly extra: Map<string, DecodedTexture>;
  private readonly textures = new Map<string, ScreenTexture | null>();
  private font: ScreenFont | null | undefined;

  /** `archives` by name (game2D.arc, main2D.arc, result.arc, data.arc, msgus.arc); `extra` are textures made in code. */
  constructor(archives: Map<string, RarcArchive>, extra: Map<string, DecodedTexture> = new Map()) {
    this.archives = archives;
    this.extra = extra;
    const messages = archives.get("msgus.arc");
    const bmg = messages ? archiveFile(messages, "bmg/gc_four_swords_text_e.bmg") : null;
    this.bmg = bmg ? parseBmg(bmg) : null;
  }

  /** Textures for a screen of `archive`: its own timg/ first (as the game loads them), then the others'; the font. */
  assetsFor(archive: string): ScreenAssets {
    const order = [archive, ...[...this.archives.keys()].filter((name) => name !== archive)];
    return {
      texture: (name) => {
        const key = `${archive}/${name.toLowerCase()}`;
        if (!this.textures.has(key)) {
          const made = this.extra.get(name);
          let found: ScreenTexture | null = made ? { image: made } : null;
          for (const a of found ? [] : order) {
            const bytes = this.archives.has(a) ? archiveFile(this.archives.get(a)!, `timg/${name}`) : null;
            if (bytes) {
              found = { image: decodeBti(bytes), header: parseBtiHeader(bytes) };
              break;
            }
          }
          this.textures.set(key, found);
        }
        return this.textures.get(key)!;
      },
      font: (name) => this.messageFont(name),
    };
  }

  /** A screen file (scrn/<name>) of an archive, parsed anew (callers adjust their copy), or null. */
  screen(archive: string, name: string): BloScreen | null {
    const a = this.archives.get(archive);
    const bytes = a ? archiveFile(a, `scrn/${name}`) : null;
    return bytes ? parseBlo(bytes) : null;
  }

  /** Any file of an archive (data.arc's particle.jpc…), unpacked, or null. */
  file(archive: string, path: string): Uint8Array | null {
    const a = this.archives.get(archive);
    return a ? archiveFile(a, path) : null;
  }

  /** A screen animation file (scrn/<name>: .bck/.btk/.brk/.bpk), or null. */
  animation(archive: string, name: string): ScreenAnimation | null {
    const a = this.archives.get(archive);
    const bytes = a ? archiveFile(a, `scrn/${name}`) : null;
    return bytes ? parseScreenAnimation(bytes, name) : null;
  }

  private messageFont(name: string): ScreenFont | null {
    if (this.font === undefined) {
      const messages = this.archives.get("msgus.arc");
      const bytes = messages ? (archiveFile(messages, `font/${name}`) ?? archiveFile(messages, `font/${MESSAGE_FONT}`)) : null;
      const font = bytes ? parseBfn(bytes) : null;
      this.font = font ? { font, sheets: decodeBfnSheets(font) } : null;
    }
    return this.font;
  }
}

/** A file of an archive by path (case-insensitive), unpacked. */
export function archiveFile(archive: RarcArchive, path: string): Uint8Array | null {
  const lower = path.toLowerCase();
  const file = archive.files.find((f) => f.path.toLowerCase() === lower);
  return file ? (isYaz0(file.data) ? decompressYaz0(file.data) : file.data) : null;
}
