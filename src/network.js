const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504]);
// Bad gateway / unavailable / gateway timeout answered by a proxy (Render waking up, a deploy
// restarting the server) rather than by this API: api.js marks those code "UNAVAILABLE".
export const GATEWAY_STATUSES = new Set([502, 503, 504]);
const aborted = () => new DOMException("Request aborted", "AbortError");

export function retryAfter(value) {
  if (!value) return 0;
  const seconds = Number(value);
  return Math.max(0, Number.isFinite(seconds)
    ? seconds * 1000 : Date.parse(value) - Date.now()) || 0;
}

export function isTransient(error) {
  return error?.code === "NETWORK" || error?.code === "TIMEOUT" ||
    TRANSIENT.has(error?.status);
}

// The API itself could not be reached (offline, Wi-Fi portal, timeout, server restarting).
// A JSON error from the API (even a 503 "try again") proves the server is reachable.
export function isConnectivityError(error) {
  return ["NETWORK", "TIMEOUT", "UNAVAILABLE"].includes(error?.code);
}

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const finish = () => { signal.removeEventListener("abort", cancel); resolve(); };
    const timer = setTimeout(finish, ms);
    const cancel = () => { clearTimeout(timer); reject(aborted()); };
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
  });
}

// The deadline covers headers, body consumption and retries together. Only
// explicitly replayable operations opt into retries; a payment is never replayed.
export async function networkRequest(action, {
  timeout = 20000, signal, retries = 0, retryDelay = 500,
} = {}) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) throw aborted();
  signal?.addEventListener("abort", cancel, { once: true });
  const deadline = Date.now() + timeout;
  const timer = setTimeout(cancel, timeout);
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        return await action(controller.signal);
      } catch (failure) {
        if (signal?.aborted) throw aborted();
        let error = failure;
        if (controller.signal.aborted) {
          error = Object.assign(new Error("Máy chủ phản hồi quá lâu. Vui lòng thử lại."), { code: "TIMEOUT" });
        } else if (failure instanceof TypeError) {
          error = Object.assign(new Error(globalThis.navigator?.onLine === false
            ? "Mạng đang gián đoạn. Vui lòng kiểm tra Wi-Fi hoặc dây mạng."
            : "Chưa kết nối được máy chủ. Vui lòng thử lại."), { code: "NETWORK" });
        }
        const delay = Math.max(error.retryAfterMs || 0,
          retryDelay * 2 ** attempt + (retryDelay ? Math.random() * 250 : 0));
        if (controller.signal.aborted || attempt >= retries || !isTransient(error) ||
            Date.now() + delay >= deadline) throw error;
        try { await pause(delay, controller.signal); }
        catch {
          if (signal?.aborted) throw aborted();
          throw Object.assign(new Error("Máy chủ phản hồi quá lâu. Vui lòng thử lại."), { code: "TIMEOUT" });
        }
      }
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

// ── One shared view of whether the API answers ─────────────────────────────
// Fed by the outcome of real API requests (never by navigator.onLine alone), so a
// whole page shows a single "connection lost / reconnected" state instead of every
// panel guessing on its own.
let connectivity = { online: true, error: null, since: Date.now() };
const connectivityListeners = new Set();

export const getConnectivity = () => connectivity;

export function subscribeConnectivity(listener) {
  connectivityListeners.add(listener);
  return () => connectivityListeners.delete(listener);
}

// error = null for any answer from the server. Cancelled requests say nothing.
export function reportConnectivity(error) {
  if (error?.name === "AbortError") return;
  const online = !isConnectivityError(error);
  if (online === connectivity.online && (online || connectivity.error === error)) return;
  const recovered = online && !connectivity.online;
  connectivity = { online, error: online ? null : error, since: online === connectivity.online ? connectivity.since : Date.now() };
  for (const listener of [...connectivityListeners]) listener(connectivity);
  // Readers that backed off during the outage refresh immediately.
  if (recovered) requestWake(false);
}

// ── Recovery: re-check with real requests when the network may be back ─────
// Browser online flags are hints, not proof that this API is reachable. Network
// changes, a return from a hidden tab, bfcache restore, waking from sleep and the
// first successful request after an outage all trigger a coalesced re-check.
const recoveryListeners = new Set();
let wakeQueued = false, wakeExplicit = false, lastWakeAt = -Infinity;
let hiddenAt = 0, blurredAt = 0, lastTick = 0, sleepWatch = null;
const HIDDEN_REFRESH_MS = 1000, BLUR_REFRESH_MS = 60000, SLEEP_GAP_MS = 30000, WAKE_GAP_MS = 500;

// explicit=false: woken only because some request just succeeded after an outage, so a
// reader that has fresh data itself can skip its re-check ({ recovered: true }).
// A burst (online + focus + visibility, or several events a few ms apart) re-checks once:
// events in the same turn are merged and later ones within WAKE_GAP_MS are dropped. No timer
// is involved, so recovery is never delayed behind a throttled or paused clock.
function requestWake(explicit = true) {
  if (typeof document === "undefined" || document.hidden) return;
  if (!wakeQueued && Date.now() - lastWakeAt < WAKE_GAP_MS) return;
  wakeExplicit ||= explicit;
  if (wakeQueued) return;
  wakeQueued = true;
  queueMicrotask(() => {
    const info = { recovered: !wakeExplicit };
    wakeQueued = false;
    wakeExplicit = false;
    lastWakeAt = Date.now();
    for (const listener of [...recoveryListeners]) {
      try { listener(info); } catch (error) { console.error(error); }
    }
  });
}
const events = {
  online: () => requestWake(),
  // Ask the API right away instead of waiting for the next poll to fail.
  offline: () => requestWake(),
  // A normal page load also fires pageshow (persisted=false); only a page restored
  // from the back/forward cache needs fresh data.
  pageshow: (event) => { if (event.persisted !== false) requestWake(); },
  blur: () => { blurredAt = Date.now(); },
  // Switching windows for a moment must not reload every panel; a long absence or
  // a known outage does.
  focus: () => {
    if (!connectivity.online || (blurredAt && Date.now() - blurredAt >= BLUR_REFRESH_MS)) requestWake();
    blurredAt = 0;
  },
  visibilitychange: () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (!connectivity.online || (hiddenAt && Date.now() - hiddenAt >= HIDDEN_REFRESH_MS)) requestWake();
    hiddenAt = 0;
  },
};
function listen(add) {
  const method = add ? "addEventListener" : "removeEventListener";
  for (const name of ["online", "offline", "pageshow", "blur", "focus"]) window[method](name, events[name]);
  document[method]("visibilitychange", events.visibilitychange);
  globalThis.navigator?.connection?.[method]?.("change", events.online);
  clearInterval(sleepWatch);
  sleepWatch = null;
  if (add) {
    // Timers stop while the computer sleeps: a long gap means it just woke up and
    // the Wi-Fi may have reconnected without an online event.
    lastTick = Date.now();
    sleepWatch = setInterval(() => {
      const now = Date.now();
      if (now - lastTick > SLEEP_GAP_MS) requestWake();
      lastTick = now;
    }, 10000);
  }
}

export function onNetworkRecovery(callback) {
  if (typeof window === "undefined") return () => {};
  if (!recoveryListeners.size) listen(true);
  recoveryListeners.add(callback);
  return () => {
    if (!recoveryListeners.delete(callback) || recoveryListeners.size) return;
    listen(false);
    wakeExplicit = false;
  };
}

// ── Giờ mở cửa và nhịp giữ máy chủ thức (xem useKeepServerAwake) ──
export const KEEP_AWAKE_MS = 8 * 60_000;
// Tiệm mở 9h–23h; bắt đầu giữ thức từ 8h để máy chủ đã chạy sẵn khi nhân viên mở máy chụp và
// khách đầu tiên tới. Hạn mức free 750 giờ/tháng: 15 giờ × 31 ngày = 465 giờ.
export const OPEN_HOURS = { from: 8, to: 23 };

export function inOpenHours(now = new Date(), { from, to } = OPEN_HOURS) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Ho_Chi_Minh",
    }).format(now),
  );
  return hour >= from && hour < to;
}
