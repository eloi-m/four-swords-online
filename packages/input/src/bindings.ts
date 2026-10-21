// Key and gamepad bindings: which KeyboardEvent.code values and standard-mapping pad buttons hold which of the sim's
// buttons. Shadow Battle's are the players' to choose (its Controls dialog) and saved in localStorage; the Lake Hylia
// pages use fixed ones. The GameCube pad's B = Sword, R = Action (lift, throw, roll), A = Item (measured in Dolphin,
// docs/measurements.md).
import { Button } from "@fso/sim";

export const ACTIONS = ["Up", "Down", "Left", "Right", "Sword", "Action", "Item"] as const;
export type InputAction = (typeof ACTIONS)[number];
export const ACTION_BITS: Record<InputAction, number> = Button;
export const ACTION_NAMES: Record<InputAction, string> = {
  Up: "Up",
  Down: "Down",
  Left: "Left",
  Right: "Right",
  Sword: "Sword",
  Action: "Action (lift, throw, roll)",
  Item: "Item",
};

export interface Bindings {
  /** Keyboard layouts, one per player slot: KeyboardEvent.code values per action. */
  keyboards: Record<InputAction, string[]>[];
  /** Gamepad buttons (standard mapping indices) per action, for every pad; the left stick also moves. */
  gamepad: Record<InputAction, number[]>;
}

export const DEFAULT_BINDINGS: Bindings = {
  keyboards: [
    { Up: ["KeyW"], Down: ["KeyS"], Left: ["KeyA"], Right: ["KeyD"], Sword: ["KeyJ"], Action: ["KeyK"], Item: ["KeyL"] },
    {
      Up: ["ArrowUp"],
      Down: ["ArrowDown"],
      Left: ["ArrowLeft"],
      Right: ["ArrowRight"],
      Sword: ["Comma", "Numpad0"],
      Action: ["Period", "NumpadDecimal"],
      Item: ["Slash", "NumpadEnter"],
    },
  ],
  // Standard mapping: d-pad 12-15, A = sword, B = item, X or the right shoulder/trigger = action (the GC's R).
  gamepad: { Up: [12], Down: [13], Left: [14], Right: [15], Sword: [0], Action: [2, 5, 7], Item: [1] },
};

/** The Lake Hylia pages (apps/game, apps/netplay): one player on arrows or WASD, J/Z sword, K/X item, L/C action. */
export const ADVENTURE_BINDINGS: Bindings = {
  keyboards: [
    {
      Up: ["ArrowUp", "KeyW"],
      Down: ["ArrowDown", "KeyS"],
      Left: ["ArrowLeft", "KeyA"],
      Right: ["ArrowRight", "KeyD"],
      Sword: ["KeyJ", "KeyZ"],
      Item: ["KeyK", "KeyX"],
      Action: ["KeyL", "KeyC"],
    },
  ],
  gamepad: { Up: [12], Down: [13], Left: [14], Right: [15], Sword: [0], Item: [1], Action: [2] },
};

const STORAGE_KEY = "fso.battle.controls";

/** A deep copy of `b`. */
export function copyBindings(b: Bindings): Bindings {
  return JSON.parse(JSON.stringify(b)) as Bindings;
}

/** Bindings from stored JSON; anything missing or malformed falls back to the defaults (per action). */
export function parseBindings(json: string | null): Bindings {
  const out = copyBindings(DEFAULT_BINDINGS);
  let raw: Partial<Bindings> | null = null;
  try {
    raw = json ? (JSON.parse(json) as Partial<Bindings>) : null;
  } catch {}
  if (!raw || typeof raw !== "object") return out;
  const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string" && x.length < 40) ? (v as string[]) : null;
  const indices = (v: unknown) => Array.isArray(v) && v.every((x) => Number.isInteger(x) && x >= 0 && x < 32) ? (v as number[]) : null;
  out.keyboards.forEach((layout, i) => {
    const saved = raw.keyboards?.[i];
    for (const a of ACTIONS) layout[a] = strings(saved?.[a]) ?? layout[a];
  });
  for (const a of ACTIONS) out.gamepad[a] = indices(raw.gamepad?.[a]) ?? out.gamepad[a];
  return out;
}

/** Shadow Battle's saved bindings (the defaults if none). */
export function loadBindings(): Bindings {
  try {
    return parseBindings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return copyBindings(DEFAULT_BINDINGS);
  }
}

export function saveBindings(b: Bindings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(b));
  } catch {}
}

/** A short name for a KeyboardEvent.code: "KeyW" → "W", "ArrowUp" → "↑", "Numpad0" → "Num0", "Comma" → ",". */
export function keyLabel(code: string): string {
  const named: Record<string, string> = {
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Comma: ",", Period: ".", Slash: "/", Semicolon: ";",
    Quote: "'", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Minus: "-", Equal: "=", Backquote: "`",
    NumpadDecimal: "Num.", NumpadEnter: "NumEnter", NumpadAdd: "Num+", NumpadSubtract: "Num-", NumpadMultiply: "Num*",
    NumpadDivide: "Num/", ShiftLeft: "Left Shift", ShiftRight: "Right Shift", ControlLeft: "Left Ctrl",
    ControlRight: "Right Ctrl", AltLeft: "Left Alt", AltRight: "Right Alt", MetaLeft: "Left Cmd", MetaRight: "Right Cmd",
  };
  return named[code] ?? code.replace(/^Key|^Digit/, "").replace(/^Numpad/, "Num");
}

/** Standard-mapping names of gamepad buttons. */
export function padLabel(index: number): string {
  return ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Back", "Start", "L stick", "R stick", "D-pad ↑", "D-pad ↓", "D-pad ←", "D-pad →", "Home"][index] ?? `Button ${index}`;
}

/** One line per keyboard layout for the menu: "Keyboard: WASD, J sword, K action (lift, throw, roll), L item". */
export function describeLayout(layout: Record<InputAction, string[]>): string {
  const keys = (a: InputAction) => layout[a].map(keyLabel).join(" or ") || "none";
  const move = (["Up", "Left", "Down", "Right"] as const).map((a) => layout[a].map(keyLabel)[0] ?? "?"); // WASD order
  const moves = move.join("") === "WASD" ? "WASD" : move.join("") === "↑←↓→" ? "arrows" : `${move.join(" ")} move`;
  return `Keyboard: ${moves}, ${keys("Sword")} sword, ${keys("Action")} action (lift, throw, roll), ${keys("Item")} item`;
}
