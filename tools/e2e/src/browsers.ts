// Where the browsers the e2e scripts drive are installed: $CHROME / $FIREFOX when set, else the first of the usual
// install paths on this platform that exists.
//   const CHROME = browserPath("chrome");
import { existsSync } from "node:fs";

export type BrowserName = "chrome" | "firefox";

const INSTALLS: Readonly<Record<BrowserName, Partial<Record<NodeJS.Platform, readonly string[]>>>> = {
  chrome: {
    darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"],
    linux: ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"],
    win32: ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"],
  },
  firefox: {
    darwin: ["/Applications/Firefox.app/Contents/MacOS/firefox"],
    linux: ["/usr/bin/firefox", "/snap/bin/firefox"],
    win32: ["C:\\Program Files\\Mozilla Firefox\\firefox.exe", "C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe"],
  },
};

/** The browser's executable: $CHROME or $FIREFOX, else its usual install path here; throws when neither is found. */
export function browserPath(name: BrowserName): string {
  const variable = name.toUpperCase();
  const set = process.env[variable];
  if (set) return set;
  const found = INSTALLS[name][process.platform]?.find((path) => existsSync(path));
  if (!found) throw new Error(`${name} not found: set ${variable} to its executable`);
  return found;
}
