import { describe, expect, it } from "vitest";
import { headTags, manifestFor } from "../manifest.ts";
import { PAGES } from "../pages.ts";

const page = (name: string) => PAGES.find((p) => p.name === name)!;

describe("web app manifests", () => {
  it("open the battle fullscreen in landscape, under the site's base", () => {
    const m = manifestFor(page("battle"), "/fso/");
    expect(m).toMatchObject({ start_url: "/fso/battle/", id: "/fso/battle/", scope: "/fso/", display: "fullscreen", orientation: "landscape", short_name: "Shadow Battle" });
    expect(m.icons[0]!.src).toBe("/fso/icon.svg");
  });

  it("keep the other pages standalone, in any orientation", () => {
    const home = manifestFor(page("home"), "/");
    expect(home).toMatchObject({ start_url: "/", scope: "/", display: "standalone", name: "Four Swords Online" });
    expect(home.orientation).toBeUndefined();
    expect(manifestFor(page("online"), "/fso/")).toMatchObject({ start_url: "/fso/online/", display: "standalone" });
  });

  it("link each page to its own manifest", () => {
    const link = headTags(page("adventure"), "/fso/").find((t) => t.tag === "link")!;
    expect(link.attrs).toEqual({ rel: "manifest", href: "/fso/adventure/manifest.webmanifest" });
  });
});
