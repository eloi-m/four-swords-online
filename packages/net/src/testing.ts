// Test helpers (`@fso/net/testing`): simulated network, whole-match harness, a toy game.
export { appliedInputs, playerId, replay, runMatch, type MatchOptions, type MatchPeer, type MatchResult } from "./match.ts";
export { rng, runSimulation, SimNetwork, type LinkConditions, type Ticker } from "./simnet.ts";
export { createToy, scriptedInput, toyGame, type ToyState } from "./toygame.ts";
