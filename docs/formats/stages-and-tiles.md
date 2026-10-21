# FSA formats: stages, tile layers, background tiles, tile types

Part of the FSA file-format notes (index: [../formats.md](../formats.md)).

## Stages (`Boss/bossNNN.arc`)
- **confirmed** Stage IDs: `boss0WS`, where W = world (1–8) and S = stage (0–3). `boss010` = 1-1 Lake Hylia (first playable
  stage), `boss990` = intro, `boss991` = ending, `boss500` = Shadow Battle, `boss2xx` = mini-game stages (Bucking Bronco,
  Cucco Wranglers, Hammer Tag…), `boss00x`/`boss09x` = development/test stages, `boss1xx` = unidentified.
  Names come from FSALib `stages.json`. boss010 = Lake Hylia is confirmed: the Lake Hylia savestate frame matches boss010 room 1.
- Contents: `map/mapNNN.csv` (+ `_1` single-player variant), `szs/mNNN/*.szs` (tile layers), `bin/bNNN/*.bin` (actors),
  optional `timg/` (BTI), `j3d/` (BMD/BTK/BRK effects such as waterfalls `taki_*`), boss folders (`ganon/`, `grock/`…).

### Map layout CSV
- **confirmed** Line 1: `mapNNN,startX,startY,bgmId,showE3Banner,tilesetIndex,npcSheetId,overlayTextureId,unknown,disallowTingle`.
  Then 10 lines × 10 columns of room numbers or `NULL`, then `end`. boss010: start cell (5,4) = room 0,
  tileset 12 (`m`), overlay texture 1. Field names come from FSALib; only the tileset and start room are verified.
- Shadow Battle (`boss500`) uses a different format, see below.

### Tile layers `szs/mNNN/d_mapNNN_RR_mmm_G_V.szs`
- RR = room, G = layer group (1 = base, drawn below actors; 2 = top, drawn above), V = sublayer:
  **0 = TV screen**, 1–7 = GBA-screen areas (house and cave interiors, drawn with the `_gb_` palettes).
- **confirmed** Each file decompresses to 2048 bytes: 32×32 u16 little-endian tile indices (0–0x3FF), stored as four
  16×16 quadrants (TL, TR, BL, BR). `packages/formats/src/fsa/bg.ts` `decodeLayer`.
- **confirmed** Only the top 24 tile rows (512×384 px) are visible on the TV; rows 24–31 hold filler.

## Background tiles (**confirmed**: renders match Dolphin, see Checkpoint A)
- Tile = 16×16 px = 4 parts of 8×8 (TL, TR, BL, BR). The tile → parts table is `data.arc/spl/bg_a_spl.szs`
  (0x2000 bytes, shared by every tileset): u16 LE `PPPP VH CCCCCCCCCC` (palette, vflip, hflip, part index).
- Part pixels: 4bpp, 32 bytes per part, low nibble = left pixel, color 0 transparent. The 0x8000-byte char sheet holds
  `sch/bg_<id>_sch.szs` (0x6000) at 0, then `sch/bg_base_sch.szs` (0x1000) at 0x6000. 0x7000–0x7FFF is empty at
  runtime in Lake Hylia (only tile 0x1C2, used in 3 stages, points there). Animated tiles overwrite slices of the sheet: see below.
- **confirmed** (texture dump) At runtime the GC uploads the sheet as one 128×512 C4 texture, 16 parts per row, in
  part order (the GX 8×8 C4 block = one part, nibbles swapped). In RAM it sits at 0x80EEDAC0 in the Lake Hylia savestate.
- Palettes: `scl/bg_<id>_scl.szs` (TV), `bg_<id>_gb_scl.szs` (GBA), `bg_<id>_ura_scl.szs` (Dark World?). **confirmed**
  All 28 `bg_*_ura_scl` files are byte-identical (a generic debug-looking palette), so they're probably not what the Dark
  World uses.
  0x200 bytes = 16 × 16 colors, BGR555 LE, expanded with `(v << 3) | (v >> 2)`.
- Tileset IDs: index 0–25 = `a`–`z`, 26 = `1a`, 27 = `1b`.
- Palette 13 water transparency (**partly confirmed**, Lake Hylia TV): FSALib says colors 8–10 of palette 13 get
  alpha 80/120/160 when environment effects are on. The runtime TLUT of palette 13 (texture dump) instead has those
  three colors as RGB5A3 with alpha 4/7 (0x92 after expansion) and their RGB cut to 4 bits (e.g. `2952b5` →
  `2255bb`); the other 13 colors are opaque and unchanged, and palettes 10/11 are unchanged. The river bed (below) is
  drawn under the BG layers there. Implemented (`packages/render/src/riverbed.ts`, `riverBedPalettes`) where the room's
  SWEV has bit 19, in apps/battle (The Field) and apps/game (one quad per such room, which also get the water
  palette; Lake Hylia's but 4 and 10); Dolphin, battle, the river bed's colors poked red: the water turns
  (177, 120, 149) = 0.573 × color 10 (119, 204, 255) + 0.427 × red, so the water blends at alpha 0x92 as modelled.
  The ground overlay doesn't touch these water colors (filter1 poked to 0: the ground goes black, the water stays as
  it was), so the tilemap skips it on half-transparent pixels.

### Animated tiles (`sch/bg_anim_b_sch.bin`, `sch/bg_anim_sch.bin`, 0x8000 bytes each, uncompressed)
Implemented in `packages/formats/src/fsa/bganim.ts` (software: `animateChars`) and `packages/render/src/tilemap.ts`.
- The BG animator (main.dol G4SE01 rev 0 @ 0x802A3A0C, run once per 60 Hz frame; its timers are set to 10 and its
  counters to 0 by 0x802A3D80) copies frames over the char sheet. Frame offsets come from a u16 table at 0x8046C4A8
  (`i × 0x400`). A tick below = one animator update since the stage started; the first copy is on tick 10, and until
  then the tileset's own parts show.
- **confirmed** Water, every tileset: `bg_anim_b` = 16 blocks of 0x800 bytes (64 parts). Every 10 ticks the next block
  0, 1 … 7, 0 … is copied to char offset 0x3800 (parts 0x1C0–0x1FF), i.e. an 8-frame, 80-tick cycle. Tileset 16 (`q`)
  uses blocks 8–15 (offset +0x4000) instead. Within blocks 0–7, parts 0x1C0–0x1DF repeat every 4 blocks and
  0x1E0–0x1FF every 8. Most tilesets store block 0 in their own 0x3800 region (block 8 for `q`).
  Checked in Lake Hylia (tileset `m`): the 8 texture-dump states are exactly blocks 0–7 (4bpp indices recovered
  from the dumped colors; all other parts match our sheet except 2–7, below); a Dolphin frame dump steps exactly every 10
  frames (every dumped frame distinct, so 60 fps), with blocks in order 4, 5, 6, 7, 0, 1 … (fit against our renders);
  the RAM char sheet in the savestate holds block 3. The white flowers (tiles 0x1B4/0x1C4, part 0x1DF) animate too.
- *hypothesis* (read from the animator, not yet seen in Dolphin) `bg_anim` = 32 slices of 0x400 bytes, per tileset:
  `l`: slices at 0x2000 + n × 0x400 (n = 1, 2 … 7, 0) → 0x5800, **20** ticks per frame after the first copy;
  `s`, `w`: 0x6000 + n × 0x400 → 0x1C00, 8 frames; `k`, `v`: 0x1000 + n × 0x400 → 0x5C00, 4 frames;
  `y`, `1b`: 0x4000 + n × 0x800 (0x800 bytes) → 0x5800, 4 frames; 10 ticks per frame unless noted. Each of these
  tilesets stores one of those frames in its own sheet at the destination, which supports the mapping.
- *observed* In the Lake Hylia savestate, parts 2–3 of the runtime sheet are zero and parts 4–7 hold `bg_tenso_sch.bin`
  parts 0x0E–0x11 (constant in all dumps; used only by tiles 0x38/0x39, absent from boss010). Not handled.
- Measuring in Dolphin: the river isn't on screen in the savestate, so an Action Replay code (cheats on with
  `-C Dolphin.Core.EnableCheats=True`, code in the user folder's `GameSettings/G4SE01.ini`) filled room 1's base
  layer in RAM with water tiles, e.g. `02F009E0 003F0179` = 64 × tile 0x179 at 0x80F009E0 (top-right quadrant). The
  game draws and collides with the RAM layer, so this works for any tile. `-C GFX.Hacks.SkipDuplicateXFBs=False`
  makes Dolphin dump every field, which is how the 60 fps rate was checked.

## TV rendering pipeline (observed in Dolphin, boss010 room 1, savestate `ref/save-lake-hylia.sav`)
- Frame dump at native resolution is 608×452. The camera scales the room by about **2.14×** and follows the Links (the
  zoom is dynamic). Fitted with `tools/render/src/compare.ts`; reference frame `ref/frames/boss010-room01-dolphin.png`.
- **confirmed** (fit, code and Dolphin) Ground overlay: `data.arc/timg/filter<N>.bti`, where N = the map layout's
  `overlayTextureId` (0 = none; 1 = outdoor fields, 2 = dungeons…, 9 max, matching filter1–9). These are 128×128 I4
  textures (the renderer loads 10 at 0x802FFDEC: index 0 and 1 are both filter1).
  - World-anchored, 1 texel = 1 room pixel, texel = (room x mod 128, room y mod 128). The correlation fit landed exactly
    on scale 1.000 and zero offset.
  - It multiplies tile RGB by the intensity (a TEV multiply): in Dolphin, the BG copy of filter1 poked to all 0 turns
    the tiles black, all 0xF shows the exact palette colors (74, 173, 74 grass). An earlier one-frame regression gave
    `0.318 + 0.542 × intensity`: it was absorbing the cloud shadows, which darken the Checkpoint A frame by up to 18 %
    (see "Cloud shadows"). The mean luma difference against Dolphin: 27.6 without, 18.8 with the plain overlay, 9.95 with
    the cloud shadows too.
  - Sprites don't get it: with the filter poked black the Links and villagers keep their colors (the sprite drawer
    0x802F745C has a filter stage too, but a second filter1 copy poked black changes nothing on screen).
  - Implemented in `packages/formats/src/fsa/overlay.ts` (software) and in the tilemap shader (`packages/render`).
- **confirmed** Cloud shadows (`data.arc/timg/kumo_env.bti`, over the ground and the sprites, under the top layer):
  see "Cloud shadows" under the Shadow Battle layout. Also checked on Lake Hylia frames: with that mapping (one repeat
  per 512 × 384 room, 1/2048 per frame), a Dolphin frame pair 300 frames apart (static camera) agrees on 99.9 % of the
  pixels and the drift fits 300–307 frames; the darkening measures ×0.815 (1 − 47/255). Every Lake Hylia room but 4
  and 10 has SWEV 0x00280000 (bits 21 and 19). It is not the J3D `cloudshadowfilter00.bmd` (its model instance keeps
  an identity base). Drawn by apps/battle (`cloudshadow.ts`) and by `CloudShadows` in `packages/render/src/j3d/effects.ts`
  (the viewer's 3D effects).
- Over water, Dolphin shows bright cloud shapes instead: SWEV bit 19 → manager +0x1C7, the river-bed drawer
  (0x8016CB14) under the semi-transparent water colors of palette 13. **River bed** (**confirmed**, code; the look
  checked against Dolphin's The Field): one opaque screen quad, map 0 `kawazoko.bti` (+0xFC, "river bottom"), map 1
  `kumo_env.bti` (+0xF4), map 2 `noize_kawazoko_1.bti` (+0x100) as the indirect texture of both TEV stages
  (GXSetTevIndWarp, signed, matrix 0.02: ±2.56 texels). With the camera center (cx, cy) and the manager's frame f:
  kawazoko s, t = x / 128, y / 128; kumo_env s = cx / 1024 + (x − cx) / 256 − (f & 0xFFF) / 4096, t = cy / 768 +
  (y − cy) / 192 − (f & 0xFFF) / 4096; noise s = x / 256 − (f & 0x3FF) / 1024, t = y / 256 − cy / 768. Stage 0
  lerp(C0, C1, kawazoko), C0 = (0, 80, 120) (0x8053D910), C1 = (56, 96, 168) (0x8053D914); stage 1 adds A0 × kumo_env
  with A0 = min(level × 120 / 47, 120), level = +0x1EC (the cloud shadows', rising one a frame from the round's start:
  3 on the battle state's frame 10, so the clouds over the water fade in over the first second).
- The zoom is dynamic: 2.14 in Lake Hylia room 1, 1.59 when the Links swim in the waterfall (room 7).
- Not implemented yet: the adventure HUD in apps/game (the battle HUD is in apps/battle). Shadows: see "Actor graphics"; static actor sprites too. JPA particles: see "JPA particles".
  J3D effects: see "J3D models".

## Tile types (**confirmed**: table read from main.dol; semantics partly verified visually)
- main.dol data @ **0x8046CB88** (G4SE01 rev 0): 1024 × u16 BE, one behavior type per global tile index (same indices
  as `bg_a_spl`). `packages/formats/src/fsa/tiletypes.ts` reads it from the user's own main.dol.
- Located by correlating candidate arrays with community tile notes (FSALib, used locally as an oracle only), then
  cross-tabulated. Values are an enum, not bitfields: 0x00 floor, 0x01 solid, 0x02 background, 0x03 pit, 0x0d deep water,
  0x0e damaging pit, 0x39 shallow water, 0x50 ice, 0x51 spikes, 0x60 quicksand, 0x61 ladder. Partial walls come in
  blocks of 4 (top, bottom, left, right or BR, BL, TR, TL): 0x04–07, 0x08–0b (sloped), 0x10–13, 0x14–17, 0x28–2b (door
  frames), 0x58–5f (walls in water). Also 0x20 fence, 0x21 bush (cuttable), 0x30–38 movable blocks, 0x40–43 steel ball
  spawners, 0x52–53 fragile blocks.
- Collision comes from the **base layer** (group 1) only. Top-layer tiles such as tree canopies are typed solid but
  never block.
