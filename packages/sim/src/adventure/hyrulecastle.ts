// Hyrule Castle (stage 1-4, boss013) as a route for drive.ts's RoutePlayer, played by the sim's rules (docs/ADVENTURE.md
// "Hyrule Castle"): as far as it goes, rooms 0, 1 (its side views, the walls' crystal, the drawbridge), 2, 3 (a pull
// switch, the gate, its areas 2 and 4, the east rampart), 5 (the gatehouse's bow, an arrow through its door, the
// garden's cracked wall, the tower's cannons and small key), back through room 3's locked door to its north corridor,
// 6 (the courtyard's soldiers, kill counters and gates, its gem rain gathered), 57's lower band into room 9, 9 (the big handle pulled in the
// wide formation, the tower lowered, its areas 2 and 3: the bombs from a pedestal, the throne room's cracked wall), its
// area 5 (a bomb at the fragile blocks, the first escort Zora: zoras.ts) and back with it to room 57 (its switch 18),
// 58 (its four crystals lit by a spin in the cross formation, its tower lowered; area 2: a Link thrown over the pits,
// the pot off its floor switch, area 3's second Zora, Y over the pits) and back to 57 (19, the fairy: the barrier
// gone), 57's areas 2 and 3 round to its two platforms' switch pairs (the box formation: the checkerboard), 10 (a pot
// off its floor point, the generator's soldiers, the door), its area 2 (its two Force Gems, the throne pushed in the
// long formation, the curtain behind it cut), areas 7 and 6 (cannons up through both side views, each middle column's
// Force Gems on the way, out onto the TV's walkway), north into room 11, Phantom Ganon fought till the staircase
// comes, down it into room 12 and onto the goal with 2,605 Force Gems: the stage cleared (docs/ADVENTURE.md "Hyrule
// Castle"). Used by hyrulecastle.realdisc.test.ts and the browser (apps/game's window.fso.route).
import { Button, SUBPX } from "../player.ts";
import { actorKey, type AdventureGame } from "./adventure.ts";
import { collect, defeat, face, fight, formation, goTo, holdUntil, openChestFacing, press, readOn, sequence, shadowGone, travelTo, wait, waitUntil, type Goal } from "./drive.ts";
import { enemyActive, enemyShown } from "./enemies.ts";
import { GATHER_BUTTON, SEPARATE_BUTTON, selectButtons } from "./formation.ts";
import { BLADE_STATE } from "./traps.ts";

const { Up, Down, Left, Right, Sword, Action, Item } = Button;
const swing = (dir: number): Goal[] => [face(dir), press(Sword, 2, 14)];
const leaderX = (g: AdventureGame) => g.players[0]!.x / SUBPX;
const leaderY = (g: AdventureGame) => g.players[0]!.y / SUBPX;
const inArea = (area: number) => (g: AdventureGame) => g.adventure.area === area && !g.adventure.warp;
const switchOn = (n: number) => (g: AdventureGame) => ((g.battle.switches >>> n) & 1) === 1;
const inCannon = (g: AdventureGame) => g.adventure.links[0]!.mode === "cannon";
const landed = (g: AdventureGame) => g.adventure.links[0]!.mode === "walk" && !g.adventure.links[0]!.air;
/** Room 5's cracked wall (DOOR kind 2 at (80, 256)): its index in the room's list. */
const CRACKED_WALL = 22;
/** Room 9's area 3: the cracked east wall (DOOR kind 2 at (192, 64)). */
const THRONE_ROOM_WALL = 45;
/**
 * Room 9's area 2: past its two blade traps (traps.ts: at (72, 184) and (184, 184), each turns toward the nearest Link
 * within 22 px across its row and slides at him, and they stop where they meet, in the middle). From (128, y0), in
 * their row but clear of where they meet, the leader sets them off; once they've met and eased 20 px back on their way
 * home (they wait till they're there), the four go through to (128, y1).
 */
const pastBladeTraps = (y0: number, y1: number): Goal[] => [
  travelTo(128, y0, { tol: 1, exact: true }),
  waitUntil(
    "the blade traps met and on their way back",
    (g) => g.adventure.enemies.filter((e) => e.type === "TRAP").every((e) => e.shot === BLADE_STATE.back && Math.abs(e.x - e.homeX) <= 30 * SUBPX),
    240,
  ),
  travelTo(128, y1),
];
/** Hands the controls to the Link in slot 1 (the D-pad of his color). */
const handOver = (): Goal => ({ name: "hand over to the next Link", limit: 5, next: (g, _s, t) => (t >= 3 ? true : t === 0 ? selectButtons(g.adventure.colors[1]!) : 0) });
/** Hands the controls to the first other Link (slot) `which` picks. */
const handOverTo = (which: (g: AdventureGame, slot: number) => boolean): Goal => ({
  name: "hand over to that Link",
  limit: 5,
  next: (g, _s, t) => (t >= 3 ? true : t === 0 ? selectButtons(g.adventure.colors[g.players.findIndex((_p, i) => i > 0 && which(g, i))]!) : 0),
});

const PHANTOM_GANON_NAME = "room 11: Phantom Ganon fought (his ball sent back four times strikes him down, struck while down) till he's gone, the staircase";

/** The route, in milestones (each a list of goals); `HYRULE_CASTLE_ROUTE` is all of them. */
export const HYRULE_CASTLE_MILESTONES: readonly { name: string; goals: readonly Goal[] }[] = [
  {
    name: "room 0: up the path to the owl, who talks as the Links come to y 204.5 (read through), then on up into room 1",
    goals: [holdUntil("up to the owl", Up, (g) => g.adventure.talk !== null, 400), readOn(), travelTo(256, 40), goTo(Up, 1)],
  },
  {
    name: "room 1: up the left-hand garden through its bushes to the two-Link rock, lifted off its hole, down into the side view",
    goals: [
      travelTo(88, 316),
      ...[296, 280, 264, 248, 232, 216, 200, 184, 168].flatMap((y) => [...swing(Up), travelTo(88, y, { tol: 2, exact: true })]),
      // The bushes beside the rock, then the two in a column right of it.
      travelTo(88, 168, { tol: 2, exact: true }),
      ...swing(Left),
      travelTo(88, 152, { tol: 2, exact: true }),
      ...swing(Left),
      travelTo(74, 152, { tol: 2, exact: true }),
      formation("long"),
      waitUntil("in a column", (g) => g.adventure.formation === "long", 30),
      face(Left),
      press(Action, 2, 4),
      waitUntil("the rock carried", (g) => g.adventure.heavy?.phase === "carry", 120),
      face(Right),
      press(Action, 2, 4),
      // Then trailing again, as one goal (the column's Links would hold the leader at the hole's walls: formation.ts
      // holdFormation; the bent playtests count the goals).
      sequence("the rock thrown, then together", [
        waitUntil("the rock thrown", (g) => !g.adventure.heavy, 60),
        press(GATHER_BUTTON, 1, 0),
        waitUntil("together", (g) => g.adventure.formation === "trail", 120),
      ]),
      // The hole's steps go down from its top side.
      travelTo(76, 134),
      travelTo(48, 134),
      holdUntil("down the hole", Down, (g) => g.adventure.area === 5 && !g.adventure.warp, 300),
    ],
  },
  {
    name: "room 1's side views: down the ladder, along the passage east into area 6, up its two ladders to its floor switches' room",
    goals: [
      holdUntil("down the ladder", Down, (g) => g.players[0]!.y > 76 * 256, 300),
      holdUntil("to the next ladder", Right, (g) => g.players[0]!.x > 118 * 256, 300),
      holdUntil("down it", Down, (g) => g.players[0]!.y > 118 * 256, 300),
      holdUntil("east along the passage", Right, (g) => g.players[0]!.x > 488 * 256, 600),
      holdUntil("through its east end", Right | Up, (g) => g.adventure.area === 6 && !g.adventure.warp, 300),
      holdUntil("to area 6's ladder", Right, (g) => g.players[0]!.x > 118 * 256, 300),
      holdUntil("up it", Up, (g) => g.players[0]!.y < 330 * 256, 600),
      holdUntil("to the next", Right, (g) => g.players[0]!.x > 198 * 256, 300),
      holdUntil("up it", Up, (g) => g.players[0]!.y < 236 * 256, 600),
    ],
  },
  {
    name: "room 1's area 6: the right ledge's pots, a Link thrown over the gap onto the left one, its pots, a Link on each switch (19: the bridge), the bridge to the left ladder, up and out onto the walls",
    goals: [
      holdUntil("down to the ledge", Down, (g) => leaderY(g) > 262, 300),
      // The three pots on the right-hand ledge (the last on switch 6), lifted from the ladder and along.
      face(Left),
      press(Action, 2, 4),
      holdUntil("to the next pot", Left, (g) => leaderX(g) <= 183.5, 60),
      press(Action, 2, 4),
      holdUntil("to the last pot", Left, (g) => leaderX(g) <= 167.5, 60),
      press(Action, 2, 4),
      holdUntil("to the gap's edge", Left, (g) => leaderX(g) < 135, 60),
      wait(30),
      // Apart (the last Link stays on switch 6), the first behind lifted and thrown over the gap.
      press(SEPARATE_BUTTON, 1, 4),
      holdUntil("past the Link behind", Right, (g) => leaderX(g) >= 155, 60),
      face(Left),
      press(Action, 2, 4),
      waitUntil("carried", (g) => g.battle.fighters[0]!.move === "carry", 60),
      holdUntil("back to the edge", Left, (g) => leaderX(g) <= 137.5, 60),
      press(Action, 2, 4),
      waitUntil("thrown, down", (g) => g.battle.fighters.every((f) => f.move === "none"), 120),
      // The thrown Link lifts the left-hand ledge's pots and stays on switch 5: both held, 19 for good.
      handOver(),
      face(Left),
      press(Action, 2, 4),
      holdUntil("to the next pot", Left, (g) => leaderX(g) <= 88, 60),
      press(Action, 2, 4),
      holdUntil("to the last pot", Left, (g) => leaderX(g) <= 72, 60),
      press(Action, 2, 4),
      holdUntil("onto switch 5", Left, (g) => leaderX(g) <= 56, 120),
      waitUntil("the bridge", switchOn(19), 30),
      // The first leader goes on alone: up the right ladder, over the bridge, up the left one, out at the top.
      handOver(),
      holdUntil("to the right ladder", Right, (g) => leaderX(g) >= 199, 120),
      holdUntil("up it", Up, (g) => leaderY(g) <= 218, 120),
      holdUntil("along the bridge", Left, (g) => leaderX(g) <= 40, 200),
      holdUntil("up the left ladder", Up, (g) => leaderY(g) <= 106, 200),
      holdUntil("to the way out", Right, (g) => leaderX(g) >= 119.5, 200),
      holdUntil("up and out onto the walls", Up, inArea(0), 300),
    ],
  },
  {
    name: "room 1's walls: the two blocks pushed, the crystal struck (1), the wait and the camera (2, 3 → 16), the drawbridge down (17)",
    goals: [
      travelTo(376, 100),
      holdUntil("the block pushed up", Up, (g) => g.adventure.blocks.length === 1 && g.adventure.blocks[0]!.tick >= 32, 200),
      travelTo(376, 66),
      travelTo(360, 70),
      holdUntil("the block pushed down", Down, (g) => g.adventure.blocks.length === 2 && g.adventure.blocks[1]!.tick >= 32, 200),
      travelTo(344, 88),
      ...swing(Left),
      waitUntil("the crystal lit", switchOn(1), 30),
      waitUntil("the drawbridge down", switchOn(17), 600),
    ],
  },
  {
    name: "room 1, back: the others called, down the hole, area 6's two chests, its bridge and ladders, area 5, the garden's bushes again, through the gate into room 2",
    goals: [
      press(GATHER_BUTTON, 1, 0),
      waitUntil("together", (g) => g.adventure.formation === "trail", 120),
      travelTo(360, 88),
      travelTo(360, 70),
      travelTo(376, 66),
      travelTo(376, 120),
      holdUntil("down the hole", Down, inArea(6), 300),
      waitUntil("landed", (g) => leaderY(g) >= 104 && !g.players[0]!.moving, 120),
      holdUntil("to the chest", Right, (g) => leaderX(g) >= 184, 120),
      ...openChestFacing(Right),
      holdUntil("to the left ladder", Left, (g) => leaderX(g) <= 40, 300),
      holdUntil("down it", Down, (g) => leaderY(g) >= 216, 300),
      holdUntil("along the bridge", Right, (g) => leaderX(g) >= 199.5, 300),
      holdUntil("down the right ladder", Down, (g) => leaderY(g) >= 328, 300),
      holdUntil("to the lower chest", Left, (g) => leaderX(g) <= 72, 300),
      ...openChestFacing(Left),
      holdUntil("to the middle ladder", Right, (g) => leaderX(g) >= 119.5, 300),
      holdUntil("down it", Down, (g) => leaderY(g) >= 486, 300),
      holdUntil("west along the passage", Left, (g) => leaderX(g) <= 12, 300),
      holdUntil("west into area 5", Left | Up, inArea(5), 300),
      holdUntil("west to its ladder", Left, (g) => leaderX(g) <= 120, 600),
      holdUntil("up it", Up, (g) => leaderY(g) <= 93, 300),
      holdUntil("west to the next", Left, (g) => leaderX(g) <= 24, 300),
      holdUntil("up it, out of the garden's hole", Up, inArea(0), 300),
      travelTo(76, 134),
      travelTo(88, 134, { tol: 2, exact: true }),
      // The garden's bushes grew back (the area left): down their column again.
      ...[150, 166, 182, 198, 214, 230, 246, 262, 278].flatMap((y) => [...swing(Down), travelTo(88, y, { tol: 2, exact: true })]),
      ...swing(Down),
      travelTo(88, 316),
      travelTo(256, 330),
      travelTo(256, 40),
      // Apart: the leader goes into room 2 alone (its captain's lunges and its soldiers on one Link, not four).
      press(SEPARATE_BUTTON, 1, 10),
      goTo(Up, 2),
    ],
  },
  {
    name: "room 2: its sword soldiers and captain beaten (16: the two chests; the spikes down), the chests, up into room 3",
    goals: [
      fight("room 2's soldiers and captain", (e) => e.type === "SLR1" || e.type === "SLR4", 9000),
      collect("their drops", (it) => it.type === "gem" || it.type === "heart", 3000),
      press(GATHER_BUTTON, 1, 0),
      waitUntil("together", (g) => g.adventure.formation === "trail", 120),
      waitUntil("the chests", switchOn(16), 60),
      travelTo(248, 200),
      ...openChestFacing(Up),
      travelTo(264, 200),
      ...openChestFacing(Up),
      travelTo(256, 30),
      goTo(Up, 3),
    ],
  },
  {
    name: "room 3: the right-hand handle's bush cut, the handle pulled out (5; the camera 7, 128 ticks on 6: 24), the gate (25), into area 2",
    goals: [
      travelTo(408, 300),
      ...swing(Up),
      travelTo(408, 282, { tol: 1, exact: true }),
      face(Up),
      holdUntil("the handle pulled out", Action | Down, switchOn(5), 120),
      waitUntil("the gate open", switchOn(25), 400),
      travelTo(256, 214),
      holdUntil("through the gate into area 2", Up, inArea(2), 300),
    ],
  },
  {
    name: "room 3's area 2: its two sword soldiers beaten, out by its east door into area 4, round it and out onto the TV's east rampart, east into room 5",
    goals: [
      defeat("area 2's soldiers", (e) => e.type === "SLR1", 3000),
      travelTo(470, 128),
      holdUntil("east into area 4", Right, inArea(4), 300),
      travelTo(128, 280),
      holdUntil("down out onto the rampart", Down, inArea(0), 300),
      travelTo(470, 176),
      goTo(Right, 5),
    ],
  },
  {
    name: "room 5: along the walls' tops (their Force Gems) to the gatehouse's door, down into its area 2",
    goals: [
      travelTo(168, 100),
      travelTo(310, 88),
      travelTo(312, 40),
      travelTo(368, 40),
      holdUntil("down into area 2", Down, inArea(2), 300),
    ],
  },
  {
    name: "room 5's gatehouse: the bow from its right-hand pedestal, an arrow shot over the pit through the south door onto the crystal below it (17: the bridge), over it and out into the channel",
    goals: [
      travelTo(200, 41, { tol: 1 }),
      face(Right),
      press(Action, 2, 4),
      waitUntil("the bow", (g) => g.adventure.gear === "bow", 30),
      readOn(),
      travelTo(152, 66),
      travelTo(128, 70, { tol: 1, exact: true }),
      face(Down),
      press(Item, 2, 4),
      waitUntil("the crystal lit through the door", switchOn(17), 60),
      travelTo(128, 120),
      holdUntil("through the south door onto the TV", Down, inArea(0), 300),
      // West out of the channel's top between 17's bollards, off the ledge (304, 192) down into the garden.
      travelTo(311.5, 168, { tol: 0.6, exact: true }),
      holdUntil("off the ledge into the garden", Down, (g) => leaderY(g) > 240 && g.adventure.links[0]!.mode === "walk", 120),
    ],
  },
  {
    name: "room 5's garden: a bomb flower's bomb thrown at the cracked wall (DOOR kind 2), out of its way, through the hole into area 5 (the tower)",
    goals: [
      travelTo(24, 312, { tol: 1, exact: true }),
      face(Up),
      press(Action, 2, 4),
      waitUntil("the bomb lifted", (g) => g.battle.fighters[0]!.move === "carry", 60),
      travelTo(96, 289, { tol: 1, exact: true }),
      face(Up),
      press(Action, 2, 4),
      travelTo(96, 326),
      waitUntil("the wall blown open", (g) => g.adventure.opened.includes(actorKey(5, CRACKED_WALL)), 400),
      holdUntil("up through the hole into area 5", Up, inArea(5), 300),
    ],
  },
  {
    name: "room 5's area 5 (the tower, a side view): up its ladder, into the middle cannon, shot up into the niche with the small key's chest, the key; the cannon again, into the passage, the shaft's cannon, shot out at the top onto the TV",
    goals: [
      holdUntil("along the floor to the ladder", Right, (g) => leaderX(g) >= 215, 300),
      holdUntil("up it", Up, (g) => leaderY(g) <= 300, 300),
      holdUntil("off it to the left", Left, (g) => leaderX(g) <= 167, 120),
      waitUntil("in the middle cannon", inCannon, 120),
      press(Item, 1, 1),
      holdUntil("shot up, steered left into the niche", Left, landed, 300),
      holdUntil("against the chest", Left, (g) => leaderX(g) <= 103.5, 30),
      ...openChestFacing(Left),
      waitUntil("the small key", (g) => g.adventure.keys > 0, 30),
      holdUntil("off the niche to the right", Right, (g) => leaderX(g) >= 162, 120),
      waitUntil("in the middle cannon again", inCannon, 200),
      press(Item, 1, 1),
      // Up against the wall over the niche, down past it and the wall under it, then left into the passage.
      holdUntil("shot up, against the wall", Left, (g) => leaderX(g) <= 120 && g.adventure.links[0]!.vy > 0, 300),
      waitUntil("down past the niche", (g) => leaderY(g) >= 226, 120),
      holdUntil("steered left into the passage", Left, landed, 120),
      holdUntil("left off its end into the shaft", Left, (g) => leaderX(g) <= 44, 120),
      waitUntil("in the shaft's cannon", inCannon, 120),
      press(Item, 1, 1),
      // Out of the hole on the TV (its top-left yard), steered down and left onto the ledge's corridor (let go of, he
      // falls back down the hole).
      waitUntil("shot out at the top", (g) => !!g.adventure.warp?.launch, 120),
      holdUntil("out of the TV's hole onto its yard", Down | Left, inArea(0), 400),
    ],
  },
  {
    name: "room 5 back west with the key: off the ledge below the tower's way out into the walls' corridor, west into room 3, into its area 4, west into area 2, the key into its locked top door, up through area 6 onto the TV",
    goals: [
      travelTo(39.5, 100, { tol: 0.6, exact: true }),
      holdUntil("off the ledge into the corridor", Down, (g) => leaderY(g) > 136 && g.adventure.links[0]!.mode === "walk", 120),
      travelTo(24, 176),
      goTo(Left, 3),
      travelTo(440, 160),
      holdUntil("up into area 4", Up, inArea(4), 300),
      travelTo(24, 80),
      holdUntil("west into area 2", Left, inArea(2), 300),
      travelTo(252, 40),
      holdUntil("the key into the locked door, up through it into area 6", Up, inArea(6), 300),
      holdUntil("up its corridor onto the TV", Up, inArea(0), 600),
    ],
  },
  {
    name: "room 6 (the courtyard): its three sword soldiers (3 kills: 25, the gate 16), the iron-ball soldier let out (4: 17), the four gates' 48 sword soldiers (WTSW 18-21, 52 kills: 24, the way north and a gem rain), north into room 57",
    goals: [
      travelTo(256, 30),
      // Apart: the leader fights the courtyard alone.
      press(SEPARATE_BUTTON, 1, 10),
      goTo(Up, 6),
      fight("room 6's three sword soldiers", (e) => e.type === "SLR1", 3000),
      waitUntil("the gate open", switchOn(16), 300),
      shootBallSoldier(),
      fight("the four gates' wave of sword soldiers", (e) => e.type === "SLR1", 20000, switchOn(24)),
      press(GATHER_BUTTON, 1, 0),
      waitUntil("together", (g) => g.adventure.formation === "trail", 120),
      // The gem rain (256 gems over 128 ticks, ~40 more to fall) and the soldiers' drops.
      wait(200),
      collect("the gem rain and the soldiers' drops", (it) => it.type === "gem", 9000),
      travelTo(248, 30),
      goTo(Up, 57),
    ],
  },
  {
    // (Its floor switches' puzzle, two Links on each pair latching the checkerboard open, leads north to room 10: not
    // taken.)
    name: "room 57 (room 7 played alone): east along its lower band into room 9",
    goals: [travelTo(490, 300), goTo(Right, 9)],
  },
  {
    name: "room 9: its three sword soldiers beaten, the big handle (PSWB) pulled out by the four in the wide formation (17), the camera (16: the tower lowered)",
    goals: [
      fight("room 9's sword soldiers", (e) => e.type === "SLR1", 4000),
      shadowGone(),
      travelTo(296, 240),
      travelTo(304, 152, { tol: 1, exact: true }),
      formation("wide"),
      waitUntil("in a row", (g) => g.players.every((p) => p.y === g.players[0]!.y && !p.moving), 60),
      face(Up),
      holdUntil("the big handle pulled out", Action | Down, switchOn(17), 400),
      waitUntil("the tower lowered", switchOn(16), 120),
    ],
  },
  {
    name: "room 9: the others called back, through the lowered tower into the walled yard, up through its door into area 2",
    goals: [
      press(GATHER_BUTTON, 1, 0),
      waitUntil("together", (g) => g.adventure.formation === "trail", 120),
      travelTo(128, 280),
      travelTo(128, 110),
      holdUntil("up through the door into area 2", Up, inArea(2), 300),
    ],
  },
  {
    name: "room 9's area 2: up its stairs to the four weapons, the bombs from the top right pedestal, up through its top door into area 3",
    goals: [
      ...pastBladeTraps(200, 120),
      travelTo(164, 72, { tol: 1 }),
      face(Right),
      press(Action, 2, 4),
      waitUntil("the bombs", (g) => g.adventure.gear === "bombs", 30),
      readOn(),
      travelTo(128, 40),
      holdUntil("up through the top door into area 3", Up, inArea(3), 300),
    ],
  },
  {
    name: "room 9's area 3 (the throne room): a bomb put down at the cracked east wall (DOOR kind 2), out of its way, through it into area 5",
    goals: [
      travelTo(172, 76, { tol: 1, exact: true }),
      face(Right),
      press(Item, 2, 4),
      travelTo(96, 112),
      waitUntil("the wall blown open", (g) => g.adventure.opened.includes(actorKey(9, THRONE_ROOM_WALL)), 400),
      travelTo(176, 76),
      holdUntil("east through it into area 5", Right, inArea(5), 300),
    ],
  },
  {
    name: "room 9's area 5 (a side view): a bomb put down at the column of fragile blocks, out of its way, the blocks broken, on to the escort Zora (it goes with the Links)",
    goals: [
      holdUntil("to the blocks", Right, (g) => leaderX(g) >= 84, 200),
      press(Item, 2, 4),
      holdUntil("away from the bomb", Left, (g) => leaderX(g) <= 40, 200),
      waitUntil("the blocks broken", (g) => g.adventure.broken.length >= 2, 300),
      holdUntil("to the Zora", Right, (g) => !!g.adventure.escort, 300),
      readOn(),
    ],
  },
  {
    name: "room 9, back west with the Zora: out of area 5 into the throne room, down into area 2, down out onto the TV, down through the lowered tower, west along the lower band into room 57, where it walks to its arrival point (18)",
    goals: [
      holdUntil("west to its way in", Left, (g) => leaderX(g) <= 8, 400),
      holdUntil("up through it into the throne room", Up, inArea(3), 300),
      travelTo(128, 120),
      holdUntil("down into area 2", Down, inArea(2), 300),
      ...pastBladeTraps(168, 220),
      holdUntil("down out onto the TV", Down, inArea(0), 300),
      travelTo(128, 280),
      travelTo(24, 300),
      goTo(Left, 57),
      waitUntil("the Zora at its arrival point", switchOn(18), 600),
    ],
  },
  {
    name: "room 57: west along its lower band into room 58",
    goals: [travelTo(24, 300), goTo(Left, 58)],
  },
  {
    name: "room 58 (room 8 played alone): in the cross formation amid its four crystals, a spin attack lights them all at once (5-8: 9), the camera (16: the tower lowered)",
    goals: [
      travelTo(232, 296, { tol: 1, exact: true }),
      formation("cross"),
      waitUntil("in a diamond", (g) => g.players.every((p) => !p.moving) && g.players[3]!.y === g.players[0]!.y + 32 * 256, 60),
      press(Sword, 60, 30),
      waitUntil("the four crystals lit together", switchOn(9), 30),
      waitUntil("the tower lowered", switchOn(16), 120),
    ],
  },
  {
    // (Area 2's entry lane is walled in, pits across its top: how the Links get past them to the floor switches' room,
    // and back out with the second Zora, is where the route stops: docs/ADVENTURE.md "Hyrule Castle".)
    name: "room 58: the others called back, up through the lowered tower's door into area 2",
    goals: [
      press(GATHER_BUTTON, 1, 0),
      waitUntil("together", (g) => g.adventure.formation === "trail", 120),
      travelTo(384, 150, { tol: 1, exact: true }),
      holdUntil("up through the door into area 2", Up, inArea(2), 300),
    ],
  },
  {
    name: "room 58's area 2: apart, the Link below lifted, carried up the lane and thrown over its pits, handed the controls",
    goals: [
      press(SEPARATE_BUTTON, 1, 10),
      face(Down),
      press(Action, 2, 4),
      waitUntil("carried", (g) => g.battle.fighters[0]!.move === "carry", 60),
      holdUntil("up the lane", Up, (g) => leaderY(g) <= 172.5, 60),
      press(Action, 2, 4),
      waitUntil("thrown, down", (g) => g.battle.fighters.every((f) => f.move === "none") && g.players.every((p) => !p.moving), 120),
      handOverTo((g, i) => g.players[i]!.y < 144 * SUBPX),
    ],
  },
  {
    name: "room 58's area 2, past the pits: up the stairs, the pot off the right-hand floor switch (17: the top door), up through it into area 3",
    goals: [
      travelTo(160, 60),
      travelTo(208, 44, { tol: 1 }),
      face(Right),
      press(Action, 2, 30),
      face(Left),
      press(Action, 2, 30),
      travelTo(229, 44, { tol: 1 }),
      waitUntil("the switch", switchOn(17), 30),
      travelTo(160, 30),
      holdUntil("up through the top door into area 3", Up, inArea(3), 300),
    ],
  },
  {
    name: "room 58's area 3: up to the second escort Zora (it goes with the Link), back down through its door into area 2, down the stairs to the pits' edge",
    goals: [
      holdUntil("up to the Zora", Up, (g) => !!g.adventure.escort, 120),
      readOn(),
      holdUntil("down through the door into area 2", Down, inArea(2), 300),
      travelTo(160, 128.8, { tol: 1 }),
      waitUntil("the Zora behind him", (g) => g.adventure.escort?.area === 2, 30),
    ],
  },
  {
    name: "room 58's area 2: the controls to a Link south of the pits, Y: the one north of them dashes over onto him; down the lane, the Zora dashing over the pits after them, out through the bottom door onto the TV",
    goals: [
      handOverTo((g, i) => g.players[i]!.y > 160 * SUBPX),
      waitUntil("the Zora held at the pits' edge", (g) => g.adventure.escort!.y >= 135 * SUBPX, 60),
      press(GATHER_BUTTON, 1, 0),
      waitUntil("together", (g) => g.adventure.formation === "trail", 120),
      travelTo(160, 186),
      holdUntil("down through the bottom door onto the TV", Down, inArea(0), 300),
      waitUntil("the Zora with them", (g) => g.adventure.escort?.area === 0, 30),
    ],
  },
  {
    name: "room 58 back east with the second Zora along the lower band into room 57, where it walks to its arrival point (19); both waiting, the great fairy (16: the barrier gone)",
    goals: [
      travelTo(472, 300),
      goTo(Right, 57),
      waitUntil("the Zora at its arrival point", switchOn(19), 600),
      waitUntil("the great fairy, the barrier gone", switchOn(16), 600),
    ],
  },
  {
    name: "room 57, past the barrier: up through its doorway into area 2, its sword soldier beaten, its west door into area 3's west half, round its top and down onto the TV's west platform",
    goals: [
      travelTo(256, 170),
      holdUntil("up through the doorway into area 2", Up, inArea(2), 300),
      defeat("area 2's sword soldier", (e) => e.type === "SLR1", 3000),
      // Its side doors are curtains (DOOR kind 8: doors.ts), cut open with the sword.
      travelTo(48, 96, { tol: 1, exact: true }),
      ...swing(Left),
      holdUntil("west into area 3", Left, inArea(3), 300),
      defeat("area 3's west sword soldier", (e) => e.type === "SLR1" && e.x < 256 * SUBPX, 3000),
      travelTo(47, 180),
      holdUntil("down onto the TV", Down, inArea(0), 300),
      defeat("the west platform's bow soldier", (e) => e.type === "SLR2" && e.x < 256 * SUBPX && e.y < 192 * SUBPX, 3000),
    ],
  },
  {
    name: "room 57's west platform: the box formation on its two floor switches (5, 6: 24, half the checkerboard)",
    goals: [
      travelTo(168, 72, { tol: 1, exact: true }),
      formation("box"),
      waitUntil("on both", switchOn(24), 120),
    ],
  },
  {
    name: "room 57, round to the east platform: back up through area 3's west half, area 2, its east door, area 3's east half, down onto the TV's east platform; the box formation on its switches (7, 8: 25, the checkerboard open)",
    goals: [
      press(GATHER_BUTTON, 1, 0),
      waitUntil("together", (g) => g.adventure.formation === "trail", 120),
      travelTo(128, 76),
      holdUntil("up into area 3", Up, inArea(3), 300),
      // (Its soldiers are back: the area was left.)
      defeat("area 3's west sword soldier", (e) => e.type === "SLR1" && e.x < 256 * SUBPX, 3000),
      travelTo(160, 144),
      holdUntil("east into area 2", Right, inArea(2), 300),
      defeat("area 2's sword soldier", (e) => e.type === "SLR1", 3000),
      travelTo(208, 96, { tol: 1, exact: true }),
      ...swing(Right),
      holdUntil("east into area 3", Right, inArea(3), 300),
      travelTo(448, 180),
      holdUntil("down onto the TV", Down, inArea(0), 300),
      defeat("the east platform's bow soldier", (e) => e.type === "SLR2" && e.x > 256 * SUBPX && e.y < 192 * SUBPX, 3000),
      travelTo(328, 72, { tol: 1, exact: true }),
      formation("box"),
      waitUntil("on both", switchOn(25), 120),
    ],
  },
  {
    name: "room 57: over the checkerboard and up the lane north into room 10",
    goals: [press(GATHER_BUTTON, 1, 0), waitUntil("together", (g) => g.adventure.formation === "trail", 120), travelTo(256, 80), travelTo(256, 20), goTo(Up, 10)],
  },
  {
    name: "room 10: the pot lifted off its west floor point (PONT, 17: the generator), the generator's soldiers beaten (SKIL 32: 16, the door), up through it into area 2",
    goals: [
      travelTo(88, 328, { tol: 1, exact: true }),
      face(Left),
      press(Action, 2, 30),
      face(Right),
      press(Action, 2, 30),
      waitUntil("the generator on", switchOn(17), 60),
      // (Fought as they come up out of the lane: chasing one down it would leave the room.)
      travelTo(256, 336),
      guardLane("the generator's soldiers, met at the lane's mouth", 256, 336, switchOn(16), 20000),
      collect("their drops", (it) => it.type === "gem", 3000),
      travelTo(256, 270),
      holdUntil("up through the door into area 2", Up, inArea(2), 300),
    ],
  },
  {
    name: "room 10's area 2 (the throne room): up between its two Armos (asleep), round the throne's left side, the four in the long formation push it 64 px right (rocks.ts), the curtain behind it cut (DOOR kind 8), up through it into area 7",
    goals: [
      // Its two Force Gems first, down in the band round its foot (x 64-447, y 320-479: 150 and 100).
      collect("the throne room's Force Gems", (it) => it.from === "RUPY", 3000),
      // Out by the door and in again: back on the middle line (x 256, the only one 64 px from both Armos: any nearer
      // and one wakes).
      travelTo(256, 330),
      holdUntil("down out of the door onto the TV", Down, inArea(0), 300),
      holdUntil("up through it into area 2 again", Up, inArea(2), 300),
      travelTo(256, 104, { tol: 1, exact: true }),
      travelTo(210, 104, { tol: 1, exact: true }),
      travelTo(210, 40, { tol: 1, exact: true }),
      formation("long"),
      waitUntil("in a column", (g) => g.adventure.formation === "long" && g.players.every((p, i) => p.x === g.players[0]!.x && p.y === g.players[0]!.y + 16 * i * SUBPX), 60),
      holdUntil("the throne pushed all the way", Right, (g) => g.adventure.rocks.some((r) => r.type === "STBL" && r.state === "set"), 600),
      press(GATHER_BUTTON, 1, 0),
      waitUntil("together", (g) => g.adventure.formation === "trail", 120),
      travelTo(256, 40, { tol: 0.5, exact: true }),
      ...swing(Up),
      holdUntil("up through the curtain into area 7", Up, inArea(7), 300),
    ],
  },
  {
    name: "room 10's areas 7 and 6 (side views, cannons): up the west ladders, off the ledge into the lower cannon, shot up into the upper one, shot up out of the top into area 6 flying on, into its lower cannon, its upper one, shot out of its top onto the TV's hole (96, 64), steered onto the walkway, north into room 11",
    goals: [
      holdUntil("west along the floor to the ladder", Left, (g) => leaderX(g) <= 87, 300),
      holdUntil("up it", Up, (g) => leaderY(g) <= 458, 300),
      holdUntil("west to the next", Left, (g) => leaderX(g) <= 55, 300),
      holdUntil("up it", Up, (g) => leaderY(g) <= 426, 300),
      holdUntil("west to the last", Left, (g) => leaderX(g) <= 23, 300),
      holdUntil("up onto the ledge", Up, (g) => leaderY(g) <= 378, 300),
      holdUntil("east off it into the lower cannon", Right, inCannon, 200),
      press(Item, 1, 1),
      // Steered east all the way: over the top, down past the upper column onto the middle one's top, its two Force
      // Gems (150 and a winged 100); west off it, down into the upper cannon.
      holdUntil("shot up, steered east onto the middle column's top", Right, landed, 200),
      holdUntil("west off it, down into the upper cannon", Left, inCannon, 200),
      press(Item, 1, 1),
      // Out of area 7's top into area 6 (adventure.ts stepShotInto, traced), still flying up.
      waitUntil("flying on up in area 6", (g) => inArea(6)(g) && g.adventure.links[0]!.mode === "shot", 300),
      holdUntil("steered west", Left, (g) => leaderX(g) <= 137, 200),
      waitUntil("in area 6's lower cannon", inCannon, 200),
      press(Item, 1, 1),
      // The same there: onto the middle column's top (a winged 100), east along it to the 200, then off its west end
      // steered down into the lower cannon again.
      holdUntil("shot up, steered east onto the middle column's top", Right, landed, 200),
      holdUntil("east along it to its Force Gem", Right, (g) => leaderX(g) >= 208, 60),
      { name: "west off it, steered down into the lower cannon", limit: 200, next: (g) => (inCannon(g) ? true : leaderX(g) > 137 ? Left : leaderX(g) < 135 ? Right : 0) },
      press(Item, 1, 1),
      holdUntil("shot up, steered west", Left, (g) => leaderX(g) <= 73, 200),
      waitUntil("in its upper cannon", inCannon, 200),
      press(Item, 1, 1),
      waitUntil("shot out at the top", (g) => !!g.adventure.warp?.launch, 200),
      holdUntil("out of the TV's hole, steered east onto the walkway", Right, (g) => g.adventure.area === 0 && !g.adventure.warp, 400),
      travelTo(256, 40),
      goTo(Up, 11),
    ],
  },
  { name: PHANTOM_GANON_NAME, goals: ganonGoals() },
  {
    name: "room 11's staircase (RASN kind 5, its switch 16) walked down into, west and up to room 12's top (stairs.ts), down to the goal's top-left pad (GOL2): the stage cleared",
    goals: [
      travelTo(256, 296),
      holdUntil("down into the staircase", Down, (g) => !!g.adventure.stairs, 120),
      waitUntil("down it into room 12", (g) => g.adventure.room === 12 && !g.adventure.stairs, 400),
      travelTo(176, 128),
      holdUntil("onto the goal: the stage cleared", Down, (g) => g.adventure.cleared > 0, 120),
    ],
  },
];

export const HYRULE_CASTLE_ROUTE: readonly Goal[] = HYRULE_CASTLE_MILESTONES.flatMap((m) => m.goals);

const toward = (dx: number, dy: number, tol: number) => (dx > tol ? Right : dx < -tol ? Left : 0) | (dy > tol ? Down : dy < -tol ? Up : 0);
const facingOf = (dx: number, dy: number) => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? Right : Left) : dy > 0 ? Down : Up);
const FACING_BUTTON: Readonly<Record<string, number>> = { right: Right, left: Left, down: Down, up: Up };

/**
 * Fights Phantom Ganon (phantomganon.ts) until he's gone: keeps out of his dash's reach at the arena's bottom, on the
 * side away from him, swings at his energy ball as it comes (sent back at him till the rally strikes him down), and
 * strikes him while he's down.
 */
export function fightGanon(limit = 30000): Goal {
  let swinging = 0;
  return {
    name: "Phantom Ganon",
    limit,
    next(game) {
      const g = game.adventure.ganon;
      if (!g || g.gone) return true;
      if (g.lock) return 0;
      const p = game.players[0]!, px = p.x / 256, py = p.y / 256, gx = g.x / 256, gy = (g.y - g.z) / 256;
      if (swinging > 0) return swinging-- > 8 ? Sword : 0;
      if (g.state === 20 && g.z === 0) {
        // Down: in front of him, facing him, striking.
        const tx = gx, ty = gy + 22;
        if (Math.abs(tx - px) > 3 || Math.abs(ty - py) > 3) return toward(tx - px, ty - py, 2);
        if (FACING_BUTTON[p.facing] !== Up) return Up;
        swinging = 12;
        return Sword;
      }
      const b = g.ball;
      if (b && (b.vx || b.vy) && b.safe === 0) {
        const dx = b.x / 256 - px, dy = b.y / 256 - py;
        const coming = dx * b.vx + dy * b.vy < 0, speed = Math.hypot(b.vx, b.vy) / 256;
        // (Swung when it's a few ticks off, so the sword's boxes are out as it comes: turned to it already.)
        if (coming && Math.hypot(dx, dy) < 16 + 3 * speed) {
          const want = facingOf(dx, dy);
          if (FACING_BUTTON[p.facing] !== want) return want;
          swinging = 12;
          return Sword;
        }
        // Coming down at him: into its line (where it crosses his row), then turned to it.
        if (coming && b.vy > 0 && dy < 0) {
          const cross = b.x / 256 + (b.vx / b.vy) * (py - b.y / 256);
          const step = toward(cross - px, 0, 2);
          if (step) return step;
        }
        if (coming) return FACING_BUTTON[p.facing] !== facingOf(dx, dy) ? facingOf(dx, dy) : 0;
      }
      // Sent back at him: wait for it where he is.
      if (b && b.back) return 0;
      // Away from him along the arena's bottom.
      return toward((gx < 256 ? 340 : 172) - px, 318 - py, 3);
    },
  };
}

/** How far (px) below the iron-ball soldier the leader shoots from: out of its ball's reach (a 70 px chain from its
 *  hand, the ball's ±8 px and his ±7: 94 px at most). */
const BALL_SHOT_FROM = 104;
const BALL_SHOT_SLACK = 20;
/** Nearer than this (px, both ways) the soldier is on the Link: he swings at it (assumed; the route's timing). */
const BALL_SHOT_CLOSE = 40;
/** Ticks between shots (its 30-tick reel-in after a hit: nothing hurts it meanwhile). */
const BALL_SHOT_EVERY = 32;

/**
 * Room 6's iron-ball soldier (SLR3, castlesoldiers.ts's rules) shot with the bow from below, out of its ball's reach:
 * the leader keeps in line with it, BALL_SHOT_FROM px below as it walks at him, and shoots up; each arrow knocks it back
 * up its passage and reels its ball in.
 */
export function shootBallSoldier(limit = 6000): Goal {
  let last = -99, lastSwing = -99;
  return {
    name: "the iron-ball soldier, shot from below",
    limit,
    next(game, _stage, tick) {
      if (tick === 0) last = lastSwing = -99;
      const e = game.adventure.enemies.find((x) => x.type === "SLR3" && enemyActive(x) && enemyShown(game, x));
      if (!e) return true;
      const p = game.players[0]!, dx = e.x / SUBPX - p.x / SUBPX, dy = p.y / SUBPX - e.y / SUBPX;
      // On him (it chases at 1.5 × its base speed: it reached the leader against the room's wall): the sword, facing it.
      if (Math.abs(dx) < BALL_SHOT_CLOSE && dy < BALL_SHOT_CLOSE) {
        const want = facingOf(-dx, -dy);
        if (FACING_BUTTON[p.facing] !== want) return want;
        if (tick - lastSwing < 16) return lastSwing >= 0 && tick - lastSwing < 2 ? Sword : 0;
        lastSwing = tick;
        return Sword;
      }
      const step = toward(dx, dy < BALL_SHOT_FROM ? BALL_SHOT_FROM - dy : dy > BALL_SHOT_FROM + BALL_SHOT_SLACK ? BALL_SHOT_FROM - dy : 0, 1.5);
      if (step) return step;
      if (p.facing !== "up") return Up;
      if (tick - last < BALL_SHOT_EVERY) return 0;
      last = tick;
      return Item;
    },
  };
}

/**
 * Soldiers coming up a lane met at its mouth (x, y): the leader faces down it holding his sword out (charging: its box
 * strikes them as they walk into it), stepping sideways into the line of the nearest one out of the lane.
 */
function guardLane(name: string, x: number, y: number, until: (g: AdventureGame) => boolean, limit: number): Goal {
  return {
    name,
    limit,
    next(game) {
      if (until(game)) return true;
      const p = game.players[0]!, px = p.x / SUBPX, py = p.y / SUBPX;
      if (p.action === "none" && p.facing !== "down") return Down;
      const near = game.adventure.enemies.filter((e) => e.type.startsWith("SLR") && enemyActive(e) && e.state !== "knock");
      const e = near.length ? near.reduce((a, b) => (Math.hypot(b.x - p.x, b.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? b : a)) : null;
      const tx = e ? e.x / SUBPX : x, ty = e ? Math.max(y - 16, Math.min(y + 16, e.y / SUBPX - 24)) : y;
      return Sword | toward(tx - px, ty - py, 2);
    },
  };
}

/** Room 11's fight from its way in (each call fresh goals: fightGanon keeps a count). */
function ganonGoals(): Goal[] {
  return [
    travelTo(256, 300),
    fightGanon(),
    // The Force Gems his two falls and his end flung out (99 + 99 + 80), some against the arena's top wall.
    collect("his Force Gems", (it) => it.type === "gem", 3000, false, true),
    waitUntil("the staircase", (g) => ((g.battle.switches >>> 16) & 1) === 1, 600),
  ];
}

/** Room 11's fight alone, from its way in (the test and #route started there); the route's last milestone too. */
export const PHANTOM_GANON_MILESTONES: readonly { name: string; goals: readonly Goal[] }[] = [{ name: PHANTOM_GANON_NAME, goals: ganonGoals() }];
