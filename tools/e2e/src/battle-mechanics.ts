// Shadow Battle mechanics in headless Chrome (apps/battle): lifting, carrying and throwing a Link, lifting a bush,
// rolling, a Tower of Flames bomb lifted, thrown and going off, the fire bars above the clouds, an arrow, the
// boomerang's afterimages, a charging sword's sparkles and burst, the hammer and the Fire Rod, the item orbs, the castle's soldiers and Vaati at time-out; the side rooms; the Tower of Winds in side view (a ledge, a
// ladder, a gate into its gallery, the giant-bomb Shadow Link) and the bombchus. Links are placed by writing their positions into the
// live state (window.fso.game) and driven with P1's keys (WASD, J sword, K action, L item); the game loop is stepped by
// hand, so every run sees the same ticks. Screenshots go to out/e2e-mechanics/. Expects the dev server:
//   pnpm --filter @fso/battle exec vite --port 5181
//   node tools/e2e/src/battle-mechanics.ts [url] [outDir]
import { mkdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import puppeteer, { type Page } from "puppeteer-core";
import { openReady } from "./ready.ts";
import { browserPath } from "./browsers.ts";

const CHROME = browserPath("chrome");
const [url = "http://localhost:5181/", outArg = "out/e2e-mechanics"] = process.argv.slice(2);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const COUNTDOWN = 409; // packages/sim COUNTDOWN_TICKS

type Entity = { id: number; kind: string; phase: string; hp: number; x: number; y: number; z: number; timer: number; item: string; home: number; param: number; hitMask: number; tick: number };
type Fighter = { hearts: number; mode: string; move: string; moveTick: number; carryLink: number; carryEntity: number; heldBy: number; z: number; item: string; itemTimer: number; dark: number };
type Player = { x: number; y: number; facing: string; action: string };
type Game = {
  tick: number;
  players: Player[];
  battle: { phase: string; timeLeft: number; timeUp: number; switches: number; fighters: Fighter[]; entities: Entity[]; cut: number[]; rules: { timeLimit: number }; hits: { cause?: string; victim: number }[] };
};
type World = { widthCells: number; solid: Uint8Array; surface: Uint8Array };
type Fso = {
  mode: string;
  game: Game;
  world: World;
  view: {
    cameraMode: string;
    entities: { drawn: Record<string, number>; orbIcons: Record<number, number>; circleFrames: Record<number, number> };
    lighting: { drawn: number };
    particles: { stats: { particles: number; emitters: number }; liveIds(): number[] };
    shadowLinkFrame: number;
    insets(game: Game): unknown[];
  };
  startMatch(s: Record<string, number>): void;
  hud: { snapshot(): { item: string; level: boolean; disc: boolean; discFrame: number; slide: number }[] };
  screens: { visible(): string[]; last: { message: { id: number; offset: number } | null } | null };
};
type Win = Window & { fso: Fso; __loop?: FrameRequestCallback; __now: number };

const problems: string[] = [];
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: mkdtempSync(join(out, "profile-")),
  defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
});
try {
  const page = await browser.newPage();
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`page error: ${e instanceof Error ? e.message : String(e)}`));
  await openReady(page, `${url}#mute&seed=7`, () => (window as unknown as Win).fso?.mode === "menu");
  console.log("menu up");
  await page.evaluate(() => {
    const w = window as unknown as Win;
    // The fake clock starts when the loop is captured, just after its last real frame: the first stepped frame is then
    // a whole tick (starting it earlier made the sim run a tick or two behind the frames a script counts).
    window.requestAnimationFrame = (cb) => {
      if (!w.__loop) w.__now = performance.now();
      w.__loop = cb;
      return 1;
    };
  });
  await page.waitForFunction(() => (window as unknown as Win).__loop !== undefined, { polling: 20 });

  await liftAndThrow(page);
  await bush(page);
  await roll(page);
  await flamesBomb(page);
  await potSwitchJets(page);
  await lavaPit(page);
  await darkCrystal(page);
  await fireBars(page);
  await panels(page);
  await arrow(page);
  await swordCharge(page);
  await hammerAndFireRod(page);
  await boomerang(page);
  await boomerangAfterimages(page);
  await orbs(page);
  await soldiers(page);
  await vaati(page);
  await messageAtTop(page);
  await sideRoom(page);
  await winds(page);
  await bombchus(page);
} finally {
  await browser.close();
}
if (problems.length) {
  console.log(`PROBLEMS:\n  ${problems.join("\n  ")}`);
  process.exitCode = 1;
} else console.log(`all good; screenshots in ${out}`);

// --- helpers (run in the page) ---

function tick(page: Page, n = 1): Promise<void> {
  return page.evaluate((n) => {
    const w = window as unknown as Win;
    for (let i = 0; i < n; i++) w.__loop!((w.__now += 1000 / 60));
  }, n);
}
function game(page: Page): Promise<Game> {
  return page.evaluate(() => (window as unknown as Win).fso.game);
}
function key(page: Page, code: string, type: "keydown" | "keyup"): Promise<void> {
  return page.evaluate((code, type) => void window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true })), code, type);
}
/** Presses a key for one tick. */
async function tap(page: Page, code: string): Promise<void> {
  await key(page, code, "keydown");
  await tick(page, 1);
  await key(page, code, "keyup");
}
async function match(page: Page, room: number, players = 2, time = 0): Promise<void> {
  await page.evaluate((room, players, time) => (window as unknown as Win).fso.startMatch({ room, players, hearts: 4, time, wins: 3 }), room, players, time);
  await tick(page, COUNTDOWN + 1);
}
/** Puts player `i` at (x, y) px facing `facing`. */
function place(page: Page, i: number, x: number, y: number, facing: string): Promise<void> {
  return page.evaluate(
    (i, x, y, facing) => {
      const p = (window as unknown as Win).fso.game.players[i]!;
      Object.assign(p, { x: x * 256, y: y * 256, facing });
    },
    i,
    x,
    y,
    facing,
  );
}
/**
 * Steps a tick and counts the canvas pixels that aren't opaque (read back before the frame is handed over): the
 * browser composites the canvas by its alpha, and the Tower of Flames' lava writes 0 there (WebKit then showed the
 * page's black over the fire pit's hole and its flame).
 */
function seeThrough(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as Win;
    w.__loop!((w.__now += 1000 / 60));
    const gl = (w.fso.view as unknown as { renderer: { getContext(): WebGL2RenderingContext } }).renderer.getContext();
    const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight, px = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) n++;
    return n;
  });
}
async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(out, `${name}.png`) });
}

// --- scenarios ---

// The Field: P1 lifts P2, carries him and throws him; P2 lands hurt.
async function liftAndThrow(page: Page): Promise<void> {
  await match(page, 0);
  await place(page, 0, 200, 184, "right");
  await place(page, 1, 216, 184, "up");
  await tap(page, "KeyK");
  await tick(page, 15);
  let g = await game(page);
  const [f1, f2] = g.battle.fighters;
  console.log(`lift: P1 ${f1!.move} (tick ${f1!.moveTick}), P2 ${f2!.move}, z ${f2!.z / 256}`);
  if (f1!.move !== "lift" || f2!.move !== "held") problems.push(`lift: P1 ${f1!.move}, P2 ${f2!.move}`);
  await shot(page, "mech-lift");
  await tick(page, 12);
  await key(page, "KeyD", "keydown");
  await tick(page, 12);
  await key(page, "KeyD", "keyup");
  g = await game(page);
  if (g.battle.fighters[0]!.move !== "carry" || g.battle.fighters[1]!.z < 16 * 256) problems.push(`carry: ${JSON.stringify(g.battle.fighters[0])}`);
  await shot(page, "mech-carry");
  await tap(page, "KeyK");
  await tick(page, 14);
  g = await game(page);
  console.log(`throw: P2 ${g.battle.fighters[1]!.move} at z ${g.battle.fighters[1]!.z / 256}`);
  if (g.battle.fighters[1]!.move !== "thrown") problems.push(`throw: P2 ${g.battle.fighters[1]!.move}`);
  await shot(page, "mech-throw");
  await tick(page, 30);
  g = await game(page);
  console.log(`landed: P2 hearts ${g.battle.fighters[1]!.hearts}/16, mode ${g.battle.fighters[1]!.mode}, x ${g.players[1]!.x / 256}`);
  // Traced in Dolphin: a thrown Link lands unhurt, 42.9 px out.
  if (g.battle.fighters[1]!.hearts !== 16 || g.battle.fighters[1]!.mode !== "active") problems.push("throw: P2 was hurt landing");
}

// The Field: P1 lifts the bush at (96, 224); its tile is cut (drawn as the cut-bush tile), and he carries it.
async function bush(page: Page): Promise<void> {
  await match(page, 0);
  await place(page, 0, 104, 210, "down");
  await tap(page, "KeyK");
  await tick(page, 30);
  const g = await game(page);
  const tile = 14 * 32 + 6;
  console.log(`bush: cut ${JSON.stringify(g.battle.cut)}, P1 ${g.battle.fighters[0]!.move}`);
  if (!g.battle.cut.includes(tile) || g.battle.fighters[0]!.move !== "carry") problems.push(`bush: cut ${JSON.stringify(g.battle.cut)}, move ${g.battle.fighters[0]!.move}`);
  await shot(page, "mech-bush");
  await tap(page, "KeyK");
  await tick(page, 20);
  await shot(page, "mech-bush-thrown");
}

// A roll: walking right, K.
async function roll(page: Page): Promise<void> {
  await match(page, 2);
  await key(page, "KeyD", "keydown");
  await tick(page, 4);
  await tap(page, "KeyK");
  await key(page, "KeyD", "keydown");
  await tick(page, 8);
  const g = await game(page);
  console.log(`roll: P1 ${g.battle.fighters[0]!.move}, frame tick ${g.battle.fighters[0]!.moveTick}`);
  if (g.battle.fighters[0]!.move !== "roll") problems.push(`roll: P1 ${g.battle.fighters[0]!.move}`);
  await shot(page, "mech-roll");
  await key(page, "KeyD", "keyup");
  await tick(page, 20);
}

// Tower of Flames: P1 lifts a socket bomb (it lights), throws it toward the middle; it blows up.
async function flamesBomb(page: Page): Promise<void> {
  await match(page, 1);
  // A socket bomb with open floor 16 px inward (toward the arena's middle) to stand on, away from the eternal flames.
  const spot = await page.evaluate(() => {
    const { game, world } = (window as unknown as Win).fso;
    const floor = (x: number, y: number) => {
      const i = Math.floor(y / 8) * world.widthCells + Math.floor(x / 8);
      return world.solid[i] === 0 && world.surface[i] === 0;
    };
    for (const e of game.battle.entities) {
      if (e.kind !== "bomb") continue;
      const bx = e.x / 256, by = e.y / 256;
      for (const [dx, dy, facing] of [[-1, 0, "left"], [1, 0, "right"], [0, -1, "up"], [0, 1, "down"]] as const) {
        const x = bx - dx * 16, y = by - dy * 16;
        const inward = Math.abs(x - 256) + Math.abs(y - 192) < Math.abs(bx - 256) + Math.abs(by - 192);
        const burning = game.battle.entities.some((f) => f.kind === "flame" && Math.abs(f.x / 256 - x) < 28 && Math.abs(f.y / 256 - y) < 28);
        if (inward && !burning && [[-7, 0], [7, 0], [0, -7], [0, 7], [0, 4]].every(([ox, oy]) => floor(x + ox!, y + oy!))) return { x, y, facing, id: e.id };
      }
    }
    return null;
  });
  if (!spot) {
    problems.push("bomb: no socket bomb with floor next to it");
    return;
  }
  await place(page, 0, spot.x, spot.y, spot.facing);
  await place(page, 1, 256, 280, "up");
  await tap(page, "KeyK");
  await tick(page, 26);
  let g = await game(page);
  const bomb = g.battle.entities.find((e) => e.id === spot.id);
  console.log(`bomb: lifted (${bomb?.phase}, fuse ${bomb?.timer})`);
  if (bomb?.phase !== "held" || !(bomb.timer > 0)) problems.push(`bomb: ${JSON.stringify(bomb)}`);
  await shot(page, "mech-bomb-lifted");
  // Turn back toward the middle and throw.
  const back = { left: "KeyD", right: "KeyA", up: "KeyS", down: "KeyW" }[spot.facing]!;
  await key(page, back, "keydown");
  await tick(page, 2);
  await key(page, back, "keyup");
  await tap(page, "KeyK");
  await tick(page, 16);
  await shot(page, "mech-bomb-thrown");
  for (let i = 0; i < 320; i++) {
    g = await game(page);
    if (g.battle.entities.some((e) => e.kind === "explosion")) break;
    await tick(page, 1);
  }
  await tick(page, 3);
  g = await game(page);
  const drawn = await page.evaluate(() => (window as unknown as Win).fso.view.entities.drawn);
  console.log(`bomb: explosion drawn ${drawn.explosion ?? 0}, sockets left ${g.battle.entities.filter((e) => e.kind === "bomb").length}`);
  if (!drawn.explosion) problems.push("bomb: no explosion drawn");
  await shot(page, "mech-bomb-explosion");
}

// Tower of Flames: P1 lifts the pot at the fire pit's top-left (224, 160), steps on the switch under it (9), and the
// jets pointing away from that corner (right and down, through SWOR gates 11 and 13) shoot out onto P2.
async function potSwitchJets(page: Page): Promise<void> {
  await match(page, 1);
  await place(page, 0, 232, 150, "down");
  await place(page, 1, 300, 192, "left");
  await tap(page, "KeyK");
  await tick(page, 26);
  let g = await game(page);
  const cut = g.battle.cut.includes(10 * 32 + 14);
  console.log(`pot: lifted ${cut}, P1 ${g.battle.fighters[0]!.move}`);
  if (!cut || g.battle.fighters[0]!.move !== "carry") problems.push(`pot: cut ${JSON.stringify(g.battle.cut)}, P1 ${g.battle.fighters[0]!.move}`);
  await key(page, "KeyS", "keydown");
  await tick(page, 10);
  await key(page, "KeyS", "keyup");
  await tick(page, 14);
  g = await game(page);
  const sw = (n: number) => ((g.battle.switches >>> n) & 1) === 1;
  const jets = g.battle.entities.filter((e) => e.kind === "jet").map((e) => `${e.phase}:${e.timer}`);
  console.log(`pot switch: 9 ${sw(9)}, 11 ${sw(11)}, 13 ${sw(13)}; jets ${jets.join(" ")}; P2 hearts ${g.battle.fighters[1]!.hearts}`);
  if (!sw(9) || !sw(11) || !sw(13)) problems.push(`pot switch: switches ${g.battle.switches.toString(2)}`);
  if (g.battle.fighters[1]!.hearts >= 16) problems.push("jets: P2 wasn't burned");
  const clear = await seeThrough(page);
  if (clear) problems.push(`jets: ${clear} see-through canvas pixels (the lava's alpha)`);
  await shot(page, "mech-pot-switch-jets");
}

// The Tower of Flames' fire pit: P1 walks into its lava; he jumps out burning (JPA 585 + 581 facing up), lands in a
// puff of dust (975) and, now behind P2 in life, gets the rank-down mark over him (933); the embers stay up all along.
async function lavaPit(page: Page): Promise<void> {
  await match(page, 1);
  await place(page, 0, 257, 222, "up");
  await place(page, 1, 136, 232, "down");
  await key(page, "KeyW", "keydown");
  let g = await game(page);
  for (let t = 0; t < 40 && g.battle.fighters[0]!.mode !== "falling"; t++) {
    await tick(page, 1);
    g = await game(page);
  }
  await key(page, "KeyW", "keyup");
  const ids = () => page.evaluate(() => (window as unknown as Win).fso.view.particles.liveIds());
  await tick(page, 80);
  const burning = await ids();
  await shot(page, "mech-lava-burn");
  for (let t = 0; t < 80 && (await game(page)).battle.fighters[0]!.mode === "falling"; t++) await tick(page, 1);
  await tick(page, 2);
  const landed = await ids();
  await shot(page, "mech-lava-landed");
  g = await game(page);
  console.log(`lava: P1 ${g.battle.fighters[0]!.mode}, hearts ${g.battle.fighters[0]!.hearts}; burning ${burning.join(",")}; landed ${landed.join(",")}`);
  const missing = [585, 581, 680].filter((id) => !burning.includes(id)).concat([975, 933].filter((id) => !landed.includes(id)));
  if (missing.length) problems.push(`lava: effects ${missing.join(", ")} missing`);
}

// The Dark World Tower of Flames: a bomb going off at a crystal (80, 176) lights it for 384 ticks (its switch on, a
// light circle, the lit tile).
async function darkCrystal(page: Page): Promise<void> {
  await match(page, 6);
  await place(page, 0, 120, 200, "left");
  await page.evaluate(() => {
    const b = (window as unknown as Win).fso.game.battle;
    b.entities.push({ ...b.entities.find((e) => e.kind === "crystal")!, id: 999_999, kind: "bomb", phase: "rest", x: 100 * 256, y: 184 * 256, z: 0, timer: 2, home: -1, param: 0, hitMask: 0, tick: 0 });
  });
  await tick(page, 4);
  const g = await game(page);
  const crystal = g.battle.entities.find((e) => e.kind === "crystal");
  const lights = await page.evaluate(() => (window as unknown as Win).fso.view.lighting.drawn);
  console.log(`crystal: ${crystal?.phase}, switch 23 ${((g.battle.switches >>> 23) & 1) === 1}, ${lights} lights`);
  if (crystal?.phase !== "active") problems.push(`crystal: ${JSON.stringify(crystal)}`);
  await tick(page, 30);
  await shot(page, "mech-dark-crystal");
}

// Above the Clouds: the colored panels turn P2's color after 120 ticks; P1 standing on one falls.
async function panels(page: Page): Promise<void> {
  await match(page, 4);
  await place(page, 0, 248, 256, "down"); // on the ring's bottom side (out of the fire bars' way): P1's color (0) at first
  await tick(page, 60);
  let g = await game(page);
  if (g.battle.fighters[0]!.mode !== "active") problems.push(`panels: P1 ${g.battle.fighters[0]!.mode} on his own color`);
  await shot(page, "mech-panels-p1");
  await tick(page, 70);
  g = await game(page);
  console.log(`panels: after 130 ticks P1 ${g.battle.fighters[0]!.mode}, hearts ${g.battle.fighters[0]!.hearts}/16`);
  // Falling (the pit's 2 life come when he lands back, 125 ticks after falling in: combat.ts).
  if (g.battle.fighters[0]!.mode !== "falling" && g.battle.fighters[0]!.hearts >= 16) problems.push("panels: P1 didn't fall on P2's color");
  await shot(page, "mech-panels-p2");
}

// Above the Clouds: the fire bars turn.
async function fireBars(page: Page): Promise<void> {
  await match(page, 4, 4);
  await page.evaluate(() => ((window as unknown as Win).fso.view.cameraMode = "full"));
  await tick(page, 40);
  const drawn = await page.evaluate(() => (window as unknown as Win).fso.view.entities.drawn);
  console.log(`fire bars: ${drawn.firebar ?? 0} arms drawn`);
  if (drawn.firebar !== 2) problems.push(`fire bars: ${drawn.firebar} arms drawn`);
  await shot(page, "mech-firebars");
  await tick(page, 45);
  await shot(page, "mech-firebars-2");
  await page.evaluate(() => ((window as unknown as Win).fso.view.cameraMode = "fit"));
}

// The Field: P1's boomerang fetches the bow (set on it in flight) and brings it back drawn under it.
async function boomerang(page: Page): Promise<void> {
  await match(page, 0);
  await place(page, 0, 120, 184, "right");
  await place(page, 1, 120, 260, "up");
  await page.evaluate(() => ((window as unknown as Win).fso.game.battle.fighters[0]!.item = "boomerang"));
  await tap(page, "KeyL");
  await tick(page, 30);
  await page.evaluate(() => {
    const e = (window as unknown as Win).fso.game.battle.entities.find((e) => e.kind === "boomerang");
    if (e) e.item = "bow";
  });
  await tick(page, 1);
  await shot(page, "mech-boomerang-fetch");
  let g = await game(page);
  if (!g.battle.entities.some((e) => e.kind === "boomerang" && e.item === "bow")) problems.push("boomerang: not in flight with the bow");
  await tick(page, 80);
  g = await game(page);
  console.log(`boomerang: P1's item ${g.battle.fighters[0]!.item}`);
  if (g.battle.fighters[0]!.item !== "bow") problems.push(`boomerang: P1 got ${g.battle.fighters[0]!.item}, expected the bow`);
}

// Tower of Winds: P1 gets the bow and shoots at P2's back (on its bottom floor: it's side view).
async function arrow(page: Page): Promise<void> {
  await match(page, 2);
  await place(page, 0, 150, 328.5, "right");
  await place(page, 1, 300, 328.5, "right");
  await page.evaluate(() => ((window as unknown as Win).fso.game.battle.fighters[0]!.item = "bow"));
  await tick(page, 1);
  // The HUD's item box shows the bow in P1's corner, nothing in P2's.
  const items = JSON.stringify(await hudItems(page));
  console.log(`arrow: HUD items ${items}`);
  if (items !== '["kk_bow_01.bti",""]') problems.push(`arrow: HUD items ${items}, expected the bow and none`);
  await tap(page, "KeyL");
  await tick(page, 12);
  let g = await game(page);
  if (!g.battle.entities.some((e) => e.kind === "arrow")) problems.push("arrow: none in flight");
  await shot(page, "mech-arrow");
  await tick(page, 30);
  g = await game(page);
  console.log(`arrow: P2 hearts ${g.battle.fighters[1]!.hearts}/16`);
  if (g.battle.fighters[1]!.hearts >= 16) problems.push("arrow: P2 wasn't hit");
  // Items change hands: P1's box empties, P2's shows a bomb (icon 8).
  await page.evaluate(() => {
    const [p1, p2] = (window as unknown as Win).fso.game.battle.fighters;
    p1!.item = "";
    p2!.item = "bomb";
  });
  await tick(page, 1);
  const after = JSON.stringify(await hudItems(page));
  if (after !== '["","kk_bomb_00.bti"]') problems.push(`arrow: HUD items ${after} after the swap, expected none and the bomb`);
  await shot(page, "mech-hud-items");
  // A level-2 item gets the L2 badge.
  await page.evaluate(() => {
    const [p1, p2] = (window as unknown as Win).fso.game.battle.fighters;
    p1!.item = "slingshot";
    Object.assign(p2!, { item: "bow", itemLevel: 2 });
  });
  await tick(page, 1);
  const special = JSON.stringify(await hudItems(page));
  const badges = JSON.stringify(await hudLevels(page));
  console.log(`hud: a slingshot and a level-2 bow ${special}, L2 badges ${badges}`);
  if (!/^\["kk_\w+\.bti","kk_bow_01\.bti"\]$/.test(special)) problems.push(`hud: ${special}, expected the slingshot and the bow`);
  if (badges !== "[false,true]") problems.push(`hud: L2 badges ${badges}, expected P2's only`);
  await shot(page, "mech-hud-items-2");
}

// The Field: P1 holds the sword facing down: the sparkle along the blade (JPA 623), then at the full charge (the
// counter's 48) the burst at its tip (203, 204), the blade's glow (626) and the glint (enemy_both2 683…); let go, he spins.
async function swordCharge(page: Page): Promise<void> {
  await match(page, 0);
  await place(page, 0, 200, 184, "down");
  await place(page, 1, 300, 184, "left");
  const count = async () => ((await game(page)).players[0]! as Player & { actionTick: number }).actionTick;
  const ids = () => page.evaluate(() => (window as unknown as Win).fso.view.particles.liveIds());
  const glints = () => page.evaluate(() => (window as unknown as Win).fso.view.entities.drawn.glint ?? 0);
  await key(page, "KeyJ", "keydown");
  for (let t = 0; t < 60 && ((await game(page)).players[0]!.action !== "charge" || (await count()) < 30); t++) await tick(page, 1);
  const charging = await ids();
  await shot(page, "mech-charge");
  for (let t = 0; t < 40 && (await count()) < 50; t++) await tick(page, 1);
  const full = await ids(), glint = await glints();
  await shot(page, "mech-charge-full");
  await tick(page, 20);
  const later = await glints();
  await shot(page, "mech-charge-glow");
  await key(page, "KeyJ", "keyup");
  await tick(page, 3);
  const g = await game(page);
  console.log(`charge: charging ${charging.join(",")}; full ${full.join(",")}, glint ${glint} then ${later}; let go: ${g.players[0]!.action}`);
  if (!charging.includes(623)) problems.push("charge: no sparkle (623) while charging");
  const missing = [203, 204, 626].filter((id) => !full.includes(id));
  if (missing.length) problems.push(`charge: effects ${missing.join(", ")} missing once full`);
  if (glint !== 1 || later !== 0) problems.push(`charge: the glint drawn ${glint} then ${later} times, expected 1 then 0`);
  if (g.players[0]!.action !== "spin") problems.push(`charge: ${g.players[0]!.action} on letting go, expected spin`);
}

// The Field: P1's hammer flattens P2 in front of him (drawn half height), then his Fire Rod's fireball (JPA 411, 412)
// sets P2 alight: P2 runs burning (his flames 583 facing left… by his facing).
async function hammerAndFireRod(page: Page): Promise<void> {
  await match(page, 0);
  await place(page, 0, 200, 184, "right");
  await place(page, 1, 220, 188, "up");
  await page.evaluate(() => ((window as unknown as Win).fso.game.battle.fighters[0]!.item = "hammer"));
  await tick(page, 1);
  const items = JSON.stringify(await hudItems(page));
  console.log(`hammer: HUD items ${items}`);
  if (!/^\["kk_\w+\.bti",""\]$/.test(items)) problems.push(`hammer: HUD items ${items}, expected the hammer's icon and none`);
  await tap(page, "KeyL");
  await tick(page, 8);
  let g = await game(page);
  const f2 = g.battle.fighters[1]! as Fighter & { squash: number };
  console.log(`hammer: P2 ${f2.move}, hearts ${f2.hearts}/16`);
  if (f2.move !== "squash" || f2.hearts !== 14) problems.push(`hammer: P2 ${f2.move} with ${f2.hearts} hearts, expected flattened with 14`);
  await tick(page, 12);
  g = await game(page);
  if ((g.battle.fighters[1]! as Fighter & { squash: number }).squash !== 50) problems.push("hammer: P2 not flat after the squash");
  await shot(page, "mech-hammer");
  await page.evaluate(() => {
    const f = (window as unknown as Win).fso.game.battle.fighters;
    f[0]!.item = "fireRod";
    Object.assign(f[1]!, { flat: 0, squash: 100, invincible: 0 });
  });
  await place(page, 1, 250, 184, "left");
  await tap(page, "KeyL");
  await tick(page, 13);
  const ids = () => page.evaluate(() => (window as unknown as Win).fso.view.particles.liveIds());
  const flying = await ids();
  g = await game(page);
  if (!g.battle.entities.some((e) => e.kind === "fireball")) problems.push("fire rod: no fireball");
  await shot(page, "mech-fireball");
  for (let t = 0; t < 40 && (await game(page)).battle.fighters[1]!.move !== "burning"; t++) await tick(page, 1);
  await tick(page, 30);
  const burning = await ids();
  g = await game(page);
  console.log(`fire rod: P2 ${g.battle.fighters[1]!.move}, hearts ${g.battle.fighters[1]!.hearts}; flying ${flying.join(",")}; burning ${burning.join(",")}`);
  if (g.battle.fighters[1]!.move !== "burning") problems.push(`fire rod: P2 ${g.battle.fighters[1]!.move}, expected burning`);
  const missing = [411, 412].filter((id) => !flying.includes(id)).concat([584, 580].filter((id) => !burning.includes(id)));
  if (missing.length) problems.push(`fire rod: effects ${missing.join(", ")} missing`);
  await shot(page, "mech-burning");
}

// The Field: P1 throws the boomerang at P2 (the Dolphin state's spots); it leaves pale afterimages behind it.
async function boomerangAfterimages(page: Page): Promise<void> {
  await match(page, 0);
  await place(page, 0, 203, 280, "right");
  await place(page, 1, 312, 280, "down");
  await page.evaluate(() => ((window as unknown as Win).fso.game.battle.fighters[0]!.item = "boomerang"));
  await tap(page, "KeyL");
  await tick(page, 24);
  const g = await game(page);
  const drawn = await page.evaluate(() => (window as unknown as Win).fso.view.entities.drawn);
  console.log(`boomerang: ${drawn.boomerang ?? 0} drawn, ${drawn.afterimages ?? 0} afterimages`);
  if (!g.battle.entities.some((e) => e.kind === "boomerang" && e.hp >= 0)) problems.push("boomerang afterimages: none in flight");
  else if (!((drawn.afterimages ?? 0) >= 3 && (drawn.afterimages ?? 0) <= 5)) problems.push(`boomerang: ${drawn.afterimages ?? 0} afterimages (expected 3-5: one every 4 ticks for 20)`);
  await shot(page, "mech-boomerang-afterimages");
}

function hudLevels(page: Page): Promise<boolean[]> {
  return page.evaluate(() => (window as unknown as Win).fso.hud.snapshot().map((c) => c.level));
}

function hudItems(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as Win).fso.hud.snapshot().map((c) => c.item));
}

// The Field: its kind-2 generator leaves an item on the ground (bow or bombs) 2.5 s in, the kind-1 one an orb 7.5 s in.
async function orbs(page: Page): Promise<void> {
  await match(page, 0, 4);
  await tick(page, 600);
  const g = await game(page);
  const orbs = g.battle.entities.filter((e) => e.kind === "orb");
  const items = g.battle.entities.filter((e) => e.kind === "pickup");
  console.log(`orbs: ${orbs.map((o) => o.item).join(", ")}; on the ground: ${items.map((o) => o.item).join(", ")}`);
  if (orbs.length !== 1) problems.push(`orbs: ${orbs.length} (expected 1)`);
  if (items.length !== 1 || !["bow", "bomb"].includes(items[0]!.item)) problems.push(`items on the ground: ${JSON.stringify(items.map((o) => o.item))} (expected bow or bomb)`);
  await page.evaluate(() => ((window as unknown as Win).fso.view.cameraMode = "full"));
  await tick(page, 1);
  await shot(page, "mech-orbs");
  await page.evaluate(() => ((window as unknown as Win).fso.view.cameraMode = "fit"));
  // Idle, the orb blinks a green / red "?" (enemy_both2 144 / 145); lifted, it blinks on for 20 frames, then the
  // roulette stops on its content's icon (carrot 152, cucco 147) within 359 frames (measured: 5 N + 129, N ≤ 46).
  const orb = orbs[0];
  if (!orb) return;
  const icons = (): Promise<Record<number, number>> => page.evaluate(() => (window as unknown as Win).fso.view.entities.orbIcons);
  const idle = new Set<number>();
  for (let i = 0; i < 2; i++, await tick(page, 10)) idle.add((await icons())[orb.id]!);
  if ([...idle].sort().join() !== "144,145") problems.push(`idle orb icons: ${[...idle].join(", ")} (expected 144, 145)`);
  await place(page, 0, orb.x / 256, orb.y / 256 - 16, "down");
  await tap(page, "KeyK");
  await tick(page, 10);
  const early = (await icons())[orb.id];
  await tick(page, 100);
  await shot(page, "mech-orb-roulette");
  const spinning = (await icons())[orb.id];
  await tick(page, 300);
  const held = (await game(page)).battle.entities.find((e) => e.id === orb.id);
  const final = (await icons())[orb.id];
  const expected = ({ carrot: 152, cucco: 147 } as Record<string, number>)[orb.item];
  console.log(`orb roulette: ${early} lifted, ${spinning} spinning, ${final} at the end (${orb.item}, ${held?.phase})`);
  if (held?.phase !== "held") problems.push(`orb roulette: the orb is ${held?.phase ?? "gone"}, not held`);
  if (early !== 144 && early !== 145) problems.push(`orb roulette: ${early} just lifted (expected a "?", 144 or 145)`);
  if (final !== expected) problems.push(`orb roulette: ends on ${final} (expected ${expected} for ${orb.item})`);
  await shot(page, "mech-orb-content");
}

// Hyrule Castle: the soldiers go after the Links.
async function soldiers(page: Page): Promise<void> {
  await match(page, 3, 4);
  await page.evaluate(() => ((window as unknown as Win).fso.view.cameraMode = "full"));
  await tick(page, 90);
  const g = await game(page);
  const moved = g.battle.entities.filter((e) => e.kind === "soldier" && e.phase === "chase").length;
  console.log(`soldiers: ${moved} chasing`);
  if (!moved) problems.push("soldiers: none chasing");
  await shot(page, "mech-soldiers");
  // The GEN3 bow soldiers (switches 7, 8) and captain (9) come when their switches rise (castlesoldiers.ts).
  await page.evaluate(() => {
    const b = (window as unknown as Win).fso.game.battle;
    b.switches = (b.switches & ~((1 << 7) | (1 << 8) | (1 << 9))) >>> 0;
  });
  await tick(page, 1);
  await page.evaluate(() => {
    const b = (window as unknown as Win).fso.game.battle;
    b.switches = (b.switches | (1 << 7) | (1 << 8) | (1 << 9)) >>> 0;
  });
  await tick(page, 60);
  const castle = (await game(page)).battle.entities;
  const drawn = await page.evaluate(() => (window as unknown as Win).fso.view.entities.drawn);
  const count = (kind: string) => castle.filter((e) => e.kind === kind && e.hp >= 0).length;
  console.log(`castle soldiers: ${count("bowSoldier")} bow soldiers, ${count("captain")} captain (drawn ${drawn.bowSoldier ?? 0}, ${drawn.captain ?? 0})`);
  if (count("bowSoldier") < 1 || count("captain") < 1) problems.push(`castle soldiers: ${count("bowSoldier")} bow soldiers, ${count("captain")} captains`);
  if (!drawn.bowSoldier || !drawn.captain) problems.push(`castle soldiers: drawn ${JSON.stringify(drawn)}`);
  await shot(page, "mech-castle-soldiers");
  await page.evaluate(() => ((window as unknown as Win).fso.view.cameraMode = "fit"));
}

// Time-out: Vaati comes and knocks everyone out (measured: a Link in a side room too, so no shelter): a draw.
async function vaati(page: Page): Promise<void> {
  await match(page, 0, 2, 60);
  await page.evaluate(() => ((window as unknown as Win).fso.game.battle.timeLeft = 2));
  await page.evaluate(() => ((window as unknown as Win).fso.view.cameraMode = "full"));
  await tick(page, 120);
  let g = await game(page);
  console.log(`vaati: timeUp ${g.battle.timeUp}, Vaati ${g.battle.entities.some((e) => e.kind === "giantBomb")}`);
  if (!g.battle.timeUp) problems.push("vaati: no Vaati");
  await shot(page, "mech-vaati-bomb");
  await tick(page, 340); // he knocks everyone out 454 ticks after the time-out (measured)
  g = await game(page);
  console.log(`vaati: phase ${g.battle.phase}, hearts ${g.battle.fighters.map((f) => f.hearts).join("/")}`);
  if (g.battle.phase !== "roundOver" || g.battle.fighters.some((f) => f.hearts !== 0)) problems.push(`vaati: ${g.battle.phase}, ${g.battle.fighters.map((f) => f.hearts)}`);
  await shot(page, "mech-vaati-blast");
}

// The message window goes to the top when it would cover a Link at the bottom (timeline.ts messageAtTop): both Links
// by the arena's bottom edge, P2 knocked out, "P2 down!" 107 ticks later at the top.
async function messageAtTop(page: Page): Promise<void> {
  await match(page, 0);
  await place(page, 0, 200, 372, "up");
  await place(page, 1, 300, 372, "up");
  await tick(page, 30); // (the camera settles on them)
  await page.evaluate(() => ((window as unknown as Win).fso.game.battle.fighters[1]!.hearts = 0));
  await tick(page, 107 + 40);
  const shown = await page.evaluate(() => (window as unknown as Win).fso.screens.visible().filter((t) => t.startsWith("message")));
  console.log(`message: ${shown.join(" ")}`);
  if (shown.join(" ") !== "message:P2 down! message-top") problems.push(`message: not at the top (${shown})`);
  await shot(page, "mech-message-top");
}

// The Field's house (a side room, packages/sim siderooms.ts): P1 walks up to its shut door, pushes it open (traced: 20
// ticks walking into it, 12 pushing) and through it (in at y 178.5, out at (80, 116) in the house), shows in a GBA inset
// with the HUD's black disc, lifts the house's socket bomb and throws it at the crystal: lit, it rains bombs on the TV
// (switch 5 → 8). Then out of the door again, the exit marked.
async function sideRoom(page: Page): Promise<void> {
  const SIDE = 512 * 2; // the house: sublayer 2, laid out 2 × 512 px below the arena
  await match(page, 0);
  await place(page, 0, 255.5, 200, "up");
  await key(page, "KeyW", "keydown");
  await tick(page, 52);
  await key(page, "KeyW", "keyup");
  let g = await game(page);
  console.log(`side room: P1 ${g.battle.fighters[0]!.move} at y ${g.players[0]!.y / 256}`);
  if (g.battle.fighters[0]!.move !== "warp") problems.push(`side room: P1 didn't go through the house's door (${g.battle.fighters[0]!.move}, y ${g.players[0]!.y / 256})`);
  await tick(page, 110);
  g = await game(page);
  const at = [g.players[0]!.x / 256, g.players[0]!.y / 256 - SIDE];
  const view = await page.evaluate(() => {
    const w = window as unknown as Win;
    return { insets: w.fso.view.insets(w.fso.game).length, disc: w.fso.hud.snapshot()[0]!.disc, frames: document.querySelectorAll(".inset-frame:not([hidden])").length };
  });
  console.log(`side room: P1 at (${at.join(", ")}) in the house, ${view.insets} inset, disc ${view.disc}`);
  if (at[0] !== 80 || at[1] !== 116 || view.insets !== 1 || view.frames !== 1 || !view.disc) problems.push(`side room: P1 at (${at}), insets ${view.insets}/${view.frames}, disc ${view.disc}`);
  await shot(page, "mech-side-room");
  // The socket bomb at (40, 40) of the house: lift it (it lights), face right, throw it at the crystal (112, 32).
  await place(page, 0, 40, SIDE + 56, "up");
  await tap(page, "KeyK");
  await tick(page, 26);
  await tap(page, "KeyD");
  await tick(page, 2);
  await tap(page, "KeyK");
  await tick(page, 40);
  g = await game(page);
  const bomb = g.battle.entities.find((e) => e.kind === "bomb" && e.y >= SIDE * 256);
  console.log(`side room: the house's bomb ${bomb ? `${bomb.phase} at (${bomb.x / 256}, ${bomb.y / 256 - SIDE}), fuse ${bomb.timer}` : "gone"}`);
  await shot(page, "mech-side-room-bomb");
  let lit = false, rained = 0;
  for (let t = 0; t < 400 && !(lit && rained); t += 10) {
    await tick(page, 10);
    g = await game(page);
    lit ||= g.battle.entities.some((e) => e.kind === "crystal" && e.y >= SIDE * 256 && e.phase === "active");
    rained = g.battle.entities.filter((e) => e.kind === "bomb" && e.y < 384 * 256 && e.timer > 0).length;
  }
  console.log(`side room: the crystal ${lit ? "lit" : "not lit"}, ${rained} bombs on the TV`);
  if (!lit || rained < 4) problems.push(`side room: crystal ${lit}, ${rained} bombs on the TV`);
  await page.evaluate(() => ((window as unknown as Win).fso.view.cameraMode = "full"));
  await tick(page, 2);
  await shot(page, "mech-side-room-bombs");
  await page.evaluate(() => ((window as unknown as Win).fso.view.cameraMode = "fit"));
  // Out again: down through the door; the TV marks where he comes out.
  await place(page, 0, 80, SIDE + 112, "down");
  await key(page, "KeyS", "keydown");
  await tick(page, 12);
  await key(page, "KeyS", "keyup");
  await tick(page, 60);
  const marks = await page.evaluate(() => document.querySelectorAll(".exit-mark:not([hidden])").length);
  await shot(page, "mech-side-room-exit");
  await tick(page, 60);
  g = await game(page);
  console.log(`side room: out at (${g.players[0]!.x / 256}, ${g.players[0]!.y / 256}), ${marks} exit mark`);
  if (g.players[0]!.y / 256 !== 188 || marks !== 1) problems.push(`side room: out at y ${g.players[0]!.y / 256}, ${marks} marks`);

  // The Tower of Flames' north room: its floor switch (14) lights the eternal flames on the TV (traced in Dolphin).
  await match(page, 1);
  await place(page, 0, 256, 100, "up");
  await key(page, "KeyW", "keydown");
  await tick(page, 12);
  await key(page, "KeyW", "keyup");
  await tick(page, 110);
  await place(page, 0, 152, SIDE + 60, "up");
  await key(page, "KeyW", "keydown");
  await tick(page, 20);
  g = await game(page);
  const flames = await page.evaluate(() => (window as unknown as Win).fso.view.entities.drawn.flame ?? 0);
  console.log(`side room: Tower of Flames switch ${(g.battle.switches >>> 14) & 1}, ${flames} eternal flames drawn`);
  if (!((g.battle.switches >>> 14) & 1) || flames < 10) problems.push(`side room: the eternal flames (switch ${(g.battle.switches >>> 14) & 1}, ${flames} drawn)`);
  await shot(page, "mech-side-room-flames");
  await key(page, "KeyW", "keyup");

  // Above the Clouds' hole (measured): no pit; down into the room under it, into its cannon, shot back over the TV.
  await match(page, 4);
  await place(page, 0, 248, 190, "up");
  await key(page, "KeyW", "keydown");
  await tick(page, 12);
  await key(page, "KeyW", "keyup");
  await tick(page, 150);
  g = await game(page);
  console.log(`side room: Above the Clouds, P1 ${g.battle.fighters[0]!.move} at (${g.players[0]!.x / 256}, ${g.players[0]!.y / 256 - SIDE})`);
  if (g.battle.fighters[0]!.move !== "cannon") problems.push(`side room: P1 not in the cannon (${g.battle.fighters[0]!.move})`);
  await shot(page, "mech-side-room-cannon");
  await tap(page, "KeyL");
  await tick(page, 100);
  await key(page, "KeyS", "keydown");
  await tick(page, 90);
  await key(page, "KeyS", "keyup");
  await tick(page, 2);
  g = await game(page);
  console.log(`side room: shot out, P1 ${g.battle.fighters[0]!.mode}/${g.battle.fighters[0]!.move} at (${g.players[0]!.x / 256}, ${g.players[0]!.y / 256}), hearts ${g.battle.fighters[0]!.hearts}`);
  if (g.players[0]!.y >= 384 * 256 || g.battle.fighters[0]!.move !== "none" || g.battle.fighters[0]!.hearts !== 16) problems.push(`side room: the cannon's shot (${g.battle.fighters[0]!.move}, y ${g.players[0]!.y / 256})`);
  await shot(page, "mech-side-room-landed");

  // Hyrule Castle: an open magic circle (switch 18 at (168, 168)) takes P1 to the dark side (s1, (160, 160)); out by
  // its middle spot (style 6), down onto the TV's (256, 208), marked meanwhile. P2's life is kept up (the soldiers).
  const DARK = 512;
  const keepUp = () => page.evaluate(() => ((window as unknown as Win).fso.game.battle.fighters[1]!.hearts = 16));
  await match(page, 3);
  await place(page, 0, 168, 190, "up");
  await page.evaluate(() => ((window as unknown as Win).fso.game.battle.switches |= 1 << 18));
  await tick(page, 66);
  // Full size (50 ticks on) it asks for "You got 10 Dark World seconds!" (BMG 0xE8) in the message window, sliding up
  // from the bottom; Hyrule Castle's circle is the one with "10" on it (enemy_gc_sob 302).
  const asked = await page.evaluate(() => {
    const w = (window as unknown as Win).fso;
    return { shown: w.screens.visible().filter((t) => t.startsWith("message")), circles: Object.values(w.view.entities.circleFrames) };
  });
  console.log(`side room: the castle's circle ${asked.circles.join("/")}, ${asked.shown.join(" ")}`);
  if (asked.shown[0] !== "message:You got 10 Dark World seconds!" || !asked.circles.includes(302)) problems.push(`side room: the circle's message and "10" (${asked.shown}, ${asked.circles})`);
  await shot(page, "mech-castle-message");
  await key(page, "KeyW", "keydown");
  await tick(page, 6);
  await key(page, "KeyW", "keyup");
  g = await game(page);
  const taken = g.battle.fighters[0]!.move;
  await tick(page, 40);
  await shot(page, "mech-castle-circle");
  await tick(page, 140);
  await keepUp();
  g = await game(page);
  const dark = await page.evaluate(() => (window as unknown as Win).fso.view.insets((window as unknown as Win).fso.game).length);
  console.log(`side room: castle circle ${taken}, P1 at (${g.players[0]!.x / 256}, ${g.players[0]!.y / 256 - DARK}) on the dark side, ${dark} inset, ${g.battle.fighters[0]!.dark} ticks left`);
  // His HUD corner: the black disc with his sprite in it, the other groups slid 15 px in; his seconds by his inset.
  const disc = await page.evaluate(() => ({ hud: (window as unknown as Win).fso.hud.snapshot()[0]!, label: document.querySelector(".inset-frame:not([hidden]) b")?.textContent ?? "" }));
  console.log(`side room: the disc ${disc.hud.disc} with frame ${disc.hud.discFrame}, slid ${disc.hud.slide} px, inset "${disc.label}"`);
  if (!disc.hud.disc || disc.hud.discFrame < 0 || disc.hud.slide !== 15 || !/^P1 · \d+$/.test(disc.label)) problems.push(`side room: the HUD's disc (${JSON.stringify(disc)})`);
  if (taken !== "circle" || g.players[0]!.x / 256 !== 160 || g.players[0]!.y / 256 !== DARK + 160 || dark !== 1) problems.push(`side room: the castle's circle (${taken}, at (${g.players[0]!.x / 256}, ${g.players[0]!.y / 256}), ${dark} insets)`);
  await shot(page, "mech-castle-dark-side");
  await place(page, 0, 256, DARK + 222, "up");
  await key(page, "KeyW", "keydown");
  await tick(page, 8);
  await key(page, "KeyW", "keyup");
  await tick(page, 120);
  await keepUp();
  const spot = await page.evaluate(() => ({ move: (window as unknown as Win).fso.game.battle.fighters[0]!.move, moveTick: (window as unknown as Win).fso.game.battle.fighters[0]!.moveTick, marks: document.querySelectorAll(".exit-mark.down:not([hidden])").length }));
  await shot(page, "mech-castle-spot");
  await tick(page, 244 - spot.moveTick);
  await shot(page, "mech-castle-drop"); // spinning down onto the spot
  await tick(page, 262 - 244); // down on the TV on its 262nd tick (siderooms.ts SPOT_TICKS)
  g = await game(page);
  console.log(`side room: out by the middle (${spot.move}, ${spot.marks} mark), P1 at (${g.players[0]!.x / 256}, ${g.players[0]!.y / 256}) ${g.battle.fighters[0]!.move}`);
  if (spot.move !== "spot" || spot.marks !== 1 || g.players[0]!.x / 256 !== 256 || g.players[0]!.y / 256 !== 208 || g.battle.fighters[0]!.move !== "none") problems.push(`side room: the dark side's middle (${spot.move}, ${spot.marks} marks, at y ${g.players[0]!.y / 256})`);
}

// The Tower of Winds, side view as in the game (packages/sim siderooms.ts, traced): P1 stands on his ledge, walks off
// it and falls 4 px a tick to the floor, climbs a ladder, goes through the left gate (Up) into the gallery (an inset);
// then the giant-bomb Shadow Link (switch 21, the gallery's four crystals): he rises, holds his bomb as it grows,
// throws it; it burns with its last seconds counted, and its blast knocks out P2 on the TV while P1, in the gallery, is
// spared (traced: 1021 ticks from the switch).
async function winds(page: Page): Promise<void> {
  await match(page, 2);
  await place(page, 0, 152, 184, "right");
  await place(page, 1, 360, 184, "left");
  await tick(page, 2);
  let g = await game(page);
  const stood = g.players.map((p) => p.y / 256);
  console.log(`winds: the Links stand at y ${stood.join(", ")}`);
  if (stood.some((y) => y !== 184.5)) problems.push(`winds: the Links aren't on their ledges (y ${stood})`);
  const shadows = await page.evaluate(() => (window as unknown as Win).fso.view.entities.drawn.shadows ?? 0);
  if (shadows) problems.push(`winds: ${shadows} shadows drawn in side view`);
  await shot(page, "mech-winds");
  // Off the ledge's right end (x 176): falling 4 px a tick, down to the floor.
  await key(page, "KeyD", "keydown");
  for (let t = 0; t < 40 && (await game(page)).players[0]!.x < 182 * 256; t++) await tick(page, 1);
  await key(page, "KeyD", "keyup");
  await tick(page, 3);
  const y0 = (await game(page)).players[0]!.y;
  await tick(page, 1);
  const fell = ((await game(page)).players[0]!.y - y0) / 256;
  await shot(page, "mech-winds-fall");
  await tick(page, 40);
  g = await game(page);
  console.log(`winds: off the ledge, ${fell} px a tick, down at (${g.players[0]!.x / 256}, ${g.players[0]!.y / 256})`);
  if (fell !== 4 || g.players[0]!.y / 256 < 320) problems.push(`winds: the fall (${fell} px/tick, y ${g.players[0]!.y / 256})`);
  // A ladder (x 224-239, from the floor up to the middle ledge's top at 240).
  await place(page, 0, 232, 328.5, "up");
  await key(page, "KeyW", "keydown");
  await tick(page, 40);
  g = await game(page);
  const climbed = 328.5 - g.players[0]!.y / 256;
  await shot(page, "mech-winds-ladder");
  await tick(page, 80);
  await key(page, "KeyW", "keyup");
  await tick(page, 4);
  const topped = (await game(page)).players[0]!.y / 256;
  console.log(`winds: the ladder, ${climbed} px up in 40 ticks, then at y ${topped}`);
  if (climbed < 30 || topped > 240) problems.push(`winds: the ladder (${climbed} px up, then at y ${topped})`);
  // The left gate (64, 184): a press of Up in it, then 110 ticks to the gallery's (64, 184).
  await place(page, 0, 66, 184.5, "left");
  await tick(page, 2);
  await tap(page, "KeyW");
  g = await game(page);
  const warping = g.battle.fighters[0]!.move;
  await tick(page, 112);
  g = await game(page);
  const insets = await page.evaluate(() => (window as unknown as Win).fso.view.insets((window as unknown as Win).fso.game).length);
  console.log(`winds: the gate (${warping}), P1 at (${g.players[0]!.x / 256}, ${g.players[0]!.y / 256 - 512}) in the gallery, ${insets} inset`);
  if (warping !== "warp" || g.players[0]!.x !== 64 * 256 || Math.floor(g.players[0]!.y / 256) !== 512 + 184 || insets !== 1) problems.push(`winds: the gate (${warping}, at (${g.players[0]!.x / 256}, ${g.players[0]!.y / 256}), ${insets} insets)`);
  await shot(page, "mech-winds-gallery");
  // Switch 21: the giant-bomb Shadow Link.
  await page.evaluate(() => ((window as unknown as Win).fso.game.battle.switches |= 1 << 21));
  let t = 0;
  const seen = new Set<number>();
  let sparkles = 0, landed = "";
  for (; t < 1100; t++) {
    await tick(page, 1);
    const entities = (await game(page)).battle.entities;
    const e = entities.find((x) => x.kind === "shadowLink");
    // Landing, the bomb asks for its message (the window up 14 ticks later).
    const big = entities.find((x) => x.kind === "bigBomb");
    if (big?.param === 5 && big.tick === 14) {
      landed = (await page.evaluate(() => (window as unknown as Win).fso.screens.visible().find((v) => v.startsWith("message:")))) ?? "none";
      await shot(page, "mech-winds-giant-bomb-message");
    }
    const v = await page.evaluate(() => ({ frame: (window as unknown as Win).fso.view.shadowLinkFrame, particles: (window as unknown as Win).fso.view.particles.stats.particles }));
    if (v.frame >= 0) seen.add(v.frame);
    if (e?.param === 3) sparkles = Math.max(sparkles, v.particles);
    if (e?.param === 6 && e.tick === 40) await shot(page, "mech-winds-shadow-link"); // holding his bomb as it grows
    if (e?.param === 7 && e.tick === 12) await shot(page, "mech-winds-shadow-throw");
    if (e && e.param >= 9) break;
  }
  let bomb: Entity | undefined;
  for (; t < 1100; t += 10) {
    await tick(page, 10);
    bomb = (await game(page)).battle.entities.find((x) => x.kind === "bigBomb");
    if (bomb && bomb.param === 6 && bomb.timer < 300) break;
  }
  await page.evaluate(() => ((window as unknown as Win).fso.game.battle.fighters[0]!.hearts = 16));
  const drawn = await page.evaluate(() => (window as unknown as Win).fso.view.entities.drawn.bigBomb ?? 0);
  await shot(page, "mech-winds-giant-bomb"); // burning, its seconds counted
  console.log(`winds: the Shadow Link drawn on frames ${[...seen].sort((a, b) => a - b).join(", ")}, ${sparkles} sparkle particles; his bomb ${bomb ? `burning, ${bomb.timer} left` : "missing"}, drawn ${drawn}`);
  console.log(`winds: the bomb landing, ${landed}`);
  if (landed !== "message:A giant bomb! Escape to your Game Boy Advance!") problems.push(`winds: the giant bomb's message (${landed})`);
  if (![257, 263, 258, 813, 816].every((f) => seen.has(f)) || !sparkles || !bomb || !drawn) problems.push(`winds: the Shadow Link (frames ${[...seen]}, sparkles ${sparkles}, bomb ${bomb?.param}/${bomb?.timer}, drawn ${drawn})`);
  await tick(page, bomb ? bomb.timer + 2 : 0);
  await shot(page, "mech-winds-blast");
  await tick(page, 20);
  g = await game(page);
  console.log(`winds: the blast, hearts ${g.battle.fighters.map((f) => f.hearts).join(", ")}, ${g.battle.phase}`);
  if (g.battle.fighters[0]!.hearts <= 0 || g.battle.fighters[1]!.hearts > 0) problems.push(`winds: the blast (hearts ${g.battle.fighters.map((f) => f.hearts)})`);
}

// Bombchus (packages/sim bombchus.ts): the Tower of Flames' eight from its spawners by the walls (switch 30), and the
// Dark Tower of Winds' crawling out of its wall hole along the side-view TV (its pot's switch 1).
async function bombchus(page: Page): Promise<void> {
  await match(page, 1);
  await page.evaluate(() => ((window as unknown as Win).fso.game.battle.switches |= 1 << 30));
  await tick(page, 40);
  let chus = await page.evaluate(() => (window as unknown as Win).fso.view.entities.drawn.bombchu ?? 0);
  console.log(`bombchus: ${chus} drawn in the Tower of Flames`);
  if (chus !== 8) problems.push(`bombchus: ${chus} drawn in the Tower of Flames, expected 8`);
  await page.evaluate(() => ((window as unknown as Win).fso.view.cameraMode = "full"));
  await tick(page, 2);
  await shot(page, "mech-bombchus");
  await page.evaluate(() => ((window as unknown as Win).fso.view.cameraMode = "fit"));
  await tick(page, 300);
  const g = await game(page);
  const left = g.battle.entities.filter((e) => e.kind === "bombchu").length;
  if (left) problems.push(`bombchus: ${left} still about 340 ticks on`);
  await match(page, 7);
  await page.evaluate(() => ((window as unknown as Win).fso.game.battle.switches |= 1 << 1));
  await tick(page, 70);
  chus = await page.evaluate(() => (window as unknown as Win).fso.view.entities.drawn.bombchu ?? 0);
  const chu = (await game(page)).battle.entities.find((e) => e.kind === "bombchu");
  console.log(`bombchus: the Dark Tower of Winds' ${chu ? `at (${chu.x / 256}, ${chu.y / 256}), ${chu.param & 32 ? "crawling" : "free"}` : "missing"}, ${chus} drawn`);
  if (!chu || !(chu.param & 32) || chus !== 1) problems.push(`bombchus: the Dark Tower of Winds' (${chu?.param}, ${chus} drawn)`);
  await shot(page, "mech-bombchus-wall");
}
