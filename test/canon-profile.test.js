import assert from "node:assert/strict";
import { test } from "node:test";
import { isRaw, RAW_ONLY_MESSAGE, PHOTO_FOLDER_EXAMPLE } from "../src/kiosk/folder.js";
import { cameraRank, liveUsable } from "../src/kiosk/camera.js";

test("Canon RAW extensions are diagnosed, and the default folder targets R50", () => {
  assert.equal(isRaw("IMG_0001.CR3"), true);
  assert.equal(isRaw("IMG_0001.cr2"), true);
  assert.equal(isRaw("IMG_0001.JPG"), false);
  assert.equal(isRaw("legacy.RAF"), false);
  assert.match(PHOTO_FOLDER_EXAMPLE, /CanonR50/);
  assert.match(RAW_ONLY_MESSAGE, /CR3/);
});
test("USB streaming and EOS Webcam cannot take over the R50 USB capture session", () => {
  assert.equal(liveUsable({ label: "EOS Webcam Utility" }), false);
  assert.equal(liveUsable({ label: "Canon EOS R50" }), false);
  assert.equal(liveUsable({ label: "Integrated Camera" }), false);
  assert.equal(liveUsable({ label: "USB Video" }), true);
  assert.equal(cameraRank({ label: "Elgato Cam Link HDMI" }), 0);
});
