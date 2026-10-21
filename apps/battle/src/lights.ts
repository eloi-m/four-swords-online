// The arenas' lighting, as main.dol sets it up (docs/formats/battle-arenas.md "Lighting and the Dark World"): a room's LTEV actor
// ("light environment control") sets the stage's light, a tint color and an ambient level (0-255), and while that
// level is below 255 the frame is multiplied by the tint and by the light gathered in the frame buffer's alpha: the
// ambient level plus a soft circle (data.arc timg/circle.bti) around each light source. In the Dark World the ambient
// level is 10, so only the circles around the Links (85 px, multiplayer) and the arena's flames show the ground; the
// Links themselves are drawn at full brightness. The Tower of Flames (room 1) is lit too: warm and slightly dim. Rooms
// without an LTEV get their light from their SWEV ("environment switch control"): the Tower of Winds is blue and dim,
// Above the Clouds slightly tinted (SWEV_LIGHTS). This module is plain data read from the stage and the sim's state; lighting.ts draws it.
import type { Stage } from "@fso/formats";
import { fighterFrame, fighterHeight, fireballs, SUBPX, CRYSTAL_LIGHT, crystalShines, type GameState } from "@fso/sim";

/**
 * The light a room's LTEV (or SWEV) sets: its tint (RGB, 0-255), the tint's alpha (0-255: the pass adds tint × alpha)
 * and ambient level (0-255, 255 = no darkness). `kind` is the LTEV's kind, −1 for a SWEV's light.
 */
export interface RoomLight {
  kind: number;
  tint: readonly [number, number, number];
  tintAlpha: number;
  ambient: number;
}

/**
 * The stage light ([0x8053AB10]+0x2C: tint RGBA, level) the SWEVs of the rooms without an LTEV set, by SWEV params;
 * read in RAM from the round-start states (2p and 4p alike). SWEV keeps its light in +0x2E0…+0x2EC and +0x310 and
 * writes it every frame (update 0x802B3AB8, kinds 0, 13, 14); where those values come from wasn't traced. The other
 * rooms without an LTEV (The Field, Hyrule Castle) stay white at 255.
 */
export const SWEV_LIGHTS: Readonly<Record<number, readonly [number, number, number, number, number]>> = {
  0x0010020e: [150, 200, 255, 20, 180], // Tower of Winds
  0x0001000d: [190, 210, 200, 0, 255], // Above the Clouds
};

/**
 * LTEV kinds (params & 0xFF), from its init (0x802EFBFC, jump table 0x804AA548): tint RGB and ambient level. Kinds 2, 5,
 * 8, 11 and 15 fade there from the current light (4 levels per frame) and kind 16 brightens to 200 when its switch
 * turns on; the battle rooms use 0, 1, 3, 4 and 9, which apply at once.
 */
export const LTEV_KINDS: readonly (readonly [number, number, number, number])[] = [
  [210, 200, 170, 10],
  [150, 200, 255, 10],
  [255, 200, 160, 130],
  [255, 200, 160, 10],
  [255, 200, 160, 200],
  [255, 200, 160, 200],
  [200, 210, 255, 10],
  [200, 210, 255, 200],
  [200, 210, 255, 200],
  [150, 200, 255, 10],
  [150, 200, 255, 130],
  [150, 200, 255, 130],
  [210, 255, 255, 220],
  [255, 128, 255, 10],
  [255, 128, 255, 200],
  [255, 128, 255, 130],
  [255, 200, 160, 10],
  [255, 255, 255, 128],
];

/** The light of a boss500 room, or null when it has none (full light: nothing to draw). */
export function roomLight(stage: Stage, room: number): RoomLight | null {
  const actors = stage.actors(room);
  const ltev = actors.find((a) => a.id === "LTEV" && a.sublayer === 0);
  const entry = ltev ? LTEV_KINDS[ltev.params & 0xff] : undefined;
  if (ltev && entry) {
    const [r, g, b, ambient] = entry;
    return { kind: ltev.params & 0xff, tint: [r, g, b], tintAlpha: 0, ambient };
  }
  const swev = actors.find((a) => a.id === "SWEV" && a.sublayer === 0);
  const light = swev ? SWEV_LIGHTS[swev.params] : undefined;
  if (!light) return null;
  const [r, g, b, tintAlpha, ambient] = light;
  return { kind: -1, tint: [r, g, b], tintAlpha, ambient };
}

/** A light circle: center in arena px (already raised by the source's height), radius in px, strength 0-255. */
export interface LightSource {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

/**
 * Each Link's own light in multiplayer (Link +0xB90: it eases toward 85 px, 1 px per frame, from 85.33 at spawn;
 * 0x802580E0), drawn by 0x80264998 at the Link (+0x338 = his position when not playing alone) with strength 255.
 */
export const LINK_LIGHT = { radius: 85, alpha: 255 } as const;
/** BLZ2 eternal flames (draw 0x802E4E6C): 32 px, strength 128, one per flame of the actor's grid. */
export const FLAME_LIGHT = { radius: 32, alpha: 128 } as const;
/** FLME fire-pit flames at rest (draw 0x8015DE10): 60 px, strength 128. */
export const JET_LIGHT = { radius: 60, alpha: 128 } as const;

/** FBOB fireballs of the fire bars: 32 px, strength 128 each. */
export const FIREBALL_LIGHT = { radius: 32, alpha: 128 } as const;

/** The light sources of a battle frame: the Links still drawn, the lit flames and crystals, the fire bars. */
export function lightSources(game: GameState): LightSource[] {
  const out: LightSource[] = [];
  const b = game.battle;
  game.players.forEach((p, i) => {
    const f = b?.fighters[i];
    if (f && fighterFrame(p, f, () => 0) < 0) return; // out of the round
    const x = Math.floor(p.x / SUBPX), y = Math.floor(p.y / SUBPX) - (f ? fighterHeight(f) : 0);
    out.push({ x, y, ...LINK_LIGHT });
  });
  if (!b) return out;
  for (const e of b.entities) {
    if (e.hp < 0) continue;
    const x = Math.floor(e.x / SUBPX), y = Math.floor(e.y / SUBPX);
    if (e.kind === "flame" && e.phase === "active") out.push({ x, y, ...FLAME_LIGHT });
    else if (e.kind === "jet") out.push({ x, y, ...JET_LIGHT }); // drawn even while the jet is off
    else if (e.kind === "crystal" && crystalShines(b, e)) out.push({ x, y, ...CRYSTAL_LIGHT });
    else if (e.kind === "firebar") for (const ball of fireballs(b, e)) out.push({ x: Math.floor(ball.x / SUBPX), y: Math.floor(ball.y / SUBPX), ...FIREBALL_LIGHT });
  }
  return out;
}

