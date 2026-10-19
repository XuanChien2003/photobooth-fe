// Share only a request that is still running, never a saved API response.
// Each subscriber can cancel without cancelling another screen's request.
export function createSharedReads() {
  const pending = new Map();
  const cancelled = () => new DOMException("Request aborted", "AbortError");
  return {
    invalidate() {
      pending.clear();
    },
    run(key, signal, start) {
      if (signal?.aborted) return Promise.reject(cancelled());
      let entry = pending.get(key);
      if (!entry) {
        const controller = new AbortController();
        entry = { controller, subscribers: 0, timer: null };
        entry.promise = Promise.resolve().then(() => start(controller.signal));
        pending.set(key, entry);
        const release = () => {
          if (pending.get(key) === entry) pending.delete(key);
          clearTimeout(entry.timer);
        };
        entry.promise.then(release, release);
      }
      clearTimeout(entry.timer);
      entry.subscribers++;
      return new Promise((resolve, reject) => {
        let finished = false;
        const finish = (callback, value) => {
          if (finished) return;
          finished = true;
          signal?.removeEventListener("abort", abort);
          entry.subscribers--;
          callback(value);
        };
        const abort = () => {
          finish(reject, cancelled());
          if (!entry.subscribers) {
            // React may immediately subscribe again during its effect check.
            entry.timer = setTimeout(() => {
              if (entry.subscribers) return;
              if (pending.get(key) === entry) pending.delete(key);
              entry.controller.abort();
            }, 0);
          }
        };
        signal?.addEventListener("abort", abort, { once: true });
        entry.promise.then(
          (value) => finish(resolve, value),
          (error) => finish(reject, error),
        );
      });
    },
  };
}
