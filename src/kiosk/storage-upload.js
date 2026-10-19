import { networkRequest } from "../network.js";

// Fetch gives no upload progress events. A stalled 15 MB PUT must not hold both
// camera upload slots for the whole three-minute budget while the API is healthy.
// Progress resets only the inactivity timer; the overall deadline stays bounded.
export function putToStorage(url, file, { timeout = 180000, stallTimeout = 30000, signal } = {}) {
  return networkRequest(async (requestSignal) => {
    if (typeof XMLHttpRequest === "undefined") {
      const response = await fetch(url, {
        method: "PUT", body: file, headers: { "Content-Type": "image/jpeg" },
        credentials: "omit", referrerPolicy: "no-referrer", signal: requestSignal,
      });
      if (!response.ok) {
        response.body?.cancel().catch(() => {});
        throw Object.assign(new Error("Kho ảnh từ chối tải lên."), { status: response.status });
      }
      return;
    }
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let timer, settled = false, loaded = 0;
      const cleanup = () => {
        clearTimeout(timer);
        requestSignal.removeEventListener("abort", cancel);
        xhr.onload = xhr.onerror = xhr.onabort = null;
        xhr.upload.onprogress = xhr.upload.onload = null;
      };
      const finish = (error, abort = false) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (abort) xhr.abort();
        if (error) reject(error); else resolve();
      };
      const cancel = () => finish(new DOMException("Request aborted", "AbortError"), true);
      const watch = () => {
        clearTimeout(timer);
        timer = setTimeout(() => finish(Object.assign(
          new Error("Kho ảnh không nhận thêm dữ liệu. Đang thử cách tải khác."),
          { code: "TIMEOUT" },
        ), true), stallTimeout);
      };
      if (requestSignal.aborted) return cancel();
      requestSignal.addEventListener("abort", cancel, { once: true });
      xhr.onload = () => finish(xhr.status >= 200 && xhr.status < 300 ? null
        : xhr.status ? Object.assign(new Error("Kho ảnh từ chối tải lên."), { status: xhr.status })
          : new TypeError("Failed to fetch"));
      xhr.onerror = () => finish(new TypeError("Failed to fetch"));
      xhr.onabort = () => finish(new DOMException("Request aborted", "AbortError"));
      xhr.upload.onprogress = (event) => {
        if (event.loaded > loaded) { loaded = event.loaded; watch(); }
      };
      // Upload bytes finished; also bound waiting for the storage acknowledgement.
      xhr.upload.onload = watch;
      try {
        xhr.open("PUT", url, true);
        xhr.withCredentials = false;
        xhr.setRequestHeader("Content-Type", "image/jpeg");
        watch();
        xhr.send(file);
      } catch (error) { finish(error, true); }
    });
  }, { timeout, signal });
}
