// The Hyrulean Adventure's stages: `Boss/boss0WS.arc` for level W 1-8 and S 0-3, named by the game's own messages
// (msgus.arc's _e.bmg: message 1 + 4 (W - 1) + S, the levels at 0x2D-0x34; docs/ADVENTURE.md).
import { bmgMessageById, bmgPlainText, decompressYaz0, isYaz0, parseBmg, type Bmg, type RarcArchive } from "@fso/formats";

export interface StageInfo {
  /** The archive's name, e.g. "boss010" (also the #stage= deep link). */
  id: string;
  level: number;
  /** 0-3 in the archive's name. */
  slot: number;
  name: string;
}

export const LEVELS = 8;
const STAGE_MESSAGE = 1;
const LEVEL_MESSAGE = 0x2d;

export const stageId = (level: number, slot: number) => `boss0${level}${slot}`;

/** Every stage, named from the message file when it's given (else "Stage W-S"). */
export function adventureStages(bmg: Bmg | null): StageInfo[] {
  const out: StageInfo[] = [];
  for (let level = 1; level <= LEVELS; level++) {
    for (let slot = 0; slot < 4; slot++) {
      const message = bmg ? bmgMessageById(bmg, STAGE_MESSAGE + 4 * (level - 1) + slot) : undefined;
      out.push({ id: stageId(level, slot), level, slot, name: message ? bmgPlainText(message).replace(/\s+/g, " ").trim() : `Stage ${level}-${slot + 1}` });
    }
  }
  return out;
}

/** A level's name ("Whereabouts of the Wind"…), from its message. */
export function levelName(bmg: Bmg | null, level: number): string {
  const message = bmg ? bmgMessageById(bmg, LEVEL_MESSAGE + level - 1) : undefined;
  return message ? bmgPlainText(message).split("\n").slice(1).join(" ").trim() || `Level ${level}` : `Level ${level}`;
}

/** The English message file (msgus.arc `_e.bmg`), or null. */
export function englishMessages(archive: RarcArchive): Bmg | null {
  const file = archive.files.find((f) => f.path.endsWith("_e.bmg"));
  return file ? parseBmg(isYaz0(file.data) ? decompressYaz0(file.data) : file.data) : null;
}
