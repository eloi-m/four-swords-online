// Smoke test for apps/screens in headless Chrome: renders a list of J2D screens via deep links and screenshots each
// one. Expects the Vite dev server to be running (pnpm --filter @fso/screens exec vite --port 5180).
//   node tools/e2e/src/screens.ts [url] [outDir] [arc/screen[+all][#extra=params] ...]
// Each screen is saved twice: the viewer canvas and a 1:1 capture of the 608×448 screen (-raw.png). With the default
// list, the message browser too: BMG messages in the message window and the speech balloon (colors, picture characters,
// arrows, Japanese), turning a page, searching, and setText on a text box.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import puppeteer, { type Page } from "puppeteer-core";
import { openReady } from "./ready.ts";
import { browserPath } from "./browsers.ts";

const CHROME = browserPath("chrome");
const [url = "http://localhost:5180/", outArg = "out/e2e", ...wanted] = process.argv.slice(2);
const targets = wanted.length
  ? wanted
  : [
      "game2D.arc/main_bat.blo",
      "game2D.arc/main_bat.blo+all",
      "game2D.arc/main_adv.blo",
      "game2D.arc/main_adv.blo+all",
      "game2D.arc/main_bat_ranking.blo+all",
      "game2D.arc/pause.blo",
      "main2D.arc/bat_stage_select_window.blo",
      "main2D.arc/main_message_window.blo",
      "main2D.arc/pressstart.blo",
      "map2.arc/bat_stage_select.blo",
      "file.arc/file_select.blo",
      "gamemode.arc/gamemode.blo",
      // The adventure HUD as in ref/save-lake-hylia.sav: the game moves the single-player group to the bottom left,
      // hides unused panes and swaps the counter digits (compare with ref/frames/boss010-room01-dolphin.png).
      "game2D.arc/main_adv.blo#bg=none&hide=.*&show=^(ROOT|Ndata16|Ndata13|Php1l[fk]0[1-4]|Ph1piib[1-3]|Ph1psk?0[1-4]|Ph1pr0[12])$" +
        "&move=Ndata16:77,375;Ph1piib3:54,379;Ndata13:29,412&tex=" +
        ["01", "02", "03", "04"].flatMap((d) => [`Ph1ps${d}`, `Ph1psk${d}`].map((t) => `${t}:kk_rupyNum_0${d === "04" ? 4 : 0}.bti`)).join(","),
      // BMG messages (apps/screens messages.ts): "You got 50 Force Gems!" in the message window; Pegasus Boots (a color
      // tag) and "Who helped you this time?" (players' colors and Link pictures) in the balloon; the L Button hint
      // (arrows); the Japanese Pegasus Boots
      "main2D.arc/main_message_window.blo#msg=0xd7",
      "main2D.arc/hukidashi.blo#msg=0xc8",
      "main2D.arc/hukidashi.blo#msg=0xdf",
      "main2D.arc/hukidashi.blo#msg=0x44b",
      "main2D.arc/hukidashi.blo#msg=0xc8&bmg=jp",
    ];
const out = resolve(outArg);
mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: mkdtempSync(join(out, "profile-")),
  defaultViewport: { width: 1400, height: 900, deviceScaleFactor: 1 },
});
const problems: string[] = [];

// window.fsoScreens, published by apps/screens once a screen is drawn.
interface ScreensState {
  archive: string;
  screen: string;
  panes: number;
  drawn: number;
  notes: [string, string][];
  ready: boolean;
  capture(): string;
  message: { file: string; id: number; page: number; pages: number; text: string } | null;
  setText(tag: string, text: string): boolean;
  animation(): { names: string[]; frame: number; players: { name: string; frame: number; duration: number; unbound: string[] }[] };
  seek(frame: number): void;
}

// Screen animations (apps/screens anim.ts). A screen file is a snapshot of its own animation (gameover.blo is frame 103
// of gameover.bck, entry_arrow_anim.blo frame 4 of its .bck), so the render at that frame must match the static one
// pixel for pixel, and other frames must not; the title's shine (title.btk on an indirect material) must move.
async function checkAnimations(page: Page): Promise<void> {
  const animation = () => page.evaluate(() => (window as unknown as { fsoScreens: ScreensState }).fsoScreens.animation());
  const show = async (arc: string, scrn: string, extra = "") => {
    await page.evaluate((hash) => (location.hash = hash), `arc=${arc}&scrn=${scrn}&bg=black${extra}`);
    await page.reload({ waitUntil: "networkidle0" });
    await waitReady(page, scrn);
  };
  const capture = (frame?: number) =>
    page.evaluate((f) => {
      const s = (window as unknown as { fsoScreens: ScreensState }).fsoScreens;
      if (f !== null) s.seek(f);
      return s.capture();
    }, frame ?? null);
  // Pixels of two captures (PNG data URLs) differing by more than 8 in a channel, inside a box.
  const differing = (a: string, b: string, box = [0, 0, 608, 448]) =>
    page.evaluate(
      async (a, b, [x0, y0, x1, y1]) => {
        const pixels = async (url: string) => {
          const img = new Image();
          img.src = url;
          await img.decode();
          const c = document.createElement("canvas");
          [c.width, c.height] = [img.width, img.height];
          const ctx = c.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          return ctx.getImageData(x0!, y0!, x1! - x0!, y1! - y0!).data;
        };
        const [p, q] = [await pixels(a), await pixels(b)];
        let n = 0;
        for (let i = 0; i < p.length; i += 4) if ([0, 1, 2].some((c) => Math.abs(p[i + c]! - q[i + c]!) > 8)) n++;
        return n;
      },
      a,
      b,
      box,
    );
  for (const [arc, scrn, anim, frame, other] of [
    ["game2D.arc", "gameover.blo", "gameover.bck", 103, 0],
    ["entry.arc", "entry_arrow_anim.blo", "entry_arrow_anim.bck", 4, 19],
  ] as const) {
    await show(arc, scrn);
    const still = await capture();
    await show(arc, scrn, `&anim=${anim}&frame=${frame}`);
    const status = await animation();
    const unbound = status.players.flatMap((p) => p.unbound);
    if (status.names.join() !== anim || unbound.length) problems.push(`${scrn}: animations ${status.names.join()} (unbound: ${unbound.join("; ")})`);
    const same = await differing(still, await capture(frame));
    const moved = await differing(still, await capture(other));
    console.log(`${scrn} + ${anim}: frame ${frame} vs the file: ${same} px differ; frame ${other}: ${moved}`);
    if (same > 40) problems.push(`${scrn}: frame ${frame} of ${anim} differs from the file in ${same} px`);
    if (moved < 50) problems.push(`${scrn}: frame ${other} of ${anim} looks like the file (${moved} px differ)`);
  }
  await show("title.arc", "title.blo", "&anim=title.btk");
  const logo = [85, 51, 525, 315];
  const [f0, f30, f45] = [await capture(0), await capture(30), await capture(45)];
  const [d30, d45] = [await differing(f0, f30, logo), await differing(f30, f45, logo)];
  console.log(`title.blo + title.btk: the shine changes ${d30} logo px from frame 0 to 30, ${d45} from 30 to 45`);
  if (d30 < 2000 || d45 < 2000) problems.push(`title.btk: the shine barely moves (${d30}, ${d45} px)`);
  for (const [f, png] of [[0, f0], [30, f30], [45, f45]] as const) writeFileSync(join(out, `screens-title-shine-${f}-raw.png`), Buffer.from(png.split(",")[1]!, "base64"));
}

async function waitReady(page: Page, screen: string): Promise<void> {
  await page.waitForFunction(
    (s) => {
      const current = (window as unknown as { fsoScreens?: ScreensState }).fsoScreens;
      return (current?.ready && current.screen.endsWith(`/${s}`)) || document.querySelector("#screen-info.error");
    },
    { timeout: 60_000 },
    screen,
  );
  await new Promise((r) => setTimeout(r, 400));
}

try {
  const page = await browser.newPage();
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`page error: ${e instanceof Error ? e.message : String(e)}`));
  const started = Date.now();
  await openReady(page, url, () => !document.querySelector("#controls")!.hasAttribute("hidden"));
  console.log(`load: ${((Date.now() - started) / 1000).toFixed(1)} s · ${await page.$eval("#data-status", (el) => el.textContent)}`);

  for (const target of targets) {
    const [spec, extra] = target.split("#");
    const [path, flag] = spec!.split("+");
    const arc = path!.slice(0, path!.lastIndexOf("/")), screen = path!.slice(path!.lastIndexOf("/") + 1);
    const params = new URLSearchParams(extra ?? "");
    params.set("arc", arc);
    params.set("scrn", screen);
    if (flag === "all") params.set("all", "1");
    await page.evaluate((hash) => (location.hash = hash), params.toString());
    // A hash change to the screen already shown only toggles "all"; reload to apply it.
    await page.reload({ waitUntil: "networkidle0" });
    await waitReady(page, screen);
    const info = await page.$eval("#screen-info", (el) => el.textContent);
    const status = await page.evaluate(() => (window as unknown as { fsoScreens: ScreensState }).fsoScreens);
    console.log(`${target}: ${info}`);
    if (params.get("msg")) {
      const m = status.message;
      console.log(`  message ${m ? `${m.file} 0x${m.id.toString(16)} page ${m.page + 1}/${m.pages}: ${JSON.stringify(m.text.slice(0, 70))}` : "not shown"}`);
      if (!m || m.id !== Number(params.get("msg"))) problems.push(`${target}: the message isn't shown`);
      if (status.notes.length) problems.push(`${target}: ${status.notes.map(([t, n]) => `${t}: ${n}`).join("; ")}`);
    }
    if (status.notes.length)
      console.log(`  notes: ${status.notes.slice(0, 8).map(([t, n]) => `${t}: ${n}`).join("; ")}${status.notes.length > 8 ? " …" : ""}`);
    const canvas = await page.$("#view");
    const name = `screens-${arc.replace(/\W+/g, "_")}-${screen.replace(/\.blo$/, "")}${flag ? `-${flag}` : ""}${extra ? `-${params.get("msg") ? `msg${params.get("msg")}${params.has("bmg") ? `-${params.get("bmg")}` : ""}` : "custom"}` : ""}`;
    await canvas!.screenshot({ path: join(out, `${name}.png`) });
    const raw = await page.evaluate(() => (window as unknown as { fsoScreens: ScreensState }).fsoScreens.capture());
    writeFileSync(join(out, `${name}-raw.png`), Buffer.from(raw.split(",")[1]!, "base64"));
  }

  if (!wanted.length) {
    // The message browser by hand: the next page, a search, and setText on the message window's text box.
    const state = () => page.evaluate(() => (window as unknown as { fsoScreens: ScreensState }).fsoScreens);
    await page.evaluate(() => (location.hash = "msg=0xc8&box=hukidashi"));
    await page.reload({ waitUntil: "networkidle0" });
    await waitReady(page, "hukidashi.blo");
    await page.click("#msg-next");
    await page.waitForFunction(() => (window as unknown as { fsoScreens: ScreensState }).fsoScreens.message?.page === 1, { timeout: 10_000 });
    const turned = await state();
    console.log(`next page: ${turned.message!.page + 1}/${turned.message!.pages} ${JSON.stringify(turned.message!.text.slice(0, 60))} · ${await page.evaluate(() => location.hash)}`);
    if (!/page=1/.test(await page.evaluate(() => location.hash))) problems.push("the page isn't in the deep link");
    await page.type("#msg-search", "Quit Shadow Battle");
    const found = await page.$$eval("#msg-list option", (options) => options.map((o) => (o as HTMLOptionElement).value));
    console.log(`search "Quit Shadow Battle": ${found.map((v) => `0x${Number(v).toString(16)}`).join(", ")}`);
    if (!found.includes(String(0x10c))) problems.push("search: message 0x10c not found");
    await page.select("#msg-list", String(0x10c));
    await page.waitForFunction(() => (window as unknown as { fsoScreens: ScreensState }).fsoScreens.message?.id === 0x10c, { timeout: 10_000 });
    await page.evaluate(() => (location.hash = "arc=main2D.arc&scrn=main_message_window.blo"));
    await page.reload({ waitUntil: "networkidle0" });
    await waitReady(page, "main_message_window.blo");
    const before = (await state()).drawn;
    const set = await page.evaluate(() => {
      const s = (window as unknown as { fsoScreens: ScreensState }).fsoScreens;
      return [s.setText("Tmmt01", "Hello from setText!"), s.setText("Tmmt02", "Hello from setText!"), s.setText("Pmmtp", "x")];
    });
    await new Promise((r) => setTimeout(r, 300));
    console.log(`setText Tmmt01/Tmmt02/Pmmtp: ${set.join("/")}`);
    if (set.join() !== "true,true,false") problems.push(`setText returned ${set.join()}`);
    const raw = await page.evaluate(() => (window as unknown as { fsoScreens: ScreensState }).fsoScreens.capture());
    writeFileSync(join(out, "screens-main2D_arc-main_message_window-settext-raw.png"), Buffer.from(raw.split(",")[1]!, "base64"));
    if (before <= 0) problems.push("nothing drawn on main_message_window");
  }
  if (!wanted.length) await checkAnimations(page);
} finally {
  await browser.close();
}
if (problems.length) {
  console.log(problems.join("\n"));
  process.exitCode = 1;
}
console.log(`screenshots in ${out}`);
