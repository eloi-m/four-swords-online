// Synthetic SCRNblo2 / FONTbfn1 files built byte by byte, following the layouts documented in blo.ts and bfn.ts.
import { describe, expect, it } from "vitest";
import { bfnGlyph, parseBfn } from "./bfn.ts";
import { findPane, MATERIAL_INIT_SIZE, parseBlo, walkPanes } from "./blo.ts";

class Writer {
  bytes: number[] = [];
  get length() {
    return this.bytes.length;
  }
  u8(...v: number[]) {
    for (const x of v) this.bytes.push(x & 0xff);
    return this;
  }
  u16(...v: number[]) {
    for (const x of v) this.u8(x >> 8, x);
    return this;
  }
  u32(...v: number[]) {
    for (const x of v) this.u16(x >>> 16, x);
    return this;
  }
  f32(...v: number[]) {
    const b = new DataView(new ArrayBuffer(4));
    for (const x of v) {
      b.setFloat32(0, x);
      this.u32(b.getUint32(0));
    }
    return this;
  }
  str(s: string) {
    return this.u8(...[...s].map((c) => c.charCodeAt(0)));
  }
  pad(align: number, fill = 0) {
    while (this.length % align) this.u8(fill);
    return this;
  }
  set16(at: number, v: number) {
    this.bytes[at] = (v >> 8) & 0xff;
    this.bytes[at + 1] = v & 0xff;
  }
  set32(at: number, v: number) {
    this.set16(at, v >>> 16);
    this.set16(at + 2, v & 0xffff);
  }
  append(w: Writer) {
    this.bytes.push(...w.bytes);
    return this;
  }
}

function block(tag: string, body: Writer, align = 4): Writer {
  const w = new Writer().str(tag).u32(0).append(body).pad(align);
  w.set32(4, w.length);
  return w;
}

function resources(names: string[]): Writer {
  const w = new Writer().u16(names.length, 0xffff).u32(0x10); // count, pad, table offset (from the block tag)
  const table = new Writer().u16(names.length);
  const entries = new Writer();
  for (const n of names) {
    table.u16(2 + names.length * 2 + entries.length);
    entries.u8(2, n.length).str(n);
  }
  return w.append(table).append(entries);
}

// Pane header (0x40 bytes after the tag/size): u16 0x40, id, visible, anchor, pad, tag, user tag, floats.
function paneHeader(tag: string, id: number, anchor: number, box: number[], visible = 1): Writer {
  const [w, h, x, y, rot = 0] = box as [number, number, number, number, number?];
  const name = new Writer().u8(...new Array(8 - tag.length).fill(0)).str(tag);
  return new Writer().u16(0x40, id).u8(visible, anchor).str("RE").append(name).u32(0, 0).f32(w, h, 1, 1, 0, 0, rot, x, y).u32(0);
}

function exPane(tag4: string, sub: string, tag: string, id: number, anchor: number, box: number[], body: Writer): Writer {
  return block(tag4, new Writer().append(block(sub, paneHeader(tag, id, anchor, box))).append(body), 8);
}

// One material: texture 0 through TEXMTX0, lerp(C0, C1, tex) then × vertex color, blend src-alpha.
function materials(): Writer {
  const init = new Writer();
  init.u8(1, 2, 0, 0, 0, 0, 1, 0); // flag, cull idx, chan num idx, texgen num idx, tev stage num idx, dither idx
  init.u16(0, 0xffff); // mat colors
  init.u16(0, 0, 1, 1); // color chans
  init.u16(0, ...new Array(7).fill(0xffff)); // tex gens
  init.u16(0, ...new Array(9).fill(0xffff)); // tex matrices
  init.u16(0, ...new Array(7).fill(0xffff)); // textures
  init.u16(0xffff); // font
  init.u16(0, 0, 0, 0); // konst colors
  init.u8(0x1f, ...new Array(15).fill(0x0c)).u8(0x1d, ...new Array(15).fill(0x1c)); // konst sels
  init.u16(0, 1, ...new Array(14).fill(0xffff)); // tev orders
  init.u16(0, 1, 2, 2); // tev colors
  init.u16(0, 1, ...new Array(14).fill(0xffff)); // tev stages
  init.u16(0, 0, ...new Array(14).fill(0xffff)); // swap modes
  init.u16(0, 0, 0, 0); // swap tables
  init.u16(0, 0, 0); // alpha comp, blend, pad
  expect(init.length).toBe(MATERIAL_INIT_SIZE);

  const tables: [number, Writer | null][] = [];
  const t = (w: Writer | null) => tables.push([0, w]);
  t(init);
  t(new Writer().u16(0).pad(4)); // remap
  t(new Writer().u16(1, 0xffff).u16(0x1234, 8).str("mat_Ptest\0").pad(4)); // names
  t(null); // indirect
  t(new Writer().u32(2, 1, 0)); // cull modes
  t(new Writer().u8(255, 255, 255, 100)); // mat colors
  t(new Writer().u8(1).pad(4)); // chan nums
  t(new Writer().u8(0, 1, 0xff, 0xff, 0, 1, 0xff, 0xff)); // chan infos
  t(new Writer().u8(1).pad(4)); // tex gen nums
  t(new Writer().u8(1, 4, 0x1e, 0xff)); // tex gens
  t(new Writer().u8(1, 0).u16(0xffff).f32(0.5, 0.5, 0.5, 2, 1, 0, 0.25, 0)); // tex matrix
  t(new Writer().u16(0).pad(4)); // textures
  t(null); // fonts
  t(new Writer().u8(0, 0, 0xff, 0xff, 0xff, 0xff, 4, 0xff)); // tev orders
  t(new Writer().u16(0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0)); // tev colors (s10)
  t(new Writer().u8(255, 255, 255, 255)); // konst
  t(new Writer().u8(2).pad(4)); // stage nums
  t(new Writer()
    .u8(0xff, 2, 4, 8, 15, 0, 0, 0, 1, 0, 1, 2, 4, 7, 0, 0, 0, 1, 0, 0xff)
    .u8(0xff, 15, 10, 0, 15, 0, 0, 0, 1, 0, 7, 5, 0, 7, 0, 0, 0, 1, 0, 0xff)); // stages
  t(new Writer().u8(0, 0, 0xff, 0xff)); // swap modes
  t(new Writer().u8(0, 1, 2, 3)); // swap tables
  t(new Writer().u8(7, 0, 0, 7, 0, 0xff, 0xff, 0xff)); // alpha compare
  t(new Writer().u8(1, 4, 5, 3)); // blend
  t(new Writer().u8(1).pad(4)); // dither

  const body = new Writer().u16(1, 0xffff);
  const offsets = body.length;
  body.u32(...new Array(23).fill(0));
  tables.forEach(([, w], i) => {
    if (!w) return;
    body.set32(offsets + i * 4, body.length + 8);
    body.append(w);
  });
  return block("MAT1", body);
}

function screen(): Uint8Array {
  const blocks: Writer[] = [
    block("INF1", new Writer().u16(608, 448).u8(128, 128, 128, 0), 0x20),
    block("TEX1", resources(["dot.bti"]), 0x20),
    block("FNT1", resources(["font.bfn"]), 0x20),
    materials(),
    block("PAN2", paneHeader("ROOT", 0, 0, [608, 448, 0, 0])),
    block("BGN1", new Writer()),
    exPane("PIC2", "pan2", "Ptest", 2, 4, [40, 20, 100, 50, 90],
      new Writer().u16(0x30, 1, 0).str("RE").u16(4, 5, 6, 7).u16(0, 0, 0x100, 0, 0, 0x100, 0x100, 0x100).u32(0xff0000ff, 0x00ff00ff, 0x0000ffff, 0xffffff80)),
    block("BGN1", new Writer()),
    exPane("TBX2", "pan2", "Ttext", 3, 0, [200, 40, -20, 5],
      new Writer().u16(0x25, 2, 0).u16(1, 24, 22, 20).u8(2, 0).u32(0xffffffff, 0x808080ff).u8(0).str("RES").u16(16, 5).str("Hi\nyo")),
    block("END1", new Writer()),
    exPane("WIN2", "pan2", "Wbox", 4, 0, [100, 60, 10, 10],
      new Writer().u16(0x40).str("RESERV").u32(0xffffffff, 0xffffffff).u16(0, 0, 0, 0).u8(0x27).str("R").u16(16, 16, 68, 28).u16(3, 0).str("RE").u16(8, 9, 10, 11).u32(0x685928ff, 0x685928ff, 0x685928ff, 0x685928ff)),
    block("END1", new Writer()),
    block("EXT1", new Writer()),
  ];
  const file = new Writer().str("SCRNblo2").u32(0, blocks.length).str("SVR1").u8(...new Array(12).fill(0xff));
  for (const b of blocks) file.append(b);
  file.set32(8, file.length);
  return new Uint8Array(file.bytes);
}

describe("SCRNblo2", () => {
  const s = parseBlo(screen());

  it("reads the screen info and resource tables", () => {
    expect([s.width, s.height, s.background]).toEqual([608, 448, [128, 128, 128, 0]]);
    expect(s.textures).toEqual([{ type: 2, name: "dot.bti" }]);
    expect(s.fonts).toEqual([{ type: 2, name: "font.bfn" }]);
  });

  it("builds the pane tree from BGN1/END1", () => {
    const tree = [...walkPanes(s.root)].map(({ pane, depth }) => `${depth}:${pane.block}:${pane.tag}`);
    expect(tree).toEqual(["0:PAN2:ROOT", "1:PIC2:Ptest", "2:TBX2:Ttext", "1:WIN2:Wbox"]);
  });

  it("decodes picture fields", () => {
    const p = findPane(s, "Ptest")!;
    if (p.kind !== "picture") throw new Error(p.kind);
    expect([p.id, p.anchor, p.width, p.height, p.x, p.y, p.rotateZ, p.visible]).toEqual([2, 4, 40, 20, 100, 50, 90, true]);
    expect([p.materialId, p.material, p.vertexIndices]).toEqual([1, 0, [4, 5, 6, 7]]);
    expect(p.texCoords).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
    expect(p.cornerColors).toEqual([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 128]]);
  });

  it("decodes text box and window fields", () => {
    const t = findPane(s, "Ttext")!;
    if (t.kind !== "textbox") throw new Error(t.kind);
    expect([t.charSpace, t.lineSpace, t.fontWidth, t.fontHeight, t.hBinding, t.vBinding]).toEqual([1, 24, 22, 20, 2, 0]);
    expect([t.topColor, t.bottomColor, t.maxLength, t.text]).toEqual([[255, 255, 255, 255], [128, 128, 128, 255], 16, "Hi\nyo"]);
    const w = findPane(s, "Wbox")!;
    if (w.kind !== "window") throw new Error(w.kind);
    expect([w.frameMaterials, w.frameMirror, w.contentX, w.contentY, w.contentWidth, w.contentHeight]).toEqual([[0, 0, 0, 0], 0x27, 16, 16, 68, 28]);
    expect([w.materialId, w.material, w.vertexIndices, w.contentColors[0]]).toEqual([3, 0, [8, 9, 10, 11], [0x68, 0x59, 0x28, 0xff]]);
  });

  it("resolves material tables through the init data indices", () => {
    expect(s.materials).toHaveLength(1);
    const m = s.materials[0]!;
    expect([m.name, m.flag, m.cullMode, m.colorChannels, m.dither]).toEqual(["mat_Ptest", 1, 0, [1, 1], true]);
    expect(m.matColors).toEqual([[255, 255, 255, 100], [255, 255, 255, 255]]);
    expect(m.textures).toEqual([0]);
    expect(m.texGens).toEqual([{ type: 1, source: 4, matrix: 0x1e }]);
    expect(m.texMatrices[0]).toMatchObject({ center: [0.5, 0.5, 0.5], scaleX: 2, scaleY: 1, translateX: 0.25 });
    expect(m.tevOrders).toEqual([{ texCoord: 0, texMap: 0, channel: 0xff }, { texCoord: 0xff, texMap: 0xff, channel: 4 }]);
    expect(m.tevColors).toEqual([[0, 0, 0, 0], [255, 0, 0, 255], [0, 0, 0, 0], [0, 0, 0, 0]]);
    expect(m.tevStages.map((t) => [t.colorIn, t.alphaIn])).toEqual([[[2, 4, 8, 15], [1, 2, 4, 7]], [[15, 10, 0, 15], [7, 5, 0, 7]]]);
    expect([m.kColorSels, m.kAlphaSels]).toEqual([[0x1f, 0x0c], [0x1d, 0x1c]]);
    expect(m.blend).toEqual({ type: 1, source: 4, dest: 5, logicOp: 3 });
    expect(m.alphaCompare).toEqual({ comp0: 7, ref0: 0, op: 0, comp1: 7, ref1: 0 });
  });

  it("rejects other files", () => {
    expect(() => parseBlo(new TextEncoder().encode("SCRNblo1".padEnd(64, "\0")))).toThrow(/SCRNblo2/);
  });
});

describe("FONTbfn1", () => {
  // Two 8×8 I4 cells side by side on one 16×8 sheet; codes 0x41-0x42 map linearly to glyphs 0-1.
  const sheet = new Writer();
  for (let bx = 0; bx < 2; bx++) for (let i = 0; i < 32; i++) sheet.u8(bx ? 0x0f : 0xf0);
  const blocks = [
    block("INF1", new Writer().u16(0, 6, 2, 8, 8, 0).pad(0x20 - 8)),
    block("WID1", new Writer().u16(0, 1).u8(1, 6, 0, 7)),
    block("MAP1", new Writer().u16(0, 0x41, 0x42, 0)),
    block("GLY1", new Writer().u16(0, 1, 8, 8).u32(sheet.length).u16(0, 2, 1, 16, 8, 0).append(sheet)),
  ];
  const file = new Writer().str("FONTbfn1").u32(0, blocks.length).u8(...new Array(16).fill(0));
  for (const b of blocks) file.append(b);
  const font = parseBfn(new Uint8Array(file.bytes));

  it("reads metrics, maps codes to glyph cells and widths", () => {
    expect([font.encoding, font.ascent, font.descent, font.width, font.leading]).toEqual([0, 6, 2, 8, 8]);
    expect(bfnGlyph(font, 0x41)).toEqual({ sheet: 0, x: 0, y: 0, width: 8, height: 8, bearing: 1, advance: 6 });
    expect(bfnGlyph(font, 0x42)).toMatchObject({ x: 8, y: 0, bearing: 0, advance: 7 });
    expect(bfnGlyph(font, 0x43)).toMatchObject({ x: 0 }); // unmapped codes fall back to the default glyph
  });
});
