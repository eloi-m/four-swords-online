// The on-screen touch controls (@fso/input/touch) in emulated phones, with real touch input:
//   Chrome (puppeteer, device emulation: a landscape phone with isMobile and hasTouch; the fingers are CDP touch
//   points, several at once): Shadow Battle's menu by taps (the first one starts the audio, as iOS needs), then a local
//   round stepped tick by tick: walk, swing while walking (two fingers), charge and spin while walking, lift and throw
//   P2, roll, shoot an arrow, and knock P2 out to the results; the pause button opens the menu; the Controls dialog's
//   touch settings by taps (44 px targets). Then an online duel between two emulated phones on a lobby of its own (the
//   stick and Sword drive this browser's Link, the pause button opens the match menu), and the adventure page
//   (the controls in its TV frame's margins, the pause button opening the stage list).
//   The page must never zoom or scroll (visualViewport.scale 1, no scroll offset).
//   WebKit (Playwright's build, Safari's engine; isMobile and hasTouch): the same pages, real taps (Playwright has no
//   touch holds: the held stick is dispatched as pointer events), the pause button, no zoom or scroll.
// Expects the site's dev server (it serves the game files from extracted/): pnpm site:dev, or apps/site's vite on another
// port. The browser profiles are kept in out/e2e-touch/; screenshots go there too.
//   node tools/e2e/src/touch.ts [url=http://localhost:5191/] [chrome|webkit|all] [--signal-port=5197]
//   WebKit: PLAYWRIGHT_BROWSERS_PATH=~/.cache/fso-webkit (see site-webkit.ts)
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { startSignalServer } from "@fso/signal";
import { webkit, type Page as WebKitPage } from "playwright-core";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { leaveMatch, openReady } from "./ready.ts";
import { browserPath } from "./browsers.ts";

const CHROME = browserPath("chrome");
const args = process.argv.slice(2);
const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const [base = "http://localhost:5191/", which = "all"] = args.filter((a) => !a.startsWith("--"));
if (!["chrome", "webkit", "all"].includes(which)) {
  console.error("usage: touch [url] [chrome|webkit|all] [--signal-port=5197]");
  process.exit(1);
}
const signalPort = Number(opt("signal-port") ?? 5197);
const out = resolve("out/e2e-touch");
mkdirSync(out, { recursive: true });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const url = (path: string) => new URL(path, base).href;

// Landscape phones: an Android one (CSS px 915×412; its 608:448 frame leaves 178 px margins) and a notched iPhone's.
const ANDROID = { width: 915, height: 412, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, isLandscape: true };
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const IPHONE = { width: 852, height: 393, deviceScaleFactor: 3 };

type Circle = { x: number; y: number; r: number };
type Layout = { placement: string; stick: Circle; buttons: (Circle & { action: string })[]; pause: { x: number; y: number; w: number; h: number } };
type Player = { x: number; y: number; facing: string; action: string };
type Fighter = { hearts: number; mode: string; move: string; item: string };
type Game = { tick: number; players: Player[]; battle: { phase: string; fighters: Fighter[]; entities: { kind: string }[]; rules: { hearts: number } } };
type Touch = { active: boolean; visible: boolean; layout: Layout | null; root: HTMLElement; pad: { held: number }; sample(): number; settings: { mode: string } };
type Fso = {
  mode: string;
  game: Game;
  touch: Touch;
  audio: { state: string; contextState: string } | null;
  startMatch(s?: object): void;
  online: { current: { net: { match: number } } | null; game: Game | null; ui: { paused: boolean }; localPlayer: number } | null;
};
type Win = Window & { fso: Fso; fsoHome: { data: string }; __loop?: FrameRequestCallback; __now: number; __masks: number[] };

const Button = { Up: 1, Down: 2, Left: 4, Right: 8, Sword: 16, Item: 32, Action: 64 };
const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
};

// --- Chrome ---

/** Checks the server has the game files: the home page finds them (the pages then load theirs from <base>data/). */
async function loadData(page: Page): Promise<void> {
  await openReady(page, base, () => (window as unknown as Win).fsoHome?.data === "ready", 30_000);
}

function watch<P extends Page>(page: P, label: string): P {
  page.on("console", (m) => {
    if (m.type() === "error" || (m.type() === "warn" && !/audio unavailable/.test(m.text()))) problems.push(`[${label}] console ${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`[${label}] page error: ${e instanceof Error ? e.message : String(e)}`));
  if (process.env.DEBUG) page.on("framenavigated", (f) => f === page.mainFrame() && console.log(`[${label}] navigated to ${f.url()}`));
  return page;
}

async function phone(browser: Browser, label: string): Promise<Page> {
  const page = watch(await browser.newPage(), label);
  await page.emulate({ viewport: ANDROID, userAgent: ANDROID_UA });
  return page;
}

/** The page never zooms or scrolls (a pinch, a double tap, a drag on the controls). */
async function noZoom(page: Page | WebKitPage, label: string): Promise<void> {
  const v = await (page as Page).evaluate(() => ({ scale: visualViewport?.scale ?? 1, x: scrollX, y: scrollY, vx: visualViewport?.offsetLeft ?? 0, vy: visualViewport?.offsetTop ?? 0 }));
  check(v.scale === 1 && v.x === 0 && v.y === 0 && v.vx === 0 && v.vy === 0, `${label}: the page zoomed or scrolled ${JSON.stringify(v)}`);
}

const layout = (page: Page | WebKitPage) => (page as Page).evaluate(() => (window as unknown as Win).fso.touch.layout!);
const button = (l: Layout, action: string) => l.buttons.find((b) => b.action === action)!;
const pauseCenter = (l: Layout) => ({ x: l.pause.x + l.pause.w / 2, y: l.pause.y + l.pause.h / 2 });

/** Takes the game loop over: it only runs when `tick` calls it (as battle.ts does). */
async function stepByHand(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Win;
    // The fake clock starts when the loop is captured, just after its last real frame: the first stepped frame is then
    // a whole tick (starting it earlier made the sim run a tick or two behind the frames a script counts).
    window.requestAnimationFrame = (cb) => {
      if (!w.__loop) w.__now = performance.now();
      w.__loop = cb;
      return 1;
    };
    // Every mask the controls hand the sim.
    w.__masks = [];
    const touch = w.fso.touch, sample = touch.sample.bind(touch);
    touch.sample = () => {
      const m = sample();
      w.__masks.push(m);
      return m;
    };
  });
  await page.waitForFunction(() => (window as unknown as Win).__loop !== undefined, { polling: 20 });
}

/** Steps `n` ticks; returns P1's action and the controls' mask after each. */
function tick(page: Page, n = 1): Promise<{ action: string; move: string; mask: number }[]> {
  return page.evaluate((n) => {
    const w = window as unknown as Win;
    const seen = [];
    for (let i = 0; i < n; i++) {
      w.__loop!((w.__now += 1000 / 60));
      seen.push({ action: w.fso.game.players[0]!.action, move: w.fso.game.battle.fighters[0]!.move, mask: w.__masks.at(-1) ?? 0 });
    }
    return seen;
  }, n);
}

const game = (page: Page) => page.evaluate(() => (window as unknown as Win).fso.game);

function place(page: Page, i: number, x: number, y: number, facing: string): Promise<void> {
  return page.evaluate(
    (i, x, y, facing) => void Object.assign((window as unknown as Win).fso.game.players[i]!, { x: x * 256, y: y * 256, facing }),
    i,
    x,
    y,
    facing,
  );
}

/** A finger on a control for one tick. */
async function tap(page: Page, at: { x: number; y: number }): Promise<void> {
  const f = await page.touchscreen.touchStart(at.x, at.y);
  await tick(page, 1);
  await f.end();
}

async function localRound(browser: Browser): Promise<void> {
  const page = await phone(browser, "battle");
  await page.evaluateOnNewDocument(() => localStorage.removeItem("fso.touch")); // the saved settings of an earlier run
  // (cpu= empty: both players human; a touch screen's first visit would make P2 a CPU)
  await page.goto(url("battle/#arena=0&players=2&hearts=2&time=0&wins=1&seed=3&cpu="), { waitUntil: "load" });
  await page.waitForFunction(() => (window as unknown as Win).fso?.mode === "menu", { timeout: 90_000, polling: 100 });
  const menu = await page.evaluate(() => {
    const w = window as unknown as Win;
    return { coarse: matchMedia("(pointer: coarse)").matches, active: w.fso.touch.active, visible: w.fso.touch.visible, p1: document.querySelector("#controls li")?.textContent ?? "" };
  });
  console.log(`menu: pointer coarse ${menu.coarse}, controls active ${menu.active}, shown ${menu.visible}; P1: ${menu.p1}`);
  check(menu.coarse && menu.active && !menu.visible, `menu: the controls should be on for this phone and hidden in the menu ${JSON.stringify(menu)}`);
  check(menu.p1.includes("On-screen controls"), `menu: P1's line doesn't list the on-screen controls: ${menu.p1}`);
  await page.screenshot({ path: join(out, "chrome-menu.png") });
  await noZoom(page, "menu");

  // "Fight!" by a tap: also the gesture that starts the AudioContext (no autoplay flag in this browser).
  await page.tap("#start");
  await page.waitForFunction(() => (window as unknown as Win).fso.mode === "match", { timeout: 10_000 });
  await page.waitForFunction(() => ["running", "failed"].includes((window as unknown as Win).fso.audio?.state ?? ""), { timeout: 120_000, polling: 100 });
  const audio = await page.evaluate(() => ({ state: (window as unknown as Win).fso.audio!.state, context: (window as unknown as Win).fso.audio!.contextState }));
  console.log(`audio after the first tap: ${audio.state}, AudioContext ${audio.context}`);
  check(audio.state === "running" && audio.context === "running", `audio: ${JSON.stringify(audio)} after the first tap`);

  await stepByHand(page);
  for (let i = 0; i < 400 && (await game(page)).battle.phase !== "play"; i++) await tick(page, 10);
  const l = await layout(page);
  const frame = await page.evaluate(() => (window as unknown as { fso: { view: { frame(): { x: number; w: number } } } }).fso.view.frame());
  console.log(`layout: ${l.placement}; stick at (${l.stick.x.toFixed(0)}, ${l.stick.y.toFixed(0)}) r ${l.stick.r}; buttons ${l.buttons.map((b) => `${b.action} (${b.x.toFixed(0)}, ${b.y.toFixed(0)})`).join(", ")}; frame x ${frame.x.toFixed(0)}..${(frame.x + frame.w).toFixed(0)}`);
  check(l.placement === "margins" && l.stick.x + l.stick.r <= frame.x && l.buttons.every((b) => b.x - b.r >= frame.x + frame.w), `layout: the controls should sit in the letterbox margins ${JSON.stringify(l)}`);
  await page.screenshot({ path: join(out, "chrome-battle.png") });
  // At an iPhone's size too (Chrome's emulation has no safe area: env() is 0 there).
  await page.setViewport({ ...ANDROID, ...IPHONE });
  await tick(page, 1);
  const li = await layout(page);
  console.log(`layout at ${IPHONE.width}×${IPHONE.height}: ${li.placement}, buttons ${li.buttons.map((b) => `${b.action} (${b.x.toFixed(0)}, ${b.y.toFixed(0)})`).join(", ")}`);
  check(li.placement === "margins", `layout: ${li.placement} on an iPhone-sized screen`);
  await page.screenshot({ path: join(out, "chrome-battle-iphone.png") });
  await page.setViewport(ANDROID);
  await tick(page, 1);

  // Walk right, then down-right: the left thumb stays on the stick. (Up-right from there walks into The Field's house
  // door at (256, 168): a side room's warp, where he can't swing.)
  const S = l.stick, r = S.r;
  const stick = await page.touchscreen.touchStart(S.x, S.y);
  await stick.move(S.x + r * 0.8, S.y);
  let g0 = await game(page);
  await tick(page, 30);
  let g1 = await game(page);
  const walked = (g1.players[0]!.x - g0.players[0]!.x) / 256;
  await stick.move(S.x + r * 0.6, S.y + r * 0.6);
  g0 = g1;
  const diagMasks = (await tick(page, 20)).map((s) => s.mask);
  g1 = await game(page);
  const diag = { dx: (g1.players[0]!.x - g0.players[0]!.x) / 256, dy: (g1.players[0]!.y - g0.players[0]!.y) / 256 };
  console.log(`walk: ${walked.toFixed(1)} px right in 30 ticks; down-right ${diag.dx.toFixed(1)}, ${diag.dy.toFixed(1)} px in 20`);
  check(walked > 30, `walk: P1 went ${walked} px right`);
  // The diagonal's speed along x is 1.06 px a tick (1.5 straight).
  check(diagMasks.every((m) => m === (Button.Down | Button.Right)) && diag.dx > 15 && diag.dx < 25 && diag.dy > 15 && diag.dy < 25, `walk: down-right gave masks ${[...new Set(diagMasks)]}, moved ${JSON.stringify(diag)}`);
  // Sword with the right thumb while walking: a swing, the stick still held.
  const swing = await (async () => {
    const f = await page.touchscreen.touchStart(button(l, "Sword").x, button(l, "Sword").y);
    const seen = await tick(page, 3);
    await f.end();
    return [...seen, ...(await tick(page, 20))];
  })();
  await stick.end();
  const both = swing.some((s) => s.mask === (Button.Down | Button.Right | Button.Sword));
  console.log(`swing while walking: actions ${[...new Set(swing.map((s) => s.action))].join(" → ")}; stick and Sword held together: ${both}`);
  check(swing.some((s) => s.action === "swing") && both, `swing: ${JSON.stringify([...new Set(swing.map((s) => `${s.action}/${s.mask}`))])}`);
  await tick(page, 30);

  // Charge (Sword held 56 ticks) while walking left for a while, then the spin on release.
  const sword = await page.touchscreen.touchStart(button(l, "Sword").x, button(l, "Sword").y);
  const charge = await tick(page, 20);
  const left = await page.touchscreen.touchStart(S.x, S.y);
  await left.move(S.x - r * 0.8, S.y);
  charge.push(...(await tick(page, 30)));
  await left.end();
  charge.push(...(await tick(page, 40)));
  await sword.end();
  charge.push(...(await tick(page, 45)));
  const actions = [...new Set(charge.map((s) => s.action))];
  const heldSword = charge.slice(0, 90).every((s) => s.mask & Button.Sword);
  const walkCharging = charge.some((s) => s.mask === (Button.Sword | Button.Left));
  console.log(`charge and spin: ${actions.join(" → ")}; Sword held for 90 ticks ${heldSword}, walking left meanwhile ${walkCharging}`);
  check(actions.includes("charge") && actions.includes("spin") && heldSword && walkCharging, `charge: ${actions.join(", ")}, held ${heldSword}, walking ${walkCharging}`);
  await noZoom(page, "after the charge");

  // Lift P2 with Action, carry him, throw him: he lands hurt.
  await place(page, 0, 200, 184, "right");
  await place(page, 1, 216, 184, "up");
  await tap(page, button(l, "Action"));
  await tick(page, 15);
  let g = await game(page);
  const lifted = `${g.battle.fighters[0]!.move}/${g.battle.fighters[1]!.move}`;
  await tick(page, 12);
  await tap(page, button(l, "Action"));
  await tick(page, 14);
  g = await game(page);
  const thrown = g.battle.fighters[1]!.move;
  await tick(page, 30);
  g = await game(page);
  // (a thrown Link lands unhurt: traced in Dolphin, packages/sim carry.ts THROWN_LAND_DAMAGE)
  console.log(`lift and throw: ${lifted}, then P2 ${thrown}, landing with ${g.battle.fighters[1]!.hearts}/${g.battle.rules.hearts * 4} hearts`);
  check(lifted === "lift/held" && thrown === "thrown" && g.battle.fighters[1]!.hearts === g.battle.rules.hearts * 4, `lift and throw: ${lifted}, ${thrown}, ${g.battle.fighters[1]!.hearts}`);
  await tick(page, 60);

  // A roll: Action while walking.
  await place(page, 0, 150, 250, "right");
  const roll = await page.touchscreen.touchStart(S.x, S.y);
  await roll.move(S.x + r * 0.8, S.y);
  await tick(page, 4);
  await tap(page, button(l, "Action"));
  const rolled = (await tick(page, 8)).some((s) => s.move === "roll");
  await roll.end();
  console.log(`roll: ${rolled}`);
  check(rolled, "roll: Action while walking didn't roll");
  await tick(page, 30);

  // An item: the bow, shot with Item.
  await place(page, 0, 150, 184, "right");
  await place(page, 1, 300, 184, "right");
  await page.evaluate(() => ((window as unknown as Win).fso.game.battle.fighters[0]!.item = "bow"));
  await tap(page, button(l, "Item"));
  await tick(page, 10);
  const arrow = (await game(page)).battle.entities.some((e) => e.kind === "arrow");
  console.log(`item: an arrow in flight ${arrow}`);
  check(arrow, "item: Item didn't shoot the bow");
  await tick(page, 60);

  // Knock P2 out with sword taps: the round and the match (1 win) end, the results show.
  let hits = 0;
  for (let i = 0; i < 80; i++) {
    g = await game(page);
    if (g.battle.phase !== "play") break;
    const p2 = g.players[1]!;
    await place(page, 0, p2.x / 256 - 14, p2.y / 256, "right");
    const before = g.battle.fighters[1]!.hearts;
    await tap(page, button(l, "Sword"));
    await tick(page, 24);
    if ((await game(page)).battle.fighters[1]!.hearts < before) hits++;
  }
  // The game's "PRESS START" at the match's end: the Sword button moves on to the Total screen, the results over it.
  for (let i = 0; i < 120 && (await game(page)).battle.phase !== "matchOver"; i++) await tick(page, 10);
  await tick(page, 10);
  await tap(page, button(l, "Sword"));
  for (let i = 0; i < 30 && (await page.$eval("#results", (el) => (el as HTMLElement).hidden)); i++) await tick(page, 10);
  g = await game(page);
  const results = await page.$eval("#results", (el) => !(el as HTMLElement).hidden && (el.querySelector("h1")?.textContent ?? ""));
  console.log(`knockout: ${hits} sword hits, phase ${g.battle.phase}, results "${results}"`);
  check(g.battle.phase === "matchOver" && !!results && /P1/.test(results), `knockout: phase ${g.battle.phase}, results ${results}`);
  await page.screenshot({ path: join(out, "chrome-results.png") });
  await noZoom(page, "results");

  // Rematch by a tap; the pause button opens the game's pause screen (what Esc does), and taps on Choose an Area then
  // Yes go back to the menu.
  await page.tap("#rematch");
  await tick(page, 5);
  const pause = pauseCenter(await layout(page));
  await page.touchscreen.tap(pause.x, pause.y);
  await tick(page, 40);
  const paused = await page.evaluate(() => (window as unknown as { fso: { pause: { state: { phase: string } | null } } }).fso.pause.state?.phase ?? "none");
  await page.screenshot({ path: join(out, "chrome-pause.png") });
  await noZoom(page, "the pause");
  await page.tap("#pause-area");
  await tick(page, 45);
  await page.tap("#pause-yes");
  await tick(page, 40);
  const mode = await page.evaluate(() => (window as unknown as Win).fso.mode);
  console.log(`pause button: the pause ${paused}, then mode ${mode}`);
  check(paused === "menu" && mode === "menu", `pause: the pause ${paused}, mode ${mode} after Choose an Area / Yes`);
  const hidden = await page.evaluate(() => !(window as unknown as Win).fso.touch.visible);
  check(hidden, "pause: the controls stay on screen in the menu");

  await controlsDialog(page);
  await noZoom(page, "the Controls dialog");
  await page.close();
}

// The Controls dialog by touch: every target at least 44 px, the on-screen controls turned off, then back on.
async function controlsDialog(page: Page): Promise<void> {
  await page.tap("#controls-open");
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("#controls-dialog button, #controls-dialog .touch-modes label, #controls-dialog .touch-sliders label")]
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({ what: el.textContent?.trim().slice(0, 24) ?? el.tagName, h: el.getBoundingClientRect().height, w: el.getBoundingClientRect().width }))
      .filter((b) => b.h < 44 || b.w < 44),
  );
  check(small.length === 0, `controls dialog: targets under 44 px: ${JSON.stringify(small.slice(0, 5))}`);
  await page.screenshot({ path: join(out, "chrome-controls.png") });
  await page.tap('.touch-modes input[value="off"]');
  await page.tap("#controls-done");
  const off = await page.evaluate(() => ({ active: (window as unknown as Win).fso.touch.active, saved: localStorage.getItem("fso.touch"), p1: document.querySelector("#controls li")?.textContent ?? "" }));
  await page.tap("#controls-open");
  await page.tap('.touch-modes input[value="auto"]');
  await page.tap("#controls-done");
  const on = await page.evaluate(() => (window as unknown as Win).fso.touch.active);
  console.log(`controls dialog: ${small.length} small targets; "Never" → active ${off.active} (saved ${off.saved}); "On touch screens" → active ${on}`);
  check(!off.active && /"mode":"off"/.test(off.saved ?? "") && !off.p1.includes("On-screen") && on, `controls dialog: ${JSON.stringify(off)}, back on ${on}`);
}

// Two phones online: the controls drive this browser's Link; the pause button opens the match menu.
async function onlineDuel(browser: Browser): Promise<void> {
  const server = `ws://127.0.0.1:${signalPort}`;
  const a = await phone(browser, "online A");
  await a.goto(url(`battle/#create&autostart=2&arena=0&hearts=4&time=0&wins=1&name=A&server=${encodeURIComponent(server)}`), { waitUntil: "load" });
  await a.waitForFunction(() => (document.getElementById("online-room-code")?.textContent?.length ?? 0) >= 4, { timeout: 90_000, polling: 100 });
  const code = await a.$eval("#online-room-code", (el) => el.textContent!);
  const b = await phone(browser, "online B");
  await b.goto(url(`battle/#join=${code}&name=B&server=${encodeURIComponent(server)}`), { waitUntil: "load" });
  const playing = () => (window as unknown as Win).fso.online?.game?.battle.phase === "play";
  for (const p of [a, b]) await p.waitForFunction(playing, { timeout: 90_000, polling: 100 });
  await a.bringToFront();
  // A page in the background draws no frames, and the controls are placed when a frame is drawn: A's layout is the one
  // of its last frame before B's page came to the front (the room's), until it draws again.
  await a.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const l = await layout(a);
  const shown = await a.evaluate(() => ({ visible: (window as unknown as Win).fso.touch.visible, local: (window as unknown as Win).fso.online!.localPlayer }));
  check(shown.visible && shown.local === 0, `online: controls ${JSON.stringify(shown)}`);
  // Actions of P1 as each page sees them, sampled every few ms (the net match ticks in real time).
  for (const p of [a, b]) {
    await p.evaluate(() => {
      const w = window as unknown as Win & { __seen: Set<string> };
      w.__seen = new Set();
      setInterval(() => w.__seen.add(w.fso.online?.game?.players[0]?.action ?? "none"), 4);
    });
  }
  const x = (p: Page) => p.evaluate(() => (window as unknown as Win).fso.online!.game!.players[0]!.x / 256);
  const x0 = await x(a);
  const stick = await a.touchscreen.touchStart(l.stick.x, l.stick.y);
  await stick.move(l.stick.x + l.stick.r * 0.8, l.stick.y);
  await sleep(700);
  const sword = await a.touchscreen.touchStart(button(l, "Sword").x, button(l, "Sword").y);
  await sleep(80);
  await sword.end();
  await sleep(400);
  await stick.end();
  await sleep(300);
  const [xa, xb] = [await x(a), await x(b)];
  const seen = await Promise.all([a, b].map((p) => p.evaluate(() => [...(window as unknown as Win & { __seen: Set<string> }).__seen])));
  console.log(`online: P1 walked ${(xa - x0).toFixed(0)} px (B sees ${(xb - x0).toFixed(0)}), actions on A ${seen[0]!.join(", ")}, on B ${seen[1]!.join(", ")}`);
  check(xa - x0 > 40 && Math.abs(xa - xb) < 1, `online: P1 moved ${xa - x0} px on A, ${xb - x0} on B`);
  check(seen.every((s) => s.includes("swing")), `online: no swing seen ${JSON.stringify(seen)}`);
  await a.screenshot({ path: join(out, "chrome-online.png") });
  const p = pauseCenter(l);
  await sleep(500); // (a tap right after the stick's and the screenshot is often lost)
  await a.touchscreen.tap(p.x, p.y);
  // (the click a tap makes can come after the tap's promise: wait for it)
  const paused = await a.waitForFunction(() => (window as unknown as Win).fso.online!.ui.paused, { timeout: 3000, polling: 50 }).then(() => true, () => false);
  await a.screenshot({ path: join(out, "chrome-online-pause.png") });
  // (Continue lies see-through on the game's plate, placed once the pause screen is drawn)
  if (paused) await a.waitForSelector("#online-resume", { visible: true, timeout: 5000 }).then((el) => el!.tap(), (e) => problems.push(`online pause: Continue ${String(e)}`));
  const resumed = !(await a.evaluate(() => (window as unknown as Win).fso.online!.ui.paused));
  console.log(`online pause button: menu ${paused}, back to the match ${resumed}`);
  check(paused && resumed, `online pause: opened ${paused}, closed ${resumed}`);
  await noZoom(a, "online");
  await a.close();
  await b.close();
}

// The adventure (apps/game, Lake Hylia): its TV frame is letterboxed in the window as the battle's is, so the controls go
// in the margins, clear of the frame (and of the GBA window inside it), every target at least 44 px; the pause button
// opens the stage list.
async function adventure(browser: Browser): Promise<void> {
  const page = await phone(browser, "adventure");
  await page.goto(url("adventure/#room=1&x=300&y=280"), { waitUntil: "load" });
  await page.waitForFunction(() => !!(window as unknown as Win).fso?.touch?.layout, { timeout: 90_000, polling: 100 });
  const l = await layout(page);
  const frame = await page.evaluate(() => (window as unknown as { fso: { view: { frame(): { x: number; w: number } } } }).fso.view.frame());
  const outside = l.stick.x + l.stick.r <= frame.x && l.buttons.every((b) => b.x - b.r >= frame.x + frame.w) && l.pause.x + l.pause.w <= frame.x;
  const small = [l.stick, ...l.buttons].some((c) => c.r * 2 < 44) || l.pause.w < 44 || l.pause.h < 44;
  console.log(`adventure layout: ${l.placement}; stick (${l.stick.x.toFixed(0)}, ${l.stick.y.toFixed(0)}) r ${l.stick.r}; buttons ${l.buttons.map((b) => `${b.action} (${b.x.toFixed(0)}, ${b.y.toFixed(0)}) r ${b.r}`).join(", ")}; frame x ${frame.x.toFixed(0)}..${(frame.x + frame.w).toFixed(0)}`);
  check(l.placement === "margins" && outside && !small, `adventure layout: the controls should sit in the frame's margins, 44 px or more ${JSON.stringify({ l, frame })}`);
  await page.evaluate(() => {
    const w = window as unknown as Win & { __seen: Set<string> };
    w.__seen = new Set();
    setInterval(() => w.__seen.add(w.fso.game.players[0]!.action), 4);
  });
  const x = () => page.evaluate(() => (window as unknown as Win).fso.game.players[0]!.x / 256);
  const x0 = await x();
  const stick = await page.touchscreen.touchStart(l.stick.x, l.stick.y);
  await stick.move(l.stick.x - l.stick.r * 0.8, l.stick.y);
  await sleep(500);
  await stick.end();
  const walked = x0 - (await x());
  await page.touchscreen.tap(button(l, "Sword").x, button(l, "Sword").y);
  await sleep(300);
  const seen = await page.evaluate(() => [...(window as unknown as Win & { __seen: Set<string> }).__seen]);
  console.log(`adventure: walked ${walked.toFixed(0)} px left, actions ${seen.join(", ")}`);
  check(walked > 20 && seen.some((a) => a !== "none"), `adventure: walked ${walked}, actions ${seen.join(", ")}`);
  await page.screenshot({ path: join(out, "chrome-adventure.png") });
  await noZoom(page, "adventure");
  const p = pauseCenter(l);
  await page.touchscreen.tap(p.x, p.y);
  const stages = await page.waitForFunction(() => document.querySelector<HTMLDialogElement>("#stages")?.open, { timeout: 3000, polling: 50 }).then(() => true, () => false);
  console.log(`adventure pause button: the stage list ${stages ? "open" : "closed"}`);
  check(stages, "adventure: the pause button didn't open the stage list");
  await page.close();
}

async function chrome(): Promise<void> {
  const signal = await startSignalServer({ port: signalPort });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: join(out, "profile-chrome"), protocolTimeout: 180_000 });
  try {
    console.log(`\n=== ${await browser.version()}, ${ANDROID.width}×${ANDROID.height} @${ANDROID.deviceScaleFactor}, touch`);
    const home = watch(await browser.newPage(), "home");
    await loadData(home);
    await home.close();
    await localRound(browser);
    await onlineDuel(browser);
    await adventure(browser);
  } finally {
    await browser.close();
    await signal.close();
  }
}

// --- WebKit ---

/** As loadData, in Playwright. */
async function loadDataWebKit(page: WebKitPage): Promise<void> {
  await openReady(page, base, () => (window as unknown as Win).fsoHome?.data === "ready", 30_000);
}

async function webkitPass(): Promise<void> {
  const context = await webkit.launchPersistentContext(join(out, "profile-webkit"), { headless: true, viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    page.on("console", (m) => m.type() === "error" && problems.push(`[webkit] console error: ${m.text()}`));
    page.on("pageerror", (e) => problems.push(`[webkit] page error: ${e.message}`));
    console.log(`\n=== WebKit ${context.browser()?.version() ?? ""}, 844×390 @3, isMobile, hasTouch`);
    await loadDataWebKit(page);
    await page.evaluate(() => localStorage.removeItem("fso.touch"));
    await page.goto(url("battle/#arena=0&players=2&hearts=2&time=0&wins=1&cpu=")); // (both human, as above)
    await page.waitForFunction(() => (window as unknown as Win).fso?.mode === "menu", null, { timeout: 90_000 });
    const menu = await page.evaluate(() => ({ coarse: matchMedia("(pointer: coarse)").matches, active: (window as unknown as Win).fso.touch.active }));
    await page.tap("#start");
    await page.waitForFunction(() => (window as unknown as Win).fso.game?.battle?.phase === "play", null, { timeout: 30_000 });
    const after = await page.evaluate(() => ({ active: (window as unknown as Win).fso.touch.active, visible: (window as unknown as Win).fso.touch.visible, audio: (window as unknown as Win).fso.audio?.contextState ?? "none" }));
    console.log(`webkit: pointer coarse ${menu.coarse}, controls active ${menu.active} (after the first tap: ${after.active}, shown ${after.visible}); AudioContext ${after.audio}`);
    check(after.active && after.visible, `webkit: controls ${JSON.stringify({ menu, after })}`);
    const l = await layout(page);
    await page.evaluate(() => {
      const w = window as unknown as Win & { __seen: Set<string> };
      w.__seen = new Set();
      setInterval(() => w.__seen.add(w.fso.game.players[0]!.action), 4);
    });
    await page.touchscreen.tap(button(l, "Sword").x, button(l, "Sword").y);
    await sleep(300);
    const swung = await page.evaluate(() => [...(window as unknown as Win & { __seen: Set<string> }).__seen]);
    // Holds: Playwright only taps, so the stick is held by pointer events dispatched on its zone.
    const x0 = await page.evaluate(() => (window as unknown as Win).fso.game.players[0]!.x);
    const pointer = (type: string, x: number, y: number) =>
      page.evaluate(
        ([type, x, y]) => {
          const zone = document.querySelector('.fso-touch-zone[data-zone="stick"]')!;
          zone.dispatchEvent(new PointerEvent(type as string, { pointerId: 41, pointerType: "touch", isPrimary: true, clientX: x as number, clientY: y as number, bubbles: true, cancelable: true }));
        },
        [type, x, y] as const,
      );
    await pointer("pointerdown", l.stick.x, l.stick.y);
    await pointer("pointermove", l.stick.x + l.stick.r * 0.8, l.stick.y);
    await sleep(500);
    await pointer("pointerup", l.stick.x + l.stick.r * 0.8, l.stick.y);
    const walked = ((await page.evaluate(() => (window as unknown as Win).fso.game.players[0]!.x)) - x0) / 256;
    console.log(`webkit: Sword tap → ${swung.join(", ")}; held stick → ${walked.toFixed(0)} px`);
    check(swung.some((a) => ["stab", "lunge", "swing"].includes(a)) && walked > 20, `webkit: tap ${swung.join(", ")}, walked ${walked}`);
    await page.screenshot({ path: join(out, "webkit-battle.png") });
    await noZoom(page, "webkit battle");
    const p = pauseCenter(l);
    await leaveMatch(page, () => page.touchscreen.tap(p.x, p.y));
    const mode = await page.evaluate(() => (window as unknown as Win).fso.mode);
    check(mode === "menu", `webkit: pause button, Choose an Area, Yes → mode ${mode}`);
    await page.goto(url("adventure/"));
    await page.waitForFunction(() => !!(window as unknown as Win).fso?.touch?.layout, null, { timeout: 90_000 });
    const adv = await page.evaluate(() => (window as unknown as Win).fso.touch.visible);
    console.log(`webkit: pause button → ${mode}; Lake Hylia controls shown ${adv}`);
    check(adv, "webkit: Lake Hylia without controls");
    await noZoom(page, "webkit adventure");
  } finally {
    await context.close();
  }
}

try {
  if (which !== "webkit") await chrome();
  if (which !== "chrome") await webkitPass();
} finally {
  if (problems.length) {
    console.log(`\nPROBLEMS:\n  ${problems.join("\n  ")}`);
    process.exitCode = 1;
  } else console.log(`\nall good; screenshots in ${out}`);
}
