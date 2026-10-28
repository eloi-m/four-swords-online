# Four Swords Online: backlog

Where the project stands, and what's left by area (§B1–B7). History per phase: `docs/ROADMAP.md`; every format and
table: `docs/formats.md`; Dolphin measurements: `docs/measurements.md`; also `docs/netcode.md`, `docs/animations.md`,
`docs/deploy.md`, `docs/ADVENTURE.md`. Index of the docs: `docs/README.md`.

## Where things stand

- **Shadow Battle works, locally and online, on desktop and (in emulation) on phones:**
  - Local play is 2–4 players on one machine, any of them a CPU (easy, normal, hard).
  - Online play: rollback netcode over WebRTC, a relay fallback (also when a data channel goes quiet mid-match),
    lobbies, spectators, rematches, and CPU players in rooms.
  - Free Play (home → `battle/#free`): a name, then one shared field (stage 4-2's) for up to 8 players who come and
    go, hits and throws but no lost hearts; the first one in can start a battle for everyone there (up to 8 Links on
    The Field), whose results lead back to free play (`docs/netcode.md` "Free play").
  - All 10 arenas render, with their HUD, music and sound effects.
  - Mechanics: sword, stab, lunge, charge and spin, shield, knockback, pits, lift and throw, roll, items and orbs,
    hazards, the switch network, the GBA-screen side rooms, the Tower of Winds in side view (ledges, ladders, gates),
    bombchus, the giant-bomb Shadow Link, Dark World lighting, shadows, 3D lava and clouds.
  - Input: keyboard, gamepads and on-screen touch controls (`packages/input`), remappable.
- **One site (`apps/site`):**
  - `pnpm site:dev` → http://localhost:5191, with its lobby on :5185.
  - Pages: `/` (Shadow Battle's title screen), `/battle/`, `/online/`, `/adventure/` (Lake Hylia slice, linked from
    About). The dev tools (viewer, screens, sound test) left the site; they run from their own dev servers.
  - No disc import any more: every page loads its game files over HTTP from `<base>data/` (dev and preview serve the
    repo's `extracted/`; a deployment serves `pnpm bundle`'s `out/fso-data/`).
- **Checks:**
  - `pnpm test` runs 763 tests, and `pnpm typecheck` must be clean.
  - Browser flows, none needing a disc upload: `node tools/e2e/src/site.ts all` (Chrome and Firefox; `BASE=/fso/`
    for the deployed sub-path), `site-webkit.ts`, `touch.ts` and `mobile.ts` (phones in emulation), and
    `tools/e2e/src/{battle,battle-cpu,battle-mechanics,battle-online,free-play,game,viewer,screens,sound,netplay,perf}.ts`.
  - `node tools/e2e/src/tilemap.ts` compares the GPU tile renderer with the software one pixel for pixel.
  - `node tools/e2e/src/site.ts all --url=<url>` checks a deployment from outside.
  - Online, every peer's state hash must match on every frame.
- **Fidelity:**
  - Walking, sword, lift, throw, roll, knockback and items are measured in Dolphin (adventure mode).
  - Formats and tables are read from the disc and `main.dol`.
  - Battle-only numbers are traced in Shadow Battle in Dolphin: Link-on-Link combat, pits, held and thrown Links,
    shots, orbs, hazards, Vaati's time-up and the camera, the Tower of Winds' side view, 30 traces replayed frame by
    frame by the sim's tests
    (Backlog §B1, `docs/measurements.md`). What main.dol shows statically fills most of the rest ("Battle constants
    from main.dol"); the remaining guesses are marked `TODO(measure)` (B1's "Left" list).
- **Game files:**
  - `disc/Legend of Zelda, The - Four Swords Adventures (USA).rvz` (G4SE01 rev 0), extracted to `extracted/`
    (`pnpm --filter @fso/extract extract <rvz> extracted`); `pnpm bundle` → `out/fso-data/` (135 files, 40.9 MB).
  - Savestates: `ref/save-lake-hylia.sav`, and the Shadow Battle round starts `ref/save-battle-<arena>-<n>p.sav`
    (menu steps in `ref/battle/`). Dolphin 2606 is used with private user folders under `ref/`.
  - None of these are committed, and they must stay out of git.
- **The GBA BIOS:** a dump at `disc/gba_bios.bin` (16 KiB, your own) lets Dolphin's integrated GBAs boot FSA's client
  program, so Shadow Battle now runs and traces in Dolphin (Backlog §B1, `docs/measurements/battle-arenas.md` "Battle mode in
  Dolphin").

## Backlog

### B1. Measure battle-only numbers in Dolphin
- **How:** with the real GBA BIOS, Dolphin's four integrated GBAs multiboot FSA's client and Shadow Battle runs,
  scripted from power-on (`docs/measurements/battle-arenas.md` "Battle mode in Dolphin"):
  - `ref/dolphin-user-battle` (`tools/dolphin/src/battle-user.ts`): 4 GBA ports, the BIOS, a savestate hotkey on a
    pipe device;
  - `tools/dolphin/src/battle-states.ts` rebuilds the states: menus in `ref/battle/`, round starts
    `ref/save-battle-<field|flames|winds|castle|clouds>-<2|3|4>p.sav`, saved 10 frames before control, reloading
    deterministically;
  - `trace.ts` drives each GBA (`p1:right+B p2:A`), records the four Links (`--link <off>:<len>` adds chosen Link
    fields), each GBA's keys and the camera zoom, pokes RAM (`--write`: a Link's life at +0xBFC, his item at +0xC10,
    his position at actor + 8) and saves states at any frame (`--save`); `actor-trace.ts` records live actors by
    vtable; `fixture.ts --battle` turns traces into `packages/sim/src/dolphin-battle-traces.json`, 25 cases the sim
    replays frame by frame (`battle-measured.test.ts`).
- **Measured and applied** (2026-09-29; `docs/measurements/battle-combat.md` "Battle measurements: combat" and "Battle
  measurements: arenas, orbs and camera"):
  - the sword (`attacks.ts`): two boxes per direction against a ±7 px body (`HURTBOX`, hazards too), live all of a
    swing or stab, the lunge's ticks 6–14, the spin's boxes turning, the charging sword; damage = power / 2 (swing and
    stab 2, lunge 4, charged spin 4, charging sword 1; +1 at sword level 2); knockback 1.5 px/tick with the 3.0 hop
    (4.0 above 4 damage), 60 invincibility;
  - the shield blocks by facing (the attack's direction opposite the blocker's), spins too: both Links pushed 2
    px/tick apart while the box meets the body, then the push decay (× 0.9, × 0.95 above 2, zero under 0.2); two live
    swords meeting clash (a 15-tick tink); overlapping Links step 1 px apart each tick (a roll into a Link does only
    that);
  - pits: the anchor over the pit, placed 8 px inside, a 58-tick fall, a 64-tick jump onto the edge 7 px out, 2 life
    (`PIT_DAMAGE`), 180 invincibility (`RESPAWN_INVINCIBLE_TICKS`), dying on the edge on the last life;
  - held Links: 2 px higher, no time limit, free on the 17th direction press; thrown or free they hop 3.3 px/tick
    from z 18 and land unhurt; a thrown Link hits a third for 2 (0.75 px/tick, hop 4.0) and flies on; a slammed Link
    stuns the Link he lands on (90 ticks);
  - shots: the quick arrow 1 life; the quick seed stuns (90 ticks, then 60 invincible); the boomerang hooks and drags;
    another Link's bomb and a socket bomb: 4, 1.0 px/tick, hop 4.0; a socket regrows its bomb 60 ticks after;
  - hearts: 12 life (3 hearts) for every Link, the default; 2, 4 and 6 stay as options (`HEART_OPTIONS` 2/3/4/6);
  - orb generators in every TV arena (first orb 450 ticks in, items 150; orbs lie 899 ticks, items 599; the next
    1500 / 900 after the last; gated ones from their switch's tick), the roulette (`rouletteIcon`);
  - the battle camera (`apps/battle/src/camera.ts`: a box around the Links, FOCS points and Vaati, edges easing 0.1 at
    most 3 px, a 60-tick hold, 128 px of slack, the view ± 86 px at 608:448);
  - fire bars and the trick floor as the sim had them; the fire-pit jets (4, knocking from their flame's middle);
    Hyrule Castle's soldiers' chase; Vaati's time-up (he flies in, loops, leaves, everyone out 454 ticks after the
    time-out; no bomb);
  - game state +0x7E = 1, +0x7F = 0 in battle (the "several players" branches).
- **Left** (the `TODO(measure)` grep of `packages/sim/src` and `apps/battle/src`, and the notes in
  `docs/measurements.md`):
  - (done 2026-10-03, above: drawn shots, item levels, the Four Sword, taking items, orb drops, the cucco, Epona's
    ride, the bomb's timing, the boomerang's hook, the Tower of Flames' rim, soldiers not respawning at home);
  - (done 2026-10-05, above: the trick floor's respawn spot, the Field's corner by P2's start, the push state,
    Epona's trampling and the rider, the cucco's target, GEN3 soldiers' life and the sword on them, the bees' flight);
  - (done 2026-10-09, `docs/measurements/battle-open-items.md` "Battle leftovers, traced": the trick floor's far edges
    (+1 px), a trampled Link held at a wall (bounces on the 4th tick stopped with Epona off him), the cucco's heading
    (22.5° steps every 2-9 ticks, its velocity easing 0.3 to 3 px/tick along it), a bumped Link's walk frames, shots on
    the ground (height 0; a quick seed lobbed at 1.0438 px/tick, 0.1 px/tick²), the charge (no glow frame: effects));
  - the boomerang's flight through the house's middle block that stops arrows (the tile type doesn't tell them apart:
    read, not applied);
  - (done 2026-10-10: the bees' wake rule, a boots crash within 80 px, traced; B2 "The Pegasus Boots");
  - (done 2026-10-09: the bomb's flash, a blast hurting 12 ticks, the chain at once; the eternal flames' 1 life and
    0.75 px knockback, burning a tick after they light; the soldiers' stun (16 px/tick × 0.78, 25 ticks), their patrol
    and sight (100 px the way they look standing, the way they walk walking), read from main.dol and checked against
    the traces: `docs/measurements/battle-combat.md` "Bombs, the eternal flames and the soldiers, traced");
  - the soldiers: state 1's turn-back when blocked, an alerted soldier's chase at once (+0x280), the rule after a chase
    (`SOLDIER_KEEP_SIGHT` 128), their facing at the start;
  - smaller: the Four Sword's longer charge (main.dol: its counter runs on to 168 for another spin, with the effects
    619–622 by player; `docs/formats/jpa.md` "A charging sword"), not modelled.
- **What to watch:** `docs/measurements/battle-constants.md` "Battle constants from main.dol" lists, per item, the code or table the
  value was read from statically, how sure that reading is, and the RAM field or actor offset to trace.

### B2. Battle gaps
- **The GBA-screen side rooms** are simulated (`packages/sim/src/siderooms.ts`; research in `docs/formats/side-rooms.md` "Side
  rooms (GBA screens)", traces in `docs/measurements/side-rooms.md` "Side rooms"): The Field's house and cave, the Tower of Flames'
  north and south rooms and its side-view basement, the room under Above the Clouds' hole (holes, ladders, cannons, the
  shot back over the TV), Hyrule Castle's dark side through its magic circles. Their switches drive the TV: the eternal
  flames, the house's bomb rain, the lava stripes, the fire bars' turn, the Dark World Tower of Flames' bomb drops. A
  player inside gets a GBA inset by his HUD corner (`apps/battle/src/siderooms.ts`). The Tower of Winds (side view, its
  gates and gallery, the giant-bomb Shadow Link) and bombchus are done (above). Left:
  - (done 2026-10-05: things thrown or shot through doors and holes, above);
  - guesses: a ladder's top (the game's pushing pose), the side-view sword's boxes up and down, a bombchu crawling in
    side view and two bombchus meeting (read, not traced), steering a cannon shot, the cannon's easing at its ends, the
    TV marker on the timed return from the dark side, the giant bomb's fuse effects' exact spot (2026-10-10: not
    reached; the run went to the arena check and the boots);
  - presentation: (done 2026-10-05: BBSL's fading tint, the screen quakes; a thrown orb's quake 4 isn't applied, a side
    room's GBA inset doesn't quake). (Done: the door, gate, hole, cannon, circle sounds, the house door opening,
    the Shadow Link's and the giant bomb's sounds; the message window's messages, the castle circle's "10", the HUD's
    disc with the Link's sprite and the slide, the held hum and fuse: below.)
- **The message window and the HUD's side-room disc** (2026-10-03; docs/formats/j2d-and-bmg.md "The message window", "How the game
  drives main_bat", docs/measurements/screens.md "The message window and the HUD's disc in Dolphin"): `timeline.ts`
  `messageWindow` runs main.dol's one window (a request while it's up is dropped; {notice} once a match; 19 + 160 + 11
  ticks; at the top when a Link would be under it) over the requests: "P2 down!" (107 ticks after the knockout),
  Vaati's "30 seconds left!" / "Vaati arrives in 10 seconds!", and the sim's `BattleState.messages`
  (`packages/sim/src/messages.ts`: the castle circle's "You got 10 Dark World seconds!", an orb's content taken in a
  side room "P1 nabbed a crystal ball!", the giant bomb's "Escape to your Game Boy Advance!"), with their sounds
  (ATTENTION / ATTENTION_PINCH; Vaati's DEATH_WARNING and DEATH_COUNT_05…01, which replace LAST_COUNT). The castle's
  circle is enemy_gc_sob 302, the one with "10" on it. **`ONLINE_VERSION` 11.** (The angry cuccos' message 0x1B7:
  done 2026-10-05, hens.ts.) Left: the bombchu path of the orb's message (CRTL 0x80321D14, not decoded), where
  {notice} flags live in battle (the save file's: here once a match), what the GBA shows of the Dark World seconds
  (the inset's label "P1 · 9" is ours), the message window's text at the top not compared with a Dolphin frame.
- **What the arenas hold** (2026-10-10: boss500's actor lists, and the sim's switch network run 3 minutes in Hyrule
  Castle): the castle's TV (rooms 3, 8) has `GEN3` spawners of SLR2 bow soldiers (kind 0x08 at (112, 224) and (400,
  224), switches 7 and 8), an SLR4 captain (0x1D at (112, 224), switch 9) and an SLR3 ball-and-chain soldier (0x15 at
  (400, 224), switch 10), reached by the random soldier picks (30 → 14 → 11 or 15 → 12, 13 → 5–10; switch 9 rose 447
  ticks in with one seed, 7 within 30 s with another). The bow soldiers and the captain: **done 2026-10-10**
  (`packages/sim/src/castlesoldiers.ts`, the adventure's rules and constants, which adventure/soldiers.ts now takes from
  there; drawn in apps/battle from enemy_gc_sob as the adventure does; `ONLINE_VERSION` 22): an archer walks, looks
  round, closes on a Link it faces within 100 px and shoots arrows (3 px/tick, 2 life, blockable; a sword knocks one
  out); the captain marches on his attack/gather orders, winds up 47 ticks for a Link within 80 px and lunges (4, hard
  knock), his spear (3) and body hurt, his shield turns a sword from ahead; both take twice the Link's share and are
  knocked away as the sword soldiers are (12 and 24 life). Not traced in battle; assumed: no captain's group (the
  battle's SLR1s keep none, though GEN3 0x1B's params name group 1), so he never has followers and chases after his
  first lunge, and the archers never gather or flee; the knockback is the SLR1's traced one; a pit stops them as a
  wall. The SLR3 ball-and-chain soldier: **done 2026-10-10**, read statically from main.dol (castlesoldiers.ts
  `BALL_SOLDIER`, docs/measurements/battle-constants.md "Hazards"; `ONLINE_VERSION` 23): 32 life, it walks at the
  nearest Link at 0.3 px/tick swinging its ball round on a 70-px chain (400 angle units a tick, ×1.9 after each of its
  first two hits); the ball hurts 2 with a 6 px/tick knock (hit type 3), its body 2; struck, it's knocked 16 px/tick
  and reels the ball in for 30 ticks; a sword meeting the ball clanks. Not traced; assumed (TODO(measure)): one hit per
  reel-in, the clank cancelling that Link's strikes that tick, the ball's spin direction. The Pegasus Boots appear (The Field's mask
  0x1182; the castle's side rooms' 0x97E2): **done**, below. The hammer and the Fire Rod (only in the castle's side
  rooms, 0x97E2, which have no `DOSN`): **done 2026-10-11**, read from main.dol; **traced 2026-10-21**
  (`packages/sim/src/hammer.ts`, `firerod.ts`; docs/measurements/battle-combat.md "The Magic Hammer and the Fire Rod,
  traced", 11 replayed traces; `ONLINE_VERSION` 28): the pound (2 life, 4 charged after 48 ticks held) flattens a Link
  for 300 / 600 ticks and a charged one is a ground impact (bees, the jolt within 50 / 100 px, but no `DOSN` switch);
  pots and orbs ignore it. The fireball (or the held stream, up to 384 ticks) sets a Link alight: 2 life, he runs
  300 ticks steered by the stick, into pits, put out by shallow water, setting alight whom he meets; fire meeting a
  wall leaves a `BLZE` flame (2 life, the slow knockback, any Link: a burning Link grazing a wall is hurt by his own),
  fireballs and the stream burn bushes. CPUs use them since 2026-10-11, and steer a burning run, keep off `BLZE` flames,
  burning Links and fireballs since 2026-10-21 (B4). Fire on pots, orbs and soldiers and Above the Clouds' outer
  pits **traced 2026-10-28** (docs/measurements/battle-combat.md "Fire on pots, orbs and soldiers, and the plain pit,
  traced"; `ONLINE_VERSION` 30): fire takes 32 off a castle sword soldier (kills any; a fireball knocks a survivor
  along its flight, the stream stuns it on the spot, again every 25 ticks), flies through orbs, bursts on pots as on
  walls (sim unchanged there); a plain pit (tile type 0x03) puts a Link back where he last stood clear of it, no jump,
  then 60 ticks standing. Left (TODO(measure)): fire on the archers, the captain and the ball-and-chain soldier
  (applied alike, not reached in Dolphin), a burning Link's flame and `BLZE` flames on soldiers, the walking Link's
  stop and step on a plain pit's edge before he falls, the hammer's Action-button lock while flat, why the charged
  pound sets no `DOSN` switch, the effects' look. `DOSN` thud
  switches: The Field only ((128, 64) → 3, (256, 128)
  → 4, (144, 256) and (352, 256) → 1).
- **The Pegasus Boots** (done 2026-10-10; `packages/sim/src/boots.ts`, docs/measurements/battle-combat.md "The Pegasus
  Boots", 7 replayed traces; the run-up and crash first traced 2026-10-09, docs/measurements/battle-open-items.md
  "What wakes The Field's bees"): 10 ticks standing, then a 3 px/tick dash while A is held (steered 45° at 2.1), a sword
  attack all along (the sword's boxes, 3 life, blockable); head on into a wall a crash (bounced 2 px/tick with a 4.0 hop,
  33 ticks), a ground impact that sets the `DOSN` switches and wakes the bees within 80 px and makes Links standing
  within 50 px hop. The bees now wake only on that (main.dol's rule; the sword-and-blast stand-in is gone).
  **`ONLINE_VERSION` 20.** Since (2026-10-11, read from main.dol, not traced; `ONLINE_VERSION` 26): the dash strikes
  what a sword strikes (pots, orbs, bush tiles, soldiers, bees: the actors test the Link's +0x458 / +0x4A0 attack boxes,
  `strike.ts` dashStrikes), a level-2 crash jolts within 100 px, and a jolted Link (a crash's or a charged pound's)
  lands dizzy: state 12, the seed's 90-tick stun, then 60 invincible. Left (TODO(measure)): a trace of the dash on pots,
  bushes and soldiers, the stun after the hop, the dash into a ball soldier's ball.
- **Values to confirm or decode:**
  - Read from main.dol (2026-09-28, `docs/measurements/battle-constants.md` "Battle constants from main.dol"), applied to the sim, still
    to confirm in Dolphin: the eternal flames (1), bees (1), the knockback of the hit types not traced yet.
    (Confirmed since, see B1: sword damage, the shield's push, hit types 1, 4, 5 and 9, the jets' 4, the orb
    generators, their timeouts, the roulette, pit damage, a thrown Link's landing, escaping a hold, the camera,
    time-out = Vaati knocking everyone out.)
  - Item levels: applied (2026-10-03).
  - Some SWT4 details.
- **Details guessed rather than taken from the game:** some soldier poses, and the Links' light radius in battle
  (85 px). (The held and thrown Link sprites are traced now: 662–665.)
- **Presentation:** the round screens are the game's own now (above); left are the details listed there. The HUD's
  force gem counter is hidden in battle, as the game code does.

### B3. Visual and audio fidelity
- **Visuals:**
  - **Bugs (open):** (done 2026-10-09: an item fetched by the boomerang rides under it, its spot not measured;
    battle-mechanics.ts checks it) the real game also leaves pale afterimages behind a thrown boomerang, which we
    don't draw. From the former bug list: (done 2026-10-09) the Tower of Winds' Links "floating": the
    room had no light (its SWEV sets a blue one, level 180: Links and level now tinted alike) and the wall backdrop sat
    off by its quad's half size; Above the Clouds gets its SWEV tint too. Not reproduced in Chrome: the Tower of Flames'
    middle flame "drawn below the hole" (its place, size and layering match Dolphin to a pixel; probably the WebKit
    alpha bug fixed in c4e7fdc; recheck in Safari). (The boomerang "flicker" was the creature frame 104, fixed in 1d93849.)
  - JPA particles (done, above; 2026-10-10: the rank-by-life marks 933/934, a burning Link 578–585, the Links' dust
    979/975, the orb's 1380, the Tower of Flames' embers 680, and the heat haze 1357 over flames, fireballs and jets as
    a frame-copy pass that runs only while one shows; docs/formats/jpa.md; 2026-10-10: the Tower of Flames' screen-wide
    haze 1355 in the TV frame's own space, the torches' 1354 and the waterfall's ripple 1362, apps/game's pass too:
    `render/jpa/distortion.ts`). Left: 1347/1348 (group 5, who spawns them isn't known), 1356, 1358… (not listed); the
    frame copy's size in the game (assumed 608×448 for the indirect offsets) isn't measured (Dolphin's Tower of Flames
    shifts 9 % of the floor's blocks by 2-3 px, ours 2 %: a half-size copy would double ours); 1354/1362 are only
    checked for placement, not against Dolphin (no savestate by a torch or a waterfall); 980 (dust on tile 0x39) and
    the landing's water/lava variants; the ids the game remaps by state (Dark World?); colors a little more orange than
    Dolphin's;
  - the river bed under water and the boomerang's afterimages: done (`render/riverbed.ts` in apps/battle's The Field
    and, 2026-10-10, apps/game's water rooms with the cloud shadows; docs/formats/stages-and-tiles.md "River bed";
    `entities.ts` `AFTERIMAGE`, sprites-and-actors.md "Afterimages"). Against Dolphin (Lake Hylia room 3, the river's
    pixels): blue 205 before (no cloud shadows), 186 now, Dolphin 163, the cloud spread now Dolphin's (σ 28.7 / 28.8);
    the grass is 9 % darker in Dolphin too (not the water's). Left: the cloud level's rise in the adventure (the
    battle's assumed), the other afterimage kinds (the sprite drawer's tables, 0x80471060…) and who passes them (kind
    14: the minor Shadow Links, drawn in apps/game);
  - J3D GX lights, fog and billboards (checked 2026-10-10, docs/formats/j3d.md): no model on the disc enables fog; the
    lit channels only show where a TEV stage reads RASC/RASA: the `suisyo_*` crystals (also the only billboards),
    `osiro_mon` (Hyrule Castle's gate) and `poisonswamp00`, none of them drawn by an app yet (actor-spawned: who places
    them isn't read). Battle's `nagarekumo` is lit but its TEV ignores the channel; `yougan` is unlit. apps/game now
    draws the SEV2 stage effects (waterfalls, rainbows, the morning light). Left: placing those models, then the GX
    light from RAM (J3D's light objects) to emulate a lit channel;
  - BMG message text: parsed and drawn (`j2d/bmg.ts`, `render/screentext.ts`, the screens viewer's message browser;
    docs/formats/j2d-and-bmg.md "Messages (BMG)"). Left: most flow tags (group 2) are only named from context; the answer cursor's
    space count and most of the text layout (J2DPrint) aren't checked against Dolphin (the message window's one line
    is: 4 px off our centering); the battle uses "P2 down!" and Continue / Quit; apps/battle's DOM menus take their words
    from it (`menu-text.ts`, plain text, the page's own words as fallbacks): the arena names (menu and online lobby),
    "Shadow Battle", Rules, START!, "P1 WINS!" (local and online results), the results' Continue / Quit and the pause's
    Continue / Yes / No. Our rule rows (hearts, time limit, wins), the lobby's and the CPU levels have no message.
  - J2D screens: animations, indirect textures and the battle's round screens are done (above); left:
    the A prompt (`button.blo`) and checking gameover/map/collect/results/GBA window in Dolphin (`main_bat_ranking` and
    the pause are done: part 2);
- **Audio:**
  - IIR filter and reverb done (`effects.ts`, docs/formats/audio.md "IIR filter and reverb"); left: a Dolphin capture
    of the muffle (what the game writes to the tracks' port 0, and when, wasn't found), the FIR filter (unused);
  - the built-in DSP waveforms (0xF0+ programs) play (square/saw/pulse, `docs/formats/audio.md`), but their shapes and
    pitch are assumed from Dolphin's HLE, not checked against a capture of JA_SE_ITEM_NG or JA_SE_OBJ_BOYOYON;
  - the balance between sound effects and music isn't measured;
  - the high-frequency difference from Dolphin captures is unexplained.

### B4. CPU opponents (done)
- **The AI:** `packages/sim/src/cpu.ts` + `cpunav.ts` + `cpuswitches.ts`. It outputs the pad's button mask for one player per tick, a
  pure function of the state; its memory (target, plan, waypoint, the move under way, its own xorshift generator)
  is a flat record in `BattleState.cpus`, so clones, hashes and rollbacks cover it.
  - Navigation: walkable 8×8 cells (wall sensors, pit probe, colored panels as pits unless all show the CPU's color
    with 70 ticks left), Dijkstra fields to goals snapped to a 3-cell lattice (memoized per arena view), regions.
  - Behavior: picks the nearest reachable rival, approaches (straight or down a field), stands off his shield (sides
    or behind) and away from pit edges, swings, stabs, lunges, charges a spin from afar, lifts and throws (into a pit
    when one is in range), rolls in, uses items (aimed shots, cooked bombs, cucco, Epona), breaks orbs and picks up
    items, keeps away when low on hearts, swats soldiers and bees, mashes free, steers
    round hazards every tick (fire bars foreseen 16 ticks ahead, jets, flames, `BLZE` flames, burning rivals,
    explosions, bombs, the trick floor; shots, fireballs and charged rivals for normal and hard).
  - Levels easy / normal / hard (`TUNING`): reaction time, reach misjudgement, flanking, tricks, dodging, placement.
- **Where:** local slots in `apps/battle` (menu rows, `#cpu=`), online rooms (`MatchConfig.cpus`, `ONLINE_VERSION`
  4; `battleGame` plays them inside the step, so peers and spectators agree and nothing is sent).
- **Measured** (`pnpm --filter @fso/sim bench`, node 22, a busy M1 Pro): 4 CPUs cost 3-13 µs a tick together on
  average (the sim's step 6-16 µs); p99 13-144 µs (a new distance field is about 90-100 µs, a nav rebuild after a
  bush is cut 220-350 µs); an 8-frame rollback with the 4 CPUs thinking in every step, 66-231 µs. Duels on the 10
  arenas, both sides: hard beats normal 78%, easy 92%; normal beats easy 90%; every level beats a Link doing
  nothing. In 20 four-CPU matches (`cpu.test.ts`), none walked into a pit; about 5 a match get knocked or thrown in.
- **Side rooms and side view** (2026-10-02): a CPU walks, climbs and drops off ledges on side-view screens, follows a
  rival into a side room (by a door, hole or gate whose way out leads to him) when nobody is left on its own screen,
  leaves an empty one, shelters in the Tower of Winds' gallery while the giant bomb burns, and keeps off armed
  bombchus. Side-view rounds run longer (knockbacks drop Links off ledges): `cpu.test.ts` gives them 60 000 ticks.
- **Switches** (2026-10-09, `cpuswitches.ts`: each arena's floor switches and crystals followed through the switch
  logic to what they set off): normal and hard CPUs press a floor switch (lifting its pot or bush) or light a crystal
  (a socket bomb or their own, thrown against it) when its attack would catch more rivals than themselves: the jets,
  the eternal flames, the lava stripes, the trick floor, bombs raining in a side room a rival is in; hard ones also go
  into a side room for an attack on the whole TV (the Tower of Flames' bombchus). Easy never does. Duels after it
  (6 seeds, both sides): hard beats easy 57%, normal 65%; normal beats easy 70% (before: 56%, 65%, 58%). Bench: 4 CPUs
  2.6-11.4 µs a tick (3.7-8.8 before, same run, a busy machine), p99 13-125 µs. Also since: CPUs hit a rival a seed
  stunned (they used to wait him out, then stun him again), and don't take item after item at a generator while
  keeping away (each restarted the retreat).
- **Crystals lit together, throws into side rooms** (2026-10-10): crystals behind one SWT4 are a group
  (`cpuswitches.ts` partners, volleyOf: the fewest blast spots covering them); normal and hard CPUs light one when it's
  worth it ("volley"): top-down, a bomb of theirs put down by each spot (Hyrule Castle's dark side, 80 px apart, timed
  256); under crystals overhead in side view, bombs thrown up to blow against them (the sim's rule: a throw up there
  rises to the ceiling; fuse 12-22 at the press), two put down 100 ticks apart so the second blast comes within the
  first's 192 (the gallery's four: two spots, then the giant-bomb Shadow Link). Alone in a side room they check for a
  group before leaving. With a rival in a side room and nobody on the TV, a CPU near its door or hole throws a bomb
  (cooked) or a pot through it when he's in line on the other side ("toss"; seen in the Tower of Flames' matches, from
  its socket bombs). Easy does neither. Bench after: 4 CPUs 3.3-10.2 µs a tick (3.1-9.6 before, same run), p99 12-108.
- **Left:** the gallery's crystals need bombs there, and the Tower of Winds' generators hold none (its rain falls lit
  all at once, so two blasts apart never come from it): in a real match the Shadow Link is only called with bombs
  carried in, i.e. never; nobody has lit the gallery in Dolphin either (switch 21 was poked). Bushes aren't thrown into
  side rooms; tosses into a side-view room only go up or down (sideways, the drift isn't foreseen). Tuning is by
  self-play only: it needs a human's opinion of what feels fair.
- **The boots, the hammer, the Fire Rod** (2026-10-11, `ONLINE_VERSION` 26): a CPU dashes at a rival 28-200 px ahead
  (into his shield too), holding the button and steering onto his line, letting go before a pit, a hazard or a wall;
  pounds a rival in front of the hammer, and (normal, hard) holds a charged pound for a rival standing about or keeping
  away within its impact's reach (he lands dizzy, then the sword); shoots the fireball at a rival in line (140 px, one
  at a time, not at a burning one). They used to keep the boots unused and treat the hammer and the Fire Rod as empty
  hands. Self-play doesn't change (71-49 hard vs easy, 4 walk-ins, before and after): in 4-CPU matches on the 10 arenas
  no CPU ever held one (The Field's generator didn't hand out boots in 4 seeds, and nobody fetches from the castle's
  side rooms). Duels on the 10 arenas with one side given the item (6 seeds, both ways, 120 a cell; the same CPU with
  no item: 50%): boots normal 90%, hard 95%; hammer 66%, 54%; Fire Rod 97%, 98%.
- **Fire** (2026-10-21, `ONLINE_VERSION` 29): a burning CPU steers its run (cpu.ts `burning`): each tick (easy: every
  4) it plays each of the four ways' runs out straight ahead (60 ticks hard, 40 normal, 12 easy; the sim's own wall
  moves) and takes the best: into shallow water within reach along the cells (200 px hard, 120 normal), into a rival
  close by (90 / 60 px) whose back or side is to it or who is busy, else the run that stays clear longest of pits,
  hazards, `BLZE` flames, walls its flame would burst on (its `BLZE` hurts it) and the reach of rivals' swords, as far
  from them as it can. Easy does neither water nor rivals. Every CPU keeps off `BLZE` flames (going round a flame that
  stays put on the side of it it's on, rather than turning one way then the other) and burning Links; normal and hard
  also off fireballs (foreseen 16 ticks at full speed). Item duels re-run after the trace (`ONLINE_VERSION` 28, the
  same harness: 10 arenas, 6 seeds, both ways, 120 a cell), before → after: boots normal 85% → 85%, hard 88% → 88%;
  hammer 61% → 61%, 52% → 52% (unchanged: no fire in them); Fire Rod normal 89% → 82%, hard 87% → 74%; burns ending
  in a pit 33 → 0 (normal), 28 → 3 (hard), burns 391 → 284 and 400 → 272 (fireballs dodged). Most burns still end by
  the shooter's sword during the hop (172 and 184 of them): the 24-tick hop takes no stick, and the shooter walks up
  meanwhile. Self-play is unchanged (71-49 hard vs easy, 4 walk-ins, 60/60 against a Link doing nothing). A burning CPU
  costs about 55 µs a tick (two CPUs, one running alight; p99 130 µs, from 140 / 300 before the search was narrowed).
  Bench after (`pnpm --filter @fso/sim bench`, a busy machine; no fire in it): 4 CPUs 3.3-10.5 µs a tick (3.4-9.7
  before, same run), p99 10.6-106 µs (11.3-105). Left: the Fire Rod's stream isn't used; a burning CPU in side view (not seen in the game) is left running.

### B5. Online robustness
- **Rejoining** (done 2026-10-09, `docs/netcode.md` "Rejoining"): a reload or a lost lobby connection brings a player
  back into the running match in his slot (the lobby key, a snapshot from another player, his Link in from the next
  round; e2e `battle-online.ts` over WebRTC and the relay). (Done since: the rejoin frame is the arbiter's, so a sponsor
  leaving mid-rejoin leaves the next one the same; 2026-10-10: a page frozen in the background rejoins by itself
  instead of the "dropped" screen, and free rooms take rejoins, free play and its battles, `ONLINE_VERSION` 20; e2e
  `mobile.ts`, `free-play.ts`.) (Done 2026-10-11: a free room's player whose lobby connection dropped is *away*
  (`RoomInfo.away`, kept 2 min by the lobby): no restart, and the host's restarts keep his place (`start` with `keep`,
  absent from frame 0), so he comes back as himself, same P number and name, his Link in where it stood; a `leave`
  restarts at once; `ONLINE_VERSION` 27; `rejoin.test.ts` "absent", `server.test.ts`, e2e `free-play.ts` Dan.) (Done
  2026-10-21: a player who drops out of a battle started from free play is away there too, and the free play after it
  keeps his place, so he comes back as himself; `server.test.ts`, `netmatch.test.ts`, `online-game.test.ts`, e2e
  `free-play.ts` Finn.) Left: a player already away when the host starts a battle isn't kept through it.
- **Input delay** adapts to the network (done 2026-10-05: `adaptiveDelay`, the rooms' Auto; target refined
  2026-10-11, `docs/netcode.md` "The adaptive delay's target"): `ceil((RTT/2 + RTT deviation)/16.7 − tick lead + 0.25)`
  with hysteresis going down (`adapt.ts`), so 4.2 frames of steady latency settles at 5 (or 4/6 by tick phase) with
  no rollback (6.7 a second before), 2 ± 1.5 frames of jitter at 4–5 (4.2/s → 0). The spectators' buffer adapts to
  their feed's jitter the same way (was a fixed 4 frames drained at once: 30% of ticks stalled under that jitter, now
  0.2%). Left: nothing measured in real browsers over a real WAN; the delay climbs one frame per half second, so a
  sudden big latency step still rolls back while it climbs.
- **Disconnect rules** (done 2026-10-09, `docs/netcode.md` "Disconnects"): peers only report the players they lose; the
  arbiter (the lowest player of the group that still hears each other) decides every cut and relays the inputs up to it,
  so a partition inside a 3–4 player match cuts one player (`arbiter.test.ts`, e2e `partition`), and no cut is lowered
  after a frame settled (the false desync when two left at once: the lobby's "left" beat a third peer's lower cut).
  Spectators follow the next player when P1 leaves or is cut (`netmatch.test.ts`, e2e `feed`). (Done 2026-10-11:
  splits, `docs/netcode.md` "Disconnects": only a majority cuts, a tie goes to the lobby's first claim, the smaller or
  losing side drops out and its pages rejoin by themselves (at most once a minute, else a "connection lost" screen);
  a cut player rejoins by himself too; `arbiter.test.ts`, `netmatch.test.ts`, e2e `split` and `partition`.) Left: two
  arbiters in a row deciding differently is only detected (why: netcode.md). **Bug:** when a 2–2 split's losing half
  is P1 and P2, their pages don't get back in: "rejoin: no snapshot came" on both, and C and D keep them cut (e2e
  `battle-online.ts` `split`: it failed every time the lobby's claim went to P3 and P4's half, 2 runs in 7, before and
  after 2026-10-21's changes, and passed every time it went to P1 and P2's). A sponsor among P3/P4 doesn't answer, or P1's snapshot request goes nowhere.
  Rarer: a winner logs a loser's cut as "reported" rather than "timeout" (the check's timing).
- **Done 2026-10-12:** all three leftovers implemented and verified (unit
  tests; e2e the whole of `battle-online.ts`, `mobile.ts` and `free-play.ts`; one `free-play.ts` run showed a
  "WebSocket is already in CLOSING or CLOSED state" console error from a frozen page, not reproduced, likely Vite's
  client). The netmatch "feed" test and a battle particles test that timed out once in the full `pnpm test` were
  load, not this branch: 3 full runs green, the feed test takes 6.7 s of its 15 s (particles: 0.1 s, untouched here).
- **Game version:** peers must run the same build, since the protocol changed and there's an `ONLINE_VERSION`
  check. Deploy both lobby and site together.

### B6. Adventure (low priority; battle is the goal)
Status per milestone and what's left: `docs/ADVENTURE.md` "Status". In short:
- **Done:** every stage loads and is walkable (rooms on all sides, doors into GBA-screen areas in the GBA window), the
  four-Link formation and the push (traced), the adventure HUD, Octoroks, Keese and sword soldiers, Force Gems and
  their rains, keys and locked doors, chests, the switch machinery (PNPC, ZNSW, FOCS, YNSW), the goal with the quota.
- **Since:** swimming, ledges, side views (ladders, side swimming, cannons, wall doors), water warps and the whirlpool,
  waterfalls, the C stick's formations, the Links apart (X, the D-pad, Y), pushed boulders and blocks, two-Link rocks,
  the boomerang and the Fire Rod, all traced in Dolphin; a scripted player (`drive.ts`) and Lake Hylia's route
  (`lakehylia.ts`).
- **Lake Hylia is played to its goal** by the route, in node and in the browser (14 milestones, 23,575 ticks, 2,059
  Force Gems, the stage cleared, its fights without a Link out of hearts; Tingle's scene under room 5's bridge read
  through, `tingle.ts`, traced): rooms 50+ played as their alone variants
  (room 58 → room 8, traced), the Links apart holding switches, leaving an area alone and called back from it, `SWT4`'s latch, the raft, the side views' walk-offs and their followers (falls, cannon shots),
  keys lifted and carried (all traced), room 5's generator ambush fought (traced); what it skips or assumes is in
  `docs/ADVENTURE.md` M5 (room 58's Zora left, so its big gem stays hidden; the raft's riders box; the quota met by
  about 170 gems).
- **Enemies, generators, drops:** generators (`GENE`, `GEN3`) and kill counters (`SKIL`), room 5's ambush traced; drops
  by enemyparam.csv's `dasu` class (main.dol's tables, traced on the soldiers) and from bushes; the kill streak's
  falling gems (`SCRE`, traced: room 5's falling red gem); the sword soldiers as main.dol has them (patrols, looking
  round, the wind-up, the chase) with their attack slots (soldiers keep 40-56 px off an idle Link until one is struck:
  traced in rooms 5 and 9); from main.dol (`foes.ts`, `soldiers.ts`, `walkers.ts`, `waterfoes.ts`, `hinox.ts`,
  `wizzrobe.ts`, not traced): Tektites, Stalfos, Buzz Blobs, Poes, Mozos, rats, sand crabs, Armos, bow soldiers,
  captains and their groups, snakes, Zols (and what a two-Link rock holds), PAMEs, river Zoras and their fireballs, the
  side views' fish, Hinoxes (no grab), Wizzrobes and the Stalfos they raise; apps/game draws them at the game's sizes
  and alphas (SpriteMesh `setSize`, `setOpacity`), the ghost Poes with their textures.
- **Signs and dialogue:** signs and villagers talk on the GC's A (BMG messages page by page in main2D's boxes, timed
  as traced), items got show their pose and message. Lake Hylia's old man (room 1) and cave villager (room 58) talk too,
  through their message flows (branch4, ifFlag: `docs/formats/j2d-and-bmg.md` "Flows followed by the talk"; the
  controller count and the flags' timing are assumed). **The Cave of No Return** (boss011) is played by its route
  (`cavenoreturn.ts`) from its start to the stage clear (2,091 Force Gems, quota 2000: a thin margin): lamp, candles, movable tiles and points, `BLCK` blocks, pots,
  color blocks (the Links apart), locked doors, chests from below (traced); then the bow (`bow.ts`, from room 0's
  pedestal: assumed) and room 3 crossed with it, arrows lit at its torches (main.dol, untraced); then room 11's four-Link
  lever (`lever.ts`, main.dol), room 4's Shadow Link (`shadowlink.ts`: his first form, walk and swing traced; what beats his second form not) and room 5's goal. **Tingle's Tower** (boss012) is played by its route
  (`tingletower.ts`) to the stage clear (2,020 Force Gems; loaded in Dolphin by pokes, traced up to room 4 and for the
  rules its route leans on: currents, falls, river stones, ladders). **Hyrule Castle** (boss013) is played by its route (`hyrulecastle.ts`, 39 milestones) to the stage clear (2,535 Force Gems: room 6's gem rain, room 10's throne room and cannon columns), through Phantom Ganon (main.dol, untraced) and room 11's staircase (`RASN` kind 5: its destination is in its params, stairs.ts); the Links still die often in its fights (revived).
- **World 1 (the showcase), what's left per stage** — what beats the Cave's Shadow Link (his second form) and room 3's arrows checked in Dolphin, Hyrule Castle's untraced rooms and Phantom Ganon checked in Dolphin — with what's known,
  measured, the savestates and the next steps: `docs/ADVENTURE.md` "World 1: what's left".
- **Left:** the Links pushing each other, a key pushed on the floor, and C-stick formations held back by
  a blocked follower and the blocked dash's 0.3 slide (traced, not applied: the routes need rescripting for them;
  docs/measurements/adventure-lake-hylia.md "Adventure: formations against walls"), the soldiers' rarer variants (guards, circlers, kinds 1 and
  6), the Hinox's grab, the Armos as push blocks and on rails, the other ~20 placed enemy types (`POPO`, `DDRK`, `SLK2`,
  `TNDR`, `Poon`, `GROK`, `GOMA`, `SLR3`…), the spells' JPA effects, traces of the main.dol-only enemies (no savestate
  reaches their stages), bosses beyond Phantom Ganon (his Dolphin checks: docs/ADVENTURE.md), ice and quicksand, music and sounds, the held sword hitting
  walls; the other 31 stages' own puzzles.
- **Playtest 2026-10-10 (Lake Hylia, by hand with F8 captures):** fixed: RCK3 drawn (actor `bti` pieces had no
  texture source in apps/game), the followers' push frames on a pushed rock, a boulder let go mid-leg resumes its leg
  (it restarted its 64 px and overshot the river's gap), YNSW drawn at floor depth, open-door tile swaps only where
  floor is behind (Lake Hylia's and Hyrule Castle's doors copied solid wall: a black bar). Open, by size:
  - `FGAL`, the four girls (room 1): drawn only (no motion through their formations, no collision).
  - Done: a carried Lake Hylia stone (0x72) is drawn as the game's `STON` draws it, enemy_both2 41 (main.dol's lift
    check 0x802A1050 spawns `STON` for 0x72; docs/formats/adventure.md "The lifted grey stone"). Not checked against a
    Dolphin frame (the palettes as our renderer has them; it matches the tile's grey by eye).
  - Done: open doors show the game's open tiles (`doorlook.ts`, DOOR's tables at 0x8046D598/0x8046D628/0x8046D688,
    docs/formats/adventure.md "DOOR's open tiles"), every stage, the Cave's too (its passages now dark doorways, not
    copied floor). Drawn only: the open tiles' types aren't applied to collision (`actors.ts` EXPECTED: room 6's area 6
    door, one 8 px cell drawn floor but solid). A bombed cracked wall (kinds 2 and 4) shows its base pair and its top-layer
    row (the lintel, read in RAM: B6 "Playtest, World 1" item 7).
  - RCK3's colour (the BTI's own palette, pale grey) and placement (centred: guessed), unchecked against Dolphin.
- **Playtest checks (`tools/playtest`, `docs/tools.md` "Playtest checks"):** Lake Hylia's 22 puzzles bent 272 ways
  and its actors checked against their drawings, messages and tile swaps. Fixed: followers who jumped off a ledge
  before the Link ahead landed walked back up his path in the air into the bank (room 58's east ledge; `ledge.ts`
  stepJump drops those trail points on landing). Open, each a capture (`captures/playtest-*`, replayable):
  - Done: bushes cut in a room the Links apart are left in stay cut when the leader comes back (`away.cut`; not in Dolphin).
  - Done: a two-Link rock carried (rocks.ts "Carried"): a lifter held by a wall holds the leader, and the rock stays in its area (no door, edge, stairs or jump, no formation change); unchecked in Dolphin (`playtest-bent-house-rock-away-and-back`, now an EXPECTED rule).
  - Done: C-stick followers caught behind a wall corner (`playtest-bent-house-rock-from-another-side`,
    `playtest-bent-raft-from-another-side`, both now ok). Traced in room 3 round its rock: a follower left behind
    while the leader walks is put on the leader and dashes again (formation.ts; when exactly is inferred: no nearer
    his place and a straight way from the leader to it). Also traced, not applied (the routes were scripted without
    them; with the slide the Cave of No Return ends 22 gems short): a blocked dash slides at 0.3 of its step, and
    the four in their places walk as one, a blocked follower holding the leader (most of the four routes then
    stall). docs/measurements/adventure-lake-hylia.md "Adventure: formations against walls".
  - Done: the four-Link switch's catch, snap and pose traced (`logic.ts` stepFourSwitch, 2026-10-28): the four Links'
    bodies in its ±15 px box (2.5 px up) 6 ticks running, then snapped 8 px each way off the box's middle, a 95-tick
    pose, the switch on 79 ticks in. Lake Hylia's route walks to (128, 96) in room 2's cave and waits out the pose.
  - Done: the open doors' shut look (above): room 2's cave door and room 3's house door (`playtest-cave-door-look`,
    `playtest-locked-door-look`, replayed with `capture:shot`: open; their scenarios dropped from `bent.ts`).
  - Action facing a follower lifts him (the battle's lift of a Link) in the one-player adventure
    (`playtest-lift-a-follower`): what the game does, Dolphin.
  - Rules the sim has, unchecked in Dolphin (the variants fail by them): only the wide formation pushes the boulder
    and the area 6 block; a two-Link rock needs a second Link's lift point in the 32 px square round it (main.dol's
    RCK2: ±16; any two of the four, the two nearest); a C-stick formation walks as one (a follower against a wall holds
    the leader: traced, the corner slide not); the cave stone's lift point is 16 px ahead, and the route's spot (x 352) is on the edge of it.
- **Playtest, World 1 (2026-10-11):** `tools/playtest` now runs on the Cave of No Return, Tingle's Tower and Hyrule
  Castle too (`docs/tools.md` "Playtest checks"): 32 more puzzles bent 597 ways (`world1.ts`; 553 ok, 44 known
  results, each classed in `bent.ts` EXPECTED), and every placed actor checked and censused (`actors.ts --census`).
  **Done 2026-10-12:**
  - **3 (blocks): done for the Cave.** Open: Hyrule Castle's room 1 blocks still slide twice because its route's
    `travelTo(376, 66)` (and room 1's return milestone's) needs the second slide; the once-only rule is applied to the
    Cave only (`CAVE_STAGE`). Next: a Dolphin check of the castle blocks, then re-time that walk and the later
    milestones in the same change (the first try, a walk to y 72, broke room 57 later in the route).
  - **5 (crystal): done**, drawn swaps only (`logic.ts` drawnRewrites). Assumed: the crystal's write wins in the
    game. Next: a Dolphin check of room 3's crystal lit while switch 19 is on.
  - **6 (Shadow Links): done for the Cave and Castle** (`formats fsa/unsimulated.ts`); Lake Hylia's: see below
    (2026-10-18).
  - Verified: typecheck, pnpm test (893), playtest:actors (0 new), playtest:bent (0 new), e2e
    game.ts 3 of 3 (the earlier room-5 generator failure did not repeat; it was not a branch regression).
  Nothing else here is fixed. Ranked (captures from `--captures`, replayable with
  `pnpm -s capture:replay <name>`; a "(b)" item is a Dolphin check before any change):
  1. **Done (2026-10-11): Hyrule Castle's simulated things are drawn** (docs/formats/sprites-and-actors.md "Hyrule
     Castle's simulated actors"): `PLSW` both2 327 + its length class and `STBL` both2 449 at 2× (confirmed from their
     draws), `BARI` as its JPA effects 200/201 while it stands (confirmed; they play out when it goes), `PSWB` data.arc's
     `4hippari_switch_0-4.bti` by how far it's out (centring assumed), the escort Zoras both2 578 + FZRA's walk/stand
     animations (FAZR's own table assumed the same; facing read off its moves, standing it faces the leader: assumed;
     an arrival point shown from its switch until the fairy's, its fade not done). `playtest:actors castle` reports
     none of them; `tools/e2e/src/looks.ts` screenshots each. Left: the sim moves the escort into a new area ~80 ticks
     after the Links (unseen until then), and walks it among the Links rather than behind the last one; BARI's ±40 ×
     ±16 box (main.dol) against the sim's ±32 × ±8; the turned barrier kind; FZRA's fade.
     Complete (verified: pnpm test, typecheck, playtest:actors castle 0 new, looks.ts
     screenshots looked at); next steps are only the "Left" items above, plus a Dolphin frame to check PSWB's centring.
     `tools/e2e/src/game.ts` stopped in its Lake Hylia room-5 generator check (no live SLR1 to stab: the test's own
     `find()!`), unrelated to these draws and not checked against main.
  2. ~~Room 58's four crystals light only from the route's exact spot~~ **Done** (2026-10-12): the cross formation's
     spin traced in Dolphin and applied (`whirl.ts`, the crystals' ±5 box); `castle-crystals-spin / y ±1-3 px` pass.
  3. **Done (2026-10-11):** a moved movable block stays moved (tileblocks.ts stepBlocks: a tile that is a moved
     block's `to` doesn't start a slide), in the Cave only (`CAVE_STAGE`, measured in room 7). The corner variants
     are ok (the driver's `pushes` option: an off spot's walk can lean the block first, so the route's push goal also
     ends once it has slid). **Open:** Hyrule Castle's room 1 blocks still slide again, since its route's
     `travelTo(376, 66)` is reached only by that second slide (the block at 48-63 blocks the walk otherwise, and the
     same walk in room 1's return milestone). Unmeasured: check the castle blocks in Dolphin, then re-time that walk
     (changing a milestone's timing shifts the route's later checks: room 57 failed when tried). M.
  4. **Done:** followers no longer walk back up through a waterfall's face: over a falls-lip tile (Tingle's Tower,
     falls.ts stepTileFalls) the trails start again where the four land in the pool
     (`tower-falls-5 / idle 120 ticks` stays below the lip).
  5. **Done (2026-10-11):** the Cave's room 3 crystal's own tile wins over a PNPC's rewrite in the drawn swaps
     (logic.ts `drawnRewrites`: apps/game's patchArea and the census's drawn swaps). Collision keeps `rewrittenTiles`
     (a dark crystal's base tile is passable there). Assumed: in the game the crystal's write is the one on screen
     (not measured).
  6. **Done (2026-10-11):** minor Shadow Links aren't drawn where unsimulated: `HIDDEN_UNSIMULATED` (formats
     `fsa/unsimulated.ts`: the Cave's `ZSLJ`, Hyrule Castle's `ZSLH` and `ZSLJ`), skipped by apps/game's statics, and
     `playtest:actors --census` lists them "drawn: hidden". **Done (2026-10-18):** Lake Hylia's two stay drawn,
     standing facing down as Dolphin shows them (ZSLH was the hammer frame 363, now 16 like ZSLJ). **Done
     (2026-10-18):** room 4's ZSLH simulated (sim `minorshadow.ts`, traced: by time, not distance; three blows that stun
     the leader, the spin, the smoke, off the TV), Hyrule Castle's too; left: a sword on him, the camera widening, his
     sounds. **Done (2026-10-21):** room 3's doorway ZSLJ simulated (sim `minorshadow.ts`, traced: hops in place, a
     Link within 48 px sets him off, a 44-tick jump 125.16 px aside on his next landing, three of them, then ZSLH's
     spin, smoke and walk off; the door does nothing to him, the old "gone when the key opens it" is dropped), drawn
     with his shadow, his black afterimages (both minor Shadow Links: kind 14) and over the top layer in the air
     (assumed for the hops); left: a sword on him (state 0, read, never seen), his body against the Links, walls in
     his jump, his sounds, the Cave's and Hyrule Castle's (same code, still hidden).
  7. **Done (2026-10-21):** a bombed cracked wall shows the game's open look: its base pair and, one tile out from
     the wall, a row on the top layer (doorlook.ts `doorOpenTopTiles`, tables 0x8046D718/0x8046D728/0x8046D738; the
     layer read in RAM on Hyrule Castle room 5's bombed wall: docs/formats/adventure.md "DOOR's open tiles"). Hyrule
     Castle's room 5 garden wall and room 9's throne-room wall, Tingle's Tower's room 4 area 5 (`looks.ts` checks
     the three, shut then open). The open tiles' types still aren't applied to the collision.
  8. **Tingle's house villagers say nothing** (b): `JIJI` messages 843 and 844 are only a `branch` (2.07/2.10/2.2C)
     whose cond byte is unknown, not followed by MessageBook. Fix: read the cond in main.dol or Dolphin. M. **Done
     (2026-10-21):** read in main.dol: 2.07's byte is a switch of the current room (on: the first message), and
     `MessageBook.resolve` follows it. Room 11's switch 29 is never set, so they say 879 and 880: the horse race's
     texts ("And in last place…", "Here's your last chance…"; boss012 isn't the retail game's stage, its message
     numbers land there). Left: not seen in Dolphin; 2.10 and 2.2C still not followed (none in World 1's talk).
  9. **Out of hearts in the Cave's room 13, the four can be cut off** (b): bent timing let the rats at the top bite
     them out of hearts; they get up at the room's west entry (the sim's assumed revive place) with the blocks still
     pushed, and the way east is gone (`cave-big-block / let go 20 ticks in`). Fix: check the game over/revive in
     Dolphin (where the four get up, whether the room reloads). S once known.
  10. **Rules the variants fail by, unchecked** (b, each a Dolphin check): the chain lever takes only the column
      (`cave-lever`), the big handle only the wide formation (`castle-big-handle`), the throne not the cross, a `BLCK`
      not the cross (how the game counts pushers), each `SWTH` of room 57's pairs two Links (0x360; the east pair
      wants the box), the two-Link rock not the wide formation, the side view's pot lift after a thrown Link bounces
      off a pot (`castle-gap-throw / x -1 px`), the pot lift by room 58's switch from 1.4 px left of the route's stop.
  11. The Cave's kind-0 south doors (rooms 4, 6, 11) forced open look shut (b): whether they ever open in play. S.
  12. **Done (2026-10-21):** Lake Hylia room 6's whirlpool (`WARP` (416, 224), style 0x0E) is drawn: WARP's init
      (0x80228B60) makes JPA 1363 (a blue swirl, a screen distortion) and 1262 (sparkles) at its middle (424, 232), as
      RAM and a Dolphin frame show (docs/formats/jpa.md); Tingle's Tower's room 3 and room 7 ones too (the same code,
      not seen in Dolphin). The grey spiral over room 6's waterfall foam was PRTC's ripple 1362, which kind 0 doesn't
      make (392-394 only: RAM): gone, also from room 58's waterfall. `looks.ts` screenshots room 6's whirlpool on the
      route. Left: room 3's area 2 whirlpool (on a GBA screen the game spawns sprite actors for effects: not read).
  The traps are done (`traps.ts`, drawn): the Cave's room 1 fireball traps (`FBGE` ×5, traced in Dolphin: the shots,
  the hit, the key knocked out of the Link's hands, now any hit's) and the blade traps (`TRAP`, Tingle's Tower room 2
  ×2, Hyrule Castle room 9 area 2 ×2: read from main.dol, untraced, no savestate reaches them); the routes go round
  them. Left of them: a blade trap's run in Dolphin, the sword's clank sound on it, the big one's size (none in World
  1), their sparks on a GBA screen (the game's sprite actors).
  Not simulated at all, by whether a player would notice (`actors.ts --census`): **the Cave** — `ZSLJ` (6 above),
  `VWMD` (rooms 4-6's dark areas lit), `BGMN` (music changes), `SKUL` ×2 (room 2 area 5: a light source in
  main.dol's light table, r 30), `ZOMO` (room 3), `STGN` (room 12; both unread, hidden), the hidden controllers (`TINB`,
  `LTEV`, `SWEV`, `SWNP`, `GLWP`, `RAIL`); `YAJI` arrow signs are drawn (decor). **Tingle's Tower** — `WDRY` (room 4
  area 1, wooden gems: not there to take), `BFRY` (room 4 area 5's Great Fairy), `FLYO` ×17
  (room 10's flying floor tiles, static), `MJGR` (room 4, unread, hidden), `SWEV` (`VWMD`'s top mode, the underwater
  areas' water seen through, is drawn: sim logic.ts). **Hyrule Castle** —
  `ZSLJ` (6 above), `GFBS` ×3 (rooms 3, 6, 10), room 12's story demo (`DMCT`, `DMCR`) and
  `GOAL`, room 11's `BTIN` ×2 and `PRTC`, `AGBW` (room 5), `SZSC` (room 10; both unread, hidden), `BGMN`, `VWMD` (room
  58's dark areas 2-3), `ZOOM`, `SWNP`, `SWEV`, `RAIL`, `TINB`, `LTEV`, `GLWP`.
  The rest of the known results are the driver's (the path finder's grid lacks some actors' boxes; the route's holds
  assume where a shot or thrown Link lands) or variants that can't be fair (a released charge doesn't spin; pots come
  back with a room).

- **Lake Hylia drawing glitches (blind playtest, 2026-10-18).** Done: static actors sorted by their y in the room
  (apps/game `staticsZ`: they were placed at world y, so in every room below the grid's top row they drew over the
  Links); J3D stage effects drawn only from the current room's SEV2s (render `StageEffects.showRoom`, formats
  `EffectPlacement.also`: room 0's morning light no longer darkens room 1's east half); a carried bush/pot/stone drawn
  at the load's spot, not 8 px lower (Dolphin: its bottom meets the carrier's eyes; apps/battle entities.ts, both
  apps); the minor Shadow Links above. Checked faithful: room 3's red shield and grey puffs in the doorway (Dolphin
  shows the same figure; the puffs are base-layer doorstep tiles), the sign "over a Link's head" (base layer, the Link
  in front), the carry pose (704, right). Left: `FGAL` (room 1's girls) stand in their spawn column, the formations
  aren't simulated; (done 2026-10-28) room 9's soldiers (`SLR1` ×6, `SLR4`) all chasing to one spot and the knight drawn over the
  fence: they shove each other apart and keep their own boxes (±8, ±10 px) off the walls (traced,
  docs/measurements/adventure-enemies.md "Their boxes and the shove"). (Done: a `#room=N` start with a spot places all four Links on it (`createAdventure`); the followers
  used to start at the room's centre and walk through its enemies off screen, the "hearts lost with no enemy" of room 3.)

- **Cave of No Return findings (blind playtest, 2026-10-18), all checked faithful, nothing changed:** the HUD's empty
  heart slots are `heart_04_2` dots (docs/formats/j2d-and-bmg.md, checked in Dolphin); room 2's wait at 0 hearts is
  the knockback + the 76-tick death (docs/ADVENTURE.md "Out of hearts"); room 4's corner pots (0x40) lift from beside
  them, not from a step lower where only Link's cut corner touches and the lift point is on the floor
  (`cavepot.realdisc.test.ts`; the sword doesn't break pot tiles, as in battle); the dark figure at room 4's middle is
  Shadow Link (`SLK2`, spawned at (256, 192), the `#room=N` start's spot) drawn over the stacked Links: equal y, and
  the followers sit 1/16 px behind (the game's tie order isn't known).
- **The single-Link stone (tile 0x72, STON look) thrown:** drawn as the stone in flight since 2026-10-18 (carry.ts kept a
  pot's tile through the throw); its landing still breaks into the pot's shards and flies on the pot's speed and arc,
  both assumed: a Dolphin frame of a thrown STON landing would settle them.
- **Lake Hylia against Dolphin (2026-10-28):** each room's live actors read from Dolphin RAM dumps and compared with
  the sim's, frames side by side, and three input clips replayed in both. Matching: every placed actor's position, the
  room-change arrival spots, the box formation (0.0 px), room 9's soldiers closing in on idle Links. Different:
  1. Done (2026-10-28): slope tiles 0x08-0x0B, solid on one side of the diagonal by pixel; a Link walking into one
     slides along it by the corner sliding (docs/measurements/walking-and-sword.md "Slopes"; the leader's walk up room
     2's area 5 within 0.4 px of Dolphin's). The Field's arena has eight (its two worlds): the battle changed too
     (`ONLINE_VERSION` 31).
  2. Done (2026-10-28): the four-Link switch's catch, snap and 95-tick pose, read in main.dol and traced
     (`logic.ts` stepFourSwitch; from Dolphin's inputs the four match to 0.0 px through the snap and the pose). Left:
     from there Dolphin's door north takes the leader 98 frames after the switch, the right-hand Links pushing against
     the doorway's frame while he walks in; ours opens with the switch and the box formation stays held under the
     doorway by those Links (holdFormation), so the clip doesn't go through the door. Needs the `DOOR`'s opening
     timing (update 0x802C59D8) and when a pushing follower stops holding the leader (docs/measurements/
     adventure-lake-hylia.md "Room 2's cave").
  3. The camera's zoom varies (room 0 1.75, room 3 1.51, room 7 1.43 → 1.19, room 9 1.89 → 1.20, GBA areas 1.1875);
     ours is fixed at 2.14.
  4. The HUD changes corner (room 0 bottom-right mirrored, room 1 bottom-left; it left the top-left as the Links reached
     room 6's top-left); ours stays top-left.
  5. Winged Force Gems (`HNRY`) move by their params (room 7's, 0x71000: x 232.7 ↔ 389.4 at 0.8 px/frame, ~396 frames a
     round trip; room 6 area 6's and room 7 area 5's too; rooms 2 and 3's stay), bobbing 16-19 px over a gem-shaped
     shadow; ours are still, with no shadow.
  6. Smaller: room 6 area 6's `OBLF` slabs drawn by ours, not seen in Dolphin; room 0's `YAJI` arrows pulse on an
     80-frame cycle; the GBA window's "Z Close" label, and its empty space grey (41, 41, 41), not black; a clock icon
     with a digit beside the Links in room 6 area 5's side-view water (what it counts not known).
  7. Measured, already known: room 6's ladder foot out of the water is a push of ~20 frames, then a 27-frame ledge jump
     (state 56); ours walks out 34 ticks sooner (`TRACED_WATER_STAGES`).
  Not compared (no savestate reaches them): areas 3/2, 3/3, 3/5, 5/2, 7/6 and room 58.

### B7. Code health
- **Dependencies:** `playwright-core` is only in `tools/e2e`, for WebKit; its browser lives in `~/.cache/fso-webkit`
  (~335 MB, `PLAYWRIGHT_BROWSERS_PATH`).

## Running things (reference)
- **Install and check:** `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install`, then `pnpm test`, then `pnpm typecheck`.
- **Site:** `pnpm site:dev` → http://localhost:5191, lobby on :5185 (the game files come from `extracted/`).
  - Standalone apps: `pnpm --filter @fso/<battle|game|viewer|screens|sound-test|netplay> dev`.
- **Production:** `pnpm build:site`, then `pnpm site:preview` to try the production build.
- **Dolphin tooling:** see `docs/dolphin.md` "Dolphin reference captures" and `docs/measurements.md` (battle mode: its
  "Battle mode in Dolphin" section). Only one process at
  a time should use the GDB stub with `ref/dolphin-user`.
