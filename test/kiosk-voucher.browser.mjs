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
  const packs = [
    { _id: 'pack-strip', name: 'Khung nhỏ', printSize: 'strip', price: 70000, prints: 1, shots: 4 },
    { _id: 'pack-full', name: 'Khung to', printSize: 'full', price: 100000, prints: 2, shots: 4 },
  ];
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

const booking = { _id: "booking-1", code: "123456", status: "checked_in", packageName: "Khung to", prints: 2,
  shots: 4, captureDuration: 10, photos: [] };

// Máy chụp có thư mục ảnh (OPFS giả lập) và API giả: ping trả phòng, claim / sale mở lượt chụp.
async function openKiosk(room, handlers = {}, { sale = null } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((sale) => {
    window.showDirectoryPicker = async () => navigator.storage.getDirectory();
    // Lượt mua dở còn lưu trên máy (vd. từ lúc phòng còn là phòng đút tiền).
    if (sale && !sessionStorage.getItem("sale-seeded")) {
      localStorage.setItem("kiosk-sale", JSON.stringify(sale));
      sessionStorage.setItem("sale-seeded", "1");
    }
  }, sale);
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const handler = Object.entries(handlers).find(([end]) => path.endsWith(end));
    if (handler) return handler[1](route, JSON.parse(route.request().postData()));
    return route.fulfill({ json: path.endsWith("/kiosk/ping") ? { room }
      : path.endsWith("/health") ? { ok: true } : { booking } });
  });
  // Màn đầu tiên sau “Chạm để bắt đầu” theo loại phòng máy chủ báo về.
  const pinged = page.waitForResponse((r) => r.url().endsWith("/api/kiosk/ping"));
  await page.goto(base);
  await pinged;
  await page.getByText("Cài đặt máy chụp (nhân viên)").click();
  await page.getByRole("button", { name: "Chọn thư mục ảnh" }).click();
  await page.getByRole("button", { name: "Chạm để bắt đầu" }).click();
  return { page, errors };
}

test("code room: touch to start → enter the code from the counter → straight to the shoot screen", async () => {
  const claims = [];
  const { page, errors } = await openKiosk({ _id: "room-1", flip: "device" }, {
    "/kiosk/claim": (route, body) => {
      claims.push(body);
      if (body.code !== "123456") return route.fulfill({ status: 400, json: { message: "Mã chụp không đúng." } });
      return route.fulfill({ json: { booking, captureToken: "fixture-capture", accessToken: "fixture-album" } });
    },
  });
  try {
    await page.getByRole("heading", { name: "Nhập mã chụp" }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Chọn khổ ảnh" }).count(), 0, "a code room sells nothing at the kiosk");
    await page.getByRole("textbox", { name: "Mã chụp" }).fill("000000");
    await page.getByRole("button", { name: "Bắt đầu chụp" }).click();
    await page.getByText("Mã chụp không đúng.").first().waitFor();
    assert.equal(await page.getByRole("textbox", { name: "Mã chụp" }).inputValue(), "");
    await page.getByRole("textbox", { name: "Mã chụp" }).fill("123456");
    await page.getByRole("button", { name: "Bắt đầu chụp" }).click();
    await page.locator(".shoot-screen").waitFor();
    assert.deepEqual(claims.map((c) => c.code), ["000000", "123456"]);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("cash room: touch to start → size → print count → bill reader; enough money opens the session", async () => {
  const sales = [];
  const { page, errors } = await openKiosk(
    { _id: "room-1", flip: "device", payment: "cash", paymentTest: true, cashCheckoutReady: true },
    {
      "/kiosk/sale": (route, body) => {
        sales.push(body);
        return route.fulfill({ status: 201, json: { booking, captureToken: "fixture-capture", accessToken: "fixture-album" } });
      },
    },
  );
  try {
    await page.getByRole("heading", { name: "Chọn khổ ảnh" }).waitFor();
    await page.getByRole("button", { name: /Khung nhỏ/ }).click();
    await page.getByRole("button", { name: /Tiếp tục/ }).click();
    await page.getByRole("heading", { name: "Chọn số bản in" }).waitFor();
    assert.equal(await page.locator(".kiosk-counter output").innerText(), "2");
    await page.getByRole("button", { name: "Tăng số bản in" }).click();
    assert.equal(await page.locator(".kiosk-counter output").innerText(), "4");
    await page.getByRole("button", { name: /Thanh toán tiền mặt/ }).click();
    await page.getByRole("heading", { name: "Đút tiền để bắt đầu chụp" }).waitFor();
    assert.match(await page.locator(".pay-board").innerText(), /90\.000/);
    // Chế độ thử: giả lập đút 2 tờ 50.000 — đủ 90.000 thì tự mở lượt chụp.
    await page.getByRole("button", { name: /50\.000/ }).click();
    assert.equal(sales.length, 0);
    await page.getByRole("button", { name: /50\.000/ }).click();
    await page.locator(".shoot-screen").waitFor();
    assert.equal(sales.length, 1);
    assert.equal(sales[0].package, "pack-strip");
    assert.equal(sales[0].prints, 2, "two 10 × 15 sheets = four small prints");
    assert.equal(sales[0].expectedTotal, 90000);
    assert.equal(sales[0].skip, true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

const staleSale = (bills = []) => ({
  pack: { _id: "pack-full", name: "Khung to", printSize: "full", price: 100000, prints: 2, shots: 4 },
  prints: 4, extraPrintPrice: 20000, stage: "pay", requestKey: "stale-key", bills,
});

test("a code room drops a sale left from when it was a cash room and asks for the code", async () => {
  const { page, errors } = await openKiosk({ _id: "room-1", flip: "device", payment: "counter" }, {}, { sale: staleSale() });
  try {
    await page.getByRole("heading", { name: "Nhập mã chụp" }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Đút tiền để bắt đầu chụp" }).count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem("kiosk-sale")), null, "the stale sale is gone");
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("money already inserted is never dropped: the bill screen comes back even in a code room", async () => {
  const bills = [{ amount: 50000, at: "2026-10-30T13:00:00.000Z" }];
  const { page, errors } = await openKiosk({ _id: "room-1", flip: "device", payment: "counter" }, {}, { sale: staleSale(bills) });
  try {
    await page.getByRole("heading", { name: "Đút tiền để bắt đầu chụp" }).waitFor();
    assert.match(await page.locator(".pay-board").innerText(), /50\.000/);
    assert.notEqual(await page.evaluate(() => localStorage.getItem("kiosk-sale")), null);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
