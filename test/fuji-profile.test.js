import assert from "node:assert/strict";
import { test } from "node:test";
import { isRaw, RAW_ONLY_MESSAGE, PHOTO_FOLDER_EXAMPLE } from "../src/kiosk/folder.js";
import { cameraRank, liveUsable } from "../src/kiosk/camera.js";

test("Fujifilm RAF is diagnosed, and the default folder targets Fujifilm", () => {
  assert.equal(isRaw("IMG_0001.CR3"), false);
  assert.equal(isRaw("IMG_0001.cr2"), false);
  assert.equal(isRaw("IMG_0001.JPG"), false);
  assert.equal(isRaw("DSCF0001.RAF"), true);
  assert.match(PHOTO_FOLDER_EXAMPLE, /Fujifilm/);
  assert.match(RAW_ONLY_MESSAGE, /RAF/);
});
test("USB streaming cameras cannot replace an HDMI capture card", () => {
  assert.equal(liveUsable({ label: "EOS Webcam Utility" }), false);
  assert.equal(liveUsable({ label: "Canon EOS R100" }), false);
  assert.equal(liveUsable({ label: "FUJIFILM X-S10" }), false);
  assert.equal(liveUsable({ label: "FUJIFILM X-S20" }), false);
  assert.equal(liveUsable({ label: "FUJIFILM X-T3" }), false);
  assert.equal(liveUsable({ label: "Integrated Camera" }), false);
  assert.equal(liveUsable({ label: "USB Video" }), true);
  assert.equal(cameraRank({ label: "Elgato Cam Link HDMI" }), 0);
});
