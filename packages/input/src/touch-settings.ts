// The on-screen controls' settings (the battle menu's Controls dialog), saved in localStorage for every page of the
// site: shown on touch screens only ("auto"), always or never; their size and opacity; vibration on presses.

export type TouchMode = "auto" | "on" | "off";
export const TOUCH_MODES: readonly TouchMode[] = ["auto", "on", "off"];

export interface TouchSettings {
  mode: TouchMode;
  /** Scale of the controls (1 = the default size). */
  size: number;
  opacity: number;
  /** A short vibration on each press, where the browser can (navigator.vibrate: Android, not iOS). */
  haptics: boolean;
}

export const TOUCH_SIZE = { min: 0.7, max: 1.5 } as const;
export const TOUCH_OPACITY = { min: 0.2, max: 1 } as const;
export const DEFAULT_TOUCH_SETTINGS: Readonly<TouchSettings> = { mode: "auto", size: 1, opacity: 0.6, haptics: true };

const STORAGE_KEY = "fso.touch";

/** Settings from stored JSON; anything missing or malformed falls back to the defaults (per field). */
export function parseTouchSettings(json: string | null): TouchSettings {
  const out = { ...DEFAULT_TOUCH_SETTINGS };
  let raw: Partial<TouchSettings> | null = null;
  try {
    raw = json ? (JSON.parse(json) as Partial<TouchSettings>) : null;
  } catch {}
  if (!raw || typeof raw !== "object") return out;
  const range = (v: unknown, { min, max }: { min: number; max: number }) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null);
  if (TOUCH_MODES.includes(raw.mode as TouchMode)) out.mode = raw.mode as TouchMode;
  out.size = range(raw.size, TOUCH_SIZE) ?? out.size;
  out.opacity = range(raw.opacity, TOUCH_OPACITY) ?? out.opacity;
  if (typeof raw.haptics === "boolean") out.haptics = raw.haptics;
  return out;
}

export function loadTouchSettings(): TouchSettings {
  try {
    return parseTouchSettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...DEFAULT_TOUCH_SETTINGS };
  }
}

export function saveTouchSettings(s: TouchSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}
