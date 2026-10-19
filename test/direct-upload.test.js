import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createRequire } from "node:module";
import { savePhoto, resetDirectUploads } from "../src/kiosk/direct-upload.js";
import { cleanJpegMetadata } from "../../Photo_BE/src/services/jpeg-metadata.js";

const sharp = createRequire(new URL("../../Photo_BE/package.json", import.meta.url))("sharp");
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });
beforeEach(() => resetDirectUploads());

const camera = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#884455" } })
  .withMetadata({ orientation: 6, exif: { IFD0: { Make: "FUJIFILM", Artist: "private" } } }).jpeg().toBuffer();
const cleaned = cleanJpegMetadata(camera, 6);
const preview = new Blob([await sharp(camera).rotate().jpeg().toBuffer()], { type: "image/jpeg" });
const image = new Blob([camera], { type: "image/jpeg" });
const STORAGE = "https://test-media.account.r2.cloudflarestorage.com/media/x.jpg?X-Amz-Signature=1";
const options = { captureToken: "capture-token", clientKey: "camera-0123456789", mirrored: true, preview };

// A scripted network: each request is matched by kind and answered by the test.
function network(answers) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const kind = String(url).includes(".r2.cloudflarestorage.com") ? "storage"
      : String(url).endsWith("/upload-url") ? "ticket" : "commit";
    const call = { kind, url: String(url), init };
    calls.push(call);
    return answers[kind](call);
  };
  return calls;
}
const json = (body, status = 200) => () => Response.json(body, { status });
const bytes = async (body) => Buffer.from(await body.arrayBuffer());

test("the camera original goes straight to storage and the server only gets the preview", async () => {
  const calls = network({
    ticket: json({ upload: { url: STORAGE, stored: "stored-token" } }),
    storage: () => new Response(null, { status: 200 }),
    commit: json({ photos: [{ id: "p1" }] }),
  });
  assert.deepEqual(await savePhoto("/kiosk/photo", image, options), { photos: [{ id: "p1" }] });
  assert.deepEqual(calls.map((c) => c.kind), ["ticket", "storage", "commit"]);
  assert.deepEqual(JSON.parse(calls[0].init.body),
    { clientKey: options.clientKey, size: cleaned.length, captureToken: "capture-token" });
  assert.match(calls[0].url, /\/api\/kiosk\/photo\/upload-url$/);
  const put = calls[1].init;
  assert.equal(put.method, "PUT");
  assert.equal(put.credentials, "omit");
  assert.equal(put.headers["Content-Type"], "image/jpeg");
  assert.deepEqual(await bytes(put.body), cleaned, "private metadata removed, pixels untouched");
  const commit = calls[2].init;
  assert.deepEqual(await bytes(commit.body), await bytes(preview), "only the preview reaches the server");
  assert.equal(commit.headers["X-Photo-Stored"], "stored-token");
  assert.equal(commit.headers["X-Photo-Key"], options.clientKey);
  assert.equal(commit.headers["X-Capture-Token"], "capture-token");
  assert.equal(commit.headers["X-Photo-Mirrored"], "1");
  assert.equal(commit.headers["X-Photo-Preview-Length"], undefined);
});

test("storage that refuses uploads sends photos through the server for a while", async () => {
  const calls = network({
    ticket: json({ upload: { url: STORAGE, stored: "stored-token" } }),
    storage: () => { throw new TypeError("Failed to fetch"); }, // e.g. CORS without PUT
    commit: json({ photos: [] }),
  });
  await savePhoto("/kiosk/photo", image, options);
  await savePhoto("/kiosk/photo", image, { ...options, clientKey: "camera-second-photo" });
  assert.deepEqual(calls.map((c) => c.kind), ["ticket", "storage", "commit", "commit"],
    "after one failure the next photo skips the storage attempt");
  for (const call of calls.filter((c) => c.kind === "commit")) {
    assert.equal(call.init.headers["X-Photo-Stored"], undefined);
    assert.equal(call.init.headers["X-Photo-Preview-Length"], String(preview.size));
    assert.deepEqual((await bytes(call.init.body)).subarray(0, camera.length), camera, "the usual full upload");
  }
});

test("a stalled browser PUT falls back once with the intact original and releases the next capture", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const previous = globalThis.XMLHttpRequest;
  let uploading, aborts = 0;
  globalThis.XMLHttpRequest = class {
    constructor() { this.upload = {}; uploading = this; }
    open() {} setRequestHeader() {} send(body) { this.body = body; }
    abort() { aborts++; this.onabort?.(); }
  };
  try {
    const calls = network({
      ticket: json({ upload: { url: STORAGE, stored: "stored-token" } }),
      commit: json({ photos: [] }),
    });
    const saving = savePhoto("/kiosk/photo", image, options);
    while (!uploading) await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(await bytes(uploading.body), cleaned);
    t.mock.timers.tick(30000);
    await saving;
    assert.equal(aborts, 1);
    assert.deepEqual(calls.map(call => call.kind), ["ticket", "commit"]);
    assert.deepEqual((await bytes(calls[1].init.body)).subarray(0, camera.length), camera);
    assert.equal(calls[1].init.headers["X-Photo-Stored"], undefined);
    await savePhoto("/kiosk/photo", image, { ...options, clientKey: "camera-after-stall" });
    assert.deepEqual(calls.map(call => call.kind), ["ticket", "commit", "commit"],
      "following captures use the existing fallback instead of waiting on storage again");
  } finally {
    if (previous === undefined) delete globalThis.XMLHttpRequest;
    else globalThis.XMLHttpRequest = previous;
  }
});

test("an unusable stored upload, an older server and a half-written file all fall back", async () => {
  let calls = network({
    ticket: json({ upload: { url: STORAGE, stored: "stored-token" } }),
    storage: () => new Response(null, { status: 200 }),
    commit: (call) => call.init.headers["X-Photo-Stored"]
      ? Response.json({ message: "không dùng được" }, { status: 422 }) : Response.json({ photos: [] }),
  });
  await savePhoto("/kiosk/photo", image, options);
  assert.deepEqual(calls.map((c) => [c.kind, Boolean(c.init.headers?.["X-Photo-Stored"])]),
    [["ticket", false], ["storage", false], ["commit", true], ["commit", false]]);
  calls = network({ ticket: json({ message: "API không tồn tại." }, 404), commit: json({ photos: [] }) });
  await savePhoto("/albums/token/photos", image, { clientKey: "camera-older-server", preview });
  assert.deepEqual(calls.map((c) => c.kind), ["ticket", "commit"]);
  assert.match(calls[0].url, /\/api\/albums\/token\/photos\/upload-url$/);
  calls = network({ commit: json({ photos: [] }) });
  await savePhoto("/kiosk/photo", new Blob([camera.subarray(0, camera.length - 50)]), options);
  assert.deepEqual(calls.map((c) => c.kind), ["commit"], "the server judges an incomplete file as before");
});

test("a lost commit reply is retried without uploading 15 MB again; saved photos come back at once", async () => {
  let reachable = false;
  const calls = network({
    ticket: json({ upload: { url: STORAGE, stored: "stored-token" } }),
    storage: () => new Response(null, { status: 200 }),
    commit: () => { if (!reachable) throw new TypeError("Failed to fetch"); return Response.json({ photos: [1] }); },
  });
  await assert.rejects(savePhoto("/kiosk/photo", image, options));
  reachable = true;
  assert.deepEqual(await savePhoto("/kiosk/photo", image, options), { photos: [1] });
  const kinds = calls.map((c) => c.kind);
  assert.equal(kinds.filter((k) => k === "storage").length, 1, "uploaded once");
  assert.equal(kinds.filter((k) => k === "ticket").length, 1);
  assert.ok(calls.filter((c) => c.kind === "commit").every((c) => c.init.headers["X-Photo-Stored"] === "stored-token"));
  const already = { photos: [{ id: "p9", clientKey: "camera-already-saved" }] };
  const saved = network({ ticket: json({ saved: true, booking: already }) });
  assert.deepEqual(await savePhoto("/kiosk/photo", image, { ...options, clientKey: "camera-already-saved" }), already);
  assert.deepEqual(saved.map((c) => c.kind), ["ticket"]);
  // An answer that does not show this photo saved (or names another host) is never trusted.
  for (const ticket of [{ saved: true, booking: { photos: [] } }, { booking: already },
    { upload: { url: "https://example.com/upload", stored: "t" } }]) {
    const odd = network({ ticket: json(ticket), commit: json({ photos: [] }) });
    await savePhoto("/kiosk/photo", image, { ...options, clientKey: "camera-already-saved" });
    assert.deepEqual(odd.map((c) => c.kind), ["ticket", "commit"]);
    assert.equal(odd[1].init.headers["X-Photo-Stored"], undefined);
  }
});
