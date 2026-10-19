import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detectFaces, isNeutral } from "../beauty";
import { applyBeautyAsync, decodePhotoAsync } from "../image-processing.js";
import { BEAUTY_KEYS, photoUrl } from "./utils";
import { createPhotoEngine } from "./photo-engine";
import { createDeferredWriter } from "../deferred-write.js";
import { createUploadedOriginals } from "./upload-photos.js";
import { fetchMediaBlob, storageLink } from "../media-delivery.js";
import { createBlobPrefetch } from "./blob-prefetch.js";

// Bộ nhớ đệm ảnh gốc, khuôn mặt và ảnh đã chỉnh để không xử lý lại.
export function usePhotoEngine(token, photos = []) {
  const mirroredPhotos = useRef(new Map());
  mirroredPhotos.current = new Map(photos.map((p) => [p.id, Boolean(p.mirrored)]));
  const printSources = useRef(new Set());
  printSources.current = new Set(photos.filter((p) => p.printSource).map((p) => p.id));
  const photoById = useRef(new Map());
  photoById.current = new Map(photos.map((p) => [p.id, p]));
  return useMemo(() => {
    const uploaded = createUploadedOriginals();
    const download = (id, kind, options = {}) => fetchMediaBlob(photoUrl(token, id, kind === "original" ? false : kind),
      { ...options, link: storageLink(photoById.current.get(id), kind) });
    // Print sources for the sheets being made, downloaded a few photos ahead (see Result).
    const printAhead = createBlobPrefetch((id, options) => download(id, "print", options));
    // Tải qua fetch để canvas không bị "tainted" khi API khác tên miền.
    const loadPhoto = async (id, kind = "original") => {
      let blob = kind !== "thumbnail" && uploaded.get(id);
      const localOriginal = Boolean(blob);
      if (!blob && kind === "print") {
        const ahead = printAhead.take(id);
        blob = ahead && await ahead.catch(() => undefined);
      }
      if (!blob) {
        blob = await download(id, kind);
        // Keep compressed remote originals too. Evicting a decoded 26 MP canvas
        // must not force another 15 MB download when the photo is used again.
        if (kind === "original") uploaded.remember(id, blob);
      }
      // The server makes thumbnail/preview/print copies already mirrored; only the
      // untouched camera original (or this device's own copy) is mirrored here.
      return decodePhotoAsync(blob, {
        edge: kind === "thumbnail" ? 640 : kind === "preview" ? 1600 : 0,
        mirrored: (kind === "original" || localOriginal) && mirroredPhotos.current.get(id),
      });
    };
    const engine = createPhotoEngine({
      loadOriginal: (id) => loadPhoto(id),
      loadThumbnail: (id) => loadPhoto(id, "thumbnail"),
      loadPreview: (id) => loadPhoto(id, "preview"),
      loadPrint: (id) => loadPhoto(id, "print"),
      hasPrintSource: (id) => printSources.current.has(id),
      detectFaces,
      applyBeauty: applyBeautyAsync,
      isNeutral,
      beautyKeys: BEAUTY_KEYS,
      createThumbnail: (c, size) => {
        const t = document.createElement("canvas");
        t.width = size;
        t.height = Math.round((c.height / c.width) * size);
        const ctx = t.getContext("2d");
        ctx.imageSmoothingQuality = "high"; // a smooth downscale, not jagged pixels
        ctx.drawImage(c, 0, 0, t.width, t.height);
        return t.toDataURL("image/jpeg", 0.88);
      },
    });
    // The exact camera file: this device's own upload, or downloaded once and kept.
    const originalFile = async (id) => {
      const local = uploaded.get(id);
      if (local) return local;
      const blob = await fetchMediaBlob(photoUrl(token, id),
        { link: storageLink(photoById.current.get(id), "original") });
      uploaded.remember(id, blob);
      return blob;
    };
    // Start downloading the print sources of these photos (in this order) a few at a time.
    const prefetchPrints = (ids) =>
      printAhead.prefetch(ids.filter((id) => printSources.current.has(id) && !uploaded.get(id)));
    return { ...engine, originalFile, prefetchPrints, cancelPrintPrefetch: () => printAhead.clear(),
      rememberUpload: (id, file) => uploaded.remember(id, file) };
  }, [token]);
}

export function useThumb(engine, id, size) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true;
    engine.thumb(id, size).then(
      (s) => live && setSrc(s),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [engine, id, size]);
  return src;
}

export function usePersistedState(key, initial) {
  const read = () => {
    try {
      return { ...initial, ...JSON.parse(localStorage.getItem(key)) };
    } catch {
      return initial;
    }
  };
  const [record, setRecord] = useState(() => ({ key, value: read() }));
  // A new album cannot inherit or persist the previous album's layout.
  const current = record.key === key ? record : { key, value: read() };
  if (current !== record) setRecord(current);
  const value = current.value;
  const writer = useMemo(() => createDeferredWriter((next) =>
    localStorage.setItem(key, JSON.stringify(next)),
  ), [key]);
  useEffect(() => {
    writer.schedule(value);
  }, [writer, value]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) writer.flush(); };
    window.addEventListener("pagehide", writer.flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      writer.flush();
      window.removeEventListener("pagehide", writer.flush);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [writer]);
  const setValue = useCallback((update) => setRecord((previous) =>
    previous.key !== key ? previous : {
      key, value: typeof update === "function" ? update(previous.value) : update,
    },
  ), [key]);
  return [value, setValue];
}
