// The Hyrulean Adventure's audio: each stage's BGM and the adventure's sound effects, played by the shared synth player
// (@fso/web/audio, as Shadow Battle's). `AdventureAudio` adds the stages' BGM; `AdventureCues` turns the adventure's
// states into sounds without ever writing to them.
//
// Triggering: the sim has no sound events; a cue is read off the state after each tick, either keyed by the tick its
// cause started (a swing's `tick - actionTick`, a hurt's `tick - modeTick`, as apps/battle's SoundCues) or by what
// changed since the last state seen in the same area (a pickup gone, an enemy's life down, a switch turned on, a chest
// opened). Observing the same state again plays nothing. Everything resets when the Links change area.
//
// Which sound for which action: the Link's own sounds as Shadow Battle's (BATTLE_SE there); the stage BGM from main.dol's
// table; the rest by name (see ADVENTURE_SE), noted where main.dol's code plays the id.
import { readStageBgmTable } from "@fso/audio";
import type { Dol } from "@fso/formats";
import { Button, CHARGE, DEBRIS, ownSwitch, THROW_RELEASE_TICK } from "@fso/sim";
import { BLADE_STATE, FIRE_TRAP_KIND, GEM_VALUES, pageTyped, shutDoors, talkTyped, type AdventureGame, type AdventureStage } from "@fso/sim/adventure";
import { SynthAudio, type SynthData } from "@fso/web/audio";

const VOLUME_KEY = "fso.adventure.volume";

/**
 * The sound effects the cues use (JA_SE_* names from the BST name table). "game": main.dol's code plays the id with a
 * constant (tools/dol `callers` of the actor and Link sound functions); the others are picked by name (assumed).
 */
export const ADVENTURE_SE = {
  // The Link's sword and voice, as apps/battle plays them.
  swing: ["JA_SE_LK_SWORD_WIELD"],
  lunge: ["JA_SE_LK_SWORD_WIELD", "JA_SE_V_SWORD_SWING"],
  charged: ["JA_SE_LK_CHARGING"],
  spin: ["JA_SE_LK_TAMEGIRI", "JA_SE_V_TAMEGIRI"],
  hurt: ["JA_SE_V_DAMAGE"], // (game: the Link's damage states)
  fall: ["JA_SE_V_FALL_DOWN"], // (game)
  death: ["JA_SE_V_DOWN", "JA_SE_LINK_DOWN"],
  // Enemies: struck and beaten (game: both ids are played by enemy code); the sword soldiers' own (assumed); Phantom
  // Ganon's (game: PGANON_DAMAGE; the rest assumed).
  enemyHit: ["JA_SE_CHR_ENEMY_DAMAGE"],
  enemyDown: ["JA_SE_CHR_ENEMY_DOWN"],
  soldierHit: ["JA_SE_CHR_SOLDIER_DAMAGE"],
  soldierDown: ["JA_SE_CHR_SOLDIER_DOWN"],
  octorokSpit: ["JA_SE_CHR_OCTA_FIRE"], // (game)
  // The traps (game: FBGE's shot, TRAP's slide and its stop against a wall; sim traps.ts).
  fireTrap: ["JA_SE_OBJ_ZORA_TAMA"],
  trapMove: ["JA_SE_OBJ_TRAP_MOVE"],
  trapBound: ["JA_SE_OBJ_TRAP_BOUND"],
  ganonHit: ["JA_SE_CHR_PGANON_DAMAGE"],
  ganonDown: ["JA_SE_CHR_PGANON_DIE", "JA_SE_CHR_BOSS_DOWN"],
  // Pickups (assumed): a Force Gem by its size (worth under 50: the small ones; 50 and more: the big ones), a heart,
  // a key or an item; a dropped gem landing (game: RUPY's bound).
  gem: ["JA_SE_LK_COIN"],
  bigGem: ["JA_SE_LK_BIG_COIN"],
  gemLand: ["JA_SE_OBJ_RUPY_BOUND"],
  heart: ["JA_SE_HEART_RECOVER"],
  key: ["JA_SE_LK_NORM_ITEM_GET"],
  item: ["JA_SE_LK_NORM_ITEM_GET"],
  // Things (game: each id played by object code with a constant; which object for the door, the chest and the switch is
  // assumed): a chest, a door opening (a locked one: the key turning first, assumed), shutting, a floor switch or
  // the four Links' switch going on.
  chest: ["JA_SE_OBJ_TBOX_OPEN"],
  unlock: ["JA_SE_LK_UNLOCK"],
  doorOpen: ["JA_SE_OBJ_DOOR_OPEN"],
  doorClose: ["JA_SE_OBJ_DOOR_CLOSE"],
  switch: ["JA_SE_OBJ_SWITCH"],
  // Cutting and breaking (game: CUT_GRASS and POT_BREAK), lifting and throwing (game: LK_THROW in the Link's throw,
  // OBJ_LIFT, TAKE_UP_BIGROCK), bombs and gear as apps/battle.
  cutGrass: ["JA_SE_OBJ_CUT_GRASS"],
  potBreak: ["JA_SE_OBJ_POT_BREAK"],
  lift: ["JA_SE_OBJ_LIFT"],
  liftRock: ["JA_SE_OBJ_TAKE_UP_BIGROCK"],
  throw: ["JA_SE_LK_THROW"],
  bomb: ["JA_SE_OBJ_BOMB_BURST"],
  bombSet: ["JA_SE_LK_BOMB_SET"],
  boomerang: ["JA_SE_LK_BOOMERANG"],
  arrow: ["JA_SE_LK_ARROW_SHOOT"],
  // Water (game: the Link's swim code plays LK_PLUNGE and LK_SWIM): into deep water, each stroke.
  plunge: ["JA_SE_LK_PLUNGE"],
  swim: ["JA_SE_LK_SWIM"],
  // The message box (assumed): opening, its typing (a blip every TYPE_BLIP characters), a page turned, closing.
  msgOpen: ["JA_SE_MSG_OPEN"],
  type: ["JA_SE_CHAR_DISP"],
  page: ["JA_SE_PAGE_CHANGE"],
  msgClose: ["JA_SE_MSG_CLOSE"],
} as const satisfies Record<string, readonly string[]>;
export type AdventureCue = keyof typeof ADVENTURE_SE;

/** Jingles and boss music (assumed by name): an item or a chest's content got, the stage cleared, Phantom Ganon. */
export const ITEM_BGM = "JA_BGM_ITEM";
export const CLEAR_BGM = "JA_BGM_FANFARE";
export const BOSS_BGM = "JA_BGM_BOSS";
/** The message box's blip every this many characters typed (one a tick). */
const TYPE_BLIP = 3;
/** The worth from which a Force Gem is a big one (its pickup sound). */
const BIG_GEM = 50;

/** The adventure's audio: the shared player with the stages' BGM. */
export class AdventureAudio extends SynthAudio {
  private readonly stageTable: number[];

  private constructor(data: SynthData, dol: Dol) {
    super(data, VOLUME_KEY);
    this.stageTable = readStageBgmTable(dol);
  }

  /** Parses the audio data and starts decoding the waves in the background (no AudioContext yet). */
  static async load(read: (path: string) => Promise<Uint8Array>, dol: Dol): Promise<AdventureAudio> {
    return new AdventureAudio(await SynthAudio.loadData(read), dol);
  }

  /** A stage's BGM: its map CSV's bgmId, an index into main.dol's stage BGM table (Lake Hylia: JA_BGM_WATER_FIELD). */
  stageBgm(bgmId: number): string | null {
    return this.bgmName(this.stageTable[bgmId]);
  }

  /** Names the cues use that the disc lacks (should be empty). */
  missing(): string[] {
    return this.lacking(Object.values(ADVENTURE_SE).flat(), [ITEM_BGM, CLEAR_BGM, BOSS_BGM]);
  }
}

/** What the cues compare the next state with (the last state seen in the same area). */
interface Seen {
  area: string;
  pickups: Map<number, { type: string; kind: number; z: number }>;
  enemies: Map<number, { life: number; state: string; shot: number; angle: number }>;
  switches: number;
  keys: number;
  opened: number;
  gates: number;
  shut: number;
  modes: string[];
  ganon: { hp: number; state: number } | null;
  heavy: string;
  talk: { message: number; page: number; typed: number; close: boolean } | null;
}

/** Cue windows: a cue keyed by its start fires if it started at most this many ticks ago. */
const WINDOW = 4;
const SOLDIERS = /^SLR/;
/** Phantom Ganon's state once the blow that beats him lands (phantomganon.ts swordsOnGanon). */
const GANON_BEATEN = 22;

/** Turns adventure states into BGM changes and sound effects (see the file comment). */
export class AdventureCues {
  private readonly audio: AdventureAudio;
  private readonly stage: AdventureStage;
  private readonly bgm: string | null;
  private readonly played = new Map<string, number>();
  private seen: Seen | null = null;
  private music = "";

  /** `bgm`: the stage's BGM (AdventureAudio.stageBgm). */
  constructor(audio: AdventureAudio, stage: AdventureStage, bgm: string | null) {
    this.audio = audio;
    this.stage = stage;
    this.bgm = bgm;
  }

  /** Call with each state the sim reaches; reads it only. `quiet`: takes it in without a sound (a replay catching up). */
  observe(game: AdventureGame, quiet = false): void {
    const a = game.adventure, b = game.battle, tick = game.tick;
    const cue = (key: string, start: number, name: AdventureCue) => {
      if (tick - start > WINDOW || tick < start || this.played.has(key)) return;
      this.played.set(key, start);
      if (!quiet) this.audio.playSe(ADVENTURE_SE[name], tick);
    };
    const now = (name: AdventureCue) => !quiet && this.audio.playSe(ADVENTURE_SE[name], tick);
    const area = `${a.room}:${a.area}`;
    if (this.seen && this.seen.area !== area) this.played.clear();
    const before = this.seen?.area === area ? this.seen : null;
    const present = a.away ? 1 : game.players.length;

    // The Links: their sword (one sound for the Links swinging together), hurt, falling, dying, lifting and throwing.
    for (let i = 0; i < present; i++) {
      const p = game.players[i]!, f = b.fighters[i]!;
      const start = tick - p.actionTick + 1;
      if (p.action === "swing" || p.action === "stab") cue(`swing:${start}`, start, "swing");
      else if (p.action === "lunge") cue(`lunge:${start}`, start, "lunge");
      else if (p.action === "spin") cue(`spin:${start}`, start, "spin");
      else if (p.action === "charge" && p.actionTick >= CHARGE.fullTicks && p.held & Button.Sword) {
        const full = tick - (p.actionTick - CHARGE.fullTicks);
        cue(`charged:${full}`, full, "charged");
      }
      const since = tick - f.modeTick;
      if (f.mode === "hurt") cue(`hurt:${since}`, since, "hurt");
      else if (f.mode === "falling") cue(`fall:${since}`, since, "fall");
      else if (f.mode === "dying") cue(`death:${since}`, since, "death");
      if (f.mode === "active") {
        const moved = tick - f.moveTick - 1;
        if (f.move === "lift") cue(`lift:${moved}`, moved, "lift");
        else if (f.move === "throw" && f.moveTick >= THROW_RELEASE_TICK) {
          const release = tick - (f.moveTick - THROW_RELEASE_TICK);
          cue(`throw:${release}`, release, "throw");
        }
      }
    }
    // The arena's things: bushes cut, pots broken, blasts, the gear's shots (by entity id, once each).
    for (const e of b.entities) {
      if (e.hp < 0) continue;
      if (e.kind === "debris" && e.param === DEBRIS.bush) cue(`debris:${e.id}`, tick, "cutGrass");
      else if (e.kind === "debris" && e.param === DEBRIS.pot) cue(`debris:${e.id}`, tick, "potBreak");
      else if (e.kind === "explosion") cue(`boom:${e.id}`, tick, "bomb");
      else if (e.kind === "boomerang") cue(`boomerang:${e.id}`, tick, "boomerang");
      else if (e.kind === "arrow" && e.phase === "flying") cue(`arrow:${e.id}`, tick, "arrow");
      else if (e.kind === "bomb" && e.owner >= 0 && e.home < 0) cue(`bombset:${e.id}`, tick, "bombSet");
    }

    const seen: Seen = {
      area,
      pickups: new Map(a.pickups.map((p) => [p.id, { type: p.type, kind: p.kind, z: p.z }])),
      enemies: new Map(a.enemies.map((e) => [e.id, { life: e.life, state: e.state, shot: e.shot, angle: e.angle }])),
      switches: b.switches,
      keys: a.keys,
      opened: a.opened.length,
      gates: a.gates.length,
      shut: shutDoors(game, this.stage).length,
      modes: a.links.map((m) => m.mode),
      ganon: a.ganon && !a.ganon.gone ? { hp: a.ganon.hp, state: a.ganon.state } : null,
      heavy: a.heavy?.phase ?? "",
      talk: a.talk ? { message: a.talk.message, page: a.talk.page, typed: talkTyped(a.talk), close: a.talk.close > 0 } : null,
    };
    if (before) {
      // Pickups taken (gone from the area's list), dropped gems landing (one sound a tick).
      let landed = false;
      for (const [id, p] of before.pickups) {
        const still = seen.pickups.get(id);
        if (still) {
          if (p.z > 0 && still.z === 0) landed = true;
          continue;
        }
        if (p.type === "gem") now((GEM_VALUES[p.kind] ?? 0) >= BIG_GEM ? "bigGem" : "gem");
        else if (p.type === "heart") now("heart");
        else if (p.type === "item") now("item");
      }
      if (landed) now("gemLand");
      if (seen.keys > before.keys) now("key");
      // Enemies struck (their life down) and beaten.
      for (const e of a.enemies) {
        const was = before.enemies.get(e.id);
        const soldier = SOLDIERS.test(e.type);
        if (!was) {
          if (e.type === "OKTM") now(e.kind === FIRE_TRAP_KIND ? "fireTrap" : "octorokSpit");
          continue;
        }
        // A blade trap off (its slide), and stopped dead (its sparks).
        if (e.type === "TRAP") {
          if (e.shot === BLADE_STATE.slide && was.shot !== BLADE_STATE.slide) now("trapMove");
          if (e.angle !== was.angle && e.angle >= 0) now("trapBound");
          continue;
        }
        if (e.state === "die" && was.state !== "die") now(soldier ? "soldierDown" : "enemyDown");
        else if (e.life < was.life) now(soldier ? "soldierHit" : "enemyHit");
      }
      if (seen.ganon && before.ganon && seen.ganon.hp < before.ganon.hp) now(seen.ganon.state === GANON_BEATEN ? "ganonDown" : "ganonHit");
      // Switches turned on: the area's floor switches and four-Link switches.
      const on = (seen.switches & ~before.switches) >>> 0;
      if (on && this.physicalSwitches(game) & on) now("switch");
      // A chest opened; a locked door unlocked; doors opening or shutting (by a switch, the room's enemies).
      if (seen.opened > before.opened) now("chest");
      if (seen.shut < before.shut || seen.gates > before.gates) now("doorOpen");
      else if (seen.shut > before.shut) now("doorClose");
      // Into deep water (the leader).
      const m = a.links[0]!;
      if ((m.mode === "swim" || m.mode === "wade") && before.modes[0] !== "swim" && before.modes[0] !== "wade") now("plunge");
      // The two-Link rock.
      if (seen.heavy === "lift" && before.heavy !== "lift") now("liftRock");
      else if (seen.heavy === "throw" && before.heavy !== "throw") now("throw");
      // The message box.
      const t = seen.talk, was = before.talk;
      if (t && (!was || was.message !== t.message)) now("msgOpen");
      else if (t && was && t.page > was.page) now("page");
      else if (t && was && t.close && !was.close) now("msgClose");
      if (t && a.talk && t.typed > 0 && (!was || t.typed !== was.typed) && t.typed % TYPE_BLIP === 1 && !pageTyped(a.talk, this.stage)) now("type");
    }
    // Each stroke the leader swims (its animation's first tick, moving).
    const lead = a.links[0]!;
    if (lead.mode === "swim" && lead.tick === 0 && lead.speed > 0) cue(`swim:${tick}`, tick, "swim");
    if (a.opening) cue(`unlock:${tick - a.opening.tick}`, tick - a.opening.tick, "unlock");
    this.seen = seen;

    // Music: the stage's BGM; Phantom Ganon's fight; a jingle while an item got is held up; the fanfare once cleared.
    const music = a.cleared ? "clear" : a.get ? `item:${tick - a.get.tick}` : a.ganon && !a.ganon.gone ? "boss" : "stage";
    if (music !== this.music) {
      this.music = music;
      const name = music === "clear" ? CLEAR_BGM : music.startsWith("item") ? ITEM_BGM : music === "boss" ? BOSS_BGM : this.bgm;
      this.audio.playBgm(name, tick);
    }
    for (const [key, start] of this.played) if (start < tick - 600 || start > tick + 600) this.played.delete(key);
  }

  /** The switch bits of the area's floor switches (SWTH) and four-Link switches (YNSW). */
  private physicalSwitches(game: AdventureGame): number {
    let bits = 0;
    for (const e of game.battle.entities) if (e.kind === "switch") bits |= 1 << e.param;
    for (const actor of this.stage.area(game.adventure.room, game.adventure.area).actors) if (actor.id === "YNSW") bits |= 1 << ownSwitch(actor.params);
    return bits >>> 0;
  }
}
