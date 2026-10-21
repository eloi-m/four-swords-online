// Fixed 60 Hz ticks driven from a worker timer: requestAnimationFrame stops in hidden tabs and page timers get
// throttled to 1 Hz there, but a match has to keep ticking (the other players wait on our inputs). Rendering stays
// on requestAnimationFrame. Used by apps/netplay and apps/battle's online mode.
export const TICK_MS = 1000 / 60;

/** Calls `poll` on every timer message (~4 ms) and `tick` once per elapsed 1/60 s. Returns a stop function. */
export function startTicker(tick: () => void, poll: () => void = () => {}): () => void {
  const source = "const t = setInterval(() => postMessage(0), 4); onmessage = () => clearInterval(t);";
  const worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
  let last = performance.now(), acc = 0;
  worker.onmessage = () => {
    poll();
    const now = performance.now();
    acc += Math.min(now - last, 250); // after a long freeze, don't try to catch up by more than 15 frames
    last = now;
    while (acc >= TICK_MS) {
      acc -= TICK_MS;
      tick();
    }
  };
  return () => worker.terminate();
}
