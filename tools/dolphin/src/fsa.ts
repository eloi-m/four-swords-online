// FSA (G4SE01 rev 0) runtime addresses found with the GDB tracer, and a per-frame snapshot reader. See docs/formats/runtime-ram.md
// "Runtime (RAM) notes" for how each field was identified and how sure we are.
import type { GdbClient } from "./gdb.ts";

export const R13 = 0x80541bc0; // small-data base (constant for this DOL)
/** Head of the main loop in main(): hit exactly once per 60 Hz frame, between two game updates. */
export const MAIN_LOOP_HEAD = 0x801347f8;
export const VI_RETRACE_COUNT = R13 - 0x7654; // u32, incremented by the VI retrace handler
/** Pointer to the player manager; its +4 + 4i are the four Link actors (player 0 = the single-player leader). */
export const PLAYER_MANAGER_PTR = R13 - 0x6f30;
/** PADStatus[4] as filled by PADRead: u16 buttons, s8 stick x, s8 stick y, … (12 bytes each). */
export const PAD_STATUS = 0x8052ea28;
/** Normalized stick of pad 0: f32 x, f32 y, f32 magnitude, u16 angle (0x4000 = right). */
export const PAD_STICK = 0x8052eb18;
/** View matrix (3×4 f32); translation x at +0xC and y at +0x1C hold -camera center (world px). */
export const VIEW_MATRIX = 0x80536c50;
/** [[STAGE_PTR] + 0x24] = the camera the stage drawers read: f32 zoom (TV px per world px) at +0x858. */
export const STAGE_PTR = 0x8053ab10;
export const CAMERA_ZOOM = 0x858;
/** Shadow Battle: the keys each player's GBA reported, one 0xE0-byte record per player (bss). u16 at +0: bits 0–7 =
 *  A, B, Select, Start, Right, Left, Up, Down (pressed = 1), bit 8 (sometimes 9) set; u16 at +2: R 0x100, L 0x200, and
 *  a low byte that changes with the keys (a check byte?). Holds the movie input one frame late. */
export const GBA_KEYS = 0x804db7f8;
export const GBA_KEYS_STRIDE = 0xe0;
/** GBA keys in KEYINPUT order (A 1, B 2, Select 4, Start 8, Right 0x10, Left 0x20, Up 0x40, Down 0x80, R 0x100, L 0x200). */
export const gbaKeys = (w0: number, w2: number) => (w0 & 0xff) | (w2 & 0x300);

/** Link actor (vtable 0x804A6F38, 0x13BC bytes). Offsets. */
export const LINK = {
  x: 0x8, // f32 world px (room cell (cx, cy) spans x cx*512…, y cy*384…)
  y: 0xc,
  z: 0x10, // f32 height above the ground (the knockback hop), px
  speedX: 0x38c, // f32 walk speed per axis this frame (0 when blocked)
  speedY: 0x390,
  frame: 0x3c4, // u16 player_sob frame drawn, then u16 the previous one
  animTick: 0x3f8, // u8 walk-cycle tick, then u8 walk frame (tick / 3)
  state: 0x1240, // u32 current state, next state, previous state
  // Found while measuring lifting, rolling, damage and items (docs/measurements.md).
  knockback: 0x350, // f32 x, y knockback velocity (px/frame), then f32 vertical (hop) velocity at +0x358
  facing: 0x3dc, // u32 0 right, 1 left, 2 down, 3 up
  invincible: 0x464, // u32 invincibility frames left (60 after a hit)
  bombs: 0xb30, // 2 × s32 handles of this Link's placed bombs, -1 = free
  maxLife: 0xbf8, // u32 (16 in the savestate)
  life: 0xbfc, // u32 (-2 per Octorok hit)
  item: 0xc10, // u32 item: 0 none, 1 lamp?, 2 Roc's Feather, 3 boomerang, 4 bow, 5 hammer, 6 Fire Rod, 7 boots?, 8 bombs, 9 shovel, 10 slingshot
  itemLevel: 0xc14, // u32
  carried: 0xd64, // u8 1 while lifting/carrying, +0xd68 the carried actor's handle, +0xd6c its type ID ("GRAS"; "NULL" when empty)
} as const;

export interface LinkSnapshot {
  x: number;
  y: number;
  z: number;
  life: number;
  invincible: number;
  frame: number;
  prevFrame: number;
  animTick: number;
  animFrame: number;
  speedX: number;
  speedY: number;
  state: number;
  nextState: number;
  prevState: number;
  facing: number;
  /** Knockback velocity x, y and the hop's vertical speed (px/frame). */
  knock: [number, number, number];
  /** Extra Link fields asked for (`trace.ts --link <hexoff>:<hexlen>`): hex bytes by hex offset. */
  raw?: Record<string, string>;
}

export interface FrameSnapshot {
  retrace: number;
  pad: { buttons: number; x: number; y: number };
  stick: { x: number; y: number; angle: number };
  camera: { x: number; y: number; zoom?: number };
  links: LinkSnapshot[];
  /** Shadow Battle: per GBA port, the keys the game received (`gbaKeys`). */
  gba?: number[];
}

export const isRam = (a: number) => a >= 0x80000000 && a < 0x81800000;

/** The Link actors, in player order; none while booting or between modes (the manager or its slots are null). */
export async function linkActors(gdb: GdbClient): Promise<number[]> {
  const manager = view(await gdb.readMemory(PLAYER_MANAGER_PTR, 4)).getUint32(0);
  if (!isRam(manager)) return [];
  const table = view(await gdb.readMemory(manager + 4, 16));
  const actors = [0, 1, 2, 3].map((i) => table.getUint32(i * 4));
  const end = actors.findIndex((a) => !isRam(a));
  return end < 0 ? actors : actors.slice(0, end);
}

/** One frame's state; `gbaPorts` GBA key records are read too (Shadow Battle), and `extra` [offset, length] ranges of
 *  every Link. */
export async function readSnapshot(gdb: GdbClient, actors: readonly number[], gbaPorts = 0, extra: readonly (readonly [number, number])[] = []): Promise<FrameSnapshot> {
  const retrace = view(await gdb.readMemory(VI_RETRACE_COUNT, 4)).getUint32(0);
  const pad = view(await gdb.readMemory(PAD_STATUS, 4));
  const stick = view(await gdb.readMemory(PAD_STICK, 16));
  const matrix = view(await gdb.readMemory(VIEW_MATRIX, 0x30));
  const links: LinkSnapshot[] = [];
  for (const a of actors) {
    const pos = view(await gdb.readMemory(a + LINK.x, 12));
    const life = view(await gdb.readMemory(a + LINK.life, 4)).getUint32(0);
    const invincible = view(await gdb.readMemory(a + LINK.invincible, 4)).getUint32(0);
    const mid = view(await gdb.readMemory(a + LINK.knockback, LINK.animTick + 2 - LINK.knockback));
    const at = (o: number) => o - LINK.knockback;
    const st = view(await gdb.readMemory(a + LINK.state, 12));
    links.push({
      x: pos.getFloat32(0),
      y: pos.getFloat32(4),
      z: pos.getFloat32(8),
      life,
      invincible,
      frame: mid.getUint16(at(LINK.frame)),
      prevFrame: mid.getUint16(at(LINK.frame) + 2),
      animTick: mid.getUint8(at(LINK.animTick)),
      animFrame: mid.getUint8(at(LINK.animTick) + 1),
      speedX: mid.getFloat32(at(LINK.speedX)),
      speedY: mid.getFloat32(at(LINK.speedY)),
      state: st.getUint32(0),
      nextState: st.getUint32(4),
      prevState: st.getUint32(8),
      facing: mid.getUint32(at(LINK.facing)),
      knock: [mid.getFloat32(at(LINK.knockback)), mid.getFloat32(at(LINK.knockback) + 4), mid.getFloat32(at(LINK.knockback) + 8)],
      ...(extra.length ? { raw: await readExtra(gdb, a, extra) } : {}),
    });
  }
  let zoom: number | undefined;
  const stage = view(await gdb.readMemory(STAGE_PTR, 4)).getUint32(0);
  if (isRam(stage)) {
    const camera = view(await gdb.readMemory(stage + 0x24, 4)).getUint32(0);
    if (isRam(camera)) zoom = view(await gdb.readMemory(camera + CAMERA_ZOOM, 4)).getFloat32(0);
  }
  let gba: number[] | undefined;
  if (gbaPorts) {
    const keys = view(await gdb.readMemory(GBA_KEYS, GBA_KEYS_STRIDE * (gbaPorts - 1) + 4));
    gba = Array.from({ length: gbaPorts }, (_, i) => gbaKeys(keys.getUint16(i * GBA_KEYS_STRIDE), keys.getUint16(i * GBA_KEYS_STRIDE + 2)));
  }
  return {
    retrace,
    pad: { buttons: pad.getUint16(0), x: pad.getInt8(2), y: pad.getInt8(3) },
    stick: { x: stick.getFloat32(0), y: stick.getFloat32(4), angle: stick.getUint16(12) },
    camera: { x: -matrix.getFloat32(0xc), y: -matrix.getFloat32(0x1c), ...(zoom === undefined ? {} : { zoom }) },
    links,
    ...(gba ? { gba } : {}),
  };
}

async function readExtra(gdb: GdbClient, actor: number, extra: readonly (readonly [number, number])[]): Promise<Record<string, string>> {
  const raw: Record<string, string> = {};
  for (const [off, len] of extra) raw[off.toString(16)] = Buffer.from(await gdb.readMemory(actor + off, len)).toString("hex");
  return raw;
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
