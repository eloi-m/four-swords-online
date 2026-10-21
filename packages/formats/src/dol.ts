// GameCube DOL executables: 7 text + 11 data sections, each with a file offset, load address and size.
import { dataView } from "./bytes.ts";

export interface DolSection {
  kind: "text" | "data";
  offset: number;
  address: number;
  size: number;
}

export class Dol {
  readonly bytes: Uint8Array;
  readonly sections: DolSection[];

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    const v = dataView(bytes);
    this.sections = [];
    for (let i = 0; i < 18; i++) {
      const size = v.getUint32(0x90 + i * 4);
      if (size) this.sections.push({ kind: i < 7 ? "text" : "data", offset: v.getUint32(i * 4), address: v.getUint32(0x48 + i * 4), size });
    }
  }

  /** Bytes at a load address, as they are in RAM right after loading (static data only). */
  read(address: number, length: number): Uint8Array {
    const s = this.sections.find((x) => address >= x.address && address + length <= x.address + x.size);
    if (!s) throw new Error(`0x${address.toString(16)} is not in a DOL section`);
    return this.bytes.subarray(s.offset + address - s.address, s.offset + address - s.address + length);
  }
}
