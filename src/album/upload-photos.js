// Keep one file transmitting while the server finishes saving the previous one.
// Two requests bound memory/network use on phones; stop scheduling on failure
// and wait for requests already sent before unlocking album mutations.
export async function uploadPhotos(files, { upload, onSaved }) {
  let cursor = 0, done = 0, error;
  const worker = async () => {
    while (!error && cursor < files.length) {
      const index = cursor++;
      try {
        const next = await upload(files[index], index);
        onSaved(next, files[index]);
        done++;
      } catch (failure) {
        error ||= failure;
      }
    }
  };
  // Large originals stay sequential to avoid doubling phone/server memory use.
  const concurrency = files.some(file => file.size > 12 * 1024 * 1024) ? 1 : 2;
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return { done, error };
}

// Responses can arrive in a different order. Add confirmed photos without
// dropping later confirmations or overwriting print quotas/favorites elsewhere.
export function mergeUploadedPhotos(current, response) {
  const photos = new Map(current.photos.map(photo => [photo.id, photo]));
  for (const photo of response.photos) {
    const known = photos.get(photo.id);
    if (!known) photos.set(photo.id, photo);
    // Numbers come from the server: filling the gap a deleted photo left renumbers later ones.
    else if (photo.number && known.number !== photo.number) photos.set(photo.id, { ...known, number: photo.number });
  }
  const expiries = [current.mediaExpiresAt, response.mediaExpiresAt].filter(Boolean);
  return {
    ...current,
    photos: [...photos.values()].sort((a, b) => a.number - b.number),
    ...(expiries.length && { mediaExpiresAt: expiries.sort()[0] }),
    mediaDeleted: false,
  };
}

// Retain compressed JPEG files, not full-size canvases, so opening an uploaded
// camera/phone photo doesn't download it again. Eviction falls back to the API.
export function createUploadedOriginals({ maxBytes = 64 * 1024 * 1024, maxEntries = 12 } = {}) {
  const files = new Map();
  let bytes = 0;
  return {
    remember(id, file) {
      if (file.type !== "image/jpeg" || file.size > maxBytes) return;
      const previous = files.get(id);
      if (previous) bytes -= previous.size;
      files.delete(id);
      files.set(id, file);
      bytes += file.size;
      for (const [key, stored] of files) {
        if (bytes <= maxBytes && files.size <= maxEntries) break;
        bytes -= stored.size;
        files.delete(key);
      }
    },
    get(id) {
      const file = files.get(id);
      if (file) { files.delete(id); files.set(id, file); }
      return file;
    },
  };
}
