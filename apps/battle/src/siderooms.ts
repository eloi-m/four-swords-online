// The side rooms on screen (packages/sim siderooms.ts: The Field's house and cave, the Tower of Flames' rooms…). In the
// game each one shows on the GBA of whoever is inside, 240×160 px of it around him, in the GBA palettes (`_gb_`); the
// TV doesn't show him, and his HUD portrait turns into a black disc (hud.ts). Here a player in a side room gets a
// GBA-sized inset over the TV frame, by his HUD corner (scene.ts draws it: the same scene, a camera over his room),
// framed in his tunic color. While a Link comes out of a door onto the TV, the TV marks the spot: his head, his
// number and an arrow into the door, glowing (traced in Dolphin: from a few frames after he starts walking out of the
// side room until he has walked out of the door on the TV); coming back from Hyrule Castle's dark side, his number and
// head over the spot he'll drop onto, an arrow down at it (frame dumps: the middle spot's way out). This module is the
// layout and the DOM; it reads the state.
import { ARENA_H, CIRCLE_BACK_Y, CIRCLE_RAISE_TICKS, SPOT_SHOW_TICK, type GameState } from "@fso/sim";
import { HUD_H, HUD_W, PLAYER_COLORS, PLAYER_INK, playerName } from "./hud.ts";
import { fillArt } from "./menu-art.ts";

/** The GBA's screen, in room px (one GBA pixel per room pixel). */
export const GBA_W = 240;
export const GBA_H = 160;
/** An inset's size in the TV frame (J2D units, 608×448): the GBA screen at this scale. */
export const INSET_SCALE = 0.6;
const INSET_W = GBA_W * INSET_SCALE, INSET_H = GBA_H * INSET_SCALE;
/** The HUD corners take about this much of the frame's top and bottom (main_bat.blo): the insets go just inside. */
const CORNER_H = 108;
const MARGIN = 10;

/** Where player i's inset goes in the TV frame (J2D units): under his corner at the top, over it at the bottom. */
export function insetRect(i: number): { x: number; y: number; w: number; h: number } {
  const right = i % 2 === 1, bottom = (i >> 1) % 2 === 1;
  return { x: right ? HUD_W - MARGIN - INSET_W : MARGIN, y: bottom ? HUD_H - CORNER_H - INSET_H : CORNER_H, w: INSET_W, h: INSET_H };
}

/** A side room's tiles (world px): what its GBA view stays inside. */
export interface SideRoomArea {
  screen: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The GBA view's top-left (world px) around a Link at (x, y): centered on him, kept inside the room's tiles; a room
 * smaller than the screen sits in its middle.
 */
export function gbaView(area: SideRoomArea, x: number, y: number): { x: number; y: number } {
  const clamp = (v: number, lo: number, hi: number, size: number) => (hi - lo <= size ? (lo + hi - size) / 2 : Math.min(Math.max(v - size / 2, lo), hi - size));
  return { x: Math.round(clamp(x, area.left, area.right, GBA_W)), y: Math.round(clamp(y, area.top, area.bottom, GBA_H)) };
}

/** A Link coming out of a door onto the TV: where the mark goes (world px) and who. */
export interface ExitMark {
  player: number;
  x: number;
  y: number;
  /** Over the spot, pointing down at it (back from the dark side), rather than under a door pointing up into it. */
  down?: boolean;
}

/** The mark shows from this many ticks after he starts walking out of the side room (traced: 6-8 frames). */
export const EXIT_MARK_FROM = 8;
/** px below the door's spot (where he lands) the mark sits (traced: about 18 px under the house's door). */
export const EXIT_MARK_BELOW = 18;

/** The Links coming out of a door onto the TV now. */
export function exitMarks(game: GameState): ExitMark[] {
  const b = game.battle;
  if (!b) return [];
  return b.fighters.flatMap((f, i) => {
    // Out of the dark side by its middle spot until he shows, or sent back over the circle once he's let go of his
    // sword (this one assumed marked the same way: not traced).
    if (f.move === "spot" && f.moveTick >= EXIT_MARK_FROM && f.moveTick < SPOT_SHOW_TICK) {
      const w = b.props.warps?.[f.warp];
      return w ? [{ player: i, x: w.toX, y: w.toY, down: true }] : [];
    }
    if (f.move === "circleBack" && f.moveTick > CIRCLE_RAISE_TICKS) {
      const c = b.props.actors[f.circle];
      return c ? [{ player: i, x: c.x, y: c.y - CIRCLE_BACK_Y, down: true }] : [];
    }
    // (A door from a side room onto the TV: its destination is in the arena, the door itself below it.)
    const w = f.move === "warp" ? b.props.warps?.[f.warp] : undefined;
    if (!w || w.toY >= ARENA_H || w.y < ARENA_H || f.moveTick < EXIT_MARK_FROM) return [];
    return [{ player: i, x: w.toX, y: w.toY + EXIT_MARK_BELOW }];
  });
}

/**
 * The seconds a Link has left on Hyrule Castle's dark side (Link +0xBD8, 600 ticks from his first free tick there:
 * 10 … 1), or null. The game's TV shows only the circle's own "10" (its sprite); his GBA gets a command each second
 * (0x803037D4: what it shows wasn't seen), so the inset shows the count by his number (ours).
 */
export function darkSeconds(game: GameState, i: number): number | null {
  const f = game.battle?.fighters[i];
  return f && f.dark > 0 && f.move === "none" ? Math.ceil((f.dark - 1) / 60) || null : null;
}

/** The insets' frames (a border in the tunic color, "P1" and his Dark World seconds) and the exit marks, over the TV frame (CSS px). */
export class SideRoomOverlay {
  private readonly root: HTMLElement;
  private readonly frames: HTMLElement[] = [];
  private readonly marks: HTMLElement[] = [];

  constructor(hud: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "siderooms";
    hud.prepend(this.root);
  }

  /** `insets` CSS px rects in the frame by player; `marks` CSS px points in the frame. */
  update(
    insets: readonly { player: number; x: number; y: number; w: number; h: number; seconds?: number | null }[],
    marks: readonly { player: number; x: number; y: number; down?: boolean }[],
    tick: number,
  ): void {
    this.root.hidden = false;
    insets.forEach((r, k) => {
      const el = (this.frames[k] ??= this.add("inset-frame"));
      el.hidden = false;
      el.style.setProperty("--color", PLAYER_COLORS[r.player] ?? "#fff");
      el.style.setProperty("--ink", PLAYER_INK[r.player] ?? "#fff");
      const label = r.seconds ? `${playerName(r.player)} · ${r.seconds}` : playerName(r.player);
      if (el.dataset.label !== label) {
        el.dataset.label = label;
        el.innerHTML = `<b>${label}</b>`;
      }
      Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    });
    for (let k = insets.length; k < this.frames.length; k++) this.frames[k]!.hidden = true;
    marks.forEach((m, k) => {
      const el = (this.marks[k] ??= this.add("exit-mark"));
      el.hidden = false;
      el.style.setProperty("--color", PLAYER_COLORS[m.player] ?? "#fff");
      el.style.setProperty("--ink", PLAYER_INK[m.player] ?? "#fff");
      if (el.dataset.player !== String(m.player)) {
        el.dataset.player = String(m.player);
        el.innerHTML = `<i class="arrow"></i><span class="link-icon head" data-art-bg="link${(m.player % 4) + 1}"></span><b>${playerName(m.player)}</b>`;
        fillArt(el);
      }
      el.classList.toggle("glow", Math.floor(tick / 6) % 3 === 0);
      el.classList.toggle("down", !!m.down);
      el.style.transform = `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px)${m.down ? " translateY(-100%)" : ""}`;
    });
    for (let k = marks.length; k < this.marks.length; k++) this.marks[k]!.hidden = true;
  }

  hide(): void {
    this.root.hidden = true;
  }

  private add(className: string): HTMLElement {
    const el = document.createElement("div");
    el.className = className;
    this.root.append(el);
    return el;
  }
}
