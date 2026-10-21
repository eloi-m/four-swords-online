# Measurements: Shadow Battle constants from main.dol (and the float-op audit)

Part of the measurements from the real game (index: [../measurements.md](../measurements.md)).

## Battle constants from main.dol
These were read statically from main.dol, before battle mode ran in Dolphin (it does now: "Battle mode in Dolphin"), with
`tools/dol` (`func`, `callers`, `xref`, `field`, `float`, `data`; G4SE01 rev 0). This is the list for the Dolphin
measurement pass: each item names the code or table, the value, how sure the reading is, and what a battle trace should
watch to confirm it. Confidence: **certain** = a constant on the code path a multiplayer match takes; *likely* = read
from the code, but which branch battle takes (or what a field means) is inferred; *guess* = a candidate only.
Addresses: Link fields are offsets in a Link actor (`[[0x8053AC90]+4+4·n]`, vtable 0x804A6F38); other actors are found
in RAM by their vtable (`node tools/dol/src/cli.ts live <mem1> <IDs>`, vtables below); the game state is
`[0x8053AAF8]`.

**How damage flows** (the frame of reference for everything below)
- The spawn function copies the actor's `enemyparam.csv` stats into it: life +0x108, **atcp +0x114**, atcn +0x118, dasu
  +0x18C, dstr +0x1A8, efsz +0xC0, voic +0x190. Actors hurt Links with **0x801F2B7C(actor, damage, skip player, hit
  type)** (damage −100 = its own +0x114): each Link whose body meets the actor's box (+0x60…+0x6C around +0xC, within
  32 px of height) goes to **0x80238548(player, damage, &source, hit type)**, then to the Link's hit method
  **0x802710C8**.
- Link on Link: **0x80232A0C** runs once a frame over every ordered pair: the attacker's sword box against the victim's
  body (0x80273E7C), then the victim's shield (0x80272224, given the attacker's facing, the one at the attack's start
  for the sword states: +0x3F0 when +0x458 = 1). A block pushes both apart; a hit calls 0x80238548(victim, **damage =
  attack power / 2** (power 1 → 1), source = the attacker, hit type 1), with **0 damage when [0x8053AAF8]+0x7F ≠ 0**.
- Game state: +0x7E = several players (0 alone; the player-count menus 0x803EC804 and 0x803FB6F4 set it), +0x7F =
  playing alone with a controller (the prompt 0x803DE05C; 1 in the Lake Hylia savestate). A lot of battle behaviour
  tests +0x7F == 0 (friendly fire, item timeouts, orb contents); Links hurting each other in battle means it's 0 there
  (*likely*). **Watch** +0x7E and +0x7F during a battle: 1 and 0 expected.
- The hit method 0x802710C8(link, target, damage, &source, type): no damage in some states (0x80240B5C), half with
  0x80241498; nothing while dying (states 51, 52); in multiplayer a hit of 4 or more makes the Link drop his item as an
  `LSTI` (0x8024E500) when a per-player setting (0x8050EC80, 200-byte records) allows it (*likely*); life (+0xBFC) −=
  damage (0x80236468 → 0x80270D34), ≤ 0 → state 51. Then by type the knockback velocity (+0x350, +0x354: the unit
  vector from the source, × speed) and the hop (+0x358), invincibility **+0x464 = 60** and state 15 (**certain**, the
  measured 60):

  | Hit type | Speed (px/frame) | Hop | Passed by |
  |---|---|---|---|
  | 1, 25, 28 | 1.5 | 3.0, or 4.0 above 4 damage | swords (Link on Link), SLR1, FBOB fire bars, BEEE bees, thrown GRAS/TUBO/CRTL, NIWA cuccos, PCDM seeds, ARRW |
  | 2, 23 | 3.0 | 3.0 / 4.0 alike | BBMB's box (1 damage) |
  | 3 | 6.0 | 3.0 / 4.0 alike | SLR1's other attack |
  | 4, 7 | 0.75 | 4.0 | THCL (a thrown Link), BLZ2 eternal flames, BLZE, ARRW, STON |
  | 5, 8 | 1.0 | 4.0 | HBMB's blast, NIWA |
  | 6, 9, 19 | 1.5 | 4.0 | EXPL, FLME fire-pit jets |
  | 26 | 0.5 | 2.0 | |
  | 20, 21, 11, 12 | none | | 20/21: the hammer's pound, state 64 (flattened) and +0xC9C = 300 / 600 (60 with the player manager's +0x6C or +0x6D); 11/12: state 12 |
  | 22 | none | | fire (FIRE: the Fire Rod's fireball and stream, a burning Link): +0x464 = 2, state 80 (burning, running 300 ticks); nothing on a Link already burning |
  | 18, 19 | life = 0 | | TUGF 40 (type 18: death, no invincibility), BBMB 32 (type 19) |
  | 27 | 6.0 | none | a Link-on-Link attack (0x80273FB8): state 16, +0xC9C = 300 |

  Types 0 and 17 only set +0x464 = 180. The measured Octorok rock (2 damage) is type 1: 1.5 and 3.0. The measured
  own-bomb blast (0.75, 4.0, 0 damage, alone) doesn't match HBMB's type 5 (1.0, 4.0): a friendly hit alone probably
  takes another path; **watch** a bomb blast on another Link in battle (+0x350/+0x354, +0x358).
- Pushes: +0x35C…+0x364 is a push velocity added to the position every frame, then × 0.95 (above 2.0 px/frame) or
  × 0.9 (× 0.6 in states 18, 21–24), zeroed under 0.2 (0x80287E90).

**Link on Link** (Link fields; the victim's +0xBFC is the life, 16 = 4 hearts)

| What | main.dol | Value | Confidence | Sim | Watch |
|---|---|---|---|---|---|
| Swing / stab damage | power +0xBF4 = 4, set by the sword state's entry 0x8027DEA0 (state 4) for attack kinds +0x45C 0–3; read by 0x8023B6CC → 0x802721A8 | 4 / 2 = **2** | measured ("Battle measurements: combat") | `SWORD_DAMAGE` 2 | attacker +0xBF4, +0x45C; victim +0xBFC |
| Lunge damage | same, +0x45C = 4 (the lunge, 4 px/frame) → +0xBF4 = 8 | **4** | measured ("Battle measurements: combat") | `LUNGE_DAMAGE` 4; live on its ticks 6–14 | as above |
| Spin damage | the spin's entry 0x8027BA2C, by spin kind +0x11AC: 1 (released charge, 0x80274CB8) 8, 2 (stick rotation, 0x80275D9C) 6, 3: 4, 4 (0x80275F88, 0x80281A90) 8 | charged spin **4**; the others 3, 2, 4 | measured (kind 1) | `SPIN_DAMAGE` 4 | +0x11AC, +0xBF4 |
| Held sword while charging | the charge state's entry 0x8027C4FC sets power 2 | 1 | measured ("Battle measurements: combat") | `CHARGE_DAMAGE` 1 | victim life while touched by a charging sword |
| Sword level | 0x802721A8: +2 power when +0xC18 (0x80241544) ≥ 2; power 4 when +0x492 = 1 | +1 damage | measured (level: a level-2 lunge took 5), *guess* (+0x492) | `SWORD_LEVEL_POWER` (battle swords are level 1) | +0xC18, +0x492 |
| Knockback | hit type 1 | 1.5 px/frame, hop 3.0 (4.0 above 4 damage) | measured | `KNOCK_DEFAULT`, `KNOCK_HARD`, `knockFor` | victim +0x350, +0x354, +0x358 |
| Invincibility | 0x80272038 | 60 frames | certain (= measured) | `INVINCIBLE_TICKS` | +0x464 |
| Shield block | 0x802336A8: attacker and victim both get a push of 2.0 px/frame apart (direction 0x80233BC4), no state change | 2.0 px/frame along the line, set again every frame the boxes meet, then the push decay | measured ("Battle measurements: combat") | `BLOCK_PUSH_SPEED`, `PUSH_DECAY`, `shieldBlocks` (by facing) | +0x35C/+0x360 of both, +0x1240 |
| Shield vs spin | the spin's entry sets +0x458 = 1, so 0x80272224 gets its starting facing | blocked | measured ("Battle measurements: combat") | `SHIELD_BLOCKS_SPIN` true | a spin into a shield |
| Friendly fire alone | +0x7F ≠ 0 → damage 0 | | certain | (battle only) | |
| Other attack boxes | 0x80273518 (0 damage, type 11), 0x802573E0 (box +0x590…, while +0xB38 ≥ 0 and +0xB68 = 1: 4 / 2 = 2, type 1), 0x80273FB8 (2, type 27), 0x80256F44 (the hammer's pound, box +0x5B0 while +0xB99: 2, type 20; charged 4, type 21) | | *likely* (read: the hammer, battle-combat.md "The Magic Hammer and the Fire Rod"); *guess* for the others | hammer.ts `HAMMER`, `poundHits`; the others not modelled | which item or move sets +0xB68 |

**Thrown things and shots**

| What | main.dol | Value | Confidence | Sim | Watch |
|---|---|---|---|---|---|
| Thrown Link (`THCL`, spawned at the throw by 0x802636D4, vtable 0x804A7C40) | 0x8029D4A8: rides with the thrown Link (+0x230), hits the first Link that is neither him nor the thrower (+0x110), then goes | atcp **2** (0 alone), type 4: 0.75 px/frame, hop 4.0; the thrown Link flies on | measured | `THROWN_LINK_DAMAGE` 2, `KNOCK_SLOW` | the Link hit: +0xBFC, +0x350 |
| Thrown bush / pot | GRAS 0x802CF8D8, TUBO 0x802D20CC: their atcp in multiplayer (0 alone), skip = the thrower (+0xC8), type 1 | 1 / 2 | certain | `THROWN_DAMAGE` | |
| Thrown orb | CRTL 0x803232B8 | 2, type 1 | certain | `THROWN_DAMAGE.orb` 2 | |
| A thrown Link's own landing, escape presses, hold time | not found | measured: no landing damage, no hold limit, free on the 17th direction press | measured | `THROWN_LAND_DAMAGE` 0, `ESCAPE_PRESSES` 17 | held: state 25 |
| Arrows (`ARRW`, 0x804A05E0) | the bow state 0x8025C894 counts +0x3FC while drawing (an effect at 48 frames) and spawns kind (params >> 8) & 15 = 0 after 48 frames, 1 before; 0x80165E84: kind 0 or 4 → 2 damage, type 0 (no knockback, +0x464 = 180), else 1, type 1 (0 alone) | a quick arrow 1, a drawn one 2 | measured (a drawn one: 2, 180 invincible, carried 13 frames; drawn at 48 on the counter, +2 a frame at level 2) | `ARROW_DAMAGE` 1, `PIN_DAMAGE` 2 (combat.ts `pinFighter`) | ARRW +0x94; the victim's +0xBFC, +0x464 |
| Seeds (`PCDM`, 0x804AB3A8) | the slingshot state 0x8025BEB0, same draw rule; 0x80324380: kind 0 → 1 damage, type 1; otherwise 0 damage, type 11 (state 12: a stun) | a quick seed stuns, a drawn one 1 | measured (the quick seed: state 12 for 90 frames, then 60 invincible; a drawn one 1) | `SEED_DAMAGE` 0, `STUN_TICKS`, `DRAWN_SEED_DAMAGE` 1 | PCDM +0x94; the victim's state |
| Boomerang (vtable 0x804A0738) | 0x80168C38: a Link it touches goes to state 66 (0x8025AA8C, its handle in +0x11F8), no damage call | 0 damage | measured (state 66, dragged 6 px/frame to 18 px from the thrower) | `BOOMERANG_DAMAGE` 0, `hookFighter` | the victim's +0x1240 = 66 |

**Hazards**

| What | main.dol | Value | Confidence | Sim | Watch |
|---|---|---|---|---|---|
| Fire-pit jets (`FLME`, vtable 0x804A0330) | init 0x8015EDF4 sets atcp **4** (kinds other than 4 and 5; the battle's are kind 1); update 0x8015DF7C attacks with it, type 9, while its size +0x260 > 0.7, in its direction's box from table 0x80466130 (× 1.5 for class (params >> 18) & 3 = 1; the arenas' four are class 0) | 4, 1.5 px/frame, hop 4.0 | certain | `JET_DAMAGE` 4, `JET_KNOCK` | FLME +0x114 = 4 |
| Eternal flames (`BLZ2`, 0x804A9D28) | init 0x802E57E0 sets atcp **1**; 0x802E5080 / 0x802E5678 attack with it, type 7 | 1, 0.75 px/frame, hop 4.0 | measured (battle-combat.md "Bombs, the eternal flames and the soldiers, traced") | `FLAME_DAMAGE` 1, `FLAME_KNOCK` | BLZ2 +0x114 = 1 |
| Fire bars (`FBOB`, 0x804A4038) | init 0x801BDA40 sets atcp 2; 0x801BD9D0 attacks with type 1 | 2, 1.5, hop 3.0 | certain | `FIREBAR_DAMAGE` 2 | |
| Fire-bar speed (`FBMR`, 0x804A3F90) | init 0x801BD348: +0x2F8 = 128 / 256 / 64 angle units a frame by (params >> 24) & 3 (2 in battle) | 64 (a turn in 1024 frames) | certain | `FIREBAR_SPEEDS` | FBMR +0x2F8, the balls' positions |
| Trick floor (`TFLR`, 0x804A83A0) | update 0x802ADC18 (docs/formats/battle-arenas.md "Switches") | 8 / 40 / 41 frames, ±20 px | certain | hazards.ts | its 16 tiles' types |
| Bees (`BEEE`, 0x804AC600) | 0x80344144: 0x801F2B7C(**1**, type 1). A swarm of 7 (positions +0x2A4…, speeds +0x278 = 2.0–3.0 from its init 0x803450AC, then the first bee's 1.5–2.0); kind +0x270 = params & 1: kind 0 (The Field's) wakes when a Link with an impact flag (0x8023A51C → 0x8026FCE0: +0xB9A the hammer's pound, +0xB9C a Pegasus Boots crash, traced) comes within 80 px (6400 = 80²), timer +0x238 = 60; kind 1 within 64 px, 120; on waking, the other six bees' points in a second array (+0x2F8…, 12 bytes each) are set 3 px around the first's, a sixth of a turn apart (a placement, not a speed: re-read after the float-op fix) | damage 1 | certain (damage), *likely* (the rest) | `BEE_DAMAGE` 1; flight TODO | BEEE +0x230 state, +0x238, the 7 positions |
| Soldiers (`SLR1`) | 0x80150284: −100 (its atcp 2), type 1; and a type-3 attack (6.0 px/frame) | 2 | certain | `SOLDIER_DAMAGE` 2 | |
| Ball-and-chain soldier (`SLR3`, vtable 0x804A0810; Hyrule Castle's GEN3 0x15 at (400, 224), switch 10, params 0 = kind 0) | init 0x80171AF8: life from enemyparam.csv **32** (16 when 0x802DE814 says alone in some stages, 24 in world 0 stage 3: not battle, *likely*), swing speed +0x250 = **400** angle units a tick (kind 0), chain length +0x284 → target +0x288 = **70**, the ball an SLR3 of kind 5 (+0x26C). Update 0x80170450: the ball (kind 5: life 10000) hurts with 0x801F2B7C(**2**, type **3**); the soldier's body −100 (its atcp **2**), type 1; ball = hand (table 0x804A07F8 by walk frame +0x258: (−8, 1), (−9, 2), (−9, 4)) + length × (cos, sin)(+0x24C), z 16; the angle += speed every tick; the length eases 0.7, ≤ 3.0 a tick (0x801F71A4). It walks at the nearest Link (0x801EEC98, no range: any eligible Link on its screen) at 0.3 px/frame (+0x280), its velocity +0x3C easing 0.3, ≤ 1.0 a frame; none → state 4: ball reeled in (target 10), standing. Struck (0x801F2FAC → 0x801F37AC: +16 px/frame away, the per-Link mask +0xD5): target 10 and +0x240 = 30 ticks, then 70 again; kind 0 swings × 1.9 while +0x264 < 2 (400, 760, 1444). A Link's sword meeting the ball (0x801F285C, then 0x80237948 → 0x80271068): a 0-damage hit of type 14 from the ball (pushed 2.0 px/frame away; state 8 → 55, the recoil; else state 2), effects 279, 280, a clank. Draw 0x80170008: gc 127 + walk frame (1, 2, 1, 0 for 2, 10, 10, 10 frames: 0x804A07D8, 0x804A07E8), ten chain links gc 131 at 0.7 a tenth apart from the hand, the ball gc 130 × 1.5 (+0x27C), turning 0.2 rad a frame (+0x278) | life 32; ball 2 (6 px/frame knock), body 2 | *likely* (read statically, not traced) | castlesoldiers.ts `BALL_SOLDIER`, `BALL_KNOCK`; assumed (TODO(measure)): one hit per 30-tick reel-in (not the per-Link mask), the clank cancels that Link's strikes that tick, any sword action clanks, the ball's spin direction | the soldier's +0x108, +0x24C, +0x250, +0x284; the Link's +0x350 after a ball hit |
| Cuccos (`NIWA`, from orbs) | 0x80330868: hurts its target by 4 (kind +0x290 = 2) or 2, type 1, and carries back min(the target's life, that) (+0x298); its heading +0x29C steps ≤ 0x1000 toward the goal +0x29E every 2 + rand(8) ticks (+0x238), its velocity easing 0.3 (≤ 1.0 a tick) to 3.0 along it | 1 or ½ heart | measured (kind 2: 4, carried back to the thrower, up to 16) | cucco.ts `CUCCO_STEAL` 4 | NIWA +0x290, +0x298 |

**Orbs and items** (the sim's orbs.ts follows this)

| What | main.dol | Value | Confidence | Watch |
|---|---|---|---|---|
| Generator timing (`CRGN`, 0x8049E5B8) | init 0x801296FC: kind +0x234 = params & 15, counter +0x238 = **150**; update 0x80129598: counts only while its switch (params >> 27) is on; at 600 (300 for kind 2) it spawns (0x80129200), then watches what it made (handle +0x23C) while that's a `CRTL`, `LSTI` or `NNJN`, and counts again from 0 | first after **450** (kind 2: 150), then 600 / 300 after it's gone | certain | CRGN +0x230 (0 watching, 1 counting), +0x238, +0x23C |
| What it makes | 0x80129200: kind 1 (and ≥ 4) a `CRTL` crystal ball, params 0; 2 an `LSTI` item from the mask; 3 an `NNJN` carrot; 0 a `CRTL` holding the mask's items (+0x280); 15 a random kind k among the params bits 16 + k set (1 if none) | battle rooms use 1 and 2 | certain | |
| Item masks | params bit 5 + k (table 0x80465000) → item 0x80465058[k] = 10 slingshot, 3 boomerang, 4 bow, 8 bombs, 6 Fire Rod, 5 hammer, 7 Roc's Feather, 1 Pegasus Boots, 9 shovel, 2 lamp, 11 the Four Sword (and CRTL param bit 0x8046502C[k]); an empty mask: the slingshot | 0x1E2 slingshot, boomerang, bow, bombs (Tower of Flames, Above the Clouds); 0x8A2 slingshot, bow, Roc's Feather (Tower of Winds); 0x1182 bow, bombs, boots (The Field); 0x9E2 the 0x1E2 four + Roc's Feather (Dark Clouds); 0x97E2 + Fire Rod, hammer, boots, the Four Sword (Hyrule Castle, whose generators are all in GBA rooms) | certain | the `LSTI` +0x238 item |
| Item level | 0x80129444: level 2 (params 0x800000) when a random 0…1 is ≥ 0.8 (20 %) unless it's the lamp; the Four Sword always 2; else 1 (0x400000) | measured: level 1 for 12 of 13 generator items; applied (orbs.ts `LEVEL2_ODDS`) | certain (re-read: the old "80 % level 2" had the branch the wrong way round) | LSTI +0x23C; the Link's +0xC14 after taking it |
| Items on the ground (`LSTI`, 0x804A8C80) | init 0x802C0F20: item +0x238 = params & 0x7F, level +0x23C = (params >> 22) & 31, mode +0x234 = (params >> 7) & 31; in multiplayer lifetime +0x254 = 180 (mode 0) or **600** (the generators' and crystals' 0x180 → mode 3), its alpha +0x24C pulsing while ≤ 120 | 600, blinking the last 120 | certain | LSTI +0x254 |
| Orb content (`CRTL`, 0x804AB308) | 0x80322F44 picks the roulette table +0x288: 0 alone, 1–3 by Force Gem rank when +0x7F = 1, **4 in multiplayer**, 5 for CRTL params (p >> 8) & 15 ≠ 0; table 0x80471784 + 28 × table, 7 entries; the content is entry +0x2B4, uniform 0–6; contents: 2 carrot (NNJN), 3 cucco (NIWA 50 + 256 × player, icon 147), 4 cuccos (NIWA 3, icon 154), 5 bombchus (BMTY, icon 149), 6 Force Gem (RUPY), 7 heart (BHRT), 8 cucco (NIWA 56, icon 148); table 4 = 2, 3, 5, 3, 5, 3, 5 | carrot 1/7, cucco 3/7, bombchus 3/7 | certain (code), *likely* (table 4 in battle) | CRTL +0x288 = 4, +0x294, +0x2B4 |
| The roulette | starts when a Link can lift it (0x8022F9E4 → 0x80322F44; state 2): 20 frames of "?" (+0x260), then 40 + rand(7) steps (+0x24C) of 5 frames, the last 5 slowing to 10, 15 … 30 frames (0x80471760 by 6 − the steps left; measured, below); idle, it blinks green/red "?" every 10 frames (icons 144/145) | | measured | CRTL +0x230, +0x264 shown content |
| Orb lifetime | CRTL init +0x278 = **900**, −1 a frame while idle (state 0) in multiplayer, then it's deleted | 900 | certain | CRTL +0x278 |
| Carrot (`NNJN`) | 0x803471A0: +0x24C = 720 when a Link takes it, counting down while +0x271 = 1 | Epona 12 s? | measured: +0x24C counts down from 1024 while it lies there; taken by touch, the ride (state 11) lasts 360 frames | NNJN +0x24C; the rider's state |

**Rounds, time-up, camera**

| What | main.dol | Value | Confidence | Watch |
|---|---|---|---|---|
| Time-up (`TUGF` "TimeUp Gufuu", vtable 0x804ACCC0) | the stage timer 0x802D3A18 (counter +0xC4, when stage byte +0x31F0 = 1; warnings at 1800, 660, 300…0) spawns TUGF in multiplayer (TUTM alone); TUGF 0x80354030: pause, 60 frames; 60 frames of fading; 300 frames; flies at 6 px/frame; then hits every Link for 40, type 18 (death) | | measured in battle (the Vaati rule sets the stage byte; below): 60 frames in, a 300-frame loop and on, everyone out 454 frames after the time-out | TUGF's +0x2B8 state, +0x2C0 timer |
| Giant bomb (`BBMB`, 0x804AC588) | spawned by BBSL (0x803413D0, 0x80341604) and IMUP (0x8015B49C); init 0x803435F8, update 0x80342850 (states: 0 grows 0.75/80 a frame to 0.75, 1 waits 8, 4 up at 3.0 falling 0.2/frame² to its own z 0, 5 squashes 15, 6 burns 600 with a ±24 px solid box, each hit −60 then 15 frames deaf, 7 the blast 0x8034335C); its box hurts for 1 (type 2) falling and squashing; the blast: every Link on the TV life 0 (type 19, no distance; spared: one going through a warp, one held, those in side rooms), effects 51–56, quake 16 | measured (switch 21 poked on): both Links on the TV out 1021 frames after the switch | certain (code), measured | BBMB +0x230, +0x234, the Links' life |
| Giant-bomb Shadow Link (`BBSL`, Tower of Winds TV (256, 128), params 0xAA000000) | init 0x803418B8 (+4 px y on a side-view screen), update 0x803410DC, state table 0x804AC524: 0 waits for switch 21, 1, 2 unseen 60, 3 sparkles 115 (JPA 1048–1050), 4 rises 32 (z +3.0, −0.1 a frame), 5 hovers 60, 6 holds the bomb 80 (spawned at z + 24), 7 throws 60, 8 fades 10, 9 away while his bomb lasts, 10 waits 300 then for the switch, 11 fades back in 60 and holds a new bomb; no hit, box or damage of his own; the camera frames (x, y − z) in states 2–8 and 11 | measured: at (256, 132), the bomb thrown and burning on the middle ledge as read (frame dumps) | certain (code), measured | BBSL +0x230, +0x234 |
| Bombchu (`BMTY`, init 0x803264C0, update 0x80325A30) | params & 15 = kind (3 ±2.5 px/frame along x, 4 2.5 at a random angle, 1/2 from a broken orb); life, atcp 2; fuse +0x23C 300, not counting while held; +0x248 30 frames harmless out of a hand (10 in side view); armed and on the ground, its ±8 px box hurts Links for 2 (type 1: 1.5 px/frame knockback, hop 3.0) and it runs on; straight lines bouncing off walls and plain pits (crossing lava and deep water), an orb's first one turning ×0.7 at its first wall; in side view it crawls round surfaces (+0x276, +0x27C its turn); set off by its fuse, a sword or an attack box registered before it; the blast ±16 px, 2 (type 1) each of its 32 frames, effects 89–91 as a bomb's; GEN3 0x17 → kind 4, 0x18 → kind 3, at most 30 | measured: eight from the Tower of Flames' GEN3s (switch 30), 2.5 px/frame, 299 on their first frame, gone after 71–332 frames | certain (code), measured | BMTY +0x23C, +0x248, position |
| Round end (`BFIN`, 0x804B0380) | PTMF table 0x804B032C (filled by 0x803D6DC0); states 4 and 5 wait 130 frames each (+0x23C), a BGM command 45 between | measured: state 1 137 frames after the knockout, then 2 (130), 3 (25), 5 (130), and 6 waits for A | measured | BFIN +0x230, +0x23C |
| Camera zoom | 0x8030E154: zoom +0x858 = the frame buffer width / the view's width; the view size (+0x1D4, +0x1D8) eases 0.1 of the way, ±3 px a frame, toward the mode's entry in 0x804AA8E8 (7 × 9 fields; mode +0x174 = 1 in multiplayer, 3 with +0x179): mode 1 = 86, 130, 32, 3, 3, 128, 60, 0.1; single player 104, 142 (Lake Hylia's 284-px view) | measured (below): +0x1D4/+0x1D8 hold 86 and 130, not the view; 86 is the margin, 3 the box's largest step, 128 its slack, 60 its hold, 0.1 the ease | measured | [0x8053AB10]+0x24: +0x174, +0x1D4, +0x1D8, +0x858 |
| Countdown, pit damage, respawn invincibility | not found (0x8027057C, the adventure's revive, sets +0x464 = 180) | measured: the first round plays 409 frames after the arena shows; a pit costs 2 life, then 180 invincibility frames | measured | what the countdown shows, later rounds' wait |

### Audit after the float-op disassembler fix (2026-10)
Until 384f9d6, `tools/dol` printed A-form float ops wrong: `fmul(s)` showed frB (usually f0) instead of frC, the
multiply-adds (`fmadd`, `fmsub`, `fnmadd`, `fnmsub`, `s` forms) and `fsel` dropped frC; it also gave `ps_mul(s0/1)` a
spurious frB, `fres`/`frsqrte`, `fneg`/`fmr`/`fctiwz`… a spurious frA, and printed `lfsx`'s float register as an `r`.
All fixed (printed text only; the analysis' register tracking never used those operands). Every main.dol function the
docs and the sim/app comments cite was listed with its A-form lines; those whose documented value comes out of float
arithmetic were re-read with the fixed decoder. Trace = a Dolphin RAM measurement (the replayed fixtures
`dolphin-battle-traces.json` / `dolphin-traces.json`, or "Battle measurements" here), which wins over a reading.

| Reading | Code | Outcome |
|---|---|---|
| Knockback speeds and hops by hit type (1.5/3.0/6.0/0.75/1.0/0.5; hop 3.0/4.0/2.0) | 0x802710C8 | unchanged (the unit vector × an `lfs` constant through `ps_muls0`, which printed right); types 1, 4 and 9 confirmed by trace |
| Push decay × 0.95 above 2 px/frame, × 0.9, × 0.6 in states 18, 21–24, zeroed under 0.2 | 0x80287E90 | unchanged; confirmed by trace (shield-block pushes) |
| Shield-block push 2.0 px/frame | 0x80232A0C (0x802336A8) | unchanged; confirmed by trace |
| Camera ease 0.1, step 3, slack 128, hold 60 | 0x8030E154, table 0x804AA8E8 | not re-derived from code: confirmed by trace (camera.ts) |
| FLME size easing 1/10, burns above 0.7, shown from 0.1 | 0x8015DF7C | unchanged; size confirmed by trace (+0x260) |
| FLME burning box (table 0x80466130, 90 × 20 px) | 0x8015DF7C | **changed (doc)**: × 1.5 when (params >> 18) & 3 = 1 (old print `fmuls f0, f0, f0`); the arenas' four jets are class 0, so the sim's box stands |
| BEEE speeds and wake | init 0x803450AC, update 0x80343D90 | **changed (doc)**: speeds 2.0–3.0, then the first bee's 1.5–2.0 (a dropped `fmadds` operand); "fan out at 3 px/frame" was a one-time ring of the other six points 3 px around the first's; wake radii 80² / 64² unchanged. Flight not modelled (sim unaffected) |
| Item level odds | 0x80129200 (0x80129444) | **changed (doc)**: level 2 when rand ≥ 0.8, i.e. 20 % (not the float bug: the branch had been read backwards); matches the measured 12 of 13 at level 1 |
| Shadow opacity max(79, 159 − z/2) (Link), max(159, 223 − z/2) (actors) | 0x80264998, 0x801EF830 | unchanged (`fnmsubs` with its dropped frC = z) |
| Height scale 192 / (192 − min(z, 96)) | 0x802F5040 | unchanged (the `fmuls` by f12 printed as f0) |
| Environment model origin c·(1 − p) + 512·trunc(c·p/512) + 256, ±1536 | 0x8016A7DC | unchanged |
| Cloud-shadow texture coordinates (x/512 − (f & 0x7FF)/2048…) | 0x8016ADE0 | unchanged; also fitted to a Dolphin frame |
| Backdrop a, k, c (Tower of Winds sky and wall; Above the Clouds' far land, shadows, low and high clouds) | 0x8016B4D4, 0x8016B910 | unchanged, all six rows re-derived |
| Effect dynamics scale (s, 0.707s, 0.707s), FLME effect scale 1 + class/2 | 0x8013CC50, 0x8015DF7C | already corrected by RAM (384f9d6) |
| Effect rotation R = Rz·Ry·Rx | 0x800EF008 | unchanged; confirmed by RAM |
| JPA emission: rate × (1 + random × (2r − 1)) accumulated | 0x800EB008 | unchanged |
| Stage actor positions 8 × (x, y) + the room | 0x802D8328 | unchanged |
| Walk ×0.5 vertical on tiles 0x2C–0x2F, ×1.4 both axes in state 5 | 0x802808E8 | factors now written down (the walk itself confirmed by trace) |
| HUD fade step 0.1 toward 1.0 / 0.6 / 0, alpha × factor | 0x80424148 | unchanged |
| Time-up 6 px/frame, fire-bar 64 units and 16-px rings | 0x80354030, 0x801BD348 | unchanged; confirmed by trace |
| Light radius easing toward 85, light and flame radii, LTEV tints, roulette, CRGN timers | 0x802580E0, 0x802E4E6C, 0x8015DE10, 0x802EFBFC, 0x80322F44, 0x80129598 | no A-form op on the value's path (the roulette's `fmuls` by 7.0 printed right: frB = frC = f0) |

The integer readings (damages, atcp, timers, hit types, tables, switch kinds) don't go through float ops. No sim or
app constant changed, so `ONLINE_VERSION` stays.
