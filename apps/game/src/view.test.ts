// The static actors' depth (view.ts staticsZ): placed at world y, they sort with the Links by their y in the room.
import { describe, expect, it } from "vitest";
import { staticsZ } from "./view.ts";

describe("staticsZ", () => {
  it("sorts a static in a lower room against the Links by its y in the room", () => {
    // Lake Hylia room 3 (cell row 3, origin y 1152): its doorway figure at y 112, a Link below it at 119 (2 + y / 1024).
    const figure = staticsZ({ y: 1152 }) + (1152 + 112) / 1024, link = 2 + 119 / 1024;
    expect(figure).toBeCloseTo(2 + 112 / 1024, 9);
    expect(figure).toBeLessThan(link);
    // Under the top layer (3) and the cloud shadows (2.9), wherever the room is.
    expect(staticsZ({ y: 9 * 384 }) + (9 * 384 + 383) / 1024).toBeLessThan(2.9);
  });
});
