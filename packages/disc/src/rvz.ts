// Reader for Dolphin's RVZ disc image format, exposing the disc as a virtual ISO.
// Format reference: Dolphin's docs/WiaAndRvz.md. Only GameCube (non-partitioned) discs are supported.
import { dataView, type ByteSource } from "./source.ts";

export type Decompressor = (input: Uint8Array) => Uint8Array;

export const Compression = { None: 0, Purge: 1, Bzip2: 2, Lzma: 3, Lzma2: 4, Zstd: 5 } as const;

export const RVZ_MAGIC = 0x52565a01; // "RVZ\x01"

const HEADER_1_SIZE = 0x48;
const DISC_HEADER_SIZE = 0x80; // stored verbatim in header 2, not in the raw data groups
const RAW_DATA_ALIGNMENT = 0x8000; // raw data entries start on this boundary once rounded down
const JUNK_SEED_SIZE = 17 * 4;
const GROUP_CACHE_SIZE = 8;

interface RawDataEntry {
  discOffset: number;
  size: number;
  firstGroup: number;
  groupCount: number;
}

interface GroupEntry {
  fileOffset: number;
  storedSize: number;
  compressed: boolean;
  packedSize: number;
}

export class RvzReader implements ByteSource {
  readonly size: number;
  readonly discType: number; // 1 = GameCube, 2 = Wii
  readonly discHeader: Uint8Array;

  private readonly source: ByteSource;
  private readonly decompress: Decompressor | null;
  private readonly chunkSize: number;
  private readonly rawData: RawDataEntry[];
  private readonly groups: GroupEntry[];
  private readonly cache = new Map<number, Uint8Array>();

  private constructor(fields: {
    source: ByteSource;
    decompress: Decompressor | null;
    chunkSize: number;
    rawData: RawDataEntry[];
    groups: GroupEntry[];
    size: number;
    discType: number;
    discHeader: Uint8Array;
  }) {
    this.source = fields.source;
    this.decompress = fields.decompress;
    this.chunkSize = fields.chunkSize;
    this.rawData = fields.rawData;
    this.groups = fields.groups;
    this.size = fields.size;
    this.discType = fields.discType;
    this.discHeader = fields.discHeader;
  }

  static async open(source: ByteSource, decompressors: Partial<Record<number, Decompressor>>): Promise<RvzReader> {
    const h1 = dataView(await source.read(0, HEADER_1_SIZE));
    if (h1.getUint32(0) !== RVZ_MAGIC) throw new Error("not an RVZ file");
    const header2Size = h1.getUint32(0x0c);
    const isoSize = Number(h1.getBigUint64(0x24));

    const h2Bytes = await source.read(HEADER_1_SIZE, header2Size);
    const h2 = dataView(h2Bytes);
    const discType = h2.getUint32(0x00);
    const compression = h2.getUint32(0x04);
    const chunkSize = h2.getUint32(0x0c);
    const discHeader = h2Bytes.slice(0x10, 0x10 + DISC_HEADER_SIZE);

    let decompress: Decompressor | null = null;
    if (compression !== Compression.None) {
      decompress = decompressors[compression] ?? null;
      if (!decompress) throw new Error(`RVZ compression method ${compression} is not supported`);
    }

    let o = 0x90;
    const partitionCount = h2.getUint32(o);
    if (partitionCount !== 0) throw new Error("Wii partitions are not supported");
    o += 4 + 4 + 8 + 20;

    const rawCount = h2.getUint32(o);
    const rawOffset = Number(h2.getBigUint64(o + 4));
    const rawSize = h2.getUint32(o + 12);
    o += 16;
    const groupCount = h2.getUint32(o);
    const groupOffset = Number(h2.getBigUint64(o + 4));
    const groupSize = h2.getUint32(o + 12);

    const readTable = async (offset: number, size: number) => {
      const stored = await source.read(offset, size);
      return dataView(decompress ? decompress(stored) : stored);
    };

    const rawTable = await readTable(rawOffset, rawSize);
    const rawData: RawDataEntry[] = [];
    for (let i = 0; i < rawCount; i++) {
      const e = i * 24;
      const offset = Number(rawTable.getBigUint64(e));
      const size = Number(rawTable.getBigUint64(e + 8));
      const skipped = offset % RAW_DATA_ALIGNMENT;
      rawData.push({
        discOffset: offset - skipped,
        size: size + skipped,
        firstGroup: rawTable.getUint32(e + 16),
        groupCount: rawTable.getUint32(e + 20),
      });
    }

    const groupTable = await readTable(groupOffset, groupSize);
    const groups: GroupEntry[] = [];
    for (let i = 0; i < groupCount; i++) {
      const e = i * 12;
      const dataSize = groupTable.getUint32(e + 4);
      groups.push({
        fileOffset: groupTable.getUint32(e) * 4,
        storedSize: dataSize & 0x7fffffff,
        compressed: (dataSize & 0x80000000) !== 0,
        packedSize: groupTable.getUint32(e + 8),
      });
    }

    return new RvzReader({ source, decompress, chunkSize, rawData, groups, size: isoSize, discType, discHeader });
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    const out = new Uint8Array(length);
    let pos = offset;
    const end = offset + length;
    while (pos < end) {
      if (pos < DISC_HEADER_SIZE) {
        const n = Math.min(DISC_HEADER_SIZE, end) - pos;
        out.set(this.discHeader.subarray(pos, pos + n), pos - offset);
        pos += n;
        continue;
      }
      const entry = this.rawData.find((e) => pos >= e.discOffset && pos < e.discOffset + e.size);
      if (!entry) {
        // Not covered by any raw data entry: zeros up to the next entry.
        const next = Math.min(end, ...this.rawData.map((e) => e.discOffset).filter((s) => s > pos));
        pos = next;
        continue;
      }
      const groupInEntry = Math.floor((pos - entry.discOffset) / this.chunkSize);
      const groupStart = entry.discOffset + groupInEntry * this.chunkSize;
      const groupLength = Math.min(this.chunkSize, entry.discOffset + entry.size - groupStart);
      const data = await this.loadGroup(entry.firstGroup + groupInEntry, groupLength);
      const n = Math.min(groupStart + groupLength, end) - pos;
      out.set(data.subarray(pos - groupStart, pos - groupStart + n), pos - offset);
      pos += n;
    }
    return out;
  }

  private async loadGroup(index: number, length: number): Promise<Uint8Array> {
    const cached = this.cache.get(index);
    if (cached) {
      this.cache.delete(index);
      this.cache.set(index, cached);
      return cached;
    }

    const group = this.groups[index];
    if (!group) throw new Error(`RVZ group ${index} out of range`);
    let data: Uint8Array;
    if (group.storedSize === 0) {
      data = new Uint8Array(length);
    } else {
      data = await this.source.read(group.fileOffset, group.storedSize);
      if (group.compressed) {
        if (!this.decompress) throw new Error("compressed group in an uncompressed RVZ");
        data = this.decompress(data);
      }
      data = group.packedSize !== 0 ? unpack(data, length) : padTo(data, length);
    }

    this.cache.set(index, data);
    if (this.cache.size > GROUP_CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    return data;
  }
}

// RVZ packing: a sequence of [u32 size][payload]. When the size's top bit is set the payload is a
// junk-data PRNG seed instead of literal bytes. Junk only ever fills padding between files, so it is
// left zeroed here rather than regenerated; this reader is for file access, not 1:1 ISO rebuilding.
function unpack(packed: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  const view = dataView(packed);
  let i = 0;
  let o = 0;
  while (o < length && i < packed.length) {
    const word = view.getUint32(i);
    i += 4;
    const size = word & 0x7fffffff;
    if (word & 0x80000000) {
      i += JUNK_SEED_SIZE;
    } else {
      out.set(packed.subarray(i, i + Math.min(size, length - o)), o);
      i += size;
    }
    o += size;
  }
  return out;
}

function padTo(data: Uint8Array, length: number): Uint8Array {
  if (data.length >= length) return data;
  const out = new Uint8Array(length);
  out.set(data);
  return out;
}
