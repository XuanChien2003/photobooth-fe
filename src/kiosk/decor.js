import {
  COLOR_FILTERS,
  CUSTOM_FILTER,
  FILTER_CSS,
  customCss,
  filterRegion,
  filterSteps,
} from "../beauty-render.js";
import {
  decorationBox,
  decorationsReady,
  drawDecorations,
  preloadDecorations,
} from "../album/decorations.js";
import { photoLayout, slotRect } from "../frame-utils.js";

// Trang trí trên màn chọn ảnh của máy chụp: một màu ảnh (filter) cho mọi ảnh trong khung và các
// nhãn dán trên khung. Ảnh xem trước, ảnh ghép trong album và ảnh in vẽ bằng cùng các hàm này.
export const NO_DECOR = Object.freeze({ filter: "original", stickers: Object.freeze([]) });
export const MAX_STICKERS = 20;
// Cỡ nhãn dán: chiều cao so với bề rộng vùng đặt nhãn dán.
export const STICKER_SCALE = Object.freeze({ initial: 0.2, min: 0.06, max: 0.45, step: 1.2 });
export const clampScale = (scale) =>
  Math.max(STICKER_SCALE.min, Math.min(STICKER_SCALE.max, Number(scale) || STICKER_SCALE.initial));

// Màu ảnh khách chọn được: "Gốc", filter tiệm tự tạo đang kích hoạt, rồi bộ lọc có sẵn đang bật
// (Thiết lập → Quản lý filter). steps: công thức màu (null = giữ ảnh gốc).
export function filterChoices(settings = {}) {
  const enabled = settings.enabledFilters?.length ? settings.enabledFilters : Object.keys(COLOR_FILTERS);
  const builtIn = (id) => ({
    id,
    label: COLOR_FILTERS[id],
    css: FILTER_CSS[id] || "none",
    steps: filterSteps({ filter: id }) || null,
  });
  return [
    builtIn("original"),
    ...(settings.customFilters || [])
      .filter((f) => f.active !== false && f.id && f.name)
      .map((f) => {
        const steps = filterSteps({ filter: CUSTOM_FILTER + f.id, custom: f });
        return { id: CUSTOM_FILTER + f.id, label: f.name, css: customCss(f), steps: steps.length ? steps : null };
      }),
    ...Object.keys(COLOR_FILTERS)
      .filter((id) => id !== "original" && enabled.includes(id))
      .map(builtIn),
  ];
}
// Công thức màu của filter khách đã chọn (filter vừa bị tắt / xóa: giữ ảnh gốc).
export const filterStepsFor = (id, settings) =>
  filterChoices(settings).find((choice) => choice.id === id)?.steps || null;

// Màu ảnh chỉ áp lên các ô ảnh (kể cả ô bản sao): nền khung, mã QR và nhãn dán giữ nguyên màu.
export function filterPhotos(ctx, frame, steps, width, height) {
  if (!steps?.length) return;
  const layout = photoLayout(frame);
  for (const slot of [...layout.slots, ...layout.copies.map((copy) => copy.slot)]) {
    const r = slotRect(slot, width, height);
    filterRegion(ctx, r.x, r.y, r.w, r.h, steps);
  }
}

// Vùng đặt nhãn dán (tỉ lệ 0–1 của khung). Khung có mỗi ô một bản sao lệch đều nhau (khung nhỏ:
// 2 dải giống nhau trên một tờ, máy in cắt đôi) chỉ đặt nhãn dán trên dải đầu; nhãn dán tự lặp
// sang dải kia (shift) để hai tờ cắt ra giống nhau.
export function stickerArea(frame) {
  const whole = { x: 0, y: 0, w: 1, h: 1, shift: null };
  const layout = photoLayout(frame);
  const { slots, copies } = layout;
  if (!copies.length || copies.length !== slots.length || new Set(copies.map((c) => c.of)).size !== slots.length)
    return whole;
  const shifts = copies.map((c) => ({ dx: c.slot.x - slots[c.of].x, dy: c.slot.y - slots[c.of].y }));
  const dx = shifts.reduce((sum, s) => sum + s.dx, 0) / shifts.length;
  const dy = shifts.reduce((sum, s) => sum + s.dy, 0) / shifts.length;
  if (shifts.some((s) => Math.abs(s.dx - dx) > 0.02 || Math.abs(s.dy - dy) > 0.02)) return whole;
  const across = Math.abs(dx) >= 0.1,
    down = Math.abs(dy) >= 0.1;
  if (!across && !down) return whole;
  return {
    x: across && dx < 0 ? 1 - Math.abs(dx) : 0,
    y: down && dy < 0 ? 1 - Math.abs(dy) : 0,
    w: across ? Math.abs(dx) : 1,
    h: down ? Math.abs(dy) : 1,
    shift: { dx, dy },
  };
}

// Nhãn dán lưu theo vùng đặt: { id, src (ảnh của tiệm) | text (biểu tượng), u, v (tâm, 0–1 trong
// vùng), scale }. Đổi sang mục trang trí của decorations.js (tọa độ theo cả khung, cỡ theo khung
// rộng 1200 px: ảnh cao size × 1,6, biểu tượng cao bằng cỡ chữ); index: vị trí trong danh sách.
export function placedStickers(stickers = [], area) {
  const placed = [];
  stickers.forEach((sticker, index) => {
    const scale = clampScale(sticker.scale);
    const item = {
      type: "sticker",
      ...(sticker.src ? { src: sticker.src } : { text: sticker.text }),
      size: (sticker.src ? 750 : 1200) * scale * area.w,
      x: area.x + Math.max(0, Math.min(1, sticker.u)) * area.w,
      y: area.y + Math.max(0, Math.min(1, sticker.v)) * area.h,
      index,
    };
    placed.push(item);
    if (area.shift) placed.push({ ...item, x: item.x + area.shift.dx, y: item.y + area.shift.dy, copy: true });
  });
  return placed;
}
export function drawStickers(ctx, stickers, area, width, height) {
  if (stickers?.length) drawDecorations(ctx, placedStickers(stickers, area), width, height);
}
// Nhãn dán ở điểm chạm (px trên canvas); nhãn dán vẽ sau nằm trên nên được chọn trước.
export function hitSticker(ctx, stickers, area, x, y, width, height) {
  const placed = placedStickers(stickers, area);
  for (let i = placed.length - 1; i >= 0; i--) {
    const box = decorationBox(ctx, placed[i], width, height);
    // Nới vùng chạm một chút cho dễ chạm trên màn cảm ứng.
    const pad = Math.max(6, Math.min(box.w, box.h) * 0.15);
    if (x >= box.x - pad && x <= box.x + box.w + pad && y >= box.y - pad && y <= box.y + box.h + pad)
      return placed[i].index;
  }
  return -1;
}
// Khung bao (px) của một nhãn dán, cả bản lặp ở dải thứ hai.
export const stickerBoxes = (ctx, stickers, area, index, width, height) =>
  placedStickers(stickers, area)
    .filter((item) => item.index === index)
    .map((item) => decorationBox(ctx, item, width, height));
// Ảnh nhãn dán của tiệm nạp xong mới vẽ được (ảnh lỗi thì bỏ qua).
const imageItems = (stickers = []) => stickers.filter((s) => s.src).map((s) => ({ src: s.src }));
export const stickersReady = (stickers) => decorationsReady(imageItems(stickers));
export const loadStickers = (stickers) => preloadDecorations(imageItems(stickers));
