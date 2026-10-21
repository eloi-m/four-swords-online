// BST sound table and BSTN name table (JAudio2). A sound ID is section << 24 | group << 16 | index.
// BST: "BST ", u32 0, u32 0x01000000, u32 root offset; root: u32 n, u32[n] sections; section: u32 n, u32[n] groups;
//   group: u32 n, u32 0, u32[n] items as (type << 24 | item offset). Offsets are relative to the table start.
//   Type 0x11 (sequence) items are 12 bytes: u8 priority, 3 × u8, u32 0, u8 player slot, u24 sequence resource
//   id (the file id inside Seqs/JaiSeqs.arc). Types 0x10/0x12 are sound effects (layout not decoded).
// BSTN: same tree with a name offset after each count: section: u32 n, u32 name, u32[n]; group: u32 n, u32 name,
//   u32[n] item names.
import { ascii, dataView } from "@fso/formats";

export interface SoundEntry {
  id: number;
  section: number;
  group: number;
  index: number;
  type: number;
  name: string;
  groupName: string;
  sectionName: string;
  /** Raw item bytes (up to the next item). */
  item: Uint8Array;
  /** Type 0x11 (sequence): resource id of the .bms in JaiSeqs.arc. */
  sequence?: number;
  /** Type 0x11: the high byte next to the resource id (1 for BGM, 2 for short jingles). */
  slot?: number;
}

export function soundId(section: number, group: number, index: number): number {
  return ((section << 24) | (group << 16) | index) >>> 0;
}

export function parseSoundTable(bst: Uint8Array, bstn?: Uint8Array): SoundEntry[] {
  if (ascii(bst, 0, 4) !== "BST ") throw new Error("not a BST sound table");
  if (bstn && ascii(bstn, 0, 4) !== "BSTN") throw new Error("not a BSTN name table");
  const v = dataView(bst);
  const n = bstn ? dataView(bstn) : null;
  const name = (o: number | undefined) => (bstn && o ? ascii(bstn, o) : "");
  const root = v.getUint32(12);
  const nroot = n ? n.getUint32(12) : 0;
  const items: { entry: SoundEntry; offset: number }[] = [];
  for (let s = 0; s < v.getUint32(root); s++) {
    const sec = v.getUint32(root + 4 + s * 4);
    const nsec = n ? n.getUint32(nroot + 4 + s * 4) : 0;
    const sectionName = name(n?.getUint32(nsec + 4));
    for (let g = 0; g < v.getUint32(sec); g++) {
      const grp = v.getUint32(sec + 4 + g * 4);
      const ngrp = n ? n.getUint32(nsec + 8 + g * 4) : 0;
      const groupName = name(n?.getUint32(ngrp + 4));
      for (let i = 0; i < v.getUint32(grp); i++) {
        const word = v.getUint32(grp + 8 + i * 4);
        const entry: SoundEntry = {
          id: soundId(s, g, i),
          section: s,
          group: g,
          index: i,
          type: word >>> 24,
          name: name(n?.getUint32(ngrp + 8 + i * 4)),
          groupName,
          sectionName,
          item: new Uint8Array(0),
        };
        items.push({ entry, offset: word & 0xffffff });
      }
    }
  }
  const starts = [...new Set(items.map((x) => x.offset))].sort((a, b) => a - b);
  for (const { entry, offset } of items) {
    const next = starts.find((x) => x > offset) ?? Math.min(offset + 16, bst.length);
    entry.item = bst.subarray(offset, Math.min(next, offset + 16));
    if (entry.type === 0x11 && entry.item.length >= 12) {
      const word = dataView(entry.item).getUint32(8);
      entry.slot = word >>> 24;
      entry.sequence = word & 0xffffff;
    }
  }
  return items.map((x) => x.entry);
}
