import { describe, expect, it } from "vitest";
import { animationFrame, LoopMode, parseBrk, parseBtk, sampleTexSrt, sampleTrack, texMatrixBasic } from "./anim.ts";
import { readJ3dChunks, readNameTable } from "./bmd.ts";

/** Big-endian byte writer for synthetic J3D files. */
class Writer {
  bytes: number[] = [];
  u8(v: number) {
    this.bytes.push(v & 0xff);
    return this;
  }
  u16(v: number) {
    return this.u8(v >> 8).u8(v);
  }
  u32(v: number) {
    return this.u16(v >>> 16).u16(v);
  }
  s16(v: number) {
    return this.u16(v & 0xffff);
  }
  f32(v: number) {
    const b = new DataView(new ArrayBuffer(4));
    b.setFloat32(0, v);
    return this.u32(b.getUint32(0));
  }
  ascii(s: string) {
    for (const c of s) this.u8(c.charCodeAt(0));
    return this;
  }
  pad(to: number) {
    while (this.bytes.length < to) this.u8(0);
    return this;
  }
  at(offset: number, write: (w: Writer) => void) {
    const w = new Writer();
    write(w);
    this.pad(offset + w.bytes.length);
    this.bytes.splice(offset, w.bytes.length, ...w.bytes);
    return this;
  }
}

/** A name table with one name at `offset` in `w`. */
function nameTable(w: Writer, offset: number, name: string) {
  w.at(offset, (t) => t.u16(1).u16(0xffff).u16(0).u16(8).ascii(name).u8(0));
}

/** J3D file header + one chunk. */
function j3dFile(magic: string, chunkId: string, chunk: Writer): Uint8Array {
  const w = new Writer().ascii(magic).u32(0x20 + chunk.bytes.length).u32(1).pad(0x20);
  chunk.at(0, (c) => c.ascii(chunkId).u32(chunk.bytes.length));
  return Uint8Array.from([...w.bytes, ...chunk.bytes]);
}

describe("J3D containers", () => {
  it("splits chunks and reads name tables", () => {
    const chunk = new Writer().pad(0x40);
    nameTable(chunk, 0x10, "filter");
    const file = j3dFile("J3D1btk1", "TTK1", chunk);
    const { magic, chunks } = readJ3dChunks(file);
    expect(magic).toBe("J3D1btk1");
    expect(chunks.map((c) => [c.id, c.offset, c.size])).toEqual([["TTK1", 0x20, 0x40]]);
    expect(readNameTable(chunks[0]!.data, 0x10)).toEqual(["filter"]);
  });
});

describe("J3D animation sampling", () => {
  it("interpolates keyframes as a Hermite spline (linear when tangents match the slope)", () => {
    const track = [
      { time: 0, value: 0, tangentIn: 0.5, tangentOut: 0.5 },
      { time: 10, value: 5, tangentIn: 0.5, tangentOut: 0.5 },
    ];
    expect(sampleTrack(track, 4)).toBeCloseTo(2);
    expect(sampleTrack(track, -1)).toBe(0);
    expect(sampleTrack(track, 20)).toBe(5);
    // Flat tangents ease in and out.
    const eased = track.map((k) => ({ ...k, tangentIn: 0, tangentOut: 0 }));
    expect(sampleTrack(eased, 5)).toBeCloseTo(2.5);
    expect(sampleTrack(eased, 1)).toBeLessThan(0.5);
  });

  it("maps ticks to frames per loop mode", () => {
    expect(animationFrame({ loopMode: LoopMode.REPEAT, duration: 100 }, 250)).toBe(50);
    expect(animationFrame({ loopMode: LoopMode.ONCE, duration: 100 }, 250)).toBeCloseTo(99.999);
    expect(animationFrame({ loopMode: LoopMode.ONCE_AND_RESET, duration: 100 }, 250)).toBe(0);
    expect(animationFrame({ loopMode: LoopMode.MIRRORED_REPEAT, duration: 11 }, 15)).toBe(5);
  });

  it("builds basic texture SRT matrices around the texture center", () => {
    const m = texMatrixBasic(2, 3, 0, 0.25, 0, 0.5, 0.5);
    // s' = 2s + 0.25 + 0.5 - 1 ; t' = 3t + 0.5 - 1.5
    expect([m[0], m[5], m[12], m[13]]).toEqual([2, 3, -0.25, -1]);
  });
});

describe("synthetic BTK / BRK", () => {
  it("parses a TTK1 entry and samples its translation", () => {
    const c = new Writer();
    // Header: loop 2, rotation decimal 0, duration 100, 3 entries (1 material), table sizes 1 scale / 1 rotation / 6
    // translation values.
    c.at(0x08, (w) => w.u8(LoopMode.REPEAT).u8(0).u16(100).u16(3).u16(1).u16(1).u16(6));
    c.at(0x14, (w) => w.u32(0x60).u32(0x98).u32(0x9c).u32(0xb0).u32(0xb4).u32(0xc0).u32(0xc4).u32(0xc8));
    c.at(0x5c, (w) => w.u32(0));
    // 9 tracks: S (scale, rot, trans), T, Q. Scale → index 0 (1 key); rotation → 0; S translation keys 0..1 (count 2).
    const tracks = [
      [1, 0, 0],
      [1, 0, 0],
      [2, 0, 0], // S translation: 2 keys starting at t[0]
      [1, 0, 0],
      [1, 0, 0],
      [1, 0, 0],
      [1, 0, 0],
      [1, 0, 0],
      [1, 0, 0],
    ];
    c.at(0x60, (w) => tracks.forEach(([n, i, t]) => w.u16(n!).u16(i!).u16(t!)));
    c.at(0x98, (w) => w.u16(0)); // remap
    nameTable(c, 0x9c, "mat");
    c.at(0xb0, (w) => w.u8(0)); // texture matrix index
    c.at(0xb4, (w) => w.f32(0.5).f32(0.5).f32(0.5)); // center
    c.at(0xc0, (w) => w.f32(1)); // scale table
    c.at(0xc4, (w) => w.s16(0)); // rotation table
    // Translation table: keys (time, value, tangent): (0, 0, 0.01) and (100, 1, 0.01).
    c.at(0xc8, (w) => w.f32(0).f32(0).f32(0.01).f32(100).f32(1).f32(0.01));
    const btk = parseBtk(j3dFile("J3D1btk1", "TTK1", c));
    expect(btk.duration).toBe(100);
    expect(btk.entries).toHaveLength(1);
    const e = btk.entries[0]!;
    expect(e.material).toBe("mat");
    expect(sampleTrack(e.translationS, 50)).toBeCloseTo(0.5);
    expect(sampleTexSrt(btk, e, 50)[12]).toBeCloseTo(0.5);
  });

  it("parses TRK1 register animations", () => {
    const c = new Writer();
    // One register entry; R, G, B tables hold 1 value, A holds two (time, value, tangent) keys.
    c.at(0x08, (w) => w.u8(LoopMode.ONCE).u8(0).u16(99).u16(1).u16(0).u16(1).u16(1).u16(1).u16(6).u16(0).u16(0).u16(0).u16(0));
    c.at(0x20, (w) => w.u32(0x60).u32(0x7c).u32(0x80).u32(0x84).u32(0x88).u32(0x98));
    c.at(0x38, (w) => w.u32(0xa0).u32(0xa4).u32(0xa8).u32(0xac).u32(0).u32(0).u32(0).u32(0));
    c.at(0x60, (w) => w.u16(1).u16(0).u16(0).u16(1).u16(0).u16(0).u16(1).u16(0).u16(0).u16(2).u16(0).u16(0).u8(2));
    nameTable(c, 0x88, "filter");
    nameTable(c, 0x98, "");
    c.at(0xa0, (w) => w.s16(255));
    c.at(0xa4, (w) => w.s16(255));
    c.at(0xa8, (w) => w.s16(255));
    c.at(0xac, (w) => w.s16(0).s16(0).s16(0).s16(100).s16(64).s16(0));
    const brk = parseBrk(j3dFile("J3D1brk1", "TRK1", c));
    const e = brk.entries[0]!;
    expect([e.material, e.target, e.index]).toEqual(["filter", "tev", 2]);
    expect(sampleTrack(e.a, 100) * 255).toBeCloseTo(64);
    expect(sampleTrack(e.r, 3)).toBeCloseTo(1);
  });
});
