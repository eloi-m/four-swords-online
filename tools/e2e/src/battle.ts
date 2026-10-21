// Shadow Battle in headless Chrome: shows every arena with 4 Links (static actors, backdrops and the
// J2D HUD), falls into a pit, plays a scripted 2-player fight (P1 walks up to P2 and swings until P2 is out) and
// checks the results screen, the HUD's hearts (full, partial and empty) and the audio (AudioContext running, BGM
// notes, sound-effect cues). The game loop is stepped by hand (its requestAnimationFrame callback is captured), so
// every run sees the same ticks. Expects the dev server (pnpm --filter @fso/battle exec vite --port 5181).
//   node tools/e2e/src/battle.ts [url] [outDir]
import { mkdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import puppeteer, { type Page } from "puppeteer-core";
import { openReady } from "./ready.ts";
import { browserPath } from "./browsers.ts";

const CHROME = browserPath("chrome");
const [url = "http://localhost:5181/", outArg = "out/e2e"] = process.argv.slice(2);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });

const COUNTDOWN = 409; // packages/sim COUNTDOWN_TICKS
const ARENAS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
// Room points whose tiles are transparent, where the backdrop must show (Tower of Winds, Above the Clouds).
const BACKDROP_PROBES: Record<number, [number, number]> = { 2: [256, 110], 7: [256, 110], 4: [30, 190], 9: [30, 190] };
// The Dark World rooms, and a room point far from the Links' and flames' light there.
const DARK_ROOMS = [5, 6, 7, 8, 9];
const DARK_PROBES: Record<number, [number, number]> = { 5: [256, 40], 6: [256, 60], 7: [256, 40], 8: [256, 60], 9: [30, 20] };
// The rooms whose light is on outside the Dark World: room 1 (as before), and the Tower of Winds (2) and Above the Clouds
// (4), whose stage light a SWEV sets (lights.ts SWEV_LIGHTS; off in this check before e8b54f6).
const LIT_ROOMS = [1, 2, 4];

// Shapes read back from window.fso (see apps/battle/src/main.ts).
type Player = { x: number; y: number; facing: string; action: string };
type Fighter = { hearts: number; mode: string; invincible: number; stars: number };
type Battle = { phase: string; round: number; fighters: Fighter[]; hits: { attacker: number; victim: number; blocked: boolean }[]; matchWinner: number; rules: { hearts: number } };
type Game = { tick: number; players: Player[]; battle: Battle & { entities: unknown[] } };
type AudioStats = { seconds: number; bgm: { playing: boolean; notes: number; missing: number }; se: { started: number; notes: number; missing: number } };
type Audio = { state: string; contextState: string; time: { played: number; startedAt: number }; stats: AudioStats | null; log: { tick: number; name: string; sent: boolean }[]; error: string | null; missing(): string[]; arenaBgm(room: number): string | null };
type View = {
  cameraMode: string;
  drawnActors: { id: string }[];
  entities: { drawn: Record<string, number> };
  lighting: { active: boolean; drawn: number; enabled: boolean };
  missingModels: string[];
  toScreen(x: number, y: number): { x: number; y: number };
  render(game: Game): void;
};
type Hud = { snapshot(): { hearts: string[]; fade: number }[]; visibleRoots(): string[][]; update(game: Game): void };
type Screens = { visible(): string[] };
type Total = { last: { s: number; stars: number[]; winner: number; cursor: number | null } | null };
type Fso = { mode: string; game: Game; view: View; hud: Hud; audio: Audio | null; screens: Screens; total: Total };
type Win = Window & { fso: Fso; __loop?: FrameRequestCallback; __now: number };

const problems: string[] = [];
let expectedHits = 0; // sword hits the fight takes to knock P2 out (from the first hit's damage)
/** The stepped loop (set once it is captured), for the helpers that need ticks. */
let stepLoop: (n?: number) => Promise<void> = async () => {};
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: mkdtempSync(join(out, "profile-")),
  args: ["--autoplay-policy=no-user-gesture-required"],
  defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
});
try {
  const page = await browser.newPage();
  page.on("console", (m) => (m.type() === "error" || m.type() === "warn" ? problems.push(`console ${m.type()}: ${m.text()}`) : m.text().startsWith("bot") && console.log(m.text())));
  page.on("pageerror", (e) => problems.push(`page error: ${e instanceof Error ? e.message : String(e)}`));
  const loading = Date.now();
  await openReady(page, url, () => (window as unknown as Win).fso?.mode === "menu");
  console.log(`menu up after ${((Date.now() - loading) / 1000).toFixed(1)} s`);
  await page.screenshot({ path: join(out, "battle-menu.png") });
  // A click is the user gesture that starts the AudioContext (once the waves are decoded).
  const clicked = Date.now();
  await page.click("#menu h1");
  await page.waitForFunction(() => ["running", "failed"].includes((window as unknown as Win).fso.audio?.state ?? ""), { timeout: 120_000, polling: 100 });
  console.log(`audio ${await page.evaluate(() => (window as unknown as Win).fso.audio!.state)} ${((Date.now() - clicked) / 1000).toFixed(1)} s after the first click`);

  // From here on the loop only runs when we call it.
  await page.evaluate(() => {
    const w = window as unknown as Win;
    // The fake clock starts when the loop is captured, just after its last real frame: the first stepped frame is then
    // a whole tick (starting it earlier made the sim run a tick or two behind the frames a script counts).
    window.requestAnimationFrame = (cb) => {
      if (!w.__loop) w.__now = performance.now();
      w.__loop = cb;
      return 1;
    };
  });
  await page.waitForFunction(() => (window as unknown as Win).__loop !== undefined, { polling: 20 });
  const tick = (n = 1) =>
    page.evaluate((n) => {
      const w = window as unknown as Win;
      for (let i = 0; i < n; i++) w.__loop!((w.__now += 1000 / 60));
    }, n);
  const game = () => page.evaluate(() => (window as unknown as Win).fso.game);
  stepLoop = tick;

  await pauseCheck(page, tick);
  await arenaTour(page, tick);
  await pitCheck(page, tick, game);
  await fight(page, tick, game);
  await heartStates(page);
  await chargeAndReplay(page);
  await audioCheck(page);
} finally {
  await browser.close();
}


/**
 * Back to the menu the way a player goes: Esc opens the game's pause screen, then Choose an Area and Yes (at the
 * match's end Esc is the results' Menu).
 */
async function leaveToMenu(page: Page): Promise<void> {
  const mode = () => page.evaluate(() => (window as unknown as Win).fso.mode);
  if ((await mode()) === "menu") return;
  await page.keyboard.press("Escape");
  if ((await mode()) === "menu") return;
  await stepLoop(20);
  await page.click("#pause-area");
  await stepLoop(45);
  await page.click("#pause-yes");
  await stepLoop(40);
  if ((await mode()) !== "menu") problems.push(`pause: Choose an Area / Yes left the page in ${await mode()}`);
}

async function startFromMenu(page: Page, room: number, options: { players: string; hearts: string; time: string; wins: string }): Promise<void> {
  await leaveToMenu(page);
  await page.click(`.arena[data-room="${room}"]`);
  await page.select("#opt-players", options.players);
  await page.select("#opt-hearts", options.hearts);
  await page.select("#opt-time", options.time);
  await page.select("#opt-wins", options.wins);
  await page.click("#start");
}

// The round's intro as the game plays it (the Links hidden in their portals, the afterimages, the corners one by one),
// then the pause screen: Esc drops the plate in over the dimmed arena and stops the sim; the cursor, a choice and its
// question, No back to the plate, Continue back to the round.
async function pauseCheck(page: Page, tick: (n?: number) => Promise<void>): Promise<void> {
  type Pause = { state: { phase: string; cursor: number; question: string | null } | null; last: { dim: number; plate: number | null; confirm: number | null } | null };
  const pause = () => page.evaluate(() => (window as unknown as Win & { fso: { pause: Pause } }).fso.pause.state);
  const view = () => page.evaluate(() => (window as unknown as Win & { fso: { pause: Pause } }).fso.pause.last);
  await startFromMenu(page, 0, { players: "2", hearts: "3", time: "0", wins: "3" });
  await tick(100);
  const hidden = await page.evaluate(() => (window as unknown as Win).fso.game.battle.phase === "countdown" && !(window as unknown as Win & { fso: { view: { links: { visible: boolean }[] } } }).fso.view.links.some((l) => l.visible));
  if (!hidden) problems.push("intro: a Link showed before his portal burst (tick 100)");
  await page.screenshot({ path: join(out, "battle-intro-portals.png") });
  await tick(170); // tick 270: P2's afterimage, P1's corner in
  await page.screenshot({ path: join(out, "battle-intro-afterimage.png") });
  await tick(COUNTDOWN - 270 + 30);
  const t0 = (await game(page)).tick;
  await page.keyboard.press("Escape");
  await tick(40);
  const open = await view();
  const frozen = (await game(page)).tick === t0;
  console.log(`pause: ${JSON.stringify(open)}, sim stopped ${frozen}`);
  if (!open || open.dim !== 80 || open.plate !== 0 || !frozen) problems.push(`pause: open ${JSON.stringify(open)}, sim stopped ${frozen}`);
  await page.screenshot({ path: join(out, "battle-pause.png") });
  await page.keyboard.down("KeyS");
  await tick(2);
  await page.keyboard.up("KeyS");
  await tick(2);
  if ((await pause())?.cursor !== 1) problems.push(`pause: the cursor is on ${(await pause())?.cursor} after a press down`);
  await page.keyboard.press("Enter");
  await tick(45);
  const asked = await pause();
  if (asked?.phase !== "confirm" || asked.question !== "area") problems.push(`pause: Choose an Area asked ${JSON.stringify(asked)}`);
  await page.screenshot({ path: join(out, "battle-pause-question.png") });
  await page.keyboard.press("Backspace"); // B: No
  await tick(60);
  const back = await pause();
  if (back?.phase !== "menu" || back.cursor !== 0) problems.push(`pause: No went to ${JSON.stringify(back)}`);
  await page.keyboard.press("Escape"); // Start: Continue
  await tick(40);
  const after = await pause();
  await tick(10);
  const going = (await game(page)).tick > t0;
  if (after !== null || !going) problems.push(`pause: Continue left ${JSON.stringify(after)}, play going on ${going}`);
}

async function game(page: Page): Promise<Game> {
  return page.evaluate(() => (window as unknown as Win).fso.game);
}

/** RGB under a room pixel after drawing a frame. */
async function pixelAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  return page.evaluate(
    (x, y) => {
      const w = window as unknown as Win;
      w.__loop!((w.__now += 1000 / 60)); // draw, then read the canvas in the same task
      const screen = document.getElementById("screen") as HTMLCanvasElement;
      const p = w.fso.view.toScreen(x, y), rect = screen.getBoundingClientRect();
      const copy = document.createElement("canvas");
      copy.width = screen.width;
      copy.height = screen.height;
      const ctx = copy.getContext("2d")!;
      ctx.drawImage(screen, 0, 0);
      const k = screen.width / rect.width;
      const d = ctx.getImageData(Math.round((p.x - rect.left) * k), Math.round((p.y - rect.top) * k), 1, 1).data;
      return [d[0]!, d[1]!, d[2]!] as [number, number, number];
    },
    x,
    y,
  );
}

// Every arena with 4 Links and the whole-arena camera. Counts the colors on the canvas to catch blank renders, checks
// the static actors and the backdrops, and that the four HUD corners show full hearts.
async function arenaTour(page: Page, tick: (n?: number) => Promise<void>): Promise<void> {
  for (const room of ARENAS) {
    await startFromMenu(page, room, { players: "4", hearts: "4", time: "0", wins: "3" });
    await page.evaluate(() => ((window as unknown as Win).fso.view.cameraMode = "full"));
    await tick(COUNTDOWN + 50);
    const colors = await page.evaluate(() => {
      const w = window as unknown as Win;
      w.__loop!((w.__now += 1000 / 60));
      const screen = document.getElementById("screen") as HTMLCanvasElement;
      const copy = document.createElement("canvas");
      copy.width = screen.width;
      copy.height = screen.height;
      const ctx = copy.getContext("2d")!;
      ctx.drawImage(screen, 0, 0);
      const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
      const seen = new Set<number>();
      for (let i = 0; i < pixels.length; i += 4 * 7) seen.add((pixels[i]! << 16) | (pixels[i + 1]! << 8) | pixels[i + 2]!);
      return seen.size;
    });
    const info = await page.evaluate(() => {
      const { game, view, hud } = (window as unknown as Win).fso;
      const counts: Record<string, number> = {};
      for (const a of view.drawnActors) counts[a.id] = (counts[a.id] ?? 0) + 1;
      // Bombs, flames, soldiers, bees and orbs are the sim's entities now (apps/battle/src/entities.ts).
      for (const [kind, n] of Object.entries(view.entities.drawn)) counts[`sim:${kind}`] = n;
      // Drawn as tiles, effects or not at all (the Tower of Winds' Shadow Link until his switch).
      const invisible = ["switch", "trapdoor", "circle", "jet", "logic", "crystal", "flame", "shadowLink"];
      return { phase: game.battle.phase, actors: counts, entities: game.battle.entities.filter((e) => !invisible.includes((e as { kind: string }).kind)).length, missing: view.missingModels, hud: hud.snapshot() };
    });
    const actors = Object.entries(info.actors).map(([id, n]) => `${id}×${n}`).join(" ") || "none";
    console.log(`arena ${room}: ${colors} colors, phase ${info.phase}; actors ${actors}${info.missing.length ? `; J3D not drawn: ${info.missing.join(", ")}` : ""}`);
    if (colors < 16) problems.push(`arena ${room} looks blank (${colors} colors)`);
    if (info.phase !== "play") problems.push(`arena ${room}: phase ${info.phase} after the countdown`);
    if ("PLAS" in info.actors) problems.push(`arena ${room}: the player starts are drawn`);
    if (!Object.keys(info.actors).length && info.entities > 0) problems.push(`arena ${room}: no actors drawn`);
    const hearts = info.hud.map((c) => c.hearts.join(","));
    if (info.hud.length !== 4 || hearts.some((h) => h !== "4,4,4,4,-,-,-,-")) problems.push(`arena ${room}: HUD hearts ${JSON.stringify(hearts)}`);
    // The room's light (apps/battle lights.ts): the Dark World is dark away from the Links and the flames.
    const light = await page.evaluate(() => {
      const { view } = (window as unknown as Win).fso;
      return { active: view.lighting.active, drawn: view.lighting.drawn };
    });
    if (DARK_ROOMS.includes(room)) {
      const far = await pixelAt(page, DARK_PROBES[room]![0], DARK_PROBES[room]![1]);
      console.log(`  lighting: ${light.drawn} lights; far from them rgb(${far.join(", ")})`);
      if (!light.active || light.drawn < 4) problems.push(`arena ${room}: not lit (${JSON.stringify(light)})`);
      if (far[0] + far[1] + far[2] > 40) problems.push(`arena ${room}: not dark far from the lights (rgb ${far.join(", ")})`);
    } else if (light.active !== LIT_ROOMS.includes(room)) problems.push(`arena ${room}: lighting ${light.active ? "on" : "off"}`);
    const probe = BACKDROP_PROBES[room];
    if (probe) {
      // The backdrop behind the tiles, with the lighting off (the Dark World darkens it too).
      await page.evaluate(() => ((window as unknown as Win).fso.view.lighting.enabled = false));
      const rgb = await pixelAt(page, probe[0], probe[1]);
      await page.evaluate(() => ((window as unknown as Win).fso.view.lighting.enabled = true));
      console.log(`  backdrop at (${probe.join(", ")}): rgb(${rgb.join(", ")})`);
      if (rgb[0] + rgb[1] + rgb[2] < 30) problems.push(`arena ${room}: no backdrop behind the transparent tiles`);
    }
    await tick(1);
    await page.screenshot({ path: join(out, `battle-arena-${room}.png`) });
  }
  // One 4-player start with the zoom-to-fit camera.
  await page.evaluate(() => ((window as unknown as Win).fso.view.cameraMode = "fit"));
  await tick(60);
  await page.screenshot({ path: join(out, "battle-fit.png") });
}

// Tower of Flames: P1 walks right into the middle hole (its rim keeps him off the outer void: traced), falls, jumps
// back out onto the edge he fell from and only then loses half a heart (the pit's 2 life, traced in Dolphin).
async function pitCheck(page: Page, tick: (n?: number) => Promise<void>, game: () => Promise<Game>): Promise<void> {
  await startFromMenu(page, 1, { players: "2", hearts: "2", time: "0", wins: "1" });
  await tick(COUNTDOWN + 1);
  await page.evaluate(() => Object.assign((window as unknown as Win).fso.game.players[0]!, { x: 220 * 256, y: 192 * 256 }));
  await page.keyboard.down("d");
  let g = await game();
  for (let i = 0; i < 200 && g.battle.fighters[0]!.mode !== "falling"; i++) {
    await tick(1);
    g = await game();
  }
  await page.keyboard.up("d");
  const f = g.battle.fighters[0]!, fell = g.players[0]!;
  console.log(`pit: falling at x ${fell.x / 256}, hearts ${f.hearts}`);
  if (f.mode !== "falling" || f.hearts !== 8) problems.push(`pit: mode ${f.mode}, hearts ${f.hearts}`);
  await tick(12);
  await page.screenshot({ path: join(out, "battle-pit.png") });
  const roots = await page.evaluate(() => (window as unknown as Win).fso.hud.visibleRoots());
  if (roots[2]!.length || roots[3]!.length || roots[0]!.length < 5) problems.push(`pit: HUD corners shown in a 2-player match: ${JSON.stringify(roots)}`);
  for (let i = 0; i < 150 && g.battle.fighters[0]!.mode !== "active"; i++) {
    await tick(1);
    g = await game();
  }
  const back = g.players[0]!, hearts = g.battle.fighters[0]!.hearts;
  await tick(1);
  const hud = await page.evaluate(() => (window as unknown as Win).fso.hud.snapshot()[0]!.hearts.join(","));
  if (hud !== "4,2,-,-,-,-,-,-") problems.push(`pit: HUD shows ${hud} for 1.5 of 2 hearts`);
  // Back on the edge he walked off (15 px out from where the fall put him), not at his start.
  if (g.battle.fighters[0]!.mode !== "active" || hearts !== 6 || Math.abs(back.x - fell.x) > 20 * 256 || back.y !== fell.y) {
    problems.push(`pit: not back on the edge with 6 life (${back.x / 256}, ${back.y / 256}, ${hearts})`);
  } else console.log(`pit: jumped back out at (${back.x / 256}, ${back.y / 256}), hearts ${hearts}`);
}

// Tower of Winds (no hazards: Hyrule Castle's soldiers would join in), 2 players, 2 hearts, 1 win: P2 turns away (so
// his shield doesn't block), P1 walks up and swings.
async function fight(page: Page, tick: (n?: number) => Promise<void>, game: () => Promise<Game>): Promise<void> {
  await startFromMenu(page, 2, { players: "2", hearts: "2", time: "0", wins: "1" });
  await tick(COUNTDOWN + 1);
  // The Tower of Winds is side view: both on its bottom floor, so the bot only has to walk sideways.
  await page.evaluate(() => {
    const [p1, p2] = (window as unknown as Win).fso.game.players;
    Object.assign(p1!, { x: 150 * 256, y: 328.5 * 256 });
    Object.assign(p2!, { x: 300 * 256, y: 328.5 * 256 });
  });
  await page.keyboard.down("ArrowUp");
  await tick(2);
  await page.keyboard.up("ArrowUp");
  await tick(1);
  if ((await game()).players[1]!.facing !== "up") problems.push("fight: P2 didn't turn");

  // The bot runs inside the page, pressing P1's keys (WASD + J) through the real keyboard listeners.
  const bot = (stopAt: "hit" | "over", max: number) =>
    page.evaluate(
      (stopAt, max) => {
        const w = window as unknown as Win & { __keys?: Set<string> };
        const keys = (w.__keys ??= new Set());
        const press = (want: Set<string>) => {
          for (const code of ["KeyW", "KeyA", "KeyS", "KeyD", "KeyJ"]) {
            if (want.has(code) && !keys.has(code)) window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
            if (!want.has(code) && keys.has(code)) window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
          }
          keys.clear();
          for (const code of want) keys.add(code);
        };
        for (let t = 0; t < max; t++) {
          const g = w.fso.game, [p1, p2] = g.players, f2 = g.battle.fighters[1]!;
          if (stopAt === "hit" && g.battle.hits.some((h) => !h.blocked)) return { t, tick: g.tick };
          if (stopAt === "over" && g.battle.phase !== "play") return { t, tick: g.tick };
          const dx = (p2!.x - p1!.x) / 256, dy = (p2!.y - p1!.y) / 256;
          const want = new Set<string>();
          if (Math.abs(dy) > 3) want.add(dy > 0 ? "KeyS" : "KeyW");
          else if (dx > 22) want.add("KeyD");
          else if (dx < 10) want.add("KeyA");
          else if (p1!.facing !== "right") want.add("KeyD");
          else if (p1!.action === "none" && f2.invincible === 0 && !keys.has("KeyJ")) want.add("KeyJ");
          press(want);
          w.__loop!((w.__now += 1000 / 60));
        }
        press(new Set());
        const g = w.fso.game;
        console.log(`bot gave up: ${JSON.stringify({ players: g.players, fighters: g.battle.fighters, keys: [...keys] })}`);
        return null;
      },
      stopAt,
      max,
    );

  const hit = await bot("hit", 600);
  if (!hit) {
    problems.push("fight: P1 never hit P2");
    return;
  }
  const afterHit = await game();
  const quarters = afterHit.battle.fighters[1]!.hearts;
  console.log(`first hit at tick ${hit.tick}: P2 hearts ${quarters}/8, mode ${afterHit.battle.fighters[1]!.mode}`);
  expectedHits = Math.ceil(8 / (8 - quarters));
  await tick(3);
  const hud = await page.evaluate(() => (window as unknown as Win).fso.hud.snapshot()[1]!.hearts.join(","));
  const expected = [0, 1].map((h) => { const q = Math.max(0, Math.min(4, quarters - 4 * h)); return q ? String(q) : "dot"; }).join(",") + ",-,-,-,-,-,-";
  console.log(`  P2's HUD hearts: ${hud}`);
  if (hud !== expected) problems.push(`fight: P2's HUD shows ${hud}, expected ${expected}`);
  await page.screenshot({ path: join(out, "battle-hit.png") });

  const over = await bot("over", 3000);
  const g = await game();
  console.log(`round over at tick ${over?.tick}: hearts ${g.battle.fighters.map((f) => f.hearts).join("/")}, P2 x ${g.players[1]!.x / 256}`);
  if (!over || g.battle.fighters[1]!.hearts !== 0 || g.battle.fighters[0]!.hearts !== 8) problems.push("fight: P2 wasn't defeated cleanly");
  await tick(40);
  const fade = await page.evaluate(() => (window as unknown as Win).fso.hud.snapshot()[1]!);
  if (fade.hearts.join(",") !== "dot,dot,-,-,-,-,-,-" || Math.abs(fade.fade - 0.6) > 1e-6) problems.push(`fight: P2's corner after the KO: ${JSON.stringify(fade)}`);
  await page.screenshot({ path: join(out, "battle-ko.png") });
  // The game's round screens (apps/battle timeline.ts): "P2 down!" 117 ticks after the knockout, "P1 WIN!" from 294,
  // then (the match over, 423) "PRESS START" until a press, then the Total screen with the results over its buttons.
  const screens = () => page.evaluate(() => (window as unknown as Win).fso.screens.visible().join(" "));
  await tick(140 - 40);
  const down = await screens();
  await tick(200);
  const win = await screens();
  await page.screenshot({ path: join(out, "battle-win.png") });
  await tick(140);
  const press = await screens();
  const waiting = await page.evaluate(() => ({ phase: (window as unknown as Win).fso.game.battle.phase, results: !document.getElementById("results")!.hidden }));
  console.log(`round screens: "${down}" at 140, "${win}" at 340, "${press}" at 480 (${waiting.phase})`);
  // (The Links fight on the Tower of Winds' floor, low on the screen: the window goes to the top, messageAtTop.)
  if (down !== "message:P2 down! message-top" || win !== "win1" || press !== "win1 press") problems.push(`fight: round screens "${down}" / "${win}" / "${press}"`);
  if (waiting.phase !== "matchOver" || waiting.results) problems.push(`fight: ${JSON.stringify(waiting)} before the press`);
  await page.keyboard.press("Enter");
  await tick(90);
  const results = await page.evaluate(() => ({
    shown: !document.getElementById("results")!.hidden,
    title: document.getElementById("results-title")!.textContent,
    phase: (window as unknown as Win).fso.game.battle.phase,
    total: (window as unknown as Win).fso.total.last,
    rematch: document.getElementById("rematch")!.getBoundingClientRect().toJSON(),
  }));
  console.log(`results: ${results.shown ? "shown" : "hidden"}, "${results.title}", phase ${results.phase}, Total screen ${JSON.stringify(results.total)}, Rematch at ${JSON.stringify(results.rematch)}`);
  if (!results.shown || !/P1 WINS!/.test(results.title ?? "")) problems.push(`fight: no win screen (${JSON.stringify(results)})`);
  if (!results.total || results.total.stars.join() !== "1,0" || results.total.winner !== 0 || results.total.cursor !== 0) problems.push(`fight: Total screen ${JSON.stringify(results.total)}`);
  await page.screenshot({ path: join(out, "battle-total.png") });
}

// Every heart state in all four corners: the HUD is drawn from a copy of a 4-player, 4-heart state whose hearts are
// set by hand (presentation only: the real state isn't touched), then cropped at the TV frame's 1:1 size.
async function heartStates(page: Page): Promise<void> {
  await startFromMenu(page, 0, { players: "4", hearts: "4", time: "0", wins: "3" });
  const quarters = [15, 10, 5, 0]; // P1 3¾, P2 2½, P3 1¼, P4 none
  const snap = await page.evaluate((quarters) => {
    const w = window as unknown as Win;
    for (let i = 0; i < 240; i++) w.__loop!((w.__now += 1000 / 60));
    const copy = JSON.parse(JSON.stringify(w.fso.game)) as Game;
    copy.battle.fighters.forEach((f, i) => (f.hearts = quarters[i]!));
    for (let i = 0; i < 6; i++) w.fso.hud.update(copy); // the fade settles in 4 frames
    w.fso.view.render(copy);
    return w.fso.hud.snapshot();
  }, quarters);
  const want = ["4,4,4,3", "4,4,2,dot", "4,1,dot,dot", "dot,dot,dot,dot"];
  snap.forEach((c, i) => {
    const got = c.hearts.slice(0, 4).join(",");
    console.log(`hearts P${i + 1} (${quarters[i]} quarters): ${c.hearts.join(",")} fade ${c.fade}`);
    if (got !== want[i] || c.hearts.slice(4).some((h) => h !== "-")) problems.push(`hearts P${i + 1}: ${c.hearts.join(",")}, expected ${want[i]}`);
  });
  const frame = await page.evaluate(() => {
    const r = (document.getElementById("screen") as HTMLCanvasElement).getBoundingClientRect();
    const w = Math.min(r.width, (r.height * 608) / 448), h = (w * 448) / 608;
    return { x: r.left + (r.width - w) / 2, y: r.top + (r.height - h) / 2, width: w, height: h };
  });
  await page.screenshot({ path: join(out, "battle-hud-hearts.png") });
  await page.screenshot({ path: join(out, "battle-hud-hearts-tl.png"), clip: { x: frame.x, y: frame.y, width: frame.width * 0.4, height: frame.height * 0.3 } });
}

// A full charge and spin (P1 holds the sword, then lets go), recording every state; then those states are shown to
// the cues again, as a rollback re-simulating the same frames would: nothing may play twice.
async function chargeAndReplay(page: Page): Promise<void> {
  await startFromMenu(page, 2, { players: "2", hearts: "2", time: "0", wins: "1" });
  const r = await page.evaluate((countdown) => {
    const w = window as unknown as Win & { fso: { cues: { observe(game: Game): void } } };
    const step = () => w.__loop!((w.__now += 1000 / 60));
    for (let i = 0; i < countdown + 1; i++) step();
    const key = (type: string) => window.dispatchEvent(new KeyboardEvent(type, { code: "KeyJ", bubbles: true }));
    const states: Game[] = [];
    const log = () => w.fso.audio!.log.length;
    const before = log();
    key("keydown");
    for (let i = 0; i < 90; i++) (step(), states.push(JSON.parse(JSON.stringify(w.fso.game)) as Game));
    key("keyup");
    for (let i = 0; i < 45; i++) (step(), states.push(JSON.parse(JSON.stringify(w.fso.game)) as Game));
    const names = w.fso.audio!.log.slice(before).map((l) => l.name);
    const actions = [...new Set(states.map((s) => s.players[0]!.action))];
    const after = log();
    // Rewind 60 frames and show them again, twice.
    for (let pass = 0; pass < 2; pass++) for (const s of states.slice(-60)) w.fso.cues.observe(s);
    return { names, actions, replayed: log() - after };
  }, COUNTDOWN);
  const n = (name: string) => r.names.filter((x) => x === name).length;
  console.log(`charge and spin: actions ${r.actions.join(" → ")}; cues ${r.names.map((x) => x.replace(/^JA_SE_/, "")).join(" ")}; ${r.replayed} cues on replay`);
  if (!r.actions.includes("charge") || !r.actions.includes("spin")) problems.push(`charge: P1 went ${r.actions.join(", ")}`);
  if (n("JA_SE_LK_CHARGING") !== 1 || n("JA_SE_LK_TAMEGIRI") !== 1) problems.push(`charge: ${n("JA_SE_LK_CHARGING")} charged and ${n("JA_SE_LK_TAMEGIRI")} spin cues`);
  if (r.replayed) problems.push(`charge: ${r.replayed} cues replayed by re-shown states`);
}

// The audio: the first click started the AudioContext; the arena BGM plays and the fight's cues reached the synth.
async function audioCheck(page: Page): Promise<void> {
  await new Promise((r) => setTimeout(r, 1500)); // let the worklet report
  const a = await page.evaluate(() => {
    const audio = (window as unknown as Win).fso.audio;
    if (!audio) return null;
    return { now: performance.now(), time: audio.time, state: audio.state, context: audio.contextState, stats: audio.stats, error: audio.error, missing: audio.missing(), log: audio.log.filter((l) => l.sent).map((l) => l.name), unsent: audio.log.filter((l) => !l.sent).length, bgm: [0, 1, 2, 3, 4].map((r) => audio.arenaBgm(r)) };
  });
  if (!a) {
    problems.push("audio: not loaded");
    return;
  }
  const count = (name: string) => a.log.filter((n) => n === name).length;
  console.log(`audio: ${a.state}, context ${a.context}, ${a.stats?.seconds.toFixed(1)} s rendered; BGM ${a.stats?.bgm.notes} notes (${a.stats?.bgm.missing} missing), ${a.stats?.se.started} effects, ${a.stats?.se.notes} notes (${a.stats?.se.missing} missing)`);
  console.log(`  context started ${((a.now - a.time.startedAt) / 1000).toFixed(1)} s ago, played ${a.time.played.toFixed(1)} s`);
  console.log(`  arena BGM: ${a.bgm.join(", ")}`);
  console.log(`  cues: ${[...new Set(a.log)].map((n) => `${n.replace(/^JA_(SE|BGM)_/, "")}×${count(n)}`).join(" ")}`);
  if (a.unsent) problems.push(`audio: ${a.unsent} cues before the synth ran`);
  if (a.context !== "running") problems.push(`audio: AudioContext ${a.context} (${a.error ?? "no error"})`);
  if (a.missing.length) problems.push(`audio: missing ${a.missing.join(", ")}`);
  if (!a.stats || a.stats.bgm.notes === 0 || a.stats.se.started === 0 || a.stats.se.notes === 0) problems.push(`audio: nothing scheduled ${JSON.stringify(a.stats)}`);
  if (a.stats && (a.stats.bgm.missing > 0 || a.stats.se.missing > 0)) problems.push("audio: notes without an instrument");
  for (const name of ["JA_BGM_BATTLE_ZAKO", "JA_BGM_FANFARE_WIN", "JA_BGM_RESULT", "JA_SE_READY", "JA_SE_GO", "JA_SE_LK_SWORD_WIELD", "JA_SE_V_DAMAGE", "JA_SE_V_FALL_DOWN", "JA_SE_V_DOWN"])
    if (!count(name)) problems.push(`audio: no ${name} cue`);
  // Rollback safety: cues are keyed by cause, so a swing is heard once, however many states show it.
  const swings = count("JA_SE_LK_SWORD_WIELD"), hits = count("JA_SE_V_DAMAGE");
  if (hits !== expectedHits) problems.push(`audio: ${hits} hit cues for the ${expectedHits} hits of the fight`);
  if (swings > 40) problems.push(`audio: ${swings} swing cues`);
}

if (problems.length) {
  console.log(problems.join("\n"));
  process.exitCode = 1;
}
console.log(`screenshots in ${out}`);
