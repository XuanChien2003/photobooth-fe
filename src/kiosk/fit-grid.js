// Lưới ảnh vừa khít khung: chọn số cột để ảnh to nhất mà vẫn thấy hết mọi ảnh, không phải cuộn
// (vd. 12 ảnh trong khung 900 × 560 px: 4 cột × 3 hàng, ảnh rộng ~216 px thay vì 6 cột ~150 px).
// width / height: chỗ trống của lưới (không tính padding). aspect: tỉ lệ ảnh (ngang / dọc).
// frame: phần viền của ô quanh ảnh (cả hai bên). Ảnh nhỏ hơn `min` (quá nhiều ảnh) thì giữ ảnh đủ to
// để bấm và cho cuộn (scroll: true).
export function fitGrid(width, height, count, { aspect = 3 / 2, gap = 12, frame = 8, min = 120, maxCols = 8 } = {}) {
  if (!(width > 0) || !(height > 0) || !(count > 0)) return null;
  let best = null;
  for (let cols = 1; cols <= Math.min(count, maxCols); cols++) {
    const rows = Math.ceil(count / cols);
    const byWidth = (width - gap * (cols - 1)) / cols;
    const byHeight = ((height - gap * (rows - 1)) / rows - frame) * aspect + frame;
    const size = Math.floor(Math.min(byWidth, byHeight));
    if (!best || size > best.size) best = { cols, size, scroll: false };
  }
  if (best.size >= min) return best;
  const cols = Math.max(1, Math.min(maxCols, Math.floor((width + gap) / (min + gap))));
  return { cols, size: Math.floor((width - gap * (cols - 1)) / cols), scroll: true };
}
