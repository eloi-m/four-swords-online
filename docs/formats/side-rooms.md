# FSA formats: side rooms (GBA screens)

Part of the FSA file-format notes (index: [../formats.md](../formats.md)).

### Side rooms (GBA screens) (implemented in `packages/sim/src/siderooms.ts`, `apps/battle/src/siderooms.ts`)
Measured in Dolphin where marked (docs/measurements/side-rooms.md "Side rooms"), else read from main.dol or the stage files.
- **confirmed** (files, code, Dolphin) The side rooms are the battle rooms' own GBA sublayers 1–7 (tile layers
  `_mmm_G_V` with V ≥ 1 and the actors whose byte 4 is V), shown on the GBA of whoever is inside with the `_gb_`
  palettes. The game keeps them as **screens** of the same room: an actor's screen is 0 (TV) or 7 + its sublayer (the
  house of The Field = screen 9); the Link's screen is **+0x3B4** (not a collision pointer, as once guessed); the stage's
  runtime tile map `[[0x8053AB10]+0x20]+0x28 + 4·screen` points at each screen's base layer (screen 9 = the house's
  tiles, read in RAM). GBA screens have their own origin (stage data +0xDC, (0, 0); the TV's +0xCC, (512, 384)): a Link
  in the house is at (80, 116), not near the arena. The room's 32 switches are shared by all its screens (traced: the
  Tower of Flames north room's floor switch set bit 14 of the TV room's switch word, 0x81255ED4 in these states).
- Which sublayers have tiles, and what each is:

  | Room | Sublayer | What | View | Way in → way out |
  |---|---|---|---|---|
  | 0/5 The Field | 2 | the house (160×160 px) | top-down | the house door (TV WARP (248,160), style 25) → down out of its door |
  | 0/5 | 5 | the cave | top-down | the cave mouth (TV WARP (136,80), style 25) → down out |
  | 1/6 Tower of Flames | 2 | north room | top-down | the 3 north doors (TV (216–280,72), style 0, walk up) → its 6 door warps (style 1, walk down) |
  | 1/6 | 3 | south room | top-down | the 6 south door warps (TV (216–280,296/312), style 1, walk down) → its 3 top doors (style 0) |
  | 1/6 | 5 | the basement | **side view** | the two side pits with `BLDF` covers (TV (112,160), (384,160), style 4: fall) → the ladder tops (style 3) or the top edge (style 19, ±256 px) |
  | 2/7 Tower of Winds | 1 | the tower's gallery, full size | side view | the 4 gates (`SVGT` next to TV WARPs (56/440, 176/272), style 21) → the same gates back |
  | 3/8 Hyrule Castle | 1 | the dark castle, full size ("the Dark World") | top-down | a magic circle (`CIRC`: its update 0x8028AE2C warps with style 20 to the params' destination in s1) → the WARP at its middle (style 6) or 600 frames later, back over the circle (measured) |
  | 3/8 | 2 | no room: one `ONOF` at (0, 0) | – | a logic placeholder (lit at the start with 2 players: switch 28) |
  | 4/9 Above the Clouds | 2 | under the hole | side view | the middle hole (TV WARP (240,160), style 4) → a cannon (`CNON`) shooting up through the top edge (style 19), or the ladder (style 3) |

- **confirmed** (code: init 0x80228B60) WARP params: destination screen (p >> 24) & 7 (0 = TV, else sublayer), destination
  ((p >> 16) & 0x3F, (p >> 8) & 0x3F) × 8 px in that screen, style p & 0x7F, bit 7 (no centering), gate p >> 27 (the warp
  works only while that switch is on). Styles 4, 6, 32, 36 with no destination lead to the same spot of the other
  screen. Styles **25–28** add their way back at init: a WARP at their (raw) destination leading to their own position,
  of style 1, 3, 0x18, 0x17, and become 0, 2, 0x17, 0x18 (The Field's house and cave). Unless bit 7 is set the warp sits
  8 px right and down of its listed position (its tile's center) and so does its destination. Its box around that
  (init 0x802290A8): 0 and 3 (−4, −20)–(4, 4) (a door walked up into), 1 (−4, −4)–(4, 20) (walked down into), 4 ±1 (a
  hole), 6 ±0.01, 11 ±8, 15/22 ±24 × ±8, 19 ±256 × ±8 (a side-view room's top edge), 21/35 ±4 on a side-view screen
  (stage +0x131DF[screen], set by the loader 0x802D4CCC when the screen's layers have a tile of type 0x02 or 0x3B),
  else up into it on the TV and down on a GBA screen (35 the other way), 32 ±10, 40 ±7, the rest ±4. A warp whose
  own tile is type 1 or 0x21 (solid, a bush) does nothing (0x802265FC). Styles 25–28 also make the reverse warp's
  params from the parent's.
- **likely** (code: GameCube 0x802E055C, 0x803085A4; the GBA client `Agb/client_thread.arc`, LZ77, read only; not seen
  in Dolphin) A screen's top layer (group 2) is the GBA's BG2 (map 0x0600C000, priority 2) over the base layer's BG3. A
  `VWMD` on the screen with params bits 12-13 set (its top mode, held while its switch params >> 27 is on, or always)
  makes the GBA alpha-blend BG2 over BG3, the sprites (put at priority 3, under it) and the backdrop (BLDCNT 0x3844):
  EVA/EVB 8/15 in mode 1 (the adventure's underwater areas: their top layer is the water, seen through), 0/14 in mode 2
  (Lake Hylia room 5's area 2: its top layer, the filler tile over the half under the bridge, only shades it to 14/16).
  `packages/sim/src/adventure/logic.ts` TOP_MODE_BLEND, drawn by apps/game and `tools/render/src/room.ts`.
- **confirmed** (code: update 0x80227F50, 0x802278A8, the Link's 0x80290070) The update runs per player 0–3 after the
  players moved: the Link's ±7 px body box (+0x4C0) must overlap the warp's box (inclusive) on the same screen, his z ≤ 8
  (not on side-view screens), and he not be dying, held, warping already (+0xCE8)…; a carried thing is dropped at doors
  (styles 0–3, 23, 24: 0x802381B8) but falls with him into a hole (style 4: 0x802348C4). A per-player latch (+0x234[i])
  is set while he's inside the box during a warp of his own (arriving in a doorway), cleared once he's more than 1 px out
  of it. Things fall through holes too (styles 4, 32, 36: the actors listed at 0x8046AC2C, HBMB, BOME, STON, GRAS, TUBO,
  YASI, RUPY, HNRY, ESRY, SBAL, within the box, moved to the destination by 0x801F349C; styles 6, 11, 20 the list at
  0x8046AC20, HNRY and ESRY; the other styles, doors included, the list at 0x8046ABE8, ARRW, FIRE, HBMB, BOME, STON,
  GRAS, TUBO, YASI, HNRY, ESRY, PCDM, SWBM, SBAL, through 0x80227290 with a 32.0: **measured** since, a thrown bomb, a
  pot, an arrow, a seed or a boomerang going into a door or a hole ends up in the side room, and back up its top edge:
  docs/measurements/battle-open-items.md "Shadow Battle's open items, traced"; siderooms.ts `thingWarps`). The Link's warp (0x80290070) stores the destination (+0xCD4), screens (+0xCE0 from,
  +0xCE4 to), style (+0xCF4) and the pending flag (+0xCE8), and starts a state by style: **28** (doors 0–3, 21, 35,
  lined up on the door's x; 23/24 on its y), **30** (holes 4, 7–9, 32, 36: moved onto the hole), 32 (5), 34/36 (6, 11, 20,
  31: at once), 38 (14, 37), 40 (15), 42 (10), 44 (29), 46 (30), 48 (39), 50 (12, 13, 38), **77** (19, 22: launched).
- **measured** A door (styles 0 and 1, The Field's house and the Tower of Flames' north room): the overlap starts it
  (the house door took P1 at y 178, his body's top 171 ≤ the box's bottom 172); state 28 lines him up on the door and
  walks him 0.5 px/frame along his facing for 39 frames (through the door's tiles), the walk cycle at 2 frames per
  frame; on the 40th he's at the destination, on the other screen, in state 29: 30 frames standing (the cycle's first
  stride, frame 16 facing down), then 40 frames walking 0.5 px/frame, and control on the next frame (111 frames from
  the trigger). He keeps his facing: up into the house, up out of its door into it; down out of it, down onto the TV.
- **measured** A hole (style 4, Above the Clouds' middle): the overlap moves the Link onto the hole and he falls (state
  30, 58 frames, sprites 183–188 as a pit fall, no damage), then appears at the destination (152, 8) of screen 9 in
  state 31 for 60 frames, then falls in the side view at 4 px/frame (constant) and lands in the moving cannon below.
- **measured** A cannon (`CNON`, s2 of Above the Clouds): the Link who falls in rides it (state 76) as it patrols left
  and right (1 px/frame, easing at its ends, x 105–200); the GBA's A fires it (state 77): up at about 10 px/frame to the
  top edge (style 19, 25 frames after the shot), then out of the hole on the TV, straight up (z up to 206 px, 9.2 px/frame
  at first, about 80 frames up and 45 down) with no sideways motion without input, and back into the hole if he doesn't
  steer. The sim's speeds are the traced ones (siderooms.ts); TODO(measure): steering in the air (walking speed there).
- **confirmed** (code: CIRC update 0x8028AE2C) A magic circle is open while its switch is on (+0x234) or for 180
  frames after it took someone (+0x238); open, it grows 0.02 a frame (+0x240) to full size, then waits 10 frames
  (+0x248; 120 at init) and takes, per player 0–3, a Link whose body box overlaps its own (±8 px around its listed
  spot; the Link on its screen): style 20 for color 5 (params & 7, Hyrule Castle's: anyone), else style 6 for that
  player only (colors 1–4: none in battle). A per-player latch (+0x252[i]) is set on the overlap and cleared once he's
  more than 1 px out of the box. *Likely* (not traced): mode +0x24C 0 or 6–9 counts its uses and shuts it after the
  last (+0x251); the castle's, opened by switches, never do.
- **measured** (Hyrule Castle, switch 18 poked on) The circle at (168, 168) took P1 walking up 16 px below it, moved him
  onto its middle on that frame and started state 36: the sword raised (sprite 796) 60 frames, then gone (289) to the
  119th, when he's at the params' spot (160, 160) of screen 8 in state 37 (standing, 60 frames), on his own on the
  180th. The TV says "You got 10 Dark World seconds!" (asked by the circle as it reaches full size: "The message window"
  below) and the "10" on the circle is its sprite: CIRC draws enemy_gc_sob 297 + its color (0x8028AB7C), and color 5's
  frame 302 has "10" on it (the players' colors 298-301 don't). Link +0xBD8 (u32)
  counts 600 frames from there (599 on his first free frame); at 0 he goes back the same way (state 32: sprite 796 60
  frames, then standing; on the TV on the 119th at +0xCB0, the circle's spot, 16 px higher (+0xCF2 not set), state 33
  hidden 60 frames, free on the 180th).
- **measured** The WARP at the dark side's middle (style 6, listed (248, 200), out to the TV's (256, 208)): it took P1
  walking down 6 px above it, onto its middle, state 34: spinning (a facing every 4 frames: down, left, up, right),
  rising 4 px a frame from the 60th frame (z 128 on the 91st); on the TV on the 92nd, state 35 for 170 frames: hidden,
  the TV marking the spot (his number and head over an arrow down at it), then (frame dumps) spinning down onto it
  from about the 226th; free on the 263rd. +0xBD8 stopped while he spun and was 0 once he was on the TV.
- **measured** The Tower of Winds' TV screen is side view too: a Link walking off a ledge falls 4 px/frame (constant,
  1.5 px/frame sideways in the air) to the platform below; the floor's type 0x02 makes it so (the loader's flag above).
  The sim plays it so (siderooms.ts `stepSideView`, `sideViewFall`, `fallEntities`; traced cases in
  `dolphin-battle-traces.json`): standing on a ledge (the game's Link jitters ±0.2 px against it), walking off it,
  knocked off it (the knockback goes on while he falls 4 px/frame), Up/Down only turning him off a ladder, climbing a
  ladder (0x61) at walking speed both ways, the sword as on the ground (Up/Down turn it up or down). Things fall at
  0.15 px/frame² (the gallery's bombs, from rest, landing with their ±7 px box on the platform); a pot thrown on the TV
  leaves at its carried height (20 px) as screen y, 6 px/frame sideways, falling the same way. Not measured: the top of a
  ladder (the game's Link goes into his pushing pose, state 13, which the sim doesn't model).
- **measured** (and code 0x802278A8, 0x80294ADC, 0x802948C0) The Tower of Winds' gates (style 21; 35 its mirror): walking
  past one does nothing; a new press of Up or Down (this frame or the last) while the Link's body meets its ±4 px box
  takes him, with no latch; state 28 lines him up on its x, facing up from the TV (down from a GBA screen), and walks him
  into it 0.5 × 1/16 = 1/32 px a frame for 40 frames; on the 40th he's at the other screen's gate, 1.25 px back on the
  41st, stands 30, walks 40 more onto the spot and is free on the 111th, facing down on the TV, up in the gallery. An
  `SVGT` beside each of the TV's four gates (the gallery's have none) only shows its glow (JPA 1095 and 1096, layer −1;
  init 0x803524D0, nothing else).
- **measured** No shelter: at Vaati's time-out a Link in the house went out on the same frame as the one on the TV.
- **measured** Two Links in the same side room fight as on the TV (P1's swing took P2 2 life in the house, the usual
  knockback); a Link in a side room isn't on the TV, and the TV camera leaves him out of its box (with both Links in
  the house it held still).
- **measured** (frame dumps) What the TV shows: a Link walking into a door is drawn walking into the doorway (under
  the top layer), then gone; while he's inside, his HUD portrait is a black disc with a green ring (`ra01`, bigger
  than the portrait) showing his sprite; coming out, from 6–8 frames after he starts walking out of the side room
  until he has walked out of the door on the TV, the TV marks the spot under the door: his head icon, "P1" in yellow
  and an arrow pointing into the door, with a glow pulsing every few frames.
- **confirmed** (files) What each side room holds, and what it drives (the wiring below decoded from the actors'
  params, see "Switches"):
  - The Field's house (s2): a socket bomb on tile 0x85 (type 0x0C), a crystal (`ONOF`, switch 5, timed 384), soldier
    spawners (`GEN3` SLR1 on switch 4, set by the TV's `DOSN` at (256,128): a hammer or boots impact near the house)
    and an enemy-wiped check (`ZNSW` → 12, which re-arms 4). Lighting the crystal (the house's own bomb does it) sets 5:
    the TV's `CKSW`s pulse 8 (10 lit bombs fall at (312–376, 120–184)) and 14 (clearing 7, 8, 14 again).
  - The Field's cave (s5): a crystal (switch 6, timed 384; no bomb there: a Link's own), a cucco (`NIWA`), spawners on
    3 (the TV `DOSN` at (128,64)). Switch 6 pulses 11: `MOZO` ×3 and a `BZBR` on the TV (not simulated), and 15.
  - Tower of Flames north room (s2): the floor switch (144,32) **sets 14, the eternal flames** (kind 0: while stood
    on; traced); ten `GEN3` bombs on switch 7 (room 6: the TV floor switch (112,208), held 384 frames: bombs rain on
    whoever's inside). Room 6's north room has two toggle crystals instead (17, 18): both lit → `SWT4` 21 → `CKSW` 14
    on; both out → 20 off → 22 → 14 cleared.
  - Tower of Flames south room (s3): a crystal (28, timed 320) and a socket bomb: `SWT4` 30 = 28 → **bombchus** (`BMTY`)
    from the TV's edges; ten bombs on switch 8 (room 6: TV switch (384,208)). Room 6: two crystals (28, 29) both lit.
    **measured** (actor trace, switch 30 poked on in room 1): eight bombchus at once from both side walls, x about
    20–75 and 435–490, y about 85–300, each running about 2.5 px a frame in a straight line, a fuse (+0x23C) counting
    down from 299; they were gone 71–332 frames later (*likely* blown up on a wall, a Link or each other: not seen).
    Simulated in `packages/sim/src/bombchus.ts` (main.dol readings: docs/measurements/battle-constants.md "Battle constants from
    main.dol").
  - Tower of Flames basement (s5, side view): four floor switches (3–6, kind 2) driving the 42-tile `PNPC` groups 3–6
    on the TV (its floor turned to lava 0x0D while held: **the lava stripes**); eight bombs on 27 (room 6: the four TV
    crystals 23–26 lit together); two cannons.
  - Tower of Winds gallery (s1, side view): four crystals (8–11, timed 192) → `SWT4` 21 → **`BBSL`, the giant-bomb
    Shadow Link** on the TV (`packages/sim/src/giantbomb.ts`; **measured**, switch 21 poked on: both Links on the TV
    out 1021 frames later; his states, the bomb's and their timings: docs/measurements/side-rooms.md "Side rooms"); bombs on 19/20
    (the TV pots' switches 3/4 → `CKSW` → 128-frame pulses: ten lit bombs fall in the gallery on whoever's there, and
    their blasts don't light its crystals: **measured**). Room 7 adds two crystals (5, 6) → `SWT4` 23 → the TV's 14
    bomb spawners.
  - Hyrule Castle's dark side (s1): two orb generators and two item generators (mask 0x4BF: slingshot, boomerang, bow,
    bombs, Fire Rod, hammer, boots, the Four Sword… the castle's only items), the WARP back at its middle; room 8 adds
    crystals 23, 24 → `SWT4` 25 → bombchus on the TV.
  - Above the Clouds under the hole (s2, side view): a toggle crystal (16): **the fire bars turn the other way**; a
    cannon; a ladder.
