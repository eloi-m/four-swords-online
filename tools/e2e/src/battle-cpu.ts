// CPU opponents in apps/battle, in headless Chrome (own Vite server, port E2E_PORT or 5198):
//   1. The menu by hand: 4 players, P2-P4 set to CPUs with the rows' selects, 1 human (P1, WASD) against them on the
//      Tower of Winds: P1 walks with the keyboard while the CPUs play, then stands still while they fight on to the
//      results screen, which names the CPUs.
//   2. The deep link #cpu=2:hard,3,4:easy&players=4&start: the right levels, and the CPUs get moving.
//   3. The same deep link on a phone-sized landscape page (touch, 3× pixels): 1 human + 3 CPUs play on.
//   4. The menu on that phone, opened as the home page's "Vs. Computer" does (#vs=cpu): every player's picker is
//      there and in reach (44 px, on screen), P2 and P3 are CPUs, a CPU's level is picked, a tap on Fight starts it.
// The game loop is stepped by hand (its requestAnimationFrame callback is captured, as in battle.ts), so every run
// sees the same ticks. Screenshots in out/e2e-cpu/.
//   node tools/e2e/src/battle-cpu.ts [outDir]
import { mkdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import puppeteer, { type Page } from "puppeteer-core";
import { createServer } from "vite";
import { openReady } from "./ready.ts";
import { browserPath } from "./browsers.ts";

const CHROME = browserPath("chrome");
const PORT = Number(process.env.E2E_PORT ?? 5198);
const COUNTDOWN = 409; // packages/sim COUNTDOWN_TICKS
const [outArg = "out/e2e-cpu"] = process.argv.slice(2);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });

type Fighter = { hearts: number; mode: string; stars: number };
type Game = { tick: number; players: { x: number; y: number }[]; battle: { phase: string; round: number; matchWinner: number; fighters: Fighter[]; cpus?: { player: number; level: string }[] } };
type Win = Window & { fso: { mode: string; game: Game | null }; __loop?: FrameRequestCallback; __now: number };

const vite = await createServer({
  configFile: resolve(import.meta.dirname, "../../../apps/battle/vite.config.ts"),
  root: resolve(import.meta.dirname, "../../../apps/battle"),
  server: { port: PORT, strictPort: true },
  logLevel: "warn",
});
await vite.listen();
const base = `http://localhost:${PORT}/`;
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: mkdtempSync(join(out, "profile-")),
  args: ["--autoplay-policy=no-user-gesture-required"],
  defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
});
const problems: string[] = [];

/** The page with its game files loaded (the dev server serves them from extracted/) and in `mode`. */
async function openBattle(hash: string, label: string, mode: "menu" | "match"): Promise<Page> {
  const page = await browser.newPage();
  page.on("console", (m) => (m.type() === "error" ? problems.push(`${label} console: ${m.text()}`) : undefined));
  page.on("pageerror", (e) => problems.push(`${label} page error: ${e instanceof Error ? e.message : String(e)}`));
  await openReady(page, `${base}#${hash}`, (m: string) => (window as unknown as Win).fso?.mode === m, 180_000, mode);
  return page;
}

/** From here on the page's loop runs only when stepped. */
async function takeLoop(page: Page): Promise<(n?: number) => Promise<void>> {
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
  return (n = 1) =>
    page.evaluate((n) => {
      const w = window as unknown as Win;
      for (let i = 0; i < n; i++) w.__loop!((w.__now += 1000 / 60));
    }, n);
}

const game = (page: Page) => page.evaluate(() => (window as unknown as Win).fso.game!);
const cpusOf = (g: Game) => (g.battle.cpus ?? []).map((c) => `P${c.player + 1} ${c.level}`).join(", ");

async function humanVersusCpus(): Promise<void> {
  const name = "1 human vs 3 CPUs (menu)";
  console.log(name);
  const page = await openBattle("", "menu", "menu");
  await page.click('.arena[data-room="2"]');
  await page.select("#opt-players", "4");
  await page.select("#opt-hearts", "2");
  await page.select("#opt-wins", "1");
  await page.select("#opt-time", "0");
  for (const [slot, level] of [[1, "normal"], [2, "hard"], [3, "easy"]] as const) await page.select(`select.slot[data-slot="${slot}"]`, level);
  const rows = await page.$$eval("#controls li", (lis) => lis.map((li) => `${li.querySelector("b")!.textContent} ${(li.querySelector("select") as HTMLSelectElement).value}: ${li.querySelector(".how")!.textContent}`));
  console.log(`  menu: ${rows.join(" | ")}`);
  if (rows.length !== 4 || !rows[0]!.includes("human: Keyboard") || !rows.slice(1).every((r) => /^P\d (easy|normal|hard): $/.test(r))) problems.push(`${name}: the menu shows ${JSON.stringify(rows)}`);
  await page.screenshot({ path: join(out, "cpu-menu.png") });
  const tick = await takeLoop(page);
  await page.click("#start");
  await tick(COUNTDOWN + 20);
  let g = await game(page);
  console.log(`  match: ${g.battle.phase}, CPUs ${cpusOf(g)}`);
  if (cpusOf(g) !== "P2 normal, P3 hard, P4 easy") problems.push(`${name}: CPUs ${cpusOf(g)}`);
  // P1 is the one human: D walks him right while the CPUs play.
  const x0 = g.players[0]!.x, cpuStarts = g.players.slice(1).map((p) => `${p.x},${p.y}`);
  await page.keyboard.down("KeyD");
  await tick(40);
  await page.keyboard.up("KeyD");
  g = await game(page);
  const walked = (g.players[0]!.x - x0) / 256;
  const moved = g.players.slice(1).filter((p, k) => `${p.x},${p.y}` !== cpuStarts[k]).length;
  console.log(`  P1 walked ${walked} px on the keyboard; ${moved}/3 CPUs moved`);
  if (walked < 20) problems.push(`${name}: P1 didn't walk (${walked} px)`);
  if (moved < 3) problems.push(`${name}: only ${moved} CPUs moved`);
  await tick(200);
  await page.screenshot({ path: join(out, "cpu-fight.png") });
  // P1 stands still from here: the CPUs fight on to the end of the match.
  for (let t = 0; t < 12_000 && g.battle.phase !== "matchOver"; t += 300) {
    await tick(300);
    g = await game(page);
  }
  // "PRESS START" (the game's), a press, then the Total screen with the results over its buttons.
  await tick(30);
  await page.keyboard.press("Enter");
  await tick(90);
  const results = await page.evaluate(() => ({ shown: !document.getElementById("results")!.hidden, title: document.getElementById("results-title")!.textContent, standings: document.getElementById("standings")!.textContent }));
  console.log(`  ${g.battle.phase} at tick ${g.tick}: "${results.title}" ${results.standings}`);
  if (g.battle.phase !== "matchOver" || !results.shown || !/WINS!/.test(results.title ?? "")) problems.push(`${name}: no results (${g.battle.phase}, ${JSON.stringify(results)})`);
  if (!/CPU \(hard\)/.test(results.standings ?? "")) problems.push(`${name}: the standings don't name the CPUs`);
  await page.screenshot({ path: join(out, "cpu-results.png") });
  await page.close();
}

const PHONE = { width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true };

async function phoneMenu(): Promise<void> {
  const name = "phone menu (#vs=cpu, 844×390, touch)";
  console.log(name);
  const page = await browser.newPage();
  page.on("console", (m) => (m.type() === "error" ? problems.push(`${name} console: ${m.text()}`) : undefined));
  page.on("pageerror", (e) => problems.push(`${name} page error: ${e instanceof Error ? e.message : String(e)}`));
  await page.setViewport(PHONE);
  await openReady(page, `${base}#vs=cpu&players=3`, () => (window as unknown as Win).fso?.mode === "menu", 180_000);
  const rows = await page.$$eval("#controls li select", (selects) =>
    selects.map((s) => {
      const r = s.getBoundingClientRect();
      return { value: (s as HTMLSelectElement).value, width: r.width, height: r.height, onScreen: r.top >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth };
    }),
  );
  const fits = await page.evaluate(() => ({ menu: document.getElementById("menu")!.scrollHeight - document.getElementById("menu")!.clientHeight, sideways: document.documentElement.scrollWidth - window.innerWidth }));
  console.log(`  rows: ${rows.map((r, i) => `P${i + 1} ${r.value} ${r.width.toFixed(0)}×${r.height.toFixed(0)}${r.onScreen ? "" : " (off screen)"}`).join(" | ")}; overflow ${fits.menu} px down, ${fits.sideways} px sideways`);
  if (rows.length !== 3 || rows[0]!.value !== "human" || rows.slice(1).some((r) => r.value === "human")) problems.push(`${name}: the rows are ${JSON.stringify(rows.map((r) => r.value))}`);
  if (rows.some((r) => r.width < 44 || r.height < 44 || !r.onScreen)) problems.push(`${name}: a picker is out of reach ${JSON.stringify(rows)}`);
  if (fits.menu > 0 || fits.sideways > 0) problems.push(`${name}: the menu overflows (${fits.menu} px down, ${fits.sideways} px sideways)`);
  // A different level for P2 (a select's change, as the phone's picker makes it), then Fight by a tap.
  const level = rows[1]!.value === "hard" ? "easy" : "hard";
  await page.select('select.slot[data-slot="1"]', level);
  await page.screenshot({ path: join(out, "cpu-phone-menu.png") });
  await page.tap("#start");
  await page.waitForFunction(() => (window as unknown as Win).fso.mode === "match", { timeout: 10_000 });
  const cpus = cpusOf(await game(page));
  console.log(`  after picking ${level} for P2 and tapping Fight: CPUs ${cpus}`);
  if (cpus !== `P2 ${level}, P3 ${rows[2]!.value}`) problems.push(`${name}: the match has CPUs ${cpus}`);
  await page.close();
}

async function deepLink(hash: string, label: string, viewport?: { width: number; height: number; deviceScaleFactor: number; isMobile: boolean; hasTouch: boolean; isLandscape: boolean }): Promise<void> {
  console.log(label);
  const page = await openBattle(hash, label, "match");
  if (viewport) await page.setViewport(viewport);
  const tick = await takeLoop(page);
  await tick(COUNTDOWN + 10);
  let g = await game(page);
  const starts = g.players.map((p) => `${p.x},${p.y}`);
  await tick(600);
  g = await game(page);
  const moved = g.players.slice(1).filter((p, k) => `${p.x},${p.y}` !== starts[k + 1]).length;
  const hits = g.battle.fighters.map((f) => f.hearts).join("/");
  console.log(`  CPUs ${cpusOf(g)}; after 10 s: ${moved}/3 moved, hearts ${hits}, phase ${g.battle.phase}`);
  if (cpusOf(g) !== "P2 hard, P3 normal, P4 easy") problems.push(`${label}: CPUs ${cpusOf(g)}`);
  if (moved < 3) problems.push(`${label}: only ${moved} CPUs moved`);
  await page.screenshot({ path: join(out, `cpu-${viewport ? "phone" : "deeplink"}.png`) });
  await page.close();
}

try {
  await humanVersusCpus();
  await deepLink("arena=3&players=4&hearts=2&wins=1&cpu=2:hard,3,4:easy&start", "deep link #cpu=2:hard,3,4:easy");
  await deepLink("arena=0&hearts=2&wins=1&cpu=2:hard,3,4:easy&start", "phone (844×390 landscape, touch)", PHONE);
  await phoneMenu();
} catch (error) {
  problems.push(`aborted: ${(error as Error).stack ?? (error as Error).message}`);
} finally {
  await browser.close();
  await vite.close();
}
if (problems.length) {
  console.log(`\nproblems:\n${problems.join("\n")}`);
  process.exitCode = 1;
} else console.log(`\nall passed; screenshots in ${out}`);
