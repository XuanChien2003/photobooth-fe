// Chỉ cắt vùng xem HDMI; ảnh JPEG nhận từ máy ảnh không đi qua bước này.
const TOP = 0.08;
const BOTTOM = 0.12;

export function livePreviewLayout(sourceWidth, sourceHeight, width, height) {
  if (
    ![sourceWidth, sourceHeight, width, height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return null;

  const visibleHeight = sourceHeight * (1 - TOP - BOTTOM);
  const scale = Math.max(width / sourceWidth, height / visibleHeight);
  return {
    width: sourceWidth * scale,
    height: sourceHeight * scale,
    left: (width - sourceWidth * scale) / 2,
    top: (height - visibleHeight * scale) / 2 - sourceHeight * TOP * scale,
  };
}
