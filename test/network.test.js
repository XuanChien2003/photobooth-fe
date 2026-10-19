import assert from "node:assert/strict";
import { test } from "node:test";
import { networkRequest, retryAfter } from "../src/network.js";
import { api } from "../src/api.js";
import { photoUpload } from "../src/photo-upload.js";

test("safe reads retry a transient failure and share the retry without extra requests", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    if (++calls === 1) return Response.json({ message: "Starting" }, { status: 503 });
    return Response.json({ ready: true });
  };
  try {
    const data = await Promise.all([api('/fixture', { share: true }), api('/fixture', { share: true })]);
    assert.deepEqual(data, [{ ready: true }, { ready: true }]);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test("a photo whose acknowledgement was lost replays the same bytes and key once", async () => {
  const original = globalThis.fetch, calls = [];
  const image = new Blob([new Uint8Array([255, 216, 7, 255, 217])], { type: 'image/jpeg' });
  const stored = new Map();
  globalThis.fetch = async (_, request) => {
    calls.push(request);
    stored.set(request.headers['X-Photo-Key'], request.body);
    if (calls.length === 1) throw new TypeError('Connection dropped after saving');
    return Response.json({ photos: [{ id: 'same-photo' }] });
  };
  try {
    await api('/albums/fixture/photos', photoUpload(image, { clientKey: 'fixed-photo-key' }));
    assert.equal(calls.length, 2);
    assert.equal(stored.size, 1);
    assert.ok(calls.every(request => request.body === image && request.headers['X-Photo-Key'] === 'fixed-photo-key'));
  } finally { globalThis.fetch = original; }
});

test("payments/login and permanent request errors are never automatically replayed", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    for (const path of ['/auth/login', '/admin/bookings/paid', '/albums/fixture/print']) {
      calls = 0;
      globalThis.fetch = async () => { calls++; throw new TypeError('Disconnected'); };
      await assert.rejects(api(path, { method: 'POST', body: {} }), { code: 'NETWORK' });
      assert.equal(calls, 1);
    }
    for (const status of [400, 401, 403, 404, 409, 413, 422]) {
      calls = 0;
      globalThis.fetch = async () => { calls++; return Response.json({ message: 'Rejected' }, { status }); };
      await assert.rejects(api('/fixture/permanent'), { status });
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = original; }
});

test("caller cancellation interrupts a retry delay without reporting a timeout", async () => {
  const controller = new AbortController(); let calls = 0;
  const task = networkRequest(async () => {
    calls++;
    throw Object.assign(Error('Busy'), { status: 503 });
  }, { signal: controller.signal, retries: 1, retryDelay: 10000 });
  controller.abort();
  await assert.rejects(task, { name: 'AbortError' });
  assert.equal(calls, 1);
});

test("a deadline bounds the whole transfer and retry budget", async () => {
  let calls = 0;
  await assert.rejects(networkRequest(signal => new Promise((_, reject) => {
    calls++;
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }), { timeout: 25, retries: 1, retryDelay: 0 }), { code: 'TIMEOUT' });
  assert.equal(calls, 1);
});

test("Retry-After is honored without waiting past the request deadline", async () => {
  let calls = 0;
  await assert.rejects(networkRequest(async () => {
    calls++;
    throw Object.assign(Error('Rate limit'), { status: 429, retryAfterMs: 60000 });
  }, { timeout: 100, retries: 1, retryDelay: 0 }), { status: 429 });
  assert.equal(calls, 1);
  assert.equal(retryAfter('60'), 60000);
  assert.equal(retryAfter('invalid'), 0);
  assert.equal(retryAfter(new Date(Date.now() - 10000).toUTCString()), 0);
});

test("an inaccurate offline hint does not prevent a successful server request", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const original = globalThis.fetch;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  globalThis.fetch = async () => Response.json({ reachable: true });
  try { assert.deepEqual(await api('/fixture/reachable'), { reachable: true }); }
  finally {
    globalThis.fetch = original;
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  }
});

test("one shared connectivity state follows real API outcomes, not the offline hint", async () => {
  const { getConnectivity, subscribeConnectivity, isConnectivityError } = await import("../src/network.js");
  const original = globalThis.fetch;
  const seen = [];
  const unsubscribe = subscribeConnectivity((state) => seen.push(state.online));
  try {
    globalThis.fetch = async () => { throw new TypeError("Disconnected"); };
    await assert.rejects(api("/fixture/state", { retry: 0 }), { code: "NETWORK" });
    assert.equal(getConnectivity().online, false);
    assert.equal(getConnectivity().error.code, "NETWORK");
    // Server restarting behind the proxy (its HTML error page, not our JSON): still unreachable.
    globalThis.fetch = async () => new Response("<html>502 Bad Gateway</html>", { status: 502, headers: { "Content-Type": "text/html" } });
    await assert.rejects(api("/fixture/state", { retry: 0 }), { status: 502, code: "UNAVAILABLE" });
    assert.equal(getConnectivity().online, false);
    // Any real answer, even a refusal, proves the server is reachable again.
    globalThis.fetch = async () => Response.json({ message: "Nope" }, { status: 403 });
    await assert.rejects(api("/fixture/state"), { status: 403 });
    assert.equal(getConnectivity().online, true);
    assert.equal(getConnectivity().error, null);
    assert.deepEqual(seen, [false, false, true], "listeners hear each change once");
    // A cancelled request says nothing about the network.
    const controller = new AbortController();
    globalThis.fetch = (_, { signal }) => new Promise((_, reject) =>
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    const cancelled = api("/fixture/state", { signal: controller.signal });
    controller.abort();
    await assert.rejects(cancelled, { name: "AbortError" });
    assert.equal(getConnectivity().online, true);
    // The API's own JSON 503 ("try again") means the server answered.
    globalThis.fetch = async () => Response.json({ message: "Busy" }, { status: 503 });
    await assert.rejects(api("/fixture/state", { retry: 0 }), (error) => error.status === 503 && !error.code);
    assert.equal(getConnectivity().online, true);
    assert.equal(isConnectivityError({ code: "UNAVAILABLE", status: 504 }), true);
    assert.equal(isConnectivityError({ status: 500 }), false, "a server bug is not a lost connection");
    assert.equal(isConnectivityError({ code: "TIMEOUT" }), true);
  } finally { unsubscribe(); globalThis.fetch = original; }
});

test("a Wi-Fi sign-in page answering instead of the API counts as a network problem and is retried", async () => {
  const { getConnectivity } = await import("../src/network.js");
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1
      ? new Response("<html>Please sign in to Wi-Fi</html>", { headers: { "Content-Type": "text/html" } })
      : Response.json({ ok: true });
  };
  try {
    assert.deepEqual(await api("/fixture/portal"), { ok: true });
    assert.equal(calls, 2);
    calls = 10;
    globalThis.fetch = async () => new Response("<html>portal</html>", { headers: { "Content-Type": "text/html; charset=utf-8" } });
    await assert.rejects(api("/fixture/portal", { retry: 0 }), (error) =>
      error.code === "NETWORK" && /Wi-Fi/.test(error.message));
    assert.equal(getConnectivity().online, false);
    globalThis.fetch = async () => Response.json({ ok: true });
    await api("/fixture/portal");
    assert.equal(getConnectivity().online, true);
  } finally { globalThis.fetch = original; }
});
