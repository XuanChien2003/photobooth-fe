import assert from "node:assert/strict";
import { test } from "node:test";
import { detectSlots } from "../src/frame-utils.js";

function frameFixture(count, transparent = false) {
  // A portrait 10×15 frame sampled at the editor's maximum 800px probe size.
  const width = 533;
  const height = 800;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data.set([82, 46, 34, 255], i);
  }
  const paint = (rect, color) => {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        data.set(color, (y * width + x) * 4);
      }
    }
  };
  const columns = count === 12 ? 3 : 4;
  const rows = 4;
  const gutter = 18;
  const margin = 32;
  const top = 80;
  const bottom = 80;
  const slotWidth = Math.floor(
    (width - margin * 2 - gutter * (columns - 1)) / columns,
  );
  const slotHeight = Math.floor(
    (height - top - bottom - gutter * (rows - 1)) / rows,
  );
  const rectangles = Array.from({ length: count }, (_, index) => ({
    x: margin + (index % columns) * (slotWidth + gutter),
    y: top + Math.floor(index / columns) * (slotHeight + gutter),
    w: slotWidth,
    h: slotHeight,
  }));
  for (const rect of rectangles) {
    paint(rect, transparent ? [0, 0, 0, 0] : [255, 255, 255, 255]);
  }
  // Decorative dots, a small logo and a fine white border are not photo slots.
  paint({ x: 30, y: 20, w: 8, h: 8 }, [255, 255, 255, 255]);
  paint({ x: 200, y: 24, w: 50, h: 22 }, [255, 255, 255, 255]);
  paint({ x: 3, y: 3, w: width - 6, h: 3 }, [255, 255, 255, 255]);
  return { image: { data, width, height }, rectangles, paint };
}

for (const count of [12, 13, 14]) {
  for (const transparent of [false, true]) {
    test(`detects ${count} ${transparent ? "transparent" : "white"} photo slots with headers and gutters`, () => {
      const { image, rectangles } = frameFixture(count, transparent);
      const slots = detectSlots(image);
      assert.equal(slots.length, count);
      assert.deepEqual(
        slots,
        rectangles.map(({ x, y, w, h }) => ({
          x: x / image.width,
          y: y / image.height,
          w: w / image.width,
          h: h / image.height,
        })),
      );
      for (const slot of slots) {
        assert.ok(slot.x >= 0 && slot.y >= 0 && slot.w > 0 && slot.h > 0);
        assert.ok(slot.x + slot.w <= 1 && slot.y + slot.h <= 1);
      }
    });
  }
}

test("thin white connectors do not merge neighboring photo slots", () => {
  const { image, rectangles, paint } = frameFixture(14);
  const [first, second] = rectangles;
  paint(
    {
      x: first.x + first.w,
      y: first.y + Math.floor(first.h / 2),
      w: second.x - first.x - first.w,
      h: 2,
    },
    [255, 255, 255, 255],
  );
  assert.equal(detectSlots(image).length, 14);
});

test("small white decorations alone do not become photo slots", () => {
  const { image, rectangles, paint } = frameFixture(14);
  for (const rectangle of rectangles) {
    paint(rectangle, [82, 46, 34, 255]);
  }
  assert.deepEqual(detectSlots(image), []);
});
