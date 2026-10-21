// Input scripts for trace runs: `;`-separated segments of `<frames> <input>`, e.g. `30 idle; 40 right; 20 down-right+B`.
// Inputs are `+`-joined tokens: stick directions (right, left, up, down, up-right, …; full tilt, diagonals on the
// unit circle), `stick=x,y` (raw 0–255), the C stick (c-up, c-down, c-left, c-right: full tilt), D-pad (dpad-right…),
// buttons (A B X Y Z L R START; L and R also fully press the analog trigger; SELECT = Z, the GBA's Select), or `idle`.
// Several players: space-separated `p<n>:<input>` specs, e.g. `20 p1:right+B p2:A`; players not named are idle, and
// a spec without a prefix is player 1's. Player n plays port n. On a GBA port (Dolphin's integrated GBA) the
// directions press the D-pad, A B L R START SELECT are the GBA's keys, and X resets the GBA.
import type { PadInput, PortDevice } from "./dtm.ts";

export interface Segment {
  frames: number;
  /** Player 1's input (= inputs[0]). */
  input: PadInput;
  /** Per player (port) 1–4. */
  inputs: PadInput[];
  label: string;
}

const DIAGONAL = Math.round(127 * Math.SQRT1_2); // 90: a real stick's diagonal reach
export const MAX_PLAYERS = 4;

export function parseScript(script: string): Segment[] {
  return script
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^(\d+)\s+(.+)$/.exec(s);
      if (!m) throw new Error(`bad segment "${s}" (expected "<frames> <input>")`);
      const inputs = parsePlayers(m[2]!);
      return { frames: Number(m[1]), input: inputs[0]!, inputs, label: m[2]!.trim() };
    });
}

/** `p1:right+B p2:A` (or a bare spec for player 1) → one input per player. */
export function parsePlayers(spec: string): PadInput[] {
  const inputs = Array.from({ length: MAX_PLAYERS }, (): PadInput => ({}));
  for (const part of spec.trim().split(/\s+/)) {
    const m = /^p([1-4]):(.*)$/.exec(part);
    if (m) inputs[Number(m[1]) - 1] = parseInput(m[2]!);
    else if (/^p\d*:/.test(part)) throw new Error(`bad player in "${part}" (p1–p4)`);
    else inputs[0] = parseInput(part);
  }
  return inputs;
}

export function parseInput(spec: string): PadInput {
  const input: PadInput = {};
  let dx = 0, dy = 0;
  for (const token of spec.split("+").map((t) => t.trim())) {
    const stick = /^stick=(\d+),(\d+)$/.exec(token);
    const c = /^c-(up|down|left|right)$/.exec(token);
    if (token === "idle" || token === "") continue;
    else if (c) {
      if (c[1] === "left" || c[1] === "right") input.cStickX = c[1] === "right" ? 255 : 1;
      else input.cStickY = c[1] === "up" ? 255 : 1;
    } else if (stick) [input.stickX, input.stickY] = [Number(stick[1]), Number(stick[2])];
    else if (/^(up|down|left|right)(-(up|down|left|right))?$/.test(token)) {
      for (const d of token.split("-")) {
        if (d === "right") dx = 1;
        if (d === "left") dx = -1;
        if (d === "up") dy = 1;
        if (d === "down") dy = -1;
      }
    } else if (token.startsWith("dpad-")) {
      const d = token.slice(5) as "up" | "down" | "left" | "right";
      if (!["up", "down", "left", "right"].includes(d)) throw new Error(`bad D-pad token ${token}`);
      input[d] = true;
    } else {
      const key = ({ A: "a", B: "b", X: "x", Y: "y", Z: "z", SELECT: "z", L: "l", R: "r", START: "start" } as const)[token as "A"];
      if (!key) throw new Error(`unknown input token "${token}"`);
      input[key] = true;
      // A full press of the analog shoulders also clicks the digital button (the game may read either).
      if (token === "R") input.triggerR = 255;
      if (token === "L") input.triggerL = 255;
    }
  }
  if (dx || dy) {
    const reach = dx && dy ? DIAGONAL : 127;
    input.stickX = Math.min(255, 128 + dx * reach);
    input.stickY = Math.min(255, 128 + dy * reach);
  }
  return input;
}

/** A GBA port's state: the stick's directions become the D-pad (the GBA has no stick), the analog values go. */
export function gbaPad(p: PadInput): PadInput {
  const x = (p.stickX ?? 128) - 128, y = (p.stickY ?? 128) - 128;
  const out: PadInput = {
    up: p.up || y >= 64,
    down: p.down || y <= -64,
    left: p.left || x <= -64,
    right: p.right || x >= 64,
  };
  for (const k of ["a", "b", "x", "z", "l", "r", "start"] as const) if (p[k]) out[k] = true;
  return out;
}

/** Expands segments into player 1's per-poll controller states. */
export function toPolls(segments: readonly Segment[], pollsPerFrame: number): PadInput[] {
  return segments.flatMap((s) => Array.from({ length: s.frames * pollsPerFrame }, () => s.input));
}

/** Expands segments into the movie's state stream for a port layout: per poll, one state for each plugged port in port
 *  order (player n on port n; GBA ports get `gbaPad`). */
export function toPortStates(segments: readonly Segment[], pollsPerFrame: number, ports: readonly PortDevice[]): PadInput[] {
  const perPoll = (s: Segment) =>
    ports.flatMap((port, i) => (port === "none" ? [] : [port === "gba" ? gbaPad(s.inputs[i]!) : s.inputs[i]!]));
  return segments.flatMap((s) => {
    const poll = perPoll(s);
    return Array.from({ length: s.frames * pollsPerFrame }, () => poll).flat();
  });
}

/** `gba,gba` → ["gba", "gba"] (ports 1–4; missing ones are empty). */
export function parsePorts(spec: string): PortDevice[] {
  const ports = spec.split(",").map((p) => p.trim());
  if (ports.length > MAX_PLAYERS || ports.some((p) => !["gc", "gba", "none"].includes(p))) {
    throw new Error(`bad --ports "${spec}" (up to 4 of gc, gba, none)`);
  }
  return ports as PortDevice[];
}
