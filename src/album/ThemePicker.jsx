import {
  PiArrowRightBold,
  PiCheckBold,
  PiCheckCircleDuotone,
  PiHeartFill,
  PiImagesDuotone,
  PiStackDuotone,
  PiWarningCircleDuotone,
} from "react-icons/pi";
import { useEffect } from "react";
import { Button } from "../studio";
import { packCapacity } from "./frame-capacity";
import { ActionBar } from "./shared";

// ─── Bước 2A: Chọn bộ chủ đề (xem trước cả bộ, cỡ lớn) ───────────────────
export function ThemePicker({
  packs,
  selected,
  favorites,
  totalPhotos,
  favoritesSaving,
  onSelect,
  onBack,
  onNext,
}) {
  const pack = packs.find((p) => p.id === selected);
  const capacity = packCapacity(pack);
  // Danh sách chỉ tải ảnh xem nhanh; ảnh khung gốc của bộ đang chọn tải trước lúc rảnh để bước
  // ghép ảnh mở ngay (cùng kiểu tải CORS với bước ghép nên dùng lại được bản đã tải).
  const preload = pack?.frames.map((f) => f.image).join("|") || "";
  useEffect(() => {
    if (!preload) return;
    const start = () => {
      for (const src of preload.split("|")) {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.src = src;
      }
    };
    const idle = window.requestIdleCallback?.(start, { timeout: 1500 });
    const timer = idle === undefined ? setTimeout(start, 300) : null;
    return () => (idle === undefined ? clearTimeout(timer) : window.cancelIdleCallback?.(idle));
  }, [preload]);
  const extra = pack ? Math.max(0, favorites - capacity) : 0;
  const missing = pack ? Math.max(0, capacity - favorites) : 0;
  return (
    <>
      <div className="studio-head theme-catalog-head">
        <div>
          <h2>Chọn bộ chủ đề</h2>
          <p>
            Chọn một bộ bạn thích. Các khung trong bộ sẽ được ghép cùng nhau.
          </p>
        </div>
        <span className="theme-total">{packs.length} bộ khung</span>
      </div>
      <div
        className={`theme-status theme-selection-status ${missing ? "is-short" : favorites ? "ok" : ""}`}
        role="status"
      >
        {missing ? <PiWarningCircleDuotone /> : favorites ? <PiCheckCircleDuotone /> : <PiHeartFill />}
        <div>
          <strong>
            {favorites
              ? `Bạn đã chọn ${favorites} ảnh yêu thích`
              : "Bạn chưa chọn ảnh yêu thích"}
          </strong>
          <span>
            {pack
              ? `Bộ “${pack.name}” có ${capacity} ô ảnh.`
              : "Chọn bộ khung để xem số ảnh cần ghép."}
            {extra > 0
              ? ` ${extra} ảnh còn lại vẫn được giữ trong thư viện và có thể dùng để đổi ảnh ở từng ô.`
              : missing > 0
                ? ` Còn thiếu ${missing} ảnh yêu thích. Bạn có thể chọn thêm hoặc tự động ghép ở bước tiếp theo.`
                : ""}
          </span>
        </div>
      </div>
      <div className="theme-list theme-catalog">
        {packs.map((p) => (
          <button
            key={p.id}
            type="button"
            className={p.id === selected ? "active" : ""}
            aria-pressed={p.id === selected}
            aria-label={`Chọn bộ ${p.name}, ${p.frames.length} khung, ${packCapacity(p)} ô ảnh`}
            onClick={() => onSelect(p.id)}
          >
            <div
              className="theme-big-preview"
              style={{ "--preview-columns": Math.min(3, p.frames.length) }}
            >
              {p.frames.map((f) => (
                <span className="theme-preview-frame" key={f._id}>
                  <img
                    src={f.thumb || f.image}
                    alt={f.name}
                    loading="lazy"
                    crossOrigin="anonymous"
                  />
                </span>
              ))}
            </div>
            <div className="theme-list-info">
              <div className="theme-card-title">
                <strong>{p.name}</strong>
                <span
                  className={`theme-choice ${p.id === selected ? "checked" : ""}`}
                  aria-hidden="true"
                >
                  {p.id === selected && <PiCheckBold />}
                </span>
              </div>
              <div className="theme-card-meta">
                <span>
                  <PiStackDuotone /> {p.frames.length} khung
                </span>
                <span>
                  <PiImagesDuotone /> {packCapacity(p)} ô ảnh
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
      {!packs.length && (
        <div className="empty-state">
          Studio chưa có bộ chủ đề. Vui lòng liên hệ lễ tân.
        </div>
      )}
      <ActionBar onBack={onBack} className="theme-action-bar">
        <span className="theme-action-summary">
          <strong>{pack ? pack.name : "Chọn 1 bộ khung"}</strong>
          <small>
            {pack
              ? `${capacity} ô ảnh · ${favorites} ảnh yêu thích${missing ? ` · Thiếu ${missing} ảnh` : ""}`
              : "Chạm bộ khung để chọn"}
          </small>
        </span>
        <Button
          disabled={!pack || !totalPhotos || favoritesSaving || !capacity}
          onClick={onNext}
        >
          Ghép ảnh <PiArrowRightBold />
        </Button>
      </ActionBar>
    </>
  );
}
