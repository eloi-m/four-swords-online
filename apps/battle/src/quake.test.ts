import { BIG_BOMB, BLAST_BOMBCHU, BLAST_GIANT, createBattle, spawnEntity, SUBPX } from "@fso/sim";
import { describe, expect, it } from "vitest";
import { QUAKE, quakeOffset } from "./quake.ts";

describe("screen quakes", () => {
  const game = () => createBattle(0, [{ x: 100, y: 100, facing: "down" }, { x: 200, y: 100, facing: "down" }], { hearts: 3, timeLimit: 0, wins: 3 });

  it("shake the TV up and down, the sign flipping every 2 ticks, 0.2 px weaker each tick (main.dol 0x802DD54C)", () => {
    const g = game(), b = g.battle!;
    expect(quakeOffset(g)).toBe(0);
    const blast = spawnEntity(b, "explosion", 100 * SUBPX, 100 * SUBPX, { phase: "active", param: BLAST_BOMBCHU, timer: 32 });
    g.tick = 0;
    expect(quakeOffset(g)).toBe(QUAKE.bombchu);
    g.tick = 2;
    blast.tick = 5;
    expect(quakeOffset(g)).toBeCloseTo(-(QUAKE.bombchu - 1));
    blast.tick = 19;
    expect(quakeOffset(g)).toBe(0); // under 0.2 px: still
    // The giant bomb's blast outshakes a bombchu's; its landing shakes 8, on through its squash into its burning.
    spawnEntity(b, "explosion", 100 * SUBPX, 100 * SUBPX, { phase: "active", param: BLAST_GIANT, timer: 32 });
    g.tick = 0;
    expect(quakeOffset(g)).toBe(QUAKE.giantBomb);
    const g2 = game();
    const bomb = spawnEntity(g2.battle!, "bigBomb", 100 * SUBPX, 100 * SUBPX, { param: BIG_BOMB.burning });
    bomb.tick = 5;
    g2.tick = 0;
    expect(quakeOffset(g2)).toBeCloseTo(QUAKE.giantBombLanding - 0.2 * 20);
  });
});
