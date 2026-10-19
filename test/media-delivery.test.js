import assert from "node:assert/strict";
import { after, test } from "node:test";
import * as media from "../src/media-delivery.js";
import { directMediaUrl, proxyMediaUrl, fetchMediaBlob } from "../src/media-delivery.js";

const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });

test("only album images use direct delivery; sheet, thumbnail and download options survive", () => {
  const url = "https://api.example/api/albums/token/prints/job?sheet=2&download=1";
  const direct = directMediaUrl(url);
  assert.equal(new URL(direct).searchParams.get("direct"), "1");
  assert.equal(proxyMediaUrl(direct), url);
  assert.equal(directMediaUrl("blob:local-image"), "blob:local-image");
  assert.equal(directMediaUrl("/api/catalog"), "/api/catalog");
  assert.equal(directMediaUrl("/api/albums/token/photos/id?size=thumbnail"),
    "/api/albums/token/photos/id?size=thumbnail&direct=1");
});

test("direct original bytes are preserved and missing CORS falls back once for later edits", async () => {
  const bytes = new Uint8Array([255, 216, 1, 2, 3, 255, 217]);
  const calls = [];
  globalThis.fetch = async url => { calls.push(url); return new Response(bytes); };
  const url = "https://api.example/api/albums/token/photos/id";
  assert.deepEqual(new Uint8Array(await (await fetchMediaBlob(url)).arrayBuffer()), bytes);
  assert.equal(new URL(calls[0]).searchParams.get("direct"), "link");
  globalThis.fetch = async url => {
    calls.push(url);
    if (url.includes("direct=link")) return Response.json({ url: "https://fixture.r2.cloudflarestorage.com/original" });
    if (url.includes(".r2.cloudflarestorage.com")) throw new TypeError("CORS");
    return new Response(bytes);
  };
  await fetchMediaBlob(url);
  await fetchMediaBlob(url);
  assert.deepEqual(calls.slice(1), [url + "?direct=link", "https://fixture.r2.cloudflarestorage.com/original", url, url]);
});

test("album storage links are used only while they have time left and point at R2", () => {
  const now = Date.parse("2026-10-17T10:00:00Z");
  const photo = { links: { until: "2026-10-17T10:03:00Z",
    thumbnail: "https://bucket.account.r2.cloudflarestorage.com/media/a.thumb.jpg?X-Amz-Signature=1",
    preview: "https://evil.example/media/a.preview.jpg" } };
  const { storageLink } = media;
  assert.equal(storageLink(photo, "thumbnail", now), photo.links.thumbnail);
  assert.equal(storageLink(photo, "preview", now), null, "only R2 hosts");
  assert.equal(storageLink(photo, "original", now), null);
  assert.equal(storageLink(photo, "thumbnail", Date.parse("2026-10-17T10:02:45Z")), null, "about to expire");
  assert.equal(storageLink({}, "thumbnail", now), null);
  assert.equal(storageLink(undefined, "thumbnail", now), null);
});

test("a known storage link skips the API; an expired one is signed again, a broken R2 uses the API", async () => {
  const { fetchMediaBlob: fetchFresh } = await import("../src/media-delivery.js?known-link");
  const bytes = new Uint8Array([255, 216, 9, 255, 217]);
  const url = "https://api.example/api/albums/token/photos/id?size=preview";
  const known = "https://bucket.account.r2.cloudflarestorage.com/media/id.preview.jpg?sig=old";
  const calls = [];
  let r2 = () => new Response(bytes, { headers: { "Content-Type": "image/jpeg" } });
  globalThis.fetch = async (target, options) => {
    calls.push(String(target));
    if (String(target).includes("direct=link"))
      return Response.json({ url: "https://bucket.account.r2.cloudflarestorage.com/media/id.preview.jpg?sig=new" });
    if (String(target).includes(".r2.cloudflarestorage.com")) {
      assert.equal(options.credentials, "omit");
      return r2(String(target));
    }
    return new Response(bytes);
  };
  assert.deepEqual(new Uint8Array(await (await fetchFresh(url, { link: known })).arrayBuffer()), bytes);
  assert.deepEqual(calls, [known], "no server round trip");
  calls.length = 0;
  r2 = (target) => target.includes("sig=old") ? new Response("expired", { status: 403 }) : new Response(bytes);
  await fetchFresh(url, { link: known });
  assert.deepEqual(calls, [known, url + "&direct=link", "https://bucket.account.r2.cloudflarestorage.com/media/id.preview.jpg?sig=new"]);
  calls.length = 0;
  r2 = () => { throw new TypeError("CORS"); };
  await fetchFresh(url, { link: known });
  assert.deepEqual(calls, [known, url], "R2 unreachable: stream through the API");
});
