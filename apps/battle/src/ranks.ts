// The battle HUD's ranking labels (game2D.arc main_bat_ranking.blo, the HUD's second screen in main.dol): "1st" …
// "4th" (main2D kk_mainRank_01-04, IA4) by each player's portrait while the players' lives differ, and over the
// Links' heads for a while after play starts and after the ranking changes (frame dumps: 180 ticks). The ranking is
// by life, ties sharing the better rank (1st, 1st, 3rd); each rank has its colors (main.dol 0x80422824: four corner
// colors and the white, i.e. TEV C1). A label over a head is 16 room px tall, its middle 27 px over the Link's feet.
// Presentation only: what it remembers (when the ranking last changed) is a tick of the state, reset each round.
import { findPane, type BloPane, type BloScreen, type Rgba } from "@fso/formats";
import { ScreenView } from "@fso/render";
import type { BattleState, GameState } from "@fso/sim";
import * as THREE from "three";
import { ORDER } from "./banners.ts";
import type { ScreenFiles } from "./screen-files.ts";

/** Per rank: the label's corner colors (TL, TR, BL, BR) and its white (C1). */
export const RANK_COLORS: { corners: [Rgba, Rgba, Rgba, Rgba]; white: Rgba }[] = [
  { corners: [[255, 157, 16, 255], [185, 84, 18, 255], [216, 58, 22, 255], [185, 18, 18, 255]], white: [255, 255, 255, 255] },
  { corners: [[252, 255, 33, 255], [242, 171, 36, 255], [242, 72, 9, 255], [242, 72, 9, 255]], white: [255, 255, 255, 255] },
  { corners: [[255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255]], white: [255, 255, 119, 255] },
  { corners: [[255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255]], white: [216, 255, 161, 255] },
];
const RANK_TEXTURES = ["kk_mainRank_01.bti", "kk_mainRank_02.bti", "kk_mainRank_03.bti", "kk_mainRank_04.bti"];
/** How long the labels over the heads stay up after play starts or the ranking changes (frame dumps). */
export const HEAD_TICKS = 180;
const HEAD_SIZE = 16, HEAD_LIFT = 27;

/** Each fighter's rank (0 = 1st) by hearts, ties sharing the better one; -1 for players gone from the match. */
export function ranks(b: BattleState): number[] {
  const gone = (i: number) => b.fighters[i]!.mode === "dead" && (b.downs[i] ?? -1) < 0;
  return b.fighters.map((f, i) => (gone(i) ? -1 : b.fighters.filter((g, j) => !gone(j) && g.hearts > f.hearts).length));
}

interface Label {
  shadow: BloPane;
  label: BloPane;
}

export class RankLabels {
  readonly group = new THREE.Group();
  private readonly corner: ScreenView;
  private readonly head: ScreenView;
  private readonly corners: Label[];
  /** Per corner the ring round the side-room disc (Pp{n}ra02, kk_mainCircle_01 in the player's color). */
  private readonly rings: (BloPane | null)[];
  private readonly heads: Label[];
  private readonly headScreen: BloScreen;
  /** The ranking last seen and the tick it changed (or play started), per round. */
  private seen = "";
  private changed = -1;
  private round = -1;
  private readonly shown = new Map<string, string>();
  /** What the last update showed (tests): per player the corner's label, the head's (rank or -1). */
  last: { corner: number[]; head: number[] } = { corner: [], head: [] };

  constructor(files: ScreenFiles) {
    const load = () => files.screen("game2D.arc", "main_bat_ranking.blo");
    const screen = load(), headScreen = load();
    if (!screen || !headScreen) throw new Error("no game2D.arc scrn/main_bat_ranking.blo");
    this.headScreen = headScreen;
    const assets = files.assetsFor("main2D.arc");
    const labels = (s: BloScreen): Label[] => [1, 2, 3, 4].map((n) => ({ shadow: findPane(s, `P${n}1st02`)!, label: findPane(s, `P${n}1st01`)! }));
    this.corner = new ScreenView(screen, assets);
    this.head = new ScreenView(headScreen, assets);
    this.corners = labels(screen);
    this.rings = [1, 2, 3, 4].map((n) => findPane(screen, `Pp${n}ra02`));
    this.heads = labels(headScreen);
    for (const view of [this.corner, this.head]) {
      view.object.renderOrder = ORDER.ranks;
      // The rings (the side-room disc's: update's `inside`) and every label start hidden.
      for (const pane of view.screen.root.children) view.setPaneVisible(pane, false);
      this.group.add(view.object);
    }
  }

  /**
   * Draws the labels for `game`. `corner(i)`: player i's corner factor (the HUD's fades, 0-1); `heads`: where each Link's
   * feet are on the 608×448 screen and how many screen px 16 room px make (ArenaView.screenLinks); `inside(i)`: Link i
   * is in a side room, his portrait the black disc (hud.ts), with this screen's ring round it (main.dol 0x804257E4).
   */
  update(
    game: GameState,
    players: number,
    corner: (i: number) => number,
    heads: { points: readonly ({ x: number; y: number } | null)[]; px16: number },
    inside: (i: number) => boolean = () => false,
  ): void {
    const b = game.battle;
    const rank = b && b.phase !== "free" && players > 0 ? ranks(b) : [];
    if (b && b.round !== this.round) {
      this.round = b.round;
      this.seen = "";
      this.changed = -1;
    }
    const key = rank.join();
    const playing = b?.phase === "play";
    if (b && playing && key !== this.seen) {
      // Play's first tick, or a change: the labels go up over the heads again.
      this.seen = key;
      this.changed = game.tick - (this.changed < 0 ? b.phaseTick : 0);
    }
    const differ = rank.some((r) => r > 0);
    const headsUp = !!b && this.changed >= 0 && game.tick - this.changed < HEAD_TICKS && (b.phase === "play" || b.phase === "roundOver");
    const shownCorner: number[] = [], shownHead: number[] = [];
    for (let i = 0; i < 4; i++) {
      const ring = this.rings[i], round = i < players && inside(i);
      if (ring && this.set(`ring${i}`, String(round))) this.corner.setPaneVisible(ring, round);
      const r = i < players ? (rank[i] ?? -1) : -1;
      const c = differ && r >= 0 ? corner(i) : 0;
      shownCorner.push(c > 0 ? r : -1);
      this.draw(this.corner, this.corners[i]!, `c${i}`, c > 0 ? r : -1, c);
      const at = heads.points[i];
      const h = headsUp && r >= 0 && at ? r : -1;
      shownHead.push(h);
      this.draw(this.head, this.heads[i]!, `h${i}`, h, 1);
      if (h >= 0 && at) {
        const scale = (HEAD_SIZE * heads.px16) / 16 / this.heads[i]!.label.height;
        const lift = (HEAD_LIFT * heads.px16) / 16, half = (this.heads[i]!.label.width * scale) / 2;
        const x = Math.round((at.x - half) * 4) / 4, y = Math.round((at.y - lift - half) * 4) / 4;
        if (this.set(`hp${i}`, `${x},${y},${scale}`)) this.head.setPaneTransform(this.heads[i]!.shadow, { x, y, scaleX: scale, scaleY: scale });
      }
    }
    this.last = { corner: shownCorner, head: shownHead };
  }

  dispose(): void {
    this.corner.dispose();
    this.head.dispose();
  }

  private draw(view: ScreenView, l: Label, key: string, rank: number, alpha: number): void {
    if (!this.set(key, `${rank}|${alpha}`)) return;
    view.setPaneVisible(l.shadow, rank >= 0);
    if (rank < 0) return;
    const colors = RANK_COLORS[rank]!;
    if (this.set(`${key}t`, String(rank))) {
      view.setPaneTexture(l.label, RANK_TEXTURES[rank]!);
      view.setPaneTexture(l.shadow, RANK_TEXTURES[rank]!);
      if (l.label.kind === "picture") {
        view.setMaterialTevColor(l.label.material, 1, colors.white);
        view.setPaneCornerColors(l.label, colors.corners);
      }
    }
    view.setPaneAlpha(l.label, 255 * alpha);
    view.setPaneAlpha(l.shadow, 200 * alpha);
  }

  private set(key: string, value: string): boolean {
    if (this.shown.get(key) === value) return false;
    this.shown.set(key, value);
    return true;
  }
}
