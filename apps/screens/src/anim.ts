// The screen viewer's animation panel: the archive's .bck/.btk/.brk/.bpk files as checkboxes (the screen's own, by
// name, first), play/pause, step and a frame slider driving every checked animation from one 60 Hz clock (each folds it
// by its own loop mode). Deep link: &anim=title.btk,… (or &anim=auto: the screen's own), &frame=30, &play=1.
import { decompressYaz0, isYaz0, parseScreenAnimation, screenAnimationNames, type RarcArchive } from "@fso/formats";
import { ScreenAnimator, type ScreenAnimationPlayer, type ScreenView } from "@fso/render";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface AnimationState {
  /** Checked animations, by file name. */
  names: string[];
  /** The shared clock, in frames (60 per second when playing). */
  frame: number;
  playing: boolean;
  /** Per animation: the frame it shows, its length and what didn't bind. */
  players: { name: string; frame: number; duration: number; loopMode: number; unbound: string[] }[];
}

export class AnimationPanel {
  private readonly section = $<HTMLElement>("anims");
  private readonly list = $<HTMLDivElement>("anim-list");
  private readonly playButton = $<HTMLButtonElement>("anim-play");
  private readonly stepButton = $<HTMLButtonElement>("anim-step");
  private readonly slider = $<HTMLInputElement>("anim-frame");
  private readonly label = $<HTMLSpanElement>("anim-frame-label");
  private readonly info = $<HTMLParagraphElement>("anim-info");
  private animator: ScreenAnimator | null = null;
  private archive: RarcArchive | null = null;
  private readonly players = new Map<string, ScreenAnimationPlayer>();
  private frame = 0;
  private playing = false;
  private last = 0;
  private readonly redraw: () => void;
  private readonly onLink: (link: URLSearchParams) => void;

  /** `redraw` is called whenever the screen changed; `onLink` gets the deep-link parameters to keep in the URL. */
  constructor(redraw: () => void, onLink: (link: URLSearchParams) => void) {
    this.redraw = redraw;
    this.onLink = onLink;
    this.playButton.addEventListener("click", () => this.setPlaying(!this.playing));
    this.stepButton.addEventListener("click", () => {
      this.setPlaying(false);
      this.seek(Math.floor(this.frame) + 1);
    });
    this.slider.addEventListener("input", () => {
      this.setPlaying(false);
      this.seek(Number(this.slider.value));
    });
    const loop = (now: number) => {
      if (this.playing && this.animator) {
        // Whole 60 Hz ticks since the last frame (at most 4, so a background tab doesn't jump).
        const ticks = Math.min(4, Math.floor((now - this.last) / (1000 / 60)));
        if (ticks > 0) {
          this.last += ticks * (1000 / 60);
          this.seek(this.frame + ticks, false);
        }
      } else this.last = now;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** Lists the archive's animations for a newly shown screen and applies the deep link's. */
  show(archive: RarcArchive, screenPath: string, view: ScreenView, link: URLSearchParams): void {
    this.animator = new ScreenAnimator(view);
    this.archive = archive;
    this.players.clear();
    const files = archive.files.map((f) => f.path).filter((p) => /(^|\/)scrn\/[^/]+\.(bck|btk|brk|bpk)$/i.test(p));
    const own = screenAnimationNames(screenPath, files);
    const ordered = [...own, ...files.filter((f) => !own.includes(f))];
    const wanted = (link.get("anim") ?? "").split(",").filter(Boolean);
    const checked = new Set(wanted.includes("auto") ? own : ordered.filter((p) => wanted.includes(base(p))));
    this.list.replaceChildren(
      ...ordered.map((path) => {
        const row = document.createElement("label");
        row.className = "inline anim";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.dataset.anim = base(path);
        box.checked = checked.has(path);
        box.addEventListener("change", () => {
          this.toggle(path, box.checked);
          this.seek(this.frame);
          this.updateLink();
        });
        const name = document.createElement("span");
        name.textContent = base(path) + (own.includes(path) ? "" : " (other screen)");
        row.append(box, name);
        return row;
      }),
    );
    this.section.hidden = !ordered.length;
    for (const path of checked) this.toggle(path, true);
    this.frame = Number(link.get("frame") ?? 0) || 0;
    this.seek(this.frame);
    this.setPlaying(link.get("play") === "1" && this.players.size > 0);
  }

  /** Shows every checked animation at `frame` of the shared clock. */
  seek(frame: number, updateLink = true): void {
    this.frame = Math.max(0, frame);
    if (this.animator) {
      for (const player of this.players.values()) player.seek(this.frame);
      this.animator.apply();
    }
    const max = Math.max(1, ...[...this.players.values()].map((p) => p.duration));
    this.slider.max = String(max);
    this.slider.value = String(Math.min(max, Math.floor(this.frame)));
    this.label.textContent = `${Math.floor(this.frame)}`;
    this.info.textContent = [...this.players.values()]
      .map((p) => `${p.name}: frame ${p.frame.toFixed(0)}/${p.duration}${p.binding.unbound.length ? ` · ${p.binding.unbound.length} tracks unbound` : ""}`)
      .join("\n");
    this.redraw();
    if (updateLink) this.updateLink();
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.playButton.textContent = playing ? "Pause" : "Play";
    this.updateLink();
  }

  state(): AnimationState {
    return {
      names: [...this.players.keys()],
      frame: this.frame,
      playing: this.playing,
      players: [...this.players.values()].map((p) => ({ name: p.name, frame: p.frame, duration: p.duration, loopMode: p.loopMode, unbound: p.binding.unbound })),
    };
  }

  private toggle(path: string, on: boolean): void {
    const name = base(path);
    const existing = this.players.get(name);
    if (existing) {
      this.animator?.remove(existing);
      this.players.delete(name);
    }
    if (!on || !this.animator || !this.archive) return;
    const file = this.archive.files.find((f) => f.path === path);
    if (!file) return;
    const bytes = isYaz0(file.data) ? decompressYaz0(file.data) : file.data;
    // Every animation follows the shared clock; REPEAT etc. still fold it by the file's loop mode.
    this.players.set(name, this.animator.add(parseScreenAnimation(bytes, name), { playing: false }));
  }

  private updateLink(): void {
    const link = new URLSearchParams();
    if (this.players.size) {
      link.set("anim", [...this.players.keys()].join(","));
      link.set("frame", String(Math.floor(this.frame)));
      if (this.playing) link.set("play", "1");
    }
    this.onLink(link);
  }
}

const base = (path: string) => path.slice(path.lastIndexOf("/") + 1);
