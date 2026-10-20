// Chữ, sticker và chữ ký vẽ tay trên khung. Tọa độ lưu theo tỉ lệ 0–1 của khung, cỡ chữ / nét vẽ
// theo khung rộng 1200 px, nên ảnh xem trước và ảnh in 10 × 15 cm vẽ ra giống hệt nhau.
export const DECOR_FONTS = {
  sans: { label: "Hiện đại", css: "'Be Vietnam Pro', Arial, sans-serif" },
  serif: { label: "Cổ điển", css: "Georgia, 'Times New Roman', serif" },
  handwritten: { label: "Viết tay", css: "'Segoe Script', 'Brush Script MT', cursive" },
  round: { label: "Tròn", css: "'Comic Sans MS', 'Chalkboard SE', 'Trebuchet MS', sans-serif" },
  typewriter: { label: "Đánh máy", css: "'Courier New', Courier, monospace" },
};
export const DECOR_COLORS = [
  "#382b26", "#ffffff", "#7a4b36", "#c89b7b", "#e8d5c4", "#d94f5c",
  "#f29fb0", "#f2b544", "#5c9c6a", "#4a7bd0", "#8e6bbf", "#111111",
];
export const DECOR_STICKERS = [
  "⭐", "✨", "💖", "🌸", "🎀", "🦋", "🌙", "☀️", "🍓", "🧸", "🎉", "📸",
  "😊", "😎", "🥰", "👑", "💐", "🌈", "🍀", "🔥",
];
const MAX_POINTS = 600;
const isColor = (value) => /^#[0-9a-fA-F]{6}$/.test(value || "");
const unit = (value) => Math.max(0, Math.min(1, Number(value) || 0));

function fontOf(item, px) {
  if (item.type === "sticker") return `${px}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  const family = (DECOR_FONTS[item.font] || DECOR_FONTS.sans).css;
  return `${item.type === "signature" ? "italic " : ""}${item.bold ? "700 " : ""}${px}px ${family}`;
}
const sizeOf = (item, width) => Math.max(12, Math.min(160, Number(item.size) || 36)) * width / 1200;

export function drawDecorations(ctx, decorations = [], width, height) {
  for (const item of decorations) {
    ctx.save();
    if (item.type === "drawing") {
      const points = Array.isArray(item.points) ? item.points.slice(0, MAX_POINTS) : [];
      if (points.length) {
        ctx.strokeStyle = isColor(item.color) ? item.color : "#382b26";
        ctx.lineWidth = Math.max(1, Math.min(40, Number(item.width) || 6)) * width / 1200;
        ctx.setLineDash([]);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(unit(points[0][0]) * width, unit(points[0][1]) * height);
        for (const [x, y] of points.slice(1)) ctx.lineTo(unit(x) * width, unit(y) * height);
        if (points.length === 1) ctx.lineTo(unit(points[0][0]) * width + 0.1, unit(points[0][1]) * height);
        ctx.stroke();
      }
      ctx.restore();
      continue;
    }
    const text = String(item.text || "").slice(0, 100);
    if (text) {
      ctx.fillStyle = isColor(item.color) ? item.color : "#382b26";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = fontOf(item, sizeOf(item, width));
      ctx.fillText(text, unit(item.x) * width, unit(item.y) * height, width * .9);
    }
    ctx.restore();
  }
}

// Khung bao (px) của một mục trang trí để chạm chọn / kéo trên màn hình.
export function decorationBox(ctx, item, width, height) {
  if (item.type === "drawing") {
    const xs = item.points.map((p) => p[0] * width), ys = item.points.map((p) => p[1] * height);
    const pad = (Number(item.width) || 6) * width / 1200 + 6;
    return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad,
      w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  }
  const px = sizeOf(item, width);
  ctx.save();
  ctx.font = fontOf(item, px);
  const w = Math.min(width * .9, ctx.measureText(String(item.text || "")).width) + 12;
  ctx.restore();
  const h = px * 1.3;
  return { x: unit(item.x) * width - w / 2, y: unit(item.y) * height - h / 2, w, h };
}

export function hitDecoration(ctx, decorations, x, y, width, height) {
  for (let i = decorations.length - 1; i >= 0; i--) {
    const b = decorationBox(ctx, decorations[i], width, height);
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return i;
  }
  return -1;
}

export const MAX_DRAWING_POINTS = MAX_POINTS;
