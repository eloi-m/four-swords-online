// Dolphin input movie (.dtm) writer, per Dolphin's Source/Core/Core/Movie.h: a 256-byte little-endian DTMHeader, then
// one 8-byte ControllerState per controller poll (not per frame: the game's SI polling rate decides how many polls a
// frame takes). Movies that start from a savestate need bFromSaveState = 1 and the state saved as `<movie>.sav`.
// We write bSaveConfig = 0 (use the current settings) and a zero MD5 (Dolphin then skips the disc checksum).
// With several controllers, every SI poll reads each plugged port in order (SerialInterface::UpdateDevices), so the
// states interleave: poll 0 port 1, poll 0 port 2, …, poll 1 port 1… Dolphin's integrated GBAs (mGBA, SI device 13)
// are movie controllers too: a GBA port's state is a GameCube ControllerState whose A, B, Z (Select), Start, D-pad, L
// and R bits are the GBA's keys (SI_DeviceGBAEmu.cpp), and X resets that GBA. The header's GBAControllers byte marks
// those ports, and playing the movie plugs integrated GBAs into them (Movie::ChangePads).

export interface PadInput {
  start?: boolean;
  a?: boolean;
  b?: boolean;
  x?: boolean;
  y?: boolean;
  z?: boolean;
  l?: boolean;
  r?: boolean;
  up?: boolean; // D-pad
  down?: boolean;
  left?: boolean;
  right?: boolean;
  /** Main stick, 0–255, center 128 (Y grows upwards). */
  stickX?: number;
  stickY?: number;
  cStickX?: number;
  cStickY?: number;
  triggerL?: number;
  triggerR?: number;
}

export const HEADER_SIZE = 256;
export const STATE_SIZE = 8;

/** What sits in each of the four controller ports. */
export type PortDevice = "gc" | "gba" | "none";

export interface DtmOptions {
  gameId: string;
  fromSaveState: boolean;
  /** Bit i = a controller in port i + 1 (a GameCube pad, or an integrated GBA when its `gbas` bit is set too). */
  controllers?: number;
  /** Bit i = port i + 1 holds an integrated GBA. */
  gbas?: number;
  /** The header's frame count. Playback of a movie from boot stops when the VI frame count reaches it; from a
   *  savestate only the input runs out. Default: the number of states (always enough). */
  frames?: number;
  author?: string;
}

/** Header bits for a port layout, e.g. ["gba", "gba"] → controllers 0b11, gbas 0b11. */
export function portBits(ports: readonly PortDevice[]): { controllers: number; gbas: number } {
  let controllers = 0, gbas = 0;
  ports.forEach((p, i) => {
    if (p !== "none") controllers |= 1 << i;
    if (p === "gba") gbas |= 1 << i;
  });
  return { controllers, gbas };
}

/** Builds a movie from the ControllerStates in poll order (one per poll for a single controller; with several, each
 *  poll's states in port order). */
export function writeDtm(states: readonly PadInput[], o: DtmOptions): Uint8Array {
  const out = new Uint8Array(HEADER_SIZE + states.length * STATE_SIZE);
  const view = new DataView(out.buffer);
  out.set([0x44, 0x54, 0x4d, 0x1a], 0); // "DTM\x1A"
  ascii(out, 0x04, o.gameId, 6);
  out[0x0b] = o.controllers ?? 1;
  out[0x0c] = o.fromSaveState ? 1 : 0;
  view.setBigUint64(0x0d, BigInt(o.frames ?? states.length), true); // frameCount
  view.setBigUint64(0x15, BigInt(states.length), true); // inputCount
  ascii(out, 0x31, o.author ?? "four-swords-online", 32);
  // 0x89 bSaveConfig = 0; the settings after it, the md5 at 0x71, revision and tickCount stay zero.
  out[0xa1] = o.gbas ?? 0; // GBAControllers
  states.forEach((p, i) => out.set(encodePad(p), HEADER_SIZE + i * STATE_SIZE));
  return out;
}

/** One ControllerState: two bytes of bitfields (LSB first), then triggers and sticks. */
export function encodePad(p: PadInput): Uint8Array {
  const bits = [p.start, p.a, p.b, p.x, p.y, p.z, p.up, p.down, p.left, p.right, p.l, p.r, false, false, true, false];
  let word = 0;
  bits.forEach((b, i) => (word |= b ? 1 << i : 0)); // bit 14 = is_connected
  return Uint8Array.from([
    word & 0xff,
    word >> 8,
    p.triggerL ?? 0,
    p.triggerR ?? 0,
    p.stickX ?? 128,
    p.stickY ?? 128,
    p.cStickX ?? 128,
    p.cStickY ?? 128,
  ]);
}

export function readDtmPolls(file: Uint8Array): Uint8Array[] {
  const polls: Uint8Array[] = [];
  for (let o = HEADER_SIZE; o + STATE_SIZE <= file.length; o += STATE_SIZE) polls.push(file.subarray(o, o + STATE_SIZE));
  return polls;
}

function ascii(out: Uint8Array, offset: number, s: string, max: number): void {
  for (let i = 0; i < Math.min(s.length, max); i++) out[offset + i] = s.charCodeAt(i) & 0x7f;
}
