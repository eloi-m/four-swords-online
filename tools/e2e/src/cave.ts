// The Cave of No Return (boss011) on screen in apps/game, played by its scripted route (window.fso.route) in headless
// Chrome: the rooms' darkness (light.ts: room 6 at level 10, darker than the same frame with #nolight; room 12 lit), the lamp's
// light round the Links, the lit candles' and torches' lights, room 3's burning arrows' flames (effect 189 synced),
// room 11's chain levers and room 4's Shadow Link drawn (dark, his change's roulette, then in a Link's colors), room 4
// brightening. A screenshot at each into out/e2e/cave-*.png (kept out of git).
// Expects the dev server (pnpm --filter @fso/game dev), which serves the game files.
//   node tools/e2e/src/cave.ts [url] [outDir]
import { mkdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import puppeteer, { type Page } from "puppeteer-core";
import { decodePng } from "../../render/src/png.ts";
import { openReady } from "./ready.ts";
import { browserPath } from "./browsers.ts";

const CHROME = browserPath("chrome");
const [urlArg = "http://localhost:5174/", outArg = "out/e2e"] = process.argv.slice(2);
const base = urlArg.split("#")[0]!;
const out = resolve(outArg);
mkdirSync(out, { recursive: true });

/** What the page shows, read each step (window.fso). */
interface Seen {
  tick: number;
  room: number;
  area: number;
  gear: string;
  milestone: number;
  done: boolean;
  error: string;
  active: boolean;
  ambient: number;
  circles: number;
  lamp: number;
  arrowFlames: number;
  drawn: Record<string, number>;
  lever: number;
  shadow: { form: number; state: string; kind: number } | null;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: mkdtempSync(join(out, "profile-")),
  defaultViewport: { width: 1216, height: 896, deviceScaleFactor: 1 },
});
const problems: string[] = [];

async function open(page: Page, hash: string): Promise<void> {
  await page.goto("about:blank");
  await openReady(page, `${base}#${hash}`, () => document.getElementById("boot")!.hidden);
  // The game loop captured: the test steps it.
  await page.evaluate(() => {
    const w = window as unknown as { __loop?: FrameRequestCallback; __now: number };
    window.requestAnimationFrame = (cb) => {
      if (!w.__loop) w.__now = performance.now();
      w.__loop = cb;
      return 1;
    };
  });
  await page.waitForFunction(() => (window as unknown as { __loop?: unknown }).__loop !== undefined, { polling: 20 });
}

/** Steps the loop `ms` at a time (250: 15 ticks a frame) until `until` holds for what the page shows (or `frames` run out). */
async function stepUntil(page: Page, until: string, ms: number, frames: number): Promise<Seen | null> {
  return page.evaluate(
    (until, ms, frames) => {
      type W = { __loop: FrameRequestCallback; __now: number; fso: any };
      const w = window as unknown as W, f = w.fso;
      const read = (): Seen => {
        const g = f.game, a = g.adventure, v = f.view, r = f.route.state;
        const sources = v.light.sources(g, f.stage) as { radius: number; alpha: number }[];
        const light = v.light.current();
        const shadow = a.enemies.find((e: { type: string }) => e.type === "SLK2");
        return {
          tick: g.tick,
          room: a.room,
          area: a.area,
          gear: a.gear,
          milestone: r?.milestone ?? -1,
          done: !!r?.done,
          error: r?.error ?? "",
          active: v.lighting.active,
          ambient: light ? light.ambient : 255,
          circles: v.lighting.drawn,
          lamp: sources.filter((s) => s.alpha === 255).length,
          arrowFlames: v.drawnArrowFlames,
          drawn: { ...v.enemies.drawn },
          lever: Math.max(0, ...a.levers.map((l: { pull: number }) => l.pull)),
          shadow: shadow ? { form: shadow.flags, state: shadow.state, kind: shadow.kind } : null,
        };
      };
      const test = new Function("s", `return ${until};`) as (s: Seen) => boolean;
      for (let i = 0; i < frames; i++) {
        w.__loop((w.__now += ms));
        const s = read();
        if (test(s) || s.done || s.error) return s;
      }
      return null;
    },
    until,
    ms,
    frames,
  ) as Promise<Seen | null>;
}

/** Mean luma of the TV frame's middle (the screenshot). */
async function shot(page: Page, name: string): Promise<number> {
  const png = (await page.screenshot({ path: join(out, `cave-${name}.png`) })) as Uint8Array;
  const img = decodePng(png), ch = img.data.length / (img.width * img.height);
  let sum = 0, n = 0;
  for (let y = Math.floor(img.height * 0.2); y < img.height * 0.8; y += 2) {
    for (let x = Math.floor(img.width * 0.2); x < img.width * 0.8; x += 2) {
      const i = (y * img.width + x) * ch;
      sum += 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;
      n++;
    }
  }
  return sum / n;
}

/** One check: step to it, print what's seen, screenshot it. */
async function check(page: Page, name: string, until: string, ms: number, frames: number): Promise<Seen | null> {
  const s = await stepUntil(page, until, ms, frames);
  if (!s || s.error || (s.done && !new Function("s", `return ${until};`)(s))) {
    problems.push(`${name}: not seen (${s ? `tick ${s.tick} room ${s.room}${s.error ? `, route error ${s.error}` : ""}` : "ran out"})`);
    if (s) console.log(`${name}: last seen ${JSON.stringify(s)}`);
    return null;
  }
  const luma = await shot(page, name);
  console.log(`${name}: tick ${s.tick} room ${s.room}/${s.area}, light ${s.active ? `level ${s.ambient}` : "off"}, ${s.circles} circles (${s.lamp} lamp), arrow flames ${s.arrowFlames}, drawn ${JSON.stringify(s.drawn)}, luma ${luma.toFixed(1)}`);
  return s;
}

try {
  const page = await browser.newPage();
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`page error: ${e instanceof Error ? e.message : String(e)}`));

  // Room 6 without its darkness, then with it: the same tick, darker (level 10, its LTEV kind 3).
  await open(page, "stage=boss011&room=6&players=4&mute&nolight");
  await stepUntil(page, "s.tick >= 60", 1000 / 60, 200);
  const bright = await shot(page, "room6-nolight");
  await open(page, "stage=boss011&room=6&players=4&mute");
  const dark = await check(page, "room6", "s.tick >= 60", 1000 / 60, 200);
  const darkLuma = await shot(page, "room6");
  console.log(`room 6: luma ${darkLuma.toFixed(1)} dark, ${bright.toFixed(1)} with #nolight`);
  if (!dark?.active || dark.ambient !== 10) problems.push(`room 6: not dark (${JSON.stringify(dark)})`);
  if (!(darkLuma < bright * 0.6)) problems.push(`room 6: the frame isn't darker (${darkLuma.toFixed(1)} vs ${bright.toFixed(1)})`);
  // The stage's start, room 12 (no LTEV): lit.
  await open(page, "stage=boss011&players=4&mute");
  const start = await check(page, "start", "s.tick >= 60", 1000 / 60, 200);
  if (start?.active) problems.push(`room 12: dark (level ${start.ambient})`);

  await page.evaluate(() => (window as unknown as { fso: { route: { start(): void } } }).fso.route.start());
  // The lamp from room 6's pedestal: the Links carry its light (100 px, strength 255).
  const lamp = await check(page, "lamp", "s.gear === 'lamp' && s.lamp >= 1", 250, 4000);
  if (lamp && lamp.lamp !== 4) problems.push(`lamp: ${lamp.lamp} Links' lights, not 4`);
  // Room 6's candles lit by the lamp: their lights and their torches' (more circles than the Links').
  await check(page, "candles", "s.room === 6 && s.circles >= 9", 250, 4000);
  // Room 3: an arrow set alight through a torch, its flame synced.
  // (8 ticks on: 40 px from the torch that lit it.)
  const arrow = await check(page, "arrow", "s.room === 3 && s.arrowFlames > 0", 1000 / 60, 60000);
  if (arrow) await check(page, "arrow-flying", `s.room === 3 && s.arrowFlames > 0 && s.tick >= ${arrow.tick + 8}`, 1000 / 60, 60);
  // Room 11's levers drawn, one pulled part way.
  await check(page, "lever", "s.room === 11 && (s.drawn.PSWK ?? 0) >= 2 && s.lever >= 1500", 250, 20000);
  // Room 4's Shadow Link: dark, then in a Link's colors (the light brightening to 200 there).
  // (A second after he shows: the camera's pan into the room done.)
  const darkForm = "s.room === 4 && (s.drawn.SLK2 ?? 0) > 0 && s.shadow && s.shadow.form === 0";
  const shows = await stepUntil(page, darkForm, 250, 20000);
  const shadow = shows && (await check(page, "shadow-dark", `${darkForm} && s.tick >= ${shows.tick + 60}`, 1000 / 60, 600));
  if (shadow && shadow.ambient <= 10) problems.push(`room 4: still dark (${shadow.ambient})`);
  // His change's roulette: a Link's colors shown while he changes (shadowlink.ts).
  await check(page, "shadow-roulette", "s.room === 4 && (s.drawn.SLK2 ?? 0) > 0 && s.shadow && s.shadow.state === 'change' && s.shadow.kind < 4", 1000 / 60, 20000);
  await check(page, "shadow-color", "s.room === 4 && (s.drawn.SLK2 ?? 0) > 0 && s.shadow && s.shadow.form >= 1 && s.shadow.state !== 'change'", 250, 20000);
  const end = await check(page, "room4-lit", "s.room === 4 && s.ambient === 200", 250, 20000);
  if (end && end.ambient !== 200) problems.push(`room 4: level ${end.ambient}, not 200`);
} finally {
  await browser.close();
}

if (problems.length) {
  console.log(problems.join("\n"));
  process.exitCode = 1;
}
console.log(`screenshots in ${out}`);
