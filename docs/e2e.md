# End-to-end scripts (`tools/e2e`)

Index of the docs: [README.md](README.md).

- `tools/e2e` — no disc needed: the dev servers and previews serve the game files. `src/ready.ts` is the shared way to
  open a page (`openReady(page, url, () => condition)`, `waitReady`: fails fast with the page's own error; `opfsEntries`;
  `leaveMatch`: from a Shadow Battle match back to its menu through the game's pause, Choose an Area, Yes;
  puppeteer or Playwright). `node tools/e2e/src/adventure-run.ts [url]` (World 1 chained: each stage marked cleared in the sim, the next loads, `#route` kept, the end screen's gems, Play again; game.ts's pages use `#run=off`). `node tools/e2e/src/game.ts [url] [outDir]` (walks Link, checks movement and collision, stabs and
  swings in 4 directions, lunges, charges and spins, stepping the game loop tick by tick for the screenshots; then the
  adventure: a room change up, a house both ways, an Octorok, Force Gems and the HUD, Lake Hylia's ambush and gem rain,
  room 5's generator (its soldiers walking in, a kill counted), Tektites (one killed: a heart) and a Buzz Blob's shock,
  snakes, a Zora and its fireball, Wizzrobes, a Hinox, PAMEs, Zols and ghost Poes counted and drawn,
  the key and the locked door, a chest, the goal, the stage list, a sign read; then Lake Hylia by its scripted route to the stage clear and
  the Cave of No Return's and Tingle's Tower's to their clears, a screenshot per milestone, Phantom Ganon
  fought to his end; the audio started by a click before each and checked after: each World 1 stage's BGM with notes,
  the boss music and fanfare, the cues that reached the synth, M muting),
  `node tools/e2e/src/cave.ts [url] [outDir]` (the Cave of No Return on screen by its route, ~3 min: room 6 darker
  than with `#nolight`, room 12 lit, the lamp's light round the four Links, room 6's candles lit, room 3's burning
  arrow's flame, room 11's chain levers, room 4's Shadow Link dark, his change's color roulette, then in a color and
  the room brightening to 200;
  `cave-*.png` screenshots, apps/game's dev server),
  `node tools/e2e/src/looks.ts [url] [outDir]` (World 1's looks by the routes, ~1 min: Lake Hylia's carried grey stone and
  the same stone in flight (still drawn as a stone), room 2's cave door shut then open and room 3's house door open, read back from the drawn base layer as the game's open
  tiles, room 6's whirlpool (its effects synced), room 5's Tingle under the bridge drawn while he talks, chants and floats off; Hyrule Castle room 1's area 6, a Link held overhead and thrown with the held frames, the bridge's tiles; the
  cracked walls shut then bombed open, base and top layer (Hyrule Castle room 5's and room 9's area 3's on the route,
  Tingle's Tower room 4's area 5's marked opened by hand; the traps: Hyrule Castle room 9's area 2's blade traps at
  rest and set off on the route, the Cave's room 1 fireball trap's shot (the Links put in its reach), Tingle's Tower
  room 2's blade traps at rest and one set off);
  `looks-*.png`) and
  `node tools/e2e/src/viewer.ts [url]` drive system Chrome headless (puppeteer-core) against the
  running dev server: load the game files, check the reload (HTTP cache, nothing in OPFS) and take screenshots into
  `out/e2e/`.
  `node tools/e2e/src/tilemap.ts` (no dev server needed; reads `extracted/`) checks the GPU tilemap pixel for pixel
  against the software `drawLayer`, animated tiles and overlay included.
  `node tools/e2e/src/screens.ts [url]` does the same for apps/screens (canvas + 1:1 `-raw.png` per screen), plus
  messages in the message window and the balloon (colors, picture characters, arrows, Japanese), the browser's page
  turn and search, and `setText`; then steps animations (a screen file is a snapshot of its animation: gameover.blo =
  frame 103 of gameover.bck, so that frame must match it; the title logo's glint must move).
  `node tools/e2e/src/battle.ts [url]` drives apps/battle: the intro (the Links hidden in their portals, the frame's
  zoom), the pause screen (the sim stopped, the cursor, a choice's question, No, Continue), every arena with 4 Links (actors, backdrops, HUD,
  the Dark World's darkness), a
  pit fall, a scripted 2-player fight through the round's screens ("P2 down!", "P1 WIN!", PRESS START, a press) to
  the Total screen and the results, every heart state, and the audio (the loop is stepped by
  hand, like game.ts). `node tools/e2e/src/battle-mechanics.ts [url]` lifts, carries and throws a Link and a
  bush, rolls, throws a Tower of Flames bomb, lifts a pot off a switch and stands on it (the fire pit's jets), walks
  into the fire pit's lava (the burning jump out, the landing's dust, the rank mark, the embers: JPA ids), lights a
  Dark World crystal with a bomb, shoots an arrow, charges the sword (the sparkle, the full charge's burst, glow and glint), flattens a Link with the hammer and sets him alight with the Fire
  Rod (his half height, the fireball's and the burning run's JPA ids), falls off an Above the Clouds panel of another color, and checks the
  fire bars, orbs, soldiers (the castle's GEN3 bow soldiers and captain drawn) and Vaati's bomb, and visits side rooms: The Field's house (its inset, the HUD's disc, its
  crystal's bomb rain on the TV, the exit mark), the Tower of Flames' north room (its switch lights the eternal
  flames), Above the Clouds' hole and cannon, Hyrule Castle's circle (its "10", its message) and dark side (the HUD's disc with his sprite, the slide); the message
  window at the top; the Tower of Winds in side view (no
  shadows, a fall off a ledge at 4 px a tick, a ladder, the gate into the gallery, the giant-bomb Shadow Link through
  his bomb's blast and its message, P1 spared in the gallery) and bombchus (the Tower of Flames' eight, the Dark Tower of Winds'
  crawling one) (screenshots in `out/e2e-mechanics/`).
  `node tools/e2e/src/netplay.ts [frames]` starts its own Vite + signaling servers and plays apps/netplay in
  pages of one headless Chrome (2 players over WebRTC / the relay / an impaired network, 4 players, a mid-match
  spectator): state hashes must match on every frame.
  `node tools/e2e/src/battle-online.ts` does the same for online Shadow Battle (own Vite on 5187, lobby on
  5188): the menus by hand, a knockout to "P1 wins" with a mid-match spectator, a rematch with a disconnect mid-round,
  4 players under 60±30 ms / 10% loss with an outage and a disconnect, a forced desync, 2 players + 2 CPUs with a
  spectator (and the name tags: up at the start, faded mid-fight), and rejoining: P3 of 3 reloads mid-round and
  comes back in his slot, over WebRTC, then over the relay with a lost lobby connection after it (identical hashes
  from his snapshot on), the link between P3 and P4 of 4 cut mid-round (P1, the arbiter, cuts P4 alone), and P1
  leaving with a spectator watching (P2 feeds it from then on); `E2E_ONLY=rejoin,duel,partition,feed,…` runs some
  scenarios only.
  `node tools/e2e/src/free-play.ts` (own Vite on 5242, lobby on 5243; `E2E_PORT`/`E2E_SIGNAL_PORT`): free play
  with players joining and leaving (restarts with everyone where they stood, the host's Battle mode button, P5's
  yellow tunic), the host's battle for five with a latecomer watching, its results, free play back after them, the
  host leaving; a page frozen past the cut in free play and one mid-battle, each back in its slot by itself, and
  one away (lobby connection dropped) from mid-battle until after the free play that follows, back in it as itself
  (identical hashes from its snapshot on; screenshots in `out/e2e-free/`).
  `node tools/e2e/src/battle-cpu.ts` (own Vite on 5198, `E2E_PORT`): 1 human vs 3 CPUs picked in the
  menu, to the results; the `#cpu=` deep link; a phone-sized page; the phone menu as "Vs. Computer" opens it
  (`#vs=cpu`: every Player/CPU picker in reach, a level picked, Fight by a tap) (screenshots in `out/e2e-cpu/`).
  `node tools/e2e/src/sound.ts [url]` drives apps/sound-test (dev server running): offline AudioWorklet render,
  live playback, a sound effect over the BGM.
  `node tools/e2e/src/site.ts [chrome|firefox|all] [--url=…]` checks the whole site in Chrome and Firefox
  (builds it and serves it with vite preview on 5193, lobby on 5194; `--url=` tests a deployment, `BASE=/fso/` a
  sub-path): the home page (game files, the game's art, the live logo and sky, browser checks, About, a phone-landscape layout), every page, remapped controls,
  online over WebRTC and the relay, the data (a second visit from the HTTP cache, `<base>data/` URLs, OPFS empty), a
  Chrome-hosted match joined from Firefox. `site-webkit.ts` does the same in Playwright's
  WebKit (Safari's engine; install once with `PLAYWRIGHT_BROWSERS_PATH=… node tools/e2e/node_modules/playwright-core/cli.js
  install webkit`) against a running site (`site-webkit.ts [url]`), plus a Chrome–WebKit match.
  `node tools/e2e/src/perf.ts [all] [--profile]` profiles battle frames (4 bots through fake gamepads, 1512×945 @2x:
  CPU per part, GPU, draw calls and the HUD's share, the particles' CPU and count, uploads) and online net ticks under lag (own servers on 5195/5196,
  `--ports=` to move them); `--phone` emulates a landscape phone (852×393 @3x, touch), `--cpu=4` throttles the page's
  CPU. `E2E_PORT`/`E2E_SIGNAL_PORT` override the fixed ports of site.ts, battle-online.ts, free-play.ts, perf.ts and netplay.ts
  (Vite only), for parallel runs.
  `node tools/e2e/src/mobile.ts` plays apps/battle on emulated landscape phones (844×390, 667×375, touch;
  builds it and serves it with vite preview on 5240, lobby on 5241): the menus by tap, a local match, two phones
  online through a rematch, a page frozen mid-match with no rejoin record (the "dropped" screen, the opponent's
  message, back to the room), a third phone frozen that rejoins the match by itself (identical hashes from its
  snapshot on), and one with no record that watches the rest, the relay fallback (no ICE, a data channel quiet one way), the portrait
  "rotate" screen; no horizontal scroll, no zoom, 44 px targets everywhere.
  `node tools/e2e/src/touch.ts [url] [chrome|webkit|all]` plays with the on-screen touch controls against a
  running site (pnpm site:dev): in Chrome's phone emulation with real multi-touch (CDP touch points), Shadow Battle's
  menu by taps (the first one starts the audio), a local round stepped by hand (walk, swing while walking, charge and
  spin, lift and throw, roll, an arrow, a knockout to the results), the pause button, the Controls dialog's touch
  settings (44 px targets), an online duel between two phones (own lobby on `--signal-port=`, 5197) and Lake Hylia; the
  page must never zoom or scroll. Then Playwright's WebKit with isMobile/hasTouch (taps; holds as pointer events).
  Profiles and screenshots in `out/e2e-touch/`.
  `node tools/e2e/src/capture.ts [outDir]` (own Vite servers on 5293/5294, `E2E_PORT`)
  checks captures and replays (`docs/tools.md`): a battle vs 2 CPUs and Lake Hylia played in real time, F8 and Shift+F8
  with a typed note write `captures/<id>/` (a temporary folder: `FSO_CAPTURES`) and the index line, each capture
  replays to its state hash in node (`replay.ts`, also `--at 60`) and in the page (`#replay=`), and `shot.ts` screenshots
  the replay.
