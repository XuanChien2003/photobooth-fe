import { useEffect, useState } from "react";
import {
  PiArrowLeftBold as ArrowLeft,
  PiArrowRightBold as ArrowRight,
  PiBackspaceBold,
} from "react-icons/pi";
import { Brand, Button, ErrorBox, useStudio } from "../studio";
import { canPickFolder } from "./folder.js";

export const ENTRY_STEPS = ["start", "code"];
const IDLE_MS = 90_000;

export function KioskEntry({
  step,
  setStep,
  claim,
  error,
  device,
  code,
  setCode,
  busy,
  folder,
  folderAccess,
  roomId,
  children,
}) {
  const { settings = {}, screens = [] } = useStudio();
  // Màn hình chờ: cấu hình riêng của máy này, không có thì cấu hình chung (Thiết lập → Màn hình chờ).
  const screen =
    screens.find((s) => s.rooms?.includes(roomId)) || screens.find((s) => s.isDefault);
  const legacy = settings.kiosk || {};
  const idle = screen
    ? { title: screen.title, subtitle: screen.subtitle, images: screen.images.map((i) => i.url), interval: screen.interval }
    : { title: legacy.idleTitle, subtitle: legacy.idleSubtitle, images: legacy.idleImage ? [legacy.idleImage] : [], interval: 6 };
  const [slide, setSlide] = useState(0);
  const slides = idle.images.length;
  useEffect(() => {
    setSlide(0);
    if (step !== "start" || slides < 2) return;
    const timer = setInterval(() => setSlide((i) => (i + 1) % slides), Math.max(2, idle.interval || 6) * 1000);
    return () => clearInterval(timer);
  }, [step, slides, idle.interval]);

  // If a guest walks away before entering a code, clear it and return to the attract screen.
  useEffect(() => {
    if (step === "start") return;
    let timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        setCode("");
        setStep("start");
      }, IDLE_MS);
    };
    reset();
    window.addEventListener("pointerdown", reset);
    window.addEventListener("keydown", reset);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
    };
  }, [step, setCode, setStep]);

  if (step === "start") {
    const image = idle.images[slide % Math.max(1, slides)];
    return (
      <section className="kiosk-entry kiosk-attract">
        <button
          type="button"
          className={`kiosk-tap ${image ? "has-image" : ""}`}
          onClick={() => setStep("code")}
          aria-label="Chạm để bắt đầu"
        >
          {image && (
            <span className="kiosk-polaroid" aria-hidden="true">
              <img key={image} className="kiosk-slide" src={image} alt="" />
            </span>
          )}
          <span className="kiosk-tap-copy">
            <Brand />
            <strong>{idle.title || <>Cười lên, <mark>mình chụp nhé!</mark></>}</strong>
            <span className="kiosk-hand">{idle.subtitle || "chụp xong in ngay · nhận ảnh trên điện thoại"}</span>
            <span className="kiosk-sticker">Chạm để bắt đầu</span>
          </span>
        </button>
      </section>
    );
  }

  return (
    <section className="kiosk-entry">
      <form className="kiosk-entry-card kiosk-step kiosk-code-step" onSubmit={claim}>
        <div className="kiosk-mast"><Brand /><span>MÃ CHỤP ĐÃ THANH TOÁN</span></div>
        <h1>Nhập mã chụp</h1>
        <p className="kiosk-hand">
          Nhập mã 6 số nhận tại quầy. Gói chụp, khổ ảnh và số bản in đã được xác nhận khi thanh toán.
        </p>
        <ErrorBox error={error} />
        {!device && (
          <p className="soft-note">
            Máy chụp chưa được gán phòng. Mở liên kết Cài máy chụp trong Quản trị →
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
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
          {Array.from({ length: 6 }, (_, i) => (
            <span
              key={i}
              className={code[i] ? "filled" : i === code.length ? "current" : ""}
            >
              {code[i] || ""}
            </span>
          ))}
        </label>
        <div className="keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"].map((k) => (
            <button
              type="button"
              key={k}
              aria-label={k === "clear" ? "Xóa hết" : k === "back" ? "Xóa một số" : k}
              className={k.length > 1 ? "keypad-action" : ""}
              onClick={() => setCode((v) =>
                k === "clear" ? "" : k === "back" ? v.slice(0, -1) : (v + k).slice(0, 6)
              )}
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
        <div className="kiosk-step-nav">
          <Button type="button" className="outline" onClick={() => setStep("start")}>
            <ArrowLeft size={18} /> Quay lại
          </Button>
          <Button type="submit" disabled={busy || !device || code.length !== 6}>
            {busy ? "Đang kiểm tra…" : "Bắt đầu chụp"} <ArrowRight size={18} />
          </Button>
        </div>
        {children}
      </form>
    </section>
  );
}
