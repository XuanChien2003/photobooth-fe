// A theme can contain several frames; every slot across the set counts.
export function packCapacity(pack) {
  return (pack?.frames || []).reduce(
    (total, frame) => total + (frame.slots?.length || 0),
    0,
  );
}

// Hearts are a shortlist, independent of frame capacity. Other originals are
// eligible for automatic filling only after the guest explicitly chooses it.
export function compositionPhotos(photos, { includeOthers = false } = {}) {
  const originals = photos.filter((photo) => photo.kind === "original");
  const favorites = originals.filter((photo) => photo.favorite);
  return includeOthers
    ? [...favorites, ...originals.filter((photo) => !photo.favorite)]
    : favorites;
}
