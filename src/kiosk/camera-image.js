import { createImageCanvas } from "../image-canvas.js";

// This is only the kiosk preview. The untouched JPEG is uploaded separately.
const MAX_PREVIEW_EDGE = 1600;
export async function prepareCameraImage(file, mirror) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  let canvas;
  try {
    const scale = Math.min(1, MAX_PREVIEW_EDGE / Math.max(bitmap.width, bitmap.height));
    canvas = createImageCanvas(
      Math.round(bitmap.width * scale), Math.round(bitmap.height * scale),
    );
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    if (mirror) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (canvas.convertToBlob)
      return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
    return await new Promise((resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Không tạo được ảnh từ máy ảnh.")),
      "image/jpeg", 0.92,
    ));
  } finally {
    bitmap.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
}
