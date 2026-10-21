// Room changes, as measured in Dolphin (docs/measurements/walking-and-sword.md): once the leader gets within ROOM_EDGE px of a room side
// with a room beyond it, the camera switches to that room and Link walks on by himself, ignoring input, for
// ROOM_WALK_TICKS ticks, stands still for one more, then control resumes.
import { SUBPX, WALK_FRAME_TICKS, type PlayerState } from "./player.ts";
import { MAP_GRID } from "@fso/formats";
import { ROOM_H, ROOM_W, type World } from "./world.ts";

export const ROOM_EDGE = 20; // px from the side that triggers the change
export const ROOM_WALK_TICKS = 25;
export const ROOM_LOCK_TICKS = ROOM_WALK_TICKS + 1;
// Auto-walk speed per tick: (distance to the side + 56 px) / 32. Fits the three transitions traced to 0.001 px; the
// walk ends about 39.5 px inside the new room.
export const ROOM_WALK_LEAD = 56;
export const ROOM_WALK_DIVISOR = 32;
export const ROOM_WALK_FRAME_TICKS = 2; // the walk cycle restarts and runs faster during the auto-walk

export interface RoomTransition {
  room: number;
  dx: number; // -1, 0, 1
  dy: number;
  speed: number; // 1/256 px per tick
  tick: number;
}

/** Starts a transition if the leader stands within ROOM_EDGE of a side that has a room beyond it. */
export function roomTransitionAt(world: World, p: PlayerState): RoomTransition | null {
  const x = p.x / SUBPX, y = p.y / SUBPX;
  const cx = Math.floor(x / ROOM_W), cy = Math.floor(y / ROOM_H);
  const lx = x - cx * ROOM_W, ly = y - cy * ROOM_H;
  const sides = [
    { dx: 1, dy: 0, d: ROOM_W - lx },
    { dx: -1, dy: 0, d: lx },
    { dx: 0, dy: 1, d: ROOM_H - ly },
    { dx: 0, dy: -1, d: ly },
  ];
  for (const { dx, dy, d } of sides) {
    const nx = cx + dx, ny = cy + dy;
    if (d > ROOM_EDGE || nx < 0 || ny < 0 || nx >= MAP_GRID || ny >= MAP_GRID) continue;
    const room = world.rooms[ny * MAP_GRID + nx]!;
    if (room < 0) continue;
    const speed = Math.round((d * SUBPX + ROOM_WALK_LEAD * SUBPX) / ROOM_WALK_DIVISOR);
    return { room, dx, dy, speed, tick: 0 };
  }
  return null;
}

/** Advances the leader through a transition; returns false once it is over (input applies again next tick). */
export function stepRoomTransition(p: PlayerState, t: RoomTransition): boolean {
  t.tick++;
  p.action = "none"; // a room change cancels a sword charge
  p.actionTick = 0;
  if (t.tick > ROOM_WALK_TICKS) {
    p.moving = false;
    p.walkTicks = 0;
    return t.tick < ROOM_LOCK_TICKS;
  }
  p.moving = true;
  p.walkTicks = Math.floor((t.tick * WALK_FRAME_TICKS) / ROOM_WALK_FRAME_TICKS);
  p.x += t.dx * t.speed;
  p.y += t.dy * t.speed;
  return true;
}
