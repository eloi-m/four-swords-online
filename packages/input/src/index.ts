// @fso/input: every way a player's buttons reach the sim (a u16 mask per tick): keyboard layouts and gamepads
// (LocalInput, with Shadow Battle's remappable bindings), and the on-screen touch controls, whose DOM overlay is
// `@fso/input/touch` (TouchControls); everything here is plain logic, testable in node.
export * from "./bindings.ts";
export { cancelOpposites, DIRECTIONS, mergeButtons, type ButtonSource } from "./buttons.ts";
export { LocalInput } from "./local.ts";
export { STICK_THRESHOLD, stickButtons } from "./stick.ts";
export { TOUCH_BUTTONS, TouchPad, type Circle, type PadButton, type StickFinger, type TouchButton } from "./touch.ts";
export { layoutControls, type ControlsLayout, type Insets, type Rect } from "./touch-layout.ts";
export * from "./touch-settings.ts";
