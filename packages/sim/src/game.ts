// The simulation root: plain, serializable state advanced by fixed 60 Hz ticks from per-player button masks.
import { stepLink } from "./actions.ts";
import { cloneBattle, stepBattle, type BattleState } from "./battle.ts";
import { createPlayer, SUBPX, type PlayerState } from "./player.ts";
import { roomTransitionAt, stepRoomTransition, type RoomTransition } from "./rooms.ts";
import { roomAt, type World } from "./world.ts";

export interface GameState {
  tick: number;
  players: PlayerState[];
  /** Room the camera belongs to (the leader's room). */
  room: number;
  /** Leader's automatic walk into the next room, while one is under way (rooms.ts). */
  transition?: RoomTransition;
  /** Shadow Battle rules and per-player combat state (battle.ts), when this is a battle. */
  battle?: BattleState;
}

export function createGame(world: World, spawns: { x: number; y: number }[]): GameState {
  const players = spawns.map((s) => createPlayer(s.x, s.y));
  const leader = players[0]!;
  return { tick: 0, players, room: roomAt(world, leader.x / SUBPX, leader.y / SUBPX) };
}

export function stepGame(state: GameState, inputs: readonly number[], world: World): GameState {
  if (state.battle) return stepBattle(state, inputs, world);
  state.players.forEach((p, i) => {
    if (i === 0 && state.transition) {
      p.held = inputs[i] ?? 0; // input is ignored during the auto-walk; a button held through it isn't a new press
      if (!stepRoomTransition(p, state.transition)) delete state.transition;
    } else stepLink(p, inputs[i] ?? 0, world);
  });
  const leader = state.players[0]!;
  if (!state.transition) {
    const transition = roomTransitionAt(world, leader);
    if (transition) {
      state.transition = transition;
      state.room = transition.room;
    }
  }
  const room = roomAt(world, Math.floor(leader.x / SUBPX), Math.floor(leader.y / SUBPX));
  if (room >= 0 && !state.transition) state.room = room;
  state.tick++;
  return state;
}

/** Deep copy for snapshots (rollback, replays, tests). */
export function cloneGame(state: GameState): GameState {
  const clone: GameState = { tick: state.tick, room: state.room, players: state.players.map((p) => ({ ...p })) };
  if (state.transition) clone.transition = { ...state.transition };
  if (state.battle) clone.battle = cloneBattle(state.battle);
  return clone;
}
