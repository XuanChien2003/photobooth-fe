import { useEffect, useRef, useState } from "react";
import { PiArrowLeftBold, PiArrowRightBold, PiCheckBold } from "react-icons/pi";
import { Button } from "../studio";
import { composePreview, previewBitmap } from "./compose.js";
import { useObjectUrl } from "./KioskShoot.jsx";

// Ảnh xem nhanh của các tấm đã chụp, giải mã một lần cho cả bước chọn ảnh và chọn khung.
export function useShotBitmaps(shots, token) {
  const [bitmaps, setBitmaps] = useState(() => new Map());
  // Ảnh đã đọc của lượt hiện tại. Kết quả đọc xong giữ lại kể cả khi danh sách tấm vừa đổi (ảnh gốc
  // tải lên xong làm cập nhật lượt chụp) — bỏ đi thì tấm đó không bao giờ được đọc lại và khung
  // ghép xem trước bị trống ô.
  const store = useRef({ token, loading: new Set(), map: bitmaps });
  useEffect(() => {
    let s = store.current;
    // Lượt khách mới, hoặc đã rời bước chọn ảnh / khung: giải phóng ảnh đã giải mã (~10 MB mỗi tấm;
    // máy chụp mở cả ngày).
    if (s.token !== token || !shots.length) {
      if (s.map.size || s.loading.size) {
        for (const bitmap of s.map.values()) bitmap.close?.();
        s = store.current = { token, loading: new Set(), map: new Map() };
        setBitmaps(s.map);
      } else s.token = token;
    }
    for (const shot of shots) {
      if (s.loading.has(shot.key)) continue;
      s.loading.add(shot.key);
      previewBitmap(shot, token).then(
        (bitmap) => {
          if (store.current !== s) return bitmap.close?.();
          s.map = new Map(s.map).set(shot.key, bitmap);
          setBitmaps(s.map);
        },
        () => s.loading.delete(shot.key),
      );
    }
  }, [shots, token]);
  useEffect(() => () => {
    for (const bitmap of store.current.map.values()) bitmap.close?.();
    store.current = { token: null, loading: new Set(), map: new Map() };
  }, []);
  return bitmaps;
}

// Khung ghép xem trước (ảnh trong khung đổi theo ảnh đang chọn).
// imageKey: các tấm đang đặt vào khung (đổi thì ghép lại), images: ảnh tương ứng.
export function FramePreview({ frame, images, imageKey, width = 900, className = "", qrUrl = "" }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let alive = true, url = "";
    if (!frame) return;
    composePreview(frame, images, width, qrUrl)
      .then((canvas) => new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9)))
      .then((blob) => {
        if (!alive || !blob) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  }, [frame?._id, imageKey, width]);
  return src ? <img className={`frame-preview ${className}`} src={src} alt={frame?.name || "Khung ảnh"} /> : <div className={`frame-preview is-loading ${className}`} />;
}

function Pick({ shot, order, onToggle, disabled }) {
  const src = useObjectUrl(shot.preview);
  return (
    <button
      type="button"
      className={`select-shot ${order ? "is-picked" : ""}`}
      aria-pressed={Boolean(order)}
      disabled={disabled && !order}
      onClick={() => onToggle(shot.key)}
    >
      {src && <img src={src} alt="" loading="lazy" />}
      {order ? <span className="select-order">{order}</span> : null}
    </button>
  );
}

// Chụp xong: chọn ảnh yêu thích để ghép (vd. gói 70k chọn 4 tấm), có giới hạn thời gian.
export function KioskSelect({ shots, bitmaps, count, selected, onToggle, secondsLeft, frame, onNext, qrUrl }) {
  const ready = selected.filter((key) => bitmaps.has(key));
  const images = ready.map((key) => bitmaps.get(key));
  const full = selected.length >= count;
  return (
    <section className="kiosk-flow select-screen">
      <header className="flow-head">
        <h1>
          Bạn có <u>{secondsLeft}s</u> để chọn ảnh yêu thích
        </h1>
        <p>Chọn {count} tấm để ghép khung · đã chọn {selected.length}/{count}</p>
      </header>
      <div className="select-layout">
        <div className="select-preview">
          <FramePreview frame={frame} images={images} imageKey={ready.join()} width={700} qrUrl={qrUrl} />
        </div>
        <i className="select-divider" aria-hidden="true" />
        <div className="select-grid" role="group" aria-label="Ảnh đã chụp">
          {shots.map((shot) => (
            <Pick
              key={shot.key}
              shot={shot}
              order={selected.indexOf(shot.key) + 1}
              disabled={full}
              onToggle={onToggle}
            />
          ))}
        </div>
      </div>
      <footer className="flow-foot">
        <Button className="kiosk-next" disabled={!selected.length} onClick={onNext}>
          {full ? <PiCheckBold aria-hidden="true" /> : null} Tiếp tục chọn khung <PiArrowRightBold aria-hidden="true" />
        </Button>
      </footer>
    </section>
  );
}

// Chọn khung: mũi tên trái / phải để lướt khung, xem ngay ảnh vừa chọn nằm trong khung.
export function KioskFrame({ frames, index, setIndex, images, imageKey, secondsLeft, onConfirm, busy, qrUrl }) {
  const frame = frames[index];
  const move = (by) => setIndex((index + by + frames.length) % frames.length);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <section className="kiosk-flow frame-screen">
      <header className="flow-head">
        <h1>Chọn khung ảnh</h1>
        <p>
          {frame ? `${frame.themeName?.trim() || frame.name} · khung ${index + 1}/${frames.length} · ` : ""}còn <u>{secondsLeft}s</u>
        </p>
      </header>
      {!frames.length ? (
        <p className="frame-none" role="status">Tiệm chưa có khung ảnh — bấm “Nhận ảnh &amp; mã QR” để tải ảnh của bạn.</p>
      ) : (
        <div className="frame-stage">
          <button type="button" className="frame-arrow" aria-label="Khung trước" onClick={() => move(-1)} disabled={frames.length < 2}>
            <PiArrowLeftBold />
          </button>
          <FramePreview key={frame?._id} frame={frame} images={images} imageKey={imageKey} width={900} className="frame-main" qrUrl={qrUrl} />
          <button type="button" className="frame-arrow" aria-label="Khung sau" onClick={() => move(1)} disabled={frames.length < 2}>
            <PiArrowRightBold />
          </button>
        </div>
      )}
      <div className="frame-dots" aria-hidden="true">
        {frames.slice(0, 24).map((f, i) => <i key={f._id} className={i === index ? "on" : ""} />)}
      </div>
      <footer className="flow-foot">
        <Button className="kiosk-next" disabled={busy || (!frame && frames.length > 0)} onClick={onConfirm}>
          {busy ? "Đang ghép ảnh…" : frames.length ? "Chọn khung này" : "Nhận ảnh & mã QR"} <PiCheckBold aria-hidden="true" />
        </Button>
      </footer>
    </section>
  );
}
