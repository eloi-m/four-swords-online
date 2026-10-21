// Key and gamepad bindings (bindings.ts): stored settings are validated per action, the menu's descriptions, and a
// LocalInput (local.ts) sampling remapped keys and pad buttons (a plain EventTarget stands in for the window), with
// sources attached to a player merged in.
import { Button } from "@fso/sim";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADVENTURE_BINDINGS, copyBindings, DEFAULT_BINDINGS, describeLayout, keyLabel, padLabel, parseBindings } from "./bindings.ts";
import { mergeButtons, type ButtonSource } from "./buttons.ts";
import { LocalInput } from "./local.ts";

describe("bindings", () => {
  it("fall back to the defaults, per action, for missing or malformed settings", () => {
    expect(parseBindings(null)).toEqual(DEFAULT_BINDINGS);
    expect(parseBindings("not json")).toEqual(DEFAULT_BINDINGS);
    const partial = parseBindings(JSON.stringify({ keyboards: [{ Sword: ["Space"], Item: "KeyL" }], gamepad: { Action: [3], Sword: [-1] } }));
    expect(partial.keyboards[0]!.Sword).toEqual(["Space"]);
    expect(partial.keyboards[0]!.Item).toEqual(["KeyL"]); // not an array: default
    expect(partial.keyboards[1]).toEqual(DEFAULT_BINDINGS.keyboards[1]);
    expect(partial.gamepad.Action).toEqual([3]);
    expect(partial.gamepad.Sword).toEqual([0]); // out of range: default
    expect(DEFAULT_BINDINGS.keyboards[0]!.Sword).toEqual(["KeyJ"]); // the defaults aren't modified
  });

  it("describe the layouts as the menu shows them", () => {
    expect(describeLayout(DEFAULT_BINDINGS.keyboards[0]!)).toBe("Keyboard: WASD, J sword, K action (lift, throw, roll), L item");
    expect(describeLayout(DEFAULT_BINDINGS.keyboards[1]!)).toBe("Keyboard: arrows, , or Num0 sword, . or Num. action (lift, throw, roll), / or NumEnter item");
    const custom = copyBindings(DEFAULT_BINDINGS).keyboards[0]!;
    Object.assign(custom, { Up: ["KeyI"], Down: ["KeyK"], Left: ["KeyJ"], Right: ["KeyL"], Sword: ["Space"], Action: [], Item: ["ShiftLeft"] });
    expect(describeLayout(custom)).toBe("Keyboard: I J K L move, Space sword, none action (lift, throw, roll), Left Shift item");
    expect([keyLabel("Digit3"), keyLabel("NumpadAdd"), keyLabel("ArrowLeft"), padLabel(7), padLabel(20)]).toEqual(["3", "Num+", "←", "RT", "Button 20"]);
  });
});

describe("LocalInput", () => {
  afterEach(() => vi.unstubAllGlobals());

  const key = (target: EventTarget, type: "keydown" | "keyup", code: string) => target.dispatchEvent(Object.assign(new Event(type), { code }));

  it("samples remapped keys, keyboard layouts first", () => {
    vi.stubGlobal("HTMLInputElement", class {});
    vi.stubGlobal("HTMLSelectElement", class {});
    const target = new EventTarget();
    const bindings = copyBindings(DEFAULT_BINDINGS);
    bindings.keyboards[0]!.Sword = ["Space"];
    bindings.keyboards[0]!.Right = ["KeyG"];
    const input = new LocalInput(target as unknown as Window, bindings);
    key(target, "keydown", "Space");
    key(target, "keydown", "KeyG");
    key(target, "keydown", "KeyJ"); // no longer bound
    key(target, "keydown", "ArrowUp");
    expect(input.sample(3)).toEqual([Button.Sword | Button.Right, Button.Up, 0]);
    expect(input.single()).toBe(Button.Sword | Button.Right);
    key(target, "keyup", "KeyG");
    key(target, "keydown", "KeyA");
    key(target, "keydown", "KeyD"); // now unbound: KeyA alone moves left
    expect(input.sample(1)).toEqual([Button.Sword | Button.Left]);
    // New bindings take effect at once (and drop the keys held under the old ones).
    input.bindings = copyBindings(DEFAULT_BINDINGS);
    key(target, "keydown", "KeyJ");
    expect(input.sample(1)).toEqual([Button.Sword]);
  });

  it("reads remapped gamepad buttons and the stick, gamepads first when asked", () => {
    const pad = (pressed: number[], axes = [0, 0]) => ({ index: 0, id: "Test pad (STANDARD GAMEPAD)", connected: true, axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })) });
    let pads = [pad([0])];
    vi.stubGlobal("navigator", { getGamepads: () => pads });
    const bindings = copyBindings(DEFAULT_BINDINGS);
    bindings.gamepad.Sword = [3];
    bindings.gamepad.Item = [0];
    const input = new LocalInput(new EventTarget() as unknown as Window, bindings);
    expect(input.sample(3)).toEqual([0, 0, Button.Item]);
    input.gamepadsFirst = true;
    pads = [pad([3, 13], [0.9, 0])];
    expect(input.sample(1)).toEqual([Button.Sword | Button.Down | Button.Right]);
    expect(input.describe(2)).toEqual(["Gamepad 1: Test pad", "Keyboard: WASD, J sword, K action (lift, throw, roll), L item"]);
  });

  it("merges attached sources into their player's buttons, across devices, opposites cancelled", () => {
    vi.stubGlobal("HTMLInputElement", class {});
    vi.stubGlobal("HTMLSelectElement", class {});
    const pad = (pressed: number[], axes = [0, 0]) => ({ index: 0, id: "Test pad", connected: true, axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })) });
    let pads = [pad([])];
    vi.stubGlobal("navigator", { getGamepads: () => pads });
    const target = new EventTarget();
    const input = new LocalInput(target as unknown as Window, copyBindings(DEFAULT_BINDINGS));
    let touch = Button.Right | Button.Sword;
    const source: ButtonSource & { active: boolean } = { label: "On-screen controls", active: true, sample: () => touch };
    input.attach(0, source);
    key(target, "keydown", "KeyA"); // keyboard 1 holds Left: against the touch stick's Right, no direction
    expect(input.sample(3)).toEqual([Button.Sword, 0, 0]);
    key(target, "keyup", "KeyA");
    key(target, "keydown", "KeyL");
    expect(input.sample(1)).toEqual([Button.Right | Button.Sword | Button.Item]);
    // Online, the one player gets keyboard 1, the first pad and player 0's sources.
    pads = [pad([2], [0, -0.8])];
    touch = Button.Sword;
    expect(input.single()).toBe(Button.Sword | Button.Item | Button.Action | Button.Up);
    expect(input.describe(1)).toEqual(["On-screen controls · Keyboard: WASD, J sword, K action (lift, throw, roll), L item"]);
    // An inactive source (the controls on a desktop) is sampled (its latched taps dropped) but plays nothing.
    source.active = false;
    expect(input.sample(1)).toEqual([Button.Item]);
    expect(input.describe(1)).toEqual(["Keyboard: WASD, J sword, K action (lift, throw, roll), L item"]);
    source.active = true;
    input.detach(source);
    expect(input.single()).toBe(Button.Item | Button.Action | Button.Up);
    expect(mergeButtons(Button.Up, Button.Down | Button.Sword, Button.Left)).toBe(Button.Left | Button.Sword);
  });

  it("plays the Lake Hylia pages' fixed keys: arrows or WASD, J/Z sword, K/X item, L/C action", () => {
    vi.stubGlobal("HTMLInputElement", class {});
    vi.stubGlobal("HTMLSelectElement", class {});
    vi.stubGlobal("navigator", { getGamepads: () => [] });
    const target = new EventTarget();
    const input = new LocalInput(target as unknown as Window, ADVENTURE_BINDINGS);
    for (const code of ["ArrowUp", "KeyD", "KeyZ", "KeyX", "KeyC"]) key(target, "keydown", code);
    expect(input.single()).toBe(Button.Up | Button.Right | Button.Sword | Button.Item | Button.Action);
    key(target, "keydown", "KeyW"); // two keys for Up: releasing one keeps it held
    key(target, "keyup", "ArrowUp");
    expect(input.single() & Button.Up).toBe(Button.Up);
  });
});
