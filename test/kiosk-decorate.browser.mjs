// Kiosk photo selection with colour (filter) and stickers, through to the composite and print upload.
// Isolated API fixtures; the photos, frame and sticker are generated solid-colour PNGs.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

// PNG RGBA tối giản: color(x, y) → [r, g, b, a].
function png(width, height, color) {
  const row = width * 4 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) raw.set(color(x, y), y * row + 1 + x * 4);
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 bit
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const dataUrl = (bytes) => `data:image/png;base64,${bytes.toString("base64")}`;

const RED = [220, 30, 30, 255], PINK = [240, 120, 160, 255], BLUE = [30, 60, 220, 255];
const SLOTS = [
  { x: 0.05, y: 0.05, w: 0.9, h: 0.42, kind: "photo", photo: 1 },
  { x: 0.05, y: 0.53, w: 0.9, h: 0.42, kind: "photo", photo: 2 },
];
const inside = (x, y) => SLOTS.some((s) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
// Khung 2 : 3 viền hồng, ô ảnh trắng.
const frameImage = png(200, 300, (x, y) => (inside(x / 200, y / 300) ? [255, 255, 255, 255] : PINK));
const photoImage = png(300, 200, () => RED);
const stickerImage = png(60, 60, () => BLUE);

const FRAME = { _id: "frame-decor", name: "Khung thử", printSize: "full", active: true, image: dataUrl(frameImage), slots: SLOTS };
const STICKER = { _id: "sticker-blue", name: "Tim xanh", image: dataUrl(stickerImage), thumb: dataUrl(stickerImage) };
const SETTINGS = { enabledFilters: ["original", "mono"], customFilters: [] };

let server, browser, base;
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { MemoryRouter } from 'react-router-dom';
  import { StudioContext, ToastProvider } from '/src/studio.jsx';
  import { Kiosk } from '/src/kiosk/Kiosk.jsx';
  import '/src/tailwind.css';
  const studio = ${JSON.stringify({ settings: SETTINGS, packages: [], frames: [FRAME], stickers: [STICKER] })};
  createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode, null,
    React.createElement(MemoryRouter, { initialEntries: ['/kiosk?device=fixture-device'] },
      React.createElement(StudioContext.Provider, { value: studio },
        React.createElement(ToastProvider, null, React.createElement(Kiosk))))));
`;

before(async () => {
  const bundle = await build({
    configFile: false, logLevel: "error", esbuild: { jsx: "automatic" },
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env.VITE_API_URL": '""' },
    build: { write: false, minify: false, rollupOptions: { input: "virtual:kiosk-decorate.jsx" } },
    plugins: [tailwindcss(), {
      name: "kiosk-decorate-fixture", enforce: "pre",
      resolveId: (id) => id.startsWith("virtual:") ? "\0" + id : null,
      load: (id) => id === "\0virtual:kiosk-decorate.jsx" ? fixture : null,
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
});

after(async () => { await browser?.close(); await new Promise((resolve) => server?.close(resolve)); });

async function selectScreen() {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [], uploads = { composite: null, print: null };
  page.on("pageerror", (e) => errors.push(e.message));
  const booking = {
    _id: "fixture-booking", code: "123456", packageName: "Gói thử", shots: 3, selectCount: 2,
    prints: 1, printSize: "full", status: "checked_in", captureDuration: 10,
    captureStartedAt: new Date(Date.now() - 600000).toISOString(),
    captureEndsAt: new Date(Date.now() - 1000).toISOString(),
    photos: ["p1", "p2", "p3"].map((id) => ({ id, kind: "original" })),
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (/\/albums\/fixture-album\/photos\//.test(path))
      return route.fulfill({ body: photoImage, contentType: "image/png" });
    if (path.endsWith("/kiosk/composite")) {
      uploads.composite = route.request().postDataBuffer();
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith("/albums/fixture-album/print-pack")) {
      uploads.print = route.request().headers()["x-print-sheets"];
      return route.fulfill({ json: { _id: "job", code: "123456", spoolStatus: "sent", status: "pending" } });
    }
    if (path.endsWith("/albums/fixture-album/print"))
      return route.fulfill({ json: { _id: "job", code: "123456", spoolStatus: "sent", status: "pending" } });
    await route.fulfill({ json: path.endsWith("/kiosk/ping") ? { room: { _id: "room", flip: "device", payment: "counter" } }
      : path.endsWith("/health") ? { ok: true } : { booking } });
  });
  await page.addInitScript((booking) => {
    if (sessionStorage.getItem("photo-capture-fixture-device")) return;
    sessionStorage.setItem("photo-capture-fixture-device", JSON.stringify({
      captureToken: "fixture-capture", accessToken: "fixture-album", booking,
      phase: "select", selected: [], selectEndsAt: Date.now() + 150000, mode: "remote",
    }));
  }, booking);
  await page.goto(base);
  return { page, errors, uploads };
}
const saved = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("photo-capture-fixture-device")));

// Đọc màu một số điểm (tỉ lệ 0–1) của ảnh JPEG đã gửi lên.
async function samples(page, jpeg, points) {
  return page.evaluate(async ({ b64, points }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    return {
      width: bitmap.width,
      height: bitmap.height,
      colors: points.map(([x, y]) =>
        [...ctx.getImageData(Math.round(x * bitmap.width) - 2, Math.round(y * bitmap.height) - 2, 5, 5).data]
          .reduce((sum, v, i) => (sum[i % 4] += v / 25, sum), [0, 0, 0, 0]).slice(0, 3).map(Math.round)),
    };
  }, { b64: jpeg.toString("base64"), points });
}

test("guests pick photos, a colour and a sticker; the print shows exactly that", async () => {
  const { page, errors, uploads } = await selectScreen();
  try {
    await page.getByRole("heading", { name: /để chọn ảnh & trang trí/ }).waitFor();
    const tab = (name) => page.getByRole("tab", { name: new RegExp(name) });
    assert.equal(await tab("Chọn ảnh").getAttribute("aria-selected"), "true");
    const shots = page.getByRole("group", { name: "Ảnh đã chụp" }).getByRole("button");
    await shots.nth(0).click();
    await shots.nth(1).click();
    // Chọn đủ ảnh: tự mở mục Màu ảnh.
    await page.getByRole("radiogroup", { name: "Màu ảnh" }).waitFor();
    assert.equal(await tab("Màu ảnh").getAttribute("aria-selected"), "true");
    const colors = page.getByRole("radiogroup", { name: "Màu ảnh" }).getByRole("radio");
    assert.deepEqual(await colors.allInnerTexts(), ["Gốc", "Trắng đen"]);
    await page.getByRole("radio", { name: "Trắng đen" }).click();
    assert.equal(await page.getByRole("radio", { name: "Trắng đen" }).getAttribute("aria-checked"), "true");
    assert.equal((await saved(page)).decor.filter, "mono");

    await tab("Nhãn dán").click();
    await page.getByText("Chạm một nhãn dán bên dưới để dán lên khung.").waitFor();
    const palette = page.getByRole("group", { name: "Thêm nhãn dán" });
    // Nhãn dán của tiệm đứng trước bộ biểu tượng có sẵn.
    assert.equal(await palette.getByRole("button").first().getAttribute("aria-label"), "Thêm nhãn dán Tim xanh");
    await palette.getByRole("button", { name: "Thêm nhãn dán Tim xanh" }).click();
    await page.getByRole("button", { name: "To hơn" }).click();
    let sticker = (await saved(page)).decor.stickers[0];
    assert.equal(sticker.src, STICKER.image);
    assert.ok(Math.abs(sticker.scale - 0.24) < 1e-9, `cỡ ${sticker.scale}`);

    // Kéo nhãn dán trên khung xem trước tới giữa ô ảnh thứ nhất.
    const canvas = page.getByRole("img", { name: /Khung ảnh xem trước/ });
    await page.waitForFunction(() => document.querySelector(".decor-canvas:not(.is-loading)"));
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + sticker.u * box.width, box.y + sticker.v * box.height);
    await page.mouse.down();
    await page.mouse.move(box.x + 0.5 * box.width, box.y + 0.26 * box.height, { steps: 8 });
    await page.mouse.up();
    sticker = (await saved(page)).decor.stickers[0];
    assert.ok(Math.abs(sticker.u - 0.5) < 0.02 && Math.abs(sticker.v - 0.26) < 0.02, `vị trí ${sticker.u}, ${sticker.v}`);

    // Thêm rồi xóa một biểu tượng: chỉ còn nhãn dán xanh.
    await palette.getByRole("button", { name: "Thêm nhãn dán ⭐" }).click();
    await page.getByRole("button", { name: "Xóa nhãn dán" }).click();
    assert.equal((await saved(page)).decor.stickers.length, 1);

    await page.getByRole("button", { name: "In ảnh" }).click();
    await page.waitForFunction(() => document.querySelector(".done-title"));
    for (let i = 0; i < 100 && (!uploads.composite || !uploads.print); i++) await page.waitForTimeout(100);
    assert.ok(uploads.composite, "chưa gửi ảnh ghép vào album");
    assert.equal(uploads.print?.split(",").length, 1, "gói 1 tờ in → 1 tờ gửi máy in");
    const { width, height, colors: [onSticker, onPhoto, onFrame] } =
      await samples(page, uploads.composite, [[0.5, 0.26], [0.15, 0.12], [0.02, 0.5]]);
    assert.deepEqual([width, height], [1200, 1800]);
    const close = (actual, expected, tolerance = 24) =>
      actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance);
    // Nhãn dán vẽ sau màu ảnh: vẫn xanh. Ảnh đỏ thành xám (trắng đen). Viền khung giữ màu hồng.
    assert.ok(close(onSticker, BLUE), `nhãn dán: ${onSticker}`);
    assert.ok(close(onPhoto, [70, 70, 70]), `ảnh trắng đen: ${onPhoto}`);
    assert.ok(close(onFrame, PINK), `viền khung: ${onFrame}`);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("two fingers resize a sticker on the touch screen; one finger then keeps dragging it", async () => {
  const { page, errors } = await selectScreen();
  try {
    const shots = page.getByRole("group", { name: "Ảnh đã chụp" }).getByRole("button");
    await shots.nth(0).click();
    await shots.nth(1).click();
    await page.getByRole("tab", { name: /Nhãn dán/ }).click();
    await page.getByRole("button", { name: "Thêm nhãn dán Tim xanh" }).click();
    await page.waitForFunction(() => document.querySelector(".decor-canvas:not(.is-loading)"));
    const before = (await saved(page)).decor.stickers[0];
    const box = await page.getByRole("img", { name: /Khung ảnh xem trước/ }).boundingBox();
    const at = (u, v) => ({ x: box.x + u * box.width, y: box.y + v * box.height });
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", {
      type, touchPoints: points.map(([id, p]) => ({ id, x: p.x, y: p.y, radiusX: 4, radiusY: 4, force: 1 })),
    });
    const center = at(before.u, before.v);
    // Ngón 1 trên nhãn dán, ngón 2 cạnh đó rồi mở rộng gấp đôi khoảng cách.
    await touch("touchStart", [[1, center]]);
    await touch("touchStart", [[1, center], [2, { x: center.x + 30, y: center.y }]]);
    for (const dx of [40, 50, 60]) await touch("touchMove", [[1, center], [2, { x: center.x + dx, y: center.y }]]);
    // touchEnd nhấc các ngón được liệt kê: nhấc ngón 2, ngón 1 kéo tiếp nhãn dán rồi nhấc.
    await touch("touchEnd", [[2, { x: center.x + 60, y: center.y }]]);
    for (const dy of [10, 20, 30]) await touch("touchMove", [[1, { x: center.x, y: center.y + dy }]]);
    await touch("touchEnd", [[1, { x: center.x, y: center.y + 30 }]]);
    const after = (await saved(page)).decor.stickers[0];
    assert.ok(Math.abs(after.scale - 0.4) < 0.01, `cỡ sau khi mở 2 ngón: ${after.scale}`);
    assert.ok(Math.abs((after.v - before.v) * box.height - 30) < 3, `kéo tiếp: ${before.v} → ${after.v}`);
    assert.ok(Math.abs(after.u - before.u) < 0.01);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("colour and stickers survive a reload during selection", async () => {
  const { page, errors } = await selectScreen();
  try {
    const shots = page.getByRole("group", { name: "Ảnh đã chụp" }).getByRole("button");
    await shots.nth(0).click();
    await shots.nth(2).click();
    await page.getByRole("radio", { name: "Trắng đen" }).click();
    await page.getByRole("tab", { name: /Nhãn dán/ }).click();
    await page.getByRole("button", { name: "Thêm nhãn dán 🌸" }).click();
    await page.reload();
    await page.getByRole("heading", { name: /để chọn ảnh & trang trí/ }).waitFor();
    // Đã đủ ảnh từ trước: không tự chuyển mục, khách vẫn thấy ảnh đã chọn.
    assert.equal(await page.getByRole("tab", { name: /Chọn ảnh/ }).getAttribute("aria-selected"), "true");
    assert.equal(await page.getByRole("tab", { name: /Chọn ảnh/ }).innerText().then((t) => t.includes("2/2")), true);
    await page.getByRole("tab", { name: /Màu ảnh/ }).click();
    assert.equal(await page.getByRole("radio", { name: "Trắng đen" }).getAttribute("aria-checked"), "true");
    await page.getByRole("tab", { name: /Nhãn dán/ }).click();
    await page.getByRole("button", { name: "Xóa hết nhãn dán (1)" }).click();
    assert.deepEqual((await saved(page)).decor.stickers, []);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
