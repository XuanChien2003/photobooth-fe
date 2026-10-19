import assert from "node:assert/strict";
import test from "node:test";
import { compositionPhotos, packCapacity } from "../src/album/frame-capacity.js";
import { createFavoriteQueue } from "../src/album/favorite-queue.js";

const pack = (id, ...counts) => ({
  id,
  frames: counts.map((count) => ({
    slots: Array.from({ length: count }, () => ({})),
  })),
});

test("frame capacity counts all slots across a set without limiting favorites", () => {
  const packs = [
    pack("twelve", 4, 4, 4),
    pack("thirteen", 6, 7),
    pack("fourteen", 14),
  ];
  assert.deepEqual(packs.map(packCapacity), [12, 13, 14]);
});

test("a missing or empty frame set needs no photos", () => {
  assert.equal(packCapacity(), 0);
  assert.equal(packCapacity(pack("empty", 0)), 0);
  assert.equal(packCapacity({ frames: [{}, { slots: [{}] }] }), 1);
});

test("composition keeps all favorites and includes other originals only after automatic-fill consent", () => {
  const originals = Array.from({ length: 20 }, (_, index) => ({
    id: `photo-${index + 1}`, kind: "original", favorite: index < 18,
  }));
  const derived = { id: "collage", kind: "composite", favorite: true };
  const photos = [...originals, derived];
  assert.deepEqual(compositionPhotos(photos), originals.slice(0, 18));
  assert.deepEqual(compositionPhotos(photos, { includeOthers: true }), originals);
  assert.equal(photos.length, 21);
  assert.equal(originals.filter((photo) => photo.favorite).length, 18,
    "Building an automatic pool must not create extra favorites");
});

test("an automatic pool orders favorites first and can compose an album with zero hearts", () => {
  const photos = [
    { id: "other-1", kind: "original", favorite: false },
    { id: "favorite-1", kind: "original", favorite: true },
    { id: "other-2", kind: "original", favorite: false },
    { id: "favorite-2", kind: "original", favorite: true },
  ];
  assert.deepEqual(compositionPhotos(photos, { includeOthers: true }).map((photo) => photo.id),
    ["favorite-1", "favorite-2", "other-1", "other-2"]);
  const noHearts = photos.map((photo) => ({ ...photo, favorite: false }));
  assert.deepEqual(compositionPhotos(noHearts), []);
  assert.deepEqual(compositionPhotos(noHearts, { includeOthers: true }), noHearts);
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test("20 quick favorites exceed frame capacity while retaining the latest selection and serializing PUTs", async () => {
  const requests = [];
  const saved = [];
  const states = [];
  const queue = createFavoriteQueue({
    save: (ids) => {
      const request = { ids, ...deferred() };
      requests.push(request);
      return request.promise;
    },
    onSaved: (result, latest) => saved.push({ result, latest }),
    onError: () => assert.fail("No request should fail"),
    onPending: (pending) => states.push(pending),
  });
  queue.enqueue(["1"], []);
  await Promise.resolve();
  for (let n = 2; n <= 20; n++) {
    queue.enqueue(
      Array.from({ length: n }, (_, i) => String(i + 1)),
      ["1"],
    );
  }
  assert.equal(requests.length, 1);
  requests[0].resolve("first");
  await Promise.resolve();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].ids.length, 20);
  assert.deepEqual(
    requests[1].ids,
    Array.from({ length: 20 }, (_, i) => String(i + 1)),
  );
  requests[1].resolve("final");
  await queue.whenIdle();
  assert.deepEqual(saved, [
    { result: "first", latest: false },
    { result: "final", latest: true },
  ]);
  assert.deepEqual(states, [true, false]);
});

test("a failed final save restores the last server-confirmed selection", async () => {
  const requests = [];
  const errors = [];
  const queue = createFavoriteQueue({
    save: (ids) => {
      const request = { ids, ...deferred() };
      requests.push(request);
      return request.promise;
    },
    onSaved: () => {},
    onError: (error, confirmed) =>
      errors.push({ message: error.message, confirmed }),
    onPending: () => {},
  });
  queue.enqueue(["one"], []);
  await Promise.resolve();
  queue.enqueue(["one", "two"], ["one"]);
  requests[0].resolve({});
  await Promise.resolve();
  requests[1].reject(new Error("Offline"));
  await queue.whenIdle();
  assert.deepEqual(errors, [{ message: "Offline", confirmed: ["one"] }]);
});

test("a failed old request does not discard a newer selection", async () => {
  const requests = [];
  const errors = [];
  const saved = [];
  const queue = createFavoriteQueue({
    save: (ids) => {
      const request = { ids, ...deferred() };
      requests.push(request);
      return request.promise;
    },
    onSaved: (result, latest) => saved.push({ result, latest }),
    onError: (error, confirmed) => errors.push(confirmed),
    onPending: () => {},
  });
  queue.enqueue(["one"], []);
  await Promise.resolve();
  queue.enqueue(["one", "two"], ["one"]);
  requests[0].reject(new Error("Temporary failure"));
  await Promise.resolve();
  assert.deepEqual(errors, [null]);
  requests[1].resolve("both");
  await queue.whenIdle();
  assert.deepEqual(saved, [{ result: "both", latest: true }]);
});

test("effect setup after StrictMode cleanup keeps the queue usable", async () => {
  const saved = [];
  const queue = createFavoriteQueue({
    save: async (ids) => ids,
    onSaved: (result) => saved.push(result),
    onError: () => assert.fail("No request should fail"),
    onPending: () => {},
  });
  queue.dispose();
  queue.activate();
  await queue.enqueue(["one"], []);
  assert.deepEqual(saved, [["one"]]);
});
