# Measurements: adventure signs, Cave of No Return, Tingle's Tower, Hyrule Castle

Part of the measurements from the real game (index: [../measurements.md](../measurements.md)).

## Adventure: signs and dialogue
Traced 2026-10-05 (`ref/dolphin-user-adventure2`, GDB port 55134, frame dumps) from `ref/save-adv-lake-room3.sav`,
the Links teleported to (248, 316) below room 3's sign (`KNBN` at (240, 288), params 0x407, tile 0x71), facing up,
then A pressed (movie frames 32-34; the GC's A is the item's button and talks, the sim's Item). `packages/sim/src/adventure/dialogue.ts` and apps/game `dialogue.ts` apply it.
- **The message:** 0x532 = params + 0x12B, as main.dol's KNBN adds 299 ("Do not recklessly pick up stones and throw
  them by pressing the R Button!"), on the wooden board (main2D `hukidashi_wood.blo`) at the screen file's own
  place: centered at the bottom (the board 506 × 145 down to y 415, its text box `Tm01` at (305, 343)), whatever the
  camera did; the `P1` badge (`P1b02` at x 525) appears once the page is typed. Dolphin draws no other badge.
- **Timing:** a speech icon over the Link the 5th frame after the press; the board on the 6th, with the first
  character; then one character a frame ("Do" on frame 39, "Do not" 44, "Do not reckl" 49, "Do not recklessly pick"
  59); the page (73 steps) typed by ~111, the badge then. A press closed it: the board showed 6 more frames and was gone
  on the 7th (frame 192 after a press at 185); pressed again (288) it reopened 6-8 frames later, the same way.
- **Meanwhile:** the Link reading stood (state 0); the Octoroks kept walking (the game isn't paused).
- **The box's edge** (2026-10-18, the same save, `--tele` to (239, 330) and (242, 330), 14 ticks up to y 311 against
  the sign, A): the board at x 242, nothing at x 239 (the Link half under the sign but his point left of x + 2), as
  main.dol's box says; `dialogue.realdisc.test.ts` walks both. A hand repro at x 239 had taken that for a bug.
- Not measured: the speech balloon (`hukidashi.blo`) over a person (Lake Hylia's girls `FGAL` are fenced off; the
  houses' villagers need the key's door), a press while a page types (the sim finishes the page), the turn to the next
  page, the stone board (tile 0x3C).

## Adventure: the Cave of No Return
Traced 2026-10-03…05 (`ref/dolphin-user-adventure2`, GDB port 55134, frame dumps). The stage was loaded from
`ref/save-lake-hylia.sav` by RAM pokes (world 0x80529F04 = 0, stage 0x80529F08 = 1, then on the game state
gs = [0x8053AAF8]: gs + 0x58 = 1 and byte gs + 0x84 = 1: boss011 loads at its start, room 12), then played; the
savestates `ref/adv/w1-boss011-start`, `w1-011-lamp`, `w1-011-room7`, `-room7-blocks`, `-room13` (b, c, d), `-room0`,
`-room2`, `-room1`, `-room2b`, `-room3` (not committed) step through it. Past room 13 the Links were moved by
`--tele` (it works inside a room from a nearby spot: from far away the game put them back) and room switches poked
(the current room's u32 at stage data + 0x178 + cell y · 40 + cell x · 4, formats/battle-arenas.md "Switches"). The sim follows it:
`stairs.ts`, `lamp.ts`, `tileblocks.ts`, `rocks.ts` (BLCK), `colorblocks.ts`, `chests.ts`, `doors.ts`, `dialogue.ts`
(an item got), `cavenoreturn.ts` (the route), `cavenoreturn.realdisc.test.ts`.
- **The way in** (room 12): the stone door (`SIBT` kind 2) began rising the tick the leader came within 80 px below its
  line (16 px above its anchor), 0.2 px/tick, blocking him (pushing at y 87) until 24 px up (120 ticks), stopping at
  40. The staircase (`RASN`): the tick after the leader's y went under 56 the four stood in a row on its line, 16 px
  apart, facing up, walking in place for 67 ticks; then in room 6 at its bottom door (x 328-376, y 272), still 29
  ticks, walking up at 0.5 px/tick for 40, control back the tick after.
- **The lamp** (room 6): the Action button facing its pedestal (tile 0x017) gives it to the four; the pose (player_sob
  233 × 10, 234 × 4, 235, then 236) and its message (0xDD, two pages) on the 97th tick after the press. A press of
  the GC's A then lights it: state 72 the next tick for 9 ticks (866 + 2 × facing, 2, 4 and 3 ticks); a candle
  switch (`LWSW`) in front lights, its switch on (room 6's two, 17 and 19, open the door north: `SWT4` 20).
- **Movable block tiles** (room 7, tile types 0x35-0x38): 0x38 went left, 0x37 right, 0x36 down (0x35 taken as up);
  leaning on one, the 21st tick moves it one tile at 0.5 px/tick, the Link with it; once only. Four pushed onto the
  room's `PONT`s (kind 3: its switch on when the tile under it changes) put out the ring of fire (`FLME` kind 5) round
  the key's chest ~25 ticks after the fourth.
- **Chests:** the GC's A facing one and touching it opens it, **from below only** (room 13's key chest: touching it
  from its left side, A lit the lamp; from below it opened): the lid, the Link holds the content up from the 12th tick
  (238 × 4, 239, then 240), its message from the 97th; a key is then carried overhead (state 18, frame 719 standing).
- **Locked doors** (`DOOR` kind 1, (p >> 12) & 31 = 2): the Link carrying the key pushing right at y 140 by room 13's
  door at (480, 128) opened nothing; at y 172 (the passage's middle) the key went at once and he walked through. The
  door box is 2 tiles along the wall from Lake Hylia's place for it (room 7's door at (480, 32) took it at y 72).
- **BLCK blocks** (room 13): a 32 px block didn't move for the leader alone; the four in the wide formation pushed it
  32 px in two legs of 16 at ~0.35 px/tick, 12 still ticks between; it went once. The block in the east column
  (params 0xC05) went **down** pushed from above (the leader from y 120.8 to 152.3). main.dol's update (0x8028C7D0)
  explains room 13: (p & 3) + 1 Links needed, 0.5 px/tick × 0.7 (× 0.4 for 64 px), params bit 10 fixes the way, as
  an axis for 32 px blocks (0 across, 1 up or down): the east column's block is the way into the room's east side,
  its 64 px block (down only) the way from there to the bottom.
- **Pots** (tile 0x40) lift like Lake Hylia's grey stone and leave 0x11 (the tile rewritten in RAM).
- **Rats** (`NZMI`) bite: the route beats the ones in its way.
- **Room 0** (color blocks): the two candles by the east door lit from (462, 280) facing up and (464, 318) facing
  down opened it (switches 17, 18 → `SWT4` 16). The color blocks themselves (`BCK2`) are read from main.dol, not traced.
- **Room 1:** its walls are pots (tile 0x40); the pot over the key's `PONT` (384, 208), lifted, showed the key
  (switch 21); fireballs (`FBGE`: "The fireball traps" below) knocked the Link back (state 15) along y 232 and made him
  drop what he held. The Mozos of room 2 (alive again on the way back) knocked the key out of his hands too.
- **Room 3** (where the route stops): its middle is a pit (tile 0x0D/0xDE, type 0x0E) from y 80 to 272; walking in
  cost a heart and put the Link back on the edge (state 50, an arc up to z 132 and down). A Link tossed (apart, lifted,
  thrown up) flew 47 px and fell in alike. The room's candles, crystal and the bridge's switch are all on the far
  side: `SWT4` 19 (its four candles) shows the Keese (sixty) and the crystal, the crystal (`ONOF`, switch 16) lays the
  bridge (66 floor tiles over the pit, x 208-304). Switch 4 or 5 toggles 1 (`OFFS`, checked by a poke), but `SWT4` 16
  also wants switch 0, which nothing sets alone. The lamp at the near side's candle stands lit nothing. How the Links
  cross alone wasn't found (room 9's ghost says friends can be tossed across chasms: room 9's are one tile wide).

### The fireball traps (the Cave's room 1, Dolphin, 2026-10-21) and the blade traps (main.dol)
Traced with a copy of the cave user folder (`ref/dolphin-user-adventure-cave-fire`, GDB port 2400) from
`ref/adv/w1-011-room1.sav` (the four just in from room 2 at (98-153, 152), the traps' countdowns at 1), `actor-trace.ts
--ids FBGE,FBAL,KEY0` (FBGE +0x2A8 its countdown; FBAL +0xC/+0x10 its place, +0x3C/+0x40 its velocity), the Links moved
by `--tele` in hops of under ~110 px; frame dumps for the look. The sim follows it: `traps.ts`, `doors.ts`
`knockKeyOut`, `traps.realdisc.test.ts`.
- **The shot:** the trap at (248, 40) shot the frame the Links were put at (230, 140) (100.6 px off): an `FBAL` at the
  trap's spot, z 0, velocity (−0.266, 1.476) = 1.5 px/tick at the leader, moving from the next frame, straight on over
  the pots; the countdown 120 that frame, a shot again 120 frames later while a Link was in reach (the five shot 120
  frames apart all along). At (153, 152) (147 px) and (223.3, 152.9) (115.6 px) none shot. main.dol (`FBGE`'s update
  0x8021D2FC → 0x801CECF4(this, 'FBAL', 1.5, 112.0)): the nearest Link on its screen within 112 px; params bit 0 /
  bit 1 put it away playing alone / with several (all five 0); its switch on puts it away.
- **The hit:** 63 frames after the shot, at (231.5, 131.5) against the leader at (230, 140) (7 px apart, the sim's ±7
  body against its ±2 box: a frame earlier): life 12 → 10, state 15 for 25 frames, 1.5 px/tick away from the shot
  ((−0.26, 1.48), then (−1.50, 0.02) from one coming along the row), up to z 19.5 and down (hop 3.0), 60 invincible;
  the shot gone. From the right (the trap at (440, 232)): the leader at x 392 struck when it was 7.5 px off. main.dol:
  the Zora's fireball's update (0x801D2E70): atcp 2, hit type 1 (0x801F2B7C), gone on a hit, a 2-frame poof when a
  shield stops it (JA_SE_CHR_SHIELD), off the screen's rect gone.
- **A key knocked out:** the leader lifting the key at (392, 232.5) facing up (state 17 at frame 132, carrying it
  overhead, state 18, from 156: the key at z 18 over him), struck at 157 by the shot along y 232: from 158 the key
  flew up 6 px a frame from z 18 ((392, 226.5, 18), (392, 220.5, 17.8), (392, 214.5, 17.4)), stopped by the pots above
  at y 214, drifted back ½ px a frame and lay at (392, 219) on its 14th frame (z 18 − 0.1·k(k − 1)): the key's throw
  without its wind-up, along his facing, while he was knocked back left.
- **The look:** `FBAL`'s init (0x80220274) makes JPA 656 at its spot (layer 0), its update moves it along; its draw
  (0x802201D8) adds a light, 24 px at 128 (frame dumps: a small flame). Its sound
  (0x50030) is JA_SE_OBJ_ZORA_TAMA.
- **The blade traps** (`TRAP`, read from main.dol only: no savestate reaches Tingle's Tower room 2 or Hyrule Castle
  room 9's area 2): init 0x801650AC, update 0x80164834, draw 0x80164640. Params: p & 3 its way (right, left, down,
  up), bit 2 it turns toward the Link, bit 4 big (box ±12), (p >> 8) & 15 its look (0: enemy_both2 340; else enemy_gc
  378 + a step cycling every 10 frames, the first a random 0-2), (p >> 12) & 15 non-zero: to and fro for good.
  Box ±6, wall box ±3, life 1000 every frame, atcp 2 (enemyparam.csv), hit type 1 every frame it touches a Link; a
  sword meeting it: 0x801F285C, 0x80237948 (the iron ball's clank), effects 279/280, JA_SE_CHR_SHIELD. Waiting (state
  0), its 10-frame cool-down over: the nearest Link (0x801EEC98) within 22 px across its way (either side) sets it
  off: its velocity eases (0x801F71A4: 0.3 of the gap, ≤ 1 px a frame) to 3 px/tick its way, JA_SE_OBJ_TRAP_MOVE;
  sliding (1): a wall or another actor met (+0x9C) stops it dead, sparks (JPA 1185, 8 px ahead) and
  JA_SE_OBJ_TRAP_BOUND at most every 4 frames, then back (2): its place eases home (0.3, ≤ 0.5 px a frame), home
  within 1 px. World 1's: Tingle's Tower room 2 (104, 232) 0x100 right, (184, 296) 0x101 left (look 1, in deep
  water); Hyrule Castle room 9 area 2 (72, 184), (184, 184) 0x4 (right, turning). Not read: 0x801EEC98's way to the
  Link (taken as the larger of |dx| and |dy|), which actors +0x9C counts (taken as the other blade trap).

### The Cave of No Return from room 3 on (Dolphin, 2026-10-10)
Traced with a copy of the adventure user folder (`ref/dolphin-user-adventure-cave`, GDB port 9093), `trace.ts` and
`actor-trace.ts` (its `--place` puts an actor beside a Link wherever he stands, `--dump-frames` dumps frames). The
current room's switches are the u32 at 0x8115A3F0 + cy · 40 + cx · 4 (room 3: 0x8115A478, room 11: 0x8115A450,
room 4: 0x8115A428, room 9's cell: 0x8115A4A0; switch n is bit n). New savestates (`ref/adv/`, each with its `.json`,
the pokes and teleports in it): `w1-011-room11` (room 3 crossed by poking switches 16 and 21, the four in room 11's
south pocket), `w1-011-room11-north` (teleported into its north part, (256, 60)), `w1-011-room4` (switch 20 poked,
through the door: Shadow Link's cutscene starting), `w1-011-room4-shadow` (the Links apart, red in control, Shadow Link
just struck him), `w1-011-room4-green` (after three red hits, his second form), `w1-011-room8` (room 9's cell, the four
in a row at y 224 east of the island's pit), `w1-011-room8-island` (the red Link thrown onto the island).
- **Getting there:** in room 3, switch 16 poked lays the bridge (the PNPC tiles watch it); switch 19 would show the
  ledge row (and the Keese and a cutscene), so the Links were teleported past it (y 103 → 56); switch 21 opens the north
  door (and the gem rain). Room 11's switch 20 opens its door north. A teleport inside a room worked over ~220 px when
  nothing was in the way; four Links teleported onto one spot push apart (room 8: the leader shoved into the pit).
- **Room 11's chain levers** (`PSWK`, the east one at (336, 24); `actor-trace --ids PSWK`, its pull the f32 at +0x244,
  its y = 24 + pull): the leader walking up stops at y 39 (15 px under the handle). R pressed facing it: the leader
  holds it the 4th tick (state 26, player_sob 738), the others of a C-down column (16 px apart) a tick apart each
  (state 17 for 1-3 ticks, then 26). **R alone holds it and nothing moves; R + Down pulls** (from the 4th tick): 0.03 px
  a tick over 0-2, 10-12, 20-22, 30-32 px, 0.5 px a tick between, 40 px 330 ticks after the first. The leader alone (the
  others trailing far) holding R + Down: nothing moves. The four come down with it in 0.5 px steps (the leader at most
  0.5 px behind the handle + 15), and the tick after the full pull they all step back 7 px (78.5 → 85.5); then 50 ticks,
  a 13-step pose sequence (player_sob 220-232; the 12th step 8 ticks, the 13th 25), and the switch (20) turns on 94
  ticks after the full pull; they let go 2 ticks later (state 0) whatever the pad, and the lever goes back up at 1.25 px
  a tick. Down let go while R holds a lever pulled 12 px: it goes back up 1.25 px a tick dragging the four up with it,
  the leader lets go on its 3rd tick, the others one by one 3-4 ticks apart. **The grab:** from y 39, 40, 41 and 41.5
  (facing up, x 329-342) the leader grabbed it; from y 42 and 43 he only reached (state 17, ~22 ticks) and didn't.
- **Room 4's Shadow Link** (`SLK2` at 0x812E7100 in these states; `actor-trace --ids SLK2 --fields SLK2=80-5b4`; his
  life at +0x108, his state at +0x248, his speed at +0x254, his heading at +0x234/+0x238):
  - The way in: walking up from the door, the Links stop at y 265 and the camera pans to the room's middle, where he
    comes out of a dark portal (jumping out ~230 ticks in); control comes back ~550 ticks after the door. **Shadow
    Link's entrance** (2026-10-30; read in main.dol: the state ticks 0x801C30BC…, their starts 0x801C3BC0…, the group
    0x804C7E70 (0x801C0D70) and its coordinator 0x801C0DCC, his camera method 0x801C283C; traced with `actor-trace.ts`
    from `ref/adv/w1-011-room11-north` with its recipe's script and switch-20 poke then 800 frames of Up, `--fields
    SLK2=230,248,24c,250,c:f,10:f,14:f,3c:f,40:f,44:f,33c:h,340,11d:b,98` and the raw bars (overlay 0x81128470 +0x284),
    the scene's mask (0x811738CC +0x3041), the camera's special focus (0x80F8BC30 +0x7F0), view and box; GDB port 2520):
    - **Who:** his init (0x801C544C) by kind (p >> 5) & 7: 1 and 2 get the flags 0x6000 (in the entrance, the one
      that leads it), 3 only 0x4000 (taken along), the others none; the group's place (+0x54) is his spot, its +0x50
      (a place to come out at) −1 in room 4. His reach for the wake: (p >> 20) & 0xFF × 16 px, 10 × 16 when 0 (room 4's
      0x544120: 80 px).
    - **0** (unseen): the Link in control within that reach (squared distance; the leader at (231, 266.5) woke him,
      268 didn't) and all four on his screen (0x801CD228) → **1**: the scene takes the game (0x801F68E0: a Link
      carrying something has it dropped first, 0x80230C6C, and it tries again the next tick; then each Link held,
      +0x3041 = 15, the pause menu barred by 0x8037AE00: its flag [0x8053AF40]+0x13F is read only by START's check
      0x80136364) and asks for the bars; the group's flag 8 makes the coordinator (each
      frame, before the actors) put every 0x4000 member in **2** (1 tick); the Links' last step is the take's tick,
      then not a step or a frame of theirs moves (the leader stays in state 2 on his walking frame 63, the others 3).
    - **3**, the dark portal: JPA 1043, 1044, 1045 at his spot and sound 0x40048 `JA_SE_CHR_SLINK_APP_EFFECT`
      (0x80214740, param 0; 1048-1050 and 0x4004E `_APP_EFF_S` with 1: his state 13, back into it; with the group's
      +0x50 ≥ 0, JPA 470-473 and 0x400D6 `_APP_EFF_G` instead: none in World 1), 235 ticks (160 when the group's +0x50
      ≥ 0). **4**, out of it: +0x11D = 1 (drawn from here), animation 4, sound 0x40035 `JA_SE_CHR_SLINK_APPEAR`, up 4.5 px/tick less 0.2 a tick, at most 4 down: 4.3, 8.4 … 48.4 at the top (22
      ticks) … 0.4, then on the ground on the 45th tick. **5**: 15 ticks (60 when 0x801C11F0 or the group's flag 1),
      then +0x230 0x8000 and the group's flag 0x10; once every member is (+2: their count) the coordinator poses them
      (0x801C272C: 6 when 0x801C11F0, 7 with flag 1, else **9**). **9**: 60 ticks, then 10 (115) and 11 (60) for a
      skill with flag 2, else **12**: the message window's "Defeat Shadow Link!" (0x8043D67C with 411: BMG 0x19C) and the
      stage call 0x802D6BC8(1); when the window is free again (+0x10A, 191 ticks on) the group's flag 0x20 puts him in
      **14** on the next frame: the scene's end (0x801F6884) and standing as in 15 for 5 + rand(26) ticks. 12's start
      also asks for BGM 0x0100000D `JA_BGM_SHADOW_LINK` (0x80458FF0).
    - **His animation** (+0x340: set 0x800FEB78, stepped each tick 0x800FE8C0 by step lists, 0xFF looping, 0xFE
      holding; the frame +0x348 = the facing's first frame (right, left, down, up) + the step's offset; table
      0x80463AA0): 0 standing (60-63), 1 walking (8 × facing + 0-7, 3 ticks each, looping), 4 the tumble (241 + 8 ×
      facing + 0-7: 3, 6, 6, 3, 3, 3, 6, 80 ticks, then held). In the entrance: 4 in state 4, 0 in 5 (0x801C3CC8), 9
      (0x801C3F04, shared by 7, 8, 11) and 14 (0x801C4020), none set in 12; 10 walks (1). A Link's frames in his
      palette, not frames of his own.
    - **The HUD's fade** (the adventure HUD's corner update, 0x80419E28): every tick a player's parts lose 0.1 of
      alpha while the bars are asked for (overlay +0x284), his corner is hidden (message manager +0xDC) or he isn't
      in, and gain 0.1 back toward each part's own (0.6, 0.9 or 1) otherwise: gone 10 ticks after the take, back 10
      ticks after 12 stops asking.
    - **Timeline from the wake (tick T):** T+1 the take, T+2 state 3, T+237 state 4, T+282 5, T+297 ready, T+298 9,
      T+357 12, T+548 the window free, T+549 14, T+550 the leader's first step (traced, all of it).
    - **The camera** (0x801C283C every tick): in states 3-12, the one that leads asks for the bars (overlay +0x284 = 1,
      +0x28C = 0.05) and, unless the Links are in a GBA area, sets the special focus (+0x7F4 = 1, kind +0x7F8 = 4, his
      x, y, +0x7F6 = 0); from 14 on (but 23) he hands his point (0x8030C210) and sets +0x178 (a boss: mode 2). With the
      special focus of kind 4 the box (0x8030CD18) is his point alone, no Link counted, the edges' holds cleared: it
      went 3 px a tick toward him (0.95 across, 3 up), then a fifth of the gap (mode 4: no point handed), on him
      (2304, 576) by ~40 ticks, the view 284 px wide (2.1408). Mode 2 (64, 130, 32, 3, 1, slack 32, hold 60, 0.1, flag
      0): without the flag every Link on the TV counts and points aren't pulled; the margin (+0x1D4) and the least half
      width (+0x1D8) ease to the mode's by a tenth of the gap, 3 px at most: the zoom 2.141 → 2.338. apps/game's camera
      fed this trace's Links and his states gives Dolphin's box and view to 0.000 px over 800 frames.
    - **The bars** (the overlay [[0x8053AB10]+0x30], step 0x8016005C, draw 0x8015F9C0): asked for during a tick, their
      amount +0x288 goes up by +0x28C on the next step (0.05: 1.0 twenty ticks after the take), else down by it (0 twenty
      ticks after 14's start); drawn black over the whole width, 48 × a² TV px tall at the top and at the bottom, alpha
      255 × a². Frame dumps (`compare.ts`, cave-room4): the HUD gone from the take, the portal a black disc with purple
      sparks, "Defeat Shadow Link!" at the top (the Links low on the screen).
    - From `ref/places/cave-room4` (21 ticks into state 3; its `.sav` holds +0x24C = 20, a trace's first frame 21) with
      Up held (`clip.ts`, `cave-room4-entrance`): his states at the same frames as ours through 14 (3, 4 on 214, 5 on 259,
      9 on 275, 12 on 334, 14 on 526), the leader's first step on 527 in both.
  - **Walk and target:** he walks at 1 px/tick, reached by +0.1 px/tick each tick from rest (the heading a unit
    vector). Left alone he goes about the room's `RAIL` points ((96, 80), (96, 192), (416, 192), (416, 64), (112, 80):
    +0x358's low byte the point he heads for), stands at each (state 15, ~90-580 ticks) and once jumped from (120, 80)
    to (425, 66) (5.1 px/tick across, up to z 84). A Link near him: he comes at that Link (state 27, the same walk);
    a Link appearing ~20 px from him or swinging his way: he springs back (state 32: 3 px/tick away, slowing ×0.78
    from the 8th tick) or, later, jumps over him (state 28: up to z 44, 2 px/tick, 45 ticks; landing, state 31, 18).
  - **His attack is a sword swing, not a touch:** at ~24 px from the red Link he turned (state 34, 2 ticks) and swung
    (35); the Link was hurt 5 ticks after the turn: 2 (the shared life 8 → 6), knocked back 2.4 px/tick for ~25 ticks,
    60 invincible ticks. Then he stood 90 ticks (state 39). No hurt by touch was seen (he never touched a Link).
  - **Hits:** put 18 px in front of a Link (by `--place`) and struck while standing (states 39, 15, 31), each sword
    hit took 4 off +0x108 and knocked him back (state 33: 16 px/tick, ×0.78 a tick, 24 ticks). His first form is dark
    (his shield's emblem red): **3 hits beat it from any Link**: the red Link's three, and in another run the blue
    Link's three (+0x10C, the last striker, 2) did the same. After the third: state 43 (~120 ticks), a jump away (29,
    30), 44 (~175), 45 (~75), his life back to 1000 (+0x564 0 → 2, +0x568 12 → 8), ~454 ticks from the hit; he came
    back **in a Link's colors**: blue after the blue Link's hits (frame dumps), green then purple after the red Link's.
  - **The second form:** the green Link's swings (placed in front, in states 15, 27, 39) all made him jump over him
    (state 28); cycling the controls through the four (the D-pad hands them to the next Link, whichever direction) with
    a swing each, only the purple Link's (+0x10C 3) landed, while he landed from a jump (state 31): 1000 → 996 → 992,
    then his life went back to 1000 48 ticks after the second (state 46), and later single hits were put back the same
    way (the other Links' swings in between getting him up again: below).
  - **What beats the second form** (2026-10-10, from `w1-011-room4-green`; GDB port 55123, `ref/dolphin-user`; fields
    +0x560 his color (the index of the Link whose sword lands; 4 the dark form), +0x564 his form (0 dark, 2 colored, 3
    down), +0x568 the damage that beats the form, +0x59E the down count, +0xD8 his invincibility). In this state he's
    purple (+0x560 = 3). The D-pad twice handed the controls to the purple Link (red → blue → purple), Up faced him up;
    he was put 18 px above that Link (`--place <f>:SLK2:3:0:-18`) with his heading +0x33C poked to 0x8000 (facing away:
    from ahead his shield stops the sword, state 32) the frame before each swing:
    - hit 1: 1000 → 996, knocked back (state 33, invincible 24); hit 2 (a swing at his turn was stopped twice first):
      992, invincible **48**; when it ran out (48 ticks) **state 46, form 3, life 1000, +0x568 = 1, count 600**: down;
    - **a hit of his color while down: knocked back 24 ticks, then state 41** (he spins: +0x33C += 0x4000 every 8 ticks)
      **for 160 ticks, then he's gone**, and room 4's switch word (0x8115A428 in this lineage) took 0x00010000
      (**switch 16**, the door north) 2 ticks later;
    - left down: the count ran 600 → 0 (a 100-tick spell in state 16 on the way also counted) and he was up (state 27,
      form 2, +0x568 = 1); one hit of his color then put him down again 48 ticks later, and the next beat him (state 41);
    - the green Link's sword on him down (the D-pad once more from purple): form 2 at once, +0x590 0 (the striker), he
      jumped over him (state 28, 90 ticks; landing, 31, 29) and came at him again (27).
  - **His moves** (2026-10-11; `ref/dolphin-user-adventure-slk` copy, GDB port 2350; `actor-trace --ids SLK2
    --fields SLK2=c:f,10:f,14:f,3c:f,40:f,44:f,98,108,248,24c,250,254:f,258:f,338,33c:h,358,55c,560,564,594,598,5a4:f,5a8:f,5ac:f,d8,52c:f,530:f,534:f,538:f`;
    room px = world − (2048, 384); fields: +0x248 his state, +0x24C/+0x250 its ticks and length, +0x254/+0x258 his
    speed and the one it eases to, +0x33C his heading (0 down, 0x4000 right: velocity (sin, cos) × speed), +0x98 his
    facing (0 right, 1 left, 2 down, 3 up), +0x358 his rail (bytes: ?, the way 0 on/1 back, the count 5, the point he
    heads for), +0x55D the points left to walk, +0x597/+0x598 his swing's and the chase's cool-downs, +0x5A4/+0x5A8/
    +0x5AC his ranges, +0x52C-0x538 his sword's box). The state numbers and the rules are read from main.dol (tick
    table 0x804A448C, starts 0x804A45B4; docs/ADVENTURE.md "Room 4"); what the traces showed:
    - **Left alone** (`w1-011-room4-shadow`, the Links teleported to (256, 268), 2,400 frames): 39 → 27 → 15 (no
      Link within +0x5AC = 79 px of the red Link in control), 15 for 17 ticks (15 + rand(16)), then 17 (red within
      +0x5A4 = 100 px); his speed eases 0.1 a tick up and 0.2 down; heading at the next point (rail point 2 (416,
      192), the way on), arriving within ~10 px of it jittered (±16 px each way, 0x801C8C84); at the points left = 0
      and red beyond +0x5A8 he stood (15) 312 and later 579 ticks (300 + rand(301)), then walked 2 points on (+0x55D
      = 2), turning 0x500 a tick after a corner. At (410, 94) (point 3 reached, point 4 ahead: flags 0x08/0x10) he
      stood 90 ticks (18), crouched 30 (19), flew 60 (20: (−4.91, −0.18) px/tick, 6 up) to (115.6, 82.9) near (112,
      80), landed 30 (21) and stood 90 (22); then on to (96, 80) and (96, 192). The same jump back from (113, 94) to
      (427, 81) (`w1-011-room4-green`: the way back, +0x359 = 1; 18 63 ticks there, 19 2: cut short by +0x540's
      check, not decoded). A Link within 100 px about ahead turned him back along the rail (+0x359 1 → 0, the point
      before).
    - **Only the Link in control counts**: every range check above held for the red Link in control alone (the others
      standing apart nearer him didn't count).
    - **The shield and the spring back** (the red Link walking right at him, B every 22 frames, from
      `w1-011-room4-shadow`): red's swings from ahead of him clanked on his shield four times (f120, 142, 186, 208): no harm, state 32 with
      (2.3, −0.5) px/tick (3 × 0.78) away from red, × 0.78 a tick, for 10 ticks (9.5 px), then 27 (his swing's
      cool-down +0x597 = 60 still on) or 34; red pushed back 1 px/tick for ~7 ticks (state 4, then 2). Closing in
      (34, 10 ticks, his heading at red every tick), then his swing (35) from 16 px: his sword's box (−8, 8)-(8, 24)
      facing down on ticks 2-7 and 10-15 of the 16, red's sword meeting it on tick 10: 32 at 3 px/tick. Another 35
      from 28 px hurt red on its 4th tick; then 39, 90 ticks.
    - **From his side** (red placed 18 px right of him by `--place 10:SLK2:1:-18:0`, his heading poked to 0 (down)
      and +0x98 to 2, red facing left, B): the sword landed (1000 → 996), knocked back (33: −15.9 px/tick, his heading
      0x3C6E: facing red), 24 ticks, then 34 at once (red 40 px off), which timed out after 5 ticks (15).
    - **A Link who can't hurt him** (`w1-011-room4-green`, him purple, red in control placed under him by `--place`,
      B): the same tick state 28 (42 lasts no tick on the ground), heading at red, 2.0 px/tick, +0x44 = 4.5 up, 45
      ticks (f20 → f65), walls stopping him (moved 18.5 px against the room's south edge; 76 px the second time),
      landing 31 for 27 and 17 ticks (10 + rand(21)), then 27.
    Not traced: the lunge (state 36, two swings in five: none came up), the stun by an item (16), how he joins his rail
    (0x801C844C), the change's jump.
- **Room 8's island** (room 9's cell played alone): the four in a row at y 224 (leader x 328 facing left, 18 px
  apart). X (apart), a right tap (he turns without moving), R: the follower in front is lifted the 2nd tick (state 25;
  the leader 17 then 18), up to z 20 over the leader by the 25th tick. A left tap (he turns, 1.2 px), R: the leader
  winds up (state 22) 10 ticks, throws (23): the Link flies 3.36 px/tick west, z 22 → 0 in 12 ticks, landing at x
  283.3, **43.5 px** from the thrower, on the island (standing, state 0). The D-pad hands him the controls; at
  (203.8, 199) facing up, R at the pedestal: the get pose (233 × 10, 234 × 4, 235, 236) the next tick, item 4 (the bow)
  by the 90th, the message closed by A ~165 ticks after R (A at the pedestal again shows the pose again). At (232.3,
  226) facing down, B: switch 16 (the crystal `ONOF` (224, 240): the bridge) on the swing's first tick.
  Its frame dumps (`ref/dolphin-user-adventure-cave/Dump/Frames`, 2026-10-10, the lamp held): all four Links hold the
  bow up (enemy_both2 68, LSTI's look) over the raised right hand from the press until the message closes; the HUD's
  item box shows the lantern until the item changes (still at ~15 ticks), then the bow; the pedestal then draws the
  lamp (taken again, the bow): the item held goes onto the pedestal (`gear.ts`, `AdventureState.pedestals`).

## Adventure: Tingle's Tower in Dolphin (2026-10-11)
Traced with a copy of the adventure user folder (`ref/dolphin-user-adventure-tingle`, GDB port 2360), `trace.ts`.
- **Why the stage pokes missed it:** the loader (0x80135B90) takes the arc's name from `table[world · 4 + stage]`
  (0x8049ED88, static); slot 2 of every world is `boss20W.arc` (`boss200`: rooms 1-2, start (2, 9) → room 1, a fenced
  field with a woman and an arrow sign, and `scrn/mg_horse_race.blo`; its rooms 3-11 are byte copies of boss012's,
  off its layout). No code names `boss0W2`. The map CSV comes from a second table (0x804A9710 alone, 0x804A9830
  otherwise: `map200.csv`), the map files' "%s" from the string at 0x80540F58 + 4 · stage ("010" "011" "200" "013").
- **Loading boss012:** poking `boss012.arc` over `boss200.arc` (0x804653A4) hangs on the horse race's HUD (slot 2
  builds it: 0x80445D24 looks up `kk_rupyNum_00.bti`, null in boss012 → a call through 0, an ISI at 0x00000000). Through
  slot 1 instead: `boss012.arc` over 0x80465398, `map012.csv` over 0x8046E258, `map012_1.csv` over 0x8046E598, `012`
  over 0x80540F5C, then the usual pokes with stage 1. It loads, but the CSV parser (0x802D3D48, the grid at stage data
  + 0x60) wants 9 header fields and boss012's has 8 (all the `boss0W2` and a few unused arcs do; every arc the loader
  names has 9): it read row 0 as the 9th, losing rooms 2, 1, 0, 11. Patching the header as it's read (`--patch
  802D3E5C:r3:…` "map0,5,0,2,0,22,8,1,5,0", the 9th field 0 as in the other overworld stages) loads it right: room 11,
  the four in a row at (416, 96) … (464, 96) (playing alone, the castle's start lines them up the same way from its
  first `PLAS`; the sim puts them on the four `PLAS`).
- **Room 11's owl** (`KEPO` (280, 104), 0xC000001C): walking left along y 96 the leader stopped at (299.2, 118.3), 23.95 px
  from it (the step before 24.21: main.dol's reach (p >> 20 & 31, at least 1.5) × 16); the camera panned to the house
  under letterbox bars, the owl flew in, the box's first character came 239 ticks after the stop (message 0x147, one
  page); A closed it and he walked within 3 ticks.
- **Room 0:** the villager (`JIJI` (416, 144)) stopped the leader walking left at x 431.4. The ladder's foot (0x3C/0x3D):
  he stopped at y 184.73, moved 1 px on the 20th blocked tick, then was at (x, 216) with z 32.27 (the drop + 2), z
  +2.0, +1.83, … (−0.17 a tick) to 43.05 and down 34 ticks later (state 56), stood a tick, swam. Swimming west: 1.2,
  1.45, then 1.5 px/tick (the current).
- **Room 1:** swimming right 1 px/tick across and 0.5 down; gliding to a stop across while the 0.5 down went on; at a
  stone (spike tile 0x51) life −1 (15 → 14) and knocked back up 0.75 px/tick for ~30 ticks (state 15), with a hop. A
  100-gem pickup opened "You got 100 Force Gems! You're filled with power!", held until A.
- **Room 3's falls** (from `w1-boss012-room3`, idle): carried down 2 px/tick by the 0x96 current, the leader's y 186.23
  (bottom sensor on the lip row 192): that tick the three others (28, 52, 73 px behind) were at 254.23, 254.16, 249.01
  with z 98, 122, 138, the leader the next at 250.23 with z 66 (each landing − y + 2), z then +1.83, +1.66, … as the
  ladder's drop; down after 44 ticks (leader), swimming at once.
- **Room 3's whirlpool** (320, 304): reached at (328, 312) he spun 51 ticks (state 38), stood at area 5's (40, 8)
  (state 39) ~58 ticks, sank to (40, 40) at 1 px/tick, swam in the side view (state 75), the others joining then.
- **Area 5's shaft top** (208, 0, style 0x0F): swimming up 0.7 px/tick, Up held; at y 22.9 → state 40, up 0.5 px/tick
  66 ticks to −10.1; then in area 2 at (136, 136) (its whirlpool's box middle), state 41, 69 ticks; swimming (state 74)
  from the next, the others beside him; idle there 115+ ticks, the whirlpool didn't take him.
- **Room 4** (from `w1-boss012-room4`): east along y 297.6 a stone at x ~216 hit him (14 → 13); up to y 218 and east,
  stones at x ~232 hit him three more times; up-right again at y 197. Not crossed that way: the stones (spike tiles
  0x51) wall the lake's west part off from the island's, diagonal joint to joint from (240, 112) to (224, 320).
- **River stones** (room 4, Links teleported, `--tele` from `w1-boss012-room4`): a stone run into costs 1 life (the
  four's shared life) and knocks the leader back 0.75 px/tick (0.53 per axis on a diagonal) for 33 ticks (state 15,
  knock z velocity +4 less 0.25 a tick: z up to 34), straight away from the sensor that ran into it: swimming right
  into one, (−0.75, 0); carried down by the inflow onto a stone's top-left corner, (−0.53, −0.53); down onto a top,
  (0, −0.75); up-right into a corner, (−0.53, +0.53); a dive (frames 504-507) is struck the same. Sliding down past a
  stone's side doesn't strike him. While knocked the current doesn't carry him, and after it his drift starts from
  nothing. Then 60 ticks (+0x464) in which a stone only blocks him (he rested on one 4-8 ticks before the next
  strike). The other three follow the leader's trail through it (his hop drawn on them), unstruck.
- **Over the chain's north end** (teleported to (200, 40) on the inflow's slow west edge, then 39 ticks right, 5 down,
  right; or 40 right, 40 down-right, right): the fast current (0x96, 2 px/tick) carried him down onto the north stone's
  top at x 242, it knocked him straight up 24 px (13 life), and swimming right he came down past its east side
  (256.5, 96.9) → (262.5, 108.9), on to the island's shallows at (320, 152). Crossing from the slow edge without the
  strike isn't possible: right across the fast current he comes down ~95 px in the 56 px across.
- **Out of the water up a ladder** (room 0's, from `w1-boss012-room0`, teleported into the river under it at (324,
  218), Up held): he stopped at y 208.0 under the foot's solid top half (ending at 200: the swim's top sensor reaches 8
  px), 19 ticks there, moved half a px on, then jumped as off a ledge (state 56, 27 ticks, z up to 22.5) from (313,
  207.5) to (320.3, 183.1) (the ladder's middle in the tile above the foot, landing a step past it), stood (state 13)
  and walked up at 1.5 px/tick.

## Adventure: Force Gems spilled by a Link struck (Dolphin, 2026-10-30)
From `ref/places/tingle-room5.sav` left idle (the leader under room 5's falls, 301 Force Gems: Link +0xC04 301, 0, 0,
0, the HUD's 0x80529ED4 the same): `trace.ts --break` on the hit method and the drop, `--raw` on the counts,
`actor-trace.ts --ids RUPY,GOLD --scan 812D8000:81320000` (1800 frames; `ref/dolphin-user-adventure-gems`, GDB port
2550). Applied in the sim (pickups.ts `spillOf`, `spillGems`, `GEM_LIFE`; adventure.ts `noteSpill`).
- **When**: the current carries him onto a river stone on frame 217 (hit method 0x802710C8 for each Link: damage 1, hit
  type 4); state 15 for 33 frames; on frame 251, his first back in the swim (state 74), 0x802796B8 (called from the
  hurt state's end, 0x80287754) drops the gems: +0xC04 301 → 293 at once, the HUD counting down one a frame.
- **How many** (0x802796B8, by the hit type kept in +0x11E4): types 4 and 7 → 0x8024E46C: 5 + rand(5) (here 8); 5 and
  8 → 0x8024E3D8: 20 + rand(10); 6 and 9 → 0x8024E344: 50 + rand(20); others none. On a GBA screen (+0x3B4 ≥ 8)
  exactly 5, 20, 50. The skips: a Link grouped with others under another's control (+0xD60 ≥ 0, mode 4 from
  0x802486A0 and not its group's own) drops none; the followers of a game alone hold no gems anyway.
- **The drop** (0x8024E694(link, worth, round)): at most what he holds (his +0xC04, or his group's 0x80236228), taken
  off it; a `GOLD` at his place and height of params = the worth (kind 0: the burst, `RUPY`s worth it, as Phantom
  Ganon's), kind 6 when he's in state 81; on a GBA screen the worth rounded down to one gem's (1, 5, 20 … 3000) and a
  GOLD of kind 4 (that gem; 7 in state 81). The death drop (0x80277F98) asks it for 2000, the hit method's
  0x802710C8 for 100 rounded (not traced).
- **The gems**: eight green, flung from his place at 2-4 px/frame up; two rose past him and were taken coming down at
  about 4.8 px (not at 7.2 px); one fell in the pool: below 4 px over deep water (0x8032B0A4, surface 13) a gem sinks
  0.1 px/frame (state 6, +0x24C = 30) and went 27 frames after; the five on the bank lay (state 1) and went on frame
  1080: RUPY's init sets +0x24C = 830 (1010 with several players), counted down while it lies, gone at 0.
- **Shadow Battle**: no Force Gems are held there (the orbs' table 4 has no gem), so nothing spills; the battle sim is
  unchanged.

## Adventure: Tingle's Tower and Hyrule Castle, loading them
The stage pokes that load the Cave of No Return (stage 0x80529F08 = 1, gs + 0x58 = 1, byte gs + 0x84 = 1 from
`ref/save-lake-hylia.sav`) load Hyrule Castle with 3 (`ref/adv/w1-boss013-start.sav`: the Links on its `PLAS` starts,
room 0 (256, 344)), but with 2 the Links stood at (48, 64) of a cell (2, 9): `boss200` (above, "Tingle's Tower in Dolphin").
- **Hyrule Castle room 0:** walking up the path, the Links stopped at y 72 while the owl (`KEPO`, params 0xA0500190)
  flew in and talked (message 0x190 + 0x12B = 0x2BB, in the dark message window with the P1 badge, a page turned per
  A); once read they walked on into room 1.
  Re-traced 2026-10-10 (`ref/adv/w1-boss013-start.sav`, walked up with 120 frames of up, as `w1-013-room1`'s json): the
  Links came up at 1.5 px a tick and stopped at room y 204.5 (the sample at frame 106), the leader's animation frozen from
  the next tick (its sprite frame changed to 63, a standing pose) while the other three stood behind it, to the end of the
  run (frame 252). The y 72 stop above didn't reproduce from this start. The owl's box wasn't seen (its flight in, the
  box's first tick and the pages' timing are not measured). The sim stops the leader at y 204.5 (dialogue.ts `startOwlTalk`).
- **Room 1:** the gate is shut (the `SPBG` drawbridge), two bow soldiers on the walls; the crystal sits inside the
  walls (`ONOF` (320, 80)).

## Hyrule Castle: a Link thrown across area 6's gap, the drawbridge, room 2's spikes
From `ref/adv/w1-013-room1c.sav` (stage data [[[0x8053AAF8]+4]+0xC] = 0x8113B244 in this state, so room 1's switches
are at 0x8113B4B0 and room 2's at 0x8113B488); `--tele 5:880:2462` (room 1's (368, 152)) drops the Links down the
walls' hole into area 6's top room (136, 104.8). Dolphin user folder: a copy of `ref/dolphin-user-adventure2`, GDB 55200.
- **Area 6's gap** (x 112-127 between the two ledges at y 264.8): walking off either side the Link drops at once into
  the room below (his anchor past the edge: no foot width); there is no other way onto the left ledge from below.
  Walking right off the left ladder's foot (x 39.7, y 216.8) he hangs on to x 54.7, then falls onto the left pots.
- **Formations do nothing** in a side view (C left/right/down/up: the four stayed stacked); **X** leaves the others
  where they stand without the TV's step away (stacked, they stayed stacked: frame 451, facing down).
- **Lifting a Link** (R, the Action button): one 1 or 3 px ahead was lifted (one on the very same spot wasn't: an empty
  lift, state 17 for 22 ticks); A (the item button) never lifts. The lift plays as the battle's (held 16 px ahead at
  z 2 for 16 ticks, 12 ahead at z 10 for 8, on the head at 18 then 20; carrier state 17 then 18 from the 26th tick);
  carrying walks at 1.25 px/tick. **The throw** (R again; carrier state 22 then 23): behind at z 17 for 7 ticks, over
  him at 19 for 2, 22 for 1, then off at 3.3 px/tick from z 18, z falling 0.25 more each tick (18, 17.75, 17.25, 16.5 …
  1.5, 1.0, 0): 14 ticks, 46.2 px, his y unchanged, also over the gap (thrown from the right ledge at x 137.7 he
  crossed it level). He hit the left ledge's pot at x 103.4, came back 1.7, 1.6, 1.7 px a tick and landed at 108.4,
  then stood waiting (state 0, frame 451, facing down); the carrier stood again the tick after.
- **The drawbridge:** room 1's switch 16 poked on, `SPBG` set 17 121 ticks later.
- **Room 2:** walked in from room 1 (switches 16 and 17 poked open), the Links stood held while the camera showed
  the soldiers marching into their ranks; the bottom spikes, down as they came in, were up ~80 ticks later. Room 2's
  switch 16 poked on brought the chest (the `PNPC`s' 0x30 under the captain) but left the spikes up 300 ticks on.

## Hyrule Castle rooms 5 and 6: the bow, an arrow through a door, the tower, the iron-ball soldier
Traced 2026-10-09 (a copy of `ref/dolphin-user-adventure2`, GDB port 55220; savestates `ref/adv/w1-013-room5-gatehouse`
(area 2's top), `-room5-bow`, `-room5-channel` (17 on, on the TV below the gatehouse), `-room5-tower` (area 5's
bottom), `-room5-key`, `-room5-launch`, `-room6`, `-room57`, not committed). In this lineage the stage data is at
0x8113B244: room 5's switches at 0x8113B464, room 6's at 0x8113B438. In a GBA-screen area the Links' positions and
`--tele` are area px; on the TV, world px (room 5's TV at (1024, 1536)).
- **The gatehouse's pedestals** (room 5 area 2, tiles 0x017 at (32, 32) and (208, 32)): R facing the left one gave
  item 8 (bombs) to all four, the right one item 4 (the bow), the pose (player_sob 233…236) and the item 97 ticks
  after the press; the top layer over each shows 0x27 + the item's number (0x2F, 0x2B; the Cave of No Return's lamps
  0x29, Lake Hylia's boomerang 0x2A). The Item button (A) facing a pedestal while holding an item: "You dropped your
  item! You're lighter," and +0xC10 went to 0.
- **The arrow through the door:** from (128.2, 72.7) facing down, the bow's pose from frame 61 (A on 59), the arrow on
  the pose's 7th tick flew over the pit, through the south door's warp, and lit the crystal on the TV (`ONOF` (352,
  192)): switch 17 on frame 87, 20 ticks after it left the bow; then 17's PNPCs bridged the pit (walked over, frame
  160, out on the TV at (368, 176.5)).
- **The cracked wall** (`DOOR` kind 2, (80, 256)): walking up into it at x 96 the Link was held at y 279 (pushing,
  state 13). A bomb flower's bomb (lifted facing up from (24, 312), carried, thrown up from (96, 289)) went off 300
  ticks after the lift (the Link, 24 px away, knocked back); walking up from y 290 he then went through at y 263 into
  area 5 at (32, 489). The blast also burnt the grass around (Force Gems).
- **Area 5 (the tower, a side view):** along the floor, up the ladder (x 217) to y 293, off it to the left: falling,
  steered left, caught by the cannon (160, 416) at frame 300 (state 76, 16 px over it, the others too). A (frame 325):
  shot up (state 77), steered left (0.8 px, +0.1 a tick, 1.6), held at x 119.3 by the wall over the niche, the top at
  y 55.75, down into the niche, landed at (104.9, 168.7) and pushed left against the chest (103.4). A facing it (the
  side): the chest's pose (240) from the 17th tick, its message closed by one A, then the key carried (state 18).
  Carrying it, A threw it (state 24); in a cannon A fired him (state 77, sprite 877), key and all. Off the passage's
  end (x 64, y 296.6) holding left he fell into the shaft's cannon (40, 336) at x 50.9; A: up out of the top (`WARP`
  (32, 0), style 0x16) at y 18.25, 15 ticks later on the TV in the hole (96, 32) at (104, 40), still (z 1.2) 59 more
  ticks, then flying: z +7.0 px the first tick, 0.25 less each tick (102.8 at the top), falling at most 6, down 58
  ticks later. Steered (down-left) from the flight's second tick at 0.57 px, +0.1 a tick, up to 1.6 px a tick on each
  axis, stopped by walls; he came down at (39.1, 102.9) by the ledge (row 112). Not steered, he came down in the hole
  and fell back into area 5 (40, 8).
- **Room 6's iron-ball soldier** (`SLR3`, 0x80000000, at (256, 48) behind the gate; vtable 0x804A0810; scanned
  0x813C0000-0x813F0000): with room 6's switch 16 poked on (frame 2) it walked from frame 4 toward the leader (+0x3C,
  +0x40: 0.090, 0.153, 0.197, 0.228 … 0.300 px/tick, eased 3/10 a tick, turning as he moved), +0x230 0 all along
  (600 frames, never near him; +0x238 counts 9…0 over and over).
- **Room 57 → 9:** with room 6's switches 16, 24 and 25 poked on, up the courtyard into room 57 (256, 319); moved to
  (440, 300) and walking right he went into room 9 along room 57's lower band.

## Hyrule Castle room 58's area 2: a Link thrown over the pits, the second escort Zora
Traced 2026-10-09 (a copy of `ref/dolphin-user-adventure2`, GDB port 55301) from `ref/adv/w1-013-room57.sav`:
`--tele 5:540:1068` and walking left into room 58 (`w1-013-room58`), `--tele 100:376:918` and up through the tower's
door (384, 128) into area 2 (`-room58-area2`; then `-thrown`, `-switch17`, `-area3`, `-zora`, `-gathered`, not
committed). Stage data 0x8113B244 in this lineage: room 58's switches (cell (0, 2)) at 0x8113B40C. Area px below.
- **Area 2 is dark** (`VWMD` 0x8000002): only the Links, the pots near them and the Zora are drawn.
- **The pits** (tile type 0x03, y 144-159 across the lane's top): walking up the lane the leader stopped at y 152,
  fell (state 30, ~60 ticks) and came back south of them at (160, 168) (state 31).
- **The throw:** X (the others stepped away to (168.6, 184.9), (159.1, 184.7), (151.1, 183.8)); the leader at
  (160, 177) took 3 ticks down (180) and R lifted the Link below him (state 17, the held one 2 px ahead at z 2, then
  z 10 and 20); Up 6 ticks (172.5) and R threw him: he flew level up the lane over the pits (z 17.8 at its top) and
  came down at (160, 129.6) on the sunken floor 30 ticks after the press, ~43 px on, then stood waiting.
- **The switches' room:** the D-pad (right) handed the controls to the thrown one: up the stairs (x 144-175, y 80-111:
  0.75 px/tick on them), along the top ledge (y 41.5) to x 216.8, where a pot stood on `SWTH` (224, 32); R facing
  right lifted it, thrown left (a heart); walking right, switch 17 came on with him at x 228.8 (the switch tile's
  middle) and stayed on when he left it (latched). The top `DOOR` (144, 16) was open: up through it at x 160 into area
  3 at (128, 136).
- **The Zora** (`FAZR` (120, 40), its position at +0xC/+0x10 as f32, vtable 0x8049DF78): walking up area 3's
  corridor the Link stopped at (128, 86), 46.7 px from it, and its talk began (it holds him; ~16 A presses, ~330
  ticks); then it stood 11.6 px below him and followed him 16-22 px behind (at his pace, the stairs' too), into area 2
  (it appears 16 px behind him at the door). North of the pits it stopped at their edge (y 137) as he stood at 128.8.
- **The way back:** the D-pad (up) handed the controls to a Link south of the pits, Y: the Link north of them dashed
  straight over the pits onto him (6.5 px/tick, frames 268-275, no fall); the Zora stayed at the pits' edge (it was
  47.7 px from the Link). Walking off down the lane (the one in control 49 px from it) it dashed straight over the pits
  after him (5 px/tick, 157 → 172 → 178) and then walked behind him, out through the lane's bottom door with the
  Links onto the TV, at (384, 120) behind them (384, 136).

## Hyrule Castle room 10: the throne, the curtain, the cannons
Traced 2026-10-09 (a copy of `ref/dolphin-user-adventure2`, GDB port 55411) from `ref/adv/w1-013-room57.sav`: room 57's
switches (0x8113B410) poked to 16, 24, 25, `--tele 6:768:820`, up the lane into room 10, its switch 16 (0x8113B3E8)
poked, up through the door into area 2 (`w1-013-room10-area2`: the Links at (256, 189)); then `-room10-throne` (the
four in the long formation left of the throne), `-room10-pushed` (pushed). Area px below.
- **The throne** (`STBL` (256, 64), 0x3000; live at (256, 80) as its position, (320, 80) once pushed): walking up the
  middle the leader was held at y 102.3 under it (alone, pushing, it didn't move); the four in the long formation at
  x 209.5 (y 39.25 … 87.25) holding right: walking from frame 7, held at x 218 from 12, pushing (state 13) from 33,
  moving with it (state 14) from 34 at 0.2 px/tick: 218 → 229.8 (frame 92), still 12, → 245.8 (182), still 12,
  → 261.8 (272), still 12, → 281.8 (382), then nothing more (64 px). The Links take its steps 0.5 px at a time.
  The two `AMOS` (kind 0, ±12 boxes, life 16) stayed asleep with the Links up the middle (x 256); round the side at
  x 201 one woke and hurt the leader.
- **The curtain** (`DOOR` (240, 16), 0x88: kind 8, side 1; its box (244, 20)-(260, 36)): walking up into it at x 256
  the leader was held at y 39 (also at x 257.8, against the opening's edge). A sword swing up (B) from there: on the
  swing's first tick (state 4) the door went from state 2 to 3, then 5 (open, for good); walking up he went through
  (state 28) into area 7 at (208, 504), walking out up to 484. Its update's state 2 (0x802C6C60) asks 0x8023B8E4
  (each Link: 0x80274238, his attack meeting the box) and opens when one does.
- **Area 7's cannons:** teleported over the upper cannon (168, 224) the leader fell into it (state 76, at (168, 208));
  A shot him up (state 77): 13 px the first tick, 0.25 less each; out of the top's warp at y 12.3 (frame 327, the
  last step 8.75); the next frame he was in area 6 at (168, 504), held there 20 frames (328-347), then on up 8.5,
  8.25 … (495.5, 487.3 …), at the top y 356 (frame 384), down at most 6 px/tick into the bottom hole (504, frame 418:
  state 30, falling), 17 frames later at area 7's top (168, 8) (state 31), then down at 4 px/tick back into the cannon.
- **Not reached:** room 11 from room 10's walkway by teleport (the leader held at the room's top edge, y 400 world,
  the followers stuck behind the walkway's wall: the camera keeps the four on screen).

## Who a hit can reach: the group of four (Dolphin, 2026-10-31)
Read in main.dol and traced from `ref/places/castle-room10-area2.sav` (`5 idle; 24 left; 240 idle`, `--break` on
0x80238548, 0x802710C8's call and 0x80236468; `--link d60:4 --link 1224:4`).
- **Groups:** +0xD60 is a Link's group leader (−1 for the leader himself; 0 for the three followers in a game alone),
  +0x1224 on the leader the group's Link in control (0 at first; the D-pad steps it: 1, then 2, traced). 0x80240808
  is "follows someone", 0x80240644 his leader, 0x802486A0 the group's size, 0x80248778 a Link's place in it (0 the
  leader, then the followers by index), 0x8022E438 "in one group".
- **The touch test** (0x802732C4, an actor's box against a Link's body, as 0x801F2B7C asks it for each Link) and **the
  hurt** (0x802710C8) both refuse, in a group of four, every Link but the one whose place is the group's +0x1224;
  then the usual refusals (0x80270ABC: +0x464, +0x468, dying, ...). So only the Link in control is ever touched.
- **The hurt's spread** (0x80238548(victim, damage, &source, type)): each Link in the victim's group gets 0x802710C8,
  the source moved by his offset from the victim; the damage comes off only on the victim's own call (0x80236468:
  the leader's life, every follower's copied from it by 0x80270D34). Then every follower's life is copied again.
- **Traced:** the Armos's three hits (frames 93, 162, 238) each called 0x80238548 for Link 0 only (2 damage, type 1),
  though the followers stood stacked on him at 162; the hurt ran for all four Links and the damage once (0x80236468
  for Link 0); the followers' +0x464 stayed 0 and they never went to state 15.
- **The enemies' target** (0x801EEC98, the nearest Link and its other modes): each Link is passed over when not in
  play (+0xCAC), +0x454 set, in state 73, dying (51, 52: 0x80270A8C), on another kind of screen (TV / GBA), or when
  0x80240670 says so: in a group of four every Link but the one at the group's +0x1224, in another group every
  follower (+0xD60 ≥ 0). No invincibility nor height check. Traced (`actor-trace.ts --ids AMOS`, the same clip): the
  Armos aimed each hop (0.5 px/tick, re-aimed every landing) at the leader through his knock-back and his 60 ticks,
  never stopping, and hit him as soon as its box met him (box ±12 against ±7: 18.6-19 px across). Its hurt came from
  its box's middle, its height off (0x801F2B7C: y + the box − z), 7 px up its hop at the first hit: the leader was
  knocked 40° down from level where its feet would have given 24°.
- Not read: Links apart (X didn't part them from this place).

## Hyrule Castle room 11: Phantom Ganon
Traced 2026-10-10 (a copy of `ref/dolphin-user-adventure2`, `ref/dolphin-user-adventure-ganon`, GDB port 55433;
`actor-trace.ts` scanning 0x81380000-0x81420000 for `FGAN`, `GOLD`, `RUPY`). **The way in:** from
`ref/adv/w1-013-room10-pushed.sav` (the four left of the pushed throne in room 10's area 2): down out of the throne room
(`5 idle; 150 down; 17 left; 250 down`) onto the TV at (256, 268), then `--tele` every 3rd frame from 455 to 518 to
world (768, 448) (room 10's walkway, (256, 64): teleported every few frames the followers stay on it too, where one
teleport left them behind its wall), `150 idle; 66 up`: north into room 11 at (256, 332). Saved as
`ref/adv/w1-013-room11.sav` (frame 645; its .json notes the teleports). Room px below; frames from that state (`s1080`:
a state saved at its frame 1082, the ball raised); pokes: his rally +0x278 = 0x813C55D8, his state +0x230 =
0x813C5590, his HP +0x26C = 0x813C55CC (his object at 0x813C5360, the ball's at 0x813B3B60); room 11's switches are
the u32 at 0x8113B3C0 (stage data 0x8113B244 + 0x178 + 4).
- **Placement:** `FGAN` 0x2000 at (256, 192): he stands there (z 0), his home (+0x2A0) 16 px below, (256, 208).
- **The intro:** the camera on the room at frame 23: state 1, +0x254 counting to 101, then +0x250 to 300 (frame 421:
  state 2), shown by frame ~470 (alpha +0x290 255), state 3 for 100, 4 (the swing) at 574, 5, 6/7 at 659 (z → 40).
- **Hovering and the dash** (the Links idle at the bottom): wander 2 px/tick; the dash from (251.85, 268.78) at frame
  954: 12, 11, 10, … 3 px a tick (13 − 1, slowing 1 a tick), then ×0.7 (2.09, 1.45, 1.02 …): ~84 px; the Links lost 2
  (life 8 → 6) on the update into frame 957, him 21.7 px above the leader (z 38).
- **His rise and the ball:** state 12 rises at 4 px/tick until y ≤ home − 60 (stopped at 144.5); the ball (`FGAN` kind
  10: +0x90 = 0xA, boxes ±7, ±7, ±2) raised at (x − 20, y − 110), batted 40 frames later at the leader at 3 px/tick
  (z 1 all along). Unreturned at the leader it met him: −2 (life 6 → 4), 60 frames safe, the ball gone.
- **Returns** (B pressed 2 frames, the leader facing up): returned on the swing's second tick, the ball 35.5 px above
  him (the sword's up box to −32 and the ball's ±7); a return keeps the ball's speed (3.00 the first, 3.26 the second)
  aimed at (x, y − 8 − z) (direction within 0.6° of it), +0x238 = 30 (no other return for 30 ticks), +0x23C = 100;
  the rally +0x278 + 1. His bat after it: 3.26, then 3.78 px/tick (3 + 0.26 × returns so far), ±2048 off the leader
  alternating (first 0: −11.4°, then +11°). The ball's +0x238 stays 0 after his bats (returnable at once); +0x254
  counts from his bat to 51 and isn't reset by a return.
- **His catch** (states 16/17, the returned ball, pre-move positions): caught at (−6.0, +5.2) and (−14.5, +6.7) from
  his place on the ground (his z 43, ignored); not at (−6.4, +8.2), (−15.4, +9.9): x within ±14.5 at least, from below
  up to ~8 px under him (the sim: (−16, −40, 16, 8), its top assumed). Caught with the rally at 4 (poked): state 18 on
  the next update.
- **Left alone the ball bursts** (the leader stepped aside, `20 idle; 25 right`): flying on through the bottom wall,
  at y 400.5 (frame 152 of the run, 121 after his bat; > 50 flown) it burst: 16 px past the screen's edge (main.dol
  0x801F6758: the view rectangle grown by 16). Seven shards (kind 11, ±2 boxes) at 5 px/tick, 22.5° apart, the middle one
  at the leader (−60.1° to him, −60° traced); they fly through walls and past the room, 78 frames (152-229), the one
  that met the leader gone with −2 (life 6 → 4). The rally +0x278 back to 0.
- **Struck down** (state 18 → 19, the Links held 30 frames: 'up' pressed from frame 190 moved the leader only at 218):
  z → 0 at 3 px/tick then ×0.7 (0 at frame 243). Down (state 20) for 400 ticks (+0x250 to 401, state 21 at 619;
  back to 6/7 at 637-638).
- **The sword on him, down** (`--place` puts him at the leader + (dx, dy) before each swing, facing up): met at dy
  −64, −56, −44, −24, +8 and dx ±20 (dy −24); not at dy +20, +28, +36 nor dx 28: his body is (x ± 16, y − 8 … y + 40)
  on the ground (his first init box, (−16, −8, 16, 40)). Each blow 4 (+0x108 = 9996: damage 10000 − it); HP 210 → 206
  → … Swinging every 16 frames, every other swing missed: +0x254 (open to the sword) goes 0 on a blow and his hurt
  (dawn) frames restart from the first, the frame's own tick count left running (4, 4, 4, 2-tick frames, then the
  last): open again a tick into the last frame, 15-21 frames after the blow; 11 blows in one fall (44: the 75 that gets
  him up early not reached by one Link's swings).
- **Force Gems (`GOLD`, vtable 0x804AB660, init 0x8032A7B8, update 0x80329640):** his fall (state 18) spawns one at his
  place and height (frame 188: (258.24, 144.5, z 43.21)), params 99 (+0x238 = 99 = the worth, kind (p >> 16) & 15 =
  0), if his count +0x260 < 2 (the first two falls; main.dol 0x8017D6C8); it lives one frame and makes `RUPY`s: 99 =
  5, 5, 5, 50, 20 and fourteen 1s (19 gems; the second fall: 22 gems, 99 again). Each gem from the GOLD's place:
  (vx, vy) each (−1, 1] px/tick, vz 2-4 (1.81-3.59 seen after the first tick), z += vz then vz −= 0.3 a frame; it
  lands (z 0) and stops: e.g. one from z 43.2 up 2.11/tick and 0.5 px/tick across landed 27 frames later 13.5 px
  over. The worth's split (main.dol): up to 100 tries, the largest type (cap 11, kept lowered) not worth more than
  what's left, a random type 0..it, below 20 left a 1; taken off what's left.
- **Beaten** (HP poked to 4, one more blow): state 23 at once, z up to 39.15 (10 px/tick then ×0.7), then still for
  300 frames (the bosses' death, main.dol 0x801F4E0C: +0x188 = 300, effects 106-109); the Links walk about meanwhile
  (not held). Gone at frame 1170 with a `GOLD` worth 80 at his place, z 39.15 (19 gems: 0x801F4A9C, the bosses'
  death drop). Room 11's switches: 0x40000 (18) on from the start; 17 on 3 frames after he went (`ZNSW`), 16 on 320
  frames later (`WTSW`: the staircase), 18 off with it.

## Hyrule Castle room 58: the cross formation's spin on the four crystals (Dolphin, 2026-10-11)
Applied (2026-10-12): `packages/sim/src/adventure/whirl.ts`, hyrulecastle.realdisc.test.ts replaying the trace below.
Traced from `ref/adv/w1-013-room58.sav` (a copy of `ref/dolphin-user-adventure2`, GDB port 2350; room 58's switches the
u32 at 0x8113B40C; world px = room px + (0, 768)). Script `10 idle; 3 c-left; 20 idle; 62 B; 60 idle`, `--tele 5:x:y`,
`--link 458:4 --link 4a0:20`. Crystals (`ONOF` kind 2, 31 frames): switch 5 (200, 280), 6 (264, 280), 7 (200, 344),
8 (264, 344) (their tiles' middles, room px); the diamond's middle C = leader + (0, 16).
- **The cross formation faces out:** the leader up, the left Link left, the right one right, the bottom one down (the
  sim turns the followers to the leader's facing). B in formation: all four swing (state 4), charge (8) and, let go
  after a full charge, spin (9) together, each with his own facing's boxes.
- **The spin in cross formation is a whirl** (state 9 for 34 frames, not the battle's 26): frames 1-10 the leader
  stands and his boxes turn as the battle's spin (attacks.ts `spinDir`); each follower dashes (6 px/frame, straight,
  through the middle) toward the circle of radius 16 round C at the angle of his own box direction (the leader's + his
  place's: left 270°, right 90°, bottom 180°, clockwise from up), the two side ones crossing (they jostle there: frames
  3-6 off that line). From frame 11 all four go round C on that circle, 15° a frame clockwise (the leader from up),
  back on their places on frame 34; each one's box direction is the 8-way nearest his angle, the boxes placed where he
  stood the frame before (they trail a frame, as the lunge's). Then state 0 in the cross again.
- **The crystals' hit box for the sword is ±5 px** (main.dol, ONOF update 0x802CB230: a ±8 box goes to 0x8023AE34 →
  0x802576CC, the Link's three boxes at +0x4E0 (not the sword; what they are: unknown), then a ±5 box to 0x8023BA68 →
  0x80273C30 → 0x80274238 → 0x802738F0, the sword's two boxes at +0x4A0 while +0x458 = 1; the Link's room +0x3B4 must
  be the crystal's). The traced lighting frames fit ±5 (and ±8 a frame late too; the code settles it).
- **From the route's spot** (leader (232, 296)): 5, 6 and 8 lit on whirl frame 5 (by the right Link's, the bottom one's
  and the left one's outer boxes while crossing), 7 on frame 14; 9 (`SWT4`) the next frame, 16 (`FOCS`) 12 frames
  later; everything (the Links too) stood still 16 frames from 9's frame (the camera's event, not simulated).
- **The jostle** (re-traced 2026-10-12, same script, `--raw 8113B40C:4`): on frames 1-2 and 7-10 each follower's step
  is exactly 6 px toward his point; on frames 3-5 the three cross the middle with 6 px steps turned toward an axis
  (the left one's (5.98, 0.47) for (5.55, 2.30)), on frame 6 a 1.76 px step (held); on frames 11-13 their steps are
  6.6-6.9 px while they stand ~13.2 px apart (pushed off one another: assumed), on the circle from frame 14 (±0.05 px
  after). The game's whirl positions drift by up to 0.05 px from the exact circle.
- **Forgiving:** all four lit (9 on) from the leader at (232, 293), (232, 299), (229, 296), (235, 296), (232, 288),
  (232, 304), (224, 296), (240, 296) (x ±8, y ±8 px); not tried further out.
- **What broke the first tries:** the charge ended 14 frames in (state 8 → 0, B still held) whenever the Links stood
  near the crystals 100+ frames after arriving: the minor Shadow Link (`ZSLJ`, (368, 304), not simulated here; Lake
  Hylia's is, adventure-lake-hylia.md "The minor Shadow Link who jumps": 368 − 242.8 = 125.2 px, one of his jumps by
  the numbers) came up
  and the bottom Link's charging sword met it (watched with `trace.ts --watch`: 0x802721A8 sets +0xCAE, the charge's
  update 0x8027C4B0 ends on +0xCAE/+0xCAF; ZSLJ's object at 0x813C0760 then, at (242.8, 304)). Charging soon after
  arriving (the script above) beats it.
