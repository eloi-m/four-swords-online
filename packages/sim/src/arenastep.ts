// One tick of everything in a Shadow Battle arena besides the Links' own control, in a fixed order (after the Links
// moved, before sword hits): loads follow their carriers, things fly, bombs burn and blow up, hazards act, items and
// orbs, respawns. `harmful` is false once the round is decided: things keep moving but hurt nobody.
import { attachLoads } from "./carry.ts";
import { stepBombchus } from "./bombchus.ts";
import { stepBombs, stepExplosions } from "./bombs.ts";
import { sweepEntities } from "./entities.ts";
import type { GameState } from "./game.ts";
import { stepFire } from "./firerod.ts";
import { poundHits, stepFlat } from "./hammer.ts";
import { stepHazards, stepRespawns } from "./hazards.ts";
import { stepItemEffects } from "./items.ts";
import { stepPickups } from "./orbs.ts";
import { stepProjectiles } from "./projectiles.ts";
import { fallEntities, thingWarps } from "./siderooms.ts";
import { swordStrikes } from "./strike.ts";
import type { World } from "./world.ts";

export function stepArena(state: GameState, world: World, harmful: boolean, arrowWorld: World = world): void {
  const b = state.battle!;
  attachLoads(state);
  for (const f of b.fighters) stepFlat(f); // (a hammer's flattening wearing off: hammer.ts)
  if (harmful) {
    thingWarps(state); // things thrown or shot into a door or a hole: out of the other side, flying on from there
    stepProjectiles(state, world, arrowWorld);
    b.hits.push(...stepFire(state, world), ...poundHits(state)); // (the Fire Rod and the hammer: firerod.ts, hammer.ts)
    fallEntities(state, world); // (side view: what lies there with nothing under it)
    stepBombs(state);
    stepExplosions(state, true);
    stepHazards(state, world);
    stepBombchus(state, world); // (after the spawners: one counts its first tick on the one it appears on, as traced)
    stepItemEffects(state);
    stepRespawns(b); // before the pickups: a new orb or item counts its first tick (CRTL, LSTI)
    stepPickups(state);
    attachLoads(state); // a bomb that went off in someone's hands frees them this tick
  } else stepExplosions(state, false);
  sweepEntities(b);
}

/** Sword strikes on entities and bushes (after the sword hits between Links). */
export function stepStrikes(state: GameState): void {
  swordStrikes(state);
  sweepEntities(state.battle!);
}
