import assert from "node:assert/strict";
import { test } from "node:test";
import { clampZoom, PHOTO_ZOOM, slotScale } from "../src/frame-utils.js";

test("a photo shrinks to 50% of the slot-filling size and grows to 300%", () => {
  assert.deepEqual(PHOTO_ZOOM, { min: 0.5, max: 3 });
  assert.equal(clampZoom(0.1), 0.5);
  assert.equal(clampZoom(5), 3);
  assert.equal(clampZoom(undefined), 1);
  assert.equal(clampZoom(Number.NaN), 1);
  // Ảnh 300 × 200 trong ô 100 × 100: 100 % = phủ kín ô (cạnh ngắn bằng ô), 50 % = một nửa.
  const image = { width: 300, height: 200 }, rect = { w: 100, h: 100 };
  assert.equal(slotScale(image, rect, { zoom: 1 }), 0.5);
  assert.equal(slotScale(image, rect, { zoom: 0.5 }), 0.25);
  assert.equal(slotScale(image, rect, { zoom: 0.2 }), 0.25, "never below 50%");
});
