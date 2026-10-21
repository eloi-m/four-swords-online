// Screen animations played on a ScreenView: the .bck / .btk / .brk / .bpk files next to a J2D screen
// (packages/formats/src/j2d/anim.ts says how their tracks bind), each with its own clock advanced by an explicit 60 Hz
// tick (never the wall clock), several on one screen. In the game the screen code sets each animation's frame itself
// (J2DAnmBase::setFrame); a player's loop mode defaults to the file's.
//   const animator = new ScreenAnimator(view);
//   animator.add(parseScreenAnimation(bytes, "title.btk"));
//   every tick: animator.step(); then render
import {
  animationFrame,
  bindScreenAnimation,
  LoopMode,
  samplePaneTransform,
  sampleScreenColor,
  sampleScreenTexSrt,
  type BloScreen,
  type ScreenAnimation,
  type ScreenAnimationBinding,
} from "@fso/formats";
import type { ScreenView } from "./screen.ts";

export interface ScreenAnimationOptions {
  /** J3D LoopMode (ONCE, ONCE_AND_RESET, REPEAT, MIRRORED_ONCE, MIRRORED_REPEAT); the file's by default. */
  loopMode?: number;
  /** Animation frames per tick; 1 = the game's speed. */
  rate?: number;
  /** Frame to start from (0). */
  frame?: number;
  /** Whether it advances on step() from the start (true). */
  playing?: boolean;
}

/** One animation bound to one screen, with its own clock. */
export class ScreenAnimationPlayer {
  readonly animation: ScreenAnimation;
  readonly binding: ScreenAnimationBinding;
  loopMode: number;
  rate: number;
  playing: boolean;
  /** Frames played since frame 0, before the loop mode folds them (rate × ticks while playing). */
  private time: number;

  constructor(screen: BloScreen, animation: ScreenAnimation, options: ScreenAnimationOptions = {}) {
    this.animation = animation;
    this.binding = bindScreenAnimation(screen, animation);
    this.loopMode = options.loopMode ?? animation.data.loopMode;
    this.rate = options.rate ?? 1;
    this.playing = options.playing ?? true;
    this.time = options.frame ?? 0;
  }

  get name(): string {
    return this.animation.name;
  }

  /** Length in frames. */
  get duration(): number {
    return this.animation.data.duration;
  }

  /** The frame shown: ONCE holds the end, ONCE_AND_RESET goes back to 0, REPEAT wraps, the MIRRORED modes bounce. */
  get frame(): number {
    return animationFrame({ duration: this.duration, loopMode: this.loopMode }, this.time);
  }

  /** A one-shot animation (ONCE, ONCE_AND_RESET, MIRRORED_ONCE) that has played to its end. */
  get done(): boolean {
    const once = this.loopMode === LoopMode.ONCE || this.loopMode === LoopMode.ONCE_AND_RESET;
    if (once) return this.time >= this.duration;
    return this.loopMode === LoopMode.MIRRORED_ONCE && this.time >= 2 * this.duration;
  }

  /** Plays on from the current frame, or from `frame`. */
  play(frame?: number): void {
    if (frame !== undefined) this.time = frame;
    this.playing = true;
  }

  stop(): void {
    this.playing = false;
  }

  /** Shows `frame` (frames may be fractional: tracks are interpolated). Keeps playing or stopped. */
  seek(frame: number): void {
    this.time = frame;
  }

  /** Advances the clock by `ticks` 60 Hz ticks if playing. */
  step(ticks = 1): void {
    if (this.playing) this.time += ticks * this.rate;
  }
}

/** The animations of one ScreenView. Later animations win where two drive the same pane or material register. */
export class ScreenAnimator {
  readonly players: ScreenAnimationPlayer[] = [];
  private readonly view: ScreenView;
  private readonly screen: BloScreen;

  constructor(view: ScreenView) {
    this.view = view;
    this.screen = view.screen;
  }

  /** Binds an animation to the screen and shows its start frame. */
  add(animation: ScreenAnimation, options?: ScreenAnimationOptions): ScreenAnimationPlayer {
    const player = new ScreenAnimationPlayer(this.screen, animation, options);
    this.players.push(player);
    this.applyOne(player);
    return player;
  }

  /** Removes an animation and puts what it drove back to the file's values (then re-applies the others). */
  remove(player: ScreenAnimationPlayer): void {
    const i = this.players.indexOf(player);
    if (i < 0) return;
    this.players.splice(i, 1);
    this.restore(player);
    this.apply();
  }

  clear(): void {
    for (const player of this.players.splice(0)) this.restore(player);
  }

  /** Advances every playing animation by `ticks` 60 Hz ticks, then shows all of them. */
  step(ticks = 1): void {
    for (const player of this.players) player.step(ticks);
    this.apply();
  }

  /** Writes every animation's current frame into the view (after seeks, or to show the state without stepping). */
  apply(): void {
    for (const player of this.players) this.applyOne(player);
  }

  private applyOne(player: ScreenAnimationPlayer): void {
    const { animation, binding } = player;
    const frame = player.frame;
    const view = this.view;
    switch (animation.kind) {
      case "transform":
        animation.data.joints.forEach((joint, i) => {
          const pane = binding.panes[i];
          if (pane) view.setPaneTransform(pane, samplePaneTransform(joint, frame));
        });
        break;
      case "texSrt":
        animation.data.entries.forEach((entry, i) => {
          const m = binding.materials[i]!;
          if (m < 0) return;
          view.setMaterialTexMatrix(m, entry.texMatrix, sampleScreenTexSrt(entry, frame, this.screen.materials[m]!.texMatrices[entry.texMatrix]));
        });
        break;
      case "tevReg":
        animation.data.entries.forEach((entry, i) => {
          const m = binding.materials[i]!;
          if (m < 0) return;
          const color = sampleScreenColor(entry, frame);
          if (entry.target === "konst") view.setMaterialKonstColor(m, entry.index, color);
          else view.setMaterialTevColor(m, entry.index, color);
        });
        break;
      case "color":
        animation.data.entries.forEach((entry, i) => {
          const m = binding.materials[i]!;
          if (m >= 0) view.setMaterialColor(m, sampleScreenColor(entry, frame));
        });
        break;
    }
  }

  private restore(player: ScreenAnimationPlayer): void {
    const { animation, binding } = player;
    const view = this.view, materials = this.screen.materials;
    switch (animation.kind) {
      case "transform":
        for (const pane of binding.panes) if (pane) view.setPaneTransform(pane, {});
        break;
      case "texSrt":
        animation.data.entries.forEach((entry, i) => {
          const file = materials[binding.materials[i]!]?.texMatrices[entry.texMatrix];
          if (file) view.setMaterialTexMatrix(binding.materials[i]!, entry.texMatrix, file);
        });
        break;
      case "tevReg":
        animation.data.entries.forEach((entry, i) => {
          const m = binding.materials[i]!, material = materials[m];
          if (!material) return;
          if (entry.target === "konst") view.setMaterialKonstColor(m, entry.index, material.konstColors[entry.index] ?? [255, 255, 255, 255]);
          else view.setMaterialTevColor(m, entry.index, material.tevColors[entry.index] ?? [0, 0, 0, 0]);
        });
        break;
      case "color":
        animation.data.entries.forEach((_, i) => {
          const material = materials[binding.materials[i]!];
          if (material) view.setMaterialColor(binding.materials[i]!, material.matColors[0]!);
        });
        break;
    }
  }
}
