// Bound decoded pixels, not JPEG file size: one 12 MP canvas occupies ~48 MB.
// Eviction only drops cache references; canvases currently displayed/exported stay valid.
export function createCanvasCache({ maxPixels = 24_000_000, maxEntries = 12 } = {}) {
  const entries = new Map();
  const costs = new Map();
  const remove = (key) => { costs.delete(key); entries.delete(key); };
  const prune = (keep) => {
    let pixels = [...costs.values()].reduce((sum, size) => sum + size, 0);
    for (const key of entries.keys()) {
      if (pixels <= maxPixels && costs.size <= maxEntries) break;
      // Do not evict in-flight requests or the single current oversized image.
      if (key === keep || !costs.has(key)) continue;
      pixels -= costs.get(key);
      remove(key);
    }
  };
  return {
    keys: () => entries.keys(),
    delete: remove,
    remember(key, make) {
      if (entries.has(key)) {
        const promise = entries.get(key);
        entries.delete(key);
        entries.set(key, promise);
        return promise;
      }
      const promise = Promise.resolve().then(make).then((image) => {
        if (entries.get(key) === promise) {
          costs.set(key, (image.naturalWidth || image.width || 0) *
            (image.naturalHeight || image.height || 0));
          prune(key);
        }
        return image;
      }).catch((error) => {
        if (entries.get(key) === promise) remove(key);
        throw error;
      });
      entries.set(key, promise);
      return promise;
    },
  };
}
