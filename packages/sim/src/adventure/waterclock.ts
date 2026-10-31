// The clock in a side view's water (main.dol, read; traced in Tingle's Tower room 3's underwater passage,
// `tingle-room3-passage`; docs/measurements/adventure-world1.md "The side view's water clock"):
// - each Link has his own (+0xBE4 ticks left, +0xBE8 running): it starts at 600 as he starts swimming in a side view
//   (state 75's entry, unless it's already running) and stops as he leaves that state (but for a knockback, 15/16);
//   it counts down while he swims, on a GBA screen only (on the TV it's held at 0);
// - the GBA screen shows the seconds left, rounded up (at most 20), by a clock icon (the HUD's data for the GBA
//   picture, 0x803085A4); in a group the followers show the leader's;
// - run out (0x8028FC2C), he goes back to the TV: when he came into the water by a whirlpool (state 39), to where he left
//   the TV (+0xCB0: the whirlpool's middle); else to the stage's own spot (a table by stage slot and room; Lake Hylia's
//   is room 6's whirlpool, (1960, 1000) in the world), or nowhere (Tingle's Tower has none: the clock stays at 0).
//   Going: 67 ticks floating up 0.1 px/tick facing up (state 48, sprites 556-561, a bubble at its 4th and 8th tick),
//   then on the TV spot 92 ticks facing down (state 49: two effects, 347 and 348, and sounds 0x20041 and 0x1000F at its
//   start; sprites 856-862), then swimming there (state 74). The others come along with the leader (traced: his
//   followers' own clocks never ran out; they swam on the TV a tick after him). No damage.
import { SUBPX } from "../player.ts";
import { enterArea, present, WHIRLPOOL_STYLE, type AdventureGame, type WarpTrip } from "./adventure.ts";
import { gatherOnLeader } from "./formation.ts";
import type { AdventureStage } from "./stage.ts";

/** The clock's start (ticks: 10 s). */
export const AIR_TICKS = 600;
/** The float up: its ticks and its rise per tick (1/256 px: 0.1). */
export const SURFACE_RISE_TICKS = 67;
export const SURFACE_RISE = 26;
/** On the TV spot before swimming on (state 49). */
export const SURFACE_SPOUT_TICKS = 92;
export const SURFACE_TICKS = SURFACE_RISE_TICKS + SURFACE_SPOUT_TICKS;
/** A stage's own spot (main.dol's table; the stage's index, AdventureState.stage): its room and that room's TV px. */
const STAGE_SURFACE: Readonly<Record<number, readonly [number, number, number]>> = { 10: [6, 424, 232] };

/** The seconds the clock shows (0: none). */
export function airSeconds(game: AdventureGame): number {
  const air = game.adventure.air;
  return air > 0 ? Math.min(20, Math.ceil(air / 60)) : 0;
}

/** The TV's whirlpool down into the current area, as where the Links left the TV (a start in the area: replay.ts). */
export function whirlpoolInto(game: AdventureGame, stage: AdventureStage): number[] {
  const a = game.adventure;
  const d = stage.area(a.room, 0).doors.find((d) => d.style === WHIRLPOOL_STYLE && d.to.area === a.area);
  return d ? [a.room, d.x + 8, d.y + 8] : [];
}

/** One tick of the leader's clock, after his move; true when it ran out and the way back started (a warp). */
export function stepWaterClock(game: AdventureGame): boolean {
  const a = game.adventure, m = a.links[0]!;
  if (a.area === 0 || m.mode !== "swim" || !m.side) {
    a.air = -1;
    return false;
  }
  if (a.air < 0) {
    a.air = AIR_TICKS;
    return false;
  }
  if (a.air === 0 || --a.air > 0) return false;
  const spot = a.surface.length ? a.surface : STAGE_SURFACE[a.stage];
  // (Another room's spot: the way there isn't done.)
  if (!spot || spot[0] !== a.room) return false;
  const p = game.players[0]!, x = Math.floor(p.x / SUBPX), y = Math.floor(p.y / SUBPX);
  a.warp = { area: 0, x: spot[1]! - 8, y: spot[2]! - 8, facing: "down", tick: 0, fromX: x - 8, fromY: y - 8, surface: true };
  return true;
}

/** The way back to the TV (WarpTrip.surface): floating up, then on the TV spot, then swimming there. */
export function stepSurfacing(game: AdventureGame, stage: AdventureStage, w: WarpTrip): void {
  const a = game.adventure, leader = game.players[0]!, t = w.tick;
  leader.action = "none";
  leader.moving = false;
  if (t <= SURFACE_RISE_TICKS) {
    leader.facing = "up";
    leader.y -= SURFACE_RISE;
  } else if (t === SURFACE_RISE_TICKS + 1) {
    for (const p of present(game)) {
      p.x = (w.x + 8) * SUBPX;
      p.y = (w.y + 8) * SUBPX;
      p.facing = w.facing;
    }
    enterArea(game, stage, a.room, 0, 0, 0);
    a.entryX = w.x + 8;
    a.entryY = w.y + 8;
    a.entryFacing = w.facing;
    a.landed = true;
    for (const m of a.links) Object.assign(m, { mode: "swim", side: false, speed: 0, dir: -1, tick: 0 });
  }
  gatherOnLeader(game);
  if (t >= SURFACE_TICKS) a.warp = null;
}

/** The leader's sprite on the way back (traced: state 48's 556-561 by its walk tick, state 49's 856-862 by its count). */
export function surfacingFrame(w: WarpTrip): number {
  const t = w.tick;
  if (t <= SURFACE_RISE_TICKS) return 556 + (t <= 4 ? 0 : t < 19 ? 1 : 2 + (Math.floor((t - 19) / 4) % 4));
  const left = SURFACE_TICKS - t;
  return left > 84 ? 856 + Math.trunc((90 - left) / 2) : 859 + (Math.floor((84 - left) / 6) % 4);
}
