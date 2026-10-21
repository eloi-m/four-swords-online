// The adventure's sound cues (sound.ts AdventureCues) on Lake Hylia played by its scripted route from the start to the
// goal, tick by tick: the stage's BGM, the sword, enemies struck and beaten, Force Gems, the chest, the key and its
// door, switches, bushes, the water, the message box and the fanfare all play, and nothing twice for a state seen
// again. Also World 1's stage BGM from main.dol's table. Skipped when extracted/ is absent (e.g. in CI).
import { existsSync, readFileSync } from "node:fs";
import { bgmList, INIT_FILE, loadAudioInit, readStageBgmTable } from "@fso/audio";
import { decompressYaz0, Dol, isYaz0, loadActorTypes, parseBmg, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { actorStats, AdventureStage, createAdventure, LAKE_HYLIA_MILESTONES, messageBook, playedAlone, RoutePlayer, stepAdventure } from "@fso/sim/adventure";
import { describe, expect, it } from "vitest";
import { AdventureCues, CLEAR_BGM, type AdventureAudio } from "./sound.ts";

const root = new URL("../../../extracted/", import.meta.url);
const present = existsSync(new URL("sys/main.dol", root));
const file = (path: string) => readFileSync(new URL(`files/GC4Sword_usa/${path}`, root));
const archive = (path: string) => {
  const bytes = file(path);
  return parseRarc(isYaz0(bytes) ? decompressYaz0(bytes) : bytes);
};

/** A stand-in for the synth: the effects and BGM asked for, on which tick. */
function recorder(): { audio: AdventureAudio; played: [number, string][]; music: string[] } {
  const played: [number, string][] = [], music: string[] = [];
  const audio = {
    playSe: (names: readonly string[], tick: number) => names.forEach((n) => played.push([tick, n])),
    playBgm: (name: string | null) => music.push(name ?? "stop"),
  };
  return { audio: audio as unknown as AdventureAudio, played, music };
}

describe.skipIf(!present)("real disc: the adventure's sounds", () => {
  const dol = present ? new Dol(readFileSync(new URL("sys/main.dol", root))) : null!;

  it("World 1's stage BGM (map CSV bgmId → main.dol's table)", () => {
    const init = loadAudioInit(file(INIT_FILE.replace(/^GC4Sword_usa\//, "")));
    const table = readStageBgmTable(dol), bgm = bgmList(init, new Map());
    const names = ["boss010", "boss011", "boss012", "boss013"].map((id) => bgm.find((b) => b.id === table[new Stage(archive(`Boss/${id}.arc`)).layout.bgmId])?.name);
    expect(names).toEqual(["JA_BGM_WATER_FIELD", "JA_BGM_DANGEON", "JA_BGM_WATER_FIELD", "JA_BGM_CHIJOU"]);
  });

  it("Lake Hylia by its route: every kind of cue, none twice", { timeout: 120_000 }, () => {
    const stage = new AdventureStage(playedAlone(new Stage(archive("Boss/boss010.arc"))), readTileTypes(dol), actorStats(loadActorTypes(archive("data.arc"))!));
    const bmg = archive("msgus.arc").files.find((f) => f.path.endsWith("_e.bmg"))!.data;
    stage.messages = messageBook(parseBmg(isYaz0(bmg) ? decompressYaz0(bmg) : bmg));
    const game = createAdventure(stage, { players: 4 });
    const { audio, played, music } = recorder();
    const cues = new AdventureCues(audio, stage, "JA_BGM_WATER_FIELD");
    cues.observe(game);
    for (const m of LAKE_HYLIA_MILESTONES) {
      const player = new RoutePlayer(m.goals);
      for (;;) {
        const buttons = player.next(game, stage);
        if (player.done) break;
        stepAdventure(game, [buttons], stage);
        cues.observe(game);
        // Seen again (a frame drawn twice): nothing more.
        const count = played.length;
        cues.observe(game);
        expect(played.slice(count)).toEqual([]);
      }
    }
    expect(game.adventure.cleared).toBeGreaterThan(0);
    const count = (name: string) => played.filter(([, n]) => n === name).length;
    const summary = [...new Set(played.map(([, n]) => n))].map((n) => `${n.replace(/^JA_SE_/, "")}×${count(n)}`).join(" ");
    console.log(`Lake Hylia's cues: ${summary}; music ${music.join(" → ")}`);
    for (const name of [
      "JA_SE_LK_SWORD_WIELD",
      "JA_SE_CHR_ENEMY_DAMAGE",
      "JA_SE_CHR_ENEMY_DOWN",
      "JA_SE_LK_COIN",
      "JA_SE_OBJ_TBOX_OPEN",
      "JA_SE_LK_NORM_ITEM_GET",
      "JA_SE_OBJ_DOOR_OPEN",
      "JA_SE_OBJ_SWITCH",
      "JA_SE_OBJ_CUT_GRASS",
      "JA_SE_LK_PLUNGE",
    ])
      expect(count(name), name).toBeGreaterThan(0);
    expect(music[0]).toBe("JA_BGM_WATER_FIELD");
    expect(music.at(-1)).toBe(CLEAR_BGM);
  });
});
