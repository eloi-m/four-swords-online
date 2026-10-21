// RARC ("JKRArchive") archives: a directory tree of nodes and file entries plus a string table.
// All offsets in the info block are relative to 0x20; file data offsets are relative to the data section.
import { ascii, dataView } from "./bytes.ts";

export interface RarcFile {
  path: string; // relative to the archive root, "/"-separated
  id: number;
  attributes: number;
  data: Uint8Array;
}

export interface RarcArchive {
  rootName: string;
  dirs: string[];
  files: RarcFile[];
}

const ENTRY_DIRECTORY = 0x02;

export function isRarc(bytes: Uint8Array): boolean {
  return bytes.length >= 0x40 && ascii(bytes, 0, 4) === "RARC";
}

export function parseRarc(bytes: Uint8Array): RarcArchive {
  if (!isRarc(bytes)) throw new Error("not a RARC archive");
  const view = dataView(bytes);
  const dataStart = 0x20 + view.getUint32(0x0c);
  const nodeCount = view.getUint32(0x20);
  const nodeTable = 0x20 + view.getUint32(0x24);
  const entryTable = 0x20 + view.getUint32(0x2c);
  const strings = 0x20 + view.getUint32(0x34);
  const name = (offset: number) => ascii(bytes, strings + offset);

  const dirs: string[] = [];
  const files: RarcFile[] = [];
  const visited = new Set<number>();

  const walkNode = (index: number, prefix: string) => {
    if (index >= nodeCount || visited.has(index)) throw new Error(`bad RARC node index ${index}`);
    visited.add(index);
    const node = nodeTable + index * 0x10;
    const entryCount = view.getUint16(node + 0x0a);
    const firstEntry = view.getUint32(node + 0x0c);
    for (let i = 0; i < entryCount; i++) {
      const entry = entryTable + (firstEntry + i) * 0x14;
      const entryName = name(view.getUint16(entry + 0x06));
      if (entryName === "." || entryName === "..") continue;
      const attributes = view.getUint8(entry + 0x04);
      const offset = view.getUint32(entry + 0x08);
      const size = view.getUint32(entry + 0x0c);
      const path = prefix + entryName;
      if (attributes & ENTRY_DIRECTORY) {
        dirs.push(path);
        walkNode(offset, `${path}/`);
      } else {
        const start = dataStart + offset;
        files.push({
          path,
          id: view.getUint16(entry),
          attributes,
          data: bytes.subarray(start, start + size),
        });
      }
    }
  };

  const rootName = name(view.getUint32(nodeTable + 0x04));
  walkNode(0, "");
  return { rootName, dirs, files };
}
