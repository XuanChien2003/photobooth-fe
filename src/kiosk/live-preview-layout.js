// Chỉ cắt vùng xem HDMI; ảnh JPEG nhận từ máy ảnh không đi qua bước này.
// Máy ảnh xuất kèm thông số (thước phơi sáng, khung lưới) ở các mép hình HDMI: cắt bỏ các mép
// đó. `zoom` (0–0,3) là phần cắt thêm ở mỗi cạnh do nhân viên chỉnh trong Cài đặt máy chụp.
const TOP = 0.08;
const BOTTOM = 0.12;
export const CROP_KEY = "hdmi-crop";
export const DEFAULT_CROP = 0.08;

export const readCrop = () => {
  const value = Number(globalThis.localStorage?.getItem(CROP_KEY));
  return Number.isFinite(value) && value >= 0 && value <= 0.3
    ? value
    : DEFAULT_CROP;
};

// Vùng còn thấy được của khung hình nguồn (tỉ lệ 0–1 theo chiều ngang / dọc).
export function visibleRegion(zoom = 0) {
  const side = Math.max(0, Math.min(0.3, zoom));
  const top = Math.max(TOP, side);
  const bottom = Math.max(BOTTOM, side);
  return { x: side, y: top, w: 1 - side * 2, h: 1 - top - bottom };
}

export function livePreviewLayout(sourceWidth, sourceHeight, width, height, zoom = 0) {
  if (
    ![sourceWidth, sourceHeight, width, height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return null;

  const region = visibleRegion(zoom);
  const visibleWidth = sourceWidth * region.w;
  const visibleHeight = sourceHeight * region.h;
  const scale = Math.max(width / visibleWidth, height / visibleHeight);
  return {
    width: sourceWidth * scale,
    height: sourceHeight * scale,
    left: (width - visibleWidth * scale) / 2 - sourceWidth * region.x * scale,
    top: (height - visibleHeight * scale) / 2 - sourceHeight * region.y * scale,
  };
}
