import { describe, expect, it } from "vitest";
import { isFullyCharged, linkDisplayFrame, linkFrame, LUNGE_TICKS, SPIN_TICKS, stepLink, SWING_TICKS, swordHitbox } from "./actions.ts";
import { CHARGE, LUNGE, SPIN, STAB, SWING, SWORD_BOXES } from "./animations.ts";
import { cloneGame, createGame, stepGame } from "./game.ts";
import { Button, createPlayer, SUBPX, WALK_SPEED, type Facing, type PlayerState } from "./player.ts";
import type { World } from "./world.ts";

// Open 32×32-cell (256×256 px) world.
function openWorld(): World {
  const widthCells = 32, heightCells = 32, solid = new Uint8Array(widthCells * heightCells);
  return { widthCells, heightCells, solid, surface: new Uint8Array(solid.length), rooms: Int16Array.from([0]) };
}

const run = (p: PlayerState, world: World, buttons: number, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepLink(p, buttons, world);
};
const DIR: Record<Facing, number> = { right: Button.Right, left: Button.Left, down: Button.Down, up: Button.Up };

/** Frames shown on consecutive ticks, collapsed into [frame, ticks] runs. */
function runs(frames: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const f of frames) {
    if (out.at(-1)?.[0] === f) out.at(-1)![1]++;
    else out.push([f, 1]);
  }
  return out;
}

// Walking right for a while, then `buttons` on the press tick and `after` from the next tick on.
function walkThenPress(buttons: number, after: number, facing: Facing = "right") {
  const world = openWorld(), p = createPlayer(100, 100, facing);
  run(p, world, DIR[facing], 20);
  stepLink(p, buttons, world);
  return { world, p, after };
}

describe("sword actions (timings measured in Dolphin)", () => {
  it("swings while walking: the press tick still walks, then 8 ticks of 7 frames, walking again 10 ticks after the press", () => {
    const { world, p } = walkThenPress(Button.Right | Button.Sword, Button.Right);
    const x = p.x;
    expect(x).toBe(100 * SUBPX + 20 * WALK_SPEED); // 19 steps after the turn tick, plus the press tick's step
    const frames: number[] = [];
    for (let i = 0; i < SWING_TICKS; i++) {
      stepLink(p, Button.Right, world);
      expect(p.action).toBe("swing");
      expect(swordHitbox(p)).not.toBeNull();
      frames.push(linkFrame(p));
    }
    expect(p.x).toBe(x); // locked
    expect(runs(frames)).toEqual([[32, 1], [33, 1], [34, 1], [35, 2], [36, 1], [37, 1], [38, 1]]);
    stepLink(p, Button.Right, world); // press + 9: back to standing, the turn tick
    expect([p.action, p.x, linkFrame(p)]).toEqual(["none", x, 60]);
    stepLink(p, Button.Right, world); // press + 10: walking
    expect(p.x).toBe(x + WALK_SPEED);
  });

  it("swings when the stick is only pushed on the tick after the press, keeping the facing", () => {
    const world = openWorld(), p = createPlayer(100, 100, "right");
    run(p, world, Button.Right, 20);
    stepLink(p, Button.Sword, world); // stick released on the press tick: Link stops
    stepLink(p, Button.Up, world);
    expect([p.action, p.facing, linkFrame(p)]).toEqual(["swing", "right", SWING.frames.right[0]]);
  });

  it("stabs with the stick neutral, standing or walking", () => {
    for (const standing of [true, false]) {
      const world = openWorld(), p = createPlayer(100, 100, "down");
      if (!standing) run(p, world, Button.Down, 20);
      stepLink(p, Button.Sword, world);
      const frames: number[] = [];
      for (let i = 0; i < 8; i++) {
        stepLink(p, 0, world);
        frames.push(linkFrame(p));
      }
      expect(p.action).toBe("stab");
      expect(runs(frames)).toEqual([[602, 1], [603, 4], [604, 1], [605, 2]]);
      stepLink(p, 0, world);
      expect(p.action).toBe("none");
    }
    expect(STAB.frames.right).toEqual([594, 595, 596, 597]);
  });

  it("lunges from standing toward the stick pushed on the press tick or the next: 4 px/tick for 10 ticks, 31 ticks", () => {
    for (const [onPress, next] of [[Button.Sword | Button.Right, 0], [Button.Sword, Button.Right]]) {
      const world = openWorld(), p = createPlayer(100, 100, "down");
      stepLink(p, onPress!, world);
      const frames: number[] = [];
      for (let i = 0; i < LUNGE_TICKS; i++) {
        stepLink(p, i === 0 ? next! : 0, world);
        expect(p.action).toBe("lunge");
        frames.push(linkFrame(p));
      }
      expect(p.facing).toBe("right");
      expect(p.x).toBe(100 * SUBPX + 10 * LUNGE.speed);
      expect(runs(frames)).toEqual([[610, 6], [611, 1], [612, 1], [613, 1], [614, 2], [615, 20]]);
      stepLink(p, 0, world);
      expect(p.action).toBe("none");
    }
  });

  it("ignores presses during an attack", () => {
    const world = openWorld(), p = createPlayer(100, 100);
    stepLink(p, Button.Sword, world);
    run(p, world, 0, 3);
    stepLink(p, Button.Sword, world); // ignored
    run(p, world, 0, 5);
    expect(p.action).toBe("none");
    run(p, world, 0, 2);
    expect(p.action).toBe("none"); // nothing was buffered
    stepLink(p, Button.Sword, world);
    stepLink(p, 0, world);
    expect(p.action).toBe("stab");
  });

  it("charges while held; a release spins only after 56 held ticks counting the press", () => {
    for (const [held, spins] of [[55, false], [56, true]] as const) {
      const world = openWorld(), p = createPlayer(100, 100, "up");
      run(p, world, Button.Sword, held);
      expect(p.action).toBe("charge");
      expect(linkFrame(p)).toBe(CHARGE.stand.up);
      expect(isFullyCharged(p)).toBe(spins);
      // The sim keeps the normal sword frame; renderers flash the glowing one once a release would spin.
      expect([0, 4].map((t) => linkDisplayFrame(p, t))).toEqual(spins ? [CHARGE.stand.up + CHARGE.glowOffset, CHARGE.stand.up] : [CHARGE.stand.up, CHARGE.stand.up]);
      stepLink(p, 0, world); // the release tick still shows the charge
      expect(p.action).toBe("charge");
      stepLink(p, 0, world);
      expect(p.action).toBe(spins ? "spin" : "none");
    }
  });

  it("walks at 1.125 px/tick while charging, facing locked, through a 28-tick cycle", () => {
    const world = openWorld(), p = createPlayer(100, 100, "down");
    run(p, world, Button.Sword, 20);
    const frames: number[] = [];
    for (let i = 0; i < 28; i++) {
      stepLink(p, Button.Sword | Button.Up, world); // backward: same frames, facing kept
      frames.push(linkFrame(p));
    }
    expect([p.facing, p.y]).toEqual(["down", 100 * SUBPX - 28 * CHARGE.speed]);
    expect(runs(frames)).toEqual([[83, 3], [85, 2], [87, 4], [89, 4], [83, 4], [91, 2], [93, 4], [95, 4], [83, 1]]);
    stepLink(p, Button.Sword | Button.Up | Button.Right, world);
    expect(p.x).toBe(100 * SUBPX + CHARGE.speedDiagonal);
    expect(swordHitbox(p)).toBeNull(); // the held sword doesn't hit
  });

  it("spins for 26 ticks through the measured order, movement locked", () => {
    const world = openWorld(), p = createPlayer(100, 100, "right");
    run(p, world, Button.Sword, 60);
    run(p, world, 0, 2);
    const frames: number[] = [];
    while (p.action === "spin") {
      frames.push(linkFrame(p));
      expect(swordHitbox(p)).not.toBeNull();
      expect([p.x, p.y, p.facing]).toEqual([100 * SUBPX, 100 * SUBPX, "right"]);
      stepLink(p, Button.Left | (frames.length % 2 ? Button.Sword : 0), world); // movement locked, presses ignored
    }
    expect(frames.length).toBe(SPIN_TICKS);
    expect(runs(frames).map(([f]) => f)).toEqual(SPIN.frames.right);
    expect(runs(frames)[0]).toEqual([152, 2]);
    expect([p.action, p.facing, p.x]).toEqual(["none", "left", 100 * SUBPX]); // then a turn tick
  });

  it("offsets the frame's sword box by Link's position", () => {
    const world = openWorld(), p = createPlayer(50, 60, "left");
    stepLink(p, Button.Sword, world);
    expect(swordHitbox(p)).toBeNull(); // the press tick
    stepLink(p, 0, world);
    const [l, t, r, b] = SWORD_BOXES[STAB.frames.left[0]!]!;
    expect(swordHitbox(p)).toEqual({ left: 50 + l, top: 60 + t, right: 50 + r, bottom: 60 + b });
  });

  it("is deterministic and serializable", () => {
    const world = openWorld();
    const script = Array.from({ length: 600 }, (_, i) =>
      [Button.Sword, Button.Sword | Button.Up, Button.Sword | Button.Left, 0, Button.Right, Button.Right | Button.Sword, 0, Button.Sword][
        Math.floor(i / 40) % 8
      ]!,
    );
    const replay = () => {
      const game = createGame(world, [{ x: 100, y: 100 }]);
      return script.map((b) => JSON.stringify(cloneGame(stepGame(game, [b], world))));
    };
    const a = replay();
    expect(a).toEqual(replay());
    expect(new Set(a.map((s) => JSON.parse(s).players[0].action))).toEqual(new Set(["none", "stab", "swing", "lunge", "charge", "spin"]));
  });
});
