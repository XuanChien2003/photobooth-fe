import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { build } from "vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

let server, browser, base, videoBytes;
const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGxoAAAAASUVORK5CYII=", "base64");
const storage = "https://fixture.r2.cloudflarestorage.com/media/";
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { ToastProvider } from '/src/studio.jsx';
  import { AlbumViewer } from '/src/album/AlbumViewer.jsx';
  const root = createRoot(document.getElementById('root'));
  window.showAlbum = booking => root.render(React.createElement(ToastProvider, null,
    React.createElement(AlbumViewer, { token: 'fixture', booking })));
`;

before(async () => {
  const bundle = await build({
    configFile: false, logLevel: "error", esbuild: { jsx: "automatic" },
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env.VITE_API_URL": '""' },
    build: { write: false, minify: false, rollupOptions: { input: "virtual:album-media.jsx" } },
    plugins: [{
      name: "album-media-fixture", enforce: "pre",
      resolveId: id => id.startsWith("virtual:") ? "\0" + id : null,
      load: id => id === "\0virtual:album-media.jsx" ? fixture : null,
    }],
  });
  const assets = new Map(bundle.output.map(asset => ["/" + asset.fileName, asset.code || asset.source]));
  const entry = bundle.output.find(asset => asset.isEntry).fileName;
  server = createServer((req, res) => {
    res.setHeader("Content-Type", assets.has(req.url) ? "application/javascript" : "text/html; charset=utf-8");
    res.end(assets.get(req.url) || `<div id="root"></div><script type="module" src="/${entry}"></script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(base);
  videoBytes = Buffer.from(await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64; canvas.height = 48;
    const ctx = canvas.getContext("2d"), stream = canvas.captureStream(30), chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
    recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.start();
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? "#2288cc" : "#cc8822";
      ctx.fillRect(0, 0, 64, 48);
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    recorder.stop(); await stopped;
    stream.getTracks().forEach(track => track.stop());
    return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
  }));
  await page.close();
});

after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });

function booking(signature = "first") {
  const until = new Date(Date.now() + 300000).toISOString();
  return {
    code: "123456", status: "completed", printSheets: 0,
    video: { size: videoBytes.length, mimeType: "video/webm", links: { until, original: `${storage}video.webm?sig=${signature}` } },
    composite: { links: { until, original: `${storage}composite.jpg?sig=${signature}`, thumbnail: `${storage}thumb.jpg?sig=${signature}` } },
    photos: [{ id: "photo", kind: "original", links: { until, preview: `${storage}preview.jpg?sig=${signature}`, thumbnail: `${storage}photo-thumb.jpg?sig=${signature}` } }],
  };
}

test("album displays R2 media directly and refreshed links do not restart a playing video", async () => {
  const page = await browser.newPage(), errors = [], apiCalls = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => { apiCalls.push(route.request().url()); return route.abort(); });
  await page.route(storage + "**", route => route.fulfill({
    contentType: route.request().url().includes("video.webm") ? "video/webm" : "image/png",
    body: route.request().url().includes("video.webm") ? videoBytes : imageBytes,
  }));
  try {
    await page.goto(base);
    await page.evaluate(value => window.showAlbum(value), booking());
    const composite = page.locator(".album-viewer-stage img");
    await composite.waitFor();
    assert.equal(await composite.getAttribute("src"), storage + "composite.jpg?sig=first");
    await page.getByRole("tab", { name: "Video tua nhanh" }).click();
    await page.waitForFunction(() => document.querySelector("video")?.videoWidth === 64);
    await page.evaluate(() => { window.playingVideo = document.querySelector("video"); window.playingVideo.pause(); });
    await page.evaluate(value => window.showAlbum(value), booking("refreshed"));
    assert.equal(await page.locator("video").getAttribute("src"), storage + "video.webm?sig=first");
    assert.equal(await page.evaluate(() => window.playingVideo === document.querySelector("video")), true);
    await page.getByRole("tab", { name: "Ảnh 1", exact: true }).click();
    assert.equal(await page.locator(".album-viewer-stage img").getAttribute("src"), storage + "preview.jpg?sig=refreshed");
    assert.deepEqual(apiCalls, [], "viewing uses no API byte relay");
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("unavailable or expired R2 media falls back to the authenticated image and video streams", async () => {
  const page = await browser.newPage(), calls = [];
  await page.route(storage + "**", route => route.abort());
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    calls.push(url.pathname + url.search);
    return url.searchParams.has("direct") ? route.fulfill({ status: 503, body: "storage unavailable" })
      : route.fulfill({ contentType: url.pathname.endsWith("video") ? "video/webm" : "image/png",
        body: url.pathname.endsWith("video") ? videoBytes : imageBytes });
  });
  try {
    await page.goto(base);
    await page.evaluate(value => window.showAlbum(value), booking());
    await page.waitForFunction(() => {
      const image = document.querySelector(".album-viewer-stage img");
      return image?.complete && image.naturalWidth > 0 && image.getAttribute("src") === "/api/albums/fixture/composite";
    });
    await page.getByRole("tab", { name: "Video tua nhanh" }).click();
    await page.waitForFunction(() => document.querySelector("video")?.videoWidth === 64);
    assert.equal(await page.locator("video").getAttribute("src"), "/api/albums/fixture/video");
    assert.ok(calls.includes("/api/albums/fixture/video?direct=1"));
    assert.ok(calls.includes("/api/albums/fixture/video"));
  } finally { await page.close(); }
});

test("a newly uploaded composite replaces the legacy print sheet already on screen", async () => {
  const page = await browser.newPage();
  await page.route(storage + "**", route => route.fulfill({ contentType: "image/png", body: imageBytes }));
  await page.route("**/api/**", route => new URL(route.request().url()).pathname.endsWith("/print")
    ? route.fulfill({ json: { _id: "legacy-sheet" } })
    : route.fulfill({ contentType: "image/png", body: imageBytes }));
  try {
    await page.goto(base);
    const old = booking();
    delete old.composite; delete old.video;
    await page.evaluate(value => window.showAlbum(value), old);
    await page.waitForFunction(() => document.querySelector(".album-viewer-stage img")?.getAttribute("src") ===
      "/api/albums/fixture/prints/legacy-sheet?direct=1");
    await page.evaluate(value => window.showAlbum(value), booking());
    await page.waitForFunction(expected => document.querySelector(".album-viewer-stage img")?.getAttribute("src") === expected,
      storage + "composite.jpg?sig=first");
    assert.equal(await page.getByRole("tab", { name: "Ảnh ghép khung" }).locator("img").getAttribute("src"),
      storage + "thumb.jpg?sig=first");
  } finally { await page.close(); }
});
