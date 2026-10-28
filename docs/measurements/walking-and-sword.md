# Measurements: method, walking, collision, room changes, sword, sim constants

Part of the measurements from the real game (index: [../measurements.md](../measurements.md)).

## Method
- **Tooling** (`tools/dolphin`, see docs/dolphin.md): `trace.ts` writes an input movie (`dtm.ts`) from a script such as
  `20 idle; 50 left; 80 up`, starts Dolphin from the savestate with its GDB stub enabled (`gdb.ts`, `dolphin.ts`),
  breaks at the head of `main()`'s loop (0x801347F8, hit exactly once per 60 Hz frame) and reads the fields in
  `fsa.ts` into a JSON trace. `trace-print.ts` tabulates a trace; `fixture.ts` turns traces into the sim's regression
  fixture. A 1000-frame trace takes about 10 s.
- **Input timing**: FSA polls the pad twice per frame, so the movie holds 2 states per frame. The PADStatus the game
  sees at loop head *f* is the input its update *f* used; the sim is compared tick for tick against that.
- **Finding Link**: per-frame recordings of RAM regions while walking right showed float x positions stepping by
  1.5 px; walking the JKRExpHeap block list ("HM" headers) around them gave four 0x13BC-byte blocks with vtable
  0x804A6F38, the four Links. A write watchpoint on x found the movement code (0x802808E8: pos += speed × stick
  direction) and the wall resolution (writes at 0x8026B4A8 that undo a step 0.5 px at a time).
- **Sprite anchor**: a frame dump fitted with `tools/render/src/compare.ts` (scale 2.1535, room origin 229.19, 32.44)
  plus a template match of each Link's SOB frame put the sprite anchor at the actor position (offsets 0 to −0.75 px,
  within the fit's error). So actor position = SOB anchor = the sim's player position, and the collision below is
  relative to it.
- **Traces**: open-field walking, taps, reversals and diagonals; walks into the fence (x 368–383), the tree line (y ≤ 47),
  the south wall (y ≥ 352) and bushes; seven approaches each to the convex corner of the fence/wall at (383, 239),
  from below and from the right; room changes to the right (twice) and to the left; analog stick tilts and the
  D-pad; sword presses, holds and charge-walks. The ones in `packages/sim/src/dolphin-traces.json` carry their
  scripts.

## Walking
| What | Value | Confidence |
|---|---|---|
| Speed | **1.5 px/frame**, from the first moving frame, no acceleration or deceleration | confirmed |
| Diagonal | **1.0607 px/frame per axis** (1.5 along the stick angle: 1.5/√2; x 1.0605, y 1.0607 from the sine table) | confirmed |
| Start | the first frame with input from standing only turns Link (standing sprite of the new facing); he moves from the next frame, so a 1-frame tap never moves him | confirmed |
| Stop | no movement on the first neutral frame; that frame still shows walk frame 0, then the standing sprite | confirmed |
| Turning while walking | immediate (no extra frame), the walk cycle carries on | confirmed |
| Facing | kept while its direction is held (down + down-right stays down); otherwise horizontal wins (facing down + up-right turns right) | confirmed |
| Walk cycle | tick 1–23 then 0 (24-tick cycle), frame = tick / 3, so **3 ticks per walk frame**; tick is 1 on the first moving frame, resets to 0 on stop | confirmed |
| Standing sprites | player_sob **60 right, 61 left, 62 down, 63 up** (walk frame 0 is a stride) | confirmed |
| Analog stick | no slow walk: below a threshold nothing, above it full speed. Stick normalized as PADStatus / 54 (clamped to 1): 0.59 doesn't walk, 0.69 does (diagonal 0.5/0.5 doesn't, 0.69/0.69 does) | measured |
| D-pad | doesn't move Link (in formation mode) | measured |

## Collision
- **Shape** (confirmed): 8 point sensors relative to the actor position: side middles (0, −7), (0, +7), (−7, 0),
  (+7, 0) and corners (±5, ±5), an octagon. Each tests the solid map at the floored pixel. The 8×8 solid map from the
  base layer's tile types matches the game exactly (bush tiles 0x21 included, while uncut).
- **Walls** (confirmed): the step is taken whole, then undone in **0.5 px** increments while a leading sensor is in a
  wall, so Link stops within 0.5 px of the wall with his sub-pixel phase preserved (e.g. x 391.254 against the fence
  at x 383, y 55.16 under the trees at y 47, y 344.66 above the wall at y 352). A side sensor that ends up in a wall
  pushes Link straight out in 0.5 px steps while he keeps walking (seen as +1.0, +2.0, +0.5 jumps past corners).
- **Corner sliding** (confirmed): the game advances a straight step in fifths (0.3 px at walking speed). A fifth
  that would put exactly one leading corner sensor in a wall while the leading side's middle sensor is clear goes
  sideways instead, away from that corner. So Link slides at walking speed and is forgiven up to **5 px** of overlap
  (the corner sensors' offset); if the middle sensor hits, he just stops. Diagonal input slides along walls by its own
  axis components (1.06 px/frame); corner sliding with diagonal input wasn't tested.
- **Slopes** (traced 2026-10-28, Lake Hylia room 2's area 5 from `ref/adv/room2-cave5.sav`; the sim's
  `slopeSolid`, formats' `tiletypes.ts`): tile types 0x08 (bottom-right), 0x09 (bottom-left), 0x0A (top-right), 0x0B
  (top-left) are solid on one side of the tile's diagonal, the diagonal included, by pixel: 0x0A where `lx >= ly`
  (lx, ly 0-15 in the tile), 0x0B where `lx + ly <= 15`, 0x08 `lx + ly >= 15`, 0x09 `ly >= lx` (0x08 and 0x09 by
  symmetry, not walked). Nothing else: walking straight into one, the corner sliding above slides Link along it. Holding
  up from (128, 332.5) the leader went up to y 316, then 0.3-1.2 px aside a frame (fifths: 4 up 1 left, 2 up 3 left,
  3 up 2 left, 1 up 4 left… 45° on average, x 128 -> 120.9), a 2 px side push past the tile's corner (122.9 -> 120.9),
  the next 0x0A tile (x -> 104.8 by y 272), then up a 0x0B one to the right (x -> 119.1 by y 193). Replayed from
  Dolphin's frames each fifth's choice matches the floored-pixel test; the whole walk on the sim stays within 0.4 px
  (our 1/256 px fifths against the game's floats; `fourswitch.realdisc.test.ts`).
- **Pushing** (measured, not in the sim): after 20 frames of walking without progress Link enters a push state
  (state 13; sprites 666/670/674/681 by direction…): no movement at all, which also ends a diagonal slide along the
  wall. After the stick is released the push state lasts 6 more frames before idle, delaying the next walk by that much.

## Room changes
- **Trigger** (confirmed for left and right): the leader within **20 px** of the room's side (x ≥ 492 or x ≤ 20,
  room-local) with a room beyond it. *Hypothesis*: the same 20 px at the top and bottom.
- **Auto-walk** (confirmed): for **25 frames** Link walks on by himself, ignoring input, at **(d + 56) / 32 px/frame**
  where d is his distance to the side at the trigger (2.367 px/frame from 492.254; fits three transitions to
  0.001 px). He ends about 39.5 px inside the new room. His walk cycle restarts at tick 1 and runs at **2 ticks per
  frame**. Then 1 still frame, then control returns (with the usual 1-frame start). The three followers are stacked
  onto the leader at the trigger.
- **Camera** (confirmed): the pan starts 3 frames after the trigger frame and lasts **30 frames**, a quadratic
  ease-out `p = p0 + (p1 − p0)(1 − (1 − k/30)²)`, k = 1…30, from the old room's clamp to the new one's (2418 → 2702
  world px: 284 px, one view width; the camera clamp implies a view 2 × 142 px wide). Outside transitions the camera
  follows the formation with smoothing (not measured further).

## Sword (formation mode; implemented in `packages/sim/src/actions.ts` and `animations.ts`)
All confirmed from traces unless marked. Frame P = the frame the press is seen on.
- **Which attack** is decided on P+1: the stick pushed on P or P+1 makes it a **swing** if Link was in the walk state on
  P (facing kept, even if the stick points elsewhere), a **lunge** if he was standing (turning to the stick); the
  stick neutral on both frames makes it a **stab**. On P itself Link still walks, stops or turns as usual.
- **Swing**: 8 frames in state 4, no movement. Sprites right 32, 33, 34, 35 ×2, 36, 37, 38; left 39–45; down 46–52; up
  53–59 (7 frames, the 4th shown twice). P+9 is the idle (turn) frame and walking resumes on **P+10**.
- **Stab**: 8 frames, no movement. Right 594, 595 ×4, 596, 597 ×2; left 598–601, down 602–605, up 606–609 alike.
- **Lunge**: 31 frames, **4 px/frame for the first 10** (40 px) along the facing. Right 610 ×6, 611, 612, 613, 614 ×2,
  615 ×20; left 616–621, down 622–627, up 628–633 alike. Into the fence it stopped and bounced back ~4 px (not modelled).
- **Buffering**: a B press during a swing, stab or spin is ignored, not buffered; a press after it ends starts a new one.
- **Charge**: B still held on the attack's last frame enters state 8 on the next (after a swing, stab or lunge). A
  release fires the spin only if B was held at least **56 frames counting the press frame** (8 attack frames + 47
  charging frames); 55 just ends the charge. On the release frame the charge pose stays; the spin (or idle) follows.
  The sprite never switches to the glowing-sword frames (68, 84, …), so the game's full-charge flash must be a palette
  effect (*hypothesis*; not traced). After a lunge, the count needed wasn't measured.
- **Charge walk**: **1.125 px/frame** (0.75 × walking), 0.7955 per axis on diagonals, facing kept, no turn frame (moves
  on the first frame), and forward, backward and sideways all use the same frames: a 28-tick cycle, right 67, 69, 71,
  73, 67, 69, 71, 73; left 75–81 alike; down 83, 85, 87, 89, 83, 91, 93, 95; up 97, 99, 101, 103, 97, 105, 107, 109;
  for 4, 2, 4, 4, 4, 2, 4, 4 ticks. The tick restarts on stopping (stand frame 67/75/83/97). A room change cancels the
  charge. Walking the held sword into a wall plays **swordTink** (state 55, right 273–276, left 277–280, down 281–284,
  up 285–288 for 2, 4, 4, 5 frames) and keeps the charge (not modelled).
- **Spin**: 26 frames in state 9, no movement: wind-up on the facing's own frames b + 1 ×2, b ×4, b + 1, b + 2 (b = 151
  right, 155 left, 159 down, 163 up), one clockwise turn through 143 (up-right) … 150 (up) starting one step before the
  facing (right from 143, down from 145, left from 147, up from 149), 1 frame for the first cycle frame then 2 each,
  and b + 3 ×3.

## Sim constants (packages/sim)
| Constant | Old | New | Confidence |
|---|---|---|---|
| `WALK_SPEED` | 384 | 384 (1.5 px) | confirmed |
| `WALK_SPEED_DIAGONAL` | 272 | 272 (true value 271.53/256; drifts 0.0018 px/frame) | confirmed |
| `WALK_FRAME_TICKS` | 4 | **3** | confirmed |
| `HITBOX` | −6…5 × 0…7 | **±7 × ±7 side sensors, `HITBOX_CORNER` 5** (octagon) | confirmed |
| `NUDGE_RANGE` | 4 | **5**, sliding at walking speed in `NUDGE_STEPS` = 5 fifths | confirmed |
| `WALL_BACKOFF` | (pixel snap) | 0.5 px | confirmed |
| `STAND_FRAME` | walk frame 0 | 60–63 | confirmed |
| rooms.ts | (none) | `ROOM_EDGE` 20, `ROOM_WALK_TICKS` 25, speed (d + 56)/32, 2 ticks per walk frame | confirmed (left/right) |
| apps/game `ROOM_SCROLL` | 0.15/tick easing | `ROOM_SCROLL_TICKS` 30 quadratic ease-out, `ROOM_SCROLL_DELAY` 2 | confirmed |
| animations.ts `SWING` / `STAB` / `LUNGE` / `SPIN` | 18-tick swing, 25-tick spin | measured orders and ticks above (8 / 8 / 31 / 26) | confirmed |
| `CHARGE` | ½ speed, 60 ticks, glow frames | 288/256 px (204 diagonal), `fullTicks` 47, 28-tick walk cycle, no glow frames | confirmed |

Behaviour changes in `player.ts`: the 1-frame start, facing priority (horizontal first), standing sprites, and the
sensor-based collision (whole step + 0.5 px backoff, side push-out, corner sliding by fifths) replacing the
pixel-stepping box. `packages/sim/src/measured.test.ts` replays 5 traces (1391 frames: open ground, walls, room
changes, two corners) and matches the game within 0.075 px on open ground (diagonal rounding), 0.05 px through
room changes and 0.002 px against walls and corners, with identical sprite frames except the 1-frame stop pose.
