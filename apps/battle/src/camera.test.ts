// The battle camera against Dolphin's (docs/measurements/battle-arenas.md "Battle measurements: arenas, orbs and camera"): room px,
// the zoom = 608 / the view's width.
import { describe, expect, it } from "vitest";
import { BattleCamera, cameraView, CAMERA_HOLD, type Point } from "./camera.ts";

const W = 512, H = 384, ASPECT = 608 / 448;
const view = (points: Point[]) => cameraView(new BattleCamera(points).box, W, H, ASPECT);
const zoom = (points: Point[]) => 608 / view(points).w;
const p = (x: number, y: number): Point => ({ x, y });

describe("battle camera", () => {
  it("frames the Links at a round's start as the game does in every arena (2 players)", () => {
    // The zoom on frame 0 of each ref/save-battle-<arena>-2p.sav, and its centre.
    expect(zoom([p(200, 280), p(312, 280)])).toBeCloseTo(2.1408, 3); // The Field
    expect(view([p(200, 280), p(312, 280)]).y).toBeCloseTo(279.37, 2); // (moved up inside the arena)
    expect(zoom([p(376, 232), p(136, 232)])).toBeCloseTo(1.4757, 3); // Tower of Flames
    expect(zoom([p(152, 184), p(360, 280)])).toBeCloseTo(1.6, 3); // Tower of Winds
    expect(zoom([p(200, 184), p(200, 280)])).toBeCloseTo(1.6716, 3); // Hyrule Castle
    expect(zoom([p(104, 312), p(392, 72)])).toBeCloseTo(1.1875, 4); // Above the Clouds: the arena's whole width
    expect(view([p(104, 312), p(392, 72)])).toMatchObject({ x: 256, y: 192 });
    // 3 and 4 players: the box around all of them.
    expect(zoom([p(312, 184), p(200, 184), p(312, 280)])).toBeCloseTo(1.6716, 3); // The Field, 3 players
    expect(view([p(312, 184), p(200, 184), p(312, 280)])).toMatchObject({ x: 256, y: 232 });
  });

  it("eases each edge a tenth of the way, the one with the farthest to go at most 3 px a frame (Hyrule Castle's FOCS)", () => {
    const links = [p(200, 184), p(200, 280)], focus = [p(176, 144), p(320, 144), p(176, 304), p(320, 304)];
    const camera = new BattleCamera(links);
    camera.step([...links, ...focus]); // (it acts a frame late)
    camera.step([...links, ...focus]);
    // Measured on the first frame of play: right +3 (120 to go), left -0.6, top -1, bottom +0.6.
    expect(camera.box.right).toBeCloseTo(203, 5);
    expect(camera.box.left).toBeCloseTo(199.4, 5);
    expect(camera.box.top).toBeCloseTo(183, 5);
    expect(camera.box.bottom).toBeCloseTo(280.6, 5);
    for (let f = 0; f < 120; f++) camera.step([...links, ...focus]);
    const v = cameraView(camera.box, W, H, ASPECT);
    // The castle's camera for good: centred on (248, 221), zoom 1.3742 (clipped at the arena's bottom).
    expect(v.x).toBeCloseTo(248, 1);
    expect(v.y).toBeCloseTo(221, 1);
    expect(608 / v.w).toBeCloseTo(1.3742, 3);
  });

  it("follows a Link walking out 15 px behind (1.5 px a frame), and comes back in 60 frames after, to 128 px outside him", () => {
    // The Field, 2 players: P2 walks right from 312 to 430.5, then back to 237 (measured: the edge 824.15, 824.43 …
    // on his first frames, still for 60 frames once he turns back, then eased to 128 px outside him: 877 - 512).
    const camera = new BattleCamera([p(200, 280), p(312, 280)]);
    let x = 312;
    const walk = (to: number) => {
      while (x !== to) {
        x += Math.sign(to - x) * Math.min(1.5, Math.abs(to - x));
        camera.step([p(200, 280), p(x, 280)]);
      }
    };
    x += 1.5;
    camera.step([p(200, 280), p(x, 280)]);
    expect(camera.box.right).toBe(312); // a frame late
    x += 1.5;
    camera.step([p(200, 280), p(x, 280)]);
    expect(camera.box.right).toBeCloseTo(312.15, 5);
    walk(430.5);
    expect(430.5 - camera.box.right).toBeCloseTo(15, 0);
    for (let f = 0; f < 60; f++) camera.step([p(200, 280), p(x, 280)]);
    walk(429); // (the camera still sees him where he was)
    const out = camera.box.right, back = [p(200, 280), p(237, 280)];
    for (let f = 0; f < CAMERA_HOLD; f++) camera.step(back); // back in at once: the edge holds for 60 frames…
    expect(camera.box.right).toBe(out);
    camera.step(back);
    expect(camera.box.right).toBeLessThan(out); // …then comes back in,
    for (let f = 0; f < 300; f++) camera.step(back);
    expect(camera.box.right).toBeCloseTo(237 + 128, 1); // to 128 px outside him
    expect(camera.box.left).toBe(200);
  });

  it("zooms in on the winner at a round's end: the box exact on the Links, then on him, the view at least 260 wide", () => {
    // The Field, 2 players (docs/measurements/screens.md "The round's end in Dolphin"): P1 (288.5, 280) knocked P2 (312, 280)
    // out; the box had held at 200 since the start. From BFIN + 1 its left edge comes in 3 px a frame (the view 281,
    // 278 … 260 px wide: zoom 2.1637 … 2.3385), then a tenth of the gap; once the winner poses, the right one too.
    const camera = new BattleCamera([p(200, 280), p(312, 280)]);
    const both = [p(288.5, 280), p(312, 280)];
    camera.step(both, true); // (a frame late)
    camera.step(both, true);
    expect(camera.box.left).toBeCloseTo(203, 5);
    expect(608 / cameraView(camera.box, W, H, ASPECT).w).toBeCloseTo(2.1637, 3);
    for (let f = 0; f < 7; f++) camera.step(both, true);
    expect(camera.box.left).toBeCloseTo(224, 5);
    expect(608 / cameraView(camera.box, W, H, ASPECT).w).toBeCloseTo(2.3385, 3);
    for (let f = 0; f < 12; f++) camera.step(both, true);
    expect(camera.box.left).toBeCloseTo(260, 5); // 3 px a frame to 260 (frame 240), then eased
    camera.step(both, true);
    expect(camera.box.left).toBeCloseTo(262.85, 2);
    for (let f = 0; f < 200; f++) camera.step([p(288.5, 280)], true);
    expect(camera.box.right).toBeCloseTo(288.5, 1);
    const v = cameraView(camera.box, W, H, ASPECT);
    expect([v.x, v.w]).toEqual([expect.closeTo(288.5, 1), 260]);
    expect(608 / v.w).toBeCloseTo(2.3385, 3);
  });
});
