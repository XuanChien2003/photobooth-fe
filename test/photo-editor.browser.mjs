// Run explicitly: node test/photo-editor.browser.mjs
// Exercise the real React editor with deterministic detector failures and delays.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium } from "../../Photo_BE/node_modules/playwright/index.mjs";

const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { PhotoEditor } from '/src/album/PhotoEditor.jsx';
  import { FrameEditor } from '/src/album/FrameEditor.jsx';
  import { ToastProvider } from '/src/studio.jsx';
  import { DEFAULT_ADJUST } from '/src/beauty.js';
  import { DEFAULT_TRANSFORM } from '/src/frame-utils.js';
  import { createPhotoEngine } from '/src/album/photo-engine.js';
  const root = createRoot(document.getElementById('root'));
  let run = 0;
  const makeCanvas = (red) => {
    const canvas = document.createElement('canvas');
    canvas.width = 40; canvas.height = 60;
    const context = canvas.getContext('2d');
    context.fillStyle = 'rgb(' + red + ', 100, 100)';
    context.fillRect(0, 0, 40, 60);
    return canvas;
  };
  window.mountEditor = (mode) => {
    const state = window.testState = { detections: 0, loads: 0, warmups: 0, renders: [], saved: [] };
    const engine = createPhotoEngine({
      loadOriginal: () => { state.loads++; return makeCanvas(15); },
      detectFaces: () => {
        state.detections++;
        if (mode === 'transient' && state.detections === 1) throw new Error('offline');
        if (mode === 'noFace' && state.detections === 1) return [];
        return [[]];
      },
      applyBeauty: (source, faces, adjust) => {
        state.renders.push(adjust.slim || 0);
        const output = makeCanvas(adjust.slim || 77);
        if (mode === 'stale' && adjust.slim === 10)
          return new Promise((resolve) => setTimeout(() => resolve(output), 650));
        if (mode === 'held' && adjust.slim === 10)
          return new Promise(resolve => { window.releasePreview = () => resolve(output); });
        return output;
      },
      isNeutral: (adjust) => ['slim', 'smooth', 'whiten', 'blush'].every((key) => !adjust[key])
        && (!adjust.filter || adjust.filter === 'original'),
      beautyKeys: ['slim', 'smooth', 'whiten', 'blush'],
      createThumbnail: (canvas) => canvas.toDataURL(),
    });
    const initial = { ...DEFAULT_ADJUST, slim: ['transient', 'noFace'].includes(mode) ? 50 : 0,
      filter: mode === 'colorOnly' ? 'warm' : 'original' };
    root.render(React.createElement(ToastProvider, { key: ++run },
      React.createElement(PhotoEditor, {
        engine,
        photos: [{ id: 'one', number: 1 }],
        startId: 'one',
        adjustOf: () => initial,
        onFavorite: () => {},
        onDelete: () => false,
        onClose: () => {},
        onSave: (drafts) => state.saved.push(drafts),
        onApplyAll: (adjust) => state.saved.push(adjust),
      })));
  };
  window.mountFrameEditor = (mode) => {
    const state = window.testState = { detections: 0, loads: 0, renders: [], next: 0 };
    const key = ++run;
    const createEngine = (red, old = false) => createPhotoEngine({
      loadOriginal: () => { state.loads++; return makeCanvas(15); },
      detectFaces: async () => {
        state.detections++;
        if (mode === 'frameTransient') {
          await new Promise((resolve) => setTimeout(resolve, 150));
          if (state.detections === 1) throw new Error('offline');
        }
        if (old && mode === 'staleFailure') {
          await new Promise((resolve) => setTimeout(resolve, 650));
          throw new Error('old engine failed');
        }
        return [[]];
      },
      applyBeauty: () => {
        state.renders.push(red);
        if (old && mode === 'staleResult')
          return new Promise((resolve) => setTimeout(() => resolve(makeCanvas(red)), 650));
        return makeCanvas(red);
      },
      isNeutral: () => false,
      beautyKeys: ['slim', 'smooth', 'whiten', 'blush'],
      createThumbnail: (canvas) => canvas.toDataURL(),
    });
    let engine = createEngine(mode === 'frameTransient' ? 50 : 30, true);
    const frame = {
      image: makeCanvas(255).toDataURL(),
      slots: [{ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }],
    };
    const render = () => root.render(React.createElement(ToastProvider, { key },
      React.createElement(FrameEditor, {
        engine, frame, title: 'Khung thử',
        slots: [{ photo: 'one', ...DEFAULT_TRANSFORM }],
        photos: [{ id: 'one', number: 1, favorite: true }],
        adjustOf: () => ({ ...DEFAULT_ADJUST, slim: 50 }),
        onSlots: () => {}, onReshuffle: () => {}, onBack: () => {},
        onNext: () => { state.next++; },
      })));
    window.swapFrameEngine = () => { engine = createEngine(80); render(); };
    render();
  };
`;

let server;
let browser;
let page;

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
        input: "/__editor_fixture__.jsx",
        output: {
          format: "iife",
          name: "EditorRegression",
          inlineDynamicImports: true,
        },
      },
    },
    plugins: [
      {
        name: "photo-editor-regression-fixture",
        enforce: "pre",
        resolveId(id, importer) {
          if (id === "/__editor_fixture__.jsx") return "\0editor-fixture.jsx";
          if (id === "../beauty" && importer?.includes("PhotoEditor.jsx"))
            return "\0editor-beauty.js";
        },
        load(id) {
          if (id === "\0editor-fixture.jsx") return fixture;
          if (id === "\0editor-beauty.js")
            return "export * from '/src/beauty.js'; export const loadFaceLandmarker = async () => { window.testState.warmups = (window.testState.warmups || 0) + 1; return null; }; export const warmFaceModel = () => { window.testState.prefetches = (window.testState.prefetches || 0) + 1; };";
        },
      },
    ],
  });
  const code = bundle.output.find((chunk) => chunk.type === "chunk").code;
  server = createServer((request, response) => {
    if (request.url === "/fixture.js") {
      response.setHeader("Content-Type", "text/javascript; charset=utf-8");
      response.end(code);
      return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(
      '<!doctype html><div id="root"></div><script src="/fixture.js"></script>',
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) =>
    process.stderr.write(`Browser fixture error: ${error.message}\n`),
  );
  await page.goto(`http://127.0.0.1:${server.address().port}/__editor_test__`);
  await page.waitForFunction(() => typeof window.mountEditor === "function");
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function mount(mode) {
  await page.evaluate((value) => window.mountEditor(value), mode);
  await page.getByRole("dialog").waitFor();
}

async function setSlim(amount) {
  await page.getByRole("tab", { name: "Thon mặt (V-Line)" }).click();
  await page
    .getByRole("slider", { name: "Thon mặt (V-Line)" })
    .evaluate((input, value) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, String(amount));
}

for (const mode of ["neutral", "colorOnly"]) {
  test(`${mode} preview skips face-model warmup until a portrait adjustment is used`, async () => {
    await mount(mode);
    await page.waitForFunction(
      () => !document.querySelector(".editor-foot button:last-child").disabled,
    );
    assert.equal(await page.evaluate(() => window.testState.warmups), 0);
    assert.equal(await page.evaluate(() => window.testState.detections), 0);
    // The model files are fetched quietly once the photo is shown, without compiling or running.
    await page.waitForFunction(() => window.testState.prefetches >= 1, null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.testState.warmups), 0);
    await setSlim(40);
    await page.waitForFunction(
      () => window.testState.detections === 1 &&
        !document.querySelector(".editor-foot button:last-child").disabled,
    );
    assert.equal(await page.evaluate(() => window.testState.warmups), 1);
    assert.equal(await page.evaluate(() => window.testState.loads), 1);
  });
}

test("transient inference failure blocks saving and retries the same image and settings", async () => {
  await mount("transient");
  await page.getByRole("button", { name: "Thử nhận diện lại" }).waitFor();
  assert.match(
    await page.locator(".editor-status").innerText(),
    /Chưa tải hoặc chạy/,
  );
  assert.equal(
    await page.getByRole("button", { name: "Xong", exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Tải ảnh về", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Thử nhận diện lại" }).click();
  await page.waitForFunction(
    () => !document.querySelector(".editor-foot button:last-child").disabled,
  );
  const state = await page.evaluate(() => window.testState);
  assert.equal(state.loads, 1);
  assert.equal(state.detections, 2);
  assert.deepEqual(state.renders, [50]);
  assert.equal(
    await page.getByRole("button", { name: "Thử nhận diện lại" }).count(),
    0,
  );
});

test("successful no-face result has a separate message and an explicit new inference retry", async () => {
  await mount("noFace");
  await page.getByRole("button", { name: "Thử nhận diện lại" }).waitFor();
  assert.match(
    await page.locator(".editor-status").innerText(),
    /Không nhận diện được khuôn mặt/,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Áp dụng cho tất cả ảnh" })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Thử nhận diện lại" }).click();
  await page.waitForFunction(
    () => !document.querySelector(".editor-foot button:last-child").disabled,
  );
  assert.equal(await page.evaluate(() => window.testState.detections), 2);
});

test("color-only editing remains usable after a detector failure", async () => {
  await mount("transient");
  await page.getByRole("button", { name: "Thử nhận diện lại" }).waitFor();
  await setSlim(0);
  await page.getByRole("button", { name: "Đen trắng", exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector(".editor-foot button:last-child").disabled,
  );
  assert.equal(await page.evaluate(() => window.testState.detections), 1);
  await page.getByRole("button", { name: "Xong", exact: true }).click();
  await page.waitForFunction(() => window.testState.saved.length === 1);
  const saved = await page.evaluate(() => window.testState.saved[0].one);
  assert.equal(saved.slim, 0);
  assert.equal(saved.filter, "mono");
});

test("an older in-flight edit cannot overwrite newer slider settings", async () => {
  await mount("stale");
  await page.waitForFunction(
    () => !document.querySelector(".editor-foot button:last-child").disabled,
  );
  await setSlim(10);
  await page.waitForFunction(() => window.testState.renders.includes(10));
  await setSlim(80);
  await page.waitForFunction(
    () =>
      window.testState.renders.includes(80) &&
      !document.querySelector(".editor-foot button:last-child").disabled,
  );
  // Wait until the original delayed request has definitely completed.
  await page.waitForTimeout(800);
  const red = await page
    .locator(".editor-stage canvas")
    .evaluate(
      (canvas) => canvas.getContext("2d").getImageData(0, 0, 1, 1).data[0],
    );
  assert.equal(red, 80);
  assert.equal(
    await page.getByRole("slider", { name: "Thon mặt (V-Line)" }).inputValue(),
    "80",
  );
});

test("slider bursts skip superseded jobs while a slow preview is running", async () => {
  await mount("stale");
  await page.waitForFunction(() => !document.querySelector(".editor-foot button:last-child").disabled);
  await setSlim(10);
  await page.waitForFunction(() => window.testState.renders.includes(10));
  await setSlim(20);
  await page.waitForTimeout(120);
  await setSlim(30);
  await page.waitForTimeout(120);
  await setSlim(80);
  await page.waitForFunction(() => !document.querySelector(".editor-foot button:last-child").disabled);
  assert.deepEqual(await page.evaluate(() => window.testState.renders), [10, 80]);
  assert.equal(await page.locator(".editor-stage canvas").evaluate(canvas =>
    canvas.getContext("2d").getImageData(0, 0, 1, 1).data[0]), 80);
});

for (const color of [false, true]) {
  test(`a pending portrait adjustment cannot block switching to ${color ? "a color filter" : "the original"}`, async () => {
    await mount("held");
    try {
      await page.waitForFunction(() => !document.querySelector(".editor-foot button:last-child").disabled);
      await setSlim(10);
      await page.waitForFunction(() => window.testState.renders.includes(10));
      await page.getByRole("button", { name: "Khôi phục ảnh gốc" }).click();
      if (color) await page.getByRole("button", { name: "Ấm", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector(".editor-foot button:last-child").disabled,
        undefined, { timeout: 2000 });
      assert.equal(await page.locator(".editor-stage canvas").evaluate(canvas =>
        canvas.getContext("2d").getImageData(0, 0, 1, 1).data[0]), color ? 77 : 15);
    } finally { await page.evaluate(() => window.releasePreview?.()); }
  });
}

test("frame inference failure clears previews, blocks results, and retries without reloading originals", async () => {
  await page.evaluate(() => window.mountFrameEditor("frameTransient"));
  await page.getByRole("button", { name: "Xem kết quả" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Xem kết quả" }).isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Thử nhận diện lại" }).waitFor();
  assert.match(
    await page.getByRole("status").innerText(),
    /Chưa tải hoặc chạy/,
  );
  const redBefore = await page
    .locator(".frame-canvas canvas")
    .evaluate(
      (canvas) => canvas.getContext("2d").getImageData(20, 30, 1, 1).data[0],
    );
  assert.equal(redBefore, 255);
  await page.getByRole("button", { name: "Thử nhận diện lại" }).click();
  assert.equal(
    await page.getByRole("button", { name: "Xem kết quả" }).isDisabled(),
    true,
  );
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].find((button) =>
        button.textContent.includes("Xem kết quả"),
      ).disabled,
  );
  const result = await page.evaluate(() => ({
    state: window.testState,
    red: document
      .querySelector(".frame-canvas canvas")
      .getContext("2d")
      .getImageData(20, 30, 1, 1).data[0],
  }));
  assert.equal(result.state.loads, 1);
  assert.equal(result.state.detections, 2);
  assert.equal(result.red, 50);
  await page.getByRole("button", { name: "Xem kết quả" }).click();
  assert.equal(await page.evaluate(() => window.testState.next), 1);
});

for (const mode of ["staleResult", "staleFailure"]) {
  test(`replacing the frame engine ignores its older in-flight ${mode === "staleResult" ? "result" : "failure"}`, async () => {
    await page.evaluate((value) => window.mountFrameEditor(value), mode);
    await page.waitForFunction(() => window.testState.detections === 1);
    await page.evaluate(() => window.swapFrameEngine());
    await page.waitForFunction(
      () =>
        window.testState.renders.includes(80) &&
        ![...document.querySelectorAll("button")].find((button) =>
          button.textContent.includes("Xem kết quả"),
        ).disabled,
    );
    await page.waitForTimeout(800);
    const red = await page
      .locator(".frame-canvas canvas")
      .evaluate(
        (canvas) => canvas.getContext("2d").getImageData(20, 30, 1, 1).data[0],
      );
    assert.equal(red, 80);
    assert.equal(
      await page.getByRole("button", { name: "Xem kết quả" }).isDisabled(),
      false,
    );
    assert.equal(
      await page.getByRole("button", { name: "Thử nhận diện lại" }).count(),
      0,
    );
  });
}
