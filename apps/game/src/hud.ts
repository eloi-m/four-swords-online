// The adventure's HUD: game2D.arc's J2D screen scrn/main_adv.blo over the TV frame, its single-player group (Ph*: up
// to 8 hearts at Ndata16, the item box Ph1piib3, the Force Gem counter Ndata13), as the game shows it playing alone
// with a controller (Dolphin, Lake Hylia: the grey item box, 4 hearts, "0004"). The four players' corners are hidden.
// Hearts follow main.dol's heart code (apps/battle hud.ts has the rules, checked on this HUD in Dolphin): per slot a
// full heart or kk_heart_01-03 for 3, 2, 1 quarters, the dot (heart_04_2) for an empty slot within the maximum. The
// counter: four digits with leading zeros on main2D's kk_rupyNum_00-09, the fifth hidden (docs/formats/j2d-and-bmg.md "How the game
// drives main_bat"). The item box: the leader's item's icon pair Php1ii(2k+1) + shadow, the others hidden (the icons'
// order is main_bat's, apps/battle hud.ts; Dolphin frame dumps, the Cave of No Return room 8: the lantern while the
// lamp is held, the bow once taken). It only reads the state.
import { findPane, type BloPane, type BloScreen } from "@fso/formats";
import { screenCamera, ScreenView, type ScreenAssets } from "@fso/render";
import { HEART } from "@fso/sim";
import type { AdventureGame, GearKind } from "@fso/sim/adventure";
import * as THREE from "three";

export const HUD_W = 608;
export const HUD_H = 448;
const HEART_SLOTS = 8;
const HEART_TEXTURES = [null, "kk_heart_03.bti", "kk_heart_02.bti", "kk_heart_01.bti", "heart.bti"] as const;
/** The single-player group's top-level panes, shown; every other top-level pane is a player corner, hidden. */
const SINGLE_PLAYER = ["Ndata16", "Ph1piib3", "Ndata13"];
const DIGITS = 4;
const ITEM_ICON_COUNT = 12;
/** Each item's icon k (pane pair Php1ii(2k+1), ii(2k+2)): 0 shield, 1 slingshot, 2 boomerang, 3 bow, 4 feather, 5 boots,
 *  6 hammer, 7 fire rod, 8 bomb, 9 mirror, 10 shovel, 11 lantern. */
export const GEAR_ICONS: Readonly<Record<Exclude<GearKind, "">, number>> = {
  slingshot: 1, boomerang: 2, bow: 3, feather: 4, boots: 5, hammer: 6, fireRod: 7, bombs: 8, shovel: 10, lamp: 11,
};

interface Slot {
  heart: BloPane;
  shadow: BloPane | null;
}

export class AdventureHud {
  readonly view: ScreenView;
  readonly scene = new THREE.Scene();
  readonly camera = screenCamera(HUD_W, HUD_H);
  private readonly hearts: Slot[] = [];
  private readonly hearts2: Slot[] = [];
  private readonly digits: { digit: BloPane; shadow: BloPane | null }[] = [];
  private readonly visible = new Map<BloPane, boolean>();
  private readonly texture = new Map<BloPane, string>();
  private readonly items: BloPane[][] = [];
  /** What's shown (for tests): per heart slot "4" … "1", "dot" or "-"; the counter's digits; the item icon's index (-1 none). */
  shown = { hearts: [] as string[], gems: "", icon: -1 };

  constructor(screen: BloScreen, assets: ScreenAssets) {
    this.view = new ScreenView(screen, assets);
    this.scene.add(this.view.object);
    for (const pane of screen.root.children) this.setVisible(pane, SINGLE_PLAYER.includes(pane.tag));
    const pane = (tag: string) => findPane(screen, tag);
    for (let i = 1; i <= HEART_SLOTS; i++) {
      const two = (n: number) => String(n).padStart(2, "0");
      this.hearts.push({ heart: pane(`Php1lf${two(i)}`)!, shadow: pane(`Php1lk${two(i)}`) });
      this.hearts2.push({ heart: pane(`Php1lf${two(i + 8)}`)!, shadow: pane(`Php1lk${two(i + 8)}`) });
    }
    for (let i = 1; i <= 5; i++) this.digits.push({ digit: pane(`Ph1ps0${i}`)!, shadow: pane(`Ph1psk0${i}`) });
    // The item box: its icons, level badge and cross hidden (update() shows the item held's icon).
    const box = pane("Ph1piib3");
    for (const child of box?.children ?? []) if (!/^Ph1piib/.test(child.tag)) this.setVisible(child, false);
    for (let k = 0; k < ITEM_ICON_COUNT; k++) {
      const two = (n: number) => String(n).padStart(2, "0");
      this.items.push([pane(`Php1ii${two(2 * k + 1)}`), pane(`Php1ii${two(2 * k + 2)}`)].filter((p) => !!p));
    }
    this.setVisible(this.digits[4]!.digit, false);
    if (this.digits[4]!.shadow) this.setVisible(this.digits[4]!.shadow, false);
  }

  update(game: AdventureGame): void {
    const f = game.battle.fighters[0];
    if (!f) return;
    const max = Math.min(HEART_SLOTS, game.battle.rules.hearts);
    this.shown.hearts = this.hearts.map((s, h) => {
      const quarters = h < max ? Math.min(4, Math.max(0, f.hearts - h * HEART)) : 0;
      const texture = HEART_TEXTURES[quarters];
      this.setSlot(s, !!texture);
      this.setSlot(this.hearts2[h]!, h < max && !texture);
      if (!texture) return h < max ? "dot" : "-";
      this.setTexture(s.heart, texture);
      if (s.shadow) this.setTexture(s.shadow, texture);
      return String(quarters);
    });
    const gear = game.adventure.gear, icon = gear ? GEAR_ICONS[gear] : -1;
    this.shown.icon = icon;
    this.items.forEach((panes, k) => {
      for (const p of panes) this.setVisible(p, k === icon);
    });
    const gems = String(Math.min(9999, game.adventure.gems)).padStart(DIGITS, "0");
    this.shown.gems = gems;
    for (let i = 0; i < DIGITS; i++) {
      const name = `kk_rupyNum_0${gems[i]}.bti`;
      const d = this.digits[i]!;
      this.setTexture(d.digit, name);
      if (d.shadow) this.setTexture(d.shadow, name);
    }
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
