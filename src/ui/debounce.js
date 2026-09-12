// Generic debounce. No DOM here: a plain higher-order function over
// setTimeout, which is what keeps it unit-testable with node:test's mock
// timers instead of needing a browser.

/**
 * Wrap `fn` so a burst of calls collapses into one, run `waitMs` after the
 * last call in the burst.
 *
 * The returned wrapper also carries `.flush()`, which runs any pending call
 * immediately. That matters wherever a caller is about to read state that the
 * debounced call would otherwise still be sitting on (for example, copying a
 * share link before the debounced URL-hash write has actually fired).
 */
export function debounce(fn, waitMs) {
  let timer = null;
  let pendingArgs = null;

  function runPending() {
    timer = null;
    const args = pendingArgs;
    pendingArgs = null;
    fn(...args);
  }

  function wrapped(...args) {
    pendingArgs = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(runPending, waitMs);
  }

  wrapped.flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    runPending();
  };

  return wrapped;
}
