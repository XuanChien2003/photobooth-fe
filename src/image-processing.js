import { applyBeauty } from "./beauty-render.js";
import { prepareCameraImage } from "./kiosk/camera-image.js";
import { decodePhoto } from "./decode-photo.js";

let worker;
let unavailable = false;
let sequence = 0;
let queue = Promise.resolve();
const pending = new Map();
const workerError = () => Object.assign(new Error("Image worker unavailable"), {
  code: "IMAGE_WORKER_UNAVAILABLE",
});
function stopWorker() {
  unavailable = true;
  worker?.terminate();
  worker = null;
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(workerError());
  }
  pending.clear();
}
function getWorker() {
  if (unavailable || typeof Worker === "undefined" ||
      typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined" ||
      typeof OffscreenCanvas.prototype.convertToBlob !== "function" ||
      typeof OffscreenCanvas.prototype.transferToImageBitmap !== "function")
    throw workerError();
  if (!worker) {
    try {
      worker = new Worker(new URL("./image-processing.worker.js", import.meta.url), {
        type: "module",
      });
      worker.onmessage = ({ data }) => {
        const request = pending.get(data.id);
        if (!request) { data.result?.close?.(); return; }
        pending.delete(data.id);
        clearTimeout(request.timer);
        if (data.error) {
          const error = Object.assign(new Error(data.error.message), { code: data.error.code });
          request.reject(error);
          if (error.code === "IMAGE_WORKER_UNAVAILABLE") stopWorker();
        } else request.resolve(data.result);
      };
      worker.onerror = (event) => { event.preventDefault(); stopWorker(); };
      worker.onmessageerror = stopWorker;
    } catch { stopWorker(); throw workerError(); }
  }
  return worker;
}

// One full-size image at a time. Create transferable bitmaps inside the queue,
// so a frame containing many photos does not allocate them all at once.
function run(task, makeInput, fallback) {
  const result = queue.then(async () => {
    try {
      const active = getWorker();
      const { input, transfer = [] } = await makeInput();
      if (unavailable || active !== worker) {
        for (const value of transfer) value.close?.();
        throw workerError();
      }
      return await new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(stopWorker, 60000);
        pending.set(id, { resolve, reject, timer });
        try { active.postMessage({ id, task, ...input }, transfer); }
        catch {
          for (const value of transfer) value.close?.();
          stopWorker();
        }
      });
    } catch (error) {
      if (error.code !== "IMAGE_WORKER_UNAVAILABLE") throw error;
      return fallback();
    }
  });
  queue = result.catch(() => {});
  return result;
}

export function prepareCameraImageAsync(file, mirror) {
  return run("camera", () => ({ input: { file, mirror } }),
    () => prepareCameraImage(file, mirror));
}

function canvasFromBitmap(result) {
  if (typeof ImageBitmap === "undefined" || !(result instanceof ImageBitmap)) return result;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = result.width;
    canvas.height = result.height;
    canvas.getContext("2d").drawImage(result, 0, 0);
    return canvas;
  } finally { result.close(); }
}

export async function decodePhotoAsync(file, options = {}) {
  return canvasFromBitmap(await run("photo", () => ({ input: { file, ...options } }),
    () => decodePhoto(file, options)));
}

export async function applyBeautyAsync(source, faces, adjust) {
  const result = await run("beauty", async () => {
    const bitmap = await createImageBitmap(source);
    return { input: { source: bitmap, faces, adjust }, transfer: [bitmap] };
  }, () => applyBeauty(source, faces, adjust));
  return canvasFromBitmap(result);
}
