// The rule shared by the players' adaptive input delay (session.ts) and the spectators' adaptive buffer
// (spectator.ts): an integer number of frames that follows a measured need (fractional frames), up as soon as the
// need passes it, down only once one frame less would still leave a margin, and that for a while. See
// docs/netcode.md "Frames and inputs".

/** The need is smoothed over about this many ticks (an EWMA of gain 1/32). */
const SMOOTHING = 32;
/** Going down needs the smoothed need under value − 1 − ADAPT_SLACK (frames)... */
export const ADAPT_SLACK = 0.5;
/** ...at this many checks in a row. */
export const ADAPT_DOWN_CHECKS = 2;

export class AdaptiveFrames {
  value: number;
  readonly min: number;
  readonly max: number;
  private readonly interval: number;
  private cooldown: number;
  private smoothed = NaN;
  private low = 0;

  constructor(value: number, min: number, max: number, interval: number) {
    this.value = value;
    this.min = min;
    this.max = max;
    this.interval = interval;
    this.cooldown = interval;
  }

  /** The need, smoothed (frames), NaN until measured. */
  get target(): number {
    return this.smoothed;
  }

  /** One tick with the current need (NaN: unknown, forgets it). Returns the move: +1, −1 or 0, at most one per
   *  `interval` ticks. `canLower` false holds a move down (the caller isn't ready for it). */
  update(need: number, canLower = true): number {
    if (Number.isNaN(need)) this.smoothed = NaN;
    else this.smoothed = Number.isNaN(this.smoothed) ? need : this.smoothed + (need - this.smoothed) / SMOOTHING;
    if (--this.cooldown > 0 || Number.isNaN(this.smoothed)) return 0;
    this.cooldown = this.interval;
    if (this.smoothed > this.value && this.value < this.max) {
      this.low = 0;
      this.value++;
      return 1;
    }
    this.low = this.smoothed < this.value - 1 - ADAPT_SLACK && this.value > this.min ? this.low + 1 : 0;
    if (this.low < ADAPT_DOWN_CHECKS || !canLower) return 0;
    this.low = 0;
    this.value--;
    return -1;
  }
}
