import { visibleRegion } from "./live-preview-layout.js";
import { choosePort, savedPort } from "./serial-ports.js";
import { billAcceptor, readBillConfig } from "./bill-acceptor.js";

// Chế độ "Đếm giờ": hết đếm ngược thì máy chụp tự chụp. Trình duyệt không điều khiển được máy
// ảnh Fujifilm qua X Acquire, nên bấm máy giống hệt dây bấm (máy ảnh chụp thật, flash nổ, ảnh gốc
// về thư mục X Acquire như khi khách tự bấm):
// - "arduino" (mặc định): mạch Arduino Pro Micro (dùng chung với máy nhận tiền) nhận lệnh "SHOOT"
//   qua cổng COM, nhấn nửa (lấy nét) rồi nhấn hết qua 2 opto nối song song với dây bấm.
//   Mã mạch: hardware/bill-acceptor-pulse/bill-acceptor-pulse.ino.
// - "relay": mạch relay USB (Web Serial) nối song song với nút chụp của dây bấm.
// - "hdmi": lấy khung hình đang phát từ thẻ ghi hình HDMI (không cần thêm thiết bị, ảnh 1080p,
//   KHÔNG có flash) — cũng là đường lui khi mạch chưa sẵn sàng.
export const SHUTTER_KEY = "kiosk-shutter";
export const RELAY_KEY = "kiosk-relay";
export const SHUTTER_MODES = ["arduino", "relay", "hdmi"];
// Lệnh mặc định của module relay USB 1 kênh phổ biến (LCUS-1, chip CH340): bật / tắt kênh 1.
export const DEFAULT_RELAY = { on: "A0 01 01 A2", off: "A0 01 00 A1", ms: 300, baud: 9600 };

export const relaySupported =
  typeof navigator !== "undefined" && "serial" in navigator;
export const readShutter = () => {
  const saved = globalThis.localStorage?.getItem(SHUTTER_KEY);
  return SHUTTER_MODES.includes(saved) ? saved : "arduino";
};
export function readRelay() {
  try {
    return { ...DEFAULT_RELAY, ...JSON.parse(localStorage.getItem(RELAY_KEY)) };
  } catch {
    return { ...DEFAULT_RELAY };
  }
}
export const hexBytes = (text) => {
  const parts = String(text).trim().split(/[\s,]+/).filter(Boolean);
  if (!parts.length || parts.some((p) => !/^(0x)?[0-9a-f]{1,2}$/i.test(p)))
    throw new Error("Lệnh relay phải là các byte hex, vd. A0 01 01 A2.");
  return new Uint8Array(parts.map((p) => parseInt(p.replace(/^0x/i, ""), 16)));
};

// Cổng USB-serial riêng của từng thiết bị bấm máy ("relay" hoặc mạch Arduino riêng "shutter").
const ports = new Map();
const opening = new Map();
// Mở cổng đã cho phép trước đó; ask = true thì hỏi nhân viên chọn cổng (cần bấm nút).
async function openPort(role, baud, ask) {
  if (!relaySupported) throw new Error("Trình duyệt không hỗ trợ cổng USB (Web Serial). Dùng Chrome hoặc Edge.");
  if (!ask && ports.get(role)?.writable) return ports.get(role);
  if (!opening.has(role))
    opening.set(role, (async () => {
      const chosen = ask ? await choosePort(role) : await savedPort(role);
      if (!chosen) return null;
      if (!chosen.writable) await chosen.open({ baudRate: baud });
      ports.set(role, chosen);
      navigator.serial.addEventListener?.("disconnect", (event) => {
        if (event.target === ports.get(role)) ports.delete(role);
      });
      return chosen;
    })().finally(() => opening.delete(role)));
  return opening.get(role);
}
async function send(port, bytes) {
  const writer = port.writable.getWriter();
  try {
    await writer.write(bytes);
  } finally {
    writer.releaseLock();
  }
}

export const connectRelay = (ask = false) => openPort("relay", readRelay().baud || 9600, ask);
export const relayConnected = () => Boolean(ports.get("relay")?.writable);
// Đóng relay trong `ms` mili giây (như bấm nút dây bấm) rồi nhả ra.
export async function pressRelay(config = readRelay()) {
  const port = await connectRelay(false);
  if (!port) throw new Error("Chưa kết nối relay chụp ảnh.");
  await send(port, hexBytes(config.on));
  await new Promise((resolve) => setTimeout(resolve, Math.max(50, Number(config.ms) || 300)));
  await send(port, hexBytes(config.off));
}

// ─── Mạch Arduino bấm máy (dây bấm điện tử) ───────────────────────────────
// Có cổng riêng đã chọn cho mạch bấm máy thì dùng cổng đó; không thì dùng chung mạch Pro Micro của
// máy nhận tiền (kiểu "Xung qua Arduino — cổng COM"), vì một cổng COM chỉ mở được một lần.
export const hasOwnShutterPort = () => Boolean(globalThis.localStorage?.getItem("serial-port-shutter"));
export const chooseShutterPort = () => openPort("shutter", 9600, true);
export function forgetShutterPort() {
  localStorage.removeItem("serial-port-shutter");
  ports.get("shutter")?.close().catch(() => {});
  ports.delete("shutter");
}
async function arduinoLine(line) {
  if (hasOwnShutterPort()) {
    const port = await openPort("shutter", 9600, false);
    if (!port) throw new Error("Chưa kết nối mạch bấm máy (cổng COM đã chọn không có).");
    return send(port, new TextEncoder().encode(`${line}\n`));
  }
  if (readBillConfig().protocol !== "pulse")
    throw new Error("Chưa chọn cổng cho mạch bấm máy (máy nhận tiền không dùng mạch Arduino).");
  if (!billAcceptor.port?.writable && !(await billAcceptor.connect(false)))
    throw new Error("Chưa kết nối mạch Arduino (chọn cổng ở mục Máy đọc tiền).");
  return billAcceptor.writeText(line);
}
export const arduinoConnected = () =>
  hasOwnShutterPort()
    ? Boolean(ports.get("shutter")?.writable)
    : readBillConfig().protocol === "pulse" && Boolean(billAcceptor.port?.writable);
// Nhấn nửa (lấy nét) trước lúc chụp ~1 giây để máy chụp đúng lúc hết đếm ngược. Mạch tự nhả sau
// vài giây nếu không có lệnh chụp.
export const focusArduino = () => arduinoLine("FOCUS");
// Nhấn hết: máy ảnh chụp (flash nổ), mạch trả lời "SHOT".
export const pressArduino = () => arduinoLine("SHOOT");

// Bấm máy theo chế độ đã chọn ("arduino" / "relay"); "hdmi" không bấm máy.
export const pressShutter = (mode = readShutter()) =>
  mode === "relay" ? pressRelay() : pressArduino();

// Khung hình HDMI đang phát → JPEG chưa lật (giống ảnh gốc máy ảnh), cắt đúng vùng khách thấy
// trên màn hình (bỏ mép có thông số máy ảnh).
export async function grabHdmiFrame(video, zoom = 0) {
  const width = video?.videoWidth, height = video?.videoHeight;
  if (!width || !height) throw new Error("Chưa có hình trực tiếp từ máy ảnh để chụp.");
  const region = visibleRegion(zoom);
  const sx = Math.round(width * region.x), sy = Math.round(height * region.y);
  const sw = Math.round(width * region.w), sh = Math.round(height * region.h);
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  try {
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Không chụp được khung hình HDMI."))),
        "image/jpeg",
        0.95,
      ),
    );
  } finally {
    canvas.width = canvas.height = 0;
  }
}
