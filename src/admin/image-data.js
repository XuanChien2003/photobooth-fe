// Thu nhỏ ảnh trước khi lưu vào DB (ảnh nền ≤ 1920 px JPEG, sticker ≤ 512 px PNG giữ nền trong suốt).
export async function imageData(file, maxEdge, type, quality) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL(type, quality);
}

// Đọc nguyên tệp (GIF động không thu nhỏ được bằng canvas mà không mất chuyển động).
export const fileData = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
