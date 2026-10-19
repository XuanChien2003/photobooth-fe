import assert from "node:assert/strict";
import { test } from "node:test";
import { livePreviewLayout } from "../src/kiosk/live-preview-layout.js";

const cases = [
  [1920, 1080, 1064, 900],
  [1920, 1080, 1904, 450],
  [1920, 1080, 374, 388],
  [1280, 960, 1064, 900],
  [1280, 960, 1904, 450],
];

for (const [sourceWidth, sourceHeight, width, height] of cases) {
  test(`HDMI bands stay outside ${width}×${height} preview from ${sourceWidth}×${sourceHeight}`, () => {
    const layout = livePreviewLayout(sourceWidth, sourceHeight, width, height);
    const scale = layout.width / sourceWidth;
    const tolerance = 1e-6;

    assert.ok(Math.abs(layout.height / sourceHeight - scale) < tolerance);
    assert.ok(Math.abs(layout.left + layout.width / 2 - width / 2) < tolerance);
    assert.ok(layout.left <= tolerance);
    assert.ok(layout.left + layout.width >= width - tolerance);

    // The visible viewport lies entirely between the two embedded HUD bands.
    const firstVisibleSourceRow = -layout.top / scale;
    const lastVisibleSourceRow = (height - layout.top) / scale;
    assert.ok(firstVisibleSourceRow >= sourceHeight * 0.08 - tolerance);
    assert.ok(lastVisibleSourceRow <= sourceHeight * 0.88 + tolerance);
  });
}

test("unready or invalid camera dimensions do not produce a broken layout", () => {
  for (const dimensions of [
    [0, 1080, 800, 600],
    [1920, 0, 800, 600],
    [1920, 1080, 0, 600],
    [1920, 1080, 800, 0],
    [NaN, 1080, 800, 600],
    [1920, Infinity, 800, 600],
    [1920, 1080, -1, 600],
  ])
    assert.equal(livePreviewLayout(...dimensions), null);
});
