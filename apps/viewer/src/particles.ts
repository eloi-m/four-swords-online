// The viewer's JPA particles (data.arc's particle.jpc, docs/formats/jpa.md "JPA particles"):
// - the effect browser: any of the 1394 effects played at the view's center as the game places it (createEffect's
//   rotation and scale for its id) or raw, looped. Deep link `#jpa=<id>` (`&jpatick=N` freezes it N frames in,
//   `&jpascale=<s>` its scale, `&jparaw` without the game's placement);
// - with the 3D effects (`&effects`), the effects the stage's actors keep up while they rest (fsaActorParticles:
//   waterfall spray, torches, eternal flames, fire-pit flames, fire bars).
// Particles are drawn over the top tile layer, through the game's TV view (y down, like the game shows them).
import {
  fsaParticleGroup,
  fsaParticlePlacement,
  JpaShape,
  parseJpac,
  type FsaParticlePlacement,
  type Jpac,
  type JpaResource,
  type RarcArchive,
  type Stage,
} from "@fso/formats";
import { JpaEffects, stageParticles, type JpaEffectSpec } from "@fso/render";
import type { MapView } from "./scene.ts";

const SHAPES = Object.fromEntries(Object.entries(JpaShape).map(([name, v]) => [v, name.toLowerCase().replace(/_/g, " ")]));
const VOLUMES = ["cube", "sphere", "cylinder", "torus", "point", "circle", "line"];
const RESTART_PAUSE = 30; // frames between loops

export interface ParticleUi {
  enabled: HTMLInputElement;
  panel: HTMLElement;
  id: HTMLInputElement;
  list: HTMLSelectElement;
  play: HTMLInputElement;
  loop: HTMLInputElement;
  fsa: HTMLInputElement;
  info: HTMLElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  restart: HTMLButtonElement;
}

export class ViewerParticles {
  private readonly view: MapView;
  private readonly ui: ParticleUi;
  private jpac: Jpac | null = null;
  private effects: JpaEffects | null = null;
  private stageSpecs: JpaEffectSpec[] = [];
  private stageStart: number | null = null;
  private browse: { id: number; at: { x: number; y: number }; start: number | null; run: number; ended: number | null } | null = null;
  private readonly frozen: number | null;
  private readonly scale: number;
  /** Frames played (it stands still while paused). */
  private time = 0;
  private lastTick = -1;
  private changed = true;

  constructor(view: MapView, ui: ParticleUi) {
    this.view = view;
    this.ui = ui;
    const link = new URLSearchParams(location.hash.slice(1));
    this.frozen = link.has("jpatick") ? Number(link.get("jpatick")) : null;
    this.scale = link.has("jpascale") ? Number(link.get("jpascale")) : 1;
    if (link.has("jparaw")) ui.fsa.checked = false;
    view.addTickListener((tick) => this.step(tick));
    ui.enabled.addEventListener("change", () => this.showBrowser(ui.enabled.checked ? Number(ui.id.value) : null));
    ui.id.addEventListener("change", () => this.select(Number(ui.id.value)));
    ui.list.addEventListener("change", () => this.select(Number(ui.list.value)));
    ui.prev.addEventListener("click", () => this.select(Number(ui.id.value) - 1));
    ui.next.addEventListener("click", () => this.select(Number(ui.id.value) + 1));
    ui.restart.addEventListener("click", () => this.restart());
    ui.fsa.addEventListener("change", () => this.restart());
  }

  /** What was drawn in the last frame (for tests). */
  get stats(): { draws: number; particles: number; emitters: number } {
    return { ...(this.effects?.renderer.stats ?? { draws: 0, particles: 0 }), emitters: this.effects?.emitterCount ?? 0 };
  }

  /** Reads particle.jpc from data.arc; returns the effect the deep link asks for, if any. */
  load(data: RarcArchive): number | null {
    const file = data.files.find((f) => f.path === "particle.jpc");
    this.effects?.dispose();
    this.effects = null;
    this.jpac = file ? parseJpac(file.data) : null;
    this.ui.enabled.disabled = !this.jpac;
    if (!this.jpac) return null;
    this.effects = new JpaEffects(this.jpac, { zBase: 2.2, zScale: 1 / 8192 });
    this.view.overlay.add(this.effects.group);
    this.ui.list.replaceChildren(...this.jpac.resources.map((r) => new Option(this.label(r), String(r.id))));
    this.ui.id.max = String(this.jpac.resources.length - 1);
    const wanted = new URLSearchParams(location.hash.slice(1)).get("jpa");
    return wanted === null ? null : Number(wanted);
  }

  /** Opens the browser on effect `id` (null closes it). */
  showBrowser(id: number | null): void {
    this.ui.enabled.checked = id !== null;
    this.ui.panel.hidden = id === null;
    this.changed = true;
    if (id === null) this.browse = null;
    else this.select(id);
  }

  /** The effects a stage's actors keep up (shown with the 3D effects). Returns a one-line summary. */
  showStage(stage: Stage | null, enabled: boolean): string {
    this.stageSpecs = [];
    this.stageStart = null;
    this.changed = true;
    if (!stage || !enabled || !this.jpac) return "";
    const counts = new Map<string, number>();
    const seen = new Set<string>();
    for (const { room, actor, spec } of stageParticles(stage)) {
      this.stageSpecs.push(spec);
      const one = `${room}:${spec.key.split(":")[2]}`;
      if (!seen.has(one)) counts.set(actor, (counts.get(actor) ?? 0) + 1);
      seen.add(one);
    }
    return counts.size ? `Particles: ${[...counts].map(([id, n]) => `${id} ×${n}`).join(", ")}` : "Particles: none known for this stage";
  }

  private label(r: JpaResource): string {
    const tex = [...new Set(r.textureIds.map((t) => this.jpac!.textures[t]?.name ?? "?"))].slice(0, 2).join(", ");
    return `${r.id} · ${SHAPES[r.baseShape.shapeType] ?? "?"} · ${tex}`;
  }

  private select(id: number): void {
    if (!this.jpac) return;
    id = Math.max(0, Math.min(this.jpac.resources.length - 1, Number.isFinite(id) ? id : 0));
    this.ui.id.value = String(id);
    this.ui.list.value = String(id);
    this.ui.panel.hidden = false;
    this.ui.enabled.checked = true;
    this.browse = { id, at: this.view.centerPixel, start: null, run: (this.browse?.run ?? 0) + 1, ended: null };
    this.ui.info.textContent = this.describe(this.jpac.resources[id]!);
    this.changed = true;
  }

  private restart(): void {
    if (this.browse) this.select(this.browse.id);
  }

  private placement(id: number, x: number, y: number): FsaParticlePlacement | null {
    const p = fsaParticlePlacement(id, x, y, 0, { scale: this.scale, userFlags: this.jpac!.resources[id]?.dynamics.userFlags });
    if (!p) return null;
    if (!this.ui.fsa.checked) return { ...p, rotation: "none", dynamicsScale: [this.scale, this.scale, this.scale], queued: false };
    // A queued effect is browsed on its own emitter, as the resident one would draw it there.
    return p.queued ? { ...p, queued: false } : p;
  }

  private step(viewTick: number): boolean {
    if (!this.effects) return false;
    const delta = this.lastTick < 0 ? 0 : Math.max(0, viewTick - this.lastTick);
    this.lastTick = viewTick;
    if (this.frozen !== null) {
      // Frozen: everything starts at 0 and is shown `jpatick` frames in.
      if (!this.changed) return false;
      this.changed = false;
      const specs = this.stageSpecs.map((s) => ({ ...s, start: 0 }));
      const b = this.browse;
      const placement = b && this.placement(b.id, b.at.x, b.at.y);
      if (b && placement) specs.push({ key: `browse:${b.run}`, start: 0, placement });
      this.effects.sync(this.frozen, specs);
      return true;
    }
    if (this.ui.play.checked) this.time += delta;
    else if (!this.changed) return false;
    this.changed = false;
    const tick = this.time;
    this.stageStart ??= tick;
    const specs: JpaEffectSpec[] = this.stageSpecs.map((s) => ({ ...s, start: this.stageStart! }));
    const b = this.browse;
    if (b) {
      b.start ??= tick;
      const key = `browse:${b.run}`, e = this.effects.emitterOf(key);
      if (e && e.terminated && e.particleCount === 0 && b.ended === null) b.ended = tick;
      if (b.ended !== null && tick >= b.ended + RESTART_PAUSE && this.ui.loop.checked) {
        b.run++;
        b.start = tick;
        b.ended = null;
      }
      const placement = this.placement(b.id, b.at.x, b.at.y);
      if (placement && b.ended === null) specs.push({ key: `browse:${b.run}`, start: b.start, placement });
    }
    this.effects.sync(tick, specs);
    return true;
  }

  private describe(r: JpaResource): string {
    const d = r.dynamics, b = r.baseShape, c = r.childShape, x = r.extraShape;
    const tex = (slot: number) => this.jpac!.textures[r.textureIds[slot] ?? -1];
    const texName = (slot: number) => {
      const t = tex(slot);
      return t ? `${t.name} ${t.header.width}×${t.header.height}` : "?";
    };
    const group = fsaParticleGroup(r.id);
    const lines = [
      `effect ${r.id} · group ${group === 255 ? "255 (queued)" : group}${d.userFlags ? ` · user flags ${d.userFlags}` : ""}`,
      `${SHAPES[b.shapeType]} ${b.baseSize.map((v) => (v * 50).toFixed(1)).join("×")} px · from a ${VOLUMES[d.volumeType]} of ${d.volumeSize}`,
      `rate ${+d.rate.toFixed(3)}${d.rateStep ? ` every ${d.rateStep + 1} frames` : ""} · life ${d.lifeTime} · ${d.maxFrame ? `emits ${d.maxFrame} frames` : "endless"}${d.startFrame ? ` after ${d.startFrame}` : ""}`,
      `textures ${b.texIdxAnimData ? `${[...new Set(b.texIdxAnimData)].map(texName).join(", ")} (animated)` : texName(b.texIdx)}`,
      `blend 0x${b.blendModeFlags.toString(16)} · TEV color ${b.colorInSelect} alpha ${b.alphaInSelect} · Z 0x${b.zModeFlags.toString(16)}`,
    ];
    if (x) lines.push(`extra: ${[x.isEnableScale && "scale", x.isEnableAlpha && "alpha", x.isEnableSinWave && "flicker", x.isEnableRotate && "rotation"].filter(Boolean).join(", ") || "none"}`);
    if (c) lines.push(`children: ${SHAPES[c.shapeType]}, ${c.rate} every ${c.step + 1} frames, life ${c.life}, ${texName(c.texIdx)}`);
    if (r.fields.length) lines.push(`fields: ${r.fields.map((f) => ["gravity", "air", "magnet", "newton", "vortex", "random", "drag", "convection", "spin"][f.type]).join(", ")}`);
    if (b.isEnableProjection) lines.push("projected on the frame's copy: not drawn");
    return lines.join("\n");
  }
}
