import { useEffect } from "react";
import {
  PiArrowLeftBold as ArrowLeft,
  PiArrowRightBold as ArrowRight,
  PiBackspaceBold,
  PiMinusBold,
  PiPlusBold,
} from "react-icons/pi";
import { money } from "../api";
import { Brand, Button, ErrorBox, useStudio } from "../studio";
import { canPickFolder } from "./folder.js";

// Các bước trước khi chụp (kiểu Mellow): chạm để bắt đầu → chọn khổ → chọn số tờ in → nhập mã.
export const ENTRY_STEPS = ["start", "size", "prints", "code"];
const IDLE_MS = 90_000;
const SIZES = {
  strip: { title: "Khung bé", detail: "2 ảnh nhỏ · tờ 10 × 15 cm cắt đôi" },
  full: { title: "Khung to", detail: "2 ảnh lớn · tờ 10 × 15 cm nguyên bản" },
};

// Gói rẻ nhất của mỗi khổ quyết định giá hiển thị trên kiosk.
export function sizeOptions(packages = []) {
  const bySize = {};
  for (const p of packages)
    if (p.active !== false && SIZES[p.printSize || "full"] && !bySize[p.printSize || "full"])
      bySize[p.printSize || "full"] = p;
  return bySize;
}

// Khổ bé: một tờ 10 × 15 cm cắt thành 2 ảnh; khổ to: mỗi tờ là một ảnh.
export const photosPerSheet = (size) => (size === "strip" ? 2 : 1);
export const includedSheets = (pack) => Math.max(1, Number(pack?.prints) || 1);

// prints tính theo tờ (như vé); phần vượt số tờ của gói tính theo giá in thêm mỗi tờ.
export function printsPrice(pack, sheets, extraPrice) {
  if (!pack) return 0;
  return (Number(pack.price) || 0) +
    Math.max(0, sheets - includedSheets(pack)) * (Number(extraPrice) || 0);
}

export function KioskEntry({
  step,
  setStep,
  size,
  setSize,
  prints,
  setPrints,
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
  const { packages = [], settings = {} } = useStudio();
  const options = sizeOptions(packages);
  const pack = options[size];
  const minSheets = includedSheets(pack);
  const perSheet = photosPerSheet(size);
  const extraPrice = Number(settings.extraPrintPrice) || 0;
  // Đổi khổ, gói đổi số tờ, hoặc khách mới (về màn chờ): bắt đầu lại từ số tờ có sẵn trong gói.
  const atStart = step === "start";
  useEffect(() => setPrints(minSheets), [size, minSheets, atStart]);

  // Khách bỏ đi giữa chừng: quay về màn chờ, xóa mã đang nhập.
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
  }, [step]);

  if (step === "start") {
    // Màn hình chờ: chữ và ảnh nền do chủ cửa hàng đặt trong Quản trị → Kiosk & sticker.
    const idle = settings.kiosk || {};
    return (
      <section className="kiosk-entry kiosk-attract">
        <button
          type="button"
          className={`kiosk-tap ${idle.idleImage ? "has-image" : ""}`}
          onClick={() => setStep("size")}
          aria-label="Chạm để bắt đầu"
        >
          {idle.idleImage && (
            <span className="kiosk-polaroid" aria-hidden="true">
              <img src={idle.idleImage} alt="" />
            </span>
          )}
          <span className="kiosk-tap-copy">
            <Brand />
            <strong>{idle.idleTitle || <>Cười lên, <mark>mình chụp nhé!</mark></>}</strong>
            <span className="kiosk-hand">{idle.idleSubtitle || "chạm vào màn hình để bắt đầu"}</span>
            <span className="kiosk-sticker">Tap to start</span>
          </span>
        </button>
      </section>
    );
  }

  const nav = (back, next, nextDisabled, nextLabel = "Next") => (
    <div className="kiosk-step-nav">
      <Button type="button" className="outline" onClick={back}>
        <ArrowLeft size={18} /> Back
      </Button>
      <Button
        type={next ? "button" : "submit"}
        disabled={nextDisabled}
        onClick={next || undefined}
      >
        {nextLabel} <ArrowRight size={18} />
      </Button>
    </div>
  );

  if (step === "size")
    return (
      <section className="kiosk-entry">
        <div className="kiosk-entry-card kiosk-step">
          <div className="kiosk-mast"><Brand /><span>Bước 01 / 03 · Khổ ảnh</span></div>
          <h1>Choose the size</h1>
          <p className="kiosk-hand">chọn khổ ảnh đúng với gói bạn đã mua ở quầy</p>
          <ErrorBox error={error} />
          <div className="kiosk-size-grid">
            {Object.entries(SIZES).map(([key, info]) => (
              <button
                type="button"
                key={key}
                className={`kiosk-size ${key} ${size === key ? "active" : ""}`}
                aria-pressed={size === key}
                disabled={!options[key]}
                onClick={() => setSize(key)}
              >
                <span className="kiosk-size-art" aria-hidden="true"><i /><i /></span>
                <strong>{info.title}</strong>
                <small>{info.detail}</small>
                <b>{options[key] ? money(options[key].price) : "Chưa mở bán"}</b>
              </button>
            ))}
          </div>
          {nav(() => setStep("start"), () => setStep("prints"), !pack)}
        </div>
      </section>
    );

  if (step === "prints")
    return (
      <section className="kiosk-entry">
        <div className="kiosk-entry-card kiosk-step">
          <div className="kiosk-mast"><Brand /><span>Bước 02 / 03 · Số ảnh in</span></div>
          <h1>Choose the number of prints</h1>
          <p className="kiosk-hand">{SIZES[size]?.title} · tối thiểu {minSheets * perSheet} ảnh in</p>
          <div className="kiosk-counter" role="group" aria-label="Số bản in">
            <button
              type="button"
              aria-label="Bớt ảnh in"
              disabled={prints <= minSheets}
              onClick={() => setPrints((n) => Math.max(minSheets, n - 1))}
            >
              <PiMinusBold />
            </button>
            <output aria-live="polite">{prints * perSheet}</output>
            <button
              type="button"
              aria-label="Thêm ảnh in"
              disabled={prints >= 20}
              onClick={() => setPrints((n) => Math.min(20, n + 1))}
            >
              <PiPlusBold />
            </button>
          </div>
          <div className="kiosk-price">
            <strong>{money(printsPrice(pack, prints, extraPrice))}</strong>
            <small>
              {prints} tờ 10 × 15 cm{perSheet > 1 ? ` · cắt thành ${prints * perSheet} ảnh nhỏ` : ""}
            </small>
            {prints > minSheets && (
              <small>
                Gồm {prints - minSheets} tờ in thêm × {money(extraPrice)} — thanh
                toán phần thêm tại quầy trước khi nhận ảnh.
              </small>
            )}
          </div>
          {nav(() => setStep("size"), () => setStep("code"), false)}
        </div>
      </section>
    );

  return (
    <section className="kiosk-entry">
      <form className="kiosk-entry-card kiosk-step kiosk-code-step" onSubmit={claim}>
        <div className="kiosk-mast"><Brand /><span>Bước 03 / 03 · Mã chụp</span></div>
        <h1>Nhập mã chụp</h1>
        <p className="kiosk-hand">nhập mã 6 số lễ tân đã đưa cho bạn</p>
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
        {nav(
          () => setStep("prints"),
          null,
          busy || !device || code.length !== 6,
          busy ? "Đang kiểm tra…" : "Next",
        )}
        {children}
      </form>
    </section>
  );
}
