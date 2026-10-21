// When Shadow Battle's own screens show, as functions of the battle state only (so any state, rolled back or not, is
// drawn the same, and a spectator joining mid-match sees what everyone sees). The numbers are the game's, read from
// main.dol and Dolphin (docs/measurements/screens.md "J2D screens in Dolphin", "Shadow Battle's round screens"):
// - the intro (the sim's countdown, COUNTDOWN_TICKS from the arena showing): the arena fades in from black, "Be the
//   last one standing!" zooms in, each player's HUD corner fades in, "Go!" zooms in as the first text fades, then
//   fades out as the Links get control;
// - the message window: "P2 down!" 107 ticks after a knockout (sliding in from the bottom, in view from 117), Vaati's
//   timer's warnings, the messages the arena's actors ask for (the sim's BattleState.messages), one at a time;
// - the round's end (BFIN): the HUD fades out (137 ticks after the knockout), "P1 WIN!" or "DRAW!" (293), then the
//   game's "PRESS START" (RESULT_TICKS, 423), then the Total screen (here: on its own between rounds, after a press at
//   the match's end);
// - a time limit's last five seconds: one big digit a second.
import { COUNTDOWN_TICKS, NOTICE_MESSAGES, RESULT_TICKS, ROUND_OVER_TICKS, type BattleState, type GameState } from "@fso/sim";

/** The intro, in ticks from the arena showing (the countdown's phaseTick; play goes on from COUNTDOWN_TICKS). */
export const INTRO = {
  /** The screen fades in from black over these ticks (the game's +0x58 fade, 25 frames from its first lit frame). */
  fadeIn: 26,
  /** "Be the last one standing!" appears at 15× its size and shrinks 5/3 a tick to 1× (main.dol: Game +0x8C). */
  rival: 27,
  rivalScale: 15,
  rivalShrink: 5 / 3,
  /** "Go!": 30×, 20×, 10×, then 1× (Game +0x90); the first text loses 10 alpha a tick from the next tick on. */
  go: 327,
  goScales: [30, 20, 10, 1],
  rivalFade: 10,
  /** Go! loses 6 alpha a tick from here (Game +0x6C): 0 as the Links get control. */
  goFade: 367,
  goFadeStep: 6,
  /**
   * The Links' own intro (main.dol 0x80253E6C: each Link counts +0xD38 from the screen's fade-in on, i.e. from tick 26):
   * at 16 the dark portal (effects 1048-1050 at his feet, layer 0 sublayer 1) and its sound; at 131 he shows (+0xC80)
   * as it bursts; then per player the frame's afterimage closing in on him (0x8015F8FC, 30 frames: AFTERIMAGE), and 32
   * frames later his HUD corner (0x8043A170 sets the message manager's +0xDD bit; the corner fades in 0.1 a tick). The
   * frame dumps agree: P1's and P2's corners from 249-250 and 282, P3's of four about 307.
   */
  links: 26,
  portal: 42,
  appear: 157,
  zooms: [218, 250, 274, 290],
  corners: [250, 282, 306, 322],
} as const;

/** The intro's afterimage (the stage manager's +0x30 object, kind 1): its slot counts down from 30, drawn while > 0. */
export const AFTERIMAGE_TICKS = 29;

export interface Afterimage {
  player: number;
  /** 0 → 1 over its frames: the part of the frame's copy shown (over the whole screen) goes from all of it to a 40×30 box round the Link. */
  u: number;
  /** 0-1: 159/255 at its brightest (u² = ½). */
  alpha: number;
}

/**
 * The afterimages up at intro tick `t` (several can overlap: P2's and P3's, of four). The game's draw (0x8015F9C0):
 * u = 1 − T / 30 for the slot's T, alpha 159 · 2u² (or 2 − 2u² past ½), the copy's rectangle from (0, 0, 608, 448) to
 * (x ± 20, y ± 15) about the Link's place on the screen by u² (afterimageRect).
 */
export function afterimages(t: number, players: number): Afterimage[] {
  const out: Afterimage[] = [];
  INTRO.zooms.slice(0, players).forEach((at, player) => {
    const k = t - at;
    if (k < 0 || k >= AFTERIMAGE_TICKS) return;
    const u = 1 - (AFTERIMAGE_TICKS - k) / 30, u2 = u * u;
    out.push({ player, u, alpha: (159 / 255) * (u2 <= 0.5 ? 2 * u2 : 2 - 2 * u2) });
  });
  return out;
}

/** The part of the frame an afterimage shows over the whole screen (608×448 px), for the Link at screen (x, y). */
export function afterimageRect(a: Afterimage, x: number, y: number): { x0: number; y0: number; x1: number; y1: number } {
  const k = a.u * a.u, rest = 1 - k;
  return { x0: k * (x - 20), y0: k * (y - 15), x1: k * (x + 20) + rest * 608, y1: k * (y + 15) + rest * 448 };
}

/** Whether a Link shows yet during his round's intro (hidden in the portal until it bursts). */
export function linkShown(b: BattleState): boolean {
  return b.phase !== "countdown" || b.phaseTick >= INTRO.appear;
}

/**
 * The round's end, in ticks from the knockout (roundOver's phaseTick): BFIN's states 1 (the HUD fades out), 2 (the
 * camera's end mode from the next tick: the box eases exactly onto every Link where he stands or lies), 3 (the
 * winner raises his sword, player_sob 220-232 a frame every 2 ticks from 270, and the camera keeps him alone) and 5
 * ("P1 WIN!", the sparkle on his sword: effects 203 + 204, 7 px right and 27 up, layer 1) (traces, docs/measurements.md).
 */
export const ROUND_END = {
  hudOut: 137,
  camera: 138,
  pose: 270,
  result: 294,
} as const;
/** The winner's pose: player_sob frames 220 … 232, one every 2 ticks, then held. */
export const POSE_FRAMES = { first: 220, last: 232, ticks: 2 } as const;

/** What the camera follows at the round's end ("all": every Link on the TV, "winner": him alone), or null (play). */
export function endCamera(b: BattleState): "all" | "winner" | null {
  if (b.phase === "matchOver") return b.roundWinner >= 0 ? "winner" : "all";
  if (b.phase !== "roundOver" || b.phaseTick < ROUND_END.camera) return null;
  return b.roundWinner >= 0 && b.phaseTick >= ROUND_END.pose ? "winner" : "all";
}

/** The winner's sprite frame while he holds his sword up, or null. */
export function winnerPose(b: BattleState, i: number): number | null {
  if (i !== b.roundWinner) return null;
  if (b.phase === "matchOver") return POSE_FRAMES.last;
  if (b.phase !== "roundOver" || b.phaseTick < ROUND_END.pose) return null;
  return Math.min(POSE_FRAMES.last, POSE_FRAMES.first + Math.floor((b.phaseTick - ROUND_END.pose) / POSE_FRAMES.ticks));
}

/**
 * The Total screen's sequence, in ticks from its start (the press of A in the game; RESULT_TICKS into roundOver between
 * rounds): the arena fades to black, the castle wall fades in, the panel slides up (offsets below its place, screen px,
 * one a tick), Continue then Quit slide up on their own, the "Total" scroll drops in, the star just won flies to its
 * slot (total_star.bck's frames 0-19, faded in), then pulses every 120 ticks (frames 79-109). Offsets measured by
 * aligning the frame dumps with the screen at rest.
 */
export const TOTAL = {
  fadeOut: 25,
  wall: 26,
  wallFade: 25,
  panel: 63,
  panelSlide: [351, 325, 297, 268, 235, 201, 165, 127, 87, 44],
  buttons: [63, 68],
  buttonSlide: [94, 71, 48, 25],
  scroll: 72,
  scrollDrop: [-81, -66, -51, -35, -18],
  star: 90,
  starFlight: 19,
  pulse: 170,
  pulseFrom: 79,
  pulseTo: 109,
  pulseEvery: 120,
} as const;

/** The Total screen between rounds ends with a fade to black (the next round fades in from it). */
export const TOTAL_LEAVE = ROUND_OVER_TICKS - RESULT_TICKS - 25;

/** "PRESS START" at the match's end: alpha 1 for 21 of every 46 ticks, down to 0.19 and back (frame dumps). */
export function pressStartAlpha(t: number): number {
  if (t < 1) return 0;
  const c = t % 46;
  if (c >= 26) return 1;
  const u = Math.abs(c - 13) / 13;
  return 0.194 + 0.806 * u * u;
}

export interface IntroView {
  /** Black over the frame, 0-1. */
  fade: number;
  rival: { scale: number; alpha: number } | null;
  go: { scale: number; alpha: number } | null;
}

/** The intro's pictures at tick `t` from the arena showing (beyond COUNTDOWN_TICKS: the first ticks of play). */
export function introView(t: number): IntroView {
  const fade = t < INTRO.fadeIn ? Math.min(1, (INTRO.fadeIn - t) / 25) : 0;
  let rival: IntroView["rival"] = null, go: IntroView["go"] = null;
  if (t >= INTRO.rival) {
    const alpha = t <= INTRO.go ? 255 : 255 - INTRO.rivalFade * (t - INTRO.go);
    if (alpha > 0) rival = { scale: Math.max(1, INTRO.rivalScale - (t - INTRO.rival) * INTRO.rivalShrink), alpha };
  }
  if (t >= INTRO.go) {
    const alpha = t < INTRO.goFade ? 255 : 255 - INTRO.goFadeStep * (t - INTRO.goFade + 1);
    if (alpha > 0) go = { scale: INTRO.goScales[Math.min(t - INTRO.go, INTRO.goScales.length - 1)]!, alpha };
  }
  return { fade, rival, go };
}

/** Ticks since the arena showed: the countdown's, then play's, or null in the other phases. */
export function introTick(b: BattleState): number | null {
  if (b.phase === "countdown") return b.phaseTick;
  if (b.phase === "play") return COUNTDOWN_TICKS + b.phaseTick;
  return null;
}

/**
 * How much of player i's HUD corner shows (0-1, times the HUD's own fades): faded in during the intro after his
 * introduction, faded out from BFIN's state 1 on. The HUD steps 0.1 a tick toward its targets; here the same ramps
 * are worked out from the state.
 */
export function cornerShown(b: BattleState, i: number): number {
  const ramp = (ticks: number) => Math.min(1, Math.max(0, ticks / 10));
  switch (b.phase) {
    case "countdown":
      return ramp(b.phaseTick - (INTRO.corners[i] ?? INTRO.corners[INTRO.corners.length - 1]!) + 1);
    case "roundOver":
      return 1 - ramp(b.phaseTick - ROUND_END.hudOut + 1);
    case "matchOver":
      return 0;
    default:
      return 1;
  }
}

/**
 * The message window (main2D main_message_window.blo; main.dol's message manager [0x8053AED0]: the request 0x8043D67C,
 * its states 0x8043D034, 0x8043CF40, 0x8043CEA0, 0x8043CDA0). One window: a request while it's up is dropped (+0x10A),
 * and a {notice} message shows once (a flag of the save file: here once a match). On the request's tick it's placed
 * 100 px off the screen, at the bottom, or at the top (its top 13 px down) when a Link stands where it would cover him
 * and none where it would go instead (messageAtTop); then it slides in over 19 ticks (100 · (1 − (k/19)²) px off),
 * stays 160 more, slides out over 11 (100 · (k/11)²) and is free again on the last. Checked against the frame dumps
 * of "P2 down!" (from 10 ticks in: 72, 67, 60 … 10, in place, out 1, 3, 7 … 67, gone) and of "You got 10 Dark World
 * seconds!" (docs/measurements.md).
 */
export const MESSAGE_WINDOW = { away: 100, slideIn: 19, stay: 160, slideOut: 11 } as const;
/** Ticks from a request to the window being free again (its last slide-out step). */
export const MESSAGE_BUSY = MESSAGE_WINDOW.slideIn + MESSAGE_WINDOW.stay + MESSAGE_WINDOW.slideOut;
/** The last tick it shows: the slide-out's last two steps put it below the screen (dumps: gone at "P2 down!"'s +189). */
const MESSAGE_SHOWN = MESSAGE_BUSY - 2;
/** A knockout asks for "P{n} down!" this many ticks after it (the Link's death state, 0x80277F98). */
export const DOWN_MESSAGE_DELAY = 107;
/** Vaati's timer asks at these ticks left (the stage's timer 0x802D3A18, as it counts down to them). */
export const TIMER_MESSAGES = [
  { left: 1800, id: 0x196 }, // "30 seconds left!"
  { left: 660, id: 0x197 }, // "Vaati arrives in 10 seconds!"
] as const;
const MESSAGE_DOWN = 0x19b; // "P{number 0} down!"
/** The window's place: its top at 364 px (the frame's top, Pmmw01), or 13 px down from the screen's top. */
export const MESSAGE_PLACE = { bottom: 364, top: 13, height: 448 } as const;

/** A request for the message window: BMG id, the player its {number 0} names (-1 none), the tick it was made. */
export interface MessageRequest {
  id: number;
  player: number;
  tick: number;
}

/**
 * The window's sound with a message it takes (the request's own 2D sound, 0x8043D7EC): JA_SE_ATTENTION_PINCH for the
 * urgent ones (BMG 0x190-0x191, 0x196-0x199, 0x1A9), none for 0x240, else JA_SE_ATTENTION.
 */
export function messageSound(id: number): "attention" | "pinch" | null {
  const k = id - 1;
  if (k === 575) return null;
  return k === 424 || (k >= 399 && k < 401) || (k >= 405 && k < 409) ? "pinch" : "attention";
}

/** Every request of the round so far (and the match's {notice} ones), in the order the game makes them. */
export function messageRequests(b: BattleState, tick: number): MessageRequest[] {
  const out: MessageRequest[] = [];
  b.downs.forEach((down, i) => {
    if (down >= 0 && down + DOWN_MESSAGE_DELAY <= tick) out.push({ id: MESSAGE_DOWN, player: i, tick: down + DOWN_MESSAGE_DELAY });
  });
  // Vaati's timer: play's own ticks count it down (timeLeft = timeLimit − play's ticks, until it runs out).
  if (b.rules.timeLimit > 0 && (b.phase === "play" || (b.phase === "roundOver" && b.timeLeft > 0))) {
    for (const { left, id } of TIMER_MESSAGES) {
      if (b.rules.timeLimit <= left || b.timeLeft > left) continue;
      const at = b.phase === "play" ? tick - b.phaseTick + (b.rules.timeLimit - left) : tick - b.phaseTick - (left - b.timeLeft);
      if (at <= tick) out.push({ id, player: -1, tick: at });
    }
  }
  for (const m of b.messages ?? []) if (m.tick <= tick) out.push(m);
  return out.sort((a, c) => a.tick - c.tick); // (stable: same-tick requests keep the order above)
}

/** The requests the window takes (it drops those made while it's up, and a {notice} message after its first time). */
export function acceptedMessages(b: BattleState, tick: number): MessageRequest[] {
  const out: MessageRequest[] = [];
  let free = -Infinity;
  const noticed = new Set<number>();
  for (const r of messageRequests(b, tick)) {
    if (r.tick < free || noticed.has(r.id)) continue;
    if (NOTICE_MESSAGES.has(r.id)) noticed.add(r.id);
    out.push(r);
    free = r.tick + MESSAGE_BUSY + 1;
  }
  return out;
}

export interface MessageView extends MessageRequest {
  /** Ticks since the request (0: placed off the screen). */
  s: number;
  /** How far off its place the window is (px, toward the edge it slides in from). */
  offset: number;
}

/** How far off its place the window is `s` ticks after the request (px), or null when it doesn't show. */
export function messageOffset(s: number): number | null {
  const w = MESSAGE_WINDOW;
  if (s < 1 || s > MESSAGE_SHOWN) return null;
  if (s <= w.slideIn) return Math.round(w.away * (1 - (s / w.slideIn) ** 2) * 100) / 100;
  if (s <= w.slideIn + w.stay) return 0;
  return Math.round(w.away * ((s - w.slideIn - w.stay) / w.slideOut) ** 2 * 100) / 100;
}

/** The message window at `tick` (GameState.tick), or null. */
export function messageWindow(b: BattleState, tick: number): MessageView | null {
  const shown = acceptedMessages(b, tick).at(-1);
  if (!shown) return null;
  const s = tick - shown.tick, offset = messageOffset(s);
  return offset === null ? null : { ...shown, s, offset };
}

/**
 * Where the window goes for a request (decided as it's placed, 0x8043D034): at the top when a Link on the TV (his feet,
 * on the 608×448 screen) is low enough for it to cover him (below its top less 16 room px) and none is high enough to
 * be covered up there; `px16`: what 16 room px make on the screen.
 */
export function messageAtTop(points: readonly ({ x: number; y: number } | null)[], px16: number): boolean {
  const h = MESSAGE_PLACE.height;
  const on = points.filter((p): p is { x: number; y: number } => !!p && p.x > 0 && p.x < 608 && p.y > 0 && p.y < h);
  return on.some((p) => p.y > MESSAGE_PLACE.bottom - px16) && !on.some((p) => p.y < h - MESSAGE_PLACE.bottom + px16);
}

/** The result banner's subject: the round's winner, -1 for a draw, or null when no banner shows. */
export function resultBanner(b: BattleState): number | null {
  if (b.phase === "roundOver" && b.phaseTick >= ROUND_END.result && b.phaseTick < RESULT_TICKS) return b.roundWinner;
  return null;
}

/** The Total screen's tick between rounds (0 = its start, RESULT_TICKS into roundOver), or null. */
export function totalBetweenRounds(b: BattleState): number | null {
  return b.phase === "roundOver" && b.phaseTick >= RESULT_TICKS ? b.phaseTick - RESULT_TICKS : null;
}

/** Black over everything during the Total screen's fades at tick `s` (`leave`: when it fades out again, if it does). */
export function totalFade(s: number, leave: number | null): number {
  if (s < TOTAL.wall) return Math.min(1, s / TOTAL.fadeOut);
  if (leave !== null && s >= leave) return Math.min(1, (s - leave) / 25);
  return Math.max(0, 1 - (s - TOTAL.wall) / TOTAL.wallFade);
}

/** The time limit's last seconds: the digit shown (5…1) for the first half of each second, else null. */
export function countdownDigit(b: BattleState): number | null {
  if (b.phase !== "play" || b.rules.timeLimit <= 0 || b.timeLeft <= 0 || b.timeUp > 0) return null;
  const n = Math.ceil(b.timeLeft / 60);
  return n <= 5 && b.timeLeft > 60 * n - 30 ? n : null;
}

/** The ticks since this state's knockout of player i, or null (for tests and the HUD). */
export function sinceDown(game: GameState, i: number): number | null {
  const at = game.battle?.downs[i] ?? -1;
  return at < 0 ? null : game.tick - at;
}

/** Players the Total screen has columns for (the game's four). */
export const TOTAL_PLAYERS = 4;

export interface ScreensView {
  intro: IntroView | null;
  /** The message window ("P2 down!", "You got 10 Dark World seconds!"…), or null. */
  message: MessageView | null;
  /** "P1 WIN!" (the winner) or "DRAW!" (-1), or null. */
  result: number | null;
  /** "PRESS START"'s alpha (0: not shown). */
  press: number;
  /** The time limit's digit, or null. */
  digit: number | null;
  /** The Total screen at its tick `s`, and when it fades out again (between rounds), or null. */
  total: { s: number; leave: number | null } | null;
  /** Black over the frame (the intro's and the Total screen's fades), 0-1. */
  fade: number;
}

/**
 * What the game's screens show in this state. At the match's end the game waits for A on "PRESS START" before its
 * Total screen: `matchEnd` "press" does too (local play: `pressed` is matchOver's tick at the press, null before it);
 * "auto" goes on to the Total screen at once (online, where nobody waits for anyone). Battles of more than four Links
 * (free play's) have no Total screen: the result stays up.
 */
export function screensView(game: GameState, matchEnd: "press" | "auto", pressed: number | null = null): ScreensView {
  const view: ScreensView = { intro: null, message: null, result: null, press: 0, digit: null, total: null, fade: 0 };
  const b = game.battle;
  if (!b || b.phase === "free") return view;
  const t = introTick(b);
  if (t !== null && t <= COUNTDOWN_TICKS) {
    view.intro = introView(t);
    view.fade = view.intro.fade;
  }
  view.message = messageWindow(b, game.tick);
  view.digit = countdownDigit(b);
  view.result = resultBanner(b);
  const fits = b.fighters.length <= TOTAL_PLAYERS;
  const between = totalBetweenRounds(b);
  if (between !== null && fits) view.total = { s: between, leave: TOTAL_LEAVE };
  else if (between !== null) view.result = b.roundWinner; // (no Total screen: the result stays up to the next round)
  if (b.phase === "matchOver") {
    const s = !fits ? null : matchEnd === "auto" ? b.phaseTick : pressed === null ? null : b.phaseTick - pressed;
    if (s === null) {
      view.result = b.roundWinner;
      view.press = matchEnd === "press" && fits ? pressStartAlpha(b.phaseTick) : 0;
    } else view.total = { s, leave: null };
  }
  // The press takes the banner away at once, then the arena fades out (dumps); between rounds the same, unpressed.
  if (view.total) {
    view.result = null;
    view.fade = Math.max(view.fade, totalFade(view.total.s, view.total.leave));
  }
  return view;
}
