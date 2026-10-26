import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createCanonServer } from "../scripts/canon-camera/server.js";
import { prepareShutter } from "../src/kiosk/shutter.js";
import { saveCanonConfig } from "../src/kiosk/canon-camera.js";
const storage = new Map();
globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
const fetchOriginal = globalThis.fetch, origin = "http://localhost:5173", token = "fixture-agent-token";
let server, base, failShot = false;
const calls = [];
before(async () => {
  server = createCanonServer({ token, origins: [origin], driver: { async request(action, payload) {
    calls.push({ action, payload });
    if (action === "shoot" && failShot) throw new Error("Response lost after physical exposure");
    return { connected: true, model: "Canon EOS R50", folder: "C:\\PhotoBooth\\CanonR50" };
  } } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  globalThis.fetch = (url, options) => fetchOriginal(String(url).replace("http://127.0.0.1:8788", base), options);
  saveCanonConfig({ token });
});
after(async () => { globalThis.fetch = fetchOriginal; await new Promise((resolve) => server.close(resolve)); });
const post = (action, body, headers = {}) => fetchOriginal(`${base}/${action}`, { method: "POST",
  headers: { Origin: origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("Canon client uses USB agent despite legacy Bluetooth/HDMI preferences", async () => {
  storage.set("kiosk-shutter", "hdmi"); storage.set("kiosk-camera-bluetooth", "legacy-pair");
  const shutter = await prepareShutter();
  await shutter.focus(); await shutter.press(); await shutter.release();
  assert.deepEqual(calls.map((c) => c.action), ["connect", "focus", "shoot", "release"]);
  assert.ok(calls[2].payload.requestId);
  assert.ok(calls[2].payload.expiresAt > Date.now());
});
test("agent rejects foreign origins and incorrect connection tokens before touching camera", async () => {
  const before = calls.length;
  assert.equal((await post("connect", {}, { Origin: "https://untrusted.example" })).status, 403);
  assert.equal((await post("connect", {}, { Authorization: "Bearer wrong" })).status, 401);
  assert.equal(calls.length, before);
});
test("local network preflight is allowed for the kiosk without exposing the token", async () => {
  const response = await fetchOriginal(`${base}/shoot`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Private-Network": "true" } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  assert.equal(response.headers.get("Access-Control-Allow-Private-Network"), "true");
  assert.equal(await response.text(), "");
});
test("duplicate simultaneous exposure IDs cause exactly one camera command", async () => {
  const before = calls.length, payload = { requestId: "same-exposure", expiresAt: Date.now() + 3000 };
  const responses = await Promise.all([post("shoot", payload), post("shoot", payload)]);
  assert.ok(responses.every((r) => r.status === 200));
  assert.equal(calls.length - before, 1);
});
test("ambiguous failed exposure is remembered and cannot fire again", async () => {
  failShot = true;
  const before = calls.length, payload = { requestId: "ambiguous-exposure", expiresAt: Date.now() + 3000 };
  assert.equal((await post("shoot", payload)).status, 503);
  assert.equal((await post("shoot", payload)).status, 503);
  assert.equal(calls.length - before, 1);
  failShot = false;
});
test("expired commands and pre-cancelled client calls never touch the camera", async () => {
  const before = calls.length;
  assert.equal((await post("shoot", { requestId: "expired-exposure", expiresAt: Date.now() - 1 })).status, 409);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(prepareShutter(undefined, abort.signal), { name: "AbortError" });
  assert.equal(calls.length, before);
});
test("camera connection must be configured on this computer", async () => {
  saveCanonConfig({ token: "" });
  const before = calls.length;
  await assert.rejects(prepareShutter(), /Chưa cài kết nối Canon R50/);
  assert.equal(calls.length, before);
  saveCanonConfig({ token });
});
