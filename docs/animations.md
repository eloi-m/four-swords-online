# Link's animations (`data.arc/sob/player_sob.bin`)

Working notes on the 981 frames of `player_sob.bin`. The machine-readable version is
`packages/sim/src/animations.ts` (`PLAYER_ANIMATIONS`, frame indices only); a test checks that it covers every frame.

**How this was done:** the frames were rendered as numbered catalogs
(`FIRST=<n> COUNT=<n> SCALE=<n> node tools/render/src/sprites.ts player_sob.bin out/x.png 8 scl/cu_cl_obj_base_scl.szs <columns>`)
and classified by eye. Identical part lists were found by comparing the parsed frames (for example 60 = 0, 144 = 161 = 221).
The frame order within an animation, and every timing, lives in the game code; the sword actions' order and timings
were measured in Dolphin (`docs/measurements.md`).

Confidence: **high** = obvious from the pictures and consistent with duplicates; **medium** = clear what it shows, but the
split or play order is inferred; **low** = a guess.

## Conventions seen in the file
- Per-direction blocks come in the order **right, left, down, up**, like the walk cycles.
- Walk-like cycles often have **4 frames sideways and 7 up/down** (charge walk, rod walk, push, carry, `swordHoldAlt`).
  The vertical cycles hold a standing frame plus 6 steps with two identical "passing" frames (89 = 95).
- The sword is always drawn with **palette 10** (blade `0:68` / `0:45`…, swoosh trails `0:1e`, `0:3e`); Link himself uses
  palettes 7 and 15, which are replaced by the player color. The glowing charged blade is a different tile (`1:f2`, `1:d4`).

## Sword
| Frames | Action | Split | Confidence | Notes |
|---|---|---|---|---|
| 32–59 | swing | 7 per facing (R 32, L 39, D 46, U 53) | high | The swoosh trail shows the direction: right goes up → down, down goes left → right, left and up are mirrored. Play order = file order. |
| 60–63 | stand | 1 per facing | high | Identical to walk frames 0/8/16/24. |
| 64–66 | blink | R, L, D | medium | Same poses, another head tile; no up variant, since the face isn't visible. |
| 67–110 | charge walk forward | R 67–74, L 75–82, D 83–96, U 97–110 | high | Pairs of (normal, glowing sword). The first pair is the standing pose; then 3 steps sideways, 6 up/down. |
| 111–142 | sword held, head turned | L 111, R 119, U 127, D 135 (8 each) | low | Sword still points forward, but the head turns. Same (normal, glowing) pairs. Not the backward charge walk: the game walks backward with the forward frames (measured). |
| 143–150 | spin cycle | UR, R, DR, D, DL, L, UL, U | high | Clockwise full turn with swoosh trails; play order measured (see SPIN). |
| 151–166 | spin starts | R 151, L 155, D 159, U 163 (4 each) | medium | Link faces his facing with the sword wound up *behind* him, then sweeps clockwise. |
| 219–229 | spin (facing down) | one sequence | medium | A stand-alone spin laid out in play order: 219–222, then cycle frames 147, 148, 149, 150, 143, 144, 145 (duplicates). This is what the per-facing spins in `SPIN` are modelled on: 4 start frames, then 7 cycle frames (skipping one), about 1.4 turns. |
| 197–218 | sword held out, other set | 4/4/7/7 | low | Blade further out, no glow variants. Strafing while charging? A dash? |
| 273–288 | sword tink | 4 per facing | medium | The charge pose (273 = 67) with sparks at the tip: the held sword hitting a wall. |
| 454–465 | down thrust | 3 per facing | low | Airborne, sword down (Roc's Feather jump attack?). |
| 562–593 | reverse swing | 8 per facing | medium (pictures) / low (use) | Rotates the other way (right: down → up). |
| 594–609 | stab (`stab`) | 4 per facing | high | Sword press with the stick neutral (measured). Ends on the charge pose (597 = 67, 601 = 75, 605 = 83). |
| 610–633 | lunge (`lunge`) | 6 per facing | high | Sword press from standing with the stick pushed: big swoosh while dashing 40 px (measured). |
| 634–649 | sword thrust | 4 per facing | medium | Pull back, lunge, retract. |
| 230–232, 453, 794–796, 953–961 | sword raised | – | medium/low | The Four Sword held overhead, glowing and flaming variants. |

## Everything else
| Frames | Action | Split | Confidence |
|---|---|---|---|
| 0–31 | walk | 8 per facing | high |
| 167–182 | knockback: white silhouette + 3 airborne/landing poses (measured, below) | 4 per facing | high |
| 183–188 | fall into a pit (shrink, sparkle) | – | medium |
| 189–196 | death (turn around, collapse) | – | medium |
| 233–240, 548–561, 662–665 | poses facing the camera (surprised, cheering, cutscenes) | – | low |
| 241–272 | tumbling in the air / seen from above (thrown or lifted by another Link?); 257–264 play for item 7 (boots?) | – | low |
| 770–793 | roll (measured, below) | 6 per facing | high |
| 289–290 | empty (the only part is transparent); 289 is the invincibility blink (measured) | – | high |
| 291–318 | Magic Hammer (raise, slam with ring) | 7 per facing | medium |
| 319–334 / 335–346 | bow shoot / bow walk? | 4 / 3 per facing | medium / low |
| 347–362 | boomerang | 4 per facing | medium |
| 363–394 | big hammer with a golden shockwave | 8 per facing | low |
| 395–418 | rod swing (Fire Rod) | 6 per facing | medium |
| 419–446 | shovel | 7 per facing | medium |
| 447–452 | sitting | – | low |
| 466–487 | rod held out while walking | 4/4/7/7 | medium |
| 488–503 / 504–507 / 508–523 | swim / dive shadow / swim with a shadow | 4 per facing / – / 4 per facing | medium / medium / low |
| 524–547 | body stretched out: swim strokes or flying | – | low |
| 650–661 | electric shock (normal, 2 skeleton flashes) | 3 per facing, order unsure | medium |
| 666–687 | push | 4/4/7/7 | medium |
| 688–703 | lift (measured, below) | 4 per facing | high |
| 704–725 | carry (walking with arms up; measured) | 4/4/7/7 | high |
| 726–741 | grab (R against a wall; measured facing left) | 4 per facing | medium |
| 742–769 | blue item stretched forward (slingshot?) + walk | 4 / 3 per facing | low |
| 797, 798–801 | sword in a pedestal?, translucent blue Link | – | low |
| 802–821 | throw and slam (measured, below) | 5 per facing | high |
| 822–825, 863–884 | front poses, 2-frame hops (866–873: Roc's Feather, measured facing down) | – | low |
| 826–837 / 838–853 / 854–855 | Epona: sword swing / gallop / other | 3 / 4 per facing / – | medium |
| 856–862 | peeking out of a hole | – | low |
| 885–916 | walk cycle with the mouth open (909–916 = walk up) | 8 per facing | low |
| 917–948 | the same with flames (on fire; 933–940 = 901–908) | 8 per facing | low |
| 949–952 | hurt: one pose each for right, down, left, up | – | low |
| 962–972 | drowning | – | medium |
| 973–980 | standing poses, tiny Link, head only | – | low |

## Measured in Dolphin: lifting, throwing, rolling, getting hurt, items
Play orders and durations (60 Hz frames) read from RAM traces (`docs/measurements/battle-combat.md`, "Lifting, throwing, rolling,
damage and items"). They settle several low-confidence rows above: 770–793 is the roll, 802–821 the throw, 289 the
invincibility blink. Per-facing blocks are right, left, down, up as usual.

| Frames | Action (state) | Play order per facing | Confidence |
|---|---|---|---|
| 688–703 | lift (17) | b ×7, b+1 ×8, b+2 ×8, b+3 ×1; b = 688 / 692 / 696 / 700. Empty lift (nothing in front): b ×8, b+1 ×13 | confirmed |
| 704–725 | carry (18) | 3 ticks each: right 704–707 ×2, left 708–711 ×2, down 712, 713, 714, 715, 712, 716, 717, 718, up 719, 720, 721, 722, 719, 723, 724, 725; standing = the first | confirmed |
| 802–821 | throw (22, 23) | t ×7, t+1 ×2, t+2 ×1 (22), t+2 ×1, t+3 ×8, t+4 ×4, t+2 ×1 (23); t = 802 / 807 / 812 / 817; the object leaves on the first frame of 23 | confirmed |
| 817–821 | slam (21, B while carrying), facing up | 817 ×7, 818, 819, 820 ×8, 821 ×4, 819 (other facings presumably t = 802 / 807 / 812) | confirmed (up) |
| 770–793 | roll (79) | r ×4, r+1 ×4, r+2 ×3, r+3 ×3, r+4 ×3, r+5 ×4; r = 770 / 776 / 782 / 788 | confirmed |
| 726–741 | grab (26, R against a wall) | 730 seen facing left (4 per facing) | measured |
| 167–182 | knockback (15) | k ×4, k+1 ×4, k+2 ×4, k+3 until landing; k = 167 / 171 / 175 / 179 | confirmed (up, down) |
| 289 | blank: the invincibility blink | shown instead of the pose while the invincibility counter is ≤ 55 and (counter mod 4) is 2 or 3 | confirmed |
| 319–334, 335–346 | bow (58) | b ×3, w ×4, b+2 ×3, b+3 ×4; b = 319 / 323 / 327 / 331, w = 335 / 338 / 341 / 344; the arrow leaves on the 7th frame | confirmed (left, down) |
| 347–362 | boomerang (61) | c ×2, c+1 ×2, c+2 ×2, c+3 ×11; c = 347 / 351 / 355 / 359; thrown on the 7th frame | confirmed (down) |
| 742–769 | slingshot (59) | s ×3, w ×4, s+2 ×3, s+3 ×4; down s = 750, w = 764 (so s = 742 + 4 × direction, w = 758 + 3 × direction, *hypothesis* for the others) | confirmed (down) |
| 291–318 | Magic Hammer (60), facing down | 306 ×2, 307 ×2, 310 ×8, 311 ×5 | measured |
| 395–418 | Fire Rod (68), facing down | 407 ×2, 408, 409, 410 ×6, 411, 412 | measured |
| 419–446 | shovel (71), facing down | 433 ×12, 434 ×16, 435 ×4, 436 ×9 | measured |
| 866–873 | Roc's Feather (72), facing down | 870 ×2, 871 ×4, 870 ×3 | measured |
| 257–264 | item 7 (Pegasus Boots?, state 70), standing | 257 ×4, 258 ×5, 259–263 ×4, 264 ×15, 257 ×3 | measured |

## What the sim uses (`packages/sim/src/actions.ts`, measured in Dolphin)
- A Sword press doesn't interrupt its own tick; the next tick starts a **swing** (`SWING`, walking with the stick
  pushed: 32–59, 8 ticks), a **stab** (`STAB`, stick neutral: 594–609, 8 ticks) or a **lunge** (`LUNGE`, standing
  with the stick pushed: 610–633, 31 ticks, 4 px/tick for 10). Movement and facing are locked; presses are ignored.
- **Charge** (button held through the attack): `CHARGE.stand` / `CHARGE.walk` (the normal-sword frames, the same
  for forward, backward and sideways), 1.125 px/tick, 28-tick cycle. A release after 56 held ticks (counting the press)
  spins. On the TV the blade keeps its normal frame (traced: 83 all through) and there is no palette flash: the charge
  shows as effects (main.dol, checked in Dolphin's RAM and frames; `docs/formats/jpa.md` "A charging sword"): a
  sparkle sliding along the blade, then on the full charge a burst and a glow at the tip and a glint sprite
  (enemy_both2 683–686), drawn by Shadow Battle (`apps/battle/src/charge.ts`). The glowing-sword frames (+1) are the
  GBA screens' (every other 2 ticks once full); `linkDisplayFrame` still flashes them for the other apps as a stand-in.
- **Spin**: `SPIN.frames[facing]` in play order (wind-up, one clockwise turn of 143–150, end pose), 26 ticks.
- **Sword hitbox:** `SWORD_BOXES[frame]` = the opaque pixels of the palette-10 parts, relative to the anchor. It's active
  during swings, stabs, lunges and spins (`swordHitbox`). Regenerate with `node tools/render/src/swordboxes.ts`; a real-data
  test checks it. This is derived from the graphics. The game's real hitbox is in the code and still needs measuring.
- **Shadow Battle** (`packages/sim/src/combat.ts`, `fighterFrame`): a hit plays `knockback` for the facing (167–182:
  white flash, two airborne poses for 4 ticks each, then the landing pose until he lands: measured), a pit plays
  `fallInPit` (183–188, 6 ticks each) and defeat plays `death` (189–196, 8 ticks each), after which Shadow Battle draws him lying on 195 (`scene.ts` `DEAD_FRAME`).
  Invincibility hides the sprite (the blank frame 289) while the counter is ≤ 55 and (counter mod 4) ≥ 2, as measured.
  The `hurt` poses (949–952) aren't used yet. The fall and death timings are placeholders.
- **Battle moves** (`packages/sim/src/moveframes.ts`, `fighterFrame` → `moveFrame`): `LIFT`, `EMPTY_LIFT`, `CARRY` (with the
  load's bob), `THROW`, `SLAM`, `ROLL` and the bow / slingshot / boomerang poses (`USE`) are the measured play orders above;
  a move's press tick shows the walking or standing frame and the move plays from the next tick, as measured. Not
  measured (battle only): a held Link (`HELD_FRAME`: 258 / 266, dangling), a thrown one (`THROWN`: the 241–248 tumble,
  2 ticks each) and riding Epona (`RIDE`: the 838–853 gallop, 4 ticks each).

## Still to measure (`TODO(measure)`)
- The charge count after a lunge, a diagonal stick for the lunge, the held
  sword hitting walls (`swordTink`, seen but not modelled), the game's real sword hitboxes, and the battle timings.

Open questions for Dolphin: what triggers the other sword sets (197–218, 562–593, 634–649); whether the held sword
pokes or hits.
