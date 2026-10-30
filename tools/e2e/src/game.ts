// Smoke test for apps/game (the Hyrulean Adventure) in headless Chrome: walks Link, checks movement and collision, the
// sword in four directions, then the adventure: a room change upward, a house's door both ways (the GBA window), an
// Octorok killed with a stab, Force Gems picked up (the HUD's counter), Lake Hylia's soldier ambush (stakes, the gem
// rain once they're beaten), the key and the locked door, a chest, the goal with the quota (the banner), the stage list
// loading another stage; then Lake Hylia from its start by the scripted route (window.fso.route, the sim's
// lakehylia.ts) to its goal (the stage cleared with the quota), a screenshot at each milestone, into
// out/e2e/route-<n>.png and route-goal.png. The audio (apps/game sound.ts): started by a click before each World 1
// route and Phantom Ganon's fight, then checked: the AudioContext running, the stage's BGM (and the fanfare, the boss
// music) with notes, the cues that reached the synth ("cues:"), M muting.
// Expects the dev server (pnpm --filter @fso/game dev), which serves the game files.
//   node tools/e2e/src/game.ts [url] [outDir]
import { mkdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import puppeteer, { type KeyInput, type Page } from "puppeteer-core";
import { openReady } from "./ready.ts";
import { browserPath } from "./browsers.ts";

const CHROME = browserPath("chrome");
const [urlArg = "http://localhost:5174/", outArg = "out/e2e"] = process.argv.slice(2);
const base = urlArg.split("#")[0]!, extra = urlArg.includes("#") ? urlArg.slice(urlArg.indexOf("#") + 1) : "";
const out = resolve(outArg);
mkdirSync(out, { recursive: true });

type Fso = {
  game: {
    tick: number;
    room: number;
    players: { x: number; y: number; facing: string; action: string; actionTick: number }[];
    battle: { fighters: { hearts: number; mode: string }[]; switches: number };
    adventure: {
      room: number;
      area: number;
      gems: number;
      keys: number;
      cleared: number;
      warp: unknown;
      edge: unknown;
      enemies: { id: number; type: string; x: number; y: number; state: string; life: number }[];
      pickups: { type: string; x: number; y: number; z: number; actor: number }[];
    };
  };
  info: { id: string; name: string };
  view: {
    gbaWindow: number;
    hud: { shown: { hearts: string[]; gems: string } } | null;
    enemies: { drawn: Record<string, number> };
    dialogue: { shown: { style: string; message: number; page: number; typed: number; done: boolean } | null } | null;
  };
  toScreen(x: number, y: number): { x: number; y: number };
  route: { start(from?: number): void; state: { milestone: number; milestones: number; name: string; goal: string; done: boolean; error: string } | null };
};
const fso = (page: Page) => page.evaluate(() => {
  const f = (window as unknown as { fso: Fso }).fso, g = f.game, p = g.players[0]!;
  return { x: p.x / 256, y: p.y / 256, room: g.room, area: g.adventure.area, facing: p.facing, action: p.action, tick: g.tick, gems: g.adventure.gems, stage: f.info.id };
});
const hold = async (page: Page, key: KeyInput, ms: number) => {
  await page.keyboard.down(key);
  await new Promise((r) => setTimeout(r, ms));
  await page.keyboard.up(key);
};
// (A new hash alone wouldn't reload the page: a blank page first.)
const open = async (page: Page, hash: string) => {
  await page.goto("about:blank");
  await openReady(page, `${base}#${[hash, extra, "run=off"].filter(Boolean).join("&")}`, () => document.getElementById("boot")!.hidden);
};

/** Captures the page's game loop so the test steps it tick by tick (screenshots land on exact ticks). */
async function capture(page: Page): Promise<(n?: number) => Promise<void>> {
  await page.evaluate(() => {
    const w = window as unknown as { __loop?: FrameRequestCallback; __now: number };
    // The fake clock starts when the loop is captured, just after its last real frame: the first stepped frame is then
    // a whole tick (starting it earlier made the sim run a tick or two behind the frames a script counts).
    window.requestAnimationFrame = (cb) => {
      if (!w.__loop) w.__now = performance.now();
      w.__loop = cb;
      return 1;
    };
  });
  await page.waitForFunction(() => (window as unknown as { __loop?: unknown }).__loop !== undefined, { polling: 20 }); // rAF polling would hang
  const tick = (n = 1) =>
    page.evaluate((n) => {
      const w = window as unknown as { __loop: FrameRequestCallback; __now: number };
      for (let i = 0; i < n; i++) w.__loop((w.__now += 1000 / 60));
    }, n);
  await tick(20); // flush time accumulated before the hook
  return tick;
}

/** A 60 room px square around Link on the page (the screenshot clip). */
async function clipAround(page: Page) {
  const at = await page.evaluate(() => {
    const f = (window as unknown as { fso: Fso }).fso, p = f.game.players[0]!;
    return f.toScreen(p.x / 256, p.y / 256 - 8);
  });
  const size = 240;
  return { x: Math.max(0, at.x - size / 2), y: Math.max(0, at.y - size / 2), width: size, height: size };
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: mkdtempSync(join(out, "profile-")),
  defaultViewport: { width: 1216, height: 896, deviceScaleFactor: 1 },
});
const problems: string[] = [];
try {
  const page = await browser.newPage();
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`page error: ${e instanceof Error ? e.message : String(e)}`));
  await open(page, "room=1&x=300&y=280");
  const start = await fso(page);
  console.log("start", start);
  if (start.stage !== "boss010" || start.room !== 1) problems.push(`started on ${start.stage} room ${start.room}`);
  await page.screenshot({ path: join(out, "game-start.png") });

  await hold(page, "ArrowRight", 1000);
  const right = await fso(page);
  const speed = (right.x - start.x) / (right.tick - start.tick);
  console.log(`after 1 s right: x ${start.x} -> ${right.x} (${speed.toFixed(2)} px/tick), facing ${right.facing}`);
  if (!(right.x > start.x + 30)) problems.push("Link didn't walk right");

  await hold(page, "ArrowUp", 4000);
  const up = await fso(page);
  console.log(`after 4 s up: y ${right.y} -> ${up.y}, room ${up.room}`);
  await page.screenshot({ path: join(out, "game-up.png") });
  await hold(page, "ArrowUp", 1000);
  const blocked = await fso(page);
  if (blocked.y !== up.y && blocked.room === up.room) console.log(`note: still moving up (${up.y} -> ${blocked.y})`);
  else console.log(`blocked going up at y ${blocked.y} (room ${blocked.room})`);

  await swordChecks(page);
  await adventureChecks(page);
  await routeChecks(page);
  await routeChecks(page, "boss011");
  await routeChecks(page, "boss012");
  await ganonChecks(page);
  await owlChecks(page);
} finally {
  await browser.close();
}

// Sword: stab and swing in each direction, lunge, charge, spin, the loop stepped by hand.
async function swordChecks(page: Page): Promise<void> {
  const tick = await capture(page);
  type Link = { x: number; y: number; facing: string; action: string; actionTick: number };
  const link = () => page.evaluate(() => (window as unknown as { fso: Fso }).fso.game.players[0]! as Link);

  const keys = [["right", "ArrowRight"], ["left", "ArrowLeft"], ["down", "ArrowDown"], ["up", "ArrowUp"]] as const;
  // Stab: a press from standing with the stick neutral (the attack starts the tick after the press). Pushing the
  // stick from the second attack tick on must neither turn nor move Link.
  for (const [dir, key] of keys) {
    await page.keyboard.down(key);
    await tick(2);
    await page.keyboard.up(key);
    await tick(10);
    const before = await link();
    if (before.facing !== dir) problems.push(`stab ${dir}: facing ${before.facing}`);
    await page.keyboard.down("z");
    await tick(1);
    await page.keyboard.up("z");
    await tick(1);
    await page.keyboard.down(dir === "up" ? "ArrowDown" : "ArrowUp");
    for (let k = 0; k < 4; k++) {
      const now = await link();
      if (now.action !== "stab") problems.push(`stab ${dir}: action ${now.action} at step ${k}`);
      if (now.x !== before.x || now.y !== before.y || now.facing !== dir) problems.push(`stab ${dir}: moved or turned mid-stab`);
      await page.screenshot({ path: join(out, `sword-stab-${dir}-${k}.png`), clip: await clipAround(page) });
      await tick(2);
    }
    await page.keyboard.up(dir === "up" ? "ArrowDown" : "ArrowUp");
    await tick(30);
    const after = await link();
    if (after.action !== "none") problems.push(`stab ${dir}: still ${after.action} after the stab`);
  }
  console.log("stabbed in 4 directions");

  // Swing: a press while walking. Link stops for the 8-tick swing, facing kept.
  for (const [dir, key] of keys) {
    await page.keyboard.down(key);
    await tick(8);
    await page.keyboard.down("z");
    await tick(2);
    await page.keyboard.up("z");
    const start = await link();
    for (let k = 0; k < 4; k++) {
      const now = await link();
      if (now.action !== "swing") problems.push(`swing ${dir}: action ${now.action} at step ${k}`);
      if (now.x !== start.x || now.y !== start.y || now.facing !== dir) problems.push(`swing ${dir}: moved or turned mid-swing`);
      await page.screenshot({ path: join(out, `sword-swing-${dir}-${k}.png`), clip: await clipAround(page) });
      await tick(2);
    }
    await page.keyboard.up(key);
    await tick(20);
    const back = { right: "ArrowLeft", left: "ArrowRight", down: "ArrowUp", up: "ArrowDown" }[dir] as KeyInput;
    await page.keyboard.down(back); // walk back where we came from, so the room stays the same
    await tick(10);
    await page.keyboard.up(back);
    await tick(10);
  }
  console.log("swung in 4 directions");

  // Lunge: a press from standing with the stick pushed dashes 40 px that way.
  {
    const before = await link();
    await page.keyboard.down("ArrowDown");
    await page.keyboard.down("z");
    await tick(1);
    await page.keyboard.up("z");
    await page.keyboard.up("ArrowDown");
    await tick(12);
    const now = await link();
    await page.screenshot({ path: join(out, "sword-lunge.png"), clip: await clipAround(page) });
    if (now.action !== "lunge" || now.facing !== "down" || now.y - before.y !== 40 * 256) problems.push(`lunge: ${now.action}, facing ${now.facing}, moved ${(now.y - before.y) / 256} px`);
    await tick(30);
    await page.keyboard.down("ArrowUp");
    await tick(2);
    await page.keyboard.up("ArrowUp");
    await tick(10);
  }
  console.log("lunged");

  // Hold: stab, then charge (walking backward keeps the facing); release after a full charge (56 ticks held): spin.
  await page.keyboard.down("z");
  await tick(40);
  await page.keyboard.down("ArrowDown");
  await tick(20);
  const charging = await link();
  if (charging.action !== "charge" || charging.facing !== "up") problems.push(`charge: ${charging.action}, facing ${charging.facing}`);
  await page.screenshot({ path: join(out, "sword-charge.png"), clip: await clipAround(page) });
  await page.keyboard.up("ArrowDown");
  await tick(40);
  await page.screenshot({ path: join(out, "sword-charged.png"), clip: await clipAround(page) });
  await page.keyboard.up("z");
  for (let k = 0; k < 4; k++) {
    await tick(k === 0 ? 2 : 6);
    const spin = await link();
    if (spin.action !== "spin") problems.push(`spin: action ${spin.action} at step ${k}`);
    await page.screenshot({ path: join(out, `sword-spin-${k}.png`), clip: await clipAround(page) });
  }
  await tick(30);
  if ((await link()).action !== "none") problems.push("spin didn't end");
  console.log(`charged and spun (charge at x ${charging.x / 256}, y ${charging.y / 256})`);
}

async function adventureChecks(page: Page): Promise<void> {
  // A room change upward: Lake Hylia room 2's top edge leads into room 3 (the auto-walk, then control).
  await open(page, "room=2&x=280&y=60");
  let tick = await capture(page);
  await page.keyboard.down("ArrowUp");
  await tick(30);
  const walking = await fso(page);
  await tick(30);
  await page.keyboard.up("ArrowUp");
  await tick(30);
  const above = await fso(page);
  console.log(`room change up: room 2 -> ${above.room} (at ${above.x}, ${above.y})`);
  if (above.room !== 3 || !(above.y > 300)) problems.push(`room change up: room ${above.room} at y ${above.y} (mid-walk room ${walking.room})`);
  await page.screenshot({ path: join(out, "adventure-room3.png") });

  // A house: walk up into room 1's door (the GBA window opens), then back out.
  await open(page, "room=1&x=256&y=300");
  tick = await capture(page);
  await page.keyboard.down("ArrowUp");
  await tick(60);
  await page.keyboard.up("ArrowUp");
  await tick(120);
  const inside = await fso(page);
  const open1 = await page.evaluate(() => (window as unknown as { fso: Fso }).fso.view.gbaWindow);
  console.log(`house: area ${inside.area} at (${inside.x}, ${inside.y}), window ${open1}`);
  if (inside.area !== 2 || open1 !== 1) problems.push(`house: area ${inside.area}, window ${open1}`);
  await page.screenshot({ path: join(out, "adventure-house.png") });
  await page.keyboard.down("ArrowDown");
  await tick(30);
  await page.keyboard.up("ArrowDown");
  await tick(150);
  const outside = await fso(page);
  console.log(`out of the house: area ${outside.area}, room ${outside.room} at (${outside.x}, ${outside.y})`);
  if (outside.area !== 0 || outside.room !== 1 || !(outside.y > 270)) problems.push(`out of the house: area ${outside.area} room ${outside.room} y ${outside.y}`);

  // An Octorok: Link placed beside one (room 3), facing it, stabs; it's knocked back and dies.
  await open(page, "room=3&x=280&y=300");
  tick = await capture(page);
  const target = await page.evaluate(() => {
    const g = (window as unknown as { fso: Fso }).fso.game;
    const e = g.adventure.enemies.find((x) => x.type === "OKTA")!;
    const p = g.players[0]!;
    p.x = e.x - 20 * 256;
    p.y = e.y;
    p.facing = "right";
    return { id: e.id, life: e.life };
  });
  await page.keyboard.down("z");
  await tick(1);
  await page.keyboard.up("z");
  await tick(3);
  await page.screenshot({ path: join(out, "adventure-octorok-hit.png"), clip: await clipAround(page) });
  const hit = await page.evaluate((id) => (window as unknown as { fso: Fso }).fso.game.adventure.enemies.find((e) => e.id === id) ?? null, target.id);
  await tick(60);
  const gone = await page.evaluate((id) => !(window as unknown as { fso: Fso }).fso.game.adventure.enemies.some((e) => e.id === id), target.id);
  console.log(`octorok: life ${target.life} -> ${hit?.life} (${hit?.state}), gone after 60 ticks: ${gone}`);
  if (!hit || hit.life !== 0 || !gone) problems.push(`octorok not killed: ${JSON.stringify(hit)}, gone ${gone}`);

  // Force Gems: room 6's column of gems, walking up through it; the HUD counts them.
  await open(page, "room=6&x=216&y=260");
  tick = await capture(page);
  await page.keyboard.down("ArrowUp");
  await tick(90);
  await page.keyboard.up("ArrowUp");
  await tick(5);
  const gems = await fso(page);
  const hud = await page.evaluate(() => (window as unknown as { fso: Fso }).fso.view.hud?.shown ?? null);
  console.log(`gems: ${gems.gems}, the HUD shows ${hud?.gems} and hearts ${hud?.hearts.join(" ")}`);
  if (!(gems.gems > 0) || hud?.gems !== String(gems.gems).padStart(4, "0")) problems.push(`gems ${gems.gems}, HUD ${hud?.gems}`);
  await page.screenshot({ path: join(out, "adventure-gems.png") });

  // Lake Hylia's ambush (room 9): the entrance switch stakes the way out; the soldiers beaten (here by hand), the grass
  // comes back and Force Gems rain.
  await open(page, "room=9&x=472&y=88&players=1");
  tick = await capture(page);
  await tick(3);
  const staked = await page.evaluate(() => ((window as unknown as { fso: Fso }).fso.game.battle.switches >>> 18) & 1);
  await page.screenshot({ path: join(out, "adventure-ambush-stakes.png") });
  await page.evaluate(() => {
    const g = (window as unknown as { fso: Fso }).fso.game;
    for (const e of g.adventure.enemies) e.life = -1;
    g.players[0]!.x = 300 * 256;
    g.players[0]!.y = 300 * 256;
  });
  await tick(40);
  const rain = await page.evaluate(() => {
    const g = (window as unknown as { fso: Fso }).fso.game;
    return { switches: g.battle.switches, gems: g.adventure.pickups.filter((p) => p.actor < 0).length };
  });
  await page.screenshot({ path: join(out, "adventure-ambush-rain.png") });
  console.log(`ambush: stakes ${staked}, then switches 16/17 ${(rain.switches >>> 16) & 1}/${(rain.switches >>> 17) & 1}, ${rain.gems} gems raining`);
  if (staked !== 1 || ((rain.switches >>> 17) & 1) !== 1 || !(rain.gems > 40)) problems.push(`ambush: stakes ${staked}, switches ${rain.switches.toString(16)}, gems ${rain.gems}`);

  // Room 5's ambush from its generator: on the bridge's floor switch the way west shuts and sword soldiers walk in from
  // the west, one every 10 ticks (sixteen); one is stabbed: a kill for the room's count.
  await open(page, "room=5&x=264&y=304&players=1");
  tick = await capture(page); // (about 20 ticks, more on a busy machine: a soldier made on ticks 1, 11, 21, ...)
  await tick(2);
  const shut = await page.evaluate(() => {
    const g = (window as unknown as { fso: Fso }).fso.game;
    return { tick: g.tick, switch4: (g.battle.switches >>> 4) & 1, soldiers: g.adventure.enemies.filter((e) => e.type === "SLR1").length };
  });
  await tick(158 - 20);
  const walked = await page.evaluate(() => {
    const f = (window as unknown as { fso: Fso }).fso, s = f.game.adventure.enemies.filter((e) => e.type === "SLR1");
    return { tick: f.game.tick, soldiers: s.length, drawn: f.view.enemies.drawn.SLR1 ?? 0, walking: s.filter((e) => e.state === "walk").length };
  });
  await page.screenshot({ path: join(out, "adventure-generator.png") });
  // Stabs, the Link put 14 px left of a soldier each time, until one goes down.
  let kills = 0;
  for (let k = 0; k < 8 && !kills; k++) {
    await page.evaluate(() => {
      const g = (window as unknown as { fso: Fso }).fso.game;
      const e = g.adventure.enemies.find((x) => x.type === "SLR1" && x.life > 0 && x.state !== "knock")!;
      Object.assign(g.players[0]!, { x: e.x - 14 * 256, y: e.y, facing: "right", action: "none", actionTick: 0 });
    });
    await page.keyboard.down("z");
    await tick(1);
    await page.keyboard.up("z");
    await tick(45);
    kills = await page.evaluate(() => ((window as unknown as { fso: Fso }).fso.game.adventure as unknown as { kills: number }).kills);
  }
  await page.screenshot({ path: join(out, "adventure-generator-kill.png") });
  console.log(`generator: tick ${shut.tick}: switch 4 ${shut.switch4}, ${shut.soldiers} soldiers; tick ${walked.tick}: ${walked.soldiers} (${walked.drawn} drawn, ${walked.walking} walking in); kills ${kills}`);
  if (shut.switch4 !== 1 || shut.soldiers !== Math.min(16, Math.floor((shut.tick - 1) / 10) + 1) || walked.soldiers !== 16 || !(walked.drawn >= 10) || kills < 1) problems.push(`generator: ${JSON.stringify({ shut, walked, kills })}`);

  // New enemies: The Mountain Path's Tektites (stage 3-2, room 5) jump about, one is stabbed and leaves a heart; the
  // Death Mountain Foothills' Buzz Blobs (3-1, room 5) shock the Link who strikes one.
  await open(page, "stage=boss031&room=5&x=256&y=300&players=1");
  tick = await capture(page);
  await tick(60);
  const tektites = await page.evaluate(() => {
    const f = (window as unknown as { fso: Fso }).fso, t = f.game.adventure.enemies.filter((e) => e.type === "TKTA");
    return { count: t.length, drawn: f.view.enemies.drawn.TKTA ?? 0, states: t.map((e) => e.state).join(",") };
  });
  await page.screenshot({ path: join(out, "adventure-tektites.png") });
  let tektiteKilled = false;
  for (let k = 0; k < 10 && !tektiteKilled; k++) {
    const id = await page.evaluate(() => {
      const g = (window as unknown as { fso: Fso }).fso.game;
      const e = g.adventure.enemies.find((x) => x.type === "TKTA" && x.state === "rest")!;
      if (!e) return -1;
      Object.assign(g.players[0]!, { x: e.x - 16 * 256, y: e.y, facing: "right", action: "none", actionTick: 0 });
      return e.id;
    });
    if (id >= 0) {
      await page.keyboard.down("z");
      await tick(1);
      await page.keyboard.up("z");
    }
    await tick(50);
    tektiteKilled = await page.evaluate((id) => id >= 0 && !(window as unknown as { fso: Fso }).fso.game.adventure.enemies.some((e) => e.id === id), id);
  }
  const heart = await page.evaluate(() => (window as unknown as { fso: Fso }).fso.game.adventure.pickups.some((p) => p.type === "heart" && p.actor < 0));
  await page.screenshot({ path: join(out, "adventure-tektite-heart.png") });
  await open(page, "stage=boss030&room=5&x=256&y=300&players=1");
  tick = await capture(page);
  const shocked = await page.evaluate(() => {
    const g = (window as unknown as { fso: Fso }).fso.game;
    const e = g.adventure.enemies.find((x) => x.type === "BZBR")!;
    Object.assign(g.players[0]!, { x: e.x - 16 * 256, y: e.y, facing: "right", action: "none", actionTick: 0 });
    return { hearts: g.battle.fighters[0]!.hearts, id: e.id };
  });
  await page.keyboard.down("z");
  await tick(1);
  await page.keyboard.up("z");
  await tick(6);
  const buzz = await page.evaluate((id) => {
    const f = (window as unknown as { fso: Fso }).fso, e = f.game.adventure.enemies.find((x) => x.id === id);
    return { hearts: f.game.battle.fighters[0]!.hearts, life: e?.life ?? -1, state: e?.state ?? "", drawn: f.view.enemies.drawn.BZBR ?? 0 };
  }, shocked.id);
  await page.screenshot({ path: join(out, "adventure-buzz-blob.png") });
  console.log(`tektites: ${tektites.count} (${tektites.drawn} drawn, ${tektites.states}), one killed ${tektiteKilled}, a heart ${heart}; buzz blob struck: hearts ${shocked.hearts} -> ${buzz.hearts}, its life ${buzz.life} (${buzz.state}), ${buzz.drawn} drawn`);
  if (tektites.count < 2 || tektites.drawn < 1 || !tektiteKilled || !heart) problems.push(`tektites: ${JSON.stringify(tektites)}, killed ${tektiteKilled}, heart ${heart}`);
  if (buzz.hearts !== shocked.hearts - 1 || buzz.life !== 4 || buzz.state !== "spit" || buzz.drawn < 1) problems.push(`buzz blob: ${JSON.stringify({ shocked, buzz })}`);

  // More enemies: each in a room that has it, the page stepped a while, then counted and drawn (screenshots): snakes,
  // a Zora and its fireball, a Wizzrobe showing up near the Link, a Hinox, PAMEs, Zols, the ghost Poes' textures.
  // (`shots`: wait for a shot (OKTM) too.)
  const stepped = async (hash: string, ticks: number, shot: string, type: string, shots = false) => {
    await open(page, hash);
    tick = await capture(page);
    await page.evaluate(() => ((window as unknown as { fso: Fso }).fso.game.battle.fighters[0]!.hearts = 80));
    let seen = { count: 0, drawn: 0, states: "", shots: 0 };
    for (let t = 0; t < ticks; t += 20) {
      await tick(20);
      seen = await page.evaluate((type) => {
        const f = (window as unknown as { fso: Fso }).fso, e = f.game.adventure.enemies.filter((x) => x.type === type);
        const shots = f.game.adventure.enemies.filter((x) => x.type === "OKTM").length;
        return { count: e.length, drawn: f.view.enemies.drawn[type] ?? 0, states: [...new Set(e.map((x) => x.state))].join(","), shots };
      }, type);
      if (seen.drawn > 0 && (!shots || seen.shots > 0)) break;
    }
    await page.screenshot({ path: join(out, `adventure-${shot}.png`) });
    return seen;
  };
  const more: Record<string, { count: number; drawn: number; states: string; shots: number }> = {};
  more.ROPE = await stepped("stage=boss023&room=1&x=256&y=360&players=1", 120, "snakes", "ROPE");
  more.ZORA = await stepped("stage=boss012&room=4&x=256&y=200&players=1", 900, "zora", "ZORA", true);
  more.WIZR = await stepped("stage=boss053&room=13&x=256&y=200&players=1", 400, "wizzrobe", "WIZR");
  more.HINO = await stepped("stage=boss030&room=6&x=256&y=300&players=1", 60, "hinox", "HINO");
  more.PAME = await stepped("stage=boss070&room=27&x=256&y=300&players=1", 60, "pame", "PAME");
  more.ZASL = await stepped("stage=boss073&room=15&x=256&y=300&players=1", 60, "zols", "ZASL");
  more.POOH = await stepped("stage=boss041&room=12&x=256&y=200&players=1", 400, "ghost-poes", "POOH");
  console.log(`more enemies: ${Object.entries(more).map(([k, v]) => `${k} ${v.count} (${v.drawn} drawn; ${v.states})`).join(", ")}`);
  for (const [k, v] of Object.entries(more)) if (!v.count || !v.drawn) problems.push(`${k}: ${JSON.stringify(v)}`);
  if (!more.ZORA!.shots) problems.push("zora: no fireball");

  // The key (room 3), lifted facing it from 18 px below (the action key) and carried, and the house's locked door:
  // walking up into it with the key opens it, and on into the house.
  await open(page, "room=3&x=456&y=218&players=1");
  tick = await capture(page);
  await tick(2);
  await page.keyboard.down("ArrowUp");
  await tick(1);
  await page.keyboard.up("ArrowUp");
  await page.keyboard.down("c");
  await tick(2);
  await page.keyboard.up("c");
  await tick(20);
  await page.screenshot({ path: join(out, "adventure-key.png") });
  const keys = await page.evaluate(() => (window as unknown as { fso: Fso }).fso.game.adventure.keys);
  await page.evaluate(() => Object.assign((window as unknown as { fso: Fso }).fso.game.players[0]!, { x: 400 * 256, y: 140 * 256, facing: "up" }));
  await page.keyboard.down("ArrowUp");
  await tick(40);
  await page.screenshot({ path: join(out, "adventure-door.png") });
  await tick(30);
  await page.keyboard.up("ArrowUp");
  await tick(120);
  const house = await fso(page);
  const keysLeft = await page.evaluate(() => (window as unknown as { fso: Fso }).fso.game.adventure.keys);
  console.log(`locked door: keys ${keys} -> ${keysLeft}, now in area ${house.area}`);
  if (keys !== 1 || keysLeft !== 0 || house.area !== 2) problems.push(`locked door: keys ${keys} -> ${keysLeft}, area ${house.area}`);

  // A chest (room 5, made by switch 17): the item button (the GC's A) facing it from below opens it (a red Force Gem).
  await open(page, "room=5&x=328&y=71&players=1");
  tick = await capture(page);
  await page.evaluate(() => {
    const g = (window as unknown as { fso: Fso }).fso.game;
    g.battle.switches |= 1 << 17;
    g.players[0]!.facing = "up";
  });
  await tick(2);
  await page.keyboard.down("x");
  await tick(1);
  await page.keyboard.up("x");
  await tick(10);
  const chest = await fso(page);
  await page.screenshot({ path: join(out, "adventure-chest.png"), clip: await clipAround(page) });
  console.log(`chest: ${chest.gems} Force Gems, action ${chest.action}`);
  if (chest.gems !== 20) problems.push(`chest: gems ${chest.gems}`);

  // A sign (room 3's, read from below with the item button, the GC's A): its wooden board types the message, the P1 badge once
  // it's typed, the button closes it (main2D's hukidashi_wood.blo, as Dolphin shows it).
  await open(page, "room=3&x=248&y=314&players=1");
  tick = await capture(page);
  await page.evaluate(() => ((window as unknown as { fso: Fso }).fso.game.players[0]!.facing = "up"));
  await page.keyboard.down("x");
  await tick(1);
  await page.keyboard.up("x");
  await tick(20);
  const shown = () => page.evaluate(() => (window as unknown as { fso: Fso }).fso.view.dialogue?.shown ?? null);
  const typing = await shown();
  await page.screenshot({ path: join(out, "adventure-sign-typing.png") });
  await tick(80);
  const typed = await shown();
  await page.screenshot({ path: join(out, "adventure-sign.png") });
  await page.keyboard.down("x");
  await tick(1);
  await page.keyboard.up("x");
  await tick(8);
  const closed = await shown();
  console.log(`sign: ${JSON.stringify(typing)} -> ${JSON.stringify(typed)} -> ${JSON.stringify(closed)}`);
  if (typing?.style !== "wood" || typing.message !== 0x532 || typing.done || !typed?.done || closed) problems.push(`sign: ${JSON.stringify({ typing, typed, closed })}`);

  // The goal (room 10) with the quota: the stage is cleared, the banner says so.
  await open(page, "room=10&x=212&y=150&players=1");
  tick = await capture(page);
  await page.evaluate(() => ((window as unknown as { fso: Fso }).fso.game.adventure.gems = 2000));
  await page.keyboard.down("ArrowUp");
  await tick(20);
  await page.keyboard.up("ArrowUp");
  await tick(5);
  const goal = await page.evaluate(() => ({ cleared: (window as unknown as { fso: Fso }).fso.game.adventure.cleared, banner: document.getElementById("banner")!.hidden ? "" : document.getElementById("banner")!.textContent }));
  await page.screenshot({ path: join(out, "adventure-goal.png") });
  console.log(`goal: cleared on tick ${goal.cleared}, banner "${goal.banner}"`);
  if (!goal.cleared || !goal.banner?.includes("cleared")) problems.push(`goal: ${JSON.stringify(goal)}`);

  // The stage list (Esc) loads another stage.
  await page.keyboard.press("Escape");
  await page.waitForSelector("#stages[open]");
  await page.screenshot({ path: join(out, "adventure-stages.png") });
  await Promise.all([page.waitForNavigation({ waitUntil: "load" }).catch(() => undefined), page.click('#stage-list a[data-stage="boss033"]')]);
  await openReady(page, page.url(), () => document.getElementById("boot")!.hidden);
  const other = await fso(page);
  console.log(`stage list: now ${other.stage} room ${other.room}`);
  if (other.stage !== "boss033") problems.push(`the stage list loaded ${other.stage}`);
  await page.screenshot({ path: join(out, "adventure-boss033.png") });
}

// Hyrule Castle's room 11: Phantom Ganon fought by the route's fight (phantomganon.ts), a screenshot as he appears,
// when the fight starts, his ball, struck down, and at the end (the staircase's switch).
// The audio: Hyrule Castle's own BGM from its start, then the boss music and his cues.
async function ganonChecks(page: Page): Promise<void> {
  await open(page, "stage=boss013&players=4");
  const castle = await capture(page);
  await startAudio(page, "boss013");
  await castle(120);
  await audioCheck(page, "boss013", ["JA_BGM_CHIJOU"], []);
  await open(page, "stage=boss013&room=11&x=256&y=330&players=4");
  await capture(page);
  await startAudio(page, "ganon");
  try {
    await ganonFight(page);
  } finally {
    await audioCheck(page, "ganon", ["JA_BGM_BOSS"], ["JA_SE_CHR_PGANON_DAMAGE", "JA_SE_CHR_PGANON_DIE", "JA_SE_LK_SWORD_WIELD"]);
  }
}

async function ganonFight(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { fso: Fso }).fso.route.start());
  const shots = new Set<string>();
  for (let frame = 0; frame < 1200; frame++) {
    const s = await page.evaluate(() => {
      const w = window as unknown as { __loop: FrameRequestCallback; __now: number; fso: Fso & { game: { adventure: { ganon: { state: number; hp: number; gone: boolean; ball: unknown } | null } } } };
      for (let i = 0; i < 4; i++) w.__loop((w.__now += 250));
      const g = w.fso.game.adventure.ganon, r = w.fso.route.state!;
      return { tick: w.fso.game.tick, state: g?.state ?? -1, hp: g?.hp ?? 0, gone: g?.gone ?? true, ball: !!g?.ball, switches: w.fso.game.battle.switches, done: r.done, error: r.error };
    });
    const shot = s.state === 2 ? "appear" : s.state === 7 ? "fight" : s.ball && s.state === 16 ? "ball" : s.state === 20 ? "down" : "";
    if (shot && !shots.has(shot)) {
      shots.add(shot);
      await page.screenshot({ path: join(out, `ganon-${shot}.png`) });
      console.log(`ganon: ${shot} at tick ${s.tick} (state ${s.state}, hp ${s.hp})`);
    }
    if (s.error) problems.push(`ganon: ${s.error}`);
    if (s.done) {
      console.log(`ganon: route done at tick ${s.tick}, gone ${s.gone}, switch 16 ${(s.switches >>> 16) & 1}`);
      if (!s.gone || !((s.switches >>> 16) & 1)) problems.push(`ganon: not beaten (state ${s.state}, hp ${s.hp})`);
      await page.screenshot({ path: join(out, "ganon-end.png") });
      return;
    }
  }
  problems.push("ganon: not done after 1200 frames");
}

// Hyrule Castle's owl (dialogue.ts startOwlTalk): the route walks up room 0 and the owl's box shows as the Links reach
// room y 204.5 (they stand there), a screenshot of it; the route reads it and goes on up into room 1.
async function owlChecks(page: Page): Promise<void> {
  await open(page, "stage=boss013&players=4");
  await capture(page);
  await page.evaluate(() => (window as unknown as { fso: Fso }).fso.route.start());
  let shown = false;
  for (let frame = 0; frame < 1500; frame++) {
    const s = await page.evaluate(() => {
      const w = window as unknown as { __loop: FrameRequestCallback; __now: number; fso: Fso & { game: { adventure: { talk: { message: number; style: string; page: number } | null } } } };
      for (let i = 0; i < 4; i++) w.__loop((w.__now += 250));
      const g = w.fso.game, p = g.players[0]!, t = g.adventure.talk;
      return { tick: g.tick, room: g.room, y: p.y / 256, talk: t ? { message: t.message, style: t.style, page: t.page } : null, route: w.fso.route.state! };
    });
    if (s.talk && !shown) {
      shown = true;
      console.log(`owl: box at tick ${s.tick}: message 0x${s.talk.message.toString(16)} (${s.talk.style}), the leader at y ${s.y}`);
      if (s.talk.message !== 0x2bb) problems.push(`owl: message 0x${s.talk.message.toString(16)}`);
      if (s.y !== 204.5) problems.push(`owl: the leader at y ${s.y}, not 204.5`);
      await page.screenshot({ path: join(out, "owl.png") });
    }
    if (s.route.error) problems.push(`owl: ${s.route.error}`);
    if (s.route.milestone >= 1 || s.route.done) {
      if (!shown) problems.push("owl: the route got past room 0 without the owl's box");
      if (s.room !== 1) problems.push(`owl: the route reached room ${s.room}, not 1`);
      console.log(`owl: read; the route in room ${s.room} at milestone ${s.route.milestone}`);
      return;
    }
  }
  problems.push("owl: the route didn't pass room 0 in 1500 frames");
}

type AudioStats = { seconds: number; bgm: { playing: boolean; notes: number; missing: number }; se: { started: number; notes: number; missing: number } };
type GameAudio = { state: string; contextState: string; stats: AudioStats | null; log: { tick: number; name: string; sent: boolean }[]; error: string | null; muted: boolean; currentBgm: string | null; missing(): string[] };
type AudioWin = Window & { fso: { audio: GameAudio | null } };

/** Starts the page's audio with a click (the user gesture browsers want) and waits until its synth runs. */
async function startAudio(page: Page, tag: string): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as AudioWin).fso.audio, { timeout: 60_000, polling: 100 });
  const t0 = Date.now();
  await page.mouse.click(4, 400);
  await page.waitForFunction(() => ["running", "failed"].includes((window as unknown as AudioWin).fso.audio!.state), { timeout: 120_000, polling: 100 });
  const state = await page.evaluate(() => (window as unknown as AudioWin).fso.audio!.state);
  console.log(`${tag}: audio ${state} ${((Date.now() - t0) / 1000).toFixed(1)} s after the click`);
}

/**
 * The audio after a stage's play: the AudioContext running, the BGM wanted played (notes from the synth, none without an
 * instrument), and the cues that reached the synth (summed up as battle.ts's "cues:").
 */
async function audioCheck(page: Page, tag: string, bgm: readonly string[], cues: readonly string[]): Promise<void> {
  await new Promise((r) => setTimeout(r, 1500)); // let the worklet render and report
  const a = await page.evaluate(() => {
    const audio = (window as unknown as AudioWin).fso.audio;
    return audio && { state: audio.state, context: audio.contextState, stats: audio.stats, error: audio.error, missing: audio.missing(), current: audio.currentBgm, log: audio.log.map((l) => ({ name: l.name, sent: l.sent })) };
  });
  if (!a) {
    problems.push(`${tag}: audio not loaded`);
    return;
  }
  const sent = a.log.filter((l) => l.sent).map((l) => l.name), all = a.log.map((l) => l.name);
  const count = (name: string) => sent.filter((n) => n === name).length;
  console.log(`${tag}: audio ${a.state}, context ${a.context}, ${a.stats?.seconds.toFixed(1)} s rendered; BGM ${a.stats?.bgm.notes} notes (${a.stats?.bgm.missing} missing), ${a.stats?.se.started} effects, ${a.stats?.se.notes} notes (${a.stats?.se.missing} missing)`);
  console.log(`  music: ${all.filter((n) => n.startsWith("JA_BGM") || n === "stopBgm").join(" → ")} (now ${a.current})`);
  console.log(`  cues: ${[...new Set(sent.filter((n) => n.startsWith("JA_SE")))].map((n) => `${n.replace(/^JA_SE_/, "")}×${count(n)}`).join(" ")}`);
  if (a.context !== "running") problems.push(`${tag}: AudioContext ${a.context} (${a.error ?? "no error"})`);
  if (a.missing.length) problems.push(`${tag}: audio missing ${a.missing.join(", ")}`);
  if (!a.stats || a.stats.bgm.notes === 0) problems.push(`${tag}: no BGM notes ${JSON.stringify(a.stats)}`);
  if (cues.length && (!a.stats || a.stats.se.started === 0 || a.stats.se.notes === 0)) problems.push(`${tag}: no effect played ${JSON.stringify(a.stats)}`);
  if (a.stats && (a.stats.bgm.missing > 0 || a.stats.se.missing > 0)) problems.push(`${tag}: notes without an instrument`);
  for (const name of bgm) if (!all.includes(name)) problems.push(`${tag}: no ${name}`);
  for (const name of cues) if (!count(name)) problems.push(`${tag}: no ${name} cue`);
}

/** M mutes and unmutes (the setting kept), the sound button following. */
async function muteCheck(page: Page): Promise<void> {
  const read = () => page.evaluate(() => ({ muted: (window as unknown as AudioWin).fso.audio!.muted, button: document.getElementById("mute")!.textContent }));
  await page.keyboard.press("m");
  const off = await read();
  await page.keyboard.press("m");
  const on = await read();
  console.log(`mute: M → ${JSON.stringify(off)}, M → ${JSON.stringify(on)}`);
  if (!off.muted || off.button !== "Sound off" || on.muted || on.button !== "Sound on") problems.push(`mute: ${JSON.stringify({ off, on })}`);
}

/** Each World 1 stage's music, and the cues its route must play (stage BGM from main.dol's table, sound.ts). */
function routeAudio(stage: string): { bgm: readonly string[]; cues: readonly string[] } | undefined {
  return {
    boss010: {
      bgm: ["JA_BGM_WATER_FIELD", "JA_BGM_FANFARE"],
      cues: ["JA_SE_LK_SWORD_WIELD", "JA_SE_CHR_SOLDIER_DOWN", "JA_SE_LK_COIN", "JA_SE_LK_BIG_COIN", "JA_SE_OBJ_TBOX_OPEN", "JA_SE_OBJ_DOOR_OPEN", "JA_SE_OBJ_SWITCH", "JA_SE_OBJ_CUT_GRASS", "JA_SE_OBJ_LIFT", "JA_SE_LK_THROW", "JA_SE_LK_PLUNGE", "JA_SE_LK_SWIM"],
    },
    boss011: { bgm: ["JA_BGM_DANGEON", "JA_BGM_FANFARE"], cues: ["JA_SE_OBJ_TBOX_OPEN", "JA_SE_LK_UNLOCK", "JA_SE_MSG_OPEN"] },
    // (Its route's Force Gems are all 100s, winged and red ones: the big gem's cue.)
    boss012: { bgm: ["JA_BGM_WATER_FIELD", "JA_BGM_FANFARE"], cues: ["JA_SE_LK_BIG_COIN", "JA_SE_LK_SWIM"] },
  }[stage];
}

// A stage from its start, its route driving the leader to the stage clear (Lake Hylia's, the Cave of No Return's,
// Tingle's Tower's): the loop stepped 15 ticks a frame (its 250 ms catch-up cap). The audio is started first, and
// checked at the end (routeAudio; Lake Hylia's also mutes and unmutes).
async function routeChecks(page: Page, stage = "boss010"): Promise<void> {
  const tag = stage === "boss010" ? "route" : `route-${stage}`;
  await open(page, `stage=${stage}&players=4`);
  await capture(page);
  await startAudio(page, tag);
  if (stage === "boss010") await muteCheck(page);
  const sound = routeAudio(stage);
  try {
    await routePlay(page, tag);
  } finally {
    if (sound) await audioCheck(page, tag, sound.bgm, sound.cues);
  }
}

async function routePlay(page: Page, tag: string): Promise<void> {
  await page.evaluate(() => (window as unknown as { fso: Fso }).fso.route.start());
  const t0 = Date.now();
  let milestone = 0;
  for (let frame = 0; frame < 2000; frame++) {
    const s = await page.evaluate(() => {
      const w = window as unknown as { __loop: FrameRequestCallback; __now: number; fso: Fso };
      for (let i = 0; i < 4; i++) w.__loop((w.__now += 250));
      const g = w.fso.game, a = g.adventure as Fso["game"]["adventure"] & { gear: string };
      return { ...w.fso.route.state!, tick: g.tick, room: a.room, area: a.area, gems: a.gems, gear: a.gear };
    });
    if (s.milestone !== milestone || s.done) {
      console.log(`${tag}: milestone ${milestone} done at tick ${s.tick} (room ${s.room}/${s.area}, gems ${s.gems}, gear ${s.gear || "-"})`);
      await page.screenshot({ path: join(out, `${tag}-${milestone}.png`) });
      milestone = s.milestone;
    }
    if (s.error) problems.push(`${tag}: ${s.error}`);
    if (s.done) {
      console.log(`${tag}: ${s.milestone}/${s.milestones} milestones in ${((Date.now() - t0) / 1000).toFixed(1)} s${s.error ? `, stopped: ${s.error}` : ""}`);
      if (s.milestone < s.milestones) problems.push(`${tag}: stopped in milestone ${s.milestone} "${s.name}"`);
      // The goal: the stage cleared with the quota, its banner up.
      const end = await page.evaluate(() => {
        const w = window as unknown as { fso: { game: { adventure: { cleared: number; gems: number } } } };
        return { cleared: w.fso.game.adventure.cleared, gems: w.fso.game.adventure.gems, banner: document.getElementById("banner")?.textContent ?? "" };
      });
      console.log(`${tag}: cleared at tick ${end.cleared} with ${end.gems} Force Gems, banner "${end.banner}"`);
      if (!end.cleared || end.gems < 2000) problems.push(`${tag}: the stage isn't cleared (${end.gems} Force Gems)`);
      await page.screenshot({ path: join(out, `${tag}-goal.png`) });
      return;
    }
  }
  problems.push(`${tag}: not done after 2000 frames`);
}

if (problems.length) {
  console.log(problems.join("\n"));
  process.exitCode = 1;
}
console.log(`screenshots in ${out}`);
