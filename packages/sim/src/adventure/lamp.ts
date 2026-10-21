// The lamp (item 2) and what it lights: the Cave of No Return's candle switches (LWSW) and the torches (TRCH) that
// show their switches. Measured in Dolphin (docs/measurements/adventure-world1.md "Adventure: the Cave of No Return"):
// - the lamp lies on a pedestal (tile 0x017, its glow a TRCH of kind 1): the Action button facing it gives it, to all
//   four Links (gear.ts takeFromPedestal, PEDESTAL_ITEMS), with "You got a lamp!…" (message 0xDD, two pages);
// - the Item button (the GC's A) with the lamp: state 72 the next tick for 9 ticks (player_sob 866 + 2 × facing:
//   the first frame 2 ticks, the second 4, the first again 3), the leader standing; a candle switch in front of him
//   lights (its flame shows ~15 ticks later) and stays lit: its switch is on (room 6's two open the way north).
// From main.dol:
// - LWSW (init 0x802BED94, update 0x802BE9E0): switch = the params' top 5 bits, (p >> 22) & 31 a mode (1: goes out
//   after p & 0xFFF frames), box ±10 px round its anchor + (8, 8); it lights when a Link's fire box (+0x550, while his
//   +0xB1C ≥ 0: the lamp's flame) or a Fire Rod fireball ('FIRE') meets it, and only on its candle tiles (0x3D, 0x1DE).
// - TRCH (init 0x802B11D0, update 0x802B0F9C): kind p & 0x7F, switch the top 5 bits: lit while its switch is on (or
//   without one); kinds 0 and 2 light 70 px round them, the others 20 (the darkness: apps/game).
// TODO(measure): the lamp's flame box (here 16 px ahead, ±8), burning bushes and enemies with it, LWSW mode 1.
import { FACING_STEP } from "../entities.ts";
import { Button, SUBPX, type Facing } from "../player.ts";
import { setSwitch, switchOn } from "../switches.ts";
import { currentArea, type AdventureGame } from "./adventure.ts";
import type { AdventureStage, AreaActor } from "./stage.ts";

/** Ticks of the lamp's pose (state 72 the tick after the press, 9 ticks), and its frames' ticks. */
export const LAMP_POSE_TICKS = 10;
const LAMP_FRAMES: readonly number[] = [0, 0, 0, 1, 1, 1, 1, 0, 0, 0];
/** The flame's box: this far ahead of the Link, this half size (px). TODO(measure). */
export const LAMP_REACH = 16;
export const LAMP_HALF = 8;
/** A candle switch's box: ±10 px round its anchor + (8, 8) (LWSW init). */
export const CANDLE_HALF = 10;
/** The candle tiles a candle switch lights on (LWSW update). */
export const CANDLE_TILES: ReadonlySet<number> = new Set([0x3d, 0x1de]);

/** The Item button with the lamp: the pose starts (true: the tick is the pose's). Uses AdventureState.pose. */
export function useLamp(game: AdventureGame, buttons: number): boolean {
  const a = game.adventure, p = game.players[0]!, f = game.battle.fighters[0]!;
  if (a.gear !== "lamp" || a.pose > 0 || !(buttons & ~p.held & Button.Item) || f.mode !== "active" || f.move !== "none" || p.action !== "none") return false;
  a.pose = 1;
  p.moving = false;
  p.walkTicks = 0;
  p.held = buttons;
  return true;
}

/** The lamp's pose, one tick (true while it lasts: the leader stands); its flame lights the candles it meets. */
export function stepLampPose(game: AdventureGame, stage: AdventureStage, buttons: number): boolean {
  const a = game.adventure, p = game.players[0]!;
  if (a.pose <= 0 || a.gear !== "lamp") return false;
  p.held = buttons;
  const [sx, sy] = FACING_STEP[p.facing];
  const fx = p.x / SUBPX + sx * LAMP_REACH, fy = p.y / SUBPX + sy * LAMP_REACH;
  for (const c of candles(game, stage)) {
    if (Math.abs(c.x + 8 - fx) <= CANDLE_HALF + LAMP_HALF && Math.abs(c.y + 8 - fy) <= CANDLE_HALF + LAMP_HALF) setSwitch(game.battle, c.params >>> 27, true);
  }
  if (++a.pose > LAMP_POSE_TICKS) a.pose = 0;
  return true;
}

/** The lamp's pose frame, or -1: player_sob 866-873, two per facing (right, left, down, up). */
export function lampPoseFrame(game: AdventureGame): number {
  const a = game.adventure;
  if (a.pose <= 0 || a.gear !== "lamp") return -1;
  const base = 866 + 2 * (["right", "left", "down", "up"] as Facing[]).indexOf(game.players[0]!.facing);
  return base + LAMP_FRAMES[Math.min(a.pose - 1, LAMP_FRAMES.length - 1)]!;
}

/** The current area's candle switches (LWSW) still on their candle tiles. */
export function candles(game: AdventureGame, stage: AdventureStage): AreaActor[] {
  const area = currentArea(game, stage);
  return area.actors.filter((a) => a.id === "LWSW" && CANDLE_TILES.has(area.base ? area.base[(a.y >> 4) * 32 + (a.x >> 4)]! & 0x3ff : 0));
}

/** Whether a torch (TRCH) burns: without a switch, or while it's on. */
export function torchLit(game: AdventureGame, torch: AreaActor): boolean {
  const own = torch.params >>> 27;
  return own === 0 || switchOn(game.battle, own);
}

/** How far a lit torch lights (px): kinds 0 and 2 70, the others 20 (TRCH init). */
export function torchRadius(torch: AreaActor): number {
  const kind = torch.params & 0x7f;
  return kind === 0 || kind === 2 ? 70 : 20;
}
