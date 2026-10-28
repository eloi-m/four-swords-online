# FSA formats: actor lists, sprites, actor graphics, GX textures, shared graphics

Part of the FSA file-format notes (index: [../formats.md](../formats.md)).

### Actor lists `bin/bNNN/d_enemy_mapNNN_RR.bin`
- **confirmed** One file per room, not compressed. It's a sequence of 11-byte big-endian records ending with a terminator
  record: ID `"    "` (four spaces) and seven zero bytes. `packages/formats/src/fsa/actors.ts` `parseActors`, and
  `Stage.actors(room)`. Across every stage there are 1564 files and 38,330 actors, all of them whole records with exactly one
  terminator, at the end.

  | Offset | Size | Field |
  |---|---|---|
  | 0 | 4 | ID, 4 ASCII chars (e.g. `WARP`, `PLAS`, `Poon`) |
  | 4 | 1 | sublayer: 0 = TV, 1–7 = GBA-screen area (same numbering as the tile layers' V) |
  | 5 | 1 | x in half-tiles (8 px) from the room's left, 0–63 |
  | 6 | 1 | y in half-tiles, 0–63 (all but 16 TV actors stay in the visible rows, y < 48; GBA areas use the whole 32×32 layer) |
  | 7 | 4 | parameters, u32 BE; meaning depends on the type |
- **confirmed** Positions. Tile-bound actors use even coordinates, the top-left corner of their tile: all 560 `DOOR`s,
  all 89 `KNBN` (talking signs), 568/570 `TKRA` (chests). Free actors are often odd, a tile's center: all 285 `HBMB`
  (bombs). The tiles underneath check out: every sign and grave sits on a solid tile, 812/909 `TRCH` (torches) and 549/560
  doors too, and 560 of the 584 `PLAS` (player starts) checked sit on floor. In the viewer, warps sit on stairs, doorways, pits and
  house doors.
- **confirmed** Byte 4 is the sublayer. The 319 chests placed in GBA areas (byte 4 ≠ 0) all sit on solid tiles of *that*
  sublayer's base layer, but only 116 of them do if checked against the TV layer.
- Parameters are type-specific. Known so far: `PLAS` low byte = player index 0–3 (every battle room has exactly one of
  each), bits 4-5 its facing. Many types put a switch or flag number in the top bits (0x80 | n<<3 patterns such as `88`,
  `90`, `98`…).
- **confirmed** (Dolphin, Lake Hylia's house both ways: docs/measurements/adventure-lake-hylia.md "Adventure: rooms, doors, enemies and Force
  Gems") `WARP`: byte 0 & 7 = the area it leads to in the same room (0 the TV, 1-7 a GBA-screen area), bytes 1 and 2 =
  the top-left of the 16 × 16 box it leads to, in 8 px units, byte 3 = the style (0x19 a door going up, 0x1A going down,
  0x1B/0x1C sideways, 0x03 from a GBA area back to the TV…; only 0x19 traced); the top 5 bits of byte 0 a switch on the
  gated styles 0x84/0xA8 (*hypothesis*). The warp's own 16 × 16 box (its anchor the top-left) is passable whatever its
  tiles, and the Link goes through within 12 px of its middle. A GBA-screen area with no warp at a door returns through
  the warp that led into it. Implemented in `packages/sim/src/adventure/` (stage.ts `warpTarget`, adventure.ts).
- **confirmed** (main.dol) `RUPY` Force Gems: type = params & 0xFF (0-11), look table 0x80471948 (Actor graphics), worth
  table 0x804719D8: 1, 5, 20, 50, 100, 150, 200, 300, 1000, 1500, 2000, 3000. `HNRY` hovering gems show (and so are
  worth) the gem of table 0x804AB038 by params & 7; of kind (p >> 16) & 0xFF 1, 2, 6, 7 they shuttle (pickups.ts
  `HOVER_SHUTTLE`, update 0x8031A6A4, init 0x8031B994). A stage's goal wants 2000 Force Gems from the four Links together
  (0x802F0404). `packages/sim/src/adventure/pickups.ts`.
- Adventure stage machinery, read from main.dol (vtable slot 3 = init, slot 5 = update), implemented in
  `packages/sim/src/adventure/` (`logic.ts`, `doors.ts`, `chests.ts`, `pickups.ts`, `enemies.ts`); a room's 32
  switches stay as they were when the Links come back (RYRN's init skips a rain whose switch is already on):
  - **confirmed** `PNPC` "panel rewriting NPC" (init 0x802C9284, setup 0x802C8F28, update 0x802C89FC): tile = p & 0x3FF;
    (p >> 16) & 0xF ≠ 0 the other layer; (p >> 20) & 7: 0 writes for good, 1-2 restores the tile when the switch goes
    off; (p >> 10) & 3 how many players it needs (0 any, 1 three or more, 2 four, 3 two or more); the top 5 bits its
    switch; without one it acts while a Link is within its ±48 px box. Special tiles: 0x30 (a chest appearing; 0x10 if
    it was opened), 0x8B-0x8E (colored panels), 22/23, 1006/1007. Of the 5,699 placed, 2,398 write for good on a switch
    and 2,390 follow one.
  - **confirmed** `ZNSW` "all enemies beaten" (init 0x802BE008, update 0x802BD924): kind p & 31, mode (p >> 7) & 31 (0
    latched, 1 follows); kinds 0-1 turn their switch on when the stage manager's +0x305C says the room has no enemies
    left (kind 0 with a chime), kinds 2-9 watch a box ((p >> 22) & 31 + 1 and (p >> 17) & 31 + 1, in 8 px).
  - **confirmed** `FOCS` "focus" (init 0x802C96E0, update 0x802C9558): input switch (p >> 22) & 31 (0: none), hold
    p & 0xFFF frames; when the input is on it asks the camera to come to it and, once it's there, turns its own switch on.
    Lake Hylia's ambush (room 9): ZNSW → 16 → FOCS → 17 → the PNPCs' grass replaces the stakes.
  - **confirmed** `RYRN` "Force Gem rain" (init 0x802A92FC, update 0x802A8284): kind p & 0xFF (jump table 0x804A8064;
    0, 6, 7 wait for the switch, 3 and 12 start at once), count (p >> 12) & 0xFF (0: 256; 40/120/200 are re-scaled for 2+
    players), two `RUPY` a frame of type 2 / 1 / 0 for a roll of 100 under 5 / under 20 / else, from 300 + rand(50) px
    up, within ±8 × ((p >> 8) & 0xF) px (0: 64) of it for kinds 6, 7, 12, else anywhere on the screen.
  - **confirmed** `YNSW` "switch for four" (init 0x8034EAB4, update 0x8034E49C, snap 0x8034E050): a ±15 px box 2.5 px
    up of its position, the four Links' bodies (+0x4C0) meeting it for 6 frames running, then each snapped onto a corner
    (±8 px about the box's middle) and a 95-frame pose, its switch on 79 frames in (docs/measurements/
    adventure-lake-hylia.md "Room 2's cave"); kind p & 15 (1: already on stays on). Lake Hylia's open the houses' shutters (`DOOR` kind 0 on the same switch).
  - `DOOR` (init 0x802C7CC8, update 0x802C59D8, 15 states not decoded): kind p & 0x7F, side (p >> 7) & 31, (p >> 12) &
    31, bits 17 and 18, the top 5 bits a switch; its ±8 px box around its anchor + (12, 4) / (12, 12) / (12, 12) / (4, 12)
    by side, moved (p >> 12) & 31 tiles along its wall (the Cave of No Return's doors have 2: measured, their key taken at
    the passage's middle). **Measured**: kinds 3 and 1 are locked (a key carried into it opens it, docs/measurements.md);
    kind 0 with a switch is shut until the switch is on (the cave's stone doors, traced).
  - **confirmed** `TKRA` chests (update 0x802EB314): the chest is the tile, 0x30 closed (0x10 open); its content p & 0xFF
    rises out as `IMUP` (draw 0x80159C28): 0-7 the Force Gems of those types (table 0x804A01A0), 8-11 the huge ones,
    16-25 enemy_both2 45-54 (16 a small key, 17 the big key, 20 a heart…), 47 nothing. Placed: content 4 ×98, 0x14 ×71,
    3, 2, 6, 0x10, 1, 0x15, 0x2E… Init 0x802EBDCC: content p & 0xFF, (p >> 8) & 15 and (p >> 12) & 15 (≥ 4 → -1)
    kept (not decoded); its middle is (x + 8, y + 12). **Measured**: opened with the GC's A, touching it, from below only.
  - **confirmed** `BLCK` pushed blocks (init 0x8028D5D0, update 0x8028C7D0): size ((p & 3) + 1) × 16 px; (p & 3) + 1
    Links pushing move it (the pushers' count 0x80239108), its length along the push, at 0.5 px/frame × 0.7 (sizes 1,
    2) or × 0.4 (size 3); once (its saved state is the way it went, restored by its init), again only with bit 8; bit 10
    fixes the way from (p >> 2) & 3 (right, left, down, up: table 0x8046C180), a size-1 block's axis (0 across, 1 up or
    down); bit 7 or 8 makes it slide on (state 8, 30 frames); bit 8 also turns (p >> 12…27) switches on at waypoints;
    size 0 blocks slide on ice (tile type 0x50).
  - **confirmed** `BCK2` color blocks (init 0x803754E8, update 0x80374BAC): one tile; color (p >> 2) & 7 (1-4 the Link of
    that tunic, 0 any, 5 a color the other BCK2s don't have, at random); way p & 3; ≥ 1 Link pushing, it must be the
    color's (0x80239558), the way its own; one tile then done (color 0); (p >> 8) & 15 still from the start; bit 5 clear:
    the save keeps it moved. Drawn both 69 (grey) or 72 + color.
  - **confirmed** `KETH` Keese (init 0x8015D844, update 0x8015CCF8): kind p & 0xF, bit 8 = it may leave a heart (one
    time in two); resting it wakes when the nearest Link is within 60 px and its rest is over, takes off with its
    heading + 0x8000 from that Link's, turns toward him by up to 0x300 a frame at 0.7 px/frame (velocity eased 0.3, by
    up to 1.0), flies 50 + rand(50) frames, lands when its wings (3 frames of 6, +0x258) are down, rests 20 + rand(20).
    Kind 3 patrols one axis (either, at random) at 1.2 × sin of an angle stepping ±(512 + rand(512)) a frame; kind 1
    waits for the tile under it to change; a swoop branch (|dx| < 64, the Link below within 128) runs in side views and
    for the heart-dropping ones (not done).
  - `GOL2` the goal: four pads (table 0x8046EA10 / 0x8046EA70 by p & 0x1F), the top 5 bits a switch (Lake Hylia's 16,
    which nothing in its room sets: the quota is assumed); `KEY0` keys are lifted, carried and thrown (the first one the
    Links get, on the boomerang's return, shows a message about the R Button and a keyhole; measured in Lake Hylia room 3).
  - GBA-screen areas with the stage manager's +0x31DF set are side views (Lake Hylia room 3's cave, area 5: ladders,
    ledges); not simulated as such.
- **confirmed** The type table is `data.arc/enm/enemyparam.csv` (Shift-JIS): `type,name,life,atcp,atcn,dstr,dasu,efsz,voic`
  with 352 rows (including `NULL`), each an ID with its Japanese name (e.g. `PLAS` "set the player's start coordinates",
  `PONT` "point check NPC") and stats. The rows with `dstr` = 1 are enemies and bosses (plus a few boss-fight props). 284 of the 285 IDs used in the stage lists are in it; the
  exception is `GSCK` (3 uses in boss040). `parseActorTypes` / `loadActorTypes` read it from the user's disc; the viewer
  shows the names on hover. Don't copy the table into the repo.
- main.dol (static code, G4SE01 rev 0):
  - **confirmed** The spawn-by-ID function at **0x801F9484** (r3 = actor manager, r4 = ID, r5 = screen, r6 = &position
    vec3, r7 = params) is a compiler-generated binary search (`lis`/`addi` + `cmpw`, with some `bge` range jumps).
    Simulating its compares (`tools/dol`) resolves 347 of the 352 table IDs (all but `DMTK`, `MGMA`, `PLAY`, `SEGE`,
    `NULL`) to a case that calls `operator new(size)` (0x8008440C) and then the type's constructor. For example, 0x801638A0
    builds `POOH` and calls it.
  - **confirmed** After construction the same function stores the screen at +0x4/+0x8, the position at +0xC (and copies at
    +0x18, +0x24), the params at +0x90, and looks up the type's `enemyparam.csv` stats by column name (`life`, `atcp`,
    `atcn`, `dstr`, `dasu`, `efsz`, `voic` as 4-char constants).
  - **confirmed** Actor objects start with a vtable pointer. Constructors call the base constructor 0x801F5AE0 (base vtable
    0x804A5770) and then store their own vtable; vtables are CodeWarrior-style (two zero words, then methods). Slot 1 is
    init, slot 6 draws (the base one is an empty stub). Live objects in a savestate are found by their vtable pointer.
  - **confirmed** The stage loader (0x802D8328) reads the 11-byte records and passes position = 8.0 × (x, y) + the room
    origin, z = 0, and screen = 0 for TV actors or 7 + sublayer for GBA areas (the savestate's room 1 GBA-area JIJI has
    screen 9). So an actor's anchor is exactly `actorPixel`.
  - Other IDs are compared inline elsewhere. 228 of the 285 used IDs appear as code immediates, but only 75 as strings.
  - The strings sit in small per-behavior lists in `.data`. For example, 0x80464204 lists 43 enemy IDs ending with `NULL`,
    next to `enemy_both2_sob.bin` / `enemy_gc_sob.bin` names, and 0x8046C100 holds `HNRYESRYNULL`.
  - Which sprite each type draws: see "Actor graphics" below.

## GX textures (**confirmed** by unit tests; checked visually on data.arc textures)
- BTI header (0x20 bytes, big-endian): format u8 @0, width u16 @2, height u16 @4, wrap S/T @6/7, palette format @9,
  palette count u16 @0xA, palette offset u32 @0xC, min/mag filter @0x14/0x15, mip count @0x18, data offset u32 @0x1C.
- All GX formats are decoded in `packages/formats/src/gx/bti.ts`. CMPR uses the GX 5/8–3/8 interpolation, as in Dolphin.

## Sprites (**confirmed** against Dolphin texture dumps)
- SOB (`data.arc/sob/*_sob.bin`): u16 LE frame count, (count+1) u16 LE offsets, then 6-byte OAM-style parts:
  `[s8 y][shape<<6][s8 x][size<<6 | vflip<<5 | hflip<<4][tile in page][palette<<4 | page]`. Shape/size give GBA
  OAM block dimensions. Parts are drawn last to first. `packages/formats/src/fsa/sprites.ts`.
- Sprite sheet: 16 pages × 256 parts (4bpp 8×8), 32 parts per row, assembled as
  `gb_ch_obj_base_sch` (0x7000) @0, `gb_ch_obj_tr_sch<N>` (0x1000, per-stage objects) @0x7000, `enemy_sch` @0x8000,
  `gals2_sch` @0x10000, `player_sch` @0x14000, `gals_sch` @0x18000. At runtime the GC uploads it as 256×256 C4
  textures (4 pages each); pages 0–3 and 8–11 match our assembly byte for byte (Dolphin texture dump, TLUT recovered).
- TV palettes: `scl/cu_cl_obj_base_scl.szs` ("cube"); GBA: `gb_cl_obj_base_scl`; Dark World: `ura_cl_obj_base_scl`.
  Player colors are palettes **12–15 = green, red, blue, purple**. SOB frames use palette 7 (confirmed) and 15
  (hypothesis) as player placeholders, replaced by 12 + player. (`player_scl.szs` isn't what the TV uses.)
- `player_sob.bin` has 981 frames: 0–7 walk right, 8–15 walk left, 16–23 walk down, 24–31 walk up (8 frames each), then
  32–59 sword swings, 67–142 charging, 143–166 spin attack, items, swimming, Epona… Classified in `docs/animations.md`.
  The sword is always palette 10. Frame timings live in the code.
- The TV Links look "HD" in Dolphin only because the 16×16 heads are magnified 2.14× with bilinear filtering.

## Actor graphics (`packages/formats/src/fsa/actorgraphics.ts`)
What each actor type draws on the TV right after it spawns. Derived from main.dol with our own tools (`tools/dol`: a
small PowerPC decoder, the spawn-switch simulation, per-type draw-call listing) plus the savestate RAM and Dolphin frame
dumps. FSALib's actor JSONs were used only as a local oracle, to find where a few looks live (the BLZ2/TRCH flame) and to
cross-check; no values are taken from them, and where FSALib disagrees with the code, the code wins (e.g. SLR1 kinds 1-3
draw `both2` 512, not `both` 155). Where the code leaves the resting pose open ("matched" below), we picked it by looking
at the frames of the block the code draws from; for ZASL, ZSLH and KEPO the pick agrees with the pose FSALib draws.
- **confirmed** Draw functions (called from the draw method, vtable slot 6, or its helpers):
  - 0x801F06F0 `(actor, sobName, frame, remap*, shadow, f1 = f2 = 1.0)` draws a frame of a named SOB list at the actor's
    position (+0xC). `sobName` is one of `enemy_both_sob.bin` ("both": drawn on TV and GBA), `enemy_both2_sob.bin`,
    `enemy_gc_sob.bin` (TV only), `player_sob.bin`. 0x801F02BC is a variant with the same first arguments.
  - 0x802F86CC `(renderer, &pos, sob, frame, params*)` draws a SOB resource looked up by name through the resource
    manager (`'SOB '` + file name); 0x803075AC `(…, screen, &pos, frame, …)` sends the GBA copy of a sprite to the GBAs.
  - **confirmed** (code, Dolphin) Afterimages: params +0x30 is an afterimage kind (−1 none). 0x802F86CC then calls
    0x802F6800, which stamps the sprite (position, frame, params) into one of 256 slots of 0x9C bytes at renderer
    +0x2398 when the stage's frame counter ([0x8053AAF8]+0x5C) and the SOB's address agree modulo the kind's period;
    0x802FEE68 draws the live stamps, the per-frame update decrements their life. Per kind, tables at 0x80471060 (color
    × RGBA), 0x804710A8 (+ RGBA), 0x804710F0 (life), 0x80471138 (end scale), 0x80471180 (period); a stamp's alpha and
    added alpha scale by life left / life, its size from 1 to the end scale. The boomerang (draw 0x80168E78) passes kind
    17: every 4 frames, life 20, × (255, 255, 255, 191) + (127, 127, 127, 0), scale 1: pale copies left behind (poking
    its `li r0, 17` at 0x80168F2C to −1 removes them in Dolphin). Drawn in `apps/battle/src/entities.ts` (`AFTERIMAGE`).
    The minor Shadow Links (ZSLH, ZSLJ: their draw 0x80220F54) pass kind 14: every 4 frames, life 20, × (0, 0, 0, 191)
    + 0, scale 1: black copies trailing their hops and jumps (Dolphin, Lake Hylia room 3; apps/game `enemies.ts`
    `minorShadowTrails`).
  - 0x804030C4 / 0x804032E8 / … draw BTI textures (`'TIMG'` resources, e.g. RCK3's `timg/yy_1_1_iwa1.bti`).
  - The frame argument is usually `field + constant`: the constant is the first frame of the type's block in the list and
    the field an animation step, a direction (× frames per direction) or a variant chosen in init. Direction order is
    0 right, 1 left, 2 down, 3 up everywhere we looked (PLAS's table, soldiers, octoroks, JIJI; the order of Link's walk
    blocks). Idle looks face down.
  - `remap*` points to a 16-byte palette table on the caller's stack, filled with 0..15 and then patched (e.g. SLR1 writes
    its kind's palette into entry 2, OKTA into entry 3). `ActorSpritePiece.palettes` holds the patched entries.
  - The next argument is -1 or a shadow spec, drawn by 0x801EF830 (**confirmed**, code; apps/battle `shadows.ts`):
    skipped for -1, on GBA screens, and where the base-layer type under the actor's (x, y) is 0x02, 0x03 or 0x0E (so
    no actor shadow on the Tower of Winds' floor); always on the ground at (x, y) whatever the actor's height, just
    under its sprite, alpha-blended with hard edges, opacity 223 (max(159, 223 − z/2) in the air; × the caller's alpha
    for bit 0x400). Spec & 0x3FF = 7: the actor's own frame scaled 0.9 × 0.5 at height −5 as a flat (40, 40, 40)
    silhouette (FGAL, HNRY, BBSL); anything else: `kage_sob.bin` frame n (7 frames, palette 4 = (41, 41, 41)): 0 a 12×6
    ellipse at x −6…+5, y +2…+7 (HBMB bombs, LSTI items, SLR1 kind 1–3 hidden by the body), 1 a 6×4 one (BEEE bees,
    HART hearts). No shadow: CRTL orbs, NIWA cuccos, GRAS bushes, TUBO pots, arrows, seeds, the boomerang. On shallow
    water (0x39) spec 0 at height 0 becomes a ripple (enemy_both2 399 + [0, 1, 2, 1][counter >> 2 & 3]).
  - **confirmed** (code) The Links' shadow (0x80264998, before the Link): his own current player_sob frame scaled 0.9 ×
    0.5 at height −5, flat (40, 40, 40), opacity min(his alpha, +0xCA1, 159) (max(79, 159 − z/2) in the air), at
    (x, y − 0.01) plus his draw offset, ignoring his height (held or thrown: y = +0x328, the ground under him). The
    renderer turns height −5 into a 192/197 scale and 5 px lower, so standing it peeks out just under and beside him
    (as in the Dolphin frames); it blinks and shrinks with his frame. `player_kage_sob.bin` isn't used on the TV.
  - **confirmed** (code) Anything drawn at height z ≠ 0 (default draw parameters) grows by 192 / (192 − min(z, 96))
    about its anchor: a carried load at z 18 × 1.10, a knocked-back Link at z 19.5 × 1.11.
- **confirmed** Anchor: the frame's origin is the actor position (stage loader above), verified on boss010 room 1: the four
  FGAL girls rendered with `tools/render` `ACTORS=1` fall on the girls of a Dolphin frame dump from the same savestate
  (frame 1) after the usual camera fit (scale 2.146, room origin (228.5, 32.4)), same spacing and overlap. The viewer's
  screenshot fits the same frame with a mean luma difference of 15.3 (the rest is the Links, HUD and cloud shadows). Some draw methods move the
  position around the call: RCK2 adds 8.0 to y. A scan of every mapped type's draw functions for that pattern found no other.
- Draw order: pieces sorted by their own anchor y (lower drawn over higher), which matches the girls' overlap in Dolphin and
  puts a rock drawn 8 px low over the Zol placed at the same spot (boss010 room 4).
- **refuted** (Dolphin RAM pokes) The ground overlay (`filterN.bti`) doesn't darken sprites; what darkens them is the
  cloud-shadow layer drawn over them (see TV rendering pipeline), which explains the better fit measured when the
  overlay was applied after the actors (girls' region 27.2 → 22.5).
- Types, with confidence (full notes and the checked main.dol values are in the module; the real-disc test checks every
  one of those values and that every piece in boss010/boss013/boss500 is a non-empty frame or a present texture):

  | Type | Look | Confidence and evidence |
  |---|---|---|
  | FGAL (4 girls) | both2 910 ×4, 16 px apart downward | confirmed: direction table 0x80474EE0 (913 up, 907 left, 904 right, 910 down) + walk table 0x80474ED0; the savestate has all four at 910 in that column, as Dolphin frame 1 shows. They then cycle through formations (ring, square…), so later frames differ |
  | JIJI (villagers) | variant = params byte 2 -> table 0x804753C0 (base frame, SOB) + the variant's animation set's down offset (table 0x80475498) | confirmed; RAM: the room-1 old man has variant 0, base 902, SOB both2, frame 902/903 |
  | RUPY (Force Gems) | table 0x80471948 by params & 0xFF: 0-7 both2, 8-11 gc | confirmed |
  | HNRY (hovering gem) | both2 table 0x804AB038 by params & 7, + its glint step (0 for 61 frames, then 1, 2, 3 two frames each); bobbing +0x2B8 over its height (8 or 24), shadow spec 7 (its own frame) | confirmed (draw 0x8031A270) |
  | SLR1 (soldier) | kind = params & 7: both 155 or both2 512 (kinds 1-3); palette 2 (and 8) <- table 0x8049FA40 | confirmed |
  | OKTA (Octorok) | gc 8 (kind 1: gc 1102), palette 3 <- 3/4/5 | confirmed (spawn direction is random; down shown). Animated (draw 0x8013FA08): gc 0 + 4 × direction + step, the step bit 2 of the walk count (+0x234) while walking, 2 + the spit pose while spitting; its rock `OKTM` gc 37 |
  | PLAS (player start) | player_sob 8 × direction, palettes 7/15 <- 12 + player | confirmed: direction table 0x8046C890 |
  | GOL2 (goal) | 4 × gc 603 laid out by params & 0x1F (float tables 0x8046EA10/0x8046EA70) | confirmed |
  | CNON 332, PUKU 323, FTGL 192, YNSW both 13, YAJI both 16 + params & 0xF, BLCK both 4 + size / 69 / 72 + color, ZORA gc 213, HBMB both2 232, BEEE both2 460, SNPC variants, RCK2 both2 43 (+8 y) | as listed | confirmed: the constants are the draw call's immediates |
  | ZASL gc 721, SLR4 gc 556, NIWA both2 687, CIRC gc 297 + color, KEY0 both2 45 + kind, LSTI both2 64 + item, ZSLH player_sob 16, ZSLJ 62 (palette 7 left as is = dark; both simulated in Lake Hylia, rooms 4 and 3, their +0x280 traced: 60 + facing standing (62 down: ZSLJ's frame through his hops and jumps), ZSLH's 305-307, 379, 380-386 the hammer: sim minorshadow.ts; their draw 0x80220F54 also passes shadow spec 7 and afterimage kind 14, below), RCK3 `yy_1_1_iwa1.bti` | base frame from code, resting pose or param field picked visually | matched |
  | BLZ2 (eternal flame) | TV: an effect; GBA: both2 265 + step (from BLZE, which BLZ2 spawns), drawn as a stand-in | matched |
  | KEPO gc 618, OBLF both 20 + shape ((p & 0xF) + ((p >> 16) & 0xF) × 16, init 0x8035151C; shape 20, room 6's raft, not drawn: below 14 the slabs), CRGN both2 144 ('?' crystal ball; the content is chosen at run time) | | guessed |
  | PLSW (pull handle), STBL (throne) | PLSW both2 327 + length class (0 under 1 px out, 1 under 3, 2 under 8, 4 out for good) at its home; STBL both2 449 at 2×, 16 px below its placement | confirmed (Hyrule Castle: below) |
  | FAZR, FZRA (escort Zoras), PSWB (four-Link handle) | both2 578 + animation frame; data.arc `timg/4hippari_switch_0-4.bti` | matched (below) |
  | KNBN, TKRA, SWTH, DOOR, TRCH, PNPC, RBPN, TFLR, TMI2, DOSN, SVGT | nothing: the look is in the tile layers | matched (no sprite/texture draw reachable) |
  | WARP, PONT, GENE, GEN3, SWEV, TINB, GFBS, FOCS, BFIN, LTEV, … (33 types) | nothing | matched (no draw reachable); BBSL only appears at time-out |

- Drawn as JPA particles, not sprites (see "JPA particles"): FLME, BLZ2 on the TV, FBMR's FBOB fireballs, PRTC, TRCH,
  BARI (Hyrule Castle's barrier, below), a whirlpool's WARP (style 0x0E: no draw of its own, its init makes 1363 and
  1262).
- **Hyrule Castle's simulated actors** (read 2026-10-11 with `tools/dol`; apps/game draws them from the sim's state:
  `enemies.ts` EnemyView, `view.ts` renderRocks and barriers):
  - **confirmed** `PLSW` (draw 0x8028A39C): enemy_both2 327 + +0x23C on the TV (0x802F86CC) and the GBA, at its home
    (+0x24), not its moving position; +0x23C is set at the end of its update from how far it's out (+0x244): under 1.0
    → 0, under 3.0 → 1, under 8.0 → 2, else 4 (frames 327, 328, 329, 331: the handle on a longer and longer stem).
  - **confirmed** `PSWB` (draw 0x80373434): no sprite, a TIMG texture from table 0x804AE560, `4hippari_switch_<k>.bti`
    (data.arc, 64 × 40: the wall mount, a stem, the red 64 px bar the four hold), k = +0x23C set at the end of its
    update (under 3, 8, 11, 14 px out → 0-3, else 4), at its position; TV only. Its grab box moves down with k by the
    floats at 0x80474F98 (0, 0, 5, 8, 11). **Assumed:** the texture centred on the position (0x802F745C's anchor not read).
  - **confirmed** `STBL` (class vtable 0x804AC2D8, shared by kinds (p >> 12) & 15; the throne's p 0x3000 is kind 3):
    init 0x8033E188 adds 16 to y (its live spot, (256, 80) for the placement (256, 64), as traced) and gives kinds 2, 3, 6
    a box -31..31 × -47..15; its draw 0x8033CD44 for kind 3 draws enemy_both2 449 through a 2× scale matrix (and on the
    GBA). Other kinds: 0 gc 1141 + a table, 1 both2 449, 2 a 2 × 2 grid of both2 948 + …, 4 `kazari_piramid.bti`, else
    both2 892/893 (not used in World 1's castle).
  - **confirmed** `BARI`: no draw method (vtable +0x20 is the base's no-op); init (0x8011FAF0) reads (p >> 4) & 15 as its
    orientation and (p >> 22) & 31 as a second switch, and 0x8011F314 makes five JPA emitters (createEffect, layer 0):
    effect 200 at (x, y − 16), (x, y), (x, y + 16) and 201 at (x ± 32, y) (orientation 0; orientation 1 lays the 200s
    side by side, turned π/2: not drawn). Its state 3 sets bit 0 of each emitter's +0xF4 (stops emitting: they play
    out), state 4 deletes it. Its box: ±40 × ±16 (the sim keeps ±32 × ±8, assumed before). Dolphin's frame from
    `w1-013-room57` shows the beams and blue orbs across the doorway, as apps/game now draws them.
  - **matched** `FZRA` (draw 0x80126F1C): enemy_both2 578 + its animation frame (+0x28C; the animation object at +0x27C
    over table 0x8049E400: 9 animations of (frame, ticks) pairs). Frames 578 + 1-3 face right, 4-6 left, 7-9 down,
    10-12 up; animations 0-3 walk right, left, down, up (2, 1, 3, 1 … for 10, 7, 10, 7 ticks), 6 stands facing down
    (frame 7). States 13 and 14 put its alpha (+0x254) into the draw's colour bytes (the fade before the fairy). Not
    seen at room 57's arrival points in Dolphin before a Zora is brought (`w1-013-room57`), so drawn once its switch
    (p >> 22) is on; **assumed** gone at once when the fairy's switch (p >> 27) comes.
  - **matched** `FAZR` (ctor 0x80121164 passes both2 / 578 to the base NPC init 0x801247C8: +0x384 the list, +0x338
    the base frame; draw 0x80123F9C: base + its animation frame +0x240). **Assumed:** its animations are FZRA's (its own
    table not read); apps/game walks it the way the sim moves it, standing facing the leader.
- `ActorSpritePiece.size` scales a piece about its anchor (STBL's 2×); `ActorBtiPiece.archive: "data"` takes the
  texture from data.arc's `timg/` (PSWB).
- Not mapped yet (markers in the viewer): BLDF (covers the Tower of Flames' one-tile holes with `black.bti` 16×16,
  fading while a Link stands inside), and every type outside boss010/boss500.
- Rendering: `packages/render/src/actorsprites.ts` `actorSpriteMeshes` batches pieces into one atlas (`SpriteAtlas`) and
  one mesh; the viewer draws them between the base and top layers (`#…&actors`, `&markers` for plain markers), and
  `tools/render/src/room.ts` with `ACTORS=1` draws them in software (`drawActorPieces`).

## Shared graphics (`data.arc`)
- `sch/` 58 files: 4bpp character (8×8 tile) pages, e.g. `bg_a_sch.szs` … per tileset, `player_sch`, `enemy_sch`.
- `scl/` 92 files: palettes (16 × 16 colors, RGB555), including `_gb_` (GBA-screen) and `_ura_` (Dark World) variants.
- `sob/` 10 files: sprite (OAM-style) layouts: `player_sob`, `enemy_*_sob`, `kage_sob` (shadows).
- `spl/` `bg_a_spl.szs`; `smp/` 30 × 512-byte files (object stamps: houses, trees, …); `enm/enemyparam.csv`.
- `particle.jpc` (JPA particles), `j3d/` (lava, magic circle, fog…), `timg/` (171 BTI enemy/object sprites).
