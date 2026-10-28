import { describe, expect, it } from "vitest";
import { battleStateName, landingErrors, localPx, parseRecipe, traceArgs } from "./recipe.ts";

const base = { ports: ["gc"], frame: 345, script: "5 idle; 40 right; 300 idle", from: "ref/adv/room5-river.sav" };

describe("recipes", () => {
  it("parses a state's JSON, its pokes' trailing comments dropped", () => {
    const { recipe, problems } = parseRecipe({ ...base, tele: ["10:2304:828 (into the north part)"], write: ["5:8115A478:00210000 (room 3: switches)"] });
    expect(problems).toEqual([]);
    expect(recipe.tele).toEqual(["10:2304:828"]);
    expect(recipe.write).toEqual(["5:8115A478:00210000"]);
    expect(recipe.fill).toEqual([]);
  });

  it("says what an older state noted as free text", () => {
    const { problems } = parseRecipe({
      ...base,
      tele: "every 3rd frame 455..518 to world (768, 448)",
      write: ["16,61,106:812e710c (Shadow Link put above)"],
      pokes: "boss012.arc through world 0's stage slot 1",
    });
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/^tele noted as text/);
    expect(problems[1]).toMatch(/not --write's form/);
    expect(problems[2]).toMatch(/^pokes noted as text/);
  });

  it("wants a script, a frame and a parent", () => {
    expect(parseRecipe({ ports: ["gc"] }).problems).toEqual(["no parent state (from)", "no script", "no frame"]);
    expect(parseRecipe({ ...base, script: "5 jump" }).problems[0]).toMatch(/^script: unknown input token/);
  });

  it("replays to its frame as trace.ts arguments", () => {
    const { recipe } = parseRecipe({ ...base, ports: ["gba", "gba"], tele: ["10:1:2"] });
    expect(traceArgs(recipe, { save: "ref/x.sav" })).toEqual([
      "--savestate", "ref/adv/room5-river.sav", "--script", base.script, "--ports", "gba,gba", "--tail", "1", "--tele", "10:1:2", "--save", "345:ref/x.sav",
    ]);
    expect(traceArgs({ ...recipe, from: "boot" })[0]).toBe("--boot");
    expect(() => traceArgs({ ...recipe, frame: 100 })).toThrow(/inside the script/);
  });

  it("checks where the Links land", () => {
    const place = { links: [{ x: 1584.3, y: 728.3, screen: 0 }, { x: 10, y: 20, screen: 9 }] };
    expect(landingErrors(place, [{ x: 1584.5, y: 728.0, screen: 0 }, { x: 10, y: 20, screen: 9 }])).toEqual([]);
    expect(landingErrors(place, [{ x: 1486.6, y: 967, screen: 0 }, { x: 10, y: 20, screen: 0 }])).toEqual([
      "Link 1 at (1486.6, 967.0), not (1584.3, 728.3): 238.7 px off",
      "Link 2 on screen 0, not 9",
    ]);
    expect(landingErrors(place, [{ x: 1584.3, y: 728.3, screen: 0 }])).toEqual(["1 Links, the recipe says 2"]);
  });

  it("knows the battle round states and the rooms' px", () => {
    expect(battleStateName("ref/save-battle-field-2p.sav")).toEqual({ arena: "field", room: 0, players: 2 });
    expect(battleStateName("ref/save-battle-clouds-4p.sav")?.room).toBe(4);
    expect(battleStateName("ref/places/lake-room7.sav")).toBeNull();
    expect(localPx({ x: 1584.3, y: 728.3, screen: 0 }, { cx: 3, cy: 1 })).toEqual({ x: 1584.3 - 1536, y: 728.3 - 384 });
    expect(localPx({ x: 40, y: 50, screen: 12 }, { cx: 3, cy: 1 })).toEqual({ x: 40, y: 50 });
  });
});
