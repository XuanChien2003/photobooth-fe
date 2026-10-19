import assert from "node:assert/strict";
import test from "node:test";
import {
  compareFrameOrder,
  frameDisplayNames,
} from "../src/frame-catalog-data.js";

test("duplicate frame names get stable aliases without changing stored names", () => {
  const items = [
    { _id: "b", name: "pink", themeName: "cute", order: 1 },
    { _id: "a", name: "pink", themeName: " cute ", order: 2 },
    { _id: "c", name: "pink", themeName: "other", order: 1 },
    { _id: "d", name: "Unique", themeName: "cute", order: 3 },
  ];
  const before = structuredClone(items);
  const names = frameDisplayNames(items);
  assert.equal(names.get("a"), "pink · 01");
  assert.equal(names.get("b"), "pink · 02");
  assert.equal(names.get("c"), "pink");
  assert.equal(names.get("d"), "Unique");
  assert.deepEqual(items, before);
  const moved = items.map((frame) => ({ ...frame, order: 10 - frame.order }));
  assert.deepEqual(frameDisplayNames(moved), names);
});

test("legacy frames with equal order have deterministic order across API responses", () => {
  const frames = [{ _id: "c", order: 2 }, { _id: "b" }, { _id: "a", order: 0 }];
  assert.deepEqual(
    frames.sort(compareFrameOrder).map((frame) => frame._id),
    ["a", "b", "c"],
  );
});
