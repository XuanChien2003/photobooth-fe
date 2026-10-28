import { useEffect, useRef, useState } from "react";
import {
  PiArrowLeftBold,
  PiArrowRightBold,
  PiBackspaceBold,
  PiMoneyWavyDuotone,
  PiMinusBold,
  PiPlusBold,
  PiTicketBold,
  PiWarningCircleBold,
} from "react-icons/pi";
import { money } from "../api";
import { Brand, Button, ErrorBox } from "../studio";
import { billAcceptor } from "./bill-acceptor.js";

const IDLE_SECONDS = 120;
const SIM_BILLS = [10000, 20000, 50000, 100000];

// Chọn khổ ảnh từ những gói thật trong Bảng giá, giữ đúng giá đã cấu hình.
export function KioskPackages({ packages, onPick, onBack }) {
  const [selectedId, setSelectedId] = useState("");
  const selected = packages.find((pack) => pack._id === selectedId);
  return (
    <section className="kiosk-flow package-screen size-screen">
      <header className="flow-head">
        <Brand />
        <h1>Chọn khổ ảnh</h1>
        <p>Chạm vào khổ ảnh bạn muốn. Giá nằm ngay dưới mỗi lựa chọn.</p>
      </header>
      <div className="kiosk-size-grid" role="group" aria-label="Chọn khổ ảnh và gói chụp">
        {packages.map((pack) => {
          const strip = pack.printSize === "strip" || (!pack.printSize && /strip|mini|nhỏ|bé/i.test(pack.name));
          return <button
            type="button"
            key={pack._id}
            className={`kiosk-size ${strip ? "strip" : "full"} ${selectedId === pack._id ? "active" : ""}`}
            aria-pressed={selectedId === pack._id}
            onClick={() => setSelectedId(pack._id)}
          >
            <span className="kiosk-size-art" aria-hidden="true"><i /><i /></span>
            <strong>{pack.name}</strong>
            <small>{pack.shots} lần chụp · kèm {Number(pack.prints) || 0} bản in</small>
            <b>{money(pack.price)}</b>
            {pack.description && <small>{pack.description}</small>}
          </button>;
        })}
        {!packages.length && <p className="soft-note">Chưa có gói chụp cho máy này. Nhờ nhân viên kiểm tra mục Bảng giá.</p>}
      </div>
      <footer className="flow-foot kiosk-step-nav">
        <Button className="outline" onClick={onBack}>
          <PiArrowLeftBold aria-hidden="true" /> Quay lại
        </Button>
        <Button disabled={!selected} onClick={() => onPick(selected)}>
          Tiếp tục <PiArrowRightBold aria-hidden="true" />
        </Button>
      </footer>
    </section>
  );
}

// Giá gói đã gồm số bản in của gói; chỉ bản in thêm mới cộng vào tổng tiền.
export function KioskPrintCount({ pack, prints, extraPrintPrice, onChange, onNext, onBack }) {
  const included = Number(pack.prints) || 0;
  const extra = Math.max(0, prints - included);
  const canAdd = Number.isFinite(extraPrintPrice) && extraPrintPrice >= 0;
  const total = (Number(pack.price) || 0) + extra * (extraPrintPrice || 0);
  return (
    <section className="kiosk-flow print-screen">
      <header className="flow-head">
        <Brand />
        <h1>Chọn số bản in</h1>
        <p>Gói {pack.name} đã kèm {included} bản in.</p>
      </header>
      <div className="print-choice">
        <div className="kiosk-counter" aria-label="Số bản in">
          <button type="button" aria-label="Giảm số bản in" disabled={prints <= included} onClick={() => onChange(prints - 1)}><PiMinusBold /></button>
          <output aria-live="polite">{prints}</output>
          <button type="button" aria-label="Tăng số bản in" disabled={!canAdd || extra >= 20} onClick={() => onChange(prints + 1)}><PiPlusBold /></button>
        </div>
        <div className="kiosk-price">
          <span>Tổng tiền</span>
          <strong>{money(total)}</strong>
          <small>{extra ? `${money(pack.price)} tiền gói + ${extra} × ${money(extraPrintPrice)} bản in thêm` : `Đã gồm ${included} bản in trong gói`}</small>
          {!canAdd && <small>Nhân viên cần đặt “Giá in thêm” trong quản trị để khách chọn thêm bản in.</small>}
        </div>
      </div>
      <footer className="flow-foot kiosk-step-nav">
        <Button className="outline" onClick={onBack}><PiArrowLeftBold aria-hidden="true" /> Quay lại</Button>
        <Button onClick={onNext}>Chọn thanh toán <PiArrowRightBold aria-hidden="true" /></Button>
      </footer>
    </section>
  );
}

// Mã trả trước được nhập ngay tại bước thanh toán. Máy nhận tiền chỉ mở sau khi chọn tiền mặt.
export function KioskPayment({ pack, total, prints, code, setCode, onVoucher, bills, onBack, cashReady = false, ...cashProps }) {
  const [method, setMethod] = useState(() => bills.length ? "cash" : "choice");
  const { busy, error, cameraReady } = cashProps;
  if (method === "cash")
    return <CashPayment
      {...cashProps}
      cashReady={cashReady}
      pack={pack}
      total={total}
      prints={prints}
      bills={bills}
      onBack={() => setMethod("choice")}
    />;
  return (
    <section className="kiosk-flow pay-screen payment-choice-screen">
      <header className="flow-head">
        <Brand />
        <h1>Chọn cách thanh toán</h1>
        <p>{pack.name} · {prints} bản in · tổng {money(total)}</p>
      </header>
      <ErrorBox error={error} />
      {!cameraReady && <p className="soft-note">Nhân viên cần chọn thư mục ảnh trong Cài đặt máy chụp trước khi thanh toán.</p>}
      <div className="payment-choices">
        <form className="payment-voucher" onSubmit={onVoucher}>
          <PiTicketBold className="payment-icon" aria-hidden="true" />
          <h2>Đã thanh toán tại quầy</h2>
          <p>Nhập mã voucher 6 số nhân viên đã cấp.</p>
          <label htmlFor="voucher-code">Mã voucher</label>
          <input id="voucher-code" aria-label="Mã voucher" type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="••••••" />
          <div className="voucher-keypad" aria-label="Bàn phím nhập mã voucher">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"].map((key) =>
              <button type="button" key={key} aria-label={key === "clear" ? "Xóa hết mã" : key === "back" ? "Xóa một số" : key}
                onClick={() => setCode((value) => key === "clear" ? "" : key === "back" ? value.slice(0, -1) : (value + key).slice(0, 6))}>
                {key === "clear" ? "Xóa" : key === "back" ? <PiBackspaceBold /> : key}
              </button>
            )}
          </div>
          <Button type="submit" disabled={busy || !cameraReady || code.length !== 6}>{busy ? "Đang kiểm tra…" : "Dùng mã voucher"}</Button>
          <small>Voucher áp dụng gói và số bản in đã thanh toán tại quầy{prints > (Number(pack.prints) || 0) ? "; bản thêm chọn ở đây chỉ tính khi trả tiền mặt" : ""}.</small>
        </form>
        <div className="payment-cash">
          <PiMoneyWavyDuotone className="payment-icon" aria-hidden="true" />
          <h2>Tiền mặt</h2>
          <p>{cashReady ? `Đút tiền vào máy nhận tiền. Khi đủ ${money(total)}, lượt chụp sẽ tự mở.` : "Đang chờ kết nối máy nhận tiền và máy chủ để mở phương thức này."}</p>
          <Button type="button" disabled={busy || !cameraReady || !cashReady} onClick={() => setMethod("cash")}>Chọn tiền mặt <PiArrowRightBold aria-hidden="true" /></Button>
        </div>
      </div>
      <footer className="flow-foot"><Button className="outline" disabled={busy} onClick={onBack}><PiArrowLeftBold aria-hidden="true" /> Quay lại số bản in</Button></footer>
    </section>
  );
}

// Trả tiền: máy nhận tiền chỉ nhận tờ tiền ở màn này. Đủ tiền thì tự mở lượt chụp. Chế độ thử
// (chưa lắp máy nhận tiền) có nút bỏ qua và các nút giả lập đút tiền — lượt thử không tính tiền.
function CashPayment({ pack, total, prints, bills, onBill, onPaid, onSkip, onBack, testMode, busy, error, cameraReady, cashReady }) {
  const [status, setStatus] = useState(billAcceptor.status);
  const [idle, setIdle] = useState(IDLE_SECONDS);
  const [simulated, setSimulated] = useState(0);
  const received = bills.reduce((sum, bill) => sum + bill.amount, 0) + simulated;
  const remaining = Math.max(0, total - received);
  const paidOnce = useRef(false);
  useEffect(() => billAcceptor.onStatus(setStatus), []);
  // Máy nhận tiền chỉ mở nhận tiền khi đang ở màn này.
  useEffect(() => {
    let active = true;
    billAcceptor.accepting = () => cashReady && billAcceptor.connected && cameraReady && !paidOnce.current;
    billAcceptor.connect(false).then(
      (connected) => {
        if (active) billAcceptor.setEnabled(cashReady && Boolean(connected) && cameraReady && !paidOnce.current).catch(() => {});
      },
      () => { if (active) billAcceptor.setEnabled(false).catch(() => {}); },
    );
    const off = billAcceptor.onBill((amount) => {
      setIdle(IDLE_SECONDS);
      onBill(amount);
    });
    return () => {
      active = false;
      off();
      billAcceptor.accepting = () => billAcceptor.enabled;
      billAcceptor.setEnabled(false).catch(() => {});
    };
  }, [cameraReady, cashReady]);
  useEffect(() => {
    if (!cameraReady || !total || received < total || paidOnce.current) return;
    paidOnce.current = true;
    billAcceptor.setEnabled(false).catch(() => {});
    if (simulated) onSkip();
    else onPaid();
  }, [received, cameraReady]);
  // Không ai thao tác: chưa đút tiền thì về màn chờ; đã đút tiền thì giữ lại (gọi nhân viên).
  useEffect(() => {
    const timer = setInterval(() => setIdle((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!idle && !bills.length && !busy) onBack();
  }, [idle]);
  return (
    <section className="kiosk-flow pay-screen">
      <header className="flow-head">
        <h1>Đút tiền để bắt đầu chụp</h1>
        <p>{pack.name} · {prints} bản in · đưa tờ tiền thẳng, không gấp</p>
      </header>
      <ErrorBox error={error} />
      {!cameraReady && <p className="soft-note">Chưa đọc được thư mục ảnh máy ảnh. Máy nhận tiền đang khóa; nhờ nhân viên vào Cài đặt máy chụp để cấp quyền thư mục.</p>}
      <div className="pay-board">
        <div>
          <span>Tổng tiền</span>
          <strong>{money(total)}</strong>
        </div>
        <div>
          <span>Đã nhận</span>
          <strong className="pay-received">{money(received)}</strong>
        </div>
        <div className={remaining ? "pay-due" : "pay-done"}>
          <span>{remaining ? "Còn thiếu" : "Đã đủ tiền"}</span>
          <strong>{remaining ? money(remaining) : "✓"}</strong>
        </div>
      </div>
      <div className="pay-machine">
        <PiMoneyWavyDuotone aria-hidden="true" />
        <p>
          {busy
            ? "Đang mở lượt chụp…"
            : received > total
              ? `Bạn đã đút dư ${money(received - total)} — máy không trả tiền thừa, nhờ nhân viên hỗ trợ nhé.`
              : "Máy nhận tiền ở phía dưới màn hình. Máy nhận các tờ 10.000 – 500.000 đ."}
        </p>
        <small className={billAcceptor.connected ? "" : "is-warn"}>{status}</small>
      </div>
      {received >= total && error && !busy && (
        <Button className="kiosk-next" onClick={simulated ? onSkip : onPaid}>
          Thử mở lượt chụp lại <PiArrowRightBold aria-hidden="true" />
        </Button>
      )}
      {testMode && (
        <div className="pay-test" aria-label="Chế độ thử">
          <span>
            <PiWarningCircleBold aria-hidden="true" /> Chế độ thử — chưa lắp máy nhận tiền. Lượt thử không tính doanh thu.
          </span>
          <div>
            {SIM_BILLS.map((amount) => (
              <Button key={amount} className="outline small" disabled={busy}
                onClick={() => setSimulated((n) => n + amount)}>
                + {money(amount)}
              </Button>
            ))}
          </div>
        </div>
      )}
      <footer className="flow-foot">
        <Button className="outline" disabled={busy || bills.length > 0} onClick={onBack}>
          <PiArrowLeftBold aria-hidden="true" /> {bills.length ? `Đã nhận tiền (${idle}s)` : `Đổi cách thanh toán (${idle}s)`}
        </Button>
        {testMode && (
          <Button className="kiosk-next" disabled={busy} onClick={onSkip}>
            Tiếp — bỏ qua đút tiền (thử) <PiArrowRightBold aria-hidden="true" />
          </Button>
        )}
      </footer>
    </section>
  );
}
