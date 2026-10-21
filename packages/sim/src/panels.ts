// Above the Clouds' colored floor panels (RBPN "colored floor switch", 76 tiles in a ring; main.dol 0x80200458 and
// the player tile handler 0x8026D6AC; docs/formats/battle-arenas.md "Switches"): every period each panel steps to the next player's
// color (tile 0x8B + color, types 0x4C-0x4F), and a panel is solid ground only for the Link of its color: any other
// Link standing on it falls as into a pit (in a 2- or 3-player match, the absent players' colors are pits for all).
// With the arenas' params (0) all panels change together every 120 frames, P1 → P2 → P3 → P4 → P1.
import type { BattleState } from "./battle.ts";
import { onGround, PIT_PROBE, startFall } from "./combat.ts";
import { tileIndexAt } from "./entities.ts";
import type { GameState } from "./game.ts";
import { SUBPX } from "./player.ts";
import { switchOn } from "./switches.ts";

export const PANEL_TILE = 0x8b; // + color
export const PANEL_DEFAULT_PERIOD = 120; // frames, for params & 0x7F = 0
export const PANEL_PERIOD_UNIT = 10;

/** The panel colors at a round's start, one per RBPN prop in list order (packed color << 16 | timer). */
export function initialPanels(b: BattleState): number[] {
  return b.props.actors.filter((a) => a.id === "RBPN").map((a) => {
    const color = (a.params >>> 7) & 31;
    return (color < 4 ? color : 0) << 16;
  });
}

/** The color (player index 0-3) of RBPN panel `k` (k-th RBPN prop). */
export const panelColor = (b: BattleState, k: number) => (b.panels[k] ?? 0) >>> 16;

const tileMaps = new WeakMap<BattleState["props"], Map<number, number>>();

/** Tile index → panel index, for the arena's RBPN props (derived from the props, which never change: cached). */
function panelTiles(b: BattleState): Map<number, number> {
  let out = tileMaps.get(b.props);
  if (out) return out;
  out = new Map();
  let k = 0;
  for (const a of b.props.actors) if (a.id === "RBPN") out.set(tileIndexAt(a.x, a.y), k++);
  tileMaps.set(b.props, out);
  return out;
}

/** One tick: the panels' timers, then Links standing on a panel of another player's color fall. */
export function stepPanels(state: GameState): void {
  const b = state.battle!;
  if (!b.panels.length) return;
  let k = 0;
  for (const a of b.props.actors) {
    if (a.id !== "RBPN") continue;
    const packed = b.panels[k]!;
    let color = packed >>> 16, timer = packed & 0xffff;
    const gate = a.params >>> 27, force = (a.params >>> 22) & 31;
    if (gate === 0 || switchOn(b, gate)) {
      const period = (a.params & 0x7f) * PANEL_PERIOD_UNIT || PANEL_DEFAULT_PERIOD;
      if (++timer >= period || switchOn(b, force)) {
        color = (color + 1) % 4;
        timer = 0;
      }
    }
    b.panels[k++] = (color << 16) | timer;
  }
  const tiles = panelTiles(b);
  state.players.forEach((p, i) => {
    const f = b.fighters[i]!;
    if (f.mode !== "active" && f.mode !== "recoil" && f.mode !== "hurt") return;
    if (!onGround(f)) return;
    const panel = tiles.get(tileIndexAt(Math.floor(p.x / SUBPX) + PIT_PROBE.x, Math.floor(p.y / SUBPX) + PIT_PROBE.y));
    if (panel !== undefined && panelColor(b, panel) !== i) startFall(p, f);
  });
}
