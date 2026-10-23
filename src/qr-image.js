import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { QRCodeSVG } from "qrcode.react";

// Mã QR (link album của khách) để vẽ lên khung ảnh: dựng SVG bằng React ở một nút tách rời (không
// cần react-dom/server — thư viện đó làm nặng gói tải chung của mọi trang) rồi nạp thành ảnh, giữ
// lại theo link.
const cache = new Map();
async function qrMarkup(url) {
  const host = document.createElement("div");
  const root = createRoot(host);
  root.render(createElement(QRCodeSVG, {
    value: url, size: 512, marginSize: 1, level: "M",
    // Ảnh SVG nạp qua <img> phải có xmlns, thiếu là trình duyệt báo lỗi.
    xmlns: "http://www.w3.org/2000/svg",
  }));
  try {
    for (let i = 0; i < 50 && !host.firstElementChild; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    if (!host.firstElementChild) throw new Error("Không tạo được mã QR.");
    return host.innerHTML;
  } finally {
    root.unmount();
  }
}
export function qrImage(url) {
  if (!cache.has(url)) {
    const image = new Image();
    const ready = qrMarkup(url).then((svg) => new Promise((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Không tạo được mã QR."));
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }));
    // Lỗi thì lần sau tạo lại.
    ready.catch(() => cache.delete(url));
    cache.set(url, ready);
    if (cache.size > 20) cache.delete(cache.keys().next().value);
  }
  return cache.get(url);
}
