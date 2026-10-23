import { visibleRegion } from "./live-preview-layout.js";
import { choosePort, savedPort } from "./serial-ports.js";

// Chế độ "Đếm giờ": hết đếm ngược thì máy chụp tự chụp. Trình duyệt không điều khiển được máy
// ảnh Fujifilm qua X Acquire, nên có hai cách:
// - "relay": mạch relay USB (Web Serial) nối song song với nút của dây bấm → máy ảnh chụp thật,
//   ảnh gốc về thư mục X Acquire như khi khách bấm dây.
// - "hdmi": lấy khung hình đang phát từ thẻ ghi hình HDMI (không cần thêm thiết bị, ảnh 1080p).
export const SHUTTER_KEY = "kiosk-shutter";
export const RELAY_KEY = "kiosk-relay";
// Lệnh mặc định của module relay USB 1 kênh phổ biến (LCUS-1, chip CH340): bật / tắt kênh 1.
export const DEFAULT_RELAY = { on: "A0 01 01 A2", off: "A0 01 00 A1", ms: 300, baud: 9600 };

export const relaySupported =
  typeof navigator !== "undefined" && "serial" in navigator;
export const readShutter = () =>
  globalThis.localStorage?.getItem(SHUTTER_KEY) === "relay" ? "relay" : "hdmi";
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

let port = null;
let opening = null;
// Mở cổng relay đã cho phép trước đó; ask = true thì hỏi nhân viên chọn cổng (cần bấm nút).
export async function connectRelay(ask = false) {
  if (!relaySupported) throw new Error("Trình duyệt không hỗ trợ cổng USB (Web Serial). Dùng Chrome hoặc Edge.");
  if (port?.writable) return port;
  opening ??= (async () => {
    const chosen = ask ? await choosePort("relay") : await savedPort("relay");
    if (!chosen) return null;
    if (!chosen.writable) await chosen.open({ baudRate: readRelay().baud || 9600 });
    port = chosen;
    navigator.serial.addEventListener?.("disconnect", (event) => {
      if (event.target === port) port = null;
    });
    return port;
  })().finally(() => {
    opening = null;
  });
  return opening;
}
export const relayConnected = () => Boolean(port?.writable);

async function send(bytes) {
  const writer = port.writable.getWriter();
  try {
    await writer.write(bytes);
  } finally {
    writer.releaseLock();
  }
}
// Đóng relay trong `ms` mili giây (như bấm nút dây bấm) rồi nhả ra.
export async function pressRelay(config = readRelay()) {
  if (!(await connectRelay(false))) throw new Error("Chưa kết nối relay chụp ảnh.");
  await send(hexBytes(config.on));
  await new Promise((resolve) => setTimeout(resolve, Math.max(50, Number(config.ms) || 300)));
  await send(hexBytes(config.off));
}

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
