import { useEffect, useRef, useState } from "react";
import {
  PiArrowLeftBold,
  PiArrowRightBold,
  PiMoneyWavyDuotone,
  PiTicketBold,
  PiWarningCircleBold,
} from "react-icons/pi";
import { money } from "../api";
import { Brand, Button, ErrorBox } from "../studio";
import { billAcceptor } from "./bill-acceptor.js";

const IDLE_SECONDS = 120;
const SIM_BILLS = [10000, 20000, 50000, 100000];

// Chọn gói chụp ngay tại máy (giá, số tấm, số tờ in).
export function KioskPackages({ packages, onPick, onCode, onBack, allowCode }) {
  return (
    <section className="kiosk-flow package-screen">
      <header className="flow-head">
        <Brand />
        <h1>Chọn gói chụp</h1>
        <p>Chạm vào gói bạn muốn, rồi trả tiền tại máy để bắt đầu chụp.</p>
      </header>
      <div className="package-choices">
        {packages.map((pack) => (
          <button type="button" key={pack._id} onClick={() => onPick(pack)}>
            <strong>{pack.name}</strong>
            <b>{money(pack.price)}</b>
            <span>
              {pack.shots} lần chụp · chọn {pack.selectCount || 4} tấm · {pack.prints} tờ in
            </span>
            {pack.description && <small>{pack.description}</small>}
          </button>
        ))}
        {!packages.length && <p className="soft-note">Chưa có gói chụp cho máy này. Nhờ nhân viên kiểm tra mục Bảng giá.</p>}
      </div>
      <footer className="flow-foot">
        <Button className="outline" onClick={onBack}>
          <PiArrowLeftBold aria-hidden="true" /> Quay lại
        </Button>
        {allowCode && (
          <Button className="outline" onClick={onCode}>
            <PiTicketBold aria-hidden="true" /> Đã có mã từ quầy
          </Button>
        )}
      </footer>
    </section>
  );
}

// Trả tiền: máy nhận tiền chỉ nhận tờ tiền ở màn này. Đủ tiền thì tự mở lượt chụp. Chế độ thử
// (chưa lắp máy nhận tiền) có nút bỏ qua và các nút giả lập đút tiền — lượt thử không tính tiền.
export function KioskPayment({ pack, bills, onBill, onPaid, onSkip, onBack, testMode, busy, error }) {
  const [status, setStatus] = useState(billAcceptor.status);
  const [idle, setIdle] = useState(IDLE_SECONDS);
  const [simulated, setSimulated] = useState(0);
  const received = bills.reduce((sum, bill) => sum + bill.amount, 0) + simulated;
  const remaining = Math.max(0, pack.price - received);
  const paidOnce = useRef(false);
  useEffect(() => billAcceptor.onStatus(setStatus), []);
  // Máy nhận tiền chỉ mở nhận tiền khi đang ở màn này.
  useEffect(() => {
    billAcceptor.accepting = () => !paidOnce.current;
    billAcceptor.connect(false).catch(() => {}).finally(() => billAcceptor.setEnabled(true).catch(() => {}));
    const off = billAcceptor.onBill((amount) => {
      setIdle(IDLE_SECONDS);
      onBill(amount);
    });
    return () => {
      off();
      billAcceptor.accepting = () => billAcceptor.enabled;
      billAcceptor.setEnabled(false).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!pack.price || received < pack.price || paidOnce.current) return;
    paidOnce.current = true;
    billAcceptor.setEnabled(false).catch(() => {});
    if (simulated) onSkip();
    else onPaid();
  }, [received]);
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
        <p>{pack.name} · đưa tờ tiền thẳng, không gấp, chiều nào cũng được</p>
      </header>
      <ErrorBox error={error} />
      <div className="pay-board">
        <div>
          <span>Giá gói</span>
          <strong>{money(pack.price)}</strong>
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
            : received > pack.price
              ? `Bạn đã đút dư ${money(received - pack.price)} — máy không trả tiền thừa, nhờ nhân viên hỗ trợ nhé.`
              : "Máy nhận tiền ở phía dưới màn hình. Máy nhận các tờ 10.000 – 500.000 đ."}
        </p>
        <small className={billAcceptor.connected ? "" : "is-warn"}>{status}</small>
      </div>
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
          <PiArrowLeftBold aria-hidden="true" /> {bills.length ? `Đã nhận tiền (${idle}s)` : `Quay lại (${idle}s)`}
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
