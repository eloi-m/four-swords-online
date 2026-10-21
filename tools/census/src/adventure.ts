// Inventory of the Hyrulean Adventure stages (boss0WS, worlds 1-8, stages 0-3): per stage its name (the game's own
// message 1 + 4 (W - 1) + S), rooms, tileset, overlay and BGM, start room, actors; then every actor type with its count
// over all of them (TV and GBA-screen sublayers), whether enemyparam.csv calls it an enemy (dstr), and how far
// apps/game draws it (packages/formats actorgraphics.ts). The output stays local (it names the game's types and
// messages): docs/ADVENTURE.md summarizes it.
//   node tools/census/src/adventure.ts [extracted] [--types] [--stage boss010]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { actorLook, bmgPlainText, decompressYaz0, loadActorTypes, parseBmg, parseRarc, Stage, type RarcArchive } from "@fso/formats";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const extracted = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--stage")) ?? "extracted";
const root = join(extracted, "files/GC4Sword_usa");
const load = (path: string): RarcArchive => parseRarc(decompressYaz0(readFileSync(join(root, path))));

const data = load("data.arc");
const types = loadActorTypes(data)!;
const msg = parseBmg(load("msgus.arc").files.find((f) => f.path.endsWith("_e.bmg"))!.data);
const stageName = (w: number, s: number) => bmgPlainText(msg.messages[(w - 1) * 4 + s]!).replace(/\n/g, " ");

interface Count {
  tv: number;
  gba: number;
  stages: Set<string>;
}
const counts = new Map<string, Count>();
const only = option("--stage");

console.log("| Stage | Name | Rooms | Tileset | Overlay | BGM | Start (cell → room) | TV actors | GBA actors | Types |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
for (let w = 1; w <= 8; w++) {
  for (let s = 0; s <= 3; s++) {
    const id = `boss0${w}${s}`;
    if (only && only !== id) continue;
    let stage: Stage;
    try {
      stage = new Stage(load(`Boss/${id}.arc`));
    } catch {
      continue;
    }
    const L = stage.layout;
    let tv = 0, gba = 0;
    const kinds = new Set<string>();
    for (const room of stage.roomNumbers) {
      for (const a of stage.actors(room)) {
        if (a.sublayer === 0) tv++;
        else gba++;
        kinds.add(a.id);
        const c = counts.get(a.id) ?? { tv: 0, gba: 0, stages: new Set() };
        if (a.sublayer === 0) c.tv++;
        else c.gba++;
        c.stages.add(id);
        counts.set(a.id, c);
      }
    }
    const start = L.rooms[L.startY]?.[L.startX];
    const enemies = flag("--enemies")
      ? " " +
        [...kinds]
          .filter((k) => types.get(k)?.stats.dstr === 1)
          .map((k) => `${k}${actorLook(k) ? "*" : ""}`)
          .join(" ") +
        " |"
      : "";
    console.log(
      `| ${id} | ${stageName(w, s)} | ${stage.roomNumbers.length} | ${L.tilesetIndex} | ${L.overlayTextureId} | ${L.bgmId} | (${L.startX},${L.startY}) → ${start ?? "NULL"} | ${tv} | ${gba} | ${kinds.size} |${enemies}`,
    );
  }
}

if (flag("--types")) {
  console.log("\n| Type | TV | GBA | Stages | enemy (dstr) | life | atcp | Look | Confidence |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  const sorted = [...counts].sort((a, b) => b[1].tv + b[1].gba - (a[1].tv + a[1].gba));
  for (const [id, c] of sorted) {
    const t = types.get(id), look = actorLook(id);
    console.log(
      `| ${id} | ${c.tv} | ${c.gba} | ${c.stages.size} | ${t?.stats.dstr ?? ""} | ${t?.stats.life ?? ""} | ${t?.stats.atcp ?? ""} | ${look?.draw ?? "-"} | ${look?.confidence ?? ""} |`,
    );
  }
}
