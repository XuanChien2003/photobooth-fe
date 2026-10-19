import assert from "node:assert/strict";
import { test } from "node:test";
import { createUploadedOriginals, mergeUploadedPhotos, uploadPhotos } from "../src/album/upload-photos.js";

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test("phone batch pipelines two files, handles reordered responses and waits before unlocking", async () => {
  const requests = Array.from({ length: 4 }, deferred);
  let active = 0, peak = 0;
  const started = [], saved = [];
  const task = uploadPhotos([0, 1, 2, 3], {
    upload: async file => {
      started.push(file); peak = Math.max(peak, ++active);
      try { return await requests[file].promise; } finally { active--; }
    },
    onSaved: response => saved.push(response),
  });
  await tick();
  assert.deepEqual(started, [0, 1]);
  requests[1].resolve("second"); await tick();
  assert.deepEqual(started, [0, 1, 2]);
  requests[2].resolve("third"); await tick();
  requests[3].resolve("fourth"); await tick();
  assert.equal(active, 1, "first request is still retained");
  requests[0].resolve("first");
  assert.deepEqual(await task, { done: 4, error: undefined });
  assert.equal(peak, 2);
  assert.deepEqual(saved, ["second", "third", "fourth", "first"]);
});

test("a failed batch stops new files but keeps successful in-flight confirmations", async () => {
  const requests = [deferred(), deferred()];
  const started = [], saved = [];
  const failure = new Error("offline");
  const task = uploadPhotos([0, 1, 2], {
    upload: file => { started.push(file); return requests[file].promise; },
    onSaved: response => saved.push(response),
  });
  requests[0].reject(failure); await tick();
  assert.deepEqual(started, [0, 1]);
  requests[1].resolve("confirmed");
  assert.deepEqual(await task, { done: 1, error: failure });
  assert.deepEqual(saved, ["confirmed"]);
});

test("large originals stay sequential to keep upload memory bounded", async () => {
  const requests = [deferred(), deferred()];
  const started = [];
  const task = uploadPhotos([{ size: 20 * 1024 * 1024 }, { size: 1024 }], {
    upload: (_, index) => { started.push(index); return requests[index].promise; },
    onSaved() {},
  });
  await tick();assert.deepEqual(started, [0]);
  requests[0].resolve({});await tick();assert.deepEqual(started, [0, 1]);
  requests[1].resolve({});assert.equal((await task).done, 2);
});

test("late upload responses cannot remove photos, reset favorites or overwrite a print quota", () => {
  const first = { id: "one", number: 1, favorite: true };
  const second = { id: "two", number: 2 };
  const current = { prints: 7, printSheets: 3, photos: [first, second] };
  const response = { prints: 1, printSheets: 0, photos: [{ ...first, favorite: false }] };
  assert.deepEqual(mergeUploadedPhotos(current, response), { ...current, mediaDeleted: false });
  const next = mergeUploadedPhotos(current, { photos: [{ id: "three", number: 3 }, second, first] });
  assert.deepEqual(next.photos.map(p => p.id), ["one", "two", "three"]);
  // #02 was deleted on another device: the server renumbered, the page takes its numbers but
  // keeps its own favorite state.
  const renumbered = mergeUploadedPhotos(next, { photos: [{ ...first, favorite: false }, { id: "three", number: 2 }, { id: "four", number: 3 }] });
  assert.deepEqual(renumbered.photos.map(p => [p.id, p.number]), [["one", 1], ["two", 2], ["three", 2], ["four", 3]]);
  assert.equal(renumbered.photos[0].favorite, true);
});

test("uploaded JPEG cache retains the exact file and bounds compressed bytes with recent-use eviction", async () => {
  const cache = createUploadedOriginals({ maxBytes: 8, maxEntries: 2 });
  const jpeg = value => new Blob([value], { type: "image/jpeg" });
  const first = jpeg("1234"), second = jpeg("5678"), third = jpeg("90");
  cache.remember("one", first); cache.remember("two", second);
  assert.equal(cache.get("one"), first);
  cache.remember("three", third);
  assert.equal(cache.get("two"), undefined);
  assert.equal(cache.get("one"), first);
  assert.equal(await cache.get("one").text(), "1234");
  cache.remember("large", jpeg("123456789"));
  cache.remember("png", new Blob(["png"], { type: "image/png" }));
  assert.equal(cache.get("large"), undefined);
  assert.equal(cache.get("png"), undefined, "server converts non-JPEG; use that canonical original");
});
