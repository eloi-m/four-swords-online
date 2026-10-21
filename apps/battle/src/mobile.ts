// Phones and tablets: what the page does beyond CSS (style.css has the layouts, the 44 px targets and the "rotate to
// landscape" screen). Everything is feature-detected and fails silently; nothing here changes a desktop page.
//   - no pinch zoom on iOS, which ignores the viewport's user-scalable=no;
//   - fullscreen and a landscape lock when a [data-fullscreen] button is tapped (Android Chrome; iOS Safari has
//     neither for pages: Add to Home Screen with the site's manifest gets close);
//   - the screen kept awake during matches (Screen Wake Lock API), taken again when the page comes back;
//   - sharing a link (the invite) through the system share sheet.

/** A touch screen is the main pointer (phones, tablets): the same test as style.css's `(pointer: coarse)`. */
export const isTouch = (): boolean => matchMedia("(pointer: coarse)").matches;

export function setupMobilePage(): void {
  // iOS Safari pinches through user-scalable=no; its gesture events can be cancelled. (Double-tap zoom is off
  // through style.css's touch-action: manipulation.)
  for (const type of ["gesturestart", "gesturechange"]) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  document.addEventListener(
    "click",
    (e) => {
      if (isTouch() && e.target instanceof Element && e.target.closest("[data-fullscreen]")) enterFullscreen();
    },
    { capture: true },
  );
}

/** Fullscreen, then the landscape lock (which needs fullscreen on Android). Call from a user gesture. */
export function enterFullscreen(): void {
  const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  const lock = () => void orientation?.lock?.("landscape").catch(() => {});
  if (document.fullscreenElement) return lock();
  try {
    if (root.requestFullscreen) root.requestFullscreen({ navigationUI: "hide" }).then(lock, () => {});
    else root.webkitRequestFullscreen?.();
  } catch {}
}

/** Keeps the screen on while `hold(true)`: a match runs. The browser drops the lock when the page is hidden. */
export class WakeLock {
  /** Test hook: whether a lock is held right now. */
  held = false;
  private wanted = false;
  private sentinel: { release(): Promise<void>; addEventListener(type: "release", f: () => void): void } | null = null;
  private pending = false;

  constructor() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.acquire();
    });
  }

  hold(on: boolean): void {
    this.wanted = on;
    if (on) this.acquire();
    else {
      const s = this.sentinel;
      this.sentinel = null;
      this.held = false;
      void s?.release().catch(() => {});
    }
  }

  private acquire(): void {
    const api = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<NonNullable<WakeLock["sentinel"]>> } }).wakeLock;
    if (!api || !this.wanted || this.sentinel || this.pending || document.visibilityState !== "visible") return;
    this.pending = true;
    api.request("screen").then(
      (sentinel) => {
        this.pending = false;
        if (!this.wanted) return void sentinel.release().catch(() => {});
        this.sentinel = sentinel;
        this.held = true;
        sentinel.addEventListener("release", () => {
          if (this.sentinel !== sentinel) return;
          this.sentinel = null;
          this.held = false;
        });
      },
      () => (this.pending = false), // not allowed (no gesture yet, battery saver, an iframe): no lock
    );
  }
}

/** Shares a link through the system share sheet when there is one (phones), else copies it. Returns what happened. */
export async function shareLink(url: string, title: string): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  if (isTouch() && navigator.share) {
    try {
      await navigator.share({ title, url });
      return "shared";
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return "cancelled";
      // (not allowed here: fall back to the clipboard)
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}
