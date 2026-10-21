# FSA formats: Shadow Battle arenas (boss500), backdrops, lighting, switches

Part of the FSA file-format notes (index: [../formats.md](../formats.md)).

### Shadow Battle layout (`boss500`)
- **confirmed** `map/map500.csv` has no `mapNNN` header and no grid: one line per room, `room,c1,…,c8`, then `end`.
  Rooms 0–9, and lines 5–9 repeat lines 0–4 exactly. `parseBattleLayout` in `packages/formats/src/fsa/stage.ts`;
  `Stage.battleRooms` holds the lines, and `Stage.layout.rooms` places room r at column r mod 5, row r div 5 of the usual
  10×10 grid, so grid-based code still works. `Stage.tilesetIndexOf(room)` / `overlayTextureIdOf(room)` give the per-room values.
- Columns (after the room number):
  - **confirmed** c3 = tileset index. Rendering each room with each candidate column only gives clean pictures with c3.
    Values: 13, 3, 9, 4, 24 for rooms 0–4.
  - *hypothesis* c5 = ground overlay ID (1, 2, 2, 2, 9). It matches the adventure maps: 1 on outdoor fields, 2 in
    dungeons, 9 only in world 8 (Realm of the Heavens).
  - *hypothesis* c8 = the adventure maps' last column (FSALib calls it `disallowTingle`): 1 for rooms 1 and 2. In adventure
    maps it's 1 exactly on the dungeon/temple stages.
  - *likely* c1 = bgmId (24, or 16 for room 4): it sits where the adventure maps' bgmId does, right before the
    `showE3Banner`-like 1 (c2), the tileset (c3) and the object sheet (c4 = 0 = `npcSheetId`), and indexes main.dol's
    stage BGM table to battle music: 24 → `JA_BGM_BATTLE_ZAKO`, 16 → `JA_BGM_BOSS` (see Audio, Stage BGM). Not yet
    heard in Dolphin (battle mode needs emulated GBAs).
  - Unknown: c2 = 1, c4 = 0, c6 = 2, 2, 1, 2, 1 (a column the adventure maps don't have), c7 = 5 (like the adventure
    maps' `unknown`).
- **confirmed** (by tileset and look) Which room is which arena. Three arenas use the tileset of the adventure stage
  with the same name, and the other two are clear from their tiles:

  | Rooms | Arena | Tileset | Evidence |
  |---|---|---|---|
  | 0 / 5 | The Field | 13 (`n`, also `boss021`) | grass, trees, a house, a cave and a lake |
  | 1 / 6 | Tower of Flames | 3 (`d`) | same tileset as `boss033` Tower of Flames |
  | 2 / 7 | Tower of Winds | 9 (`j`) | same tileset as `boss073` Tower of Winds; open sky behind ladders and ledges |
  | 3 / 8 | Hyrule Castle | 4 (`e`) | same tileset as `boss043` Infiltration of Hyrule Castle |
  | 4 / 9 | Above the Clouds | 24 (`y`, also `boss052`) | white cloud floor; overlay 9 as in world 8 |
- **confirmed** (main.dol, and the look checked in Dolphin by poking the light) Rooms 5–9 are the Dark World variants of
  rooms 0–4. Their tile layers are almost identical (0–68 tiles differ per layer), their CSV lines are identical, and
  each one adds an `LTEV` actor ("light environment control") that rooms 0–4 lack (room 1 has one too, with a different
  parameter). The LTEV is what makes them dark: see "Lighting and the Dark World" below. The `_ura_` palettes play no
  part (they're byte-identical for all 28 tilesets, see Background tiles).
- Each battle room has 4 `PLAS` player starts (params 0–3 = player index), a `BFIN` ("battle royale end check") and
  `CRGN` crystal generators. The rest is traps, switches and hazards (`HBMB` bombs and `BLZ2` flames in the Tower of Flames,
  `RBPN` floor panels above the clouds).
- **confirmed** Arena geometry, from the base layer's tile types (`packages/sim/src/arena.ts` simulates each arena as one
  room at the origin, everything outside solid). Every arena is a single 512×384 room; `PLAS` starts sit on tile centers,
  players 0/1 side by side on top, 2/3 below (x, y in room px):

  | Arena | Starts (P1, P2, P3, P4) | Floor and hazards |
  |---|---|---|
  | The Field | (200,184) (312,184) (200,280) (312,280) | open grass, cliffs, trees, bushes (0x21), a shallow lake (0x39) bottom right; no pits. A 4×4-tile square at (224,208) has no tiles: the `TFLR` "trick floor" actor sits there. 11 `TOMI` "transparent NPC wall" actors stand tile-aligned among the lake's stakes (treated as solid, *hypothesis*) |
  | Tower of Flames | (136,152) (376,152) (136,232) (376,232) | an octagon (x 80–432, y 96–288) ringed by damaging pit 0x0e; a 2×2 pit (0x03) in the middle and one-tile pits at (112,160) and (384,160). Actors: 32 `HBMB` bombs, 20 `BLZ2` "unquenchable flames", 84 `PNPC` "panel rewriting NPC", 4 `FLME` flames at the center, `BLDF` "blindfold" covers on the side pits |
  | Tower of Winds | (152,184) (360,184) (152,280) (360,280) | walled; the walkable floor is tile 0x3e0, type 0x02 ("background") and transparent in the tile layers: the tower's wall and the sky are drawn behind it (see Shadow Battle backdrops); ledges are solid, 42 ladder tiles (0x61). `SVGT` "side-view gate display NPC" ×4 next to `WARP`s, `BBSL` "giant bomb Shadow Link" at (256,128) |
  | Hyrule Castle | (200,184) (312,184) (200,280) (312,280) | a walled courtyard (x 96–416, y 96–352), plain floor. `SLR1` sword soldiers ×4, `CIRC` magic circles ×4 |
  | Above the Clouds | (104,72) (392,72) (104,312) (392,312) | a cloud island (x 64–432, y 32–352) ringed by pit 0x03, a one-tile pit in the middle (240,160, with a `WARP`); 76 `RBPN` "colored floor switch" tiles (type 0x4c) form a ring; `FBMR` fire-bar manager ×2 at the center |

  Dark World rooms differ by a few tiles (a slightly different Tower of Flames outline, more `BLZ2` flames and no bombs).
- Battle props as the sim reads them (`packages/sim/src/props.ts` `arenaProps`; behavior in `hazards.ts`, `orbs.ts`,
  `switches.ts`, `panels.ts`; the wiring is under "Switches" below):
  - **confirmed** (tiles and actor lists) `HBMB` bombs sit on the centers of the Tower of Flames' 32 type-0x0c tiles
    (sockets, params 0x101; The Field has one with params 1). `SWTH` switches are tile-bound, and most hide under
    something: the Tower of Flames' four under the pots around its fire pit (tile 0x43, type 0x01 solid), the Tower of
    Winds' under pots too (tile 0x46), The Field's under a bush (tile 0x6a, type 0x21) next to the trick floor; the Dark
    World Tower of Flames adds two bare ones (tile 0x12, params 0x…0188). (Tiles rendered: 0x43 and 0x46 are pots,
    0x50 a yellow star switch, 0x51 the pressed grey star, 0x12/0x13 an orange button up/down, 0x14/0x15 the Tower of
    Winds' side-view button.)
  - **confirmed** (code) the top 5 bits of most actors' params are the switch they set or wait for (0 = none). The Tower
    of Flames' four `FLME` flames at the fire pit's middle carry a direction in params byte 2 (0 right, 1 left, 2 down,
    3 up) and switches 10–13, which `SWOR` OR gates derive from the pots' switches 9, 15, 16, 31.
  - **confirmed** (code) `FBMR` is one fire-bar arm (init 0x801BD348): params & 0xFF balls (8), (p >> 8) & 0xFF the arm
    (start angle right, left, down, up), (p >> 16) & 1 the direction, ((p >> 20) & 15) + 1 the first ring (3: balls at
    48, 64 … 160 px), (p >> 24) & 3 the speed class (128, 256, 64 angle units per frame: 64 here, a turn every 1024
    frames, clockwise), (p >> 26) & 31 a switch that reverses it (16, set only from a GBA area). Each ball (`FBOB`) burns
    in a ±8 px box (atcp forced to 2) and gives light (radius 32, strength 128).
  - **confirmed** (code) `CRGN` (init 0x801296FC, update 0x80129598, spawn 0x80129200): the top 5 bits gate it (it
    does nothing while that switch is off); its counter starts at 150 and it makes something at 600 (300 for kind 2,
    params & 15), then waits until that's gone and counts again from 0. Kind 1 makes a `CRTL` crystal ball, kind 2 an
    item on the ground (`LSTI`) from its item mask, kind 3 a carrot (`NNJN`), kind 0 a crystal ball holding the mask's
    items. The mask is params bits 5–15, bit 5 + k selecting the item in table 0x80465058 (10 slingshot, 3 boomerang,
    4 bow, 8 bombs, 6 Fire Rod, 5 hammer, 7 Roc's Feather, 1 Pegasus Boots, 9 shovel, 2 lamp, 11 the Four Sword): 0x1e2
    = slingshot, boomerang, bow, bombs; 0x8a2 = slingshot, bow, Roc's Feather; 0x1182 = bow, bombs, boots. A crystal
    ball's content comes from a roulette table (0x80471784; in multiplayer carrot, cucco, bombchus, cucco, bombchus,
    cucco, bombchus). Details and timings: `docs/measurements/battle-constants.md` "Battle constants from main.dol";
    `packages/sim/src/orbs.ts`.
  - **confirmed** (sprites and code) the crystal balls show their content: `enemy_both2_sob` 144 + the content, remapped
    (CRTL draw 0x80320D18): 144 green "?", 145 red "?" (it blinks between them while idle), 147 a big cucco, 148 a
    cucco, 149 bombchus, 150 a red Force Gem, 151 a heart, 152 a carrot, 154 a flock of cuccos.
  - `enemyparam.csv`'s `atcp` is the damage in Link's life units (quarter hearts): an Octorok (atcp 2) takes 2 life
    (measured, `docs/measurements.md`). The spawn function copies it to the actor's +0x114, and the attack calls pass
    it, or a value the actor's init sets instead (FLME 4, BLZ2 1), or a constant (bees 1): see `docs/measurements/battle-constants.md`
    "Battle constants from main.dol". The sim uses HBMB 4, FLME 4, BLZ2 1, FBOB 2, BEEE 1, SLR1 2, THCL (a thrown
    player's hit box) 2, TUBO/CRTL 2, GRAS 1.
  - data.arc `timg/bomb_big.bti` (96×96) is the giant bomb (BBMB, which the Tower of Winds' `BBSL` Shadow Link
    carries; drawn at 0.75, `timg/bomb_big_a.bti` in its last 540 frames with main2D.arc's `timg/kk_rupynum_0N.bti` digit
    N = the seconds left at half size over it, on the TV only; Vaati's time-up is TUGF, a flying eye: enemy_gc_sob
    1126-1128); `timg/otosiana_bg_s.bti` (64×64) is
    exactly the trick floor's 4×4 tiles: the open hole (the actor's draw method names it). A lifted or cut bush 0x70 becomes 0x79
    (measured in Lake Hylia); apps/battle uses 0x79 for every bush tile.
- Battle entity sprites (`apps/battle/src/entities.ts`, picked from numbered renders of `enemy_both2_sob`; the actors'
  base frames are the code's where known): bomb 232 (233 red: flashing), explosion 234–240, eternal flame 265–272,
  small flames 273–277, horizontal and vertical flame columns 241–252 / 253–264 (not used yet), fireballs 456–457,
  arrows 76 (right), 77 (left), 78 (down), 79 (up) and shorter ones 80–91, a seed 231, the boomerang spinning 105–108 (one 16×16 graphic, plain, flipped H, HV, V; 104 is the last of 97–104, a creature), sword
  beams 301 (horizontal) and 311 (vertical), item icons 64 book, 65 boots, 66 lantern, 67 boomerang, 68 bow, 69 hammer,
  70 Fire Rod, 71 Roc's Feather, 72 bomb, 73 shovel?, 74 slingshot, 75 the Four Sword (LSTI: 64 + the game's item
  number), crystal balls 144/145 (idle, blinking every 10 frames) and, lifted, the roulette ending on the content (cucco
  147, carrot 152, bombchus 149 while it spins), a lifted bush 41, pots 33/34,
  smoke puffs 133–136, bees 460–463, cuccos 687–694 (711… big), soldier kind 1–3 poses 500–531 (512 = facing down);
  bombchus 140–143 (**confirmed**, BMTY draw 0x80325754: 140 + a step toggling every 4 frames of its fuse; its last 100
  frames 143, 142, 141, 140; in side view turned to the surface it crawls on); magic circles enemy_gc_sob 297 + color,
  scaled by how open they are; shadows from kage_sob.bin (see Actor graphics), none on a side-view screen. The giant-bomb
  Shadow Link (`BBSL`, **confirmed** by its draw 0x80340EC8 and frame dumps) is player_sob with no palette remap
  (palette 7 = the dark one): the Roc's Feather jump's 257–263 as he rises, 816 hovering, 258 holding the bomb, 813 ×9,
  814, 815 ×8, 816 throwing it, 816 fading out, 806/811/816/821 every 4 frames fading back in.
- `map/map500_ctrl.csv`: 12 lines for rooms 12–23, 8 columns in the same layout (c3 = tilesets 13, 3, 9, 22, 14, 17, 5, 7,
  8, 21, 4, 0). No such rooms exist in boss500, so its purpose is unknown (*hypothesis*: a battle-room list for a
  controller-only mode, `_ctrl` like the adventure maps' `_1`, never used: twelve arenas, five of them the real ones'
  tilesets). It has nothing to do with the side rooms, which are each room's own GBA sublayers (below).
  `parseBattleLayout` reads it too.
- Other boss500 files: `timg/sky.bti` (512×128, C8), `timg/wall.bti` (512×256 CMPR, a castle wall whose windows are
  transparent), `timg/enkei.bti` (256×256 CMPR, "distant view": Hyrule from above), `j3d/nagarekumo.bmd/.btk` ("drifting
  clouds"), `timg/otosiana_bg_s.bti` (the trick floor's hole). All BTIs wrap (repeat) and filter linearly.
- `Boss/battle1.arc`: `timg/sky.bti` and `timg/wall.bti` (byte-identical to boss500's), plus `j3d/suna.bmd/.btk/.brk`
  ("sand": a model with texture and color animations). What loads it is unknown.

### Shadow Battle backdrops (**confirmed** from main.dol; the Tower of Winds' wall checked against Dolphin frames)
What shows through the arenas' transparent tile pixels (42 % of Tower of Winds, 41 % of Above the Clouds, 52 % of
Tower of Flames, the 4×4 trick floor of The Field; none in Hyrule Castle). Implemented in `apps/battle/src/backdrop.ts`
(the J3D lava and drifting clouds through `EnvModelInstance`, placed as in "J3D models"). SWEV bit 21 (The Field, Hyrule
Castle) is the cloud shadow quad (see "Cloud shadows"), not a backdrop.
- The stage's environment manager (constructor 0x8016F0BC) loads every candidate effect resource into fields: J3D
  models (w_kumo*, `yougan`, `doku_yougan`, `yami_yougan`, `moya`, the filters, `nagarekumo` @+0xCC, `darkFog00`,
  `moya_red`…) and textures (`kumo_env` @+0xF4, `smoke`, `kawazoko`, `noize_kawazoko_1`, `bg_mori` @+0x104, `enkei`
  @+0x108, `enkei_dark` @+0x10C, `wall` @+0x110, `sky` @+0x114, `wall_koware` @+0x118, `sky_koware` @+0x11C,
  `bg_piramid` @+0x120). Byte flags at +0x1C4… choose what is drawn; missing resources are skipped.
- Each battle room's `SWEV` actor ("environment switch control") sets the flags from its params (init 0x802B5360
  splits the params into bits, update 0x802B3AB8 applies them): bit 18 → +0x1C4 (draws model +0x04 = `yougan.bmd`,
  data.arc lava), bit 16 → +0x1C9 (enkei drawer), bit 9 → +0x1CC (wall/sky drawer), bit 6 → +0x1CD (the `_koware`
  "broken" wall/sky), bit 19 → +0x1C7 (river-bed textures `kawazoko` + `kumo_env` + noise, under water). `SEV2`
  ("environment control 2", Above the Clouds only) bit 16 → +0x1CA (`enkei_dark`), bit 17 → +0x1DC (the `nagarekumo`
  model). SWEV params per arena: The Field 0x00E80000, Tower of Flames 0x00040000, Tower of Winds 0x0010020E (Dark World
  0x00100200), Hyrule Castle 0x00200000, Above the Clouds 0x0001000D (Dark World 0x00010000); SEV2 0x00020000 in both
  cloud rooms. So:

  | Arena | Behind the tiles |
  |---|---|
  | The Field | the river bed under the lake's water (stages-and-tiles.md "River bed"), nothing else |
  | Tower of Flames | the J3D lava `data.arc j3d/yougan.bmd/.btk` (not `yami_yougan`, also in the Dark World room) |
  | Tower of Winds | `sky.bti`, then `wall.bti` over it (drawer 0x8016B4D4) |
  | Hyrule Castle | nothing (bit 21 isn't a backdrop) |
  | Above the Clouds | `enkei.bti`, three `data.arc timg/kumo_env.bti` cloud layers (drawer 0x8016B910) and the J3D `nagarekumo` |

- Both drawers send screen quads (608×448, `GX_QUADS`, position + texture coordinate) whose texture coordinates follow
  the camera: with the camera center (cx, cy) in world px (from the view matrix: -translation), the zoom z, the room
  size (64, 48) in 8-px units (so 0.125 / 64 = 1/512 per px) and the environment's frame counter f (+0x1C0, +1 per
  update), a quad's s = a·cx/512 + c ± k·(608 / z / 2)/512, i.e. **s(x) = k·x/512 + (a − k)·cx/512 + c** at world x on
  screen (t likewise with 384):

  | Layer | Texture | a, k, c for s | a, k, c for t | Color |
  |---|---|---|---|---|
  | Winds sky | sky.bti | 1, 1, −(f & 0xFFF)/4096 | 3, 3, 0 | texture |
  | Winds wall | wall.bti | 1, 1, 0 | 0.75, 1.5, 0 | texture (windows transparent) |
  | Clouds far land | enkei.bti (enkei_dark with +0x1CA) | 0.1, 0.7, 0.2 | 0.1, 0.525, 0.2 | texture |
  | Clouds shadows | kumo_env.bti | 0.1, 3, −(f & 0xFFF)/4096 | 0.1, 2.25, same | TEV C0 = 0,0,0,0x2F (color input C0 only) |
  | Clouds low | kumo_env.bti | 0.2, 2.5, −(f & 0xFFF)/4096 | 0.2, 1.875, −((f + 1300) & 0xFFF)/4096 | C0 = AF,CF,CF,FF (dark: 36,61,82,FF) |
  | Clouds high | kumo_env.bti | 0.3, 2, −((f + 3100) & 0xFFF)/4096 | 0.3, 1.5, −((f + 1300) & 0xFFF)/4096 | C0 = CF,E7,E7,FF (dark: 36,61,82,FF) |

  World px here are the battle's: the arena room sits at world cell (1, 1), i.e. room + (512, 384), whichever boss500
  room it is (with that, the Tower of Winds' wall rows and windows land where Dolphin shows them, to a few px).
  So the sky is world-anchored at one texel per world px and drifts right by 1/8 px per frame; the wall is world-anchored
  horizontally and scrolls at half the camera speed vertically; the far land and clouds sit almost still on screen
  (parallax a/k = 1/7 … 1/30) while the clouds drift diagonally. *hypothesis* the cloud layers' alpha is the texture
  intensity times C0's alpha (the alpha TEV set-up wasn't read). The drawers' camera inputs were checked against the
  Lake Hylia RAM: [0x8053AB10]+0x20 → +0x2380/+0x2384 = 64, 48; +0x24 → +0x10/+0x20 = view matrix translation
  (−2418, −1673, as at VIEW_MATRIX), +0x858 = zoom 2.1408.
- The Field's `TFLR` trick floor (4×4 tiles at (224,208), its own tiles transparent) draws its closed floor from
  data.arc `smp/*_smp.bin` stamps (16×16 u16 LE tile indices; its draw method 0x802ACF04 lists `floor`, `field`,
  `jimen`, `house_left/right`, `tree0/1`, `mastersword_left/right`), in two 2×4 halves, over `otosiana_bg_s.bti`.
  *hypothesis* The Field's is `field_smp` (tile 0x1B0, the grass around the square). Params 0x11000106 (TFLR update
  0x802ADC18): kind = p & 0x7F (6: 4×4 tiles), enable switch (p >> 7) & 31 = 2, mode (p >> 24) & 3 = 1 ("follows a
  switch"); see "Switches".

### Lighting and the Dark World (**confirmed** from main.dol; the look checked in Dolphin)
Implemented in `apps/battle/src/lights.ts` (data) and `lighting.ts` (the pass).
- The stage keeps a light: a 16-byte struct at [0x8053AB10]+0x2C (vtable 0x804A0160, made by 0x801594E8): +4 RGBA tint,
  +8 the `data.arc timg/circle.bti` texture, +0xC u8 ambient level (255 = full light), +0xD/+0xE variants (0, 255).
  0x8013A884 sets the tint, 0x80128C58 the level; SWEV (mode 0) and LTEV write them every frame.
- `LTEV` ("light environment control", init 0x802EFBFC, update 0x802EF80C): kind = params & 0xFF picks a tint and level
  from a jump table (0x804AA548; kinds 2, 5, 8, 11, 15 fade 4 levels per frame from the current light, kind 16 waits
  for its switch (params >> 22 & 31) then brightens to 200). The battle rooms:

  | Room | LTEV kind | Tint | Level |
  |---|---|---|---|
  | 0, 2, 3, 4 | (none) | white | 255 (no pass) |
  | 1 Tower of Flames | 4 | 255, 200, 160 | 200 |
  | 5 Dark Field, 8 Dark Castle | 9 | 150, 200, 255 | 10 |
  | 6 Dark Tower of Flames | 3 | 255, 200, 160 | 10 |
  | 7 Dark Tower of Winds | 1 | 150, 200, 255 | 10 |
  | 9 Dark Clouds | 0 | 210, 200, 170 | 10 |
  | 2 Tower of Winds | (SWEV 0x0010020E) | 150, 200, 255, alpha 20 | 180 |
  | 4 Above the Clouds | (SWEV 0x0001000D) | 190, 210, 200 | 255 (tint only) |

  The last two rooms have no LTEV: their SWEV writes the light every frame from its +0x2E0…+0x2EC and +0x310 (update
  0x802B3AB8, jump table 0x804A86D0 on params & 15); the values were read in RAM from the round-start states (2p and
  4p), where they come from wasn't traced. The tint's alpha adds tint × alpha in the pass. Checked in Dolphin frames:
  the Tower of Winds' Links and level dim and blue alike, Above the Clouds' island (149, 180, 136) on average.

- The frame buffer's alpha holds the light: it starts at 0 and only the Links' sprites write it (255; their draw
  parameters' offset 0x2D). Light sources add soft circles to it (0x80158B5C: a quad ±r around the source at (x, y − z),
  texture coordinates −1…1 over circle.bti mirrored about its corner, its red channel through swap table 1 times the
  source's strength, blend ONE + ONE, alpha writes only): circle.bti's radial profile is 255 at the center falling to 0
  at 0.94 r. Then 0x80158F70 (when the level is below 255 or the tint isn't white): alpha += level; color × tint (blend
  src·srcA + dst·srcColor, the tint's alpha is 0); color × dst alpha. So everything is tinted, and darkened to the level
  except within the light circles and on the Links' pixels (Dolphin: a Link's hair (255, 247, 41) turns (150, 194, 41)
  under the Dark Field's tint, and doesn't darken).
- Light sources in battle: each Link, radius +0xB90 easing 1 px per frame toward 85 in multiplayer (0x802580E0: 0 when
  playing alone unless holding the lantern (item 2): 100), strength 255, at his position (+0x338 = his position when
  not alone); `BLZ2` eternal flames r 32, strength 128 per flame while lit; `FLME` fire-pit flames r 60, 128, always;
  `FBOB` fireballs r 32, 128; `ONOF` on/off crystals r 70, 128 while lit (timed and toggle kinds). The Dark World
  therefore shows about 85 px around each Link: the manuals' "much smaller field of view".
- The adventure (apps/game `light.ts`, read from main.dol, not checked in Dolphin): LTEV's fade (0x802EF76C, its
  state argument 0) steps the level 4 a frame and each tint channel by a quarter of the gap while above its target
  (else set); state 4 sets at once; kind 16 sets (255, 200, 160) at 10, waits in state 5 for its switch, then
  brightens 4 a frame to 200 (state 2, the tint kept). A Link playing alone carries 100 px only with the lamp (item
  2). `TRCH` (draw 0x802B0CD8): kinds 0/2 r 70 at (x + 8, y + 8), strength 128 while lit; kinds 1/3 r 20 at
  (x, y − 4), strength 200; the radius eases ±4 a frame. `LWSW` (0x802BE8F8): r 70 easing ±4, (x + 8, y + 8), 128.
  `ARRW` (0x8016545C): r 32, 128 while it burns (+0x94 2 or 4). `SKUL` (0x802B2728): r 30, 128.
- Checked in Dolphin (Lake Hylia, SWEV +0x310 / +0x2E0 poked to the Dark Field's light): the ground, the trees and the
  villagers go dark and blue, the Links and the HUD stay bright (tinted); alone (+0x7F = 1), the Links carry no light.
- `SWEV` bit 25 → darkFilter00.bmd (+0x1EF; no battle room), bit 21 → the cloud shadows (below).

### Cloud shadows (**confirmed** from main.dol and Dolphin)
Implemented in `apps/battle/src/cloudshadow.ts`. The environment manager's drawer 0x8016ADE0 draws `data.arc
timg/kumo_env.bti` (I4 128×128) as a screen quad with the TEV of 0x8013B1E8 (color C1 + C0 × texture, alpha A1 + A0 ×
texture alpha, blend src-alpha / inverse): C0 = (0, 0, 0, level), so the ground darkens by up to level/255 under the
clouds. Texture coordinates: s = world x / 512 − (f & 0x7FF) / 2048, t = world y / 384 − (f & 0x7FF) / 2048 (one repeat
per room, drifting 0.25 px right and 0.19 px down per frame; f = the manager's frame counter +0x1C0). Its level is
+0x1EC, which SWEV bit 21 (The Field, Hyrule Castle; Lake Hylia) raises by 1 per frame toward 47 × (the stage light
when SWEV started) / 255. It's drawn after the base layer and every sprite (the Links included) and under the top layer
(Dolphin, the level poked to 255: black blobs over the ground, the villagers and the Links, not over the fence posts).
With the ground overlay as a plain multiply (see TV rendering pipeline) it brings the Checkpoint A frame's mean luma
difference to 9.95 (from 15.6 with the old fitted overlay), the frame counter fitted to 1630.

### Switches (**confirmed** from main.dol unless marked; implemented in `packages/sim/src/switches.ts`, `hazards.ts`, `panels.ts`)
- Each room has 32 switches: a u32 at stage data + 0x178 + room y·40 + room x·4 (stage data = [[[0x8053AAF8]+4]+0xC], a
  pointer; the current room's cell x, y at stage data + 0x14, + 0x18).
  get 0x802D800C(stage, n), set 0x802D8050(stage, n, on, who) (it also counts sets at +0x308+n and keeps the setter at
  +0x328+n, 255 for objects). Switch 0 means none. The base actor vtable: +0x3C switch number = params >> 27, +0x34 is it
  on, +0x30 set it. Randomness: the LCG at [0x8053AAF8]+0xB4 (x·0x19660D + 0x3C6EF35F); the sim uses its own seeded one.
- Logic actors (5-bit input fields at shifts 22, 17, 12, 7):
  - `SWOR` (OR): its switch is on while any of its (p & 31) inputs is.
  - `SWT4` (4-switch monitor): on when all four inputs are (players' "who" must differ: not needed on the TV), off when
    one goes off (mode 2: for good).
  - `CHSW` (chain): a rising edge of its switch starts p & 0x1FFFF frames, then (p >> 18) & 3 sets (0) or clears (1)
    the target (p >> 22) & 31, and (p >> 20) & 3 sets (1) or clears (2) its own switch; bit 17 = once. Pulses and timers.
  - `OFFS`: T = its switch, X = (p >> 22) & 31; mode p & 31: 0 clear X on T's rising edge, 1 X = T ? 0 : its value at
    load, 2 toggle, 3 X = !T, 4 clear X while T. It runs once at load.
  - `CKSW` (check): when its switch (0 = at once) is on, sets one of its four inputs at random (rand(100) & 3); mode 1
    re-arms when it goes off, the others act once. It runs once at load.
  - `RNSW` (random toggle): every (p & 0x3F) × 10 frames (paused while its switch, if any, is off) sets one of its four
    outputs at random (bit 6: in turn) and clears the others; the first at frame = period.
  - `WTSW` (wait): p & 0x3FFFF frames after (p >> 22) & 31 comes on, sets its switch and is done.
  - `GEN3` (spawner): on each rising edge of its switch, a smoke puff a frame later and the spawn 2 frames after
    (mode (p >> 20) & 15 = 1 in every arena: once per edge, not above 30 of that kind). Kind p & 0x7F indexes the ID
    table 0x8046F398 (0x16 HBMB lit bomb, 0x17/0x18 BMTY bombchu, 0x02/0x03/0x1A/0x1B/0x22/0x24 SLR1, 0x08 SLR2, 0x15
    SLR3, 0x1D SLR4, 0x0F MOZO, 0x07 BZBR…) with spawn params at 0x8046F450.
  - `ONOF` (on/off switch: a crystal, tile 0xBF dark / 0xBE green): anchored on its tile's center; lit by a fresh blast
    (an exploding HBMB overlapping it) or fire; kind (p >> 12) & 7: 0/4 lit for good, 1/3 toggle, 2 lit for p & 0xFFF
    frames; 25 frames of lockout after going out; its switch is on while lit; (p >> 25) & 3 = 1 or 2 lights it at the
    start with 2 (or 3) players.
  - `DOSN` (thud switch): set by a Link's charged hammer pound or boots crash within 80 px, and left on (boots: traced,
    `packages/sim/src/boots.ts`; the hammer read, `hammer.ts`; no hammer in the TV arenas). `PNPC`: rewrites its tile (Tower of Flames floor 0x360 → lava 0x0D) while its switch is on (3–6: side rooms).
- Sources and consumers:
  - `SWTH` (init 0x802A7978, update 0x802A6BC4): kind p & 31, timer p & 0x3E0 (kind 8, 0 → 60). Dormant while its tile
    is a cover (0x43, 0x46 pots; 0x68, 0x6A bushes): lifting the pot (0x8029EDB8) or slamming something on it
    (0x802A3164) uncovers the switch (0x43 → 0x50, 0x46 → 0x14, 0x6A → 0x50). Pressed by the first Link standing on it
    (his ±7 px box over its ±1 px middle, on the ground; kinds 2, 3 also |dx| < 7); kinds 0, 2, 5, 6 on while stood on,
    8 held `timer` frames after, 1, 3 latched, 4, 7 on for good; pressed tiles 0x50 → 0x51, 0x12 → 0x13, 0x14 → 0x15.
  - `FLME` (kind 1): on while its switch is on; its size eases toward 1 or 0 by a tenth of the gap per frame and it burns
    while on and above 0.7 (from the 12th frame), in a 90 × 20 px box from its anchor along its direction (0x80466130;
    × 1.5 for class (params >> 18) & 3 = 1, not the arenas' class 0).
  - `BLZ2`: a grid of ((p >> 22) & 31) + 1 × ((p >> 17) & 31) + 1 flames 16 px apart; with (p >> 4) & 1 it waits for its
    switch (14 in both Tower of Flames rooms) and goes out when it's off; burns ±8 px while lit.
  - `TFLR`: opens when its switch is on: 8 frames, then its 16 tiles are a damaging pit (tile 13), for at least 40
    frames and while the switch stays on; closes when it's off and no Link is within ±20 px of its middle (41 frames,
    still a pit meanwhile).
  - `CIRC`: grows 0.02 per frame while its switch (if any) is on, shrinks when off, isn't drawn at 0 and works when full.
  - `RBPN` (colored floor switch, 0x80200458): period (p & 0x7F) × 10 (0 → 120) frames, start color (p >> 7) & 31, gate
    p >> 27, (p >> 22) & 31 forces a change each frame while on. Each period the panel steps to the next color (tile 0x8B
    + color: green, red, blue, purple); the player tile handler (jump table 0x804A7338 → 0x8026D6AC) makes a panel of type
    0x4C + c safe only for player c: anyone else standing on it falls as into a pit.
  - `BEEE`: they swarm on a Link's impact (hammer, boots) within 80 px (kind 0; kind 1 64 px), and only on that
    (traced: swords and blasts nearby don't).
- Per room, what shows on the TV (the side rooms' part of the wiring: "Side rooms (GBA screens)" below):
  - Tower of Flames (1, 6): `RNSW` 0x0042213C turns on switch 1 or 2 every 600 frames: 1 gates the orb generators at
    (256, 136) and (200, 200), 2 those at (312, 200) and (256, 248). The pots at (224, 160) = 9, (272, 160) = 16,
    (224, 208) = 15, (272, 208) = 31; `SWOR`s: 11 = 9 | 15 → jet right, 13 = 9 | 16 → jet down, 10 = 15 | 31 → up, 12 = 16 | 31
    → left: standing on a switch fires the two jets pointing away from its corner, as long as he stays. The eternal
    flames (14) are lit only from a side room (room 1: the north room's floor switch, SWTH 0x70000000, traced; room 6:
    its two crystals through `CKSW`/`OFFS`). Room 6 adds two floor switches 7 and 8 (kind 8, held 384 frames)
    whose bombs fall in the side rooms, and four crystals (80/416, 176/192; switches 23–26, lit 384 frames by a blast)
    that together (`SWT4` → 27) drop bombs in a side room. Bombchus (switch 30) come from side-room crystals.
  - Tower of Winds (2, 7): the pots at (48, 320) and (448, 320) hide switches 3 and 4 → `CKSW` relays → 19/20, 128-frame
    pulses (`CHSW`) → bombs in the side room. Room 7 adds pots at (48, 128) and (448, 128): switches 1, 2 → 17, 18 → a
    bombchu from (48, 224) or (464, 224) (`GEN3` kind 0x18; crawling along the side-view TV: bombchus.ts); its 14 TV
    bomb spawners (switch 23) and the giant-bomb Shadow Link `BBSL` (21) answer side-room crystals only.
  - The Field (0, 5): the switch under the bush (2) opens the trick floor; `DOSN` near the bee trees; the rest (bombs
    around (344, 152), MOZO, BZBR) answers the house's and cave's crystals.
  - Hyrule Castle (3, 8): switch 22 is set at load; timers alternate 16/17 (288/1024 frames), and each rise of 16 opens
    one random circle among 18–21 for 256 frames; 30/31 (144/288) and 26/27 (209/458) start random soldier picks: `GEN3`
    spawners at north, west, east and south send SLR1 sword soldiers, and from (112, 224) and (400, 224) SLR2 bow
    soldiers (switches 7, 8), an SLR4 captain (9) (these two: `castlesoldiers.ts`) and an SLR3 ball-and-chain soldier (10)
    (not implemented).
  - Above the Clouds (4, 9): `CKSW` 0x018E8480 picks 6–9 at load, `WTSW`s turn that into switch 5 after 1, 121, 241 or
    361 frames: the center orb generator; `RNSW` 0x00443228 turns on one of 1–4 every 400 frames: the corner orb
    generators; the 76 panels cycle every 120 frames; the fire bars' reverse switch (16) is a side-room crystal.
