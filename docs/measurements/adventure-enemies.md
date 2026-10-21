# Measurements: adventure generators, kills, drops and sword soldiers

Part of the measurements from the real game (index: [../measurements.md](../measurements.md)).

## Adventure: generators, kills and drops
Traced 2026-10-03 (`ref/dolphin-user-adventure`, GDB port 55129, `actor-trace.ts`) from `ref/adv/room5-river.sav`
(room 5, the Links teleported onto the bridge's floor switch at (264, 304), `r5gene`; then to the west passage at
(86, 74) stabbing left every 12-13 frames, `r5fight`…`r5fight3`), and states made from it and from
`save-adv-lake-room3.sav`: `ref/adv/room4.sav`, `ref/adv/room9.sav` (not committed). Room px unless said; the stage
object was at 0x81255D30 (its kill counters at +0x6748, room 5's switches at +0x1D0). `packages/sim/src/adventure/`
`generators.ts` and `enemies.ts` apply it (`generators.realdisc.test.ts`).
- **Room 5's ambush** (two `GENE`, a `SKIL`): the floor switch set switch 2 (frame 4); on frame 5 switch 4 came on
  (`SWT4`: 2 and not 16, through `OFFS` 3 = not 16: the `PNPC`s shut the way west) and the first sword soldier
  appeared, then one every 10 frames (frames 5, 15 … 155), 16 in all, the generator then idle (+0x230 2). Its params
  0x139CE010: switch 2, three types 14 (5 bits at shifts 22, 17, 12), interval field 0 (→ 10 frames), count 0x10. Type
  14 makes `SLR1` with params 0x102 (kind 2, life 1). The other `GENE` (switch 1, the south bank's floor switch at
  (80, 336)) makes 5 the same way at (312, 234).
- **The soldiers walk in** (state 0): appearing at (24, 74) = the generator's (16, 80) + (8, 26), then 32 px up (SLR1's
  init does this for a soldier spawned at world (104x, 87x) / 10 in the room on cell (2, 2): only here), facing right,
  each walks right at 1.4 px/frame, its velocity easing 0.3 of the way (0.42, 0.714, 0.920, 1.064 … 1.400), for
  110 + rand(40) frames (+0x23C: 146, 131, 145, 123 …), then chases (state 6, +0x23C 150 + rand(100): 215, 222).
  Idle on the switch the Links were never reached in 700 frames: the soldiers came down the bridge and stopped 40-55
  px short (at y 251-278), turning back (velocity −1.0) and pacing (states 1, 2, 4, 5); the same with the Links
  further up the bridge (stopped 40-50 px north of them). In room 9 the six soldiers gathered round the captain
  (`SLR4`, patrolling a diagonal at 0.9 px/frame, 347-frame legs) rather than the Links. main.dol explains the
  gathering: a soldier's params' top byte names its captain's group, and the captain (0x80172DC4) gives orders by
  turns, gather (marching away from the Links, its soldiers closing on it) and attack (marching at them), each for
  200 + rand(200) frames when its params don't set them (room 9: 347) (`soldiers.ts`). The stand-off: below,
  "Adventure: the sword soldiers".
- **Kills** (`SKIL`, update 0x802ABCD8): the stage counts kills per screen (+0x6748 + 4 × screen, 0x802D766C, when an
  enemy with +0x1A8 set dies); room 5's counter went 1, 2 … 13 with each soldier killed by a stab. SKIL mode 0 sums
  the screens; at p & 0xFF (16 here) it sets its switch (16: the way west open again) and goes.
- **Drops**: a dying enemy whose enemyparam.csv `dasu` isn't 0 rolls its class's chance (0x80469D48) and one of eight
  codes from its row (0x80469D78): hearts, or Force Gems (`RUPY` params 0x261E00 + type). The sword soldiers (dasu 4:
  half the time, then red 4 in 8, blue 2, a heart 1, green 1): 7 drops in 13 kills, all red (the RNG replayed the same
  in two runs); with another stab rhythm 6 in 12: green, blue, red × 3 and a heart. Dropped gems lay where the soldier
  died and were still there 670 frames later; the heart popped up (z 0, 1.5, 2.9 … a 0.1 px/frame² hop).
- **A Force Gem falling** (`RUPY` params 2 from 299 px up onto a Link): 1.3 px the first frame, 0.3 more each frame
  (1.6, 1.9 … 13.0), down after 41 frames. Its source is the **kill streak** (found 2026-10-05, `r5fight` again: the
  Links put on the bridge's switch, then at the west passage stabbing left every 12 frames): red gems fell onto the
  Link exactly 90 frames after the 10th and the 15th soldier went (16 killed, the Link never hurt). main.dol: the
  common death code (0x801F4F28, an enemy with +0xFC = 1) adds one to the killer's count (Link +0xC74, at most 9999;
  +0x10C the Link) and makes a `SCRE` (params: the count, the Link, kind 0) that follows him for 90 frames, then
  (0x80393514) rewards each multiple of ten the count went past since the last SCRE (the per-Link table 0x80529FE0):
  `RUPY` 2 (red) for 10 and 20, 3 (50) for 30-50, a fairy (`FARY`) from 60, and one more red for passing 15, each at
  his position from 300 px up, falling at 1 px/frame. The stage zeroes the counts at an event (0x802DBD60 for the four
  Links; not looked into). `enemies.ts` STREAK.
- **Bushes** (room 1, a dozen cut by stabs): three left a small heart, none a gem. main.dol's cut-grass actor (`GRAS`,
  0x802CEC10; params 0 for the sword's bushes) rolls rand(100): 40-60 leaves something, a green gem when odd, a heart
  when even (other params: always a heart, two, an `MTBO`; its other kind, (p >> 20) & 15 ≠ 0, 11 in 100); none in stage 8-3. Pots (`TUBO`/`STON`,
  0x802D152C): 26 in 100, a green gem or a heart (always a gem in stages 3-3 and 5-3).
- **Lake Hylia's Zol** (`ZASL` at (176, 112) in room 4, params 0x10) wasn't alive in single player (a MEM1 dump of the
  room); a `RCK2` lies on the same spot. main.dol: the stage loader calls each actor's vtable +0x10 once the room's
  actors are made, and RCK2's (0x8034D99C) takes out of play up to 8 live actors of its screen whose placed point lies
  in [x − 16, x + 16) × [y − 16, y + 16), keeping their type, point, params and list index; lifted by two Links, a
  count of 3 runs while it's up or thrown, then they're made again at their points (0x8034D8F0). `rocks.ts`
  heldUnderRocks (not traced: the lift in Dolphin needs two Links).

## Adventure: the sword soldiers
Traced 2026-10-05 (`actor-trace.ts`, `ref/dolphin-user-adventure`, GDB port 55129; the soldiers' fields +0x230 state,
+0x238/+0x23C/+0x240 timers, +0x28C chase speed, +0x29E aim, +0x2AC/+0x2B0 target velocity, +0x3C/+0x40 velocity,
and the attack slots 0x804BF850, the countdown 0x80539F68 and the rate 0x8053AB48 raw every frame): `r5idle` (room 5's
ambush, the Link idle on the bridge's switch, 900 frames) and `r9idle` (room 9, the Links idle at the room's right edge,
1200 frames); read in main.dol: SLR1's update 0x80150284 (its states' table 0x8049FCF8), init 0x80153AA4, death
0x8015394C. `soldiers.ts` applies it (`soldiers.realdisc.test.ts`).
- **States**: 0 walk in (room 5's), 1 patrol (walks along its facing at its base speed while its leg lasts, else
  stands), 2 a wall's 8-frame stop, 3 looking round (a head turn every 15 frames, the head's direction table
  0x8049FB78), 4 "!" (one frame), 5 the 20-frame wind-up facing the Link, 6 chase. Placed soldiers start looking
  round (room 9: state 3 on frame 0, walking off 36 frames later). Timers count down after the state's code (a timer
  set to 20 reads 19 the same frame; a chase ends the frame after its timer reads 0).
- **Noticing**: patrolling, a Link in the quadrant it faces within 100 px (1000 for kinds 1-3: room 9's kind 2 soldiers
  set off from 300 px) once its cool-down (+0x240) is over; looking round, within 100 px where its head looks. Then
  state 4, 5 (+0x23C = 20) and the chase: 1 + 20 frames (`r5idle`: notice on 398, chase on 419).
- **The chase**: 50 + rand(200) frames (+0x23C 76, 219, 92 …), its speed 1.5 × base + rand(0.2) (1.10-1.23 read), its
  first aim 20 + rand(instance & 7) frames in, then every 13 + rand(instance & 7) (the soldiers read: 13), at the Link
  give or take 0x1000 (its facing then his quadrant); kinds 1-3 and 6 without a captain halve their target across
  their facing (`r5idle`: target (−0.10, 1.18) for an aim of 63807 at 1.196). The velocity eases 0.3 of the way to the
  target. Over, it stands (state 1, target 0) with +0x238 = 20 and a cool-down of 30 + rand(instance & 7), its leg
  50 + rand(50).
- **The attack slots**: four words at 0x804BF850 (one per Link: the soldier's id +0x198 that has it, −1 free), a
  countdown 0x80539F68 and a rate 0x8053AB48. A chasing soldier within 56 px of a Link (the nearest, 0x801EEC98) takes
  his slot if it's free and the countdown less the rate is out (the countdown is then 200 again); otherwise it sets its
  target to its chase speed 0x7000 round from the Link (`r5idle` f326: (0.31, −1.16) for the Link 54 px off, 7.9° from
  straight down), every frame, so between aims it backs off. Every SLR1 init frees the slots, sets the countdown to 200
  and the rate to 0; a soldier struck (or killed, 0x8015394C) frees its slot and adds 2 to the rate (at most 200; the
  first time also zeroes the countdown). `r5idle`: the slots stayed free, the countdown 200 and the rate 0 for 900
  frames, the sixteen soldiers pacing 44-60 px from the Link (none came closer). The traced backing off skips some
  frames where soldiers shove each other apart (their separation, not simulated); the sim's soldiers kept 52-68 px.
- **A captain's soldiers** (`r9idle`): the captain's order (+0x288: 1 gather, 0 attack) is copied to each soldier
  (+0x27C); under gather a patrolling soldier goes 4 → 6 at once (frames 36-38) and aims at the captain while more than
  40 px from him, its chase held at 20; under attack its chase is held while it sees a Link. The captain's legs: 296
  and 268 frames (params 0x01000000: 200 + rand(200)).
