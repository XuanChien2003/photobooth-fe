import { useState } from "react";
import { PiArrowLeftBold, PiCameraBold } from "react-icons/pi";
import { money } from "../api";
import { Brand, Button, ErrorBox } from "../studio";
import { useKioskText } from "./use-kiosk-text.js";

// Hình layout trên thẻ: lưới đúng số ảnh của layout (1, 2, 3, 4, 6… ô).
const GRID = { 1: [1, 1], 2: [2, 1], 3: [3, 1], 4: [2, 2], 5: [3, 2], 6: [3, 2], 8: [4, 2], 9: [3, 3] };
export const layoutGrid = (n) => {
  const count = Math.max(1, Number(n) || 1);
  if (GRID[count]) return GRID[count];
  const cols = Math.ceil(Math.sqrt(count));
  return [cols, Math.ceil(count / cols)];
};
export function LayoutArt({ count }) {
  const n = Math.max(1, Number(count) || 1);
  const [cols, rows] = layoutGrid(n);
  return (
    <span className="layout-art" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
      {Array.from({ length: n }, (_, i) => <i key={i} />)}
    </span>
  );
}

// Phòng Polaroid: Chạm để bắt đầu → chọn layout (các gói khổ Instax: số ảnh, giá) → thông báo "Chọn
// layout này, vào chụp nha!" → vào chụp luôn; khách trả tiền ở quầy. Chữ trên màn sửa ở quản trị.
// instax: tình trạng máy in Instax (chưa sẵn sàng vẫn cho chụp — lệnh in chờ tới khi máy in kết nối).
export function KioskLayouts({ layouts, instax, busy, error, onStart, onBack }) {
  const t = useKioskText();
  const [chosen, setChosen] = useState(null);
  return (
    <section className="kiosk-flow layout-screen">
      <header className="flow-head">
        <Brand />
        <h1>{t("layout.title")}</h1>
        <p>{t("layout.subtitle")}</p>
      </header>
      <ErrorBox error={error} />
      <div className="kiosk-layout-grid" role="group" aria-label={t("layout.title")}>
        {layouts.map((pack) => (
          <button type="button" key={pack._id} className="kiosk-layout" onClick={() => setChosen(pack)}
            aria-label={`${t("layout.photos", { n: pack.selectCount || 1 })} · ${pack.name} · ${money(pack.price)}`}>
            <LayoutArt count={pack.selectCount} />
            <strong>{t("layout.photos", { n: pack.selectCount || 1 })}</strong>
            <small>{pack.name}</small>
            <b>{money(pack.price)}</b>
          </button>
        ))}
        {!layouts.length && (
          <p className="soft-note">Chưa có layout cho phòng Polaroid. Nhờ nhân viên thêm gói khổ Instax ở Khổ ảnh & bảng giá.</p>
        )}
      </div>
      {instax && !instax.ready && (
        <p className="soft-note layout-printer-note">
          {(instax.message || "Máy in Instax chưa sẵn sàng").replace(/\.$/, "")} — ảnh sẽ in khi máy in sẵn sàng.
        </p>
      )}
      <footer className="flow-foot">
        <Button className="outline" disabled={busy} onClick={onBack}>
          <PiArrowLeftBold aria-hidden="true" /> Quay lại
        </Button>
      </footer>
      {chosen && (
        <div className="layout-confirm" role="dialog" aria-modal="true" aria-labelledby="layout-confirm-title">
          <div className="layout-confirm-card">
            <LayoutArt count={chosen.selectCount} />
            <h2 id="layout-confirm-title">{t("layout.confirm")}</h2>
            <p>
              {t("layout.photos", { n: chosen.selectCount || 1 })} · {chosen.name} · <b>{money(chosen.price)}</b>
            </p>
            <div className="layout-confirm-actions">
              <Button className="outline" disabled={busy} onClick={() => setChosen(null)}>
                {t("layout.back")}
              </Button>
              <Button disabled={busy} onClick={() => onStart(chosen)}>
                <PiCameraBold aria-hidden="true" /> {busy ? "Đang mở…" : t("layout.go")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
