// The site's home page: Shadow Battle's title screen (the game's logo, sky and Link icons, drawn from the game files
// the server has; then the logo's glint, title-logo.ts, and the 3D clouds behind it, title-sky.ts), the four ways to
// play, and two dialogs: the controls, and "About" (the project, the game files, what this browser supports, the
// adventure slice). window.fsoHome is for tests.
import { describeManifest, GameArt, openServerStore, showArt } from "@fso/web";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const state = {
  data: "checking" as "checking" | "ready" | "missing",
  error: "",
  files: 0,
  bytes: 0,
  art: false,
  /** The title screen's live logo (title-logo.ts): its glint as the game plays it. */
  logo: { mode: "loading" as "canvas" | "image" | "loading", glints: 0, frame: 0 },
  /** The title screen's sky (title-sky.ts): its clouds' clock, the lightning's strikes and flash. */
  sky: { mode: "loading" as "canvas" | "image" | "loading", tick: 0, strikes: 0, flash: [0, 0] as [number, number], bolts: false },
};
(window as unknown as { fsoHome: typeof state }).fsoHome = state;

/** What the site needs from the browser, tested without side effects. */
function checks(): { name: string; ok: boolean; note: string }[] {
  const gl = (() => {
    try {
      return !!document.createElement("canvas").getContext("webgl2");
    } catch {
      return false;
    }
  })();
  return [
    { name: "WebGL 2", ok: gl, note: "the arenas are drawn with it" },
    { name: "AudioWorklet", ok: typeof AudioWorkletNode !== "undefined", note: "music and sound effects" },
    { name: "Web workers", ok: typeof Worker !== "undefined", note: "online matches keep ticking in background tabs" },
    { name: "WebRTC data channels", ok: typeof RTCPeerConnection !== "undefined", note: "online play (a relay is used otherwise)" },
    { name: "Gamepads", ok: typeof navigator.getGamepads === "function", note: "optional" },
    { name: "Secure context", ok: window.isSecureContext, note: "sound needs HTTPS or localhost" },
  ];
}
$("checks").innerHTML = checks()
  .map((c) => `<li class="${c.ok ? "" : "missing"}" title="${c.note}">${c.name}${c.ok ? "" : ` (missing: ${c.note})`}</li>`)
  .join("");

const source = import.meta.env.VITE_SOURCE_URL as string | undefined;
if (source) $("source").innerHTML = `Source code: <a href="${encodeURI(source)}">${source.replace(/^https?:\/\//, "")}</a>.`;

// The dialogs: opened by their buttons, closed by Close, Esc or a click outside.
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-open]")) {
  button.addEventListener("click", () => $<HTMLDialogElement>(button.dataset.open!).showModal());
}
for (const dialog of document.querySelectorAll("dialog")) dialog.addEventListener("click", (e) => e.target === dialog && dialog.close());

// The modes as a game menu: the arrow keys move between them, Enter picks one; with a mouse or a keyboard the first
// one starts selected.
const modes = [...document.querySelectorAll<HTMLAnchorElement>(".mode")];
document.addEventListener("keydown", (e) => {
  if (document.querySelector("dialog[open]") || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
  e.preventDefault();
  const at = modes.indexOf(document.activeElement as HTMLAnchorElement);
  const step = e.key === "ArrowDown" ? 1 : -1;
  modes[at < 0 ? (step > 0 ? 0 : modes.length - 1) : (at + step + modes.length) % modes.length]!.focus();
});
if (matchMedia("(pointer: fine)").matches) modes[0]?.focus({ preventScroll: true });

const info = $<HTMLParagraphElement>("data-info"), status = $<HTMLParagraphElement>("data-status");
try {
  const store = await openServerStore();
  const { manifest } = store;
  Object.assign(state, { data: "ready", files: manifest.files.length, bytes: manifest.bytes });
  info.textContent = `Ready on this server: ${describeManifest(manifest)}.`;
  const art = new GameArt(store);
  await showArt(document, art);
  state.art = !!document.querySelector(".logo-art")?.getAttribute("src");
  // Then the title screen's own logo, its glint animated (three.js and the J2D renderer load only now).
  const slot = document.querySelector<HTMLElement>(".logo"), img = document.querySelector<HTMLImageElement>(".logo-art");
  const title = state.art && slot && img ? await art.archive("title.arc") : null;
  const live = title ? await import("./title-logo.ts").then((m) => m.liveLogo(slot!, img!, title, state.logo)).catch(() => false) : false;
  if (!live) state.logo.mode = "image";
  // Then the title screen's sky behind everything: its 3D clouds drifting and flashing (three.js is in already), and
  // last the lightning's bolts, particles from data.arc (1.2 MB, which Shadow Battle loads anyway: not with Save-Data
  // or reduced motion).
  const sky = document.querySelector<HTMLElement>(".sky");
  const clouds = title && sky ? await import("./title-sky.ts").then((m) => m.liveSky(sky, title, state.sky)).catch(() => null) : null;
  if (!clouds) state.sky.mode = "image";
  const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData;
  if (clouds && !saveData && !matchMedia("(prefers-reduced-motion: reduce)").matches) clouds.addBolts(await art.archive("data.arc"));
} catch (error) {
  Object.assign(state, { data: "missing", error: (error as Error).message });
  info.textContent = status.textContent = (error as Error).message;
  status.classList.add("error");
  status.hidden = false;
}
