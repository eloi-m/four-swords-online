// Signs and people talking (dialogue.ts) on Lake Hylia (skips without extracted/): the sign in room 3 read from below
// as measured in Dolphin (the box on the 6th tick, a character a tick, closed 7 ticks after the press), a villager's
// pages turned, and a sign that isn't faced staying shut; the flows of the old man (room 1) and the cave villager
// (room 58) to their text, and the old man's flag set by his first talk; Tingle's Tower's two villagers in Tingle's house
// (room 11), whose branch reads the room's switch.
import { existsSync, readFileSync } from "node:fs";
import { bmgMessageById, bmgPlainText, decompressYaz0, Dol, isYaz0, loadActorTypes, parseBmg, parseRarc, readTileTypes, Stage } from "@fso/formats";
import { describe, expect, it } from "vitest";
import { Button, SUBPX, type Facing } from "../player.ts";
import { createAdventure, stepAdventure, type AdventureGame } from "./adventure.ts";
import { facedSpeaker, flagKey, messageBook, pageTyped, speakers, talkTyped, TALK_CLOSE_TICKS, TALK_OPEN_TICKS } from "./dialogue.ts";
import { actorStats, AdventureStage } from "./stage.ts";

const root = new URL("../../../../extracted/", import.meta.url);
const load = (path: string) => parseRarc(decompressYaz0(readFileSync(new URL(`files/GC4Sword_usa/${path}`, root))));

describe.skipIf(!existsSync(root))("signs and dialogue", () => {
  const tileTypes = readTileTypes(new Dol(readFileSync(new URL("sys/main.dol", root))));
  const stats = actorStats(loadActorTypes(load("data.arc"))!);
  const bmgFile = load("msgus.arc").files.find((f) => f.path.endsWith("_e.bmg"))!.data;
  const bmg = parseBmg(isYaz0(bmgFile) ? decompressYaz0(bmgFile) : bmgFile);
  const book = messageBook(bmg);
  const stage = new AdventureStage(new Stage(load("Boss/boss010.arc")), tileTypes, stats);
  stage.messages = book;
  const at = (room: number, x: number, y: number, facing: Facing): AdventureGame => createAdventure(stage, { room, x, y, facing });
  const step = (g: AdventureGame, buttons = 0, n = 1) => {
    for (let i = 0; i < n; i++) stepAdventure(g, [buttons], stage);
  };

  it("finds Lake Hylia's signs and villagers with their messages", () => {
    const g = at(3, 248, 314, "up");
    const signs = speakers(g, stage).filter((s) => s.style !== "balloon");
    expect(signs.map((s) => s.message)).toEqual([0x532]);
    expect(signs[0]!.style).toBe("wood");
  });

  it("reads room 3's sign from below as Dolphin shows it", () => {
    const g = at(3, 248, 314, "up");
    step(g, Button.Item);
    const t = g.adventure.talk!;
    expect(t.message).toBe(0x532);
    expect(g.battle.fighters[0]!.move).toBe("none");
    step(g, Button.Item, TALK_OPEN_TICKS - 1);
    expect(talkTyped(g.adventure.talk!)).toBe(0);
    step(g, 0);
    expect(talkTyped(g.adventure.talk!)).toBe(1);
    // Typed one character a tick, the leader standing whatever he presses.
    const x = g.players[0]!.x;
    step(g, Button.Left, 80);
    expect(g.players[0]!.x).toBe(x);
    expect(pageTyped(g.adventure.talk!, stage)).toBe(true);
    step(g, Button.Item);
    step(g, Button.Item, TALK_CLOSE_TICKS - 1);
    expect(g.adventure.talk).not.toBeNull();
    step(g, 0);
    expect(g.adventure.talk).toBeNull();
    // The next press opens the sign again.
    expect(g.battle.fighters[0]!.move).toBe("none");
    step(g, Button.Item);
    expect(g.adventure.talk?.message).toBe(0x532);
  });

  // A hand repro walked up at x 239 and got nothing: the sign's box starts at x 242. Dolphin agrees (2026-10-18, the
  // Links teleported to (239, 330) and (242, 330) below it, walked up to y 311, A: the board at 242 only).
  it("reads room 3's sign walked up to from below, only with the talking point in its box", () => {
    for (const [x, opens] of [[242, true], [254, true], [239, false], [255, false]] as const) {
      const g = createAdventure(stage, { room: 3, x, y: 330, players: 4 });
      step(g, Button.Up, 24);
      expect(g.players[0]!.y / SUBPX, `x ${x}`).toBe(311);
      step(g, 0, 2);
      step(g, Button.Item, 2);
      expect(g.adventure.talk?.message ?? null, `x ${x}`).toBe(opens ? 0x532 : null);
    }
  });

  it("doesn't read a sign from the side or from above", () => {
    const g = at(3, 232, 296, "right");
    step(g, Button.Item);
    expect(g.adventure.talk).toBeNull();
  });

  it("turns a sign's pages: room 2's, two pages", () => {
    const g = at(2, 360, 282, "up");
    step(g, Button.Item);
    expect(g.adventure.talk?.message).toBe(0x528);
    step(g, 0, TALK_OPEN_TICKS + 3);
    // A press while it types shows the whole page (assumed); the next turns it, the last closes the box.
    step(g, Button.Item);
    expect(pageTyped(g.adventure.talk!, stage)).toBe(true);
    step(g, 0);
    step(g, Button.Item);
    expect(g.adventure.talk!.page).toBe(1);
    expect(talkTyped(g.adventure.talk!)).toBe(0);
    step(g, 0);
    expect(talkTyped(g.adventure.talk!)).toBe(1);
    step(g, 0, 80);
    step(g, Button.Item);
    step(g, 0, TALK_CLOSE_TICKS);
    expect(g.adventure.talk).toBeNull();
  });

  it("knows the villagers' messages: room 3's house (two of them), room 7's cannon man", () => {
    const messages = [2, 3].flatMap((area) => stage.area(3, area).actors.filter((a) => a.id === "JIJI").map((a) => (a.params & 0xfff) + 0x12b));
    expect(messages).toEqual([0x470, 0x471]);
    expect(book.pages(0x471)).toEqual([82, 85]);
    // Room 1's old man (message 1278): only a flow (branch4), no text of its own.
    expect(book.pages(0x4fe)).toBeNull();
  });

  it("follows the flows of the old man (room 1) and the cave villager (room 58) to printable text", () => {
    const one = { controllers: 1, flags: [] as number[], switches: 0 };
    // The old man: branch4 by the controllers (1 → message index 1302, the ifFlag; 2-4 → 1304, "Hrmm..."), then ifFlag
    // by the flag (unset → index 1279 → 1280 → index 1276, the first talk, 1277).
    expect(book.resolve(0x4fe, one)).toBe(0x4fd);
    expect(book.resolve(0x4fe, { controllers: 2, flags: [], switches: 0 })).toBe(0x518);
    expect(book.resolve(0x4fe, { controllers: 1, flags: [flagKey(3, 10)], switches: 0 })).toBe(0x4ff); // the lecture after the drill
    expect(book.resolve(0x4fe, { controllers: 1, flags: [flagKey(1, 10)], switches: 0 })).toBe(0x502); // his repeat line
    expect(book.sets(0x4fd)).toEqual([[flagKey(1, 10), 1]]);
    // The cave villager: branch4(791, 791, 791, 792) → 792 for one to three controllers, 793 for four.
    expect(book.resolve(0x317, one)).toBe(0x318);
    expect(book.resolve(0x317, { controllers: 4, flags: [], switches: 0 })).toBe(0x319);
    for (const id of [0x4fd, 0x518, 0x4ff, 0x502, 0x318, 0x319]) {
      const text = bmgPlainText(bmgMessageById(bmg, id)!);
      expect(text, `message ${id}`).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/);
      expect(text.trim().length, `message ${id}`).toBeGreaterThan(0);
    }
    expect(bmgPlainText(bmgMessageById(bmg, 0x318)!)).toMatch(/^Whoa!/);
  });

  it("lists the old man and the cave villager with the messages they show", () => {
    const old = at(1, 88, 56, "right");
    old.adventure.area = 2;
    expect(speakers(old, stage).map((s) => [s.actor.index, s.message])).toContainEqual([9, 0x4fd]);
    const cave = at(58, 248, 312, "right");
    cave.adventure.area = 5;
    expect(speakers(cave, stage).map((s) => [s.actor.index, s.message])).toContainEqual([36, 0x318]);
  });

  it("talks to the old man: his first talk sets the flag, the next talk is his repeat line", () => {
    const g = at(1, 88, 56, "right");
    g.adventure.area = 2;
    // Pages turned on the Item button (each after its typing), until the box closes.
    const finish = () => {
      for (let i = 0; i < 20 && g.adventure.talk; i++) {
        step(g, 0, 90);
        if (!g.adventure.talk) break;
        step(g, Button.Item);
        step(g, 0);
      }
    };
    step(g, Button.Item);
    expect(g.adventure.talk?.message).toBe(0x4fd);
    expect(g.adventure.flags).toEqual([flagKey(1, 10)]); // its setFlag, set as it opens
    step(g, 0);
    finish();
    expect(g.adventure.talk).toBeNull();
    expect(g.adventure.flags).toEqual([flagKey(1, 10)]);
    step(g, Button.Item);
    expect(g.adventure.talk?.message).toBe(0x502);
  });

  // The playtest capture `playtest-old-man-silent` (made before the flows were followed): the leader below him facing up.
  it("talks to the old man faced from below with the Item button", () => {
    const g = at(1, 104.625, 79.125, "up");
    g.adventure.area = 2;
    step(g, Button.Action, 2);
    // The Action button lifts nothing (the empty lift, 23 ticks: no talk meanwhile); the Item button talks.
    step(g, 0, 30);
    expect(g.adventure.talk).toBeNull();
    step(g, Button.Item, 2);
    expect(g.adventure.talk?.message).toBe(0x4fd);
  });

  it("talks to the cave villager: the one-controller text, the four Links' controls", () => {
    const g = at(58, 248, 312, "right");
    g.adventure.area = 5;
    step(g, Button.Item);
    expect(g.adventure.talk?.message).toBe(0x318);
    expect(g.battle.fighters[0]!.move).toBe("none");
  });

  // Tingle's house (Tingle's Tower room 11, area 2): two villagers whose messages (843, 844) are only a branch (2.07) on
  // the room's switch 29 (main.dol 0x80384074 → 0x802D800C), which nothing in the room sets.
  const tower = new AdventureStage(new Stage(load("Boss/boss012.arc")), tileTypes, stats);
  tower.messages = book;
  const text = (id: number) => bmgPlainText(bmgMessageById(bmg, id)!);

  it("follows Tingle's house villagers' branch by the room's switch", () => {
    const off = { controllers: 1, flags: [] as number[], switches: 0 }, on = { ...off, switches: 1 << 29 };
    // 843: branch(29, 877, 878): on → index 877 (id 878), off → index 878 (id 879); 844: branch(29, 880, 879).
    expect(book.resolve(843, off)).toBe(879);
    expect(book.resolve(843, on)).toBe(878);
    expect(book.resolve(844, off)).toBe(880);
    expect(book.resolve(844, on)).toBe(881);
    // Another switch doesn't count.
    expect(book.resolve(843, { ...off, switches: 1 << 28 })).toBe(879);
    expect(text(879)).toMatch(/^And in last place\.\.\. P.*\nC'mon! I know you can do\nbetter than that\./);
    expect(text(880)).toMatch(/^Here's your last chance to\nreverse your fortunes!/);
  });

  it("talks to Tingle's house villagers: the messages of the switch off, of it on once set", () => {
    const g = createAdventure(tower, { room: 11, x: 168, y: 76, facing: "up" });
    g.adventure.area = 2;
    const said = () => speakers(g, tower).filter((s) => s.actor.id === "JIJI").map((s) => [s.actor.index, s.message]);
    expect(said()).toEqual(expect.arrayContaining([[8, 879], [11, 880]]));
    // The leader below the first, facing up: the Item button opens the message of the switch off.
    expect(facedSpeaker(g, tower)?.actor.index).toBe(8);
    stepAdventure(g, [Button.Item], tower);
    expect(g.adventure.talk?.message).toBe(879);
    g.battle.switches = 1 << 29;
    expect(said()).toEqual(expect.arrayContaining([[8, 878], [11, 881]]));
  });
});
