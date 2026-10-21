import { getApiUrl } from "../api";
import { ADJUST_LABELS } from "../beauty";
import { DEFAULT_TRANSFORM } from "../frame-utils";

export const BEAUTY_KEYS = Object.keys(ADJUST_LABELS);

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const pad = (n) => String(n).padStart(2, "0");

// size: false = ảnh gốc của máy ảnh; true / "thumbnail"; "preview" (chỉnh ảnh); "print" (nguồn in).
export const photoUrl = (token, id, size = false) =>
  getApiUrl(
    `/api/albums/${token}/photos/${id}${size ? `?size=${["preview", "print"].includes(size) ? size : "thumbnail"}` : ""}`,
  );

export const hitSlot = (slots, p) =>
  slots.findIndex(
    (s) => p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h,
  );

const imageExports = new WeakMap();

// Chỉ dùng với canvas thành phẩm không bị vẽ lại. Canvas xem trước của editor
// thay đổi theo thanh trượt nên không được đưa vào bộ nhớ đệm này.
export function prepareImage(canvas) {
  if (!imageExports.has(canvas)) {
    const promise = new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("máy không đủ bộ nhớ để tạo ảnh, hãy thử lại"));
        },
        "image/jpeg",
        0.95,
      );
    }).catch((error) => {
      if (imageExports.get(canvas) === promise) imageExports.delete(canvas);
      throw error;
    });
    imageExports.set(canvas, promise);
  }
  return imageExports.get(canvas);
}

// Lưu ảnh về máy: điện thoại dùng bảng chia sẻ (có "Lưu ảnh"), máy tính tải file.
export async function saveImage(canvas, name) {
  return saveBlob(await prepareImage(canvas), name);
}

export async function saveBlob(blob, name) {
  const file = new File([blob], name, { type: blob.type || "image/jpeg" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return "shared";
    }
  } catch (e) {
    if (e.name === "AbortError") return "cancelled";
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "downloaded";
}

export const ACCEPTED_IMAGES = /^image\/(jpeg|png|webp)$/;

export const MAX_UPLOAD_MB = 40;

// Fill across the whole set without silently repeating a short selection.
// Repetition is reserved for the explicit automatic-fill confirmation.
export function autoLayouts(frames, photos, { repeat = false } = {}) {
  let k = 0;
  return Object.fromEntries(
    frames.map((f) => [
      f._id,
      f.slots.map(() => ({
        photo: photos[repeat ? k++ % photos.length : k++]?.id || null,
        ...DEFAULT_TRANSFORM,
      })),
    ]),
  );
}

export const isFilled = (frame, slots) =>
  slots?.length === frame.slots.length && slots.every((s) => s.photo);
