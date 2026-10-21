// Smoke test for apps/viewer in headless Chrome: loads the game files from the dev server, then screenshots the map.
// Expects the Vite dev server to be running (pnpm --filter @fso/viewer dev).
//   node tools/e2e/src/viewer.ts [url] [outDir]
import { mkdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { openReady, opfsEntries, waitReady } from "./ready.ts";
import { browserPath } from "./browsers.ts";

const CHROME = browserPath("chrome");
const [url = "http://localhost:5173/", outArg = "out/e2e"] = process.argv.slice(2);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: mkdtempSync(join(out, "profile-")),
  defaultViewport: { width: 1400, height: 900, deviceScaleFactor: 1 },
});
const problems: string[] = [];
try {
  const page = await browser.newPage();
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`page error: ${e instanceof Error ? e.message : String(e)}`));
  const started = Date.now();
  await openReady(page, url, () => !document.querySelector("#controls")!.hasAttribute("hidden"));
  const status = await page.$eval("#data-status", (el) => el.textContent);
  console.log(`load: ${((Date.now() - started) / 1000).toFixed(1)} s · status: ${status}`);

  await new Promise((r) => setTimeout(r, 500));
  const info = await page.$eval("#stage-info", (el) => el.textContent);
  console.log(`stage: ${await page.$eval("#stage", (el) => (el as HTMLSelectElement).value)} · ${info}`);
  await page.screenshot({ path: join(out, "viewer-map.png") });

  // Reload through a deep link (the files now come from the HTTP cache): Lake Hylia room 1 at 2×, the savestate's room.
  await page.goto(`${url}#stage=boss010&room=1&zoom=2`, { waitUntil: "networkidle0" });
  await page.reload({ waitUntil: "networkidle0" });
  await waitReady(page, () => !document.querySelector("#controls")!.hasAttribute("hidden"), 30_000);
  console.log(`after reload: ${await page.$eval("#data-status", (el) => el.textContent)}`);
  const stored = await opfsEntries(page);
  if (stored.length) problems.push(`the viewer stored files in OPFS: ${stored.join(", ")}`);
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: join(out, "viewer-room1-zoom2.png") });
  await page.click("#collision");
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: join(out, "viewer-room1-collision.png") });

  // Actor markers (deep-link flag), then hover the WARP that room 1's list puts at (31, 24) half-tiles = (248, 192) px.
  const open = async (hash: string) => {
    await page.goto(`${url}#${hash}`, { waitUntil: "networkidle0" });
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForFunction(() => !document.querySelector("#controls")!.hasAttribute("hidden"), { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 500));
  };
  await open("stage=boss010&room=1&zoom=2&actors");
  await page.screenshot({ path: join(out, "viewer-room1-actors.png") });
  const view = await page.$eval("#view", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, zoom: 2 / window.devicePixelRatio };
  });
  await page.mouse.move(view.x + (248 - 256) * view.zoom, view.y);
  const hover = await page.$eval("#hover", (el) => el.textContent ?? "");
  console.log(`hover on the room 1 warp: ${hover.split("\n").slice(2).join(" | ")}`);
  if (!hover.includes("WARP")) problems.push(`hovering room 1's warp didn't show it: ${hover}`);
  // Actor sprites (on by default with &actors): the four girls of FGAL at (37, 11) half-tiles = (296, 88) px.
  await page.mouse.move(view.x + (296 - 256) * view.zoom, view.y + (88 - 192) * view.zoom);
  const girls = await page.$eval("#hover", (el) => el.textContent ?? "");
  console.log(`hover on room 1's girls: ${girls.split("\n").slice(2, 4).join(" | ").slice(0, 160)}`);
  if (!girls.includes("FGAL") || !girls.includes("graphics: sprite")) problems.push(`FGAL isn't shown as a sprite: ${girls}`);
  await open("stage=boss010&room=1&zoom=2&actors&markers");
  await page.screenshot({ path: join(out, "viewer-room1-markers.png") });
  await open("stage=boss010&room=3&zoom=2&actors");
  await page.screenshot({ path: join(out, "viewer-room3-actors.png") });
  await open("stage=boss010&room=4&zoom=2&actors");
  await page.screenshot({ path: join(out, "viewer-room4-actors.png") });

  // Shadow Battle: 10 rooms on a 5×2 grid, with and without actors, then one arena up close.
  await open("stage=boss500");
  const battle = await page.$eval("#stage-info", (el) => el.textContent ?? "");
  console.log(`boss500: ${battle}`);
  if (!battle.startsWith("Shadow Battle")) problems.push(`boss500 didn't load: ${battle}`);
  await page.screenshot({ path: join(out, "viewer-boss500.png") });
  await open("stage=boss500&actors");
  await page.screenshot({ path: join(out, "viewer-boss500-actors.png") });
  await open("stage=boss500&room=1&zoom=2&actors");
  await page.screenshot({ path: join(out, "viewer-boss500-room1-actors.png") });
  await open("stage=boss500&room=0&zoom=2&actors");
  await page.screenshot({ path: join(out, "viewer-boss500-room0-actors.png") });
  await open("stage=boss500&room=4&zoom=2&actors");
  await page.screenshot({ path: join(out, "viewer-boss500-room4-actors.png") });

  // 3D effects (frozen at tick 0): Lake Hylia's waterfall and rainbow framed as a Dolphin frame of room 7 (camera
  // (1857.5, 524.3), zoom 1.59), the upper waterfall of room 58, and room 1's cloud shadows.
  for (const [name, hash] of [
    ["viewer-effects-waterfall", "stage=boss010&effects&efftick=0&x=1857.5&y=524.3&scale=1.589"],
    ["viewer-effects-room58", "stage=boss010&effects&efftick=0&x=1724&y=208.9&scale=1.589"],
    ["viewer-effects-room1", "stage=boss010&room=1&zoom=2&effects&efftick=600"],
  ] as const) {
    await open(hash);
    const effects = await page.$eval("#effects-info", (el) => el.textContent ?? "");
    if (!effects.includes("taki_a") || !effects.includes("cloud shadows")) problems.push(`${name}: effects missing (${effects})`);
    await page.screenshot({ path: join(out, `${name}.png`) });
  }
  console.log(`boss010 effects: ${await page.$eval("#effects-info", (el) => el.textContent)}`);
} finally {
  await browser.close();
}
if (problems.length) {
  console.log(problems.join("\n"));
  process.exitCode = 1;
}
console.log(`screenshots in ${out}`);
