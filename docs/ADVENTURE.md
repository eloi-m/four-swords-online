# The Hyrulean Adventure beyond Lake Hylia: survey and plan

Shadow Battle is the project's goal; this is the plan for growing the adventure (`apps/game`, the site's
`/adventure/`) as far as it reasonably goes, and its status. Numbers come from `node tools/census/src/adventure.ts
[--types] [--enemies]` (every `bin/` actor list of the 32 adventure stages; its output stays local because it names the
game's types and messages) and from main.dol and Dolphin as marked.

## The stages
`Boss/boss0WS.arc`, W = level 1–8, S = 0–3. Their names are the game's own: msgus.arc `_e.bmg` messages 1–32 in that
order (message 1 + 4 (W − 1) + S; the Tingle's Tower bonus stages sit where the level's map puts them, which is why S
isn't the in-game stage number), and the level names follow (0x2D–0x34: "Whereabouts of the Wind", "Eastern Hyrule",
"Death Mountain", "Near the Fields", "The Dark World", "The Desert of Doubt", "Frozen Hyrule", "Realm of the
Heavens"). The order is confirmed where a tileset settles it: boss033 Tower of Flames, boss043 Hyrule Castle
Infiltration and boss073 Tower of Winds share their tilesets with the battle arenas of those names.

| Stage | Name | Rooms | Tileset | Overlay | BGM id | Start cell → room | TV actors | GBA-area actors | Enemy types placed (`dstr` 1 in enemyparam.csv; * = drawn today, animated or static) |
|---|---|---|---|---|---|---|---|---|---|
| boss010 | Lake Hylia | 11 | 12 | 1 | 2 | (5,4) → 0 | 234 | 124 | OKTA* PUKU* ZASL* SLR1* SLR4* ZORA* |
| boss011 | Cave of No Return | 12 | 1 | 2 | 7 | (2,6) → 12 | 478 | 128 | MOZO* KETH* SLK2 NZMI* |
| boss012 | Tingle's Tower | 12 | 22 | 1 | 2 | (5,0) → 11 | 82 | 48 | ZORA* KETH* PUKU* |
| boss013 | Hyrule Castle | 13 | 2 | 2 | 0 | (1,7) → 0 | 422 | 126 | SLR2 SLR1* SLR4* KETH* SLR3 AMOS* FGAN |
| boss020 | The Coast | 12 | 11 | 1 | 2 | (0,1) → 9 | 292 | 153 | PEAC* ZORA* OKTA* KETH* PUKU* SLR1* TTAT |
| boss021 | Village of the Blue Maiden | 10 | 13 | 1 | 38 | (1,3) → 0 | 288 | 186 | SLK2 |
| boss022 | Tingle's Tower | 16 | 26 | 1 | 3 | (0,8) → 0 | 169 | 62 | PEAC* PAME* BZBR* STAL* SLR2 SLR3 SLR4* SLR1* MOZO* |
| boss023 | Eastern Temple | 18 | 0 | 2 | 1 | (2,9) → 17 | 519 | 126 | KETH* ROPE* STAL* WIZR* NZMI* BWRT |
| boss030 | Death Mountain Foothills | 13 | 25 | 1 | 0 | (0,8) → 0 | 280 | 129 | SLR1* SLR2 KETH* DDRK BZBR* HINO* SLR4* |
| boss031 | The Mountain Path | 15 | 14 | 1 | 10 | (0,8) → 14 | 573 | 170 | KETH* TNDR SLK2 TKTA* GROK |
| boss032 | Tingle's Tower | 11 | 14 | 1 | 10 | (0,5) → 0 | 142 | 61 | DDRK GROK PAME* TKTA* |
| boss033 | Tower of Flames | 18 | 3 | 2 | 6 | (1,9) → 15 | 670 | 81 | Poon AMOS* SLR3 SLK2 DDGO GROK |
| boss040 | The Field | 32 | 26 | 1 | 3 | (0,9) → 26 | 478 | 199 | GOMA KETH* SLR1* SLR4* SLR2 SLR3 |
| boss041 | Tingle's Tower | 14 | 16 | 8 | 8 | (4,9) → 0 | 346 | 289 | OKTA* KETH* TNDR SLR1* SLR2 SLR4* PUKU* HBB2 POOH* STAL* |
| boss042 | The Swamp | 8 | 16 | 7 | 8 | (0,5) → 0 | 213 | 119 | POOH* STAL* KETH* |
| boss043 | Hyrule Castle Infiltration | 16 | 4 | 2 | 9 | (3,6) → 1 | 909 | 124 | KETH* POOH* STAL* BPH2 |
| boss050 | Lost Woods | 23 | 17 | 5 | 10 | (4,2) → 9 | 241 | 100 | BZBR* KETH* HBB2 GOMA |
| boss051 | Four Who Descend into Darkness | 19 | 18 | 2 | 10 | (1,4) → 0 | 459 | 182 | KETH* SLK2 TKTA* ZORA* PUKU* SLR4* |
| boss052 | Tingle's Tower | 17 | 24 | 1 | 9 | (0,0) → 0 | 235 | 114 | TKTA* ZORA* TNDR PUKU* SLR1* SLR2 SLR4* |
| boss053 | Temple of Darkness | 21 | 5 | 2 | 1 | (2,7) → 15 | 828 | 81 | POPO STAL* SLR3 Poon KETH* SLR4* WIZR* NZMI* FGN2 PAME* MOZO* |
| boss060 | Desert of Doubt | 14 | 19 | 4 | 9 | (1,6) → 12 | 481 | 262 | RIVR GDMN RUSA KETH* MIRA TKTA* TNDR PUKU* SLK2 SLR4* |
| boss061 | Desert Temple | 17 | 6 | 2 | 1 | (4,7) → 26 | 509 | 123 | EGOL AMOS* DGT2 RUSA GDMN GOMA SLK2 |
| boss062 | Tingle's Tower | 16 | 19 | 4 | 9 | (2,8) → 0 | 974 | 37 | PEAC* |
| boss063 | Pyramid | 19 | 7 | 4 | 1 | (2,9) → 22 | 426 | 154 | MIRA KETH* STAL* ROPE* DGT2 MOZO* DGTL BPH2 |
| boss070 | Frozen Hyrule | 21 | 20 | 6 | 11 | (2,9) → 0 | 676 | 157 | SLR1* SLR2 SLR4* PAME* PUKU* FAGN WIZR* TTAT POOH* STAL* |
| boss071 | The Ice Temple | 24 | 8 | 3 | 1 | (4,9) → 21 | 709 | 22 | KETH* AMOS* WIZR* FAGN SLR1* SLK2 SLR3 |
| boss072 | Tingle's Tower | 15 | 20 | 6 | 11 | (1,5) → 0 | 231 | 98 | SLR1* POOH* AMOS* STAL* WIZR* HINO* |
| boss073 | Tower of Winds | 13 | 9 | 2 | 12 | (2,9) → 13 | 447 | 207 | ZASL* KETH* ICHL BOIC |
| boss080 | Realm of the Heavens | 15 | 21 | 9 | 13 | (0,4) → 0 | 692 | 29 | SLR1* SLR4* SLR3 SLR2 TTAT TKTA* DDGO |
| boss081 | Tingle's Tower | 25 | 27 | 9 | 13 | (0,9) → 0 | 3642 | 98 | TNDR KETH* SLR1* WIZR* SLR2 SLR4* SLK2 |
| boss082 | Cloud Citadel | 11 | 21 | 9 | 12 | (0,3) → 0 | 252 | 100 | SLR4* SLR1* SLR2 NZMI* SLK2 BZBR* ROPE* TKTA* |
| boss083 | The Seal | 26 | 10 | 2 | 14 | (3,9) → 24 | 932 | 168 | SLR3 STAL* SLR1* GOMA ZLD2 GNON AMOS* HINO* KETH* |

527 rooms, 17,829 TV actors and 4,057 in GBA-screen areas (houses, caves; in single player they show on the TV), 252
types. Bosses live in their own folders (`ganon/`, `grock/`…) and stage rooms, not surveyed here.

### Actor types by use (all 32 stages)
- **Stage machinery** (no look of their own, or a tile): `PNPC` panel rewriting (5,699), `FLYK` falling floor
  (1,845), `WARP` doors, stairs, holes (1,810), `TRCH` torches (723), `SWTH` floor switches (613), `RAIL` rail data
  (516), `TKRA` chests (455), `SWEV`/`SEV2`/`LTEV` environment (575/122/160), `PONT` point checks (349), `DOOR` (307),
  `BGMN` music changes (248), `FOCS` camera focus (218), `SWNP`, `SHTR` shutters (196), `ONOF` crystals (183), `SWT4`
  (165), `GEN3` enemy generators (156), `LWSW` candle switches (117), `WTSW`, `BTIN`, `ZNSW` "all enemies beaten"
  switches (97), `PTMI`/`TOMI` invisible walls, `RYRN` Force Gem rain, `SKIL`, `CKSW`, `OFFS`, `TINB`, `GENE`
  generators.
- **Force Gems and pickups**: `RUPY` Force Gems (876), `HNRY` hovering gems (173), `WDRY` wooden gems (162), `BRRY`
  buried gems (57), `ESRY` fleeing gems, `KEY0` keys (27), `HART` small hearts, `GOL2` goals (one per stage, 32) and
  `GOAL`, `LSTI` items.
- **Enemies placed** (count, stages): `SLR1` sword soldier 210/15, `KETH` Keese 177/20, `SLR2` bow soldier 156/10,
  `POOH` Poe 139/5, `BZBR` Buzz Blob 102/4, `MOZO` 93/4, `PAME` shelled beetle 65/4, `PEAC` 62/3, `STAL` Stalfos 58/10, `OKTA`
  Octorok 57/3, `NZMI` rat 57/4, `AMOS` Armos 57/6, `POPO` 51/1, `DDRK` Deadrock 43/2, `TKTA` Tektite 43/7, `PUKU`
  39/8 (GBA areas), `ROPE` snake 36/3, `ZORA` 35/5, `SLK2` Shadow Link 29/10, `TNDR` 23/5, `Poon` 23/2, `SLR4` 21/14,
  `HINO` Hinox 20/3, `WIZR` Wizzrobe 18/6, `GROK`, `GOMA`, `SLR3` 12/8, `ZASL` Zol 6/2, … Many more come out of
  generators (`GEN3`, `GENE`) at run time. Minor Shadow Links (`ZSLJ`, `ZSLH`, `ZSLD`, `ZSLF`) are props of their own.
- **NPCs and signs**: `JIJI` villagers (193), `KNBN` signs (48), `NAVI`, `SNPC`, `KEPO` the owl, `FGAL` the girls,
  `BFRY` Great Fairies, `FARY` fairies.
- **Drawn today** (packages/formats `actorgraphics.ts`, from main.dol): 34 of the adventure's types have a sprite (the
  Lake Hylia and Shadow Battle ones), 50 more are known to draw nothing or a tile; the other ~170 show nothing (a
  marker in the viewer). apps/game also draws the enemies it animates (`ROPE`, `PAME`, `HINO`, `WIZR`… from their own
  draw methods: apps/game `enemies.ts`).

## What existed before this work
- `apps/game`: Lake Hylia only (`boss010` hard-coded), one Link walking with the game's collision, the sword (swing,
  stab, lunge, charge, spin), room changes left/right measured (up/down by hypothesis), the camera clamped per room with
  the measured pan. No actors drawn, no HUD, no enemies, no items.
- `packages/sim`: the adventure-mode measurements (walking, sword, lift/throw, roll, items, knockback, Octorok damage)
  live in the battle code: `carry.ts`, `roll.ts`, `items.ts`, `bombs.ts`, `projectiles.ts`, `combat.ts` (knockback,
  pits, invincibility), the switch network (`switches.ts`), soldiers and bees (`hazards.ts`), all on a battle arena:
  one room at the origin, tiles indexed `ty * 32 + tx`.
- Missing: formation followers (the three other Links), push state, surfaces (water, ice, quicksand, ladders), held
  sword hitting walls, any enemy AI, Force Gems, chests, doors, keys, warps, messages, the adventure HUD.

## Design: the current room is an arena
The battle code already simulates one room at the origin with its bushes, pots, switches, bombs, shots, soldiers and
hazards. The adventure reuses it as is: `packages/sim/src/adventure/` keeps the stage-level state (which room, the
Force Gems, keys, what was collected or opened, the enemies) and simulates **the current room as a battle arena**
(`GameState.battle` built from that room's actors and tiles, `buildArenaWorld`), in room-local coordinates. A room
change carries the Links over (their positions shifted by a room), rebuilds the arena from the new room and plays the
measured auto-walk; the renderer places the room's things at its world origin. So lifting, throwing, cutting bushes,
bombs, items, switches, the switch logic actors (`SWOR`, `SWT4`, `CHSW`, `WTSW`, `GEN3`…), soldiers and bees work in
every adventure room without new code, and battle files aren't touched. Enemies (new) are the adventure's own records,
hit by the same sword boxes (`attacks.ts`) and hurting Links through `combat.ts` `hurtFighter`. Everything stays plain
data, deterministic and serializable (`hashGame` covers it), so the adventure could go online later.

## Plan (milestones in order of "playable adventure" per effort)
- **M1 any stage loadable and walkable.** `#stage=boss0WS` and a stage select (the game's stage names), the start room
  from the CSV and the Links on its `PLAS` starts, room changes across the 10×10 grid on all four sides (the vertical
  one traced), `WARP`s between rooms and into GBA-screen areas (decoded in Dolphin), the stage's tileset, overlay,
  animated tiles and every mapped actor as a static sprite, the room's battle-arena props live (bushes, pots,
  switches…).
- **M2 enemies.** A small enemy framework (life from enemyparam.csv `life`, contact damage from `atcp`, sword damage,
  knockback, invincibility, death puff, drops), then behaviors from main.dol + Dolphin traces, the most frequent first:
  Octorok (Lake Hylia's, traced), Zol, Keese, soldiers (the battle's SLR1 chase), Poe, Stalfos, Tektite.
- **M3 world interactions.** Force Gems (`RUPY`, `HNRY`, values from main.dol) with the counter on the game's adventure
  HUD (`main_adv.blo`: hearts, gems), chests (`TKRA`), keys and locked doors, small hearts, the goal (`GOL2`) with the
  Force Gem quota.
- **M4 the four-Link formation.** The followers walking the leader's trail (traced: 18 px apart), switching leader,
  formations, carrying them through room changes.
- **M5 one complete stage.** Lake Hylia 1-1 from its start to `GOL2`: what blocks it is listed under Status.
- **Later.** Bosses, NPC dialogue with the BMG messages (`hukidashi.blo`, signs), the remaining enemies, surfaces
  (water, ice, quicksand), the push state, music.

## Status
Code: `packages/sim/src/adventure/` (`@fso/sim/adventure`: `stage.ts` the stage and its areas, `adventure.ts` the
state and the step, `formation.ts` (the trail and the C stick's formations), `push.ts`, `motion.ts` (what a Link does
besides walking, and its sprite), `swim.ts`, `ledge.ts`, `sideview.ts` (side-view areas: falls, ladders, swimming),
`cannon.ts`, `rocks.ts` (the boulder and blocks pushed, two-Link rocks lifted, the raft), `gear.ts` (items: pedestals, the
boomerang's fetch, the Fire Rod and stumps), `enemies.ts` (and `foes.ts`, `soldiers.ts`, `walkers.ts`, `waterfoes.ts`,
`hinox.ts`, `wizzrobe.ts`), `generators.ts`, `pickups.ts`,
`logic.ts`, `doors.ts`, `chests.ts`; `drive.ts`, a scripted player (goals: walk or travel round walls, hold, press,
fight, wait) and `lakehylia.ts`, Lake Hylia's route for it) and `apps/game` (`view.ts`, `enemies.ts`, `hud.ts`, `gbawindow.ts`, `stages.ts`). Tests:
`adventure.realdisc.test.ts` (every stage loads and runs; the Dolphin traces replay; determinism through clones),
`motion.realdisc.test.ts` (swimming, ledges and the boulder against Dolphin traces), `lakehylia.realdisc.test.ts` (the
route to the goal, milestone by milestone, and replayed on a clone), `apart.realdisc.test.ts` (room 58 played alone, the
Links apart on its switches and leaving them, the side views' walk-offs, against traces), `enemies.realdisc.test.ts`,
`foes.realdisc.test.ts`, `soldiers.realdisc.test.ts` (the soldiers' stand-off and attack slot, the captain),
`walkers.realdisc.test.ts`, `waterfoes.realdisc.test.ts`, `wizzrobe.realdisc.test.ts`, `generators.realdisc.test.ts`
(room 5's ambush against its trace, a GEN3, drops, the kill streak's falling gems),
`logic.realdisc.test.ts`; `tools/e2e/src/game.ts` plays each milestone in the browser, then the route to the stage
clear (`#route`, `window.fso.route`).

- **M1 done.** Every stage loads (`#stage=boss0WS`, the stage list on Esc or the pause button, named from the game's
  messages), starts on its PLAS starts, changes rooms on all four sides (up and down traced like left and right),
  goes through `WARP`s into GBA-screen areas, shown in the game's GBA window (`main_gba_window.blo`) as when playing
  alone, and back (traced both ways); every mapped actor is a static sprite; the room's battle props are live. The HUD
  is the game's `main_adv.blo` (hearts, Force Gems).
- **M2 mostly.** The enemy framework (life and atcp from enemyparam.csv, the sword's power, the measured knockback,
  the dying puff, switch-gated enemies, boxes at the enemy's height), the Octorok (traced), the Keese (main.dol) and
  the sword soldiers (`soldiers.ts`, main.dol's states traced in rooms 5 and 9: patrols, looking round, "!" and the
  21-tick wind-up, the chase re-aimed every 13 ticks; the attack slots, one per Link: until a Link strikes a soldier,
  they all back off within 56 px of him, so they stop 40-56 px short, as traced; room 5's walk in); from main.dol (not
  traced: no savestate reaches their stages): (`foes.ts`) the Tektite, the Stalfos and its bones, the Buzz Blob (its
  shock), the Poe (hiding, fading; the ghosts swords can't kill), the Mozo, the rat, the sand crab (`PEAC`), the Armos
  (waking, hopping); (`soldiers.ts`) the bow soldiers (`SLR2`: arrows from 70 px in line, bush archers, bomb throwers)
  and the captains (`SLR4`: shield, lunge) with their groups (a soldier's params' top byte; the captain's gather and
  attack orders, traced in room 9); (`walkers.ts`) the snake (`ROPE`: dashing at a Link in line), the Zol (`ZASL`;
  Lake Hylia's lies under a two-Link rock, which holds what's under it until it's lifted: main.dol's RCK2) and the
  shelled beetle (`PAME`: kicked sliding, then struck on its back); (`waterfoes.ts`) the river Zora (rising on deep
  water, its fireball) and the side views' fish (`PUKU`, never hurt); (`hinox.ts`) the Hinox (strides, the charge, its
  rocks; its grab and gem shaking not simulated); (`wizzrobe.ts`) the Wizzrobe (teleporting near the Link, bolts, ice
  balls, orbs that raise Stalfos, the gem-draining beam) and the Stalfos it raises (they collapse and get up). Enemy
  generators (`GENE`, `GEN3`: what they make that the sim has) and kill counters (`SKIL`), traced on room 5's ambush;
  drops by each type's enemyparam.csv class (`dasu`, main.dol's tables, traced on the soldiers) and from bushes
  (main.dol's rule); the kill streak (`SCRE`: a red Force Gem falls onto a Link 90 ticks after his 10th and 15th
  kills, traced). apps/game draws them at the game's sizes (big Tektites and rats 1.2×, big Stalfos and Armos 2×,
  PAMEs 1.4×, Zoras 1.5×) and alphas (Poes, Wizzrobes), the ghost Poes with their textures. Not done: the soldiers
  shoving each other apart, their guards and circlers ((p >> 16) & 15 of 4, 6-9), kinds 1 and 6's own states; the
  other ~20 placed types (`POPO`, `DDRK`, `SLK2`, `TNDR`, `Poon`, `GROK`, `GOMA`, `SLR3`…: static sprites); the Armos
  pushed as blocks (kinds 1, 4) and on rails (kind 5: main.dol read, not simulated); the Hinox's grab; the Wizzrobe's
  POPOs and fire bolt flames; side views' gravity for the Stalfos; JPA effects for the spells (a stand-in sprite).
- **M3 mostly.** Force Gems (`RUPY`, `HNRY`, worth from main.dol) with the HUD counter, small hearts, keys (lifted
  with the Action button facing them, carried overhead and thrown, traced: `measurements/adventure-lake-hylia.md` "The key's
  throw"; the first key's message on the boomerang's return), locked doors (traced) and switch shutters, chests (tile 0x30 → 0x10, content as IMUP
  shows it; opened with the GC's A from below: traced in the Cave of No Return), Force Gem rains (`RYRN`), panel rewriting (`PNPC`), the
  all-enemies-beaten, focus and four-Link switches, rooms keeping their switches, the goal (`GOL2`) with the 2000 quota;
  items (traced): the pedestal's boomerang, which fetches what it touches, and the Fire Rod (`LSTI`), which burns
  stumps; grey stones lifted, the boulder and the cave block pushed by the wide formation, two-Link rocks lifted and
  thrown, the raft (`OBLF`, traced: its riders, sink, glide and rise); `SWT4`'s latch in modes other than 0 and 3
  (traced); rooms numbered 50 and up played as their alone variant (`playedAlone`: room 58 → 8, traced). Not done:
  the big key and the other chest contents, a key pushed on the floor (walking into it slides it: not simulated), a thrown key over water or a pit (none reached in room 3: assumed to stay), the other `DOOR` kinds, `SKIL`, `ZNSW` kinds 2-9, the other
  items, the open doors' and lit pads' looks, signs and NPC dialogue.
- **M4 done.** The three followers walk the leader's trail 18 px apart and replay Dolphin's 4-Link trace within 0.1 px
  (the leader within 0.01); the leader's push state; one shared heart meter; `#players=1-4`; the C stick's formations
  (traced: wide, box; cross and long assumed), on T/F/G/H and the right stick in apps/game; the Links apart (X), one
  picked with the D-pad, called back (Y) (traced; Q, E and 1-4 in apps/game); X steps them away only from a stack, a
  Link left on a floor switch is put on its middle, the one in control goes through doors and room changes alone (the
  others parked out of the way, `AdventureState.away`) and Y brings them from there (traced in room 58's caves). The
  room they're left in keeps its cut bushes and pots while they're there (`away.cut`; a room the Links all left regrows
  its bushes on return, as the garden's do): the rule chosen, not checked in Dolphin; its enemies and generators still
  reload. Not done: the Links pushing each other, a C-stick formation held back by a blocked follower (traced at area
  6's ladder).
- **Out of hearts** (adventure.ts `revive`; the game over, its Force Gems and fairy not traced): once the dying Link's
  76 ticks are over, the four get up where they came into the area, hearts full, 180 ticks invincible (main.dol's revive
  sets +0x464 = 180) and blinking 2 ticks in 4, walking at once; leaning on a wall doesn't hold the count
  (`revive.realdisc.test.ts`). A sampler stepping by fours can see them hidden all along (a playtest did).
  From the last quarter heart to the revive is ~100 ticks: the struck Link's knockback first (24), then his 76; only
  he dies, the others stand (the Cave's room 2 Mozos, replayed from a playtest's capture: 0 hearts at tick 283,
  up at 384; its "150+ ticks standing" was one `do` step over them).
- **Motion (traced):** swimming (deep water: speed, glide, turns, walls, the dive; followers swim the trail), ledges
  jumped down (0x10-0x13), side-view areas (falls, ladders, side swimming), water warps under room 5's bridge and room
  6's whirlpool, side views' wall doors (Up) and cannons (in, the shot, steering, the top edge), waterfalls (`SEV2`),
  side views' walk off a ledge (its arc) and off a ladder (hanging on while over its column), out of the water onto a
  ladder; the side views' followers (no gravity of their own: off the ground each plays the Link ahead 13 or 12 ticks
  late, so they fall his falls and fly his cannon shots behind him and end on him; they get into his cannon with him).
  Left: the cannon firing by itself after 300 ticks, and the followers' 12-17 px spacing in a side view's water (the
  sim keeps 18), traced, not applied.
- **M5 done: Lake Hylia by its route, from its start to its goal.** `lakehylia.ts` plays the stage by the sim's rules
  (the same in node and in the browser), 14 milestones, 21,439 ticks (6.0 minutes), 2,280 Force Gems, the stage cleared,
  and no Link out of hearts at any tick (the realdisc test counts it: 0). 9 hits taken in all, 12 quarter hearts (3 of the
  4 hearts' worth) in all, the lowest the party went: 10 of 16 quarters. The long fights are the leader's alone: the
  others are parked by SEPARATE before the room (the room change leaves them behind) and GATHER calls them back from
  another area at once. These are room 3's Octoroks (before the key walk, and again on the way back to area 0, where
  they've reloaded), room 4's Octoroks up the stairs, room 5's ambush and room 9's soldiers and captain.
  The stage, in order: rooms 0-1's bushes; room 2's boulder (wide formation) and its cave (the stone at its mouth, the box
  formation on the four-Link switch, the boomerang); room 3's key fetched over the posts, lifted and carried to the house's
  locked door, the house's back room (a two-Link rock, the Fire Rod), the stumps burnt, the rock lifted off the hole, the
  side-view cave (ladders, the crystal's bridge);
  room 4 (grey stones, the four-Link switch's gem rain picked up, a two-Link rock); room 5's pocket (a stone, the ledge
  into the river), its river and under its bridge (a GBA area); room 6's steps; room 7's caves (three cannons) to
  room 58; room 58's caves (room 8's, played alone): the four apart on the middle room's switches (the bridge west,
  for good), out and in by the next cave, the chests (100 gems, a heart), switch 17 held by one Link while the leader
  crosses and leaves alone by the right-hand cave, Y; the east bank's bush and ledge into the lake, its seven gems, the
  waterfall into room 6's pool, its gems, the whirlpool, area 5 swum to its ladder; area 6's block pushed (the wide
  formation), the raft across the pit (a hovering 100-gem on the way), the ladder up to the garden's well; the garden's
  bushes and grey stone, the hole under a bush, area 7 (down, up its right-hand ladder, off it onto the passage, up the
  left-hand ladder) to room 6's bottom-left; room 5's south bank, its ambush (on the bridge's floor switch sixteen
  sword soldiers come out of its generator, the leader alone meets them; the sixteenth kill opens the way west again; their
  gems picked up), the north bank's four switches under bushes (the four apart again: two chests, two 100-gems); room 9's
  ambush (the way in shut by its floor switch, the six sword soldiers and their captain fought by the leader alone, the
  captain's lunge stepped out of and struck while he holds, the others gathered, the way west opened, the gem rain of 256,
  about 650 gems, picked up); room 10's goal.
  What the route leaves out or plays by assumption:
  - room 5's soldiers keep their distance from an idle Link (traced, and so in the sim now: the attack slots); the
    leader alone fights them from the bridge's foot as they come, its first strike freeing the slots;
  - room 58's big gem over the shallows waits for switch 18 (room 8's enemies beaten): its Zora, which the route
    can't reach while swimming, so the gem stays hidden;
  - room 9's captain (`SLR4`, from main.dol) counts for `ZNSW` here (assumed, as it has the enemy flag): the leader
    draws his lunge and strikes him while he holds (`fight`, as Hyrule Castle's);
  - area 6's four-Link switch, its door and the lower part's two chests (a dead end; not needed);
  - the raft's riders box (four at x 339.5–355.5 counted, one at 361.5 not): the sim's is ±12 px round (x − 4, y);
  - a two-Link rock carried (the route only throws it; `tools/playtest`'s house-rock detour): the pair walks together (a
    lifter held by a wall holds the leader), no door, edge, stairs or jump takes the Links out of the area with it, and
    the formations and switches of Link wait until it's thrown (rocks.ts "Carried"; unchecked in Dolphin);
  - the gems bushes and enemies drop (main.dol's rules, the adventure's generator) aren't picked up but for room 5's
    ambush and room 9's: the quota is met by about 280 gems; the two gem rains' colors and the drops are random (the
    sim's generator), so a change elsewhere can move the total by some 100: what's left on the way is little (room 2's
    and room 3's hovering gems over rivers the route doesn't swim, 20 each; room 3's river gem, 100; side-view
    chests).
- **Signs and dialogue (traced).** `dialogue.ts`: signs (`KNBN`) and villagers (`JIJI`, `SNPC`, `NAVI`/`KEPO`'s rule)
  talk on the GC's A (the sim's Item button) facing them, their message = params + 0x12B (main.dol), page by page in
  main2D's `hukidashi_wood` / `hukidashi_stone` / `hukidashi` boxes (apps/game `dialogue.ts`), timed as Dolphin shows
  Lake Hylia room 3's sign; an item or a chest's content got: the pose, then its message on the 97th tick (traced).
  A message that is only a flow (branch4, ifFlag: Lake Hylia's old man and cave villager; branch 2.07 on a room
  switch: Tingle's house villagers) shows the text it leads to, with the controllers, flags and room switches the sim
  keeps (`MessageBook.resolve`; the rules: `docs/formats/j2d-and-bmg.md`). A message whose text ends in a `branch`
  2.07 goes on with the one it picks in the same box (`MessageBook.follows`, `Talk.sameBox`), and a page with a `wait`
  2.15 stays that long once typed and turns by itself, the button ignored (Tingle's chant, traced: `tingle.ts`).
  Not done: villagers that talk by themselves when touched, the balloon placed over a speaker, a press while typing,
  the flows of `branch` 2.10 and 2.2C, `ifGems`, `ifItem` and a text's `then`.
- **The Cave of No Return (boss011), by its route from its start to its goal.** `cavenoreturn.ts`, 12 milestones,
  ~27,600 ticks, 2,160 Force Gems, in node (`cavenoreturn.realdisc.test.ts`) and the browser (`#stage=boss011&route`, game.ts): room 12's
  rising door and spiral staircase; room 6's lamp from its pedestal and its two candles; room 7's movable block tiles,
  the fence's gate, four blocks onto their points (the ring of fire out), the chest's key and the locked door; room
  13's five `BLCK` blocks (their rules from main.dol, the decisive one measured), pots, the key's chest from below and
  the door; room 0's color blocks (`BCK2`, main.dol: the Links apart, each pushing his tunic's, eight in the one order
  a search found), its two candles, east alone, the others called; room 2's ten
  Mozos (both doors open); room 1's floor switch among the pots (the chest's heart) and the pot over the key, past its
  five fireball traps (`traps.ts`: the first one's shot taken on the shield before the chest, the others left apart
  out of every trap's reach while the leader alone lifts the pots and carries the key out by the room's west side,
  where none reaches); room 9's
  cell, played alone as room 8: its locked door, a Link thrown over the pit onto the island takes the bow from its
  pedestal and strikes the crystal (the bridge), the others left by the door; room 3 alone with the bow (`bow.ts`): arrows shot up through the near ledge's
  lit torches light its four candles across the pit, one lights the crystal (the bridge), its fifty Keese beaten (the
  door north), the others called, into room 11; room 11's holes and stairs (areas 5 and 7) and its two four-Link
  chain levers (`lever.ts`, `PSWK` from main.dol); room 4's Shadow Link (`shadowlink.ts`: his rail, his
  shield, his swing, his jump over a Link of another color, his forms and the roulette); room 5's goal. The Force Gems on the way (below). Measured in Dolphin up to room 3:
  docs/measurements/adventure-world1.md "Adventure: the Cave of No Return"; from room 3 on it isn't.
  Drawn in apps/game: the rooms' darkness and their lights (`light.ts`), the burning arrows' flames, the chain levers
  and Shadow Link (below, "The Cave of No Return (boss011)" "Drawn"), room 1's fireball traps' shots (an effect and a
  light). Not simulated on the way: the rings of fire, rising door and sliding tile blocks drawn (their tiles change at
  once), Mozos' darkness.
- **Tingle's Tower (boss012) by its route.** `tingletower.ts`, 12 milestones, ~12,200 ticks, 2,020 Force Gems, the
  stage cleared (`tingletower.realdisc.test.ts`, `#stage=boss012&route`, game.ts): room 11's owl and bushes and the Zora
  house's two doors (its garden fenced off), room 0's ladder into the river, west through rooms 1-2 (their winged gems;
  room 2's two blade traps (`traps.ts`) kept off by swimming down its west side and back along the bottom, below them),
  down to room 3, over its falls, its whirlpool into the underwater passage (a winged gem), up into the tree house (its
  chest, two red gems), off the ledge into the east pool, room 4 (over the north end of its stone chain to the island's
  red gem: below), room 5's falls and gem, room 6's whirl (its gem in the middle), up room 7's ladder out of the stream,
  room 7's bush over a hole down into its side-view passage (its Keese struck, the ledge's pots, the shaft, the leader
  alone west underwater out of its four fish's way, its winged gem in the pocket at its west end, up into the
  whirlpool at the river's top, Y bringing them), room 7's channel down, room 8 between its stones and over its falls
  (two gems), room 9's three whirls (a gem in each) and out of the top one, room 10's ladder, the goal. Traced in
  Dolphin up to room 4 and for the rules the route leans on (below, "Tingle's Tower (boss012)": the owl, currents, falls,
  shaft tops, river stones, a ladder out of the water). The river's currents (2 px/tick against his 1) are swum on
  plans searched over the sim's own swim step (drive.ts `swimTo`/`planSwim`: the whirls, the gaps between stones), or
  ridden along a level (`ride`). Assumed on the way: the hole under a bush (style 4, out going down), pots beside a Link
  in a side view lifted away at once, a Link struck in a side view getting up as on the TV (dying there too). Struck
  on the way (the four's 16 quarters): room 2's stones twice, room 4's Zora (2) and the chain's north stone, room 7's
  fish once (4). Not simulated: the Great Fairy's area, `FLYO` flying floor tiles at the goal
  (static), the river's villagers' talk. Room 10's winged gem (472, 208) is in the fast current down its east channel:
  out of reach (the quota is met by 20 without it; room 7's passage gem is taken instead).
- **Hyrule Castle (boss013): surveyed.** In Dolphin (loaded by the stage pokes, stage 3): room 0's owl (`KEPO`) flies
  in and talks as the Links come up (message 0x2BB, five pages; the way is held until it's read: simulated now, `startOwlTalk`); room 1's gate is
  the `SPBG` drawbridge: the crystal behind the wall (`ONOF` at (320, 80), lit by the sword in the adventure) sets
  switch 1, `WTSW` 2 192 ticks later and the camera's `FOCS` 3, `SWT4` 16 = 2 and 3, `SPBG` then 17, which turns
  the gate's tiles to floor; the way to the crystal is under the two-Link rocks (holes into side views, areas 5 and 6:
  two floor switches for two Links apart). Then the castle's rooms (sword soldiers and captains, Armos, crystals,
  generators, pull switches `PLSW`, cannons in side views) to room 11's Phantom Ganon (`FGAN`) and room 12's goal.
  `hyrulecastle.ts`'s route plays rooms 0-2 into room 3 (room 1: a Link thrown over area 6's gap onto its far switch,
  the bridge, the walls' blocks and crystal, the drawbridge; room 2: its soldiers, chests and spikes): "World 1: what's
  left" below.
- **Phantom Ganon (`phantomganon.ts`), from main.dol and traced in Dolphin** (docs/formats/adventure.md "Phantom
  Ganon", measurements/adventure-world1.md "Hyrule Castle room 11: Phantom Ganon"): his appearance (the Links held),
  hover and wander, dashes, the energy ball and its rally (sent back four times it strikes him down; returns keep its
  speed, his bats 0.26 px/tick × the returns faster), its burst off the screen and its shards (through walls, 78
  ticks), down and open to the sword between his hurt frames (his body x ± 16, y − 8…y + 40 on the ground, 4 a
  swing, 75 per fall, 210 in all), his end (300 ticks dying at z 40, the Links free); the Force Gems (`GOLD`,
  pickups.ts `burstGems`) his first two falls (99 each) and his end (80) fling out; the room's switches then bring
  the staircase. `PHANTOM_GANON_MILESTONES` fights him from room 11's way in (~6,100 ticks: three falls) and gathers
  his 278 Force Gems, tested in node (`hyrulecastle.realdisc.test.ts`, `phantomganon.realdisc.test.ts` against the
  trace) and in the browser (`#stage=boss013&room=11&route`, game.ts), drawn from his `fganon/` BTIs (tinted with his
  aura's colour: assumed), his ball and shards as plain discs (the game's are JPA effects); the staircase
  (`stairs.ts`, kind 5) then takes the route to room 12's goal. Not done: the 2-4 player rules.
- **Music and sounds (World 1), `apps/game/src/sound.ts`.** The shared synth player (`@fso/web/audio`, as Shadow
  Battle's) plays each stage's BGM, from its map CSV's bgmId through main.dol's stage table (**game**: Lake Hylia and
  Tingle's Tower `JA_BGM_WATER_FIELD`, the Cave of No Return `JA_BGM_DANGEON`, Hyrule Castle `JA_BGM_CHIJOU`), and
  *assumed by name*: `JA_BGM_BOSS` while Phantom Ganon is there, `JA_BGM_ITEM` while an item or a chest's content is
  held up (then the stage's BGM again, from its start), `JA_BGM_FANFARE` once the stage is cleared. `AdventureCues`
  reads the sim's states after each tick (no events in the sim; nothing plays twice for a state seen again) for the
  sword, charge and spin, a Link hurt, falling or dying, enemies struck and beaten (the sword soldiers their own),
  Octoroks spitting, Phantom Ganon struck and beaten, Force Gems by size (worth < 50 `JA_SE_LK_COIN`, else
  `JA_SE_LK_BIG_COIN`) and dropped ones landing, hearts, keys, items, chests, a locked door unlocked, doors opening and
  shutting, floor and four-Link switches, bushes cut and pots broken, lifting (the two-Link rock too) and throwing,
  bombs, the boomerang, into deep water and each stroke, the message box (open, a blip every 3 characters, a page,
  close). Which id for which action: `ADVENTURE_SE` notes the ones main.dol's code plays as constants (`tools/dol
  callers` of the Link and actor sound functions: `JA_SE_V_DAMAGE`, `JA_SE_LK_THROW`, `JA_SE_LK_PLUNGE`,
  `JA_SE_LK_SWIM`, `JA_SE_OBJ_TBOX_OPEN`, `JA_SE_OBJ_DOOR_OPEN`, `JA_SE_OBJ_SWITCH`, `JA_SE_OBJ_CUT_GRASS`,
  `JA_SE_OBJ_POT_BREAK`, `JA_SE_CHR_ENEMY_DAMAGE`/`_DOWN`, `JA_SE_CHR_OCTA_FIRE`, `JA_SE_CHR_PGANON_DAMAGE`…, though
  not which call site is which action); the pickups', the message box's and the jingles' ids aren't passed as
  constants (a table, *not found*), so those are picked by name. Not done: the levels against the game's, footsteps,
  NPC voices, the GBA screens' own sounds. M or the sound button mutes, `#mute` for one page. Tested in node
  (`sound.realdisc.test.ts`: Lake Hylia's route, every kind of cue) and in the browser (game.ts: each World 1 stage's
  BGM, the cues, M).
- **Later**, as planned: bosses, the remaining enemies, surfaces (ice, quicksand, currents).

## World 1: what's left
Where each World 1 stage stands, for whoever picks it up (routes in `packages/sim/src/adventure/`, played by
`drive.ts`'s RoutePlayer; `#stage=boss01S&route` in apps/game; the realdisc tests replay them). Savestates are in the
main checkout's gitignored `ref/adv/` (`w1-*.sav`, each with its `.json`: frame, script, the state it came from); use
the Dolphin user folder `ref/dolphin-user-adventure2` (or a copy) and `tools/dolphin/src/trace.ts --savestate …`.
Dolphin helpers that worked: `--tele <frame>:<x>:<y>` (world px = cell × (512, 384) + room px) moves the Links inside
a room from a nearby spot (from far away the game puts them back; it never crosses rooms); a room's switches are the
u32 at stage data + 0x178 + cell y · 40 + cell x · 4 (stage data = [[[0x8053AAF8]+4]+0xC], 0x8115A278 in these
states), poked with `--write`; an actor only acts once the camera has caught up after a teleport (wait ~80 frames);
stage loads from `ref/save-lake-hylia.sav`: stage 0x80529F08 = S, gs + 0x58 = 1, byte gs + 0x84 = 1 (gs =
[0x8053AAF8] = 0x80958738), frame 5 (S = 1 and 3 work; S = 2 is `boss200`, the horse race: Tingle's Tower needs more, its section below).

### Lake Hylia (boss010): done
Played to its clear (`lakehylia.ts`). Checked off the route by `tools/playtest` (`docs/tools.md` "Playtest checks":
the puzzles bent, the actors against their drawings); what they found is in `docs/BACKLOG.md` B6.
Room 4's minor Shadow Link (`ZSLH`, `minorshadow.ts`, traced): 103 ticks after the room change he raises his hammer,
three blows whose shock wave stuns the Link in control near them, then spins away in dark smoke and walks off unseen;
gone for good. Room 3's (`ZSLJ`, the one who jumps, `minorshadow.ts`, traced): he hops in the house's doorway until a
Link comes within 48 px, then jumps 125 px aside (left, then back, then left), three times, each on the next Link to
come near, then spins away in the same smoke and walks off left unseen; the door does nothing to him (the Link with the
key sets him off first). Room 5's Tingle (`FTGL`, `tingle.ts`, traced): under the two-Link rock on area 2's ledge (the
bridge's GBA area); the rock lifted, he lies there, then stops the Links, talks (1294, then 1295 → 1305 → his chant 1302
in one box), floats off on his balloon past the GBA screen's edge and over room 5's TV, gone for good; the route reads
him (`lakehylia.ts`). Placed but not simulated (besides `FGAL`, `KEPO` and the hidden controllers named above): `YAJI`
(the arrows on room 0's ground, drawn only), `TMI2` (room 58's 2-3 player blocks, in its tiles), `PRTC` (the waterfalls'
particles, drawn by the stage effects), and `WPWL`, `SENP`, `ZOOM`, `GLWP` (hidden; what they do unknown).
The 2026-10-18 black-box playtest (screenshots only, `#manual`): its "push blocks" walked through in room 4 and room
2's cave are the four-Link switches (`YNSW`, floor; its "Link drawn under the block" was blinking after an Octorok's
rock), and room 4's "cliff walked through" at x 416-431 is floor right of the face's diagonal tiles (type 0x0B), the
sprites overlapping its edge (`fourswitch.realdisc.test.ts`). Its followers through walls came from `#x=&y=` starting
only the leader there (a follower walks its trail without collision): all four now start on the spot.

### The Cave of No Return (boss011): done; traced to room 3, rooms 8, 11 and 4 checked in Dolphin
- **The bow is room 8's (applied).** The walkthrough (zeldauniverse.net, chapter 1): "Press select and throw a Link to
  the other side and grab the Bow"; room 3: light the torches with arrows, the Keese come, shoot them in a horizontal
  line, and hit the switch before the bats die, or the Force Gems fall into the abyss. Every on-grid Cave pedestal
  draws the lamp (top-layer tile 0x29 over it: rooms 0, 6 ×2, 13 and its copy 10); only room 8's, on an island cut off
  by a 2-tile 0x0E pit column, draws the bow (0x2B). **Measured: played alone, the game loads room 8 at room 9's cell
  (4,4)**: in `ref/adv/w1-011-room3.sav` (one GC player) that cell's live base layer (0x80F02800, BE, quadrant order,
  docs/formats/runtime-ram.md) is room 8's (6 tiles differ: row 1, x 13-18, the north door opened; 95 from room 9's).
  How the game picks it wasn't looked for. Room 8's actors: no `SWTH`/`SWT4`, one chest (256, 176) content 0x15
  (the blue bracelet: nothing yet), the `ONOF` (switch 16, the bridge's PNPCs over the pit) at (224, 240).
  Done: `playedAlone` (stage.ts `ALONE_ROOMS`, boss011 9 → 8); pedestals give their drawn item (`PEDESTAL_ITEMS` keeps
  Lake Hylia only); the route keeps the lamp through room 0 and, at room 9's cell, lifts the Link behind (between the
  pit's candle stands, facing east), turns west and throws him onto the island (~43 px in the sim: carry.ts's flight;
  a toss flew 47 px in Dolphin), hands him the controls, takes the bow, strikes the crystal with the sword (the
  bridge) and calls the others across. **Traced** (measurements/adventure-world1.md "The Cave of No Return from room 3
  on"): the lift and throw land the Link 43.5 px west on the island, R at the pedestal gives the bow, the sword on the
  crystal from (232, 226) facing down lays the bridge on the swing's first tick: the route's sequence holds.
  Taking an item swaps it with the one held (frame dumps: the lamp left on room 8's pedestal; holding nothing leaves
  it empty, assumed); the Links hold the item got up (apps/game `heldUpLook`), the HUD's item box shows the item held.
- **Done** (`cavenoreturn.ts`, 12 milestones, ~27,600 ticks, 2,160 Force Gems for the 2000; measured in Dolphin up to
  room 3: measurements/adventure-world1.md "Adventure: the Cave of No Return"). Its Force Gems, in route order: room 6's
  two pots over floor points (`PONT` kind 3, 40), room 7's two candles (330) and its corner chest (a block pushed up,
  the one beside it right; 100), room 13's top chest (20), room 0's three chests (400; the third after two more color
  blocks: red's at (224, 144) right, green's at (224, 240) left), room 2's Mozos' drops and the streak's red gem, room
  1's four pots over floor points (80, each reached by lifting the pots on the way), (room 9's 50-gem chest isn't
  there played alone: room 8 is), room 3's gem rain, the Keese's drops and the
  streak's gems gathered where the Links can walk (~600), then the crystal (a toggle) struck again from the ledge under
  it: the bridge goes, the two peninsulas come back with their winged gems (200), room 11's four chests in areas 5 and
  7 (175) and Shadow Link's drop (100 or 150, drop class 5). Not reachable playing alone: rooms 2, 4 and 7's GBA areas
  (their `WARP` styles 7/8 at (8, 8)), ~330.
- **Room 11** (`lever.ts`, main.dol 0x80374074 and 0x80373C38): the south pocket's hole (328, 328: entered from above,
  its rim is solid) leads down into area 5; its stairs (`WARP` style 0x19) climb areas 5 → 5 → 7 → 5 → 7 → 7, and area
  7's last one comes out of the north part's hole (248, 168). The chain levers `PSWK` (176, 24) → switch 21 (the
  heart's chest under it, `PNPC`) and (336, 24) → switch 20 (the door north): a handle ±8 px, grabbed by a Link whose
  point 16 px ahead is in it; it moves only while four Links hold it, 0.5 px a tick but 0.03 over the first 2 px of
  every 10, to 40 px (~335 ticks), and back up 1.25 px a tick when let go; pulled, its switch turns on 94 ticks later.
  **Traced in Dolphin:** playing alone the leader holds the handle with R (grabbing from y 41.5 under it, not 42), the
  others in the C-down column each hold the one ahead; R alone holds, R + Down pulls (main.dol's speeds and the switch
  94 ticks after the full pull, as read); the four come down with it, step back 7 px the tick after the full pull, hold
  on to the switch whatever the pad, then let go as it goes back up; Down let go while held, it goes back up dragging
  them and the leader lets go on its 3rd tick. All in `lever.ts` (tests in `lever.realdisc.test.ts`).
- **Room 4** (`shadowlink.ts`): Shadow Link (`SLK2`, ~60 methods: a Link's state machine, its tick table 0x804A448C
  and its starts 0x804A45B4 by his state +0x248). **His moves, read from main.dol and traced in Dolphin**
  (2026-10-11, measurements/adventure-world1.md "Room 4's Shadow Link", `w1-011-room4-shadow`/`-green`): his skill
  level (params & 31, room 4's 0: flags 0x48, 0x802157B8) gives him the plain swing only (no spin attacks, no jumps
  of his own, no swing at once from up close). **Standing** (15): 15-30 ticks, then a Link within 70-100 px sends
  him along his rail, or 300-600 ticks (traced 312, 579) and he walks 1-12 of its points anyway. **His rail** (17,
  room 4's five `RAIL` actors in their index order, looping: (96, 80), (96, 192), (416, 192), (416, 64), (112, 80),
  traced): to each point jittered ±16 px at 1 px/tick (+0.1 a tick up, −0.2 down: traced), a point reached within
  10 px; out of points with no Link within 120-200 px he stands; a Link within 60 px he goes at (27); every 30 ticks
  a Link within 100 px about ahead turns him back along it (traced). (416, 64) ↔ (112, 80) is **a jump** (their
  flags 0x08/0x10): 90 ticks standing, 30 crouched, a 60-tick flight (6 px/tick up, 0.2 down), 30 landing, 90
  standing (all traced). **At a Link** (27): out of 65-80 px he gives up (stands 3 times in 5, else his rail); his
  heading re-aimed at the Link ±45° every 20-40 ticks, 0xAAA at most (traced); a Link who can hurt him (his color,
  any when dark) within 50 px: **closing in** (34, 5-20 ticks, his heading at the Link every tick), within 20-40 px
  **his swing** (35, 16 ticks, traced; 36 two times in five, a lunge: not traced). His sword's box is 8-24 px ahead,
  ±8 across, out on ticks 2-7 and 10-15 (traced), and **only hurts a Link who can hurt him** (0x801CA274), by 2;
  then 90 ticks standing (39, traced) and at the Link again 7 times in 10 (else a 60-tick cool-down). **His shield**
  (0x801CA564), up in states 14, 15, 17, 27, 32, 34-40: a box 7-9 px ahead; the sword of a Link who can hurt him
  meeting it from ahead of him (the larger axis) clanks: no harm, the Link pushed back 1 px/tick (~7 px, traced), he
  **springs back** (32) 3 px/tick away, × 0.78 a tick, 10 ticks (traced). His sword meeting that sword in a swing does
  the same (traced). From his side the sword lands (traced: 1000 → 996, knocked back 16 px/tick, his heading turned
  to the striker, then at him again). **A Link who can't hurt him** striking him (states 14-22, 27-40, 46): he **jumps
  over that Link** at once (28: 2 px/tick toward him, 4.5 up, 45 ticks, walls stopping him; traced), lands (31, 10-30
  ticks: traced 27, 17) and comes at him. His forms: the dark one, **3 sword hits from any Link** (red's and blue's
  both counted); then **the change** (~454 ticks, traced: 43 120 ticks, a jump, the roulette, 45 74 ticks), not
  hurt; **the roulette** (0x802153A8): a new color other than the shown one every 5 ticks for 100 ticks, then every 15
  for 75, his color the last shown. **The second form, traced** (2026-10-10, his color purple: +0x560 = 3, the Link
  index whose sword lands): **2 hits of his color** (the second's invincibility 48 ticks, not 24) and he's **down**
  (state 46) for **600 ticks**; **one more hit of his color then beats him**: knocked back 24 ticks, he spins 160 ticks
  (state 41) and is gone, the room's `ZNSW` (switch 16, the door north) on 2 ticks later. Left down the 600 ticks, or
  struck while down by another Link's sword (he jumps over that Link), he's up again, and one hit of his color puts
  him down again (both traced). **From main.dol** (and agreeing with the traces): each form is beaten once his life
  (1000, a sword hit 4) is down by the form's damage (+0x568: 12, 8, then 1 down; 0x8021D020, the table at
  0x8046A748), checked when his invincibility runs out (0x801C2960). Only the Link in control counted for his ranges
  (traced with the Links apart: the others' distances never did). The sim (`shadowlink.ts`) plays all the above (hits
  counted, not his life). **Assumed** (TODO(measure)): the lunge (36: a 2 px/tick step over its first 8 ticks), how
  he joins his rail from elsewhere (the nearest point, or the next when past it: 0x801C844C not decoded), his looking
  about while he stands, the change's jump (in place, 25 ticks crouched before it), a Link's shield against his
  sword (none), arrows and bombs on him (only his color's, as swords: the game's 0x801C9EB8 stuns him, state 16, not
  simulated). The route (`cavenoreturn.ts` `flankShadow`): the Links apart, red in control; struck only while he
  can't come at the Link at once (standing after a swing, landing, on his rail's jump, down), from beside him (his
  shield); else kept 36 px off, drawing him into swings that miss (his sword reaches 31 px with a Link's body), out
  of his sword's way while he swings; the dark form, then the Link of his color handed the controls once the
  roulette's over, the colored form and him down; his Force Gem taken from beside the wall it may land against
  (~2,280 ticks, 2 heart quarters lost, no death; it was ~1,175 ticks and 6 quarters walking at him).
- **Room 5**: the goal `GOL2` (layout 1), stepped on from below with the quota.
- Also: an arrow that sticks in a crystal's own tile lights it (`bow.ts`: room 3's from below depended on the pixel it
  was shot from, room 9's across the chasm never lit).
- **Still open:** Shadow Link's lunge (state 36), how he joins his rail (0x801C844C), his looking about while he
  stands, the items on him (state 16); room 3's arrow lighting in Dolphin; the blue bracelet (chest content 0x15
  gives nothing); Shadow Link's own animation (his frames are a Link's, assumed, below).
- **The stage's items: the lamp, the bow, the blue bracelet** (the wiki). Pedestals (tile 0x017, a `TRCH` kind 1 glow
  beside each) stand in rooms 6 (two), 13 (48, 112) and 0 (432, 336: the pocket by the east door, beside the candles the
  lamp lights); off the grid, room 8 (a draft of room 9 with a pedestal where room 9 has its four floor switches) and
  room 10 (room 13's copy). Each gives the item drawn over it (above: room 8's the bow, the others the lamp). The blue bracelet (msgus "You got a blue bracelet!… Damage is now reduced by half!") is likely chest
  content 0x15: room 8's chest at (256, 176), on the bow's island ("reached by throwing one of the Links across the gap
  in the room with the Bow"). Not taken (content 0x15 gives nothing yet, chests.ts).
- **Room 3, how it's crossed (main.dol + the room's layout, not traced):** the four always-lit torches on the near
  ledge (y 280) stand in the candles' columns (x 104, 184, 328, 408), the candle stands between (y 240, 96) and the
  candles (y 64) on tiles 0x3D. ARRW's wall test (0x8016636C) lets an arrow fly over tiles 0x3A/0x3D; an arrow shot up
  through a lit torch catches fire (assumed: TRCH ±8 px; ARRW shows a flame while its +0x94 is 2 or 4) and lights the
  candle it reaches (LWSW lights when its +0x94 is set). The four candles (switches 18, 27, 26, 17 → `SWT4` 19) show
  the Keese (fifty `KETH` kind 3 here), the crystal tile at (288, 64) and the ledge row y 80 under it; an arrow lights
  the crystal (ONOF lights for a Link's arrow slots +0xB00, 0x80273C30) → switch 16, the bridge (x 208-304); the Keese
  beaten → `ZNSW` 21, the door north. The route goes in alone (the others left in room 9: a Keese that crosses the
  trail strikes each Link it passes), shoots the five arrows, fights the Keese that come (drive.ts `guard`) and shoots
  the resting ones in line; ~3,400 ticks, 8 of the 16 heart quarters lost. Not done: burning arrows on enemies or bushes, an arrow stopped by an eternal flame (`FLME`/`BLZ2`: ARRW stops and burns out
  in 20 ticks), ARRW's other pass-through tiles (0x40-0x9A while its +0x94 is 0 or 4); the room's areas 5 and 6 (side
  views under the pit, `CNON` cannons) aren't on the route.
  Earlier Dolphin attempts (before the bow was known): a toss flies 47 px (the gap is 144), the lamp at the near
  stands sets nothing, `OFFS` 4/5 toggle 1, `SWT4` 16 wants 0, 0, 1, 0.
- **Drawn (apps/game), from main.dol unless marked:** `light.ts`, `enemies.ts`, `view.ts`; checked by
  `tools/e2e/src/cave.ts` (the route, screenshots of each) and `light.realdisc.test.ts`.
  - **The darkness:** each room's `LTEV` sets the stage light, drawn by apps/battle's light pass (formats/battle-arenas.md
    "Lighting and the Dark World"): rooms 0-3, 6-10 and 13 kind 3 (tint 255, 200, 160, level 10, at once); room 3 kind 16
    (level 10 until its switch 21, the Keese beaten, then 4 levels a tick to 200); rooms 4, 5 and 11 kind 5 (fading 4
    a tick to 200 from the light the last room left). Room 12 (the start) has no `LTEV`: lit. The light is kept from
    room to room; a room without an `LTEV` keeps it (assumed: full at the stage's start, the level's init not read).
  - **The lights:** each Link with the lamp, 100 px at strength 255, easing 1 px a tick (0x802580E0: playing alone,
    only while his item is the lamp; so none with the bow; assumed: at his own place, the game uses +0x338); `TRCH`
    kinds 0 and 2 70 px (strength 128, at the anchor + (8, 8), while lit), kinds 1 and 3 (the pedestals' glow) 20 px
    at strength 200, the radius easing 4 px a tick; `LWSW` candles 70 px, strength 128, easing in once lit; a burning
    arrow 32 px; the crystals, flames and fire bars as in battle.
  - **The torches' flames:** effect 189 (and the haze 1354) only while lit and only for `TRCH` kinds 0, 2 and 4 (the
    haze 0 and 2): the pedestals' glows (kind 1) no longer show a flame, the candles' only once lit.
  - **The burning arrow's flame:** effect 189 while it burns (the sim's `ARROW_BURNING`), 12 px ahead of it (table
    0x804A0530), layer 0 sublayer 2, turned along it (0x800EF008: X −1, Y 0x8000 when it points down, Z 0x4000,
    0xC000, 0x8000, 0 by facing). It showed only after a fix in `@fso/render` (jpa/draw.ts): three.js kept drawing a
    grown particle buffer's first 64 instances, so effects synced last (the arrow's, behind the stage's torches) were
    cut off.
  - **The chain levers** (`PSWK`'s draw 0x80373EC8): enemy_gc 1129 (the handle) at rest; pulled, 1129 + a length
    class (1133-1136 from 10, 20, 30 and 40 px: the handle on a longer chain) at the lever's home + 0, 2, 4 or 8 px by
    the pull within its 10 px, and a link coming out of the wall (1130-1132) at its home. In other rooms the lever's
    rest look (`ACTOR_LOOKS`).
  - **Shadow Link** (`SLK2`'s draws 0x801D3CBC, 0x801D3DAC): player_sob frames, palette 7 as 12 + his color in a
    Link's colors, as it is (dark) in the dark form, and while he changes the color his roulette shows. His own
    animation (+0x348) isn't decoded: **assumed** a Link's frames for the sim's states (walking, the sword swing
    played twice over his 16 ticks, standing, springing back = the knockback's first frame, jumping = a stride raised
    by his height, knocked back, down = the death's last frame, spinning once beaten). Not drawn: his shield apart
    from the Link frames' own, his fades, a shadow.
- **Room 1's fireball traps** (`FBGE` ×5, `traps.ts`; traced, measurements/adventure-world1.md "The fireball traps"):
  invisible; each shoots at the nearest Link within 112 px every 120 ticks (`FBAL`: 1.5 px/tick straight at him over
  the pots, 2 damage, hit type 1, a shield stops it), drawn as JPA 656 and a light. A hit on the leader carrying a key
  knocks it out of his hands (`doors.ts` `knockKeyOut`, traced: thrown on along his facing from 18 px up), in every
  stage. The route: the shot from (248, 40) taken on the shield before the chest; the others left apart by (190, 205),
  out of every trap's reach; the leader alone lifts the pots (four hits), takes the key and comes back to them; out
  by the west side (x 56) and its row 136, out of the traps above and below (no hit carrying the key).
- **Not simulated on the way:** rings of fire, the rising door and sliding tiles drawn; the lights in GBA-screen areas
  (the window shows no darkness), Mozos' darkness.
- **Savestates:** `w1-boss011-start` (room 12), `w1-011-lamp`, `w1-011-room7`, `w1-011-room7-blocks`,
  `w1-011-room13` (b, c: in room 13; d: its rats parked by RAM writes, the Links at (382, 110) above the east
  column's block), `w1-011-room0` (in room 0, the key used), `w1-011-room2` (in room 2), `w1-011-room1` (in room 1),
  `w1-011-room3` (room 3's south edge, after a fall: the place to resume). `w1-011-room2b` is from a run whose key was
  knocked out of the Link's hands (not useful). From room 3 on (switches poked, Links teleported: their `.json`s):
  `w1-011-room8`, `-room8-island` (room 9's cell, the throw), `w1-011-room11`, `-room11-north` (the levers),
  `w1-011-room4`, `-room4-shadow`, `-room4-green` (Shadow Link's first and second forms).

### Tingle's Tower (boss012): in Dolphin up to room 4 and the route's rules; the route clears the stage
**The stage isn't loaded by the retail game** (main.dol): the stage loader (0x80135B90) names the arc from a static
table, `table[world · 4 + stage]` at 0x8049ED88, and every world's slot 2 is `boss20W.arc` (world 0: `boss200`, two
rooms, a fenced field and the horse race's screen `mg_horse_race.blo`: what the old `S = 2` poke loaded, now
`w1-boss200-start.sav`); nothing names `boss0W2`. Its map CSV has the older 8-field header (all the `boss0W2` arcs
do; every arc the loader names has 9). Loading it anyway: through world 0's slot 1 (slot 2 builds the horse race's HUD
and crashes), with its names poked over the Cave's (same lengths) and the CSV's header patched in RAM as it's read
(trace.ts `--patch`): the exact pokes are in `ref/adv/w1-boss012-start.sav.json`; measurements/adventure-world1.md
"Tingle's Tower in Dolphin". It loads as the sim has it (room 11, the four in a row at (416-464, 96); it rains).

**Traced and applied to the sim** (each against Dolphin frame by frame):
- **The owl talks** (room 11, `KEPO` 0xC000001C): within 24 px of any Link it flies in and shows message 0x147,
  holding them until read (dialogue.ts `startOwlTalk`, now by its params' reach from main.dol; the route reads it).
- **Villagers block** (`JIJI`'s ±8 px box: room 0's stopped the leader at x 431.4, as the sim now does; stage.ts).
- **The ladder's foot into the river** (tile types 0x3C/0x3D): a southward ledge whose jump is a drop (ledge.ts).
- **Currents** (main.dol 0x80242DAC; swim.ts `CURRENT_TILES`): tiles 0xB4-0xB7 push 0.05 px/tick² up to 0.5,
  0x95-0x98 0.15 up to 2 (up, down, left, right); room 0's river carries a swimmer west 0.5 px/tick.
- **The waterfalls inside a room** (lip tiles 0x3E): differ from the assumption (no 11-tick wait, no Lake Hylia drop):
  the leader's bottom sensor on the lip drops the four at once, each as off the ladder's foot, into the pool 64+ px
  below; their trails restart there (the playtest finding of followers swimming back up through the face).
- **The whirlpool** (room 3 → area 5): matches the Lake Hylia timing the sim has (51/56/32 ticks).
- **The shaft's top** (style 0x0F, area 5 → the tree house): was assumed as a door; now its own trip (rise 0.5 px/tick
  66 ticks, then 69 standing at the tree house pool's whirlpool, adventure.ts `stepRise`).
- **The whirlpool not taking back a Link it brought**: matches (he stayed 115+ ticks on it).
- **River stones** (spike tiles 0x51; swim.ts `STONE_DAMAGE`, adventure.ts `strikeOnStone`): a stone run into (the
  first leading sensor of a blocked swim step, the side ones before the corners, the current's step before the
  stroke's) costs a quarter heart and knocks the leader straight away from that sensor (combat.ts `KNOCK_SLOW`: 0.75
  px/tick, a 4 px/tick hop, 33 ticks), the current holding off and his drift gone after it; 60 ticks invincible. The
  others follow his trail, unstruck. Matched against five Dolphin probes in room 4 (measurements/adventure-world1.md
  "River stones"); the sim's currents now carry before the stroke (the order the strikes' directions want).
- **Room 4's way east**: the stone chain walls the west lake (where room 3's east pool leads) off from the island and
  the way down to room 5. Over its north end: from the inflow's slow west edge at (200, 40), right across the fast
  current, which carries him onto the north stone's top at x ~241; it knocks him straight up and, still swimming right,
  he comes down past its east side (crossed so in Dolphin, one quarter heart; the route does the same).
- **Out of the water up a ladder** (ledge.ts `startLadderClimb`): swimming up into a ladder's foot (0x3C/0x3D) he stops
  under its solid half (the swim's top sensor reaches 8 px, not 7.5), and on the 20th blocked tick he jumps out as off
  a ledge to the ladder's middle in the tile above (traced in room 0's river; room 7's and room 10's ladders on the
  route).
- Not checked: the hole under a bush (room 7, style 4), the Zoras' strikes (room 4: a fireball hit the leader in room 1),
  the fish (`PUKU`, room 7), the side views' Keese, the goal.

**Left to do** (the route clears the stage; these are its assumptions, cheapest first):
1. Trace the rest from the savestates by teleports (each room via `--tele` near its exit): the currents 0x95, 0x97,
   0x98 (up, left, right: assumed from the tile blocks; only 0x96 down and the slow ones were traced) and room 6's and
   room 9's whirls they make, room 7's bush hole (style 4), its side-view passage and fish, the goal (room 10). The
   100-gem pickup message ("You got 100 Force Gems!") holds the Links until A in Dolphin; the sim doesn't show it.
2. Whether a winged gem (`HNRY`) moves: room 10's sits in a fast current, out of reach if it doesn't.
3. Lake Hylia has the current and drop tiles too (rooms 6, 7): `TRACED_WATER_STAGES` (stage.ts) keeps them (and the
   stones' strikes) to Tingle's Tower until they're traced there and its route re-planned.
Savestates (`ref/adv/`, not committed, each with its `.json`): `w1-boss012-start`, `-room0` (room 0's entry, from the
route's own inputs replayed), `-room3` (room 3's entry, above the falls), `-passage` (area 5 after the whirlpool),
`-room4` (room 4's entry). The stone and ladder probes are `--tele` runs from `-room4` and `-room0` (the measurements'
"River stones", "Out of the water up a ladder"). Scratch tools used (not committed): the sim route's inputs replayed as a
Dolphin script; the probes replayed in the sim from the same spot.

### Hyrule Castle (boss013): done, rooms 0 → 1 → 2 → 3 → 5 → 3 → 6 → 57 → 9 (the first Zora) → 57 → 58 (the second) → 57 (the barrier, the checkerboard) → 10 (its areas 2, 7, 6) → 11 (Phantom Ganon) → 12 (the goal)
- **Walkthrough (zeldauniverse.net, chapter 1)**, applied up to room 9: room 3's right handle; room 5's bow and
  arrow through a door, the bombed wall, the cannon to the key's chest; the courtyard (room 6: the iron-ball soldier,
  the wave of guards); room 9's big handle in the wide formation, its four weapons, its bombed wall. Still to apply: a
  cannon launch then four black switches hit by a spin attack in cross formation; an
  Armos pushed onto a star switch (room 58's yard: not needed), switches under pots; blue guards, the throne pushed, a
  cannon back to the top; Phantom Ganon (all applied since).
- **Done:** `hyrulecastle.ts` (39 milestones, ~38,500 ticks, **2,801 Force Gems**: rolled, the rains' and drops' gems
  are random, 2,883 when Phantom Ganon came in; the stage cleared, no Link dying) plays rooms 0-3, 5
  (and back), 6, 57 and 9 into its area 5, the first escort Zora from there back to room 57 (its 18), room 58's
  crystals and tower into its area 2, the second Zora (below) back to room 57 (19, the fairy: 16, the barrier gone),
  room 57's platforms (below), room 10's generator into its area 2, the throne, the cannons up through areas 7 and 6
  (below), into room 11, Phantom Ganon (`phantomganon.ts`, his AI from main.dol, formats/adventure.md "Phantom Ganon";
  traced: measurements/adventure-world1.md "Hyrule Castle room 11: Phantom Ganon") and his 278 Force Gems till his
  staircase's switch 16, down the staircase into room 12 and onto the goal's top-left pad. `PHANTOM_GANON_MILESTONES` is the Ganon milestone alone (apps/game's `#stage=boss013&room=11&route`).
- **The staircase (read from main.dol, not traced):** `RASN`'s kind p & 15 picks its box (init 0x8028F890: kinds 0-4
  ±40 × −10…8, walked up into; 5 ±40 × −8…10, walked down into; 6, 7 sideways) and the row's facing (4 up, 5 down);
  where it leads is in its params (state 2, kinds 4 0x8028EC90 and 5 0x8028EEB0): each Link's place in the row moved
  16 px × (p >> 16) & 0x7F across (negative with bit 23) and 16 px × (p >> 8) & 0x7F down (negative with bit 15), then
  16 px more the way it goes (kind 4 down, kind 5 up); the room is the layout's at that spot. The Cave's (0x9A0D84)
  lands on room 6's (352, 272), as measured; room 11's (0x80A09005) 512 px west and 272 px up, on room 12's (256, 48),
  the Links walking out down 20 px (state 3 adds 0.5 px/tick; its timeline assumed the Cave's). Assumed: it's there
  once its switch p >> 27 is on (16: Phantom Ganon gone; the Cave's 0: always), as a PNPC's; the game wants every Link
  in its box (the count against 0x80138A30), the sim the leader.
- **The Force Gems** (2000 for the goal; the route had 640 before room 12): room 6's gem rain (`RYRN` kind 6, 256
  gems on switch 24) and its 48 soldiers' drops gathered after the wave (+1,063: the route had walked away from them);
  room 10's generator soldiers' drops (+12); room 10's area 2 (the throne room), its two in the band round its foot
  (150 + 100), then out and in again by its door (the only line 64 px from both Armos is x 256: off it, one wakes);
  area 7 and 6's middle columns (side views): from each lower-left cannon steered east all the way, the shot comes
  down onto the column's top (area 7: 150 + a winged 100; area 6: a winged 100, then east along it to the 200), then
  off its west end into the next cannon (area 7's upper one; area 6's lower one again, steered down onto it). Left
  untaken (cheapest first): room 10's chest (128, 208) (100) and area 4's two chest rooms (100), room 5's two chests
  on the TV (20 + 100) and three wall-top gems (26), room 57's area 3 points under blocks (`PONT`s: 2 × 100), room 3's
  area 4 (100 on 16), room 4 (not on the way: ~250), room 58's area 2's three gem rains (`RYRN` kind 10 on 18: the sim
  doesn't play kind 10), the kill streaks' gems elsewhere. Phantom Ganon's three `GOLD`s (99 + 99 + 80) are gathered
  (2,605 before him).
- **The fights, without a death** (the realdisc test counts the ticks a Link is out of hearts: 0; 8 hits taken in all,
  never below 2 hearts of 4, 3 in Phantom Ganon's room). What used to kill them (the sim revived them 21 times: room 2 14, room 6 3, room 10 2,
  room 11 2), all in the route, none a sim rule found wrong: room 2's captain (`SLR4`), whose lunge (4) and spear and
  body (3) struck the Links trailing the leader in its lane, and the leader himself walking up into it; room 6's
  iron-ball soldier (`SLR3`, then a stand-in), stabbed from 18 px when its (assumed, a captain's) box reaches 19; the soldiers' touch
  (2) on the followers in rooms 6 and 10's crowds; Phantom Ganon's ball meeting the leader on the tick he turned to it.
  Now: rooms 2 and 6 are fought by the leader alone (apart, `SEPARATE` just before the room: the others parked in the
  room behind, called after; one Link has one attack slot, so the soldiers come one at a time); `drive.ts`'s `fight`
  steps out of a winding-up or lunging captain's lane, strikes him while he holds after it (his shield down), strikes a
  soldier coming within the sword's reach where he stands, and stabs a big one from outside its box; room 6's
  iron-ball soldier, now the battle's (`SLR3`, castlesoldiers.ts: its ball on a 70 px chain), is shot with the bow
  from 104 px below, out of its ball's reach (`shootBallSoldier`: 12 arrows, each knocking it back up its passage);
  room 10's generator soldiers are met at their lane's mouth, the leader facing down it with his sword held out
  (`guardLane`: they walk into its box); room 2's drops and hearts are picked up; `fightGanon` turns to the ball as it comes and swings when it's three ticks off. A fight's
  foe in a pocket of wall gets struck from its far side (`defeat`: room 57's area 3). Room 12's story demo (`DMCT`, `DMCR`)
  isn't played; `GOL2`'s switch (p >> 27 = 1) isn't waited for (logic.ts).
- **Room 1, how it goes** (measured in Dolphin: measurements/adventure-world1.md "Hyrule Castle: a Link thrown across
  area 6's gap…"): area 6's two floor switches (`SWTH`/6 sw 5 and 6 under the ledges' end pots, `SWT4`/6 19 mode 2)
  sit either side of a 16 px gap nobody walks over; a Link is **lifted and thrown** over it (`sidecarry.ts`: the
  battle's carry, the height kept a height, half-speed bounce off a wall), lifts the far pots and waits on switch 5,
  one waits on switch 6; 19 lays a bridge (the `PNPC`/6 row at y 224, tile 0x3FC solid) from the right ladder's top to
  the left ladder, up to the top room and out (`WARP`/6 (112, 0)) onto the walls at the hole (368, 144). There two
  movable blocks (tile types 0x35 up at (368, 64), 0x36 down at (352, 80)) open the way to the crystal (`ONOF`
  (320, 80)): 1 → `WTSW` 2 (192 ticks) and `FOCS` 3 → `SWT4` 16 → `SPBG` 17 after 121 ticks (measured) → the gate's
  `PNPC`s turn to floor (`logic.ts`). The way back: Y, down the hole, area 6's two chests, its bridge and ladders, area
  5, the garden's bushes (grown back), through the gate.
- **Room 2:** the 16 sword soldiers and the captain beaten (`fight`, the leader alone), `ZNSW` 16 → two chests (100 gems, a heart);
  `THRN`'s spikes (tile type 0x22) shut both ways out until the room is beaten (main.dol, below), then up into room 3.
- **Not done / assumed:** room 2's intro (the Links held while the camera shows the soldiers forming up) and its
  spikes' entry (down as the Links come in, up behind them); carrying walks at 1.25 px/tick in a side view (the sim
  1.5); X's step away is the TV's in side views too (none measured there); the right-hand rock (464, 160) covers
  plain floor. Drawn in apps/game (checked by `tools/e2e/src/looks.ts`): area 6's bridge (its `PNPC` row's tile 0x3FC,
  the base layer patched as for any PNPC), the Link held overhead and the thrown one in flight with the battle's held
  frames (662-665; view.ts no longer lets his waiting pose apart win over them). Not drawn: the walls' `SPBG`
  drawbridge itself (switch 16 → 17; its look isn't decoded).
- **Room 2's spikes, from main.dol** (`THRN` update 0x802AAC60): kind p & 0xFF ≠ 0 (room 2's is 1) lowers them on the
  stage manager's "no enemies left" byte (+0x305C, ZNSW's), kind 0 (room 6's) on its switch; they rise 15 ticks after
  the room loads and go down over 10. Poking +0x305C (0x811578F4 in these states) lowered them in Dolphin.
- **Room 3** (`hyrulecastle.ts` milestones 7-8; measured by switch pokes from a room-3 state): the right-hand handle
  (`PLSW` (408, 264), `pullswitch.ts` from main.dol: grabbed facing it, 0.25 then 0.1 px a tick, out for good at 8 px,
  56 ticks) sets 5; `FOCS` 7 follows at once (the camera's already there; the sim 30 ticks) and `WTSW` 6 128 ticks
  later; `SWT4` 24 = 6 and 7; the gate (`SPBG` kind 1) sets 25 31 ticks after 24 (kind 0, room 1's: 121) and its
  `PNPC`s open. The left handle (3) only lights its torch and makes two `GEN3` sword soldiers (not taken). Through the
  gate: area 2 (two soldiers; its top door is locked, kind 1, held shut in Dolphin), its east door → area 4 → the
  doorway (440, 128) onto the east rampart (same spot and walls in Dolphin) → room 5. Area 2's west door → area 3 → the
  west rampart → room 4 (not taken).
- **Room 5** (milestones 9-13; measured: measurements/adventure-world1.md "Hyrule Castle rooms 5 and 6"): the wall
  tops (six gems) into the gatehouse (area 2); its right pedestal gives the bow (a pedestal gives the item drawn on
  it: gear.ts `drawnPedestalItem`; the left one, bombs); an arrow shot down over the pit flies on through the south
  door onto the TV and lights the crystal (`ONOF` (352, 192), 17) 20 ticks after leaving the bow (bow.ts: worked out
  at once in the other area); 17 bridges the pit and opens the channel's bollards; west out of the channel, off the
  ledge (304, 192) into the garden; a bomb flower's bomb thrown at the cracked wall (`DOOR` kind 2: doors.ts, shut
  till a blast meets it) opens the way into area 5, the tower (a side view): up the ladder, into the middle cannon,
  shot up into the niche, its chest (side-view chests open from the side) gives the small key; the cannon again, into
  the passage, the shaft's cannon (a cannon fires carrying a key), out of the top onto the TV's hole (96, 32), steered
  down-left while flying out (adventure.ts `stepLaunchOut`, measured; let go of, he falls back in), the ledge down to
  the corridor, west into room 3: area 4, area 2, the key into its top door, area 6, the TV's north corridor.
- **Room 6** (the courtyard, milestone 14): the three sword soldiers (`SKIL` 3 → 25 → `SPBG` 30 ticks → 16, the gate's
  tiles), the iron-ball soldier (`SLR3`, waiting for 16; soldiers.ts with the battle's rules and constants,
  castlesoldiers.ts `BALL_SOLDIER`: its walk traced here, the rest read from main.dol: its life 24 in Hyrule Castle (its
  init's world 0 stage 3), its ball on a 70 px chain swinging round (400 a tick, × 1.9 at each of its first two hits),
  2 to a Link it meets (hit type 3), struck it's knocked 16 px/tick away and reels its ball in for 30 ticks, nothing
  hurting it meanwhile, a sword meeting the ball clanks; apps/game draws it, its chain's ten links and its ball as
  apps/battle does), `SKIL` 4 → 17 → `WTSW`s 18-21 (256, then 32 each) → four `GENE`s of 12 sword soldiers each, `SKIL` 52
  → 24: the way north (`PNPC`s, latched) and a gem rain (`RYRN`). Not done: the `THRN` spikes behind the Links
  (switch 15: what sets it?), `GFBS`, the `PNPC`s writing the other layer.
- **Room 57** (room 7 played alone, milestone 15): its lower band east into room 9 (as in Dolphin). Taken later
  (milestones 30-33, "Room 57 past the barrier" below): its
  floor switches (two pairs, `SWT4` 24 = 5 and 6, 25 = 7 and 8; their `PNPC`s latch the checkerboard open, 0x360:
  two Links on each pair, e.g. the box formation) north to room 10, its areas 2-3 (`PONT`s under blocks, `DOOR` kind
  8), `BARI`/`FZRA` on rails (switch 16), the bow soldiers.
- **Room 9** (milestones 16-19; from main.dol and the tiles, not traced): its three sword soldiers beaten; the big
  handle (`PSWB` (328, 136), `pullswitch.ts`: a ±32 × ±8 grab box, it moves only while four Links hold it, 0.05 px a
  tick to 3, 0.125 to 11, 0.05 to 14, out for good; 184 ticks) pulled by the four in the wide formation (assumed: the
  formation's Links hold it with the leader; its switch 17 set at full, as `PLSW`'s) → `FOCS` 16 → the tower's
  `PNPC`s turn its tiles (x 112-143, y 208-256) to floor: up through it into the walled yard, the door (120, 80) →
  area 2; its stairs up to the four pedestals (drawn: fire rod (64, 64), boomerang (64, 96), bombs (176, 64), bow
  (176, 96)): the bombs; area 2's top door → area 3 (the throne room); a bomb put down at its cracked east wall
  (`DOOR` kind 2 (192, 64), side 3) opens it → area 5 (a side view), where the route stops. Area 2's two blade
  traps (`TRAP` 0x4 at (72, 184) and (184, 184), `traps.ts`, read from main.dol): each turns toward the nearest Link
  within 22 px of its row and slides at him, and they stop where they meet, in the middle; the route sets them off
  from (128, 200) (going up; (128, 168) coming down), clear of where they meet, and goes through while they ease home.
  Not simulated: the tower's other-layer `PNPC`s (p >> 16 = 1, its top drawn). Its `ZSLH` is Lake Hylia's (`minorshadow.ts`, leaving left).
- **Room 9's area 5 and room 58** (milestones 20-24; `zoras.ts`, the rule below, assumed where marked): a bomb put
  down in the side view (items.ts' bomb; the sim had no item in side views) breaks the fragile blocks, the Zora met
  goes with the Links (no collision, 1.5 px a tick, 16 px behind the last Link), through areas 3 and 2, the tower and
  room 9's lower band west into room 57, where it walks to its `FZRA` (408, 248) and sets 18. West along room 57's
  lower band into room 58: the cross formation in the middle of its four crystals (`ONOF` kind 2, 31 ticks each), a
  spin (the followers' swords now do what the leader's does in a C-stick formation: assumed; a spin meets crystals on
  every tick of it) lights all four: `SWT4` 9 → `FOCS` 16, its tower's `PNPC`s; up through the door (384, 128) into
  area 2. `BARI` is now a wall (±32 × ±8, assumed) while its 16 is off, and both arrival points waiting bring 16
  after 240 ticks (realdisc tests; the fairy herself not done).
- **Room 58's area 2, settled in Dolphin** (measurements/adventure-world1.md "Hyrule Castle room 58's area 2"): the
  door drops the Links into a lane walled on both sides (x 144-175, y 160-191) with pits across its top (y 144; walked
  into, a Link falls and comes back south of them). The way: X, the leader lifts a Link and throws him up the lane
  over the pits (he lands ~43 px on, at y 129.6); the D-pad hands him the controls: up the stairs, the pot off `SWTH`
  (224, 32) (17, latched), the top `DOOR` (144, 16) into area 3, where the Zora (`FAZR` (120, 40), 19) talks when he
  comes within ~47 px and then follows him back into area 2 to the pits' edge. Back: the D-pad to a Link south of
  the pits, Y: the one north of them dashes over the pits onto him; the Zora, left over 48 px behind, dashes over them
  too, and goes out of the lane's bottom door with the Links. (The area is dark: `VWMD`. The side pockets, the block
  (112, 160) and `TOMI` (96, 144) aren't needed.) The sim plays it so (milestones 25-29): the thrown Link lands at
  (160, 129.6) as in Dolphin; the pot over the switch is tile 0x41 (main.dol's lift leaves 0x12; solid till lifted:
  stage.ts `COVERING_POTS`); played alone a thrown Link bowls nobody over (sidecarry.ts `flyLinks`); the Zora as traced
  (zoras.ts; its greeting holds him, see "Measured so far" below). Not done: the greeting's length (~270 ticks at a fast reader's, ~330 measured: the ids are assumed), the dark (`VWMD`), stairs at 0.75 px/tick.
- **Room 57 past the barrier** (milestones 30-33, from the tiles and actors, not traced): area 2 (a sword soldier), its
  west door → area 3's west half (a sword soldier) → its warp down onto the TV's west platform (a bow soldier); the box
  formation on `SWTH` 5 (160, 64) and 6 (176, 80) sets `SWT4` 24 (latched, half the checkerboard's `PNPC`s); back
  round through area 3, area 2's east door, area 3's east half onto the east platform, the box formation on 7 and 8
  (25, the rest); west over the checkerboard, up the lane (x 224-287) into room 10. Area 3's `PONT`s under blocks only
  give gems (`RUPY` on 1, 2): not taken. Its soldiers come back each time an area is entered again.
- **Room 10** (milestone 34, not traced): the pot at (64, 320) lifted from the side (`PONT` kind 3 → 17: `GENE`), the
  generator's sword soldiers fought in the room (`SKIL` 32 → 16; in the sim they take all the hearts once: a revive),
  the door (224, 240) open, up into area 2.
- **Room 10's areas 2, 7 and 6** (milestones 35-36; measured: measurements/adventure-world1.md "Hyrule Castle room 10:
  the throne, the curtain, the cannons"): up the throne room's middle between its two `AMOS` (kind 0: they sleep
  until a Link comes within 64 px; the route keeps away, as in Dolphin), round the throne's left; the throne (`STBL`, a
  plain base-class object in main.dol) is pushed like Lake Hylia's boulder by the **four in the long formation**
  against its side (rocks.ts: legs of 12, 16, 16, 20 px at 0.2 px/tick); the curtain behind it (`DOOR` kind 8:
  doors.ts, cut by a sword swing) up into area 7 (a side view): the west ladders, off the ledge into the lower cannon,
  steered into the upper one, out of the top into area 6 **flying on** (adventure.ts `stepShotInto`: held 20 ticks,
  then on at the speed he left with), steered into its lower cannon, its upper one, out of its top onto the TV's hole
  (96, 64), steered east onto the walkway, north into room 11. Assumed: the throne takes four Links (only the leader
  alone pushing toward the wall was seen not to move it) and goes any way; room 57's area-2 doors (kind 8 too) are
  curtains (the route cuts them); a top edge's warp takes a shot ±24 px across (its box, from main.dol). Not done:
  area 6's bottom holes (style 4: in Dolphin a shot falling back down them drops into area 7's top; the sim stands him
  on them), area 4's two chest rooms, the `HNRY`s.
- **Where it stopped before, and why:** room 7's barrier. Rooms 57 and 58 played alone are rooms 7 and 8 (stage.ts
  `playedAlone`; `tools/census` `roomactors.ts` and `tools/render` list 57/58's own, the multiplayer layouts). In room 7
  the way north starts at the door (248, 144) into area 2, and **measured** (Dolphin, `w1-013-room57`): the
  barrier (`BARI` (256, 176), 0x84400002: its switch 16, field (p >> 22) 17) stands in that doorway and shocks the
  Links (state 51, pushed back at y 197); poking room 7's switch 16 on, it was gone and they walked up into area 2.
  What sets room 7's 16 in play is unknown: no actor of room 7 sets it; room 7 also has two escort Zoras
  (`FZRA` "escort Zora, arrival point", on `RAIL`s, waiting for 16), room 9's area 5 has an escort Zora (`FAZR`
  (184, 136), waiting for 18) behind a column of fragile blocks (tile type 0x53 at x 96-111, y 96-143; solid in
  the sim, nothing breaks them), and room 8's area 3 another (`FAZR` (120, 40), waiting for 19). Likely (assumed,
  not read): the two Zoras are led to room 7 and bring the barrier down, so both towers' areas come first. A
  poke of room 9's switch 16 from room 9 left room 7's word at 0 (the stage table at 0x8113B410 for room 7,
  0x8113B414 for room 9 in that lineage). `SWNP` kind 3 (rooms 7, 8, 9) is a tile writer (update 0x802BF474, its
  init 0x802BF7CC: kind p & 63, sub-kind (p >> 18) & 15), not a link between rooms.
- **The barrier's rule (read from main.dol, not traced):** the two escort Zoras brought to room 7 bring it down.
  `FZRA` (ctor 0x80127B48, vtable 0x8049E424: init 0x80127958, update 0x80127088, its state's entry 0x80126A4C, 17
  states) waits for switch (p >> 22) & 31 (18 for the one at (408, 248), 19 for (424, 248)), its rail (p >> 8) & 0xFF
  (3, 4), and sets switch p >> 27 (16 for both) itself. A manager (0x801283E8) lists room 7's `FZRA`s: once every one
  of them stands waiting (state 1: its switch on), each goes 60 ticks (12) → 120 (13, a fade) → 14 → 15, which spawns
  `SPFR` ("super fairy", ctor 0x801336B4) with switch 16 at the pair's spot and sends the Zoras away (16); a Zora
  spoken to alone (A, message 695 within 40 px) only talks. A room seen again with it done (vtable +0x34) goes
  11 → 8, which sets 16 at once. `FAZR` (ctor 0x80121164, vtable 0x8049DF78: init 0x801210A0 over the base NPC's
  0x80124448, update 0x80124278, state entry 0x80120174 (vtable +0x6C, 16 states), state update 0x80120570) is the
  Zora to fetch: params p >> 27 = the switch it sets (room 9's 18, room 58's 19), (p >> 8) & 0xFF and (p >> 16) &
  0xFF its two rails (room 9's 1 and 3, room 58's 2 and 4: room 7's `RAIL`s, ids (p >> 8) & 0xFF, at (400, 240),
  (416, 240), (64, 240), (80, 240)). It picks the Link who meets it (0x801EEC98, kept at +0x3CC; messages 691, 692,
  695), follows him (state 4), re-spawns itself in the next room with p | 4 | state << 3 (state 8; init reads
  bit 2), walks to the farther of its two rails in room 7 (13), and there sets its switch and goes (15,
  0x801204F0). So 18 and 19 are set in room 7 when each Zora arrives there. Not read: `SPFR`'s own scene before
  16 (assumed: 16 at once), what breaks the fragile blocks (tile 1, type 0x53; the stage loader 0x802D4CCC writes
  tile 0x3E0 over it on another layer; assumed: a bomb's blast, the item the Links carry from room 9's area 2).
  The follower's speed and distance: traced since (room 58's area 2, zoras.ts).
- **Then, from the actors (the alone variants):**
  - Room 8 (west of 7; reached along room 7's lower band, x 0): four crystals `ONOF` (192/256, 272/336), kind 2 lit
    31 frames, switches 5-8 → `SWT4` 9 (the walkthrough's spin attack in cross formation: a whirl round the diamond,
    traced, `whirl.ts`) → `FOCS` 16 → its tower lowered (x 368-400) → the door (376, 128) → area 2 (`SWTH` (80, 32) 18 and
    (224, 32) 17 under pots; 17 opens its top `DOOR` (144, 16), 18 a gem rain) → area 3 (`FAZR` on 19); the walled
    yard with two `AMOS` (168/200, 88) and the star switch `SWTH` (208, 48) (1) → `SPBG` kind 2 (256, 48); a `WARP`
    (0, 0) style 7 → area 5 (a `CNON` shooting up through `WARP`/5 (176, 0) onto the TV by the crystals (408, 296)).
  - Room 12: `GOL2` (176, 144) (switch 1), `GOAL` (248, 184), `DMCT`/`DMCR` (the story demo), four `PLAS` starts.
  - Off the route: room 4 (`PONT` (80, 112) under the block (80, 128) opens its gatehouse; four floor switches → 17,
    a gem). (A room's actors as played: `AdventureStage.area(room, sublayer).actors`, the alone variants included.)
- **The owl** (room 0; `startOwlTalk`, dialogue.ts): talks by itself, once, when the leader comes up to room y 204.5
  facing up; the Links stand until its five pages are read (the route reads them: `readOn`). Re-traced in Dolphin on
  2026-10-10 from `w1-boss013-start` (measurements/adventure-world1.md "Hyrule Castle room 0"): the Links stopped at
  y 204.5, not the y 72 of the older note. Assumed: the box opens on the stop tick (the owl's flight in isn't simulated),
  in the balloon style (the dark box's screen not identified). Only Hyrule Castle's KEPO does this (Lake Hylia's and
  Tingle's Tower's don't talk: not read). Room 1's gate shut, its bow soldiers on the walls (as measured).
- **The escort Zora's greeting** (`ESCORT_GREETING` in zoras.ts; the talk queue `Talk.after`): on meeting the Link (46-48 px),
  each escort opens messages 0x2B4 ("Who... Who is it?") then 0x2B3 ("The world is in turmoil...") (msgus `_e.bmg`; the
  order and the ids are assumed: the FAZR params don't map to them, and the flows carry no tags). It holds the Links, and
  the Zora stands while it does. **Measured by main (Dolphin): the talk held him ~330 ticks, ~16 A presses; the sim's
  fast reader needs ~270 (two messages, 243 characters): not matched, TODO(measure) the messages' ids and count.** The
  great fairy's scene (her messages 0x2B5, 0x2B6, 0x2B9 and the farewell 0x2BA) is not simulated: 16 comes 240 ticks
  after both arrival points wait, as before (assumed).
- **Savestates:** `w1-boss013-start` (room 0's start), `w1-013-room1` (the owl talking), `w1-013-room1b` (its talk
  half read), `w1-013-room1c` (in room 1 before the gate), `w1-013-room5-gatehouse`, `-room5-bow`, `-room5-channel`,
  `-room5-tower`, `-room5-key`, `-room5-launch`, `-room6`, `-room57`, `-room58*`, `-room10-area2`, `-room10-throne`,
  `-room10-pushed`, `-room11` (room 11 entered from below, before Phantom Ganon appears: out of the throne room onto
  the TV, then teleported every few frames onto the walkway so the followers stay with the leader, and north;
  measurements/adventure-world1.md).
- **Phantom Ganon, traced** (measurements/adventure-world1.md "Hyrule Castle room 11: Phantom Ganon", from
  `w1-013-room11`; pokes for his rally, state and HP there): his placement, hurt box, the sword's 4 a blow and the
  window between blows, the ball's returns and speeds, his catch, its burst and shards, his falls' and end's Force
  Gems (`GOLD`), his death's 300 frames, the room's switches. **Still to check:** the 75 damage that gets him up early
  (one Link's swings did 44 in a fall), the top of his catch box (the ball always came from below), the dash's hit
  (the Links were hurt ~2 frames later than his body box says), his colours as drawn (apps/game tints his grey BTIs
  with his aura's colour: assumed), the 2-4 player rules; the staircase to room 12 in Dolphin.
- **Next steps (2026-10-12, the castle's assumed rules in Dolphin; item 1 done, 2-4 left):**
  1. Room 58's crystals: **done** (measurements/adventure-world1.md "Hyrule Castle room 58: the cross formation's
     spin"; `whirl.ts`): the cross faces out (formation.ts `CROSS_FACINGS`), its spin is the 34-tick whirl, every
     Link's boxes from where he stood the tick before (`linkAttack`, used by the crystals, enemies, curtains and
     Phantom Ganon), the crystals' sword box ±5 (gear.ts `CRYSTAL_SWORD_HALF`). hyrulecastle.realdisc.test.ts plays
     the trace: boxes and lighting ticks as traced, positions within 0.11 px but where the game's followers jostle
     (ticks 3-6, up to 6.3 px; 0.23 on 7-10) or catch up with the circle (11-14, 2.4 px), and from the 8 traced spots ±3/±8 px off
     the route's. `bent.ts`: the y ±1-3 and "from another side" variants now pass (world1.ts CRYSTAL_SPIN now says
     why the box, long and wide formations' spins don't light all four). Not simulated: the followers' jostle (their
     steps turned off the line through the middle, 6 px kept; pushed apart at ~13 px on ticks 11-13), the 16 still
     frames from switch 9's, SWT4 setting 9 a tick late (the sim's the same tick), the whirl's sprite frames (apps/game
     draws the battle's spin and holds its last frame to tick 34).
  2. Formation rules (`PSWB` wide only, the throne and `BLCK` not in the cross, room 57's `SWTH` pairs, room 58's pot
     lift): **not started**. Savestates: `w1-013-room57` (the platforms' switches: poke 16 first), `w1-013-room10-area2`
     / `-throne` (the throne), `w1-013-room58-switch17`'s parent `-thrown` (the pot); room 9 has none (the big handle).
  3. Phantom Ganon's early get-up, colours, 2-4 player rules: **not started** (`w1-013-room11`, pokes in the
     measurements' Phantom Ganon section).
  4. Room 11's staircase and room 12's goal in Dolphin: **not started**.
  The castle route: 2,751 Force Gems, no Link out of hearts, 39,036 ticks (the 39 milestones played on; 2,816 and 37,998
  before the soldiers shoved each other apart). Its gems are rolled (pickups.ts: the rain's colours, the soldiers' drops): the 2,883 of the test's
  old comment was before the route's changes since moved the random generator (room 2 then 48 fewer, room 6's rain
  135 more).
  `tools/dolphin/src/trace.ts --watch <from>-<to>:<hexoff>:<hexlen>` (new) logs who writes a field of the Links, with
  the callers up the stack: how the charge's end was found.
