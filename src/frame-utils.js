import { imageRect } from "./image-utils.js";
import { compareFrameOrder } from "./frame-catalog-data.js";
import { createCanvasCache } from "./canvas-cache.js";
import { drawDecorations } from "./album/decorations.js";

// Khung ảnh thiết kế sẵn (xuất từ Canva...): các ô đặt ảnh là vùng trắng
// hoặc trong suốt. Tự dò các ô này, trả về tọa độ tỉ lệ 0–1, xếp trái→phải, trên→dưới.
export function detectSlots({ data, width, height }) {
  const raw = new Uint8Array(width * height);
  for (let i = 0; i < raw.length; i++) {
    const p = i * 4;
    const lo = Math.min(data[p], data[p + 1], data[p + 2]);
    const hi = Math.max(data[p], data[p + 1], data[p + 2]);
    raw[i] = data[p + 3] < 40 || (lo >= 246 && hi - lo <= 6) ? 1 : 0;
  }
  // Co vùng trắng r px để cắt các sọc/viền trắng mảnh nối liền các ô,
  // sau đó nới khung chữ nhật tìm được ra lại r px.
  const r = Math.max(2, Math.round(Math.min(width, height) * 0.012));
  const erode = (src, horizontal) => {
    const out = new Uint8Array(src.length);
    const len = horizontal ? width : height,
      lines = horizontal ? height : width;
    for (let line = 0; line < lines; line++) {
      const at = (k) => (horizontal ? line * width + k : k * width + line);
      let run = 0;
      const runs = new Int32Array(len);
      for (let k = 0; k < len; k++) runs[k] = run = src[at(k)] ? run + 1 : 0;
      run = 0;
      for (let k = len - 1; k >= 0; k--) {
        run = src[at(k)] ? run + 1 : 0;
        out[at(k)] = runs[k] > r && run > r ? 1 : 0;
      }
    }
    return out;
  };
  const hole = erode(erode(raw, true), false);
  const seen = new Uint8Array(hole.length);
  const stack = new Int32Array(hole.length);
  const slots = [];
  const minArea = width * height * 0.03;
  for (let start = 0; start < hole.length; start++) {
    if (!hole[start] || seen[start]) continue;
    let top = 0,
      area = 0,
      x0 = width,
      y0 = height,
      x1 = 0,
      y1 = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const i = stack[--top];
      const x = i % width,
        y = (i - x) / width;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const n of [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1,
      ])
        if (n >= 0 && hole[n] && !seen[n]) {
          seen[n] = 1;
          stack[top++] = n;
        }
    }
    const w = x1 - x0 + 1,
      h = y1 - y0 + 1;
    // Co vùng chỉ dùng để tách các ô và kiểm tra hình chữ nhật.
    if (area / (w * h) < 0.85) continue;
    const left = Math.max(0, x0 - r),
      topY = Math.max(0, y0 - r),
      right = Math.min(width, x1 + 1 + r),
      bottom = Math.min(height, y1 + 1 + r);
    // Đo diện tích ô sau khi nới lại: ô ảnh nhỏ trong khung 12–14 ảnh
    // có thể còn dưới 3% sau bước co nhưng vẫn đủ lớn ở thiết kế gốc.
    if ((right - left) * (bottom - topY) < minArea) continue;
    slots.push({
      x: left / width,
      y: topY / height,
      w: (right - left) / width,
      h: (bottom - topY) / height,
    });
  }
  return slots.sort((a, b) =>
    Math.abs(a.y - b.y) < 0.05 ? a.x - b.x : a.y - b.y,
  );
}

const cache = createCanvasCache({ maxPixels: 12_000_000, maxEntries: 12 });
export function loadFrameImage(src) {
  // Temporary album URLs must not retain decoded full-size photos globally.
  // Their caller already owns the per-album cache and revokes the object URL.
  const load = () => new Promise((resolve, reject) => {
    const im = new window.Image();
    // Ảnh khung tải từ máy chủ API (khác tên miền): cần CORS để vẽ lên canvas rồi xuất JPEG.
    if (!/^(data|blob):/.test(src)) im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => {
      reject(new Error("Không tải được ảnh khung."));
    };
    im.src = src;
  });
  return src.startsWith("blob:") ? load() : cache.remember(src, load);
}

export const DEFAULT_TRANSFORM = { zoom: 1, x: 0, y: 0, rotate: 0 };

// Tọa độ pixel của một ô trên canvas (nới 1px để không lộ viền trắng).
export function slotRect(slot, width, height) {
  const x = Math.floor(slot.x * width) - 1,
    y = Math.floor(slot.y * height) - 1;
  return {
    x,
    y,
    w: Math.ceil(slot.w * width) + 2,
    h: Math.ceil(slot.h * height) + 2,
  };
}

// Tỉ lệ phóng ảnh khi đặt vào ô (> 1: ảnh nguồn ít điểm ảnh hơn ô cần, bị phóng lên).
export function slotScale(image, rect, t = DEFAULT_TRANSFORM) {
  const angle = ((t.rotate || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle)),
    sin = Math.abs(Math.sin(angle));
  return (
    Math.max(
      (cos * rect.w + sin * rect.h) / image.width,
      (sin * rect.w + cos * rect.h) / image.height,
    ) * Math.max(1, t.zoom || 1)
  );
}

// Vẽ ảnh vào ô theo phóng to (zoom), kéo (x, y — tỉ lệ theo kích thước ô) và xoay 90°.
export function drawSlot(ctx, image, rect, t = DEFAULT_TRANSFORM) {
  const angle = ((t.rotate || 0) * Math.PI) / 180;
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const scale = slotScale(image, rect, t);
  const limitX = Math.max(
    0,
    (image.width * scale - Math.abs(cos) * rect.w - Math.abs(sin) * rect.h) / 2,
  );
  const limitY = Math.max(
    0,
    (image.height * scale - Math.abs(sin) * rect.w - Math.abs(cos) * rect.h) /
      2,
  );
  const px = (t.x || 0) * rect.w,
    py = (t.y || 0) * rect.h;
  const dx = Math.max(-limitX, Math.min(limitX, cos * px + sin * py));
  const dy = Math.max(-limitY, Math.min(limitY, -sin * px + cos * py));
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.translate(
    rect.x + rect.w / 2 + cos * dx - sin * dy,
    rect.y + rect.h / 2 + sin * dx + cos * dy,
  );
  ctx.rotate(angle);
  ctx.drawImage(
    image,
    (-image.width * scale) / 2,
    (-image.height * scale) / 2,
    image.width * scale,
    image.height * scale,
  );
  ctx.restore();
}

// Ghép khung: nền khung trước, ảnh đặt vào các ô trắng/trong suốt.
export function composeLayout(canvas, frameImage, slots, images, transforms, decorations = []) {
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(frameImage, 0, 0, canvas.width, canvas.height);
  slots.forEach((slot, i) => {
    if (images[i])
      drawSlot(
        ctx,
        images[i],
        slotRect(slot, canvas.width, canvas.height),
        transforms[i],
      );
  });
  drawDecorations(ctx, decorations, canvas.width, canvas.height);
  return canvas;
}

// ─── Bộ chủ đề (nhiều khung cùng themeName) & xuất tờ in DNP 10 × 15 cm ───
export const SHEET = { w: 1200, h: 1800 }; // 4 × 6 inch @ 300 pixels/inch

// themeOrder: tên chủ đề theo thứ tự quản trị sắp ở Thiết lập → Chủ đề (chủ đề khác xếp sau).
export function groupFramePacks(frames, themeOrder = []) {
  const groups = new Map();
  for (const frame of frames) {
    const theme = frame.themeName?.trim();
    const key = theme ? `theme:${theme}` : frame._id;
    if (!groups.has(key))
      groups.set(key, { id: key, name: theme || frame.name, frames: [] });
    groups.get(key).frames.push(frame);
  }
  const rank = (g) => {
    const index = g.id.startsWith("theme:") ? themeOrder.indexOf(g.name) : -1;
    return index < 0 ? themeOrder.length : index;
  };
  return [...groups.values()]
    .map((g, index) => ({
      ...g,
      index,
      frames: g.frames.sort(compareFrameOrder),
      required: g.frames.reduce((n, f) => n + f.slots.length, 0),
    }))
    .sort((a, b) => rank(a) - rank(b) || a.index - b.index)
    .map(({ index, ...g }) => g);
}

// Kích thước xuất của một khung: giữ đúng tỉ lệ thiết kế, vừa khổ in.
export function frameOutputSize(frame, image) {
  const box =
    frame.printSize === "strip" ? { w: SHEET.w / 2, h: SHEET.h } : SHEET;
  const landscape = image.naturalWidth > image.naturalHeight;
  const [bw, bh] = landscape ? [box.h, box.w] : [box.w, box.h];
  const { width, height } = imageRect(
    image.naturalWidth,
    image.naturalHeight,
    bw,
    bh,
  );
  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

// Đặt ảnh vào vùng (x, y, w, h): xoay 90° nếu khác hướng, giữ tỉ lệ, căn giữa.
function placeOn(ctx, source, x, y, w, h) {
  const rotate =
    source.width > source.height !== w > h && source.width !== source.height;
  const sw = rotate ? source.height : source.width;
  const sh = rotate ? source.width : source.height;
  const scale = Math.min(w / sw, h / sh);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(x + w / 2, y + h / 2);
  if (rotate) ctx.rotate(Math.PI / 2);
  ctx.drawImage(
    source,
    (-source.width * scale) / 2,
    (-source.height * scale) / 2,
    source.width * scale,
    source.height * scale,
  );
  ctx.restore();
}

// Xếp khung lên tờ 10 × 15: khung nguyên tờ chiếm 1 tờ (khung ngang → tờ ngang
// 15 × 10, máy in tự xoay), khung dải ghép 2 dải / tờ dọc.
// Trả về [{ canvas, frames }] — frames: số khung nằm trên tờ đó.
export function packPrintSheets(outputs) {
  const sheets = [];
  const blank = (landscape = false) => {
    const c = document.createElement("canvas");
    c.width = landscape ? SHEET.h : SHEET.w;
    c.height = landscape ? SHEET.w : SHEET.h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    return c;
  };
  let half = null;
  for (const { canvas, printSize } of outputs) {
    if (printSize === "strip") {
      if (half) {
        placeOn(
          half.canvas.getContext("2d"),
          canvas,
          SHEET.w / 2,
          0,
          SHEET.w / 2,
          SHEET.h,
        );
        half.frames = 2;
        half = null;
      } else {
        half = { canvas: blank(), frames: 1, source: canvas };
        placeOn(
          half.canvas.getContext("2d"),
          canvas,
          0,
          0,
          SHEET.w / 2,
          SHEET.h,
        );
        sheets.push(half);
      }
    } else {
      const sheet = blank(canvas.width > canvas.height);
      placeOn(sheet.getContext("2d"), canvas, 0, 0, sheet.width, sheet.height);
      sheets.push({ canvas: sheet, frames: 1 });
    }
  }
  // A single strip design still fills both halves of its 4×6 sheet.
  // The DS-RX1 driver cuts the sheet after printing when 2inch cut is enabled.
  if (half) {
    placeOn(half.canvas.getContext("2d"), half.source, SHEET.w / 2, 0, SHEET.w / 2, SHEET.h);
    half.frames = 2;
  }
  return sheets;
}
