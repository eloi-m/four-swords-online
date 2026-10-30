// The TV's message window in the adventure (main2D main_message_window.blo; main.dol's message manager [0x8053AED0],
// the request 0x8043D67C), as apps/battle shows it (banners.ts, timeline.ts: its plate's alpha 0, the text centered 4 px
// left and 1 px up, sliding in over 19 ticks, staying 160, out over 11; at the top, its top 13 px down, when a Link on
// the TV would be under it). Its one request so far: Shadow Link's "Defeat Shadow Link!" (sim shadowlink.ts
// shadowChallenge; the frame dumps show it at the top over the Links low on the screen).
import { bmgMessageById, findPane, type BloPane, type BloScreen, type Bmg, type BmgMessage } from "@fso/formats";
import { screenCamera, ScreenView, type ScreenAssets } from "@fso/render";
import { shadowChallenge, type AdventureGame } from "@fso/sim/adventure";
import * as THREE from "three";
import { MESSAGE_PLACE, messageAtTop, messageOffset } from "../../battle/src/timeline.ts";

const TV_W = 608, TV_H = 448;
const TEXT_DX = -4, TEXT_DY = -1;

export class MessageWindow {
  readonly scene = new THREE.Scene();
  readonly camera = screenCamera(TV_W, TV_H);
  private readonly view: ScreenView;
  private readonly root: BloPane;
  private readonly bmg: Bmg;
  /** The request shown and whether it went to the top (decided as it's placed). */
  private placed: { key: string; top: boolean } | null = null;
  private shown = "";
  /** What it shows now (tests): the text, its offset, top or bottom; "" for none. */
  last = "";

  constructor(screen: BloScreen, assets: ScreenAssets, bmg: Bmg) {
    for (const tag of ["Tmmt01", "Tmmt02"]) {
      const tb = findPane(screen, tag);
      if (tb?.kind !== "textbox") continue;
      tb.hBinding = 0;
      tb.x += TEXT_DX;
      tb.y += TEXT_DY;
    }
    this.view = new ScreenView(screen, assets);
    const plate = findPane(screen, "Pmmtp");
    if (plate) this.view.setPaneAlpha(plate, 0);
    this.root = screen.root;
    this.bmg = bmg;
    this.view.object.visible = false;
    this.scene.add(this.view.object);
  }

  /**
   * This frame's window: whether it shows. `links`: where the Links on the TV stand on the 608×448 screen, `px16`
   * what 16 room px make there (for the side it comes in from).
   */
  update(game: AdventureGame, links: readonly { x: number; y: number }[], px16: number): boolean {
    const request = shadowChallenge(game);
    const s = request ? game.tick - request.tick : 0, offset = request ? messageOffset(s) : null;
    const message: BmgMessage | undefined = request ? bmgMessageById(this.bmg, request.id) : undefined;
    if (!request || offset === null || !message) {
      this.placed = null;
      this.view.object.visible = false;
      this.last = "";
      return false;
    }
    const key = `${request.id}:${request.tick}`;
    if (this.placed?.key !== key) this.placed = { key, top: messageAtTop(links, px16) };
    const top = this.placed.top;
    this.view.object.visible = true;
    if (this.shown !== key) {
      this.shown = key;
      for (const tag of ["Tmmt01", "Tmmt02"]) this.view.setText(tag, message, { colors: tag === "Tmmt01" });
    }
    this.view.setPanePosition(this.root, this.root.x, this.root.y + (top ? MESSAGE_PLACE.top - MESSAGE_PLACE.bottom - offset : offset));
    this.last = `${request.id}|${offset}|${top ? "top" : "bottom"}`;
    return true;
  }
}
