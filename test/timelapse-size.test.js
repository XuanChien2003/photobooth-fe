import assert from "node:assert/strict";
import { test } from "node:test";
import { timelapseBitrate, timelapseSize } from "../src/kiosk/clip-recorder.js";
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

test("the timelapse bitrate follows its resolution, so a smaller video uploads faster", () => {
  const mbps = (...args) => Math.round(timelapseBitrate(...args) / 1e5) / 10;
  // 23% crop on HDMI 1080p (6/11): 1034 × 582 → ~6 Mbps instead of 16 (22 MB → ~9 MB for 12 s).
  assert.equal(mbps(1034, 582, 12), 6.3);
  assert.equal(mbps(1536, 864, 12), 13.9);
  assert.equal(mbps(1920, 1080, 12), 16, "Full HD stays at the 16 Mbps ceiling");
  // A long session still fits the 48 MB upload limit; tiny or webcam videos keep their floor / ceiling.
  assert.ok(timelapseBitrate(1920, 1080, 60) * 60 / 8 <= 48 * 1024 * 1024);
  assert.equal(mbps(320, 180, 12), 4);
  assert.equal(mbps(1280, 720, 12, true), 8);
});
