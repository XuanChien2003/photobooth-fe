// Bấm máy ảnh Fujifilm qua Bluetooth của chính máy ảnh (như nút chụp trong app FUJIFILM XApp /
// Camera Remote): máy ảnh chụp thật (flash rời nổ), không cần mạch Arduino / relay. Giao thức theo
// dự án mã nguồn mở furble (github.com/gkoh/furble — đã chạy với X-S10, X-S20, X-T3, X-T4, X-T5…),
// có hai kiểu ghép đôi:
// - "basic" (firmware cũ): ghi mã ghép đôi 4 byte mà máy ảnh phát trong quảng bá Bluetooth lúc ở
//   chế độ PAIRING REGISTRATION. Chrome chỉ đọc được quảng bá khi bật Experimental Web Platform
//   features (chrome://flags).
// - "secure" (firmware từ khoảng 07/2025): ghép đôi bảo mật của hệ điều hành (Windows hỏi đồng ý).
// Trình duyệt chỉ chọn thiết bị khi nhân viên bấm nút (requestDevice); sau đó tự kết nối lại.

const COMPANY_ID = 0x04d8;
const NAME = "Photobooth";
const KEY = "kiosk-camera-bluetooth";
const UUID = {
  // Kiểu basic
  pairBasic: "91f1de68-dff6-466e-8b65-ff13b0f16fb8",
  pairToken: "aba356eb-9633-4e60-b73f-f52516dbd671",
  // Kiểu secure
  pairSecure: "123d8f06-62a1-4935-9322-833c531ee225",
  status: "f557d96b-8284-4667-8793-b971c1deca2a",
  // Chung
  ident: "85b9163e-62d1-49ff-a6f5-054b4630d4a1",
  conf: "4c0020fe-f3b6-40de-acc9-77d129067b14",
  ind1: "a68e3f66-0fcc-4395-8d4c-aa980b5877fa",
  ind2: "bd17ba04-b76b-4892-a545-b73ba1f74dae",
  ind3: "049ec406-ef75-4205-a390-08fe209c51f0",
  not1: "f9150137-5d40-4801-a8dc-f7fc5b01da50",
  geotag: "ad06c7b7-f41a-46f4-a29a-712055319122",
  notx: "4e941240-d01d-46b9-a5ea-67636806830b",
  not4: "bf6dc9cf-3606-4ec9-a4c8-d77576e93ea4",
  not5: "75823784-fbb7-4b71-abae-cd9a34072e3c",
  not6: "e6692c5c-b7cd-44f4-95fc-eda07ce32560",
  not7: "aab609c4-94dd-4d89-bc60-665d5090b828",
  not8: "2a125640-706d-4dd1-b420-c0f4ab93c361",
  not9: "82a9f452-c5ce-4ef5-8203-3fc9a47f8171",
  not10: "deef7187-3f43-4364-9e22-11a8c8a15951",
  syncInterval: "c95d91ae-b247-4d6d-8661-7dd5d6a0f85b",
  shutterSvc: "6514eb81-4e8f-458d-aa2a-e691336cdfac",
  shutter: "7fcf49c6-4ff0-4777-a03d-1a79166af7a8",
};
// Dịch vụ dùng để bấm máy, và các dịch vụ chỉ để nhận biết kiểu máy (ghi vào nhật ký kết nối).
const SERVICES = [UUID.pairBasic, UUID.pairSecure, UUID.conf, UUID.notx, UUID.shutterSvc];
const DETECT = {
  "ghép đôi kiểu cũ": UUID.pairBasic,
  "ghép đôi bảo mật": UUID.pairSecure,
  "cấu hình": UUID.conf,
  "thông báo": UUID.notx,
  "nút chụp": UUID.shutterSvc,
  "quảng bá bảo mật": "a9d2b304-e8d6-4902-8336-352b772d7597",
  "chính (bảo mật)": "731893f9-744e-4899-b7e3-174106ff2b82",
  "camera remote": "af854c2e-b214-458e-97e2-912c4ecf2cb8",
  "XApp": "117c4142-edd4-4c77-8696-dd18eebb770a",
};
// Lệnh nút chụp: ghi SHUTTER_CMD rồi tham số (nhấn hết / nhấn nửa / nhả).
const SHUTTER_CMD = Uint8Array.of(0x01, 0x00);
const PRESS = Uint8Array.of(0x02, 0x00);
const FOCUS = Uint8Array.of(0x03, 0x00);
const RELEASE = Uint8Array.of(0x00, 0x00);

export const bluetoothSupported =
  typeof navigator !== "undefined" && Boolean(navigator.bluetooth?.requestDevice);
export const bluetoothScanSupported = bluetoothSupported && typeof navigator.bluetooth.requestLEScan === "function";
const readSaved = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
};
const save = (value) => localStorage.setItem(KEY, JSON.stringify(value));
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (text) => Uint8Array.from(text.match(/../g).map((h) => parseInt(h, 16)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let device = null;
let shutter = null;
let connecting = null;
let focusTimer = null;
const listeners = new Set();
// Nhật ký kết nối (hiện trong Cài đặt máy chụp → "Chi tiết kết nối") để biết hỏng ở bước nào.
const trail = [];
const state = () => ({
  name: device?.name || readSaved()?.name || "",
  // Chỉ coi là đã ghép đôi khi bắt tay với máy ảnh xong (bấm máy được).
  saved: Boolean(readSaved()?.paired),
  // Đã chọn máy ảnh nhưng chưa bắt tay được (thường do thiếu mã ghép đôi).
  pending: Boolean(readSaved() && !readSaved().paired),
  connected: Boolean(device?.gatt?.connected && shutter),
  log: trail.slice(-20),
});
const emit = () => {
  for (const listener of listeners) listener(state());
};
export function watchBluetoothCamera(listener) {
  listeners.add(listener);
  listener(state());
  return () => listeners.delete(listener);
}
export const bluetoothCameraState = state;
function note(text) {
  const time = new Date().toLocaleTimeString("vi-VN", { hour12: false });
  trail.push(`${time} ${text}`);
  if (trail.length > 40) trail.shift();
  emit();
}

// Mã ghép đôi (kiểu cũ) trong quảng bá của máy ảnh lúc ở màn SEARCHING: [kiểu 0x02, 4 byte mã];
// kiểu bảo mật phát [kiểu, 5 byte số máy] nên không có mã. Chrome chỉ cho đọc quảng bá khi bật
// Experimental Web Platform features (chrome://flags) và đã khởi động lại Chrome. Máy ảnh đang
// kết nối với máy nào (máy tính này, điện thoại có XApp) thì ngừng phát quảng bá.
const LISTEN_MS = 30000;
// start(onAdvert, signal) bắt đầu nghe; accept(event) chọn gói của đúng máy ảnh (khi quét cả vùng).
function listenForToken(start, accept = () => true) {
  note(`Đang nghe quảng bá của máy ảnh để lấy mã ghép đôi (tối đa ${LISTEN_MS / 1000} giây)…`);
  const abort = new AbortController();
  let seen = 0;
  return new Promise((resolve) => {
    const done = (token, text) => {
      if (abort.signal.aborted) return;
      clearTimeout(timer);
      abort.abort();
      if (text) note(text);
      resolve(token);
    };
    const timer = setTimeout(() => done(null, seen
      ? "Máy ảnh có phát quảng bá nhưng không kèm mã ghép đôi — máy ảnh chưa ở màn PAIRING REGISTRATION (SEARCHING)."
      : `Không nhận được quảng bá nào của máy ảnh trong ${LISTEN_MS / 1000} giây — máy ảnh đang kết nối với máy khác (máy tính / điện thoại) hoặc chưa ở màn SEARCHING.`), LISTEN_MS);
    const onAdvert = (event) => {
      const data = event.manufacturerData?.get(COMPANY_ID);
      const bytes = data ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
      const mine = accept(event);
      if (seen++ < 5)
        note(`Quảng bá từ ${event.device?.name || event.name || "thiết bị"}${mine ? "" : " (máy khác)"}, ${event.rssi ?? "?"} dBm: ${bytes ? hex(bytes) : "không có dữ liệu Fujifilm"}`);
      if (!bytes || !mine) return;
      if (bytes.length >= 5 && bytes[0] === 0x02) done(bytes.slice(1, 5), "Đã đọc được mã ghép đôi.");
      else if (bytes.length >= 6) done(null, "Máy ảnh dùng kiểu ghép đôi bảo mật (không cần mã).");
    };
    start(onAdvert, abort.signal).catch((error) => done(null, `Không nghe được quảng bá: ${error.message}`));
  });
}

// Cách 1: nghe quảng bá của chính máy ảnh vừa chọn trong bảng của Chrome.
function readToken(picked) {
  if (typeof picked.watchAdvertisements !== "function") {
    note("Chrome chưa cho đọc quảng bá Bluetooth (Experimental Web Platform features chưa bật, hoặc bật rồi nhưng chưa tắt hẳn Chrome để mở lại).");
    return Promise.resolve(null);
  }
  return listenForToken((onAdvert, signal) => {
    picked.addEventListener("advertisementreceived", onAdvert, { signal });
    return picked.watchAdvertisements({ signal });
  });
}

// Ngắt kết nối để máy ảnh phát lại quảng bá (và không bị kẹt ở kết nối bắt tay hỏng).
function hangUp(text) {
  shutter = null;
  if (!device?.gatt?.connected) return;
  try {
    device.gatt.disconnect();
    if (text) note(text);
  } catch {}
}

async function subscribe(server, list, required) {
  for (const [service, characteristic] of list) {
    try {
      const chr = await (await server.getPrimaryService(service)).getCharacteristic(characteristic);
      await chr.startNotifications();
    } catch (error) {
      if (required) throw error;
    }
  }
}

async function handshake() {
  note(`Đang kết nối ${device.name || "máy ảnh"}…`);
  const server = await device.gatt.connect();
  const found = [];
  for (const [label, uuid] of Object.entries(DETECT))
    if (await server.getPrimaryService(uuid).then(() => true, () => false)) found.push(label);
  note(`Đã kết nối. Dịch vụ của máy ảnh: ${found.join(", ") || "không thấy dịch vụ nào"}.`);
  const secure = await server.getPrimaryService(UUID.pairSecure).catch(() => null);
  if (secure) {
    note("Máy ảnh dùng ghép đôi bảo mật — đang xác nhận.");
    // Đọc trạng thái (Windows hỏi ghép đôi bảo mật lần đầu) rồi xác nhận lại với bit 0x20.
    const status = await secure.getCharacteristic(UUID.status);
    const value = await status.readValue();
    if (value.byteLength !== 4) throw new Error("Máy ảnh trả trạng thái lạ — thử ghép đôi lại.");
    await status.writeValueWithResponse(Uint8Array.of(value.getUint8(0), value.getUint8(1), value.getUint8(2), 0x20));
    await (await secure.getCharacteristic(UUID.ident)).writeValueWithResponse(new TextEncoder().encode(NAME));
    await subscribe(server, [
      [UUID.conf, UUID.ind1], [UUID.conf, UUID.ind2], [UUID.conf, UUID.not1],
      [UUID.conf, UUID.geotag], [UUID.notx, UUID.not4], [UUID.notx, UUID.not5],
    ], true);
    await subscribe(server, [
      [UUID.conf, UUID.not6], [UUID.notx, UUID.not7], [UUID.notx, UUID.not8],
      [UUID.notx, UUID.not9], [UUID.notx, UUID.not10],
    ], false);
    const sync = await (await server.getPrimaryService(UUID.notx)).getCharacteristic(UUID.syncInterval);
    await sync.startNotifications();
    await sync.writeValueWithResponse(Uint8Array.of(10, 0));
  } else {
    const pair = await server.getPrimaryService(UUID.pairBasic).catch(() => null);
    if (!pair) throw new Error("Thiết bị đã chọn không phải máy ảnh Fujifilm hỗ trợ bấm máy qua Bluetooth.");
    note("Máy ảnh dùng ghép đôi kiểu cũ — cần mã ghép đôi.");
    const token = readSaved()?.token;
    if (!token)
      throw new Error(typeof device.watchAdvertisements === "function"
        ? "Chưa nhận được mã ghép đôi từ máy ảnh. Trên máy ảnh vào lại PAIRING REGISTRATION (màn SEARCHING) rồi bấm “Kết nối lại máy ảnh” ngay."
        : "Máy ảnh dùng ghép đôi kiểu cũ, cần mã ghép đôi: mở chrome://flags, bật “Experimental Web Platform features”, tắt hẳn Chrome (Mac: Cmd + Q) rồi mở lại, để máy ảnh ở màn SEARCHING và bấm “Kết nối lại máy ảnh”.");
    await (await pair.getCharacteristic(UUID.pairToken)).writeValueWithResponse(fromHex(token));
    await (await pair.getCharacteristic(UUID.ident)).writeValueWithResponse(new TextEncoder().encode(NAME));
    await subscribe(server, [
      [UUID.conf, UUID.ind1], [UUID.conf, UUID.ind2], [UUID.conf, UUID.not1],
      [UUID.conf, UUID.geotag], [UUID.conf, UUID.ind3],
    ], true);
  }
  shutter = await (await server.getPrimaryService(UUID.shutterSvc)).getCharacteristic(UUID.shutter);
  const saved = readSaved();
  if (saved && !saved.paired) save({ ...saved, paired: true });
  note("Sẵn sàng: hết đếm ngược máy chụp sẽ bấm máy ảnh.");
}

function track(picked) {
  if (device === picked) return;
  device = picked;
  shutter = null;
  device.addEventListener("gattserverdisconnected", () => {
    shutter = null;
    emit();
  });
}

// Nhân viên bấm "Kết nối máy ảnh" (máy ảnh ở PAIRING REGISTRATION): chọn máy trong bảng của Chrome.
export async function pairBluetoothCamera() {
  if (!bluetoothSupported) throw new Error("Trình duyệt / máy tính này không có Bluetooth cho trang web (dùng Chrome hoặc Edge).");
  const picked = await navigator.bluetooth.requestDevice({
    filters: [
      { manufacturerData: [{ companyIdentifier: COMPANY_ID }] },
      { namePrefix: "X-" }, { namePrefix: "X100" }, { namePrefix: "GFX" },
    ],
    optionalServices: [...new Set([...SERVICES, ...Object.values(DETECT)])],
  });
  note(`Đã chọn ${picked.name || "thiết bị"} trong bảng của Chrome.`);
  if (device && device !== picked) hangUp();
  track(picked);
  hangUp("Đã ngắt kết nối cũ để máy ảnh phát lại quảng bá.");
  const token = await readToken(picked);
  const old = readSaved();
  save({
    id: picked.id,
    name: picked.name || "Máy ảnh",
    token: token ? hex(token) : old?.id === picked.id ? old.token : null,
    paired: false,
  });
  return finishPairing();
}

async function finishPairing() {
  connecting = null;
  try {
    await connect();
  } catch (error) {
    note(`Lỗi: ${error.message}`);
    throw error;
  }
  return state();
}

// Cách 2 (khi cách 1 không nhận được gì): quét mọi quảng bá Fujifilm quanh máy tính rồi lấy mã của
// máy ảnh đã chọn. Phải gọi ngay khi nhân viên bấm nút vì Chrome hỏi quyền quét.
export async function scanBluetoothToken() {
  if (typeof navigator.bluetooth?.requestLEScan !== "function")
    throw new Error("Chrome chưa cho quét Bluetooth: mở chrome://flags, bật “Experimental Web Platform features”, tắt hẳn Chrome (Mac: Cmd + Q) rồi mở lại.");
  const saved = readSaved();
  if (!saved?.id) throw new Error("Bấm “Kết nối máy ảnh” và chọn máy ảnh trước.");
  const scan = await navigator.bluetooth.requestLEScan({
    filters: [{ manufacturerData: [{ companyIdentifier: COMPANY_ID }] }],
    keepRepeatedDevices: true,
  });
  hangUp("Đã ngắt kết nối cũ để máy ảnh phát lại quảng bá.");
  note("Đang quét Bluetooth quanh máy tính…");
  let token;
  try {
    token = await listenForToken((onAdvert, signal) => {
      navigator.bluetooth.addEventListener("advertisementreceived", onAdvert, { signal });
      return Promise.resolve();
    }, (event) => event.device?.id === saved.id || (event.device?.name || event.name) === saved.name);
  } finally {
    scan.stop();
  }
  if (!token) throw new Error("Chưa đọc được mã ghép đôi — xem “Chi tiết kết nối”.");
  save({ ...readSaved(), token: hex(token), paired: false });
  if (!device) await restore(saved);
  return finishPairing();
}

export function forgetBluetoothCamera() {
  localStorage.removeItem(KEY);
  try {
    device?.gatt?.disconnect();
  } catch {}
  device = null;
  shutter = null;
  emit();
}

// Kết nối (lại) máy ảnh đã chọn trước đó — không cần bấm nút nếu trình duyệt nhớ quyền (getDevices).
export function connect() {
  if (device?.gatt?.connected && shutter) return Promise.resolve();
  connecting ??= (async () => {
    if (!device) {
      const saved = readSaved();
      if (!saved?.paired) throw new Error("Chưa kết nối máy ảnh qua Bluetooth (Cài đặt máy chụp → Kết nối máy ảnh).");
      await restore(saved);
    }
    try {
      await handshake();
    } catch (error) {
      hangUp();
      throw error;
    }
  })().finally(() => {
    connecting = null;
    emit();
  });
  return connecting;
}

async function restore(saved) {
  const known = (await navigator.bluetooth?.getDevices?.().catch(() => [])) || [];
  const found = known.find((d) => d.id === saved.id);
  if (!found) throw new Error("Trình duyệt chưa nhớ máy ảnh — bấm “Kết nối máy ảnh” trong Cài đặt máy chụp.");
  track(found);
}

async function command(param) {
  await connect();
  await shutter.writeValueWithResponse(SHUTTER_CMD);
  await shutter.writeValueWithResponse(param);
}
// Nhấn nửa (lấy nét) ~1 giây trước khi chụp; không chụp thì tự nhả sau 4 giây.
export async function focusBluetooth() {
  await command(FOCUS);
  clearTimeout(focusTimer);
  focusTimer = setTimeout(() => command(RELEASE).catch(() => {}), 4000);
}
// Nhấn hết rồi nhả: máy ảnh chụp.
export async function pressBluetooth() {
  clearTimeout(focusTimer);
  await command(PRESS);
  await sleep(200);
  await command(RELEASE);
}
