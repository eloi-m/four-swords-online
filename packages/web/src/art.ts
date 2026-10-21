// The game's own menu art in the pages' HTML: textures of the title and menu archives (the logo, the title screen's
// sky, the Shadow Battle plate, the Link icons), decoded at runtime from the game files on the server like everything
// else. The build holds none of it, and a page looks right without it (theme.css): each piece replaces its text or
// its plain color once it arrives.
//   <span class="art-slot"><img data-art="logo" alt="" /><span class="art-text">Four Swords Online</span></span>
//   showArt(document, new GameArt(store))
import { decodeBti, decompressYaz0, isYaz0, parseRarc, type RarcArchive } from "@fso/formats";
import type { AssetStore } from "./assets.ts";

const ROOT = "GC4Sword_usa";

/** Each piece: the archive under GC4Sword_usa/ and the texture in its timg/ folder. */
export const ART = {
  logo: ["title.arc", "kk_titlelogo_01.bti"], // (logo.arc's is the Japanese one)
  sky: ["title.arc", "kk_titleback_01.bti"],
  battlePlate: ["gamemode.arc", "kk_modebat_01.bti"],
  shadowLink: ["gamemode.arc", "kk_shadowlink_01.bti"],
  link1: ["game2D.arc", "kk_linkg_01.bti"],
  link2: ["game2D.arc", "kk_linkr_01.bti"],
  link3: ["game2D.arc", "kk_linkb_01.bti"],
  link4: ["game2D.arc", "kk_linkp_01.bti"],
  heart: ["game2D.arc", "kk_heart_00.bti"],
} as const satisfies Record<string, readonly [string, string]>;
export type ArtName = keyof typeof ART;

export class GameArt {
  private readonly store: AssetStore;
  private readonly archives = new Map<string, Promise<RarcArchive | null>>();
  private readonly urls = new Map<ArtName, Promise<string | null>>();

  constructor(store: AssetStore) {
    this.store = store;
  }

  /** An archive the page has already parsed (saves reading it twice). */
  provide(path: string, archive: RarcArchive): void {
    this.archives.set(path, Promise.resolve(archive));
  }

  /** A piece as an image URL (a blob: URL, valid for the page's life), or null when the game files lack it. */
  url(name: ArtName): Promise<string | null> {
    let url = this.urls.get(name);
    if (!url) {
      const [path, texture] = ART[name];
      url = this.archive(path).then((archive) => (archive ? textureUrl(archive, texture) : null)).catch(() => null);
      this.urls.set(name, url);
    }
    return url;
  }

  /** An archive under GC4Sword_usa/ (parsed once, shared with the art), or null when the server lacks it. */
  archive(path: string): Promise<RarcArchive | null> {
    let archive = this.archives.get(path);
    if (!archive) {
      archive = this.store.read(`${ROOT}/${path}`).then(
        (bytes) => parseRarc(isYaz0(bytes) ? decompressYaz0(bytes) : bytes),
        () => null,
      );
      this.archives.set(path, archive);
    }
    return archive;
  }
}

/** A BTI texture of an archive as a PNG blob URL. */
async function textureUrl(archive: RarcArchive, name: string): Promise<string | null> {
  const file = archive.files.find((f) => f.path.toLowerCase() === `timg/${name}`.toLowerCase());
  if (!file) return null;
  const texture = decodeBti(isYaz0(file.data) ? decompressYaz0(file.data) : file.data);
  const canvas = document.createElement("canvas");
  canvas.width = texture.width;
  canvas.height = texture.height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(texture.data), texture.width, texture.height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? URL.createObjectURL(blob) : null;
}

/**
 * Puts the art into the page under `root`: `img[data-art]` get their source (and their `.art-slot` parent the
 * `has-art` class, which hides the text they stand for); `[data-art-bg]` get it as `--art` and the `art-ready` class.
 */
export async function showArt(root: ParentNode, art: GameArt): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const img of root.querySelectorAll<HTMLImageElement>("img[data-art]")) {
    jobs.push(
      art.url(img.dataset.art as ArtName).then((url) => {
        if (!url) return;
        img.addEventListener("load", () => img.closest(".art-slot")?.classList.add("has-art"), { once: true });
        img.src = url;
      }),
    );
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-art-bg]")) {
    jobs.push(
      art.url(el.dataset.artBg as ArtName).then((url) => {
        if (!url) return;
        el.style.setProperty("--art", `url("${url}")`);
        el.classList.add("art-ready");
      }),
    );
  }
  await Promise.all(jobs);
}
