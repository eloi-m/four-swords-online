// Actors the adventure sim doesn't simulate yet and that must not be drawn meanwhile: a still sprite of a minor Shadow Link
// would stand frozen on screen. By stage index (the Cave of No Return 11, Hyrule Castle 13). Lake Hylia's ZSLJ (room 3,
// the one who jumps) and the hammer one (ZSLH, Lake Hylia's room 4 and Hyrule Castle's room 9) are simulated (sim
// adventure/minorshadow.ts); the sim leaves the ones listed here out. apps/game leaves them out of its statics; the
// playtest census (tools/playtest actors.ts) lists them hidden.
// Remove an entry when its actor is simulated.
export const HIDDEN_UNSIMULATED: Readonly<Record<number, readonly string[]>> = { 11: ["ZSLJ"], 13: ["ZSLJ"] };

/** Whether an actor type is not drawn in a stage (HIDDEN_UNSIMULATED). */
export const isHiddenUnsimulated = (stageIndex: number, id: string): boolean => HIDDEN_UNSIMULATED[stageIndex]?.includes(id) ?? false;
