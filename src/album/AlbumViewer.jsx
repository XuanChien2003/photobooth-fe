import { useEffect, useRef, useState } from "react";
import { PiArrowLeftBold, PiArrowRightBold, PiDownloadSimpleBold, PiImagesBold, PiPlayFill } from "react-icons/pi";
import { useToast } from "../studio";
import { api, getApiUrl } from "../api";
import { directMediaUrl, storageLink } from "../media-delivery.js";
import { PhotoThumb, photoUrl } from "./photo-thumb.jsx";
import { downloadEach, fetchFiles, savableOnIOS, usesShareSheet } from "./save-to-phone.js";

// Trang link ảnh (khách quét QR ở máy chụp / nhân viên bấm "Link ảnh"), như Snapbox: ảnh lớn ở giữa,
// dải ảnh nhỏ bên dưới — ảnh đã ghép khung, video tua nhanh rồi tới mọi ảnh gốc. "Lưu" đưa ảnh / video
// đang xem vào thư viện ảnh của điện thoại, "Lưu tất cả" đưa cả album (xem save-to-phone.js).
export function AlbumViewer({ token, booking }) {
  const toast = useToast();
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
          save: {
            url: composite ? `${composite}?download=1` : `${sheet}?download=1`,
            name: `NXC-${booking.code}-anh-ghep.jpg`,
            type: "image/jpeg",
          },
          label: "Ảnh ghép khung",
        }]
      : []),
    ...(video
      ? [{
          key: "video",
          kind: "video",
          src: video,
          save: {
            url: `${video}?download=1`,
            name: `NXC-${booking.code}-video.${booking.video.mimeType === "video/webm" ? "webm" : "mp4"}`,
            type: booking.video.mimeType || "video/mp4",
          },
          label: "Video tua nhanh",
        }]
      : []),
    ...originals.map((photo, i) => ({
      key: photo.id,
      kind: "image",
      photo,
      src: photoSrc(photo),
      fallback: photoUrl(token, photo.id, "preview"),
      save: {
        url: photoUrl(token, photo.id),
        name: `NXC-${booking.code}-${String(i + 1).padStart(2, "0")}.jpg`,
        type: "image/jpeg",
      },
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
  // Lưu vào thư viện ảnh. iPhone: tải tệp về trang rồi mở bảng chia sẻ ("Lưu N mục"). Tải lâu thì
  // Safari không cho mở bảng chia sẻ nữa: nút đổi thành "Bấm để lưu", bấm lần nữa là mở ngay.
  const [shareSheet] = useState(usesShareSheet);
  const fileCache = useRef(new Map());
  const [saving, setSaving] = useState(null); // { scope, done, total }
  const [ready, setReady] = useState(null); // { scope, files }
  const entriesOf = (list) =>
    list.map((entry) => entry.save).filter((entry) => !shareSheet || savableOnIOS(entry));
  async function share(scope, files) {
    try {
      await navigator.share({ files });
    } catch (e) {
      if (e?.name === "NotAllowedError") return setReady({ scope, files });
      if (e?.name !== "AbortError") toast.error("Không mở được bảng lưu ảnh. Vui lòng thử lại.");
    }
  }
  async function save(scope, list) {
    if (saving) return;
    const entries = entriesOf(list);
    if (!entries.length) return toast.info("iPhone không lưu được video này vào Ảnh.");
    if (!shareSheet) return downloadEach(entries);
    if (ready?.scope === scope) {
      setReady(null);
      return share(scope, ready.files);
    }
    setReady(null);
    setSaving({ scope, done: 0, total: entries.length });
    let files;
    try {
      files = await fetchFiles(entries, fileCache.current, (done) =>
        setSaving((current) => current && { ...current, done }));
    } catch (e) {
      toast.error(e.message);
      return;
    } finally {
      setSaving(null);
    }
    await share(scope, files);
  }
  const buttonText = (scope, idle) =>
    saving?.scope === scope
      ? `Đang tải ${saving.done}/${saving.total}…`
      : ready?.scope === scope
        ? ready.files.length > 1 ? `Bấm để lưu ${ready.files.length} mục` : "Bấm để lưu vào Ảnh"
        : idle;
  if (!item) return null;
  const allCount = entriesOf(items).length;
  return (
    <section className="album-viewer" aria-label="Ảnh và video của bạn">
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
        <button type="button" className="button small" disabled={Boolean(saving)} onClick={() => save(item.key, [item])}>
          <PiDownloadSimpleBold aria-hidden="true" />
          {buttonText(item.key, item.kind === "video" ? "Lưu video" : item.key === "composite" ? "Lưu ảnh ghép" : "Lưu ảnh")}
        </button>
        {allCount > 1 && (
          <button type="button" className="button outline small" disabled={Boolean(saving)} onClick={() => save("all", items)}>
            <PiImagesBold aria-hidden="true" /> {buttonText("all", `Lưu tất cả (${allCount})`)}
          </button>
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
