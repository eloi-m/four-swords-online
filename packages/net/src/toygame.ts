// A small deterministic game for netcode tests: players move, hit each other and churn a shared RNG, so any
// input difference quickly spreads through the whole state (and its hash).
import type { RollbackGame } from "./types.ts";

export interface ToyState {
  frame: number;
  x: number[];
  y: number[];
  hp: number[];
  rng: number;
}

export function createToy(players: number): ToyState {
  return {
    frame: 0,
    x: Array.from({ length: players }, (_, p) => 100 + p * 200),
    y: Array.from({ length: players }, (_, p) => 300 + (p & 1) * 50),
    hp: Array.from({ length: players }, () => 1000),
    rng: 0x12345678,
  };
}

const xorshift = (v: number): number => {
  v ^= v << 13;
  v ^= v >>> 17;
  v ^= v << 5;
  return v >>> 0;
};

export const toyGame: RollbackGame<ToyState> = {
  clone: (s) => ({ frame: s.frame, x: s.x.slice(), y: s.y.slice(), hp: s.hp.slice(), rng: s.rng }),
  step(s, inputs) {
    const n = s.x.length;
    for (let p = 0; p < n; p++) {
      const b = inputs[p] ?? 0, speed = b & 64 ? 5 : 3;
      s.x[p] = (s.x[p]! + ((b & 8 ? speed : 0) - (b & 4 ? speed : 0)) + 1024) % 1024;
      s.y[p] = (s.y[p]! + ((b & 2 ? speed : 0) - (b & 1 ? speed : 0)) + 1024) % 1024;
      if (b & 16) {
        for (let q = 0; q < n; q++) {
          if (q !== p && Math.abs(s.x[q]! - s.x[p]!) + Math.abs(s.y[q]! - s.y[p]!) < 80) s.hp[q] = s.hp[q]! - 1 - (s.rng & 3);
        }
      }
      s.rng = xorshift(s.rng ^ Math.imul(b + 1, p + 0x9e37));
    }
    s.frame++;
    return s;
  },
  hash(s) {
    let h = 0x811c9dc5;
    const mix = (v: number) => (h = Math.imul(h ^ (v | 0), 0x01000193));
    mix(s.frame);
    mix(s.rng);
    for (let p = 0; p < s.x.length; p++) {
      mix(s.x[p]!);
      mix(s.y[p]!);
      mix(s.hp[p]!);
    }
    return h >>> 0;
  },
};

/**
 * Scripted inputs: pseudo-random button masks held for 8 frames (even players) or 5 frames (odd players), so the
 * "repeat the last input" prediction is right most of the time and wrong at every change.
 */
export function scriptedInput(seed: number): (player: number, frame: number) => number {
  return (player, frame) => {
    const segment = player & 1 ? Math.floor(frame / 5) : frame >> 3;
    let v = Math.imul(segment + 1, 0x9e3779b1) ^ Math.imul(player + 1, 0x85ebca6b) ^ seed;
    v = Math.imul(v ^ (v >>> 16), 0x7feb352d);
    v ^= v >>> 15;
    return (v >>> 0) & 0x7f;
  };
}
