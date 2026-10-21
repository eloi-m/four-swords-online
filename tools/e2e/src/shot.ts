// A screenshot of a page once it's ready (apps/game by default), its console errors and its #hud text, after
// optional key presses (key:ms each):
//   node tools/e2e/src/shot.ts <url> <out.png> [ms] [keys…]
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer, { type KeyInput } from "puppeteer-core";
import { openReady } from "./ready.ts";
import { browserPath } from "./browsers.ts";

const CHROME = browserPath("chrome");
const [url = "http://localhost:5174/", out = "out/shot.png", msArg = "500", ...keys] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: mkdtempSync(join(tmpdir(), "shot-")), defaultViewport: { width: 1216, height: 896, deviceScaleFactor: 1 } });
try {
  const page = await browser.newPage();
  page.on("console", (m) => m.type() === "error" && console.log(`console: ${m.text()}`));
  page.on("pageerror", (e) => console.log(`page error: ${e instanceof Error ? e.message : String(e)}`));
  await openReady(page, url, () => document.getElementById("boot")!.hidden);
  for (const k of keys) {
    const [key, ms] = k.split(":");
    await page.keyboard.down(key as KeyInput);
    await new Promise((r) => setTimeout(r, Number(ms ?? 200)));
    await page.keyboard.up(key as KeyInput);
  }
  await new Promise((r) => setTimeout(r, Number(msArg)));
  await page.screenshot({ path: out });
  console.log(await page.evaluate(() => document.getElementById("hud")?.textContent));
} finally {
  await browser.close();
}
