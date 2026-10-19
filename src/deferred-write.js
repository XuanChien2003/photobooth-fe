// Keep drag/zoom updates in memory and serialize only after a pause, at a bounded
// interval during long gestures, or when the page is hidden/closed.
export function createDeferredWriter(write, {
  delay = 250, maxWait = 1000, setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  let pending;
  let written;
  let dirty = false;
  let quietTimer;
  let maximumTimer;
  const clear = () => {
    clearTimer(quietTimer);
    clearTimer(maximumTimer);
    quietTimer = maximumTimer = undefined;
  };
  const flush = () => {
    clear();
    if (!dirty) return;
    try {
      write(pending);
      written = pending;
      dirty = false;
    } catch { /* Storage can be unavailable/full; keep the current UI usable. */ }
  };
  return {
    schedule(value) {
      if (!dirty && value === written) return;
      pending = value;
      dirty = true;
      clearTimer(quietTimer);
      quietTimer = setTimer(flush, delay);
      maximumTimer ??= setTimer(flush, maxWait);
    },
    flush,
  };
}
