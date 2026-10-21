// The battle's sound cues (sound.ts SoundCues) for the side rooms, from real rounds stepped tick by tick: which effects
// play when a Link opens The Field's house door, goes through it and back, falls into Above the Clouds' hole, and the Tower of
// Winds' Shadow Link comes; skipped when extracted/ is absent (e.g. in CI).
import { existsSync, readFileSync } from "node:fs";
import { decompressYaz0, Dol, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { arenaProps, buildArenaWorld, Button, COUNTDOWN_TICKS, createBattle, setSwitch, sideRoomY, stepGame, SUBPX, type GameState, type World } from "@fso/sim";
import { describe, expect, it } from "vitest";
import { SoundCues, type BattleAudio } from "./sound.ts";

const root = new URL("../../../extracted/", import.meta.url);
const present = existsSync(new URL("sys/main.dol", root));

/** A stand-in for the synth: what was played, on which tick. */
function recorder(): { audio: BattleAudio; played: [number, string][]; held: Map<string, string> } {
  const played: [number, string][] = [];
  const held = new Map<string, string>(); // the held sounds playing, by tag
  const audio = {
    currentBgm: null,
    playSe: (names: readonly string[], tick: number, tag: string | null = null) =>
      names.forEach((n) => (tag ? held.set(tag, n) : played.push([tick, n]))),
    stopSe: (tag: string) => held.delete(tag),
    playBgm: () => {},
    arenaBgm: () => null,
  };
  return { audio: audio as unknown as BattleAudio, played, held };
}

describe.skipIf(!present)("real disc: the side rooms' sounds", () => {
  const stage = present ? new Stage(parseRarc(decompressYaz0(readFileSync(new URL("files/GC4Sword_usa/Boss/boss500.arc", root))))) : null!;
  const tileTypes = present ? readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root)))) : null!;
  const round = (room: number, spawns: { x: number; y: number }[]): { game: GameState; world: World; cues: SoundCues; played: [number, string][]; held: Map<string, string> } => {
    const world = buildArenaWorld(stage, tileTypes, room);
    const game = createBattle(room, spawns.map((s) => ({ ...s, facing: "up" as const })), { hearts: 3, timeLimit: 0, wins: 3 }, arenaProps(stage, tileTypes, room), 1);
    for (let t = 0; t < COUNTDOWN_TICKS; t++) stepGame(game, [], world);
    const { audio, played, held } = recorder();
    const cues = new SoundCues(audio);
    cues.reset(room);
    return { game, world, cues, played, held };
  };
  const steps = (r: ReturnType<typeof round>, n: number, buttons: number[] = []) => {
    for (let t = 0; t < n; t++) {
      stepGame(r.game, buttons, r.world);
      r.cues.observe(r.game);
    }
  };
  const after = (r: ReturnType<typeof round>, from: number) => r.played.filter(([t]) => t >= from).map(([t, n]) => [t - from, n]);

  it("a door: up the stairs going in; out onto the TV on his first step down, with the GameCube's return sound", () => {
    const r = round(0, [{ x: 255.5, y: 200 }, { x: 100, y: 300 }]);
    const from = r.game.tick;
    let t = 0;
    while (r.game.battle!.fighters[0]!.move !== "warp" && t++ < 80) steps(r, 1, [Button.Up]);
    steps(r, 120);
    expect(after(r, from).filter(([, n]) => /STAIR|RET_GC|DOOR/.test(n as string))).toEqual([
      [t - 3, "JA_SE_OBJ_DOOR_OPEN"], // (pushed open from y 183: three steps of 1.5 px before the door takes him)
      [t, "JA_SE_LK_STAIR_GO_UP"], // (out into the house: its GBA's)
    ]);
    // Out again: down through the house's door.
    Object.assign(r.game.players[0]!, { x: 80 * SUBPX, y: (sideRoomY(2) + 112) * SUBPX, facing: "down" });
    const out = r.game.tick;
    t = 0;
    while (r.game.battle!.fighters[0]!.move !== "warp" && t++ < 40) steps(r, 1, [Button.Down]);
    steps(r, 120);
    expect(after(r, out).filter(([, n]) => /STAIR|RET_GC/.test(n as string))).toEqual([
      [t, "JA_SE_LK_STAIR_GO_DN"],
      [t + 71, "JA_SE_LK_STAIR_COME_DN"],
      [t + 71, "JA_SE_LK_RET_GC"],
    ]);
  });

  it("a hole: the fall's voice and the hole's own sound, no pit damage voice", () => {
    const r = round(4, [{ x: 248, y: 190 }, { x: 100, y: 300 }]);
    const from = r.game.tick;
    let t = 0;
    while (r.game.battle!.fighters[0]!.move !== "hole" && t++ < 40) steps(r, 1, [Button.Up]);
    steps(r, 100);
    const names = after(r, from).map(([, n]) => n);
    expect(names).toContain("JA_SE_LK_HALL_IN");
    expect(names).toContain("JA_SE_V_FALL_DOWN");
    expect(names).not.toContain("JA_SE_V_DAMAGE_M");
  });

  it("the giant-bomb Shadow Link: his coming, the bomb he makes, its landing", () => {
    const r = round(2, [{ x: 152, y: 184 }, { x: 360, y: 184 }]);
    setSwitch(r.game.battle!, 21, true);
    steps(r, 600);
    const names = r.played.map(([, n]) => n);
    expect(names.filter((n) => /SLINK|IBALL|ATTENTION/.test(n))).toEqual(["JA_SE_CHR_SLINK_APP_EFF_S", "JA_SE_CHR_SLINK_MAKEBOMB", "JA_SE_OBJ_IBALL_BOUND", "JA_SE_ATTENTION_PINCH"]);
    // Its fuse hisses while it burns (held), and stops with the blast.
    expect([...r.held.values()]).toEqual(["JA_SE_OBJ_DOUKASEN_SPARKBIG"]);
    steps(r, 600);
    expect([...r.held.values()]).toEqual([]);
  });

  it("Hyrule Castle's circle: its sound as it opens, its hum while open, the message window's attention sound at full size", () => {
    const r = round(3, [{ x: 200, y: 184 }, { x: 200, y: 280 }]);
    const b = r.game.battle!;
    setSwitch(b, 18, true);
    const from = r.game.tick;
    steps(r, 60);
    expect(after(r, from).filter(([, n]) => /SQUARE|ATTENTION/.test(n as string))).toEqual([
      [1, "JA_SE_MG_SQUARE_APP"],
      [8, "JA_SE_MG_SQUARE_APP"], // (a second circle of the castle's, on its own cycle)
      [50, "JA_SE_ATTENTION"], // ("You got 10 Dark World seconds!": the window's sound)
    ]);
    expect([...r.held.values()]).toContain("JA_SE_OBJ_MAGIC_SQUARE");
    r.cues.quiet(); // (paused)
    expect(r.held.size).toBe(0);
  });
});
