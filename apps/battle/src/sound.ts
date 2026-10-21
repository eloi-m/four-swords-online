// Battle audio: the arena's BGM and the fight's sound effects, played by the shared synth player (@fso/web/audio,
// SynthAudio). `BattleAudio` adds the arenas' BGM; `SoundCues` turns battle states into sounds without ever writing to
// them.
//
// Rollback-safe triggering: a cue is derived from the state alone and keyed by the tick its cause started (a swing's
// start is `tick - actionTick`, a knockback's `tick - modeTick`, a phase's `tick - phaseTick`), and only fires in the
// first few ticks after that start. Re-simulated or re-observed states produce the same keys, so nothing plays twice;
// skipped ticks (several steps per frame) still see the cue inside its window.
import { readStageBgmTable } from "@fso/audio";
import type { Dol, Stage } from "@fso/formats";
import {
  battleWarps,
  BIG_BOMB,
  BOMB_FUSE,
  Button,
  CHARGE,
  CIRCLE_GROW_TICKS,
  CIRCLE_TICKS,
  circleOpen,
  CUCCO_TICKS,
  DEBRIS,
  DEBRIS_TICKS,
  FALL_START_TICKS,
  GATE_STYLES,
  screenAt,
  SHADOW,
  SPOT_ARRIVE_TICK,
  SUBPX,
  THROW_RELEASE_TICK,
  WARP_ENTER_TICKS,
  WARP_STAND_TICKS,
  type BattleState,
  type Fighter,
  type GameState,
} from "@fso/sim";
import { SynthAudio, type SynthData } from "@fso/web/audio";
import { acceptedMessages, INTRO, messageSound, ROUND_END, TIMER_MESSAGES } from "./timeline.ts";

/** A pit's second voice, as he comes back out: its fall's tick 58 (Link state 50). */
const PIT_OUT_TICK = 58;
const VOLUME_KEY = "fso.battle.volume";

/**
 * The sound effects the cues use (JA_SE_* names from the BST name table; picked by name and by listening to the
 * synth's renders, not yet matched against the game's own calls, except where noted in docs/formats.md).
 */
export const BATTLE_SE = {
  swing: ["JA_SE_LK_SWORD_WIELD"],
  lunge: ["JA_SE_LK_SWORD_WIELD", "JA_SE_V_SWORD_SWING"],
  charged: ["JA_SE_LK_CHARGING"],
  spin: ["JA_SE_LK_TAMEGIRI", "JA_SE_V_TAMEGIRI"],
  hit: ["JA_SE_CHR_ENEMY_DAMAGE", "JA_SE_V_DAMAGE"],
  block: ["JA_SE_LK_SHIELD"],
  // A pit (Link state 50): the voice as he falls in, another as he comes out (main.dol 0x80291888, 0x802912BC).
  fall: ["JA_SE_V_FALL_DOWN"],
  fallOut: ["JA_SE_V_DAMAGE_M"],
  death: ["JA_SE_V_DOWN", "JA_SE_LINK_DOWN"],
  ready: ["JA_SE_READY"],
  go: ["JA_SE_GO"],
  // The round's intro and end, by the ids main.dol plays (0x4004E, 0x20043, 0x25, 0x2000E: docs/formats.md).
  portal: ["JA_SE_CHR_SLINK_APP_EFF_S"],
  appear: ["JA_SE_LK_SLINK_APPEAR"],
  zoom: ["JA_SE_START_ZOOM"],
  sparkle: ["JA_SE_LK_DISCHARGE"],
  draw: ["JA_SE_HAZURE_JINGLE"],
  // Vaati's timer (main.dol 0x802D3A18): a warning at 30 s and 11 s left (with its message), then each of the last five
  // seconds its own count, 5 to 1.
  warning: ["JA_SE_DEATH_WARNING"],
  count5: ["JA_SE_DEATH_COUNT_05"],
  count4: ["JA_SE_DEATH_COUNT_04"],
  count3: ["JA_SE_DEATH_COUNT_03"],
  count2: ["JA_SE_DEATH_COUNT_02"],
  count1: ["JA_SE_DEATH_COUNT_01"],
  // The message window's (timeline.ts messageSound): with "P2 down!", "You got 10 Dark World seconds!"…, or the
  // urgent ones ("A giant bomb! Escape to your Game Boy Advance!", Vaati's).
  attention: ["JA_SE_ATTENTION"],
  pinch: ["JA_SE_ATTENTION_PINCH"],
  // Held while their cause lasts (the game asks for them every frame; both loop): an open magic circle's hum (CIRC at
  // full size, 0x3002D), the giant bomb's fuse (BBMB burning, 0x50026).
  hum: ["JA_SE_OBJ_MAGIC_SQUARE"],
  fuse: ["JA_SE_OBJ_DOUKASEN_SPARKBIG"],
  // Lifting, throwing, rolling, items and hazards (packages/sim carry.ts, roll.ts, items.ts, bombs.ts…).
  liftLink: ["JA_SE_LK_LIFT_PLAYERS", "JA_SE_V_LIFTED_UP"],
  lift: ["JA_SE_OBJ_LIFT"],
  throw: ["JA_SE_LK_THROW"],
  roll: ["JA_SE_V_ROLLING"],
  bombSet: ["JA_SE_LK_BOMB_SET"],
  bomb: ["JA_SE_OBJ_BOMB_BURST"],
  arrow: ["JA_SE_LK_ARROW_SHOOT"],
  arrowStick: ["JA_SE_OBJ_ARROW_STICK"],
  boomerang: ["JA_SE_LK_BOOMERANG"],
  cutGrass: ["JA_SE_OBJ_CUT_GRASS"],
  orbBreak: ["JA_SE_OBJ_CRYSTAL_BREAK"],
  cucco: ["JA_SE_CHR_NIWATORI"],
  epona: ["JA_SE_CHR_EPONA_INANAKI"],
  fire: ["JA_SE_OBJ_FIREBLAST"],
  // The Tower of Winds' Shadow Link and his giant bomb: the ids their code plays (BBSL 0x4004E as he comes, 0x50085 as
  // he makes the bomb; BBMB 0x3000F landing; a sound id is the BST's section << 24 | group << 16 | index).
  shadowLink: ["JA_SE_CHR_SLINK_APP_EFF_S"],
  makeBomb: ["JA_SE_CHR_SLINK_MAKEBOMB"],
  bigBombLand: ["JA_SE_OBJ_IBALL_BOUND"],
  // The side rooms (siderooms.ts), as the Link's states play them (main.dol): into a door or gate walking up or down
  // (state 28), out of one onto the TV (state 29, on its first step), into a hole (30), a cannon (CNON, state 77's
  // shot), a magic circle and back (36, 32, 33), the dark side's middle spot (34, 35); the circles' own 2D sounds.
  doorUp: ["JA_SE_LK_STAIR_GO_UP"],
  doorDown: ["JA_SE_LK_STAIR_GO_DN"],
  outUp: ["JA_SE_LK_STAIR_COME_UP", "JA_SE_LK_RET_GC"],
  outDown: ["JA_SE_LK_STAIR_COME_DN", "JA_SE_LK_RET_GC"],
  hole: ["JA_SE_V_FALL_DOWN", "JA_SE_LK_HALL_IN"],
  cannonIn: ["JA_SE_LK_TAIHOU_SET"],
  cannonShot: ["JA_SE_LK_TAIHOU_SHOOT"],
  circleIn: ["JA_SE_LK_WARP_IN_DUN"],
  circleOut: ["JA_SE_LK_RET_GC_SMOKE", "JA_SE_LK_RET_GC"],
  spot: ["JA_SE_LK_MSPOT_WARP"],
  spotOut: ["JA_SE_LK_RET_GC_SMOKE", "JA_SE_LK_JUMP_UP", "JA_SE_LK_RET_GC"],
  circleOpen: ["JA_SE_MG_SQUARE_APP"],
  circleClose: ["JA_SE_MG_SQUARE_DISAPP"],
  doorOpen: ["JA_SE_OBJ_DOOR_OPEN"], // The Field's house door, opened by a Link facing it (main.dol 0x8029E850)
} as const satisfies Record<string, readonly string[]>;
export type Cue = keyof typeof BATTLE_SE;

/** BGM per battle phase (the stage BGM comes from map500.csv, see `arenaBgm`). */
export const ROUND_WIN_BGM = "JA_BGM_FANFARE_WIN";
export const RESULT_BGM = "JA_BGM_RESULT";

/** The battle's audio: the shared player (@fso/web/audio) with the arenas' BGM. */
export class BattleAudio extends SynthAudio {
  private readonly stage: Stage;
  private readonly stageBgm: number[];

  private constructor(data: SynthData, stage: Stage, dol: Dol) {
    super(data, VOLUME_KEY);
    this.stage = stage;
    this.stageBgm = readStageBgmTable(dol);
  }

  /** Parses the audio data and starts decoding the waves in the background (no AudioContext yet). */
  static async load(read: (path: string) => Promise<Uint8Array>, stage: Stage, dol: Dol): Promise<BattleAudio> {
    return new BattleAudio(await SynthAudio.loadData(read), stage, dol);
  }

  /**
   * The arena's BGM: map500.csv's second field is the room's bgmId (the position of the adventure maps' bgmId), an
   * index into main.dol's stage BGM table (24 → JA_BGM_BATTLE_ZAKO; 16 → JA_BGM_BOSS for Above the Clouds).
   */
  arenaBgm(room: number): string | null {
    const bgmId = this.stage.battleRooms?.find((r) => r.room === room)?.columns[0];
    return this.bgmName(bgmId === undefined ? undefined : this.stageBgm[bgmId]);
  }

  /** Names the cues use that the disc lacks (should be empty). */
  missing(): string[] {
    return this.lacking(Object.values(BATTLE_SE).flat(), [ROUND_WIN_BGM, RESULT_BGM]);
  }
}

/** Cue windows: a cue fires if its cause started at most this many ticks ago. */
const WINDOW = 4;
const LAST_SECONDS = 5;

/** Turns battle states into BGM changes and sound effects, idempotently per cause (see the file comment). */
export class SoundCues {
  private readonly audio: BattleAudio;
  private readonly played = new Map<string, number>();
  private music: string | null = null;
  private room = -1;
  /** The held sounds playing (their tags, BATTLE_SE `hum` and `fuse`). */
  private readonly held = new Set<string>();

  constructor(audio: BattleAudio) {
    this.audio = audio;
  }

  /** A Link going through a door, a gate, a hole, a cannon, a magic circle (siderooms.ts), keyed by when it began. */
  private sideRoomCues(b: BattleState, f: Fighter, i: number, tick: number, cue: (key: string, start: number, names: readonly string[]) => void): void {
    const t = f.moveTick, start = tick - t, key = `${f.move}:${i}:${start}`;
    switch (f.move) {
      case "warp": {
        // Up into a door of style 0 or 3, a gate from the TV; down into 1, 2, 23, 24 or a gate from a GBA screen.
        const w = battleWarps(b)[f.warp];
        if (!w) return;
        const fromSide = screenAt(w.y * SUBPX) > 0;
        const down = [1, 2, 23, 24].includes(w.style) || (GATE_STYLES.has(w.style) && fromSide !== (w.style === 35));
        cue(key, start, down ? BATTLE_SE.doorDown : BATTLE_SE.doorUp);
        // Out onto the TV the same way, on his first step out (a GBA screen plays its own).
        if (screenAt(w.toY * SUBPX) === 0) cue(`${key}:out`, start + WARP_ENTER_TICKS + WARP_STAND_TICKS + 1, down ? BATTLE_SE.outDown : BATTLE_SE.outUp);
        return;
      }
      case "hole":
        return cue(key, start, BATTLE_SE.hole);
      case "cannon":
        return cue(key, start, BATTLE_SE.cannonIn);
      case "launch":
        if (f.warp < 0) cue(key, start, BATTLE_SE.cannonShot); // (from the cannon, before the top edge restarts the count)
        return;
      case "circle":
        return cue(key, start, BATTLE_SE.circleIn);
      case "circleBack":
        cue(key, start, BATTLE_SE.circleIn);
        cue(`${key}:out`, start + CIRCLE_TICKS - 2, BATTLE_SE.circleOut); // (he shows on the TV as it ends)
        return;
      case "spot":
        cue(key, start, BATTLE_SE.spot);
        cue(`${key}:out`, start + SPOT_ARRIVE_TICK + 60, BATTLE_SE.spotOut);
        return;
    }
  }

  /**
   * A new match: forget what was played (ticks restart at 0). `room` is the arena whose theme plays (free play takes
   * The Field's); `keepMusic`: the music playing goes on if the new match wants the same (free play restarting).
   */
  reset(room: number, keepMusic = false): void {
    this.played.clear();
    this.quiet();
    if (!keepMusic || room !== this.room || this.audio.currentBgm === null) this.music = null;
    this.room = room;
  }

  /** Stops the held sounds (the game paused); the next observed state starts what it still holds. */
  quiet(): void {
    for (const tag of this.held) this.audio.stopSe(tag);
    this.held.clear();
  }

  /** Starts and stops the held sounds to match the state: per circle at full size its hum, per burning giant bomb its fuse. */
  private holdSounds(b: BattleState): void {
    const want = new Map<string, readonly string[]>();
    if (b.phase !== "matchOver")
      for (const e of b.entities) {
        if (e.hp < 0) continue;
        if (e.kind === "circle" && e.timer >= CIRCLE_GROW_TICKS) want.set(`hum:${e.id}`, BATTLE_SE.hum);
        else if (e.kind === "bigBomb" && e.param === BIG_BOMB.burning) want.set(`fuse:${e.id}`, BATTLE_SE.fuse);
      }
    for (const tag of this.held) if (!want.has(tag)) (this.held.delete(tag), this.audio.stopSe(tag));
    for (const [tag, names] of want) if (!this.held.has(tag)) (this.held.add(tag), this.audio.playSe(names, 0, tag));
  }

  /** Call with each state the sim reaches (or any state shown); reads it only. */
  observe(game: GameState): void {
    const b = game.battle;
    if (!b) return;
    const tick = game.tick;
    const cue = (key: string, start: number, names: readonly string[], tag: string | null = null) => {
      if (tick - start > WINDOW || tick < start || this.played.has(key)) return;
      this.played.set(key, start);
      this.audio.playSe(names, tick, tag);
    };
    game.players.forEach((p, i) => {
      if (p.action === "swing" || p.action === "stab") cue(`swing:${i}:${tick - p.actionTick}`, tick - p.actionTick + 1, BATTLE_SE.swing);
      else if (p.action === "lunge") cue(`lunge:${i}:${tick - p.actionTick}`, tick - p.actionTick + 1, BATTLE_SE.lunge);
      else if (p.action === "spin") cue(`spin:${i}:${tick - p.actionTick}`, tick - p.actionTick + 1, BATTLE_SE.spin);
      // The charge counts held ticks only, so its "full" moment is keyed by when the count reached CHARGE.fullTicks; on
      // the release tick the count stops while the tick goes on, so only held ticks are looked at.
      else if (p.action === "charge" && p.actionTick >= CHARGE.fullTicks && p.held & Button.Sword) {
        const full = tick - (p.actionTick - CHARGE.fullTicks);
        cue(`charged:${i}:${full}`, full, BATTLE_SE.charged);
      }
    });
    b.fighters.forEach((f, i) => {
      // Moves: keyed by the tick they were decided on (a move's press tick has moveTick -1).
      if (f.mode === "active") {
        const moved = tick - f.moveTick - 1;
        if (f.move === "lift") cue(`lift:${i}:${moved}`, moved, f.carryLink >= 0 ? BATTLE_SE.liftLink : BATTLE_SE.lift);
        else if (f.move === "throw" && f.moveTick >= THROW_RELEASE_TICK) {
          const release = tick - (f.moveTick - THROW_RELEASE_TICK);
          cue(`throw:${i}:${release}`, release, BATTLE_SE.throw);
        } else if (f.move === "roll" && f.moveTick >= 0) cue(`roll:${i}:${moved}`, moved + 1, BATTLE_SE.roll);
        else if (f.move === "ride") cue(`epona:${i}:${tick - f.moveTick}`, tick - f.moveTick, BATTLE_SE.epona);
        else this.sideRoomCues(b, f, i, tick, cue);
      }
      const start = tick - f.modeTick;
      if (f.mode === "hurt") cue(`hurt:${i}:${start}`, start, BATTLE_SE.hit);
      else if (f.mode === "falling") {
        cue(`fall:${i}:${start}`, start, BATTLE_SE.fall);
        cue(`fallout:${i}:${start}`, start + FALL_START_TICKS + PIT_OUT_TICK, BATTLE_SE.fallOut);
      }
      else if (f.mode === "dying") cue(`death:${i}:${start}`, start, BATTLE_SE.death);
    });
    // A door opened (its tiles among the cut ones): when first seen, once a round (one sound for its two halves).
    const doors = b.props.doors ?? [];
    for (const tile of b.cut) if (doors.includes(tile) && !doors.includes(tile - 1)) cue(`door:${b.round}:${tile}`, tick, BATTLE_SE.doorOpen);
    // Blocks and clashes: the sim reports a block on its first tick only (a shield blocks without a state of its own).
    for (const h of b.hits) if (h.blocked) cue(`block:${h.victim}:${tick}`, tick, BATTLE_SE.block);
    // Entities: keyed by their id (unique in a match), started when they appeared.
    for (const e of b.entities) {
      if (e.hp < 0) continue;
      const age = e.tick - 1; // shots and explosions count their ticks from 1 on the tick they appear
      if (e.kind === "explosion") cue(`boom:${e.id}`, tick - age, BATTLE_SE.bomb);
      else if (e.kind === "arrow" && e.phase === "flying") cue(`arrow:${e.id}`, tick - age, BATTLE_SE.arrow);
      else if (e.kind === "arrow") cue(`stick:${e.id}`, tick - e.tick, BATTLE_SE.arrowStick);
      else if (e.kind === "boomerang") cue(`boomerang:${e.id}`, tick - age, BATTLE_SE.boomerang);
      else if (e.kind === "bomb" && e.owner >= 0 && e.home < 0 && e.timer > 0) cue(`bombset:${e.id}`, tick - (BOMB_FUSE - e.timer) + 1, BATTLE_SE.bombSet);
      else if (e.kind === "debris") {
        const names = e.param === DEBRIS.bush ? BATTLE_SE.cutGrass : e.param === DEBRIS.orb ? BATTLE_SE.orbBreak : null;
        if (names) cue(`debris:${e.id}`, tick - (DEBRIS_TICKS - e.timer) + 1, names);
      } else if (e.kind === "cucco" && e.phase === "chase") cue(`cucco:${e.id}`, tick - (CUCCO_TICKS - e.timer) + 1, BATTLE_SE.cucco);
      else if (e.kind === "angryCucco") cue(`cucco:${e.id}`, tick - e.tick + 1, BATTLE_SE.cucco);
      else if (e.kind === "jet" && e.phase === "active") cue(`jet:${e.id}:${tick - e.tick}`, tick - e.tick, BATTLE_SE.fire);
      // (Their states count from 0 on the tick they begin: giantbomb.ts.)
      else if (e.kind === "shadowLink" && e.param === SHADOW.sparkles) cue(`bbsl:${e.id}:${tick - e.tick}`, tick - e.tick, BATTLE_SE.shadowLink);
      else if (e.kind === "shadowLink" && e.param === SHADOW.holding) cue(`bbsl:${e.id}:${tick - e.tick}`, tick - e.tick, BATTLE_SE.makeBomb);
      else if (e.kind === "bigBomb" && e.param === BIG_BOMB.squashing) cue(`bbmb:${e.id}`, tick - e.tick, BATTLE_SE.bigBombLand);
      else if (e.kind === "circle" && e.timer > 0 && e.timer < CIRCLE_GROW_TICKS) {
        // Its size steps 1/50 a tick: the tick it began to open or close.
        const opening = circleOpen(b, e) || e.param > 0;
        if (opening) cue(`circle:${e.id}:${tick - e.timer + 1}`, tick - e.timer + 1, BATTLE_SE.circleOpen);
        else cue(`circle:${e.id}:${tick - (CIRCLE_GROW_TICKS - e.timer) + 1}`, tick - (CIRCLE_GROW_TICKS - e.timer) + 1, BATTLE_SE.circleClose);
      }
    }
    // With the round's screens (timeline.ts): "ready" as the first text comes in, "go" with Go!, the jingle with DRAW!.
    const phaseStart = tick - b.phaseTick;
    if (b.phase === "countdown") {
      cue(`ready:${phaseStart}`, phaseStart + INTRO.rival, BATTLE_SE.ready);
      cue(`go:${phaseStart}`, phaseStart + INTRO.go, BATTLE_SE.go);
      // The Links' own intro (main.dol 0x80253E6C's calls): the portals, the Links coming out, each player's zoom.
      cue(`portal:${phaseStart}`, phaseStart + INTRO.portal, BATTLE_SE.portal);
      cue(`appear:${phaseStart}`, phaseStart + INTRO.appear, BATTLE_SE.appear);
      INTRO.zooms.slice(0, Math.min(4, b.fighters.length)).forEach((at, i) => cue(`zoom:${phaseStart}:${i}`, phaseStart + at, BATTLE_SE.zoom));
    } else if (b.phase === "roundOver" && b.roundWinner < 0) cue(`draw:${phaseStart}`, phaseStart + ROUND_END.result, BATTLE_SE.draw);
    // The sparkle on the winner's raised sword (main.dol 0x801E6A18, with effects 203 + 204).
    if (b.phase === "roundOver" && b.roundWinner >= 0) cue(`sparkle:${phaseStart}`, phaseStart + ROUND_END.result, BATTLE_SE.sparkle);
    if (b.phase === "play" && b.rules.timeLimit > 0 && b.timeLeft > 0) {
      const second = Math.ceil(b.timeLeft / 60);
      if (second <= LAST_SECONDS) cue(`count:${b.round}:${second}`, tick - (60 * second - b.timeLeft), BATTLE_SE[`count${second as 1 | 2 | 3 | 4 | 5}`]);
      // (the warning plays whether its message shows or not; a limit of 30 s never counts down to 30 s left)
      for (const { left } of TIMER_MESSAGES)
        if (b.rules.timeLimit > left && b.timeLeft <= left) cue(`warning:${b.round}:${left}`, tick - (left - b.timeLeft), BATTLE_SE.warning);
    }
    // The message window's sound with each message it takes (timeline.ts), on the tick it's asked for.
    for (const m of acceptedMessages(b, tick)) {
      const sound = messageSound(m.id);
      if (sound) cue(`message:${m.id}:${m.player}:${m.tick}`, m.tick, BATTLE_SE[sound]);
    }
    this.holdSounds(b);
    // Music follows the phase: the arena's theme through countdown and play (and free play) and up to the result
    // banner, then a fanfare for a round won, then results.
    const music =
      b.phase === "countdown" || b.phase === "play" || b.phase === "free" || (b.phase === "roundOver" && b.phaseTick < ROUND_END.result)
        ? `stage:${this.room}`
        : b.phase === "roundOver"
          ? b.roundWinner >= 0
            ? `win:${b.round}`
            : `none:${b.round}`
          : "result";
    if (music !== this.music) {
      this.music = music;
      const name = music.startsWith("stage") ? this.audio.arenaBgm(this.room) : music.startsWith("win") ? ROUND_WIN_BGM : music === "result" ? RESULT_BGM : null;
      this.audio.playBgm(name, tick);
    }
    for (const [key, start] of this.played) if (start < tick - 600 || start > tick + 600) this.played.delete(key);
  }
}
