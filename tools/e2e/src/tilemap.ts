// Pixel-exactness check of the GPU tilemap (packages/render tilemap.ts) against the software renderer, in headless
// Chrome. Serves tilemap-page/ with its own Vite server and the game files straight from extracted/.
//   node tools/e2e/src/tilemap.ts [extractedDir] [port] [stages e.g. boss010,boss020]
import { mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";
import type { CheckResult } from "./tilemap-page/check.ts";
import { browserPath } from "./browsers.ts";

const CHROME = browserPath("chrome");
// Water in every stage, plus the extra bg_anim slices of tilesets l (boss020), q (boss042), s (boss051),
// y (boss052) and k (boss083).
const [extracted = "extracted", port = "5178", stages = "boss010,boss020,boss042,boss051,boss052,boss083"] = process.argv.slice(2);
const files = resolve(extracted, "files/GC4Sword_usa");
const out = resolve("out/e2e");
mkdirSync(out, { recursive: true });

const server = await createServer({
  configFile: false,
  root: resolve(import.meta.dirname, "tilemap-page"),
  logLevel: "warn",
  server: { port: Number(port), strictPort: true },
  plugins: [
    {
      name: "game-files",
      configureServer(vite) {
        vite.middlewares.use("/game", (req, res) => {
          const path = join(files, decodeURIComponent((req.url ?? "/").split("?")[0]!));
          if (!path.startsWith(files) || !statSync(path, { throwIfNoEntry: false })?.isFile()) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.setHeader("Content-Type", "application/octet-stream");
          res.end(readFileSync(path));
        });
      },
    },
  ],
});
await server.listen();

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: mkdtempSync(join(out, "profile-")),
});
let failed = false;
try {
  const page = await browser.newPage();
  page.on("console", (m) => m.type() === "error" && console.log(`console: ${m.text()}`));
  page.on("pageerror", (e) => console.log(`page error: ${e instanceof Error ? e.message : String(e)}`));
  const started = Date.now();
  await page.goto(`http://localhost:${port}/?stages=${stages}`);
  await page.waitForFunction(() => (window as { tilemapCheck?: unknown }).tilemapCheck, { timeout: 600_000, polling: 500 });
  const result = await page.evaluate(() => (window as unknown as { tilemapCheck: CheckResult[] | { error: string } }).tilemapCheck);
  if (!Array.isArray(result)) throw new Error(result.error);
  for (const r of result) {
    // The overlay multiply is float math on the GPU and double math in software; allow ±1 there only.
    const ok = r.case === "overlay" ? r.maxDiff <= 1 : r.mismatched === 0;
    failed ||= !ok;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${r.stage} ${r.case.padEnd(12)} ${r.layers} layers, ${r.pixels} px: ` +
        `${r.mismatched} differ${r.mismatched ? ` (max ${r.maxDiff})` : ""}`,
    );
  }
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
} finally {
  await browser.close();
  await server.close();
}
if (failed) process.exitCode = 1;
