import { useEffect, useRef, useState } from "react";
import {
  PiCameraBold,
  PiCheckBold,
  PiHandTapBold,
  PiTimerBold,
  PiVideoCameraSlashDuotone,
} from "react-icons/pi";
import { Button } from "../studio";
import { CameraPreview } from "./CameraPreview.jsx";

// Ảnh trên máy (Blob) hoặc trên máy chủ (URL).
export function useObjectUrl(source) {
  const [url, setUrl] = useState(typeof source === "string" ? source : "");
  useEffect(() => {
    if (!(source instanceof Blob)) {
      setUrl(typeof source === "string" ? source : "");
      return;
    }
    const next = URL.createObjectURL(source);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [source]);
  return url;
}
function Thumb({ shot }) {
  const src = useObjectUrl(shot.preview);
  return src ? <img src={src} alt="" /> : <span className="shoot-thumb-empty" />;
}
const clock = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

// Màn chụp: hình trực tiếp toàn màn hình (lật như gương, đã cắt mép thông số máy ảnh), không có
// chữ trên hình. Bên phải: đồng hồ đếm ngược và các ảnh vừa chụp xếp dọc. Chỉ 3 giây cuối mới hiện
// số đếm ở giữa màn hình. Trước khi chụp: chọn cách chụp, rồi 3 giây chuẩn bị.
export function KioskShoot({
  videoRef,
  zoom,
  ready,
  phase,
  mode,
  booking,
  preCount,
  shotLeft,
  sessionLeft,
  taken,
  quota,
  shots,
  flash,
  receiving,
  pressPrompt,
  modeLeft,
  ending,
  onPickMode,
  onEnd,
  onReopenCamera,
}) {
  const centerCount =
    phase === "ready"
      ? preCount
      : phase === "shoot" && !ending
        ? mode === "timer"
          ? shotLeft > 0 && shotLeft <= 3 ? shotLeft : null
          : sessionLeft > 0 && sessionLeft <= 3 ? sessionLeft : null
        : null;
  const timerMode = mode === "timer";
  // Ảnh mới nhất ở đầu cột: có ảnh mới thì cuộn lên đầu để khách thấy ngay.
  const rail = useRef(null);
  useEffect(() => {
    rail.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [shots.length, receiving]);
  return (
    <section className={`shoot-screen phase-${phase}`}>
      <div className="shoot-stage">
        <CameraPreview videoRef={videoRef} zoom={zoom} />
        {!ready && phase !== "mode" && (
          <div className="shoot-no-camera" role="status">
            <PiVideoCameraSlashDuotone size={36} aria-hidden="true" />
            <p>Chưa có hình trực tiếp từ máy ảnh — vẫn chụp được bằng dây bấm.</p>
            <Button className="outline small" onClick={onReopenCamera}>Mở lại camera</Button>
          </div>
        )}
        {centerCount ? (
          <strong className="shoot-count" key={`${phase}-${centerCount}`} role="timer" aria-live="assertive">
            {centerCount}
          </strong>
        ) : null}
        {pressPrompt && !ending && (
          <div className="shoot-press" role="alert">
            <PiHandTapBold aria-hidden="true" />
            <strong>Bấm nút trên dây bấm để chụp</strong>
          </div>
        )}
        {flash > 0 && <div className="camera-flash" key={flash} aria-hidden="true" />}
        {ending && (
          <div className="shoot-ending" role="status">
            <span className="spinner big" aria-hidden="true" />
          </div>
        )}
      </div>

      {phase !== "mode" && (
        <aside className="shoot-rail" aria-label="Thời gian và ảnh đã chụp">
          <div className="shoot-timer" role="timer">
            <span>{timerMode ? "ĐẾM NGƯỢC" : "THỜI GIAN"}</span>
            <strong>
              {phase === "ready"
                ? "—"
                : timerMode
                  ? shotLeft ?? "—"
                  : clock(sessionLeft)}
            </strong>
            <small>
              {Math.min(taken, quota || taken)}/{quota || "∞"} tấm
              {timerMode && phase === "shoot" ? ` · ${clock(sessionLeft)}` : ""}
            </small>
          </div>
          <ol className="shoot-thumbs" ref={rail} aria-label="Ảnh vừa chụp, mới nhất ở trên">
            {receiving && (
              <li className="shoot-thumb-pending" role="status">
                <span className="spinner" aria-hidden="true" />
                Đang nhận ảnh…
              </li>
            )}
            {[...shots].reverse().map((shot, i) => (
              <li key={shot.key} className={i === 0 && !receiving ? "is-newest" : ""}>
                <Thumb shot={shot} />
                <b className="shoot-thumb-no">{shots.length - i}</b>
              </li>
            ))}
          </ol>
          {phase === "shoot" && !ending && taken > 0 && (
            <button type="button" className="shoot-end" onClick={onEnd} aria-label="Chụp xong, chọn ảnh">
              <PiCheckBold aria-hidden="true" />
            </button>
          )}
        </aside>
      )}

      {phase === "mode" && (
        <div className="shoot-mode" role="dialog" aria-modal="true" aria-labelledby="mode-title">
          <div className="shoot-mode-card">
            <p className="shoot-mode-kicker">{booking.packageName} · {quota} tấm</p>
            <h1 id="mode-title">Chọn cách chụp</h1>
            <div className="shoot-mode-options">
              <button type="button" onClick={() => onPickMode("timer")}>
                <PiTimerBold aria-hidden="true" />
                <strong>Đếm giờ</strong>
                <span>Máy tự chụp sau {booking.countdownSeconds || 10} giây mỗi tấm</span>
              </button>
              <button type="button" onClick={() => onPickMode("remote")}>
                <PiHandTapBold aria-hidden="true" />
                <strong>Bấm dây</strong>
                <span>Tự bấm nút trên dây bấm · {quota} lần bấm</span>
              </button>
            </div>
            <small>
              <PiCameraBold aria-hidden="true" /> Tự chọn “Đếm giờ” sau {modeLeft} giây
            </small>
          </div>
        </div>
      )}
    </section>
  );
}
