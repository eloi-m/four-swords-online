# Measurements: Shadow Battle combat, lifting/throwing/rolling, items, levels and the Four Sword

Part of the measurements from the real game (index: [../measurements.md](../measurements.md)).

## Lifting, throwing, rolling, damage and items
Same savestate and method (formation leader, GameCube pad), plus RAM pokes through the tracer (`trace.ts --write`,
`--tele` to move the Links next to a room edge so that a normal room change follows) and per-frame dumps of the
spawned actors (`--raw`, `--dump`; `rawdiff.ts`, `memfind.ts`, `objtrace.ts` analyse them). Frame P = the frame the
press is seen on, as above. The Action button is **R**, and the game reads the **analog trigger**: a digital R click
alone does nothing (`script.ts` now presses both). B is the sword, A the item button. New Link actor fields are in
`docs/formats/runtime-ram.md` "Runtime (RAM) notes" and `tools/dolphin/src/fsa.ts`.

**Lift** (state 17; confirmed for bushes facing up, left, right; a placed bomb facing down)
- R with something liftable in front: decided on P (next state 17), lifting from P+1 for **24 frames**: b ×7, b+1 ×8,
  b+2 ×8, b+3 ×1 with b = **688 right, 692 left, 696 down, 700 up**. Carrying (state 18) from P+25.
- The object: a bush becomes a `GRAS` actor on P (its tile changes on P, see below), placed **16 px in front** of Link
  (along the facing), z 0. It stays there P..P+15, is at 12 px in front and z 8 for P+16..P+23 (sprite b+2), at Link
  with z 16 on P+24 (b+3), then carried at **z 18** above Link's position. A bomb lying 13 px in front snaps to 16 px on
  P+1 and follows the same path.
- Reach: the point **16 px in front** of Link must be on the bush (measured facing up: the bush's lower edge at
  y 80 is lifted from y 87.16 up to 95.16 and not from 96.66, so the probe is 15.2–16.7 px ahead; 16 = the object's
  spawn offset). Link doesn't need to touch it.
- R with nothing liftable in front, standing (or after a walking press that stopped by P+2): an **empty lift** on P+3,
  state 17 for 21 frames, b ×8, b+1 ×13, then idle (confirmed facing up and down).
- The formation followers can't be lifted in this mode: they walk through the leader, and R gives the empty lift.

**Carry** (state 18; confirmed)
- Walks at **1.5 px/frame** (1.0607 per axis on diagonals) and, unlike walking, **moves on the first input frame** (no
  turn frame). 24-tick cycle at 3 ticks per frame: right **704, 705, 706, 707** ×2, left **708–711** ×2, down **712, 713,
  714, 715, 712, 716, 717, 718**, up **719, 720, 721, 722, 719, 723, 724, 725**; standing shows the first one. No push
  state against walls (the cycle runs on). Room changes keep the object.
- The carried object bobs: z = 18 + (0, +2, +1, −1, 0, +2, +1, −1)[walk frame index] (measured walking down).

**Throw** (states 22 then 23; confirmed facing right, left, down, up; R or A while carrying)
- Decided on P, state 22 from P+1 for 10 frames: t ×7, t+1 ×2, t+2 ×1; then state 23 for 14 frames: t+2 ×1, t+3 ×8,
  t+4 ×4, t+2 ×1; idle on P+25 (**24 frames**). t = **802 right, 807 left, 812 down, 817 up**.
- The object: P+1..P+7 6 px behind Link at z 15 (facing up: 6 px below, z 11), P+8..P+9 above Link at z 17 (up: 15), P+10
  z 20, **released on P+11** along the facing (4 directions).
- A bush flies **4 px/frame**, starting at z 20 with no vertical speed and falling at **0.1 px/frame²** (z after n frames
  = 20 − 0.05 n(n+1)); it breaks when z < 0, on the 20th frame, **80 px** out. It stops at walls whatever its height, with
  a **±4 px** box (flush against the wall), and breaks there; it doesn't cut a bush it hits.
- A bomb flies **6 px/frame** from z 20 falling at 0.15 px/frame² (lands after 16 frames, 96 px), bounces once at 0.3 ×
  the speed (1.8 px/frame, vertical 3.0 falling 1.0/frame², 7 frames), then lies still; its fuse keeps running.
- **B while carrying** (state 21, 22 frames facing up: 817 ×7, 818, 819, 820 ×8, 821 ×4, 819): a slam. The object swings
  from behind (z 11) to the ground 16 px in front (z 8, then z 2 for 8 frames, 6 for 4, 8 for 1) and back onto Link's
  head; carrying resumes. *hypothesis*: an attack with the carried thing.

**Bushes** (confirmed): lifting or cutting (a stab's first frame) replaces bush tile 0x70 (type 0x21) with **0x79**
(type 0, floor) in the room's RAM layer. A bomb blast changes bush 0x70 → 0x79 and grass 0x74 → **0x7d** where its box
overlaps them, and starts a grass fire that turns bushes and grass into **0x5a** over the next ~40 frames. The Field's
other bush tiles (0x6a, 0x75) weren't tested.

**Roll** (state 79; confirmed)
- R while walking, with nothing liftable in front: decided on **P+2** if Link is still walking (otherwise the empty
  lift), rolling from P+3 for **21 frames**: r ×4, r+1 ×4, r+2 ×3, r+3 ×3, r+4 ×3, r+5 ×4 with r = **770 right, 776
  left, 782 down, 788 up**; then one idle frame (the standing pose of the stick's direction) and walking again.
- Direction = the facing when it starts (4 directions, even from a diagonal walk). Speed per frame = **2.0 px along the
  roll + 1.0 px along the stick** (unit vector, 0.7071 per axis on diagonals): 3.0 with the stick held along (63 px in
  all), 2.0 with it released, 1.0 against it, (1, 2) sideways, (0.707, 2.707) diagonally.
- Into a wall it stops like walking (0.5 px backoff, some corner slide) and finishes the animation in place; no bounce.
  It doesn't cut bushes. R during a roll is ignored (not buffered); R on the idle frame after it starts another.
- R while pushing against a wall: state 26 (a grab: 730 = left of the 726–741 block, 4 per facing) as long as R is held
  (1 frame for a tap), then idle.

**Getting hurt** (state 15; confirmed with an Octorok's rock in boss010 room 3)
- **Damage 2** (life +0xBFC 16 → 14, max life 16; a second rock 14 → 12). That is the Octorok's `atcp` in
  `enemyparam.csv`. *hypothesis*: quarter hearts, so 16 = 4 hearts.
- **Knockback**: from the frame after the hit, **1.5 px/frame** along the direction away from the source (any angle:
  (−1.174, 0.934), (−1.360, −0.633)), with a **hop**: z rises by 3.0 on the first frame, the vertical speed dropping
  0.25/frame (peak 19.5 px), and state 15 lasts until he lands: **25 frames**, 37.5 px. Walls stop it as they stop
  walking. Idle the frame after landing.
- Sprites: the knockback block, k = **167 right, 171 left, 175 down, 179 up**: k ×4, k+1 ×4, k+2 ×4, k+3 to the end
  (facing up; the blinking hides some frames, so the later durations are inferred).
- **Invincibility: 60 frames** (+0x464 set to 60 on the hit frame, −1 per frame). The sprite is replaced by the blank
  frame **289** while the counter is ≤ 55 and (counter mod 4) is 2 or 3: 5 frames shown, then 2 hidden / 2 shown, through
  the knockback and after it.
- His own bomb's blast (and the formation's own Fire Rod and Roc's Feather) knocked Link back with **0 damage**:
  **0.75 px/frame**, hop from 4.0 (peak 34 px), **33 frames**, same sprites and 60 invincibility frames. So the knockback
  speed and hop depend on the attack (*hypothesis*: on the attacker's `enemyparam` stats).

**Items** (A button; the item is +0xC10 in the Link actor, written through the tracer; level +0xC14 = 1)
- IDs: 0 none, 1 Pegasus Boots (state 57, one frame: no dash in formation), 2 lamp (state 72: 870 ×2, 871 ×4, 870 ×3
  facing down), 3 boomerang, 4 bow, 5 Magic Hammer (state 60), 6 Fire Rod (state 68), 7 Roc's Feather (state 70, 257–264
  then 257; 46 frames: the jump), 8 bombs, 9 shovel (state 71), 10 slingshot, 11 the Four Sword. Items 1, 2, 7 were first
  guessed from the animations; main.dol settles them: an item on the ground (`LSTI`) draws `enemy_both2` 64 + item (65
  boots, 66 lantern, 71 Roc's Feather, 75 the Four Sword), and the light radius code (0x802580E0) gives item 2 its lantern
  light. See "Battle constants from main.dol".
- **Bow** (state 58, 14 frames): b ×3, w ×4, b+2 ×3, b+3 ×4 with b = 319 right, 323 left, 327 down, 331 up and w = 335 +
  3 × direction (the bowWalk block). The arrow (`ARRW`) appears on the 7th frame of the state at Link + (0, +5) facing
  down, (−5, −4) facing left, flies **5 px/frame** straight, with no range limit seen (475 px across a room), sticks in the
  wall it hits for 35 frames, then disappears.
- **Boomerang** (state 61, 17 frames facing down: 355 ×2, 356 ×2, 357 ×2, 358 ×11; c = 347 + 4 × direction): appears on
  the 7th frame, 6 px in front; flies **6 px/frame** for 4 frames, slows by 0.2/frame to 1.8, then × 0.9 per frame while
  ≥ 1, stops for a frame (about **105 px** out), and flies back to Link at **5.8 px/frame**, homing, until caught.
- **Slingshot** (state 59, 14 frames: s ×3, w ×4, s+2 ×3, s+3 ×4; down s = 750, w = 764): one seed (`PCDM`) on the 7th
  frame at Link + (0, +5), z ≈ 1, **5 px/frame**, rising at ~1.0 px/frame falling 0.1/frame² (lands after 19 frames, 95 px),
  one bounce at 2.5 px/frame (vertical 1.2, 0.3/frame², 8 frames), then gone. Level 2 also fired one seed; the battle's
  three-seed shot wasn't reproduced.
- **Bombs**: A places a bomb (`HBMB`; Link's state and sprite don't change) **13 px in front** (not on a damaging pit,
  0x0e). **At most 2** at a time (+0xB30/+0xB34 hold their handles, −1 = free). **Fuse 300 frames** (+0x238 in the bomb
  counts 299 → 0, lifted or not), then the explosion lasts **32 frames** and the bomb is removed. On the first explosion
  frame the bomb's box grows from ±7 to **±16 px** (a 32 × 32 square): overlapping bushes and grass change (above) and
  Links in it are hit (knockback above). Bombs can be lifted and thrown like bushes.
- Damage values in `enemyparam.csv` (`atcp`) that fit the one measured hit: HBMB (bomb) 4, EXPL 1, THCL ("hit box of a
  thrown player") 2, TUBO / STON / CRTL 2, GRAS 1, FLME / BLZE / FIRE 2, BEEE 2, SLR1 2. What the actors actually pass
  (some override their atcp: FLME 4, BLZ2 1, bees 1) is in "Battle constants from main.dol".

**Not measured here**: Links lifting and throwing each other (needs free Links: battle or multiplayer, i.e. GBAs), how a
held Link escapes, sword-on-Link knockback, thrown-Link flight, the battle items from orbs (`CRGN`/`CRTL`), bombs in
the arena (`HBMB` params 0x101), fire spreading in detail, drowning (a teleport into room 2 was undone by the game with
60 invincibility frames, a respawn).

## What the Shadow Battle sim uses (packages/sim)
The measurements above are the adventure-mode leader's; the battle sim applies them to every Link, and the rows marked
"battle traced" or "measured in battle" were checked in Shadow Battle itself ("Battle mode in Dolphin" and the battle
measurements below). Everything not listed is `TODO(measure)` in the code.

| Sim | Value | Source |
|---|---|---|
| carry.ts `LIFT_REACH`, `LIFT_TICKS`, `loadPose` | 16 px; 24 ticks from P+1 (moveTick −1 on P); the load 16 px in front z 0 → 12 px z 8 → on the head z 16 → carried z 18 + the walk bob | measured (bush, bomb) |
| `stepCarry` "carry" | walking speed from the first input tick | measured |
| `THROW_TICKS`, `THROW_RELEASE_TICK`, throw path | 24 ticks, released on P+11 from z 20 | measured |
| `THROW_SPEED`, `THROW_GRAVITY` | 1024, 26 (0.1 px/tick² rounded; lands on the same tick: 20, 80 px) | measured (bush); pots and orbs assumed alike; a Link flies otherwise (`LINK_FLIGHT`, below) |
| `BOMB_THROW_SPEED`, `BOMB_THROW_GRAVITY`, `BOMB_BOUNCE` | 1536, 38 (16 ticks, 96 px); bounce 461 along, 768 up, 256 gravity, 7 ticks | measured |
| `WALL_PROBE` | thrown things stop at walls with a ±4 px box | measured (bush) |
| slam (`SLAM`, `loadPose` "slam") | 22 ticks; the load down 16 px in front from its 10th tick; a held Link slammed onto another stuns him (90 ticks, no damage) on its 9th | measured facing up; a Link on a Link traced in battle |
| roll.ts | decided on P+2, 21 ticks from P+3, 512 along the facing + 256 along the stick (181 diagonal), stops at walls and plays out; else the empty lift (21 ticks); walks on at once with the stick held along; into a Link only the Links' separation | measured; battle traced |
| combat.ts `KNOCK_DEFAULT`, `KNOCKBACK_GRAVITY`, `HURT_TICKS` | 384 away from the source at any angle, hop 768, gravity 64: 25 ticks until landing | measured (Octorok rock); traced for every sword hit on a Link up to 4 damage |
| `KNOCK_HARD`, `KNOCK_BOMB`, `KNOCK_SLOW` | 384, hop 1024 (above 4 damage: a level-2 lunge's 5); 256, hop 1024 (another Link's bomb); 192, hop 1024: 33 ticks (a thrown Link hitting a third) | traced in battle; the own bomb's 0.75 in the adventure |
| combat.ts `SWORD_DAMAGE`, `LUNGE_DAMAGE`, `SPIN_DAMAGE`, `CHARGE_DAMAGE`; attacks.ts | 2, 4, 4, 1 (half the power 4 / 8 / 8 / 2, + 2 power at sword level 2); the two boxes per direction, when they're live | traced in battle ("Battle measurements: combat") |
| `INVINCIBLE_TICKS`, `RESPAWN_INVINCIBLE_TICKS`, `fighterVisible` | 60 after a hit, 180 after a pit; hidden while (mod 4) ≥ 2 but for the first 5 ticks | measured; battle traced |
| combat.ts shield, clash, pushes | blocks by facing; 2 px/tick along the line, × 0.9 (× 0.95 above 2), zero under 0.2; sword boxes meeting = a clash, a 15-tick tink; overlapping Links step 1 px apart | traced in battle |
| combat.ts pits, `PIT_DAMAGE`, `HURTBOX` | the anchor over the pit, a 58-tick fall and a 64-tick jump back to 7 px off the edge, 2 life; bodies ±7 px | traced in battle |
| carry.ts held Links, `LINK_FLIGHT`, `ESCAPE_PRESSES` | held 2 px higher, no time limit, free on the 17th direction press; thrown or free: 3.3 px/tick from z 18, gravity 0.25, lands unhurt | traced in battle |
| projectiles.ts on Links | quick arrow 1 life, a drawn one 2 and 180 invincible, the Link carried 13 ticks (combat.ts `pinFighter`); quick seed: a 90-tick stun, then 60 invincible, a drawn one 1 with the sword's knockback; boomerang: its ±12 box hooks, the Link dragged 6 px/tick toward it until it's caught | traced in battle ("Items, levels and the Four Sword") |
| items.ts drawing, levels | the bow and slingshot pose held while the button is, walking at 1.125 px/tick; drawn at 48 on a counter of 1 a tick from the pose's 7th (bow level 2: 2); bow slots 1 / 2 by level, slingshot 3, its level-2 drawn triple shot; boomerang level 2 +3 px/tick; bomb level 2 ±32 blast; generator items level 2 one time in five; the Four Sword = sword level 2 | traced in battle |
| orbs.ts taking, drops; cucco.ts, epona.ts | items taken with Action (45 ticks, 60 invincible), popping up and pushed off Links; orbs dropping and bouncing; an orb's cucco (4 life there and back, up to 16) and carrot (Epona: 56-tick mount, a 19-tick gallop round, 360 ticks) | traced in battle |
| bombs.ts `BOMB_FUSE`, `EXPLOSION_TICKS`, `BLAST_HALF`, items.ts `BOMB_PLACE_DISTANCE`, `MAX_BOMBS` | 301 (the blast on P+301, hurting from P+302), 32, ±16 px (±32 at level 2), 13 px, 2 | measured; battle traced |
| projectiles.ts arrows | 1280 px/tick, no range, stuck 35 ticks; bow pose 14 ticks, released on its 7th | measured |
| boomerang | pose 17 ticks, out on the 7th 6 px ahead (shown there its first tick), 1536 for 4 ticks, −51/tick to 461, ×0.9 while ≥ 256, a tick still, back at 1485 homing, caught within 16 px | measured (goes ~115 px out); battle traced |
| slingshot seeds | 1280 px/tick, a quick one down after 19 ticks, a drawn one on to the wall; pose 14 ticks; one seed (three: a level-2 drawn shot) | measured; battle traced |
| damages | bomb 4, thrown Link / pot / orb 2, bush 1, eternal flames 1, fire-pit jets 4, fire bars 2, bees 1, soldiers 2 | what main.dol's attack calls pass (atcp, or a value set in the actor's init); Octorok atcp 2 = 2 life measured |
| orbs.ts | generator kinds (1 an orb, 2 an item on the ground from its mask, 3 a carrot), first after 450 (kind 2: 150) counting ticks, then 600 / 300 from the tick after it's gone; orbs hold carrot, cucco or bombchus (the multiplayer roulette); untouched orbs lie 899 ticks, items on the ground 599 | measured in every TV arena ("Battle measurements: arenas, orbs and camera") |
| switches.ts, hazards.ts, panels.ts | the switch network and what it wires: floor switches (stand on them; kinds, 384-tick holds), pots on switches, the fire pit's jets (ease 1/10 per tick, burn past 0.7, 90 × 20 px), eternal flames on switch 14, the trick floor (8 / 40 / 41 ticks, ±20 px), magic circles (grow 1/50 per tick), orb generators (gated by their switch), fire bars (64 units/tick, 8 balls from 48 px, ±8 px), colored panels (120 ticks), GEN3 spawns, crystals (384 ticks, 25 lockout) | read from main.dol (docs/formats/battle-arenas.md "Switches"); measured: the jets, the trick floor, the fire bars, the gated generators' switch timing (RNSW, WTSW, CKSW) |
| hazards.ts soldiers | a 21-tick wind-up, chases of 100–243 ticks standing their first 21, aimed every 13 ticks (up to 90° off) at 268 (1.047 px/tick), easing 3/10 a tick, 30-tick stops | measured (Hyrule Castle) |
| bombs.ts `BLAST_KNOCK`, `BOMB_REGROW_TICKS` | 256, hop 1024 (hit type 5, 4 damage); 60 ticks to a new socket bomb | measured (The Field's socket bomb) |
| timeup.ts | Vaati flies in (2 px/tick, 60 ticks), loops, leaves; everyone out 454 ticks after the time-out | measured (the Vaati rule forced on) |
| apps/battle camera.ts | the camera's box, holds, margins and zoom | measured |
| siderooms.ts side view (`stepSideView`, `sideViewFall`, `fallEntities`, gates) | falling 4 px/tick (walked or knocked off a ledge); Up/Down climb ladders at walking speed and otherwise only turn; things fall 0.15 px/tick²; a throw's height becomes screen y; the gates (style 21) on a fresh Up/Down press, 1/32 px a tick, 40 + 30 + 40 ticks | traced on the Tower of Winds ("Side rooms"); fixture cases windsGate, windsHit, windsKnockOff, windsLadder, windsLadderDown |
| bombchus.ts | 2.5 px/tick, fuse 300, harmless 30 (side view 10), 2 damage (sword knockback) on touch and in a 32-tick ±16 px blast; bouncing top-down, crawling in side view; GEN3 spawns and the orbs' roulette | read from main.dol; the Tower of Flames' eight traced |
| giantbomb.ts | BBSL's states and timings, BBMB's growth, flight (3.0 up, 0.2/tick²), squash, 600-tick fuse (hits −60), the TV blast | read from main.dol; the 1021-tick sequence traced |

Placeholders (`TODO(measure)`), all battle-only: the bees' wake rule (their flight, Epona's trampling and the cucco's
choice are traced since: "Shadow Battle's open items, traced"; the soldiers' sight, patrol and stun, the bomb's flash,
how long a blast hurts and the chain: "Bombs, the eternal flames and the soldiers, traced"), the sheltering rule at time-out, the countdown and the round's end (measured below, not
applied: battle.ts). What main.dol says about each, and what a Dolphin
trace should watch to confirm it, is the next section.

## Battle measurements: combat
Link against Link in Shadow Battle, traced from the round-start savestates (`field-2p`, `field-3p`, `flames-2p`) with a
private copy of the battle user folder and GDB port 55041. Every trace below was replayed through the sim: the 25 in
`packages/sim/src/dolphin-battle-traces.json` (`fixture.ts --battle`) are checked frame by frame by
`battle-measured.test.ts` (positions within 0.015 px for most, life and invincibility exact, sprites exact but for the
differences listed there). Frames are records (loop heads); the GBA keys of record *f* are what update *f* used.

**Setup.** `trace.ts --link <off>:<len>` records Link fields each frame (here +0x30C, +0x3F0, +0x458, +0x4A0…+0x4DF,
+0x5EC, +0x35C, +0xBF4, +0x11AC, +0xC10, +0xD64, +0x1240). Positions are poked with `--write <frame>:<actor + 8>:<x y
floats>`, on frame 12 (the Link actors are at 0x8117521C, 0x81176AE8, 0x811783B4, 0x81268FD0 in every field state):
a poke before the round starts is half undone by the game at frame 10, and a poke onto another Link's body is resolved
as a push. The open middle of The Field (x 210–300, y 190–260) has no obstacles; around P2's start there are corners
the sim's collision lacks. Items are poked into +0xC10 (level +0xC14), the sword level into +0xC18, life into +0xBFC.

**The sword on other Links** (traces `battle-hit`, `hit-swing` `10 idle; 59 p1:right; 4 p1:right+B`, `hit-lunge`,
`hit-spin` `…; 1 p1:down; 10 idle; 60 p1:B`, `hit-charge` `10 idle; 30 p1:right; 80 p1:right+B`, `attacks-free`,
`attacks-dirs`):
- The game doesn't test the blade: each attack stores **two boxes** at Link +0x4A0 (x0 y0 x1 y1 floats, around the
  anchor): facing right **(−4, −8, 16, 8) and (16, −8, 32, 8)**, the other facings rotated ((−8, −4, 8, 16) and
  (−8, 16, 8, 32) down); diagonals (spin) two squares, down-right (0, 0, 16, 16) and (8, 8, 24, 24). A Link is hit
  when a live box meets his **body box, ±7 px** (+0x4C0; +0x4D0 is a ±15 px box). The boxes are set before the
  lunge's move (they trail it 4 px) and after the charge walk.
- Live (+0x458 byte 0 = 1): swing and stab all 8 frames; lunge frames 6–14 of 31 (the hit on frame 6); spin all 26
  frames; charging, every frame (power 2).
- Damage = power / 2 (+0xBF4): swing, stab **2**; lunge **4**; charged spin **4**; the sword held out while charging
  **1**, and that hit ends the charge (one more charge-walk frame, a standing frame, then walking). **+0xC18 = 2**
  (sword level 2) makes a stab 3 and a lunge 5.
- Knockback: along attacker → victim at 1.5 px/frame with the 3.0 hop (25 frames) for 1–4 damage, the **4.0 hop**
  for the level-2 lunge's 5 (`hit-lunge-lv2`), invincibility 60, blink hidden while ≤ 55 and (mod 4) ≥ 2. The hit
  frame still shows the victim's old sprite; the knockback frames k ×4, k+1 ×4, k+2 ×4, k+3 from the next.
- The spin's boxes turn with it: with F the facing's direction (0 right … 7 up-right, clockwise), frames 1–7 point
  F − 3, frame 8 F − 2, 9 F − 1, 10 F, then one step every 2 frames (11–12 F + 1 … 25–26 F + 8), traced for all four
  facings. +0x3F0 holds the attack's 4-way direction (diagonals count as up or down): that is what the shield test uses.
- The lunge hops (z 1.0, 1.75, 2.25, 2.5, 2.5, 2.25, 1.75, 1.0, 0 over its first 9 frames).

**The shield** (`shield` `10 idle; 2 p2:left; 8 idle; 60 p1:right; 10 idle; 4 p1:B`, `sh-swing`, `sh-spin`, `sh-lunge`,
`sh-charge`, `sh-offset`, `sh-facing3`):
- A block happens when the attack's box meets the body of a Link whose **facing is opposite to the attack's
  direction** (+0x3F0): a Link at (+14.5, +14.9) facing left blocks a stab to the right. Swings, stabs, lunges, the
  charging sword and **spins** are all blocked (the spin on the frame its box points at him). The blocker isn't
  attacking; nothing changes for him but a counter (+0x3F4: 5 on each block frame, then 4…0).
- Both Links get a **push** (+0x35C, +0x360) of **2.0 px/frame apart along the line between them** (3D: during the
  lunge's hop it's 1.994), set again on **every frame the box still meets the body**: 5 frames for a stab from 22 px (the
  Links part 4 px a frame), 4 for a swing from 27 px, 7 for a lunge (still moving 4 px a frame), 1 for a charge or a
  spin. Then each frame: position += push, push × 0.9 (× 0.95 above 2.0), zeroed under 0.2 px. A stab's block moves
  each Link 26.0 px.
- While pushed a Link doesn't walk (a charging Link pushed back by 2.0 walks again on the frame the push drops to 0),
  but his walk or charge-walk animation runs on. A spinning Link isn't moved by his push (it decays), and moves by what
  is left on the frame the spin ends.

**Clash** (`clash` `10 idle; 1 p1:right p2:left; 9 idle; 4 p1:B p2:B`, `clash-late`): two stabs face to face 24 px
apart, or a stab started into a live one: no damage; both go to state 55 (the held-sword-in-a-wall pose, 273–276
right, 277–280 left, 2, 4, 4, 5 frames) for 15 frames, pushed 2.0 px/frame apart once, then idle.

**Links push each other** (`bump` `14 idle; 60 p1:right`, `bump-v`, `bump-l`, `roll-into`): at the start of a frame,
while two Links' ±7 px bodies overlap (≤ 14 px apart on both axes), each steps **1 px** away from the other along the
line between them, again until they don't (so 2 px each from 12 px apart); a component across the line under 0.1 px
becomes 0.1 (the lower player index +, the other −). Not between Links more than ~16 px apart in height (a knocked-back
Link 17.5 px up passed over one; at 14.5 px he was pushed 3 px). A pushed idle Link shows walk frames on alternate
frames. **A roll into a Link** does nothing else: no damage, no stun; the roll goes on slowed and pushes him along. A
roll ending with the stick still held along it walks on at once (no idle frame).

**Lifting and throwing a Link** (`lift-hold` 500 frames held, `lift-throw`, `throw3` 3 players, `escape-A` A mashed,
`escape-LR` left/right each frame, `escape-slow` every 4 frames, `escape-up`, `slam3b`):
- R 16 px in front of a Link lifts him like a bush: the lift (state 17) 24 frames, carrying (18) from P+25. The held Link
  (state 25) rides **2 px higher and 2 px lower on the ground** than a load: z 2 at +16, 10 at +12, 18 on the head, **20
  carried**; the throw's path 17, 19, 22. His sprites: 662, 663, 662, 664, 665, 664, 6 frames each, a frame on at once
  on each direction press.
- **No time limit** (500 frames held). He's let go on his **17th new press of a direction** (A presses don't count;
  one to four frames apart alike); the carrier stands on the next frame.
- **Thrown** (R while carrying: released on P+11 as for a bush) or **wriggling free** (from the next frame), he hops
  from the carrier's position along the **carrier's facing** at **3.3 px/frame**, from **z 18** with no vertical speed,
  falling 0.25 px/frame²: down on the 13th frame, **42.9 px** out, and stands (facing the way he flew, in control)
  the frame after. **No damage, no invincibility** on landing (2 and 3 players).
- A thrown Link meeting a third one: **2 damage, 0.75 px/frame with the 4.0 hop** (33 frames) on the third (hit at
  14.5 px, not at 17.8: a ±8 px box against the body), and flies on to land where he would have.
- **Sword while carrying a Link** (the slam, state 21, 22 frames): the held Link goes 6 px behind at z 17 (7 frames),
  over the head at 19, down 16 px in front at 10 on the 9th frame, 4 for 8 frames, 6 for 4, 10, then back up. A Link
  where he comes down is **stunned** (state 12, no damage); the held Link is unhurt.

**Pits** (`flames-2p`: `pit2` walking left into the middle hole, `pit-v` up into it, `pit-die` with life 2; the outer
edge by P1's start is a wall: the rim, collision type 0x0C, "Items, levels and the Four Sword"):
- The anchor itself is the probe (from below he falls in at y 207.5, not at 209). He's placed **8 px inside the edge**
  (x 271.5 → 264, y 207.5 → 200) and keeps his walking pose that frame and the next.
- Falling (state 50): 183 ×8, 184 ×8, 185 ×8, 186 ×6, 187 ×6, 188 ×6, 187 ×6, 186 ×10 (58 frames); then he **jumps
  back out** (64 frames: z rises 8.0 a frame falling 0.25 per frame, peak 132, drawn with the knockback frames) moving
  linearly onto the edge he came from, **7 px outside** it (264 → 279, 200 → 215); on the landing frame **2 damage**
  (not a heart) and **180 invincibility** (179 on that frame, blinking from 175). 125 frames from falling in to landing.
- With 2 life he jumps out the same and **dies on the edge** when he lands (state 51: 189–192 ×6 three times, 193 ×4,
  then lying on 195 until the round ends).

**Shots and bombs on Links** (items poked into P1, P2 60 px away: `it-bow-quick`, `it-bow-drawn`, `it-sling-quick`,
`it-sling-drawn`, `it-boomerang`, `it-bomb`):
- Arrows and seeds appear at their spawn point and fly from the next frame.
- **Quick arrow**: 1 damage, the sword's knockback (1.5, 3.0) along the line from the arrow (hit 5 px behind and 4 px
  above his anchor), 60 invincibility. **Drawn arrow** (A held 60 frames): 2 damage, **180** invincibility, no hop:
  state 67, carried along by the arrow at 5 px/frame for 13 frames.
- **Quick seed**: no damage; **stunned** (state 12) for **90 frames** (standing poses down, left, up, right, 6 frames
  each, the facing kept), then **60 invincibility**, blinking at once. The seed hits from **15 px** away (±8 px).
  **Drawn seed**: 1 damage with the sword's knockback.
- **Boomerang**: no damage, no invincibility: **hooked** (state 66) and dragged toward the thrower at **6 px/frame**
  until 18 px from him, spinning a quarter turn every 2 frames; he's let go facing the way the spin left him.
- **Another Link's bomb** (placed 9 px from P2): **4 damage, 1.0 px/frame, 4.0 hop** (33 frames), 60 invincibility; the
  blast hurt 301 frames after the A press (applied since: bombs.ts `BOMB_FUSE`, `blastStart`).
- The item +0xC10 = 11 (the Four Sword) doesn't change the sword's power (a stab still 2); its effect needs a real
  pickup (done since: "Items, levels and the Four Sword").
- These item traces ran at **item level 2**: the round states hold +0xC14 = 2 with no item, and only +0xC10 was poked.
  The quick shots and the boomerang's hook don't depend on it; the drawn arrow (A held 60 frames) does (below).

**Hearts.** Every Link starts with 12 life (3 hearts). The settings (START on the Select Area screen: Back, Handicap,
Rules) are on the GBAs' screens, not the TV; the Rules are Vaati, Powerful Items, Status Display, and three presses
on the Handicap screen left the round's life at 12. The sim defaults to 3 hearts and keeps 2, 4 and 6 as options.
Every Link's maximum (+0xBF8) is **16** in these rounds: a cucco's stolen heart takes its thrower from 12 to 16 (below).

## Items, levels and the Four Sword
Traced 2026-10-03 from `ref/save-battle-field-2p.sav` (a copy of the battle user folder, `ref/dolphin-user-fidelity`,
GDB port 55133; traces in `out/traces/fid/`, not committed): the item and its level poked into P1 (+0xC10, +0xC14 at
0x81175E2C / 0x81175E30), P2 moved (+8 at 0x81176AF0), `trace.ts --link c10:c --link 3fc:4` (item, level, sword
level; the draw counter) and `actor-trace.ts` for ARRW, PCDM, the boomerang (vtable 0x804A0738), HBMB, LSTI, CRTL,
NIWA, NNJN. Replayed by the sim: 10 new cases in `dolphin-battle-traces.json` (bowDrawn, bowDrawnL1, bowQuickL1,
bowWalk, slingDrawn, slingDrawn3, boomerangL2, bomb, bombL2, flamesRim), the rest in `items.test.ts` / `orbs.test.ts`.
Frames are trace records; P+1 is the frame a press is seen.

**Drawing the bow and the slingshot.** Holding A, the pose (bow state 58, slingshot 59) shows b ×3, then holds its
second frame w (bow 335, slingshot 758 facing right) while A stays held; the shot leaves on the frame A is seen up (but
not before the pose's 7th frame), then b+2 ×3, b+3 ×4, and the Link is free. A quick press is the old 14-frame pose.
While drawing the Link walks at **1.125 px/frame** with his facing kept (diagonals 0.7955 a side), frames w, w+1, w,
w+2 for 4, 4, 2, 4 frames. The draw counter (+0x3FC byte) counts from the pose's 7th frame, **1 a frame, 2 for the bow
at level 2** (0x8025C904: level ≥ 2 → +2), capped at 48; a shot that leaves with it at 48 is **drawn** (main.dol's
kind 0; a quick one is kind 1, params | 0x100): A seen held through pose frame 29 (bow, level 2) or 53 (bow level 1,
slingshot either level), not 28 / 52.
- **Drawn arrow**: 2 life, 180 invincibility (blinking from 175), no hop: the Link (state 67) is moved 15/16 of the
  way onto the arrow the frame after the hit, then onto it every frame (the arrow's position before it moves on) for
  13 frames, facing the shooter (the first frame shows the knockback frame of the arrow's way, then his own facing's,
  8 frames a frame); one more frame still in 67 and 0.3 px off along both axes, then free. The arrow flies on.
- **Drawn seed**: 1 life with the sword's knockback (1.5, hop 3.0) away from the seed; drawn seeds fly at 5 px/frame on
  the ground (z 0) until a wall, then bounce back 1.5 px/frame with a hop and vanish (a quick seed arcs: z from 1 up
  0.92 falling 0.1 a frame², down after 19 frames).
- **Slots**: the bow has 2 arrow slots, the second only at level 2 (0x8025CE30); with no free slot the pose plays
  empty. The slingshot has 3: a quick or level-1 shot takes the first free one; a drawn shot at level 2 with all three
  free fires **three seeds**: the middle one along the facing and two at 45° (3.5 px/frame on both axes), from 5 px
  behind the middle one's start (traced facing right: (205, 276), (203.5, 279.5), (203.5, 272.5) for P1 at (200, 280)).

**Item levels** (0x802415CC: +0xC14 when an item is held; its callers by Link state: 20 (the jump, Roc's Cape at 2),
57 (0x8025DACC: the lamp or the Fire Rod), 58 bow, 59 slingshot, 60 hammer, 61 (0x8025B22C), 70, 72):
- **Boomerang** level 2: 9 px/frame out for 4 frames (appearing 9 px out, then 18, 27…), then −0.2 a frame to 1.8 and
  ×0.9 as level 1 (about 234 px), back at 8.8 px/frame (5.8 + 3).
- **Bombs** level 2: the blast reaches a Link **38 px** from the bomb, not 39 (level 1: 22, not 23): a ±32 px box
  against the ±7 body (±16 at level 1); fuse, count (2) and damage (4) as level 1.
- Generator items: level 2 one time in five (CRGN 0x80129444); the Field's first item was bombs L2 in every run.
- The HUD's L2 badge (`le201-203`) shows over a level-2 item (Dolphin frames).

**The Four Sword** (the Field's first item poked to 11 in the LSTI, +0x238, then taken): Link +0xC10 stays as it was
and **+0xC18 (the sword level) becomes 2**, still 2 1100 frames later: +2 power (a stab 3, a lunge 5, as traced with
+0xC18 poked). No beam: a level-2 swing at full life shows a white blade (frame dumps) and no projectile. Applied:
orbs.ts `giveItem` (the round's `swordLevel`).

**Taking an item off the ground**: R facing it 13 px away; the LSTI is gone the frame after; the Link stands 9 frames,
then the pose facing the camera (234 ×4, 235, 236 ×32), gets the item **45 frames after the press** with **60
invincibility frames blinking at once**, and walks again two frames later (a direction held through the pose turns him
at once). Input is ignored meanwhile. Not by touch: a Link standing on the item never gets it.
- An item pops up from z 13 at 2.7 px/frame, 0.3 px/frame² down, landing on its 23rd frame (the Field); a Link on its
  spot pushes it off his body: 7 px at once, then 4, 2, 1 once it's under ~4 px up, ending 14 px from his anchor.
- An orb appears 10 px up and drops 0.1 px/frame², reaching −0.5 on its 14th frame; then it bounces (0.82 px/frame up,
  the same gravity) drifting 0.41 px/frame in some direction (−0.40, −0.11 here: about 6 px in all) and lies still on
  its 29th frame. Its lifetime counts from its first frame meanwhile.

**An orb's contents** (the Field's orb lifted, the roulette run, thrown up; content poked through CRTL +0x294 and the
entry +0x2B4 after the lift — the poke of +0x294 alone gave a cucco twice, the entry decides):
- **Cucco** (NIWA kind 2, at the orb's break): state 4 chases the rival, flying on the throw's way (up) and turning
  toward him: its heading converges by half its angle a frame toward its goal of the moment (a goal that jumps every
  few frames: not modelled, the sim steers straight at him), its speed 1.72, 2.10, 2.36, 2.55 … → 3.0 px/frame (0.3 of
  the gap a frame). On him (6 px off): **4 life** (12 → 8), the sword's knockback (1.5, hop 3.0); +0x298 = 4 (what it
  carries back). State 9 holds there, slowing ×0.7 a frame, 50 frames; then it flies straight back at up to 3 px/frame
  and on reaching the thrower he gets the 4 (**12 → 16**: up to the maximum 16, past his start); it waits 24 px over him
  (state 10) 28 frames and is gone.
- **Carrot** (NNJN, its counter +0x24C from 1024): it lies where the orb broke; R facing it 15.5 px away did an empty
  lift, walking into it (11 px off) put the Link on Epona at once: state 11, a mount of 56 frames (850-853, 7 each,
  twice), then **Epona gallops on and on** the way he faces (with no input too: in the house she paced from wall to
  wall): 3.0 px/frame ×7, 2.8, 2.6, 2.4, 2.2, 2.0 ×8, round again (frames right 826/827/828, left 829-831, down
  832-834, up 835-837); the stick turns her at once; into a wall or a tree she turns back and stands ~16 frames
  (jittering); she took him through the house's door. **360 frames** from the touch, then he stands. Invincibility
  +0x464 stayed 0; trampling and hits on the rider: traced since ("Shadow Battle's open items, traced").

**Bombs** (a Link's, placed 13 px in front): the HBMB holds +0x238 = 299 on the press's frame P+1, counts to 0, goes
off (state 5) on P+301 and hurts on **P+302**, for the bomber too (1.0 px/frame, hop 4.0). Applied: bombs.ts
`BOMB_FUSE` 301 and a bomb's explosion hurting from its second tick (`blastStart`).

**The boomerang's hook** (0x8025AED0, state 66: +0x11F8 = the boomerang): the hooked Link moves **6 px/frame toward the
boomerang** (not its thrower) and is let go once it's gone (caught), standing one more frame in state 66. The
boomerang hooks a Link its **±12 px** box meets (10.6 and 9.2 px short of his body: hooked; 12.2: not), turns straight
back by the speed it had (−4.4 at level 1, −8.2 at level 2) and homes at **5.8 px/frame at either level**; it's caught
once its step ends within 16 px of the thrower (12.8 and 14.4 caught, 18.6 not), shown on him that frame and gone the
next. On its own it turns at the end of its range after a step under 1 px/frame and a frame still. The Link ends 18 px
from a thrower 60 px away and 24 px from one 78 px away (either level).

**The Tower of Flames' rim**: walking right from P1's start the Link stops with his side on the rim tile 0x85
(collision type 0x0C) at x 409, and at y 233 walking down; pressing on, he goes into the push state (state 13: no
movement, a diagonal slides no more) and his x jitters by 0.4 px. Type 0x0C rings the tower's floor (32 tiles); the
Dark World tower (room 6) has none, The Field one (0x59 at (128, 240)). Applied: arena.ts `RIM` (solid on the arenas'
TV only; the type is all over the adventure's stages too, untested there).

**Hyrule Castle's soldiers** (`castle-2p`, P1 moved next to the soldier at (128, 128), stabbing): one stab killed it
(+0x108 life 1 → 0, state 4 for 38 frames, then gone), and it never came back at home (1077 frames); new SLR1s came
from the castle's GEN3 spawners through its switch network: (112, 224) 27 frames after the kill, (256, 112) on 483,
(256, 336) on 916. GEN3 kind k spawns table 0x8046F398[k] with params 0x8046F450[k]: 0x02 SLR1 0x00100000, 0x03
SLR1 2, 0x1A SLR1 0x102, 0x1B SLR1 0x01000004, 0x22 SLR1 0, 0x24 SLR1 6; SLR1 kind = params & 7 with life from
0x8049FA40 (12, 12, 1, 12, 16, 8, 20): the (256, 112) one (GEN3 0x1B, kind 4) had **16** life. Applied: no home
respawn (strike.ts). Since applied (below, "Shadow Battle's open items, traced"): the spawned kinds' life and the
sword's power on them; the trick floor's respawn rule, The Field's corner by P2's start, the bees' flight, things
through doors.

## Bombs, the eternal flames and the soldiers, traced
Traced 2026-10-09 (`trace.ts`, `actor-trace.ts`, GDB port 55083; the ports from the states' .json).

**The bomb's flash** (`field-2p`, P1's item poked to bombs, two bombs placed; `actor-trace --ids HBMB --fields
HBMB=230,234,238,24c,254,…`): with the fuse +0x238 under 100 a counter +0x254 steps 1 a frame (2 under 50) and the
flash flag +0x24C flips each time it wraps at 8 (HBMB 0x8014C79C): set on fuse 91–84, 75–68, 59–52, then every 4
frames from 46 (46–43, 38–35 … 6–3); the same for both bombs. Applied: bombs.ts `bombFlashing` (the renderer's sprite
233), replacing a 60-tick flash every 4.

**How long a blast hurts**: the blast (state 5) steps +0x24C through frames of 4, 4, 2, 2, 4, 4, 4, 4, 4 (+0x234 from
the table at 0x8049F760; 32 in all) and attacks (0x801F2B7C, hit type 5) and sets things off (0x801F2B20) during the
first four, its box ±16 px (±32 for kinds 8, 9). P2 walking left into a bomb's blast 22.5 px from it (blast on record
321): reaching it on record 333 he was hurt (`bombLate`, P+313), on 334 not (`bombLateMiss`): **12 hurting frames**,
records 322–333. Applied: bombs.ts `EXPLOSION_HURT_TICKS` 12 (was 8); both replayed in `battle-measured.test.ts`.

**The chain**: a second bomb 15.5, 17, 19.8 and 21.3 px from the first went off on the **same frame** as it (state 5 on
record 321 for both), in the first one's update (the caught bomb came later in the actor list; one earlier would go off
a frame later). The bomb's box is ±7 (±10 a socket's, ±3 once walked off); 21.3 px still caught means the blast's ±16
box meeting the bomb's, not the bomb's middle in the blast. Applied: bombs.ts (a bomb whose ±7, a socket's ±10, box
meets a blast goes off at once, from the blast's first tick through its hurting ones; `CHAIN_DELAY` 6 is gone).

**The eternal flames** (`flames-north-in`: P1 on the north room's switch, P2 poked next to the flame at (168, 264)):
walking right into it P2 was hurt at x 154 (his ±7 body against its ±8 box): **1 life, 0.75 px/frame away from the
flame, hop 4.0** (33 frames), 60 invincibility: hit type 7, as main.dol's reading (`FLAME_DAMAGE`, `FLAME_KNOCK`
stand). Standing inside one (at (160, 264)) he was hurt two frames after the switch word's bit 14 was set (bit seen on
record 64, hurt on 66). Applied: hazards.ts (a flame lights on the tick it sees its switch and burns from the next;
`siderooms.realdisc.test.ts`).

**The soldiers' stun** (`castle-2p`, the soldier at (128, 128) poked to 16 life, P1 poked beside it, a stab; actor
fields 230–244, 108, 98): life 16 → 12 and state 4 on the hit's frame, then knocked away from the attacker, 12.48,
9.73, 7.60, 5.92 … px a frame: **16 px/frame × 0.78 each frame** before the move (56.7 px in all; to the left it
stopped at the wall, x 104); state 4 for **25** frames, then state 5 (the wind-up, +0x23C 19 → 0) for 20, then the
chase (state 6). Applied: strike.ts `SOLDIER_STUN_TICKS` 25, `SOLDIER_STUN_SPEED` 16 px, `SOLDIER_STUN_DECAY` (was 12
ticks at 2 px), the knock along the true direction.

**The soldiers' patrol and sight** (read from main.dol, SLR1's state table 0x8049FCF8, and checked against the earlier
trace: "Battle measurements: arenas, orbs and camera"): every frame the update finds the nearest Link (0x801EEC98: its
distance, and its direction from the soldier as one of four, 0x801F681C). State 3 stands: 8 frames looking its way,
then +0x258 steps every 15 frames through the looks of table 0x8049FB78 (by facing right: right, up, right, down; left:
left, up, left, down; down: down, left, down, right; up: up, left, up, right), round 1 or 2 times (+0x25C = 1 +
⌊1.99 rand⌋: the traced 68- and 128-frame stands); then it turns 90° either way at random and walks (state 1) 50 +
⌊50 rand⌋ frames at +0x290 = 0.7 px/frame. It notices the nearest Link (state 4, then the wind-up) standing when he's
the way it looks and within **100 px**, walking when he's the way it walks within 1000 px (kinds 1–3; 100 for the
others): the traced 76 and 91 px at once, 197 px while patrolling. Applied: hazards.ts `patrol`, `soldierSees`
(`SOLDIER_SIGHT` 100, was a 128 px circle). Not modelled: state 1's turn-back when blocked (state 2, gated by a stage
flag), +0x280/+0x270 (an alerted soldier chases at once), state 7's rule after a chase (the sim's 128 px,
`SOLDIER_KEEP_SIGHT`), a soldier's facing at the start (here: down, standing).

## The Pegasus Boots
Traced 2026-10-10 from `ref/save-battle-field-2p.sav` (the battle user folder, GDB port 55177; traces in a local
scratch space, not committed): the boots poked into P1 on frame 12 (`--write 12:81175e2c:00000001`, level
0x81175E30 = 1 or 2), P1 moved there too (+8 at 0x81175224: (200, 216.7) or (256, 200)), the script idle to frame 13,
`--link c10:c` (and `--link b98:8` for the impact flags, `--raw 81255ed4:4` for the switches). Replayed by the sim: 7
cases in `dolphin-battle-traces.json` (bootsHit, bootsCrash, bootsSteer, bootsBlock, bootsJolt, bootsDown, bootsLeft),
the rules in `boots.test.ts`; applied in `packages/sim/src/boots.ts`.
- **They appear** in The Field (its item generator at (344, 152), CRGN mask 0x1182: bow, bombs, boots) and Hyrule
  Castle's side rooms (0x97E2); the item number is 1 (`LSTI` draws `enemy_both2` 65), the HUD's icon k = 5.
- **The press** (A, the item button) is an ordinary tick (he walks on); then state 57: 10 ticks standing on his walk
  frames at 2 ticks a frame (c = ticks since the press / 2: base + c), then the dash at **3 px/tick** along the facing
  for as long as A is held, on 197-200 (right), 201-204 (left), 205 206 207 208 205 209 210 211 (down), 212 213 214 215
  212 216 217 218 (up), indexed by c. A direction across the facing steers it 45° (**2.1 px** a tick on each axis), the
  facing kept; with A alone it goes on straight. Let go while dashing, he still moves on that tick and the next (the
  dash's pose), standing from the one after; let go in the charge, the tick plays out and the next is ordinary. Level 2
  is level 1 (speed, damage).
- **An attack** from the state's first tick to its last (+0x458 = 1 in its entry 0x8025E79C): the sword's two boxes for
  the facing, set before the tick's step (a Link 34.5 px ahead was hit, 37.5 not; 13.2 / 13.8 px aside hit, 15.3 /
  17.7 not), power 6: **3 life**, 1.5 px/tick with the 3.0 hop, 60 invincibility. A shield facing it blocks (the
  blocked Link pushed 2 px/tick as by a sword, again every tick of the contact); the dasher keeps dashing, his own push
  decaying unapplied until the dash is over, when it carries him back.
- **The crash** (state 65, entry 0x8025D7E4): when the middle of his leading side meets a wall (a corner only slides
  him round it, as walking does). From the next tick he's bounced back **2 px/tick** off his facing with a **4.0** hop
  (table 0x8046AFE0), the knockback frames (k ×4, k+1 ×4, k+2 ×4, k+3), 33 ticks to the ground (the landing tick in the
  pose); no damage. Its entry sets Link +0xB9C (one frame), asks for a quake (0x80134DE4) and an effect (0x802F601C).
- **The impact** (+0xB9C, read by 0x8026FCE0 with +0xB9A, the hammer's, and +0xB9D): crashing at (204.8, 263.3) set
  switch 1 (the `DOSN` at (144, 256), 61 px off; it stayed on) and woke the west tree's bees (BEEE at (160, 240), 50 px
  off), whose swarm stung him (1 life, the sword's knockback) 125 ticks later. `DOSN` and the bees' kind 0 take 80 px
  (6400 in main.dol). A Link standing **49.8 px** from a crash hopped on the spot (state 63: the 4.0 hop, 33 ticks, his
  standing pose; then state 12, below); 52.3 px and further didn't: the sim takes 50.
- **Read from main.dol since** (2026-10-11, `tools/dol`; not traced, TODO(measure); applied in `boots.ts`, `strike.ts`
  dashStrikes, `ONLINE_VERSION` 26):
  - *The dash on things.* The actors test a Link's attack through 0x8023B8E4 / 0x8023B9CC → 0x80274238 → 0x802738F0,
    which reads only +0x458 = 1 and the two boxes at +0x4A0 (the Link-on-Link pass 0x80273E7C uses the same test), and
    take 0x802721A8's power: +0xBF4, +2 when the sword level (+0xC18, 0x80241544) is 2 or more. The boots' entry sets
    +0xBF4 = 6 (0x8027221C(link, 6)) and +0x458 = 1, so the dash's trailing boxes break orbs and pots, cut bushes and hit
    soldiers and bees, power 6 (8 with the Four Sword), from the state's first tick. How the bush tiles read the boxes
    wasn't followed (the sim cuts the ones the boxes overlap, as for the sword).
  - *The level-2 jolt.* 0x8024BBB8 runs for each Link (not in state 63 or 12, not pounding, not in state 60) over the
    other Links with an impact (0x8023A51C → 0x8026FCE0: +0xB9A, +0xB9C or +0xB9D) on his screen: reach 50.0 (80.0
    when 0x8022B244, HAYA), ×2.0 when that Link's item level (0x8023725C → 0x802415CC: +0xC14 when +0xC10 holds an
    item) is 2 or more. So a crash with level-2 boots jolts within **100 px**.
  - *After the hop.* State 63's update (0x8028434C: the hop, −0.25 a tick down to −4.0) on landing goes to state 12
    when the Link's bit is in the game's playing-players mask (+0x82: 0x33, 0x77, 0xFF in battle) or he follows a
    leader (+0xD60 ≥ 0, 0x80240808), else to state 0. State 12 (entry 0x8027A0D4, update 0x80279FE8, exit 0x80279F94)
    is the seed's stun: the dizzy effect 1381 and `PEFF`, +0x458 = 0, **90 ticks** (120 playing alone), then 60
    invincible on its exit. In battle, then, a jolted Link lands dizzy for 90 ticks (`combat.ts` STUN_TICKS).

## The Magic Hammer and the Fire Rod (read from main.dol)
Read statically 2026-10-11 (`tools/dol`; nothing traced in Dolphin yet: every value is TODO(measure) in the sim);
applied in `packages/sim/src/hammer.ts`, `firerod.ts`, `itemframes.ts` (`ONLINE_VERSION` 25). Both appear only in
Hyrule Castle's side rooms (generator mask 0x97E2), items 5 and 6 (`LSTI` draws `enemy_both2` 69 and 70; the HUD's
icons k = 6, 7). The Link's state tables: entry 0x804A7628, update 0x804A74E0 (by state number).
- **The hammer** (state 60, update 0x8025B3F0, state-exit 0x8025B368 clears +0xB99/+0xB9A/+0xB9B). While the item
  button stays held from the start (+0x3FA = 0), +0x3FC counts up (0x8027EB04 runs: read as turning with the stick)
  and at **48** (25 when the player manager's +0x6C is set: only HAYA does that, not in any battle arena) the hammer is
  charged (+0xB9B = 1, the sparkle 203/204). Let go, +0x3FA counts from 1: +0xB99 (the pound's box live) on 5, off on
  7; the pose ends on **17**, charged **30** (0x80251AEC(link, 0)). Frames (0x80267818): 291 + 7 × direction
  (charged 363 + 8 × direction) + +0x3FB: held 2, 1, 0 by +0x3FC (< 2, < 4, then 0); released 1 (+0x3FA < 3), 2 (< 5),
  5 (< 13), 6: the measured 306 ×2, 307 ×2, 310 ×8, 311 ×5 facing down, which the sim reproduces (hammer.test.ts).
  Charged: 1, 2, then 3/4 by turns (on the TV, +0x3B4 < 8, shown as 5/6), 5 ×2, 6 ×2, 5 ×2, 6 ×5, 7.
- **The pound's box**: ±8 px (±16 under HAYA) around the Link + table 0x8046B0C0: (20, 7), (−20, 7), (0, 12), (0, −8)
  by facing; charged (24, 7), (−24, 7), (0, 11), (0, −6). Link on Link (0x80232A0C → 0x80256F44, after the sword and
  the 0x80273FB8 attack): a victim on the same screen whose body box (+0x4C0) meets it, not flat (0x8023A3DC reads his
  +0xC9C), takes 0x80238548(victim, **2**, attacker, type **20**), charged (0x8026FC84: +0xB9B) **4**, type **21**, 0
  alone (+0x7F); no shield check. The hit method: no knockback, 60 invincibility, state 64, +0xC9C = **300** (type 20)
  or **600** (type 21) (60 when the player manager's +0x6C or +0x6D is set). State 64 (update 0x80284294): his height
  +0xC8C = 0.5 + 0.05 × (10 − +0x3FC) for 10 ticks, then 0.5 and state 0. 0x80247F0C: +0xC9C counts down, then the
  height grows back 0.05 a tick to 1.0. While +0xC9C > 0 the Action handler 0x80261480 and the stick spin 0x80275D9C
  do nothing. Life at 0 → state 51 before any of it.
- **The charged pound's impact**: +0xB9A on +0x3FA 18, off on 20 (only when charged): 0x8026FCE0 for the bees and
  `DOSN` (80 px), and 0x8024BBB8: the other Links (not in state 60, 63 or 12) within **50 px** of a Link with an
  impact hop (state 63), **100 px** when that Link's item level (0x8023725C) is 2 or more (80 px under HAYA). (The
  boots' crash takes the same path: its jolt reach doubles at level 2 too, applied since: "The Pegasus Boots".) Also on the
  pound: the quake (0x80134DE4, 1; charged 2), the ring (0x802F601C), JPA 573/574/575 (charged 571, 572, 573 ×5,
  574 ×2, 575 ×2) and dust 975 (976 on tile types 0x39 and 0x0D) at its center, and 0x802A1D44 on the tile ahead
  (table 0x8046B120, 16 px: pegs 0x76 → 0x77 and the like; none in the battle arenas, assumed).
- **The Fire Rod** (state 68, entry 0x8025A9C0, update 0x8025A15C). Entry: +0xB84 = 1 if the magic meter (+0xC08,
  0x80241794) is above 0. +0xB84 drops when the button is up. +0x3FA from 0, +1 at the end of each tick: frames
  (0x802677BC) 395 + 6 × direction + 0 (< 2), 1 (< 3), 2 (< 4), 3 (< 10), 4 (< 11), 5; on 12 the state ends (the
  measured 407 ×2, 408, 409, 410 ×6, 411, 412 facing down). On +0x3FA = 11: with +0xB84 still set, the stream: a FIRE
  (params 0x1040 | facing << 4 | player: kind 1) given the box 36 × 12 px (x + 18…54, y − 6…6 right; x − 54…−18
  left; x − 2…10, y + 12…48 down; x − 10…2, y − 56…−20 up), the Link walking at 1.125 (0x802808E8), magic −1 a tick
  (0x80247594; +0xC08 starts at 384 and is set back to full by 0x8027F16C whenever the button is up and none was used),
  +0x3FA held at 11 until +0xB84 drops. Otherwise, with no stream (+0xB28 < 0) and no fireball out (+0xB1C < 0), a
  FIRE with params 0x1000 | facing << 4 | player (kind 0) at the Link + 8 px along the facing (up: + 0).
- **FIRE** (`FIRE`, vtable 0x804A89F0; init 0x802BBE80: +0x260 = params & 3 the owner, +0x98 = params >> 4 & 3 the
  direction, +0x264 = params >> 6 & 15 the kind, +0x268 = params >> 12 & 15; update 0x802BB468). Kind 0 heads for 2.0
  px/tick along its direction (+0x23C; kind 3: 1.5, kind 4: 0.7), its speed approaching it by 0.3 of the difference a
  tick, at most 1.0 (0x801F71A4); box ±6 (±12 when +0x268 ≥ 2). No lifetime: a wall (0x801F2618 → vtable +0x58) bursts
  it (413). Damage: 0x801F2B7C(fire, its atcp **2** (`enemyparam.csv`; 0 alone), skipping the owner, type **22**); on a
  hit, gone (TV: +0x11C = 0). Its vtable +0x54 (0x802BABEC) lights a `BLZE` where it meets a burnable tile (which
  tiles: not read). Effects 411, 412 8 px ahead, turned by table 0x8046D388.
- **Set alight** (hit type 22, 0x802710C8): nothing on a Link already in state 80; in state 81 a 60-tick flag
  (+0x484/+0x480) instead; otherwise the damage, **+0x464 = 2**, state **80**, facing away from the source by its
  quarter. State 80 (entry 0x80281760, update 0x8028126C): velocity (table 0x8046BEA8) 2.0 along the facing and 3.0 up;
  in the air z += vz, vz −= 0.25 and no move; on the ground 0x8027EB04, a step of the velocity, the velocity reset to
  2.0 along the facing, and +0x408 counted: state 0 at **300**, or on tile type 0x39. It spawns a FIRE (params 0x180 |
  facing << 4 | player: kind 6) given his body box every tick (0x802BAA0C): it sets alight the other Links it meets.
  Effects 584/583/582/585 and 580/579/578/581 by facing (right, left, down, up), redone when he turns. TV frames
  (0x80267018): 885 + 8 × direction + +0x3F9 (+0x3F8 / 2, 16-tick cycle); the GBA screens 917 + 8 × direction.
- Not traced: everything above. The sim's assumptions (TODO(measure)): 0x8027EB04 as turning with the stick, a
  flattened Link's frame (standing) and walk (as usual), no fireball after a stream, the fireball's speeds from the
  adventure's trace (docs/measurements/adventure-lake-hylia.md: 1.02 px/tick first), the stream's walk animation, no
  water putting a burning Link out, the pound and fire on pots, orbs, bushes and soldiers.
