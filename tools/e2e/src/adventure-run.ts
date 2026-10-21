// World 1 as one run (apps/game run.ts) in headless Chrome: each stage is marked cleared in the sim (the goal itself is
// game.ts's and the routes' business), and the page must show the clear a few seconds, load the next stage on its own
// (`#route` kept: the next stage's route is armed), and after Hyrule Castle show the end screen with the Force Gems per
// stage and its two buttons. A forced clear hands the Links on: their hearts and the leader's item must be there in the
// next stage, after a reload too; a stage opened from the stage list, or with #run=off, starts fresh. Expects the dev
// server (pnpm --filter @fso/game exec vite --port 5320 --strictPort, or any port given).
//   node tools/e2e/src/adventure-run.ts [url]
import puppeteer, { type Page } from "puppeteer-core";
import { openReady, waitReady } from "./ready.ts";
import { browserPath } from "./browsers.ts";

const CHROME = browserPath("chrome");
const [urlArg = "http://localhost:5620/"] = process.argv.slice(2);
const problems: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) problems.push(what);
};

/** Quarter hearts: four hearts (the maximum) is 16. */
const FULL = 16;
/** The battle item each leader's gear gives (gear.ts giveGear). */
const ITEM: Record<string, string> = { "": "", bow: "bow", boomerang: "boomerang", bombs: "bomb" };

interface Links {
  hearts: number[];
  max: number;
  gear: string;
  item: string;
}

const stageOf = (page: Page) => page.evaluate(() => (window as unknown as { fso?: { info?: { id: string } } }).fso?.info?.id ?? "");
const ready = async (page: Page, url: string) => (await page.goto("about:blank"), openReady(page, url, () => document.getElementById("boot")!.hidden));
/** The four Links' hearts (quarter), the maximum (whole hearts), the leader's gear and battle item. */
const links = (page: Page): Promise<Links> =>
  page.evaluate(() => {
    const g = (window as unknown as { fso: { game: { battle: { rules: { hearts: number }; fighters: { hearts: number; item: string }[] }; adventure: { gear: string } } } }).fso.game;
    return { hearts: g.battle.fighters.map((f) => f.hearts), max: g.battle.rules.hearts, gear: g.adventure.gear, item: g.battle.fighters[0]!.item };
  });
/** The Links at `hearts` (quarter) with the leader's `gear`, invincible so the clear's wait leaves the hearts alone. */
const setLinks = (page: Page, hearts: number, gear: string) =>
  page.evaluate((hearts, gear) => {
    const g = (window as unknown as { fso: { game: { battle: { fighters: { hearts: number; invincible: number }[] }; adventure: { gear: string } } } }).fso.game;
    for (const f of g.battle.fighters) Object.assign(f, { hearts, invincible: 1e6 });
    g.adventure.gear = gear;
  }, hearts, gear);
/** Whether the Links are as a stage hands them on: `hearts` each, the maximum of four hearts, and `gear`. */
const carried = (l: Links, hearts: number, gear: string) => l.hearts.length === 4 && l.hearts.every((h) => h === hearts) && l.max === 4 && l.gear === gear && l.item === ITEM[gear];

/** Marks the stage cleared with `gems` gems, then waits for the page to move on (a reload: the stage id changes). */
async function clearAndWait(page: Page, from: string, gems: number): Promise<{ banner: string; stayed: boolean }> {
  await page.evaluate((gems) => {
    const g = (window as unknown as { fso: { game: { tick: number; adventure: { cleared: number; gems: number } } } }).fso.game;
    g.adventure.gems = gems;
    g.adventure.cleared = g.tick;
  }, gems);
  await new Promise((r) => setTimeout(r, 1500));
  const banner = await page.evaluate(() => document.getElementById("banner")!.textContent ?? "");
  const stayed = (await stageOf(page)) === from; // 1.5 s in: still showing the clear
  await page.waitForFunction((from) => {
    const id = (window as unknown as { fso?: { info?: { id: string } } }).fso?.info?.id;
    return !!id && id !== from;
  }, { timeout: 15_000, polling: 100 }, from);
  return { banner, stayed };
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => problems.push(`page error: ${(e as Error).message}`));
  await ready(page, `${urlArg}#route`); // no stage: the run starts at Lake Hylia, scripted
  check((await stageOf(page)) === "boss010", "no stage: starts at Lake Hylia");
  check(carried(await links(page), FULL, ""), "Lake Hylia starts fresh: four hearts, no item");
  // Each stage ends with the Links at these hearts and this gear; the next stage starts with them.
  const hops = [
    ["boss010", "boss011", 6, "bow", 120],
    ["boss011", "boss012", 10, "boomerang", 340],
    ["boss012", "boss013", 14, "bombs", 560],
  ] as const;
  for (const [from, to, hearts, gear, gems] of hops) {
    await setLinks(page, hearts, gear);
    const { banner, stayed } = await clearAndWait(page, from, gems);
    check(banner.includes("cleared") && banner.includes("Next:"), `${from}: banner "${banner.replace(/\n/g, " / ")}"`);
    check(stayed, `${from}: the clear is shown a while`);
    await waitReady(page, () => document.getElementById("boot")!.hidden);
    const state = await page.evaluate(() => {
      const f = (window as unknown as { fso: { info: { id: string }; route: { state: { milestones: number } | null } } }).fso;
      return { id: f.info.id, route: f.route.state !== null };
    });
    check(state.id === to, `${from} -> ${to}`);
    check(page.url().includes("route") && state.route, `${to}: the route chained too`);
    check(carried(await links(page), hearts, gear), `${to}: the Links come in with ${hearts} quarter hearts and "${gear}" from ${from}`);
    if (to === "boss011") {
      await page.reload({ waitUntil: "load" });
      await waitReady(page, () => document.getElementById("boot")!.hidden);
      check((await stageOf(page)) === to && carried(await links(page), hearts, gear), `${to}: a reload keeps what the Links came in with`);
    }
  }
  // Hyrule Castle cleared: the end screen.
  await page.evaluate(() => {
    const g = (window as unknown as { fso: { game: { tick: number; adventure: { cleared: number; gems: number } } } }).fso.game;
    g.adventure.gems = 780;
    g.adventure.cleared = g.tick;
  });
  await page.waitForFunction(() => !document.getElementById("end")!.hidden, { timeout: 15_000, polling: 100 });
  const end = await page.evaluate(() => ({ title: document.querySelector("#end h1")!.textContent, rows: [...document.querySelectorAll("#end tr")].map((r) => r.textContent) }));
  console.log("end screen:", JSON.stringify(end));
  check(end.title === "World 1 cleared" && end.rows.length === 5, "the end screen shows the four stages and the total");
  check(end.rows.at(-1) === "Force Gems1800" && end.rows[0]!.endsWith("120") && end.rows[3]!.endsWith("780"), "the Force Gems per stage are carried across the stages");
  // Play again: back at Lake Hylia, fresh (the run's carry ended with the last stage).
  await page.click("#end-again");
  await page.waitForFunction(() => (window as unknown as { fso?: { info?: { id: string } } }).fso?.info?.id === "boss010", { timeout: 60_000, polling: 100 });
  check(true, "Play again starts Lake Hylia");
  check(carried(await links(page), FULL, ""), "Play again starts fresh: four hearts, no item");
  // A new run's clear hands on again; then a deep link into a later stage drops that carry and starts fresh.
  await setLinks(page, 6, "bow");
  await clearAndWait(page, "boss010", 5);
  await waitReady(page, () => document.getElementById("boot")!.hidden);
  check((await stageOf(page)) === "boss011" && carried(await links(page), 6, "bow"), "a run started again hands on to Cave of No Return");
  // #run=off: the carry waiting for Cave of No Return isn't used.
  await ready(page, `${urlArg}#stage=boss011&run=off`);
  check((await stageOf(page)) === "boss011" && carried(await links(page), FULL, ""), "#run=off starts Cave of No Return fresh");
  // A deep link into a later stage still plays it and moves on (fresh, as opened directly).
  await ready(page, `${urlArg}#stage=boss012`);
  check((await stageOf(page)) === "boss012", "#stage=boss012 deep link");
  check(carried(await links(page), FULL, ""), "#stage=boss012 deep link starts fresh");
  const hop = await clearAndWait(page, "boss012", 5);
  check(hop.stayed, "boss012: moves on to Hyrule Castle after the banner");
} finally {
  await browser.close();
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("\nadventure-run: all good");
