// J2D screens and fonts from the real extracted disc; skipped when extracted/ is absent (e.g. in CI).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRarc, type RarcArchive } from "../rarc.ts";
import { decompressYaz0, isYaz0 } from "../yaz0.ts";
import { bfnGlyph, decodeBfnSheets, parseBfn } from "./bfn.ts";
import { findPane, parseBlo, walkPanes, type BloPane, type BloScreen } from "./blo.ts";

const root = new URL("../../../../extracted/files/GC4Sword_usa/", import.meta.url);
const present = existsSync(root);

const ARCHIVES = [
  "game2D.arc", "main2D.arc", "entry.arc", "gamemode.arc", "file.arc", "map1.arc", "map2.arc", "result.arc",
  "result1.arc", "result2.arc", "title.arc", "logo.arc",
  ...Array.from({ length: 8 }, (_, i) => `staff/staff${i + 1}.arc`),
  ...["boss021", "boss051", "boss100", "boss200", "boss201", "boss202", "boss204", "boss205", "boss990", "boss991", "ending"].map((b) => `Boss/${b}.arc`),
];

const archives = new Map<string, RarcArchive>();
function load(path: string): RarcArchive {
  let a = archives.get(path);
  if (!a) archives.set(path, (a = parseRarc(decompressYaz0(readFileSync(new URL(path, root))))));
  return a;
}
const data = (a: RarcArchive, path: string) => {
  const f = a.files.find((x) => x.path === path);
  return f && (isYaz0(f.data) ? decompressYaz0(f.data) : f.data);
};
function screen(archive: string, name: string): BloScreen {
  return parseBlo(data(load(archive), `scrn/${name}`)!);
}
const panes = (s: BloScreen) => [...walkPanes(s.root)].map((p) => p.pane);
const textureOf = (s: BloScreen, p: BloPane) => (p.kind === "pane" ? [] : s.materials[p.material]!.textures.map((t) => s.textures[t!]?.name));

describe.skipIf(!present)("real disc: J2D screens", () => {
  it("parses all 82 SCRNblo2 screens with consistent references", () => {
    let count = 0;
    for (const path of ARCHIVES) {
      const archive = load(path);
      for (const file of archive.files.filter((f) => /(^|\/)scrn\/[^/]+\.blo$/.test(f.path))) {
        const s = parseBlo(file.data);
        count++;
        expect([s.width, s.height, s.root.tag, s.root.block]).toEqual([608, 448, "ROOT", "PAN2"]);
        // Names resolve case-insensitively, as in JKRArchive (collect.blo asks for kk_advWoman_01.bti, the file is
        // kk_advwoman_01.bti). boss100 reuses boss051's fishing HUD without shipping its textures.
        const timg = new Set(archive.files.filter((f) => f.path.includes("timg/")).map((f) => f.path.split("/").pop()!.toLowerCase()));
        if (path !== "Boss/boss100.arc") for (const t of s.textures) expect(timg.has(t.name.toLowerCase()), `${path} ${t.name}`).toBe(true);
        const ids = new Set<number>();
        for (const p of panes(s)) {
          expect(ids.has(p.id)).toBe(false);
          ids.add(p.id);
          if (p.kind === "pane") continue;
          const m = s.materials[p.material]!;
          expect(m).toBeDefined();
          for (const t of m.textures) if (t !== null) expect(t).toBeLessThan(s.textures.length);
          if (p.kind === "textbox") expect(m.font).toBe(0);
          if (p.kind === "window") for (const f of p.frameMaterials) expect(f).toBeLessThan(s.materials.length);
        }
      }
    }
    expect(count).toBe(82);
  });

  it("main_bat.blo is the Shadow Battle HUD: 4 player corners with hearts, portrait, item box and gem counter", () => {
    const s = screen("game2D.arc", "main_bat.blo");
    const all = panes(s);
    expect(all.filter((p) => p.kind === "picture")).toHaveLength(380);
    expect(all.filter((p) => p.kind === "pane")).toHaveLength(17);
    const uses = (tex: string) => all.filter((p) => textureOf(s, p).includes(tex)).length;
    // 8 heart slots per player, two layers: Pp{n}lf01-08 heart.bti, Pp{n}lf09-16 heart_04_2.bti, each with a shadow (lfk)
    expect([uses("heart.bti"), uses("heart_04_2.bti")]).toEqual([4 * 16, 4 * 16]);
    expect(uses("kk_rupyNum_08.bti")).toBe(4 * 10); // 5 gem counter digits + shadows per player
    expect(uses("kk_force_01.bti")).toBe(4 * 2);
    for (const [n, color] of [[1, "G"], [2, "R"], [3, "B"], [4, "P"]] as const) {
      expect(textureOf(s, findPane(s, `Pp${n}i01`)!)).toEqual([`kk_link${color}_01.bti`]);
      for (let i = 1; i <= 16; i++) expect(findPane(s, `Pp${n}lf${String(i).padStart(2, "0")}`)?.kind).toBe("picture");
    }
    const bar = findPane(s, "Pp4mb03")!;
    expect([bar.anchor, bar.width, bar.height, bar.x, bar.y]).toEqual([0, 116, 13, -117, -1]);
    expect(s.materials[(bar as { material: number }).material]).toMatchObject({ name: "mat_Pp4mb03_v", matColors: [[255, 255, 255, 175], [255, 255, 255, 255]] });
  });

  it("pressstart.blo: red text over a black shadow, offset by (-4, -4)", () => {
    const s = screen("main2D.arc", "pressstart.blo");
    const shadow = findPane(s, "prsstrt2")!, text = findPane(s, "prsstrt1")!;
    expect(shadow.children).toEqual([text]);
    expect([shadow.anchor, shadow.x, shadow.y, text.x, text.y]).toEqual([4, 307, 308, -4, -4]);
    const [m0, m1] = s.materials;
    expect(m0!.tevColors.slice(0, 2)).toEqual([[0, 0, 0, 0], [0, 0, 0, 255]]);
    expect(m1!.tevColors.slice(0, 2)).toEqual([[255, 255, 255, 0], [255, 0, 0, 255]]);
    expect(m0!.matColors[0]![3]).toBe(100);
  });

  it("decodes windows and text boxes", () => {
    const file = screen("file.arc", "file_select.blo");
    const w = findPane(file, "Wbat01")!;
    if (w.kind !== "window") throw new Error(w.kind);
    expect([w.width, w.height, w.contentX, w.contentY, w.contentWidth, w.contentHeight, w.frameMirror]).toEqual([214, 102, 16, 16, 182, 70, 0x27]);
    const msg = screen("main2D.arc", "main_message_window.blo");
    const t = findPane(msg, "Tmmt01")!;
    if (t.kind !== "textbox") throw new Error(t.kind);
    expect([t.fontWidth, t.fontHeight, t.charSpace, t.lineSpace, t.hBinding, t.vBinding, t.maxLength]).toEqual([22, 22, 0, 19, 2, 0, 256]);
    expect(t.text).toBe("Welcome to Entertainment Department.\nWelcome to Entertainment Department.");
    expect(msg.fonts).toEqual([{ type: 2, name: "rock_24_20_4i_e.bfn" }]);
    // Japanese placeholder text is Shift-JIS
    const sel = findPane(screen("main2D.arc", "bat_stage_select_window.blo"), "Tmmt01")!;
    expect(sel.kind === "textbox" && sel.text.startsWith("わわわ")).toBe(true);
  });

  it("reads the US and Japanese BFN fonts", () => {
    const us = parseBfn(data(load("msgus.arc"), "font/rock_24_20_4i_e.bfn")!);
    expect([us.encoding, us.ascent, us.descent, us.width, us.leading]).toEqual([0, 18, 6, 21, 24]);
    expect(us.glyphBlocks[0]).toMatchObject({ firstGlyph: 0, lastGlyph: 224, cellWidth: 24, cellHeight: 24, format: 0, sheetWidth: 128 });
    expect(decodeBfnSheets(us)).toHaveLength(9);
    expect(bfnGlyph(us, 0x41)).toMatchObject({ sheet: 1, x: 24 * 3, y: 24 }); // 'A' = glyph 33, cell 8 of sheet 1
    const jp = parseBfn(data(load("msgjp.arc"), "font/rock_24_20_4i_j.bfn")!);
    expect(jp.encoding).toBe(2);
    expect(jp.maps.map((m) => m.type)).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2, 3]);
    expect(bfnGlyph(jp, 0x82a0)).not.toEqual(bfnGlyph(jp, 0x82a2)); // あ, い
  });
});
