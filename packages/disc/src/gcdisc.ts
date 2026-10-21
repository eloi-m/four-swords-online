// GameCube disc layout: boot.bin header, bi2.bin, apploader, main.dol and the FST file system.
import { RVZ_MAGIC, RvzReader, type Decompressor } from "./rvz.ts";
import { dataView, type ByteSource } from "./source.ts";

const GC_MAGIC = 0xc2339f3d;
const BOOT_SIZE = 0x440;
const BI2_OFFSET = 0x440;
const BI2_SIZE = 0x2000;
const APPLOADER_OFFSET = 0x2440;

export interface DiscHeader {
  gameId: string; // e.g. "G4SE01"
  discNumber: number;
  revision: number;
  title: string;
  dolOffset: number;
  fstOffset: number;
  fstSize: number;
}

export interface DiscFile {
  path: string; // relative to the disc root, "/"-separated
  offset: number;
  size: number;
}

export class GameCubeDisc {
  readonly source: ByteSource;
  readonly header: DiscHeader;
  readonly files: DiscFile[];

  private constructor(source: ByteSource, header: DiscHeader, files: DiscFile[]) {
    this.source = source;
    this.header = header;
    this.files = files;
  }

  static async open(source: ByteSource): Promise<GameCubeDisc> {
    const boot = await source.read(0, BOOT_SIZE);
    const header = parseHeader(boot);
    const fst = await source.read(header.fstOffset, header.fstSize);
    return new GameCubeDisc(source, header, parseFst(fst));
  }

  readFile(file: DiscFile): Promise<Uint8Array> {
    return this.source.read(file.offset, file.size);
  }

  /** The non-FST system files, named like Dolphin's "Extract Entire Disc" sys/ folder. */
  async readSystemFiles(): Promise<Record<string, Uint8Array>> {
    const { source, header } = this;
    const appHeader = dataView(await source.read(APPLOADER_OFFSET, 0x20));
    const apploaderSize = 0x20 + appHeader.getUint32(0x14) + appHeader.getUint32(0x18);
    const dolHeader = await source.read(header.dolOffset, 0x100);
    return {
      "boot.bin": await source.read(0, BOOT_SIZE),
      "bi2.bin": await source.read(BI2_OFFSET, BI2_SIZE),
      "apploader.img": await source.read(APPLOADER_OFFSET, apploaderSize),
      "fst.bin": await source.read(header.fstOffset, header.fstSize),
      "main.dol": await source.read(header.dolOffset, dolSize(dolHeader)),
    };
  }
}

/** Opens an RVZ or plain ISO/GCM image. */
export async function openDisc(
  source: ByteSource,
  decompressors: Partial<Record<number, Decompressor>> = {},
): Promise<GameCubeDisc> {
  const magic = dataView(await source.read(0, 4)).getUint32(0);
  const iso = magic === RVZ_MAGIC ? await RvzReader.open(source, decompressors) : source;
  return GameCubeDisc.open(iso);
}

function parseHeader(boot: Uint8Array): DiscHeader {
  const view = dataView(boot);
  if (view.getUint32(0x1c) !== GC_MAGIC) throw new Error("not a GameCube disc");
  return {
    gameId: ascii(boot, 0, 6),
    discNumber: boot[6]!,
    revision: boot[7]!,
    title: ascii(boot, 0x20, 0x3e0),
    dolOffset: view.getUint32(0x420),
    fstOffset: view.getUint32(0x424),
    fstSize: view.getUint32(0x428),
  };
}

function parseFst(fst: Uint8Array): DiscFile[] {
  const view = dataView(fst);
  const count = view.getUint32(8);
  const stringsStart = count * 12;
  const files: DiscFile[] = [];

  const walk = (start: number, end: number, prefix: string) => {
    let i = start;
    while (i < end) {
      const word = view.getUint32(i * 12);
      const name = ascii(fst, stringsStart + (word & 0xffffff), 0x100);
      const a = view.getUint32(i * 12 + 4);
      const b = view.getUint32(i * 12 + 8);
      if (word >>> 24 === 1) {
        walk(i + 1, b, `${prefix}${name}/`);
        i = b;
      } else {
        files.push({ path: `${prefix}${name}`, offset: a, size: b });
        i++;
      }
    }
  };
  walk(1, count, "");
  return files;
}

function dolSize(header: Uint8Array): number {
  const view = dataView(header);
  let size = 0x100;
  for (let i = 0; i < 18; i++) {
    const offset = view.getUint32(i * 4);
    const length = view.getUint32(0x90 + i * 4);
    if (length !== 0) size = Math.max(size, offset + length);
  }
  return size;
}

function ascii(bytes: Uint8Array, offset: number, maxLength: number): string {
  let s = "";
  for (let i = offset; i < offset + maxLength && i < bytes.length && bytes[i] !== 0; i++) {
    s += String.fromCharCode(bytes[i]!);
  }
  return s;
}
