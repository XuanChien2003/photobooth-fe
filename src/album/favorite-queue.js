// Keep quick heart taps responsive, but save complete selections in order.
// While a request is running, only the latest selection needs another PUT.
export function createFavoriteQueue({ save, onSaved, onError, onPending }) {
  let pending = null;
  let confirmed = [];
  let running = false;
  let disposed = false;
  let drain = Promise.resolve();

  async function flush() {
    try {
      while (pending !== null) {
        const ids = pending;
        pending = null;
        try {
          const result = await save(ids);
          confirmed = ids;
          if (!disposed) onSaved(result, pending === null);
        } catch (error) {
          if (!disposed) onError(error, pending === null ? confirmed : null);
        }
      }
    } finally {
      running = false;
      if (!disposed) onPending(false);
    }
  }

  return {
    enqueue(ids, currentIds) {
      if (disposed) return drain;
      pending = [...ids];
      if (!running) {
        confirmed = [...currentIds];
        running = true;
        onPending(true);
        drain = Promise.resolve().then(flush);
      }
      return drain;
    },
    whenIdle: () => drain,
    isPending: () => running,
    activate() {
      disposed = false;
    },
    dispose() {
      disposed = true;
      pending = null;
    },
  };
}
