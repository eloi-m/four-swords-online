# FSA formats: runtime (RAM) notes

Part of the FSA file-format notes (index: [../formats.md](../formats.md)).

## Runtime (RAM) notes (savestate `ref/save-lake-hylia.sav`, MEM1 via `tools/dolphin/src/ram.ts`)
- Current and neighboring room layers are kept big-endian in quadrant order, in 0x2020-byte blocks around 0x80F00000
  (room 1 base @0x80F007E0, room 0 base @0x80F02800, room 1 top @0x80F04820, room 0 top @0x80F06840). Tile→part tables
  sit just before them.
- The 0x1B8-byte records around 0x813E9CDC / 0x81402BEC are **not** the Links: they stay put while the Links walk
  (0x81402BEC's floats jump when the room changes). *hypothesis*: room objects.
- **confirmed** Live actors: 22 objects found by their vtable pointer, e.g. FGAL at 0x812DA900 (girls' positions at
  +0x294 + 12 i, frames at +0x350 + 4 i, walk step at +0x364), JIJI at 0x812DFD00 (variant +0x258, base frame +0x25C, SOB
  index +0x260, animation frame +0x238, direction +0x248), plus LEAF (falling leaves), RANK, GBAO, TBGN and SWDL, which
  don't appear in the room lists. FGAL also holds four positions next to the Links' at +0x1AC…

Found with the GDB tracer (`tools/dolphin`, method and numbers in `docs/measurements.md`); addresses are for this DOL
and, for heap objects, reached through the pointers given (heap addresses are stable from this savestate only).
- **confirmed** Frame loop: `main()` (0x801344C0) loops at **0x801347F8** once per 60 Hz frame (one breakpoint hit
  per VI retrace). SDA base r13 = 0x80541BC0; VI retrace counter u32 at r13−0x7654 = 0x8053A56C (incremented by
  `__VIRetraceHandler` 0x8004B7DC; `VIWaitForRetrace` 0x8004C228 exists but the game loop doesn't call it).
- **confirmed** Pad: FSA polls SI twice per frame. `PADStatus[4]` at **0x8052EA28** (12 bytes each: u16 buttons, s8 stick
  x, s8 stick y (up positive), …, s8 err; clamped stick reaches ±72 on axes, ±40 on diagonals). Pad 0's normalized
  stick at 0x8052EB18: f32 x, f32 y, f32 magnitude, u16 angle (0x4000 = right, 0x6000 = up-right); x = PADStatus / 54
  clamped to 1.
- **confirmed** Players: `*(u32*)0x8053AC90` (r13−0x6F30) → player manager (vtable 0x804A6F28) whose +4, +8, +0xC,
  +0x10 point to the four Link actors; player 0 is the single-player leader.
- Link actor (vtable 0x804A6F38, 0x13BC-byte JKRExpHeap block):
  - **confirmed** +0x008 f32 x, +0x00C f32 y, +0x010 f32 z (0) — world px (room cell (cx, cy) at cx·512, cy·384), and
    the SOB sprite anchor.
  - *hypothesis* +0x014… position history for the followers: 12-byte x/y/z entries, 48 of them from +0x038 (updated
    only when the leader moves, by 0x80251D50); +0x02C/+0x030 last frame's position.
  - **confirmed** +0x38C / +0x390 f32 walk speed per axis this frame (1.5, 1.125 while charging, 0 when blocked).
  - **confirmed** +0x3C4 u16 player_sob frame drawn, +0x3C6 u16 previous frame; +0x3F8 u8 walk-cycle tick (0–23),
    +0x3F9 u8 walk frame (tick / 3).
  - **confirmed** +0x1240 / +0x1244 / +0x1248 u32 current / next / previous state: 0 idle, 2 walk, 4 sword attack
    (swing, stab or lunge), 8 charging, 9 spin, 13 pushing, 27 room change, 55 held sword hitting a wall.
  - *hypothesis* +0x004 player index; +0x3C1 / +0x3C2 u8 flags cleared at the start of collision (blocked on x / y?);
    +0x1264 u32 counter cycling 0–59.
  - **confirmed** (traced through doors, "Side rooms (GBA screens)") +0x3B4 u32 the screen he's on: 0 the TV, 7 + a
    sublayer for a GBA screen (9 in The Field's house); +0xCC8 / +0xCD4 a warp's start and destination (3 f32 each),
    +0xCE0 / +0xCE4 the screens from and to, +0xCE8 u8 a warp pending, +0xCF4 its style (41 when none); states 28 / 29
    (through a door, then out of the other one), 30 / 31 (into a hole, then arriving), 32 / 33 (back from the castle's
    dark side), 34 / 35 (out of it by its middle), 36 / 37 (into it by a magic circle), 76 (in a cannon), 77 (shot out).
    +0xBD8 u32 the frames left on the dark side (600 on arrival, +0xBDC 1 meanwhile), +0xCB0 (2 f32) where he goes back
    to (the circle's spot).
  - **confirmed** (lifting, damage and items, `docs/measurements.md`): more states: 15 hurt (knockback), 17 lift (also
    the empty lift), 18 carry, 21 slam (B while carrying), 22 / 23 throw and its follow-through, 26 grab (R against a
    wall), 57–61 / 68 / 70–72 item use (57 Pegasus Boots, 58 bow, 59 slingshot, 60 hammer, 61 boomerang, 68 Fire Rod, 70
    Roc's Feather, 71 shovel, 72 lamp), 79 roll. +0x010 z is the knockback hop's height; +0x350 / +0x354 f32 knockback
    velocity (px/frame), +0x358 f32 hop speed (3.0 or 4.0, −0.25 per frame); +0x3DC u32 facing (0 right, 1 left, 2 down,
    3 up); +0x464 u32 invincibility frames left (60 after a hit); +0xB30 / +0xB34 s32 handles of this Link's two placed
    bombs (−1 = free); +0xBF8 / +0xBFC u32 max life / life (16 / 16 in the savestate, −2 per Octorok hit); +0xC10 u32
    item (1 Pegasus Boots, 2 lamp, 3 boomerang, 4 bow, 5 hammer, 6 Fire Rod, 7 Roc's Feather, 8 bombs, 9 shovel, 10
    slingshot, 11 the Four Sword: `LSTI` draws item n as `enemy_both2` 64 + n; writing it gives the item), +0xC14 u32
    item level; +0xD64 u8 1 while lifting or carrying, +0xD68 the carried actor's handle, +0xD6C its type ID (`GRAS` for
    a bush, `NULL` when empty). Item getters 0x802416C4 / 0x802415CC read +0xC10 / +0xC14 unless +0xD60 (normally −1)
    points elsewhere.
  - **confirmed** Actors a Link spawns (found by vtable in heap dumps; the first free heap block is 0x812D8500 from this
    savestate): `GRAS` (thrown bush, vtable 0x804A92D0), `HBMB` (bomb, 0x8049F784: +0x230 u32 state 2 lit / 3 held /
    5 exploding, +0x238 u32 fuse, +0x60 f32 hit box −x −y +x +y, ±7 → ±16 when it explodes), `ARRW` (0x804A05E0),
    boomerang (0x804A0738), `PCDM` (seed, 0x804AB3A8). Actors keep x/y/z at +0xC and fall back to the base vtable
    0x804A5770 when removed. The player code that spawns them: 0x80260C08 (`GRAS`), 0x8025785C (item use; `HBMB`: two
    bomb slots, spawn offset 13 px per facing from the table at 0x8046B220), 0x8025C894 (`ARRW`), 0x8025BEB0 (`PCDM`)
    (`node tools/dol/src/spawners.ts <IDs>` lists the calls that spawn an ID).
- **confirmed** Code: 0x802808E8 walks the actor (pos += speed × stick direction from the sine table,
  0x8022C82C / 0x8022C76C → 0x80247330 / 0x8024712C per player); 0x80269574 (0x22A8 bytes) resolves collisions,
  undoing a blocked step 0.5 px at a time (writes at 0x8026B4A8).
- **confirmed** Camera: view matrix at 0x80536C50 (3×4 f32); translation x at +0xC and y at +0x1C are minus the
  camera center in world px.
- **confirmed** Heap blocks (JKRExpHeap): 16-byte header u16 'HM' (0x484D), u8 flags, u8 group, u32 size, prev, next.
- **confirmed** (HUD code, and an Action Replay code pinning the value in a Dolphin frame dump) HP: Link actor +0xBFC u32
  current HP in quarter hearts, +0xBF8 max HP; the HUD shows the u32 at 0x80529EC4 + 4·player (copied from +0xBFC).
  Force Gems shown by the HUD: u32 at 0x80529ED4 + 4·player. HUD mode per player (0 = controller, 1 = GBA): 2-bit field
  at [r13 − 0x70C8] + 0x83. See "How the game drives main_bat" under 2D screens.
- **confirmed** Environment effects (Shadow Battle backdrops): manager returned by 0x8016A3AC, flags at +0x1C4…+0x1DC,
  frame counter +0x1C0. Its drawers read the camera through [0x8053AB10]: +0x20 → +0x2380/+0x2384 = room size in 8-px
  units (64, 48), +0x24 → +0x10/+0x20 = view translation, +0x858 = zoom (2.1408 in Lake Hylia).
  The manager is [[0x8053AAF8]+4]+0x24 (0x814BC578 in the Lake Hylia savestate: +0x1C0 = 0x0DE7, +0x1C7 = 1, +0x1EC =
  47, the cloud shadows' level). Its fields from the constructor 0x8016F0BC: J3D models +0x04 yougan, +0x0C
  doku_yougan, +0x14 yami_yougan, +0x1C moya, +0x28 darkFilter00 (drawn while +0x1EF ≠ 0, its brk frame = +0x1EF ×
  100 / 255), +0x34 mekakusi, +0x84 forestFilter00, +0x90 fogFilter00, +0x9C cloudShadowFilter00, +0xA8 poisonSwamp00,
  +0xB4 blackCloudFilter, +0xC0 morningLight00, +0xCC nagarekumo, +0xD4 darkFog00, +0xE0 moya_red (each followed by its
  btk and brk); +0xF4 kumo_env.
- **confirmed** The stage light (Lighting and the Dark World): [0x8053AB10]+0x2C → 0x81128400 in the savestate, tint
  +4 = FF FF FF 00, circle texture +8, level +0xC = FF. The Lake Hylia SWEV (0x812D9900) rewrites it every frame from
  its +0x2E0…+0x2EC (R, G, B, A words) and +0x310 (level): poking those changes the light for good.
- **confirmed** Game state [0x8053AAF8] (r13 − 0x70C8): +0x7F = 1 when playing alone with a controller (set by the mode
  prompt 0x803DE05C; probably 0 in battle), +0x82 the mask of playing players, +0xB4 the random seed. Link actor +0xB90
  f32 light radius, +0x338 vec3 light position (his position, 16 px ahead with the lantern alone).
- Dolphin quirk: a movie started from a savestate that wasn't itself recorded with a movie stops playing right after
  the state loads (the state carries the movie frame counter) unless `<movie>.sav.dtm` exists; `trace.ts` writes it.

Shadow Battle (the `ref/save-battle-*.sav` states, four integrated GBAs; `docs/measurements/battle-arenas.md` "Battle mode in
Dolphin"; addresses in `tools/dolphin/src/fsa.ts`):
- **confirmed** The main loop head (0x801347F8) is still hit once per VI retrace, through the menus and in battle.
- **confirmed** Players: the same player manager (r13−0x6F30) lists four Link actors in battle, whatever the player
  count; a Link not in the game sits in state 1 (sprite 797; The Field 2p: at world (712, 568) and (712, 664)). The
  actor fields above hold (position, z, sprite, state, facing, knockback, invincibility, life). Life +0xBFC = 12
  (3 hearts) at the start of a default round, for 2, 3 or 4 players.
- **confirmed** World coordinates: every arena is placed at world cell (1, 1) (world = room px + (512, 384)), whatever
  its boss500 room; the Links start on the room's `PLAS` slots, in an order that changes from round to round.
- **confirmed** GBA keys: one 0xE0-byte record per player from **0x804DB7F8** (bss). u16 at +0: bits 0–7 = A, B,
  Select, Start, Right, Left, Up, Down (pressed = 1), bit 8 set (bit 9 instead on some frames); u16 at +2: R 0x100,
  L 0x200, plus a low byte that changes with the keys (0x98 for A alone, 0xFD for B, 0xDC for Right; *hypothesis*: a
  check byte of the JoyBus packet). 0x804B9BA8 + 0x100·player holds the received packet (its first byte = that low
  byte). The record shows a movie's input one frame after the frame it was played on, and the Link acts on it that
  frame, as on a pad's PADStatus (so a GBA adds one frame of latency).
- **confirmed** Camera zoom (TV px per world px): f32 at [[0x8053AB10] + 0x24] + 0x858, 2.1408 in Lake Hylia, 1.6716
  at the start of The Field 2p (Links 96 px apart vertically). *measured*: it eased down to 1.6655 once they were
  also 88 px apart sideways, so it follows the Links' spread. **measured** since: the camera object's box, holds,
  margins and zoom (`docs/measurements/battle-arenas.md` "Battle measurements: arenas, orbs and camera"; `apps/battle/src/camera.ts`).
- **confirmed** (traced Link against Link: `docs/measurements/battle-combat.md` "Battle measurements: combat") Link fields in combat:
  +0x3F0 u32 the attack's 4-way direction (diagonals count as up or down; what the shield test compares with the
  victim's facing), +0x3F4 a block counter (5 on each blocked frame, then down to 0), +0x458 u8 1 while the attack's
  boxes are live, +0x45C u32 attack kind (0 swing, 2 stab, 4 lunge), +0x4A0 two attack boxes (x0 y0 x1 y1 f32 each,
  around the anchor), +0x4C0 the ±7 px body box, +0x4D0 a ±15 px box, +0x5EC the shield's box, +0x30C the sword tip,
  +0x35C / +0x360 f32 push velocity (blocks, clashes; added to the position, then decayed), +0xBF4 u32 attack power
  (4 sword, 8 lunge and spin, 2 charging; +2 with +0xC18 u32 sword level 2), +0x11AC spin kind (1 a released charge).
  More states: 12 stunned (a seed, a slammed Link), 25 held or thrown (a Link), 50 falling into a pit, 51 dying,
  55 also a clash, 66 hooked by a boomerang, 67 carried by a drawn arrow.
