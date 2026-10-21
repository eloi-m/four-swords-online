// Scripted bots for long Shadow Battle tests (not exported from the package): each Link walks toward the nearest
// rival (or a released item), swings, lifts and throws, rolls, mashes free when held, and uses its item, with seeded
// noise. Deterministic: the same seed and states give the same buttons.
import type { GameState } from "./game.ts";
import { Button, SUBPX } from "./player.ts";

export interface BotSeed {
  s: number;
}

export function botInputs(game: GameState, seed: BotSeed): number[] {
  const b = game.battle!;
  return game.players.map((p, i) => {
    seed.s = (Math.imul(seed.s, 1103515245) + 12345) >>> 0;
    const noise = seed.s >>> 16;
    const f = b.fighters[i]!;
    if (f.move === "held") return noise % 6 === 0 ? [Button.Sword, Button.Item, Button.Action, Button.Up][noise % 4]! : 0; // mashing
    const rivals = b.fighters.flatMap((g, j) => (j !== i && g.hearts > 0 ? [j] : []));
    if (!rivals.length) return 0;
    const d = (x: number, y: number) => Math.abs(x - p.x) + Math.abs(y - p.y);
    const rival = game.players[rivals.reduce((a, j) => (d(game.players[j]!.x, game.players[j]!.y) < d(game.players[a]!.x, game.players[a]!.y) ? j : a))]!;
    const pickup = b.entities.find((e) => e.kind === "pickup" && d(e.x, e.y) < 120 * SUBPX);
    const goal = pickup ?? rival;
    const dx = Math.floor((goal.x - p.x) / SUBPX), dy = Math.floor((goal.y - p.y) / SUBPX);
    if (noise % 9 === 0) return [Button.Up, Button.Down, Button.Left, Button.Right][noise % 4]!;
    let buttons = 0;
    if (Math.abs(dx) > 12) buttons |= dx > 0 ? Button.Right : Button.Left;
    else if (Math.abs(dy) > 4) buttons |= dy > 0 ? Button.Down : Button.Up;
    const near = !pickup && Math.abs(dx) + Math.abs(dy) < 30;
    const carrying = f.carryLink >= 0 || f.carryEntity !== 0;
    if (carrying) {
      if (noise % 16 === 0) buttons |= Button.Action; // throw
    } else if (near && noise % 5 === 0) buttons |= Button.Action; // lift
    else if (near && noise % 3 === 0) buttons |= Button.Sword;
    else if (f.item && noise % 13 === 0) buttons |= Button.Item;
    else if (noise % 37 === 0 && buttons) buttons |= Button.Action; // roll
    return buttons;
  });
}
