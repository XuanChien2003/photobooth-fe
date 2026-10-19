import { networkRequest, retryAfter } from "./network.js";

// Private R2 files can be displayed/printed without relaying their bytes through
// the application server. Older backends simply ignore this optional query.
export function directMediaUrl(src) {
  if (!/^https?:|^\//.test(src) || !/\/api\/albums\/[^/]+\/(photos|prints)\//.test(src)) return src;
  const url = new URL(src, globalThis.location?.origin || "http://localhost");
  url.searchParams.set("direct", "1");
  return src.startsWith("/") ? url.pathname + url.search : url.href;
}

const isStorageUrl = (src) => {
  try {
    const url = new URL(src);
    return url.protocol === "https:" && url.hostname.endsWith(".r2.cloudflarestorage.com");
  } catch { return false; }
};

// Album responses carry each photo's short-lived storage links (thumbnail, preview), so those
// images load straight from R2 without one server round trip per image. A link is used only
// while it has a safe margin left; otherwise the API route signs a fresh one.
const LINK_MARGIN_MS = 20000;
export function storageLink(photo, size, now = Date.now()) {
  const link = photo?.links?.[size];
  return typeof link === "string" && Date.parse(photo.links.until) - now > LINK_MARGIN_MS &&
    isStorageUrl(link) ? link : null;
}

export function proxyMediaUrl(src) {
  const url = new URL(src, globalThis.location?.origin || "http://localhost");
  url.searchParams.delete("direct");
  return src.startsWith("/") ? url.pathname + url.search : url.href;
}

export function retryMediaImage(event) {
  const img = event.currentTarget;
  const src = img.getAttribute("src");
  if (src && new URL(src, location.origin).searchParams.get("direct") === "1")
    img.src = proxyMediaUrl(src);
}

// Editing needs CORS-enabled pixels. If the bucket has no CORS policy, use the
// existing authenticated stream and stop retrying the direct path for a while.
// Displaying thumbnails and printing <img> elements do not need bucket CORS.
let proxyUntil = 0;

async function readImage(response, touch) {
  if (!response.body?.getReader) return response.blob();
  const reader = response.body.getReader(), chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      touch();
      chunks.push(value);
    }
    // Preserve every source byte; no decode/recompression in the transport.
    return new Blob(chunks, { type: response.headers.get("Content-Type") || "application/octet-stream" });
  } catch (error) {
    reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

async function receive(src, { signal, stallTimeout, link = false, privateFile = false }) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
  signal.addEventListener("abort", cancel, { once: true });
  let timer, response;
  const touch = () => { clearTimeout(timer); timer = setTimeout(cancel, stallTimeout); };
  touch();
  try {
    response = await fetch(src, {
      signal: controller.signal,
      ...(privateFile ? { referrerPolicy: "no-referrer", credentials: "omit" }
        : { credentials: "include" }),
    });
    touch();
    if (!response.ok) {
      response.body?.cancel().catch(() => {});
      throw Object.assign(new Error("Không tải được ảnh. Vui lòng thử lại."), {
        status: response.status,
        retryAfterMs: retryAfter(response.headers.get("Retry-After")),
        permanent: ![403, 408, 429].includes(response.status) && response.status < 500,
      });
    }
    return link && response.headers.get("Content-Type")?.includes("application/json")
      ? await response.json() : await readImage(response, touch);
  } catch (error) {
    if (controller.signal.aborted && !signal.aborted)
      throw Object.assign(new Error("Tải ảnh bị gián đoạn. Vui lòng thử lại."), { code: "TIMEOUT" });
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}

export function fetchMediaBlob(src, { signal, timeout = 90000, stallTimeout = 15000, link: known } = {}) {
  return networkRequest(async (requestSignal) => {
    if (Date.now() >= proxyUntil) {
      let r2Failed = false;
      try {
        if (known) {
          try {
            return await receive(known, { signal: requestSignal, stallTimeout, privateFile: true });
          } catch (error) {
            // An expired link (403: a stale album list, a skewed clock) is signed again below.
            if (error.status !== 403) { r2Failed = true; throw error; }
          }
        }
        const link = new URL(directMediaUrl(src), globalThis.location?.origin || "http://localhost");
        link.searchParams.set("direct", "link");
        const data = await receive(src.startsWith("/") ? link.pathname + link.search : link.href,
          { signal: requestSignal, stallTimeout, link: true });
        if (data instanceof Blob) return data; // Compatibility with older APIs.
        if (!isStorageUrl(data.url))
          throw Object.assign(new Error("Địa chỉ ảnh không hợp lệ."), { permanent: true });
        try {
          return await receive(data.url, { signal: requestSignal, stallTimeout, privateFile: true });
        } catch (error) { r2Failed = true; throw error; }
      } catch (error) {
        if (requestSignal.aborted || error.permanent) throw error;
        // Honor rate-limit instructions instead of immediately doubling requests.
        if (error.status === 429) throw error;
        // Only an actual R2 failure bypasses R2 on later requests. A transient
        // signing/API error must not send all 15 MB originals through Render.
        if (r2Failed) proxyUntil = Date.now() + 60000;
      }
    }
    return receive(src, { signal: requestSignal, stallTimeout });
  }, { timeout, signal });
}
