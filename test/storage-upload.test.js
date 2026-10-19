import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { putToStorage } from "../src/kiosk/storage-upload.js";

const originalXHR = globalThis.XMLHttpRequest, originalFetch = globalThis.fetch;
const requests = [];
class UploadRequest {
  constructor() { this.upload = {}; this.headers = {}; this.aborts = 0; requests.push(this); }
  open(method, url, async) { Object.assign(this, { method, url, async }); }
  setRequestHeader(key, value) { this.headers[key] = value; }
  send(body) { this.body = body; }
  abort() { this.aborts++; this.onabort?.(); }
  progress(loaded) { this.upload.onprogress?.({ loaded }); }
  respond(status = 200) { this.status = status; this.onload?.(); }
}
beforeEach(() => { requests.length = 0; globalThis.XMLHttpRequest = UploadRequest; });
afterEach(() => {
  if (originalXHR === undefined) delete globalThis.XMLHttpRequest;
  else globalThis.XMLHttpRequest = originalXHR;
  globalThis.fetch = originalFetch;
});
const file = new Blob([Uint8Array.of(0xff, 0xd8, 25, 70, 0xff, 0xd9)], { type: "image/jpeg" });
const url = "https://media.account.r2.cloudflarestorage.com/image.jpg?signature=fixture";
function clean(request) {
  assert.equal(request.onload, null); assert.equal(request.onerror, null);
  assert.equal(request.onabort, null); assert.equal(request.upload.onprogress, null);
  assert.equal(request.upload.onload, null);
}

test("browser storage PUT sends the same JPEG blob without credentials and cleans its handlers", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const saving = putToStorage(url, file);
  const request = requests[0];
  assert.equal(request.method, "PUT"); assert.equal(request.url, url);
  assert.equal(request.async, true); assert.equal(request.withCredentials, false);
  assert.deepEqual(request.headers, { "Content-Type": "image/jpeg" });
  assert.equal(request.body, file, "no recompression, base64 or replacement body");
  request.respond(); await saving; clean(request);
  t.mock.timers.tick(200000);
  assert.equal(request.aborts, 0, "completion cleared both deadlines");
});

test("a stalled storage upload aborts after 30 seconds instead of occupying a camera slot for three minutes", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const saving = putToStorage(url, file);
  const rejected = assert.rejects(saving, error => error.code === "TIMEOUT");
  t.mock.timers.tick(29999); assert.equal(requests[0].aborts, 0);
  t.mock.timers.tick(1); await rejected;
  assert.equal(requests[0].aborts, 1); clean(requests[0]);
});

test("only new upload bytes reset inactivity; continuous slow uploads can use the full overall budget", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const saving = putToStorage(url, file);
  const request = requests[0];
  for (let i = 1; i <= 7; i++) {
    t.mock.timers.tick(20000); request.progress(i);
    assert.equal(request.aborts, 0);
  }
  request.upload.onload();
  t.mock.timers.tick(20000); request.respond(); await saving;
  assert.equal(request.aborts, 0); clean(request);
  const stuck = putToStorage(url, file);
  const rejected = assert.rejects(stuck, error => error.code === "TIMEOUT");
  const second = requests[1];
  t.mock.timers.tick(20000); second.progress(1);
  t.mock.timers.tick(20000); second.progress(1); // repeated event is not progress
  t.mock.timers.tick(10000); await rejected;
  assert.equal(second.aborts, 1); clean(second);
});

test("the overall deadline still aborts an upload that keeps making progress", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const saving = putToStorage(url, file);
  const rejected = assert.rejects(saving, error => error.code === "TIMEOUT");
  for (let i = 1; i <= 8; i++) { t.mock.timers.tick(20000); requests[0].progress(i); }
  t.mock.timers.tick(20000); await rejected;
  assert.equal(requests[0].aborts, 1); clean(requests[0]);
});

test("finishing the bytes cannot leave a missing storage acknowledgement hanging", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const saving = putToStorage(url, file);
  const rejected = assert.rejects(saving, error => error.code === "TIMEOUT");
  t.mock.timers.tick(20000); requests[0].progress(file.size);
  requests[0].upload.onload();
  t.mock.timers.tick(29999); assert.equal(requests[0].aborts, 0);
  t.mock.timers.tick(1); await rejected;
  assert.equal(requests[0].aborts, 1); clean(requests[0]);
});

test("network errors, refused PUTs and explicit cancellation settle once and clear handlers", async () => {
  const failed = putToStorage(url, file);
  requests[0].onerror();
  await assert.rejects(failed, error => error.code === "NETWORK"); clean(requests[0]);
  const denied = putToStorage(url, file);
  requests[1].respond(403);
  await assert.rejects(denied, error => error.status === 403); clean(requests[1]);
  const abort = new AbortController();
  const canceled = putToStorage(url, file, { signal: abort.signal });
  abort.abort();
  await assert.rejects(canceled, { name: "AbortError" });
  assert.equal(requests[2].aborts, 1); clean(requests[2]);
});

test("environments without XHR retain the byte-preserving fetch transport", async () => {
  delete globalThis.XMLHttpRequest;
  let sent;
  globalThis.fetch = async (address, init) => { sent = { address, ...init }; return new Response(null, { status: 200 }); };
  await putToStorage(url, file);
  assert.equal(sent.address, url); assert.equal(sent.method, "PUT");
  assert.equal(sent.body, file); assert.equal(sent.credentials, "omit");
  assert.equal(sent.referrerPolicy, "no-referrer");
});
