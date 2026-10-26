import { useEffect, useState } from "react";
import { Button } from "../studio";
import { CROP_KEY } from "./live-preview-layout.js";
import { pressShutter } from "./shutter.js";
import { connectCanonCamera, readCanonConfig, saveCanonConfig, watchCanonCamera } from "./canon-camera.js";
import { billAcceptor, billSupported, readBillConfig, saveBillConfig } from "./bill-acceptor.js";
const money = (n) => `${Number(n).toLocaleString("vi-VN")} đ`;

export function KioskDevices({ zoom, setZoom, roomInfo, toast }) {
  const [config, setConfig] = useState(readCanonConfig);
  const [camera, setCamera] = useState({ connected: false });
  const [cameraBusy, setCameraBusy] = useState(false);
  useEffect(() => watchCanonCamera(setCamera), []);
  const [bill, setBill] = useState(readBillConfig);
  const [billStatus, setBillStatus] = useState(billAcceptor.status);
  const [testing, setTesting] = useState(false);
  const [received, setReceived] = useState([]);
  useEffect(() => billAcceptor.onStatus(setBillStatus), []);
  useEffect(() => {
    if (!testing) return;
    billAcceptor.setEnabled(true).catch(() => {});
    const off = billAcceptor.onBill((amount) => setReceived((list) => [amount, ...list].slice(0, 6)));
    return () => { off(); billAcceptor.setEnabled(false).catch(() => {}); };
  }, [testing]);
  const saveBill = (next) => { setBill(next); saveBillConfig(next); };
  const run = async (action, success) => {
    try { await action(); if (success) toast.success(success); }
    catch (e) { if (e.name !== "NotFoundError") toast.error(e.message); }
  };
  const cameraAction = async (action, success) => {
    setCameraBusy(true);
    try { saveCanonConfig(config); await run(action, success); }
    finally { setCameraBusy(false); }
  };
  return (
    <div className="kiosk-devices">
      <label className="kiosk-range">
        <span>Cắt viền hình trực tiếp <b>{Math.round(zoom * 100)}%</b></span>
        <input type="range" min="0" max="30" value={Math.round(zoom * 100)}
          onChange={(e) => { const value = Number(e.target.value) / 100; setZoom(value); localStorage.setItem(CROP_KEY, String(value)); }} />
        <small>Khung AF nằm trong tín hiệu HDMI phải tắt trên Canon R100; thanh này chỉ cắt mép.</small>
      </label>
      <fieldset className="kiosk-device-box">
        <legend>Canon EOS R100 · kết nối chụp ảnh</legend>
        <p className={`kiosk-shutter-status ${camera.connected ? "is-ok" : "is-warn"}`} role="status">
          {camera.connected ? `${camera.model || "Canon EOS R100"} đã kết nối USB` : "Chưa kết nối Canon R100 qua USB"}
          {camera.folder && ` · ảnh lưu tại ${camera.folder}`}
        </p>
        <ol className="kiosk-device-steps">
          <li>Canon R100: khuyến nghị firmware 1.3.0 để dùng EDSDK. Cắm cáp USB dữ liệu vào máy tính và ngắt kết nối Wi-Fi trên máy ảnh.</li>
          <li>Trên Windows, mở Canon Camera Agent đã cài Canon EDSDK x64. Thoát EOS Utility và EOS Webcam Utility để chương trình dùng được máy ảnh.</li>
          <li>Nhập mã kết nối do Camera Agent hiển thị, bấm Kết nối R100 rồi chọn đúng thư mục ảnh mà chương trình báo.</li>
          <li>Bấm thử: máy ảnh phải chụp thật và nhận JPEG gốc; xác nhận flash rời trước khi đón khách.</li>
        </ol>
        <p className="kiosk-device-note"><a href="/downloads/canon-camera-agent.zip" download>Tải bộ cài Canon Camera Agent cho Windows</a> · cần Canon EDSDK x64 cài riêng theo giấy phép Canon.</p>
        <label>Mã kết nối Canon Camera Agent
          <input type="password" autoComplete="off" value={config.token || ""}
            onChange={(e) => setConfig({ token: e.target.value })} />
        </label>
        <div className="kiosk-device-row">
          <Button type="button" className="small" disabled={cameraBusy || !config.token?.trim()}
            onClick={() => cameraAction(() => connectCanonCamera(), "Đã kết nối Canon R100 qua USB.")}>Kết nối R100</Button>
          <Button type="button" className="outline small" disabled={cameraBusy || !config.token?.trim()}
            onClick={() => cameraAction(() => pressShutter(), "Đã gửi lệnh chụp thử. Kiểm tra JPEG gốc và flash rời.")}>Bấm thử</Button>
        </div>
        {camera.error && <p className="kiosk-check-result is-warn" role="alert">{camera.error}</p>}
        <p className="kiosk-device-note">Hẹn giờ: kết nối máy ảnh → đếm 3–2–1 → máy ảnh tự chụp. Bấm dây: cắm RS-60E3 hoặc dây tương thích vào cổng remote của R100; khách nhấn dây, kiosk chỉ nhận ảnh. Không cắm dây bấm vào cổng MIC.</p>
        <p className="kiosk-device-note">Flash: dùng chế độ chụp ảnh P/Tv/Av/M, tắt Silent shutter, chọn Single shooting và JPEG Large/Fine. Kiểm tra flash/trigger tương thích Canon R100 và tốc độ đồng bộ theo hướng dẫn của phụ kiện.</p>
        <p className="kiosk-device-note">Hình trực tiếp dùng micro-HDMI → thẻ ghi hình USB. Bấm INFO để kiểm tra hiển thị; nếu vẫn còn ô AF ở chế độ ảnh, có thể dùng MF và chỉnh nét vào vị trí khách đứng. Kiểm tra ảnh thử trước khi đón khách.</p>
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
