// Battle HUD: the game's own J2D screen game2D.arc scrn/main_bat.blo (one corner per player: 1 top-left, 2 top-right,
// 3 bottom-left, 4 bottom-right) drawn over the TV frame, plus DOM text for the round timer (the game shows none; its
// own round screens are banners.ts and total.ts, in this HUD's scene).
// Every pane of main_bat is visible in the file (alternatives overlap), so the HUD picks what to show from the battle
// state, as main.dol's battle HUD does (docs/formats/j2d-and-bmg.md, "How the game drives main_bat"). It only reads the state, so
// any (rolled back) state can be drawn.
import { walkPanes, type BloPane, type BloScreen } from "@fso/formats";
import { screenCamera, ScreenView, SpriteMesh, type ScreenAssets, type SpriteAtlas } from "@fso/render";
import { COUNTDOWN_TICKS, HEART, screenAt, type BattleState, type GameState, type ItemKind } from "@fso/sim";
import * as THREE from "three";
import { cornerShown } from "./timeline.ts";

/** The tunics: green, red, blue, purple, then free play's yellow, cyan, white and black (a grey that reads on dark). */
export const PLAYER_COLORS = ["#3fbf4f", "#e0443c", "#3f7fe8", "#a05ad8", "#e2b81c", "#1fbfca", "#e4e4ee", "#6c6c82"];
/** Text over each player's color (the light tunics take dark text). */
export const PLAYER_INK = ["#fff", "#fff", "#fff", "#fff", "#2a2000", "#00292c", "#22222e", "#fff"];
export const playerName = (i: number) => `P${i + 1}`;
/** The game's Link icon for player i (art.ts link1-4; players 5-8 share the first four's). */
export const linkIcon = (i: number) => `link${(i % 4) + 1}`;

/** The screen the game draws the HUD in (J2D screen space: the whole TV frame). */
export const HUD_W = 608;
export const HUD_H = 448;
/** Heart slots per corner (two rows of four: lf01-04 on top, lf05-08 below, left to right). */
export const HEART_SLOTS = 8;
/**
 * A heart's texture by quarters left in it (1 … 4). main.dol's battle HUD (update 0x804257e4, hearts 0x80423804)
 * appends main2D's kk_heart_01-03 to each heart pane and its shadow and picks one per slot; checked in Dolphin on the
 * adventure HUD, which shares the logic. An empty heart inside the maximum isn't drawn: the second layer (lf09-16 and
 * their shadows, heart_04_2.bti, a small white dot) marks it instead.
 */
export const HEART_TEXTURES = [null, "kk_heart_03.bti", "kk_heart_02.bti", "kk_heart_01.bti", "heart.bti"] as const;
/** Per-player fade: a corner goes to 60 % of its alpha while the player has no hearts, by 0.1 per frame. */
const DEAD_ALPHA = 0.6;
const FADE_STEP = 0.1;
/**
 * The boxes a Link hides a corner from (main.dol 0x8043DF8C, called for every Link on the TV each frame: the message
 * manager's +0xDC bit, which fades the corner out): 188×123 at each corner of the screen, grown by what 16 room px
 * make on the screen, tested with the Link's place (his feet).
 */
export const CORNER_BOXES = [
  { x0: -1, x1: 187, y0: 0, y1: 123 },
  { x0: 420, x1: 608, y0: 0, y1: 123 },
  { x0: -1, x1: 187, y0: 346, y1: 469 },
  { x0: 420, x1: 608, y0: 346, y1: 469 },
] as const;

/** Which corners a Link stands in front of (screen points of every Link on the TV, `px16` = 16 room px on screen). */
export function cornersCovered(points: readonly ({ x: number; y: number } | null)[], px16: number): boolean[] {
  return CORNER_BOXES.map((c) => points.some((p) => !!p && p.x >= c.x0 - px16 && p.x <= c.x1 + px16 && p.y >= c.y0 - px16 && p.y <= c.y1 + px16));
}

/** The item box's icons (docs/formats/j2d-and-bmg.md "How the game drives main_bat"): icon k is the pane pair ii(2k+1) + its
 *  shadow ii(2k+2), k = 0 shield, 1 slingshot, 2 boomerang, 3 bow, 4 feather, 5 boots, 6 hammer, 7 fire rod, 8 bomb,
 *  9 mirror, 10 shovel, 11 lantern. */
const ITEM_ICON_COUNT = 12;
/**
 * The icon of each battle item a Link can hold: they all have one in that list (traced: an orb's cucco and carrot act
 * at once, the Four Sword levels the sword up, a heart is used on the spot; packages/sim orbs.ts).
 */
export const ITEM_ICONS: Partial<Record<ItemKind, number>> = { slingshot: 1, boomerang: 2, bow: 3, boots: 5, hammer: 6, fireRod: 7, bomb: 8 };
/**
 * While a Link is in a side room his corner's other groups (hearts, item box, bars…: all but the portrait group and the
 * disc) slide this far toward the screen's middle, 3 px a tick, and back the same way (main.dol 0x804257E4: the HUD's
 * +0xF8 per player, applied by 0x80424148; Dolphin frames: the hearts 15 px in).
 */
export const DISC_SLIDE = 15;
const DISC_SLIDE_STEP = 3;
/**
 * The Link's sprite in the disc (Dolphin frames of the castle's dark side: player_sob 63 at 1.5×, his feet at the disc
 * pane's anchor + (0, 11), in his TV colors). The HUD tells the stage where its disc is (0x804257E4 → stage +0x1D0),
 * which draws him there; `li01` (link_dot_test_02, 27×39 = 1.5 × a Link) stays hidden.
 */
export const DISC_SPRITE = { scale: 1.5, dy: 11 } as const;
/** The corner's portrait group (it doesn't slide): Ndata01 / 04 / 07 / 10 by corner, and the disc. */
const PORTRAIT_ROOT = /^(Ndata(01|04|07|10)|Pp[1-4]ra01)$/;

interface Slot {
  heart: BloPane;
  shadow: BloPane | null;
}

/** The panes of one player's corner, found by tag (the player digit aside) under the corner's top-level panes. */
class Corner {
  readonly roots: BloPane[] = [];
  hearts: Slot[] = [];
  /** Second layer on the same slots: the dot marking an empty heart. */
  hearts2: Slot[] = [];
  /** The item icons by index (ITEM_ICONS): each a pane and its shadow, and the file's texture; hidden but the held item's. */
  items: { panes: BloPane[]; texture: string }[] = [];
  /** The texture of the icon shown, "" for none (for tests). */
  icon = "";
  /** The L2 badge (le201-203), shown over a level-2 item; whether it shows (for tests). */
  badge: BloPane[] = [];
  level = false;
  /** Panes shown as they are in the file: the portrait disc and the face, the empty item box. */
  shown: BloPane[] = [];
  /**
   * Hidden in Shadow Battle, where every player plays in the HUD's "GBA" mode: the items (none at the start of a
   * round; update() shows the held one), the "no item" cross, the L2 badge, the Force Gem counter, the green and red
   * bars, the GBA-area disc.
   */
  hidden: BloPane[] = [];
  /** Every drawn pane with its file alpha, for the fade. */
  alphas: { pane: BloPane; alpha: number }[] = [];
  fade = 1;
  /** The GBA-area disc (ra01), and the face and its shadow it stands in for while the Link is in a side room. */
  disc: BloPane | null = null;
  faces: BloPane[] = [];
  /** The Link is in a side room (for tests). */
  inside = false;
  /** The factor last applied to `alphas`: the fade times the round screens' (timeline.ts cornerShown). */
  applied = 1;
  /** The groups that slide in while the Link is in a side room, and how far they are now (px toward the middle). */
  sliding: BloPane[] = [];
  slide = 0;
  /** The Link's sprite in the disc: a group at his feet, scaled, holding a mesh of his atlas. */
  sprite: THREE.Group | null = null;
  mesh: SpriteMesh | null = null;
  /** The sprite frame shown in the disc, -1 for none (tests). */
  discFrame = -1;
}

const pad = (n: number) => String(n).padStart(2, "0");
const generic = (tag: string) => tag.replace(/^(Pp?)[1-4]/, "$1");

function buildCorners(screen: BloScreen): Corner[] {
  const corners = Array.from({ length: 4 }, () => new Corner());
  // Top-level panes belong to the corner they sit in (tags aren't reliable: P2's "no item" cross is tagged Pp1noi03).
  for (const root of screen.root.children) corners[(root.x >= HUD_W / 2 ? 1 : 0) + (root.y >= HUD_H / 2 ? 2 : 0)]!.roots.push(root);
  for (const corner of corners) {
    corner.sliding = corner.roots.filter((r) => !PORTRAIT_ROOT.test(r.tag));
    const byTag = new Map<string, BloPane>();
    for (const root of corner.roots) {
      for (const { pane: p } of walkPanes(root)) {
        const tag = generic(p.tag);
        byTag.set(tag, p);
        if (/^Pp(ii\d\d|noi\d\d|mb\d\d|m\d\d|nm\d\d|ra01|li01)$/.test(tag) || /^P(le20\d|r?k?\d\d|sk?\d\d)$/.test(tag)) corner.hidden.push(p);
        if (/^Ple20\d$/.test(tag)) corner.badge.push(p);
        else if (/^Pp(ib\d\d|i0[12]|iib\d\d)$/.test(tag)) corner.shown.push(p);
        // The fade leaves the GBA-area disc alone.
        if (p.kind !== "pane" && !/^Ppra0[12]$/.test(tag)) corner.alphas.push({ pane: p, alpha: screen.materials[p.material]?.matColors[0]?.[3] ?? 255 });
      }
    }
    corner.disc = byTag.get("Ppra01") ?? null;
    corner.faces = ["Ppi01", "Ppi02"].flatMap((tag) => byTag.get(tag) ?? []);
    const slot = (n: number): Slot => ({ heart: byTag.get(`Pplf${pad(n)}`)!, shadow: byTag.get(`Pplfk${pad(n)}`) ?? null });
    corner.hearts = Array.from({ length: HEART_SLOTS }, (_, i) => slot(i + 1));
    corner.hearts2 = Array.from({ length: HEART_SLOTS }, (_, i) => slot(i + 9));
    corner.items = Array.from({ length: ITEM_ICON_COUNT }, (_, k) => {
      const panes = [byTag.get(`Ppii${pad(2 * k + 1)}`), byTag.get(`Ppii${pad(2 * k + 2)}`)].filter((p) => !!p);
      const pane = panes[0];
      const map = pane && pane.kind !== "pane" ? screen.materials[pane.material]?.textures[0] : null;
      return { panes, texture: map != null ? (screen.textures[map]?.name ?? "") : "" };
    });
  }
  return corners;
}

export class BattleHud {
  readonly view: ScreenView;
  readonly scene = new THREE.Scene();
  readonly camera = screenCamera(HUD_W, HUD_H);
  private readonly corners: Corner[];
  private readonly dom: DomOverlay;
  /** Last visibility/texture per pane, so unchanged panes aren't touched every frame. */
  private readonly visible = new Map<BloPane, boolean>();
  private readonly texture = new Map<BloPane, string>();
  private players = 0;
  /** The corners a Link stood in front of in the last update (tests). */
  covered: boolean[] = [false, false, false, false];

  constructor(screen: BloScreen, assets: ScreenAssets, dom: HTMLElement) {
    this.view = new ScreenView(screen, assets);
    this.scene.add(this.view.object);
    this.corners = buildCorners(screen);
    this.dom = new DomOverlay(dom);
  }

  /** Pane tags per corner, for tests and the docs. */
  describe(): { hearts: string[]; hearts2: string[]; shown: string[]; hidden: string[] }[] {
    return this.corners.map((c) => ({
      hearts: c.hearts.map((s) => s.heart.tag),
      hearts2: c.hearts2.map((s) => s.heart.tag),
      shown: c.shown.map((p) => p.tag),
      hidden: c.hidden.map((p) => p.tag),
    }));
  }

  /**
   * What each active corner shows: per heart slot "4" … "1" (quarters), "dot" (empty) or "-" (beyond the maximum);
   * the item icon shown (its texture, "" for none).
   */
  snapshot(): { hearts: string[]; item: string; level: boolean; fade: number; disc: boolean; discFrame: number; slide: number }[] {
    return this.corners.slice(0, this.players).map((c) => ({
      disc: c.inside,
      discFrame: c.discFrame,
      slide: c.slide,
      hearts: c.hearts.map((s, i) => {
        if (this.visible.get(s.heart)) return String(HEART_TEXTURES.indexOf(this.texture.get(s.heart) as (typeof HEART_TEXTURES)[number]));
        return this.visible.get(c.hearts2[i]!.heart) ? "dot" : "-";
      }),
      item: c.icon,
      level: c.level,
      fade: c.fade,
    }));
  }

  /** Corners in use (the players this HUD shows). */
  get shownPlayers(): number {
    return this.players;
  }

  /** Whether corner i shows the side-room disc (its Link in a side room), as last drawn. */
  inSideRoom(i: number): boolean {
    return i < this.players && !!this.corners[i]?.inside;
  }

  /** How much of corner i shows (0-1: its fades together), as last drawn. */
  cornerAlpha(i: number): number {
    return i < this.players ? (this.corners[i]?.applied ?? 0) : 0;
  }

  /** Tags of the top-level panes shown, per corner (unused corners must show none). */
  visibleRoots(): string[][] {
    return this.corners.map((c) => c.roots.filter((r) => this.visible.get(r) !== false).map((r) => r.tag));
  }

  reset(players: number): void {
    this.players = players;
    this.visible.clear();
    this.texture.clear();
    this.corners.forEach((corner, i) => {
      // Unused corners are hidden whole (their top-level panes); the others show the file's choice below.
      for (const root of corner.roots) this.setVisible(root, i < players);
      if (i >= players) return;
      for (const p of corner.hidden) this.setVisible(p, false);
      for (const p of corner.shown) this.setVisible(p, true);
      corner.fade = corner.applied = 1;
      for (const { pane, alpha } of corner.alphas) this.view.setPaneAlpha(pane, alpha);
      corner.slide = 0;
      for (const root of corner.sliding) this.view.setPanePosition(root, root.x, root.y);
      if (corner.sprite) corner.sprite.visible = false;
      corner.discFrame = -1;
    });
    this.dom.reset();
  }

  /**
   * Draws the state. `links`: where the Links stand on the screen (ArenaView.screenLinks), for the corners they hide
   * (multiplayer only in the game: every battle here); `sprite`: Link i's sprite as the arena draws it
   * (ArenaView.linkSprite), for the disc of a Link in a side room.
   */
  update(
    game: GameState,
    links?: { points: readonly ({ x: number; y: number } | null)[]; px16: number },
    sprite?: (i: number) => { atlas: SpriteAtlas; frame: number } | null,
  ): void {
    const b = game.battle;
    if (!b) return;
    const covered = links ? cornersCovered(links.points, links.px16) : [false, false, false, false];
    this.covered = covered;
    this.corners.forEach((corner, i) => {
      const f = b.fighters[i];
      if (i >= this.players || !f) return;
      // (A cucco can bring a Link past his starting life, up to 16: packages/sim cucco.ts.)
      const max = Math.min(HEART_SLOTS, Math.max(Math.ceil(b.rules.hearts), Math.ceil(f.hearts / HEART)));
      corner.hearts.forEach((s, h) => {
        const quarters = h < max ? Math.min(4, Math.max(0, Math.round(((f.hearts - h * HEART) * 4) / HEART))) : 0;
        const texture = HEART_TEXTURES[quarters];
        this.setSlot(s, !!texture);
        this.setSlot(corner.hearts2[h]!, h < max && !texture);
        if (!texture) return;
        this.setTexture(s.heart, texture);
        if (s.shadow) this.setTexture(s.shadow, texture);
      });
      // The item in hand: its icon and shadow, the others hidden (the box itself always shows).
      const icon = f.item ? (ITEM_ICONS[f.item] ?? -1) : -1;
      corner.items.forEach((pair, k) => {
        for (const p of pair.panes) this.setVisible(p, k === icon);
      });
      corner.icon = icon < 0 ? "" : corner.items[icon]!.texture;
      // The L2 badge over a level-2 item (docs/formats/j2d-and-bmg.md "How the game drives main_bat").
      corner.level = icon >= 0 && f.itemLevel >= 2;
      for (const p of corner.badge) this.setVisible(p, corner.level);
      // In a side room (a GBA screen: packages/sim siderooms.ts) the black disc stands in for the portrait (traced).
      const inside = screenAt(game.players[i]?.y ?? 0) > 0 && f.mode !== "dead";
      if (corner.disc) this.setVisible(corner.disc, inside);
      for (const p of corner.faces) this.setVisible(p, !inside);
      corner.inside = inside;
      this.discSprite(corner, inside ? (sprite?.(i) ?? null) : null);
      // The other groups slide in while he's there, and back (a presentation-side step, as the fades).
      const slide = inside ? Math.min(DISC_SLIDE, corner.slide + DISC_SLIDE_STEP) : Math.max(0, corner.slide - DISC_SLIDE_STEP);
      if (slide !== corner.slide) {
        corner.slide = slide;
        const dx = i % 2 === 0 ? slide : -slide;
        for (const root of corner.sliding) this.view.setPanePosition(root, root.x + dx, root.y);
      }
      // A presentation-side fade (it settles in 4 frames), so it needs no history from the state; times the corner's
      // part in the round's screens (faded in during the intro, out at the round's end), which the state gives.
      const target = covered[i] ? 0 : f.hearts > 0 ? 1 : DEAD_ALPHA;
      if (corner.fade !== target) corner.fade = corner.fade < target ? Math.min(target, corner.fade + FADE_STEP) : Math.max(target, corner.fade - FADE_STEP);
      const applied = corner.fade * cornerShown(b, i);
      if (corner.applied !== applied) {
        corner.applied = applied;
        for (const { pane, alpha } of corner.alphas) this.view.setPaneAlpha(pane, alpha * applied);
      }
    });
    this.dom.update(b);
  }

  /** Places the DOM text over the TV frame (CSS px). */
  place(rect: { x: number; y: number; w: number; h: number }): void {
    this.dom.place(rect);
  }

  dispose(): void {
    this.view.dispose();
    for (const c of this.corners) this.dropDiscMesh(c);
  }

  /** The Link's sprite in his corner's disc (DISC_SPRITE), or none. */
  private discSprite(corner: Corner, sprite: { atlas: SpriteAtlas; frame: number } | null): void {
    corner.discFrame = sprite && corner.disc ? sprite.frame : -1;
    if (!sprite || !corner.disc) {
      if (corner.sprite) corner.sprite.visible = false;
      return;
    }
    if (!corner.sprite) {
      corner.sprite = new THREE.Group();
      corner.sprite.renderOrder = 1; // (over the HUD's screen, under the ranks' ring)
      corner.sprite.scale.set(DISC_SPRITE.scale, DISC_SPRITE.scale, 1);
      // The disc pane's anchor in the HUD's space (a top-level pane: its x, y), y up in this scene.
      corner.sprite.position.set(corner.disc.x, -(corner.disc.y + DISC_SPRITE.dy), 0.5);
      this.scene.add(corner.sprite);
    }
    if (!corner.mesh || corner.mesh.material.uniforms.uMap!.value !== sprite.atlas.texture) {
      this.dropDiscMesh(corner);
      const mesh = new SpriteMesh(sprite.atlas);
      mesh.material.depthTest = false;
      mesh.material.transparent = true; // (drawn with the HUD's transparent panes, in render order: over the disc)
      mesh.renderOrder = 1;
      corner.mesh = mesh;
      corner.sprite.add(mesh);
    }
    corner.mesh.setFrame(sprite.frame);
    corner.mesh.place(0, 0, 0);
    corner.sprite.visible = true;
  }

  private dropDiscMesh(corner: Corner): void {
    if (!corner.mesh) return;
    corner.mesh.removeFromParent();
    corner.mesh.geometry.dispose();
    corner.mesh.material.dispose();
    corner.mesh = null;
  }

  private setSlot(s: Slot, visible: boolean): void {
    this.setVisible(s.heart, visible);
    if (s.shadow) this.setVisible(s.shadow, visible);
  }

  private setVisible(pane: BloPane, visible: boolean): void {
    if (this.visible.get(pane) === visible) return;
    this.visible.set(pane, visible);
    this.view.setPaneVisible(pane, visible);
  }

  private setTexture(pane: BloPane, name: string): void {
    if (this.texture.get(pane) === name) return;
    if (!this.view.setPaneTexture(pane, name)) console.warn(`HUD texture ${name} not found`);
    this.texture.set(pane, name);
  }
}

/** The round timer (text the game doesn't have: it shows only the last five seconds, banners.ts). */
class DomOverlay {
  private readonly root: HTMLElement;
  private readonly timer: HTMLElement;
  private shown = "";
  private placed = "";

  constructor(root: HTMLElement) {
    this.root = root;
    this.timer = el("div", "timer");
    root.replaceChildren(this.timer);
  }

  reset(): void {
    this.shown = "";
  }

  place(rect: { x: number; y: number; w: number; h: number }): void {
    const key = `${rect.x},${rect.y},${rect.w},${rect.h}`;
    if (key === this.placed) return;
    this.placed = key;
    Object.assign(this.root.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
    this.root.style.setProperty("--scale", String(rect.h / HUD_H));
  }

  update(b: BattleState): void {
    const shown = b.rules.timeLimit > 0 && (b.phase === "countdown" || b.phase === "play");
    const key = shown ? clock(b) : "";
    if (key === this.shown) return;
    this.shown = key;
    this.timer.textContent = key;
    this.timer.hidden = !shown;
  }
}

function clock(b: BattleState): string {
  const s = Math.ceil(b.timeLeft / 60);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}
