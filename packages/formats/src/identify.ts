// Best-effort file type identification by magic bytes, falling back to the file extension.
import { ascii, magic } from "./bytes.ts";

const MAGIC_TYPES: Record<string, string> = {
  Yaz0: "yaz0",
  Yay0: "yay0",
  RARC: "rarc",
  BNR1: "bnr",
  BNR2: "bnr",
  "THP\0": "thp",
  IBNK: "jaudio-ibnk",
  WSYS: "jaudio-wsys",
  BARC: "jaudio-barc",
  "AA_<": "jaudio-baa",
};

export function identify(bytes: Uint8Array, path: string): string {
  const m4 = ascii(bytes, 0, 4).padEnd(4, "\0");
  if (bytes.length >= 4 && MAGIC_TYPES[m4]) return MAGIC_TYPES[m4];
  const m8 = magic(bytes, 8);
  if (m8.startsWith("J3D")) return `j3d-${m8.slice(4)}`; // e.g. J3D2bmd3 -> j3d-bmd3
  if (m8 === "MESGbmg1") return "bmg";
  if (m8.startsWith("SCRNblo")) return "j2d-blo";
  if (m8 === "FONTbfn1") return "bfn";
  if (m8.startsWith("JPAC")) return "jpa";
  const ext = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : "";
  return ext ? `ext:${ext}` : "unknown";
}
