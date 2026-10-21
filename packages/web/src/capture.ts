// Dev only (captures and replays, docs/tools.md): F8 (or the Capture button on touch screens, or #capture) sends what
// the page shows to the dev server, which writes captures/<id>/ (tools/capture/src/vite.ts) to look at
// later: the frame (the game canvas as PNG), the sim state, the input log that replays it (@fso/sim replay.ts), the
// URL and a note. Shift+F8 asks for the note first. Scripts call window.fsoCapture(note). The apps import this module
// behind `import.meta.env.DEV`, so builds hold none of it.

/** What an app hands the capture: its canvas and its sim, read at the moment of the capture. */
export interface CaptureSource {
  app: string;
  canvas: HTMLCanvasElement;
  /** Draws the current state again, just before the canvas is read: the frame then shows the state captured. */
  render(): void;
  /** A short summary for the index (mode, tick, room, where the Links are…). */
  info(): Record<string, unknown>;
  /** The sim state (Maps and typed arrays are written as arrays). */
  state(): unknown;
  /** The replay record (start and input log) that reaches this state, or null (online, menus). */
  replay(): unknown;
}

export interface CaptureResult {
  id: string;
  dir: string;
}

const ENDPOINT = `${import.meta.env.BASE_URL}__fso/capture`;

/** Wires F8 / Shift+F8, the touch button and window.fsoCapture for one app. */
export function installCapture(source: CaptureSource): void {
  const capture = async (note?: string, ask = false): Promise<CaptureResult> => {
    const shot = await grab(source);
    if (ask) note = await askNote();
    const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...shot, note: note ?? "" }) });
    if (!response.ok) throw new Error(`capture failed: ${response.status} ${await response.text()}`);
    return (await response.json()) as CaptureResult;
  };
  const run = (ask: boolean) =>
    capture(undefined, ask).then(
      (r) => toast(`Captured ${r.id}`),
      (e: Error) => toast(e.message, true),
    );
  (window as unknown as { fsoCapture: typeof capture }).fsoCapture = capture;
  addEventListener("keydown", (e) => {
    if (e.code !== "F8" || e.repeat) return;
    e.preventDefault();
    void run(e.shiftKey);
  });
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has("capture") || (matchMedia("(pointer: coarse)").matches && !navigator.webdriver)) {
    const button = el("button", "position:fixed;top:4px;left:50%;transform:translateX(-50%);z-index:1000;font:12px system-ui;padding:4px 10px;border-radius:12px;border:1px solid #fff6;background:#0008;color:#fff;opacity:.7");
    button.textContent = "Capture";
    button.addEventListener("click", () => void run(true));
    document.body.append(button);
  }
}

/** The frame and the sim, read in an animation frame, the state drawn again first (a WebGL canvas keeps its picture
 *  only until the frame is shown, and the app's loop may or may not have run yet in this one). */
function grab(source: CaptureSource): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) =>
    requestAnimationFrame(() => {
      try {
        resolve({
          app: source.app,
          url: location.href,
          time: new Date().toISOString(),
          viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
          png: (source.render(), source.canvas.toDataURL("image/png")),
          info: source.info(),
          state: plain(source.state()),
          replay: plain(source.replay()),
        });
      } catch (error) {
        reject(error as Error);
      }
    }),
  );
}

/** A JSON-ready copy: Maps become [key, value] arrays, typed arrays plain arrays. */
function plain(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value ?? null, (_, v: unknown) => {
      if (v instanceof Map) return [...v];
      if (v instanceof Set) return [...v];
      if (ArrayBuffer.isView(v) && !(v instanceof DataView)) return Array.from(v as unknown as ArrayLike<number>);
      return typeof v === "bigint" ? v.toString() : v;
    }),
  );
}

/** A one-line box for the note: Enter sends it, Esc sends the capture without one. Its keys stay off the game. */
function askNote(): Promise<string> {
  return new Promise((resolve) => {
    const box = el("form", "position:fixed;top:30%;left:50%;transform:translateX(-50%);z-index:1001;display:flex;gap:6px;padding:10px;background:#000c;border:1px solid #fff6;border-radius:8px");
    const input = el("input", "width:min(60vw,480px);font:16px system-ui;padding:6px");
    input.id = "fso-capture-note";
    input.placeholder = "What's wrong? (Enter sends, Esc skips)";
    const send = el("button", "font:14px system-ui");
    send.textContent = "Send";
    box.append(input, send);
    const done = (text: string) => (box.remove(), resolve(text));
    box.addEventListener("submit", (e) => (e.preventDefault(), done(input.value.trim())));
    for (const type of ["keydown", "keyup"] as const) {
      input.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === "keydown" && e.code === "Escape") done("");
      });
    }
    document.body.append(box);
    input.focus();
  });
}

function toast(text: string, error = false): void {
  const div = el("div", `position:fixed;top:36px;right:8px;z-index:1001;font:13px system-ui;padding:6px 10px;border-radius:6px;background:${error ? "#a00e" : "#000c"};color:#fff;pointer-events:none`);
  div.textContent = text;
  document.body.append(div);
  setTimeout(() => div.remove(), 2500);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.style.cssText = style;
  return e;
}

/** A replay record from a capture (#replay=<id>, or "latest"), served by the dev server; null when it has none. */
export async function fetchReplay(id: string): Promise<unknown> {
  const response = await fetch(`${import.meta.env.BASE_URL}__fso/captures/${encodeURIComponent(id)}/replay.json`);
  if (!response.ok) throw new Error(`no replay for capture ${id}: ${response.status}`);
  return (await response.json()) as unknown;
}
