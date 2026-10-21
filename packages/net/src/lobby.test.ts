import { describe, expect, it } from "vitest";
import { ROOM_CODE, roomCode } from "./lobby.ts";

describe("room codes", () => {
  it("reads the word out of what was typed or pasted", () => {
    expect(roomCode("river")).toBe("RIVER");
    expect(roomCode("  Bear \n")).toBe("BEAR");
    expect(roomCode("t o r c h.")).toBe("TORCH");
    expect(roomCode("https://example.org/fso/battle/#join=APPLE")).toBe("APPLE");
    expect(roomCode("http://localhost:5191/battle/#join=wolf&name=Bob&server=ws%3A%2F%2Fhost%3A5185")).toBe("WOLF");
    expect(roomCode("Join my room! https://example.org/online/#online&join=Crane&spectate")).toBe("CRANE");
  });

  it("takes words of 4 or 5 letters", () => {
    for (const code of ["BEAR", "RIVER"]) expect(ROOM_CODE.test(code)).toBe(true);
    for (const code of ["", "OWL", "RIVERS", "AB2CD", "river"]) expect(ROOM_CODE.test(code)).toBe(false);
  });
});
