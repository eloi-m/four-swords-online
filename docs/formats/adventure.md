# FSA formats: adventure (Phantom Ganon, signs and dialogue, doors' open tiles, the lifted stone)

Part of the FSA file-format notes (index: [../formats.md](../formats.md)).

### Phantom Ganon (`packages/sim/src/adventure/phantomganon.ts`, apps/game `ganon.ts`)
**Confirmed** from main.dol, and traced in Dolphin (docs/measurements/adventure-world1.md "Hyrule Castle room 11: Phantom
Ganon": what the trace corrected is marked *traced* below): `FGAN` ctor 0x80202444, vtable
0x804A1318, init 0x8017E770, update 0x8017C40C, draw 0x8017C078; the state at +0x230 through the 29-entry table at
0x804A136C. Kind = params & 15: 0 the boss (room 11's 0x2000), 10 his energy ball, 11 a shard.
- The boss: placed at his spawn, home = spawn + (0, 16) (*traced*); HP +0x26C = 210 (each hit's damage = 10000 −
  +0x108, then reset; a sword swing 4, *traced*); damage 2; boxes (−16, −8, 16, 40) and (−8, −8, 8, 8): the first is
  his body on the ground, x ± 16, y − 8 … y + 40, whatever his height (*traced* with the sword while he's down). Every frame: timers +0x234…+0x248 count down; velocity eases 0.3 of the
  way to its target (≤ 1 px/frame), z likewise (≤ +0x280); in states 7-10, 17, 21 the target z bobs 40 + 4 cos (phase
  +768 a frame). Frame tables: wait 4 × 8 (loop, 0x804A125C), swing 2, 2, 2, 2, 5 (0x804A1248), dawn 4, 4, 4, 4, 2, 4
  (0x804A1230), hurt 4, 4, 4, 8, 4 (0x804A127C).
- Intro (states 0-5): once the camera sees him a demo lock; 100 then 300 frames; he appears (scale y 5 → 1, x 0 → 1,
  alpha → 255), waits 100, swings; the screen tint (R → 159, G → 127); the boss music.
- Fight (6-17): throw timer 200 + 100 rand, dash cooldown 50 + 50 rand; hovering he wanders 2 px/frame (a = 8192 −
  16384 rand, toward home once 64 px off it, new heading every 50 + 50 rand); playing alone he charges (30 frames) and
  dashes at the nearest Link at 13 px/frame (2 damage, hit type 6), a wall within 48 px stopping him; to throw he rises
  60 px (4 px/frame, ±22.5°), raises the ball at (x − 20, y − 110), bats it 40 frames later at the Link (3 px/frame,
  later ones ±2048 off, alternating); a Link within 50 px after a throw: a dash.
- The ball: a sword sends it back at him at its own speed (aimed at y − 8 − z; *traced*: returnable at once after his
  bat, 30 frames not after a return; the Link it left is safe 100 frames); his next bat is 0.26 px/frame × the returns
  so far faster (*traced* 3, 3.26, 3.78; capped at 5, at 5 a sword no longer returns it); caught by him in states
  16-17 after a return (*traced*: its middle up to ~14.5 px aside, from below to 8 px under his place on the ground)
  he bats it back, or with the rally (+0x278, +1 per return) at 4 it strikes him down. More than 50 frames after his
  bat it bursts 16 px past the screen's edge (0x801F6758, *traced*; walls don't stop it) into 7 shards fanned ±67.5°
  at the nearest Link (5 px/frame, ±2 boxes, through walls, 78 frames, *traced*); it hurts a Link it meets (hit type 1).
- Down (18-21): hurt frames (the Links held 30 frames, *traced*), z → 0, then for up to 400 frames the sword hurts him
  on the ground, +0x254 open: a blow closes it and replays his hurt (dawn) frames from the first, open again a frame
  into the last (*traced*: 15-21 frames between blows); 75 damage in one fall gets him up; HP 0: he rises to z 40
  (state 22-23), then the bosses' death (vtable +0x24 → 0x801F4E0C: 300 frames still, the Links free, *traced*) and
  goes. The room's ZNSW (switch 17) then WTSW 16 320 frames later (*traced*; 18 off with it): the staircase (`RASN`)
  to room 12.
- Force Gems (*traced*): his first two falls (state 18, his count +0x260 < 2) spawn a `GOLD` of params 99 at his place
  and height; the bosses' death drop (0x801F4A9C) a `GOLD` of params 80 where he went. `GOLD` (vtable 0x804AB660, init
  0x8032A7B8, update 0x80329640): worth = params & 0xFFFF, kind (p >> 16) & 15; kind 0 makes `RUPY`s worth it at once
  (up to 100 tries: the largest gem type, cap 11 kept lowered, not worth more than what's left; a type at random
  0..it; below 20 left a 1; taken off) and goes; each gem from its place at (−1…1, −1…1, 2…4) px/frame, z += vz then
  vz −= 0.3, stopping where it lands (a side view's kind flings them sideways, vz 0: not used here).
- Drawn from `Boss/boss013.arc` `fganon/` BTIs by group (+0x27C): 0 dawn_00…18, 1 kenhuri_05…13 (x offsets 0, 0, −21,
  21, 21), 2 wait_00_u…28_u, 3 yarare_02…22, scaled (+0x2AC, +0x2B0) and faded (+0x290), a shadow at z 0 (alpha 100,
  0.8 × scale y). The ball and shards are JPA effects (per-Link pairs 0x372-0x379). Not decoded: the 2-4 player rules
  (no dashes, the ball passed from Link to Link), the top of his catch box.

### Signs and dialogue (`packages/sim/src/adventure/dialogue.ts`, apps/game `dialogue.ts`)
- **confirmed** (main.dol, and Dolphin for the sign: docs/measurements/adventure-world1.md "Adventure: signs and dialogue") Message ids
  are a speaker's params + 0x12B (299): `KNBN` signs (init 0x8038FD08, update 0x8038FA58) params & 0xFFFF, `JIJI`
  villagers (init 0x8037C788) params & 0xFFF, `KEPO` and `NAVI` params & 0xFFFF; message 0x12B itself is the font
  test. Lake Hylia's: room 2's sign 0x528, room 3's 0x532, the bridge's underside (room 5, area 2) 0x13A ("-Swimming
  Basics-"); room 3's house 0x470 and 0x471, room 7's cannon man (area 5) 0x22B, the Fire Rod's keeper (`SNPC`,
  room 3 area 2) 0x31B. Some are empty in the US file (room 1's house): nothing is said. The owl's (`KEPO` 0x190 → 0x2BB) is five pages long. Room 1's old man (0x4FE, 1278) and
  room 58's cave villager (0x317, 791) have only a flow (branch4, ifFlag), Tingle's Tower's two in Tingle's house (843,
  844) a branch on room 11's switch 29: the talk follows it to their text
  (`docs/formats/j2d-and-bmg.md` "Flows followed by the talk": what's established and what's assumed).
- **confirmed** Who talks: each frame a Link's point 15.999 px ahead (table 0x8046AE78 by facing: right, left, down,
  up) inside a speaker's box marks it (0x8024CD20; the box test is inclusive); with the speaker's "needs A" flag the
  pad's A pressed that frame (0x80245DB0, mask 0x100) starts the talk; the speaker's update then opens its message
  (0x8038C678: player, message id, the speaker, its screen, its position, a style word).
  - `KNBN`: the sign is its tile, 0x3C or 0x71 (one tile) or 0x1C7 (two by two; none placed), anything else says
    nothing; box (x + 2, y) to (x + 14, y + 14) (x + 30, y + 30 for 0x1C7) from its anchor; on the TV read only
    facing up from below (the Link's y not above the sign's), in side views from any side; style 0x200 for tile 0x71
    (the wooden board `hukidashi_wood.blo`, measured), 0x400 for the others (0x3C, the stone tablets: assumed
    `hukidashi_stone.blo`). Params bits 28-31 switch a sign off in some modes (not read further).
  - `JIJI`: box ±8 px round its anchor, (-16, -16) to (16, 8) for kinds (params >> 16) & 0xFF = 6, 11, 16, 25; from
    any side; style 16 (the speech balloon `hukidashi.blo`); the Link on the ground. (params >> 12) & 3 ≠ 0: talks by
    itself when touched (not done; none in world 1). World 9+ stage 0 and a debug byte at 0x8050DB10 pick other ids.
- *hypothesis* The message boxes show at their screen files' own layout (the sign's measured), one character a frame;
  a typed page shows the speaker's player badge (`P1b02` playing alone); a page tag (0.00) waits for A.

### DOOR's open tiles (`packages/sim/src/adventure/doorlook.ts`, apps/game `view.ts` patchArea)
**Confirmed** from main.dol (the tiles seen in the browser, not checked against a Dolphin frame): `DOOR` init
0x802C7CC8 keeps kind p & 0x7F (+0x234), side (p >> 7) & 31 (+0x238), width (p >> 12) & 31 (+0x23C); kind 0 starts in
state 0, the others in 1. Its update 0x802C59D8 (jump table 0x804A8E00, 15 states) runs the same case for states 0 and
3, the open ones: every tick it writes the door's open tiles into the base layer (0x8029DEBC and its 4- and 6-tile
siblings 0x8029DD50, 0x8029DB2C: the first at the anchor's tile, the next ones to the right on sides 0 and 1, down on
sides 2 and 3). Kinds 5-7 write nothing. By width:
- 0: table **0x8046D598**, u16 tile pairs, 16 bytes a kind (kinds 0-8) × 4 a side. Kinds 0 and 1: 342 343 / 350 351 /
  345 355 / 346 356 (sides 0-3, hex); kind 2 32A 32B / 338 339 / 32D 33D / 32E 33E; kinds 3 and 8: 3A2 3A3 / 3B0 3B1 /
  3A5 3B5 / 3A6 3B6; kinds 4-7: 38A 38B / 398 399 / 38D 39D / 38E 39E. (Shut, the stages' tiles there are 2E0 2E1,
  2F0 2F1, 3A8 3A9…: Lake Hylia's doors.)
- 1: table 0x8046D628, 4 tiles a side (32 bytes a kind, kinds 0-2): kinds 0 and 1 2FA 2FE 2FE 2FB / 2EA 2EE 2EE 2EB /
  2EC 2EF 2EF 2FC / 2ED 2FF 2FF 2FD; kind 2 the same from 2DA, 2CA, 2CC, 2CD.
- 2: table 0x8046D688, 6 tiles a side (48 bytes a kind, kinds 0-2): width 1's with four middle tiles (the Cave of No
  Return's doors).
- Kinds 2 and 4 of width 0, and kind 2 of width 1, also write a row one tile out from the wall (from the anchor + the
  side's offset, tables 0x8046D7E8 / 0x8046D7F8: x 0, 0, -16, 16; y 16, -16, 0, 0; along the wall as the base row) into
  the screen's **top layer**: the layer index is the actor's screen (+0x4: 0 the TV, 7 + sublayer a GBA area) + 1, or
  + 8 from screen 8 on, and `[[0x8053AB10]+0x20]+0x28 + 4·index` is that layer. Width 0, 2 tiles: 0x8046D718 (kind 2)
  33A 33B / 328 329 / 32C 33C / 32F 33F, 0x8046D728 (kind 4) 39A 39B / 388 389 / 38C 39C / 38F 39F; width 1, 4 tiles,
  kind 2 only: 0x8046D738 2D4 2D5 2D5 2D6 / 2C4 2C5 2C5 2C6 / 2C7 2C8 2C8 2C9 / 2D7 2D8 2D8 2D9. A cracked wall is a
  2×2 of tiles: the base pair opens the half on the room's side, the top row covers the other half (the doorway's
  lintel, drawn over the Links); the base layer keeps its cracked tiles under it. **Measured** in RAM
  (`w1-013-room5-tower.sav`, Hyrule Castle room 5's garden wall (80, 256), side 1, bombed): layer 0 (the TV's base)
  holds 338 339 at tiles (5, 16), (6, 16) and 320 321 above them; layer 1 (the TV's top layer: elsewhere the stage's
  group 2 tiles, 2A8 2A8 at (5, 14)) holds 328 329 at (5, 15), (6, 15). Drawn by `doorlook.ts` once a kind 2 or 4
  is opened (nothing opens a kind 4 in the sim, and World 1 has none; kind 4 isn't blocked either).
- The tiles are the same numbers in every stage's tileset. Their types (0x2A, 0x2B, 0x0C) aren't applied to the sim's
  collision (doors.ts keeps its own: doorWorld, openDoorTiles).

### The lifted grey stone (`STON`; apps/battle `entities.ts` B2.stone)
**Confirmed** from main.dol: the lift check 0x802A1050 takes tiles 0x5F, 0x68-0x6B, 0x70-0x73, 0x75, 0x82, 0x40-0x44
and 0xE5; 0x72 and 0x73 leave 0x7C and spawn `STON` (0x82 leaves 0x83 and spawns `STON` too; 0x5F leaves 0x83 and spawns
`YASI`; 0xE5 leaves 0x9D). `STON`'s draw 0x802D0E28 is enemy_both2_sob frame 41 with the palettes unmapped, its
alpha byte (+0x234) 255, or its carrier's while carried. The other tiles of the check are lifted elsewhere (not read).

