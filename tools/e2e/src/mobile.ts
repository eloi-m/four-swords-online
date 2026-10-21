// apps/battle on phones: headless Chrome emulating landscape phones (isMobile, hasTouch: 844×390 and 667×375 CSS px)
// taps through the menus and plays online. Builds the app and serves it (vite preview on port 5240, /signal proxied
// to its own lobby on 5241; MOBILE_VITE_PORT / MOBILE_SIGNAL_PORT to change them).
//   1. The battle menu (arena picker, options) at both sizes, a local match, the in-match menu, the results.
//   2. Two phones online: create a room, join by typing the code, the host's settings, a knockout to the results
//      (the in-match menu on the way), a rematch. P2's page is then frozen for 4 s (CDP Page.setWebLifecycleState,
//      close to what iOS does to a page in the background or a locked phone), with no rejoin key kept (sessionStorage
//      cleared): P1 sees "P2 lost the connection", P2 comes back to the "dropped" screen, goes back to the room, and
//      plays the next match.
//   3. Three phones: P3 is frozen, the other two play on; P3 thaws and rejoins the match in his slot by himself (the
//      lobby key, P1's snapshot): identical hashes from his snapshot on, P1 and P2 see him back. Then again with no
//      key kept: P3 watches the rest as a spectator (identical hashes).
//   4. The relay fallback: a match where ICE can't connect (#ice=fail), and one whose data channel goes quiet in one
//      direction mid-match: no interruption, the relay carries it.
//   5. A phone held upright: the menu, its Controls dialog and the online connect view as they are (Enter in the name
//      field goes on to the code, in the code field it joins, never a page load); the "rotate to landscape" screen
//      in the online room and in a match (not on a desktop window of the same size). An invite opened without a name
//      asks for one first; an invite pasted into an open page's address follows it.
// Everywhere: no horizontal scroll, visualViewport.scale 1, every visible button and field at least 44 px.
//   node tools/e2e/src/mobile.ts [outDir]
import { mkdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { startSignalServer } from "@fso/signal";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { build, preview } from "vite";
import { waitReady } from "./ready.ts";
import { browserPath } from "./browsers.ts";

const CHROME = browserPath("chrome");
const VITE_PORT = Number(process.env.MOBILE_VITE_PORT ?? 5240), SIGNAL_PORT = Number(process.env.MOBILE_SIGNAL_PORT ?? 5241);
const [outArg = "out/e2e-mobile"] = process.argv.slice(2);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });

const PHONES = {
  large: { width: 844, height: 390 }, // iPhone 12–15 in landscape
  small: { width: 667, height: 375 }, // iPhone SE / 8 in landscape
};
const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

type Fighter = { hearts: number; mode: string; stars: number; invincible: number };
type Game = { tick: number; players: { x: number; y: number; facing: string; action: string }[]; battle: { phase: string; round: number; matchWinner: number; fighters: Fighter[] } };
type Net = {
  match: number;
  localPlayer: number;
  frame: number;
  session: { finalizedFrame: number; stats: { desyncs: number } } | null;
  spectator: { frame: number } | null;
  transport: { route(peer: string): string; rescued: number; rtc: { send(peer: string, data: Uint8Array): void } | null };
};
type Online = {
  current: { net: Net; start: { players: number[] }; local: number } | null;
  finals: Map<number, number>;
  log: { type: string; player?: number; reason?: string }[];
  script: ((frame: number, state: Game) => number) | null;
  game: Game | null;
};
type Fso = { mode: string; game: Game | null; online: Online | null; wakeLock: { held: boolean }; screens: { visible(): string[] }; view: { frame(): { x: number; y: number; w: number; h: number } } };
type Win = Window & { fso: Fso };

process.env.FSO_SIGNAL_PORT = String(SIGNAL_PORT); // read by apps/battle/vite.config.ts for its /signal proxy
const signal = await startSignalServer({ port: SIGNAL_PORT });
// The production build, served by vite preview: a dev server's HMR client reloads the page when its socket drops,
// which a frozen page's does.
const battle = { configFile: resolve(import.meta.dirname, "../../../apps/battle/vite.config.ts"), root: resolve(import.meta.dirname, "../../../apps/battle"), logLevel: "warn" as const };
const dist = join(out, "dist");
await build({ ...battle, build: { outDir: dist, emptyOutDir: true } });
const vite = await preview({ ...battle, build: { outDir: dist }, preview: { port: VITE_PORT, strictPort: true } });
const base = `http://localhost:${VITE_PORT}/`;
console.log(`vite ${base}, lobby ws://localhost:${SIGNAL_PORT}`);

const browser: Browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: mkdtempSync(join(out, "profile-")),
  args: ["--autoplay-policy=no-user-gesture-required"],
  protocolTimeout: 60_000,
});
const problems: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until the page has loaded its game files (served by vite preview from extracted/) and reached `mode`. */
async function loadGame(page: Page, mode: string): Promise<void> {
  await waitReady(page, (m: string) => (window as unknown as Win).fso?.mode === m, 180_000, mode);
}

async function phone(label: string, hash = "", size = PHONES.large, mode = "menu", expectedErrors?: RegExp, opener: { newPage(): Promise<Page> } = browser): Promise<Page> {
  const page = await opener.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" && !expectedErrors?.test(m.text())) problems.push(`${label} console: ${m.text()}`);
    if (process.env.DEBUG) console.log(`[${label}] ${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`${label} page error: ${e instanceof Error ? e.message : String(e)}`));
  await page.emulate({ userAgent: UA, viewport: { ...size, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: size.width > size.height } });
  await page.goto(`${base}#${hash}`, { waitUntil: "domcontentloaded" });
  await loadGame(page, mode);
  return page;
}

/** Screenshot after two fresh frames: background pages don't render. */
async function shot(page: Page, file: string): Promise<void> {
  await page.bringToFront();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: join(out, file) });
}

/** A real tap (touch events) on the element, with the page in front (background pages don't take input). */
async function tap(page: Page, selector: string): Promise<void> {
  await page.bringToFront();
  await page.waitForSelector(selector, { visible: true, timeout: 10_000 });
  await page.tap(selector);
}

async function typeInto(page: Page, selector: string, text: string): Promise<void> {
  await tap(page, selector);
  await page.$eval(selector, (el) => ((el as HTMLInputElement).value = ""));
  await page.keyboard.type(text);
  const got = await page.$eval(selector, (el) => ({ value: (el as HTMLInputElement).value, focused: document.activeElement?.id ?? "" }));
  if (got.value !== text) problems.push(`typing into ${selector}: got "${got.value}" (focus on #${got.focused})`);
}

const visible = (page: Page, selector: string, timeout = 10_000) =>
  page.waitForFunction((sel) => { const el = document.querySelector(sel) as HTMLElement | null; return !!el && !el.hidden && el.getClientRects().length > 0; }, { timeout, polling: 50 }, selector);

/**
 * The phone layout rules on what's on screen now: no horizontal scroll (the page or a screen), no zoom, and every
 * visible button, select, text field, radio label and summary at least 44 px in both directions and inside the viewport.
 */
async function checkLayout(page: Page, label: string): Promise<void> {
  const r = await page.evaluate(() => {
    const issues: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > innerWidth + 1) issues.push(`page scrolls horizontally (${doc.scrollWidth} > ${innerWidth})`);
    if (visualViewport && visualViewport.scale !== 1) issues.push(`zoomed: visualViewport.scale ${visualViewport.scale}`);
    if (!matchMedia("(pointer: coarse)").matches) issues.push("not a coarse pointer");
    for (const el of document.querySelectorAll<HTMLElement>(".screen")) {
      if (el.hidden || getComputedStyle(el).display === "none") continue;
      if (el.scrollWidth > el.clientWidth + 1) issues.push(`#${el.id} scrolls horizontally (${el.scrollWidth} > ${el.clientWidth})`);
    }
    // (A radio button is tapped through its label.)
    const targets = document.querySelectorAll<HTMLElement>("button, select, input:not([type=checkbox]):not([type=radio]):not([type=file]), label:has(> input[type=radio]), summary");
    let n = 0;
    for (const el of targets) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || getComputedStyle(el).visibility === "hidden") continue; // not shown
      // Covered by another screen (e.g. the menu under the rotate screen): skip what can't be tapped.
      const probe = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, box.x + box.width / 2)), Math.min(innerHeight - 1, Math.max(0, box.y + box.height / 2)));
      const scrollable = el.closest(".screen");
      if (probe && !el.contains(probe) && !probe.contains(el) && !(scrollable && box.bottom > innerHeight)) continue;
      n++;
      const name = el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}${el.className ? "." + el.className.split(" ")[0] : ""} "${(el.textContent ?? "").trim().slice(0, 20)}"`;
      if (box.width < 44 - 0.5 || box.height < 44 - 0.5) issues.push(`${name} is ${box.width.toFixed(0)}×${box.height.toFixed(0)} px`);
      if (box.left < -0.5 || box.right > innerWidth + 0.5) issues.push(`${name} sticks out sideways (${box.left.toFixed(0)}…${box.right.toFixed(0)})`);
    }
    return { issues, n, size: `${innerWidth}×${innerHeight}` };
  });
  for (const issue of r.issues) problems.push(`${label} (${r.size}): ${issue}`);
  console.log(`  ${label} (${r.size}): ${r.n} targets, ${r.issues.length ? `${r.issues.length} issues` : "ok"}`);
}

const status = (page: Page) =>
  page.evaluate(() => {
    const o = (window as unknown as Win).fso.online!;
    const net = o.current?.net;
    const g = o.game;
    return {
      match: net?.match ?? 0,
      local: net?.localPlayer ?? -2,
      frame: net?.frame ?? 0,
      final: net?.session?.finalizedFrame ?? net?.spectator?.frame ?? 0,
      phase: g?.battle.phase ?? "",
      hearts: g?.battle.fighters.map((f) => f.hearts) ?? [],
      modes: g?.battle.fighters.map((f) => f.mode) ?? [],
      results: document.getElementById("online-results")!.hidden ? null : document.getElementById("online-results-title")!.textContent,
      log: o.log.map((e) => `${e.type}${e.player !== undefined ? ` P${e.player + 1}` : ""}${e.reason ? ` ${e.reason}` : ""}`),
    };
  });

const roomCode = async (page: Page) => {
  await page.waitForFunction(() => (document.getElementById("online-room-code")?.textContent?.length ?? 0) >= 4, { timeout: 20_000, polling: 100 });
  return page.$eval("#online-room-code", (el) => el.textContent!);
};
const waitMatch = (page: Page, match: number) =>
  page.waitForFunction((n) => (window as unknown as Win).fso.online?.current?.net.match === n, { timeout: 30_000, polling: 50 }, match);
const setScript = (page: Page, source: string) =>
  page.evaluate((src) => void ((window as unknown as Win).fso.online!.script = (0, eval)(src)), source);
const banner = (page: Page) => page.$eval("#online-banner", (el) => ((el as HTMLElement).hidden ? "" : el.textContent ?? ""));

/** Every page's final-state hashes on frames `from`..last must be identical. */
async function compareFinals(name: string, pages: Page[], from = 0): Promise<void> {
  const upTo = Math.min(...(await Promise.all(pages.map(status))).map((s) => s.final));
  const finals = await Promise.all(pages.map((p) => p.evaluate((a, n) => Array.from({ length: n - a + 1 }, (_, i) => (window as unknown as Win).fso.online!.finals.get(a + i) ?? -1), from, upTo)));
  const bad = finals[0]!.findIndex((h, i) => h === -1 || finals.some((other) => other[i] !== h));
  if (bad !== -1) problems.push(`${name}: hashes differ (or are missing) at frame ${from + bad}`);
  console.log(`  ${name}: ${bad === -1 ? `identical hashes on frames ${from}–${upTo}` : `DIVERGED at frame ${from + bad}`} (${pages.length} pages)`);
}

/** Freezes a page's JS (timers, workers, sockets' events) for `ms`, as iOS does to a page in the background. */
async function freeze(page: Page, ms: number): Promise<void> {
  const cdp = await page.createCDPSession();
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  await sleep(ms);
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await cdp.detach();
}

// P1's bot walks up to P2 and swings (as battle-online.ts); P2 turns his back so his shield doesn't block.
const CHASE = `(() => { let last = 0; return (frame, g) => {
  const b = g.battle; let out = 0;
  if (b.phase === "play") {
    const [p1, p2] = g.players, dx = (p2.x - p1.x) / 256, dy = (p2.y - p1.y) / 256;
    if (Math.abs(dy) > 3) out = b.props.sideViews & 1 ? (dx > 0 ? 8 : 4) : dy > 0 ? 2 : 1; // (side view: off his ledge)
    else if (dx > 22) out = 8;
    else if (dx < 10) out = 4;
    else if (p1.facing !== "right") out = 8;
    else if (p1.action === "none" && b.fighters[1].invincible === 0 && !(last & 16)) out = 16;
  }
  return (last = out);
}; })()`;
const TURN_AWAY = `(frame, g) => {
  const b = g.battle, t = b.phaseTick;
  if (b.phase !== "play") return 0;
  if (b.props.sideViews & 1) return t < 30 ? 4 : t >= 80 && t < 83 ? 1 : 0; // (side view: off his ledge to the floor first)
  return t < 3 ? 1 : 0;
}`;
// Walks around without fighting (a match that runs a while).
const WANDER = `(frame, g) => [1, 8, 2, 4][Math.floor(frame / 40) % 4]`;

async function localPlay(): Promise<Page> {
  console.log("\nmenu and a local match");
  const a = await phone("A", "", PHONES.large);
  await checkLayout(a, "menu");
  await shot(a, "menu-844.png");
  await tap(a, '.arena[data-room="2"]');
  if (!(await a.$eval('.arena[data-room="2"]', (el) => el.classList.contains("selected")))) problems.push("menu: tapping an arena didn't select it");
  await a.select("#opt-hearts", "2");
  await a.select("#opt-wins", "1");
  await a.setViewport({ ...PHONES.small, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
  await checkLayout(a, "menu");
  await shot(a, "menu-667.png");
  await a.setViewport({ ...PHONES.large, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
  await tap(a, "#start");
  await a.waitForFunction(() => (window as unknown as Win).fso.mode === "match", { timeout: 10_000, polling: 50 });
  // The game's intro text ("Be the last one standing!", J2D in the TV frame, which must fit the screen).
  await a.waitForFunction(() => (window as unknown as Win).fso.screens.visible().includes("rival"), { timeout: 5000, polling: 50 });
  const hud = await a.evaluate(() => {
    const f = (window as unknown as Win).fso, frame = f.view.frame();
    return { frame, wake: f.wakeLock.held, wakeApi: "wakeLock" in navigator };
  });
  console.log(`  local match: intro over a ${hud.frame.w.toFixed(0)}×${hud.frame.h.toFixed(0)} frame, wake lock ${hud.wake ? "held" : hud.wakeApi ? "not granted (headless)" : "no API"}`);
  if (hud.frame.x < 0 || hud.frame.x + hud.frame.w > PHONES.large.width + 0.5 || hud.frame.h < 300) problems.push(`local match: the TV frame doesn't fit ${JSON.stringify(hud)}`);
  await shot(a, "local-match.png");
  // The game's pause screen (Esc; the touch pause button does the same), its buttons tapped back to the menu, then back
  // into a match.
  await a.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" })));
  await visible(a, "#pause-area");
  await checkLayout(a, "pause");
  await shot(a, "local-pause.png");
  await tap(a, "#pause-area");
  await visible(a, "#pause-yes");
  await tap(a, "#pause-yes");
  await visible(a, "#menu");
  await checkLayout(a, "in-match menu");
  await tap(a, "#start");
  await a.waitForFunction(() => (window as unknown as Win).fso.mode === "match", { timeout: 10_000, polling: 50 });
  // The results: end the match by hand (the fights themselves are battle.ts's job).
  await a.evaluate(() => {
    const b = (window as unknown as Win).fso.game!.battle;
    b.fighters[0]!.stars = 1;
    b.matchWinner = 0;
    b.phase = "matchOver";
  });
  // The game's "PRESS START": a tap on the arena moves on to the Total screen, the results over its buttons.
  await a.waitForFunction(() => (window as unknown as Win).fso.screens.visible().includes("press"), { timeout: 5000, polling: 50 });
  await tap(a, "#screen");
  await visible(a, "#results");
  await checkLayout(a, "results");
  await shot(a, "local-results.png");
  await tap(a, "#to-menu");
  await visible(a, "#menu");
  if (await a.evaluate(() => (window as unknown as Win).fso.wakeLock.held)) problems.push("menu: the wake lock is still held");
  return a;
}

async function twoPhones(a: Page): Promise<void> {
  const name = "two phones online";
  console.log(`\n${name}`);
  await tap(a, "#play-online");
  await visible(a, "#online-connect");
  await typeInto(a, "#online-name", "Alice");
  await checkLayout(a, "lobby");
  await tap(a, "#online-create");
  const code = await roomCode(a);
  await checkLayout(a, "room (host, alone)");
  await tap(a, "#online-copy");
  await a.waitForFunction(() => document.getElementById("online-status")!.textContent !== "", { timeout: 5000, polling: 50 }).catch(() => {});
  console.log(`  room ${code}; invite button: "${await a.$eval("#online-copy", (el) => el.textContent)}" → "${await a.$eval("#online-status", (el) => el.textContent)}"`);
  const b = await phone("B", "", PHONES.small, "menu", /Back-Forward Cache/); // (Chrome closes a frozen page's sockets)
  await tap(b, "#play-online");
  await typeInto(b, "#online-name", "Bob");
  await typeInto(b, "#online-code", code.toLowerCase());
  await tap(b, "#online-join");
  await visible(b, "#online-room").catch(async (e) => {
    throw new Error(`B didn't get into the room: "${await b.$eval("#online-status", (el) => el.textContent)}", code field "${await b.$eval("#online-code", (el) => (el as HTMLInputElement).value)}" (${e})`);
  });
  await a.waitForFunction(() => document.querySelectorAll("#online-players li:not(.open)").length === 2, { timeout: 10_000, polling: 50 });
  await a.select("#online-arena", "2");
  await a.select("#online-hearts", "2");
  await a.select("#online-wins", "1");
  await a.select("#online-max", "2");
  await b.waitForFunction(() => (document.getElementById("online-arena") as HTMLSelectElement).value === "2", { timeout: 5000, polling: 50 }).catch(() => problems.push(`${name}: the host's settings didn't reach the guest`));
  await checkLayout(a, "room (host)");
  await shot(a, "room-host.png");
  await checkLayout(b, "room (guest)");
  await shot(b, "room-guest.png");
  await tap(a, "#online-start");
  await Promise.all([waitMatch(a, 1), waitMatch(b, 1)]);
  const b1 = await banner(a);
  await checkLayout(a, "online match");
  const fits = await a.$eval("#online-banner", (el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
  if (!fits) problems.push(`${name}: the banner "${b1}" doesn't fit the screen`);
  await shot(a, "online-match-A.png");
  // The in-match menu on the guest, by the same path as Esc (the touch pause button).
  await b.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" })));
  await visible(b, "#online-pause");
  await checkLayout(b, "online in-match menu");
  await shot(b, "online-pause-B.png");
  await tap(b, "#online-resume");
  await setScript(a, CHASE);
  await setScript(b, TURN_AWAY);
  await Promise.all([a, b].map((p) => p.waitForFunction(() => !document.getElementById("online-results")!.hidden, { timeout: 90_000, polling: 250 }))).catch(() => problems.push(`${name}: no results`));
  for (const [i, page] of [a, b].entries()) {
    const s = await status(page);
    if (!/P1 WINS!/.test(s.results ?? "")) problems.push(`${name}: ${"AB"[i]} shows "${s.results}"`);
    await checkLayout(page, `online results ${"AB"[i]}`);
  }
  await shot(b, "online-results-B.png");
  await compareFinals(`${name}, match 1`, [a, b]);

  console.log(`\n${name}: rematch, P2's phone locks for 4 s`);
  await tap(a, "#online-rematch");
  await Promise.all([waitMatch(a, 2), waitMatch(b, 2)]);
  await setScript(a, WANDER);
  await setScript(b, WANDER);
  await a.waitForFunction(() => (window as unknown as Win).fso.online!.game!.battle.phase === "play", { timeout: 20_000, polling: 50 });
  await b.bringToFront();
  await sleep(1000);
  await a.bringToFront(); // B goes to the background (as a phone that locks), and tells A so
  await b.evaluate(() => sessionStorage.clear()); // (no rejoin key kept: the "dropped" screen, scenario 3 rejoins)
  const frozenAt = Date.now();
  await freeze(b, 4000);
  // A: "P2 (Bob) dropped out" (his page said it went to the background), and the match is over for him.
  const seen = await a.waitForFunction(() => (window as unknown as Win).fso.online!.log.find((e) => e.type === "disconnected"), { timeout: 5000, polling: 50 }).then((h) => h.jsonValue(), () => null);
  console.log(`  A saw ${JSON.stringify(seen)} ${Date.now() - frozenAt} ms after the freeze; banner "${await banner(a)}"`);
  if (!seen) problems.push(`${name}: A didn't see P2 go`);
  await a.waitForFunction(() => /P2 \(Bob\) (dropped out|lost the connection)/.test(document.getElementById("online-results-title")!.textContent!) && !document.getElementById("online-results")!.hidden, { timeout: 5000, polling: 50 }).catch(() => problems.push(`${name}: A has no "P2 dropped out" screen`));
  console.log(`  A: "${await a.$eval("#online-results-title", (el) => el.textContent)}" / "${await a.$eval("#online-standings", (el) => el.textContent)}"`);
  await checkLayout(a, "opponent dropped");
  await shot(a, "lost-A.png");
  // B wakes up to the "dropped" screen.
  await visible(b, "#online-dropped", 5000).catch(() => problems.push(`${name}: B has no "dropped" screen`));
  const dropped = await b.evaluate(() => ({ text: document.getElementById("online-dropped-text")!.textContent, watch: !document.getElementById("online-dropped-watch")!.hidden, net: (window as unknown as Win).fso.online!.current !== null, how: (window as unknown as { fso: { online: { lastDrop: unknown } } }).fso.online.lastDrop }));
  console.log(`  B: "${dropped.text}" (watch offered: ${dropped.watch}, noticed by ${JSON.stringify(dropped.how)})`);
  if (!/in the background/.test(dropped.text ?? "") || dropped.watch || dropped.net) problems.push(`${name}: B's dropped screen ${JSON.stringify(dropped)}`);
  await checkLayout(b, "dropped");
  await shot(b, "dropped-B.png");
  // Back in the room, or (the lobby dropped B too, so he rejoined after the match started) watching it.
  await tap(b, "#online-dropped-room");
  await b.waitForFunction(() => !document.getElementById("online-room")!.hidden || (window as unknown as Win).fso.online!.current?.net.localPlayer === -1, { timeout: 10_000, polling: 50 }).catch(async () => {
    throw new Error(`B isn't back in the room: status "${await b.$eval("#online-status", (el) => el.textContent)}", dropped screen ${await b.$eval("#online-dropped", (el) => !(el as HTMLElement).hidden)}, connect ${await b.$eval("#online-connect", (el) => !(el as HTMLElement).hidden)}`);
  });
  // The host brings everyone back to the room; Bob takes a slot again (if he came back as a spectator), and plays.
  await tap(a, "#online-to-room");
  await visible(a, "#online-room");
  await b.waitForFunction(() => !(document.getElementById("online-role") as HTMLButtonElement).disabled, { timeout: 5000, polling: 50 }).catch(() => {});
  if ((await b.$eval("#online-role", (el) => el.textContent)) === "Play") await tap(b, "#online-role");
  await a.waitForFunction(() => !(document.getElementById("online-start") as HTMLButtonElement).disabled, { timeout: 5000, polling: 50 }).catch(() => problems.push(`${name}: can't start again`));
  await tap(a, "#online-start");
  await Promise.all([waitMatch(a, 3), waitMatch(b, 3)]).catch(() => problems.push(`${name}: no match 3`));
  const s3 = await status(b);
  if (s3.local !== 1) problems.push(`${name}: Bob isn't P2 in match 3 (${s3.local})`);
  await sleep(1500);
  await compareFinals(`${name}, match 3`, [a, b]);
  for (const page of [a, b]) await page.close();
}

/**
 * Three phones, P3 frozen past the cut. `rejoin`: he comes back into the match in his slot by himself (his key, a
 * snapshot), hashes identical from his snapshot on; else (no key kept) he watches the rest as a spectator.
 */
async function threePhones(rejoin: boolean): Promise<void> {
  const name = `three phones, P3 frozen${rejoin ? ", rejoins" : ", watches"}`;
  console.log(`\n${name}`);
  const a = await phone("A3", "create&autostart=3&players=3&name=A&arena=0&hearts=6&wins=3&time=0", PHONES.large, "online");
  const code = await roomCode(a);
  const b = await phone("B3", `join=${code}&name=B`, PHONES.small, "online");
  const c = await phone("C3", `join=${code}&name=C`, PHONES.large, "online", /Back-Forward Cache/);
  await Promise.all([a, b, c].map((p) => waitMatch(p, 1)));
  for (const p of [a, b, c]) await setScript(p, WANDER);
  await a.waitForFunction(() => (window as unknown as Win).fso.online!.game!.battle.phase === "play", { timeout: 20_000, polling: 50 });
  await c.bringToFront();
  await sleep(500);
  await a.bringToFront();
  if (!rejoin) await c.evaluate(() => sessionStorage.clear());
  await c.evaluate(() => void ((window as unknown as Win & { frozenNet?: unknown }).frozenNet = (window as unknown as Win).fso.online!.current!.net)); // (the match it drops out of)
  await freeze(c, 4000);
  await Promise.all([a, b].map((p) => p.waitForFunction(() => /P3 \(C\) (dropped out|lost the connection)/.test(document.getElementById("online-banner")!.textContent!) || (window as unknown as Win).fso.online!.log.some((e) => e.type === "disconnected" && e.player === 2), { timeout: 5000, polling: 50 }))).catch(() => problems.push(`${name}: no "P3 dropped out" banner`));
  if (rejoin) {
    // Back in by himself: a new session from P1's snapshot, in his slot (P3), and the others saw him come back.
    const t0 = Date.now();
    await c.waitForFunction(() => { const w = window as unknown as Win & { frozenNet?: unknown }, n = w.fso.online!.current?.net; return !!n && n !== w.frozenNet && n.match === 1 && n.localPlayer === 2 && !!n.session; }, { timeout: 25_000, polling: 100 }).catch(async () => problems.push(`${name}: C isn't back in the match (status "${await c.$eval("#online-status", (el) => el.textContent)}", dropped screen ${await c.$eval("#online-dropped", (el) => !(el as HTMLElement).hidden)})`));
    const how = await c.evaluate(() => (window as unknown as { fso: { online: { lastDrop: unknown } } }).fso.online.lastDrop);
    console.log(`  C back in ${((Date.now() - t0) / 1000).toFixed(1)} s after the thaw (noticed by ${JSON.stringify(how)}); banner "${await banner(c)}"`);
    for (const [i, p] of [a, b].entries()) {
      await p.waitForFunction(() => (window as unknown as Win).fso.online!.log.some((e) => e.type === "rejoined" && e.player === 2), { timeout: 10_000, polling: 50 }).catch(() => problems.push(`${name}: ${"AB"[i]} didn't see P3 come back`));
    }
    if (await c.$eval("#online-dropped", (el) => !(el as HTMLElement).hidden)) problems.push(`${name}: C shows the "dropped" screen`);
    await setScript(c, WANDER);
    await sleep(3000);
    const st = await Promise.all([a, b, c].map(status));
    console.log(`  frames ${st.map((s) => s.frame).join(" / ")}, events A [${st[0]!.log.join(", ")}]`);
    if (st[0]!.phase !== "play") problems.push(`${name}: the others stopped playing (${st[0]!.phase})`);
    if (st.some((s) => s.log.some((e) => /desync/.test(e)))) problems.push(`${name}: a desync`);
    await checkLayout(c, "rejoined");
    await shot(c, "rejoined-C.png");
    const first = await c.evaluate(() => Math.min(...(window as unknown as Win).fso.online!.finals.keys()));
    await compareFinals(`${name}, P1 and P2`, [a, b]);
    await compareFinals(`${name}, everyone from frame ${first} (C's snapshot)`, [a, b, c], first);
  } else {
    await visible(c, "#online-dropped", 5000).catch(() => problems.push(`${name}: C has no "dropped" screen`));
    if (!(await c.$eval("#online-dropped-watch", (el) => !(el as HTMLElement).hidden))) problems.push(`${name}: C isn't offered to watch`);
    await tap(c, "#online-dropped-watch");
    await c.waitForFunction(() => (window as unknown as Win).fso.online!.current?.net.localPlayer === -1, { timeout: 10_000, polling: 50 }).catch(() => problems.push(`${name}: C isn't watching`));
    // The spectator replays from frame 0 and catches up with the players.
    await c.waitForFunction(() => ((window as unknown as Win).fso.online!.current?.net.frame ?? 0) > 300, { timeout: 20_000, polling: 100 }).catch(() => problems.push(`${name}: C's spectator feed doesn't advance`));
    await sleep(1000);
    const st = await Promise.all([a, b, c].map(status));
    console.log(`  frames ${st.map((s) => s.frame).join(" / ")}, P3's Link ${st[0]!.modes[2]}, events A [${st[0]!.log.join(", ")}]`);
    if (st[0]!.modes[2] !== "dead") problems.push(`${name}: P3's Link still in (${st[0]!.modes[2]})`);
    if (st[0]!.phase !== "play") problems.push(`${name}: the others stopped playing (${st[0]!.phase})`);
    await checkLayout(c, "spectating");
    await shot(c, "spectating-C.png");
    await compareFinals(name, [a, b, c]);
  }
  for (const page of [a, b, c]) await page.close();
}

async function relayFallback(): Promise<void> {
  const name = "relay fallback";
  console.log(`\n${name}: ICE can't connect (#ice=fail)`);
  const a = await phone("RA", "create&autostart=2&name=A&arena=2&hearts=2&wins=1&ice=fail", PHONES.large, "online");
  const b = await phone("RB", `join=${await roomCode(a)}&name=B&ice=fail`, PHONES.small, "online");
  await Promise.all([waitMatch(a, 1), waitMatch(b, 1)]);
  await setScript(a, CHASE);
  await setScript(b, TURN_AWAY);
  await Promise.all([a, b].map((p) => p.waitForFunction(() => !document.getElementById("online-results")!.hidden, { timeout: 90_000, polling: 250 }))).catch(() => problems.push(`${name}: no results over the relay`));
  const routes = await Promise.all([a, b].map((p) => p.evaluate(() => { const t = (window as unknown as Win).fso.online!.current!.net.transport; return ["1", "2"].map((id) => t.route(id)).join(",") })));
  const st = await Promise.all([a, b].map(status));
  console.log(`  routes A ${routes[0]}, B ${routes[1]}; results "${st[0]!.results}"; events [${st[0]!.log.join(", ")}]`);
  if (st.some((s) => s.log.some((e) => /interrupted|disconnected/.test(e)))) problems.push(`${name}: the match was interrupted over the relay`);
  if (!routes.every((r) => r.includes("relay"))) problems.push(`${name}: not on the relay (${routes.join(" / ")})`);
  await compareFinals(`${name}, no ICE`, [a, b]);
  for (const page of [a, b]) await page.close();

  console.log(`\n${name}: the data channel goes quiet one way mid-match`);
  const c = await phone("RC", "create&autostart=2&name=C&arena=2&hearts=6&wins=3", PHONES.large, "online");
  const d = await phone("RD", `join=${await roomCode(c)}&name=D`, PHONES.small, "online");
  await Promise.all([waitMatch(c, 1), waitMatch(d, 1)]);
  for (const p of [c, d]) await setScript(p, WANDER);
  const peerOf = (p: Page) => p.evaluate(() => { const run = (window as unknown as Win).fso.online!.current!; return String(run.start.players.find((_, i) => i !== run.local)); });
  const [cPeer, dPeer] = [await peerOf(c), await peerOf(d)];
  await c.waitForFunction((peer) => (window as unknown as Win).fso.online!.current!.net.transport.route(peer) === "webrtc", { timeout: 15_000, polling: 100 }, cPeer).catch(() => problems.push(`${name}: WebRTC never connected`));
  // Mid-match: past the round's intro.
  await d.waitForFunction(() => (window as unknown as Win).fso.online!.game?.battle.phase === "play", { timeout: 20_000, polling: 100 }).catch(() => problems.push(`${name}: the round never started`));
  await sleep(1000);
  // C's data channel packets now vanish (its channel still reads "open"): D stops hearing C over WebRTC.
  await c.evaluate(() => void ((window as unknown as Win).fso.online!.current!.net.transport.rtc!.send = () => {}));
  await sleep(4000);
  const cs = await status(c), ds = await status(d);
  const info = await Promise.all([[c, cPeer], [d, dPeer]].map(([p, peer]) => (p as Page).evaluate((id) => { const t = (window as unknown as Win).fso.online!.current!.net.transport; return { route: t.route(id), rescued: t.rescued }; }, peer as string)));
  console.log(`  after 4 s: C ${JSON.stringify(info[0])}, D ${JSON.stringify(info[1])}; events C [${cs.log.join(", ")}], D [${ds.log.join(", ")}]`);
  if ([cs, ds].some((s) => s.log.some((e) => /disconnected/.test(e)))) problems.push(`${name}: a player was cut when the data channel went quiet`);
  if (!info[0]!.rescued || info[1]!.route !== "relay") problems.push(`${name}: the relay didn't take over (${JSON.stringify(info)})`);
  if (ds.phase !== "play") problems.push(`${name}: the match stopped (${ds.phase})`);
  await compareFinals(`${name}, quiet data channel`, [c, d]);
  for (const page of [c, d]) await page.close();
}

async function portrait(): Promise<void> {
  console.log("\nportrait");
  const UPRIGHT = { width: 390, height: 844 };
  const shown = (page: Page) => page.evaluate(() => { const r = document.getElementById("rotate")!; const box = r.getBoundingClientRect(); return getComputedStyle(r).display !== "none" && document.elementFromPoint(innerWidth / 2, innerHeight / 2)!.closest("#rotate") !== null && box.width >= innerWidth; });
  const upright = async (page: Page, label: string, file: string) => {
    if (await shown(page)) problems.push(`portrait: the rotate screen covers the ${label}`);
    await checkLayout(page, `${label} (portrait)`);
    await shot(page, file);
  };
  const focused = (page: Page) => page.evaluate(() => document.activeElement?.id ?? "");
  const p = await phone("P", "", UPRIGHT);
  await upright(p, "menu", "portrait-menu.png");
  await tap(p, "#controls-open");
  await visible(p, "#controls-dialog");
  await upright(p, "Controls dialog", "portrait-controls.png");
  await tap(p, "#controls-done");
  await tap(p, "#play-online");
  await visible(p, "#online-connect");
  await typeInto(p, "#online-name", "Uma");
  await upright(p, "connect view", "portrait-connect.png");
  const href = await p.evaluate(() => location.href);
  await p.keyboard.press("Enter");
  if ((await focused(p)) !== "online-code") problems.push(`portrait: Enter in the name field went to #${await focused(p)}, not the code`);
  await p.keyboard.press("Enter"); // (no code yet)
  const refused = await p.$eval("#online-status", (el) => el.textContent ?? "");
  if (!/room's word/.test(refused)) problems.push(`portrait: joining without a code says "${refused}"`);
  if ((await p.evaluate(() => location.href)) !== href) problems.push("portrait: the connect form loaded a page");

  // The room, where the host starts the match, asks for landscape.
  await tap(p, "#online-create");
  const code = await roomCode(p);
  if (!(await shown(p))) problems.push("portrait: no rotate screen in the online room");
  await shot(p, "portrait-room.png");

  // An invite opened with no name (another browser: none saved): the connect view with the word filled in, upright.
  const fresh = await browser.createBrowserContext();
  const g = await phone("G", `join=${code.toLowerCase()}`, UPRIGHT, "online", undefined, fresh);
  await visible(g, "#online-connect");
  const invited = await g.evaluate(() => ({ code: (document.getElementById("online-code") as HTMLInputElement).value, status: document.getElementById("online-status")!.textContent, hash: location.hash }));
  if (invited.code !== code || !/Pick a name/.test(invited.status ?? "") || invited.hash !== "#online") problems.push(`portrait: a nameless invite showed ${JSON.stringify(invited)}`);
  if ((await focused(g)) !== "online-name") problems.push(`portrait: a nameless invite focused #${await focused(g)}, not the name`);
  await upright(g, "invite without a name", "portrait-invite.png");
  await g.keyboard.type("Gus");
  await g.keyboard.press("Enter");
  await g.keyboard.press("Enter");
  await visible(g, "#online-room").catch(async () => problems.push(`portrait: Go didn't join: "${await g.$eval("#online-status", (el) => el.textContent)}"`));
  if (!(await shown(g))) problems.push("portrait: no rotate screen in the guest's room");

  // An invite pasted into the address bar of an open page: it reloads to follow it.
  const q = await phone("Q", "", UPRIGHT);
  await q.evaluate((c) => void (location.hash = `join=${c}&name=Hal`), code);
  await visible(q, "#online-room", 60_000).catch(() => problems.push("portrait: a pasted invite didn't take the open page into the room"));
  await p.waitForFunction(() => document.querySelectorAll("#online-players li:not(.open)").length === 3, { timeout: 10_000, polling: 50 }).catch(() => problems.push("portrait: the host doesn't see the two guests"));
  const names = await p.$$eval("#online-players .who", (els) => els.map((el) => el.textContent));
  if (names.slice(0, 3).join() !== "Uma,Gus,Hal") problems.push(`portrait: the room's names are ${names.join(", ")}`);

  await p.setViewport({ ...PHONES.large, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
  if (await shown(p)) problems.push("portrait: the rotate screen stays in landscape");
  await checkLayout(p, "room after rotating");
  for (const page of [g, q]) await page.close();
  await fresh.close();
  await p.close();

  // A match upright asks for landscape; a desktop window of a phone's shape doesn't (a mouse, not a touch screen).
  const m = await phone("M", "arena=0&players=2&cpu=2&start", UPRIGHT, "match");
  if (!(await shown(m))) problems.push("portrait: no rotate screen in a match");
  await m.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
  if (await shown(m)) problems.push("portrait: a narrow desktop window gets the rotate screen");
  console.log(`  room ${code}: menus upright, rotate screen in the room and in a match (a phone only)`);
  await m.close();
}

try {
  const a = await localPlay();
  await twoPhones(a);
  await threePhones(true);
  await threePhones(false);
  await relayFallback();
  await portrait();
} catch (error) {
  problems.push(`aborted: ${(error as Error).stack ?? (error as Error).message}`);
} finally {
  await browser.close();
  await vite.close();
  await signal.close();
}
if (problems.length) {
  console.log(`\nproblems:\n${problems.join("\n")}`);
  process.exitCode = 1;
} else console.log(`\nall scenarios passed; screenshots in ${out}`);
