// A stage's room grid and its actors per room, with their anchors and params (optionally only some types):
//   node tools/census/src/roomactors.ts boss010 [PNPC,DOOR]   (its output names the game's types: keep it local)
import { readFileSync } from "node:fs";
import { actorPixel, decompressYaz0, parseRarc, Stage } from "@fso/formats";
const [stageId = "boss010", only = ""] = process.argv.slice(2);
const stage = new Stage(parseRarc(decompressYaz0(readFileSync(`extracted/files/GC4Sword_usa/Boss/${stageId}.arc`))));
console.log(stage.layout.rooms.map((r) => r.map((c) => (c === null ? "  ." : String(c).padStart(3))).join("")).join("\n"));
const keep = new Set(only.split(",").filter(Boolean));
for (const room of stage.roomNumbers) {
  const acts = stage.actors(room).filter((a) => !keep.size || keep.has(a.id));
  if (!acts.length) continue;
  console.log(`room ${room}:`, acts.map((a) => `${a.id}${a.sublayer ? `/${a.sublayer}` : ""}@${actorPixel(a).x},${actorPixel(a).y}:${a.params.toString(16)}`).join(" "));
}
