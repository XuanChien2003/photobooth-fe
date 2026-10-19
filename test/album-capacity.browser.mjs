// Run explicitly: node test/album-capacity.browser.mjs
// Actual React StrictMode album flow and Result, using local synthetic images.
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
import { decodePrintPack } from "./print-pack-fixture.js";

const fixture = `
  import React, { useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { AlbumStudio } from '/src/album/AlbumStudio.jsx';
  import { Result } from '/src/album/Result.jsx';
  import { ToastProvider, StudioContext } from '/src/studio.jsx';
  import '/src/tailwind.css';
  const root = createRoot(document.getElementById('root'));
  let run = 0;
  const photo = document.createElement('canvas');
  photo.width = 80;
  photo.height = 100;
  photo.getContext('2d').fillStyle = '#dfc5ab';
  photo.getContext('2d').fillRect(0, 0, 80, 100);
  const engine = { edited: async () => photo };
  function AlbumFixture({ initial, result = false, frames }) {
    const [booking, setBooking] = useState(initial);
    window.testBooking = booking;
    return React.createElement('section', { className: 'page studio-page' },
      result ? React.createElement('div', { className: 'studio' },
        React.createElement(Result, {
          engine, token: 'capacity-token', booking, setBooking, frames,
          layouts: [{ frameId: frames[0]._id, name: frames[0].name,
            slots: [{ photo: 'photo-1', zoom: 1, x: 0, y: 0, rotate: 0 }] }],
          adjustOf: () => ({}), themeName: 'Aurelia',
          onBack: () => { window.reviewed = true; },
          onGallery: () => { window.galleryOpened = true; },
        })) : React.createElement(AlbumStudio, { booking, setBooking, token: 'capacity-token' }));
  }
  window.mountAlbum = (initial, frames, result = false) => {
    window.reviewed = false;
    window.galleryOpened = false;
    root.render(React.createElement(React.StrictMode, { key: ++run },
      React.createElement(ToastProvider, null,
        React.createElement(StudioContext.Provider, { value: { frames, settings: { name: 'NXC Studio' } } },
          React.createElement(AlbumFixture, { initial, frames, result })))));
  };
`;

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">${body}</svg>`;
const photoSvg = svg(
  '<rect width="600" height="900" fill="#dac8b4"/><circle cx="300" cy="330" r="135" fill="#b9a086"/><path d="M100 850V670a200 200 0 0 1 400 0v180" fill="#8c7764"/>',
);

function frame(name, theme, count, order, color) {
  const slots = Array.from({ length: count }, (_, index) => ({
    x: 0.09 + (index % 2) * 0.43,
    y: 0.06 + Math.floor(index / 2) * 0.19,
    w: 0.38,
    h: 0.16,
  }));
  const shapes = slots
    .map(
      (slot) =>
        `<rect x="${slot.x * 600}" y="${slot.y * 900}" width="${slot.w * 600}" height="${slot.h * 900}" rx="4" fill="#fffaf3"/>`,
    )
    .join("");
  const image = svg(
    `<rect width="600" height="900" fill="${color}"/>${shapes}<text x="300" y="850" text-anchor="middle" font-family="serif" font-size="28" fill="#522e22">${theme}</text>`,
  );
  return {
    _id: name,
    name,
    themeName: theme,
    order,
    active: true,
    printSize: "full",
    slots,
    image: `data:image/svg+xml;base64,${Buffer.from(image).toString("base64")}`,
  };
}

const frames = [
  frame("Aurelia I", "Aurelia", 7, 1, "#e5d5c4"),
  frame("Aurelia II", "Aurelia", 7, 2, "#eadbc8"),
  frame("Vintage I", "Vintage", 6, 1, "#d5c6b5"),
  frame("Vintage II", "Vintage", 6, 2, "#dfcebb"),
  frame("Muse I", "Muse", 6, 1, "#e3d1c9"),
  frame("Muse II", "Muse", 7, 2, "#dccac0"),
];
const resultFrame = frame("Print frame", "Aurelia", 1, 1, "#e5d5c4");

function initialBooking({ count = 20, favorites = [] } = {}) {
  return {
    _id: "capacity-booking",
    code: "123456",
    token: "capacity-token",
    status: "completed",
    prints: 2,
    printSheets: 0,
    photos: Array.from({ length: count }, (_, index) => ({
      id: `photo-${index + 1}`,
      number: index + 1,
      kind: "original",
      favorite: favorites.includes(index + 1),
    })),
  };
}

let server;
let browser;
let page;
let booking;
let requests;
let pageErrors;
let heldFavorite;
let holdFirstFavorite = false;
let activeFavorites = 0;
let maxActiveFavorites = 0;
let printJob = null;
let printFailure = false;
let initialSpoolStatus = "idle";
const screenshots = join(tmpdir(), "nxc-album-capacity-review");

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  return body.length ? decodePrintPack(body, request.headers) : null;
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
        input: "/__capacity_fixture__.jsx",
        output: {
          format: "iife",
          name: "AlbumCapacityReview",
          inlineDynamicImports: true,
        },
      },
    },
    plugins: [
      tailwindcss(),
      {
        name: "album-capacity-browser-fixture",
        enforce: "pre",
        resolveId(id) {
          if (id === "/__capacity_fixture__.jsx")
            return "\0capacity-fixture.jsx";
        },
        load(id) {
          if (id === "\0capacity-fixture.jsx") return fixture;
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
    if (path.match(/^\/api\/albums\/capacity-token\/photos\//)) {
      response.setHeader("Content-Type", "image/svg+xml");
      response.end(photoSvg);
      return;
    }
    if (path.startsWith("/api/")) {
      const entry = {
        method: request.method,
        path,
        body: await readJson(request),
      };
      requests.push(entry);
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      if (
        path === "/api/albums/capacity-token/favorites" &&
        entry.method === "PUT"
      ) {
        activeFavorites++;
        maxActiveFavorites = Math.max(maxActiveFavorites, activeFavorites);
        const answer = () => {
          const selected = new Set(entry.body.ids);
          booking = {
            ...booking,
            photos: booking.photos.map((photo) => ({
              ...photo,
              favorite: selected.has(photo.id),
            })),
          };
          activeFavorites--;
          response.end(JSON.stringify(booking));
        };
        if (holdFirstFavorite) {
          holdFirstFavorite = false;
          heldFavorite = answer;
        } else answer();
        return;
      }
      if (path === "/api/albums/capacity-token" && entry.method === "GET") {
        response.end(JSON.stringify(booking));
        return;
      }
      if (
        path === "/api/albums/capacity-token/print" &&
        entry.method === "GET"
      ) {
        response.end(JSON.stringify(printJob));
        return;
      }
      if (
        path === "/api/albums/capacity-token/print-pack" &&
        entry.method === "POST"
      ) {
        if (printFailure) {
          response.statusCode = 503;
          response.end(
            JSON.stringify({ message: "Fixture printer request failed" }),
          );
        } else {
          printJob = {
            _id: "fixture-job",
            status: "pending",
            spoolStatus: initialSpoolStatus,
            prints: 2,
            printSheets: 1,
            spoolMessage:
              initialSpoolStatus === "failed"
                ? "Fixture printer unavailable"
                : "",
          };
          booking = { ...booking, printSheets: 1 };
          response.end(JSON.stringify(printJob));
        }
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ message: "Unexpected fixture API" }));
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
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
});

after(async () => {
  heldFavorite?.();
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function mount({
  result = false,
  hold = false,
  spoolStatus = "idle",
  failure = false,
  count = 20,
  favorites = [],
  flow = null,
} = {}) {
  heldFavorite?.();
  heldFavorite = null;
  booking = initialBooking({ count, favorites });
  requests = [];
  pageErrors = [];
  activeFavorites = 0;
  maxActiveFavorites = 0;
  holdFirstFavorite = hold;
  printJob = null;
  initialSpoolStatus = spoolStatus;
  printFailure = failure;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:${server.address().port}/capacity`);
  await page.waitForFunction(() => typeof window.mountAlbum === "function");
  await page.evaluate(
    ({ booking, frames, result, flow }) => {
      localStorage.clear();
      if (flow) localStorage.setItem("photo-flow-v5-capacity-token", JSON.stringify(flow));
      window.mountAlbum(booking, frames, result);
    },
    { booking, frames: result ? [resultFrame] : frames, result, flow },
  );
  if (result)
    await page.getByRole("button", { name: "Tờ in 1", exact: true }).waitFor();
  else
    await page
      .getByRole("heading", { name: "Thư viện ảnh", exact: true })
      .waitFor();
}

const favoriteWrites = () =>
  requests.filter((request) => request.path.endsWith("/favorites"));
const themeButton = (name, capacity) =>
  page.getByRole("button", {
    name: `Chọn bộ ${name}, 2 khung, ${capacity} ô ảnh`,
    exact: true,
  });
const nextTheme = () =>
  page
    .locator(".theme-action-bar")
    .getByRole("button", { name: "Ghép ảnh", exact: true });

async function noOverflow() {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Album must fit the viewport",
  );
}

async function brownPrimary(button) {
  assert.equal(
    await button.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
    "rgb(75, 51, 42)",
  );
}

async function goThemes() {
  await page
    .locator(".studio-steps")
    .getByRole("button", { name: "Chủ đề", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Chọn bộ chủ đề", exact: true })
    .waitFor();
}

const shortageDialog = () => page.getByRole("dialog", {
  name: "Chưa đủ ảnh yêu thích", exact: true,
});

const readFlow = () => page.evaluate(() => {
  // State writes are deferred until idle; use the existing lifecycle flush
  // before inspecting the persisted state, without arbitrary timing sleeps.
  window.dispatchEvent(new Event("pagehide"));
  return JSON.parse(localStorage.getItem("photo-flow-v5-capacity-token"));
});

const allocatedPhotos = async () => Object.values((await readFlow()).layouts)
  .flat().map((slot) => slot.photo);

async function waitForComposition() {
  await page.waitForFunction(() =>
    JSON.parse(localStorage.getItem("photo-flow-v5-capacity-token"))?.step === 2,
  );
  await page.locator(".frame-workspace canvas").waitFor();
}

test("frame capacity counts the entire set and zero hearts prompt before any composition", async () => {
  await mount();
  assert.doesNotMatch(await page.locator(".studio-head p").innerText(), /tối đa/);
  await goThemes();
  await themeButton("Aurelia", 14).click();
  assert.equal(await nextTheme().isDisabled(), false);
  assert.equal(await page.locator(".theme-catalog > button").count(), 3);
  const columns = await page
    .locator(".theme-catalog")
    .evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.split(" ").length,
    );
  assert.equal(
    columns,
    2,
    "Theme cards must form two columns on a 390px phone",
  );
  assert.doesNotMatch(
    await page.locator(".studio").innerText(),
    /tối đa \d+ ảnh|Thích\s*[·:]\s*\d+\/\d+/,
  );
  await nextTheme().click();
  await shortageDialog().waitFor();
  assert.match(await shortageDialog().innerText(), /thiếu 14 ảnh/i);
  assert.equal((await readFlow()).step, 1);
  assert.deepEqual((await readFlow()).layouts, {});
  assert.equal(await page.locator(".frame-workspace").count(), 0);
  assert.equal(favoriteWrites().length, 0);
  await noOverflow();
  await shortageDialog().getByRole("button", { name: "Tự động ghép", exact: true }).click();
  await waitForComposition();
  assert.deepEqual(await allocatedPhotos(),
    Array.from({ length: 14 }, (_, index) => `photo-${index + 1}`));
  assert.equal(favoriteWrites().length, 0, "Automatic filling must not heart extra photos");
  assert.equal(booking.photos.filter((photo) => photo.favorite).length, 0);
  await noOverflow();
  assert.deepEqual(pageErrors, []);
});

test("twenty rapid hearts persist beyond frame capacity and every extra remains in the slot picker", async () => {
  await mount({ hold: true });
  for (let number = 1; number <= 20; number++) {
    await page
      .getByRole("button", {
        name: `Thả tim ảnh ${String(number).padStart(2, "0")}`,
        exact: true,
      })
      .click();
  }
  assert.equal(
    favoriteWrites().length,
    1,
    "New heart taps must coalesce while the first write is pending",
  );
  assert.equal(
    await page.locator('.tile-heart[aria-pressed="true"]').count(),
    20,
  );
  assert.match(await page.locator(".fav-count").innerText(), /Thích\s*·\s*20/);
  assert.doesNotMatch(await page.locator(".fav-count").innerText(), /\//);
  assert.equal(
    await page
      .getByRole("button", { name: "Đang lưu…", exact: true })
      .isDisabled(),
    true,
  );
  heldFavorite();
  heldFavorite = null;
  await page
    .getByRole("button", { name: "Chọn chủ đề", exact: true })
    .waitFor();
  await page.waitForFunction(
    () =>
      window.testBooking.photos.filter((photo) => photo.favorite).length === 20,
  );
  assert.equal(favoriteWrites().length, 2);
  assert.equal(maxActiveFavorites, 1);
  assert.deepEqual(
    favoriteWrites()[1].body.ids,
    Array.from({ length: 20 }, (_, index) => `photo-${index + 1}`),
  );
  assert.equal(booking.photos.filter((photo) => photo.favorite).length, 20);
  await goThemes();
  await themeButton("Vintage", 12).click();
  assert.match(
    await page.locator(".theme-selection-status").innerText(),
    /8 ảnh/,
  );
  assert.equal(
    await page.evaluate(
      () => window.testBooking.photos.filter((photo) => photo.favorite).length,
    ),
    20,
  );
  assert.equal(await nextTheme().isDisabled(), false);
  await themeButton("Muse", 13).click();
  assert.match(
    await page.locator(".theme-selection-status").innerText(),
    /7 ảnh/,
  );
  await themeButton("Aurelia", 14).click();
  await brownPrimary(nextTheme());
  await noOverflow();
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({
    path: join(screenshots, "themes-390.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await noOverflow();
  await brownPrimary(nextTheme());
  await page.screenshot({
    path: join(screenshots, "themes-1440.png"),
    fullPage: true,
  });
  await nextTheme().click();
  await waitForComposition();
  assert.equal(await shortageDialog().count(), 0);
  const allocated = await allocatedPhotos();
  assert.equal(allocated.length, 14);
  assert.equal(
    new Set(allocated).size,
    14,
    "A fourteen-slot set uses fourteen distinct favorites",
  );
  assert.deepEqual(allocated, Array.from({ length: 14 }, (_, index) => `photo-${index + 1}`));
  assert.equal(await page.locator(".photo-carousel button").count(), 20);
  await page.getByRole("button", { name: "Đổi ảnh", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Chọn ảnh cho ô 1", exact: true });
  await picker.waitFor();
  assert.equal(await picker.locator(".photo-sheet-grid button").count(), 20);
  await picker.getByRole("button", { name: "Dùng ảnh 20", exact: true }).click();
  await page.waitForFunction(() =>
    JSON.parse(localStorage.getItem("photo-flow-v5-capacity-token"))?.layouts["Aurelia I"][0].photo === "photo-20",
  );
  assert.equal(favoriteWrites().length, 2);
  assert.deepEqual(pageErrors, []);
});

test("choosing more hearts keeps the frame set and favorites without creating a layout", async () => {
  await mount({ favorites: [1, 2, 3, 4, 5, 6] });
  await goThemes();
  await themeButton("Aurelia", 14).click();
  const chosenPack = (await readFlow()).packId;
  await nextTheme().click();
  await shortageDialog().waitFor();
  assert.match(await shortageDialog().innerText(), /thiếu 8 ảnh/i);
  await shortageDialog().getByRole("button", { name: "Chọn thêm", exact: true }).click();
  await page.getByRole("heading", { name: "Thư viện ảnh", exact: true }).waitFor();
  assert.equal((await readFlow()).packId, chosenPack);
  assert.deepEqual((await readFlow()).layouts, {});
  assert.equal(await page.locator('.tile-heart[aria-pressed="true"]').count(), 6);
  assert.equal(favoriteWrites().length, 0);
  for (let number = 7; number <= 14; number++) {
    await page.getByRole("button", {
      name: `Thả tim ảnh ${String(number).padStart(2, "0")}`, exact: true,
    }).click();
  }
  await page.getByRole("button", { name: "Chọn chủ đề", exact: true }).waitFor();
  await goThemes();
  assert.equal(await themeButton("Aurelia", 14).getAttribute("aria-pressed"), "true");
  await nextTheme().click();
  await waitForComposition();
  assert.equal(await shortageDialog().count(), 0);
  assert.equal(new Set(await allocatedPhotos()).size, 14);
  assert.deepEqual(pageErrors, []);
});

test("automatic composition fills favorites first then other album originals without repeats or extra hearts", async () => {
  await mount({ favorites: [3, 7] });
  await goThemes();
  await themeButton("Aurelia", 14).click();
  await nextTheme().click();
  await shortageDialog().waitFor();
  assert.match(await shortageDialog().innerText(), /thiếu 12 ảnh/i);
  assert.deepEqual((await readFlow()).layouts, {});
  assert.equal((await readFlow()).step, 1);
  await shortageDialog().getByRole("button", { name: "Tự động ghép", exact: true }).click();
  await waitForComposition();
  assert.deepEqual(await allocatedPhotos(),
    [3, 7, 1, 2, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14].map((n) => `photo-${n}`));
  assert.equal(new Set(await allocatedPhotos()).size, 14);
  assert.deepEqual(booking.photos.filter((photo) => photo.favorite).map((photo) => photo.number), [3, 7]);
  assert.equal(favoriteWrites().length, 0);
  assert.deepEqual(pageErrors, []);
});

test("an album with fewer originals than slots explicitly warns before reusing photos", async () => {
  await mount({ count: 6, favorites: [2, 5] });
  await goThemes();
  await themeButton("Aurelia", 14).click();
  await nextTheme().click();
  await shortageDialog().waitFor();
  assert.match(await shortageDialog().innerText(), /thiếu 12 ảnh/i);
  assert.match(await shortageDialog().innerText(), /6 ảnh/);
  assert.match(await shortageDialog().innerText(), /dùng lại|lặp/i,
    "Guests must know that automatic composition will reuse photos");
  assert.deepEqual((await readFlow()).layouts, {});
  await shortageDialog().getByRole("button", { name: "Tự động ghép", exact: true }).click();
  await waitForComposition();
  assert.deepEqual(await allocatedPhotos(),
    [2, 5, 1, 3, 4, 6, 2, 5, 1, 3, 4, 6, 2, 5].map((n) => `photo-${n}`));
  assert.equal(favoriteWrites().length, 0);
  assert.equal(booking.photos.filter((photo) => photo.favorite).length, 2);
  await noOverflow();
  assert.deepEqual(pageErrors, []);
});

test("legacy repeated layouts require consent then use remaining originals, while later manual changes survive", async () => {
  let index = 0;
  const legacyLayouts = Object.fromEntries(frames.slice(0, 2).map((frame) => [
    frame._id,
    frame.slots.map(() => ({
      photo: index++ % 2 ? "photo-7" : "photo-3",
      zoom: 1, x: 0, y: 0, rotate: 0,
    })),
  ]));
  await mount({
    favorites: [3, 7],
    flow: { step: 0, packId: "theme:Aurelia", frameIndex: 0, layouts: legacyLayouts },
  });
  await goThemes();
  await nextTheme().click();
  await shortageDialog().waitFor();
  assert.equal((await readFlow()).step, 1);
  assert.deepEqual((await readFlow()).layouts, legacyLayouts,
    "Legacy layouts must remain untouched before automatic-fill consent");
  await noOverflow();
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: join(screenshots, "shortage-modal-390.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await shortageDialog().waitFor({ state: "hidden" });
  assert.deepEqual((await readFlow()).layouts, legacyLayouts);
  assert.equal((await readFlow()).step, 1);
  assert.equal(favoriteWrites().length, 0);

  await nextTheme().click();
  await shortageDialog().getByRole("button", { name: "Tự động ghép", exact: true }).click();
  await waitForComposition();
  const expected = [3, 7, 1, 2, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14].map((n) => `photo-${n}`);
  assert.deepEqual(await allocatedPhotos(), expected,
    "Explicit automatic filling must replace old implicit duplicates with distinct album originals");
  assert.equal((await readFlow()).autoFill, true);

  await page.getByRole("button", { name: "Đổi ảnh", exact: true }).click();
  await page.getByRole("dialog", { name: "Chọn ảnh cho ô 1", exact: true })
    .getByRole("button", { name: "Dùng ảnh 20", exact: true }).click();
  await page.getByRole("dialog", { name: "Chọn ảnh cho ô 1", exact: true }).waitFor({ state: "hidden" });
  assert.deepEqual(pageErrors, []);
  assert.equal(await page.locator(".studio-steps").count(), 1,
    `Album remains mounted after a manual slot change: ${JSON.stringify(pageErrors)}`);
  // The editor intentionally hides the global steps to give the frame room.
  await page.locator(".frame-nav").getByRole("button", { name: "Quay lại", exact: true }).click();
  await page.getByRole("heading", { name: "Chọn bộ chủ đề", exact: true }).waitFor();
  await nextTheme().click();
  await shortageDialog().getByRole("button", { name: "Tự động ghép", exact: true }).click();
  await waitForComposition();
  assert.deepEqual(await allocatedPhotos(), ["photo-20", ...expected.slice(1)],
    "Returning through automatic mode must preserve a guest's later manual slot changes");
  assert.equal(favoriteWrites().length, 0);
  assert.deepEqual(pageErrors, []);
});

test("successful print submission shows accepted state and only a real printed update shows completion", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mount({ result: true });
  const send = page.getByRole("button", { name: /^Gửi in/ });
  await brownPrimary(send);
  await send.click();
  await page
    .getByRole("heading", { name: "Ảnh đã được gửi tới quầy", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("heading", { name: "Ảnh của bạn đã in xong", exact: true })
      .count(),
    0,
  );
  assert.match(
    await page.locator(".print-confirmation-ticket").innerText(),
    /#123456.*1 tờ/,
  );
  const writes = requests.filter((request) =>
    request.path.endsWith("/print-pack"),
  );
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.images.length, 1);
  // Tờ in gửi dạng PNG (không nén mất) để giữ nguyên chất lượng; máy chủ nhận cả PNG lẫn JPEG.
  assert.match(writes[0].body.images[0], /^data:image\/(png|jpeg);base64,/);
  assert.equal(typeof writes[0].body.requestKey, "string");
  await noOverflow();
  printJob = { ...printJob, status: "printed", spoolStatus: "sent" };
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await page
    .getByRole("heading", { name: "Ảnh của bạn đã in xong", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Về thư viện ảnh", exact: true })
    .click();
  assert.equal(await page.evaluate(() => window.galleryOpened), true);
  assert.deepEqual(pageErrors, []);
});

test("a printer failure remains a staff-help state and never claims that printing completed", async () => {
  await mount({ result: true, spoolStatus: "failed" });
  await page.getByRole("button", { name: /^Gửi in/ }).click();
  await page
    .getByRole("heading", { name: "Lễ tân đang hỗ trợ lệnh in", exact: true })
    .waitFor();
  assert.match(
    await page.locator(".print-confirmation-notes").innerText(),
    /Không cần gửi lại/,
  );
  assert.equal(
    await page
      .getByRole("heading", { name: "Ảnh của bạn đã in xong", exact: true })
      .count(),
    0,
  );
  await noOverflow();
  await page
    .getByRole("button", { name: "Xem và tải ảnh", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Tải từng khung nhỏ", exact: true })
    .waitFor();
  assert.deepEqual(pageErrors, []);
});

test("failed submission does not show a success confirmation or consume the local print quota", async () => {
  await mount({ result: true, failure: true });
  await page.getByRole("button", { name: /^Gửi in/ }).click();
  await page
    .getByText("Fixture printer request failed", { exact: true })
    .waitFor();
  assert.equal(await page.locator(".print-confirmation").count(), 0);
  assert.equal(await page.evaluate(() => window.testBooking.printSheets), 0);
  // Sau lỗi, nút đổi thành “Kiểm tra và thử lại” (kiểm tra xem lệnh đã tới máy chủ chưa) và vẫn bấm được.
  assert.equal(
    await page
      .getByRole("button", { name: /^(Gửi in|Kiểm tra và thử lại)/ })
      .isDisabled(),
    false,
  );
  assert.deepEqual(pageErrors, []);
  console.log(`Album capacity screenshots: ${screenshots}`);
});
