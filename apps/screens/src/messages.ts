// Message browser: the BMG files' messages listed and searched by id or text, one shown in a message box screen
// (main2D.arc's message window, speech balloons, Zelda's box…) page by page. Deep link: #msg=<id> (decimal or 0x…),
// &bmg=e|ek|jp|jpk, &page=<n>, &box=<screen in main2D.arc>.
import { bmgMessageText, bmgPages, decompressYaz0, isYaz0, parseBmg, walkPanes, type Bmg, type BmgMessage, type RarcArchive } from "@fso/formats";
import type { ScreenView } from "@fso/render";

const FILES: Record<string, [string, string]> = {
  e: ["msgus.arc", "bmg/gc_four_swords_text_e.bmg"],
  ek: ["msgus.arc", "bmg/gc_four_swords_text_ek.bmg"],
  jp: ["msgjp.arc", "bmg/gc_four_swords_text_jp.bmg"],
  jpk: ["msgjp.arc", "bmg/gc_four_swords_text_jpk.bmg"],
};
export const MESSAGE_ARCHIVE = "main2D.arc";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const hex = (id: number) => `0x${id.toString(16).padStart(3, "0")}`;

export interface ShownMessage {
  file: string;
  id: number;
  page: number;
  pages: number;
  text: string;
}

export class MessageBrowser {
  private readonly ui = {
    root: $<HTMLDetailsElement>("messages"),
    file: $<HTMLSelectElement>("msg-file"),
    box: $<HTMLSelectElement>("msg-box"),
    search: $<HTMLInputElement>("msg-search"),
    list: $<HTMLSelectElement>("msg-list"),
    prev: $<HTMLButtonElement>("msg-prev"),
    next: $<HTMLButtonElement>("msg-next"),
    page: $<HTMLSpanElement>("msg-page"),
    text: $<HTMLPreElement>("msg-text"),
  };
  private readonly files = new Map<string, Promise<Bmg>>();
  private bmg: Bmg | null = null;
  /** The message on show (null = the screens' own placeholder texts). */
  message: BmgMessage | null = null;
  page = 0;
  private readonly loadArchive: (path: string) => Promise<RarcArchive>;
  /** Called to show the message box screen (archive main2D.arc, screen file name), then `apply` runs on it. */
  onShowBox: (screen: string) => void = () => {};

  constructor(loadArchive: (path: string) => Promise<RarcArchive>) {
    this.loadArchive = loadArchive;
    this.ui.file.addEventListener("change", () => void this.useFile(this.ui.file.value).then(() => this.select(this.message?.id ?? null)));
    this.ui.search.addEventListener("input", () => this.fillList());
    this.ui.list.addEventListener("change", () => this.select(Number(this.ui.list.value), 0));
    this.ui.box.addEventListener("change", () => this.message && this.onShowBox(this.ui.box.value));
    this.ui.prev.addEventListener("click", () => this.turn(-1));
    this.ui.next.addEventListener("click", () => this.turn(1));
  }

  get box(): string {
    return this.ui.box.value;
  }

  /** Reads #msg/&bmg/&page/&box; returns true when a message is to be shown. */
  async fromLink(link: URLSearchParams): Promise<boolean> {
    const file = link.get("bmg") ?? this.ui.file.value;
    if (FILES[file]) this.ui.file.value = file;
    const box = link.get("box") ?? link.get("scrn");
    if (box && [...this.ui.box.options].some((o) => o.value === box || o.value === `${box}.blo`)) this.ui.box.value = box.endsWith(".blo") ? box : `${box}.blo`;
    await this.useFile(this.ui.file.value);
    const msg = link.get("msg");
    if (msg === null) return false;
    const id = Number(msg);
    this.message = this.bmg?.messages.find((m) => m.id === id) ?? null;
    this.page = Math.max(0, Number(link.get("page") ?? 0) || 0);
    this.ui.root.open = true;
    this.fillList();
    this.describe();
    return this.message !== null;
  }

  /** Writes the message state into a deep link. */
  toLink(link: URLSearchParams): void {
    for (const k of ["msg", "bmg", "page", "box"]) link.delete(k);
    if (!this.message) return;
    link.set("msg", hex(this.message.id));
    if (this.ui.file.value !== "e") link.set("bmg", this.ui.file.value);
    if (this.page) link.set("page", String(this.page));
    link.set("box", this.ui.box.value.replace(/\.blo$/, ""));
  }

  /** Shows the current message page in every text box of a screen: colors on the last drawn, the shadows without. */
  apply(view: ScreenView, root: Parameters<typeof walkPanes>[0]): ShownMessage | null {
    if (!this.message) return null;
    const boxes = [...walkPanes(root)].map((p) => p.pane).filter((p) => p.kind === "textbox");
    const pages = bmgPages(this.message).length;
    this.page = Math.min(this.page, pages - 1);
    boxes.forEach((tb, i) => view.setText(tb, this.message!, { page: this.page, colors: i === boxes.length - 1 }));
    this.describe();
    return { file: this.ui.file.value, id: this.message.id, page: this.page, pages, text: bmgMessageText(bmgPages(this.message)[this.page] ?? []) };
  }

  private async useFile(key: string): Promise<void> {
    let file = this.files.get(key);
    if (!file) {
      const [arc, path] = FILES[key]!;
      file = this.loadArchive(arc).then((a) => {
        const f = a.files.find((x) => x.path === path);
        if (!f) throw new Error(`${arc} has no ${path}`);
        return parseBmg(isYaz0(f.data) ? decompressYaz0(f.data) : f.data);
      });
      this.files.set(key, file);
    }
    this.bmg = await file;
    if (this.message) this.message = this.bmg.messages.find((m) => m.id === this.message!.id) ?? null;
    this.fillList();
  }

  private select(id: number | null, page = this.page): void {
    this.message = id === null ? null : (this.bmg?.messages.find((m) => m.id === id) ?? null);
    this.page = page;
    this.describe();
    if (this.message) this.onShowBox(this.ui.box.value);
  }

  private turn(delta: number): void {
    if (!this.message) return;
    const pages = bmgPages(this.message).length;
    this.page = Math.min(Math.max(this.page + delta, 0), pages - 1);
    this.onShowBox(this.ui.box.value);
  }

  private fillList(): void {
    if (!this.bmg) return;
    const query = this.ui.search.value.trim();
    const asId = /^(0x[0-9a-f]+|\d+)$/i.test(query) ? Number(query) : null;
    const lower = query.toLowerCase();
    const rows = this.bmg.messages.filter((m) => {
      if (!m.bytes.length) return false;
      if (!query) return true;
      return m.id === asId || bmgMessageText(m).toLowerCase().includes(lower);
    });
    this.ui.list.replaceChildren(
      ...rows.map((m) => {
        const label = `${hex(m.id)}  ${bmgMessageText(m).replace(/\{[^}]*\}/g, "").replace(/\n/g, " ").slice(0, 60)}`;
        const option = new Option(label, String(m.id));
        option.selected = m.id === this.message?.id;
        return option;
      }),
    );
    if (this.message) this.ui.list.value = String(this.message.id);
  }

  private describe(): void {
    const m = this.message;
    const pages = m ? bmgPages(m).length : 0;
    this.ui.page.textContent = m ? `${hex(m.id)} · page ${this.page + 1}/${pages}` : "";
    this.ui.prev.disabled = !m || this.page <= 0;
    this.ui.next.disabled = !m || this.page >= pages - 1;
    this.ui.text.textContent = m ? bmgMessageText(m) : "";
  }
}
