import { describe, expect, it } from "vitest";
import { FSA_QUEUED_PARTICLES, fsaActorParticles, fsaJetParticle, fsaLayerOffset, fsaMoveParticle, fsaParticleGroup, fsaParticlePlacement } from "./particles.ts";

describe("FSA particle placement (createEffect 0x8013CC50)", () => {
  it("maps effect ids to createEffect's draw groups", () => {
    const groups = (ids: number[]) => ids.map(fsaParticleGroup);
    expect(groups([0, 215, 216, 233, 234, 294, 295, 299, 300, 391, 392, 397])).toEqual([0, 0, 10, 10, 0, 0, 3, 3, 0, 0, 3, 3]);
    expect(groups([398, 475, 476, 508, 509, 576, 577, 578, 617, 618, 619, 630, 631, 637, 638, 680, 681])).toEqual([0, 0, 10, 10, 0, 0, 4, 0, 0, 7, 0, 0, 7, 7, 0, 3, 0]);
    expect(groups([836, 837, 860, 861, 900, 901, 902, 934, 935, 947])).toEqual([0, 255, 255, 0, 0, 9, 0, 0, 7, 7]);
    expect(groups([948, 989, 1003, 1004, 1011, 1012, 1165, 1166, 1173, 1174, 1231, 1233, 1234, 1248, 1249, 1250, 1346])).toEqual([0, 4, 0, 10, 10, 0, 0, 2, 2, 0, 4, 4, 0, 3, 3, 0, 0]);
    expect(groups([1347, 1348, 1349, 1354, 1355, 1356, 1357, 1358, 1367, 1368, 1374, 1375, 1381, 1382, 1384, 1385, 1393])).toEqual([5, 5, 0, 0, 5, 0, 255, 0, 0, 2, 2, 0, 0, 8, 8, 2, 2]);
    expect(FSA_QUEUED_PARTICLES.every((id) => fsaParticleGroup(id) === 255)).toBe(true);
    expect(FSA_QUEUED_PARTICLES.length).toBe(25);
  });

  it("swaps Y and Z for the world groups and pushes layers in front", () => {
    // A bomb's explosion (89): layer 1, sublayer 1 → y and z + 1152.
    expect(fsaParticlePlacement(89, 100, 200, 0, { layer: 1, sublayer: 1, scale: 2 })).toEqual({
      id: 89,
      group: 0,
      translation: [100, 1352, 1152],
      rotation: "swapYZ",
      dynamicsScale: [2, 1.414214, 1.414214],
      particleScale: [2, 2],
      queued: false,
    });
    // An unrotated group (577 → 4) scales evenly.
    expect(fsaParticlePlacement(577, 0, 0, 0, { scale: 0.5 })).toMatchObject({ group: 4, rotation: "none", dynamicsScale: [0.5, 0.5, 0.5] });
    // Nothing for a scale of 0.
    expect(fsaParticlePlacement(89, 0, 0, 0, { scale: 0 })).toBeNull();
    // The screen-distortion flag moves an effect to group 1.
    expect(fsaParticlePlacement(1350, 0, 0, 0, { userFlags: 2 })?.group).toBe(1);
  });

  it("queues resident effects and lifts effects off the ground", () => {
    expect(fsaParticlePlacement(845, 10, 20, 0)).toMatchObject({ queued: true, group: 255, translation: [10, 20, 0] });
    // Up in the air, layer 0 becomes layer 1 with sublayer −1: 1024 − 128.
    expect(fsaLayerOffset(5, 0, 0, true)).toBe(896);
    expect(fsaLayerOffset(5, 0, 0, false)).toBe(0);
    expect(fsaLayerOffset(5, 1, 1, true)).toBe(1152);
    // The fire-pit jets as their emitters are in RAM at a round's start (Tower of Flames, the right-pointing one).
    const jet = fsaJetParticle(0x58000001, "idle");
    const placed = fsaParticlePlacement(jet.id, 768 + jet.dx, 576 + jet.dy, 0, jet)!;
    expect([placed.id, ...placed.translation, ...placed.dynamicsScale.map((v) => Math.round(v * 1000) / 1000), ...jet.rotation!]).toEqual([430, 771, 1728, 1152, 1, 0.707, 0.707, 0, 0xc000, 0x8000]);
    const p = fsaParticlePlacement(102, 0, 0, 0)!;
    expect(fsaMoveParticle(p, 3, 4, 8).translation).toEqual([3, 900, 904]);
  });

  it("places the whirlpool's and the waterfall foot's effects as they are in RAM (Lake Hylia room 6)", () => {
    // Room 6 at stage cell (3, 2): its WARP (416, 224), style 0x0E, has 1262 at (1960, 1000, 0) and 1363 at
    // (1960, 872, −128); its PRTC (320, 112), kind 0, has 392-394 only, at (1856, 1904, 1024).
    const placed = (actor: string, params: number, x: number, y: number) =>
      fsaActorParticles(actor, params, { x, y }).map((p) => [p.id, ...fsaParticlePlacement(p.id, 1536 + x + p.dx, 768 + y + p.dy, 0, p)!.translation]);
    expect(placed("WARP", 0x05220e0e, 416, 224)).toEqual([
      [1363, 1960, 872, -128],
      [1262, 1960, 1000, 0],
    ]);
    expect(placed("PRTC", 0, 320, 112)).toEqual([392, 393, 394].map((id) => [id, 1856, 1904, 1024]));
    // Kind 2 is the ripple; a door's WARP makes nothing; a PRTC with params bits 20-23 makes nothing at init.
    expect(fsaActorParticles("PRTC", 2).map((p) => p.id)).toEqual([1362]);
    expect(fsaActorParticles("WARP", 0x02171019, { x: 392, y: 96 })).toEqual([]);
    expect(fsaActorParticles("PRTC", 0x80110003)).toEqual([]);
  });
});
