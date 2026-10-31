// Tingle's Tower (stage 1-3, boss012) from its start to its goal, as a route for drive.ts's RoutePlayer, played by the
// sim's rules (docs/ADVENTURE.md "Tingle's Tower"): the river swum west and down from the Zoras' houses to the field of
// the goal. Used by tingletower.realdisc.test.ts and the browser (apps/game's window.fso.route).
import { Button, SUBPX } from "../player.ts";
import { collect, face, goTo, holdUntil, openChestFacing, press, readOn, swimTo, travelTo, waitUntil, type Goal } from "./drive.ts";
import type { AdventureGame } from "./adventure.ts";
import { enemyActive } from "./enemies.ts";
import { GATHER_BUTTON, SEPARATE_BUTTON } from "./formation.ts";
import { pukuHalf } from "./waterfoes.ts";

const { Up, Down, Left, Right, Sword, Action } = Button;
const swing = (dir: number): Goal[] => [face(dir), press(Sword, 2, 14)];

/** How far across (px, past touching) a fish coming at the leader makes him get out of its way: cruising, charging. */
const FISH_CLEAR = 20;
const FISH_CLEAR_CHARGING = 48;

/**
 * Swims the leader along `points` (area px) in a side view's water, out of the fish's way (PUKU: nothing hurts them,
 * waterfoes.ts): one coming at him across, closer than FISH_CLEAR (charging FISH_CLEAR_CHARGING) px past touching and
 * level with him, sends him up or down away from it first (down 1.3 px/tick, up 0.7: sideview.ts).
 */
function swimPast(name: string, points: readonly { x: number; y: number }[], limit = 2400): Goal {
  let at = 0;
  return {
    name,
    limit,
    next(g, _s, t) {
      if (t === 0) at = 0;
      const p = g.players[0]!, px = p.x / SUBPX, py = p.y / SUBPX;
      while (at < points.length && Math.abs(points[at]!.x - px) <= 2 && Math.abs(points[at]!.y - py) <= 2) at++;
      const wp = points[at];
      if (!wp) return true;
      let dodge = 0;
      for (const e of g.adventure.enemies) {
        if (e.type !== "PUKU" || !enemyActive(e)) continue;
        const dx = e.x / SUBPX - px, dy = e.y / SUBPX - py, touch = pukuHalf(e) + 7;
        const coming = e.vx * dx < 0 || Math.abs(dx) < touch;
        const clear = touch + (e.state === "chase" ? FISH_CLEAR_CHARGING : FISH_CLEAR);
        if (coming && Math.abs(dx) < clear && Math.abs(dy) < touch + 4) dodge |= dy > 0 ? Up : Down;
      }
      if (dodge === Up || dodge === Down) return dodge;
      const dx = wp.x - px, dy = wp.y - py;
      return (dx > 1 ? Right : dx < -1 ? Left : 0) | (dy > 1 ? Down : dy < -1 ? Up : 0);
    },
  };
}

/**
 * Rides a current (swim.ts CURRENT_TILES: the fast ones carry him 2 px/tick, twice his stroke) keeping the leader at
 * `level(x)` (area px) across it, up or down by his stroke, between river stones that would strike him (swim.ts
 * STONE_DAMAGE), until `until`.
 */
function ride(name: string, level: (x: number) => number, until: (g: AdventureGame) => boolean, along = 0, limit = 900): Goal {
  return {
    name,
    limit,
    next(g) {
      if (until(g)) return true;
      const p = g.players[0]!, want = level(p.x / SUBPX), y = p.y / SUBPX;
      return (y > want + 1 ? Up : y < want - 1 ? Down : 0) | along;
    },
  };
}

/** Where the Force Gem near (x, y) (area px, within 24) is, while it's there to take. */
const gemNear = (x: number, y: number) => (g: AdventureGame) => {
  const it = g.adventure.pickups.find((it) => it.type === "gem" && Math.abs(it.x / SUBPX - x) < 24 && Math.abs(it.y / SUBPX - y) < 24);
  return it ? { x: it.x / SUBPX, y: it.y / SUBPX } : null;
};

/** The route, in milestones (each a list of goals); `TINGLE_TOWER_ROUTE` is all of them. */
export const TINGLE_TOWER_MILESTONES: readonly { name: string; goals: readonly Goal[] }[] = [
  {
    name: "room 11: the owl's talk read, the bush in the fence cut, into the house by its right-hand door, out by its left-hand one, west into room 0",
    goals: [
      // West along the top: within 24 px of the owl (280, 104) it flies in and talks (dialogue.ts startOwlTalk).
      holdUntil("up to the owl", Left, (g) => g.adventure.talk !== null, 200),
      readOn(),
      travelTo(264, 152, { tol: 2, exact: true }),
      ...swing(Left),
      travelTo(248, 152, { tol: 2, exact: true }),
      ...swing(Left),
      travelTo(232, 152, { tol: 2, exact: true }),
      ...swing(Up),
      ...swing(Left),
      travelTo(216, 152, { tol: 2, exact: true }),
      ...swing(Up),
      travelTo(216, 120),
      travelTo(192, 112),
      holdUntil("into the house", Up, (g) => g.adventure.area !== 0, 300),
      travelTo(150, 120), // under the villager at (152, 104): his box blocks
      travelTo(108, 116),
      holdUntil("out of the house", Down, (g) => g.adventure.area === 0 && !g.adventure.warp, 300),
      // The bushes west of the left-hand garden.
      travelTo(136, 136, { tol: 2, exact: true }),
      ...swing(Left),
      travelTo(120, 136, { tol: 2, exact: true }),
      ...swing(Left),
      travelTo(40, 136),
      goTo(Left, 0),
    ],
  },
  {
    name: "room 0: down the ladder into the river, swum west into room 1",
    goals: [
      travelTo(320, 160),
      holdUntil("into the river", Down, (g) => g.adventure.links[0]!.mode === "swim", 200),
      travelTo(200, 236, { swim: true }),
      travelTo(30, 236, { swim: true }),
      goTo(Left, 1),
    ],
  },
  {
    name: "room 1: its three winged Force Gems, west into room 2",
    goals: [collect("room 1's gems", (it) => it.type === "gem", 3600, true), travelTo(30, 200, { swim: true }), goTo(Left, 2)],
  },
  {
    name: "room 2: its three winged Force Gems, down the river into room 3",
    goals: [
      collect("room 2's gem in the middle", (it) => it.type === "gem" && it.x > 200 * SUBPX && it.x < 360 * SUBPX, 3600, true),
      // Out of the stones' ring by its open bottom and up the clear channel at x 208-239 to the open water at y 145-159,
      // not past the stones at x 176-191 (a strike there spills Force Gems into the river: pickups.ts spillGems).
      travelTo(288, 236, { swim: true }),
      travelTo(224, 236, { swim: true }),
      travelTo(224, 152, { swim: true }),
      // Up the west pool between its stones (x 96-111 at y 160, x 48-63 at y 128, x 80-95 at y 80; a swimmer's
      // sensors reach 8 px).
      travelTo(140, 152, { swim: true }),
      travelTo(88, 148, { swim: true }),
      travelTo(88, 104, { swim: true }),
      travelTo(71, 104, { swim: true, tol: 0.5 }),
      travelTo(71, 56, { swim: true, tol: 0.5 }),
      collect("room 2's gem up the west side", (it) => it.type === "gem" && it.x < 200 * SUBPX, 3600, true),
      // Down the west side, out of the blade traps' lanes (traps.ts: the one at (104, 232) slides right from there, the
      // one at (184, 296) left to the pillar at x 80-95: whoever is in a lane sets it off), then along the bottom, below
      // them, to the east gem and back.
      travelTo(70, 330, { swim: true }),
      collect("room 2's east gem", (it) => it.type === "gem", 3600, true),
      travelTo(100, 360, { swim: true }),
      goTo(Down, 3),
    ],
  },
  {
    name: "room 3: over the waterfall, its two winged Force Gems, east into room 4",
    goals: [
      // Between the stones (spike tiles at x 80-96 and 128-144: they hurt), then the current carries him down over the
      // falls' lip into the pool under them (falls.ts stepTileFalls).
      travelTo(120, 64, { swim: true }),
      holdUntil("over the falls", Down, (g) => g.players[0]!.y > 240 * 256 && g.adventure.links[0]!.mode === "swim", 300),
      collect("the pool's gem", (it) => it.type === "gem" && it.x < 352 * 256, 1800, true),
      // The whirlpool down into the underwater passage, up its far shaft into the tree house, out of its door. The
      // passage's clock (10 s: waterclock.ts) leaves no time for both its winged gem and the shaft: the gem first, the
      // clock run out (back in the whirlpool), off it and down again, straight to the shaft.
      travelTo(328, 312, { swim: true }),
      waitUntil("in the passage", (g) => g.adventure.area === 5 && !g.adventure.warp, 300),
      collect("the passage's winged gem", (it) => it.type === "gem", 1800, true),
      waitUntil("the passage's clock run out, back in the whirlpool", (g) => g.adventure.area === 0 && !g.adventure.warp, 700),
      travelTo(328, 280, { swim: true }),
      travelTo(328, 312, { swim: true }),
      waitUntil("in the passage again", (g) => g.adventure.area === 5 && !g.adventure.warp, 300),
      // The quick way: east along its upper reach sinking, down between the rock and the stub of wall under it, east
      // along the bottom, up the shaft (up is the slow stroke, 0.7 px/tick).
      holdUntil("down the passage's left side", Down, (g) => g.players[0]!.y >= 100 * SUBPX, 120),
      holdUntil("east along its upper reach", Right, (g) => g.players[0]!.x >= 136 * SUBPX, 200),
      holdUntil("down past its rock", Down, (g) => g.players[0]!.y >= 216 * SUBPX, 200),
      swimPast("east along its bottom, kept from sinking", [{ x: 212, y: 217 }], 200),
      holdUntil("up the shaft", Up, (g) => g.adventure.area === 2, 600),
      waitUntil("in the tree house", (g) => g.adventure.area === 2 && !g.adventure.warp, 600),
      // Its two red Force Gems and its chest.
      collect("the tree house's gems", (it) => it.type === "gem", 2400, true),
      travelTo(168, 102, { tol: 2, exact: true }),
      ...openChestFacing(Up),
      travelTo(112, 300),
      travelTo(112, 420),
      travelTo(136, 470),
      holdUntil("out of the tree house", Down, (g) => g.adventure.area === 0 && !g.adventure.warp, 300),
      // Off the ledge into the east pool, its gem, east into room 4.
      travelTo(400, 210),
      holdUntil("off the ledge", Down, (g) => g.adventure.links[0]!.mode === "swim", 300),
      collect("the east pool's gem", (it) => it.type === "gem", 1800, true),
      travelTo(482, 300, { swim: true }),
      goTo(Right, 4),
    ],
  },
  {
    name: "room 4: the island's red Force Gem, down the lake's outlet into room 5",
    goals: [
      // The stones (spike tiles) wall the lake's west part off from the island's: over the north end of their chain
      // (x 240-256 from y 112) from the inflow's slow west edge, swimming right across its fast current, which carries
      // him down onto the stone's top; it knocks him straight back up (a quarter heart) and, still swimming right, he
      // comes down past its east side (in Dolphin from this spot: swim.ts STONE_DAMAGE).
      travelTo(200, 130, { swim: true }),
      travelTo(200, 40, { swim: true, tol: 1 }),
      holdUntil("over the stones' north end", Right, (g) => g.players[0]!.x > 264 * 256 && g.players[0]!.y > 120 * 256, 400),
      collect("room 4's gems", (it) => it.type === "gem", 3600, true),
      travelTo(420, 364, { swim: true }),
      goTo(Down, 5),
    ],
  },
  {
    name: "room 5: over its waterfall, its winged Force Gem, west into room 6",
    goals: [
      // The current carries the four down over the falls' lip as they come in (falls.ts stepTileFalls).
      holdUntil("over the falls", Down, (g) => g.players[0]!.y > 128 * 256 && g.adventure.links[0]!.mode === "swim", 300),
      collect("room 5's gem", (it) => it.type === "gem", 3600, true),
      travelTo(30, 290, { swim: true }),
      goTo(Left, 6),
    ],
  },
  {
    name: "room 6: its winged Force Gem, west into room 7",
    goals: [
      swimTo("the whirl's gem", gemNear(384, 192)),
      // Out of the whirl's top (its current up the east side carries him up past it), west along the top among its
      // stones and down into the fast stream west (2 px/tick), level with the gap between its two stones (x 64-80,
      // y 144-176 and 208-240) before it gets there (a plan: drive.ts swimTo).
      holdUntil("out of the whirl", Up, (g) => g.players[0]!.y < 112 * 256, 600),
      swimTo("into the stream west, level with the gap between its stones", () => ({ x: 96, y: 192 }), 3),
      goTo(Left, 7),
    ],
  },
  {
    name: "room 7: up the ladder, the bushes over the hole cut, down it into the underwater passage, west, up into the whirlpool at the river's top, down its left-hand channel into room 8",
    goals: [
      // Up out of the stream (2 px/tick west) into the still water east of the ladder's foot (x 368-400, y 160), under
      // it and up into it: he jumps out onto it (ledge.ts startLadderClimb).
      holdUntil("up out of the stream", Up, (g) => g.players[0]!.x < 410 * 256 && g.players[0]!.y < 176 * 256, 300),
      holdUntil("under the ladder", Left, (g) => g.players[0]!.x < 394 * 256, 120),
      holdUntil("up the ladder", Up, (g) => g.adventure.links[0]!.mode === "walk" && g.players[0]!.y < 150 * 256, 300),
      travelTo(400, 90),
      travelTo(296, 88, { tol: 2, exact: true }),
      ...swing(Up),
      travelTo(296, 78, { tol: 2, exact: true }),
      ...swing(Up),
      holdUntil("down the hole", Up, (g) => g.adventure.area === 5 && !g.adventure.warp, 300),
      // The ledge's three pots lifted and thrown out of the way, west along it and down the shaft (onto its floor
      // switches) into the water.
      // The ledge's Keese, woken (a Link within 60 px), struck as it comes.
      holdUntil("the Keese woken", Left, (g) => g.players[0]!.x < 443 * 256, 300),
      {
        name: "the passage's Keese",
        limit: 1800,
        next(g, _s, t) {
          const k = g.adventure.enemies.find((e) => e.type === "KETH" && e.life > 0);
          if (!k) return true;
          const p = g.players[0]!, want = k.x < p.x ? "left" : "right";
          if (p.facing !== want) return want === "left" ? Left : Right;
          return t % 16 < 2 ? Sword : 0;
        },
      },
      // West along the ledge, each pot in the way lifted off, to the shaft.
      {
        name: "along the ledge to the shaft",
        limit: 1800,
        next(g, _s, t) {
          const p = g.players[0]!, x = Math.floor(p.x / 256) - 12, y = Math.floor(p.y / 256);
          if (p.x < 352 * 256) return true;
          const tile = (y >> 4) * 32 + (x >> 4);
          const pot = g.battle.props.pots?.includes(tile) && !g.battle.cut.includes(tile);
          return pot && p.facing === "left" ? (t % 8 < 2 ? Action : 0) : Left;
        },
      },
      // The others wait on the ledge (X) while the leader swims the passage alone, out of its four fish's way, and
      // leaves by the whirlpool; Y brings them onto him (from another area: at once).
      press(SEPARATE_BUTTON, 1, 0),
      holdUntil("down the shaft", 0, (g) => g.players[0]!.y > 340 * 256, 300),
      swimPast("the passage, out of the fish's way", [{ x: 344, y: 420 }, { x: 40, y: 420 }, { x: 36, y: 476 }, { x: 40, y: 350 }]),
      holdUntil("up into the whirlpool", Up, (g) => g.adventure.area === 0 && !g.adventure.warp, 600),
      press(GATHER_BUTTON, 1, 0),
      waitUntil("together", (g) => g.adventure.formation === "trail" && !g.adventure.away, 120),
      // West into the fast channel down (x 48-112 at its narrowest), which carries them into room 8, kept to its middle.
      holdUntil("into the channel", Left, (g) => g.players[0]!.x < 96 * 256, 300),
      {
        name: "down the channel into room 8",
        limit: 900,
        next(g) {
          const a = g.adventure, x = g.players[0]!.x / SUBPX;
          if (a.room === 8 && !a.edge) return true;
          return Down | (x > 82 ? Left : x < 78 ? Right : 0);
        },
      },
    ],
  },
  {
    name: "room 8: its winged Force Gems, over its waterfall, west into room 9",
    goals: [
      // The channel turns east (2 px/tick) between two rows of stones (x 176-192 down to y 80, x 304-320 from y 96):
      // down past the first, up over the second, through the upper winged gem (400, 80) as the fall's current takes
      // them down over the lip (falls.ts stepTileFalls).
      ride("east between the stones, through the upper gem", (x) => (x < 240 ? 94 : 84), (g) => g.players[0]!.y > 112 * 256 && g.players[0]!.x > 360 * 256, 600),
      holdUntil("over the falls", Down, (g) => g.players[0]!.y > 240 * 256 && g.adventure.links[0]!.mode === "swim", 300),
      // West (2 px/tick) through the pool's stones to the lower winged gem (80, 304), on a plan (drive.ts swimTo).
      swimTo("west through the stones to the lower gem", gemNear(80, 304)),
      goTo(Left, 9),
    ],
  },
  {
    name: "room 9: its three winged Force Gems, up the river into room 10",
    goals: [
      // Its three winged gems are in the middles of the river's three whirls (their currents 2 px/tick round them):
      // swum to on plans through the currents (drive.ts swimTo), then north out of the top whirl.
      swimTo("the east whirl's gem", gemNear(384, 256)),
      swimTo("the middle whirl's gem", gemNear(240, 272)),
      swimTo("the west whirl's gem", gemNear(112, 208)),
      swimTo("into the top whirl's current up", () => ({ x: 200, y: 150 }), 4),
      swimTo("up its west side", () => ({ x: 200, y: 56 }), 4),
      swimTo("out of it north", () => ({ x: 224, y: 16 }), 4),
      goTo(Up, 10),
    ],
  },
  {
    name: "room 10: up the ladder out of the pool, onto the goal: the stage cleared",
    goals: [
      // (Its winged gem (472, 208) is in the fast current down its east channel, 2 px/tick against his 1: out of reach.)
      swimTo("under the ladder", () => ({ x: 256, y: 306 }), 3),
      holdUntil("up the ladder", Up, (g) => g.players[0]!.y < 262 * 256 && g.adventure.links[0]!.mode === "walk", 300),
      travelTo(176, 90),
      holdUntil("onto the goal: the stage cleared", Up, (g) => g.adventure.cleared > 0, 120),
    ],
  },
];

export const TINGLE_TOWER_ROUTE: readonly Goal[] = TINGLE_TOWER_MILESTONES.flatMap((m) => m.goals);
