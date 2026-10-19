// Giữ tỉ lệ ảnh và căn giữa trong vùng đích; "cover" phủ kín, "contain" giữ đủ ảnh.
export function imageRect(
  sourceWidth,
  sourceHeight,
  targetWidth,
  targetHeight,
  fit = "contain",
) {
  if (
    ![sourceWidth, sourceHeight, targetWidth, targetHeight].every(
      (size) => Number.isFinite(size) && size > 0,
    )
  ) {
    throw new RangeError("Kích thước ảnh và vùng đích phải lớn hơn 0.");
  }
  const scale = (fit === "cover" ? Math.max : Math.min)(
    targetWidth / sourceWidth,
    targetHeight / sourceHeight,
  );
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
}
