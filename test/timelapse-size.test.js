import assert from "node:assert/strict";
import { test } from "node:test";
import { timelapseSize } from "../src/kiosk/clip-recorder.js";
import { DEFAULT_CROP, visibleRegion } from "../src/kiosk/live-preview-layout.js";

test("the timelapse keeps the camera's own resolution instead of enlarging the cropped picture", () => {
  // HDMI Full HD cắt mép thông số mặc định: còn 1613 × 864 → video 1536 × 864 (16:9), không kéo lên 1080p.
  assert.deepEqual(timelapseSize(1920, 1080, visibleRegion(DEFAULT_CROP)), [1536, 864]);
  // Nguồn 4K: tối đa Full HD.
  assert.deepEqual(timelapseSize(3840, 2160, visibleRegion(0)), [1920, 1080]);
  // Webcam 720p (chế độ nhẹ, tối đa 720p).
  assert.deepEqual(timelapseSize(1280, 720, visibleRegion(DEFAULT_CROP), 720), [1024, 576]);
  // Chưa đọc được kích thước clip: dùng mức tối đa.
  assert.deepEqual(timelapseSize(0, 0, visibleRegion(0)), [1920, 1080]);
  // Luôn là số chẵn (bộ mã hoá H.264 cần kích thước chẵn).
  const [w, h] = timelapseSize(1366, 768, visibleRegion(0.13));
  assert.equal(w % 2, 0);
  assert.equal(h % 2, 0);
});
