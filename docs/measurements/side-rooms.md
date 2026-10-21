# Measurements: side rooms

Part of the measurements from the real game (index: [../measurements.md](../measurements.md)).

## Side rooms
Traced 2026-10-02 in the battle user folder's copy `ref/dolphin-user-battle-arena` (`trace.ts`/`actor-trace.ts --user
… --port 55124`), from the 2-player round states, with `--link 3b4:4 --link cc8:30` (the Link's screen and his warp's
fields: docs/formats/side-rooms.md "Side rooms (GBA screens)"). States made on the way (ref/battle-side/, not committed):
`field-house-in.sav` (P1 in The Field's house, in control), `flames-north-in.sav` (P1 in the Tower of Flames' north
room), `clouds-cannon.sav` (P1 in the cannon under Above the Clouds' hole). Positions are world px (the arena at
(512, 384); a GBA screen's own (0, 0)).
- **The Field's house** (`field-2p`: `10 idle; 38 p1:right; 100 p1:up; 60 idle; 40 p1:down; 60 idle`): P1 walks up at
  x 767.5; the door takes him on frame 116 at y 562 (state 2 → 28: his body's top 555 meets the door box's bottom 556);
  state 28 from 117: x 768 (lined up), y −0.5 a frame to 542.5 on 155; on 156 he's at (80, 136) on screen 9, state 29:
  still to 186 (sprite 16), then y −0.5 a frame to 116 on 226; state 0 on 227, his first move on 228. Out: down from
  (80, 116); the door takes him on frame 12 at y 125 (bottom 132 = the box's top); state 28 to frame 51 (y 144.5), on 52
  he's at (768, 552) on screen 0, state 29: still 30 frames, then down 0.5 a frame to 572, control on 123.
  Walking into the house's front beside the door (x 743.5) stops at y 567 (the tiles' collision), at the door
  (x 767.5) it doesn't: something opens the door's tiles (0x19C/0x19D, type 1); the sim opens the doors' boxes.
- **The Tower of Flames' north door** (`flames-2p`: `10 idle; 80 p1:up; 81 p1:left; 40 p1:up; 130 idle`): taken at
  (767, 474.5), into (112, 120) on screen 9, the same 40 + 70 frames, control at (112, 100). Its floor switch
  (`actor-trace --ids BLZ2,SWTH --raw 81255ed4:4`, from `flames-north-in`: right 27, up 42): the switch's +0x230 2 → 3
  (stood on) on frame 67, → 4 on 73, → 2 on 136 (stepped off); the room's switch word 0x81255ED4 has bit 14 from 67 to
  135; frame dumps show the 20 eternal flames lit from about 80 and dying down after 136.
- **Two Links in the house** (`field-house-in`: P2 walks in while P1 stands aside, then P1 swings at him): P2 came in
  the same way; P1's swing took him 12 → 10 with the usual knockback (1.5 px/frame, hop 3.0) and 60 invincibility.
- **No shelter** (`field-house-in`, Vaati forced: `--write 5:81268f20:01 --write 5:81255df4:00000064`): both Links
  (P1 in the house, P2 on the TV) went to life 0, state 51, on the same frame (559).
- **The TV** (frame dumps): P1 drawn walking into the doorway under the house's top layer, gone once inside; his HUD
  corner shows a black disc with a green ring, bigger than the portrait, with his sprite moving in it, until he's
  back on the TV; coming out, a marker under the door (his head, "P1", an arrow into the door, a pulsing glow) from
  about 8 frames after he starts walking out until he has walked out of the door; the TV camera leaves him out (it
  held still, zoom 1.524, with both Links in the house).
- **Above the Clouds' hole** (`clouds-2p`, P1 moved next to it: `--write 5:81175224:443e0000440f8000`, then up): taken
  on frame 21 at (760, 552), the hole's center (state 30, sprites 183–188 as a pit fall, no life lost) until 79; on 80
  he's at (152, 8) on screen 9, state 31 (facing right) to 140, then falls 4 px a frame (constant) to y 100 on 163 into
  the cannon (state 76). The cannon (`CNON` +0x230… fields cycling, x 166 → 200 → 105 at 1 px/frame, easing at the
  ends) carries him; the GBA's B does nothing, A fires: state 77, y 96 → 83 (−13), then about −10 a frame to 10.25
  (hidden from 140), the top edge's style-19 warp on frame 12 after the shot; on the TV at (760, 552) from frame 30,
  still hidden; on 89 he shows and flies up (z 11.3, +9.2 a frame at first, 206 at the top around frame 130), comes
  down with no input (z 5.3 on 175) and falls into the hole again (state 30).
- **The Tower of Winds' TV screen is side view** (`winds-2p`: `10 idle; 50 p1:right; 30 idle; 40 p1:up; 30 idle`):
  P1 walking right off his ledge at (686.5, 568.7) slides 3.3 / 2.2 px for 2 frames, then falls 4.0 px a frame (x on at
  1.5) and lands at y 616.6; standing, y jitters by ±0.2 px; up on the platform does nothing (no ladder).
- **Hyrule Castle's magic circle** (`castle-2p`, switch 18 poked on: `--write 5:81255ed4:00040000`, P2's life poked
  back to 12 every 300 frames (`811776e4`) or the soldiers end the round; `10 idle; 60 idle; 22 p1:left; 11 p1:up;
  1200 idle`, with `--link bd8:8 --link cb0:c`): P1 at (680.5, 566.5) after his first step up, 14.5 px below the
  circle's middle (680, 552); on frame 93 he's on it, next state 36; 94–153 sprite 796, 154–212 sprite 289 (blank); on
  212 at (160, 160) of screen 8, state 37 (sprite 63) to 271; state 0 on 273 with +0xBD8 = 599 (+0xBDC = 1), +0xCB0 =
  (680, 552); +0xBD8 = 0 on 872, next state 32: 873–932 sprite 796, 933–990 sprite 63, on 991 at (680, 536) of the TV
  in state 33 (sprite 289) to 1051, free on 1052. Frame dumps: "You got 10 Dark World seconds!" in a box on the TV from
  the frame he's taken, a 10 on the circle, his HUD corner the black disc while he's away.
- **The dark side's middle** (the same, then `190 idle; 64 p1:right; 40 p1:down; 300 idle`, with frame dumps): P1 at
  (254.5, 200.5) before his step down; on 385 he's at (256, 208), next state 34: 386–476 the four standing sprites in
  turn every 4 frames from 62 (down, left, up, right), z 0 to 444, then +4 a frame from 445 (4) to 476 (128); on 477 at
  (768, 592) on the TV, z 0, state 35 (sprite 60) to 647, free on 648 (sprite 62). +0xBD8 stood at 0x1E6 through state
  34 and was 0 from 477. Frame dumps: a marker over the spot on the TV (his number, his head, an arrow down) from
  392 (7 frames into his spin) to about 600, a swirl around 520, then he spins down onto the spot from about 611 to 647.
- **Bombchus** (`actor-trace --ids BMTY` from `flames-2p` with switch 30 poked on, 400 frames): eight `BMTY` from
  frame 24 along both side walls (x 22–74 and 438–487, y 86–298), +0x23C 299 counting down, steps of about 2.5 px a
  frame in a fixed direction; the last went on 355 (lives of 71–332 frames).
- **The Tower of Winds in side view** (2026-10-02, from `ref/save-battle-winds-2p.sav`, `--link 3b4:4 --link cc8:30`;
  traces in out/traces/winds/, the cases in `packages/sim/src/dolphin-battle-traces.json` via `fixture.ts --battle
  --append`):
  - Standing on a ledge the Link's y jitters between 184.5 and 185 (room px): his gravity against the ground each
    frame. Walking left along the ledge from (152, 184): 59 frames to x 65 (the first one a turn).
  - Up or Down off a ladder only turns him (`updown`); on a ladder (tile 0x61) he climbs at walking speed, up and down
    (`ladder`); at the ladder's top he goes into his pushing pose (state 13) for a frame or so (not modelled).
  - Knocked off a ledge (`knockoff`: a swing from P2 at the ledge's end): the knockback and its hop go on while he
    falls 4 px a frame; sliding off the ledge's corner he moves 3.3 then 2.2 px a frame.
  - A swing on a ledge (`hit`): the usual damage and knockback, along the ledge.
  - The left gate (`gate-left`, `gate-up`): walking into it does nothing; a press of Up in it takes him (state 28,
    facing up, x lined up on 64), 1/32 px a frame into it for 40 frames; on the 40th he's on the gallery's gate (screen
    8), standing 30, walking 40, free on the 111th at (64, 184); back by a press of Down, out on the TV facing down.
  - A pot thrown on the TV (`pot`): it leaves at its carried height (20 px over him) as screen y, 6 px a frame sideways,
    and falls 0.15 px a frame² (0.15, 0.30, 0.45 …), landing on the ledge it meets.
  - The gallery's rain (`rain`, `rain-in`: the TV pots' switches 3 and 4 poked on, P1 in the gallery): ten lit bombs
    at once, the first at (240, 135) of the gallery, falling from rest 0.15 px a frame² and resting at y 201 over the
    middle platform's top 208 on its 30th frame; their blasts didn't light the gallery's crystals (8–11 stayed off).
  - The giant-bomb Shadow Link (`bbsl`, `bbsl-frames`: switch 21 poked on at frame 5, `--write 5:81255ed4:00200000`):
    BBSL at (256, 132), seen from the sparkles' end; his bomb thrown onto the small middle ledge, burning with a digit
    for its last 9 seconds (bomb_big_a), the screen white for a few frames at the blast with effects 51–56 growing
    over the TV; both Links on the TV at life 0 on frame 1026 (state 51 from 1027).
