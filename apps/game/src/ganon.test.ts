// Phantom Ganon's appearance as the view draws it (main.dol, measurements/adventure-world1.md "His appearance's
// scene"): the bars and the special focus in his states 1-5, the scene's colour from his state 5 on.
import type { AdventureGame, Ganon } from "@fso/sim/adventure";
import { describe, expect, it } from "vitest";
import { ganonScene } from "./camera.ts";
import { GANON_TINT, sceneTint } from "./ganon.ts";

const game = (ganon: Partial<Ganon> | null, area = 0) => ({ adventure: { area, ganon } }) as unknown as AdventureGame;

describe("Phantom Ganon's appearance", () => {
  it("asks for the bars and the camera from the take (state 1) to the scene's end (state 5)", () => {
    expect([0, 1, 3, 5, 6, 7].map((state) => ganonScene(game({ state, gone: false })))).toEqual([false, true, true, true, false, false]);
    expect(ganonScene(game(null))).toBe(false);
  });

  it("leaves the scene white till his state 5 eases it to (159, 127, 255), kept from then on", () => {
    expect(sceneTint(game({ state: 3 }))).toEqual([255, 255, 255]);
    expect(sceneTint(game({ state: 5, c250: 201, c254: 168 }))).toEqual([201, 168, 255]);
    expect(sceneTint(game({ state: 7, c250: 12, c254: 40 }))).toEqual(GANON_TINT);
    expect(sceneTint(game({ state: 24, gone: true }))).toEqual(GANON_TINT);
    expect(sceneTint(game({ state: 7 }, 2))).toEqual([255, 255, 255]);
    expect(sceneTint(game(null))).toEqual([255, 255, 255]);
  });
});
