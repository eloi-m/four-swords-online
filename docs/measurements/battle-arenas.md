# Measurements: Shadow Battle in Dolphin, arenas, orbs and camera

Part of the measurements from the real game (index: [../measurements.md](../measurements.md)).

## Battle mode in Dolphin
Shadow Battle runs in Dolphin 2606 with its integrated GBAs (mGBA) and the real GBA BIOS (`disc/gba_bios.bin`, 16
KiB, SHA-1 300c20df…d25d3492): FSA multiboots its client program onto each GBA over JoyBus, and the GBAs are running
it by the time the title screen shows. Everything below is scripted from power-on and reproducible.

**Config** (`node tools/dolphin/src/battle-user.ts` writes `ref/dolphin-user-battle`; the other user folders are
untouched):
- `[Core] SIDevice0`–`3 = 13` (`SIDEVICE_GC_GBA_EMULATED` in Dolphin's `SI_Device.h`; 6 would be a GameCube pad),
  `CPUThread = False`; `[GBA] BIOS = <abs path>/disc/gba_bios.bin`, `Rom1`–`Rom4` empty (FSA sends its own program).
- No device on any GBA or GC pad (`GBA.ini`, `GCPadNew.ini`): only movies drive them, whatever the keyboard does.
- Savestates on demand: `[General] HotkeysRequireFocus = False` and `Hotkeys.ini` binding "Save State Slot 1" to
  `Pipe/0/fso:Button A`, a device of Dolphin's Pipes input backend (the FIFO `Pipes/fso`, fed "PRESS A" lines).
- Headless as before (`-b`, GDB stub, no audio): `trace.ts` picks this folder by itself for GBA ports.

**Inputs.** Every SI poll reads each plugged port in turn, so a movie holds, per poll, one ControllerState per port
in port order; FSA still polls twice per frame. The DTM header's GBAControllers byte (0xA1, plus the controllers
byte) marks the GBA ports, and playing the movie plugs integrated GBAs there. A GBA's keys are its state's A, B, Z
(Select), Start, D-pad, L and R bits; X resets that GBA. Scripts (`script.ts`) name players: `20 p1:right+B p2:A;
10 p1:START` (a bare spec is P1's; unnamed players idle); on a GBA port directions press the D-pad, `SELECT` is
Select. The game receives a GBA's keys one frame after the script frame (the record at `GBA_KEYS`, docs/formats.md),
then acts on them as on a pad: turn on the first frame, walk from the next, an attack's kind decided on P+1. On a GBA
B is the sword, A the item, R the action.

**Savestates.** `trace.ts --save <frame>:<path>` presses the hotkey while the CPU sits at that frame's main-loop
breakpoint; Dolphin queues the save as a CPU-thread job, which runs when the tracer continues, before any
instruction, so the state is exactly that frame. The movie must be over by then (the frame must be in `--tail`): a
state saved during playback keeps the movie position (`m_current_byte`), and a new movie from it would start
mid-stream. Each state gets a `<path>.json` (port layout, frame, VI count, script, parent state) that `trace.ts`
reads back for `--ports`. A trace from such a state starts on the frame after the save. Reloads are deterministic: a
160-frame scripted fight and the `battle-hit` trace below, each run twice from a round state, gave identical records.

**From power-on to a round** (`node tools/dolphin/src/battle-states.ts [--port 55031] [--players 2,3,4] [--only …]`
chains these; all input from P1's GBA; a step reruns when named or missing, and the later ones with it):

| State | From | Script (frames) | Screen |
|---|---|---|---|
| `ref/battle/title.sav` | power-on | 1095 idle, saved at 1125 | title ("PRESS START" from ~810) |
| `modes` | title | START at 30; saved at 310 | Hyrulean Adventure / Shadow Battle / Options |
| `shadow` | modes | down at 20, A at 56; 272 | Shadow Battle (attract demo, START! / Back) |
| `count` | shadow | A (START!) → "create a file on the Memory Card?" A (No) → "no saved data" A → "could not be loaded. Start game?" left, A (Yes) → Quest Log 1 (New) A → START! A; 1240 | Two / Three / Four-Player Game (cursor on Four) |
| `area-2p` / `-3p` / `-4p` | count | up ×2 / ×1 / none, A; 330 / 305 / 280 | Select Area (cursor on The Field) |
| `ref/save-battle-<arena>-<n>p.sav` | area-*n*p | right × arena index, A, idle; saved 10 frames before control | the round, "Be the last one standing!" |

No memory card file is ever created (the game runs unsaved); a new Quest Log has The Field, Tower of Flames, Tower of
Winds, Hyrule Castle and Above the Clouds, the Dark World arenas locked. Rules left at their defaults (Vaati: No,
Powerful Items: Keep, Status Display: Yes), no handicap.

The round states (15, about 20 MB each; every one checked by a trace and a frame dump). Each loads 10 frames before
the players get control: a trace from it has P1 turning on frame 9 or 10 for input from frame 8. Starts are room
px (the arena is always placed at world cell (1, 1): world = room + (512, 384)), players in port order, the Links
not in the game in brackets (state 1, sprite 797); everybody faces down (sprite 62) with life 12. The players get
the arena's four `PLAS` slots in an order that changes from one round to the next (the hand-made first Field 2p
state had P1 on slot 1 and P2 on slot 3; this one has slots 2 and 3), so a new state means new starts.

| `ref/save-battle-…` | Starts (room px) | Camera zoom on frame 0 |
|---|---|---|
| `field-2p` | (200, 280) (312, 280) [(200, 184) (312, 184)] | 2.1408 |
| `flames-2p` | (376, 232) (136, 232) [(376, 152) (136, 152)] | 1.4757 |
| `winds-2p` | (152, 184) (360, 280) [(360, 184) (152, 280)] | 1.6000 |
| `castle-2p` | (200, 184) (200, 280) [(312, 280) (312, 184)] | 1.6716 |
| `clouds-2p` | (104, 312) (392, 72) [(104, 72) (392, 312)] | 1.1875 |
| `field-3p` | (312, 184) (200, 184) (312, 280) [(200, 280)] | 1.6716 |
| `flames-3p` | (136, 232) (376, 152) (136, 152) [(376, 232)] | 1.4757 |
| `winds-3p` | (360, 280) (152, 280) (360, 184) [(152, 184)] | 1.6000 |
| `castle-3p` | (200, 280) (200, 184) (312, 184) [(312, 280)] | 1.6716 |
| `clouds-3p` | (392, 72) (392, 312) (104, 312) [(104, 72)] | 1.1875 |
| `field-4p` | (200, 280) (312, 184) (312, 280) (200, 184) | 1.6716 |
| `flames-4p` | (136, 152) (136, 232) (376, 232) (376, 152) | 1.4757 |
| `winds-4p` | (152, 280) (360, 184) (360, 280) (152, 184) | 1.6000 |
| `castle-4p` | (312, 280) (200, 280) (312, 184) (200, 184) | 1.6716 |
| `clouds-4p` | (104, 72) (104, 312) (392, 312) (392, 72) | 1.1875 |

**Tracing a round:** `node tools/dolphin/src/trace.ts --savestate ref/save-battle-field-2p.sav --port 55031
--script "10 idle; 60 p1:right; 10 idle; 4 p1:B; 100 idle" --out out/traces/battle-hit.json` (≈ 5 s; the ports come
from the state's .json). Records hold the four Links as before plus `facing` and `knock` (+0x350: knockback velocity
and hop speed), the GBA keys per port (`gba`) and `camera.zoom`. `trace-print.ts <trace> <player>` shows a player
with his keys, life, invincibility and height.

**First measurements** (`field-2p`; traces `battle-hit`, the one above; `battle-hit-angle`, `10 idle; 4 p2:up; 6 idle;
60 p1:right; 10 idle; 4 p1:B; 100 idle`; `battle-shield`, the same with `2 p2:left; 8 idle` for P2's move):
- Walking and the sword are adventure mode's: 1.5 px/frame after a 1-frame turn, 3 ticks per walk frame; swing,
  stab, charge (1.125 px/frame) and spin with the same states and sprites.
- **P1 stabs P2** (`battle-hit`: P1 at (800.5, 664) facing right, P2 at (824, 664) facing down, 23.5 px away): the
  hit lands on the stab's first frame (state 4, sprite 594, P+1 of the B press). **Damage 2** (life 12 → 10, half a
  heart). **Knockback 1.5 px/frame along the attacker → victim direction** (`battle-hit-angle`: (1.4732, −0.2821)
  for an offset of (23.5, −4.5), the unit vector × 1.5), with the hop: z +3.0 on the first frame, −0.25 per frame
  (peak 19.5), state 15 for **25 frames** (37.5 px, 824 → 861.5), then idle. Invincible 60 frames, hidden (sprite
  289) while ≤ 55 and (mod 4) ≥ 2; sprites 175 ×4, 176 ×4, 177 ×4, 178 to the end (the down-facing knockback block).
  The attacker isn't moved. All as the Octorok rock in adventure mode, so `SWORD_DAMAGE` 2 and `KNOCK_DEFAULT` hold
  for a stab.
- **Shield** (`battle-shield`: P2 turned left, toward P1): no damage, no state change, no invincibility; both Links
  slide apart along the stab, **2.0 px/frame for 5 frames, then × 0.9 per frame** until under 0.2 px (26.0 px each),
  the stab playing on. In a first try (a stab down on a Link facing up, the attacker's back to a wall) the 2.0 phase
  lasted 7 frames for the victim, while the attacker moved 2.5 px and then jittered by under 0.5 px: the phase lasts
  as long as the sword's box still meets the blocker's body (next section).
- Camera: its zoom on frame 0 changes with the arena and the starts (table above), and within a round with the Links'
  spread (docs/formats.md); its centre starts at the room's (768, 576) or near the Links' midpoint.

## Battle measurements: arenas, orbs and camera
Traces from the 2-player round states (`ref/save-battle-<arena>-2p.sav`, above), 2026-09-28. Frames count from the
state; the round's first frame of play (where the sim's play tick 0 is) is frame 9 in these states (8 in the Tower of
Winds'). Positions are room px (world − (512, 384)).

**The tool.** `node tools/dolphin/src/actor-trace.ts --savestate … --user … --port … --script "…" --ids CRGN,CRTL,LSTI
--fields CRTL=230,278,24c:f --fields BEEE=230-2a4 [--raw addr:len] [--write frame:addr:bytes] --out out/traces/x.json`
scans 0x812D8000–0x81340000 (the arena actors' heap; `--scan`) every frame for the types' vtables (from main.dol's spawn
switch) and records the chosen fields (u32, or `:s :h :b :f`; `a-b` ranges) beside trace.ts's Link snapshot, about
30 ms a frame. `actor-print.ts <trace> [--id …] [--quiet off,…] [--moves] [--all]` prints each actor's life and the
frames its fields change (counters that keep their step are folded). Traces stay in `out/traces/`.

**Game state.** [0x8053AAF8]+0x7E = 1 and +0x7F = 0 in all 15 round states (Lake Hylia: 0 and 1), +0x80 = 1 (0 in
Lake Hylia), +0x82 the players' mask (0x33, 0x77, 0xFF for 2–4), +0x83 2 bits per player = 1 (GBA). So battle takes the
"several players" branches: friendly fire, the orbs' roulette table 4 (CRTL +0x288 = 4 read), the items' lifetimes.

**Orb generators** (CRGN +0x230 state: 1 counting, 2 spawning, 0 watching; +0x238 the count; +0x23C the handle), 2400
idle frames in each arena:

| Arena | Generators (room px, kind, switch) | What came (frame: item, level) |
|---|---|---|
| The Field | (344, 152) 2; (256, 240) 1 | items 158 bombs L2, 1058 bombs L1, 1958 bow L1; orbs 458, 1958 |
| Tower of Flames | (200, 200), (256, 136) on switch 1; (312, 200), (256, 248) on 2 (the RNSW picks every 600 frames: switch 2 from 608, 1 from 1808) | items 757 bow, 1657 boomerang, 1957 bombs (all L1); orbs 1057, 2257 |
| Tower of Winds | (80, 232), (432, 232) 2; (256, 232) 1 | items 157 Roc's Feather ×2, 1057 bow ×2, 1957 slingshot ×2 (both drew the same item each time; L1); orbs 457, 1957 |
| Above the Clouds | orb (248, 200) on 5 (from 369: the WTSW 361 frames after the CKSW's pick); items (376, 296) on 4 from 408, (120, 296) on 3 from 808, (120, 88) on 1 from 1608, (376, 88) on 2 from 2008 (the RNSW every 400) | items slingshot, boomerang, bow, bow (L1); orbs 818, 2318 |
| Hyrule Castle | its four are in the GBA rooms (screen 8) | |

- Timing: the count starts at 150 on the round's first frame, so the first orb comes 450 frames in (items: 150). An orb
  lies 899 frames (+0x278 is already 899 on its first frame), an item 599 (+0x254); the generator notices the loss the
  frame after and counts its full 600 / 300 from there: the next orb 1500 frames after the last, the next item 900
  (458 → 1958, 158 → 1058). Gated generators count only while their switch is on, and the switch network's frames match
  the sim's (the RNSW's 400th/600th tick, the WTSW delays, the CKSW at load). Applied: orbs.ts `stepOrbGenerator`.
- Level: 1 for 12 of the 13 items, as main.dol's 20 % level 2 has it (re-read; it was misread as 80 %). Applied since
  (orbs.ts `LEVEL2_ODDS`; what level 2 does: "Items, levels and the Four Sword").
- Spawning: an orb appears 10 px up and falls (0.1 px/frame²), bounces once and drifts ~6 px; an item pops up from
  11–13 px (up at 0.7–2.7 px/frame, 0.3 px/frame² down) or appears on the ground (Tower of Winds); a Link standing on
  the spot pushes the item 13 px aside. Applied since (orbs.ts `stepDrop`, `pushOff`; traced again: "Items, levels and
  the Four Sword").
- Taking an item: with the Action button, not by touch (a Link stood on the Winds' generator as the item came and
  didn't get it). Facing it 13 px away, R on frame 202 (seen on 203): LSTI +0x230 = 1 on 203, gone on 204; the Link's
  +0xC10 got the item on 248 (45 frames, poses 234–236), then 60 frames of invincibility (blinking). Its generator
  restarted on 204, the next item on 504. Applied since (orbs.ts `tryTake`, the "take" move).
- The roulette (the Field's orb lifted with R on frame 502, seen 503): CRTL +0x230 = 2, +0x2B4 = 6 (the entry drawn,
  0–6), +0x294 = 5 (its content, bombchus) on 503; "?" for 20 frames (+0x260 19 → 0) with the idle green/red blink
  (+0x264, every 10 frames: +0x248) going on; then +0x24C = 41 (N = 40 + rand(7)) counts down, one table entry shown
  per step (+0x268 = (entry − steps left) mod 7, so it always ends on the content): 5 frames each until 5 are left,
  then 10, 15, 20, 25, 30 (0x80471760 by 6 − steps left); the content from frame 803, CRTL state 4 on 837; the Link
  still carries it (state 18). 5 N + 129 frames in all. Its lifetime (+0x278) stops while it's held. Applied:
  apps/battle entities.ts `rouletteIcon` (N and the entry from the orb's id).

**Fire bars** (Above the Clouds, FBMR 0x42220008 / 0x42220108): 2 arms of 8 FBOB balls at 48, 64 … 160 px from
(248, 192), from right and left, turning clockwise on screen one 64-unit step a frame (back in place after 1024 frames:
frame 8 → 1032). As the sim.

**Fire-pit jets** (Tower of Flames, the bottom-right pot lifted, P1 carrying it onto its switch: he stopped at x 287.5,
7.5 px east of its middle, and that pressed it): SWTH +0x230 = 3 on frame 114, the SWOR gates and the jets on 115: the
up and left jets. Their size +0x260 = 1 − 0.9ⁿ (0.1, 0.19, 0.271 …), past 0.7 on the 12th frame. P2 walking right into
the up jet at (239.5, 149.5): 4 damage, 60 frames invincible, knocked 1.5 px/frame along (−1.483, 0.225), i.e. away from
the flame's middle (256, 147), not its anchor (256, 192), with a 4.0 hop (33 frames). Applied: hazards.ts `stepJet`.
His body met the box's left edge (x 246) with its right side at +7 px: the ±7 px body the sim's `HURTBOX` now has.

**Trick floor** (the Field: the bush over its switch cut, P1 on the switch): SWTH 3 on 120; TFLR +0x230 3 (opening,
+0x248 growing 0.2 a frame) on 120, 4 (open) on 128, +0x244 = 40 counting down (at least 40 frames open); P1 off the
switch on 252: 5 (closing) on 253, 2 (closed) on 294. As the sim (8, 40, 41). P2 on the floor fell (state 50) on 130
and was back on 252 at (256.5, 280) (he fell at (256.5, 229); the floor's tiles end at y 271) with 2 life less
(12 → 10) and 180 invincibility frames, as combat.ts's `PIT_DAMAGE` (2) and `RESPAWN_INVINCIBLE_TICKS` (180) have
it now. Where he comes back: traced since (below, "Shadow Battle's open items, traced": back behind him).

**Bees** (The Field): the BEEE box is ±4 px at the tree's anchor (inside the solid trunk). A sword swing 56 px away,
the socket bomb going off 26 px away in P1's hands (18 px up) and the same bomb thrown against the trunk, going off on
the ground 24 px away, didn't wake them. Their idle state (the update 0x80343D90 → 0x8034423C, kind 0) only wakes on a
Link within 80 px (6400 = 80²) for whom 0x8026FCE0 is true: Link +0xB9A, +0xB9C or +0xB9D set. +0xB9A is set by the
hammer's state 0x8025B3F0 on its release counter's 18 and 19, charged only (battle-combat.md "The Magic Hammer and the Fire Rod"),
+0xB9C by 0x8025D7E4 (another item's impact: the boots?), +0xB9D by 0x8024BBB8: a ground impact, which the TV arenas'
items (bow, bombs, boots in the Field) can hardly give. The HBMB, state-5 and box checks (0x801F2718, 0x801F82CC,
0x801F285C) belong to the swarm's other states. So swords and blasts don't wake them; a boots crash 50 px away did (2026-10-10,
docs/measurements/battle-combat.md "The Pegasus Boots"), which the sim now follows (strike.ts `wakeBees`).

**Bombs** (the Field's socket bomb, HBMB params 1 at (136, 248)): lifted with R on frame 87 (lit: +0x230 3, +0x238
299), it went off in P1's hands on 387 (+0x230 5 for 32 frames): P1 lost 4 and flew at 1.0 px/frame, straight down,
with a 4.0 hop (33 frames): hit type 5. A new bomb sat in the socket on 447, 60 frames after the blast. Applied:
bombs.ts `BLAST_KNOCK`, `BOMB_REGROW_TICKS`.

**Soldiers** (Hyrule Castle, 4 SLR1 kind 2, two idle Links): states 3 (waiting 39, 68 or 128 frames), 1 (a 60-frame
patrol step, 40 px at 0.67 px/frame; also the 30-frame stops), 2 (an 8-frame turn), 4 (1 frame) and 5 (20): the
wind-up once they have a Link; 6: a chase of +0x23C = 99–242 frames. A chase stands 20 frames (+0x240 19 → 0), aims,
and re-aims every 13 frames (57 of 117 aims; some after 14–22), 44° off the nearest Link on average (up to 90° either
way), at 1.045 px/frame on average (0.74–1.24; +0x28C 1.06–1.24, drawn per chase), its velocity easing 0.3 of the way
per frame (every frame measured); then a 30-frame stop (the velocity halving) and the wind-up again. They noticed Links
76 and 91 px away at once, and patrolling ones much farther once turned their way (197 px); contact hurts 2. Applied:
hazards.ts `stepSoldier`; the patrol, sight and stun since (battle-combat.md "Bombs, the eternal flames and the
soldiers, traced").

**Vaati's time-up** (The Field): the stage object [[[0x8053AAF8]+4]+0xC] (0x81255D30 here) holds the round timer at
+0xC4, 10800 frames (3:00; 36000 in Lake Hylia), counting down only while +0x131F0 = 1, which the Vaati rule sets (0 in
these states); warnings at 1800, 660, 300, 240 … frames. Poked (+0x131F0 = 1, +0xC4 = 400 on frame 5): 0 on 408, and
TUGF (Vaati) at (576, 288), 100 px up: state 1 for 60 frames flying left at 2 px/frame (to x 456; +0x2C0 60 → 0),
state 2 one frame, state 3 (+0x2C0 300 → −91): loops about 110 px round (256, 285), 150–160 frames a turn at ~5
px/frame, then out to the left at 6 px/frame; state 4 on 861, and on 862 both Links' life was 0 (dying on 863). No bomb
falls. He's drawn as enemy_gc_sob 1126 + [0, 1, 0, 2][+0x2C8] (the index steps every 11 frames from his 62nd), and the
camera showed the arena's whole width (zoom 1.1875) from when he came in. Applied: timeup.ts (a circular loop), the
renderer, camera.ts. Sheltering (a Link inside a house) wasn't tested.

**Camera** (the object [[0x8053AB10]+0x24] = 0x80F8BC30 in every state): +0x1B4, +0x1B8, +0x1BC, +0x1C0 = the box it
keeps (left, top, right, bottom, world px), +0x1C4 … +0x1D0 its edges' hold timers, +0x164 … +0x170 the view (left,
top, right, bottom), +0x858 the zoom = 608 / the view's width, +0x1F0 … the FOCS points (registered on the first frame
of play; +0x7F0 their count); +0x1D4 / +0x1D8 hold 86 and 130 (table 0x804AA8E8), not the view's size.
- The box is exactly around the Links at a round's start, then around the Links still in, the FOCS points and Vaati.
  Each edge eases a tenth of its gap a frame, all four scaled alike so that the farthest moves at most 3 px (Hyrule
  Castle's first frame of play: +3, −0.6, −1.0, +0.6 for gaps 120, −24, −40, 24). An edge follows a Link out (15 px
  behind at 1.5 px/frame: the camera acts on the positions of the frame before), holds 60 frames once no Link is past
  it, then comes back in to 128 px outside the outermost one (P2 back at 749: the edge settled at 877), never closer.
- The view is the box ± 86 px, clipped to the room, the other axis widened to 608:448 around the clipped box's middle,
  at most 512 × 377.3 (the room's width), then moved inside the room: The Field's start (Links 112 px apart) gives
  284 × 209.3 centred on y 279.37. The zoom on frame 0 of every round state matches (2.1408, 1.4757, 1.6, 1.6716,
  1.1875; 3–4 players 1.6716 …). With FOCS the camera stays on them: Hyrule Castle (176–320 × 144–304) settles on
  (248, 221) at zoom 1.3742 (clipped at the room's bottom), Above the Clouds (96–384 × 64–304) on the whole width.
- Applied: apps/battle `camera.ts` (tested against these numbers in `camera.test.ts`). What mode 1's 130, 32 and the
  second 3 do is unknown (no minimum size showed: the box never gets small after its first moves).

**Round end** (BFIN; the Field, P2 poked to 1 life and stabbed on frame 68): BFIN +0x230 = 1 on 205 (137 frames later;
also 137 after Vaati: 862 → 999), 2 for 130 frames, 3 for 25 (+0x238 counting 0 → 12, one every 2 frames), 5 for 130,
then 6 (on 491), waiting: an A on P1's GBA (seen 601) removed BFIN, and the Links were gone on 628 (the scene unloads;
no Link again by frame 1411, with Start and A pressed later: result.arc's "Total" screen, "J2D screens in Dolphin"). **Round start**
(`ref/battle/area-2p.sav`, A on The Field on frame 10): the arena and its Links appear on frame 60 (the camera snaps
to them on 61), and play starts on 469 (the generators' first count; P1, holding right from 216, turned on 470): 409
frames of "Be the last one standing!" and "Go!" (no countdown: "Shadow Battle's round screens in Dolphin" below).
Applied (2026-10-02, online version 8): battle.ts's `COUNTDOWN_TICKS` 409 and `RESULT_TICKS` 423 (the match's last
round ends there; the others go on to our Total screen, `TOTAL_TICKS` 195, then the next round by itself).
