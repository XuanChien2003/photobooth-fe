import {
  PiFilmStripDuotone,
  PiPrinterDuotone,
  PiWarningCircleDuotone,
} from "react-icons/pi";
import { QRCodeSVG } from "qrcode.react";
import { Brand, Button } from "../studio";

const PRINT_TEXT = {
  sending: "Đang gửi ảnh tới máy in…",
  waiting: "Đang chờ tải ảnh lên để in…",
  sent: "Ảnh đang được in — lấy ảnh tại khay ảnh",
  failed: "Chưa in được — nhờ nhân viên in lại giúp bạn",
};

// Màn cuối: ảnh đã ghép khung (trái), mã QR tải ảnh & video (giữa), video tua nhanh (phải).
export function KioskDone({ done, pending, left, nextGuest }) {
  const print = done.print?.status;
  const framed = done.framed !== false;
  return (
    <section className="kiosk-flow done-screen">
      <header className="flow-head">
        <Brand />
      </header>
      <div className="done-cards">
        <figure className="done-card">
          {done.composite ? (
            <img src={done.composite} alt={framed ? "Ảnh đã ghép khung" : "Ảnh của bạn"} />
          ) : (
            <div className="done-empty">Ảnh của bạn</div>
          )}
          <figcaption>{framed ? "Ảnh đã ghép" : "Ảnh của bạn"}</figcaption>
        </figure>
        <figure className="done-card done-qr">
          <QRCodeSVG value={done.url} size={260} marginSize={2} />
          <figcaption>Quét QR</figcaption>
        </figure>
        <figure className="done-card">
          {done.video ? (
            <video src={done.video} autoPlay loop muted playsInline />
          ) : (
            <div className="done-empty">
              <PiFilmStripDuotone aria-hidden="true" />
              {done.videoPending ? "Đang làm video…" : "Chưa có video"}
            </div>
          )}
          <figcaption>Video</figcaption>
        </figure>
      </div>
      <h1 className="done-title">Quét QR để tải ảnh & video. Lấy ảnh tại khay ảnh.</h1>
      <p className={`done-print ${print === "failed" ? "is-warn" : ""}`} role="status">
        {print === "failed" ? <PiWarningCircleDuotone aria-hidden="true" /> : <PiPrinterDuotone aria-hidden="true" />}
        {!done.prints
          ? "Gói của bạn không kèm tờ in — tải ảnh bằng mã QR."
          : framed
            ? PRINT_TEXT[print] || PRINT_TEXT.sending
            : "Chưa có khung ảnh để in — nhờ nhân viên in giúp bạn."}
        {" · "}Vé {done.code} · ảnh lưu 24 giờ
      </p>
      {pending > 0 && <p className="done-sync">Đang tải {pending} ảnh gốc lên album — vui lòng giữ nguyên màn hình…</p>}
      <footer className="flow-foot">
        <Button className="kiosk-next" onClick={nextGuest}>Khách tiếp theo ({left}s)</Button>
      </footer>
    </section>
  );
}
