import {
  PiDeviceMobileDuotone,
  PiFrameCornersDuotone,
  PiHeartDuotone,
  PiPrinterDuotone,
  PiSealCheckDuotone,
} from "react-icons/pi";
import { QRCodeSVG } from "qrcode.react";
import { formatDateTime } from "../api";
import { Button } from "../studio";

export function KioskDone({ done, pending, left, nextGuest }) {
  return (
    <section className="kiosk-done">
      <div className="kiosk-done-card">
        <span className="kiosk-entry-icon">
          <PiSealCheckDuotone />
        </span>
        <p className="kiosk-session-status">
          {done.expired ? "ĐÃ HẾT THỜI GIAN CHỤP" : "HOÀN TẤT BUỔI CHỤP"} · VÉ{" "}
          {done.code}
        </p>
        <h1>Quét mã để nhận {done.photos} ảnh</h1>
        <p>
          Mở camera điện thoại, quét mã QR rồi chọn ảnh, chỉnh sửa và ghép khung
          ngay trên máy của bạn.
        </p>
        <div className="kiosk-qr-box">
          <QRCodeSVG value={done.url} size={260} marginSize={2} />
        </div>
        <p className="kiosk-done-fallback">
          Không quét được? Nhờ lễ tân mở lại mã QR — mã vé <b>{done.code}</b>
        </p>
        <p className="kiosk-done-retention">
          Mỗi ảnh lưu miễn phí 24 giờ kể từ lúc chụp
          {done.expiresAt && (
            <> (ảnh đầu tiên tự xóa lúc {formatDateTime(done.expiresAt)})</>
          )}
        </p>
        <ol className="kiosk-done-steps">
          <li>
            <PiDeviceMobileDuotone /> Quét mã QR
          </li>
          <li>
            <PiHeartDuotone /> Chọn ảnh theo số ô của bộ khung
          </li>
          <li>
            <PiFrameCornersDuotone /> Chọn bộ khung & ghép ảnh
          </li>
          <li>
            <PiPrinterDuotone /> Gửi in tại quầy
          </li>
        </ol>
        {pending.length > 0 && (
          <p className="kiosk-done-sync">
            Đang đồng bộ {pending.length} ảnh cuối, vui lòng giữ nguyên màn
            hình…
          </p>
        )}
        <Button className="full kiosk-start" onClick={nextGuest}>
          Khách tiếp theo ({left}s)
        </Button>
      </div>
    </section>
  );
}
