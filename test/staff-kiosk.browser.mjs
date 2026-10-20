// Run explicitly: node test/staff-kiosk.browser.mjs
// Real Admin and room components; isolated API fixtures, no live accounts or data.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "../../Photo_BE/node_modules/playwright/index.mjs";

const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { MemoryRouter } from 'react-router-dom';
  import { Admin } from '/src/admin.jsx';
  import { StudioContext, ToastProvider } from '/src/studio.jsx';
  import '/src/tailwind.css';
  createRoot(document.getElementById('root')).render(
    React.createElement(MemoryRouter, null,
      React.createElement(StudioContext.Provider, { value: { settings: { name: 'Fixture Studio' }, error: '' } },
        React.createElement(ToastProvider, null, React.createElement(Admin)))));
`;

const roomFixtures = [
  {
    _id: "room-1",
    name: "Phòng 01",
    branch: "Chi nhánh Nguyễn Trãi",
    description: "Tầng 1",
    active: true,
  },
  {
    _id: "room-2",
    name: "Phòng 02",
    branch: "Chi nhánh Nguyễn Trãi",
    description: "Tầng 2",
    active: true,
  },
  {
    _id: "room-off",
    name: "Phòng đã tắt",
    branch: "Chi nhánh cũ",
    description: "",
    active: false,
  },
];
const deviceToken = "fixture-device.token_01-keep";
let server;
let browser;
let page;
let role = "staff";
let rooms;
let devices;
let requests = [];
let pageErrors = [];
const screenshots = join(tmpdir(), "nxc-staff-kiosk-review");

async function readJson(request) {
  let text = "";
  for await (const chunk of request) text += chunk;
  return text ? JSON.parse(text) : undefined;
}

before(async () => {
  const bundle = await build({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    esbuild: { jsx: "automatic" },
    define: { "import.meta.env.VITE_API_URL": '""' },
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        input: "/__staff_kiosk_fixture__.jsx",
        output: {
          format: "iife",
          name: "StaffKioskReview",
          inlineDynamicImports: true,
        },
      },
    },
    plugins: [
      tailwindcss(),
      {
        name: "staff-kiosk-regression-fixture",
        enforce: "pre",
        resolveId(id) {
          if (id === "/__staff_kiosk_fixture__.jsx")
            return "\0staff-kiosk-fixture.jsx";
        },
        load(id) {
          if (id === "\0staff-kiosk-fixture.jsx") return fixture;
        },
      },
    ],
  });
  const assets = new Map(
    bundle.output.map((asset) => [
      `/${asset.fileName}`,
      asset.type === "chunk" ? asset.code : asset.source,
    ]),
  );
  const script = bundle.output.find((asset) => asset.type === "chunk").fileName;
  const styles = bundle.output.filter((asset) =>
    asset.fileName.endsWith(".css"),
  );
  const logo = await readFile(
    new URL("../public/studio-logo.jpg", import.meta.url),
  );
  server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://fixture").pathname;
    if (path === "/studio-logo.jpg") {
      response.setHeader("Content-Type", "image/jpeg");
      response.end(logo);
      return;
    }
    if (path.startsWith("/api/")) {
      const entry = {
        path,
        method: request.method,
        body: await readJson(request),
      };
      requests.push(entry);
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      const send = (value, status = 200) => {
        response.statusCode = status;
        response.end(JSON.stringify(value));
      };
      if (path === "/api/auth/me") {
        send({
          _id: "fixture-user",
          name: role === "staff" ? "Lễ tân thử nghiệm" : "Quản trị thử nghiệm",
          email: "fixture@local.test",
          role,
        });
        return;
      }
      if (path === "/api/admin/storage") {
        send({});
        return;
      }
      if (path === "/api/admin/stats") {
        send({ today: 0, printQueue: 0, todayRevenue: 0 });
        return;
      }
      if (path === "/api/admin/stats/revenue") {
        send({
          month: new URL(request.url, "http://fixture").searchParams.get(
            "month",
          ),
          days: [],
          tickets: 0,
          revenue: 0,
        });
        return;
      }
      if (path === "/api/admin/bookings" || path === "/api/admin/print-jobs") {
        send([]);
        return;
      }
      if (path === "/api/admin/rooms/live") {
        send({ now: Date.now(), rooms: [] });
        return;
      }
      if (path === "/api/admin/print-jobs/stream") {
        response.setHeader("Content-Type", "text/event-stream");
        response.end(": fixture\n\n");
        return;
      }
      if (path === "/api/admin/revenue") {
        send([]);
        return;
      }
      if (path === "/api/admin/rooms" && entry.method === "GET") {
        // Match the permission-scoped API: staff receives active rooms only.
        send(role === "admin" ? rooms : rooms.filter((room) => room.active));
        return;
      }
      const deviceMatch = path.match(/^\/api\/admin\/rooms\/([^/]+)\/device$/);
      if (deviceMatch) {
        const id = deviceMatch[1];
        if (entry.method === "POST" && !devices.has(id)) {
          devices.set(id, {
            token: `${deviceToken}.${id}`,
            name: rooms.find((room) => room._id === id).name,
          });
        }
        send(
          devices.get(id) || { message: "Chưa có liên kết kiosk." },
          devices.has(id) ? 200 : 404,
        );
        return;
      }
      const roomMatch = path.match(/^\/api\/admin\/rooms\/([^/]+)$/);
      if (roomMatch && entry.method === "PUT" && role === "admin") {
        rooms = rooms.map((room) =>
          room._id === roomMatch[1] ? { ...room, ...entry.body } : room,
        );
        send(rooms.find((room) => room._id === roomMatch[1]));
        return;
      }
      send(
        { message: `Unexpected fixture request: ${entry.method} ${path}` },
        404,
      );
      return;
    }
    if (assets.has(path)) {
      response.setHeader(
        "Content-Type",
        path.endsWith(".css") ? "text/css" : "text/javascript",
      );
      response.end(assets.get(path));
      return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(
      `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${styles.map((asset) => `<link rel="stylesheet" href="/${asset.fileName}">`).join("")}</head><body><div id="root"></div><script src="/${script}"></script></body></html>`,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    acceptDownloads: true,
  });
  page.setDefaultTimeout(7000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function mount(nextRole = "staff", width = 1440) {
  role = nextRole;
  rooms = structuredClone(roomFixtures);
  devices = new Map([["room-1", { token: deviceToken, name: "Phòng 01" }]]);
  requests = [];
  pageErrors = [];
  await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
  await page.goto(`http://127.0.0.1:${server.address().port}/admin`);
  await page
    .getByRole("navigation", { name: "Quản lý studio", includeHidden: true })
    .waitFor({ state: "attached" });
  if (width < 600)
    await page
      .getByRole("button", { name: "Menu quản lý", exact: true })
      .click();
}

async function openRooms() {
  await page
    .getByRole("navigation", { name: "Quản lý studio" })
    .getByRole("button", { name: "Phòng & chi nhánh", exact: true })
    .click();
  await page.getByRole("row").filter({ hasText: "Phòng 01" }).waitFor();
}

const roomRow = (name) => page.getByRole("row").filter({ hasText: name });
const kioskDialog = () =>
  page.getByRole("dialog", { name: "Cài máy chụp", exact: true });
const deviceRequests = () =>
  requests.filter((entry) => entry.path.endsWith("/device"));

test("staff can access active rooms and branches without room administration controls", async () => {
  await mount();
  const nav = page.getByRole("navigation", { name: "Quản lý studio" });
  assert.deepEqual(await nav.getByRole("button").allTextContents(), [
    "Tổng quan",
    "Mã chụp & khách tại quầy",
    "Hàng chờ in",
    "Phòng & chi nhánh",
  ]);
  await openRooms();
  assert.equal(await page.getByRole("row").count(), 3);
  assert.equal(
    await page.getByText("Phòng đã tắt", { exact: true }).count(),
    0,
  );
  assert.match(await roomRow("Phòng 01").innerText(), /Chi nhánh Nguyễn Trãi/);
  assert.equal(
    await page.getByRole("button", { name: "Thêm mới", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: /^Chỉnh sửa / }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: /^Ngừng sử dụng / }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: /^Cài máy chụp cho / }).count(),
    2,
  );
  assert.deepEqual(
    requests.filter((entry) => entry.method !== "GET"),
    [],
  );
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({
    path: join(screenshots, "rooms-staff-1440.png"),
    fullPage: true,
  });
  assert.deepEqual(pageErrors, []);
});

test("opening a configured kiosk uses the returned device token and displays QR and installers", async () => {
  await mount();
  await openRooms();
  await roomRow("Phòng 01")
    .getByRole("button", { name: "Cài máy chụp cho Phòng 01", exact: true })
    .click();
  const dialog = kioskDialog();
  await dialog.waitFor();
  const url = `http://127.0.0.1:${server.address().port}/kiosk?device=${encodeURIComponent(deviceToken)}`;
  assert.equal(
    await dialog.getByRole("link", { name: "Mở máy chụp" }).getAttribute("href"),
    url,
  );
  assert.equal(await dialog.locator('svg[width="220"]').count(), 1);
  assert.equal(
    await dialog.getByRole("button", { name: "File cài cho Windows" }).count(),
    1,
  );
  assert.equal(
    await dialog.getByRole("button", { name: "File cài cho Mac" }).count(),
    1,
  );
  await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
  // Issuance can return a fresh JWT; the UI must use the current response.
  const freshToken = `${deviceToken}.fresh`;
  devices.set("room-1", { token: freshToken, name: "Phòng 01" });
  await roomRow("Phòng 01")
    .getByRole("button", { name: "Cài máy chụp cho Phòng 01", exact: true })
    .click();
  await dialog.waitFor();
  assert.equal(
    await dialog.getByRole("link", { name: "Mở máy chụp" }).getAttribute("href"),
    `http://127.0.0.1:${server.address().port}/kiosk?device=${encodeURIComponent(freshToken)}`,
  );
  assert.deepEqual(
    deviceRequests().map((entry) => entry.method),
    ["POST", "POST"],
  );
  assert.deepEqual(pageErrors, []);
});

test("staff can create a kiosk link for a room that has never been configured", async () => {
  await mount();
  await openRooms();
  await roomRow("Phòng 02")
    .getByRole("button", { name: "Cài máy chụp cho Phòng 02", exact: true })
    .click();
  const dialog = kioskDialog();
  await dialog.waitFor();
  assert.match(
    await dialog.getByRole("link", { name: "Mở máy chụp" }).getAttribute("href"),
    /device=fixture-device\.token_01-keep\.room-2$/,
  );
  assert.deepEqual(
    deviceRequests().map((entry) => entry.method),
    ["POST"],
  );
  assert.deepEqual(
    requests
      .filter((entry) => entry.method !== "GET")
      .map((entry) => entry.path),
    ["/api/admin/rooms/room-2/device"],
  );
  assert.deepEqual(pageErrors, []);
});

test("downloaded Windows and Mac installers open the same room kiosk", async () => {
  await mount();
  await openRooms();
  await roomRow("Phòng 01")
    .getByRole("button", { name: "Cài máy chụp cho Phòng 01", exact: true })
    .click();
  const dialog = kioskDialog();
  await dialog.waitFor();
  const url = await dialog
    .getByRole("link", { name: "Mở máy chụp" })
    .getAttribute("href");
  for (const [label, filename] of [
    ["File cài cho Windows", "cai-kiosk-NXC.bat"],
    ["File cài cho Mac", "cai-kiosk-NXC.command"],
  ]) {
    const downloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: label, exact: true }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), filename);
    const chunks = [];
    for await (const chunk of await download.createReadStream())
      chunks.push(chunk);
    const installer = Buffer.concat(chunks).toString("utf8");
    assert.ok(
      installer.includes(url),
      "Installer must use this room's kiosk URL",
    );
    if (filename.endsWith(".bat")) {
      assert.ok(installer.includes("--start-fullscreen --new-window"));
      assert.ok(!installer.includes("--kiosk "));
      assert.ok(installer.includes("-WindowStyle Hidden"));
      assert.ok(
        installer.includes('--user-data-dir="%LOCALAPPDATA%\\NXC-Kiosk"'),
      );
      const payload = installer.match(
        /^rem NXC_WINDOW_CONTROL_BASE64:([A-Za-z0-9+/=]+)$/m,
      );
      assert.ok(
        payload,
        "Windows installer must include its own corner control",
      );
      const helper = Buffer.from(payload[1], "base64").toString("utf8");
      const source = await readFile(
        new URL(
          "../src/admin/installers/kiosk-window-control.ps1",
          import.meta.url,
        ),
        "utf8",
      );
      assert.equal(
        helper,
        `\ufeff${source}`,
        "Helper must survive encoding including Vietnamese text",
      );
      assert.ok(
        installer.indexOf("exit /b") < installer.indexOf(payload[0]),
        "Embedded helper must not execute as batch commands",
      );
      assert.ok(
        installer
          .split(/\r?\n/)
          .filter((line) => !line.startsWith("rem NXC_WINDOW_CONTROL_BASE64:"))
          .every((line) => line.length < 8191),
        "Executable batch lines must fit the Windows command length limit",
      );
    }
  }
  assert.deepEqual(pageErrors, []);
});

test("staff mobile navigation closes after opening rooms and kiosk dialog fits the screen", async () => {
  await mount("staff", 390);
  await openRooms();
  assert.equal(
    await page
      .getByRole("button", { name: "Menu quản lý", exact: true })
      .getAttribute("aria-expanded"),
    "false",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({
    path: join(screenshots, "rooms-staff-390.png"),
    fullPage: true,
  });
  await roomRow("Phòng 01")
    .getByRole("button", { name: "Cài máy chụp cho Phòng 01", exact: true })
    .click();
  const dialog = kioskDialog();
  await dialog.waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  const box = await dialog.boundingBox();
  assert.ok(
    box.x >= 0 && box.x + box.width <= 390,
    "Kiosk dialog must fit mobile width",
  );
  await dialog.getByRole("link", { name: "Mở máy chụp" }).scrollIntoViewIfNeeded();
  assert.equal(
    await dialog.getByRole("link", { name: "Mở máy chụp" }).isVisible(),
    true,
  );
  await page.screenshot({
    path: join(screenshots, "kiosk-staff-390.png"),
    fullPage: true,
  });
  assert.deepEqual(pageErrors, []);
});

test("admin keeps inactive rooms, create/edit/deactivate controls, and room editing", async () => {
  await mount("admin");
  await openRooms();
  assert.equal(await page.getByRole("row").count(), 4);
  assert.equal(
    await page.getByRole("button", { name: "Thêm mới", exact: true }).count(),
    1,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Chỉnh sửa Phòng đã tắt", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Ngừng sử dụng Phòng 01", exact: true })
      .count(),
    1,
  );
  await page
    .getByRole("button", { name: "Chỉnh sửa Phòng 01", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Chỉnh sửa dữ liệu",
    exact: true,
  });
  await dialog
    .getByLabel("Tên phòng", { exact: true })
    .fill("Phòng 01 cập nhật");
  await dialog
    .getByRole("button", { name: "Lưu thay đổi", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await roomRow("Phòng 01 cập nhật").waitFor();
  const mutation = requests.find((entry) => entry.method === "PUT");
  assert.equal(mutation.path, "/api/admin/rooms/room-1");
  assert.equal(mutation.body.branch, "Chi nhánh Nguyễn Trãi");
  assert.equal(mutation.body.name, "Phòng 01 cập nhật");
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({
    path: join(screenshots, "rooms-admin-1440.png"),
    fullPage: true,
  });
  assert.deepEqual(pageErrors, []);
});
