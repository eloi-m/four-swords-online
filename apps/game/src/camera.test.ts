// The adventure's TV camera (camera.ts) against Dolphin traces of Lake Hylia (the camera object's box, holds and zoom).
import { describe, expect, it } from "vitest";
import { AdventureCamera, boxView, FOCUS_MODE, PLAIN_MODE, targetBox, WHOLE_ROOM_TICKS, zoomOf, type Box, type CameraTargets, type Point } from "./camera.ts";

const room = (left: number, top: number): Box => ({ left, top, right: left + 512, bottom: top + 384 });
const targets = (leader: Point, focus: Point[] = [], wholeRoom = false): CameraTargets => ({ leader, focus, wholeRoom });
const run = (cam: AdventureCamera, t: CameraTargets, ticks: number) => {
  for (let n = 0; n < ticks; n++) cam.step(t);
};

describe("the adventure camera", () => {
  it("shows 284 × 209.3 px round the leader alone (zoom 2.1408), inside the room", () => {
    const r = room(2048, 1536), cam = new AdventureCamera();
    cam.enter(r, targets({ x: 2465.25, y: 1673.16 }), false);
    run(cam, targets({ x: 2465.25, y: 1673.16 }), 2);
    // Traced (ref/save-lake-hylia.sav, frame 0): the view 2276-2560 × 1568.53-1777.79.
    expect(cam.view.left).toBeCloseTo(2276, 2);
    expect(cam.view.right).toBeCloseTo(2560, 2);
    expect(cam.view.top).toBeCloseTo(1568.53, 1);
    expect(zoomOf(cam.view)).toBeCloseTo(2.1408, 4);
  });

  it("trails a walking leader by a fifth of the gap a tick", () => {
    const r = room(2048, 1536), cam = new AdventureCamera();
    cam.enter(r, targets({ x: 2465, y: 1673 }), false);
    run(cam, targets({ x: 2465, y: 1673 }), 2);
    let x = 2465;
    for (; x > 2400; x -= 1.5) cam.step(targets({ x, y: 1673 }));
    // The camera acts on the tick before's leader: 1.5 px a tick, eased 0.2, trails by 1.5 / 0.2 = 7.5 px.
    expect(cam.box!.left - (x + 1.5)).toBeCloseTo(7.5, 1);
  });

  it("frames Lake Hylia room 0's lit arrow signs with the leader (zoom 1.75)", () => {
    const r = room(2560, 1536), cam = new AdventureCamera();
    const arrows = [96, 144, 192, 240, 288].map((y) => ({ x: 2592, y: 1536 + y }));
    const leader = { x: 2622.1, y: 1730.2 };
    cam.enter(r, targets(leader), false);
    run(cam, targets(leader, arrows), 300);
    // Traced: the box 2622.1 × 1704-1752 (the signs pulled 72 px in), the view 2560-2907.4 × 1600-1856.
    expect(cam.box!.top).toBeCloseTo(1704, 3);
    expect(cam.box!.bottom).toBeCloseTo(1752, 3);
    expect(cam.view.left).toBe(2560);
    expect(cam.view.top).toBeCloseTo(1600, 3);
    expect(zoomOf(cam.view)).toBeCloseTo(1.75, 4);
    // The edges that went out hold (top, bottom: traced, the eased edge an ulp short of its place for good).
    expect(cam.holds[2]).toBe(240);
  });

  it("takes in room 3's doorway Shadow Link, its big gem and its key (zoom 1.514)", () => {
    // Dolphin: the leader at (280, 341) in the room, the camera centred on (296, 236) at zoom 1.514.
    const r = room(0, 0), view = boxView(targetBox(targets({ x: 280, y: 341 }, [{ x: 400, y: 120 }, { x: 136, y: 168 }, { x: 456, y: 200 }]), r, FOCUS_MODE), r, FOCUS_MODE);
    expect(zoomOf(view)).toBeCloseTo(1.514, 3);
    expect((view.left + view.right) / 2).toBeCloseTo(296, 0);
    expect((view.top + view.bottom) / 2).toBeCloseTo(236, 0);
  });

  it("pulls a focus point 72 px toward the box, not past it", () => {
    const r = room(0, 0), t = (x: number) => targetBox(targets({ x: 200, y: 200 }, [{ x, y: 200 }]), r, FOCUS_MODE);
    expect(t(150).left).toBe(200);
    expect(t(100).left).toBe(172);
    expect(t(400).right).toBe(328);
  });

  it("widens to room 9's captain and holds 240 ticks once he's gone, then comes back 1 px a tick", () => {
    const r = room(512, 768), cam = new AdventureCamera(), leader = { x: 954.5, y: 842 };
    cam.enter(r, targets(leader), false);
    run(cam, targets(leader, [{ x: 618, y: 1110 }]), 300);
    // Traced (ref/adv/room9.sav): the box settled on 690-954.5 × 842-1038, zoom 1.1979.
    expect(cam.box!.left).toBeCloseTo(690, 3);
    expect(cam.box!.bottom).toBeCloseTo(1038, 3);
    expect(zoomOf(cam.view)).toBeCloseTo(1.1979, 4);
    const held = cam.holds[0]!;
    run(cam, targets(leader), held + 1);
    expect(cam.box!.left).toBeCloseTo(690, 3);
    const before = cam.box!.left;
    cam.step(targets(leader));
    expect(cam.box!.left - before).toBeCloseTo(1, 3);
  });

  it("eases onto the whole room for a GBA-screen area over 70 ticks (zoom 1.1875) and back out slowly", () => {
    const r = room(1536, 1536), cam = new AdventureCamera(), leader = { x: 1920, y: 1657 };
    cam.enter(r, targets(leader), false);
    run(cam, targets(leader), 5);
    run(cam, targets(leader, [], true), WHOLE_ROOM_TICKS / 2);
    const half = zoomOf(cam.view);
    expect(half).toBeLessThan(2.1408);
    expect(half).toBeGreaterThan(1.1875);
    run(cam, targets(leader, [], true), WHOLE_ROOM_TICKS / 2 + 2);
    // Traced (ref/adv/room2-cave5.sav): the box the room less 104 px a side, the view 1536-2048 × 1539.37-1916.63.
    for (const [k, v] of Object.entries({ left: 1640, top: 1640, right: 1944, bottom: 1816 })) expect(cam.box![k as keyof Box]).toBeCloseTo(v, 2);
    expect(cam.view.top).toBeCloseTo(1539.37, 2);
    expect(zoomOf(cam.view)).toBeCloseTo(1.1875, 4);
    // Out again: the box comes back in at most 1 px a tick (traced: 1749 → 1759 in 10 frames).
    run(cam, targets(leader), 1);
    const out = cam.box!.left;
    run(cam, targets(leader), 10);
    expect(cam.box!.left - out).toBeCloseTo(10, 3);
  });

  it("pans to a new room over 30 ticks after 2, then starts over round the leader", () => {
    const cam = new AdventureCamera(), leader = { x: 2465, y: 1820 };
    cam.enter(room(2048, 1536), targets(leader), false);
    run(cam, targets(leader), 3);
    const from = cam.view.left;
    const next = { x: 2600, y: 1820 };
    cam.enter(room(2560, 1536), targets(next), true);
    run(cam, targets(next), 2);
    expect(cam.view.left).toBe(from);
    run(cam, targets(next), 15);
    expect(cam.view.left).toBeGreaterThan(from);
    expect(cam.view.left).toBeLessThan(2560);
    run(cam, targets(next), 20);
    expect(cam.view.left).toBe(2560);
    expect(cam.box).toEqual({ left: 2600, top: 1820, right: 2600, bottom: 1820 });
    expect(PLAIN_MODE.minHalf * 2).toBe(284);
  });
});
