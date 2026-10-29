# Measurements: Shadow Battle open items, traced

Part of the measurements from the real game (index: [../measurements.md](../measurements.md)).

## Shadow Battle's open items, traced (2026-10-05)
From the round states with a private copy of the battle user folder (`ref/dolphin-user-battle3`, GDB port 55135;
traces in `out/traces/s3/`, not committed). Positions are room px (screen-local in a side room); P1's actor is at
0x8117521C, P2's 0x81176AE8, P3's 0x811783B4 (position at actor + 8), The Field's orb generator 0x812E2500.

**Things through doors and holes** (`field-2p`: P1 put at (256, 200), the house door pushed open, then an arrow
(item 4), a seed (10), a boomerang (3) shot up into it and a bomb (8) lifted and thrown into it; `flames-2p`: a pot
carried under the north door and thrown up; `clouds-2p`: a bomb thrown into the hole; `actor-trace` of ARRW, PCDM,
BOME, HBMB, TUBO, GRAS). Read with the WARP update (0x80227F50, 0x80228484-0x80228AA8, the finder 0x80227290):
- A warp takes at most one thing a tick, the first it finds of its list: holes (styles 4, 32, 36) HBMB, BOME, STON,
  GRAS, TUBO, YASI, RUPY, HNRY, ESRY, SBAL (0x8046AC2C); styles 6, 11, 20 HNRY and ESRY; the other styles (doors, the
  side rooms' top edges, the gates) ARRW, FIRE, HBMB, BOME, STON, GRAS, TUBO, YASI, HNRY, ESRY, PCDM, SWBM, SBAL.
- Their boxes (+0x60): an arrow ±2, a seed ±8, a boomerang ±8, a thrown bomb ±13 (±10 on a socket), a pot ±8, a bush
  ±4. The overlap test raises the thing's box top by its height and its bottom by half of it (y − h − z to y + h −
  z/2), within 32 px of the warp's height (not on a side-view screen). Traced: the pot at (224.5, 106) 13.25 px up
  missed the north door (84.75 > 84), at 100 and 11.75 up it went.
- Into a door it must be moving the door's way (styles 0, 3, 21, 35 up; 1, 2 down; 23 right; 24 left); bombs, pots,
  bushes (and STON, YASI) only while their speed (height included) is over 1 px a tick; into a hole loads only at most
  4 px up, a boomerang on the ground; a boomerang on its way back never. The house door's shut tiles (0x19C/0x19D
  under the warp: 0x80226850) stop everything.
- Where it comes out: a seed and a boomerang (and HNRY, SWBM, FIRE kind 1) keep their offset from the warp; the rest
  come out right on its destination (the door's: the arrow at (80, 136) of the house). The move is queued (+0x17C) and
  done by the thing's own update before it moves: the frame after the warp saw it, it's there and has moved on
  (arrow 171 → (80, 131); the thrown bomb from (256, 192) 28 px up straight to (80, 130), still 28 up). Speed and
  height are kept; into a side-view room its height is dropped and its speed up the screen kept (the bomb into Above
  the Clouds' hole: (152, 8) − 1.8, then 1.65 up, falling 0.15 px/tick²).
- After a warp another one waits +0x180 ticks (20; the boomerang 60) or until the thing is +0x184 px from where it came
  out (40; the boomerang 80) (0x801F33C4): the bomb sat in the room's top edge (style 19, y 0-16) for 20 ticks before it
  took it back to the TV, onto the hole, where it fell into the pit (state 6) and was gone 21 ticks later.
- A boomerang that went through comes back the same way: it homes on where it came out and, once its step ends within
  three steps of it (12.4 px at level 1, 23.6 at level 2; not at 18.2 and 41), it's back where it went in (shown there a
  tick), then homes on its thrower. (It flew up the house to y 43.6 at level 1, past the row at y 98 where the arrow
  stuck: the sim's house stops it there.)
- Arrows and seeds shot up appear at (−2, −5) from the Link (both). A pot is thrown as a bomb: 6 px a tick, falling
  0.15 px/tick² from 20 px up (not the bush's 4 and 0.1).
Applied: siderooms.ts `thingWarps`, projectiles.ts (the boomerang's way back), carry.ts (the pot). Not: STON, YASI,
RUPY, HNRY, ESRY, SBAL, FIRE, SWBM (not in the battle sim).

**The push state and the house door** (`field-2p`: P1 walking up into the shut house door, and down into the south
wall then a diagonal, a stick turned): walking into a wall the walk cycle runs on in place; after 20 ticks without
progress (from the tick after the last part step) he leans on it, state 13, frames 8 ticks each from the tick before:
facing down 674, 675, 676, 677, 674, 678, 679, 680 (an 8-step cycle of 7 frames), up 681, 682 …; a diagonal into the
wall doesn't slide him (his position jitters by 0.44 px every 8 ticks); with the stick released he pushes on 6 ticks,
standing on the 7th (Shadow Battle trace bombL2: 50-55 pushing, 56 standing); turned, one tick pushing the new way
(667 facing right), one standing, walking from the third. As the adventure's push (same code, state 13), now shared:
push.ts. The house door (stopped at 183 on frame 26, pushing from 47, moving on 59) opened then for another reason
than the push: corrected in battle-combat.md "The arenas against Dolphin, the rest" (it opens as a Link faces it,
from the round's 48th tick).

**The trick floor's respawn spot** (`field-2p`, switch 2 poked on while P2 stood on it): walked right onto it to
(229.5, 240) (5.5 px in from its left edge 224), he's put 8 px in (232) and jumps back out to (216, 240); walked up onto
it to (240, 221.5) (13.5 px from its top edge, 50 from its bottom), he jumps back down to (240, 280) (the earlier trace's
(256.5, 229) → (256.5, 280) the same way). So the edge is the one behind him (the way he came, not the nearest), and he
lands 7 px past the floor's first pixel: edge + 7 going right or down (272 + 7 = 279 in the Tower of Flames' pit), edge
− 8 going left or up (224 − 8 = 216); the trick floor's own far edges reach a pixel past its tiles (280, not 279: not
modelled). Applied: combat.ts `pitEdge`, `startFall`.

**The Field's corner by P2's start** (the clash trace's P2, pushed away down-right from (313.3, 273.6)): no actor's box
(BEEE's ±4 px box sits inside the solid trunk, DOSN is a sensor): he meets the corner of the beehive tree's base (cells
x 320-351, y 256-271) and slides round it as a walking Link does. Applied: combat.ts `slideBy` (pushes slide round
corners off the side-view screens): the clash case now replays both Links within 0.12 px.

**Epona** (`field-2p`: the orb generator poked to kind 3, +0x234 = 3, its counter +0x238 = 595 and its position, so a
carrot lies by P1's start; P1 walks into it; P2 in her way, or stabbing the rider from beside her way): a Link she
gallops into is trampled: **2 life**, 60 invincibility, state 16: shoved along her way 6 px a tick on the ground (6.5 on
the first) until he's stopped (22 ticks to the house wall 133 px on), then bounced back 2 px a tick with a 4.0 hop
(z 4, 7.75 … 34, down 33 ticks later), the knockback frames all along. Against a wall at once he stays shoved against
it while she pushes past (19 ticks), then bounces (not modelled: the sim bounces on the first stopped tick). A stab
through the rider did nothing: **a rider can't be hit**, and a Link 16 px off her way isn't trampled. Applied:
epona.ts `trample`, combat.ts (`Fighter.shove`, `SHOVE_SPEED`, `SHOVE_BOUNCE`).

**The cucco's rival** (`field-3p`: the orb lifted, its content poked to a cucco (CRTL +0x294 = 3, +0x2B4 = 1), thrown up
after the roulette; P2 and P3 placed): P1's cucco went for **P2** both when P2 was the farther rival (P3 at 44 px, P2 at
125) and the nearer: the first rival in player order. Its goal heading (NIWA +0x29C's high half, a 16-bit angle) turns
in 22.5° steps every 4-8 ticks: with P2 40 px off its way it circled him about 40 px out for 95 ticks instead of
striking (not modelled). Applied: cucco.ts `cuccoTarget`.

**Soldiers' life and the sword** (`castle-2p`, the home soldier at (128, 128) poked to 16 life, +0x108): each stab took
**4** (16, 12, 8, 4, 0): an enemy takes the attack's power, twice a Link's share. Applied: strike.ts (`SOLDIER_LIFE`,
`soldierLife`, the sword's power), switches.ts (`GEN3_SOLDIER_PARAMS`: the GEN3 0x1B soldier's 16, 0x24's 20 …).

**The bees** (`field-2p`, P1's +0xB9A, the hammer's flag, poked on while 56 px from the west tree): BEEE state 1 for 60
ticks (the swarm spreading out of the tree), 2 hovering 32 more, then the swarm's centre (+0x2A4) flies at the nearest
Link: re-aimed every 10 ticks, its speed easing a tenth of the way to 2 px a tick (0.2, 0.38, 0.54, 0.68 …); on him a
sting: **1 life**, the sword's knockback; then state 5, buzzing on the spot 121 ticks, then at him again from a
standstill (stings on 138 and 288). Still at it 400 ticks on. Applied: hazards.ts `stepBee`, strike.ts (the wake's
92 ticks). Not: the wake rule (the sim's stand-in stays: no hammer or boots in its items).

**Angry cuccos** (`field-2p`: P1 into the cave by its door, the cave's cucco (NIWA params 6, +0x108 1000: it never dies)
put in front of him again and again while he stabbed every 30 ticks): each hit counts down its +0x268 from 10; the
tenth asks for message 0x1B7 "Angry Cuccos! Run away!" (once: +0x2A0) and +0x240 = 230; 4 ticks later and for 170
ticks a cucco (NIWA kind 1) appears every 2-14 ticks (even numbers) 15 px out of a random edge of the TV (x −15 or
527, y −15 or 399), 16 px up, flying straight at a Link there at up to 3 px a tick (1.35, 1.75, 2.02 …); one that meets
him takes 1 life with a 1 px/tick, 4.0-hop knockback (P2 on the TV: 12 → 11, 10, 9, 8, every 60 ticks); P1 in the
cave was left alone. After 230 ticks the cave cucco counts from 10 again. Applied: hens.ts.

**Presentation, read in main.dol:** the screen quakes (0x802D79E8 asks, per screen, a strength along x and y; the stage
0x802DD54C shifts the TV's view by it, the sign flipping every 2 frames, 0.2 px weaker each frame): along y, a bombchu
going off 4 (0x8032626C), the giant bomb landing 8 (0x80342D60) and blowing up 16 (0x8034338C), a thrown orb's hit 4
(0x80323310: not applied). BBSL's color matrix (draw 0x80340EC8, his fade +0x250 = a, 1 at full strength, −0.1 a tick
fading out, 0 → 1 fading back in): red × a, green and blue × (2 − a), × (3 − 2a) while fading out. Applied: apps/battle
quake.ts, scene.ts (`drawShadowLink`'s tint). Not looked at: the held sounds' volume by position.

## Battle leftovers, traced (2026-10-09)
From `ref/save-battle-field-2p.sav` (traces in `out/traces/`, not committed; GDB port 55077), P1's item poked into
+0xC10/+0xC14 (0x81175E2C) as before.

**A bumped Link's walk** (the `bump`, `roll` and `charge` cases' standing P2): he shows his walk (state 2) on each tick
after one the other Link's body moved him, the walk's frames counting those ticks as a walk does (16, 16, 17, 17, 17,
18 …), but its first frame on a tick he isn't moved. Applied: combat.ts `separateLinks` (`Fighter.bumped`,
`bumpedBefore`), `fighterFrame`: the replays' sprite differences went from 17 + 15 + 2 to 0 + 2 + 1.

**Shots on the ground** (`actor-trace.ts` ARRW, PCDM, the boomerang, +0xC…+0x14): an arrow, a boomerang and a drawn
seed fly at height 0, and ARRW's draw (0x8016545C → 0x802F86CC) passes its position as it is: their chest height is the
sprite's own offset. A quick seed is lobbed: 1.044, 1.988, 2.831, 3.575 … up to 5.98 on its 11th tick, i.e. up at
1.0438 px/tick, falling 0.1 px/tick² (the same facing right at level 1 and up at level 2). Applied: projectiles.ts
`SHOT_HEIGHT` 0 (was 8), `seedArc` (also what siderooms.ts's doors test, which had 1.27 + 1.17 a tick).

**The charge** (`10 idle; 100 p1:B`, frame dumps): the sprite stays 83 all through (no glow frame); the sword's tip
sparkles while charging and a burst of light marks the full charge (effects, not traced further). actions.ts
`linkDisplayFrame` keeps its glow-frame stand-in for renderers. Traced since (`10 idle; 90 p1:B; 30 idle`, field-2p,
`--link 3f8:10` and RAM dumps): the counter +0x403 is 1 on state 8's first frame (20), 48 on frame 67, then stays at
49; the live emitters match main.dol's reading (`docs/formats/jpa.md` "A charging sword"). Applied: Shadow Battle
draws them (apps/battle `charge.ts`) and drops the glow-frame stand-in.

**Epona against a wall** (the carrot as before; P2 walked to The Field's east edge at (432, 280) first): trampled on
155 and shoved to the wall (440.55) on 157, he stayed there, jostled ±0.3 px while she slid round him (her y 280 →
293), until 3 ticks after their bodies last touched (173): the bounce's step on 177. Shoved 105 px into the same wall
without her (the other trace): stopped on 144, 145, 146 (0.1 px a tick), the bounce's step on 147. So the bounce comes
on the 4th tick he's been stopped with her off him. Applied: combat.ts `SHOVE_STOP_TICKS` 3, epona.ts `trample`
(touching him resets the count).

**The cucco's heading** (main.dol NIWA kind 2, 0x80330868; its common tail 0x8033141C, 0x8032FA8C): when its counter
+0x238 is 0 it re-aims (goal +0x29E = the angle to its target, atan2 × 10430.4), steps its heading +0x29C toward the
goal by at most 0x1000 (22.5°, 0x801F714C) and sets the counter to 2 + rand(0…7); its target velocity is 3.0 along the
heading (+0x2B8/+0x2BC), which its velocity follows 0.3 of the way a tick, at most 1.0 a tick on each axis. Applied:
cucco.ts (`CUCCO_TURN`, `CUCCO_TURN_TICKS`, `CUCCO_TURN_SPREAD`), replacing the bisector turn.

**The trick floor's far edges**: its pit reaches a pixel past its tiles right and down (280, not 279, traced before).
Applied: world.ts `widePits` (the open trick floors, entities.ts `battleWorld`), combat.ts `pitEdge`.

**What wakes The Field's bees** (P1 with the Pegasus Boots, item 1, dashing up into the west tree): A held, state 57:
10 ticks of run-up (frames 24-29), then 3 px a tick; into the tree's trunk at y 265 he crashed (state 65: back 2 px a
tick with a 4.0 hop, frames 179-182, 33 ticks) and +0xB9C was 1 on the crash's first tick, the flag BEEE kind 0 reads
(0x8026FCE0: +0xB9A, +0xB9C or +0xB9D, within 80 px; +0xB9A is the hammer's pound; nothing stores a non-zero +0xB9D).
So a boots crash near the tree wakes them; the boots aren't in the sim (strike.ts's strike-or-blast rule stays).

**The boomerang in the house** (read, not applied): it flew up through the wall block in the house's middle (tiles
(4-5, 4-5), type 0x01 like the room's walls) to y 43.6, where an arrow stuck at y 98. The tile type doesn't tell them
apart, nor the TV's collision at the same coordinates (solid at x 80, y 96-127): left as the sim has it.
