import assert from "node:assert/strict";
import test from "node:test";
import { withAssetUrls } from "../src/api.js";

test("catalog image paths from the API become usable image sources", () => {
  const catalog = {
    rooms: [{ _id: "r" }],
    frames: [
      { _id: "a", image: "/api/frames/a/image?v=1" },
      { _id: "b", image: "data:image/png;base64,AAAA" },
    ],
    settings: { name: "NXC", bankQrImage: "/api/studio/qr?v=2" },
  };
  const before = structuredClone(catalog);
  const out = withAssetUrls(catalog);
  assert.equal(out.frames[0].image, "/api/frames/a/image?v=1");
  assert.equal(out.frames[1].image, "data:image/png;base64,AAAA");
  assert.equal(out.settings.bankQrImage, "/api/studio/qr?v=2");
  assert.deepEqual(out.rooms, catalog.rooms);
  assert.deepEqual(catalog, before, "does not change the response it was given");
});

test("catalogs without frames or a QR code pass through unchanged", () => {
  assert.deepEqual(withAssetUrls({}), {});
  const settings = { name: "NXC", bankQrImage: "https://example.com/qr.png" };
  assert.deepEqual(withAssetUrls({ frames: [], settings }), {
    frames: [],
    settings,
  });
  const none = withAssetUrls({ settings: { name: "NXC" } });
  assert.equal("bankQrImage" in none.settings, false);
});

test("asset paths from the API get the API host, other sources are untouched", async () => {
  const { assetUrl } = await import("../src/api.js");
  assert.equal(assetUrl("/api/frames/a/image?v=1"), "/api/frames/a/image?v=1");
  assert.equal(assetUrl("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");
  assert.equal(assetUrl("https://example.com/qr.png"), "https://example.com/qr.png");
  assert.equal(assetUrl(undefined), undefined);
});
