import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { build } from "vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

let server, browser, base;
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { MemoryRouter } from 'react-router-dom';
  import { StudioContext, ToastProvider } from '/src/studio.jsx';
  import { Kiosk } from '/src/kiosk/Kiosk.jsx';
  const packs = [{ _id: 'pack-full', name: 'Khung to', printSize: 'full', price: 80000, prints: 1, shots: 4 }];
  createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,
    { initialEntries: ['/kiosk?device=fixture-device'] },
    React.createElement(StudioContext.Provider,
      { value: { settings: { extraPrintPrice: 20000 }, screens: [], packages: packs, frames: [] } },
      React.createElement(ToastProvider, null, React.createElement(Kiosk)))));
`;

before(async () => {
  const bundle = await build({
    configFile: false, logLevel: "error", esbuild: { jsx: "automatic" },
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env.VITE_API_URL": '""' },
    build: { write: false, minify: false, rollupOptions: { input: "virtual:voucher.jsx" } },
    plugins: [{
      name: "voucher-fixture", enforce: "pre",
      resolveId: (id) => id.startsWith("virtual:") ? "\0" + id : null,
      load: (id) => id === "\0virtual:voucher.jsx" ? fixture : null,
    }],
  });
  const assets = new Map(bundle.output.map((a) => ["/" + a.fileName, a.code || a.source]));
  const entry = bundle.output.find((a) => a.isEntry).fileName;
  server = createServer((req, res) => {
    if (assets.has(req.url)) {
      res.setHeader("Content-Type", "application/javascript");
      res.end(assets.get(req.url));
    } else {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<div id="root"></div><script type="module" src="/${entry}"></script>`);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});

after(async () => { await browser?.close(); await new Promise((resolve) => server?.close(resolve)); });

test("voucher on payment screen rejects wrong code and opens a paid session with valid code", async () => {
  const page = await browser.newPage();
  const errors = [], claims = [];
  const booking = { _id: "booking-1", code: "123456", status: "checked_in", packageName: "Khung to", prints: 1,
    shots: 4, captureDuration: 10, photos: [] };
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => navigator.storage.getDirectory();
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/kiosk/claim")) {
      const body = JSON.parse(route.request().postData());
      claims.push(body);
      if (body.code !== "123456") return route.fulfill({ status: 400, json: { message: "Mã voucher không hợp lệ." } });
      return route.fulfill({ json: { booking, captureToken: "fixture-capture", accessToken: "fixture-album" } });
    }
    return route.fulfill({ json: path.endsWith("/kiosk/ping") ? { room: { _id: "room-1", flip: "device" } }
      : path.endsWith("/health") ? { ok: true } : { booking } });
  });
  try {
    await page.goto(base);
    await page.getByText("Cài đặt máy chụp (nhân viên)").click();
    await page.getByRole("button", { name: "Chọn thư mục ảnh" }).click();
    await page.getByRole("button", { name: "Chạm để bắt đầu" }).click();
    await page.getByRole("heading", { name: "Chọn khổ ảnh" }).waitFor();
    await page.getByRole("button", { name: /Khung to/ }).click();
    await page.getByRole("button", { name: /Tiếp tục/ }).click();
    await page.getByRole("heading", { name: "Chọn số bản in" }).waitFor();
    await page.getByRole("button", { name: /Chọn thanh toán/ }).click();
    await page.getByRole("heading", { name: "Chọn cách thanh toán" }).waitFor();
    assert.equal(await page.getByRole("button", { name: /Chọn tiền mặt/ }).isDisabled(), true);
    await page.getByRole("textbox", { name: "Mã voucher" }).fill("000000");
    await page.getByRole("button", { name: "Dùng mã voucher" }).click();
    await page.getByText("Mã voucher không hợp lệ.").first().waitFor();
    assert.equal(await page.getByRole("textbox", { name: "Mã voucher" }).inputValue(), "");
    await page.getByRole("textbox", { name: "Mã voucher" }).fill("123456");
    await page.getByRole("button", { name: "Dùng mã voucher" }).click();
    await page.locator(".shoot-screen").waitFor();
    assert.deepEqual(claims.map((c) => c.code), ["000000", "123456"]);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
