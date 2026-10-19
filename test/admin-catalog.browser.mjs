// Run explicitly: node test/admin-catalog.browser.mjs
// Real admin components and CSS; local API fixtures, no live database or photos.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
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
  import { ResourceManager } from '/src/admin/resources.jsx';
  import { ToastProvider } from '/src/studio.jsx';
  import '/src/tailwind.css';
  const root = createRoot(document.getElementById('root'));
  let run = 0;
  window.mountCatalog = (resource) => {
    window.notifications = [];
    const title = resource === 'packages' ? 'Gói chụp' : 'Khung ảnh';
    root.render(React.createElement(ToastProvider, { key: ++run },
      React.createElement('div', { className: 'admin-shell' },
        React.createElement('aside', { className: 'admin-sidebar' },
          React.createElement('div', { className: 'sidebar-brand' }, 'NXC / STUDIO'),
          React.createElement('p', { className: 'sidebar-label' }, 'QUẢN LÝ'),
          React.createElement('nav', null,
            React.createElement('button', { className: resource === 'packages' ? 'active' : '' }, 'Gói chụp'),
            React.createElement('button', { className: resource === 'frames' ? 'active' : '' }, 'Khung ảnh'))),
        React.createElement('main', { className: 'admin-main' },
          React.createElement('header', { className: 'admin-header' },
            React.createElement('div', null,
              React.createElement('p', { className: 'eyebrow' }, 'NXC / QUẢN LÝ'),
              React.createElement('h2', null, title))),
          React.createElement('div', { className: 'admin-content' },
            React.createElement(ResourceManager, {
              resource,
              notify: (message) => window.notifications.push(message),
              me: { _id: 'fixture-admin', email: 'admin@fixture.local', role: 'admin' },
            }))))));
  };
`;

function frameImage(color, motif) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900"><rect width="600" height="900" fill="${color}"/><rect x="50" y="60" width="500" height="340" rx="8" fill="#fffdf8"/><rect x="50" y="420" width="500" height="340" rx="8" fill="#fffdf8"/><text x="300" y="825" text-anchor="middle" font-size="34" fill="#423e3a" font-family="serif">${motif}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

const packageFixtures = [
  {
    _id: "package-1",
    name: "Chụp một mình",
    description: "Một chút thời gian dành cho chính bạn.",
    price: 70000,
    duration: 10,
    prints: 1,
    active: true,
  },
  {
    _id: "package-2",
    name: "Cặp đôi",
    description: "Lưu lại khoảnh khắc cùng người thương.",
    price: 120000,
    duration: 20,
    prints: 2,
    active: true,
  },
  {
    _id: "package-3",
    name: "Hội bạn",
    description: "Gói chụp nhóm cho một buổi hẹn vui.",
    price: 180000,
    duration: 30,
    prints: 3,
    active: false,
  },
];
const frameFixtures = [
  {
    _id: "frame-1",
    name: "Đêm hoa",
    themeName: "Hoa",
    order: 1,
    printSize: "full",
    image: frameImage("#e8d2d0", "BLOOM / 01"),
    slots: [
      { x: 0.083, y: 0.067, w: 0.834, h: 0.377 },
      { x: 0.083, y: 0.467, w: 0.834, h: 0.377 },
    ],
    active: true,
  },
  {
    _id: "frame-2",
    name: "Vườn hồng",
    themeName: "Hoa",
    order: 2,
    printSize: "strip",
    image: frameImage("#d5ded1", "BLOOM / 02"),
    slots: [{ x: 0.083, y: 0.067, w: 0.834, h: 0.377 }],
    active: false,
  },
  {
    _id: "frame-3",
    name: "Nắng xanh",
    themeName: "Mùa hè",
    order: 1,
    printSize: "full",
    image: frameImage("#e0dfbd", "SUNNY DAYS"),
    slots: [{ x: 0.083, y: 0.067, w: 0.834, h: 0.377 }],
    active: true,
  },
  {
    _id: "frame-4",
    name: "Kỷ niệm",
    themeName: "",
    order: 0,
    printSize: "full",
    image: frameImage("#dad9e1", "MEMORIES"),
    slots: [{ x: 0.083, y: 0.067, w: 0.834, h: 0.377 }],
    active: true,
  },
];

let server;
let browser;
let page;
let data;
let requests = [];
let pageErrors = [];
const screenshotDirectory = join(tmpdir(), "nxc-admin-catalog-review");

async function readJson(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : null;
}

before(async () => {
  const bundle = await build({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    esbuild: { jsx: "automatic" },
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        input: "/__catalog_fixture__.jsx",
        output: {
          format: "iife",
          name: "CatalogReview",
          inlineDynamicImports: true,
        },
      },
    },
    plugins: [
      tailwindcss(),
      {
        name: "admin-catalog-regression-fixture",
        enforce: "pre",
        resolveId(id) {
          if (id === "/__catalog_fixture__.jsx") return "\0catalog-fixture.jsx";
        },
        load(id) {
          if (id === "\0catalog-fixture.jsx") return fixture;
        },
      },
    ],
  });
  const assets = new Map(
    bundle.output.map((chunk) => [
      `/${chunk.fileName}`,
      chunk.type === "chunk" ? chunk.code : chunk.source,
    ]),
  );
  const script = bundle.output.find((chunk) => chunk.type === "chunk").fileName;
  const styles = bundle.output.filter((chunk) =>
    chunk.fileName.endsWith(".css"),
  );
  server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://fixture").pathname;
    if (path.startsWith("/api/")) {
      const entry = {
        method: request.method,
        path,
        body: await readJson(request),
      };
      requests.push(entry);
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      const move = path.match(/^\/api\/admin\/frames\/([^/]+)\/move$/);
      if (move && entry.method === "POST") {
        const frame = data.frames.find((item) => item._id === move[1]);
        const group = data.frames
          .filter((item) => item.themeName.trim() === frame.themeName.trim())
          .sort((a, b) => a.order - b.order || a._id.localeCompare(b._id));
        const ids = group.map((item) => item._id);
        if (ids.join() !== entry.body.expectedIds.join()) {
          response.statusCode = 409;
          response.end(
            JSON.stringify({ message: "Danh sách khung vừa thay đổi." }),
          );
          return;
        }
        const index = ids.indexOf(frame._id);
        const next = index + (entry.body.direction === "up" ? -1 : 1);
        [group[index], group[next]] = [group[next], group[index]];
        group.forEach((item, i) => {
          item.order = i + 1;
        });
        response.end(JSON.stringify(data.frames));
        return;
      }
      const match = path.match(
        /^\/api\/admin\/(packages|frames)(?:\/([^/]+))?$/,
      );
      if (!match) {
        response.statusCode = 404;
        response.end(JSON.stringify({ message: "Unexpected fixture request" }));
        return;
      }
      const [, resource, id] = match;
      if (entry.method === "GET") response.end(JSON.stringify(data[resource]));
      else if (entry.method === "PUT") {
        data[resource] = data[resource].map((item) =>
          item._id === id ? { ...item, ...entry.body } : item,
        );
        response.end(
          JSON.stringify(data[resource].find((item) => item._id === id)),
        );
      } else if (entry.method === "POST") {
        const item = { ...entry.body, _id: `${resource}-new` };
        data[resource].push(item);
        response.end(JSON.stringify(item));
      } else if (entry.method === "DELETE") {
        if (resource === "frames")
          data.frames = data.frames.filter((item) => item._id !== id);
        else
          data.packages = data.packages.map((item) =>
            item._id === id ? { ...item, active: false } : item,
          );
        response.end(JSON.stringify({ ok: true }));
      } else {
        response.statusCode = 405;
        response.end(JSON.stringify({ message: "Unexpected fixture method" }));
      }
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
    viewport: { width: 1440, height: 1100 },
    reducedMotion: "reduce",
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

async function mount(resource, overrides = {}) {
  data = {
    packages: structuredClone(packageFixtures),
    frames: structuredClone(frameFixtures),
    ...overrides,
  };
  requests = [];
  pageErrors = [];
  await page.goto(`http://127.0.0.1:${server.address().port}/catalog`);
  await page.waitForFunction(() => typeof window.mountCatalog === "function");
  await page.evaluate((resource) => window.mountCatalog(resource), resource);
  await page
    .locator(resource === "packages" ? ".package-card" : ".frame-card")
    .first()
    .waitFor();
}

const mutations = () => requests.filter((request) => request.method !== "GET");
const cards = (resource) =>
  page.locator(resource === "packages" ? ".package-card" : ".frame-card");

async function expectCount(resource, expected) {
  await page.waitForFunction(
    ({ resource, expected }) =>
      document.querySelectorAll(
        resource === "packages" ? ".package-card" : ".frame-card",
      ).length === expected,
    { resource, expected },
  );
  assert.equal(await cards(resource).count(), expected);
}

async function noOverflow() {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Catalog must fit the viewport",
  );
}

test("package search and status filters combine without changing stored data", async () => {
  await mount("packages");
  await expectCount("packages", 3);
  await page.getByLabel("Tìm gói chụp", { exact: true }).fill("CAP DOI");
  await expectCount("packages", 1);
  assert.match(await cards("packages").innerText(), /Cặp đôi/);
  await page
    .getByRole("combobox", { name: "Lọc trạng thái", exact: true })
    .selectOption("inactive");
  await expectCount("packages", 0);
  await page.getByLabel("Tìm gói chụp", { exact: true }).fill("");
  await expectCount("packages", 1);
  assert.match(await cards("packages").innerText(), /Hội bạn/);
  assert.deepEqual(mutations(), []);
  assert.deepEqual(pageErrors, []);
});

test("editing a package preserves included prints and other fields in the API payload", async () => {
  await mount("packages");
  await cards("packages")
    .filter({ hasText: "Cặp đôi" })
    .getByRole("button", { name: /Sửa|Chỉnh sửa/ })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[name="price"]').fill("135000");
  await dialog
    .getByRole("button", { name: "Lưu thay đổi", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(mutations(), [
    {
      method: "PUT",
      path: "/api/admin/packages/package-2",
      body: { ...packageFixtures[1], price: 135000 },
    },
  ]);
  assert.match(
    await cards("packages").filter({ hasText: "Cặp đôi" }).innerText(),
    /135/,
  );
  assert.deepEqual(pageErrors, []);
});

test("adding a package validates required fields and sends numeric values", async () => {
  await mount("packages");
  await page
    .getByRole("button", { name: /Thêm gói chụp|Thêm gói|Thêm mới/ })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Lưu thay đổi", exact: true })
    .click();
  assert.deepEqual(
    mutations(),
    [],
    "Empty package name must not reach the API",
  );
  await dialog.locator('input[name="name"]').fill("Ngày vui");
  await dialog
    .locator('textarea[name="description"]')
    .fill("Gói mới dành cho gia đình.");
  await dialog.locator('input[name="price"]').fill("150000");
  await dialog.locator('input[name="duration"]').fill("25");
  await dialog.locator('input[name="prints"]').fill("3");
  await dialog
    .getByRole("button", { name: "Lưu thay đổi", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(mutations(), [
    {
      method: "POST",
      path: "/api/admin/packages",
      body: {
        name: "Ngày vui",
        description: "Gói mới dành cho gia đình.",
        price: 150000,
        duration: 25,
        prints: 3,
        active: true,
      },
    },
  ]);
  await expectCount("packages", 4);
  assert.deepEqual(pageErrors, []);
});

test("frame search, status, and theme filters combine without dropping the source data", async () => {
  await mount("frames");
  await expectCount("frames", 4);
  await page
    .getByRole("combobox", { name: "Lọc chủ đề", exact: true })
    .selectOption({ label: "Hoa" });
  await expectCount("frames", 2);
  await page
    .getByRole("combobox", { name: "Lọc trạng thái", exact: true })
    .selectOption("active");
  await expectCount("frames", 1);
  await page.getByLabel("Tìm khung ảnh", { exact: true }).fill("dem hoa");
  await expectCount("frames", 1);
  await page.getByLabel("Tìm khung ảnh", { exact: true }).fill("Nắng xanh");
  await expectCount("frames", 0);
  assert.deepEqual(mutations(), []);
  assert.deepEqual(pageErrors, []);
});

test("editing a frame preserves its image and detected photo slots", async () => {
  await mount("frames");
  await page.getByRole("button", { name: "Sửa Đêm hoa", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[name="name"]').fill("Đêm hoa mới");
  await dialog
    .getByRole("button", { name: "Lưu thay đổi", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(mutations(), [
    {
      method: "PUT",
      path: "/api/admin/frames/frame-1",
      body: { ...frameFixtures[0], name: "Đêm hoa mới" },
    },
  ]);
  await page
    .getByRole("button", { name: "Sửa Đêm hoa mới", exact: true })
    .waitFor();
  assert.deepEqual(pageErrors, []);
});

test("frame deletion honors cancellation and deletes only the confirmed frame", async () => {
  await mount("frames");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Xóa Đêm hoa", exact: true }).click();
  assert.deepEqual(mutations(), []);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Xóa Đêm hoa", exact: true }).click();
  await expectCount("frames", 3);
  assert.deepEqual(mutations(), [
    { method: "DELETE", path: "/api/admin/frames/frame-1", body: null },
  ]);
  assert.deepEqual(data.frames.map((frame) => frame._id).sort(), [
    "frame-2",
    "frame-3",
    "frame-4",
  ]);
  assert.deepEqual(pageErrors, []);
});

test("deleting the last frame in the selected theme resets the stale theme filter", async () => {
  await mount("frames");
  const theme = page.getByRole("combobox", {
    name: "Lọc chủ đề",
    exact: true,
  });
  await theme.selectOption({ label: "Mùa hè" });
  await expectCount("frames", 1);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Xóa Nắng xanh", exact: true })
    .click();
  await expectCount("frames", 3);
  assert.equal(await theme.inputValue(), "all");
  assert.equal(await theme.locator('option[value="theme:Mùa hè"]').count(), 0);
  assert.deepEqual(mutations(), [
    { method: "DELETE", path: "/api/admin/frames/frame-3", body: null },
  ]);
  assert.deepEqual(pageErrors, []);
});

test("frames can move without opening the editor and search keeps complete-group ordering safe", async () => {
  await mount("frames");
  const up = page.getByRole("button", {
    name: "Đưa Vườn hồng lên trước",
    exact: true,
  });
  await up.click();
  await page.waitForFunction(
    () =>
      document.querySelector(".frame-catalog-card h4")?.textContent ===
      "Vườn hồng",
  );
  assert.deepEqual(
    data.frames
      .filter((frame) => frame.themeName === "Hoa")
      .sort((a, b) => a.order - b.order)
      .map((frame) => frame._id),
    ["frame-2", "frame-1"],
  );
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.deepEqual(mutations(), [
    {
      method: "POST",
      path: "/api/admin/frames/frame-2/move",
      body: { direction: "up", expectedIds: ["frame-1", "frame-2"] },
    },
  ]);
  assert.equal(
    await page
      .getByRole("button", { name: "Đưa Vườn hồng lên trước", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByLabel("Tìm khung ảnh", { exact: true }).fill("Đêm");
  await expectCount("frames", 1);
  assert.equal(
    await page
      .getByRole("button", { name: "Đưa Đêm hoa lên trước", exact: true })
      .isDisabled(),
    true,
  );
  assert.match(
    await page.locator(".frame-catalog-sort-hint").innerText(),
    /xóa từ khóa/,
  );
  await page.getByLabel("Tìm khung ảnh", { exact: true }).fill("");
  await page
    .getByRole("combobox", { name: "Lọc chủ đề", exact: true })
    .selectOption({ label: "Hoa" });
  await expectCount("frames", 2);
  assert.equal(
    await page
      .getByRole("button", { name: "Đưa Đêm hoa lên trước", exact: true })
      .isDisabled(),
    false,
  );
  assert.deepEqual(pageErrors, []);
});

test("duplicate names have distinct accessible labels that survive filtering", async () => {
  const frames = structuredClone(frameFixtures);
  frames[0].name = "pink";
  frames[1].name = "pink";
  await mount("frames", { frames });
  await page
    .getByRole("button", { name: "Sửa pink · 01", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Sửa pink · 02", exact: true })
    .waitFor();
  await page
    .getByRole("combobox", { name: "Lọc trạng thái", exact: true })
    .selectOption("inactive");
  await expectCount("frames", 1);
  await page
    .getByRole("button", { name: "Sửa pink · 02", exact: true })
    .click();
  assert.equal(
    await page.getByRole("dialog").locator('input[name="name"]').inputValue(),
    "pink",
  );
  assert.deepEqual(pageErrors, []);
});

test("catalogs and editors fit desktop and mobile widths with review screenshots", async () => {
  await mkdir(screenshotDirectory, { recursive: true });
  for (const width of [1440, 390, 320]) {
    const height = width === 390 ? 844 : 1000;
    await page.setViewportSize({ width, height });
    for (const resource of ["packages", "frames"]) {
      await mount(resource);
      await noOverflow();
      if (resource === "frames") {
        const geometry = await page
          .locator(".frame-catalog-card")
          .evaluateAll((cards) =>
            cards.map((card) => {
              const preview = card
                .querySelector(".frame-catalog-preview")
                .getBoundingClientRect();
              const image = card
                .querySelector(".frame-catalog-preview img")
                .getBoundingClientRect();
              return {
                ratio: preview.width / preview.height,
                contained:
                  image.y >= preview.y && image.bottom <= preview.bottom + 1,
                footer: getComputedStyle(
                  card.querySelector(".frame-catalog-actions"),
                ).backgroundColor,
                buttons: [
                  ...card.querySelectorAll(".frame-catalog-actions button"),
                ].map((button) => {
                  const r = button.getBoundingClientRect();
                  return [r.width, r.height];
                }),
              };
            }),
          );
        assert.ok(
          geometry.every(
            (g) => g.contained && g.ratio >= 1.49 && g.ratio <= 1.51,
          ),
          JSON.stringify({ width, geometry }),
        );
        assert.ok(
          geometry.every(
            (g) =>
              g.footer === "rgba(0, 0, 0, 0)" &&
              g.buttons.every(([w, h]) => w >= 44 && h >= 44),
          ),
        );
      }
      await page.screenshot({
        path: join(screenshotDirectory, `${resource}-${width}.png`),
        fullPage: true,
      });
      if (resource === "packages")
        await cards(resource)
          .first()
          .getByRole("button", { name: /Sửa|Chỉnh sửa/ })
          .click();
      else
        await page
          .getByRole("button", { name: "Sửa Đêm hoa", exact: true })
          .click();
      await page.getByRole("dialog").waitFor();
      await noOverflow();
      const bounds = await page.getByRole("dialog").boundingBox();
      assert.ok(
        bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
        "Editor must fit the viewport",
      );
      // Header and Save stay visible while only the fields scroll on mobile.
      const save = page.getByRole("dialog").getByRole("button", {
        name: "Lưu thay đổi",
        exact: true,
      });
      const saveBounds = await save.boundingBox();
      assert.ok(
        saveBounds.y >= bounds.y &&
          saveBounds.y + saveBounds.height <= bounds.y + bounds.height + 1 &&
          saveBounds.y + saveBounds.height <= height + 1,
        "The editor Save button must be visible before any scrolling",
      );
      await save.click({ trial: true });
      await page.screenshot({
        path: join(screenshotDirectory, `${resource}-editor-${width}.png`),
        fullPage: false,
      });
      assert.deepEqual(pageErrors, []);
    }
  }
  console.log(`Catalog review screenshots: ${screenshotDirectory}`);
});
