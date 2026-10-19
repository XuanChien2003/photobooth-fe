import assert from "node:assert/strict";
import { test } from "node:test";
import { createCanvasCache } from "../src/canvas-cache.js";

test("decoded-pixel budget evicts least-recently-used photos without damaging consumers", async () => {
  const cache = createCanvasCache({ maxPixels: 200, maxEntries: 10 });
  let loads = 0;
  const image = () => { loads++; return { width: 10, height: 10 }; };
  const first = await cache.remember("first", image);
  const second = await cache.remember("second", image);
  assert.equal(await cache.remember("first", image), first);
  await cache.remember("third", image);
  assert.deepEqual([...cache.keys()], ["first", "third"]);
  assert.deepEqual([second.width, second.height], [10, 10]);
  assert.notEqual(await cache.remember("second", image), second);
  assert.equal(loads, 4);
});

test("one oversized current photo remains reusable and entry count bounds tiny photos", async () => {
  const cache = createCanvasCache({ maxPixels: 100, maxEntries: 2 });
  const large = await cache.remember("large", () => ({ width: 1000, height: 1000 }));
  assert.equal(await cache.remember("large", () => assert.fail("duplicate")), large);
  for (const key of ["a", "b", "c"])
    await cache.remember(key, () => ({ width: 1, height: 1 }));
  assert.deepEqual([...cache.keys()], ["b", "c"]);
  assert.equal(large.width, 1000);
});

test("concurrent loads share work; failures retry and stale failures cannot remove replacements", async () => {
  const cache = createCanvasCache();
  let rejectOld;
  const old = cache.remember("one", () => new Promise((_, reject) => { rejectOld = reject; }));
  assert.equal(cache.remember("one", () => assert.fail("duplicate")), old);
  const rejected = assert.rejects(old, /old failure/);
  await new Promise(resolve => setImmediate(resolve));
  cache.delete("one");
  const fresh = cache.remember("one", () => ({ width: 20, height: 30 }));
  rejectOld(new Error("old failure"));
  await rejected;
  assert.equal(cache.remember("one", () => assert.fail("replacement removed")), fresh);
  await assert.rejects(cache.remember("bad", () => { throw new Error("retry"); }), /retry/);
  assert.equal((await cache.remember("bad", () => ({ width: 1, height: 1 }))).width, 1);
});
