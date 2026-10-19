import { directMediaUrl, proxyMediaUrl } from "./media-delivery.js";

// Both DNP RX1 and Epson L8050 print 4×6 inch sheets at their physical size.
export function printPhoto10x15({
  imageUrl,
  imageUrls = [imageUrl],
  code,
  copies,
}) {
  const popup = window.open("", "_blank");
  if (!popup)
    throw new Error(
      "Trình duyệt đã chặn cửa sổ in. Hãy cho phép cửa sổ bật lên và thử lại.",
    );

  popup.document.open();
  popup.document.write(`<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>NXC — In ảnh 4 × 6 inch</title>
<style>
  @page { size: 6in 4in; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f8f2ec; color: #3f2c25; font: 14px Arial, sans-serif; }
  .toolbar { max-width: 600px; margin: 24px auto; padding: 0 20px; line-height: 1.7; }
  button { padding: 12px 20px; border: 0; border-radius: 4px; background: #522e22; color: white; cursor: pointer; }
  button:disabled { opacity: .5; cursor: wait; }
  .print-sheet { position: relative; width: 6in; height: 4in; margin: 24px auto; background: white; overflow: hidden; }
  /* Tờ cùng tỉ lệ 3 : 2 với giấy: phủ kín, không viền trắng. */
  .print-sheet img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: center; }
  /* Tờ dọc 10 × 15: xoay 90° cho kín khổ giấy ngang của máy in. */
  .print-sheet.portrait img { position: absolute; left: 1in; top: -1in; width: 4in; height: 6in; transform: rotate(-90deg); }
  @media print {
    html, body { width: 6in; height: 4in; margin: 0 !important; padding: 0 !important; background: white; }
    .toolbar { display: none !important; }
    .print-sheet { margin: 0; break-inside: avoid; break-after: page; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .print-sheet:last-child { break-after: auto; }
  }
</style></head><body>
<div class="toolbar"><h1>In ảnh · 4 × 6 inch</h1><p class="booking-info"></p>
<p>Chọn đúng máy in, giấy <b>4 × 6 inch</b> (102 × 152 mm), hướng <b>ngang</b>, tỉ lệ <b>100%</b>, lề <b>Không có</b>; tắt đầu trang và chân trang.</p>
<p><b>DNP RX1:</b> chọn khổ <b>PR (4x6)</b> trong driver DNP. <b>Epson L8050:</b> chọn đúng loại giấy ảnh; chất lượng <b>High</b> trên Windows hoặc <b>Fine</b> trên macOS. Khi in tràn viền, chọn mức mở rộng thấp nhất để hạn chế cắt ảnh.</p>
<p>Tờ ngang 15 × 10 in thẳng kín khổ; tờ dọc được xoay cho vừa giấy.</p>
<p class="print-status" role="status">Đang tải ảnh…</p><button disabled>In 15 × 10 cm</button></div>
<div class="print-sheet"><img alt="Ảnh in 15 × 10 cm"></div>
</body></html>`);
  popup.document.close();

  const doc = popup.document;
  doc.querySelector(".booking-info").textContent =
    `Vé #${code} · ${imageUrls.length} tờ 15 × 10 cm × ${copies || 1} bản.`;
  const button = doc.querySelector("button");
  const status = doc.querySelector(".print-status");
  doc.querySelector(".print-sheet").remove();
  const images = imageUrls.map((src) => {
    const sheet = doc.createElement("div");
    sheet.className = "print-sheet";
    const img = doc.createElement("img");
    sheet.append(img);
    doc.body.append(sheet);
    return { img, src };
  });
  button.onclick = () => {
    popup.focus();
    popup.print();
  };
  const onError = () => {
    status.textContent =
      "Không tải được ảnh. Hãy đóng cửa sổ và thử lại từ hàng chờ in.";
  };
  Promise.all(
    images.map(
      ({ img, src }) =>
        new Promise((resolve, reject) => {
          img.onload = () => {
            img.parentElement.classList.add(
              img.naturalHeight > img.naturalWidth ? "portrait" : "landscape",
            );
            img.decode().then(resolve, reject);
          };
          const original = new URL(proxyMediaUrl(src), window.location.origin).href;
          const direct = directMediaUrl(original);
          img.onerror = () => {
            if (img.src !== original && direct !== original) img.src = proxyMediaUrl(original);
            else reject(new Error("Không tải được ảnh in."));
          };
          img.src = direct;
        }),
    ),
  )
    .then(async () => {
      try {
        if (popup.closed) return;
        button.disabled = false;
        status.textContent =
          "Ảnh đã sẵn sàng. Chỉ đánh dấu đã in sau khi nhận được bản in.";
        popup.requestAnimationFrame(() =>
          popup.requestAnimationFrame(() => {
            if (!popup.closed) {
              popup.focus();
              popup.print();
            }
          }),
        );
      } catch {
        onError();
      }
    })
    .catch(onError);
}
