// Particle effects driven from a game state: each rendered frame the caller lists the effects the state has now (an
// explosion since its first tick, a flame while it burns…), each keyed and with the tick it started, and `sync` steps
// the matching emitters to the current 60 Hz tick. An effect's particles depend only on its key, start tick and
// placement, so presentation can be rebuilt after a netcode rollback: a one-shot effect seen at an earlier tick than
// last time is replayed from its start, one whose start tick changed is replaced, one whose start lies in the future
// is dropped (the rollback undid it), and one that just isn't listed any more stops emitting and plays out. Endless
// effects (flames) skip ahead instead of replaying their whole past. Nothing here feeds back into the game state.
import { actorPixel, fsaActorParticles, fsaParticlePlacement, type FsaParticlePlacement, type Jpac, type JpaResource, type Stage } from "@fso/formats";
import { JpaEmitter } from "./emitter.ts";
import { FSA_VIEW, JpaRenderer, type JpaSceneMapping } from "./draw.ts";
import { computeModelMatrixR, m4identity, type M4 } from "./math.ts";

const TURN = (Math.PI * 2) / 0x10000;

/**
 * The effects a stage's actors keep up while they rest (fsaActorParticles: waterfall spray, torches, eternal flames,
 * fire-pit flames, fire bars, whirlpools), in stage pixels (room cell × 512 / 384 + the actor's spot), keyed by room
 * and actor.
 */
export function stageParticles(stage: Stage): { room: number; actor: string; spec: JpaEffectSpec }[] {
  const out: { room: number; actor: string; spec: JpaEffectSpec }[] = [];
  stage.layout.rooms.forEach((row, cy) =>
    row.forEach((room, cx) => {
      if (room === null) return;
      stage.actors(room).forEach((actor, k) => {
        if (actor.sublayer !== 0) return;
        const px = actorPixel(actor), x = cx * 512 + px.x, y = cy * 384 + px.y;
        fsaActorParticles(actor.id, actor.params, px).forEach((p, n) => {
          const placement = fsaParticlePlacement(p.id, x + p.dx, y + p.dy, 0, { layer: p.layer, sublayer: p.sublayer, scale: p.scale });
          if (!placement) return;
          if (p.rotation) placement.rotation = p.rotation;
          out.push({ room, actor: actor.id, spec: { key: `stage:${room}:${k}:${n}`, start: 0, placement } });
        });
      });
    }),
  );
  return out;
}

/** Places an emitter as FSA's createEffect (and the actor's own moves and turns) left it. */
export function placeEmitter(e: JpaEmitter, p: FsaParticlePlacement): void {
  const r = e.rotation;
  if (p.rotation === "swapYZ") {
    m4identity(r);
    r[5] = r[10] = 0;
    r[6] = r[9] = 1;
  } else if (p.rotation === "none") m4identity(r);
  else computeModelMatrixR(r, p.rotation[0] * TURN, p.rotation[1] * TURN, p.rotation[2] * TURN);
  e.dynamicsScale.set(p.dynamicsScale);
  e.translation.set(p.translation);
  e.particleScale[0] = p.particleScale[0];
  e.particleScale[1] = p.particleScale[1];
}

export interface JpaEffectSpec {
  /** Identity across frames (e.g. the entity's id and kind). */
  key: string;
  placement: FsaParticlePlacement;
  /** The 60 Hz tick the effect started on. */
  start: number;
  /** The tick it stops emitting (its particles play out), if known. */
  stop?: number;
  /**
   * The scene depth its particles are drawn at, in place of the mapping's (an effect the game sorts with the sprites
   * rather than over them).
   */
  sceneZ?: number;
  /** Once it's no longer listed its particles vanish at once (the game deletes the emitter), instead of playing out. */
  vanish?: boolean;
}

interface Live {
  emitter: JpaEmitter;
  id: number;
  start: number;
  /** The tick the emitter has been stepped to. */
  tick: number;
  endless: boolean;
  placement: FsaParticlePlacement;
  stop: number | undefined;
  vanish: boolean;
  dead: boolean;
}

/** Frames an endless effect is warmed up over when it starts long after its start tick (or is rebuilt). */
export const WARMUP_TICKS = 150;
/** Most frames one effect is stepped by one `sync` (a page that slept doesn't replay minutes). */
const MAX_STEPS = 600;

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export class JpaEffects {
  readonly renderer: JpaRenderer;
  private readonly jpac: Jpac;
  private readonly live = new Map<string, Live>();
  /** Resident emitters of queued effects, by effect id, and the tick they were stepped to. */
  private readonly resident = new Map<number, { emitter: JpaEmitter; tick: number }>();

  /** `view`: the game's view matrix the effects are drawn through (the TV's by default; the title screen's is identity). */
  constructor(jpac: Jpac, mapping: JpaSceneMapping, view: M4 = FSA_VIEW) {
    this.jpac = jpac;
    this.renderer = new JpaRenderer(jpac, mapping, view);
  }

  get group() {
    return this.renderer.group;
  }

  /** Live emitters (for tests and stats). */
  get emitterCount(): number {
    return this.live.size + this.resident.size;
  }

  /** The effect ids of the listed effects' emitters, and of those playing out (for tests). */
  liveIds(): number[] {
    return [...this.live.values()].map((l) => l.id);
  }

  /** The emitter of a listed effect (for tests). */
  emitterOf(key: string): JpaEmitter | undefined {
    return this.live.get(key)?.emitter;
  }

  resource(id: number): JpaResource | null {
    return this.jpac.resources[id] ?? null;
  }

  /** Steps every listed effect to `tick` (and the unlisted ones out), then draws them. */
  sync(tick: number, specs: readonly JpaEffectSpec[]): void {
    const seen = new Set<string>();
    const queued = new Map<number, number[][]>();
    for (const spec of specs) {
      const p = spec.placement;
      if (p.queued) {
        let list = queued.get(p.id);
        if (!list) queued.set(p.id, (list = []));
        list.push(p.translation);
        continue;
      }
      const res = this.jpac.resources[p.id];
      if (!res || seen.has(spec.key)) continue;
      seen.add(spec.key);
      let live = this.live.get(spec.key);
      if (live && (live.id !== p.id || live.start !== spec.start || (tick < live.tick && !live.endless))) {
        this.drop(spec.key, live);
        live = undefined;
      }
      if (!live) {
        const emitter = new JpaEmitter(res, hash(`${spec.key}/${spec.start}/${p.id}`));
        live = { emitter, id: p.id, start: spec.start, tick: spec.start - 1, endless: res.dynamics.maxFrame === 0, placement: p, stop: spec.stop, vanish: false, dead: false };
        if (live.endless && tick - live.tick > WARMUP_TICKS) {
          // Skip what's older than the warm-up: the emitter starts that late, with its age where it would be.
          emitter.age = tick - WARMUP_TICKS - spec.start;
          live.tick = tick - WARMUP_TICKS - 1;
        }
        this.live.set(spec.key, live);
      }
      live.placement = p;
      live.emitter.sceneZ = spec.sceneZ ?? null;
      live.stop = spec.stop;
      live.vanish = spec.vanish ?? false;
      this.advance(live, tick);
    }
    for (const [key, live] of this.live) {
      // A finished effect stays while it's listed (dropping it would replay it).
      if (seen.has(key)) continue;
      if (live.start > tick || tick < live.tick || live.vanish) {
        this.drop(key, live);
        continue;
      }
      // As the game ends an effect (stop, maxFrame 1): done once its particles are gone.
      live.emitter.becomeInvalid();
      this.advance(live, tick);
      if (live.dead) this.drop(key, live);
    }
    // Resident emitters step whenever the tick moves (their particles play out with nothing queued).
    for (const id of queued.keys()) {
      if (this.resident.has(id) || !this.jpac.resources[id]) continue;
      // FSA makes them endless (0x8013DDEC clears their maxFrame).
      const emitter = new JpaEmitter(this.jpac.resources[id]!, hash(`resident/${id}`));
      emitter.maxFrame = 0;
      this.resident.set(id, { emitter, tick: tick - 1 });
    }
    for (const [id, r] of this.resident) {
      const positions = queued.get(id) ?? [];
      if (tick < r.tick) r.tick = tick - 1;
      const steps = Math.min(tick - r.tick, 4);
      for (let i = 0; i < steps; i++) r.emitter.stepQueued(i === steps - 1 ? positions : []);
      r.tick = tick;
      if (!positions.length && !r.emitter.particleCount) {
        r.emitter.dispose();
        this.resident.delete(id);
      }
    }
    this.renderer.draw(this.emitters());
  }

  private *emitters(): Iterable<JpaEmitter> {
    for (const live of this.live.values()) yield live.emitter;
    for (const r of this.resident.values()) yield r.emitter;
  }

  private advance(live: Live, tick: number): void {
    const e = live.emitter;
    let steps = 0;
    while (live.tick < tick && !live.dead && steps++ < MAX_STEPS) {
      live.tick++;
      placeEmitter(e, live.placement);
      if (live.stop !== undefined && live.tick >= live.stop) e.stopCreateParticle();
      if (!e.step()) live.dead = true;
    }
    if (live.tick < tick) live.tick = tick;
  }

  private drop(key: string, live: Live): void {
    live.emitter.dispose();
    this.live.delete(key);
  }

  /** Drops every effect (a new round or arena). */
  clear(): void {
    for (const [key, live] of this.live) this.drop(key, live);
    for (const r of this.resident.values()) r.emitter.dispose();
    this.resident.clear();
    this.renderer.draw([]);
  }

  dispose(): void {
    this.clear();
    this.renderer.dispose();
  }
}
