// Webcam test mode of the kiosk (no Fujifilm camera): isolated API, Chromium's fake camera.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

let server, browser, fakeCamera, base;
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { MemoryRouter } from 'react-router-dom';
  import { StudioContext, ToastProvider } from '/src/studio.jsx';
  import { Kiosk } from '/src/kiosk/Kiosk.jsx';
  import '/src/tailwind.css';
  createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode, null,
    React.createElement(MemoryRouter, { initialEntries: ['/kiosk?device=fixture-device'] },
      React.createElement(StudioContext.Provider, { value: { settings: {}, packages: [], frames: [] } },
        React.createElement(ToastProvider, null, React.createElement(Kiosk))))));
`;

before(async () => {
  const bundle = await build({
    configFile: false, logLevel: "error", esbuild: { jsx: "automatic" },
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env.VITE_API_URL": '""' },
    build: { write: false, minify: false, rollupOptions: { input: "virtual:kiosk-webcam.jsx" } },
    plugins: [tailwindcss(), {
      name: "kiosk-webcam-fixture", enforce: "pre",
      resolveId: (id) => id.startsWith("virtual:") ? "\0" + id : null,
      load: (id) => id === "\0virtual:kiosk-webcam.jsx" ? fixture : null,
    }],
  });
  const assets = new Map(bundle.output.map((a) => ["/" + a.fileName, a.code || a.source]));
  const entry = bundle.output.find((a) => a.isEntry).fileName;
  const css = bundle.output.filter((a) => a.fileName.endsWith(".css"));
  server = createServer((req, res) => {
    if (assets.has(req.url)) {
      res.setHeader("Content-Type", req.url.endsWith(".css") ? "text/css" : "application/javascript");
      res.end(assets.get(req.url));
    } else {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<div id="root"></div>${css.map((a) => `<link rel="stylesheet" href="/${a.fileName}">`).join("")}<script type="module" src="/${entry}"></script>`);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  // Không có camera nào (máy tính không có máy ảnh lẫn webcam) và có webcam giả của Chromium.
  browser = await chromium.launch({ headless: true });
  fakeCamera = await chromium.launch({
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
});

after(async () => {
  await browser?.close();
  await fakeCamera?.close();
  await new Promise((resolve) => server?.close(resolve));
});

async function booth(launched, { webcam }) {
  const context = await launched.newContext({ viewport: { width: 1366, height: 768 } });
  if (launched === fakeCamera) await context.grantPermissions(["camera"]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const booking = {
    _id: "fixture-booking", packageName: "Gói thử", shots: 3, selectCount: 1, photos: [],
    captureDuration: 10, status: "checked_in",
    captureStartedAt: new Date().toISOString(),
    captureEndsAt: new Date(Date.now() + 600000).toISOString(),
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    // /kiosk/finish trả về chính lượt chụp (không bọc trong { booking }) như máy chủ thật.
    await route.fulfill({ json: path.endsWith("/kiosk/ping") ? { room: { _id: "room", flip: "device" } }
      : path.endsWith("/health") ? { ok: true }
      : path.endsWith("/kiosk/finish") ? { ...booking, status: "completed" } : { booking } });
  });
  await page.addInitScript(({ booking, webcam }) => {
    // Đếm số bộ ghi video được tạo (thử máy bằng webcam không được quay video tua nhanh).
    window.__recorders = 0;
    if (window.MediaRecorder) {
      const Native = window.MediaRecorder;
      window.MediaRecorder = class extends Native {
        constructor(...args) { super(...args); window.__recorders++; }
      };
    }
    if (sessionStorage.getItem("photo-capture-fixture-device")) return;
    localStorage.setItem("kiosk-webcam-test", webcam ? "1" : "0");
    sessionStorage.setItem("photo-capture-fixture-device", JSON.stringify({
      captureToken: "fixture-capture", accessToken: "fixture-album", booking, phase: "shoot", mode: "remote",
    }));
  }, { booking, webcam });
  await page.goto(base);
  return { page, errors, close: () => context.close() };
}

test("without any camera the shoot screen explains it and offers the computer webcam for a test", async () => {
  const b = await booth(browser, { webcam: false });
  try {
    const card = b.page.getByRole("status").filter({ hasText: "Chưa có hình trực tiếp" });
    await card.waitFor();
    await b.page.getByText("Nhấn nút trên dây bấm để chụp", { exact: true }).waitFor();
    assert.equal(await b.page.getByRole("button", { name: "Chụp xong, chọn ảnh" }).isDisabled(), true);
    await b.page.getByText("Chụp ít nhất 1 tấm").waitFor();
    await b.page.getByText("Ảnh vừa chụp sẽ hiện ở đây").waitFor();
    await card.getByRole("button", { name: /Dùng webcam máy tính/ }).click();
    await b.page.locator(".shoot-webcam-badge", { hasText: "Thử máy bằng webcam" }).waitFor();
    assert.equal(await b.page.evaluate(() => localStorage.getItem("kiosk-webcam-test")), "1");
    // Không có webcam thật: vẫn chưa có hình, chưa có nút chụp trên màn hình.
    assert.equal(await b.page.getByRole("button", { name: "Chạm để chụp" }).count(), 0);
    await b.page.getByRole("button", { name: "Tắt", exact: true }).click();
    assert.equal(await b.page.evaluate(() => localStorage.getItem("kiosk-webcam-test")), "0");
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test("in webcam test mode a tap counts down, takes a photo from the webcam and it can be chosen", async () => {
  const b = await booth(fakeCamera, { webcam: true });
  try {
    const snap = b.page.getByRole("button", { name: "Chạm để chụp" });
    await snap.waitFor({ timeout: 15000 });
    await b.page.locator(".shoot-webcam-badge", { hasText: "Thử máy bằng webcam" }).waitFor();
    await snap.click();
    await b.page.getByRole("timer").filter({ hasText: /^3$/ }).waitFor();
    await b.page.locator(".shoot-thumbs .shoot-thumb-no", { hasText: "1" }).waitFor({ timeout: 15000 });
    const saved = await b.page.evaluate(() => JSON.parse(sessionStorage.getItem("photo-capture-fixture-device")));
    assert.equal(saved.captureOrder.length, 1);
    // Webcam laptop: không mã hóa video liên tục (đã làm sập tab Chrome trên máy thật).
    assert.equal(await b.page.evaluate(() => window.__recorders), 0);
    await b.page.getByRole("button", { name: "Chụp xong, chọn ảnh" }).click();
    await b.page.getByRole("heading", { name: /để chọn ảnh/ }).waitFor({ timeout: 20000 });
    const picks = b.page.getByRole("group", { name: "Ảnh đã chụp" }).getByRole("button");
    await picks.first().waitFor();
    assert.equal(await picks.count(), 1);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});
