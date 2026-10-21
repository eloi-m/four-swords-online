// The game's menu art for this page's screens (the Link icons, the heart, the Shadow Battle plate, the sky): one
// GameArt, set by main.ts once the game files are open. Screens that build their HTML later call fillArt on it.
import { showArt, type GameArt } from "@fso/web";

let art: GameArt | null = null;

export function setMenuArt(value: GameArt): void {
  art = value;
  void showArt(document, value);
  void value.url("sky").then((url) => url && document.documentElement.style.setProperty("--sky-art", `url("${url}")`));
}

/** Puts the art into freshly built HTML under `root` (`img[data-art]`, `[data-art-bg]`: see @fso/web's art.ts). */
export function fillArt(root: ParentNode): void {
  if (art) void showArt(root, art);
}
