// This machine's players: the keyboard layouts, then every connected gamepad (Gamepad API), each turned into the sim's
// button mask once per tick. Player n gets device n (keyboards first, or gamepads first if asked); other sources (the
// on-screen controls) can be attached to a player and play along with that player's device. The keys and pad buttons
// come from the bindings (bindings.ts; Shadow Battle's are remappable in its Controls dialog).
import { Button } from "@fso/sim";
import { ACTION_BITS, ACTIONS, DEFAULT_BINDINGS, describeLayout, loadBindings, type Bindings } from "./bindings.ts";
import { cancelOpposites, type ButtonSource } from "./buttons.ts";

const STICK_THRESHOLD = 0.5;

type Device = { kind: "keyboard"; layout: number } | { kind: "gamepad"; index: number };

export class LocalInput {
  private held = new Set<string>();
  gamepadsFirst = false;
  /** Per keyboard layout: key code → button bits. */
  private layouts: Map<string, number>[] = [];
  /** [button index, bits] for every pad. */
  private padMap: [number, number][] = [];
  private current: Bindings = DEFAULT_BINDINGS;
  /** Sources played along with a player's device, by player index. */
  private readonly attached = new Map<number, ButtonSource[]>();

  constructor(target: Window = window, bindings: Bindings = loadBindings()) {
    this.bindings = bindings;
    target.addEventListener("keydown", (e) => {
      if (!this.layouts.some((l) => l.has(e.code))) return;
      this.held.add(e.code);
      if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) e.preventDefault();
    });
    target.addEventListener("keyup", (e) => this.held.delete(e.code));
    target.addEventListener("blur", () => this.held.clear());
  }

  get bindings(): Bindings {
    return this.current;
  }

  set bindings(b: Bindings) {
    this.current = b;
    this.layouts = b.keyboards.map((layout) => {
      const map = new Map<string, number>();
      for (const a of ACTIONS) for (const code of layout[a]) map.set(code, (map.get(code) ?? 0) | ACTION_BITS[a]);
      return map;
    });
    const pad = new Map<number, number>();
    for (const a of ACTIONS) for (const i of b.gamepad[a]) pad.set(i, (pad.get(i) ?? 0) | ACTION_BITS[a]);
    this.padMap = [...pad];
    this.held.clear();
  }

  /** Plays `source` along with player `player`'s device (its buttons are merged in). */
  attach(player: number, source: ButtonSource): void {
    this.attached.set(player, [...(this.attached.get(player) ?? []), source]);
  }

  detach(source: ButtonSource): void {
    for (const [player, list] of this.attached) this.attached.set(player, list.filter((s) => s !== source));
  }

  private gamepads(): Gamepad[] {
    return (navigator.getGamepads?.() ?? []).filter((g): g is Gamepad => g !== null && g.connected);
  }

  private devices(pads: Gamepad[]): Device[] {
    const keyboards: Device[] = this.layouts.map((_, layout) => ({ kind: "keyboard", layout }));
    const gamepads: Device[] = pads.map((g) => ({ kind: "gamepad", index: g.index }));
    return this.gamepadsFirst ? [...gamepads, ...keyboards] : [...keyboards, ...gamepads];
  }

  /** Who controls each of the first `players` players (null = nobody, the Link stands still). */
  describe(players: number): (string | null)[] {
    const pads = this.gamepads();
    const devices = this.devices(pads);
    return Array.from({ length: players }, (_, i) => {
      const s = devices[i];
      const extra = (this.attached.get(i) ?? []).filter((a) => a.active !== false && a.label).map((a) => a.label!);
      const device = !s
        ? null
        : s.kind === "keyboard"
          ? describeLayout(this.current.keyboards[s.layout]!)
          : `Gamepad ${s.index + 1}: ${pads.find((g) => g.index === s.index)?.id.replace(/\s*\(.*$/, "") ?? ""}`;
      return [...extra, ...(device ? [device] : [])].join(" · ") || null;
    });
  }

  /** Buttons of the one local player of an online match: the first keyboard layout, the first gamepad, player 0's sources. */
  single(): number {
    const pad = this.gamepads()[0];
    return cancelOpposites(this.keys(0) | (pad ? this.padButtons(pad) : 0) | this.extra(0));
  }

  /** Buttons for each of the first `players` players. */
  sample(players: number): number[] {
    const pads = this.gamepads();
    const devices = this.devices(pads);
    const out: number[] = [];
    for (let i = 0; i < players; i++) {
      const s = devices[i];
      let buttons = this.extra(i);
      if (s?.kind === "keyboard") buttons |= this.keys(s.layout);
      else if (s) {
        const pad = pads.find((g) => g.index === s.index);
        if (pad) buttons |= this.padButtons(pad);
      }
      out.push(cancelOpposites(buttons));
    }
    return out;
  }

  private extra(player: number): number {
    let buttons = 0;
    for (const source of this.attached.get(player) ?? []) {
      const b = source.sample();
      if (source.active !== false) buttons |= b;
    }
    return buttons;
  }

  private keys(layout: number): number {
    const map = this.layouts[layout];
    let buttons = 0;
    if (map) for (const code of this.held) buttons |= map.get(code) ?? 0;
    return buttons;
  }

  private padButtons(pad: Gamepad): number {
    let buttons = 0;
    for (const [i, bits] of this.padMap) if (pad.buttons[i]?.pressed) buttons |= bits;
    const [ax = 0, ay = 0] = pad.axes;
    if (ay < -STICK_THRESHOLD) buttons |= Button.Up;
    if (ay > STICK_THRESHOLD) buttons |= Button.Down;
    if (ax < -STICK_THRESHOLD) buttons |= Button.Left;
    if (ax > STICK_THRESHOLD) buttons |= Button.Right;
    return buttons;
  }
}
