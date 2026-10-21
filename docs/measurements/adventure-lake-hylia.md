# Measurements: adventure rooms, swimming, cannons, Lake Hylia to its goal

Part of the measurements from the real game (index: [../measurements.md](../measurements.md)).

## Adventure: rooms, doors, enemies and Force Gems
Traced from `ref/save-lake-hylia.sav` with a private user folder (`ref/dolphin-user-adventure`, GDB port 55129, the
savestate hotkey of `battle-user.ts` added by hand) and a state made from it in room 3 (`ref/save-adv-lake-room3.sav`:
`--tele` within room 1 to its left edge, walk into room 2, `--tele` within room 2 to its top edge, walk into room 3;
a teleport into another room's coordinates is undone by the game). `packages/sim/src/adventure/` applies all this
(docs/ADVENTURE.md); `dolphin-adventure-traces.json` holds the room-change and door traces the sim replays within
0.06 px (`adventure.realdisc.test.ts`).

**Room changes up and down** (`adv-vertical`, room 2 → 3 → 2): the same rule as left and right. Up: the leader at
y 19.0 (room px) triggered, 20.5 didn't; down: 365.41 (18.59 from the side) did, 363.91 (20.09) didn't. The auto-walk
is (d + 56) / 32 px/tick for 25 ticks (2.34375 from 19.0, 2.3309 from 18.59), the walk cycle at 2 ticks per frame, then
a still tick, then control with the usual turn tick. The camera pans as for left and right: from 3 ticks after the
trigger, 30 ticks, onto the new room's clamp (y 1431.4 = room 3's bottom − 104.65: the view is 209.3 px tall). Outside
room changes it follows at up to 3 px/tick (not measured further).

**The followers** (formation mode, the savestate's three other Links, state 3): each walks the trail of the Link ahead
of it at walking speed, and stops 18 px (of trail) behind: the leader blocked at a wall, the next one stood 18.5 px
behind him, the others 18 px apart along the path the leader took (corners included). Moving off from standing, each
heads for the trail's start with 8-way steps (1.06 px per axis on diagonals). While the leader pushes a wall they
alternate a walking and a standing frame (state 3 / 0) every tick. A room change stacks them onto the leader.

**Doors** (`adv-house`, `adv-house-exit`: room 1's house, its `WARP` at (248, 256), params 0x020F1019): the warp's
params give where it leads (byte 0 & 7 the area, 2 here; bytes 1 and 2 the box's top-left in 8 px: (120, 128); byte 3
the style, 0x19). The 16 × 16 box at the warp's anchor is passable although its tiles are solid: walking up at x 248,
Link's top-left sensor caught the door frame, he slid right at walking speed until it cleared (x 253.1) and walked in.
At 274.6 below the box's middle (264, 12 px less) he went through (276.1: not yet), on the next tick:
- 39 ticks walking on at 0.5 px/tick (state 28), x snapped to the box's middle (256), the walk cycle at 2 ticks a
  frame;
- then in the area, at the target box's middle (128, 136), 31 ticks standing (the first still showing the walk), then
  40 ticks walking on at 0.5 px/tick (state 29) to (128, 116), and control; the other Links appear on him then.
- Out: walking down inside, the leader went at 125.0 (11 px above the door box's middle at 136; 123.5 didn't), the same
  39 + 31 + 40 ticks, and came out at the warp's box middle (256, 264), walking down to (256, 284). The house has no
  warp of its own: its door is the target box of the warp that led in.
- Playing alone with a controller, the house shows in a Game Boy Advance SP window over the TV (main2D.arc
  `scrn/main_gba_window.blo`; the GBA's picture at about 1.35× from (142, 138)), which grows open from about 24
  frames after the switch for about 16 frames and shrinks from about 5 frames after the way back, for about 20
  (frame dumps; the curves not fitted). The TV keeps showing the room, the camera on the door.
- Warp styles over the 32 stages (`tools/census` scratch scan): 0x19 (297, going up), 0x1A (187, going down), 0x1B /
  0x1C (101 / 57, sideways), 0x03 (443, all of them from GBA areas back to the TV), 0x04 (230, TV to GBA areas), 0x06,
  0x23, 0x00, 0x15 and rarer ones; 0x84 / 0xA8 carry a switch in their top bits. Only 0x19 and its way back were traced.

**The Octorok** (OKTA, `adv-okta-idle`: the four of room 3, params 3, 600 frames with Link idle; main.dol update
0x8013FD50, init 0x80140920): fields +0x98 direction (0 right, 1 left, 2 down, 3 up), +0x230 state (0 walking, 1 / 2
spitting), +0x234 the walk's count, +0x238 / +0x23C the next shot's, +0x25C speed (1.0), +0x26C easing (0.3), +0x27C /
+0x280 the direction vector, +0x3C / +0x40 velocity, +0x60…+0x6C its box (±8).
- It walks at 1 px/frame, its velocity easing 0.3 of the way each frame (−0.3, −0.51, −0.657 … after a turn), for
  50 + rand(100) frames (the game's LCG at [0x8053AAF8]+0xB4); then, or at once when a wall stops it (the count kept),
  it turns onto the other axis, either way at random: up → left → down → right … in every trace.
- Every frame it hurts a Link touching its box by its atcp, hit type 1 (0x801F2B7C(actor, −100, −1, 1)).
- Kind 0 spits: when the Link is in its direction (0x801EEC98) or its counters run out, it stops and spits `OKTM` rocks
  (3 px/frame along its direction; 1 time in 100 a Force Gem instead); kind 2 aims at the Link; kind 1 grows. Kind 3,
  Lake Hylia's, only walks (the shooting branch exits for it). The spit's timing wasn't traced.
- Hit (`adv-okta-hit`: Link at (280, 341.4) stabbing right as one passed at (310.3, 329.3)): life 4 → 0 at once (a
  stab's power 4 is taken off whole, not halved as between Links); knocked away at 15.66 px/frame, × 0.78 each frame
  (+0xD8 = 24 counting, kind +0xF8 = 0; 0x801F3D94), stopped after 8 frames at a wall and 2.75 px/frame, then 30 frames
  more before the actor went. Nothing was dropped by frame 300.

**Force Gems**: a gem's type is its params' low byte; main.dol's table at 0x804719D8 (RUPY's code indexes it by type,
0x8032D56C; Link's dropped-gem code at 0x8024E8xx walks the same tiers) gives 1, 5, 20, 50, 100, 150, 200, 300 for
types 0-7 (enemy_both2) and 1000, 1500, 2000, 3000 for the huge ones (enemy_gc). 0x802F0404 compares the four Links'
gems added up with 2000: the stage's quota (message 0x24D: "You've gathered enough Force Gems! The Four Sword is
glowing with power!"). The gems of room 3 lie in the river (state 9) and weren't taken; their worth on pickup isn't
traced.

**The minor Shadow Link with a hammer** (`ZSLH`, room 4 at (256, 144), params 0x30; traced 2026-10-18 with
`actor-trace.ts --ids ZSLH --scan 81000000:81800000` from `ref/adv/room4.sav` (1000 frames, frame dumps) and from
`save-adv-lake-room3.sav` teleported to world (1575, 1372) walking left into room 4; `ref/dolphin-user-adventure`, GDB
port 55129). His own states at +0x248 (table 0x804A6B4C), their ticks +0x24C, player_sob frame +0x280, blows +0x2B8.
- He's there from the room change's first frame, his count still until 31 frames later (the Links walk in meanwhile).
  State 4: hopping in place facing down (z 2.3, 4.4 … 14.4 … 0: 2.5 px/tick up, 0.1 down, 24 frames a hop), frame 62.
  Params (p >> 8) & 3 = 0: set off at his count's 60th tick (0x802216E8; 1 and 2 would be a Link within 96 / 192 px,
  3 a count from (p >> 12) & 0xFF), going on at the next landing: the hammer up 103 frames after the room change,
  whatever the Links do. Not by distance.
- 5 the raise (307, 306, 305; 32 frames), 6 held up (379, 30; JPA 203/204 at 22 px over him: the glint), 7 the blow
  (380, 381, 384/385 shaking, 386; 29): on its 3rd frame JPA 571-575 and 975/976 12 px ahead and a shock wave (0x800F802C:
  radius 8 px more a frame, 20 frames) that gives hit type 11 (the seed's stun) to a Link it reaches: the green
  leader teleported 16 px below him went dizzy (Link state 12) 2 frames after the blow's hit, life 16 kept; the three
  followers 125 px away (inside the wave's 160 px) weren't (0x8022EA0C's check, read as the Link in control). Then 3,
  standing 120 frames, and again: three blows (frames 51, 262, 473 of the first trace).
- 8 standing 60, 1 the spin 115 (facing every 4 frames down, right, up, left: frames 62, 60, 63, 61; JPA 1046/1047 at
  his feet on its 70th: a dark ball growing over him), 2: drawn by another draw, not on the TV (frame dumps), 45 frames
  still, then walking (frames 24-31, 3 each) up at 0.1, 0.2 … 1 px/frame to 48 px past the room's top edge ((p >> 4) &
  3 = 3), gone there (frame 981: 242 frames into state 2). The camera widened after the ball. He dropped nothing.

**The key and the locked door** (`adv-door-frames`, room 3; `actor-trace.ts --tele`): teleported onto the `KEY0`
(456, 200), the game stopped for a message (lift it with R and carry it to a keyhole,
dismissed with A); facing it from 18 px below, R lifted it (state 17, 16 frames, then 18 carrying, player_sob 719-723),
and the Link carried it at 1.5 px/frame. Walking up into the house's `DOOR` (0x83 at (384, 96), its box's middle
(396, 108)), the key went when he reached y 123 (his ±7 body meeting the door's ±8 box), he walked on (state 2) to 119
and was held there 16 frames while the door opened, then walked on and went through the `WARP` behind it (state 28) on
the 21st frame after the key went. In the frame dumps the doorway's dark figure (`ZSLJ`) vanishes in smoke and a keyhole
shows. The sim lifts the key (the Action button facing it within 20 px, 16 ticks) and carries it, and opens the door the
same way (`doors.ts`).

**The key's throw, its first message, and the key on the floor** (room 3, traced in Dolphin with `trace.ts` and
`actor-trace.ts --ids KEY0=804a8cd8 --fields KEY0=0-2b8`, the KEY0 object found by its vtable; a private user folder
`ref/dolphin-user-adventure-key`, GDB port 9104). Positions are room px (world px − cell × (512, 384)); frames are the
trace's. The save `ref/save-adv-lake-room3.sav` predates the boomerang, so the item word (+0xC10 of the four Link objects)
was poked to 3 at frame 2 (`--write`). The route: `--tele 2:1809:1402` (273, 250), right to x 400, up to y 200.5, facing
right, A: the boomerang flies out over the posts to room x 502 and back and drops the key at the Links' feet (404, 204)
at frame 267 (Link at (400.5, 200.5)). Teleported onto the key the Link stands still in the solids round it (a teleport
onto it is not the way in).
- **First message** (`msgus` 361: "It's a small key! / Use the R Button to lift it / and carry it to a keyhole!"; the
  picture and the P1 badge checked in the frame dumps): on the key's return the Links stop; the box's first character is
  about 9 ticks after it dropped (its first frame in the dumps is 276, the key's drop 267), and the whole text is up 2
  frames later in the dumps (the typing rate not measured: the sim's sign typing kept). The Item press (A) before the box
  did nothing; one at frame 333 closed it, and the Links walked again on the next input. No box came by touch: the key
  on the floor, teleported onto it or walked into from above, showed none. The sim shows it on the first key the
  boomerang brings back (`KEY_MESSAGE`, `KEY_TALK_TICK` 9).
- **Walking into a key on the floor pushes it** (not simulated: `doors.ts`): teleported onto its top edge (the Link at
  (456, 194)), the key slid 8 px down over 7 frames with no input, then 10 px more as the Link walked down into it, to a
  wall at y 218, where it held the Link at y 212 (blocked). In the boomerang run the key moved 6 px right at frame 337
  (no input) and 28 px down as the Link walked past it to (410, 232), with no stop. On the lift the key shifted to
  (400.5, 201) and slid onto the Link over 13 ticks (its height 8, 16, 18 px): not explained.
- **Lift** (R, standing or as he stops): state 17 from the press, the key rising to 18 px over his head (state 18,
  player_sob 719 and the carry frames); 14 frames of state 17 the second time, 24 the first (the key's shift aside).
  The sim's 16 ticks are kept.
- **The throw** (R, carrying, standing; from (400.5, 217) facing up): the wind-up is state 22 for 10 ticks, its frames
  817 (7 ticks), 818 (2), 819 (1): for the first 7 ticks the key is 11 px high and 6 px lower (y + 6), then 15 and 20 px high. The release is the first tick of state 23 (frames 819, 820 for 8, 821 for 4: the sim's THROW pose, its
  release on tick 10); the key leaves at (400.5, 217), 20 px up. Then, per tick k = 1…15 from the release: y − 6 px
  (exactly, 6 px a tick, along the facing), height 20 − 0.1·k·(k − 1) px (for k = 1…14: 20, 19.8, 19.4, 18.8, 18, 17,
  15.8, 14.4, 12.8, 11, 9, 6.8, 4.4, 1.8; on the 15th it's 0). It lands at (400.5, 127) on the 15th tick, 90 px up, and no
  bounce: it stays put after. The Links' state 22/23 holds him from the press until that landing (no movement tried).
- **A wall**: a second throw, from (400.5, 146.5) (the lift at 19.5 px below, frame 558): on the 5th tick the key's 6 px
  step (to y 116.5) was cut to 4.5 px and it stopped at y 118.0 (the house's wall: the key's top edge at 112), its
  height on the way as the fall says (17 on the 6th tick). Then it drifted back 0.5 px a tick (118.5 on the 6th …
  123.0 on the 15th) and landed at (400.5, 123), 0 high. The sim's flight stops in ½ px steps at a wall and drifts back
  the same way (`keythrow.realdisc.test.ts`).
- **Not measured** (assumed in the sim): water and pits (the river in room 3 is walled off from any floor, so no throw
  reached it; the sim lands a key wherever its flight ends, water included, and lets it be lifted there); a flight
  over low posts (the boomerang's rule); a throw in a side view or in water; the keys of the room left mid-flight (they
  land where they are, `spawnPickups`); a second key's message (the sim shows one, the first, on the boomerang's return
  only: the lift of a floor key with no boomerang shows none, as the Cave of No Return's and Hyrule Castle's routes
  assume); the Links' movement during the wind-up and the flight; the boomerang's drop offset (the key came down 3.5 px
  right and below the Link: the sim drops it on his feet).


**Holes into GBA-screen areas** (`adv-chest`): room 3's `WARP` at (72, 232) (0x051A001A, style 0x1A) took a Link
walking down: 0.5 px/frame down (state 28) into area 5 at (216, 8), then out walking down (state 29) to (216, 28). Area
5 is a side-view cave (ladders, ledges, the chest on a ledge), where R in front of the chest lifted nothing; chests in
side views weren't opened. A teleport onto a solid spot (a rock over a warp, a wall) is undone by the game.

## Adventure: swimming, ledges, formations and Lake Hylia's way through
Traced 2026-10-02 with `ref/dolphin-user-adventure` (GDB port 55129) from `ref/save-adv-lake-room3.sav` and states made
from it under `ref/adv/` (not committed): `room5-river.sav` (the Links swimming in room 5's river, swum there from room 3
through room 6), `room6-area5.sav` (just through room 6's whirlpool), `room2-cave5.sav` / `room2-cave6.sav` (in room 2's
cave, before and after its four-Link switch). `trace.ts --tele` moves the leader within a room (followers catch up at
about 6 px/frame in state 3); the C stick is scripted as `c-up`… (`script.ts`). Positions are room px. The sim replays
`packages/sim/src/adventure/dolphin-adventure-motion.json` (`motion.realdisc.test.ts`) within 0.02 px.
- **Swimming** (room 2's river from its north pier, `swim3`): walking down, the tick that put his top sensor in the
  water (y 183, the deep tiles from 176; not at 181.5) is still a walk tick, then he swims (state 74) at **1 px/frame**
  from the next, 0.707 per axis on diagonals. Each tick he moves along the direction he swam the tick before (from a
  stop: his facing), so a turn shows one more tick the old way; the sprite turns at once (horizontal first, as walking).
  With the stick released he glides on **0.025 px/frame slower every frame** (0.975, 0.95, … to 0 in 40 frames). No
  current in the river. Frames: right 488-491, left 492-495, down 496-499, up 500-503, 6 ticks each, the 24-tick
  stroke running on while gliding or still. Against a wall (the rock) the step is taken whole, then undone 0.5 px at a
  time while a leading sensor is in it, the sensors reaching half a px further than on land (stopped at 232.02 with the
  rock from 240) and the backing off going on past where the step began (gliding into the rock he bobs 0.3-0.5 px).
  Out: the tick his anchor leaves the water (175.113 with the pier below 176) still swims; he stands the next (stand
  frame), walks the one after. Room changes in water: the usual walk-on at (d + 56) / 32 px/frame, but only pushing
  toward the side (gliding to 16 px from the top didn't change rooms). B dives (`swim2`): 7 frames on the underwater
  frames 504-507 show, he comes up 300 frames after the press, gasping (856-860); R or A while diving, once released,
  speed him up to about 1.9 px/frame, then the usual glide (not modelled). Sword, items and lifting do nothing in water.
  The followers swim the trail at 1 px/frame. The first big gem picked up (100) stops the game for a message.
- **Ledges** (`r5c`: room 5's pocket, northward into the river; `ledge2`: room 2, westward): tile types 0x10-0x13 are
  ledges jumped off north, south, west, east; the half of the tile a Link comes from is solid (0x10's bottom half,
  0x12's right half: the opposite of tiletypes.ts' masks, which Shadow Battle keeps), the cliff beyond it too. Walking
  into one, he jumps (state 56) on the **20th tick in a row without a whole step**: that tick he moves 1 px on (into the
  wall) still drawn walking; the jump aims at the middle of the first tile beyond the ledge that isn't solid, in the row
  (column) of his position + 8 px (room 2: from y 56 the row of y 64, so he drifted 16.6 px sideways), and lasts **27
  ticks** at (aim − position) / 26 a tick (so he lands one step past the aim), z rising 3.25 px/tick and falling 0.25
  px/tick² (22.75 px at the top, 0 on the 27th tick), drawn in the facing's first walk frame (24 up, 8 left). Then one
  standing tick, pushed out of a wall he landed in (1 px in room 2), then walking, or swimming (state 74 the tick after)
  when he landed in deep water. The second Link on the trail jumped too when he got there.
- **Grey stones** (tile 0x72, type 1: room 5's pocket, room 2's cave mouth): lifted with R like a bush (state 17, 18
  carrying, 22/23 throwing); the tile becomes 0x7C (RAM, the room's layer at 0x80F00C4A). In formation every Link does
  the R press: two lifted a stone and a sign (`KNBN`) side by side.
- **Formations** (C stick, room 2 and its cave): **c-right** lines the four up to the leader's right 16 px apart (the
  "wide" one), **c-up** makes a 2 × 2 box with the leader top-left (followers at +16, 0 / 0, +16 / +16, +16), c-left and
  c-down weren't sorted out; in a formation the followers walk with the leader (state 3) at walking speed.
- **The boulder** (`RCK3`, room 2 at (256, 272), box ±31.5 px from its init): the four in the wide formation walking up
  into it push (state 13 after 20 frames, then 14) and it moves **0.2 px/frame** with them, 12 px, then pauses 8 frames
  (+0x254 counting 8 → 0), 16 px, 8, 16, 8, 20, until it's at y 208 in the river's gap, where it sinks (+0x244 = 1):
  a crossing. The leader alone pushed it nowhere.
- **The two-Link rock** (`RCK2`, ±14 px; `rck2`…`rck2d`, room 3 and its house's back room): two Links side by side
  facing it (a point 16 px ahead of each inside its box) and R lift it together: it slides onto their heads, 18 px up,
  over 86 ticks, then they carry it walking; R throws it 4 px/tick the way the leader faces, coming down over 12 ticks,
  where it breaks for good. Under the back room's one lay the Fire Rod (`LSTI`, taken by walking onto it). One Link
  alone does nothing. main.dol (RCK2's update 0x8034CEB0): each Link whose lift point (his anchor + 16 px his way,
  table 0x80472190) is in [x − 16, x + 16) × [y − 16, y + 16) round the rock's anchor is counted by his facing; with two
  or more one way the two nearest the rock (their anchors) are put in the lift, any of the four. Nothing there asks the
  two to stand apart: two Links on one spot would lift it (the formation's walk keeps them apart, above). Room 3's is ringed by stumps (tile 0xFA, type 1) that R grabs (state 26).
- **The Fire Rod** (`fire`, `fire2`, `fire3`, room 3; A, the GC's item button): an 18-tick pose (sprites right 395, left
  401, up 413), the fireball leaving on the 12th tick 8 px ahead at 1.02 px/tick, easing to 2 px/tick (0.3 of the way a
  tick), bursting on a wall. A stump it touches burns with every stump touching it (all six round the rock from one
  shot), each becoming 0x5A (passable) 60 ticks later; blue gems came out of some (not modelled).
- **The boomerang** (`boom`, room 3): thrown at the key behind the posts (tile 0x073) it flew over them, took the key and
  dropped it at Link's feet; it doesn't hook the other Links.
- **The cave block** (`BLCK`, room 6's area 6, `blck`, `blck2`): pushed by the wide formation like the boulder, the same
  legs (12, 16, 16, 20 px with 9 still ticks between, 0.2 px/tick), 64 px south in all, then it stays: its switch (the
  params' top 5 bits, 16) starts the raft.
- **The raft** (`OBLF` at (352, 88) in room 6's area 6, `oblf`, `oblf2`, params 0x80012124; not simulated yet): with
  the four Links standing on its 32 × 32 top it sinks 3 px over 30 ticks, glides left 1 px/tick to x 142, and rises
  again over 30 ticks; the Links ride it.
- **Room 2's cave** (`room2-cave5`, `room2-cave6`): its four-Link switch (`YNSW` at (128, 96)) pressed by the box
  formation walking up onto it (each Link snapped onto a quarter, sprites 224-232 a while), which opens the `DOOR` (kind
  0, switch 16) to area 6; there R facing the pedestal tile 0x017 from below (leader at (125, 87)) gives the
  **boomerang** (+0xC10 = 3, 90 frames later: "You got a boomerang!"), no actor involved.
  The sim (2026-10-10, `logic.ts` catchFour, `fourswitch.realdisc.test.ts`): the box formation is caught when each Link
  is in one quarter of the switch's square (its middle (136, 104)) within ±16 px, and then each goes to his quarter's
  middle (±8 px: (128, 96), (144, 96), (128, 112), (144, 112)), the switch on that tick, the sprites 224-232 for 9 ticks
  (one a tick). **Assumed, not traced:** the ±16 px catch, the places (the quarters' middles, the box's), the snap at
  once (no ticks of walking to them), the sprites' timing; the traced "a while" wasn't timed. So the route's walk up to
  its spot is caught as the leader crosses y 104: from 103.3 he's put on (128, 96) in one tick (a 7 px jump, assumed: a
  slide over the 9 sprite ticks is the alternative if a trace shows the walk), then walks back to the spot. Room 4's
  switch (the same rule, `plateau-switch`) moves its Links 0.3-0.8 px onto their middles (the route's stops downstream:
  `bent.ts` EXPECTED).
- **The whirlpool** (room 6's `WARP` at (416, 224), style 0x0E, in the pool): swimming onto it takes the Link at once:
  state 38 (sprites 962-972) for 50 frames at the warp's position, then in area 5 at the target box's middle (280, 120)
  in state 39 (540-543) for about 90 frames, sinking from frame 60 of it, then **side-view swimming** (state 75):
  sinking 0.3 px/frame with no input (eased in), the stick moves him 1 px/frame on top of the sink (down 1.3, up 0.7,
  sideways 1.0 while sinking 0.3; diagonals 0.707 − 0.3). At the surface (y 92 in area 5's column) left onto the ladder
  tile (0x61) he stands (state 0), then climbs it like walking (state 2, up-walk frames, 1.5 px/frame); its top warp
  (style 0x19) took him into area 6 like a door. Its look (2026-10-21, `room5-river.sav`, swum right into room 6, `--tele` to (344, 192),
  frame 240): a blue swirl with sparkles over it at (424, 232), JPA 1363 and 1262 in RAM (docs/formats/jpa.md); nothing
  marks the waterfall's foot but its foam (PRTC's 392-394; no 1362).

## Adventure: formations against walls
Traced 2026-10-10 from `ref/save-adv-lake-room3.sav` (a copy of `ref/dolphin-user-adventure2` as the user folder, GDB
port 55123), round room 3's 32 × 16 rock at (224-256, 288-304) (the leader moved with `--tele 1:<x>:<y>`, the Links
then stacked on him; a C press in the next frames puts them in a formation from there). Positions are room px; a
Link's walls are about ±6 px from his anchor (he stopped at x 217.8 against the rock's x 224, at y 281.96 above its
top, at y 309.96 under its bottom).
- **The dash** (C press) is 6.0 px the first frame, then 6.5 px/frame along the line to the place. Against a wall the
  step goes on at **0.3 of itself** (0.29-0.30): the second Link of a column, pressed down onto the rock's top from
  (230.3, 272) toward (266.3, 304), slid right along it at 1.32, 1.27, 1.22 … 0.87 px/frame (0.3 × 6.5 × dx/d) until
  past its corner, then dashed on (18 frames in all, no warp); a place inside the rock (the box formation's third
  Link, (232.65, 296)) is crept toward at 0.3 of the remaining distance a frame (232.60, 232.61 … 232.65 under the
  rock) and the Link stays there, 300 frames with the leader idle.
- **Left behind**: the leader walking away while a follower can't follow puts the follower on him, then 1.5 px toward
  his place (leader + (1.06, 1.06) for a place at (16, 16); + (1.5, 0) for one at (16, 0)), and from the next frame he
  dashes there again (sliding round the rock as above). When: never with the leader standing (the wide formation
  from the rock's left side: its three followers pressed against it, their places 13, 29 and 45 px off, in it or
  beyond it, stayed 60 frames); with him walking up, the box's third Link under the rock was put on him once its place
  had left the rock (leader at y 272.5, the place (232.65, 288.5): after 5 steps in one run, after 2 + 2 + 1 steps
  with stops in another; not at y 274 / 290, even after 10 frames standing), the wide formation's first and second
  followers once theirs had (places at y 287 and 284), the third not at all (his place beyond the rock from the
  leader the whole walk: he slid up its left side and dashed round its top). A follower sliding nearer his place wasn't (the column's
  second Link, its place 25 px off and clear, the leader walking). The sim's rule (`formation.ts`
  stepFormationFollower): no nearer this tick and a Link's box goes from the leader to the place in a straight line
  (inferred from these cases; within a frame or two of them).
- **Walking in formation** (the sim since 2026-10-18: `formation.ts` holdFormation, a follower whose side meets a wall
  holds the leader; the corner slide moving all four isn't in it): the four in their places move as one.
  The column walking right with its second Link level with the rock's left side stopped where he met it (leader at x
  217.8 with the stick held right 40 frames; after 20 frames that Link pushed, state 13, and the four stood back
  1.15 px); a follower's corner slide moved all four with him (room 3's east wall: the four went up-right together). A
  follower still dashing to his place doesn't hold the leader (the box's third Link under the rock while he walked up).
- Not seen: a follower left behind by a door or a room change (those end the formation), or with the leader walking
  away from a place in a wall.

## Adventure: cannons and side-view doors
Traced 2026-10-02 (`ref/dolphin-user-adventure`) from `ref/adv/room7-area5.sav` (Lake Hylia room 7's lower cave, area
5, seen from the side; made from `room5-river.sav` with `--tele` up room 6's steps and onto room 7's door), traces
`r7a`…`r7g`. Positions are area px. The sim follows them (`packages/sim/src/adventure/cannon.ts`, `adventure.ts`). Only the leader
was traced there; the followers: "Adventure: the followers in a side view" below.
- **Doors in a side view's walls** (`WARP` style 0x15): walked into from the TV as any door (0.5 px/frame up, state 28,
  39 frames), he arrives standing in the door's box middle (32, 360) (state 29 with a 0.03 px/frame drift for 70
  frames, then gravity settles him). In the side view walking past a door does nothing (`r7f`: left from 43 to the
  wall at 23 through the door's box); **Up** in it takes him (`r7g`): lined up with its middle (x 33 → 32), state 28
  without moving for 39 frames, then on the TV at the target box's middle (64, 152), 30 frames still, then walking
  down 0.5 px/frame for 40 (to 172).
- **Walking off a ledge** in a side view: 3.3 / 2.2 px, 2.4 / 3.1, 2.0 / 4.0 the first three frames, then 1.5 px/frame
  on and falling 4 px/frame (as the Tower of Winds' TV side view). A ladder's top is walked over (sinking 1.9 px onto it).
- **Cannons** (`CNON` at (120, 400), params 0: still): walking under or into one does nothing, nor R, A or B beside it
  (`r7d`); a Link falling onto it (at (109, 385.8): within 11 px sideways, his anchor below its anchor − 16) is in it the
  next frame (state 76, sprite 976) 16 px over its anchor, bobbing down 4.5 px and back over 18 frames, then still.
  **A** shoots him (state 77, sprite 176) the frame after the press: 13 px up the first frame, 0.25 less each frame
  (to the top at 39.5 from 384), then down 0.25 more each frame up to 6 px/frame, through the HNRY on the way. The stick
  steers him while he flies: left gave −0.8 px the first frame, then 0.1 more each frame up to −1.6 (`r7f`); landing on
  the top-left ledge (y 104.8, the ledge's top at 112) he stands the frame after (state 0) and walks on. Room 7's upper
  cave (area 6) chains two cannons up through its top edge (style 0x16) into a hole in room 7's top; how the game shows
  that exit wasn't traced (the sim plays Shadow Battle's measured one: siderooms.ts).

## Adventure: the followers in a side view
Traced 2026-10-21 (`ref/dolphin-user-adventure-side`, GDB port 2410) from `ref/adv/room7-area5.sav` (the four stacked
at the door, (32, 360)), traces `s1`…`s7`, and `ref/adv/room6-area5.sav` (under the whirlpool, the four at
(280, 152)), `w1`. Positions are area px; "13 ticks late" means a follower stands where the Link ahead stood 13 ticks
before. The sim follows them (`packages/sim/src/adventure/sideview.ts` stepSideFollower, `apart.realdisc.test.ts`).
- **No gravity of their own.** The followers are drawn walking (state 3) wherever the trail takes them, in the air
  too; standing on a floor their y stays put, where the leader's flickers 0.1-0.4 px a frame (his gravity against
  the ground).
- **On the ground and on ladders** they walk the trail as on the TV: the second Link starts 13 frames after the
  leader, the third and fourth 12 after the Link ahead, and they stop when the Link ahead stops: 18-20 px behind on
  the ledge (`s4`: the leader at 56.3 on the ladder's top, the second at 36.5, the others still at the door 4.5 px
  behind him; `s6`: the leader stopped 13.5 px from the door after 10 frames, nobody moved), 18-18.5 px apart down
  the ladder (`s4`: 424.7, 406.2, 388.2, 370.2; and back up, 361.7, 379.7, 397.7, 415.7).
- **Off the ground** a follower plays the Link ahead 13 ticks late (the second Link; the third and fourth 12 ticks
  behind the Link ahead), at most 6.5 px a frame along the straight line to that spot, and goes on so, the spacing
  forgotten, until he's on that Link. `s5` (right off the ledge, the stick let go 2 frames after): the leader landed at
  (104.5, 424.8) on frame 59; the second Link walked the ledge at walking speed, then, his anchor over the pit,
  6.5 px a frame (frame 59: (101.55, 365.07) → (103.63, 371.22), toward the leader's spot of frame 46), then the
  leader's fall 4 px a frame, landing on frame 72, the third on 84, the fourth on 96: all four stacked on (104.5,
  424.6-424.9). `s3` (left in the air against the ledge's face, then let go): the same, the three falling his fall
  13, 25 and 37 frames after him. `s7` after a shot landed on the top-left ledge: the leader walked left 13 frames and
  stopped at 32.1; the second and third walked on onto him, the fourth stopped 3 px short, all still in state 3
  until frame 280, then standing.
- **The cannon** (`s1`, `s2`, `s7`). The leader falling into it from the ledge's walk (in it on frame 111 in `s7`):
  the third Link was put on him the same frame, the second the frame after (after a 6.5 px step toward him), the
  fourth the frame after that (after two), from (86.3, 360.5), (68.3, 360.9) and (50.3, 362.7). In it they bob with
  him. Shot (`s7`: A on frame 152, out on 154), they stand in its mouth (120, 384) (state 0, sprite 60), the second
  until 13 frames after him (6 px up the first frame, then 6.5 a frame), the third 12 frames after the second, the
  fourth 12 after the third; the second caught the leader's 13-frames-late spot near the top of the arc (where he's
  slow) and from there flew his path 13 frames late, the third and fourth the second's 12 late; all landed on the
  top-left ledge where he did. Back into the cannon from a shot (`s2`, frame 474), the followers in the air dashed
  straight onto him at 6.5 px a frame (not his path), and rode with him once there.
- **The cannon fires by itself**: left idle in it, the leader was shot out 300 frames after he got in (`s1`, `s2`: in
  on frame 50, out on 350, the same arc as A's), the cannon wobbling him (382-386) from about frame 232. Not in the sim
  (the leader's own motion; the routes press A).
- **Swimming** (`w1`, room 6's area 5: down, then left, then let go): the followers swim the trail 13 / 12 / 12
  frames late, at the leader's pace (1.3 px a frame diving: his 1 + 0.3 sinking), without sinking; once he glided to
  a stop they stopped 16.7, 12.9 and 12.5 px apart (on the TV: 18; the sim keeps 18).

## Adventure: the Links apart, waterfalls
Traced 2026-10-02 (`ref/dolphin-user-adventure`). Positions are world px in `free*` (room 3 from
`ref/save-adv-lake-room3.sav`, the four stacked at (1816, 1496)), room px in `falls1`.
- **Apart** (`free3`…`free5`): **X** sends the three others a step away (8 frames; red +15, +9, blue 0, +13, purple
  −16, +4 from where they stood, the leader facing down), where they stand in sprite 451 while the leader walks on
  alone; **Y** calls them back: they dash onto him (state 3, 6.5 px/frame) and trail him again; the C stick puts them in
  a formation again (`free4`: c-right, the wide one). The **D-pad** hands the controls to a Link: dpad-right to the red
  one, dpad-left to the blue one (up and down not tried); the one who had them stands where he is (451). L opens
  something that stops everything until L again (a menu); Z did nothing seen.
- **Waterfalls** (`falls1`: the four teleported into room 7's water above the falls, (300, 36)): after 11 frames
  swimming there (state 74, no current) the four are at the bottom of room 7's screen, y 368, each at his own x, in
  state 56 (sprite 24) for good, until the stick is pushed down (4 frames later the usual room change: 2.25 px/frame
  from 368 to room 6's 40.25), then 80 px down at once (120.25, state 56, sprite 16) for 14 frames, then swimming in
  room 6's pool. A `SEV2` actor stands at (224, 96) in both rooms (params 0x04000000 above, 0x04000001 below).

## Adventure: room 58's caves, the raft, area 7 (Lake Hylia to its goal)
Traced 2026-10-03 (`ref/dolphin-user-adventure`, GDB port 55129) from `ref/adv/room58-area5.sav` and states made from
it and from `room6-area6-pushed.sav` (not committed): `room58-mid.sav` (the four in the middle room), `room58-four.sav`
(on its four switches), `room6-area6-left.sav` (past the pit), `room6-area7.sav` (area 7's floor). Positions are area
px. The sim follows them (`apart.realdisc.test.ts`, `lakehylia.realdisc.test.ts`).
- **Rooms played alone.** The grid's room 58 ran **room 8's** actor list in area 5 (one player, four Links): the live
  `SWTH` with params 0x88000000 (switch 17) stood at (304, 192) (+0x90 = params), room 8's place for it, not room 58's
  (432, 144) beyond a pit; no `SWT4` 18, no switches 5-8. Every grid room numbered 50 or more has such a variant 50
  lower off the grid (boss010 58/8, boss013 57,58/7,8, boss023 52,61,66/2,11,16, boss030 54/4, boss053 54,59/4,9), its
  layers too (room 8's area 5 differs from 58's). `TMI2` ("２・３人用ブロック", blocks for 2-3 players): none shown
  alone; its init (0x8037691C) clears +0x11C at once, its other method spawns `BCK2` ("カラーブロック１人用") where its
  tile is 0x12 (a floor switch).
- **X while trailing** (`t3`): the three stand where they are (sprite 451, facing down), no step away (the step away of
  `free3` was from a stack).
- **The four switches** (`t4`): the leader walked onto switch 1, the D-pad handed the controls on (right red, left
  blue, **down purple**); a Link standing still on a floor switch shows sprite 232, one left waiting on it 453 and is
  put on its middle when the controls leave him ((265.09, 216.56) → (264, 216); (218.4, 266.6) → (216, 264)); one left
  9.56 px below a switch's middle went 16 px below it, (264, 232) (not simulated). A Link walking past another pushed
  him (224.1 → 230.1; not simulated). With all four on, switch 16 came on (the bridge's PNPCs) and **stayed on** when
  one walked off (`t6`): `SWT4` (0x802A96B0) sets its switch, sets its four inputs again as "set by an object" and, in
  modes other than 0 and 3, ends (this one is mode 1).
- **The room's switches in RAM**: the stage is a pointer, [[[0x8053AAF8] + 4] + 0xC]; its switches word at
  stage + 0x178 + cell y · 40 + cell x · 4 (cell x, y at stage + 0x14, + 0x18); room 58's 0x1001E (1-4 and 16).
- **Out alone** (`t7`, `t8`): with the others on their switches, the one in control walked out through the cave's door
  (the usual 39 + 31 + 40 frames) onto the TV alone; the others stayed in area 5 where they stood. **Y** there brought
  the three onto him the next frame (state 3 one frame, then standing), the trail again.
- **The raft** (`OBLF` at (352, 88), `a5`…`a8`; switch 16 on from the block): it counts the Links on it (+0x26C, one
  flag each at +0x283…+0x286); the four in the box formation at (339.5–355.5, 79.8–95.8) were counted, one at
  (361.5, 95.8) wasn't (the box not worked out). With all four: state 5, y + 0.1 a frame for 30 frames (88 → 91), state
  1, x − 1 a frame from 352 to 142 (210 frames), the Links a frame behind, state 6, y − 0.1 a frame for 30 frames, state
  2. The Links stood still (sprite 61, the followers flickering 3/0).
- **The ladder up to the well** (area 6's top left, the way back of the TV's `WARP` at (344, 344)): in the wide
  formation the leader stopped at y 39 pushing (state 13); trailing, he climbed it (state 28 from y 25, 0.5 px a frame)
  and came out at the well's middle (352, 352) walking up 20 px (state 29).
- **Side views** (room 7's area 5, `t10`, `t11`; room 6's area 7, `t19`): walking off a ledge, the tick his next step
  leaves the ground he moves 3.3 px on and 2.2 down (95.3 → 98.6), then 2.4 / 3.1, 2.0 / 4.0, then 1.5 / 4 a frame;
  stepping off a ladder sideways halfway down he walks at 1.5 px a frame and hangs on while his body (±7) is over the
  ladder's column (to x 69.8 off the column at 48-63; 1 px down at 65.3), then falls 4 px a frame, no arc. In area 7,
  climbed to y 97 on its right-hand ladder (288-303), walking left he hung to x 281.5, fell from 280 (1.5 left, 4 down
  a frame) and landed on the passage at (266.5, 137): the way across. Coming in through the garden's hole (style 4)
  he stood at (280, 8) about 55 frames (state 31), then fell 4 px a frame to the floor (216.7) (the sim walks him out
  20 px first). The followers: "Adventure: the followers in a side view".
- **Bushes**: two cut by a spin in room 1 dropped nothing (gems 4 → 4); the drop rule wasn't looked into further.
