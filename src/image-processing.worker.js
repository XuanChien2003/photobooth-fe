import { applyBeauty } from "./beauty-render.js";
import { prepareCameraImage } from "./kiosk/camera-image.js";
import { decodePhoto } from "./decode-photo.js";

self.onmessage = async ({ data: { id, task, source, ...options } }) => {
  let output;
  try {
    if (typeof OffscreenCanvas === "undefined" || !new OffscreenCanvas(1, 1).getContext("2d"))
      throw Object.assign(new Error("Offscreen canvas unavailable"), { code: "IMAGE_WORKER_UNAVAILABLE" });
    if (task === "camera") {
      const result = await prepareCameraImage(options.file, options.mirror);
      self.postMessage({ id, result });
    } else if (task === "beauty" || task === "photo") {
      output = task === "photo" ? await decodePhoto(options.file, options)
        : applyBeauty(source, options.faces, options.adjust);
      const result = output.transferToImageBitmap();
      self.postMessage({ id, result }, [result]);
    } else throw new Error("Unknown image task");
  } catch (error) {
    self.postMessage({ id, error: { message: error.message, code: error.code } });
  } finally {
    source?.close();
    if (output) output.width = output.height = 0;
  }
};
