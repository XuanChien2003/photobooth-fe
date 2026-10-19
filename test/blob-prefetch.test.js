import assert from "node:assert/strict";
import { test } from "node:test";
import { createBlobPrefetch } from "../src/album/blob-prefetch.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("print sources download a few photos ahead and never more than that at once", async () => {
  const started = [], pending = new Map();
  const ahead = createBlobPrefetch((id) => {
    started.push(id);
    const d = deferred();
    pending.set(id, d);
    return d.promise;
  }, { ahead: 3 });
  ahead.prefetch(["a", "b", "c", "d", "e", "b"]);
  assert.deepEqual(started, ["a", "b", "c"], "three ahead, duplicates ignored");
  pending.get("a").resolve("blob-a");
  await tick();
  assert.deepEqual(started, ["a", "b", "c"], "a finished download still counts until it is used");
  assert.equal(await ahead.take("a"), "blob-a");
  assert.deepEqual(started, ["a", "b", "c", "d"], "using one starts the next");
  assert.equal(ahead.take("a"), undefined, "handed over once");
  assert.equal(ahead.take("zzz"), undefined);
  // A failed download frees its place and is fetched normally later.
  pending.get("b").reject(new Error("network"));
  await tick();
  assert.deepEqual(started, ["a", "b", "c", "d", "e"]);
  assert.equal(ahead.take("b"), undefined);
  // A new plan keeps only the downloads that still belong to it.
  ahead.prefetch(["c", "f"]);
  pending.get("c").resolve("blob-c");
  assert.equal(await ahead.take("c"), "blob-c");
  assert.deepEqual(started, ["a", "b", "c", "d", "e", "f"]);
});

test("changing the frame plan aborts obsolete downloads and starts the new plan immediately", async () => {
  const downloads = [];
  const ahead = createBlobPrefetch((id, { signal }) => {
    const pending = deferred();
    signal.addEventListener("abort", () => pending.reject(new DOMException("Aborted", "AbortError")));
    downloads.push({ id, signal, ...pending });
    return pending.promise;
  }, { ahead: 2 });
  ahead.prefetch(["old-1", "keep", "never-start"]);
  ahead.prefetch(["keep", "new-1", "new-2"]);
  assert.deepEqual(downloads.map(item => item.id), ["old-1", "keep", "new-1"]);
  assert.equal(downloads[0].signal.aborted, true);
  assert.equal(downloads[1].signal.aborted, false, "a wanted request remains shared");
  await tick();
  assert.equal(ahead.take("old-1"), undefined);
  downloads[1].resolve("kept pixels");
  assert.equal(await ahead.take("keep"), "kept pixels");
  assert.deepEqual(downloads.map(item => item.id), ["old-1", "keep", "new-1", "new-2"]);
  ahead.clear();
  await tick();
});

test("leaving the result screen cancels unused downloads without aborting a handed-over print source", async () => {
  const signals = new Map(), pending = new Map();
  const ahead = createBlobPrefetch((id, { signal }) => {
    const request = deferred();
    signals.set(id, signal);
    pending.set(id, request);
    signal.addEventListener("abort", () => request.reject(new DOMException("Aborted", "AbortError")));
    return request.promise;
  }, { ahead: 2 });
  ahead.prefetch(["painting", "unused", "queued"]);
  const printing = ahead.take("painting");
  ahead.clear();
  assert.equal(signals.get("painting").aborted, false);
  assert.equal(signals.get("unused").aborted, true);
  assert.equal(signals.get("queued").aborted, true);
  assert.equal(ahead.take("unused"), undefined);
  pending.get("painting").resolve("original print bytes");
  assert.equal(await printing, "original print bytes");
  await tick();
  ahead.prefetch(["return"]);
  assert.equal(signals.get("return").aborted, false, "a later result screen can prefetch again");
  pending.get("return").resolve("new print bytes");
  assert.equal(await ahead.take("return"), "new print bytes");
});
