import { test } from "node:test";
import assert from "node:assert/strict";
import { imageRect } from "../src/image-utils.js";

test("wide camera input crops centrally to 4:3 without stretching", () => {
  const r = imageRect(1920, 1080, 1000, 750, "cover");
  assert.equal(r.height, 750);
  assert.ok(Math.abs(r.width / r.height - 16 / 9) < 0.0001);
  assert.ok(r.x < 0);
  assert.equal(r.y, 0);
});
test("portrait images remain complete and centered inside a landscape frame", () => {
  const r = imageRect(750, 1000, 630, 435);
  assert.equal(r.height, 435);
  assert.equal(r.width, 326.25);
  assert.equal(r.x, 151.875);
  assert.equal(r.y, 0);
});
test("zero-size camera frames are rejected instead of saving a blank image", () => {
  assert.throws(() => imageRect(0, 0, 1000, 750));
});
