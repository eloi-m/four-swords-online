// Lake Hylia (stage 1-1, boss010) from its start to its goal, as a route for drive.ts's RoutePlayer: the way the
// guides tell it (docs/ADVENTURE.md "Lake Hylia's way through"), played by the sim's rules. Used by
// lakehylia.realdisc.test.ts and the browser (apps/game's window.fso.route).
import { Button, SUBPX } from "../player.ts";
import { collect, defeat, face, fight, formation, goTo, holdUntil, openChestFacing, press, sequence, shadowGone, travelTo, wait, waitUntil, walkTo, type Goal } from "./drive.ts";
import { KEY_MESSAGE, TALK_OPEN_TICKS } from "./dialogue.ts";
import { TINGLE_STATE, tingleHolds } from "./tingle.ts";
import { GATHER_BUTTON, SEPARATE_BUTTON, selectButtons } from "./formation.ts";

const { Up, Down, Left, Right, Sword, Action, Item } = Button;

/** Swings the sword facing `dir` (turning first). */
const swing = (dir: number): Goal[] => [face(dir), press(Sword, 2, 14)];
/** Lifts the stone (or bush) faced in `dir` and throws it on that way. */
const liftAway = (dir: number): Goal[] => [face(dir), press(Action, 2, 30), press(Action, 2, 30)];
/** X: the others wait where they are. */
const apart = (): Goal => press(SEPARATE_BUTTON, 1, 4);
/** The D-pad: the controls to the first of the others not standing on a floor switch (its color's direction). */
const controlFree = (): Goal => {
  let buttons = 0;
  return {
    name: "the controls to a Link off the switches",
    limit: 6,
    next(g, _s, t) {
      if (t === 0) {
        const switches = g.battle.entities.filter((e) => e.kind === "switch");
        const k = g.players.findIndex((p, i) => i > 0 && !switches.some((e) => Math.abs(e.x + 8 * SUBPX - p.x) <= 8 * SUBPX && Math.abs(e.y + 8 * SUBPX - p.y) <= 8 * SUBPX));
        buttons = k > 0 ? selectButtons(g.adventure.colors[k]!) : 0;
      }
      return t >= 5 ? true : t < 1 ? buttons : 0;
    },
  };
};
/** Y: the others come back and trail the one in control. */
/** A Force Gem rain's gems picked up once it's over. */
const rainGems = (): Goal[] => [
  waitUntil("the rain over", (g) => g.adventure.rains.every((r) => r.state !== "rain"), 600),
  collect("the rain's gems", (p) => p.type === "gem" && p.actor < 0),
];
const together = (): Goal[] => [press(GATHER_BUTTON, 1, 0), waitUntil("together", (g) => g.adventure.formation === "trail", 120)];
/** A goal, then the four trailing again, as one goal (the bent playtests count the goals): a C-stick formation walks as
 *  one, a follower that meets a wall holding the leader (formation.ts holdFormation), so the routes leave it once done. */
const thenTogether = (goal: Goal): Goal => sequence(`${goal.name}, then together`, [goal, ...together()]);

/** Tingle's scene under the bridge (tingle.ts): his messages read (a press a page; his chant turns by itself) until
 *  he's up on his balloon and the Links walk again. */
function tingleScene(): Goal {
  let last = -99;
  return {
    name: "Tingle's scene",
    limit: 3000,
    next(g, _s, t) {
      if (t === 0) last = -99;
      const s = g.adventure.tingle;
      if (!s || (s.state >= TINGLE_STATE.fly && !tingleHolds(g))) return true;
      if (!g.adventure.talk || t - last < 8) return 0;
      last = t;
      return Item;
    },
  };
}

/** The route, in milestones (each a list of goals); `LAKE_HYLIA_ROUTE` is all of them. */
export const LAKE_HYLIA_MILESTONES: readonly { name: string; goals: readonly Goal[] }[] = [
  {
    name: "start: through the bushes west, round room 1's fenced yard",
    goals: [
      walkTo(232, 168),
      ...swing(Left),
      walkTo(216, 168),
      ...swing(Left),
      walkTo(200, 168),
      ...swing(Left),
      walkTo(184, 168),
      ...swing(Left),
      goTo(Left, 1),
      walkTo(400, 290),
      walkTo(40, 290),
      goTo(Left, 2),
    ],
  },
  {
    name: "room 2: the boulder pushed into the river with the wide formation, across it",
    goals: [
      walkTo(232, 320),
      face(Up),
      formation("wide"),
      waitUntil("the boulder sunk", (g) => g.adventure.rocks.some((r) => r.type === "RCK3" && r.state === "sunk"), 1200, Up),
      formation("long"),
      walkTo(248, 150),
      // Trailing again after it: the column walking right would be held by its last Link at the cave's cliff (x 280).
      thenTogether(walkTo(248, 60)),
    ],
  },
  {
    name: "room 2's cave: the stone at its mouth, the box formation on its four-Link switch, the boomerang",
    goals: [
      walkTo(312, 56),
      walkTo(312, 120),
      walkTo(352, 120),
      face(Right),
      press(Action, 2, 30),
      face(Left),
      press(Action, 2, 40),
      walkTo(384, 120),
      goTo(Up, 2, 5),
      walkTo(122, 320),
      walkTo(118, 290),
      walkTo(104, 272),
      walkTo(104, 208),
      walkTo(120, 190),
      walkTo(120, 150),
      formation("box"),
      // (The four in the switch's box: its middle is 2.5 px up of it, (128, 93.5); logic.ts stepFourSwitch.)
      walkTo(128, 96, 2),
      thenTogether(waitUntil("the door's switch, the snap's pose over", (g) => ((g.battle.switches >>> 16) & 1) === 1 && g.adventure.fourSnap < 0, 120)),
      walkTo(120, 60),
      goTo(Up, 2, 6),
      walkTo(125, 88),
      face(Up),
      press(Action, 2, 10),
      waitUntil("the boomerang", (g) => g.adventure.gear === "boomerang", 30),
      goTo(Down, 2, 5),
      walkTo(120, 190),
      walkTo(104, 208),
      walkTo(104, 272),
      walkTo(118, 290),
      walkTo(122, 320),
      walkTo(128, 340),
      goTo(Down, 2, 0),
      // The stone is back at the cave's mouth (an area's things come back when the Links do).
      walkTo(386, 120),
      face(Left),
      press(Action, 2, 30),
      face(Right),
      press(Action, 2, 40),
      walkTo(312, 120),
      walkTo(312, 56),
      walkTo(272, 40),
      // Apart: the leader alone goes into room 3 to fight its four Octoroks (the others are left here, parked).
      apart(),
      goTo(Up, 3),
    ],
  },
  {
    name: "room 3: the boomerang fetches the key over the posts, the locked door, the house's back room, the Fire Rod",
    goals: [
      fight("room 3's Octoroks", (e) => e.type === "OKTA"),
      ...together(),
      walkTo(273, 250),
      walkTo(400, 250),
      walkTo(400, 200),
      face(Right),
      press(Button.Item, 2, 4),
      waitUntil("the key brought back", (g) => g.adventure.pickups.some((p) => p.type === "key" && !p.fetched), 200),
      // The first key's message (dialogue.ts): once its box is on, the Item button finishes its typing and then closes it.
      waitUntil("the key's message on show", (g) => g.adventure.talk?.message === KEY_MESSAGE && g.adventure.talk.tick > TALK_OPEN_TICKS, 60),
      press(Button.Item, 1, 3),
      press(Button.Item, 1, 3),
      waitUntil("the key's message closed", (g) => g.adventure.talk === null, 60),
      // Lifted from 18 px away, facing it, and carried to the door.
      walkTo(400, 219),
      face(Up),
      press(Action, 2, 4),
      waitUntil("the key lifted", (g) => g.adventure.keys > 0 && g.adventure.keyLift === 0, 30),
      walkTo(400, 140),
      goTo(Up, 3, 2),
      walkTo(48, 116),
      walkTo(48, 40),
      walkTo(64, 40),
      goTo(Up, 3, 3),
      walkTo(48, 100),
      walkTo(146, 100),
      formation("long"),
      walkTo(154, 92),
      face(Right),
      press(Action, 2, 4),
      waitUntil("the rock carried", (g) => g.adventure.heavy?.phase === "carry", 120),
      press(Action, 2, 4),
      thenTogether(waitUntil("the rock thrown", (g) => !g.adventure.heavy, 60)),
      walkTo(176, 96),
      waitUntil("the Fire Rod", (g) => g.adventure.gear === "fireRod", 30),
      walkTo(48, 100),
      goTo(Down, 3, 2),
      walkTo(48, 40),
      walkTo(48, 110),
      walkTo(192, 110),
      // Apart: back into area 0, where its Octoroks have come back (an area's enemies reload when the Links return).
      apart(),
      goTo(Down, 3, 0),
    ],
  },
  {
    name: "room 3: the Fire Rod burns the stumps round the two-Link rock, the rock lifted off the hole, the side-view cave",
    goals: [
      fight("room 3's Octoroks, back", (e) => e.type === "OKTA"),
      ...together(),
      walkTo(400, 250),
      walkTo(224, 250),
      walkTo(224, 232),
      face(Up),
      press(Button.Item, 2, 4),
      waitUntil("the stumps burnt", (g) => g.adventure.burnt.length >= 6, 200),
      formation("wide"),
      walkTo(218, 225),
      walkTo(218, 214),
      face(Up),
      press(Action, 2, 4),
      waitUntil("the rock carried", (g) => g.adventure.heavy?.phase === "carry", 120),
      face(Down),
      press(Action, 2, 4),
      waitUntil("the rock thrown", (g) => !g.adventure.heavy, 60),
      walkTo(224, 214),
      goTo(Up, 3, 5),
      // The cave, seen from the side: down the ladder, along the bottom, up the other ladder.
      waitUntil("down the ladder", (g) => g.players[0]!.y >= 100 * 256 && !g.adventure.warp, 300, Down),
      walkTo(456, 104, 2),
      waitUntil("down the second ladder", (g) => g.players[0]!.y >= 134 * 256, 120, Down),
      walkTo(88, 136, 2),
      waitUntil("up to the ledge", (g) => g.players[0]!.y <= 57 * 256, 200, Up),
      walkTo(40, 56, 2),
      face(Left),
      press(Sword, 2, 20),
      waitUntil("the bridge", (g) => ((g.battle.switches >>> 1) & 1) === 1, 30),
      walkTo(216, 56, 2),
      goTo(Up, 3, 0),
    ],
  },
  {
    name: "room 4: the four-Link switch's gem rain, then room 5's pocket: a stone lifted, the ledge into the river",
    goals: [
      // Apart: the leader alone goes into room 4 to fight its Octoroks (the others are left in room 3, parked).
      apart(),
      goTo(Left, 4),
      // The plateau's grey stones: three lifted off the way to the stairs.
      travelTo(376, 296),
      ...liftAway(Left),
      walkTo(360, 296),
      walkTo(360, 280),
      ...liftAway(Up),
      walkTo(360, 264),
      ...liftAway(Left),
      walkTo(320, 264),
      walkTo(320, 200),
      fight("room 4's Octoroks up the stairs", (e) => e.type === "OKTA" && e.y < 240 * 256),
      ...together(),
      // (The minor Shadow Link's blows by the switch over: minorshadow.ts.)
      shadowGone(),
      // The four-Link switch (YNSW at (320, 144)): the leader on its top-left quarter, the box formation round him.
      travelTo(320, 144),
      formation("box"),
      waitUntil("the gem rain's switch, the snap's pose over", (g) => ((g.battle.switches >>> 16) & 1) === 1 && g.adventure.fourSnap < 0, 120),
      ...together(),
      ...rainGems(),
      formation("wide"),
      wait(60),
      travelTo(264, 96),
      travelTo(264, 200),
      travelTo(312, 200),
      travelTo(312, 96),
      // The two-Link rock in the way west, lifted from its east side by the column of Links.
      travelTo(232, 108),
      formation("long"),
      walkTo(198, 108),
      face(Left),
      press(Action, 2, 4),
      waitUntil("the rock carried", (g) => g.adventure.heavy?.phase === "carry", 120),
      press(Action, 2, 4),
      thenTogether(waitUntil("the rock thrown", (g) => !g.adventure.heavy, 60)),
      travelTo(56, 24),
      goTo(Up, 5),
      travelTo(72, 330),
      face(Up),
      press(Action, 2, 30),
      press(Action, 2, 30),
      travelTo(72, 314),
      holdUntil("into the river", Up, (g) => g.adventure.links[0]!.mode === "swim", 120),
    ],
  },
  {
    name: "room 5's river: its gems, under the bridge (a GBA-screen area: up its steps, off its ledge), room 6's pool, its steps up to room 7",
    goals: [
      travelTo(24, 184, { swim: true }),
      travelTo(24, 250, { swim: true }),
      travelTo(150, 200, { swim: true }),
      holdUntil("under the bridge", Right, (g) => g.adventure.area === 2 && !g.adventure.warp, 300),
      travelTo(96, 168, { swim: true }),
      travelTo(96, 120),
      // A two-Link rock on the ledge under the bridge, lifted from its west side by the column of Links.
      travelTo(110, 103),
      formation("long"),
      walkTo(122, 103),
      face(Right),
      press(Action, 2, 4),
      waitUntil("the rock carried", (g) => g.adventure.heavy?.phase === "carry", 120),
      press(Action, 2, 4),
      // Under it, Tingle: his scene holds the Links until he floats off (a rock still carried then is taken).
      waitUntil("the rock thrown", (g) => !g.adventure.heavy, 60),
      tingleScene(),
      ...together(),
      travelTo(192, 120),
      holdUntil("off the ledge into the water", Down, (g) => g.adventure.links[0]!.mode === "swim", 120),
      // Out by a low way: the higher ones lead into a pen of stakes.
      travelTo(330, 216, { swim: true }),
      holdUntil("back out past the bridge", Right, (g) => g.adventure.area === 0 && !g.adventure.warp, 300),
      travelTo(456, 232, { swim: true }),
      travelTo(456, 184, { swim: true }),
      travelTo(480, 232, { swim: true }),
      goTo(Right, 6),
      travelTo(48, 150, { swim: true }),
      travelTo(48, 112),
      travelTo(48, 28),
      goTo(Up, 7),
    ],
  },
  {
    name: "room 7's caves, seen from the side: a cannon up to the middle ledge, two more up out of the top, to room 58",
    goals: [
      travelTo(96, 290),
      holdUntil("into the lower cave", Up, (g) => g.adventure.area === 5 && !g.adventure.warp, 300),
      holdUntil("into the cannon", Right, (g) => g.adventure.links[0]!.mode === "cannon", 200),
      wait(10),
      press(Item, 2, 20),
      holdUntil("shot up and steered onto the ledge", Left, (g) => g.adventure.links[0]!.mode === "walk", 200),
      walkTo(32, 104.8, 1),
      holdUntil("out by the top door", Up, (g) => g.adventure.area === 0 && !g.adventure.warp, 300),
      travelTo(128, 160),
      holdUntil("into the upper cave", Up, (g) => g.adventure.area === 6 && !g.adventure.warp, 300),
      holdUntil("to the ladder", Left, (g) => g.players[0]!.x <= 104 * 256, 200),
      walkTo(104, 488, 1),
      holdUntil("up the ladder", Up, (g) => g.players[0]!.y <= 410 * 256, 200),
      holdUntil("into the first cannon", Left, (g) => g.adventure.links[0]!.mode === "cannon", 200),
      wait(10),
      press(Item, 2, 2),
      holdUntil("steered into the second cannon", Right, (g) => g.adventure.links[0]!.mode === "cannon" || g.players[0]!.x >= 120 * 256, 200),
      waitUntil("in the second cannon", (g) => g.adventure.links[0]!.mode === "cannon", 200),
      wait(10),
      press(Item, 2, 2),
      waitUntil("out of the top", (g) => !!g.adventure.warp?.launch, 200),
      waitUntil("out of the hole", (g) => g.adventure.warp?.launch === true && g.adventure.warp.tick > 77, 200),
      press(Up, 16, 0),
      waitUntil("down beside the hole", (g) => !g.adventure.warp, 200),
      travelTo(104, 24),
      goTo(Up, 58),
    ],
  },
  {
    name: "room 58's caves (room 8 played alone): the four Links apart on the middle room's switches, the bridge, the chests, switch 17 held while the others cross, out by the right-hand cave",
    goals: [
      travelTo(272, 60),
      goTo(Up, 58, 5),
      travelTo(240, 240),
      // Apart: each Link on a switch, handed the controls in turn (green, red, blue, purple).
      apart(),
      travelTo(216, 216, { tol: 1 }),
      controlFree(),
      travelTo(264, 216, { tol: 1 }),
      controlFree(),
      travelTo(216, 264, { tol: 1 }),
      controlFree(),
      travelTo(264, 264, { tol: 1 }),
      waitUntil("the bridge's switch", (g) => ((g.battle.switches >>> 16) & 1) === 1, 60),
      ...together(),
      travelTo(240, 470),
      goTo(Down, 58, 0),
      travelTo(224, 60),
      goTo(Up, 58, 5),
      // Over the bridge to the chests (100 Force Gems, a heart).
      travelTo(152, 300),
      travelTo(152, 190),
      travelTo(232, 167),
      ...openChestFacing(Up),
      travelTo(248, 167),
      ...openChestFacing(Up),
      // Switch 17 bridges the pit east while a Link stands on it: green stays, red takes the others' way out alone.
      travelTo(312, 200, { tol: 1 }),
      apart(),
      controlFree(),
      waitUntil("the east bridge", (g) => ((g.battle.switches >>> 17) & 1) === 1, 30),
      travelTo(464, 470),
      goTo(Down, 58, 0),
      ...together(),
    ],
  },
  {
    name: "room 58's lake: off the east bank's ledge, its gems, down the waterfall into room 6's pool, the whirlpool, up area 5's ladder into area 6",
    goals: [
      // A bush in the way down the bank, then its ledge.
      travelTo(408, 116),
      ...swing(Down),
      travelTo(408, 178),
      holdUntil("off the ledge into the lake", Down, (g) => g.adventure.links[0]!.mode === "swim", 120),
      travelTo(344, 122, { swim: true }),
      travelTo(216, 152, { swim: true }),
      // A big gem over the shallows (shown on switch 18: room 8's enemies beaten, i.e. its Zora, which the route leaves:
      // the gem stays hidden), four small ones.
      travelTo(264, 280, { swim: true }),
      travelTo(392, 280, { swim: true }),
      travelTo(392, 312, { swim: true }),
      travelTo(376, 296, { swim: true }),
      travelTo(408, 296, { swim: true }),
      travelTo(340, 360, { swim: true }),
      holdUntil("into room 7's water", Down, (g) => g.adventure.room === 7 && !g.adventure.edge, 300),
      waitUntil("over the falls", (g) => g.adventure.links[0]!.mode === "fall", 120),
      holdUntil("down into room 6's pool", Down, (g) => g.adventure.room === 6 && !g.adventure.edge && g.adventure.links[0]!.mode === "swim", 300),
      // The pool's gems, then its whirlpool.
      travelTo(320, 128, { swim: true }),
      travelTo(224, 152, { swim: true }),
      travelTo(208, 176, { swim: true }),
      travelTo(208, 240, { swim: true }),
      travelTo(396, 232, { swim: true }),
      holdUntil("down the whirlpool", Right, (g) => g.adventure.area === 5 && !g.adventure.warp, 300),
      // Area 5, seen from the side: swum down, across and up to the left-hand ladder, up it into area 6.
      travelTo(272, 200, { swim: true }),
      travelTo(40, 200, { swim: true }),
      travelTo(40, 96, { swim: true }),
      holdUntil("onto the ladder", Up | Left, (g) => g.adventure.links[0]!.mode === "walk", 200),
      goTo(Up, 6, 6),
    ],
  },
  {
    name: "room 6's area 6: the block pushed south by the wide formation, the raft across the pit, up the ladder to the TV",
    goals: [
      travelTo(464, 52),
      travelTo(374, 52),
      formation("wide"),
      waitUntil("the block pushed", (g) => g.adventure.rocks.some((r) => r.type === "BLCK" && r.state === "set"), 1200, Down),
      formation("box"),
      travelTo(340, 80, { tol: 1 }),
      waitUntil("the raft across", (g) => g.adventure.rocks.some((r) => r.type === "OBLF" && r.state === "set"), 600),
      travelTo(100, 80),
      // Up the ladder to the TV's well (in a C-stick formation the game held the leader back below it: traced).
      ...together(),
      travelTo(48, 40),
      goTo(Up, 6, 0),
    ],
  },
  {
    name: "room 6's garden: through the bushes and a grey stone west to the hole under a bush, area 7 seen from the side, out by its left-hand ladder",
    goals: [
      travelTo(328, 328),
      ...swing(Left),
      walkTo(312, 328),
      ...swing(Left),
      walkTo(298, 328),
      ...liftAway(Left),
      walkTo(282, 328),
      ...swing(Left),
      walkTo(266, 328),
      ...swing(Left),
      walkTo(232, 328),
      ...swing(Down),
      holdUntil("down the hole", Down, (g) => g.adventure.area === 7 && !g.adventure.warp, 300),
      // Area 7, seen from the side: down to its floor, up the right-hand ladder, along the passage, up the left-hand
      // ladder and out at its top.
      waitUntil("down", (g) => g.players[0]!.y >= 210 * 256 && !g.players[0]!.moving, 200),
      holdUntil("onto the right-hand ladder", Right, (g) => g.players[0]!.x >= 296 * 256, 60),
      holdUntil("up the ladder above the passage", Up, (g) => g.players[0]!.y <= 104 * 256, 200),
      holdUntil("along the passage onto the left-hand ladder", Left, (g) => g.players[0]!.x <= 24 * 256, 400),
      goTo(Up, 6, 0),
    ],
  },
  {
    name: "room 5's south bank, its ambush (the bridge's switch, sixteen soldiers out of the west), the north bank's four switches under bushes: two chests, two big gems",
    goals: [
      travelTo(40, 324),
      // Apart: the leader alone meets the ambush (one Link, one attack slot at a time: the others are left in room 6).
      apart(),
      goTo(Left, 5),
      travelTo(300, 324),
      // The bridge's floor switch (2) shuts the way west and starts room 5's generator: sixteen sword soldiers walk in
      // from the west; the sixteenth kill (SKIL) opens the way again (switch 16). Their gems picked up.
      travelTo(264, 304, { tol: 1 }),
      waitUntil("shut in", (g) => ((g.battle.switches >>> 4) & 1) === 1, 30),
      defeat("room 5's ambush", (e) => e.type === "SLR1", 3600, (g) => ((g.battle.switches >>> 16) & 1) === 1),
      ...together(),
      travelTo(232, 88),
      collect("the soldiers' gems", (p) => p.type === "gem" && p.actor < 0),
      // The bushes over the four switches (5-8), cut from below; then a Link on each (switch 17: the chests, the gems).
      ...[280, 296, 312, 360].flatMap((x) => [travelTo(x, 72, { tol: 1 }), ...swing(Up)]),
      travelTo(296, 72),
      apart(),
      travelTo(280, 56, { tol: 1 }),
      controlFree(),
      travelTo(296, 56, { tol: 1 }),
      controlFree(),
      travelTo(312, 56, { tol: 1 }),
      controlFree(),
      travelTo(360, 56, { tol: 1 }),
      waitUntil("the chests' switch", (g) => ((g.battle.switches >>> 17) & 1) === 1, 60),
      ...together(),
      travelTo(328, 71),
      ...openChestFacing(Up),
      travelTo(344, 71),
      ...openChestFacing(Up),
      travelTo(400, 84),
      travelTo(224, 70),
      travelTo(24, 72),
      // Apart: the leader alone goes into room 9 (the others are left here, parked).
      apart(),
      goTo(Left, 9),
    ],
  },
  {
    name: "room 9's ambush: the soldiers beaten behind the shut way in, the gem rain, west to room 10's goal",
    goals: [
      travelTo(472, 88, { tol: 1 }),
      travelTo(440, 88),
      waitUntil("shut in", (g) => ((g.battle.switches >>> 18) & 1) === 1, 60),
      // The leader alone (the others parked in room 5): the soldiers, then their captain, his lunge stepped out of and
      // struck while he holds (drive.ts's fight). The others come on him at once (GATHER from another area: traced).
      fight("room 9's soldiers and captain", (e) => e.type === "SLR1" || e.type === "SLR4", 3600),
      ...together(),
      waitUntil("the way west", (g) => ((g.battle.switches >>> 17) & 1) === 1, 300),
      ...rainGems(),
      travelTo(24, 200),
      goTo(Left, 10),
      travelTo(260, 160),
      holdUntil("onto the goal: the stage cleared", Up, (g) => g.adventure.cleared > 0, 120),
    ],
  },
];

export const LAKE_HYLIA_ROUTE: readonly Goal[] = LAKE_HYLIA_MILESTONES.flatMap((m) => m.goals);

void Down;
void Right;
void Action;
void wait;
