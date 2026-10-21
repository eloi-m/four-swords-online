// The Cave of No Return (stage 1-2, boss011) from its start to its goal, as a route for drive.ts's RoutePlayer, played
// by the sim's rules (docs/ADVENTURE.md "The Cave of No Return"). Used by cavenoreturn.realdisc.test.ts and the browser
// (apps/game's window.fso.route).
import { Button, SUBPX } from "../player.ts";
import { switchOn } from "../switches.ts";
import type { World } from "../world.ts";
import { areaWorld, currentArea, type AdventureGame } from "./adventure.ts";
import { collect, defeat, face, findPath, formation, goTo, guard, holdUntil, openChestFacing, press, readOn, sequence, standable, travelTo, wait, waitUntil, walkTo, type Goal } from "./drive.ts";
import type { Enemy } from "./enemies.ts";
import { GATHER_BUTTON, SEPARATE_BUTTON, selectButtons } from "./formation.ts";
import { SHADOW, SHADOW_STATE, shadowColor, shadowForm, shadowState } from "./shadowlink.ts";
import { BLOCK_SLIDE_TICKS } from "./tileblocks.ts";
import { FIRE_TRAP_KIND } from "./traps.ts";

const { Up, Down, Left, Right, Action, Item } = Button;

/** Pushes the movable block in front of (x, y) one tile the way `dir` goes, from there. */
const pushBlock = (x: number, y: number, dir: number): Goal[] => {
  let before = 0;
  return [
    travelTo(x, y, { tol: 3, exact: true }),
    {
      name: `push the block from (${x}, ${y})`,
      limit: 120,
      next(g, _s, t) {
        if (t === 0) before = g.adventure.blocks.length;
        const b = g.adventure.blocks[before];
        return b && b.tick >= BLOCK_SLIDE_TICKS ? true : dir;
      },
    },
  ];
};
/** Pushes the big block (BLCK) placed at (ax, ay) all the way, the four in the wide formation, then back in their trail. */
const pushRock = (ax: number, ay: number, dir: number): Goal[] => [
  formation("wide"),
  {
    name: `push the block at (${ax}, ${ay})`,
    limit: 600,
    next(g, s) {
      const at = currentArea(g, s).actors.find((x) => x.id === "BLCK" && x.x === ax && x.y === ay);
      const r = at && g.adventure.rocks.find((x) => x.actor === at.index);
      return r?.state === "set" ? true : dir;
    },
  },
  press(GATHER_BUTTON, 1, 0),
  waitUntil("together", (g) => g.adventure.formation === "trail", 120),
];
/** The Link of `color` (0 green … 3 purple) takes the controls, walks to tile (tx, ty) and pushes the color block beyond. */
const pushColor = (color: number, tx: number, ty: number, dir: number): Goal[] => {
  let before = 0;
  return [
    press(selectButtons(color), 1, 1),
    travelTo(tx * 16 + 8, ty * 16 + 8, { tol: 2, exact: true }),
    {
      name: `push the color block next to tile (${tx}, ${ty})`,
      limit: 120,
      next(g, _s, t) {
        if (t === 0) before = g.adventure.colorBlocks.length;
        const tick = g.adventure.colorBlocks[before + 1];
        return tick !== undefined && tick >= BLOCK_SLIDE_TICKS ? true : dir;
      },
    },
  ];
};
/** Lifts the pot (or stone) faced in `dir` and throws it on that way. */
const liftAway = (dir: number): Goal[] => [face(dir), press(Action, 2, 30), press(Action, 2, 30)];
/** Lifts the pot (or stone) next to (x, y) the way `dir` goes, from there, and throws it on. */
const liftAt = (x: number, y: number, dir: number): Goal[] => [travelTo(x, y, { tol: 1, exact: true }), ...liftAway(dir)];
/**
 * Room 1's fireball traps (traps.ts: each shoots at the nearest Link within 112 px, then waits 120 ticks): the leader,
 * within the reach of the one at (x, y), turns his shield `dir` (toward it) and waits till it has shot, its shot is
 * spent (stopped by the shield, or gone by) and `need` ticks at least are left before its next.
 */
const outlastShot = (dir: number, x: number, y: number, need: number): Goal[] => [
  face(dir),
  waitUntil(
    `a shot from the fireball trap at (${x}, ${y}) spent`,
    (g) => {
      const t = g.adventure.enemies.find((e) => e.type === "FBGE" && e.x === x * SUBPX && e.y === y * SUBPX);
      return !!t && t.timer >= need && !g.adventure.enemies.some((e) => e.type === "OKTM" && e.kind === FIRE_TRAP_KIND);
    },
    300,
  ),
];
/** Lights the candle switch in front with the lamp. */
const light = (dir: number): Goal[] => [face(dir), press(Item, 2, 12)];
/** Shoots an arrow from (x, y) the way `dir` goes (the bow: bow.ts). */
const shootFrom = (x: number, y: number, dir: number): Goal[] => [travelTo(x, y, { tol: 1, exact: true }), face(dir), press(Item, 2, 20)];
/** Opens the chest above (x, y): there, then leaning on it (a chest opens touching it), then the Item button. */
const chestAbove = (x: number, y: number): Goal[] => [travelTo(x, y, { tol: 1, exact: true }), press(Up, 8, 2), ...openChestFacing(Up)];
/** In the area `area` once through its warp. */
const inArea = (area: number) => (g: { adventure: { area: number; warp: unknown } }) => g.adventure.area === area && !g.adventure.warp;
/** Pulls the chain lever hanging over (x, 24) with the four (lever.ts): the leader under it, the column behind him. */
const pullLever = (x: number, sw: number): Goal[] => [
  travelTo(x, 41, { tol: 1, exact: true }),
  face(Up),
  formation("long"),
  wait(20),
  holdUntil(`the lever at x ${x} pulled (switch ${sw})`, Action | Down, (g) => switchOn(g.battle, sw), 1200),
  press(GATHER_BUTTON, 1, 0),
  waitUntil("together", (g) => g.adventure.formation === "trail", 120),
];

/** The Link of Shadow Link's color handed the controls (D-pad), once he's changed (his roulette over). */
const shadowColorInControl: Goal = {
  name: "the Link of his color in control",
  limit: SHADOW.change + 20,
  next(game, _stage, tick) {
    const e = game.adventure.enemies.find((x) => x.type === "SLK2");
    if (e?.state === "change") return 0;
    if (!e || game.adventure.colors[0] === shadowColor(e)) return tick > 2 ? true : 0;
    return selectButtons(shadowColor(e));
  },
};

/** Unit steps ahead of each facing. */
const AHEAD: Readonly<Record<string, readonly [number, number]>> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
/** How far beside Shadow Link the leader strikes from (px), and how far out of his sword's way he steps (px across). */
const FLANK = 18;
const SWORD_CLEAR = 18;
/** Kept this far off him while he closes in (px): his sword reaches 24 px ahead, a Link's body 7 more. */
const BAIT = 36;
/** Past this tick of his standing after a swing (of SHADOW.pause) the leader stops going for him. */
const LATE = 70;
const stepTo = (dx: number, dy: number) => (dx > 0.75 ? Right : dx < -0.75 ? Left : 0) | (dy > 0.75 ? Down : dy < -0.75 ? Up : 0);
/** A step from (px, py) away from (ex, ey), round a wall (the free side across) when it's behind. */
function away(world: World, px: number, py: number, ex: number, ey: number): number {
  const dx = px - ex, dy = py - ey, n = Math.hypot(dx, dy) || 1, ux = dx / n, uy = dy / n;
  for (const [ax, ay] of [[ux, uy], [ux - uy, uy + ux], [ux + uy, uy - ux], [-uy, ux], [uy, -ux]] as const) {
    if (standable(world, px + ax * 10, py + ay * 10)) return stepTo(ax, ay);
  }
  return stepTo(-uy, ux);
}

/**
 * Fights Shadow Link (shadowlink.ts) until `until`: his shield stops a sword from ahead of him, so the leader strikes
 * from beside him (FLANK px off across the way he faces; down, from any side), turned to him, while he can't come at
 * him at once; else he draws his swings from BAIT px off, out of his sword's way.
 */
function flankShadow(name: string, until: (game: AdventureGame) => boolean, limit: number): Goal {
  let swing = 0, path: { x: number; y: number }[] = [], at = 0, plannedAt = -99, goal: [number, number] = [0, 0];
  return {
    name,
    limit,
    next(game, stage, tick) {
      if (tick === 0) [swing, path, at, plannedAt, goal] = [0, [], 0, -99, [0, 0]];
      if (swing > 0) return swing-- > 8 ? Button.Sword : 0;
      if (until(game)) return true;
      const e = game.adventure.enemies.find((x) => x.type === "SLK2");
      if (!e) return true;
      const p = game.players[0]!, px = p.x / SUBPX, py = p.y / SUBPX, ex = e.x / SUBPX, ey = e.y / SUBPX;
      const world = areaWorld(game, stage);
      const s = shadowState(e), d = Math.hypot(px - ex, py - ey);
      const [fx, fy] = AHEAD[e.facing]!, rx = px - ex, ry = py - ey, along = rx * fx + ry * fy, across = rx * -fy + ry * fx;
      // Swinging: out of his sword's way.
      if (e.state === "turn" && along > -8 && along < BAIT && Math.abs(across) < SWORD_CLEAR) return away(world, px, py, ex, ey);
      // Struck only while he can't come at the Link at once: standing after a swing (not too late in it), landing,
      // on his rail's jump, down. Else (a Link who can hurt him within 50 px, he closes in and swings at once) he's
      // drawn into a swing that misses: kept BAIT px off (his sword reaches 24 px ahead, a Link's body 7 more), come
      // up to from further.
      const open = (s === SHADOW_STATE.pause && e.tick <= LATE) || s === SHADOW_STATE.hopLand || (s >= SHADOW_STATE.jumpWait && s <= SHADOW_STATE.jumpAfter) || e.state === "rest";
      if (!open) {
        if (d < BAIT) return away(world, px, py, ex, ey);
        if (d <= BAIT + 10 || e.state === "change" || e.state === "die" || e.state === "knock" || e.z > 0) return 0;
        return stepTo(ex - px, ey - py);
      }
      // Beside him (down: any side), the free spot nearest the leader.
      const spots: [number, number][] = e.state === "rest" ? [[ex - FLANK, ey], [ex + FLANK, ey], [ex, ey - FLANK], [ex, ey + FLANK]] : [[ex - fy * FLANK, ey + fx * FLANK], [ex + fy * FLANK, ey - fx * FLANK]];
      const free = spots.filter(([x, y]) => standable(world, x, y));
      if (!free.length) return stepTo(ex - px, ey - py);
      const [tx, ty] = free.reduce((a, b) => (Math.hypot(b[0] - px, b[1] - py) < Math.hypot(a[0] - px, a[1] - py) ? b : a));
      if (Math.abs(tx - px) <= 6 && Math.abs(ty - py) <= 6) {
        const toward = Math.abs(ex - px) >= Math.abs(ey - py) ? (ex > px ? "right" : "left") : ey > py ? "down" : "up";
        if (p.facing !== toward) return { right: Right, left: Left, down: Down, up: Up }[toward];
        swing = 10;
        return Button.Sword;
      }
      if (tick - plannedAt >= 15 || at >= path.length || Math.hypot(goal[0] - tx, goal[1] - ty) > 8) {
        path = findPath(world, Math.round(px), Math.round(py), Math.round(tx), Math.round(ty)) ?? [{ x: tx, y: ty }];
        [at, plannedAt, goal] = [0, tick, [tx, ty]];
      }
      while (at < path.length - 1 && Math.abs(path[at]!.x - px) <= 1.5 && Math.abs(path[at]!.y - py) <= 1.5) at++;
      const wp = path[at] ?? { x: tx, y: ty };
      return stepTo(wp.x - px, wp.y - py);
    },
  };
}

/** Room 3's Keese (the fifty its four candles show). */
const keese = (e: Enemy) => e.type === "KETH";
/** Up and down room 3's bridge by either edge and along its near ledge, to wake them (resting, they sway on one axis). */
const KEESE_PATROL = [
  { x: 256, y: 270 }, { x: 216, y: 230 }, { x: 216, y: 150 }, { x: 256, y: 100 }, { x: 296, y: 150 }, { x: 296, y: 230 },
  { x: 256, y: 290 }, { x: 120, y: 300 }, { x: 400, y: 300 }, { x: 256, y: 290 },
];

/** The route, in milestones (each a list of goals); `CAVE_OF_NO_RETURN_ROUTE` is all of them. */
export const CAVE_OF_NO_RETURN_MILESTONES: readonly { name: string; goals: readonly Goal[] }[] = [
  {
    name: "room 12: up to the cave's door, which rises, down the spiral staircase into room 6",
    goals: [
      walkTo(256, 168),
      holdUntil("the door risen", Up, (g) => g.adventure.gates.length > 0 && g.tick - g.adventure.gates[1]! >= 120, 600),
      holdUntil("down the staircase", Up, (g) => g.adventure.room === 6 && !g.adventure.stairs, 600),
    ],
  },
  {
    name: "room 6: the pots over its two floor points lifted (their Force Gems), the lamp from its pedestal, the two candles lit, north into room 7",
    goals: [
      travelTo(232, 200, { tol: 1, exact: true }),
      ...liftAway(Left),
      travelTo(456, 248, { tol: 1, exact: true }),
      ...liftAway(Right),
      collect("room 6's Force Gems", (it) => it.type === "gem", 900),
      travelTo(424, 150),
      walkTo(424, 135, 1),
      face(Up),
      press(Action, 2, 4),
      waitUntil("the lamp", (g) => g.adventure.gear === "lamp", 30),
      readOn(),
      // Round the middle (the pedestals block the way up between them, as in Dolphin).
      travelTo(432, 180),
      travelTo(340, 236),
      travelTo(300, 150),
      travelTo(440, 60, { tol: 2 }),
      ...light(Up),
      travelTo(360, 60, { tol: 2 }),
      ...light(Up),
      waitUntil("the way north", (g) => ((g.battle.switches >>> 20) & 1) === 1, 60),
      travelTo(400, 40),
      goTo(Up, 7),
    ],
  },
  {
    name: "room 7: its two candles lit (their Force Gems), a block pushed up the west side, the corner chest, the fence's gate opened, four blocks pushed out onto their points, the ring of fire out, the chest's key carried to the locked door east, room 13",
    goals: [
      travelTo(232, 284, { tol: 1, exact: true }),
      ...light(Up),
      travelTo(312, 344, { tol: 1, exact: true }),
      ...light(Up),
      collect("room 7's Force Gems", (it) => it.type === "gem", 1800),
      // The west side's posts let a Link through only where its block is pushed up out of the way.
      ...pushBlock(104, 199, Up),
      // (Past it on its right: walking up its column would push it on.)
      walkTo(120, 183),
      walkTo(120, 140),
      // The corner chest's pocket: its block up, then (from where it stood) the one beside it right.
      ...pushBlock(56, 136, Up),
      ...pushBlock(56, 120, Right),
      defeat("the corner's rat", (e) => e.type === "NZMI" && e.x < 96 * SUBPX && e.y < 128 * SUBPX, 1200),
      wait(40),
      collect("what it left", (it) => it.type === "gem", 600),
      ...chestAbove(40, 60),
      travelTo(120, 140),
      // The fence's gate: its two blocks, down then left (measured).
      ...pushBlock(264, 57, Down),
      ...pushBlock(263, 72, Left),
      ...pushBlock(183, 104, Left),
      ...pushBlock(312, 104, Right),
      ...pushBlock(183, 232, Left),
      ...pushBlock(312, 232, Right),
      waitUntil("the ring of fire out", (g) => ((g.battle.switches >>> 14) & 1) === 1, 30),
      travelTo(248, 183, { tol: 2, exact: true }),
      ...openChestFacing(Up),
      waitUntil("the key", (g) => g.adventure.keys > 0, 30),
      travelTo(248, 72),
      travelTo(248, 74),
      travelTo(456, 74),
      holdUntil("the door opened", Right, (g) => g.adventure.keys === 0 && !g.adventure.opening, 200),
      travelTo(470, 80),
      goTo(Right, 13),
    ],
  },
  {
    name: "room 13: the top corridor's block pushed east, two pots lifted, the middle block pushed east, round by the top to the east column, its block pushed down, two pots, the big block pushed down, two pots at the bottom, the bottom block pushed east, the key's chest, back by the big block's place to the locked door east into room 0",
    goals: [
      travelTo(57, 50),
      travelTo(96, 50),
      travelTo(96, 96),
      travelTo(166, 97),
      ...pushRock(192, 96, Right),
      // The pots under the corridor (the way down), where the block stood.
      travelTo(184, 101, { tol: 2, exact: true }),
      ...liftAway(Down),
      travelTo(200, 101, { tol: 2, exact: true }),
      ...liftAway(Down),
      travelTo(192, 150),
      travelTo(214, 192),
      // The middle block east: the way up where it stood, to the strip north of the middle, up to the top, east.
      ...pushRock(240, 192, Right),
      travelTo(240, 144),
      travelTo(288, 144),
      travelTo(288, 48),
      ...chestAbove(232, 56),
      travelTo(384, 48),
      // A rat that strays up here bites: beaten first.
      defeat("the rats at the top", (e) => e.type === "NZMI" && e.y < 136 * SUBPX && e.x > 224 * SUBPX, 2400),
      travelTo(384, 100),
      // The east column's block goes up or down only (measured: down, pushed from above); then the pots beside where it
      // stood, into the east side.
      ...pushRock(384, 144, Down),
      travelTo(384, 152, { tol: 2, exact: true }),
      ...liftAway(Right),
      travelTo(384, 136, { tol: 2, exact: true }),
      ...liftAway(Right),
      travelTo(424, 144),
      travelTo(376, 200),
      // The big block (four Links) down: the way to the bottom.
      ...pushRock(400, 256, Down),
      travelTo(400, 248),
      travelTo(380, 280),
      // The rats below (they bite while the blocks are pushed).
      defeat("the rats below", (e) => e.type === "NZMI" && e.y > 200 * SUBPX, 2400),
      collect("their drops", (it) => it.type === "gem", 600),
      travelTo(296, 288),
      travelTo(288, 330),
      travelTo(192, 330),
      travelTo(197, 280, { tol: 2, exact: true }),
      ...liftAway(Right),
      travelTo(197, 296, { tol: 2, exact: true }),
      ...liftAway(Right),
      travelTo(214, 288),
      ...pushRock(240, 288, Right),
      travelTo(240, 262),
      travelTo(248, 247, { tol: 2, exact: true }),
      ...openChestFacing(Up),
      waitUntil("the key", (g) => g.adventure.keys > 0, 30),
      // Back round by the bottom and up through the big block's place to the door.
      travelTo(240, 290),
      travelTo(192, 290),
      travelTo(192, 330),
      travelTo(288, 330),
      travelTo(296, 288),
      travelTo(380, 280),
      travelTo(400, 240),
      travelTo(440, 190),
      travelTo(456, 172),
      holdUntil("the door opened", Right, (g) => g.adventure.keys === 0 && !g.adventure.opening, 200),
      travelTo(470, 176),
      goTo(Right, 0),
    ],
  },
  {
    name: "room 0: the Links apart, each pushing the color blocks of his tunic (eight, in the one order that opens the way), the two candles lit in the pocket by the door, east alone, the others called",
    goals: [
      press(SEPARATE_BUTTON, 1, 10),
      ...pushColor(3, 4, 5, Right),
      ...pushColor(2, 8, 2, Right),
      ...pushColor(2, 13, 9, Up),
      ...pushColor(0, 17, 5, Down),
      ...pushColor(1, 26, 15, Left),
      ...pushColor(2, 25, 15, Down),
      ...pushColor(3, 25, 16, Right),
      ...pushColor(0, 26, 16, Down),
      // The two chests up north (the way to them open now); the green block by the third one pushed in, its chest.
      ...chestAbove(440, 72),
      ...chestAbove(232, 72),
      ...pushColor(1, 13, 9, Right),
      ...pushColor(0, 15, 15, Left),
      ...chestAbove(200, 232),
      travelTo(472, 288),
      ...light(Up),
      travelTo(472, 320),
      ...light(Down),
      waitUntil("the door open", (g) => ((g.battle.switches >>> 16) & 1) === 1, 60),
      // (The pedestal beside the lower candle draws the lamp, held already: the bow is room 8's, played at room 9's cell.)
      travelTo(472, 280),
      goTo(Right, 2),
      press(GATHER_BUTTON, 1, 10),
    ],
  },
  {
    name: "room 2: its ten Mozos beaten, both doors open; east into room 1",
    goals: [
      defeat("room 2's Mozos", (e) => e.type === "MOZO", 6000),
      // What they left, and the kill streak's Force Gem (it falls onto the Link 90 ticks after the tenth kill).
      wait(100),
      collect("their Force Gems", (it) => it.type === "gem", 1800),
      waitUntil("the doors open", (g) => ((g.battle.switches >>> 17) & 1) === 1, 300),
      travelTo(440, 150),
      travelTo(490, 150),
      goTo(Right, 1),
    ],
  },
  {
    name: "room 1: the chest's heart, the pot over the key's switch lifted, the key; the pots over its four floor points lifted (their Force Gems, among the pots); back west into room 2, north into room 9",
    goals: [
      travelTo(80, 136),
      travelTo(200, 136),
      // The chest's heart first (the Mozos hurt): it shows once the floor switch among the pots is pressed.
      travelTo(216, 136, { tol: 2, exact: true }),
      ...liftAway(Up).slice(0, 2), face(Down), press(Action, 2, 30),
      // The switch is under a pot of its own (tile 0x41: main.dol's lift leaves the button 0x12; traced in Hyrule
      // Castle room 58's area 2).
      travelTo(216, 122, { tol: 2, exact: true }),
      ...liftAway(Up).slice(0, 2), face(Down), press(Action, 2, 30),
      travelTo(216, 104, { tol: 2, exact: true }),
      waitUntil("the chest out", (g) => ((g.battle.switches >>> 19) & 1) === 1, 60),
      travelTo(216, 136),
      // The fireball trap above (248, 40) shoots at whoever comes within its reach: its shot taken on the shield first,
      // then to the chest, out of its reach, before the next.
      ...outlastShot(Up, 248, 40, 30),
      travelTo(184, 183, { tol: 2, exact: true }),
      ...openChestFacing(Up),
      travelTo(200, 232),
      // The others wait here, out of every fireball trap's reach (else the traps east shoot at them all along): apart
      // from here on (else a Link in front is what's lifted).
      press(SEPARATE_BUTTON, 1, 10),
      travelTo(392, 232, { tol: 2, exact: true }),
      face(Up), press(Action, 2, 30), face(Down), press(Action, 2, 30),
      waitUntil("the key out", (g) => ((g.battle.switches >>> 21) & 1) === 1, 60),
      // The floor points under the pots (PONT): each Force Gem shows over its point once its pot is lifted, and is
      // reached by lifting the pots on the way to it (before the key: carried, it takes the hands).
      ...liftAt(392, 327, Up),
      ...liftAt(376, 248, Down),
      ...liftAt(376, 264, Down),
      travelTo(376, 280, { tol: 2 }),
      ...liftAt(88, 327, Up),
      ...liftAt(88, 312, Up),
      ...liftAt(88, 296, Up),
      travelTo(88, 284, { tol: 2 }),
      ...liftAt(232, 231, Up),
      ...liftAt(232, 216, Up),
      ...liftAt(232, 200, Up),
      travelTo(232, 186, { tol: 2 }),
      ...liftAt(120, 152, Down),
      ...liftAt(120, 168, Down),
      ...liftAt(120, 184, Down),
      travelTo(120, 170, { tol: 2 }),
      // The key alone, the others still out of reach (a hit knocks it out of his hands: doors.ts knockKeyOut); back
      // to them, then west by the room's west side, out of the reach of the traps above and below.
      travelTo(392, 232),
      travelTo(388, 226, { tol: 2, exact: true }), face(Up), press(Action, 2, 20),
      waitUntil("the key", (g) => g.adventure.keys > 0, 60),
      travelTo(200, 232),
      // (A shot from the trap east comes along this row: on the shield, before the others come.)
      face(Right),
      waitUntil("the fireballs gone by", (g) => !g.adventure.enemies.some((e) => e.type === "OKTM" && e.kind === FIRE_TRAP_KIND), 300),
      press(GATHER_BUTTON, 1, 10),
      waitUntil("together", (g) => g.adventure.formation === "trail", 300),
      travelTo(100, 232),
      travelTo(56, 232),
      travelTo(56, 136),
      travelTo(20, 136),
      goTo(Left, 2),
      travelTo(360, 60),
      travelTo(360, 34),
      goTo(Up, 9),
    ],
  },
  {
    name: "room 9's cell, played alone as room 8: up the east side to the locked door north, the key; a Link thrown over the pit onto the island takes the bow from its pedestal and strikes the crystal (the bridge), the four together again; back to the door, the others left by it (room 3's Keese go for every Link), room 3 alone",
    goals: [
      travelTo(360, 300),
      travelTo(360, 60),
      travelTo(250, 48),
      holdUntil("the door opened", Up, (g) => g.adventure.keys === 0 && !g.adventure.opening, 200),
      // Between the pit's two candle stands, the Links apart, the one behind lifted (facing east), turned west with a tap
      // and thrown over the 2-tile pit onto the island (the walkthrough's "throw a Link to the other side and grab the
      // Bow"; the lift and the throw are Shadow Battle's, carry.ts: ~43 px here, a toss flew 47 in Dolphin); he takes
      // the controls, the bow from its pedestal (it draws the bow: gear.ts) and strikes the crystal: the bridge (switch
      // 16's PNPCs over the pit), the others called across. Assumed: the whole way (not traced in Dolphin).
      travelTo(360, 60),
      travelTo(360, 224),
      travelTo(327, 224, { tol: 1, exact: true }),
      press(SEPARATE_BUTTON, 1, 10),
      face(Right),
      press(Action, 2, 30),
      press(Left, 1, 2),
      press(Action, 2, 2),
      waitUntil("thrown onto the island", (g) => g.battle.fighters.every((f) => f.move === "none") && g.players.some((p) => p.x < 288 * SUBPX), 120),
      {
        name: "the thrown Link in control",
        limit: 10,
        next(g, _s, t) {
          const k = g.players.findIndex((p, i) => i > 0 && p.x < 288 * SUBPX);
          return k < 0 ? true : t === 0 ? selectButtons(g.adventure.colors[k]!) : 0;
        },
      },
      travelTo(200, 200, { tol: 1, exact: true }),
      face(Up),
      press(Action, 2, 4),
      waitUntil("the bow", (g) => g.adventure.gear === "bow", 30),
      readOn(),
      travelTo(232, 224, { tol: 1, exact: true }),
      face(Down),
      press(Button.Sword, 2, 20),
      waitUntil("the bridge east", (g) => switchOn(g.battle, 16), 90),
      press(GATHER_BUTTON, 1, 10),
      waitUntil("together", (g) => g.adventure.formation === "trail", 300),
      travelTo(296, 224),
      travelTo(360, 224),
      travelTo(360, 60),
      travelTo(250, 48),
      travelTo(250, 30),
      press(SEPARATE_BUTTON, 1, 10),
      goTo(Up, 3),
    ],
  },
  {
    name: "room 3: arrows shot up through the near ledge's lit torches light the four candles across the pit (the Keese out, the crystal shown), one at the crystal lays the bridge; the Keese beaten, the door north opens; the gem rain gathered, the crystal struck again for the winged gems on the peninsulas: room 11",
    goals: [
      ...shootFrom(104, 300, Up),
      waitUntil("the first candle", (g) => switchOn(g.battle, 18), 90),
      ...shootFrom(184, 300, Up),
      waitUntil("the second candle", (g) => switchOn(g.battle, 27), 90),
      ...shootFrom(328, 300, Up),
      waitUntil("the third candle", (g) => switchOn(g.battle, 26), 90),
      ...shootFrom(408, 300, Up),
      waitUntil("the fourth candle: the crystal shown", (g) => switchOn(g.battle, 19), 90),
      // Arrows at the crystal from below until the bridge is laid (a Keese resting in the way takes one), the Keese
      // that come struck down meanwhile.
      guard("arrows at the crystal, the Keese that come beaten", keese, {
        limit: 4000,
        until: (g) => switchOn(g.battle, 16),
        idle: sequence("an arrow at the crystal", [...shootFrom(298, 300, Up), wait(30)]),
      }),
      // The rest, from the bridge and the ledge (they wake for a Link within 60 px and come).
      guard("room 3's Keese", keese, { patrol: KEESE_PATROL, limit: 15000, shoot: true }),
      waitUntil("the door north open", (g) => switchOn(g.battle, 21), 120),
      // The gem rain (and what the Keese left, the kill streak's gems) gathered where the Links can walk.
      waitUntil("the rain down", (g) => g.adventure.rains.every((r) => r.state === "done") && g.adventure.pickups.every((it) => it.actor >= 0 || it.z === 0), 900),
      collect("the gem rain", (it) => it.type === "gem", 6000),
      // The crystal struck again from the ledge under it: the bridge goes, the two peninsulas are back, and the winged
      // Force Gems at their tips are reached.
      travelTo(296, 88, { tol: 1, exact: true }),
      face(Up),
      press(Button.Sword, 2, 20),
      waitUntil("the bridge gone", (g) => !switchOn(g.battle, 16), 30),
      collect("the winged gems", (it) => it.from === "HNRY", 1800),
      travelTo(248, 48),
      // The others called from room 9, then north together.
      press(GATHER_BUTTON, 1, 10),
      waitUntil("together", (g) => !g.adventure.away && g.adventure.formation === "trail", 300),
      goTo(Up, 11),
    ],
  },
  {
    name: "room 11: down the hole of the south pocket, up the stairs of areas 5 and 7 (their four chests) and out by the hole of the north part; the west chain lever (the heart's chest), the east one (the door north): room 4",
    goals: [
      // The hole is entered from above (its rim is solid on the sides).
      travelTo(336, 304, { tol: 1, exact: true }),
      holdUntil("down the hole", Down, inArea(5), 300),
      travelTo(176, 30),
      holdUntil("up the stairs", Up, (g) => !g.adventure.warp && g.players[0]!.x > 300 * SUBPX, 300),
      ...chestAbove(392, 90),
      ...chestAbove(408, 90),
      travelTo(400, 30),
      holdUntil("up into area 7", Up, inArea(7), 300),
      travelTo(48, 30),
      holdUntil("up into area 5's chests", Up, inArea(5), 300),
      ...chestAbove(392, 346),
      ...chestAbove(408, 346),
      travelTo(400, 290),
      holdUntil("up into area 7", Up, inArea(7), 300),
      travelTo(432, 30),
      holdUntil("up the stairs", Up, (g) => !g.adventure.warp && g.players[0]!.y > 300 * SUBPX, 300),
      travelTo(368, 410),
      holdUntil("up out of the hole north", Up, inArea(0), 300),
      ...pullLever(176, 21),
      ...chestAbove(184, 170),
      ...pullLever(336, 20),
      travelTo(256, 40),
      goTo(Up, 4),
    ],
  },
  {
    name: "room 4: the Links apart, the red one in control beats Shadow Link's dark form, then the Link of his color his colored form and him down (shadowlink.ts), his Force Gem, the others called; north into room 5",
    goals: [
      press(SEPARATE_BUTTON, 1, 10),
      press(selectButtons(1), 1, 1),
      flankShadow("Shadow Link's dark form", (g) => g.adventure.enemies.some((e) => e.type === "SLK2" && shadowForm(e) > 0), 4000),
      shadowColorInControl,
      flankShadow("Shadow Link", (g) => !g.adventure.enemies.some((e) => e.type === "SLK2" && e.state !== "die"), 6000),
      waitUntil("gone", (g) => !g.adventure.enemies.some((e) => e.type === "SLK2"), 240),
      collect("his Force Gem", (it) => it.type === "gem", 600, false, true),
      waitUntil("the door north", (g) => switchOn(g.battle, 16), 120),
      press(GATHER_BUTTON, 1, 10),
      waitUntil("together", (g) => g.adventure.formation === "trail", 300),
      travelTo(256, 40),
      goTo(Up, 5),
    ],
  },
  {
    name: "room 5: onto the goal with the Force Gems: the stage cleared",
    goals: [travelTo(256, 300), holdUntil("onto the goal: the stage cleared", Up, (g) => g.adventure.cleared > 0, 200)],
  },
];

export const CAVE_OF_NO_RETURN_ROUTE: readonly Goal[] = CAVE_OF_NO_RETURN_MILESTONES.flatMap((m) => m.goals);

void Down;
void Left;
void Right;
