import { useEffect, useState } from "react";
import { Button } from "../studio";
import { CROP_KEY } from "./live-preview-layout.js";
import {
  arduinoConnected,
  chooseShutterPort,
  connectRelay,
  DEFAULT_RELAY,
  forgetShutterPort,
  hasOwnShutterPort,
  hexBytes,
  pressArduino,
  pressRelay,
  readRelay,
  readShutter,
  RELAY_KEY,
  relayConnected,
  relaySupported,
  SHUTTER_KEY,
} from "./shutter.js";
import { billAcceptor, billSupported, readBillConfig, saveBillConfig } from "./bill-acceptor.js";

const money = (n) => `${Number(n).toLocaleString("vi-VN")} đ`;

// Cài đặt thiết bị của máy chụp (nhân viên): cắt viền thông số HDMI, cách tự chụp ở chế độ đếm
// giờ, máy đọc tiền. Lưu trên chính máy tính này.
export function KioskDevices({ zoom, setZoom, roomInfo, toast }) {
  const [shutter, setShutter] = useState(readShutter);
  const [relay, setRelay] = useState(readRelay);
  const [relayOn, setRelayOn] = useState(relayConnected);
  const [ownPort, setOwnPort] = useState(hasOwnShutterPort);
  const [arduinoOn, setArduinoOn] = useState(arduinoConnected);
  const pickShutter = (mode) => {
    setShutter(mode);
    localStorage.setItem(SHUTTER_KEY, mode);
  };
  const [bill, setBill] = useState(readBillConfig);
  const [billStatus, setBillStatus] = useState(billAcceptor.status);
  const [testing, setTesting] = useState(false);
  const [received, setReceived] = useState([]);
  useEffect(() => billAcceptor.onStatus((text) => {
    setBillStatus(text);
    setArduinoOn(arduinoConnected());
  }), []);
  // Thử máy đọc tiền: mở nhận tiền tạm thời, hiện các tờ vừa nhận (không tính tiền).
  useEffect(() => {
    if (!testing) return;
    billAcceptor.setEnabled(true).catch(() => {});
    const off = billAcceptor.onBill((amount) => setReceived((list) => [amount, ...list].slice(0, 6)));
    return () => {
      off();
      billAcceptor.setEnabled(false).catch(() => {});
    };
  }, [testing]);
  const saveRelay = (next) => {
    setRelay(next);
    localStorage.setItem(RELAY_KEY, JSON.stringify(next));
  };
  const saveBill = (next) => {
    setBill(next);
    saveBillConfig(next);
  };
  const run = async (action, success) => {
    try {
      await action();
      if (success) toast.success(success);
    } catch (e) {
      if (e.name !== "NotFoundError") toast.error(e.message);
    }
  };
  return (
    <div className="kiosk-devices">
      <label className="kiosk-range">
        <span>
          Cắt viền thông số máy ảnh trên hình trực tiếp <b>{Math.round(zoom * 100)}%</b>
        </span>
        <input
          type="range"
          min="0"
          max="30"
          value={Math.round(zoom * 100)}
          onChange={(e) => {
            const value = Number(e.target.value) / 100;
            setZoom(value);
            localStorage.setItem(CROP_KEY, String(value));
          }}
        />
        <small>
          Tăng tới khi hết thấy thước số / khung lưới ở mép. Tốt nhất tắt trên máy ảnh: SET UP →
          CONNECTION SETTING → HDMI OUTPUT INFO DISPLAY = OFF; SCREEN SET-UP → IMAGE DISP. = OFF (hình
          không nhảy sang ảnh vừa chụp).
        </small>
      </label>

      <fieldset className="kiosk-device-box">
        <legend>Tự chụp khi chọn “Đếm giờ”</legend>
        <label className="checkbox">
          <input type="radio" name="shutter" checked={shutter === "arduino"} disabled={!relaySupported}
            onChange={() => pickShutter("arduino")} />
          Bấm máy qua Arduino như dây bấm — máy ảnh chụp thật, có flash, ảnh gốc nét nhất (khuyên dùng)
        </label>
        {shutter === "arduino" && (
          <>
            <p className="kiosk-device-note">
              Dùng chung mạch Pro Micro của máy nhận tiền (nạp mã mới: hardware/bill-acceptor-pulse). D5 → opto lấy
              nét, D6 → opto chụp, đầu ra opto nối song song với dây bấm (jack chia 1 ra 2). Trên máy ảnh: SHUTTER
              TYPE = MECHANICAL (màn trập điện tử không nháy flash), RELEASE/FOCUS PRIORITY = RELEASE, MIC/REMOTE
              RELEASE = REMOTE nếu có. Còn 1 giây máy nhấn nửa để lấy nét, hết giờ chụp ngay. Mạch chưa sẵn sàng
              thì tạm lấy hình HDMI.
            </p>
            <div className="kiosk-device-row">
              <Button type="button" className="outline small"
                onClick={() => run(async () => { await pressArduino(); setArduinoOn(arduinoConnected()); },
                  "Đã bấm thử — máy ảnh phải chụp 1 tấm (flash nổ).")}>
                Bấm thử
              </Button>
              {ownPort ? (
                <Button type="button" className="outline small"
                  onClick={() => { forgetShutterPort(); setOwnPort(false); setArduinoOn(arduinoConnected()); }}>
                  Dùng chung mạch máy nhận tiền
                </Button>
              ) : (
                <Button type="button" className="outline small"
                  onClick={() => run(async () => {
                    await chooseShutterPort();
                    setOwnPort(true);
                    setArduinoOn(arduinoConnected());
                  }, "Đã chọn cổng riêng cho mạch bấm máy.")}>
                  Mạch riêng? Chọn cổng
                </Button>
              )}
            </div>
            <p className="kiosk-device-note" role="status">
              {ownPort ? "Mạch bấm máy riêng" : "Dùng chung mạch máy nhận tiền"} ·{" "}
              {arduinoOn ? "đã kết nối" : "chưa kết nối (bấm thử để mở cổng)"}
            </p>
          </>
        )}
        <label className="checkbox">
          <input type="radio" name="shutter" checked={shutter === "relay"} disabled={!relaySupported}
            onChange={() => pickShutter("relay")} />
          Bấm máy ảnh bằng relay USB nối song song dây bấm (ảnh gốc máy ảnh, có flash)
        </label>
        {shutter === "relay" && (
          <div className="kiosk-device-row">
            <Button type="button" className="outline small"
              onClick={() => run(async () => { await connectRelay(true); setRelayOn(relayConnected()); }, "Đã kết nối relay.")}>
              {relayOn ? "Đổi cổng relay" : "Kết nối relay"}
            </Button>
            <Button type="button" className="outline small" disabled={!relayOn}
              onClick={() => run(() => pressRelay(relay), "Đã bấm thử — máy ảnh phải chụp 1 tấm.")}>
              Bấm thử
            </Button>
            <label>
              Lệnh bật
              <input value={relay.on} onChange={(e) => saveRelay({ ...relay, on: e.target.value })}
                onBlur={() => run(() => hexBytes(relay.on))} />
            </label>
            <label>
              Lệnh tắt
              <input value={relay.off} onChange={(e) => saveRelay({ ...relay, off: e.target.value })}
                onBlur={() => run(() => hexBytes(relay.off))} />
            </label>
            <label>
              Giữ (ms)
              <input type="number" min="50" max="2000" value={relay.ms}
                onChange={(e) => saveRelay({ ...relay, ms: Number(e.target.value) || DEFAULT_RELAY.ms })} />
            </label>
          </div>
        )}
        <label className="checkbox">
          <input type="radio" name="shutter" checked={shutter === "hdmi"} onChange={() => pickShutter("hdmi")} />
          Lấy khung hình từ hình trực tiếp HDMI (không cần thêm thiết bị, ảnh 1080p, không có flash)
        </label>
      </fieldset>

      <fieldset className="kiosk-device-box">
        <legend>Máy đọc tiền (ICT)</legend>
        <p className="kiosk-device-note">
          Trả tiền tại máy:{" "}
          <b>
            {roomInfo?.payment === "cash" ? "đang bật" : "đang tắt (khách nhập mã từ quầy)"}
            {roomInfo?.paymentTest ? " · chế độ thử: có nút bỏ qua đút tiền" : ""}
          </b>{" "}
          — bật / tắt ở Quản trị → Quản lý máy.
        </p>
        <label>
          Kiểu kết nối
          <select value={bill.protocol} onChange={(e) => saveBill({ ...bill, protocol: e.target.value })}>
            <option value="pulse">Xung qua Arduino Pro Micro — cổng COM (khuyên dùng)</option>
            <option value="keyboard">Xung qua Pro Micro giả lập bàn phím</option>
            <option value="ict">RS232 của máy ICT (cáp USB-RS232)</option>
          </select>
        </label>
        {bill.protocol === "keyboard" && (
          <div className="kiosk-device-row">
            <label>
              Phím mạch gõ mỗi xung
              <input maxLength={1} value={bill.key} onChange={(e) => saveBill({ ...bill, key: e.target.value || "1" })} />
            </label>
            <label>
              Mỗi xung (đ)
              <input type="number" step="1000" min="1000" value={bill.pulseValue}
                onChange={(e) => saveBill({ ...bill, pulseValue: Number(e.target.value) || 10000 })} />
            </label>
          </div>
        )}
        {bill.protocol === "ict" && (
          <label>
            Mệnh giá kênh 1, 2, 3… (đ, cách nhau dấu phẩy)
            <input
              value={bill.channels.join(", ")}
              onChange={(e) => saveBill({
                ...bill,
                channels: e.target.value.split(/[,\s]+/).map(Number).filter((n) => n > 0),
              })}
            />
          </label>
        )}
        <div className="kiosk-device-row">
          {bill.protocol !== "keyboard" && (
            <Button type="button" className="outline small" disabled={!billSupported}
              onClick={() => run(async () => {
                await billAcceptor.disconnect();
                await billAcceptor.connect(true);
              }, "Đã kết nối máy đọc tiền.")}>
              Chọn cổng máy đọc tiền
            </Button>
          )}
          <Button type="button" className="outline small"
            onClick={() => run(async () => {
              await billAcceptor.connect(false);
              setReceived([]);
              setTesting((on) => !on);
            })}>
            {testing ? "Dừng thử" : "Thử nhận tiền"}
          </Button>
        </div>
        <p className="kiosk-device-note" role="status">
          {billStatus}
          {testing && (received.length ? ` · vừa nhận: ${received.map(money).join(", ")}` : " · mời đút thử một tờ tiền")}
        </p>
      </fieldset>
    </div>
  );
}
