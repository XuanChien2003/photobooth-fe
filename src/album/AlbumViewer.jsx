import { useEffect, useRef, useState } from "react";
import { PiArrowLeftBold, PiArrowRightBold, PiDownloadSimpleBold, PiFileZipBold, PiPlayFill } from "react-icons/pi";
import { api, getApiUrl } from "../api";
import { directMediaUrl, storageLink } from "../media-delivery.js";
import { PhotoThumb, photoUrl } from "./photo-thumb.jsx";

// Trang link ảnh (khách quét QR ở máy chụp / nhân viên bấm "Link ảnh"), như Snapbox: ảnh lớn ở giữa,
// dải ảnh nhỏ bên dưới — ảnh đã ghép khung, video tua nhanh rồi tới mọi ảnh gốc. Giữ vào ảnh để lưu
// trên điện thoại; nút tải lấy ảnh gốc / ảnh ghép / video.
export function AlbumViewer({ token, booking }) {
  const [job, setJob] = useState(null);
  const composite = booking.composite ? getApiUrl(`/api/albums/${token}/composite`) : "";
  // Album cũ (trước khi máy chụp lưu ảnh ghép): ảnh ghép lấy từ lệnh in.
  useEffect(() => {
    if (composite) return;
    api(`/albums/${token}/print`, { allowNull: true }).then(setJob, () => {});
  }, [token, booking.printSheets, composite]);
  const sheet = !composite && job?._id ? getApiUrl(`/api/albums/${token}/prints/${job._id}`) : "";
  const video = booking.video ? getApiUrl(`/api/albums/${token}/video`) : "";
  const originals = booking.photos.filter((p) => p.kind === "original");
  // Ảnh lớn giữ nguyên nguồn đã chọn lần đầu: album làm mới link lưu trữ định kỳ, đổi src là tải lại.
  const sources = useRef(new Map());
  const photoSrc = (photo) => {
    if (!sources.current.has(photo.id))
      sources.current.set(photo.id, storageLink(photo, "preview") || directMediaUrl(photoUrl(token, photo.id, "preview")));
    return sources.current.get(photo.id);
  };
  const items = [
    ...(composite || sheet
      ? [{
          key: "composite",
          kind: "image",
          src: composite || sheet,
          thumb: `${composite || sheet}?size=thumbnail`,
          download: composite ? `${composite}?download=1` : `${sheet}?download=1`,
          label: "Ảnh ghép khung",
        }]
      : []),
    ...(video ? [{ key: "video", kind: "video", src: video, download: `${video}?download=1`, label: "Video tua nhanh" }] : []),
    ...originals.map((photo, i) => ({
      key: photo.id,
      kind: "image",
      photo,
      src: photoSrc(photo),
      fallback: photoUrl(token, photo.id, "preview"),
      download: photoUrl(token, photo.id),
      name: `NXC-${booking.code}-${String(i + 1).padStart(2, "0")}.jpg`,
      label: `Ảnh ${i + 1}`,
    })),
  ];
  const [current, setCurrent] = useState(null);
  const index = Math.max(0, items.findIndex((item) => item.key === current));
  const item = items[index];
  const go = (by) => items.length && setCurrent(items[(index + by + items.length) % items.length].key);
  const rail = useRef(null);
  useEffect(() => {
    rail.current?.querySelector(".is-active")?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [index]);
  useEffect(() => {
    const onKey = (event) => {
      if (/input|textarea|select/i.test(event.target.tagName)) return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // Vuốt ngang trên ảnh lớn để chuyển ảnh.
  const swipe = useRef(null);
  if (!item) return null;
  return (
    <section className="album-viewer" aria-label="Ảnh và video của bạn">
      <header className="album-viewer-hint">
        <span>{item.kind === "video" ? "BẤM “TẢI VIDEO” ĐỂ LƯU VỀ MÁY" : "VUI LÒNG GIỮ VÀO ẢNH ĐỂ TẢI"}</span>
        <b>{index + 1}/{items.length}</b>
      </header>
      <div
        className="album-viewer-stage"
        onPointerDown={(event) => { swipe.current = event.clientX; }}
        onPointerUp={(event) => {
          const dx = event.clientX - (swipe.current ?? event.clientX);
          swipe.current = null;
          if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        }}
      >
        {items.length > 1 && (
          <button type="button" className="album-viewer-arrow is-prev" aria-label="Ảnh trước" onClick={() => go(-1)}>
            <PiArrowLeftBold />
          </button>
        )}
        {item.kind === "video" ? (
          <video key={item.key} src={item.src} controls autoPlay muted loop playsInline preload="metadata" />
        ) : (
          <img
            key={item.key}
            src={item.src}
            alt={item.label}
            crossOrigin={item.photo && item.src.startsWith("http") && !item.src.startsWith(location.origin) ? "anonymous" : undefined}
            onError={(event) => {
              if (item.fallback && event.currentTarget.src !== item.fallback) event.currentTarget.src = item.fallback;
            }}
          />
        )}
        {items.length > 1 && (
          <button type="button" className="album-viewer-arrow is-next" aria-label="Ảnh sau" onClick={() => go(1)}>
            <PiArrowRightBold />
          </button>
        )}
      </div>
      <div className="album-viewer-actions">
        <a className="button small" href={item.download} download={item.name || ""}>
          <PiDownloadSimpleBold aria-hidden="true" />
          {item.kind === "video" ? "Tải video" : item.key === "composite" ? "Tải ảnh ghép" : "Tải ảnh gốc"}
        </a>
        {originals.length > 1 && (
          <a className="button outline small" href={getApiUrl(`/api/albums/${token}/download`)}>
            <PiFileZipBold aria-hidden="true" /> Tải tất cả ảnh (ZIP)
          </a>
        )}
      </div>
      <div className="album-viewer-rail" ref={rail} role="tablist" aria-label="Chọn ảnh">
        {items.map((entry, i) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={entry.label}
            className={i === index ? "is-active" : ""}
            onClick={() => setCurrent(entry.key)}
          >
            {entry.kind === "video" ? (
              <span className="album-viewer-play"><PiPlayFill aria-hidden="true" /></span>
            ) : entry.photo ? (
              <PhotoThumb photo={entry.photo} token={token} alt="" loading="lazy" decoding="async" />
            ) : (
              <img src={entry.thumb} alt="" loading="lazy" decoding="async" />
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
