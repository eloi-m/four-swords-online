# FSA formats: J2D screens, screen animations, round screens, BMG messages

Part of the FSA file-format notes (index: [../formats.md](../formats.md)).

## 2D screens (J2D BLO2)
Parser `packages/formats/src/j2d/blo.ts`, fonts `j2d/bfn.ts`, three.js renderer `packages/render/src/screen.ts`, viewer
`apps/screens`. **confirmed** below means: parsed for all 82 screens with consistent cross-references (tests in
`j2d/j2d.realdisc.test.ts`) and, for the rendering rules, the adventure HUD reproduced over the Lake Hylia Dolphin frame
(same positions; interior colors within 1–3 %; mean abs difference 9/255 over all opaque HUD pixels).
- **confirmed** 82 `scrn/*.blo`, all `SCRNblo2`, in game2D, main2D, entry, gamemode, file, map1/2, result/1/2, title,
  logo, `staff/staff1-8` and 11 stage archives (boss021/051/100/200/201/202/204/205/990/991, ending: mini-game HUDs,
  prologue, ending map). Textures are BTIs in the same archive's `timg/`, looked up **case-insensitively**
  (collect.blo asks for `kk_advWoman_01.bti`, the file is `kk_advwoman_01.bti`). boss100's copy of the fishing HUD ships
  no textures. Fonts: FNT1 names `rock_24_20_4i_e.bfn` (msgus.arc `font/`; 3 screens say `rock_24_20_4i.bfn`, which the
  US disc lacks). The `.bck/.btk/.brk/.bpk` files next to some screens are their animations ("Screen animations" below).
- **confirmed** File: header `SCRNblo2`, u32 file size, u32 block count, `SVR1` + 12 × 0xFF. Blocks `[tag, u32 size]`;
  INF1/TEX1/FNT1/MAT1 are padded to 0x20 with the text "This is padding data to align", panes to 8. Padding inside
  pane records is filled with bytes of "RESERVED".
- **confirmed** INF1: u16 width 608, u16 height 448, RGBA background (80808000 in 76 screens, 00000000 in 6).
- **confirmed** TEX1/FNT1: u16 count, 0xFFFF, u32 offset (0x10, from the block) of a JUTResReference table: u16 count,
  u16 offsets (from the table), entries `u8 type, u8 length, name` (not terminated). Type is always 2 (by name in the
  owning archive).
- **confirmed** Tree: panes are `PAN2` (plain pane), `PIC2` (picture), `WIN2` (window), `TBX2` (text box); `BGN1` makes
  the last pane the parent of what follows, `END1` closes it, `EXT1` ends the file. The root is always PAN2 `ROOT`
  608×448. Children draw after their parent, in file order; a hidden pane hides its subtree.
- **confirmed** Pane header (PAN2 block, or a `pan2` sub-block at the start of PIC2/WIN2/TBX2), 0x48 bytes: tag, size,
  u16 0x40, u16 id (editor serial, unique per screen, not in tree order), u8 visible, u8 anchor, 2 pad, u64 tag (ASCII
  right-aligned: `\0\0\0\0ROOT`), u64 user tag (always 0), f32 width, height, scale x, y, rotate x, y, z (degrees; only
  z is used), translate x, y, u32 0.
- **confirmed** Placement: `anchor` (J2DBasePosition, 0 top-left … 4 center … 8 bottom-right, row-major 3×3) is the point
  of the box that sits at (x, y); (x, y) is relative to the parent's anchor point, not its corner (the root's anchor is
  0, so top-level panes use screen pixels). Scale and rotation apply about the anchor. *hypothesis* A positive rotate z
  turns counterclockwise on screen (entry/rule.blo's two selector arrows, rotated 270, then point outwards).
- **confirmed** PIC2 (0x80): pane header, then u16 0x30, u16 material id (serial over pictures, windows and text boxes),
  u16 material index, 2 pad, u16 × 4 vertex indices (4 per picture/window, running; *hypothesis*: targets of vertex
  color animations), s16 × 2 × 4 texture coordinates (8.8 fixed point; TL, TR, BL, BR, often flipped or > 1 for tiling),
  RGBA × 4 corner colors (TL, TR, BL, BR).
- **confirmed** WIN2 (0x90): pane header, then u16 0x40, 6 pad, RGBA × 2 (always white, unknown use), u16 × 4 frame
  materials (TL, TR, BL, BR; FSA always uses one material 4 times), u8 mirror (0x27 in all 19 windows: 2 bits per corner
  from TL in the top bits, high bit = mirror horizontally, low bit = vertically, so one top-left corner texture draws all
  four), pad, s16 content x, y, width, height (inside the pane box), u16 material id, u16 content material, 2 pad,
  u16 × 4 vertex indices, RGBA × 4 content colors. Each window adds a content material and a frame material.
  *hypothesis* Edges stretch the innermost texel row/column of the corner texture (renders look right).
- **confirmed** TBX2 (variable size): pane header, then u16 size, u16 material id, u16 material, s16 char space,
  s16 line space, u16 font width, u16 font height, u8 h binding (0 center, 1 right, 2 left), u8 v binding (0 center,
  1 bottom, 2 top), RGBA top color, RGBA bottom color (vertical gradient), 4 pad, u16 max length, u16 length, text.
  The font comes from the material. Text is ASCII in 208 boxes and Shift-JIS placeholders (あああ…, katakana names) in 90;
  no control codes; the game replaces texts at runtime (messages: "Messages (BMG)" below). *hypothesis* Layout as
  J2DPrint (`packages/render/src/screentext.ts`): glyph cells scaled to font width × height (x by the GLY1 cell width
  24, y by ascent + descent 24), advance × that scale + char space, lines `lineSpace` apart, the block placed by the
  bindings (centered: (box height − (font height + line space × (lines − 1))) / 2); vertex colors top → bottom color.
  Glyph colors then go through the material's TEV (2 stages: `lerp(C0, C1, glyph)` × vertex color), so a box's C0/C1
  are its black/white colors: white text in the balloons, black for their shadow copies.
- **confirmed** MAT1: u16 count, 0xFFFF, then 23 u32 offsets (from the block; 0 = absent) of: init data (0xE8 per
  material), u16 index remap (identity in FSA), name table (JUTNameTab: u16 count, pad, (u16 hash, u16 offset) pairs,
  names like `mat_Pp1lf01_v`), indirect data (0x128 per material, below; in 6 screens, enabled on 25 materials), cull modes
  (u32), material colors (RGBA), color channel counts (u8), color channel infos (4 bytes: pad, material source, pad),
  tex gen counts (u8),
  tex gens (type, source, matrix, pad), texture matrices (0x24: u8 type, info, pad, f32 center[3], scale x, y, rotation,
  translate x, y), texture indices (u16 → TEX1), font indices (u16 → FNT1), TEV orders (tex coord, tex map, channel, pad),
  TEV colors (s16 RGBA), konst colors (RGBA), TEV stage counts (u8), TEV stages (0x14, J3D layout: pad, color a/b/c/d,
  op, bias, scale, clamp, reg, alpha a/b/c/d, op, bias, scale, clamp, reg, pad), swap modes, swap tables, alpha
  compares (8), blends (type, src, dst, logic op), dither (u8).
- **confirmed** Init data (0xE8): u8 flag, cull, channel count, tex gen count, TEV stage count, dither, 2 bytes; then
  u16 indices: mat colors[2] @0x08, color channels[4] @0x0C, tex gens[8] @0x14, tex matrices[10] @0x24, textures[8]
  @0x38, font @0x48, konst colors[4] @0x4A; u8 konst color sels[16] @0x52, konst alpha sels[16] @0x62; u16 TEV orders[16]
  @0x72, TEV colors[4] @0x92 (C0, C1, C2, PREV), TEV stages[16] @0x9A, swap modes[16] @0xBA, swap tables[4] @0xDA,
  alpha compare @0xE2, blend @0xE4. 0xFFFF = unused.
- **confirmed** Observed values: flag 1, cull none, both channels take the vertex (corner) colors, alpha compare always
  passes, blend src-alpha/inv-src-alpha (one additive: src-alpha/one), identity swaps. TEV setups: 2 stages
  `lerp(C0, C1, tex)` then × vertex color (3385 materials; C0/C1 are the J2DPicture black/white colors, e.g. PRESS START
  = white→red with a black shadow), 1 stage tex × vertex (744) or vertex color only (19 window contents), 3 stages with
  a mask texture (20). The 25 indirect materials (collect, title logo, result_2p-4p, main_gba_window_s) use 2–4 textures
  with their own texture matrices (animated by the `.btk` files). Only those materials (and `result_1p_anim`'s) have
  texture matrices other than the identity.
- **confirmed** (all 25 materials; the title logo's look checked in Dolphin, docs/measurements/screens.md "J2D screens in
  Dolphin") Indirect data (0x128 bytes, in remapped material order): u8 enabled, u8 indirect stage count, 2 pad;
  4 × (u8 tex coord, u8 tex map) orders; 3 × 0x1C matrices (f32 2×3 row-major, s8 scale exponent, 3 pad); 4 × (u8
  scale s, u8 scale t); 16 × 0x0C TEV stages (u8 indirect stage, format, bias, matrix, wrap s, wrap t, add prev, utc lod,
  alpha sel, 3 pad). J3D's MAT3 has the same blocks with the orders and scales padded to 4 bytes (0x138). All 25 use
  one indirect stage (scale 1:1) read through matrix 0 = ½·I·2^e (e = 0 title and jewels, −1 results and the sword glow,
  −2 GBA window), 8-bit format, bias −128 on S, T, U, no wrap, on exactly one TEV stage. GX semantics (as Dolphin and
  noclip emulate them): the map's (A, B, G) are (S, T, U); the TEV stage adds matrix × (STU − 128) **texels** of its own
  texture to its coordinate. The title logo: `kk_test_01` (a 32×8 white bar, black end columns) through texture matrix 1
  (scale 4.6 × 1, 338°, swept by `title.btk`), shifted by the logo's height map `kk_titleLogoInd_01` (I8), × C2
  (40, 40, 80) and added over the logo: a bluish glint that runs across the letters' bevels.
- **confirmed** (Dolphin, the title shine) Texture matrices (J2DTexMtx) use J3D's "basic" SRT about the center, scale
  after rotation: s' = sx·(cos·(s − cx) − sin·(t − cy)) + cx + tx, t' = sy·(sin·(s − cx) + cos·(t − cy)) + cy + ty
  (rotation in degrees; `info` 0 = not Maya). Rotate-then-scale fits the Dolphin frames worse.
- **confirmed** Pane alpha = material color 0 alpha (heart shadows 100, digit shadows 200, bars 80–175) and is **not
  inherited**: opaque digits drawn as children of their 200-alpha shadows show no background in Dolphin.
- Runtime behaviour seen in Dolphin: the game hides the alternative panes (every pane of main_bat/main_adv is visible in
  the file, so they overlap), swaps textures (counter digits come from main2D.arc `timg/kk_rupynum_00-09.bti`) and moves
  whole groups (the adventure HUD's `Ph*` group sits 307 px lower in the Lake Hylia frame than in the file).
- **confirmed** Fonts (`FONTbfn1`, JUTResFont): 0x20 header, blocks INF1 (u16 encoding 0 = 1 byte / 2 = Shift-JIS,
  ascent 18, descent 6, width, leading 24, default glyph), WID1 (first/last glyph, then u8 left bearing + u8 advance
  per glyph), MAP1 (u16 mapping 0 linear / 2 table / 3 sorted code→glyph pairs / 1 kanji, first/last code, count,
  entries), GLY1 (first/last glyph, cell 24×24, sheet size, GX format (I4), cells per row, rows, sheet 128×128, sheets).
  US font: 225 glyphs for codes 0x20–0xFF on 9 sheets; Japanese (msgjp.arc `rock_24_20_4i_j.bfn`): 1052 glyphs, 10 maps.

### Notable screens (pane tags; n = player 1–4)
- game2D `main_bat.blo`, the **Shadow Battle HUD** (380 pictures, one corner per player: 1 top-left, 2 top-right,
  3 bottom-left, 4 bottom-right; `Ndata*` panes group them): hearts `Pp{n}lf01-08` (heart.bti) and a second layer
  `Pp{n}lf09-16` (heart_04_2.bti) on the same 8 slots, each with a shadow `Pp{n}lfk*`; portrait `Pp{n}ib01-04` (disc
  tinted with the player color by C1) + `Pp{n}i01` (`kk_link{G,R,B,P}_01` face) and shadow `Pp{n}i02`; item box
  `Pp{n}iib01-03` with 12 items `Pp{n}ii01-24` (icon + shadow: shield, slingshot, boomerang, bow, feather, boots,
  hammer, fire rod, bomb, mirror, shovel, lantern), level badge `P{n}le201-203` (L2), "no item" cross `Pp{n}noi*`;
  force gem counter: icon `P{n}r01` (+ shadow `P{n}rk01`) and 5 digits `P{n}s01-05` (player 4: `P4r02-06`) with
  shadows `P{n}sk*`; bars `Pp{n}mb01-03` with 4 green segments `Pp{n}m01-04` and an alternative red bar `Pp{n}nm01-04`;
  a black disc `Pp{n}ra01` with a `link_dot_test_02` sprite `Pp{n}li01`. No timer pane. The top-level panes of a
  corner are recognized by position, not tag: P2's "no item" cross is tagged `Pp1noi03`/`Pp1noi04`.
- **How the game drives main_bat** (main.dol battle HUD code 0x80421438–0x80427B08: init 0x80426DEC, round reset
  0x804263A8, per-frame update 0x804257E4, hearts 0x80423804, items 0x80423DF0/0x80423FA4, digits 0x80423248,
  alpha/slide 0x80424148; panes found through a u64 tag table at 0x8048E1B8; pane visible byte +0xB0, alpha +0xB2;
  `J2DPictureEx::changeTexture` = vtable +0x110, `setBlendRatio` +0x104). Reproduced by `apps/battle/src/hud.ts`:
  - **confirmed** (code; the look checked in Dolphin on the adventure HUD, whose heart code is the same, with an
    Action Replay code pinning Link's HP: 7, 10 and 1 quarters) Hearts: HP in quarters (the HUD copies the u32 at
    0x80529EC4 + 4p from the Link actor's current HP at +0xBFC; max HP at +0xBF8, clamped to 32 = 8 hearts). At init
    main2D's `kk_heart_01/02/03` are appended to every `lf01-08` and `lfk01-08` as extra textures; per slot i (0-based,
    `lf01-04` top row, `lf05-08` bottom row, left to right, every player):

    | Quarters left in slot i | `lf(i+1)` + shadow `lfk(i+1)` | second layer `lf(i+9)` + `lfk(i+9)` |
    |---|---|---|
    | 4 or more | `heart.bti` (= `kk_heart_00`, full) | hidden |
    | 3 / 2 / 1 | `kk_heart_01` (3/4: top-right quarter an empty outline) / `kk_heart_02` (left half) / `kk_heart_03` (top-left quarter) | hidden |
    | 0, slot within the maximum | not drawn | shown: `heart_04_2.bti`, a small white dot, and its shadow |
    | beyond the maximum | not drawn | hidden |

    The shadow always uses its heart's texture. main2D's `heart.bti`, `heart_01-03.bti` are byte copies of
    `kk_heart_00-03.bti` (and game2D's `heart_04_2` of `kk_heart_04_2`). The battle HUD blanks a filled/empty slot by blend ratios (0 → alpha 0)
    where the adventure HUD hides the pane; same look. `kk_heart_05` (an empty outline) and the table
    `kk_heart_05, 03, 02, 01, 00` at 0x8048F680 belong to another screen.
  - *likely* (code; not seen in a battle capture) Shadow Battle puts every player in the HUD's "GBA" mode (per-player
    2-bit field at [r13 − 0x70C8] + 0x83, set to 1 by the multiplayer setup 0x803E3468). In that mode the Force Gem
    counter (`Ndata20-23`), the green bars (`Ndata02/05/08/11`) and the red bar (`Pp{n}nm04`) are hidden; the portrait
    group keeps the file's faces (P1 `kk_linkG`, P2 R, P3 B, P4 P; `i02` is a black shadow); `li01` is always hidden
    and `ra01` replaces the portrait only while the Link is inside a GBA-screen area (screen index ≥ 8).
    **confirmed** (code 0x804257E4; Dolphin frames of the castle's dark side) Then the ranking screen's ring `ra02`
    shows round it and the portrait group (`Ndata01`/`04`/`07`/`10`) hides; the HUD writes the disc's place and size
    into the stage (+0x1D0…, per player), which draws the Link's sprite in it: his TV player_sob frame (63 standing)
    at 1.5× (27 × 34.5 px over its 18 × 23), his feet at `ra01`'s anchor + (0, 11) (P1: (67, 86); measured to the
    pixel), animated as he moves (`apps/battle/src/hud.ts` `DISC_SPRITE`).
  - Unused players' corners are hidden whole at the round reset.
  - Items: the box `iib01-03` is shown with exactly one icon pair `ii(2k+1)` + shadow `ii(2k+2)` (none for item 0, the
    start of a round). k: 0 shield, 1 slingshot, 2 boomerang, 3 bow, 4 feather, 5 boots, 6 hammer, 7 fire rod, 8 bomb,
    9 mirror, 10 shovel, 11 lantern; game item id → k (jump table 0x804B1478): 1→5, 2→11, 3→2, 4→3, 5→6, 6→7, 7→4, 8→8,
    9→10, 10→1, 11-13→0 (the mirror is never picked). The L2 badge `le201-203` shows at item level 2; the "no item"
    cross when the item can't be used (condition not decoded). `hud.ts` shows the held battle item's pair (`ITEM_ICONS`:
    slingshot 1, boomerang 2, bow 3, bomb 8). The cucco, Epona's carrot and the Four Sword have no icon in that list;
    *guess* (not checked in a battle capture): `hud-icons.ts` shows other art of the game in the shield's pair (unused
    in battle) instead: `Boss/boss201.arc` `kk_kokko_01` (the cucco minigame's HUD icon), game2D `kk_swordred_01`
    turned 45° into a square, and `enemy_both2_sob` frame 152's carrot without its ball (every orb frame 144–154 is
    tiles 329 + 357–358, the ball and its shine, around its content). A timed item's icon (the Four Sword, Epona's
    ride) blinks for its last 2 s. No L2 badge or cross (no item levels in the sim).
  - Force Gem counter (controller mode only): value at 0x80529ED4 + 4p clamped to −5000…9999, four digits with leading
    zeros in `s01-04` (`kk_rupyNum_00-09` on digit and shadow), `s05` hidden (as "0004" in the Lake Hylia frame);
    negative values put `kk_rupyNumMinus` in `s01`, the digits in `s02-05`, drawn red (255,85,65). The code's P4 tags
    are `P4r01-05` while the file's digits are `P4r02-06` (a bug that battle never shows).
  - Fade: a per-player factor (+0x108) steps by 0.1 per frame toward 1.0, 0.6 while the player has no hearts, or 0
    when the player is out (flag +0x25D, *hypothesis*), and multiplies the file alpha of every group but `ra01/02`.
  - **confirmed** (code 0x80425DA0, 0x80424148; Dolphin: the hearts 15 px in) Slides: while a per-player flag
    ([r13 − 0x70B0] + 0x20 + 0x148 + p: the Link in a GBA area) is set, the HUD's +0xF8 + 4p steps 3 px a frame to
    15 (left corners) or −15 (right), and back to 0 the same way; it moves the corner's six groups but the portrait
    and the disc (the gem counter `Ndata20`-`23`, the "no item" cross `noi02`, the item box `iib03`, the hearts
    `Ndata03`/`06`/`09`/`12`, the bars `Ndata02`/`05`/`08`/`11`, the red bar `nm04`; init 0x80426DEC, +0x90…+0xE0);
    top and bottom corners get a y offset from 0x8043D514 / 0x8043D57C (0 unless a banner or letterbox is up). No
    heart blinking.
  - **confirmed** (code; Dolphin: the castle's top corners at a 4-player start) A corner hides behind a Link: every
    frame the message manager clears its +0xDC bits, then for each Link on the TV (0x8043D8B4 → 0x804408F0 →
    0x8043DF8C) projects his place (his feet) and sets bit k when it lies in corner k's box, 188×123 px at the screen's
    corners (x −1…187 or 420…608, y 0…123 or 346…469, the y moved by the HUD's slide) grown by what 16 room px make on
    the screen; a set bit fades that corner out 0.1 a frame (0x80424148: also while the message manager shows a
    message, all four, and the bottom two while 0x8037E4BC holds). The Links lying knocked out count. `hud.ts`
    `CORNER_BOXES`.
  - *code, not used* 0x8042165C keeps 10 places for something per player (the four corners, the top and bottom
    middles, the sides' upper and lower halves; preference lists per player at 0x8048F1D8) moved away from the Links
    after 60 frames: nothing in the battle HUD reads the places it picks.
- game2D `main_bat_ranking.blo`, the HUD's second screen ([HUD + 0x18]): per player a ring `Pp{n}ra02` (player color;
  shown while the Link is in a GBA-screen area, 0x804257E4) and rank labels `P{n}1st01` over the shadow `P{n}1st02`.
  **confirmed** (code 0x80422824, Dolphin frames): the labels show with the rules' Status Display on (the default), the
  ranking by life (0x80237774) with ties sharing the better rank (1st, 1st, 3rd); main2D's `kk_mainRank_01-04` (IA4,
  "1st"…"4th") with per-rank colors: corner colors (TL, TR, BL, BR) 1st (255,157,16), (185,84,18), (216,58,22),
  (185,18,18); 2nd (252,255,33), (242,171,36), (242,72,9), (242,72,9); 3rd and 4th white, their C1 (255,255,119) and
  (216,255,161). *frame dumps*: by the portraits while the lives differ; over the Links' heads (16 room px tall, their
  middle 27 px over his feet) for 180 frames from the round's first frame of play and after each change (the timer's
  field not found). `apps/battle/src/ranks.ts`.
- game2D `main_adv.blo`: the same four corners without hearts, plus bracelets `P{n}bra*`, and the single-player group
  `Ph*`/`Php1*` (8 hearts `Php1lf01-08` + second layer `lf09-16`, shadows `Php1lk*`, under `Ndata16`; item box
  `Ph1piib1-3` with icons `Php1ii01-24`; bracelets `Ndata02`; gem counter `Ph1ps01-05` + shadows `Ph1psk*` and icon
  `Ph1pr01/02` under `Ndata13`). Playing alone with a controller the game shows just that group at the file's positions
  (Dolphin, Lake Hylia: the empty item box, 4 hearts, "0004"); `apps/game/src/hud.ts` drives it, the item box's icon
  pair `Php1ii(2k+1)`/`(2k+2)` in main_bat's order (the Cave's room 8 in Dolphin: k 11 the lantern, 3 the bow).
- main2D `main_gba_window.blo`: the Game Boy Advance SP frame (rainbow edge, "GAME BOY ADVANCE SP", "Z Close" in
  `Ndata02`) the game shows a GBA-screen area in when playing alone with a controller; the picture goes in `Psp01`
  (`kk_black`). `apps/game/src/gbawindow.ts`.
- game2D `pause.blo`, **Shadow Battle's pause** (START on a GBA; `apps/battle/src/pause.ts`, timeline `pause-state.ts`):
  `Pblack` (`kk_black` over the screen at alpha 80: the game makes it black, the file's TEV would leave it clear), the
  plate `Ndata01` at (305, 215) (note borders, `Ppau01` PAUSE, `Pcntn01` Continue, `Psc01` Choose an Area, `Psg01`
  Choose a Game: textures, not text), the cursor `Pkenc01/02` (`ken_4`, four swords each side; clear in the file, the
  texture's own colors in the game) beside the lit item at ±(its half width + 35), 1 px below its middle. Lit: the file's
  Continue colors C0 (39,16,0) C1 (255,237,160); the others C0 0, C1 (167,76,42). Measured in Dolphin
  (docs/measurements/screens.md "The pause screen in Dolphin"): the dim and the plate's drops, falls and bounces, the cursor's
  bounce. A choice asks in main2D's `warning_window.blo` resized to a 308×196 box round (305, 225) (outer frame
  `Pwbb05`, parchment `Pwb05`, text `Twt01` centered, the answer cursor `Pwcur01/02` unturned over the word): BMG
  0x10B "Leave this area?" / 0x10C "Quit Shadow Battle?" with Yes / No (the option tags printing no spaces), No first.
- game2D `gameover.blo`, `collect.blo` (collection screen, indirect/animated materials).
- main2D: `main_message_window.blo` (a small message box: frame `Pmmw01-09`, black text plate `Pmmtp`, text `Tmmt01`
  and its shadow `Tmmt02` 2 px down-right, 468×40, 2 lines of 22×22 text 19 px apart, left-aligned and vertically
  centered; the file's colors give dark brown (63,12,0) text on the black plate; **confirmed** (Dolphin, Shadow
  Battle's "P2 down!") the game shows it with the plate's alpha at 0 (its children keep theirs: the parchment shows
  through) and the line centered, 4 px left of and 1 px above our centering),
  `bat_stage_select_window.blo`, `pressstart.blo`, `hukidashi.blo` / `_wood` / `_stone` (the speech balloon and the
  wooden and stone signs: `Tm01` + shadow `Tm02`, 416×90, 29×29 text 30 px apart, top-left: **the 3-line box most
  messages are written for**, white text and black shadow in the balloon), `op_zelda.blo` (Zelda's voice, 3 lines of
  30×30), `warning_window`, `gba_connect_error_window`, `main_gba_window*`.
- map2 `bat_stage_select.blo` (Shadow Battle area select: 5 arenas + 5 locked slots), entry `bat_entry*`/`rule_bat`/
  `handicap` (battle setup), result2 `result_*p`/`result_score_*p`/`result_title` (loaded with `result.arc` and
  `result1.arc` by 0x803FFAA8, the result screens by 0x803B6FD8; not seen in a Shadow Battle: *likely* the adventure's
  stage results, Force Gem pillars and the hero ranking).
- result `total.blo` + `total_star.blo`, **Shadow Battle's end of match** (seen in Dolphin: a 2-player knockout went
  "P2 down!" → "P1 WIN!" + PRESS START → A → this "Total" screen → Continue → Select Area; both loaded by 0x803D901C):
  the castle wall, the "Total" scroll, per player a portrait cell (`Pp{n}i*`, `Pp{n}ib*`, `P{n}P01/02`) and 16 star
  slots (`P{n}kak01-16` shadows holding `P{n}ka01-16`, rows of four in blue, purple, pink and green by their C0),
  tinted columns `Pbcur01-04`, black overlays `Pblk01-03` on columns 2-4, Continue / Quit buttons (Japanese text in the
  file); the panel slides up from below as the screen opens (code: main.dol names no animation for total.blo).
  `total_star.blo` is the star just won: the game moves it onto its slot (P1's first: 2, −21 px from the file) and plays
  `total_star.bck` + `.brk` (below). What the game changes at runtime, **confirmed** by our render matching Dolphin's
  frames (docs/measurements/screens.md "Shadow Battle's round screens in Dolphin"): only the won stars' slots show; an absent
  player's column keeps its `Pblk` overlay and loses its portrait (`Ndata00n`) and label (`PnP02`), a present one loses
  the overlay; one column is lit (`Pbcur0n`, its alpha pulsing 18-89 over 120 frames: P1's, the player at the
  controls, also after a draw); the winner's portrait smiles (`Ppni03`, `kk_link?_02`, shown only for him); `Pstarli`
  is hidden; the buttons read "Continue" / "Quit" (BMG 0x10D / 0x10E) and the cursor's highlight `Paccur02` (+01)
  pulses (alpha 200·(t/30)² up, 200·(1−(t/30)²) down, 60 frames) over the chosen one; the flying star takes its slot
  row's C0. The "A Confirm" prompt top right is main2D `button.blo`'s `Pba*` group.

### Screen animations (`packages/formats/src/j2d/anim.ts`, player `packages/render/src/screenanim.ts`)
The `.bck/.btk/.brk/.bpk` files in `scrn/` are J3D animation files (`J3D1bck1` ANK1, `btk1` TTK1, `brk1` TRK1, `bpk1`
PAK1, the keyed variants, read by `j3d/anim.ts`) that J2D applies to a screen. **confirmed**: 22 files, all parse;
20 bind every track to their screen (`anim.realdisc.test.ts`). A screen's own files are `<screen>.<ext>` and
`<screen>_NN.<ext>` (`screenAnimationNames`).
- **confirmed** `.bck` → panes: joint *n* drives the pane whose id (pane header +0x0A, the editor serial) is *n*; the
  joint count is the screen's pane count, root included. The panes were laid out in a 3D tool's XZ plane: **x = T.x,
  y = T.z, scale = (S.x, S.z), rotate z = R.y** (degrees); T.y holds editor depths (2, 4, 6…, ignored), R.x and R.z
  are 0 everywhere. Evidence: each screen file is a snapshot of its animation, matched to 0.02 px with our Hermite
  sampling: `gameover.blo` = frame 103 of `gameover.bck` (rotations equal mod 360), `entry_arrow_anim.blo` frame 4,
  `entry_connect_anim.blo` frames 17/21, `total_star.blo` 19/109, `result_1p_anim.blo` 9, `map.blo` 0; rendered, the
  frame and the file differ in ≤ 2 pixels (`tools/e2e/src/screens.ts`). The GAME OVER letters roll right while R.y goes
  0 → −360: a positive angle turns counterclockwise, as the rotate-z hypothesis above says.
- **confirmed** `.btk` → texture matrices: entry → the material of that name (MAT1's name table), its byte = the
  material's texture matrix slot *n* (texgens with matrix 0x1E + 3*n*); rotation in half-turns (× 180 = the BLO's
  degrees: `title.btk`'s 1.878 = `title.blo`'s 338°), center from the `.btk` (always (0.5, 0.5), as the files), never
  Maya (+0x5C = 0). The matrix math is J2DTexMtx's (above).
- **confirmed** `.brk` → TEV registers by material name: "tev" register *n* = C*n* (`collect.brk` drives C0–C2 of
  `mat_Ppo01_v`; `total_star.brk` C1's alpha, the glint, checked in Dolphin); no konst entries in FSA.
- *likely* `.bpk` → material color 0 by name. Every FSA material takes its rasterized color from the vertices, so only
  the alpha shows, as the pane alpha: `map.bpk` fades the map's route dots `P21`–`P73` 1 → 0 over 180 frames, one
  group every 200 frames.
- Leftovers that fit no shipped screen: `adv_entry.bck` (132 joints, `adv_entry.blo` has 102 panes) and `total.bck`
  (228 joints, `total.blo` 232; joint 1 at (561, 50) where `Ndata03` is at (305, 225)). main.dol names neither, nor
  `total.brk` or result1.arc's files.

| Archive | Animation (duration, file loop) | Drives |
|---|---|---|
| title | `title.btk` (60, repeat) | the logo's glint: `mat_Ptlogo01_v` texture matrix 1 (indirect, above) |
| result | `total_star.bck` (199, once), `total_star.brk` (110, repeat) | the won star flies in spinning (frames 0–19), pulses × 1.5 with a glint (79–109) |
| result | `total.brk` (120, repeat) | `total.blo`'s `mat_Pstarli_v` C1 alpha (not named by main.dol) |
| result2 | `result_2p/3p/4p.btk` (160, repeat) | the Force Gem pillars' flash stripes `mat_Prpst{n}1/2_v_x` (indirect) |
| result1 | `result_1p_anim.bck` (59, once), `.btk` (240, repeat) | the "new record" badge (`kk_newRecord_01`) popping, its ring turning |
| game2D | `gameover.bck` (119, once) | GAME OVER: the letters fall in (frames 0–32), then roll off to the right (79–115) |
| game2D | `collect.btk` (60, repeat), `collect_02.btk` (1800, repeat), `collect_03.btk` (99, once), `collect.brk` (1, repeat) | the jewels' glints (indirect), the Four Sword's glow layers (indirect), a stripe; two color sets at frames 0/1 |
| main2D | `main_gba_window.btk`, `main_gba_window_s.btk` (1200, repeat) | a rainbow scrolling round the GBA frame (`_s`: indirect) |
| map1 | `map.bck` (1599, once), `map.bpk` (1200, repeat) | the map's pieces flying off, their dots fading |
| entry | `entry_arrow_anim.bck`, `entry_connect_anim.bck` (59, once) | the entry screens' arrow (`kk_arrow_02`) squashing and the `connect_01` icon bobbing on its cable |

- **When the game plays them** (J2D has no frame controller: the screen code sets each frame; observed in Dolphin,
  docs/measurements/screens.md "J2D screens in Dolphin"): `title.btk` once (60 frames, rate 1) every 540–552 frames (frames 128,
  680, 1218 after `ref/battle/title.sav`), 38 frames after a sparkle on the sword (another effect); `total_star.bck`
  from the star's arrival (its frame 0, the star at scale 0, lands on frame 19), then its frames 79–109 again every 120
  frames with `total_star.brk` at the **same** frame (the glint peaks with the pulse, not on its own 110-frame loop);
  the flying star fades in by code (pane alpha; the files leave it opaque). Loaders in main.dol: title 0x803A59E0,
  total/total_star 0x803D901C, result_*P (+ result_title) 0x803B6FD8, gameover 0x80439C78, map 0x804122F4, collect
  0x80452A80, main_gba_window_s 0x8043395C, entry arrows 0x803EE254 (adventure) and 0x803FCBC4 (battle). The others
  aren't checked in Dolphin.

### Shadow Battle's round screens (apps/battle `banners.ts`, `total.ts`; timings in `timeline.ts`)
What a battle shows from the arena appearing to the Total screen, read in main.dol and traced or dumped in Dolphin
(docs/measurements/screens.md "Shadow Battle's round screens in Dolphin"; frames counted as there). Most of it is J2DPicture /
J2DTextBox objects the code builds from single textures, not screen files:
- **confirmed** (code + RAM trace) The game object ([0x8053AAF8], built by 0x80139300) holds two pictures: +0xB8
  main2D `kk_rival_01` "Be the last one standing!" (black (0,0,0,0), white (255,210,0,255): gold) and +0xBC data.arc
  `go.bti` "Go!" (black (80,40,40,0), white (255,80,80,255), set at each draw); +0xC0/+0xC4 are text boxes in
  `rock_24_20_4i_e.bfn` for one-player modes. Its draw (0x80136934, when +0x58 = 0 and +0x7E ≠ 0) puts the first at
  413×38 × scale +0x8C about (304, 225), alpha +0x68, and Go! (state +0x60 ≥ 2) at 256×128 × scale +0x90 about
  (328, 164), alpha +0x6C. The intro's state machine, frames from the arena showing: +0x58 = 4 (the screen fading in
  from black) to 26; state 1 with a 300-frame timer; the text drawn from 27 at scale 15, shrinking 5/3 a frame to 1
  (frame 36); state 2 at 327 (timer 40): Go! at scale 30, 20, 10, then 1, the text losing 10 alpha a frame (0 at 353);
  state 3 at 367: Go! losing 6 alpha a frame; states 4, 5 at 410, 411, the Links in control from 409 (measured
  before: the generators' first count). The sim's `COUNTDOWN_TICKS` is 409.
- **confirmed** (code 0x80253E6C, RAM, frame dumps) The Links' own intro: each Link counts +0xD38 from the end of
  the fade-in (frame 26; the camera doesn't move, the Links stand in state 0). At 16 (frame 42) the dark portal at his
  feet: JPA 1048, 1049, 1050 (layer 0, sublayer 1) and the sound 0x4004E (`JA_SE_CHR_SLINK_APP_EFF_S`); he isn't
  drawn until +0xC80 = 1 at 131 (frame 157, the portal bursting; sound 0x20043 `JA_SE_LK_SLINK_APPEAR`). Then per
  player p (by index, whatever the count), at 192, 224, 248, 264 (frames 218, 250, 274, 290) the stage manager's
  [+0x30] object (0x8015F8FC, kind 1: 30 frames) plays his "zoom" with the sound 0x25 (`JA_SE_START_ZOOM`, through
  [0x8053AF80]), and 32 frames later (250, 282, 306, 322: the dumps agree) 0x8043A170 sets his bit of the message
  manager's +0xDD, from which his HUD corner fades in 0.1 a frame. The zoom (draw 0x8015F9C0): a copy of the frame drawn
  over the whole screen, showing the part (u²·(x − 20), u²·(y − 15)) – (u²·(x + 20) + (1 − u²)·608, u²·(y + 15) +
  (1 − u²)·448) of it round the Link's place (x, y) on the screen, u = 1 − T/30 for the slot's T (30 down to 1: a
  magnification from 1× to 15×), alpha 159·2u² (159·(2 − 2u²) past u² = ½); kind 0 runs it backwards, kind 4 lasts
  115. `apps/battle` timeline.ts `INTRO`, `afterimages`; scene.ts (a copy of the TV viewport).
- **confirmed** (code: 0x8043DF8C; Dolphin) The HUD's corners hide while a Link stands in front of them ("How the game
  drives main_bat" above): the castle's top corners at a 4-player start come in once the camera has zoomed out.
- **confirmed** (code) The message manager ([0x8053AED0], built by 0x8043F504 over main2D) holds `kk_1Pwin_01` …
  `kk_4Pwin_01` (+0x14 … +0x20; corner colors top (255,210,0), bottom (212,34,0)) and `kk_draw_01` (+0x24; top
  (255,170,210), bottom (4,36,130)); its draw (0x8043DB58) shows the one byte +0x256 picks (0-3 a player, 4 a draw,
  0xFF none) with J2DPicture::draw(179.5, 173) at the texture's size. BFIN (0x803D6BDC: the winner, 4 for a draw, into
  0x80529F94) sets that byte. It also holds `kk_rupyNum_00-09` pictures.
- **confirmed** (frame dumps, 2, 3 players, a time-up) A knockout at frame K (life 0): main2D `main_message_window.blo`
  with BMG 0x19B "P{number 0} down!" slides up from K+117 (offsets 72, 67, 60, 53, 46, 38, 29, 20, 10 px, then in
  place), stays 161 frames, slides out from K+287 (1, 3, 7, 13, 21, 30, 41, 53, 67) and is gone at K+296; every
  knockout gets one, the fight going on (three players); two Links out on the same frame (Vaati) get one message, the
  first's. The last knockout of a battle starts BFIN: from K+137 (its state 1) the HUD fades out; from K+138 (state 2)
  the camera's end mode (its byte +0x7F4 = 1: the box's edges ease exactly onto every Link on the TV, knocked-out ones
  lying where they fell, with no hold and no slack, the view at least 260 px wide: a zoom-in, traced); from K+268
  (state 3) the winner raises his sword (player_sob 220 … 232 a frame every 2 ticks from K+270, then held) and the
  camera keeps him alone; at K+294 (state 5) "P1 WIN!" / "DRAW!", the sparkle on the winner's sword (JPA 203 + 204, 7 px
  right of and 27 px over him, layer 1; sound 0x2000E `JA_SE_LK_DISCHARGE`, 0x801E67C4); at K+423 (state 6) main2D
  `pressstart.blo` 42 px higher than in the file, its alpha pulsing
  (a 46-frame cycle: full for 21, 0.194 + 0.806·u² between, u = |c − 13|/13), waiting for A. The sim's `RESULT_TICKS`
  is 423.
- **confirmed** (frame dumps) After A: the banner and PRESS START vanish, the arena fades to black over 25 frames, the
  Total screen's castle wall fades in from frame 26 (25 frames); the panel (`Ndata03`, `Pblk*`) slides up from 63 to 73
  (offsets 351, 325, 297, 268, 235, 201, 165, 127, 87, 44), Continue from 63 and Quit from 68 slide up on their own
  (94, 71, 48, 25), the "Total" scroll drops from 72 (−81, −66, −51, −35, −18); the A prompt and the cursor's pulse
  from 91; `total_star.bck` frame 0 at 90 (landing on 109), its pulse at 170 and every 120 after; its sparkles (JPA
  1231 trailing it, 1233 on landing, 1232 on each pulse) in the screen's own space (the JPA table above). Under the
  Total screen (opaque from frame 25: black, then the wall) apps/battle draws no arena.
- **confirmed** (code: the request 0x8043D67C, the message manager's states 0x8043D034, 0x8043CF40, 0x8043CEA0,
  0x8043CDA0 in the table 0x804B18A8; pane slides 0x80402940 / 0x80402E08; frame dumps of "P2 down!" and "You got 10
  Dark World seconds!") **The message window**: one main_message_window.blo for every message. A request (BMG id − 1,
  the {number 0} argument + 1, a value) is dropped while one is up (+0x10A set by the request, cleared when the
  slide-out ends), and a message whose text starts with {notice} (2.2A) is shown once ever: a bit of the save file
  (0x802D46D8, [[game + 4] + 0xC] + 0x2D48) set when it's taken, the request refused once set (0x199 too). On the
  frame it's taken it plays its 2D sound (0x8043D7EC: `JA_SE_ATTENTION_PINCH` 0x40 for ids 0x190-0x191, 0x196-0x199,
  0x1A9; none for 0x240; else `JA_SE_ATTENTION` 0x39). The next frame (state 0) places it 100 px below its place,
  or, when a Link on the TV is lower than the frame's top less 16 room px (the projected 16 px; his feet) and none is
  higher than (448 − 364) + that, at the top: its top 13 px down and 100 px above that; then it slides in over 19
  frames (100 · (1 − (k/19)²) px off: J2D's ease, the dumps' 72, 67, 60 … from k = 10), stays 160 more (the
  counter +0x104 = 160; 0 at once outside game mode 7), slides out over 11 (100 · (k/11)²: 1, 3, 7 … 67, then off
  the screen) and frees the window on the last. A knockout asks 107 frames after it (the window in view from 117).
  The HUD corners don't fade for it (frame dumps). In battle the requests are (main.dol's callers of 0x8043D67C):
  the Link's death (0x80277F98: 0x19B "P{n} down!", or 0x199 with Force Gems lost: none in battle), Vaati's timer
  (0x802D3A18: 0x196 "30 seconds left!" at 1800 frames left, 0x197 "Vaati arrives in 10 seconds!" at 660, each
  with `JA_SE_DEATH_WARNING` 0x30 of its own; then 0x8043EDE8 shows the digits 5…1 at 300, 240 … 60 with
  `JA_SE_DEATH_COUNT_05`…`_01` 0x31-0x35), a castle circle (color 5: its +0x260 set at init) reaching full size for
  the first time (0xE8 "{notice}You got 10 Dark World seconds!", CIRC 0x8028AF6C; the dumps: in place 20 frames after
  the circle's full size, before it took P1), an orb's content taken while the orb is on a GBA screen in a
  multiplayer game (0x1A2 "P{n} nabbed a crystal ball!", CRTL 0x803218A0; 0x80321D78 another path, not decoded), the
  giant bomb landing (0x1A9 "A giant bomb! Escape to your Game Boy Advance!" for its kind 0, 0x1C2 "A giant bomb! Run
  away!" for kind 1, BBMB 0x80342E10), angry cuccos (0x1B7, NIWA 0x803303C8: not simulated). Adventure-only: 0x190
  "took great damage!", 0x191 "is invincible!", 0x192-0x195 Force Gems, 0x327, 0x33A/0x33B fairies, Tingle's
  0x147/0x148. `apps/battle` `timeline.ts` (`messageWindow`, `messageAtTop`), `banners.ts`; the actors' requests in
  the sim (`BattleState.messages`, `packages/sim/src/messages.ts`): the {notice} flag is kept for the match there.
- **confirmed** (frame dumps) A time limit's last five seconds (the Vaati rule): main2D `kk_rupyNum_05` … `_01` drawn
  96×96 at (268, 165) (2×), black (80,80,0,255), white (255,255,0,255), for the first 30 frames of each second. No
  clock otherwise.
- The ranking labels: `main_bat_ranking.blo` ("2D screens", above; `ranks.ts`). Not used in battle: main2D
  `kk_gbaOut1P…4P` (the arrows to a GBA screen).

## Messages (BMG)
Parser `packages/formats/src/j2d/bmg.ts`, layout `packages/render/src/screentext.ts` (`ScreenView.setText`), browser in
`apps/screens` (`#msg=<id>`). **confirmed** = parsed for every message of the four files with consistent results
(`j2d/bmg.realdisc.test.ts`) or read in main.dol's tag handler.
- **confirmed** Files: msgus.arc `bmg/gc_four_swords_text_e.bmg` and `_ek.bmg`, msgjp.arc `_jp.bmg` and `_jpk.bmg`;
  main.dol loads both of a language at once into two message managers (0x80391A1C: `_e` at +0x48, `_ek` at +0x4C).
- **confirmed** Header (0x20): `MESGbmg1`, u32 file size, u32 block count (2), u8 encoding (3 = Shift-JIS in all four;
  the US texts are plain ASCII), pad. Blocks `[tag, u32 size]`, sizes padded to 0x20: `INF1` and `DAT1` only (no
  `MID1`, `FLW1` or `FLI1`).
- **confirmed** INF1: u16 count (2150 in every file), u16 entry size (8), u16 file id (0), u8 default color (0), pad;
  entries from +0x10: u32 offset into DAT1's data, u16 message id (= index + 1), u16 attributes (always 0). The flow
  tags' message numbers are indices, not ids (the next bullets): id = number + 1. DAT1: NUL-terminated texts; offset 0 is the empty string (584 empty
  messages in `_e`, 592 in `_jp`: unused slots).
- **confirmed** Text: Shift-JIS bytes (two-byte codes for lead bytes 0x81-0x9F / 0xE0-0xFC), `\n` line breaks, and tags
  `0x1A, u8 length (whole tag), u8 group, u16 type, arguments`. The US font (encoding 0, codes 0x20-0xFF, Windows-1252
  layout with ¥ for `\`, arrows → ← ↑ ↓ at 0xA5-0xA8) draws every US character; the Japanese font draws all but under 1 %
  of the Japanese file's codes.
- *likely* `_ek` / `_jpk` are the texts shown on a **Game Boy Advance** screen: they leave out 617 / 627 more messages
  than `_e` / `_jp` (menus, memory card, story and mini-game texts; every message empty on the TV is empty there too),
  and of the rest 13 English messages differ: "+Control Pad" for "Control Stick", "Lift it" for "Pick it up", the
  arrows as the Shift-JIS ↑↓←→ (the GBA's font) instead of picture characters, tighter line breaks. `_jpk` writes the
  Japanese without kanji (手に入れた → てにいれた), as a GBA font would need.
- **Tags** (main.dol's handler 0x8039D770 switches on `group << 16 | type` and writes J2DPrint escape text into two
  buffers, the text and its shadow; names are ours, `BMG_TAGS`):

  | Tag | Args | What it does | How sure |
  |---|---|---|---|
  | 0.00 page | | ends a box; the text after it opens a new box (a newline right after is dropped) | *likely* (every multi-box message; the handler prints nothing) |
  | 1.00-1.0A icon | | picture character: two spaces in the text, a texture drawn over them: Links `kk_linkGr/Re/Bl/Pu_01`, Hylian letters `kk_angou_01-03`, hearts `heart`, `heart_01-03` (full, ¾, ½, ¼) | **confirmed** the two spaces (0x8039CDF8); *likely* the textures (name table 0x80475E20 in this order; the font test message 0x12B lists 1.00-1.0A) |
  | 1.0B-1.0C | | print nothing | **confirmed** (unused) |
  | 1.10-1.13 arrow | | font characters 0xA7 ↑, 0xA8 ↓, 0xA6 ←, 0xA5 → | **confirmed** (sdata2 0x805432BC) |
  | 2.1E color | u8 | `ESC CC[rrggbbaa] ESC GM[0]`: one color, no gradient, from 0x80475D64: 0 white, 1 (100,255,0), 2 (250,80,0), 3 (50,210,255), 4 (240,100,255) = the players' colors; item names use 1, villains 4. The shadow buffer gets black (or white in one mode) instead | **confirmed** |
  | 2.09-2.0C choice | u32 msg, u8 | an answer that leads to a message; 4 spaces for the cursor | **confirmed** spaces; *hypothesis* the meaning |
  | 2.11-2.14 | | 4 spaces (unused) | **confirmed** |
  | 2.19-2.1C option0-3 | u8 (0) | answer slots (Yes/No, the GBA votes): as many spaces as a runtime count (r13 table +0x2EE) | **confirmed** spaces; the count unknown (we use 2) |
  | 3.00-3.08 number | [u8 unit] | prints a number from the message context (0 a player/controller number, 2 a price, 3 Force Gems held, 4 a reward, 5 a best time, 6/7 records, 8 how many are left; 1 is printed elsewhere), then a unit word if the byte is 1-9: Force Gem(s), Cucco(s), baddy/baddies, time(s), system(s), thief/thieves, mole(s), return(s), Force Fairy/Fairies, singular for 1 (0x8039C630) | **confirmed** |
  | 2.29 time | | prints the race time ("Your time is...") | *likely* |
  | 2.05 then | u32 msg | continues with another message | *hypothesis* |
  | 2.07, 2.10, 2.2C branch | msgs | go on with one of 2 messages (their cond byte: unknown) | *hypothesis* |
  | 2.18 branch4 | u32 msg × 4 | one of 4 messages: by the controllers (below) | *hypothesis* (the rule) / *likely* (the indices) |
  | 2.22 setFlag / 2.23 ifFlag | u8 kind, u16 flag, u8 value / u8 kind, u16 flag, u32 msg × 2 | set (value 1) or clear a game flag / the first message if the flag is set, else the second | *likely* |
  | 2.1D ifGems, 2.33 ifItem | u32, u32 msg × 2 | branch on Force Gems / an item | *hypothesis* |
  | 2.0D pay, 2.24 give | | take Force Gems, give an item | *hypothesis* |
  | 2.15 wait, 2.25 autoClose | u32 frames | pauses, a box that closes itself | *hypothesis* |
  | 2.16 voice, 2.06/2.17 act, 2.0E fortune, 2.1F story, 2.2A notice, 2.2B part, 2.2D jingle, 2.2E/2F/31/32 event, 2.26-2.28 race timer | | message-system events; print nothing | *hypothesis* |

  Every tag in the four files is in this table (the real-disc test fails on a new one); the group 2 tags not listed as
  printing something return without output from the handler.
- **Flows followed by the talk** (`packages/sim/src/adventure/dialogue.ts`, `MessageBook.resolve`; apps/game shows the
  result). Lake Hylia's old man (`JIJI` 0x3D3 at (104, 56) of room 1's area 2 → message 1278, only a branch4(1302, 1303,
  1303, 1303)) and cave villager (`JIJI` at (264, 312) of room 58's area 5 → 791, only a branch4(791, 791, 791, 792))
  had no text of their own, so they said nothing.
  - **likely** The tags' numbers are message indices (id = number + 1): read as ids, the old man's chain runs into a
    flow-only message and an empty one; read as indices, every link has its text. Over all 330 targets of the 2.18 and
    2.23 tags, 207 are texts as indices (181 as ids), 4 are empty (12). The chain with one controller: 1278 → branch4 → id 1303, ifFlag 3/10
    → (set) id 1279 "Listen up! Formations are the foundation…" (the flag is set by the drill's ends, ids 1290 and
    1291); (unset) id 1280, ifFlag 1/10 → (set) id 1282 "If you're interested in formations, go out into
    my backyard!", (unset) id 1277 "Hm? I've never seen you lads in these parts before…", which sets 1/10 (so the set
    branch is the first target of an ifFlag, and the unset one is its second). Id 1355 sets 1/10 too.
  - **likely** ifFlag: the first message if the flag is set, else the second (the chain above: the first talk is the
    unset path, and the repeat line the set one). setFlag: value 1 sets, 0 clears.
  - The branch4's other targets are texts: the old man's 1304 "Hrmm... I haven't seen you boys around here before..."
    (the index 1303, for two to four controllers) and the cave villager's 793, the speech without the controls (below).
  - **assumed** branch4 takes its message by the controllers: index = controllers − 1, so one controller (the one-player
    adventure: the four Links move on one controller's buttons) takes the first. The cave villager's long speech (792,
    for one to three controllers) tells the player to press X or the +Control Pad to check up on the friends and L or Y
    to call them back: the Links apart, which one controller drives; the four-controller speech (793) leaves that out.
    The other reading, the four Links (index 3), would give the one-controller game the speech without its controls.
    Not read from main.dol (the flow handler, its cond bytes, the message manager's state).
  - **assumed** A new adventure starts with no flags set, and a message's setFlags are set as it opens (1277's stands at
    its start, the drill's 1290 at its end: when within a message a flag is set is not measured).
  - **not followed**: `branch` (2.07, 2.10, 2.2C: its cond byte is unknown), `ifGems` (2.1D), `ifItem` (2.33), and `then`
    (2.05, "continues with another message", a hypothesis; `{branch 0 1301 1301}` ends Tingle's speech to a fairy, 1305).
    A message that leads only into these shows nothing (the playtest's actors check reports it).
- *hypothesis* Layout of a message in a box: J2DPrint as for any text box (above), pages split at 0.00. Our renders of
  the balloon fit 3 lines per page and the widest lines in its 416 px, which supports the box choice.

### Messages for Shadow Battle and the site (`BATTLE_MESSAGE_IDS`, `battleMessages(bmg)`)
Ids are the same in the US and Japanese files. Texts as in `_e`:
- Arenas `0x21-0x25` The Field, Tower of Flames, Tower of Winds, Hyrule Castle, Above the Clouds, `0x26-0x2A` the same
  "\n(Dark World)": in the sim's room order 0-9 (they equal `battleArenaName`).
- Mode: `0x40` / `0xA6` "Shadow Battle", `0x36` "Defeat your rivals and prove who's the strongest Shadow Link of all!",
  `0x118` "Select Shadow Battle data".
- Setup: `0x94`, `0xA2-0xA4` "P1"-"P4", `0x95` "Vs.", `0xA7` "Entry", `0xA8` "OK?", `0xAC` / `0x119` "START!",
  `0xAD` "Handicap", `0xAE` "Records", `0xF8` "Rules" with the rows `0xF9` Vaati, `0xFA` Powerful Items, `0xFB` Damage
  Rivals, `0xFC` Dark World Match and the values `0xFD` Yes, `0xFE` No, `0xFF` Drop, `0x100` Keep, `0x101` Random,
  `0xF4` "P1 - P4", `0xF5` "P2 - P4", `0xF6` End, `0xF7` Quit; `0x102` "…You got a new battle map!", `0x103` "This
  appears once Hyrulean Adventure has been cleared!".
- Results: `0xAF-0xB2` "P1 WINS!"-"P4 WINS!", `0xB3` "TIE!", `0xB4` "TIME: {number 1}", `0x4B` "Results".
- Pause: `0x10B` "Leave this area?\n\n{option0}Yes {option1}No" (Choose an Area, seen in Dolphin), `0x10C` "Quit Shadow
  Battle?\n\n{option0}Yes {option1}No" (Choose a Game), `0x10D` Continue, `0x10E` Quit (*likely* also the Total
  screen's buttons, which read the same in Dolphin).
- A knockout: `0x19B` "P{number 0} down!" (in the message window, Dolphin; `0x199` adds "\n-{number 1}!").
- The message window's others in battle ("The message window" above): `0xE8` "{notice}You got 10 Dark World
  seconds!", `0x196` "30 seconds left!", `0x197` "Vaati arrives in 10 seconds!", `0x1A2` "P{number 0} nabbed a crystal
  ball!", `0x1A9` "A giant bomb! Escape to\nyour Game Boy Advance!" (`0x1C2` "A giant bomb! Run away!"), `0x1B7`
  "Angry Cuccos! Run away!".
- Controllers: `0x3B` "The Controller in Socket {number 0} was removed…", `0xAB` "Insert {number 0} Controllers.",
  `0x38-0x3A` "Rumble Feature" ON / OFF.
- Not text: the intro's "Be the last one standing!" (main2D `kk_rival_01`) and "Go!" (data.arc `go.bti`), the results
  (main2D `kk_1pwin_01`-`kk_4pwin_01`, `kk_draw_01`), the last seconds' digits ("Shadow Battle's round screens" above);
  no round numbers, "Ready" or "Sudden death"; no item names for the battle rules, no control hints for battle.
