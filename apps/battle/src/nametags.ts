// Names over the Links in online matches: a pill in each tunic color ("P2 Zelda", "P3 CPU normal", "P1 You" over
// this browser's own Link), shown through each round's countdown and its first seconds, then faded out. In free play,
// and in battles of more than 4 Links (which have no HUD corners), they stay up, the battles' with each Link's hearts
// and stars. DOM labels in the HUD layer, placed every frame over each Link's head (ArenaView.heads), so the text stays
// sharp at any size.
import { HEART, MAX_FIGHTERS, type BattleState } from "@fso/sim";
import { PLAYER_COLORS, PLAYER_INK, playerName } from "./hud.ts";

/** Ticks into a round's fight the names stay up (then they fade: style.css). */
export const TAG_TICKS = 180;
const MAX_NAME = 14;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Free play, or a battle too big for the HUD's four corners: the names stay up, a battle's with the Links' state. */
const crowded = (b: BattleState): boolean => b.phase === "free" || b.fighters.length > MAX_FIGHTERS;

/** Whether the names show at this point of the battle: the countdown and the first TAG_TICKS of the fight. */
export const tagsShown = (b: BattleState | undefined): boolean =>
  !!b && (crowded(b) || b.phase === "countdown" || (b.phase === "play" && b.phaseTick < TAG_TICKS));

export class NameTags {
  private readonly root: HTMLElement;
  private tags: HTMLElement[] = [];
  /** Each tag's half width and height (CSS px), measured when built: they stay inside the frame. */
  private sizes: { w: number; h: number }[] = [];
  private key = "";
  /** What each tag's hearts and stars show (so unchanged ones aren't rewritten every frame). */
  private stats: string[] = [];

  constructor(hud: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "nametags";
    hud.prepend(this.root); // (under the HUD's timer and banners)
  }

  /**
   * `heads` by player (ArenaView.heads), `names` by player (the room's, then "CPU (level)"), `local` = this
   * browser's Link (-1 for a spectator), `frame` = the TV frame's size.
   */
  update(heads: readonly ({ x: number; y: number } | null)[], names: readonly string[], local: number, battle: BattleState | undefined, frame: { w: number; h: number }): void {
    this.root.hidden = false;
    this.root.classList.toggle("shown", tagsShown(battle));
    const withStats = !!battle && battle.phase !== "free" && battle.fighters.length > MAX_FIGHTERS;
    const key = JSON.stringify([names, local, heads.length, withStats]);
    if (key !== this.key) {
      this.key = key;
      this.root.innerHTML = heads.map((_, i) => tagHtml(i, names[i] ?? playerName(i), i === local, withStats)).join("");
      this.tags = [...this.root.children] as HTMLElement[];
      this.sizes = [];
      this.stats = [];
    }
    heads.forEach((head, i) => {
      const tag = this.tags[i]!;
      tag.hidden = !head;
      if (!head) return;
      if (withStats) this.showStats(i, battle!);
      const size = (this.sizes[i] ??= measure(tag));
      if (!size.w) this.sizes.length = 0; // (not laid out yet: measure again next frame)
      const x = Math.min(Math.max(head.x, size.w + 2), frame.w - size.w - 2);
      const y = Math.max(head.y, size.h + 2);
      tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    });
  }

  /** Between online matches and in local ones: no names. */
  hide(): void {
    this.root.hidden = true;
  }

  /** Player i's hearts (whole ones, rounded up, out of the rules' hearts) and stars. */
  private showStats(i: number, b: BattleState): void {
    const f = b.fighters[i];
    if (!f) return;
    const full = Math.ceil(f.hearts / HEART), text = `${full}/${b.rules.hearts}/${f.stars}`;
    if (this.stats[i] === text) return;
    this.stats[i] = text;
    const hearts = Array.from({ length: b.rules.hearts }, (_, h) => `<i class="tag-heart${h < full ? "" : " lost"}"></i>`).join("");
    const stars = Array.from({ length: f.stars }, () => `<i class="tag-star"></i>`).join("");
    this.tags[i]!.querySelector(".tag-stats")!.innerHTML = hearts + stars;
    this.sizes[i] = measure(this.tags[i]!);
  }
}

function measure(tag: HTMLElement): { w: number; h: number } {
  const body = tag.firstElementChild as HTMLElement;
  return { w: body.offsetWidth / 2, h: body.offsetHeight };
}

function tagHtml(i: number, name: string, you: boolean, stats: boolean): string {
  const cpu = /^CPU \((\w+)\)$/.exec(name);
  const label = you ? "You" : cpu ? `CPU<small>${cpu[1]}</small>` : esc(name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name);
  return (
    `<div class="nametag${you ? " you" : ""}" style="--color:${PLAYER_COLORS[i]};--ink:${PLAYER_INK[i]}"><span class="tag-body"><b class="tag-p">${playerName(i)}</b>` +
    `<span class="tag-name">${label}</span>${stats ? `<span class="tag-stats"></span>` : ""}</span></div>`
  );
}
