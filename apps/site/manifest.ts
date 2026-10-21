// Web app manifests, one per page (vite.config.ts serves and emits them at `<page>/manifest.webmanifest`), so that
// Add to Home Screen opens the page it was added from: the games fullscreen in landscape (iOS Safari has no
// Fullscreen API for pages; a home-screen app is the closest), the rest as a standalone app. Every URL is under the
// site's base (BASE=/fso/ in production).
import type { Page } from "./pages.ts";

export const MANIFEST = "manifest.webmanifest";

/** Games: fullscreen and landscape from the home screen. */
const GAMES: Record<string, string> = { battle: "Shadow Battle", adventure: "Four Swords Adventure" };
const NAMES: Record<string, string> = { home: "Four Swords Online", online: "Shadow Battle online" };

export interface WebManifest {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: "fullscreen" | "standalone";
  orientation?: "landscape";
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string }[];
}

/** `base` = Vite's base, ending with "/". */
export function manifestFor(page: Page, base: string): WebManifest {
  const game = GAMES[page.name];
  const name = game ?? NAMES[page.name] ?? page.name;
  return {
    id: `${base}${page.path}`,
    name: page.path ? `${name} · Four Swords Online` : name,
    short_name: game ?? name,
    start_url: `${base}${page.path}`,
    scope: base,
    display: game ? "fullscreen" : "standalone",
    ...(game ? { orientation: "landscape" as const } : {}),
    background_color: "#070b1d",
    theme_color: "#070b1d",
    icons: [{ src: `${base}icon.svg`, sizes: "any", type: "image/svg+xml" }],
  };
}

/** The tags every page gets in its <head>: the manifest, and the older iOS home-screen metas. */
export function headTags(page: Page, base: string): { tag: string; attrs: Record<string, string> }[] {
  const m = manifestFor(page, base);
  return [
    { tag: "link", attrs: { rel: "manifest", href: `${base}${page.path}${MANIFEST}` } },
    { tag: "meta", attrs: { name: "mobile-web-app-capable", content: "yes" } },
    { tag: "meta", attrs: { name: "apple-mobile-web-app-capable", content: "yes" } },
    { tag: "meta", attrs: { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" } },
    { tag: "meta", attrs: { name: "apple-mobile-web-app-title", content: m.short_name } },
  ];
}
