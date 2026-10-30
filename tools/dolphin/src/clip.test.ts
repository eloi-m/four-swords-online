import { describe, expect, it } from "vitest";
import { Button } from "@fso/sim";
import { GATHER_BUTTON, SEPARATE_BUTTON, selectButtons } from "@fso/sim/adventure";
import { adventureButtons } from "./clip.ts";

const pad = (buttons: number, x = 0, y = 0) => ({ buttons, x, y, cx: 0, cy: 0 });

describe("the adventure's pad in a clip", () => {
  it("reads the sword, the action, the stick", () => {
    expect(adventureButtons(pad(0x200 | 0x20, 72, 0))).toBe(Button.Sword | Button.Action | Button.Right);
  });

  it("reads X and Y as the Links apart and together, the D-pad as a Link handed the controls", () => {
    expect(adventureButtons(pad(0x400))).toBe(SEPARATE_BUTTON);
    expect(adventureButtons(pad(0x800))).toBe(GATHER_BUTTON);
    expect(adventureButtons(pad(0x2))).toBe(selectButtons(1));
    expect(adventureButtons(pad(0x4))).toBe(selectButtons(3));
  });
});
