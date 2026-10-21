# FSA formats: J3D models and the title sky

Part of the FSA file-format notes (index: [../formats.md](../formats.md)).

## J3D models (`packages/formats/src/j3d/`, renderer `packages/render/src/j3d/`)
The 3D effects drawn with the 2D world: waterfalls, rainbows, light shafts, lava, drifting clouds, filters.
- Files: stage archives' `j3d/` (Lake Hylia: `taki_a`, `taki_b` waterfalls, `niji_a` rainbow, `morninglight00` light
  shafts; `suisyo_*` crystals, `osiro_*`, `yuka_*`, `w_kumo*`, `sandfall00`…), `data.arc j3d/` (the environment
  manager's models: `yougan`/`yami_yougan`/`doku_yougan` lava, `moya`/`moya_red`, `mekakusi`, the `*filter00` models,
  `blackcloudfilter`, `poisonswamp00`, `ak_magiccircle*`), `boss500 j3d/nagarekumo`, `battle1 j3d/suna`, `title.arc`.
- **confirmed** Format: all 104 BMDs (`J3D2bmd3`), 93 BTKs and 66 BRKs of data.arc, title.arc and the Boss archives
  parse with noclip.website's chunk layouts (INF1 scene graph, VTX1, EVP1/DRW1, JNT1, SHP1 display lists, MAT3, TEX1;
  TTK1, TRK1, PAK1, ANK1, TPT1). What FSA uses: flat planes in the model's XZ plane (y = 0), 1–5 joints, no skinning
  (no envelopes, every shape uses one matrix), 25 models with billboard shapes, 1–5 TEV stages, MTX2x4 texgens from
  TEX0 (and from NRM with the "EnvmapOld" mapping mode 6 in some models), 7 filter materials with indirect stages
  (`mekakusi`, `darkfilter00`, `fogfilter00`, `forestfilter00`, `darkFog00`), 46 models with lit color channels.
  Texture formats I4, IA4, I8, IA8, C4, C8, CMPR, RGB5A3. Blend modes: alpha, additive (1/1 and srcα/1), multiply
  (0/srccolor), none.
- **confirmed** BRK register index n drives TEV register Cn (0 = C0; `cloudshadowfilter00` fades C2's alpha 0 → 64,
  the value its last stage compares against), as noclip reads it; MAT3's fourth TEV color is unused (PREV starts white).
- Rendering (`J3dModel`): GX TEV → GLSL3 generator ported from noclip's `gx_material.ts` (stages, konst colors, swap
  tables, compare ops, overflow, indirect stages, alpha test), three.js blend/depth state from MAT3, joint matrices
  (basic scaling rule, R = Rz·Ry·Rx), BTK/BRK/BPK/BCK/BTP sampled with Hermite keys at `animationFrame(anim, tick)`
  (loop modes as J3DFrameCtrl) from an explicit 60 Hz tick. Not emulated: GX lights (a lit channel gets its ambient
  color only), billboards (drawn with the plain joint matrix), texture matrix mapping modes other than "none", fog,
  cull modes (effects are flat, drawn double-sided). Where that matters (**confirmed**, MAT3 of every BMD in data.arc,
  title.arc and Boss/*): no material enables fog (MAT3's fog table, header +0x68, entry +1); a lit channel only shows
  where a TEV stage reads RASC/RASA, which only `suisyo_1`–`7` (the crystals; also the only models with billboard
  shapes, 1 of 5 each), `osiro_mon` (Hyrule Castle's gate) and `poisonswamp00` do. None of them is placed by an app
  (no SEV2 rule spawns them). `nagarekumo` (Above the Clouds) is lit but its one stage is konst × texture alpha.
- apps/game draws `StageEffects` (the SEV2 models: Lake Hylia's waterfalls, rainbows, morning light) since 2026-10-10:
  a model on the ground sorts with the sprites by its y in its room, raised ones (`taki_b`) over every sprite and
  under the top layer, the rainbows and the room filters over it (`effectZ` in apps/game view.ts).
- **confirmed** (RAM, `J3DModel` objects: vtable 0x8049A8B8, model data at +0x04, base scale at +0x18, base 3×4
  matrix at +0x24) Placement. FSA's camera: view matrix 0x80536C50 = [1 0 0 −cx | 0 1 −1 −cy | 0 1 0 −cy − 3072],
  orthographic, so a 3D point (x, y, z) shows at world pixel **(x, y − z)** and sorts by y (bigger y in front). Every
  effect is a flat model scaled into world pixels:
  - `SEV2` ("environment control 2") actors spawn the stage effects; bit 0 of the params means "origin one room up"
    (y − 384). Lake Hylia (boss010, read in Dolphin while the Links were in rooms 6, 7 and 58): room 6's SEV2
    0x04000001 at (28, 12) → `taki_a` base (1760, 480, 0) and `niji_a` (1760, 2528, 2048), both scale
    (10.24, 10.24, −10.24), identity rotation; room 58's SEV2 0x02000001 at (16, 44) → `taki_b` (1664, 992, 1024), same
    scale. Room 0's SEV2 0x00040000 → `morninglight00` base [1 0 0 2816 | 0 0 1 3328 | 0 1 0 1536] (model XZ → world
    XY, i.e. centered on room 0's 512 × 512 layer, 1536 up) scale (10, 1, 10). `stageEffectPlacements` applies these
    rules (other stages: *hypothesis*, same actor). Its BRK fades the light out over 100 frames, once.
  - The environment manager draws its own models around the camera (0x8016A7DC): rotation "swapYZ", scale (s, 1, s),
    origin c·(1 − p) + 512·trunc(c·p / 512) + 256 on each axis for camera center c and parallax p, 1536 higher (drawn
    in front) or lower (behind the tiles). `yougan` (Tower of Flames lava, flag +0x1C4): s = 10.24, p = 0.5, behind;
    `nagarekumo` (Above the Clouds, flag +0x1DC): s = 1, p = 1.5, in front. `ENV_MODELS` / `envModelPlacement`.
    That drawer skips the in-front models when [0x8053AAF8]+0x4C == 11 or +0x88 == 2 (Lake Hylia: 7 and 0; what the
    Shadow Battle values are isn't known, so apps/battle draws `nagarekumo`).
- Compared with Dolphin (frames of the waterfall in room 7 at zoom 1.59 and of room 58): `taki_a`, `niji_a` and
  `taki_b` land on the same pixels (waterfall columns, streaks, both rainbows). Dolphin's waterfall reads brighter
  mostly because its water tiles are brighter there (semi-transparent palette 13 over the river-bed layer, not drawn
  by us); the spray and the mist at the waterfalls' feet are JPA particles (`PRTC` actors), not J3D.
- Not seen drawn in Lake Hylia: `cloudshadowfilter00` (its model instance keeps an identity base; the cloud shadows
  are the environment manager's `kumo_env` quad, see TV rendering pipeline).

### The title screen's sky (title.arc `j3d/w_kumo*`; apps/site `title-sky.ts`)
The sky, clouds and floating castle behind the title logo are six J3D quads, not a picture (`kk_titleback_01`, a
darker 608×448 CMPR painting of the castle in title.arc's `timg/`, isn't drawn by the title; the home page keeps it as
its static sky). Read in main.dol (loader 0x803A59E0, draw 0x803A44D8, the environment manager's clouds and
lightning 0x8016D398) and in RAM on the title (`ref/battle/title.sav`; docs/measurements/screens.md "The title screen's sky
in Dolphin"):
- **confirmed** The models, in the loader's table 0x804AF7D8 (bmd, btk, brk): `w_kumo` (a veil of mist: two
  `AK_cloud00` layers through `cloud_a_mask`, no Z write), `w_kumo1` and `w_kumo2` (cloud banks `cloud_a_*`,
  `cloud_b_*`: color, mask, alpha), `w_kumo3` (the castle `siro0112` and its light `siro_hikari_kage0114`, a static
  btk), `w_kumo4` (far clouds `oku_kumo_0120_00_a`), `w_kumo5` (the sky's gradient `haikei_sora`, 8×256 I4,
  lerp(C0, C1) dark to blue; opaque, no animation). Every one is one 100×100 quad in its XZ plane; texture 0
  (`tenkuusiro`, a painting of the sky castle) is in each file but no material uses it.
- **confirmed** (RAM: J3DModel +0x18 scale, +0x24 base) Model i of the table gets scale 7 and base
  [1 0 0 300 | 0 0 1 250 | 0 1 0 −513 − 96i]: the quads face the screen, 700×700 px about (300, 250), `w_kumo`
  nearest (−513), `w_kumo5` farthest (−993). They are drawn through an identity view (0x8013AC54 copies the identity
  into J3D's view 0x80536C50) and the 2D screen's camera ([0x8053AB10] + 0x10: an orthographic 608×448 projection,
  y down), so they lie in screen pixels; XLU clouds over the opaque sky, far to near.
- **confirmed** Animations, set each frame by 0x8016D398 (not by the frame controllers): every `.btk` frame = the
  game's frame counter ([0x8053AAF8] + 0x5C) mod its length (1000, 2400, 2400, 1, 4800 frames: the clouds scroll
  sideways); the `.brk` (TEV C0/C1, konst 0; 100 frames, keys at 0 = dark and 59 = lit) frame = 100 × t / 60
  (integer), t = the frames left of the latest lightning strike: models 0-3 (`w_kumo1-3` lit) take the near strikes'
  t, models 4-5 (`w_kumo4`) the larger of both kinds'. So a strike lights the layers fully for 24 frames, then they
  fade over 36.
- **confirmed** Lightning (0x8016D398, title flag set): two countdowns, the title object's +0x84 (near) and +0x88
  (far). Each frame a countdown above 0 counts down; at 0 it draws its next wait from the game's generator
  ([0x8053AAF8] + 0xB4: x × 0x19660D + 0x3C6EF35F, the top 23 bits as a float in [0, 1)), trunc(310 r) for near,
  trunc(180 r) for far, and strikes in the first free one of four 28-byte slots at +0x90 (emitter, x, y, z, u16 effect,
  s32 frames left 60, sound handle): near = JPA effect 648 at (300 r − 150, 48 r + 96) (y drawn first), far = 647 at
  (±(72 r + 48), 64 r − 64) (y, then the sign: − above 0.5, then x). The strike's bolt is made with createEffect
  (scale 0.15, group 0), then every frame the slot sets its dynamics and particle scale to 7 and its translation to
  (304 + x, 224 + y) and z −657 (648: between `w_kumo1` and `w_kumo2`) or −849 (647: behind the castle); it is
  deleted once its particles are gone (the emitter's 0x40 "immortal" flag is set, so the game does it). The bolts
  draw after the models (0x800EBF88, group 0, the identity view), depth-tested against the clouds that write Z. Group
  0 is stepped twice a frame on the title: by the particle manager (0x8013DC44, groups 0-9) and again by the title's
  draw (0x803A4A00); a bolt's first frame (made in the draw) gets one step. Thunder: sound 0x30078 every other strike
  (a byte at +0x8C toggles), not played by the home page.
- Not known: the countdowns' values when the title starts (our page draws them from the generator).
- Rendering (`title-sky.ts`, `J3dModel` with `update(tick, { brk })` for the set frames, `JpaEffects` with an
  identity view and the bolts on a half-frame clock): within 0.36 (mean |ΔRGB|/3) of Dolphin's frames over the sky
  outside the logo, lit or not; 1.4 on frames with a bolt (its shape is JPA's random draws).
