// HttpStore against a fake server (a stubbed fetch): the URLs it asks for, what it returns and how it fails.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openServerStore } from "./assets.ts";
import type { DataManifest } from "./protocol.ts";

const ARC = new Uint8Array(100_000).map((_, i) => i * 7);
const MANIFEST: DataManifest = {
  gameId: "G4SE01",
  revision: 0,
  files: [
    { path: "GC4Sword_usa/data.arc", size: ARC.length, hash: "0123456789abcdef" },
    { path: "sys/main.dol", size: 3, hash: "fedcba9876543210" },
  ],
};

let requests: { url: string; cache?: RequestCache }[] = [];
let routes: Record<string, () => Response> = {};

beforeEach(() => {
  requests = [];
  routes = {
    "https://example.org/fso/data/manifest.json": () => Response.json(MANIFEST),
    // Streamed in chunks, as a network response is.
    "https://example.org/fso/data/GC4Sword_usa/data.arc?v=0123456789abcdef": () =>
      new Response(new ReadableStream({ start: (c) => (c.enqueue(ARC.subarray(0, 40_000)), c.enqueue(ARC.subarray(40_000)), c.close()) })),
    "https://example.org/fso/data/sys/main.dol?v=fedcba9876543210": () => new Response(new Uint8Array([1, 2])), // truncated
  };
  vi.stubGlobal("location", { href: "https://example.org/fso/battle/" });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    requests.push({ url, cache: init?.cache });
    return routes[url]?.() ?? new Response("not here", { status: 404, headers: { "Content-Type": "text/plain" } });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("HttpStore", () => {
  it("revalidates the manifest, then reads each file under its hash", async () => {
    const store = await openServerStore("/fso/");
    expect(requests).toEqual([{ url: "https://example.org/fso/data/manifest.json", cache: "no-cache" }]);
    expect(store.manifest).toEqual({ gameId: "G4SE01", revision: 0, files: ["GC4Sword_usa/data.arc", "sys/main.dol"], bytes: ARC.length + 3 });
    const progress: [number, number][] = [];
    store.onProgress = (loaded, total) => progress.push([loaded, total]);
    expect(await store.read("GC4Sword_usa/data.arc")).toEqual(ARC);
    expect(requests[1]).toEqual({ url: "https://example.org/fso/data/GC4Sword_usa/data.arc?v=0123456789abcdef", cache: undefined });
    expect(progress).toEqual([[0, ARC.length], [40_000, ARC.length], [ARC.length, ARC.length]]);
  });

  it("fails on files it doesn't know or that come back short", async () => {
    const store = await openServerStore("/fso/");
    await expect(store.read("GC4Sword_usa/nope.arc")).rejects.toThrow("missing GC4Sword_usa/nope.arc");
    await expect(store.read("sys/main.dol")).rejects.toThrow("got 2 bytes, expected 3");
  });

  it("says why when the server has no game files", async () => {
    delete routes["https://example.org/fso/data/manifest.json"];
    await expect(openServerStore("/fso/")).rejects.toThrow("aren't on this server (https://example.org/fso/data/manifest.json: HTTP 404). not here");
    routes["https://example.org/fso/data/manifest.json"] = () => new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } });
    await expect(openServerStore("/fso/")).rejects.toThrow("isn't a manifest");
    routes["https://example.org/fso/data/manifest.json"] = () => Response.json({ ...MANIFEST, gameId: "G4SP01" });
    await expect(openServerStore("/fso/")).rejects.toThrow("G4SP01 rev 0");
  });
});
