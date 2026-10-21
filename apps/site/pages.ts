// The pages of the site (one origin, with the game files at <base>data/): where each lives in the build and which
// app's index.html it is. The apps stay standalone Vite projects; the site builds their pages together (vite.config.ts).
// The site is for playing: the development tools (apps/viewer, screens, sound-test) run from their own dev servers.
export interface Page {
  /** URL path under the site's base ("" = the home page), always ending with "/". */
  path: string;
  /** The page's HTML, relative to apps/. */
  html: string;
  /** Short name (tests, logs). */
  name: string;
  /** An app page that gets the site's home link (not the site's own pages). */
  app: boolean;
}

export const PAGES: readonly Page[] = [
  { path: "", html: "site/index.html", name: "home", app: false },
  { path: "online/", html: "site/online/index.html", name: "online", app: false },
  { path: "battle/", html: "battle/index.html", name: "battle", app: true },
  { path: "adventure/", html: "game/index.html", name: "adventure", app: true },
];

/** Where Vite writes a page's HTML (the input's path under apps/) → where the site serves it. */
export const builtPath = (page: Page): string => page.html;
export const servedPath = (page: Page): string => `${page.path}index.html`;
