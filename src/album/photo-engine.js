import { createCanvasCache } from "../canvas-cache.js";

// Chia sẻ kết quả đang xử lý; lỗi tạm thời phải được bỏ để lần sau có thể thử lại.
export function rememberPromise(cache, key, make) {
  if (!cache.has(key)) {
    const promise = Promise.resolve()
      .then(make)
      .catch((error) => {
        // Một lần thử cũ không được xóa lần thử mới sau khi khách bấm thử lại.
        if (cache.get(key) === promise) cache.delete(key);
        throw error;
      });
    cache.set(key, promise);
  }
  return cache.get(key);
}

export class FaceInferenceError extends Error {
  constructor(cause) {
    super("Chưa tải hoặc chạy được bộ nhận diện khuôn mặt. Hãy thử lại.", {
      cause,
    });
    this.name = "FaceInferenceError";
    this.code = "FACE_INFERENCE_FAILED";
  }
}

export class FaceNotFoundError extends Error {
  constructor() {
    super(
      "Không nhận diện được khuôn mặt. Thử lại hoặc đưa các chỉnh sửa da và khuôn mặt về 0%.",
    );
    this.name = "FaceNotFoundError";
    this.code = "FACE_NOT_FOUND";
  }
}

// Mỗi album có bộ nhớ riêng. Truyền các thao tác ảnh vào để kiểm tra được cả
// mất mạng, nhận diện lại và xuất ảnh mà không cần giả lập React hay canvas.
export function createPhotoEngine({
  loadOriginal,
  loadThumbnail,
  loadPreview,
  loadPrint,
  hasPrintSource = () => false,
  detectFaces,
  applyBeauty,
  isNeutral,
  beautyKeys,
  createThumbnail,
}) {
  const photos = createCanvasCache();
  const faces = new Map();
  const edits = createCanvasCache();
  const thumbs = new Map();
  const previews = createCanvasCache({ maxPixels: 8_000_000, maxEntries: 40 });
  const previewEdits = createCanvasCache({ maxPixels: 8_000_000, maxEntries: 24 });
  const previewFaces = new Map();
  // Print sources (3000 px): one or two at a time while a frame is painted.
  const prints = createCanvasCache({ maxPixels: 12_000_000, maxEntries: 2 });
  const printEdits = createCanvasCache({ maxPixels: 12_000_000, maxEntries: 2 });
  const printFaces = new Map();

  const original = (id) => photos.remember(id, () => loadOriginal(id));
  const previewOriginal = (id, edge = 1600) => !loadPreview ? original(id)
    : edge <= 640 && loadThumbnail
      ? previews.remember(id, () => loadThumbnail(id))
      : previews.remember(`preview:${id}`, () => loadPreview(id));
  const detect = async (source) => {
    try {
      const result = await detectFaces(source);
      if (!Array.isArray(result)) throw new Error("Kết quả nhận diện không hợp lệ.");
      return result;
    } catch (error) { throw new FaceInferenceError(error); }
  };
  const infer = (cache, id, sourceOf) => rememberPromise(cache, id,
    async () => detect(await sourceOf(id)));
  const previewFacesOf = (id) => rememberPromise(previewFaces, id, async () => {
    const source = await previewOriginal(id);
    return { faces: await detect(source), width: source.width, height: source.height };
  });
  const facesOf = (id) => infer(faces, id, original);
  const edited = (id, adjust) => {
    const discardPreviousEdits = (keep) => {
      for (const stored of edits.keys())
        if (stored.startsWith(`${id}:`) && stored !== keep) edits.delete(stored);
    };
    if (isNeutral(adjust)) {
      discardPreviousEdits();
      return original(id);
    }
    const key = `${id}:${JSON.stringify(adjust)}`;
    discardPreviousEdits(key);
    return edits.remember(key, async () => {
      const needsFace = beautyKeys.some((key) => adjust[key] > 0);
      const [source, landmarks] = await Promise.all([
        original(id),
        needsFace ? facesOf(id) : [],
      ]);
      // Khi chưa có mặt, không xuất ảnh và báo đã áp dụng hiệu ứng thực tế bị bỏ qua.
      if (needsFace && !landmarks.length) {
        // A small preview may have succeeded where full-source inference had a
        // transient miss. Let the next explicit export attempt infer again.
        if (loadPreview) faces.delete(id);
        throw new FaceNotFoundError();
      }
      return applyBeauty(source, landmarks, adjust);
    });
  };
  // Landmarks found on the editor preview, moved onto another size of the same photo.
  const scaleLandmarks = (detection, source) => detection ? detection.faces.map(face => face.map(point => ({
    ...point, x: point.x * source.width / detection.width,
    y: point.y * source.height / detection.height,
    ...(point.z !== undefined && { z: point.z * source.width / detection.width }),
  }))) : [];
  const preview = (id, adjust, edge = 1600) => {
    if (!loadPreview) return edited(id, adjust);
    const prefix = `${id}:${edge <= 640 ? "small" : "large"}:`;
    const key = `${prefix}${JSON.stringify(adjust)}`;
    for (const stored of previewEdits.keys())
      if (stored.startsWith(prefix) && stored !== key) previewEdits.delete(stored);
    if (isNeutral(adjust)) return previewOriginal(id, edge);
    return previewEdits.remember(key, async () => {
      const needsFace = beautyKeys.some(key => adjust[key] > 0);
      const [source, detection] = await Promise.all([
        previewOriginal(id, edge),
        needsFace ? previewFacesOf(id) : null,
      ]);
      // Detection returns pixel coordinates, not normalized points. Keep its
      // dimensions with the result, including old albums whose preview is 640px.
      const landmarks = scaleLandmarks(detection, source);
      if (needsFace && !landmarks.length) throw new FaceNotFoundError();
      return applyBeauty(source, landmarks, adjust);
    });
  };
  // Printing: the 3000 px print source holds every frame slot's pixels at a fraction of the
  // original's download and memory. Like full-source export, faces are detected on the very
  // source being printed rather than assumed from the preview. Photos without one use the original.
  const printable = (id) => Boolean(loadPrint) && hasPrintSource(id);
  const printSource = (id) => prints.remember(id, () => loadPrint(id));
  const printFacesOf = (id) => infer(printFaces, id, printSource);
  const printEdited = (id, adjust) => {
    if (!printable(id)) return edited(id, adjust);
    if (isNeutral(adjust)) return printSource(id);
    const key = `${id}:${JSON.stringify(adjust)}`;
    return printEdits.remember(key, async () => {
      const needsFace = beautyKeys.some((key) => adjust[key] > 0);
      const [source, landmarks] = await Promise.all([
        printSource(id),
        needsFace ? printFacesOf(id) : [],
      ]);
      if (needsFace && !landmarks.length) {
        // A transient miss must not stick: the next attempt detects again.
        printFaces.delete(id);
        throw new FaceNotFoundError();
      }
      return applyBeauty(source, landmarks, adjust);
    });
  };
  const releasePrint = (id) => {
    prints.delete(id);
    for (const key of printEdits.keys())
      if (key.startsWith(`${id}:`)) printEdits.delete(key);
  };
  const thumb = (id, size = 160) =>
    rememberPromise(thumbs, `${id}:${size}`, async () =>
      createThumbnail(await (loadThumbnail && size <= 640
        ? previews.remember(id, () => loadThumbnail(id))
        : original(id)), size),
    );
  const retryFaces = (id) => {
    faces.delete(id);
    previewFaces.delete(id);
    for (const key of edits.keys())
      if (key.startsWith(`${id}:`)) edits.delete(key);
    for (const key of previewEdits.keys())
      if (key.startsWith(`${id}:`)) previewEdits.delete(key);
    for (const key of printEdits.keys())
      if (key.startsWith(`${id}:`)) printEdits.delete(key);
    printFaces.delete(id);
  };
  const releaseFull = (id) => {
    photos.delete(id);
    for (const key of edits.keys())
      if (key.startsWith(`${id}:`)) edits.delete(key);
  };
  return {
    original, facesOf, edited, previewOriginal, preview, thumb, retryFaces, releaseFull,
    hasPrintSource: printable, printEdited, releasePrint,
  };
}
