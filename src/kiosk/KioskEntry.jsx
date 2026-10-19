import {
  PiArrowRightBold as ArrowRight,
  PiBackspaceBold,
} from "react-icons/pi";
import { Brand, Button, ErrorBox } from "../studio";
import { canPickFolder } from "./folder.js";

export function KioskEntry({
  claim,
  error,
  device,
  code,
  setCode,
  busy,
  folder,
  folderAccess,
  children,
}) {
  return (
    <section className="kiosk-entry">
      <form className="kiosk-entry-card" onSubmit={claim}>
        <div className="kiosk-entry-brand">
          <Brand />
        </div>
        <h1>Bắt đầu buổi chụp</h1>
        <p>Nhập mã vé 6 số lễ tân đã cấp cho bạn.</p>
        <ErrorBox error={error} />
        {!device && (
          <p className="soft-note">
            Kiosk chưa được gán phòng. Mở liên kết Cài kiosk trong Quản trị →
            Phòng & chi nhánh.
          </p>
        )}
        <label className="code-slots">
          <input
            className="visually-hidden"
            aria-label="Mã vé"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
          />
          {Array.from({ length: 6 }, (_, i) => (
            <span
              key={i}
              className={
                code[i] ? "filled" : i === code.length ? "current" : ""
              }
            >
              {code[i] || ""}
            </span>
          ))}
        </label>
        <div className="keypad">
          {[
            "1",
            "2",
            "3",
            "4",
            "5",
            "6",
            "7",
            "8",
            "9",
            "clear",
            "0",
            "back",
          ].map((k) => (
            <button
              type="button"
              key={k}
              aria-label={
                k === "clear" ? "Xóa hết" : k === "back" ? "Xóa một số" : k
              }
              className={k.length > 1 ? "keypad-action" : ""}
              onClick={() =>
                setCode((v) =>
                  k === "clear"
                    ? ""
                    : k === "back"
                      ? v.slice(0, -1)
                      : (v + k).slice(0, 6),
                )
              }
            >
              {k === "clear" ? "Xóa" : k === "back" ? <PiBackspaceBold /> : k}
            </button>
          ))}
        </div>
        {!canPickFolder && (
          <p className="soft-note kiosk-folder-warning" role="alert">
            Máy chụp cần mở bằng Chrome hoặc Edge trên máy tính (Windows /
            macOS) để nhận ảnh từ máy ảnh.
          </p>
        )}
        {canPickFolder && (!folder || folderAccess !== "granted") && (
          <p className="soft-note kiosk-folder-warning">
            Máy chụp chưa đọc được thư mục ảnh của máy ảnh — nhân viên mở “Cài
            đặt máy chụp” bên dưới để {folder ? "cho phép" : "chọn"} thư mục.
          </p>
        )}
        <Button
          className="full kiosk-start"
          disabled={busy || !device || code.length !== 6}
        >
          {busy ? "Đang kiểm tra…" : "Bắt đầu chụp"} <ArrowRight size={18} />
        </Button>
        {children}
      </form>
    </section>
  );
}
