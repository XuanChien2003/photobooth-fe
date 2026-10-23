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

// Mã cố định theo tệp: tải lại trang / đọc lại thư mục không bị trùng ảnh. Chỉ cần tên, kích thước
// và giờ ghi tệp nên kiểm tra được ảnh đã nhận trước khi đọc 15 MB của tệp.
export const cameraPhotoId = async (file, path) =>
  "camera-" + (await sha1(`${path}:${file.size}:${file.lastModified}`));

export async function prepareCameraPhoto(file, path, isMirrored) {
  const mirrored = Boolean(isMirrored());
  // The capture app may overwrite the same path while the browser is reading it.
  // Snapshot the bytes once and derive the preview from that exact snapshot.
  const image = new Blob([await file.arrayBuffer()], { type: "image/jpeg" });
  const preview = await prepareCameraImageAsync(image, mirrored);
  const id = await cameraPhotoId(file, path);
  return { id, image, preview, mirrored };
}
