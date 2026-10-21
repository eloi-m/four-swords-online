// The viewer's "3D effects" layer: the stage's J3D effects (waterfalls, rainbows, light filters) and cloud shadows,
// placed as the game places them (@fso/formats stageEffectPlacements) and animated at 60 Hz. Their clock starts when
// they are shown, like the game's effects start with the stage. Deep link: `&effects` turns them on, `&efftick=N`
// freezes them at tick N (for screenshots).
import type { RarcArchive, Stage } from "@fso/formats";
import { StageEffects } from "@fso/render";
import type { MapView } from "./scene.ts";

export class ViewerEffects {
  private readonly view: MapView;
  private effects: StageEffects | null = null;
  private start: number | null = null;
  private frozen: number | null = null;
  private last = -1;
  private changed = false;

  constructor(view: MapView) {
    this.view = view;
    const frozen = new URLSearchParams(location.hash.slice(1)).get("efftick");
    this.frozen = frozen === null ? null : Number(frozen);
    view.addTickListener((tick) => this.tick(tick));
  }

  /** Shows (or hides, with `enabled` false) the effects of a stage. Returns a one-line summary. */
  show(stage: Stage | null, data: RarcArchive | null, enabled: boolean): string {
    if (this.effects) this.view.overlay.remove(this.effects.group);
    this.effects?.dispose();
    this.effects = null;
    this.start = null;
    this.last = -1;
    this.changed = true;
    if (!enabled || !stage || !data) return "";
    this.effects = new StageEffects(stage, data);
    this.view.overlay.add(this.effects.group);
    const models = this.effects.placements.map((p) => `${p.model} (room ${p.room}${p.status === "hypothesis" ? ", hypothesis" : ""})`);
    const clouds = this.effects.group.getObjectByName("cloud shadows") ? ["cloud shadows"] : [];
    const all = [...models, ...clouds];
    return all.length ? `3D effects: ${all.join(", ")}` : "3D effects: none known for this stage";
  }

  private tick(tick: number): boolean {
    const changed = this.changed;
    this.changed = false;
    if (!this.effects) return changed;
    this.start ??= tick;
    const t = this.frozen ?? tick - this.start;
    if (t === this.last) return changed;
    this.last = t;
    this.effects.update(t);
    return true;
  }
}
