# Measurements: screens in Dolphin (J2D, title sky, round screens, intro/HUD, pause, message window)

Part of the measurements from the real game (index: [../measurements.md](../measurements.md)).

## Renderer checks by RAM pokes (Dolphin, Lake Hylia savestate)
The tracer pokes RAM at a frame while dumping frames (`trace.ts --dump-frames --write <frame>:<addr>:<bytes>`, or
`--fill <frame>:<addr>:<len>:<byte>` for a range), then the frames are compared. Addresses are in docs/formats/runtime-ram.md
"Runtime (RAM) notes".
- **Stage light** (SWEV +0x2E0…+0x2EC and +0x310 set to the Dark Field's tint (150, 200, 255) and level 10): the whole
  frame goes near black and blue (ground, trees, the villagers), the Links and the HUD stay; a Link's hair (255, 247, 41)
  becomes (150, 194, 41): tinted, not darkened. With +0x7F = 1 (playing alone) no light circle shows around the Links.
- **Ground overlay** (filter1's image data, two copies at 0x80B98900 and 0x80BB64A0): the first poked to 0 → every
  ground tile black, the sprites unchanged; to 0xF → exact palette colors (grass 74, 173, 74); the second copy changes
  nothing visible. So the overlay is a plain multiply on the tiles only.
- **Cloud shadows** (SWEV +0x2D0/+0x2D1, the level SWEV feeds the manager's +0x1EC, poked to 255; the manager's frame
  counter +0x1C0 shifted to move the pattern): black cloud shapes over the ground, the villagers and the Links, under
  the fence posts and the HUD. At level 47 (the savestate's) the model fits the Checkpoint A frame (mean luma
  difference 9.95, frame counter 1630).

## J2D screens in Dolphin (screen animations, indirect textures)
Frame dumps compared with apps/screens' 1:1 captures (2026-10-02), to check the screen animations and the indirect
materials (docs/formats/j2d-and-bmg.md "2D screens", "Screen animations").

**Method.** A private user folder `ref/dolphin-user-j2d` (`battle-user.ts`), GDB port 55128, `trace.ts --dump-frames`:
- Title: `--savestate ref/battle/title.sav --script "300 idle"`, then 1500 frames.
- Shadow Battle's end: `--savestate ref/save-battle-field-2p.sav --write 5:811776e4:00000002` (P2's Link actor is
  0x81176AE8 in that state; +0xBFC = life 2) `--script "10 idle; 60 p1:right; 10 idle; 4 p1:B; 500 idle; 4 p1:A; 400
  idle; 4 p1:A; 400 idle"`: the stab knocks P2 out (life 0, state 51, on ~84), a "P2 down!" banner, "P1 WIN!" with
  PRESS START, A (584) → fade → the Total screen (`total.blo`, its panel sliding up on 660–664), the won star (683–700),
  A (988) → Continue → Select Area. Dump n is frame n − 1 in these runs.
- Ours: `#arc=…&scrn=…&anim=…&bg=none`, `fsoScreens.seek(f)` then `capture()` for every frame f.
- The dumps are 608×452 (the first one 456): the screen's 448 lines scaled by 452/448. Resampled back to 448 lines
  (linear), they line up with ours at (0, 0) (unresampled, the best offset drifts from 0 at the top to +2 mid-screen).
- Error: mean |ΔR| + |ΔG| + |ΔB| / 3 (0–255) over the pixels our render covers opaquely inside a box (the logo:
  85–525 × 51–315).

**Title logo and its glint** (`title.blo` + `title.btk`, the indirect material `mat_Ptlogo01_v`):
- Still (no glint): 4.3.
- The glint is `title.btk` played once at rate 1 from dump 129: for each dump 140…188 the best of our frames 0–59 is
  dump − 129 (11…59), and frame 0 (no glint) before 140 and after 188. Over dumps 131–188 (frames 2–59), whole logo:
  **5.5** with our model; 8.9 without the glint (12.4 at worst), 9.3 with the glint but no indirect offset, 6.3 with
  rotate-then-scale texture matrices. On the 232,888 pixel-frames where our glint changes the logo: **5.5** (46.9 for
  the logo without it; 11.5 for the rotate-then-scale glint on its own pixels).
- Over 1500 frames the glint ran on frames 128, 680 and 1218 (552, 538 apart), each 38 frames after a sparkle on the
  sword (another effect; it raised the error at 90, 642, 1180); the lightning of the 3D clouds behind is unrelated.

**The Total screen's star** (`total_star.blo` + `total_star.bck` + `total_star.brk`; the game moves it onto P1's first
slot, (2, −21) px from the file):
- Landed (frame 19): **5.0** on the star's opaque pixels, steady over dumps 716–760 and 786–880.
- The pulse: our frames 80–104 are dumps 761–785 and again 881–905 (every 120 frames), with the `.brk` at the same
  frame as the `.bck`: 2.3–5.1 per frame, but 6–17 on dumps 762–772 and 882–892, where Dolphin's sparkle particles
  (not J2D) cross the star; mean 7.2 and 8.9 over frames 79–105.
- The flight: our frames 10–18 match dumps 691–699 in place (frame 0 = dump 681), with errors 32 → 9: the game fades
  the flying star in (pane alpha), the files draw it opaque.
- `total.blo` itself (dump 760): 6.9 on the wall and banner strip (y < 60), 12.9 over the top-left quarter with the
  P1 / P2 cells (the game recolors cells and hides most of the file's panes: reproduced since, 2.1, "Shadow Battle's round
  screens in Dolphin").

## The title screen's sky in Dolphin
The title's 3D clouds and lightning (docs/formats/j3d.md "The title screen's sky"), against apps/site's `title-sky.ts`
(2026-10-02).

**Method.** A user folder copy `ref/dolphin-user-title` (of `ref/dolphin-user-j2d`), GDB port 55146, `trace.ts
--savestate ref/battle/title.sav --script "160 idle" --dump-frames --raw 8113b200:80 --raw 812cf72c:4 --raw
812d0eec:4 --raw 812d0f68:4 --raw 812d5458:4`: the title object's lightning (+0x84 … +0x100; the object is
[0x8053AD88] = 0x8113B17C in that state) and the frame fields (+8) of `w_kumo`'s and `w_kumo1`'s btk and of
`w_kumo1`'s and `w_kumo4`'s brk, every frame. The models' places and the cameras were read from the state's MEM1
(`ram.ts`): J3DModel +0x18 / +0x24, [0x8053AB10] + 0x10 (the 2D camera) and + 0x24 (the TV camera, unused here).
Ours: the page at 608×448 (the frame fits exactly), `fsoSky.show(tick, near, far, { strikes })` with the traced
values, the drawing buffer read back; the dumps resampled from 456 to 448 lines; mean |ΔRGB|/3 outside title.blo's
panes (the logo box 80-530 × 46-320, PRESS START, "© 2004 Nintendo").

**What the trace showed.** The btk frames are the frame count (869, 870 … on records 0, 1 …; `w_kumo`'s wraps at
1000); the brk frames follow the strikes as 0x8016D398 says: 65, 63 … (a strike 39 frames old), 100 on a near strike
(record 19, slot 1, the near countdown redrawn to 131) for `w_kumo1` and `w_kumo4`, 100 on a far strike (record 80)
for `w_kumo4` only; the emitter lived 8 frames (records 19-26) and its slot 60. The generator is shared with other code,
so the strikes' places don't follow from the savestate's seed alone (the times do: they come from the countdowns).
**Dump n shows record n − 4** (as for the round screens): the strike of record 19 lights the clouds from dump 23.

**Result** (dumps 5-159, 155 frames): **0.36** mean (max 0.38) on the 127 frames without a bolt, 118 of them lit to
some degree; **1.4** (max 4.7) on the 28 frames with a bolt, whose zigzag is drawn from JPA's random numbers (its
place, colors and life match: yellow, magenta, cyan, one color table step of two a frame, gone after about 7 frames, as
group 0 steps twice a frame on the title). Before the alpha fix the page showed the CSS sky through the canvas: GX
materials leave the alpha the game ignores, so the canvas sits on black.

**Cost** (`perf`-like, headless Chrome on the M1, 5 s of the home page idle): the live sky takes 71-82 ms of main
thread a second (36-42 ms of script) at 60 frames a second, 108-127 ms at 4× CPU throttling (desktop 1512×945 @2x and
a phone 852×393 @3x; the canvas is CSS size × 1); with reduced motion (one still frame) under 1 ms a second. A draw
(the six models, the lightning, the bolts) is 0.13 ms, 0.3-0.4 ms at 4×. It doesn't run while the page is hidden or
a dialog is open.

## Shadow Battle's round screens in Dolphin
Frame dumps and RAM traces of a battle's own screens (2026-10-02), for apps/battle's `banners.ts`, `total.ts` and
`timeline.ts` (what each screen is: docs/formats/j2d-and-bmg.md "Shadow Battle's round screens").

**Method.** The user folder copy `ref/dolphin-user-battle-combat` (GDB port 55126), `trace.ts --dump-frames`:
- the intro: `--savestate ref/battle/area-2p.sav --script "10 idle; 6 p1:A; 520 idle"` (and `area-4p.sav`; the castle:
  `"10 idle; 6 p1:right; 15 idle; 6 p1:right; 15 idle; 6 p1:right; 15 idle; 6 p1:A; 560 idle"`), with `--raw 80958738:100`
  (the game object [0x8053AAF8] in these runs) for its intro fields;
- a knockout to the Total screen: as in "J2D screens in Dolphin" (`save-battle-field-2p.sav`, P2's life poked to 2,
  a stab on frame 81, life 0 recorded on frame 82, A on 584);
- three players: `save-battle-field-3p.sav`, P3's life poked to 0 on frame 20, P2's on 420 (P2's Link actor 0x81176AE8,
  P3's 0x811783B4: +0xBFC);
- Vaati's time-up: `save-battle-field-2p.sav` with `--write 5:81268f20:01 --write 5:81255df4:00000190` (the stage's
  timer flag and 400 frames), A on frame 1310;
- the pause screen: START on P1's GBA on frame 30, down, up, START.
Dump n shows the game's frame n − 4 (the intro's RAM-traced changes appear four dumps later); the times below are game
frames.

**Intro** (frames from the arena showing; RAM-exact): see docs/formats.md. In the dumps the arena fades in over 25
frames, the text zooms in from its 15× size, the two Links rise out of dark portals, the frame zooms onto each player in
turn and that player's HUD corner fades in. In the castle with four players the top corners came in only once the camera
had zoomed out, after control: the HUD hides a corner a Link stands in front of. Decoded since (2026-10-03, "The Links'
intro, the round's end and the HUD in Dolphin" below).

**Round end.** Every knockout's "P2 down!" window started its slide 117 frames after the life reached 0 (2 players at
82; 3 players at 21 and 421; Vaati's two at 862, one message, "P1 down!"), in place at +126, out at +287-295. With one
Link left: the HUD faded out from +137, "P1 WIN!" at +294, PRESS START at +423; the camera's zoom, the winner's pose and
sparkle: below. DRAW! after the time-up at the same times from the knockout.

**The Total screen** (frames from A, 584 + 3): the fades, slides and pulses of docs/formats.md, measured by aligning
each dump with the screen at rest (the panel's offsets), by the text's edge (the scroll), by the buttons' top edge, by
the lit column's and the cursor's pixel values. Our render (`#arena=0&players=2&wins=1`, P2 knocked out, Enter on
PRESS START, the canvas read at 608×448) against the dumps resampled to 448 lines, mean |ΔRGB|/3 over the screen but
its top-right corner (the A prompt, not drawn): 0.3 and 0.5 at 30 and 60 (the wall), 1.9, 2.0, 2.2 at 66, 70, 75 (the
slides), 2.1-2.7 from 90 to 209 (the star flying in and pulsing, the column and cursor pulses).

**The banners.** "P1 WIN!" over the knockout's frame: 7.0 on its own pixels (the sparkles and the different camera
behind its edges); its place and gradient match. "P2 down!": the window and text in place; the game's line sits 4 px
left of and 1 px above our centering (applied as an offset). "Be the last one standing!" spans x 107-501 in both, Go!
matches by eye (place, outline, fade).

**Pause** (START on a GBA): game2D `pause.blo` where its file puts it, the arena dimmed behind, the plate dropping in
from above and leaving upward; "Continue" / "Choose an Area" / "Choose a Game" with the alternative panes for the
cursor. Measured since: "The pause screen in Dolphin" below.

## The Links' intro, the round's end and the HUD in Dolphin
Traces and frame dumps (2026-10-03, `ref/dolphin-user-battle-combat`, GDB port 55126), main.dol read with `tools/dol`;
applied in apps/battle (timeline.ts, scene.ts, camera.ts, particles.ts, hud.ts, ranks.ts, total.ts, sound.ts).

**Method.**
- The intro: `trace.ts --savestate ref/battle/area-2p.sav --script "10 idle; 6 p1:A; 520 idle" --raw 80f8bc30:900`
  (the camera object) `--dump-frames`, and `--dump <frame>:80000000:1800000` (MEM1) at frames 100-306 to read the live
  JPA emitters (docs/formats/jpa.md "JPA particles": the manager's lists are at [[[[0x8053AB10]+0x28]+0xC]] + 12 g) and the
  Links' intro counter +0xD38 (frame − 86: it starts with the fade-in's end, intro frame 26).
- The round's end: `save-battle-field-2p.sav`, P2's life poked to 2, a stab (as in "J2D screens in Dolphin") with the
  camera raw and MEM1 at 230-430; three players: `save-battle-field-3p.sav`, `--write 20:81178fb0:00000000` (P3's life:
  his Link 0x811783B4 + 0xBFC) `--write 420:811776e4:00000000` (P2's), the HUD ([[0x8053AED0] + 0x294] = 0x8129B1C4)
  and the message manager (0x8129AEF4) raw.
- The Total screen: the same 2-player knockout, A on 584, MEM1 at 680, 700, 766, 772.
- Ours: the battle page at 608×448 with the loop stepped by hand, the Links put at the savestate's places
  ((200, 280), (312, 280)), compared with the dumps resampled to 448 lines (as "J2D screens in Dolphin").

**Intro.** The camera doesn't move during the intro (zoom 2.1408 on The Field, 2 players); the Links stand in state 0
(sprite 62) and aren't drawn until frame 157. Effects 1048 (1 frame), 1049 (105), 1050 at (x, y + 128, 128): their
creation at counter 16 (frame 42) is main.dol's (0x80254150); in the dumps the dark sphere grows from about 45, shrinks
into a Link-shaped blob and bursts (about 160-170) as the Link shows. Compared with ours (the same places): the portals'
110×110 boxes differ by 3.5-8 (mean |ΔRGB|) from 50 to 140, 14-20 during the burst (random particles). The zoom: the
copy drawn over the whole screen is magnified onto the Link (first drawn as a shrink: wrong, fixed); our frames 240 and
270 match Dolphin's magnification and fade by eye (the whole frame's error, 30-37 there and ~16 otherwise, comes from
the arena itself: our water lighter, a few static actors different). The corners: 250, 282 (code: 26 + 224, 256;
dumps 249, 282).

**The round's end camera** (2-player knockout at K = 82; the camera object 0x80F8BC30): +0x7F4 = 1 from K + 138; the box
(+0x1B4…) eases to bounds(P1, the lying P2) by the usual law (a tenth of the gap, the farthest edge at most 3 px a frame:
left 712 → 715 → … 772 at frame 240, 774.85, 777.41 …) without the 60-frame hold or the 128 px slack, the view staying
at least 260 px wide (608/2.3385, from frame 228: the table's 130); from K + 270 the box drops the loser (right edge
824 → 821.65, 819.54 …) and settles on the winner (800.5). Three players (P3 out at frame 21, P2 at 421): the box
included the long-dead P3 until the winner's pose. Winner's sprites: 220 at K + 270, 221, 223 … 232 at K + 294, then
held. Effects 203 + 204 at (x + 7, y − 27 + 1024, 1024) created at K + 294 (state 5). camera.test.ts replays the 2-player
numbers.

**The HUD.** At the castle's 4-player start the message manager's +0xDC = 3 (top corners hidden) while +0xDD = 15 (all
introduced): the hiding rule is 0x8043DF8C's (docs/formats.md). The ranking labels: "1st" over every head from the
round's first frame of play for 180 frames (2 players, nobody hit: dumps 14-192), "3rd" by P3's portrait once he was out
(3 players), "1st" / "2nd" … after each change for about 180 frames (3 players: 421 to 600).

**The Total screen.** Group 4 emitters at screen px: 1231 at (220.3, 132.4) on frame 680 (the flying star, created at its
.bck frame 2 and moved with it), 1233 at (88.6, 239.3) on 700 (the landing, frame 19), 1232 at (84, 246) on 766 (the
pulse, frame 80) (main.dol 0x803D75B0). Ours: the trail, the burst and the pulse's sparkles at the same places.

## The pause screen in Dolphin
`save-battle-field-2p.sav`, `--script "30 idle; 4 p1:START; 60 idle; 4 p1:down; 30 idle; 4 p1:down; 30 idle; 4 p1:up;
30 idle; 4 p1:up; 30 idle; 4 p1:START; 60 idle; 4 p1:START; 40 idle; 4 p1:down; 20 idle; 4 p1:A; 150 idle; 4 p1:B; 60
idle" --dump-frames` (dump n = frame n − 4; the plate's top and bottom edges found by its gold, the dim by a patch of
grass). Ticks below count from the press the game sees (START on 30 seen on 31).
- Open: the arena dims (Pblack 80/255: ×0.686) linearly over 27 frames from tick 2, and stays frozen; the plate appears at
  tick 15, its bottom edge 354, 335, 315, 294, 272, 248, 222, 196, 169, 139, 109, 77, 44, 10 px above its place, then 26
  px below, 16, 9, 4, 1, in place (screen px, 448 lines).
- The cursor: a press moves it on the next frame, the swords jump to the new item and bounce down 0, 1, 2, 3, 5, 3, 2, 1, 0
  px; the swords sit at ±(the item's half width + 35); nothing else moves while the plate is up.
- Continue (START again): from tick 16 the plate dips 9, 16, 22, 25, 26, 23, 15, 2 px and flies up off the screen (−16,
  −39, −68, −102, −141, −185, −235, −290, −349); the dim lifts over 13 frames from tick 21; the arena moves again after it.
- Choose an Area (A): from tick 16 the plate falls out at the bottom (5, 19, 44, 77, 120, 172, 236, 307 px); from tick 27
  "Leave this area?" (BMG 0x10B) drops in in a 308×196 warning window round (305, 225) (−300, −225, −161, −105, −59, −25,
  0, then 14, 20, 8, 2, 0 px), No under the light box. B: the window falls out at once, the plate drops in again (as on
  opening) about 27 frames later, the cursor back on Continue. (Yes and Choose a Game weren't tried: ours goes on to the
  menu / the home page after a fade to black.)
- Ours against the dumps: the plate at rest 3.2 (mean |ΔRGB| over its 376×263 box), the question's box 11.1 (the window's
  frame texture and colors; the text and the light box in place).

## The message window and the HUD's disc in Dolphin
Frame dumps of Hyrule Castle's circle (2026-10-03), for apps/battle's `timeline.ts` `messageWindow`, `hud.ts`'s disc
and `entities.ts`'s circle (what each is: docs/formats/j2d-and-bmg.md "The message window", "How the game drives main_bat").

**Method.** A copy of the battle-arena user folder (`ref/dolphin-user-msg`, GDB port 55132): `trace.ts --savestate
ref/save-battle-castle-2p.sav --script "10 idle; 60 idle; 22 p1:left; 11 p1:up; 420 idle" --write
5:81255ed4:00040000 --write 300:811776e4:0000000c --link bd8:8 --link 3b4:4 --dump-frames` (switch 18 poked on, P2's
life kept up). In this run dump n shows game frame n − 8: the circle's growth shows from dump 14 (frame 6, the frame
after the poke) to 64 (full size on frame 56, 50 frames: +0x240 by 0.02); P1 taken on frame 93 (state 36, as traced
before). Images 608 × 456: y × 448/456 for the J2D screen.

- **The message**: "You got 10 Dark World seconds!" at the bottom, its top edge (the parchment at x 304) at y 448
  (dump 75), 443, 436, 429, 422, 414, 405, 396, 386, then in place from dump 84 (frame 76: 20 frames after full
  size); the same slide as "P2 down!"'s, from the circle's full size (main.dol asks for it there, not when P1 is
  taken). The HUD corners don't fade while it shows.
- **The circle**: the castle's shows a big "10" in its middle (enemy_gc_sob 302) from its first frames, open or not.
- **The disc** (dump 320, P1 standing on the dark side, player_sob 63): the green ring spans x 28-101, y 36-109 of the
  dump (73 × 72 px in J2D: `ra02` 77 × 77 about (65, 73)); inside it the black disc and his sprite, x 55-81, y 63-98
  (J2D 61.9-96.3): 27 × 34.4 px for the frame's 18 × 23, i.e. 1.5×, his feet at (67, 85.9), `ra01`'s anchor
  (67, 75) + (0, 11). The left corner's hearts and item box sit 15 px right of where they were (dump 90 vs 320).
  Ours (battle-mechanics.ts `mech-castle-dark-side`, 1280 × 800 read back to J2D): ring x 27.9-101.8, sprite x
  54.8-81.7, y 62.2-96.3.
