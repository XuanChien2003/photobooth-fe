import { useRef, useState } from "react";
import {
  PiArrowRightBold,
  PiCheckSquareBold,
  PiDownloadSimpleBold,
  PiHeartBold,
  PiHeartFill,
  PiPlusBold,
  PiSelectionAllBold,
  PiSparkleFill,
  PiSquareBold,
  PiTrashBold,
  PiUploadSimpleBold,
  PiXBold,
} from "react-icons/pi";
import { getApiUrl } from "../api";
import { directMediaUrl, storageLink } from "../media-delivery.js";
import { Button, useToast } from "../studio";
import { filterCss } from "../beauty";
import { BEAUTY_KEYS, pad, photoUrl } from "./utils";

// ─── Bước 1: Thư viện ảnh ────────────────────────────────────────────────
// Thumbnails come straight from storage with the link the album list carried, then through the
// API's redirect, then streamed by the API. A mounted thumbnail keeps its source: later album
// polls bring links signed for a new window, and swapping src would download it all again.
// Storage loads use CORS mode: the editor fetches the very same R2 URL for its canvas, and R2
// answers a plain <img> without CORS headers or "Vary: Origin", so the cached copy would make that
// fetch fail and push the editor onto the slow path through the server (seen in Chromium).
function PhotoThumb({ photo, token, ...props }) {
  const [sources] = useState(() => {
    const api = photoUrl(token, photo.id, true);
    const link = storageLink(photo, "thumbnail");
    return [...(link ? [{ src: link, cors: true }] : []),
      { src: directMediaUrl(api), cors: true }, { src: api, cors: false }];
  });
  const [index, setIndex] = useState(0);
  const { src, cors } = sources[index];
  return (
    <img
      {...props}
      crossOrigin={cors ? "anonymous" : undefined}
      src={src}
      onError={() => setIndex((i) => Math.min(i + 1, sources.length - 1))}
    />
  );
}

export function Gallery({
  token,
  booking,
  photos,
  favorites,
  selectedPack,
  favoritesSaving,
  adjustOf,
  busy,
  uploadProgress,
  onFavorite,
  onDelete,
  onDownload,
  downloadingId,
  onEdit,
  onUpload,
  onNext,
}) {
  const toast = useToast();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const input = useRef(null);
  const allSelected =
    selecting && photos.length > 0 && selected.size === photos.length;
  const toggle = (id) =>
    setSelected((old) => {
      const next = new Set(old);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  return (
    <>
      <div className="studio-head">
        <div>
          <div className="studio-title-row">
            <h2>Thư viện ảnh</h2>
            <span className="studio-photo-total">{photos.length} ảnh</span>
          </div>
          <p>
            {!photos.length
              ? "Thêm ảnh từ điện thoại để bắt đầu chọn và ghép khung."
              : "Chạm ảnh để chỉnh sửa. Thả tim những ảnh bạn yêu thích, không giới hạn số lượng."}
          </p>
          {selectedPack && photos.length > 0 && (
            <span className="gallery-selected-pack">
              Bộ đã chọn: <strong>{selectedPack.name}</strong>
            </span>
          )}
        </div>
        <a
          className="button outline small"
          href={getApiUrl(`/api/albums/${token}/download`)}
          aria-disabled={!photos.length}
          onClick={(event) => {
            if (!photos.length) return event.preventDefault();
            toast.info(
              `Đang chuẩn bị file ZIP ${photos.length} ảnh gốc, vui lòng đợi…`,
            );
          }}
        >
          <PiDownloadSimpleBold /> Tải tất cả
        </a>
      </div>
      <div className={`studio-grid ${selecting ? "is-selecting" : ""}`}>
        <button
          type="button"
          className="studio-upload-tile"
          aria-label="Thêm ảnh từ điện thoại"
          aria-busy={busy}
          disabled={busy || favoritesSaving}
          onClick={() => input.current?.click()}
        >
          {busy ? (
            <PiUploadSimpleBold aria-hidden="true" />
          ) : (
            <PiPlusBold aria-hidden="true" />
          )}
          <strong>{busy ? "Đang tải lên…" : "Thêm ảnh"}</strong>
          <span>{busy
            ? uploadProgress ? `Đã lưu ${uploadProgress.done}/${uploadProgress.total} ảnh` : "Vui lòng đợi"
            : "Từ điện thoại"}</span>
        </button>
        {photos.map((p, i) => {
          const adjust = adjustOf(p.id);
          const number = pad(p.number || i + 1);
          return (
            <figure
              key={p.id}
              className={`${p.favorite ? "is-fav" : ""} ${selected.has(p.id) ? "is-picked" : ""}`}
              style={{ "--vt": `photo-${p.id}` }}
            >
              <button
                className="studio-photo"
                aria-label={
                  selecting ? `Chọn ảnh ${number}` : `Xem & chỉnh ảnh ${number}`
                }
                onClick={() => (selecting ? toggle(p.id) : onEdit(p))}
              >
                <PhotoThumb
                  photo={p}
                  token={token}
                  className="fade-img"
                  alt={`Ảnh ${number}`}
                  loading={i < 4 ? "eager" : "lazy"}
                  fetchPriority={i < 2 ? "high" : "auto"}
                  decoding="async"
                  style={{ filter: filterCss(adjust) }}
                  onLoad={(e) => e.currentTarget.classList.add("is-loaded")}
                />
              </button>
              {(() => {
                // Mỗi ảnh lưu 24 giờ kể từ lúc chụp: còn dưới 2 giờ thì nhắc khách tải về.
                const left = p.expiresAt
                  ? Math.ceil((new Date(p.expiresAt) - Date.now()) / 60000)
                  : Infinity;
                return left <= 120 ? (
                  <span
                    className="photo-expiry"
                    title="Ảnh lưu 24 giờ kể từ lúc chụp — tải về máy để giữ lại"
                  >
                    Còn{" "}
                    {left >= 60
                      ? `${Math.floor(left / 60)} giờ ${left % 60} phút`
                      : `${Math.max(1, left)} phút`}
                  </span>
                ) : null;
              })()}
              {BEAUTY_KEYS.some((k) => adjust[k] > 0) && (
                <span className="photo-edited" title="Đã chỉnh sửa">
                  <PiSparkleFill />
                </span>
              )}
              {/* One quiet strip along the bottom: save and delete on the left, the heart on the
                  right. While picking several photos the checkbox takes their place. */}
              <div className="tile-actions">
                {selecting ? (
                  <button
                    className="tile-btn tile-check"
                    role="checkbox"
                    aria-checked={selected.has(p.id)}
                    aria-label={`Đánh dấu ảnh ${number}`}
                    onClick={() => toggle(p.id)}
                  >
                    {selected.has(p.id) ? <PiCheckSquareBold /> : <PiSquareBold />}
                  </button>
                ) : (
                  <>
                    <button
                      className="tile-btn"
                      disabled={Boolean(downloadingId)}
                      aria-busy={downloadingId === p.id}
                      aria-label={`Tải ảnh ${number} về máy`}
                      title="Tải ảnh về máy"
                      onClick={() => onDownload(p)}
                    >
                      {downloadingId === p.id ? <span className="spinner" aria-hidden="true" /> : <PiDownloadSimpleBold />}
                    </button>
                    <button
                      className="tile-btn"
                      disabled={busy || favoritesSaving}
                      aria-label={`Xóa ảnh ${number}`}
                      title="Xóa ảnh"
                      onClick={() => onDelete([p.id])}
                    >
                      <PiTrashBold />
                    </button>
                  </>
                )}
                <button
                  className="tile-btn tile-heart"
                  disabled={busy}
                  aria-label={`${p.favorite ? "Bỏ tim" : "Thả tim"} ảnh ${number}`}
                  aria-pressed={p.favorite}
                  title={p.favorite ? "Bỏ tim" : "Thả tim ảnh yêu thích"}
                  onClick={() => onFavorite(p)}
                >
                  {p.favorite ? <PiHeartFill /> : <PiHeartBold />}
                </button>
              </div>
            </figure>
          );
        })}
      </div>
      {!photos.length && (
        <div className="empty-state">
          <p>Thêm ảnh đã chỉnh sửa từ điện thoại để chọn và ghép khung.</p>
        </div>
      )}
      <input
        ref={input}
        hidden
        type="file"
        aria-label="Chọn ảnh từ điện thoại"
        accept="image/jpeg,image/png,image/webp"
        multiple
        disabled={busy || favoritesSaving}
        onChange={(e) => {
          onUpload(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
      <div className="studio-actions gallery-bar">
        <div className="gallery-tools">
          <button
            type="button"
            disabled={busy || favoritesSaving}
            onClick={() => input.current?.click()}
          >
            <PiUploadSimpleBold /> {busy ? "Đang tải lên…" : "Thêm ảnh"}
          </button>
          <button
            className={selecting ? "on" : ""}
            onClick={() => {
              if (!selecting) return setSelecting(true);
              setSelected(
                allSelected ? new Set() : new Set(photos.map((p) => p.id)),
              );
            }}
          >
            <PiSelectionAllBold />{" "}
            {!selecting
              ? "Chọn nhiều"
              : allSelected
                ? "Bỏ chọn"
                : "Chọn tất cả"}
          </button>
          {selecting && (
            <button
              aria-label="Thoát chế độ chọn"
              onClick={() => {
                setSelecting(false);
                setSelected(new Set());
              }}
            >
              <PiXBold />
            </button>
          )}
          {selecting && (
            <button
              className="danger"
              disabled={!selected.size || busy || favoritesSaving}
              onClick={async () => {
                if (await onDelete([...selected])) setSelected(new Set());
              }}
            >
              <PiTrashBold /> Xóa ({selected.size})
            </button>
          )}
        </div>
        <div className="gallery-cta">
          <span className="fav-count" aria-live="polite">
            <PiHeartFill />
            {`Thích · ${favorites.length}`}
          </span>
          <Button disabled={!photos.length || favoritesSaving} onClick={onNext}>
            {favoritesSaving ? "Đang lưu…" : "Chọn chủ đề"} <PiArrowRightBold />
          </Button>
        </div>
      </div>
    </>
  );
}
