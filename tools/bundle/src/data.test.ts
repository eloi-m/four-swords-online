// The bundle's file selection, manifest and dev server on a made-up extracted disc (no game data needed).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { DataManifest } from "@fso/web/protocol";
import { hashBytes, listFiles, scanExtracted } from "./data.ts";
import { gameData } from "./vite.ts";

const temp = mkdtempSync(join(tmpdir(), "fso-bundle-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

// "ABCDEFGH" as Yaz0: header, then one group of 8 literal bytes.
const YAZ0 = new Uint8Array([...new TextEncoder().encode("Yaz0"), 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, ...new TextEncoder().encode("ABCDEFGH")]);

function fakeDisc(name: string, gameId = "G4SE01", revision = 0): string {
  const root = join(temp, name);
  const put = (path: string, bytes: Uint8Array | string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  };
  put("sys/boot.bin", new Uint8Array([...new TextEncoder().encode(gameId), 0, revision, ...new Uint8Array(32)]));
  put("sys/main.dol", "dol");
  put("sys/fst.bin", "fst");
  put("files/opening.bnr", "banner");
  put("files/CVS/Entries", "cvs");
  put("files/GC4Sword_usa/CVS/Root", "cvs");
  put("files/GC4Sword_usa/data.arc", YAZ0);
  put("files/GC4Sword_usa/Boss/boss010.arc", "stage");
  put("files/GC4Sword_usa/thpdemo/opening.thp", "video");
  put("files/GC4Sword_usa/thpdemo/Opening.THP", "video");
  return root;
}

describe("bundle", () => {
  const disc = fakeDisc("extracted");

  it("keeps every disc file but the THP videos and CVS folders, plus main.dol", () => {
    expect([...listFiles(disc).keys()]).toEqual(["GC4Sword_usa/Boss/boss010.arc", "GC4Sword_usa/data.arc", "opening.bnr", "sys/main.dol"]);
  });

  it("writes a deterministic manifest of sizes and content hashes", () => {
    const { manifest } = scanExtracted(disc);
    expect(manifest.gameId).toBe("G4SE01");
    expect(manifest.revision).toBe(0);
    expect(manifest.files.find((f) => f.path === "GC4Sword_usa/data.arc")).toEqual({ path: "GC4Sword_usa/data.arc", size: YAZ0.length, hash: hashBytes(YAZ0) });
    expect(manifest.files.find((f) => f.path === "sys/main.dol")?.size).toBe(3);
    expect(scanExtracted(disc)).toEqual(scanExtracted(disc));
    // --decompress: the archive's decompressed bytes.
    expect(scanExtracted(disc, { decompress: true }).manifest.files.find((f) => f.path === "GC4Sword_usa/data.arc")?.size).toBe(8);
  });

  it("rehashes only files that changed", () => {
    const cache = new Map();
    const first = scanExtracted(disc, {}, cache).manifest;
    writeFileSync(join(disc, "files/opening.bnr"), "banner 2");
    utimesSync(join(disc, "files/opening.bnr"), new Date(), new Date(Date.now() + 5000));
    const second = scanExtracted(disc, {}, cache).manifest;
    expect(second.files.find((f) => f.path === "opening.bnr")?.hash).toBe(hashBytes(new TextEncoder().encode("banner 2")));
    expect(second.files.find((f) => f.path === "sys/main.dol")).toBe(first.files.find((f) => f.path === "sys/main.dol"));
  });

  it("refuses another disc", () => {
    expect(() => scanExtracted(fakeDisc("pal", "G4SP01"))).toThrow(/G4SP01 rev 0/);
    expect(() => scanExtracted(fakeDisc("rev1", "G4SE01", 1))).toThrow(/G4SE01 rev 1/);
  });

  it("mirrors the files into the output folder, and a second run changes nothing", () => {
    const out = join(temp, "out");
    const run = (...args: string[]) => execFileSync(process.execPath, [join(import.meta.dirname, "main.ts"), disc, out, ...args], { encoding: "utf8" });
    expect(run()).toMatch(/4 files.*\n4 written, 0 removed/);
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")) as DataManifest;
    expect(manifest).toEqual(scanExtracted(disc).manifest);
    expect(readFileSync(join(out, "GC4Sword_usa/data.arc"))).toEqual(Buffer.from(YAZ0));
    writeFileSync(join(out, "stale.bin"), "old");
    expect(run()).toMatch(/0 written, 1 removed/);
    expect(existsSync(join(out, "stale.bin"))).toBe(false);
    expect(run("--decompress")).toMatch(/1 written, 0 removed/);
    expect(readFileSync(join(out, "GC4Sword_usa/data.arc"), "utf8")).toBe("ABCDEFGH");
  });

  it("refuses to write into the repository outside out/", () => {
    const repo = join(import.meta.dirname, "../../..");
    expect(() => execFileSync(process.execPath, [join(import.meta.dirname, "main.ts"), disc, join(repo, "apps/site/public/data")], { stdio: "pipe" })).toThrow(/refusing/);
  });

  it("serves the files at <base>data/ in dev and preview", async () => {
    process.env.FSO_DATA = disc;
    const plugin = gameData();
    delete process.env.FSO_DATA;
    let handler = (_req: IncomingMessage, _res: ServerResponse, _next: () => void) => {};
    const fake = { config: { base: "/fso/" }, middlewares: { use: (h: typeof handler) => (handler = h) } };
    (plugin.configurePreviewServer as unknown as (server: typeof fake) => void)(fake);
    const server = createServer((req, res) => handler(req, res, () => res.writeHead(418).end()));
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/fso/data/`;
    try {
      const response = await fetch(`${base}manifest.json`);
      expect(response.headers.get("cache-control")).toBe("no-cache");
      const manifest = (await response.json()) as DataManifest;
      expect(manifest).toEqual(scanExtracted(disc).manifest);
      const arc = manifest.files.find((f) => f.path === "GC4Sword_usa/data.arc")!;
      const file = await fetch(`${base}GC4Sword_usa/data.arc?v=${arc.hash}`);
      expect(file.headers.get("cache-control")).toBe("max-age=31536000, immutable");
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(YAZ0);
      expect((await fetch(`${base}GC4Sword_usa/data.arc`, { headers: { "If-None-Match": `"${arc.hash}"` } })).status).toBe(304);
      expect((await fetch(`${base}sys/fst.bin`)).status).toBe(404); // not a wanted file
      expect((await fetch(`${base}GC4Sword_usa%2F..%2F..%2Fsys%2Fboot.bin`)).status).toBe(404); // only manifest paths
      expect((await fetch(`${base}%E0%A4%A`)).status).toBe(400);
      expect((await fetch(`${base.replace("/fso/", "/")}manifest.json`)).status).toBe(418); // not under the base
      // The lobby token: none for an open dev lobby (no 404 in the page's console), LOBBY_TOKEN when set.
      expect((await fetch(`${base}lobby-token`)).status).toBe(204);
      process.env.LOBBY_TOKEN = "dev-token-0123456789";
      try {
        expect(await (await fetch(`${base}lobby-token`)).text()).toBe("dev-token-0123456789");
      } finally {
        delete process.env.LOBBY_TOKEN;
      }
    } finally {
      server.close();
    }
  });
});
