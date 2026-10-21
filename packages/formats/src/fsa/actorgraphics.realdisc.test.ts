// Actor graphics against the real disc: every main.dol value the mapping relies on, and every frame it draws in Lake
// Hylia and the Shadow Battle arenas. Skipped when extracted/ is absent.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dataView } from "../bytes.ts";
import { Dol } from "../dol.ts";
import { parseRarc } from "../rarc.ts";
import { decompressYaz0 } from "../yaz0.ts";
import { ACTOR_LOOKS, ACTOR_SOB_FILES, actorPieces, JIJI_DIRECTIONS, JIJI_DOWN, type ActorSob, type CodeFact } from "./actorgraphics.ts";
import { loadSob, loadSpriteSheet, spriteBounds, type SpriteFrame } from "./sprites.ts";
import { Stage } from "./stage.ts";

const root = new URL("../../../../extracted/files/GC4Sword_usa/", import.meta.url);
const sys = new URL("../../../../extracted/sys/", import.meta.url);
const present = existsSync(root) && existsSync(new URL("main.dol", sys));

describe.skipIf(!present)("real disc: actor graphics", () => {
  const dol = present ? new Dol(readFileSync(new URL("main.dol", sys))) : null!;
  const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(path, root))));

  function check(fact: CodeFact): unknown[] {
    if ("imm" in fact) {
      const word = dataView(dol.read(fact.at, 4)).getUint32(0);
      const opcode = word >>> 26;
      // li/addi (14), addic (12), cmpwi (11), mulli (7): a signed 16-bit immediate in the low half.
      expect([7, 11, 12, 14], `opcode at 0x${fact.at.toString(16)}`).toContain(opcode);
      return [(word << 16) >> 16, fact.imm];
    }
    if ("ascii" in fact) return [new TextDecoder().decode(dol.read(fact.at, fact.ascii.length)), fact.ascii];
    const [values, size, get] =
      "u32" in fact ? [fact.u32, 4, (v: DataView, o: number) => v.getUint32(o)] as const
      : "u16" in fact ? [fact.u16, 2, (v: DataView, o: number) => v.getUint16(o)] as const
      : [fact.f32, 4, (v: DataView, o: number) => v.getFloat32(o)] as const;
    const view = dataView(dol.read(fact.at, values.length * size));
    return [values.map((_, i) => get(view, i * size)), [...values]];
  }

  it("every code fact matches main.dol", () => {
    let n = 0;
    for (const [id, look] of Object.entries(ACTOR_LOOKS)) {
      for (const fact of look.facts ?? []) {
        const [actual, expected] = check(fact);
        expect(actual, `${id} @0x${fact.at.toString(16)}`).toEqual(expected);
        n++;
      }
    }
    expect(n).toBeGreaterThan(40);
  });

  it("JIJI's facing-down offsets are column 2 of its direction table", () => {
    const view = dataView(dol.read(JIJI_DIRECTIONS, JIJI_DOWN.length * 16));
    expect(JIJI_DOWN.map((_, row) => view.getUint32(row * 16 + 8))).toEqual(JIJI_DOWN);
  });

  it("every piece in Lake Hylia, Hyrule Castle and the Shadow Battle arenas is a drawable frame or a stage texture", () => {
    const data = load("data.arc");
    const sobs = Object.fromEntries(Object.entries(ACTOR_SOB_FILES).map(([k, f]) => [k, loadSob(data, f)])) as Record<ActorSob, SpriteFrame[]>;
    const counts = { sprites: 0, textures: 0, actors: 0 };
    for (const name of ["boss010", "boss013", "boss500"]) {
      const stage = new Stage(load(`Boss/${name}.arc`));
      const sheet = loadSpriteSheet(data, stage.layout.npcSheetId);
      for (const room of stage.roomNumbers) {
        for (const actor of stage.actors(room)) {
          const pieces = actorPieces(actor);
          if (pieces.length) counts.actors++;
          for (const piece of pieces) {
            const where = `${name} room ${room} ${actor.id} ${actor.params.toString(16)}`;
            if (piece.kind === "bti") {
              expect((piece.archive === "data" ? data : stage.archive).files.some((f) => f.path === `timg/${piece.file}`), where).toBe(true);
              counts.textures++;
              continue;
            }
            const frame = sobs[piece.sob][piece.frame];
            expect(frame, `${where}: ${piece.sob} ${piece.frame}`).toBeDefined();
            expect(spriteBounds(sheet, frame!), `${where}: ${piece.sob} ${piece.frame} is empty`).not.toBeNull();
            counts.sprites++;
          }
        }
      }
    }
    expect(counts.actors).toBeGreaterThan(300);
    expect(counts.textures).toBe(2); // RCK3, PSWB
  });
});
