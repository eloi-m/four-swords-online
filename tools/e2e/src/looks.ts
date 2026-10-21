// World 1's looks on screen in apps/game, played by the scripted routes (window.fso.route) in headless Chrome:
// Lake Hylia's open doors with the game's open tiles (doorlook.ts: room 2's cave door, room 3's house door, read back
// from the base layer's drawn tiles), its grey stone carried (enemy_both2 41, STON's), and Hyrule Castle room 1's
// area 6: a Link held overhead, the thrown Link in flight, the bridge laid by switch 19 (its PNPC row's tile 0x3FC); on
// along its route, the things the sim simulates that apps/game drew nothing for before: room 3's pull handle (PLSW)
// pulled, room 9's four-Link handle (PSWB) pulled, the escort Zoras (FAZR) met and following, room 57's barrier (BARI's
// effects) with a Zora come to its arrival point (FZRA), the barrier gone, room 10's throne (STBL) pushed; the cracked
// walls bombed open (doorlook.ts: their base pair and the top layer's lintel): Hyrule Castle room 5's and room 9's area
// 3's on the route, Tingle's Tower room 4's area 5's marked opened by hand (off its route); the traps (sim traps.ts):
// Hyrule Castle room 9's area 2's blade traps set off on the route, the Cave of No Return room 1's fireball traps
// shooting (the Links put in their reach), Tingle's Tower room 2's blade traps (a Link put in one's row).
// A screenshot at each into out/e2e/looks-*.png (kept out of git).
// Expects the dev server (pnpm --filter @fso/game dev), which serves the game files.
//   node tools/e2e/src/looks.ts [url] [outDir]
import { mkdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import puppeteer, { type Page } from "puppeteer-core";
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
  milestone: number;
  /** The leader's position (px). */
  x: number;
  y: number;
  done: boolean;
  error: string;
  switches: number;
  opened: number[];
  /** The base layer's drawn tiles at the indices asked for (`tiles`), then the top layer's at those + 1024. */
  drawn: number[];
  /** Fighters' moves and heights (px), by Link. */
  moves: string[];
  z: number[];
  /** Whether a lifted 0x72 stone is held, or in flight once thrown (it keeps its tile: carry.ts release). */
  stone: boolean;
  stoneFlying: boolean;
  links: { visible: boolean; frame: number; y: number }[];
  /** How open the GBA window is (0-1). */
  window: number;
  /** What EnemyView drew in the last frame, by type; the barrier's effects synced; the pull handles (index, out in
   *  1/40 px, tick; …); the escort Zora following; the throne's state. */
  drawnTypes: Record<string, number>;
  barrier: number;
  pulls: number[];
  escort: boolean;
  /** The escort in the Links' room and area (the sim moves it into a new area some 80 ticks after them). */
  escortHere: boolean;
  throne: string;
  /** The blade traps' states (sim BLADE_STATE), the fireball traps' shots, the traps' effects synced. */
  blades: number[];
  fireballs: number;
  trapEffects: number;
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

/** Steps the loop `ms` at a time until `until` holds (or `frames` run out); `tiles` are base-layer indices to read (the
 *  top layer's + 1024). */
async function stepUntil(page: Page, until: string, ms: number, frames: number, tiles: number[] = []): Promise<Seen | null> {
  return page.evaluate(
    (until, ms, frames, tiles) => {
      type W = { __loop: FrameRequestCallback; __now: number; fso: any };
      const w = window as unknown as W, f = w.fso;
      const read = (): Seen => {
        const g = f.game, a = g.adventure, v = f.view, r = f.route.state;
        const area = f.stage.area(a.room, a.area);
        const onStone = (phase: string) => g.battle.entities.some((e: any) => e.kind === "pot" && e.phase === phase && !e.removed && (area.base?.[e.param] & 0x3ff) === 0x72);
        const stone = onStone("held"), stoneFlying = onStone("flying");
        return {
          tick: g.tick,
          room: a.room,
          area: a.area,
          milestone: r?.milestone ?? -1,
          x: Math.round(g.players[0].x / 256),
          y: Math.round(g.players[0].y / 256),
          done: !!r?.done,
          error: r?.error ?? "",
          switches: g.battle.switches >>> 0,
          opened: [...a.opened],
          drawn: tiles.map((i: number) => (i < 1024 ? v.patch?.data[i] : v.topPatch?.data[i - 1024]) ?? -1),
          moves: g.battle.fighters.map((x: any) => x.move),
          z: g.battle.fighters.map((x: any) => Math.round(x.z / 256)),
          stone,
          stoneFlying,
          window: v.gbaWindow,
          links: v.links.map((l: any) => ({ visible: l.visible, frame: l.frame ?? -1, y: Math.round(l.position?.y ?? 0) })),
          drawnTypes: { ...v.enemies.drawn },
          barrier: v.drawnBarrierEffects,
          pulls: [...a.pulls],
          escort: !!a.escort,
          escortHere: !!a.escort && a.escort.room === a.room && a.escort.area === a.area,
          throne: a.rocks.find((r: any) => r.type === "STBL")?.state ?? "",
          blades: a.enemies.filter((e: any) => e.type === "TRAP").map((e: any) => e.shot),
          fireballs: a.enemies.filter((e: any) => e.type === "OKTM" && e.kind === 5).length,
          trapEffects: v.drawnTrapEffects,
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
    tiles,
  ) as Promise<Seen | null>;
}

/** One check: step to it, print what's seen, screenshot it. */
async function check(page: Page, name: string, until: string, ms: number, frames: number, tiles: number[] = []): Promise<Seen | null> {
  const s = await stepUntil(page, until, ms, frames, tiles);
  if (!s || s.error || (s.done && !new Function("s", `return ${until};`)(s))) {
    problems.push(`${name}: not seen (${s ? `tick ${s.tick} room ${s.room}${s.error ? `, route error ${s.error}` : ""}` : "ran out"})`);
    if (s) console.log(`${name}: last seen ${JSON.stringify(s)}`);
    return null;
  }
  await page.screenshot({ path: join(out, `looks-${name}.png`) });
  console.log(`${name}: tick ${s.tick} room ${s.room}/${s.area} milestone ${s.milestone}, tiles ${s.drawn.map((t) => t.toString(16)).join(",")}, moves ${s.moves.join(",")} z ${s.z.join(",")}`);
  return s;
}

/** The battle's held frames (sim moveframes.ts HELD), kept through a throw. */
const HELD_FRAMES = [662, 663, 664, 665];
const hex = (t: number[]) => t.map((x) => x.toString(16)).join(",");
const expectTiles = (name: string, s: Seen | null, want: number[]) => {
  if (s && hex(s.drawn) !== hex(want)) problems.push(`${name}: drawn ${hex(s.drawn)}, not ${hex(want)}`);
};

try {
  const page = await browser.newPage();
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`page error: ${e instanceof Error ? e.message : String(e)}`));

  // Lake Hylia: room 2's grey stone carried, then the cave door (area 5's DOOR (112, 16), kind 0 side 1, switch 16)
  // open; room 3's house door (DOOR (384, 96), kind 3 side 1) unlocked, seen from outside.
  await open(page, "stage=boss010&players=4&mute&route");
  await check(page, "stone", "s.stone", 1000 / 60, 40000);
  // The stone thrown from the same spot, drawn as the stone still (not a pot: the flight's tile).
  await check(page, "stone-thrown", "s.stoneFlying", 1000 / 60, 4000);
  const caveDoor = [1 * 32 + 7, 1 * 32 + 8];
  const shut = await check(page, "cave-door-shut", "s.room === 2 && s.area === 5", 1000 / 60, 40000, caveDoor);
  if (shut && ((shut.switches >>> 16) & 1) === 0) expectTiles("cave-door-shut", shut, [0x2e0, 0x2e1]);
  const cave = await check(page, "cave-door", "s.room === 2 && s.area === 5 && ((s.switches >>> 16) & 1) === 1", 1000 / 60, 40000, caveDoor);
  if (cave) expectTiles("cave-door", await check(page, "cave-door-open", `s.tick >= ${cave.tick + 60}`, 1000 / 60, 120, caveDoor), [0x350, 0x351]);
  const houseDoor = [6 * 32 + 24, 6 * 32 + 25];
  // (Once it's opened, it opens over 17 ticks and the Links go in; seen again as they come back out.)
  const house = await check(page, "house-door", "s.room === 3 && s.area === 0 && s.opened.includes(3 * 4096 + 5)", 1000 / 60, 40000, houseDoor);
  if (house) expectTiles("house-door", await check(page, "house-door-open", `s.room === 3 && s.area === 0 && s.window === 0 && s.tick >= ${house.tick + 60}`, 1000 / 60, 20000, houseDoor), [0x3b0, 0x3b1]);

  // Hyrule Castle room 1's area 6.
  await open(page, "stage=boss013&players=4&mute&route");
  const held = await check(page, "held", "s.room === 1 && s.area === 6 && s.moves.includes('held') && s.moves[0] === 'carry'", 1000 / 60, 60000);
  if (held) {
    const i = held.moves.indexOf("held");
    if (!held.links[i]!.visible) problems.push("held: the held Link isn't drawn");
    if (held.z[i]! < 16) problems.push(`held: the held Link at z ${held.z[i]}`);
    if (!HELD_FRAMES.includes(held.links[i]!.frame)) problems.push(`held: the held Link shows frame ${held.links[i]!.frame}, not a held one`);
  }
  const thrown = await check(page, "thrown", "s.room === 1 && s.area === 6 && s.moves.includes('thrown') && s.z[s.moves.indexOf('thrown')] > 10", 1000 / 60, 3000);
  const flying = thrown?.links[thrown.moves.indexOf("thrown")];
  if (flying && (!flying.visible || !HELD_FRAMES.includes(flying.frame))) problems.push(`thrown: the thrown Link drawn ${flying.visible ? `with frame ${flying.frame}` : "hidden"}`);
  const bridge = [14 * 32 + 3, 14 * 32 + 7, 14 * 32 + 11];
  const laid = await check(page, "bridge", "s.room === 1 && s.area === 6 && ((s.switches >>> 19) & 1) === 1", 1000 / 60, 6000, bridge);
  if (laid) expectTiles("bridge", await check(page, "bridge-crossed", `s.tick >= ${laid.tick + 90}`, 1000 / 60, 200, bridge), [0x3fc, 0x3fc, 0x3fc]);

  // Hyrule Castle's simulated actors, drawn (BACKLOG B6 "Playtest, World 1" item 1).
  const drew = (name: string, s: Seen | null, type: string) => {
    if (s && !s.drawnTypes[type]) problems.push(`${name}: no ${type} drawn (${JSON.stringify(s.drawnTypes)})`);
  };
  drew("handle", await check(page, "handle", "s.room === 3 && s.area === 0 && s.pulls.some((x, k) => k % 3 === 1 && x >= 200)", 1000 / 60, 60000), "PLSW");
  // Room 5's garden wall (DOOR #22 (80, 256), kind 2 side 1) bombed open: its base pair 0x338 0x339 and the lintel
  // 0x328 0x329 on the top layer the row above (doorlook.ts).
  const wall5 = [16 * 32 + 5, 16 * 32 + 6, 1024 + 15 * 32 + 5, 1024 + 15 * 32 + 6];
  expectTiles("wall-5-shut", await check(page, "wall-5-shut", "s.room === 5 && s.area === 0 && s.x > 40 && s.x < 140 && s.y > 270 && s.y < 330 && !s.opened.includes(5 * 4096 + 22)", 1000 / 60, 60000, wall5), [0x330, 0x331, 0, 0]);
  const blown5 = await check(page, "wall-5", "s.room === 5 && s.area === 0 && s.opened.includes(5 * 4096 + 22)", 1000 / 60, 60000, wall5);
  if (blown5) expectTiles("wall-5-open", await check(page, "wall-5-open", `s.tick >= ${blown5.tick + 60}`, 1000 / 60, 200, wall5), [0x338, 0x339, 0x328, 0x329]);
  drew("big-handle", await check(page, "big-handle", "s.room === 9 && s.area === 0 && s.pulls.some((x, k) => k % 3 === 1 && x >= 400)", 1000 / 60, 60000), "PSWB");
  // Room 9's area 2: the blade traps at rest, then set off by the leader (the route's way past them), sliding.
  drew("blade-traps", await check(page, "blade-traps", "s.room === 9 && s.area === 2 && s.window === 1 && s.blades.length === 2", 1000 / 60, 20000), "TRAP");
  const blades = await stepUntil(page, "s.room === 9 && s.area === 2 && s.blades.every((b) => b === 1)", 1000 / 60, 2000);
  if (blades) drew("blade-traps-off", await check(page, "blade-traps-off", `s.tick >= ${blades.tick + 14}`, 1000 / 60, 100), "TRAP");
  else problems.push("blade-traps-off: not set off");
  // Room 9's area 3 throne-room wall (DOOR #45 (192, 64), kind 2 side 3): 0x32E 0x33E down from the anchor, the top
  // layer's 0x32F 0x33F a tile to the right.
  const wall9 = [4 * 32 + 12, 5 * 32 + 12, 1024 + 4 * 32 + 13, 1024 + 5 * 32 + 13];
  expectTiles("wall-9-shut", await check(page, "wall-9-shut", "s.room === 9 && s.area === 3 && s.window === 1 && !s.opened.includes(9 * 4096 + 45)", 1000 / 60, 60000, wall9), [0x326, 0x336, 0, 0]);
  const blown9 = await check(page, "wall-9", "s.room === 9 && s.area === 3 && s.opened.includes(9 * 4096 + 45)", 1000 / 60, 60000, wall9);
  if (blown9) expectTiles("wall-9-open", await check(page, "wall-9-open", `s.tick >= ${blown9.tick + 30}`, 1000 / 60, 200, wall9), [0x32e, 0x33e, 0x32f, 0x33f]);
  const met = await check(page, "zora-met", "s.room === 9 && s.area === 5 && s.escort", 1000 / 60, 60000);
  drew("zora-met", met, "FAZR");
  // (It comes into the area behind the Links, among them under the lowered tower's south wall: seen 100 ticks on, past it.)
  const out9 = await stepUntil(page, "s.room === 9 && s.area === 0 && s.escortHere && s.window === 0", 1000 / 60, 20000);
  if (out9) drew("zora-following", await check(page, "zora-following", `s.tick >= ${out9.tick + 100}`, 1000 / 60, 200), "FAZR");
  else problems.push("zora-following: not seen");
  const come = await check(page, "zora-arrived", "s.room === 57 && s.area === 0 && !s.escort && (s.drawnTypes.FZRA ?? 0) > 0", 1000 / 60, 20000);
  drew("zora-arrived", come, "FZRA");
  if (come && !come.barrier) problems.push("zora-arrived: the barrier's effects aren't synced");
  const gone = await check(page, "barrier-gone", "s.room === 57 && s.area === 0 && ((s.switches >>> 16) & 1) === 1", 1000 / 60, 60000);
  if (gone) {
    const after = await check(page, "barrier-after", `s.tick >= ${gone.tick + 120}`, 1000 / 60, 200);
    if (after?.barrier) problems.push(`barrier-after: ${after.barrier} barrier effects still synced`);
  }
  await check(page, "throne", "s.room === 10 && s.area === 2 && s.window === 1", 1000 / 60, 60000);
  await check(page, "throne-pushed", "s.room === 10 && s.area === 2 && s.throne === 'set'", 1000 / 60, 20000);

  // Tingle's Tower room 4's area 5 wall (DOOR #16 (144, 176), kind 2 side 3), off the route: the Links put in the area,
  // the wall marked blown (the opened list, as a blast's).
  await open(page, "stage=boss012&room=4&players=4&mute&run=off");
  await page.evaluate(() => {
    const g = (window as unknown as { fso: any }).fso.game;
    g.adventure.area = 5;
    g.players.forEach((p: any) => ((p.x = 112 * 256), (p.y = 192 * 256)));
  });
  const wall4 = [11 * 32 + 9, 12 * 32 + 9, 1024 + 11 * 32 + 10, 1024 + 12 * 32 + 10];
  expectTiles("tingle-wall-shut", await check(page, "tingle-wall-shut", "s.room === 4 && s.area === 5 && s.window === 1 && s.tick >= 60", 1000 / 60, 600, wall4), [0x326, 0x336, 0, 0]);
  await page.evaluate(() => void (window as unknown as { fso: any }).fso.game.adventure.opened.push(4 * 4096 + 16));
  const blown4 = await stepUntil(page, "true", 1000 / 60, 1);
  if (blown4) expectTiles("tingle-wall-open", await check(page, "tingle-wall-open", `s.tick >= ${blown4.tick + 10}`, 1000 / 60, 100, wall4), [0x32e, 0x33e, 0x32f, 0x33f]);

  // The Cave of No Return's room 1: the Links put within the fireball trap at (248, 40)'s reach, its shot (an effect
  // and a light) on its way some 40 ticks after it's made.
  await open(page, "stage=boss011&room=1&players=4&mute&run=off");
  await page.evaluate(() => {
    const g = (window as unknown as { fso: any }).fso.game;
    g.players.forEach((p: any) => ((p.x = 230 * 256), (p.y = 140 * 256)));
  });
  const shot = await stepUntil(page, "s.fireballs > 0", 1000 / 60, 400);
  if (shot) {
    const flying = await check(page, "fire-trap", `s.tick >= ${shot.tick + 40}`, 1000 / 60, 100);
    if (flying && !flying.trapEffects) problems.push("fire-trap: its shot's effect isn't synced");
  } else problems.push("fire-trap: no shot");

  // Tingle's Tower room 2: its blade traps at rest, then a Link put in the row of the one at (104, 232), west of it.
  await open(page, "stage=boss012&room=2&players=1&mute&run=off");
  await page.evaluate(() => {
    const g = (window as unknown as { fso: any }).fso.game;
    g.players.forEach((p: any) => ((p.x = 200 * 256), (p.y = 170 * 256)));
  });
  drew("tingle-blades", await check(page, "tingle-blades", "s.room === 2 && s.tick >= 30", 1000 / 60, 200), "TRAP");
  await page.evaluate(() => {
    const g = (window as unknown as { fso: any }).fso.game;
    g.players.forEach((p: any) => ((p.x = 72 * 256), (p.y = 236 * 256)));
  });
  const off = await stepUntil(page, "s.blades[0] === 1", 1000 / 60, 200);
  if (off) drew("tingle-blades-off", await check(page, "tingle-blades-off", `s.tick >= ${off.tick + 12}`, 1000 / 60, 100), "TRAP");
  else problems.push("tingle-blades-off: not set off");
} finally {
  await browser.close();
}

if (problems.length) {
  console.log(problems.join("\n"));
  process.exitCode = 1;
}
console.log(`screenshots in ${out}`);
