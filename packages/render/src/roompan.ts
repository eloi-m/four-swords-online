// The room-to-room camera pan, measured in Dolphin (docs/measurements): a quadratic ease-out over 30 ticks, starting
// 2 ticks after the sim switches rooms (while Link walks into the new room by himself), on both axes.
export const ROOM_SCROLL_TICKS = 30;
export const ROOM_SCROLL_DELAY = 2;

/** The camera centre over rooms: snaps while in a room, pans when `pan` is set on a room change. Step once per sim tick. */
export class RoomPan {
  x = 0;
  y = 0;
  room = -1;
  private scroll: { x: number; y: number; tick: number } | null = null;

  /** One tick with the target centre (`tx`, `ty`) in `room`; `pan`: a room change eases instead of snapping (never the first frame). */
  step(room: number, tx: number, ty: number, pan = true): void {
    if (this.room !== room) {
      this.scroll = this.room >= 0 && pan ? { x: this.x, y: this.y, tick: 0 } : null;
      this.room = room;
    }
    if (this.scroll) {
      const k = Math.max(0, this.scroll.tick++ - ROOM_SCROLL_DELAY);
      if (k < ROOM_SCROLL_TICKS) {
        const eased = 1 - (1 - k / ROOM_SCROLL_TICKS) ** 2;
        this.x = this.scroll.x + (tx - this.scroll.x) * eased;
        this.y = this.scroll.y + (ty - this.scroll.y) * eased;
        return;
      }
      this.scroll = null;
    }
    this.x = tx;
    this.y = ty;
  }
}
