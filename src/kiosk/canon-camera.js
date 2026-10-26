const KEY = "kiosk-canon-r100-usb";
const BASE = "http://127.0.0.1:8788";
let state = { connected: false, model: "Canon EOS R100", folder: "", error: "" };
const listeners = new Set();
export function readCanonConfig() {
  // The local agent keeps its token when replacing the camera; model validation still applies.
  try { return JSON.parse(localStorage.getItem(KEY) ?? localStorage.getItem("kiosk-canon-r50-usb")) || { token: "" }; }
  catch { return { token: "" }; }
}
export function saveCanonConfig(config) {
  localStorage.setItem(KEY, JSON.stringify({ token: String(config.token || "").trim() }));
  state = { ...state, connected: false }; emit();
}
export const canonCameraState = () => ({ ...state, configured: Boolean(readCanonConfig().token) });
function emit() { for (const listener of listeners) listener(canonCameraState()); }
export function watchCanonCamera(listener) { listeners.add(listener); listener(canonCameraState()); return () => listeners.delete(listener); }
async function command(action, { signal, requestId } = {}) {
  signal?.throwIfAborted();
  const { token } = readCanonConfig();
  if (!token) throw new Error("Chưa cài kết nối Canon R100. Nhân viên mở Canon Camera Agent và nhập mã kết nối trong Cài đặt máy chụp.");
  try {
    const response = await fetch(`${BASE}/${action}`, {
      method: action === "status" ? "GET" : "POST", credentials: "omit", cache: "no-store", redirect: "error",
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(12000)]),
      headers: { Authorization: `Bearer ${token}`, ...(action !== "status" ? { "Content-Type": "application/json" } : {}) },
      ...(action !== "status" ? { body: JSON.stringify({ expiresAt: Date.now() + 3000, ...(requestId ? { requestId } : {}) }) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Canon Camera Agent báo lỗi.");
    state = { ...state, ...result, error: "" }; emit(); return result;
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof TypeError || error.name === "TimeoutError" ? "Không kết nối được Canon Camera Agent trên máy tính này. Mở chương trình, kiểm tra cáp USB và cho phép trình duyệt truy cập mạng cục bộ nếu được hỏi." : error.message;
    state = { ...state, connected: false, error: message }; emit(); throw new Error(message);
  }
}
export async function connectCanonCamera(signal) {
  const result = await command("connect", { signal });
  if (!result.connected || result.model !== "Canon EOS R100") {
    const error = "Chưa xác nhận Canon R100 qua USB. Cập nhật Camera Agent bản R100 và kết nối lại đúng máy ảnh.";
    state = { ...state, connected: false, error }; emit(); throw new Error(error);
  }
  return result;
}
export const refreshCanonCamera = (signal) => command("status", { signal });
export const focusCanonCamera = (signal) => command("focus", { signal });
export const releaseCanonCamera = () => command("release");
export const pressCanonCamera = (signal) => command("shoot", { signal, requestId: crypto.randomUUID() });
