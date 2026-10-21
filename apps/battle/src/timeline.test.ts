import { COUNTDOWN_TICKS, createBattle, RESULT_TICKS, ROUND_OVER_TICKS, type GameState } from "@fso/sim";
import { describe, expect, it } from "vitest";
import {
  afterimageRect,
  afterimages,
  cornerShown,
  countdownDigit,
  acceptedMessages,
  messageAtTop,
  messageOffset,
  messageSound,
  messageWindow,
  endCamera,
  INTRO,
  introView,
  linkShown,
  pressStartAlpha,
  screensView,
  TOTAL,
  TOTAL_LEAVE,
  winnerPose,
} from "./timeline.ts";

const spawns = (n: number) => Array.from({ length: n }, (_, i) => ({ x: 100 + 40 * i, y: 100, facing: "down" as const }));
const battle = (players = 2, rules = { hearts: 3, timeLimit: 0, wins: 2 }): GameState => createBattle(0, spawns(players), rules);

describe("the intro (main.dol's Game +0x60 states, traced)", () => {
  it("fades in, zooms the first text in, then Go! in, and fades both out by the Links' control", () => {
    expect(introView(0).fade).toBe(1);
    expect(introView(1).fade).toBe(1);
    expect(introView(26).fade).toBe(0);
    expect(introView(26).rival).toBeNull();
    // Game +0x8C: 15 on frame 87 (the arena showed on 60), 13.33 … 1.67, then 1 from frame 96.
    expect(introView(27).rival).toEqual({ scale: 15, alpha: 255 });
    expect(introView(35).rival!.scale).toBeCloseTo(1.6667, 3);
    expect(introView(36).rival!.scale).toBe(1);
    // Go! (+0x90) 30, 20, 10, 1 from frame 387; the text's alpha (+0x68) 245 on 388 … 5 on 412, gone on 413.
    expect([327, 328, 329, 330].map((t) => introView(t).go!.scale)).toEqual([30, 20, 10, 1]);
    expect(introView(328).rival!.alpha).toBe(245);
    expect(introView(352).rival!.alpha).toBe(5);
    expect(introView(353).rival).toBeNull();
    // Go!'s alpha (+0x6C): 249 on frame 427 … 3, then 0 as control starts.
    expect(introView(366).go!.alpha).toBe(255);
    expect(introView(367).go!.alpha).toBe(249);
    expect(introView(COUNTDOWN_TICKS - 1).go!.alpha).toBe(3);
    expect(introView(COUNTDOWN_TICKS).go).toBeNull();
  });

  it("fades each HUD corner in after its player's introduction, and all of them out at the round's end", () => {
    const b = battle(4).battle!;
    b.phaseTick = 248;
    expect([0, 1, 2, 3].map((i) => cornerShown(b, i))).toEqual([0, 0, 0, 0]);
    b.phaseTick = 259;
    expect([0, 1, 2, 3].map((i) => cornerShown(b, i))).toEqual([1, 0, 0, 0]);
    b.phaseTick = 327;
    expect([0, 1, 2, 3].map((i) => cornerShown(b, i))).toEqual([1, 1, 1, 0.6]);
    b.phase = "play";
    expect(cornerShown(b, 3)).toBe(1);
    b.phase = "roundOver";
    b.phaseTick = 136;
    expect(cornerShown(b, 0)).toBe(1);
    b.phaseTick = 141;
    expect(cornerShown(b, 0)).toBeCloseTo(0.5);
    b.phaseTick = 146;
    expect(cornerShown(b, 0)).toBe(0);
  });
});

describe("the Links' own intro (main.dol 0x80253E6C, the counter +0xD38 from tick 26)", () => {
  it("hides each Link in his portal until it bursts", () => {
    const b = battle(2).battle!;
    b.phaseTick = INTRO.appear - 1;
    expect(linkShown(b)).toBe(false);
    b.phaseTick = INTRO.appear;
    expect(linkShown(b)).toBe(true);
    b.phase = "play";
    b.phaseTick = 0;
    expect(linkShown(b)).toBe(true);
  });

  it("closes a copy of the frame in on each player in turn, faded in and out (0x8015F9C0)", () => {
    // The dumps: P1's from about frame 285 (t 225: alpha 0.06), brightest about 239, gone by 247; P2's 32 later.
    expect(afterimages(217, 2)).toEqual([]);
    const first = afterimages(218, 2);
    expect(first.map((a) => a.player)).toEqual([0]);
    expect(first[0]!.alpha).toBeLessThan(0.01);
    const peak = afterimages(239, 2)[0]!;
    expect(peak.u * peak.u).toBeCloseTo(0.5, 1);
    expect(peak.alpha).toBeCloseTo(159 / 255, 1);
    expect(afterimages(246, 2).map((a) => a.player)).toEqual([0]);
    expect(afterimages(247, 2)).toEqual([]);
    expect(afterimages(250, 2).map((a) => a.player)).toEqual([1]);
    // Four players: P2's and P3's overlap (250 + 29 > 274).
    expect(afterimages(276, 4).map((a) => a.player)).toEqual([1, 2]);
    expect(afterimages(276, 2).map((a) => a.player)).toEqual([1]);
    // The whole screen at u 0, a 40×30 box round the Link at u 1.
    expect(afterimageRect({ player: 0, u: 0, alpha: 0 }, 100, 200)).toEqual({ x0: 0, y0: 0, x1: 608, y1: 448 });
    expect(afterimageRect({ player: 0, u: 1, alpha: 0 }, 100, 200)).toEqual({ x0: 80, y0: 185, x1: 120, y1: 215 });
  });
});

describe("the round's end", () => {
  it("zooms the camera in on every Link from BFIN + 1, then on the winner as he raises his sword", () => {
    const b = battle(2).battle!;
    Object.assign(b, { phase: "roundOver", roundWinner: 0, phaseTick: 137 });
    expect(endCamera(b)).toBeNull();
    expect(winnerPose(b, 0)).toBeNull();
    b.phaseTick = 138;
    expect(endCamera(b)).toBe("all");
    b.phaseTick = 270;
    expect([endCamera(b), winnerPose(b, 0), winnerPose(b, 1)]).toEqual(["winner", 220, null]);
    // A frame every 2 ticks (traced: 220 on frame 352, 232 on 376 and after).
    b.phaseTick = 273;
    expect(winnerPose(b, 0)).toBe(221);
    b.phaseTick = 294;
    expect(winnerPose(b, 0)).toBe(232);
    b.phaseTick = 400;
    expect(winnerPose(b, 0)).toBe(232);
    Object.assign(b, { phase: "matchOver", phaseTick: 0 });
    expect([endCamera(b), winnerPose(b, 0)]).toEqual(["winner", 232]);
    // A draw: every Link, nobody poses.
    Object.assign(b, { phase: "roundOver", roundWinner: -1, phaseTick: 300 });
    expect([endCamera(b), winnerPose(b, 0)]).toEqual(["all", null]);
  });

  it("shows P2 down! from 117 ticks after his knockout, slides it in and out as measured", () => {
    const game = battle(3);
    const b = game.battle!;
    b.phase = "play";
    b.downs = [-1, -1, 500];
    const at = (tick: number) => messageWindow(b, tick);
    expect(at(607)).toBeNull(); // (asked on 607: placed 100 px down)
    expect(at(608)!.offset).toBeCloseTo(99.72, 2);
    // The frame dumps: 72, 67, 60, 53, 46, 38, 29, 20, 10, in place on 626 to 786, out 1, 3, 7, 13, 21, 30, 41, 53, 67.
    const near = (ticks: number[], dumps: number[]) => ticks.forEach((t, k) => expect(Math.abs(at(t)!.offset - dumps[k]!)).toBeLessThan(1));
    near([617, 618, 619, 620, 621, 622, 623, 624, 625], [72, 67, 60, 53, 46, 38, 29, 20, 10]);
    expect([at(626)!.offset, at(786)!.offset]).toEqual([0, 0]);
    near([787, 788, 789, 790, 791, 792, 793, 794, 795], [1, 3, 7, 13, 21, 30, 41, 53, 67]);
    expect(at(796)).toBeNull();
    expect(at(700)).toMatchObject({ id: 0x19b, player: 2 });
    // Knocked out together (Vaati's time-up): the first player's message only.
    b.downs = [500, 500, -1];
    expect(at(700)!.player).toBe(0);
    expect(acceptedMessages(b, 1000)).toHaveLength(1);
    // One window: a knockout while it's up gets none (the request is dropped); one after it's free gets its own.
    b.downs = [500, 560, -1];
    expect(at(680)!.player).toBe(0);
    expect(acceptedMessages(b, 1000).map((m) => m.player)).toEqual([0]);
    b.downs = [500, 691, -1];
    expect(acceptedMessages(b, 1000).map((m) => m.player)).toEqual([0, 1]);
    b.downs = [500, 690, -1];
    expect(acceptedMessages(b, 1000).map((m) => m.player)).toEqual([0]);
  });

  it("takes the actors' requests and Vaati's timer's, a {notice} once a match, each with its sound", () => {
    const game = battle(2, { hearts: 3, timeLimit: 3600, wins: 2 });
    const b = game.battle!;
    // "30 seconds left!" as the timer reaches 30 s (play's tick 1800 of 3600): asked on that tick, in view the next.
    Object.assign(b, { phase: "play", phaseTick: 1800, timeLeft: 1800 });
    expect(messageWindow(b, 5000)).toBeNull();
    expect(acceptedMessages(b, 5000)).toEqual([{ id: 0x196, player: -1, tick: 5000 }]);
    Object.assign(b, { phaseTick: 1801, timeLeft: 1799 });
    expect(messageWindow(b, 5001)).toMatchObject({ id: 0x196, s: 1 });
    expect(messageSound(0x196)).toBe("pinch");
    b.timeLeft = 1700;
    b.phaseTick = 1900;
    expect(messageWindow(b, 5100)).toMatchObject({ id: 0x196, s: 100 });
    // A time limit of 30 s never counts down to 30 s left: no message.
    b.rules.timeLimit = 1800;
    expect(acceptedMessages(b, 5100)).toEqual([]);
    b.rules.timeLimit = 3600;
    // The circle's {notice} message: shown when the window is free, not a second time.
    b.messages = [
      { id: 0xe8, player: -1, tick: 5191 },
      { id: 0x1a2, player: 1, tick: 5250 }, // (dropped: the window is up)
      { id: 0xe8, player: -1, tick: 5390 }, // (free again from 5382, but already shown)
    ];
    Object.assign(b, { phaseTick: 2200, timeLeft: 1400 });
    expect(acceptedMessages(b, 5400).map((m) => m.id)).toEqual([0x196, 0xe8]);
    Object.assign(b, { phaseTick: 2041, timeLeft: 1559 });
    expect(messageWindow(b, 5241)).toMatchObject({ id: 0xe8, s: 50, offset: 0 });
    expect(messageSound(0xe8)).toBe("attention");
    expect(messageSound(0x1a9)).toBe("pinch");
    expect(messageSound(0x19b)).toBe("attention");
  });

  it("goes to the top only when a Link would be under it at the bottom and none under it at the top", () => {
    expect(messageAtTop([{ x: 300, y: 200 }], 24)).toBe(false);
    expect(messageAtTop([{ x: 300, y: 360 }], 24)).toBe(true);
    expect(messageAtTop([{ x: 300, y: 360 }, { x: 100, y: 90 }], 24)).toBe(false);
    expect(messageAtTop([{ x: 300, y: 360 }, null], 24)).toBe(true);
    expect(messageOffset(0)).toBeNull();
  });

  it("then the result banner from BFIN's state 5, the Total screen between rounds, its fades", () => {
    const game = battle(2);
    const b = game.battle!;
    Object.assign(b, { phase: "roundOver", roundWinner: 0, phaseTick: 293 });
    b.fighters[0]!.stars = 1;
    expect(screensView(game, "press").result).toBeNull();
    b.phaseTick = 294;
    expect(screensView(game, "press").result).toBe(0);
    b.phaseTick = RESULT_TICKS;
    let v = screensView(game, "press");
    expect([v.result, v.total, v.fade]).toEqual([null, { s: 0, leave: TOTAL_LEAVE }, 0]);
    b.phaseTick = RESULT_TICKS + 25;
    expect(screensView(game, "auto").fade).toBe(1);
    b.phaseTick = RESULT_TICKS + TOTAL.wall + TOTAL.wallFade;
    expect(screensView(game, "auto").fade).toBe(0);
    b.phaseTick = ROUND_OVER_TICKS - 1;
    v = screensView(game, "auto");
    expect(v.fade).toBeCloseTo(24 / 25);
    // A draw: DRAW! (-1), no star flies.
    Object.assign(b, { roundWinner: -1, phaseTick: 300 });
    expect(screensView(game, "press").result).toBe(-1);
  });

  it("at the match's end: PRESS START until a press (local), the Total screen at once online; none past 4 Links", () => {
    const game = battle(2);
    const b = game.battle!;
    Object.assign(b, { phase: "matchOver", roundWinner: 1, matchWinner: 1, phaseTick: 0 });
    let v = screensView(game, "press");
    expect([v.result, v.press, v.total]).toEqual([1, 0, null]);
    b.phaseTick = 1;
    expect(screensView(game, "press").press).toBeCloseTo(225 / 258, 1);
    b.phaseTick = 40;
    v = screensView(game, "press", 30);
    expect([v.result, v.press, v.total]).toEqual([null, 0, { s: 10, leave: null }]);
    expect(screensView(game, "auto").total).toEqual({ s: 40, leave: null });
    // Free play's battles of 5-8: no Total screen, the result stays, no PRESS START.
    const crowd = battle(6);
    Object.assign(crowd.battle!, { phase: "matchOver", roundWinner: 4, matchWinner: 4, phaseTick: 200 });
    v = screensView(crowd, "auto");
    expect([v.result, v.press, v.total]).toEqual([4, 0, null]);
  });

  it("PRESS START pulses: full for 21 of every 46 ticks, down to 0.19 and back", () => {
    expect(pressStartAlpha(0)).toBe(0);
    expect(pressStartAlpha(13)).toBeCloseTo(0.194, 3);
    expect(pressStartAlpha(26)).toBe(1);
    expect(pressStartAlpha(45)).toBe(1);
    expect(pressStartAlpha(47)).toBeCloseTo(pressStartAlpha(1));
  });
});

describe("the time limit's last seconds", () => {
  it("shows one big digit for the first half of each of the last five seconds", () => {
    const game = battle(2, { hearts: 3, timeLimit: 600, wins: 2 });
    const b = game.battle!;
    b.phase = "play";
    const digit = (left: number) => ((b.timeLeft = left), countdownDigit(b));
    expect([301, 300, 271, 270, 240, 211, 210, 60, 31, 30, 1].map(digit)).toEqual([null, 5, 5, null, 4, 4, null, 1, 1, null, null]);
  });
});
