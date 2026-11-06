import assert from "node:assert/strict";
import { after, test } from "node:test";
import { downloadEach, fetchFiles } from "../src/album/save-to-phone.js";

const originalFetch = globalThis.fetch, originalDocument = globalThis.document;
after(() => { globalThis.fetch = originalFetch; globalThis.document = originalDocument; });

test("saving album media skips the API with known links and caches unchanged original files", async () => {
  const entries = ["image/jpeg", "video/mp4"].map((type, i) => ({
    url: `/api/albums/token/${i ? "video" : "composite"}?download=1`,
    link: `https://bucket.account.r2.cloudflarestorage.com/media/${i}`,
    name: i ? "video.mp4" : "photo.jpg", type,
  }));
  const bytes = [new Uint8Array([255, 216, 1, 255, 217]), new Uint8Array([0, 0, 1, 2, 3])];
  const calls = [], cache = new Map(), progress = [];
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    assert.equal(options.credentials, "omit");
    return new Response(bytes[entries.findIndex(entry => entry.link === url)]);
  };
  const files = await fetchFiles(entries, cache, done => progress.push(done));
  for (const [i, file] of files.entries()) {
    assert.equal(file.name, entries[i].name);
    assert.equal(file.type, entries[i].type);
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes[i]);
  }
  assert.deepEqual(calls, entries.map(entry => entry.link));
  assert.deepEqual(progress, [1, 2]);
  assert.deepEqual(await fetchFiles(entries, cache), files);
  assert.equal(calls.length, 2, "saved files are reused when sharing again");
});

test("download links request direct delivery while keeping server attachment filenames", async () => {
  let link;
  globalThis.document = {
    createElement: () => (link = { click() {}, remove() {} }),
    body: { append() {} },
  };
  await downloadEach([{ url: "/api/albums/token/video?download=1", name: "NXC-video.mp4" }]);
  assert.equal(link.href, "/api/albums/token/video?download=1&direct=1");
  assert.equal(link.download, "NXC-video.mp4");
});
