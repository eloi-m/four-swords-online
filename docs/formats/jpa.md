# FSA formats: JPA particles

Part of the FSA file-format notes (index: [../formats.md](../formats.md)).

## JPA particles (`packages/formats/src/jpa/`, placement `fsa/particles.ts`; simulation and renderer `packages/render/src/jpa/`)
Every particle effect is in data.arc's `particle.jpc`. Found with `tools/dol` (`func`, `callers`, `field`, `data`) and
by reading FSA's live emitters out of Dolphin savestates (below); battle wiring in `apps/battle/src/particles.ts`.
- **confirmed** Container `JPAC2-10` (the Twilight Princess / Galaxy version): 1394 resources, resource n = effect id n,
  then 265 named TEX1 BTI textures. Block layouts as noclip.website's JPA.ts (BEM1 dynamics, BSP1 base shape, ESP1
  extra shape, ETX1 indirect / second texture, SSP1 children, FLD1 fields, KFA1 key curves, TDB1 texture table); all
  parse and every texture decodes (`jpa.realdisc.test.ts`). In the file: 1012 billboards, 224 directional, 42
  direction crosses, 32 directional billboards, 28 stripes, 52 stripe crosses, 4 Y billboards, no points; 243 with
  children, 93 with ETX1, 291 scrolling textures, 21 projected on the screen. BEM1 +0x0C (unknown to noclip) holds the
  game's flags: bit 0 (83 resources) makes createEffect pass the emitter callback at r13 − 0x70A8, bit 1 (1346–1365,
  the screen-distortion effects) moves the effect to draw group 1.
- **confirmed** (main.dol) The engine: the game's particle manager (ctor 0x8013F3E4, [[0x8053AB10] + 0x28]) loads
  `particle.jpc` and makes a JPAEmitterManager (0x800EBA98: 7168 particles, 512 emitters, 11 groups). Create
  0x800EBE1C (`&pos, id, group, resource manager, emitter callback, particle callback`; the position goes to emitter
  +0xA4), delete 0x800EC240 (233 callers), draw a group 0x800EBF88. Emission (0x800EB008): the frame's count is the whole
  part of the accumulated rate × (1 + random), the fraction kept, also while emission is stopped (noclip discards it);
  the first emission makes at least one. FSA's JPA 2 matches noclip's port otherwise, as far as checked.
- **confirmed** createEffect 0x8013CC50 (1866 callers: screen, `&pos`, id, layer, sublayer, emitter callback, particle
  callback, lift, f1 = scale): nothing for a scale ≤ 0; on a GBA screen it spawns `KMRI` / `DMGE` / `PEFF` sprite actors
  instead. The layer pushes the effect in front: y and z grow by 1024 × layer + 128 × sublayer (the TV sorts by y);
  "lift" moves an effect with z > 0 from layer < 1 up a layer (sublayer − 1); z also gets the stage's ground height
  (0x802F5E9C, 0 in the arenas). A range switch on the id picks the draw group (`fsaParticleGroup`); groups 0, 1, 3,
  7, 9 place the emitter with [[s,0,0],[0,0,0.707s],[0,0.707s,0]] (JPASetRMtxSTVec: rotation swapping Y and Z, JPA's
  up becoming FSA's z, dynamics scale (s, 0.707s, 0.707s)), groups 2, 4, 5, 8, 10 with no rotation and (s, s, s);
  particles are scaled (s, s). Some ids are remapped by game state (0x802D6A9C() + 0x131F1 / 0x131F2 flags: 975 → 1108,
  979 → 1109, 278 → 1102…; not applied). Actors then move effects with 0x8013CB44 (same layer rule, translation only)
  and some turn them with 0x800EF008 (s16 X, Y, Z angles, R = Rz·Ry·Rx), replacing the swap.
- **confirmed** Queued effects (group 255: 837–860 and 1357): resident emitters made once (0x8013DDEC: no rotation,
  scale 1, maxFrame cleared, emission stopped); createEffect only queues the position (1024 slots of 16 bytes at
  [[0x8053AB10] + 0x28] + 0x10, live one frame), and the resident emitter's after-callback (0x8013F588 → 0x8013C958)
  creates that frame's emission count at each queued position.
- **confirmed** (code and RAM) The view: groups 0, 1, 3 (0x8013D6E4), 7 and 9 draw through the TV camera's view
  (camera object [[0x8053AB10] + 0x24] + 0xE4, the same [1 0 0 −cx | 0 1 −1 −cy | 0 1 0 −cy − 3072] as 0x80536C50) and
  its projection (+0x34: diag(2/w, −2/h, …): view space is y-down, the projection flips it). A billboard's texture
  row 0 is at view +y, so it shows upside down compared with a y-up game; the art allows for it (845, the eternal
  flame's tongue, is turned 180°). Groups 2, 5, 8 and 10 use another camera ([[0x8053AB10] + 0x10] + 0x80, identity in
  battle) and a screen texture projection; group 1 draws after a copy of the frame (the heat haze).
- **confirmed** Reading the live emitters out of a savestate's RAM (`tools/dolphin/src/ram.ts`, then walking the
  lists): the emitter manager is [[[0x8053AB10] + 0x28] + 0xC]; group g's list is at [manager] + 12·g (head, tail,
  count); an emitter's link is at +0x58 (object, list, prev, next); emitter +0x24 maxFrame, +0x68 rotation (3×4),
  +0x98 dynamics scale, +0xA4 translation, +0xB0 particle scale, +0xE4 the manager, +0xE8 the resource (+0x3C its id),
  +0xF4 status. States saved with `trace.ts --save` at chosen frames gave the RAM rows below.
- What spawns what (ids, createEffect's layer / sublayer, scale; RAM = seen in the live emitters, code = read only):

  | Actor / event | Effects | Confidence |
  |---|---|---|
  | FLME fire-pit jets (kinds 0–3, 6; the arenas' are kind 1) | 430 before it ever comes out, 428 while out (size ≥ 0.1), 429 after it goes out (594/595 with params bit 20); layer 1/1, scale 1 + ((params >> 18) & 3)/2, from the actor + 3 px along the jet (table 0x804A0310; none downward), turned by X 90° (down only), Y (0x80466110: right −90°, left 90°, down 180°, up 0), Z 180° | RAM (the four at a round's start: (771, 1728, 1152), dyn (1, 0.707, 0.707)), code |
  | FLME kinds 4 and 5 (fires) | 62, 59 (sublayer −1), 60, 61 (layer 1/1); scale 0.33 (4) or 1 (5) | code |
  | FBOB, a fire bar's ball (FBMR) | 414 (its flame, turned by Y 0x8000 − the arm's heading so it trails behind) and 412 (sparks, the swap kept), layer 0, moved every frame by FBMR 0x801BD8C0; 1357 queued (layer 1/1) | RAM (Above the Clouds: 16 balls), Dolphin frame |
  | BLZ2 eternal flame, lit | 844, 845 queued, 1357 (layer 1); 1266 | code |
  | BLZE (BLZ2's GBA flame) | 415, 416, 417 + 1357 (×1.5); 841, 842, 843 + 1357; 596, 597 | code |
  | HBMB fuse, lit | 102 (smoke), 103 (sparks) at the bomb's own (x, y, z), no layer, scale 1, moved with it; the blast deletes them | RAM (a lifted socket bomb) |
  | HBMB explosion | 89, 90, 91 (+ 92 for params 8 and 9, which blow at scale 2), layer 1/1, lift, scale 1 | RAM (a chain of 14 socket bombs, one at z 18.5) |
  | HBMB in water, lava | 980, 976; 1267–1274 | code |
  | A bush cut by a sword | 855 queued at it | RAM (The Field) |
  | GRAS, a thrown bush | 977, 978; lands in water 976, lava 681/682, poison 1118/1119, else 855/856 queued; on fire 418 | code |
  | TUBO, a pot breaking | 171 (smoke), 172 (pieces), layer 1 | RAM (a pot thrown in the Tower of Flames) |
  | CRTL, an orb | breaking (0x80320374): 1380 (×0.5, layer 2) and 1283 (smoke, layer 1) at it; 681/682/976 (lava, water), 89–91 (a bomb inside), 975, 1378/1379 | code |
  | A sword hitting a Link | 586 (hit mark), 587 (slash), at the victim, layer 1/1 | RAM (a stab in The Field) |
  | A Link's rank by life changing (the HUD's "1st"… object, 0x802CA7F4: rank = how many playing Links have more life, +0x244, against last frame's +0x254) | 933 when it drops (the purple stars), 934 when it rises; createEffect at (x, y − 28, z), then every frame its place set there and its scale 0.4 on every axis (dynamics and particles); for 180 frames, then stopped; a new change deletes the old one. So a hurt Link gets 933 (a blast, a pit too), and one no longer behind gets 934 | code; RAM (933 after the lava's 2 life: (769.5, 571.5, 0), ×0.4), Dolphin frames |
  | A Link in the lava (type 0x0E pit) | 681 (glow, layer −1), 682 (drops, sublayer 1) about 40 frames into the fall, at the pit; the burning Link's two (below) when he jumps out (fall state 0x80290FC0, counter +0x3FC ≥ 58, pit style +0xCF4 = 12); 975 (dust) and 933 on landing | RAM (the four, and 975 / 933 at the landing: frames 190, 233 of a walk into the fire pit) |
  | A burning Link | entering the knockback (state 15, 0x80279CFC) from hit types 7, 8, 9, 28 (the eternal flames, the jets…), or jumping out of the lava: by his facing (right, left, down, up) 584 / 583 / 582 / 585 (+0x135C, at him, following him, sublayer −1 facing down) and 580 / 579 / 578 / 581 (+0x132C, a particle callback; the emitter stays where it began); both turned by Y 0x4000 / 0xC000 / 0 / 0x8000 (table 0x8046BC98, replacing the swap); stopped when the state ends | code; RAM (585 following him up with the lift, 581 left at the pit, facing up) |
  | A Link's dust | 979 (sublayer −1, an emitter callback) at his feet while knocked back (created on the ground, then moved only while on it) and while rolling (0x80281A90), 980 instead on tile type 0x39; stopped when the state ends. 975 where he lands from any height (0x80285F44: z ≤ 0 after > 0, 4 frames apart at least), 6 px lower, on plain ground (976 on water, 1267–1274 on lava…) | code; RAM (975 at (x, y + 6) on landing) |
  | PRTC (init 0x802E111C: by its kind, params & 0xFF, table 0x804A9B40) | kind 0 (a waterfall's foot) 392, 393, 394; 1: 395–397; 2: 1362 (the ripple, a distortion); 3: 382; 4: 383; 5: 384; 6: 110; 7: 169 (layer −1), 170; 8: 111; 9: 389–391; 10: 136 (layer −1), 137; layer 1 otherwise; params bits 11 / 10 / 9 / 8 move them a room right / left / down / up; with params bits 20–23 set none at init (its update 0x802E0AB8 makes them later: not read) | RAM (Lake Hylia room 6's kind 0: 392–394 at (x, y + 1024, 1024), no 1362: the grey spiral we drew over its waterfall's foam was 1362), code |
  | WARP style 0x0E, a whirlpool (init 0x80228B60) | 1363 (its swirl, a distortion: the frame copy tinted by c1 (128, 128, 255), so a blue spiral) layer 0 / sublayer −1, and 1262 (sparkles) layer 0, lift, scale 1, at the warp's middle (the init moves a WARP to x + 8 − x mod 8, y likewise); style 37 the same, 1363 on layer −1; deleted only by the destructor | RAM (Lake Hylia room 6's (416, 224): 1262 at (424, 232, 0), 1363 at (424, 104, −128)), Dolphin frame (the blue swirl and sparkles there) |
  | TRCH torch | 189, 1354 (distortion, drawn; its layer taken as 189's) | code |
  | GEN3 (soldier spawner) | 860 (smoke) | code |
  | The Tower of Flames' backdrop | 680 (embers), the environment manager (0x8016DE30, with the lava's flag +0x1C4): at world (512·trunc(X / 512) + X, 384·trunc(Y / 384) + Y, 0) with (X, Y) = half the camera's center, layer −1, moved there every frame; 1355 (group 5, a screen distortion) at the origin | RAM ((382.6, −716, −1024) for the camera at (765.3, 616)) |
  | SLR1 soldier, CIRC magic circle | 985, 1139/1140, 827, 681/682; 678, 679 | code |
  | A Link's round intro (0x80253E6C, his counter +0xD38 = 16) | 1048, 1049, 1050: the dark portal he comes out of, at his feet, layer 0 / sublayer 1 | RAM (the 2-player intro: (712, 792, 128), (824, 792, 128)) |
  | The round's winner (0x801E67C4, at "P1 WIN!") | 203 + 204: the sparkle on his raised sword, 7 px right of and 27 px over him, layer 1 | RAM ((807.5, 1661, 1024)) |
  | The Total screen's star (0x803D75B0, by its .bck frame) | 1231 trailing it (frames 2-19, moved with it), 1233 as it lands (19), 1232 on each pulse (80): group 4, the 2D screen's own space (positions in screen px) | RAM ((84, 246): P1's first slot) |
  | A charging sword (state 8: entry 0x8027C4FC, update 0x8027BE74, exit 0x8027BC90; the counter +0x403, 0x80274CB8: 1 on the charge's first frame, +1 a frame, 49 at most with the level-1 sword, 168 with the Four Sword) | counter < 48: 623 (layer 0/1, lift) along the blade, moved every frame to 6 + ⌊14 c / 48⌋ px ahead (+4 / −4 across facing down / up, 5 px further up); on 48 its emission stops, and at the tip ((18, 0, 2), (−18, 0, 2), (4, 18, 2), (−4, −18, 2) by facing, table 0x8046BCE8): 203 + 204 (layer 0/−1, lift), the glow 624 sideways / 626 down or up (625 / 627 with the Four Sword; moved every frame to (13, 0), (−13, 0), (4, 9), (−4, −14), the Link's layer and sublayer − 1, no lift) and a `PEFF` kind 2 sprite (enemy_both2 683, 684, 685, 686, 683 over 11 frames, drawn on the TV too); the exit stops them all. The Four Sword's counter 168 (the other tip table, 0x8046BD18): 203 + 204 again and 620, 622, 619, 621 by player (not modelled) | RAM (counter 47: 623 at (716, 807, 128); 48 on: 203, 204 at (716, 1450, 770), 626 at (716, 545, −128), the Link at (712, 664) facing down), code, Dolphin frames |
  | Player code, not mapped | 1283; 862–865; 427 + 1354; 571–575; 980, 278, 277; 655; 1234; 249/250; 653/654 | code |
- Rendering (ours): every shape but points, fields, key curves (Hermite in every interval: noclip holds the last key's
  value inside the last one), children, scale / alpha / rotation / color / texture animations, ETX1 second and indirect
  textures, GX blending, alpha compare and Z mode. The distortion effects (projected, BEM1 user flag
  bit 1) draw a copy of the frame in place of texture slot 0 (`AK_kagerouSwap00`, a stand-in), sampled at the
  fragment's screen place, shifted by the indirect texture (offsets in 608×448 frame texels, *guess*) and cut out by
  the second texture (the mask); their meshes are drawn in a pass after the arena (apps/battle `drawDistortion`: a
  framebuffer copy, only while one shows; no measurable GPU cost in perf.ts; `render/jpa/distortion.ts` since
  2026-10-10, apps/game too). Checked against Dolphin: the fire bars warp the tiles around them (clouds-2p). Group 5's
  1355 (the Tower of Flames' screen-wide haze) is drawn in the TV frame's own space (identity view, an orthographic
  608 × 448 y-down camera, in front of the arena): its resource puts the emitter at (304, 480), under the frame's
  bottom, a line volume 550 wide along x (the line's z turned by the emitter's Y 90°), particles 300 px wide (6 × ±25)
  rising 50 px a frame for 10 frames, ±1.5 px offsets; against Dolphin's flames-2p (block matching of the floor
  between frames 3 apart): 59 % of the blocks move ≥ 1 px in Dolphin, 45 % in ours (2 % without the haze), 2-3 px
  9 % vs 2 %. Not drawn: 1347/1348 (group 5, spawner unknown), logic-op blending. Compared with Dolphin: Above the Clouds' fire bars (`clouds-2p`, frame 50) match in the
  balls' flames (angle, size, color, trailing side); the fire pit's idle flames (`flames-2p`) match in shape and size,
  ours a little more orange.
