import assert from "node:assert/strict";
import { test } from "node:test";
import { fitGrid } from "../src/kiosk/fit-grid.js";

// Ô cao bao nhiêu với một bề rộng (ảnh 3:2 + viền 4 px mỗi bên).
const cellHeight = (size) => (size - 8) / 1.5 + 8;

test("photos fill the selection panel: the column count that makes every photo largest without scrolling", () => {
  // Màn ngang 1920 × 1080 của tiệm, 12 ảnh: 4 cột × 3 hàng (trước đây 6 cột ảnh rộng ~150 px).
  const twelve = fitGrid(900, 560, 12);
  assert.deepEqual(twelve, { cols: 4, size: 216, scroll: false });
  assert.ok(3 * cellHeight(twelve.size) + 2 * 12 <= 560, "all three rows are visible");
  // Ít ảnh thì to hơn nữa; vẫn vừa cả bề rộng lẫn chiều cao.
  const four = fitGrid(900, 560, 4);
  assert.deepEqual([four.cols, four.scroll], [2, false]);
  assert.ok(four.size > twelve.size);
  assert.ok(2 * four.size + 12 <= 900 && 2 * cellHeight(four.size) + 12 <= 560);
  // Màn đứng (khung cao, hẹp): ít cột hơn.
  assert.equal(fitGrid(520, 1100, 12).cols, 2);
});

test("too many photos for the panel keep a tappable size and scroll; nothing to lay out gives no layout", () => {
  const many = fitGrid(900, 300, 40);
  assert.equal(many.scroll, true);
  assert.ok(many.size >= 120);
  assert.ok(many.cols * many.size + (many.cols - 1) * 12 <= 900);
  assert.equal(fitGrid(0, 500, 12), null);
  assert.equal(fitGrid(900, 500, 0), null);
});
