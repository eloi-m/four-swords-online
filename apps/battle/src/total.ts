// Shadow Battle's Total screen (result.arc total.blo + total_star.blo, as the game shows it after each battle; seen in
// Dolphin, docs/measurements/screens.md "J2D screens in Dolphin"): the castle wall fades in, the panel slides up from below
// and the "Total" scroll drops in; per player a column (portrait, P1-P4, 16 star slots in rows of blue, purple,
// pink and green), the columns of absent players darkened, one column lit (the game's: the player at the controls);
// the round's winner smiles (kk_link?_02); the star just won flies onto its slot (total_star.bck frames 0-19, faded
// in), then pulses every 120 ticks with its glint (frames 79-109, total_star.brk at the same frame). Continue / Quit
// (BMG 0x10D / 0x10E) with the cursor's pulsing highlight at the match's end. Everything from the tick `s` of the
// sequence (timeline.ts TOTAL) and the state, so rollbacks redraw it the same.
import { BATTLE_MESSAGE_IDS, bmgMessageById, findPane, fsaParticlePlacement, parseJpac, walkPanes, type BloPane, type BloScreen } from "@fso/formats";
import { JpaEffects, ScreenAnimator, ScreenView, type JpaEffectSpec, type ScreenAnimationPlayer } from "@fso/render";
import * as THREE from "three";
import { ORDER } from "./banners.ts";
import type { ScreenFiles } from "./screen-files.ts";
import { TOTAL } from "./timeline.ts";

export interface TotalState {
  /** Ticks into the sequence (TOTAL). */
  s: number;
  /** Stars per player, the new one included. */
  stars: number[];
  /** Who just won a star (it flies in), -1 for none (a draw). */
  winner: number;
  /** The lit column (the player at this screen), -1 for none. */
  highlight: number;
  /** Continue (0) or Quit (1) under the cursor; null: no buttons (between rounds). */
  cursor: 0 | 1 | null;
}

/** The buttons' faces on the 608×448 screen (the file's places; for pointer hits and the DOM buttons over them). */
export const TOTAL_BUTTONS = {
  continue: { x: 278, y: 373, w: 120, h: 61 },
  quit: { x: 434, y: 373, w: 120, h: 61 },
} as const;
const QUIT_DX = TOTAL_BUTTONS.quit.x - TOTAL_BUTTONS.continue.x;
const BMG_CONTINUE = BATTLE_MESSAGE_IDS.pause.continue, BMG_QUIT = BATTLE_MESSAGE_IDS.pause.quit;
/** The panes that slide up with the panel (the rest of the top level: the wall, the scroll, the buttons, the light). */
const PANEL = /^(Ndata03|Pblk0[1-3])$/;
const BUTTONS = /^(Pnob04|Pyesb04|Paccur02)$/;
/** Continue's and Quit's buttons, each sliding up on its own (TOTAL.buttons). */
const SLIDING_BUTTONS = ["Pyesb04", "Pnob04"] as const;

interface Slot {
  /** The star's shadow (its parent) and the star. */
  shadow: BloPane;
  star: BloPane;
  /** Where its anchor is on the screen. */
  at: [number, number];
}

export class TotalScreen {
  readonly view: ScreenView;
  private readonly starView: ScreenView | null;
  private readonly screen: BloScreen;
  private readonly starScreen: BloScreen | null;
  private readonly slots: Slot[][];
  private readonly moving: BloPane[];
  private readonly scroll: BloPane | null;
  private readonly cursorPane: BloPane | null;
  private readonly buttons: BloPane[];
  private readonly star: BloPane | null;
  private readonly starShadow: BloPane | null;
  private readonly starAt: [number, number];
  /** total_star.blo moved this much: its star onto the slot. */
  private starOffset: [number, number] = [0, 0];
  private readonly players: { cur: BloPane | null; dim: BloPane | null; smile: BloPane | null; own: BloPane[] }[];
  private readonly animator: ScreenAnimator | null;
  private readonly anims: ScreenAnimationPlayer[] = [];
  private readonly shown = new Map<string, string>();
  /** The star's sparkles: data.arc's particle.jpc (parsed the first time a star flies) and its effects. */
  private readonly jpac: Uint8Array | null;
  private effects: JpaEffects | null = null;
  private readonly sparkleGroup = new THREE.Group();
  /** The state last drawn (tests). */
  last: TotalState | null = null;

  constructor(files: ScreenFiles) {
    const screen = files.screen("result.arc", "total.blo");
    if (!screen) throw new Error("no result.arc scrn/total.blo");
    this.screen = screen;
    this.jpac = files.file("data.arc", "particle.jpc");
    this.sparkleGroup.renderOrder = ORDER.total + 2;
    this.sparkleGroup.visible = false;
    const pane = (tag: string) => findPane(screen, tag);
    const assets = files.assetsFor("result.arc");
    this.view = new ScreenView(screen, assets);
    this.view.object.renderOrder = ORDER.total;
    this.view.object.visible = false;
    // Slots: P{n}kak{k} (the shadow) holding P{n}ka{k}, n = 1-4, k = 1-16.
    this.slots = [1, 2, 3, 4].map((n) =>
      Array.from({ length: 16 }, (_, k) => {
        const tag = `${n}ka${String(k + 1).padStart(2, "0")}`;
        return { shadow: pane(`P${n}kak${tag.slice(3)}`)!, star: pane(`P${tag}`)!, at: absolute(screen, `P${n}kak${tag.slice(3)}`) };
      }),
    );
    this.moving = screen.root.children.filter((p) => PANEL.test(p.tag));
    this.buttons = screen.root.children.filter((p) => BUTTONS.test(p.tag));
    this.scroll = pane("Pttlbk05");
    this.cursorPane = pane("Paccur02");
    this.players = [1, 2, 3, 4].map((n) => ({
      cur: pane(`Pbcur0${n}`),
      dim: n > 1 ? pane(`Pblk0${n - 1}`) : null,
      smile: pane(`Pp${n}i03`),
      // (an absent player's column has no portrait and no label: Dolphin)
      own: [pane(`Ndata00${n}`), pane(`P${n}P02`)].filter((p) => !!p),
    }));
    const light = pane("Pstarli");
    if (light) this.view.setPaneVisible(light, false); // (main.dol never loads total.brk, which pulses it)
    if (files.bmg) {
      const text = (id: number) => bmgMessageById(files.bmg!, id);
      const yes = text(BMG_CONTINUE), no = text(BMG_QUIT);
      if (yes) this.view.setText("Tyes01", yes);
      if (no) this.view.setText("Tno01", no);
    } else {
      this.view.setText("Tyes01", "Continue");
      this.view.setText("Tno01", "Quit");
    }
    // The flying star: its own screen, moved onto the slot, total_star.bck + .brk seeked to the sequence's frame.
    this.starScreen = files.screen("result.arc", "total_star.blo");
    if (this.starScreen) {
      const stars = this.starScreen;
      this.starView = new ScreenView(stars, assets);
      this.starView.object.renderOrder = ORDER.total + 1;
      this.starView.object.visible = false;
      this.star = findPane(stars, "P0ka00");
      this.starShadow = findPane(stars, "P0kak00");
      this.starAt = absolute(stars, "P0kak00");
      const lightStar = findPane(stars, "Pstarli");
      this.animator = new ScreenAnimator(this.starView);
      for (const name of ["total_star.bck", "total_star.brk"]) {
        const anim = files.animation("result.arc", name);
        if (anim) this.anims.push(this.animator.add(anim, { playing: false }));
      }
      if (lightStar && !this.anims.length) this.starView.setPaneVisible(lightStar, false);
    } else {
      [this.starView, this.star, this.starShadow, this.animator] = [null, null, null, null];
      this.starAt = [0, 0];
    }
  }

  /** The views' objects, to add to the HUD's scene. */
  get objects(): THREE_Object[] {
    return [this.view.object, ...(this.starView ? [this.starView.object] : []), this.sparkleGroup];
  }

  /** Draws the screen at `state.s` (hidden before the arena has faded out), or hides it (null). */
  update(state: TotalState | null): void {
    this.last = state;
    const view = this.view;
    const shown = !!state && state.s >= TOTAL.wall;
    if (this.set("shown", shown ? "1" : "")) {
      view.object.visible = shown;
      if (this.starView) this.starView.object.visible = false;
      if (!shown) this.shown.delete("star");
    }
    if (!state || !shown) {
      this.sparkleGroup.visible = false;
      return;
    }
    const { s } = state;
    // The panel slides up (its first offsets), the scroll drops in after it.
    const slide = s < TOTAL.panel ? TOTAL.panelSlide[0]! + 200 : s - TOTAL.panel < TOTAL.panelSlide.length ? TOTAL.panelSlide[s - TOTAL.panel]! : 0;
    if (this.set("slide", String(slide))) for (const p of this.moving) view.setPanePosition(p, p.x, p.y + slide);
    const drop = s < TOTAL.scroll ? -140 : s - TOTAL.scroll < TOTAL.scrollDrop.length ? TOTAL.scrollDrop[s - TOTAL.scroll]! : 0;
    if (this.scroll && this.set("drop", String(drop))) view.setPanePosition(this.scroll, this.scroll.x, this.scroll.y + drop);
    // Columns: the players present, the lit one, the winner's smile.
    const present = state.stars.length;
    const columns = JSON.stringify([present, state.highlight, state.winner]);
    if (this.set("columns", columns)) {
      this.players.forEach((p, i) => {
        if (p.cur) view.setPaneVisible(p.cur, i === state.highlight);
        if (p.dim) view.setPaneVisible(p.dim, i >= present);
        if (p.smile) view.setPaneVisible(p.smile, i === state.winner);
        for (const own of p.own) view.setPaneVisible(own, i < present);
      });
    }
    const lit = state.highlight >= 0 ? this.players[state.highlight]?.cur : null;
    if (lit && this.set("lit", String(litAlpha(s)))) view.setPaneAlpha(lit, litAlpha(s));
    // The stars won before (the new one's slot stays empty: the flying star lands on it and stays).
    const newSlot = state.winner >= 0 ? (state.stars[state.winner] ?? 0) - 1 : -1;
    const stars = JSON.stringify([state.stars, newSlot]);
    if (this.set("stars", stars)) {
      this.slots.forEach((row, n) =>
        row.forEach((slot, k) => {
          const won = k < (state.stars[n] ?? 0) && !(n === state.winner && k === newSlot);
          view.setPaneVisible(slot.shadow, won);
        }),
      );
    }
    this.flyingStar(state, newSlot);
    this.sparkles(state, newSlot);
    // The buttons, each sliding up from below, and the cursor's highlight (from the Confirm prompt's tick: a 60-tick
    // pulse, eased).
    const buttons = state.cursor !== null;
    if (this.set("buttons", String(buttons))) for (const p of this.buttons) view.setPaneVisible(p, buttons);
    if (buttons) {
      SLIDING_BUTTONS.forEach((tag, i) => {
        const p = this.buttons.find((b) => b.tag === tag), k = s - TOTAL.buttons[i]!;
        const dy = k < 0 ? 200 : k < TOTAL.buttonSlide.length ? TOTAL.buttonSlide[k]! : 0;
        if (p && this.set(tag, String(dy))) view.setPanePosition(p, p.x, p.y + dy);
      });
    }
    if (this.cursorPane && buttons) {
      const t = s - (TOTAL.star + 1);
      const alpha = t < 0 ? 0 : cursorAlpha(t % 60);
      const at = state.cursor === 1 ? QUIT_DX : 0;
      if (this.set("cursor", `${at}|${alpha}`)) {
        view.setPanePosition(this.cursorPane, this.cursorPane.x + at, this.cursorPane.y);
        for (const { pane } of walkPanes(this.cursorPane)) view.setPaneAlpha(pane, 200 * alpha);
      }
    }
  }

  dispose(): void {
    this.view.dispose();
    this.starView?.dispose();
    this.effects?.dispose();
  }

  private flyingStar(state: TotalState, slot: number): void {
    const starView = this.starView, root = this.starScreen?.root;
    if (!starView || !root) return;
    const f = state.s - TOTAL.star;
    const flying = state.winner >= 0 && slot >= 0 && slot < 16 && f >= 0;
    if (this.set("star", flying ? `${state.winner}|${slot}` : "")) {
      starView.object.visible = flying;
      this.shown.delete("starFrame");
      if (flying) {
        const target = this.slots[state.winner]![slot]!;
        this.starOffset = [target.at[0] - this.starAt[0], target.at[1] - this.starAt[1]];
        // The slot's row color (blue, purple, pink, green): its star's black (C0).
        const color = this.screen.materials[(target.star as { material: number }).material]?.tevColors[0];
        if (this.star && color) starView.setMaterialTevColor((this.star as { material: number }).material, 0, color);
      }
    }
    if (!flying) return;
    const frame = f < TOTAL.pulseTo + 1 ? f : (f - TOTAL.pulseFrom) % TOTAL.pulseEvery <= TOTAL.pulseTo - TOTAL.pulseFrom ? TOTAL.pulseFrom + ((f - TOTAL.pulseFrom) % TOTAL.pulseEvery) : TOTAL.pulseTo;
    if (this.set("starFrame", String(frame))) {
      for (const a of this.anims) a.seek(frame);
      this.animator?.apply();
      // (after the .bck, whose joint 0 is the root: the whole screen onto the slot)
      starView.setPanePosition(root, root.x + this.starOffset[0], root.y + this.starOffset[1]);
      // The game fades the flying star in (the files draw it opaque).
      const fadeIn = Math.min(1, frame / TOTAL.starFlight);
      if (this.star) starView.setPaneAlpha(this.star, 255 * fadeIn);
      if (this.starShadow) starView.setPaneAlpha(this.starShadow, 80 * fadeIn);
    }
  }

  /**
   * The star's sparkles (data.arc particle.jpc, draw group 4: the 2D screen's, positions in screen px; main.dol
   * 0x803D75B0 by the star's .bck frame): 1231 trailing it from frame 2 to 19, 1233 as it lands (19), 1232 on each pulse
   * (frame 80). Ticks are the sequence's (`s`), so a rollback or a new sequence replays them.
   */
  private sparkles(state: TotalState, slot: number): void {
    const f = state.s - TOTAL.star;
    const on = state.winner >= 0 && slot >= 0 && slot < 16 && f >= SPARKLES.trailFrom;
    this.sparkleGroup.visible = on;
    if (!on) {
      this.effects?.sync(state.s, []);
      return;
    }
    const fx = (this.effects ??= this.loadEffects());
    if (!fx) return;
    const at = this.starPoint();
    if (!at) return;
    const specs: JpaEffectSpec[] = [];
    const add = (key: string, id: number, from: number, stop?: number) => {
      const placement = fsaParticlePlacement(id, at.x, at.y, 0);
      if (placement && f >= from && f < from + SPARKLES.lasts) specs.push({ key, start: TOTAL.star + from, placement, ...(stop === undefined ? {} : { stop: TOTAL.star + stop }) });
    };
    add("trail", SPARKLES.trail, SPARKLES.trailFrom, TOTAL.starFlight + 1);
    add("land", SPARKLES.land, TOTAL.starFlight);
    if (f >= SPARKLES.pulseFrame) {
      const k = Math.floor((f - SPARKLES.pulseFrame) / TOTAL.pulseEvery);
      add(`pulse${k}`, SPARKLES.pulse, SPARKLES.pulseFrame + k * TOTAL.pulseEvery);
    }
    fx.sync(state.s, specs);
  }

  /** Where the flying star's middle is on the screen (its pane's anchor, as last drawn), or null. */
  private starPoint(): { x: number; y: number } | null {
    const node = this.star && this.starView?.panes.get(this.star);
    if (!node) return null;
    node.updateWorldMatrix(true, false);
    const e = node.matrixWorld.elements;
    return { x: e[12]!, y: -e[13]! };
  }

  private loadEffects(): JpaEffects | null {
    if (!this.jpac) return null;
    const fx = new JpaEffects(parseJpac(this.jpac), { zBase: 0, zScale: 0 }, SCREEN_VIEW);
    // (three sorts by the innermost group's renderOrder: the renderer's own group must carry it)
    fx.group.renderOrder = ORDER.total + 2;
    this.sparkleGroup.add(fx.group);
    return fx;
  }

  private set(key: string, value: string): boolean {
    if (this.shown.get(key) === value) return false;
    this.shown.set(key, value);
    return true;
  }
}

/** The Total screen's star effects (RAM: the live emitters on the screen, group 4) and the star's frames they start on. */
export const SPARKLES = { trail: 1231, pulse: 1232, land: 1233, trailFrom: 2, pulseFrame: 80, lasts: 90 } as const;
/** Group 4 draws in the screen's own space: no view matrix. */
const SCREEN_VIEW = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

type THREE_Object = ScreenView["object"];

/** The lit column's alpha: a 120-tick triangle between 18 and 89, at its top 113 ticks in (frame dumps). */
export function litAlpha(s: number): number {
  const u = (((s - 113) % 120) + 120) % 120;
  return Math.round(18 + 71 * (1 - Math.min(u, 120 - u) / 60));
}

/** The cursor highlight over a 60-tick cycle: eased up over 30 ticks, eased down over 30 (frame dumps). */
export function cursorAlpha(t: number): number {
  return t < 30 ? (t / 30) ** 2 : 1 - ((t - 30) / 30) ** 2;
}

/** A pane's anchor point on the screen: the sum of the positions down its parent chain. */
function absolute(screen: BloScreen, tag: string): [number, number] {
  const path: BloPane[] = [];
  const find = (p: BloPane): boolean => {
    path.push(p);
    if (p.tag === tag || p.children.some(find)) return true;
    path.pop();
    return false;
  };
  find(screen.root);
  return path.reduce<[number, number]>((at, p) => [at[0] + p.x, at[1] + p.y], [0, 0]);
}
