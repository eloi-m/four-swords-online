import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openDisc } from "./gcdisc.ts";
import { openDiscFile } from "./node.ts";
import { bytesSource } from "./source.ts";

function fakeIso(): Uint8Array {
  const iso = new Uint8Array(0x3000);
  const view = new DataView(iso.buffer);
  iso.set(new TextEncoder().encode("TEST01"), 0);
  view.setUint32(0x1c, 0xc2339f3d);
  const fst = 0x2800;
  view.setUint32(0x424, fst);
  view.setUint32(0x428, 3 * 12 + 8);
  // root dir (3 entries), dir "d" (next = 3), file "d/f.txt" at 0x2900, 5 bytes
  view.setUint32(fst + 0, 0x01000000); view.setUint32(fst + 8, 3);
  view.setUint32(fst + 12, 0x01000000); view.setUint32(fst + 20, 3);
  view.setUint32(fst + 24, 0x00000002); view.setUint32(fst + 28, 0x2900); view.setUint32(fst + 32, 5);
  iso.set(new TextEncoder().encode("d\0f.txt\0"), fst + 36);
  iso.set(new TextEncoder().encode("hello"), 0x2900);
  return iso;
}

describe("GameCube disc", () => {
  it("parses the header and FST of a plain ISO", async () => {
    const disc = await openDisc(bytesSource(fakeIso()));
    expect(disc.header.gameId).toBe("TEST01");
    expect(disc.files).toEqual([{ path: "d/f.txt", offset: 0x2900, size: 5 }]);
    expect(new TextDecoder().decode(await disc.readFile(disc.files[0]!))).toBe("hello");
  });

  const rvz = new URL("../../../disc/Legend of Zelda, The - Four Swords Adventures (USA).rvz", import.meta.url);
  it.skipIf(!existsSync(rvz))("reads the real G4SE01 RVZ byte-exactly (main.dol hash)", async () => {
    const disc = await openDiscFile(fileURLToPath(rvz));
    try {
      expect(disc.header.gameId).toBe("G4SE01");
      expect(disc.header.revision).toBe(0);
      const { "main.dol": dol } = await disc.readSystemFiles();
      expect(createHash("sha1").update(dol!).digest("hex")).toBe("d86b3d9f785566e34264035e140ef3daf3cc19f0");
    } finally {
      await disc.close();
    }
  });
});
