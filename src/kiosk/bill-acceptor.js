// Máy nhận tiền giấy (ICT A7 / V7 và loại tương tự) cắm vào máy tính của máy chụp qua cổng
// USB-serial; trang máy chụp (Chrome / Edge) nói chuyện trực tiếp bằng Web Serial, không cần cài
// phần mềm riêng. Ba kiểu kết nối (chọn trong Cài đặt máy chụp):
// - "pulse" (mặc định): máy ICT để chế độ xung (DIP switch: Pulse, vd. 1 xung = 10.000 đ), mạch
//   Arduino Pro Micro đếm xung và gửi dòng "BILL <số tiền>" qua cổng COM; máy chụp gửi lại
//   ENABLE / DISABLE để mở / khóa máy đọc tiền (chân Inhibit). Mã mạch mẫu:
//   hardware/bill-acceptor-pulse/bill-acceptor-pulse.ino.
// - "keyboard": mạch Pro Micro giả lập bàn phím, mỗi xung gõ một phím (vd. "1") — không cần cấp
//   quyền cổng nhưng không khóa được máy đọc tiền.
// - "ict": cổng RS232 của máy ICT (qua cáp USB-RS232), máy giữ tờ tiền chờ máy chụp đồng ý.
// Mã lệnh ICT theo tài liệu giao thức RS232 phổ biến của ICT; khi lắp máy thật hãy đối chiếu tài
// liệu đi kèm model đã mua (tốc độ, chẵn lẻ, mệnh giá từng kênh chỉnh được trong cài đặt).
import { choosePort, savedPort } from "./serial-ports.js";

export const BILL_KEY = "kiosk-bill";
export const DEFAULT_BILL = {
  protocol: "pulse",
  // Kiểu bàn phím: phím mạch gõ cho mỗi xung và số tiền mỗi xung.
  key: "1",
  pulseValue: 10000,
  baud: 9600,
  parity: "even",
  // Mệnh giá theo kênh tiền của máy (kênh 1, 2, 3…) — theo firmware tiền Việt đã nạp vào máy.
  channels: [10000, 20000, 50000, 100000, 200000, 500000],
};
export const billSupported =
  typeof navigator !== "undefined" && "serial" in navigator;
export function readBillConfig() {
  try {
    return { ...DEFAULT_BILL, ...JSON.parse(localStorage.getItem(BILL_KEY)) };
  } catch {
    return { ...DEFAULT_BILL };
  }
}
export const saveBillConfig = (config) =>
  localStorage.setItem(BILL_KEY, JSON.stringify(config));

const ICT = {
  POWER_UP: 0x80,
  POWER_UP_2: 0x8f,
  ESCROW: 0x81,
  STACKED: 0x10,
  ACCEPT: 0x02,
  REJECT: 0x0f,
  ENABLE: 0x3e,
  INHIBIT: 0x5e,
  STATUS: 0x0c,
};
const ICT_ERRORS = {
  0x20: "Lỗi động cơ máy nhận tiền",
  0x21: "Lỗi kiểm tra tiền",
  0x22: "Kẹt tiền trong máy",
  0x23: "Tờ tiền bị rút ra",
  0x24: "Hộp đựng tiền đang mở",
  0x25: "Lỗi cảm biến",
  0x27: "Lỗi hộp đựng tiền",
  0x28: "Tờ tiền bị kéo ngược",
  0x29: "Máy trả lại tờ tiền",
  0x2a: "Lệnh không hợp lệ",
};

// Một máy nhận tiền cho cả trang. onBill(amount) khi một tờ tiền đã vào hộp; onStatus(text) báo
// trạng thái / lỗi cho nhân viên. accepting() quyết định có nhận tờ tiền đang chờ hay trả lại.
class BillAcceptor {
  port = null;
  reader = null;
  listeners = new Set();
  statusListeners = new Set();
  enabled = false;
  accepting = () => this.enabled;
  status = "Chưa kết nối";
  pendingEscrow = null;

  onBill(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onStatus(listener) {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }
  setStatus(text) {
    this.status = text;
    for (const listener of this.statusListeners) listener(text);
  }
  emit(amount) {
    for (const listener of this.listeners) listener(amount);
  }
  get connected() {
    return this.keyboard ? true : Boolean(this.port?.readable);
  }
  // Kiểu bàn phím: mỗi lần mạch gõ phím đã chọn = một xung. Các xung liền nhau (≤ 400 ms) gộp
  // thành một tờ tiền.
  listenKeyboard(config) {
    if (this.keyboard) return;
    let pulses = 0, timer = null;
    this.keyboard = (event) => {
      // Chỉ nghe ở màn trả tiền: ngoài lúc đó phím vẫn gõ bình thường (vd. ô nhập mã).
      if (!this.enabled || event.key !== String(config.key || "1") || event.repeat) return;
      event.preventDefault();
      pulses++;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const amount = pulses * (Number(config.pulseValue) || 10000);
        pulses = 0;
        this.setStatus(`Đã nhận ${amount.toLocaleString("vi-VN")} đ`);
        this.emit(amount);
      }, 400);
    };
    window.addEventListener("keydown", this.keyboard, true);
    this.setStatus("Đang nghe mạch giả lập bàn phím");
  }

  // ask = true: nhân viên chọn cổng (cần bấm nút). Không hỏi: mở lại cổng đã cho phép trước đó.
  async connect(ask = false) {
    if (!billSupported) throw new Error("Trình duyệt không hỗ trợ cổng USB (Web Serial). Dùng Chrome hoặc Edge.");
    const config = readBillConfig();
    if (config.protocol === "keyboard") {
      this.listenKeyboard(config);
      return true;
    }
    if (this.connected) return true;
    const port = ask ? await choosePort("bill") : await savedPort("bill");
    if (!port) return false;
    await port.open({
      baudRate: Number(config.baud) || 9600,
      dataBits: 8,
      stopBits: 1,
      parity: config.protocol === "ict" ? config.parity || "even" : "none",
    });
    this.port = port;
    this.setStatus("Đã kết nối máy nhận tiền");
    this.readLoop(config);
    if (config.protocol === "ict") await this.write([this.enabled ? ICT.ENABLE : ICT.INHIBIT]);
    else await this.writeText(this.enabled ? "ENABLE" : "DISABLE");
    return true;
  }
  async disconnect() {
    if (this.keyboard) {
      window.removeEventListener("keydown", this.keyboard, true);
      this.keyboard = null;
    }
    try {
      await this.reader?.cancel();
    } catch {}
    try {
      await this.port?.close();
    } catch {}
    this.port = null;
    this.setStatus("Chưa kết nối");
  }
  async write(bytes) {
    if (!this.port?.writable) return;
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(new Uint8Array(bytes));
    } finally {
      writer.releaseLock();
    }
  }
  writeText(line) {
    return this.write([...new TextEncoder().encode(`${line}\n`)]);
  }
  // Chỉ nhận tiền khi đang ở màn trả tiền; ngoài lúc đó máy từ chối mọi tờ tiền.
  async setEnabled(on) {
    this.enabled = on;
    if (this.keyboard || !this.port?.writable) return;
    if (readBillConfig().protocol === "ict") await this.write([on ? ICT.ENABLE : ICT.INHIBIT]);
    else await this.writeText(on ? "ENABLE" : "DISABLE");
  }

  async readLoop(config) {
    const port = this.port;
    let text = "";
    while (port.readable && this.port === port) {
      this.reader = port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (config.protocol === "ict") for (const byte of value) await this.ictByte(byte, config);
          else {
            text += new TextDecoder().decode(value);
            let newline;
            while ((newline = text.indexOf("\n")) >= 0) {
              this.pulseLine(text.slice(0, newline).trim());
              text = text.slice(newline + 1);
            }
          }
        }
      } catch (error) {
        this.setStatus(`Mất kết nối máy nhận tiền: ${error.message}`);
        break;
      } finally {
        this.reader.releaseLock();
      }
    }
    if (this.port === port) {
      this.port = null;
      this.setStatus("Máy nhận tiền đã ngắt kết nối");
    }
  }

  async ictByte(byte, config) {
    if (this.expectBillType) {
      this.expectBillType = false;
      const channel = byte - 0x40;
      const amount = config.channels[channel];
      if (!amount || !this.accepting(amount)) {
        await this.write([ICT.REJECT]);
        this.setStatus(amount ? "Đã trả lại tờ tiền (chưa tới bước trả tiền)" : `Tờ tiền kênh ${channel + 1} chưa cài mệnh giá — đã trả lại`);
        return;
      }
      this.pendingEscrow = amount;
      await this.write([ICT.ACCEPT]);
      // Máy báo đã nuốt tờ tiền (0x10); một số máy không báo — sau 5 giây coi như đã nhận.
      clearTimeout(this.escrowTimer);
      this.escrowTimer = setTimeout(() => this.stacked(), 5000);
      return;
    }
    if (byte === ICT.POWER_UP || byte === ICT.POWER_UP_2) {
      // Máy vừa bật: trả lời để máy hoạt động, rồi đặt lại trạng thái nhận / không nhận.
      await this.write([ICT.ACCEPT]);
      await this.write([this.enabled ? ICT.ENABLE : ICT.INHIBIT]);
      this.setStatus("Máy nhận tiền sẵn sàng");
    } else if (byte === ICT.ESCROW) this.expectBillType = true;
    else if (byte === ICT.STACKED) this.stacked();
    else if (ICT_ERRORS[byte]) this.setStatus(ICT_ERRORS[byte]);
  }
  stacked() {
    clearTimeout(this.escrowTimer);
    if (!this.pendingEscrow) return;
    const amount = this.pendingEscrow;
    this.pendingEscrow = null;
    this.setStatus(`Đã nhận ${amount.toLocaleString("vi-VN")} đ`);
    this.emit(amount);
  }

  pulseLine(line) {
    const bill = /^BILL\s+(\d+)$/i.exec(line);
    if (bill) {
      const amount = Number(bill[1]);
      if (this.enabled) this.emit(amount);
      else this.setStatus("Có tiền vào khi chưa tới bước trả tiền — kiểm tra lệnh DISABLE của mạch.");
    } else if (/^READY/i.test(line)) this.setStatus("Máy nhận tiền sẵn sàng");
    else if (/^ERROR/i.test(line)) this.setStatus(line);
  }
}

export const billAcceptor = new BillAcceptor();
