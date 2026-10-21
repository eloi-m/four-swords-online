// The on-screen controls' logic: the stick's 8 sectors, threshold and dead zone (stick.ts), several fingers tracked
// by pointer id (touch.ts), the placement beside or over the TV frame (touch-layout.ts) and the stored settings.
import { Button } from "@fso/sim";
import { describe, expect, it } from "vitest";
import { stickButtons, STICK_THRESHOLD } from "./stick.ts";
import { TouchPad, type PadButton } from "./touch.ts";
import { layoutControls } from "./touch-layout.ts";
import { DEFAULT_TOUCH_SETTINGS, parseTouchSettings } from "./touch-settings.ts";

const { Up, Down, Left, Right, Sword, Item, Action } = Button;
const deg = (a: number, d = 50) => [Math.cos((a * Math.PI) / 180) * d, Math.sin((a * Math.PI) / 180) * d] as const;

describe("stick", () => {
  it("maps 45° sectors to 8 directions (screen y down)", () => {
    const at = (a: number) => stickButtons(...deg(a), 60);
    expect([0, 45, 90, 135, 180, 225, 270, 315].map(at)).toEqual([Right, Right | Down, Down, Down | Left, Left, Left | Up, Up, Up | Right]);
    // Each sector spans ±22.5° around its direction.
    expect([-22, 22, 23, 67, 68, 112, 113, 157, 158, 202, 203, 247, 248, 292, 293, 337].map(at)).toEqual([
      Right, Right, Right | Down, Right | Down, Down, Down, Down | Left, Down | Left, Left, Left, Left | Up, Left | Up, Up, Up, Up | Right, Up | Right,
    ]);
  });

  it("holds nothing inside the threshold (0.6 of the radius, the game's 0.59–0.69 tilt)", () => {
    expect(STICK_THRESHOLD).toBe(0.6);
    expect(stickButtons(0, 0, 60)).toBe(0);
    expect(stickButtons(35.9, 0, 60)).toBe(0);
    expect(stickButtons(36, 0, 60)).toBe(Right);
    expect(stickButtons(...deg(135, 35), 60)).toBe(0);
    expect(stickButtons(...deg(135, 37), 60)).toBe(Down | Left);
    expect(stickButtons(0, -200, 60)).toBe(Up); // far past the edge: still just Up
    expect(stickButtons(10, 0, 0)).toBe(0);
    expect(stickButtons(20, 0, 60, 0.3)).toBe(Right);
  });
});

describe("TouchPad", () => {
  const buttons: PadButton[] = [
    { action: "Sword", x: 700, y: 300, r: 34 },
    { action: "Item", x: 700, y: 222, r: 28 },
    { action: "Action", x: 764, y: 260, r: 28 },
  ];
  const pad = () => Object.assign(new TouchPad(), { stickBase: { x: 100, y: 300, r: 60 }, buttons });

  it("holds the stick with one finger while another holds and taps buttons", () => {
    const p = pad();
    p.stickDown(1, 100, 300); // on the base: pushes from its center
    expect(p.sample()).toBe(0);
    p.move(1, 150, 300);
    expect(p.sample()).toBe(Right);
    expect(p.buttonDown(2, 705, 305)).toBe(Sword); // newly pressed (for haptics)
    for (let tick = 0; tick < 60; tick++) expect(p.sample()).toBe(Right | Sword); // held: a charge
    p.move(1, 150, 350); // the stick turns while Sword stays held
    expect(p.sample()).toBe(Right | Down | Sword);
    expect(p.buttonDown(3, 760, 262)).toBe(Action); // a third finger
    expect(p.sample()).toBe(Right | Down | Sword | Action);
    p.up(2);
    expect(p.sample()).toBe(Right | Down | Action);
    p.up(1);
    p.up(3);
    expect(p.sample()).toBe(0);
    expect(p.touching).toBe(false);
  });

  it("latches a tap shorter than a tick until the next sample", () => {
    const p = pad();
    p.buttonDown(7, 700, 222);
    p.up(7);
    expect(p.held).toBe(0);
    expect(p.sample()).toBe(Item);
    expect(p.sample()).toBe(0);
    // A button another finger already holds isn't pressed again.
    p.buttonDown(8, 700, 300);
    expect(p.buttonDown(9, 702, 298)).toBe(0);
  });

  it("floats the stick where a finger lands off its base, and drags the base along past its edge", () => {
    const p = pad();
    p.stickDown(4, 300, 150); // off the base: the push starts from here
    expect(p.stick).toMatchObject({ ox: 300, oy: 150 });
    expect(p.sample()).toBe(0);
    p.move(4, 300, 400); // 250 px down: the base trails to 60 px above the finger
    expect(p.sample()).toBe(Down);
    expect(p.stick).toMatchObject({ ox: 300, oy: 340 });
    expect(p.stickOffset).toEqual({ x: 0, y: 60 });
    p.move(4, 300, 360); // 40 px back up: nothing (20 px past the base's center)
    expect(p.sample()).toBe(0);
    p.move(4, 300, 300); // 100 px back up (not the 250 it went down): Up
    expect(p.sample()).toBe(Up);
    // A second finger in the stick's zone doesn't take it over; a stick finger isn't a button finger.
    p.stickDown(5, 100, 300);
    expect(p.stick!.id).toBe(4);
    expect(p.buttonDown(4, 700, 300)).toBe(0);
  });

  it("slides between buttons, keeps a wandering thumb on its button, and lets go between buttons", () => {
    const p = pad();
    p.buttonDown(1, 700 + 34 * 1.1, 300); // within 1.2 radii: Sword
    expect(p.held).toBe(Sword);
    p.move(1, 700 + 34 * 1.45, 300); // wandered, still within 1.5 radii
    expect(p.held).toBe(Sword);
    expect(p.move(1, 764, 262)).toBe(Action); // slid onto Action
    expect(p.held).toBe(Action);
    p.move(1, 620, 380); // off every button
    expect(p.held).toBe(0);
    expect(p.move(1, 700, 225)).toBe(Item); // and onto Item
    expect(p.buttonDown(2, 600, 100)).toBe(0); // a finger landing between buttons presses nothing
    p.move(2, 700, 300);
    expect(p.held).toBe(Item | Sword);
    p.reset();
    expect(p.sample()).toBe(0);
  });
});

describe("layoutControls", () => {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };
  // The largest 608:448 frame in the window, centered (apps/battle ArenaView.frame).
  const tv = (w: number, h: number) => {
    const fw = Math.min(w, (h * 608) / 448), fh = (fw * 448) / 608;
    return { x: (w - fw) / 2, y: (h - fh) / 2, w: fw, h: fh };
  };
  const inside = (l: ReturnType<typeof layoutControls>, w: number, h: number, insets = none) =>
    [...l.buttons, l.stick].every((c) => c.x - c.r >= insets.left && c.x + c.r <= w - insets.right && c.y - c.r >= insets.top && c.y + c.r <= h - insets.bottom);

  it("puts the controls in the letterbox margins of a phone in landscape", () => {
    // An Android phone (915×412): 178 px margins hold the stick and the three-button cluster.
    const l = layoutControls({ w: 915, h: 412 }, tv(915, 412), none, 1);
    const f = tv(915, 412);
    expect(l.placement).toBe("margins");
    expect(l.stick.x + l.stick.r).toBeLessThanOrEqual(f.x);
    expect(Math.min(...l.buttons.map((b) => b.x - b.r))).toBeGreaterThanOrEqual(f.x + f.w);
    expect(inside(l, 915, 412)).toBe(true);
    expect(l.pause.x + l.pause.w).toBeLessThanOrEqual(f.x);
    // Targets of 44 px at least.
    expect(Math.min(...l.buttons.map((b) => 2 * b.r), l.pause.w, l.pause.h)).toBeGreaterThanOrEqual(44);
  });

  it("keeps out of a notched iPhone's safe area, stacking the buttons in its narrower margin", () => {
    const insets = { top: 0, right: 59, bottom: 21, left: 59 };
    const l = layoutControls({ w: 852, h: 393 }, tv(852, 393), insets, 1);
    expect(l.placement).toBe("margins");
    expect(inside(l, 852, 393, insets)).toBe(true);
    const xs = l.buttons.map((b) => b.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1); // one column
    expect(l.pause.x).toBeGreaterThanOrEqual(59);
  });

  it("goes over the frame when there are no margins (a 4:3 tablet), and scales with the size setting", () => {
    const l = layoutControls({ w: 1024, h: 768 }, tv(1024, 768), none, 1);
    expect(l.placement).toBe("over");
    expect(inside(l, 1024, 768)).toBe(true);
    expect(l.stick.x).toBeLessThan(512);
    expect(Math.min(...l.buttons.map((b) => b.x))).toBeGreaterThan(512);
    const big = layoutControls({ w: 1024, h: 768 }, tv(1024, 768), none, 1.5);
    expect(big.stick.r).toBeCloseTo(l.stick.r * 1.5);
    expect(inside(big, 1024, 768)).toBe(true);
    // Every finger lands in a zone: the stick's the left half, the buttons' the right one.
    expect(l.stickZone.x + l.stickZone.w).toBe(l.buttonZone.x);
    expect(l.buttonZone.x + l.buttonZone.w).toBe(1024);
  });
});

describe("touch settings", () => {
  it("fall back to the defaults, per field, and clamp", () => {
    expect(parseTouchSettings(null)).toEqual(DEFAULT_TOUCH_SETTINGS);
    expect(parseTouchSettings("{oops")).toEqual(DEFAULT_TOUCH_SETTINGS);
    expect(parseTouchSettings(JSON.stringify({ mode: "on", size: 9, opacity: 0.05, haptics: false }))).toEqual({ mode: "on", size: 1.5, opacity: 0.2, haptics: false });
    expect(parseTouchSettings(JSON.stringify({ mode: "sometimes", size: "big", opacity: 0.8 }))).toEqual({ ...DEFAULT_TOUCH_SETTINGS, opacity: 0.8 });
  });
});
