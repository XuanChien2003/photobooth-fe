// Real Kiosk/React flow with a simulated shutter and isolated API; no live camera or customer data.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

let server, browser, base;
const screenshots = join(tmpdir(), "photobooth-timed-capture-review");
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { MemoryRouter } from 'react-router-dom';
  import { StudioContext, ToastProvider } from '/src/studio.jsx';
  import { Kiosk } from '/src/kiosk/Kiosk.jsx';
  import '/src/tailwind.css';
  const root = createRoot(document.getElementById('root'));
  window.unmount = () => root.unmount();
  root.render(React.createElement(React.StrictMode, null,
    React.createElement(MemoryRouter, { initialEntries: ['/kiosk?device=fixture-device'] },
      React.createElement(StudioContext.Provider, { value: { settings: {}, packages: [], frames: [] } },
        React.createElement(ToastProvider, null, React.createElement(Kiosk))))));
`;
const shutterFixture = `
  export async function prepareShutter() {
    window.captureEvents.push({ type: 'connect', at: Date.now() });
    if (window.connectionError) throw new Error('Máy ảnh chưa kết nối');
    if (window.delayConnection) await new Promise(resolve => { window.finishConnection = resolve; });
    return {
      focus: async signal => { signal.throwIfAborted(); window.captureEvents.push({ type: 'focus', at: Date.now() }); },
      press: async signal => { signal.throwIfAborted(); window.captureEvents.push({ type: 'press', at: Date.now() }); },
      release: async () => {},
    };
  }
`;
const canonFixture = `
  export async function connectCanonCamera(signal) {
    signal?.throwIfAborted();
    window.captureConnections = (window.captureConnections || 0) + 1;
    if (window.connectionError) throw new Error('Máy ảnh chưa kết nối');
    return { connected: true, model: 'Canon EOS R100' };
  }
`;
before(async () => {
  const bundle = await build({
    configFile: false, logLevel: "error", esbuild: { jsx: "automatic" },
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env.VITE_API_URL": '""' },
    build: { write: false, minify: false, rollupOptions: { input: "virtual:timed-capture.jsx" } },
    plugins: [tailwindcss(), {
      name: "timed-capture-fixture", enforce: "pre",
      resolveId: (id) => id.startsWith("virtual:") ? "\0" + id : null,
      load: (id) => id === "\0virtual:timed-capture.jsx" ? fixture
        : id === "\0virtual:timer-shutter" ? shutterFixture
        : id === "\0virtual:canon-camera" ? canonFixture : null,
      transform(source, id) {
        if (id.replaceAll("\\", "/").endsWith("/src/kiosk/Kiosk.jsx"))
          return source.replace('from "./shutter.js"', 'from "virtual:timer-shutter"')
            .replace('from "./canon-camera.js"', 'from "virtual:canon-camera"');
      },
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
  browser = await chromium.launch({ headless: true });
  await mkdir(screenshots, { recursive: true });
});
after(async () => { await browser?.close(); await new Promise((resolve) => server?.close(resolve)); });

async function booth(options = {}) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, hasTouch: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let booking = { _id: "fixture-booking", packageName: "Gói thử", shots: 3, photos: [],
    captureDuration: 10, countdownSeconds: 10, status: "checked_in" };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/kiosk/start")) booking = { ...booking,
      captureStartedAt: new Date().toISOString(), captureEndsAt: new Date(Date.now() + 600000).toISOString() };
    await route.fulfill({ json: path.endsWith("/kiosk/ping") ? { room: { _id: "room", flip: "device" } }
      : path.endsWith("/health") ? { ok: true } : { booking } });
  });
  await page.addInitScript(({ booking, options }) => {
    window.captureEvents = [];
    window.delayConnection = !!options.delayConnection;
    window.connectionError = !!options.connectionError;
    sessionStorage.setItem("photo-capture-fixture-device", JSON.stringify({
      captureToken: "fixture-capture", accessToken: "fixture-album", booking,
      phase: "mode", modeEndsAt: Date.now() + 30000,
    }));
  }, { booking, options });
  await page.goto(base);
  await page.getByRole("heading", { name: "Chọn cách chụp" }).waitFor();
  const events = () => page.evaluate(() => window.captureEvents);
  return { page, events, errors, photo: () => { booking = { ...booking, photos: [
    { id: "fixture-photo", clientKey: "fixture-photo", kind: "original" },
  ] }; } };
}

test("timer mode connects first and has one three-second countdown, then advances on a new photo", async () => {
  const b = await booth({ delayConnection: true });
  try {
    await b.page.getByRole("button", { name: /Hẹn giờ/ }).click();
    await b.page.getByText("Đang kết nối máy ảnh…", { exact: true }).waitFor();
    assert.equal(await b.page.locator(".shoot-count").count(), 0);
    assert.equal(await b.page.getByText("Bấm nút trên dây bấm để chụp", { exact: true }).count(), 0);
    await b.page.waitForFunction(() => typeof window.finishConnection === 'function');
    await b.page.evaluate(() => { window.delayConnection = false; window.countStarted = Date.now(); window.finishConnection(); });
    await b.page.waitForFunction(() => window.captureEvents.some(e => e.type === 'press'));
    const first = (await b.events()).find(e => e.type === "press");
    const started = await b.page.evaluate(() => window.countStarted);
    assert.ok(first.at - started >= 3000 && first.at - started < 5000, "one countdown, without extra preparation or package's old 10s delay");
    await b.page.getByText("Đang chờ ảnh từ máy ảnh…", { exact: true }).waitFor();
    await b.page.waitForFunction(() => getComputedStyle(document.querySelector('.camera-flash')).opacity === '0');
    await b.page.screenshot({ path: join(screenshots, "waiting-for-camera.jpg") });
    b.photo();
    await b.page.waitForFunction(() => window.captureEvents.filter(e => e.type === 'press').length === 2, { timeout: 12000 });
    assert.deepEqual(b.errors, []);
  } finally { await b.page.close(); }
});

test("failed timer connection shows retry and never asks the customer to press the cable", async () => {
  const b = await booth({ connectionError: true });
  try {
    await b.page.getByRole("button", { name: /Hẹn giờ/ }).click();
    await b.page.getByText("Đang tạm dừng chụp tự động").waitFor();
    assert.equal(await b.page.locator(".shoot-error").count(), 0, "a second error banner must not cover the retry button");
    assert.equal(await b.page.locator(".shoot-count").count(), 0);
    assert.equal(await b.page.getByText("Bấm nút trên dây bấm để chụp", { exact: true }).count(), 0);
    assert.equal((await b.events()).filter(e => e.type === "press").length, 0);
    await b.page.screenshot({ path: join(screenshots, "camera-disconnected.jpg") });
    await b.page.evaluate(() => { window.connectionError = false; });
    await b.page.getByRole("button", { name: "Kết nối lại và đếm 3 giây" }).click();
    await b.page.waitForFunction(() => window.captureEvents.some(e => e.type === 'press'));
    assert.deepEqual(b.errors, []);
  } finally { await b.page.close(); }
});

test("R100 cable mode receives external photos without issuing software focus or exposure commands", async () => {
  const b = await booth();
  try {
    const initialConnections = await b.page.evaluate(() => window.captureConnections || 0);
    await b.page.getByRole("button", { name: /^Bấm dây/ }).tap();
    await b.page.getByText("Nhấn nút trên dây bấm để chụp", { exact: true }).waitFor();
    assert.ok(await b.page.evaluate(() => window.captureConnections) > initialConnections, "prepare USB reception when entering cable mode");
    assert.equal(await b.page.getByRole("button", { name: "Bấm chụp", exact: true }).count(), 0);
    assert.deepEqual(await b.events(), []);
    await b.page.getByText("Nhấn nút trên dây bấm để chụp", { exact: true }).tap();
    await b.page.locator('body').click({ position: { x: 5, y: 200 } });
    await b.page.keyboard.press('Space');
    await b.page.keyboard.press('Enter');
    b.photo(); // Physical cable exposure arrives through the existing receive/upload flow.
    await b.page.waitForFunction(() => document.querySelector('.shoot-timer small')?.textContent.startsWith('1/3'));
    assert.deepEqual(await b.events(), [], "receiving a cable photo must not start a timer or software exposure");
    await b.page.screenshot({ path: join(screenshots, "r100-cable-mode.jpg") });
    assert.deepEqual(b.errors, []);
  } finally { await b.page.close(); }
});

test("retrying USB reception in cable mode reconnects without firing", async () => {
  const b = await booth({ connectionError: true });
  try {
    await b.page.getByRole("button", { name: /^Bấm dây/ }).tap();
    await b.page.getByText("Chưa kết nối máy ảnh", { exact: true }).waitFor();
    await b.page.evaluate(() => { window.connectionError = false; });
    await b.page.getByRole("button", { name: "Kết nối lại máy ảnh", exact: true }).tap();
    await b.page.getByText("Nhấn nút trên dây bấm để chụp", { exact: true }).waitFor();
    assert.deepEqual(await b.events(), []);
    assert.deepEqual(b.errors, []);
  } finally { await b.page.close(); }
});

test("unmounting while connecting discards the old session's pending exposure", async () => {
  const b = await booth({ delayConnection: true });
  try {
    await b.page.getByRole("button", { name: /Hẹn giờ/ }).click();
    await b.page.waitForFunction(() => typeof window.finishConnection === 'function');
    await b.page.evaluate(() => { window.unmount(); window.finishConnection(); });
    // Give the discarded connection and its queued microtasks time to settle.
    await b.page.waitForTimeout(100);
    assert.equal((await b.events()).filter(e => e.type === "press").length, 0);
    assert.deepEqual(b.errors, []);
  } finally { await b.page.close(); }
});
