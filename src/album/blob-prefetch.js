// Downloads the next few photos while the current one is decoded and painted, so a print with
// many slots is not "download, decode, paint, then start the next download". At most `ahead`
// photos are downloaded but not yet used, which keeps a phone's memory bounded; a prefetch that
// fails is simply dropped and the photo is fetched again when it is needed.
export function createBlobPrefetch(fetchBlob, { ahead = 3 } = {}) {
  const queue = [];
  const entries = new Map(); // key -> { promise, controller }; started and not yet taken
  const pump = () => {
    while (entries.size < ahead && queue.length) {
      const key = queue.shift();
      if (entries.has(key)) continue;
      const controller = new AbortController();
      let promise;
      try { promise = Promise.resolve(fetchBlob(key, { signal: controller.signal })); }
      catch (error) { promise = Promise.reject(error); }
      const entry = { promise, controller };
      entries.set(key, entry);
      promise.catch(() => {
        if (entries.get(key) === entry) {
          entries.delete(key);
          pump();
        }
      });
    }
  };
  return {
    // Replaces any earlier plan: only these keys, in this order.
    prefetch(keys) {
      queue.length = 0;
      const wanted = new Set(keys);
      // Leaving the result screen or choosing another set must release downloads
      // from the old plan, otherwise they hold every prefetch slot indefinitely.
      for (const [key, entry] of entries) {
        if (wanted.has(key)) continue;
        entries.delete(key);
        entry.controller.abort();
      }
      for (const key of wanted) if (!entries.has(key)) queue.push(key);
      pump();
    },
    // The prefetched download for this key (or undefined), handed over once.
    take(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      pump();
      return entry.promise;
    },
    clear() {
      queue.length = 0;
      const obsolete = [...entries.values()];
      entries.clear();
      for (const entry of obsolete) entry.controller.abort();
    },
  };
}
