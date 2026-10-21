// Opening a page and waiting until it's ready, for every e2e script. The pages load the game files over HTTP from
// <base>data/ (in dev and `vite preview`, tools/bundle's Vite plugin serves the repo's extracted/ folder), so there is
// no disc to import: navigate, then wait for the page's own "ready" condition. Works with puppeteer and Playwright.
//   await openReady(page, url, () => window.fso?.mode === "menu");

/** A puppeteer or Playwright page (both evaluate string expressions). */
interface Evaluator {
  evaluate(expression: string): Promise<unknown>;
}
interface Navigator extends Evaluator {
  goto(url: string, options?: { waitUntil?: "load" }): Promise<unknown>;
}

/** The error a page shows instead of starting (the game files missing on the server, a failed download…), or "". */
function bootError(): string {
  const boot = document.getElementById("boot-status");
  if (boot && /^Error:/.test(boot.textContent ?? "")) return boot.textContent!;
  const status = document.querySelector("#data-status.error");
  if (status) return status.textContent ?? "error";
  const home = (window as unknown as { fsoHome?: { data: string; error: string } }).fsoHome;
  return home?.data === "missing" ? home.error : "";
}

/**
 * Waits until `ready(arg)` is truthy in the page (the function runs there: it can't use variables from the script, only
 * `arg`); throws with the page's message as soon as it shows an error.
 */
export async function waitReady<A>(page: Evaluator, ready: (arg: A) => unknown, timeout = 60_000, arg?: A): Promise<void> {
  const until = Date.now() + timeout;
  const probe = `[!!(${ready.toString()})(${JSON.stringify(arg) ?? ""}), (${bootError.toString()})()]`;
  for (;;) {
    const [ok, error] = ((await page.evaluate(probe).catch(() => [false, ""])) ?? [false, ""]) as [boolean, string];
    if (ok) return;
    if (error) throw new Error(`the page failed to start: ${error}`);
    if (Date.now() > until) throw new Error(`the page wasn't ready after ${timeout / 1000} s (${ready.toString()})`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Opens `url` and waits until `ready(arg)` holds. */
export async function openReady<A>(page: Navigator, url: string, ready: (arg: A) => unknown, timeout = 60_000, arg?: A): Promise<void> {
  await page.goto(url, { waitUntil: "load" });
  await waitReady(page, ready, timeout, arg);
}

/**
 * Shadow Battle: from a local match back to its menu the way a player goes, in real time: Esc (or the on-screen pause
 * button) opens the game's pause screen, then Choose an Area and Yes (apps/battle pause.ts). At a match's end Esc is
 * the results' Menu at once. `open`: how the pause is opened (a key press by default; a touch screen taps its button).
 */
export async function leaveMatch(page: Evaluator, open?: () => Promise<unknown>): Promise<void> {
  const mode = () => page.evaluate(`window.fso.mode`) as Promise<string>;
  if ((await mode()) === "menu") return;
  if (open) await open();
  else await page.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }))`);
  if ((await mode()) === "menu") return;
  await waitReady(page, () => !!(window as unknown as { fso: { pause: { state: unknown } } }).fso.pause.state, 5000);
  // The buttons lie see-through on the plate's items: a click on each, as a tap would do.
  await page.evaluate(`document.getElementById("pause-area").click()`);
  await waitReady(page, () => (window as unknown as { fso: { pause: { state: { phase: string } | null } } }).fso.pause.state?.phase === "confirm", 5000);
  await page.evaluate(`document.getElementById("pause-yes").click()`);
  await waitReady(page, () => (window as unknown as { fso: { mode: string } }).fso.mode === "menu", 5000);
}

/** The names at the root of the origin's private file system (OPFS): the pages store nothing there any more. */
export async function opfsEntries(page: Evaluator): Promise<string[]> {
  return (await page.evaluate(`(async () => {
    const names = [];
    if (!navigator.storage?.getDirectory) return names;
    for await (const name of (await navigator.storage.getDirectory()).keys()) names.push(name);
    return names;
  })()`)) as string[];
}
