import { createImageCanvas } from "./image-canvas.js";

// Display copies have a bounded edge. A zero edge decodes the full camera file
// for download/print; default browser colour conversion and EXIF orientation
// are retained in both paths.
export async function decodePhoto(file, { edge = 0, mirrored = false } = {}) {
  let source, url;
  try {
    if (typeof createImageBitmap === "function")
      source = await createImageBitmap(file, { imageOrientation: "from-image" });
    else {
      url = URL.createObjectURL(file);
      source = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Không đọc được ảnh."));
        image.src = url;
      });
    }
    const width = source.naturalWidth || source.width;
    const height = source.naturalHeight || source.height;
    const scale = edge > 0 ? Math.min(1, edge / Math.max(width, height)) : 1;
    const canvas = createImageCanvas(Math.round(width * scale), Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    if (mirrored) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    source?.close?.();
    if (url) URL.revokeObjectURL(url);
  }
}
