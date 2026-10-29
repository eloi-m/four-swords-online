# Apps (details and deep links)

Index of the docs: [README.md](README.md).

- `apps/site` — the website, for playing: one Vite build (root `apps/`) of the home page and the game apps' own
  index.html, on one origin. `pages.ts` maps them: `/` (home: Shadow Battle's title screen, i.e. the game's logo and
  sky from the game files, the logo then redrawn from title.blo with `title.btk`'s glint every 546 ticks by
  `src/title-logo.ts`, loaded lazily with three.js, then the title's 3D sky behind everything by `src/title-sky.ts`
  (title.arc's six `w_kumo*` J3D quads placed and animated as the title does, its lightning lighting them by `.brk`
  and its JPA bolts from data.arc, 60 Hz while seen, a still frame with reduced motion; `window.fsoSky.show(tick, …)`
  for comparisons with Dolphin); five modes: Vs. Computer → `battle/#vs=cpu`, Local Battle → `battle/#vs=local`, Online
  Battle → `online/`, Free Play → `battle/#free`, Adventure → `adventure/`, arrow
  keys + Enter like the game's menu; Controls and About as `<dialog>`s, About holding the
  game files' status, the browser checks, the adventure link, credits and the disclaimer; `src/home.ts`, laid out for
  a phone in landscape too), `/online/` (→ `/battle/#online…`), `/battle/`, `/adventure/` (apps/game). The dev tools
  (viewer, screens, sound test) aren't in the site: run their own dev servers. The `site` plugin in `vite.config.ts` points the
  apps' `/src/` URLs at their own folder, adds `src/nav.ts` (home link) and moves the built HTML. The game files are
  not in the build: dev and preview serve them at `<base>data/` (`tools/bundle`'s plugin), a deployment from
  `pnpm bundle`'s folder. `pnpm site:dev` (lobby + dev server, http://localhost:5191), `pnpm build:site` → `apps/site/dist`
  (`BASE=/sub/` for a sub-path, `VITE_SIGNAL_URL` for a lobby elsewhere, `VITE_SOURCE_URL` for a source link),
  `pnpm site:preview`. Keep the apps working standalone: a new app page = one entry in `pages.ts`. Every page gets a
  web app manifest (`manifest.ts`, at `<page>/manifest.webmanifest` under `BASE`): Add to Home Screen opens the battle
  and the adventure fullscreen in landscape.
- `apps/game` — the Hyrulean Adventure (`pnpm --filter @fso/game dev` → http://localhost:5174; the site's
  `/adventure/`): any stage (`#stage=boss0WS`, Lake Hylia by default; Esc or the pause button opens the stage list,
  named from the game's messages), the four Links in formation (`#players=1-4`), GBA-screen areas in the game's GBA
  window, the game's adventure HUD (`main_adv.blo`), a banner for the quota and the stage clear. Deep links
  `#room=1&x=300&y=280` (room-local spawn, the four stacked there), `#debug` (collision + hitbox + sword box), `#player=0-3` (tunic color).
  Dev server only: F8 captures, `#replay=<capture id|latest>[&at=<tick>]` (`docs/tools.md` "Captures and replays (F8)").
  `#route` (Lake Hylia, the Cave of No Return, Tingle's Tower or Hyrule Castle played by its scripted route;
  `#stage=boss013&room=11&route` the Phantom Ganon fight, `ganon.ts` draws him; `window.fso.route`). J/Z = sword, L/C
  action, K/X item (the GC's A: also talks, reads signs and opens a chest from below; `dialogue.ts` the message boxes) (keys and gamepad from `@fso/input`), T/F/G/H the C stick's formations (box, cross, long, wide; or a
  gamepad's right stick); on touch screens the on-screen controls over the scene's corners. `view.ts` (rooms on the grid, PNPC tile patches), `camera.ts` (the TV camera as main.dol has it: a box round the leader and the points the room's actors hand it, its zoom with them, the whole room behind a GBA area; docs/measurements/adventure-lake-hylia.md "the TV camera"),
  `enemies.ts` (enemies at the game's sizes and alphas, the ghost Poes' textures, pickups, chest contents, the Cave's chain levers and Shadow Link), `light.ts` (the rooms' darkness from their `LTEV`s and the lamp's, torches', candles' and burning arrows' lights, through apps/battle's light pass; `#nolight` turns it off), `hud.ts`, `gbawindow.ts`, `stages.ts`; the actors' particles of the leader's room and its neighbours (the waterfalls' spray,
  torches). `sound.ts`: the stage's BGM and the adventure's sound effects (docs/ADVENTURE.md "Music and sounds"),
  started on the first key, click or tap; M or the sound button (top right) mutes, `#mute` for this page only.
  World 1 plays as one run (`run.ts`): a stage cleared shows its banner ("Next: …") 5 s, then the page loads the
  next one (Lake Hylia → Cave of No Return → Tingle's Tower → Hyrule Castle; hash and reload, other deep links such as
  `#route` kept, so `#route` plays the whole world), then `#stage=end`: the end screen ("World 1 cleared", the Force
  Gems per stage kept in sessionStorage, Play again / Stage list). `#run=off` stops at the banner (the e2e scripts do).
  A cleared stage hands the next one its Links' hearts and the leader's item (`carryOf`/`applyCarry`, sim adventure.ts;
  kept in sessionStorage like the gems, so a reload keeps it; the stage list, a deep link and `#run=off` start fresh;
  the carry is assumed, unmeasured, and keys and gems don't carry).
  `window.fso` exposes state
  for tests.
- `apps/netplay` — Lake Hylia for 2–4 players online (`pnpm --filter @fso/netplay dev` → http://localhost:5184, with
  the signaling server running): two tabs, create/join a room by its word. Deep links `#create`, `#join=WORD`, `#spectate`,
  `#transport=auto|webrtc|relay`, `#delay=2`, `#lag=80&jitter=30&loss=0.1`. `window.fso` exposes the match.
- `apps/viewer` — browser map viewer (Vite + three.js). `pnpm --filter @fso/viewer dev` → http://localhost:5173.
  It loads the game files from the dev server (`/data/`, see `tools/bundle`). Deep links: `#stage=boss010&room=1&zoom=2`
  (add `&actors` for actors drawn as sprites where their graphics are mapped, `&actors&markers` for plain markers), `&effects` (3D effects and the
  actors' particles; `&efftick=N` freezes them), `#jpa=<id>` (the particle effect browser at the view's center: `&jpatick=N` freezes it,
  `&jpascale=`, `&jparaw` without the game's placement; `window.fsoParticles`),
  `#x=…&y=…&scale=…` (camera center in world px and CSS px per world px, to match a Dolphin frame).
- `apps/screens` — J2D screen viewer (HUD, menus): `pnpm --filter @fso/screens exec vite --port 5180`. Pick an
  archive + `scrn/*.blo`, toggle panes in the tree. Deep links `#arc=game2D.arc&scrn=main_bat.blo`
  (`&all=1`, `&hide=`/`&show=` tag regexes, `&tex=Tag:file.bti`, `&move=Tag:x,y`, `&bg=none`). Parser in
  `packages/formats/src/j2d/`, renderer `packages/render/src/screen.ts`. Message browser (`messages.ts`): the BMG
  files' messages by id or text, shown page by page in a message box screen: `#msg=0xc8[&bmg=e|ek|jp|jpk][&page=1]
  [&box=hukidashi]`; `window.fsoScreens.setText(tag, text)`. Animations panel (`src/anim.ts`): `&anim=title.btk,…` (or
  `&anim=auto`, the screen's own), `&frame=30`, `&play=1`.
- `apps/battle` — local Shadow Battle, 2–4 players on one machine: `pnpm --filter @fso/battle exec vite --port 5181`.
  A menu in the site's theme (the Shadow Battle plate; Arena, Fighters and Rules panels; each Fighters row: the Link's
  icon, Player or CPU easy / normal / hard, humans taking the keyboards and gamepads in order; on touch screens only
  real controllers count, a first visit makes P2–P4 CPUs, and a human without a controller is told to pick a CPU; a
  landscape phone gets it on one screen). P1 = WASD + J sword / K action (lift,
  throw, roll; the GC's R) / L item, P2 = arrows + `,`/Num0 sword, `.`/Num. action, `/`/NumEnter item, then each gamepad
  (A sword, B item, X/RB/RT action); all remappable in the menu's Controls dialog (`controls.ts`; bindings in
  `@fso/input`, saved in localStorage `fso.battle.controls`). On touch screens the on-screen controls also drive P1: a
  stick, Sword/Item/Action and a pause button that does what Esc does (the Controls dialog sets them to show on touch
  screens, always or never, their size and opacity). Esc, a gamepad's Start or the pause button open the game's pause
  screen (`pause.ts`: game2D `pause.blo` over the dimmed arena, the sim stopped; Continue, Choose an Area → the menu,
  Choose a Game → the site's home page, each choice asked in main2D's warning window with BMG 0x10B / 0x10C; arrows,
  Enter / the players' A, Backspace / B; see-through `#pause` buttons over the items for taps, and a Controls button;
  its timeline `pause-state.ts`, tested in node; at the match's end Esc is the results' Menu). Deep links
  `#arena=0-9&players=2-4&hearts=2|3|4|6&time=<s>&wins=<n>&start`, `#cpu=2,3` or `#cpu=2:hard,4:easy` (CPU players by
  number, normal by default; players grows to include them), `#vs=cpu` (P1 plays, the others are CPUs at their last
  level) / `#vs=local` (everyone plays), applied once, dev server only: F8 captures and `#replay=<capture id|latest>[&at=<tick>]`
  (`docs/tools.md` "Captures and replays (F8)"), `#debug` (collision, hurtboxes, sword boxes),
  `#camera=full`, `#mute` (M toggles; audio starts on the first key, click or tap), `#seed=<n>` (what the item orbs
  hold), `#nolight` (the Dark World without its darkness), `#touch=on|off`. `window.fso` exposes state for tests
  (`fso.touch`: the on-screen controls). Rules live in
  `packages/sim/src/battle.ts` (rounds) and `combat.ts` (hits, shield, knockback, pits); arenas in `arena.ts`, their
  hazards and orb generators in `props.ts`; lifting/throwing `carry.ts`, rolling `roll.ts`, items `items.ts`, orbs
  `orbs.ts` (items taken with Action, orbs dropping), an orb's cucco `cucco.ts` and Epona `epona.ts`, bombs `bombs.ts`, shots `projectiles.ts` (drawn arrows pin a Link: combat.ts `pinFighter`), hazards `hazards.ts`, the switch network (logic actors, spawners,
  crystals) `switches.ts`, Above the Clouds' colored panels `panels.ts`, the tiles a round changes `arenatiles.ts`,
  Vaati's time-up `timeup.ts`, the GBA-screen side rooms `siderooms.ts` (each room's sublayers 1-7 laid out below the
  arena, k × 512 px down: doors, holes, side-view rooms with ladders and cannons, Hyrule Castle's magic circles to its
  dark side; `screenAt(y)` = the screen a Link is on; side view = the top-down game with gravity, `sideViewAt`: the
  Tower of Winds' TV and gallery, its gates), bombchus `bombchus.ts` (BMTY: GEN3 spawners, the orbs' roulette, crawling
  round surfaces in side view), the Tower of Winds' giant-bomb Shadow Link `giantbomb.ts` (BBSL and his bomb BBMB, switch
  21), the message window's requests the state can't tell afterwards `messages.ts` (`BattleState.messages`: the castle
  circle's, an orb's content taken in a side room, the giant bomb landing, the angry cuccos; `ONLINE_VERSION` 13), things
  thrown or shot through doors and holes (siderooms.ts `thingWarps`), the push state `push.ts` (leaning on a wall; shared
  with the adventure; The Field's house door opens as a Link faces it), The Field's cave cucco and its angry cuccos `hens.ts`,
  free play `freeplay.ts` (its map: stage 4-2's field, `freeWorld`; its spawns, and
  `createFreePlay` with the Links that stay where they stood), all on the plain
  entities of `entities.ts`; CPU players `cpu.ts` (a battle AI giving the same button mask a pad does, its memory in
  `BattleState.cpus`: `addCpus`, `cpuInputs`; navigation in `cpunav.ts`), called by `main.ts` and `battleGame`.
  Presentation only reads the state: `menu-art.ts` (the menus' game art: `setMenuArt`, `fillArt` for HTML built
  later), `hud.ts` (the J2D `main_bat.blo` HUD; a corner a Link stands in front of fades out, main.dol's boxes; a Link
  in a side room gets the black disc with his live sprite at 1.5× and the ranks' ring, his other groups slid 15 px in;
  the L2 badge over a level-2 item), `ranks.ts` (`main_bat_ranking.blo`'s 1st-4th by the portraits while
  lives differ, over the heads for 180 ticks after play starts or the ranking changes), the game's own round
  screens in the HUD's scene (docs/formats/j2d-and-bmg.md "Shadow Battle's round screens"): `timeline.ts` (what shows when, from
  the state: the 409-tick intro with the Links' own (portals at 42, shown at 157, the frame's zoom onto each player and
  his corner after it: `afterimages`), the message window (`messageWindow`: main.dol's one window over the requests,
  "P2 down!" 107 ticks after a knockout, Vaati's warnings and the actors' `BattleState.messages`, a request while it's
  up dropped, at the top when a Link would be under it: `messageAtTop`; `messageSound`), the end camera from 138 and the winner's
  pose from 270 (`endCamera`, `winnerPose`), the result at 294, PRESS START at 423, the Total screen's sequence; tested
  in node), `banners.ts` (`BattleScreens`: "Be the last one standing!", "Go!", the
  message window with BMG texts ("P2 down!", "You got 10 Dark World seconds!", "A giant bomb! Escape to your Game Boy
  Advance!"…), P1-P4 WIN! / DRAW!, PRESS START, the last seconds' digits, the fades; `pictures.ts`
  builds the code-made J2D pictures as a screen), `total.ts` (result.arc's Total screen and flying star with its JPA
  sparkles in the screen's space; no arena is drawn under it),
  `results2d.ts` (the local match's end: a press on PRESS START, then Continue / Quit, `#results` laid see-through on
  the J2D buttons), `screen-files.ts` (their archives, the US messages and font), `scene.ts`
  (letterboxed 608×448 TV frame, static actors), `entities.ts` (the sim's entities, the round's tiles, the trick floor's hole),
  `particles.ts` (the game's JPA effects from the sim's state: the fire pit's jets, the fire bars' fireballs, lit
  eternal flames, fuses, explosions, cut bushes, broken pots and orbs, sword hits, the lava, the intro's portals, the
  winner's sparkle, the Tower of Winds' gates and giant bomb; their sprite stand-ins are skipped), `backdrop.ts` (what shows through transparent tiles), `lights.ts` + `lighting.ts` (each room's LTEV light: the Dark
  World's darkness with a light around each Link), `cloudshadow.ts` (The Field's and the castle's drifting cloud
  shadows), `shadows.ts` (sprite shadows), `quake.ts` (the screen quakes: bombchus, the giant bomb), `siderooms.ts` (a GBA-sized inset by the HUD corner of each player in a
  side room, online only one's own, labelled with his Dark World seconds; the TV's marks where a Link comes back out), `sound.ts` (BGM + rollback-safe cues keyed by the tick their
  cause started; held sounds, the open circle's hum and the giant bomb's fuse, while their cause lasts).
  **Online** (menu → Play online): `pnpm battle:online` runs the lobby server with the dev server (which proxies
  `/signal` to it) → http://localhost:5181 in two tabs/browsers, create a room in one, join by code or invite link in
  the other. One Link per browser (P1 keys, the first gamepad or the on-screen controls), `` ` `` = netplay stats, Esc
  (or the on-screen pause button) = match menu (the lobby's buttons see-through on the game's pause plate: Continue, End
  the match for the host, Leave; the match goes on). Code in
  `online.ts` (controller), `online-game.ts` (config, initial state, `battleGame` with departed players removed and
  the CPU players played inside the step; tested in node), `lobby-ui.ts` + `online.css`, `netstats.ts`, `nametags.ts`
  (the players' names over their Links as tunic-colored pills, "You" over one's own, through each round's countdown
  and its first 3 s, then faded; placed from `ArenaView.heads`); `main.ts` only draws `online.game`. Deep links
  `#create&autostart=2&arena=3&hearts=2&time=60&wins=1&delay=2&cpus=normal,hard` (CPU players after the room's,
  also picked in the room), `#join=WORD[&spectate]`, `#name=`, `#server=`,
  `#transport=`, `#ice=fail` (WebRTC never connects: the relay fallback), `#lag=&jitter=&loss=`, `#delay=N|auto` (the
  input delay; Auto, the default, adapts to each peer's round-trip time: packages/net `adaptiveDelay`), `#finals` (hash every
  final state; on by default under automation, `#finals=0` off). `window.fso.online` exposes the net match
  (`script = (frame, state) => buttons`, `finals`). A page back from the background after the 3 s disconnect (a
  locked phone) gets the "dropped" screen: watch as a spectator or back to the room (docs/netcode.md).
  **Free Play** (the home page's, `#free`, `&name=` goes straight in): a name prompt, then a free room (the lobby's
  `free`, up to 8) and free play's map, no room screen: everyone runs around and fights without losing hearts
  (`MatchConfig.mode` "free"); the host (the first one in) restarts it whenever someone joins or leaves, the others
  standing where they were (`at`, `initialFree`, `online.ts` `keepFree`), and has a Battle mode button in the bar over
  the map: a Shadow Battle on The Field for everyone there (up to 8 Links: no HUD corners past 4, the name tags stay
  up with hearts and stars; `#hearts=&time=&wins=` override the default rules), whose results lead back to free play
  8 s later; newcomers watch it. Leave goes to the site's home page. The map is `ArenaView.showMap` (the stage's rooms
  side by side, the battle camera over the whole map), 8 tunic colors (`PLAYER_COLORS`), The Field's music.
  **Phones:** `mobile.ts` (fullscreen and landscape lock on `[data-fullscreen]` taps, the screen wake lock during
  matches, the invite through `navigator.share`); `style.css`/`online.css` have the touch rules under
  `(pointer: coarse)` (44 px targets, no zoom or selection), the short-window layouts under `(max-height: 540px)` and
  the "rotate to landscape" screen (a phone held upright gets the menus and the name prompts, and is asked to turn
  once the room or the match shows).
- `apps/sound-test` — BGM and sound-effect player (`pnpm --filter @fso/sound-test exec vite --port 5178`); `window.soundTest` for tests.
