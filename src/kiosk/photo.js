// Keep the camera's JPEG bytes for editing and printing. Only the kiosk preview
// is resized and mirrored, so the full-resolution capture never gets re-encoded.
import { prepareCameraImageAsync } from "../image-processing.js";

const sha1 = async (text) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export async function prepareCameraPhoto(file, path, isMirrored) {
  const mirrored = Boolean(isMirrored());
  // The capture app may overwrite the same path while the browser is reading it.
  // Snapshot the bytes once and derive the preview from that exact snapshot.
  const image = new Blob([await file.arrayBuffer()], { type: "image/jpeg" });
  const preview = await prepareCameraImageAsync(image, mirrored);
  // Mã cố định theo tệp: tải lại trang / đọc lại thư mục không bị trùng ảnh.
  const id =
    "camera-" + (await sha1(`${path}:${file.size}:${file.lastModified}`));
  return { id, image, preview, mirrored };
}
