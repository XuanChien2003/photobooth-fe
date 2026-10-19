// Run explicitly: node test/image-export.browser.mjs
// Exercise JPEG bytes and the real editor's prepared-download lifecycle.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium } from "../../Photo_BE/node_modules/playwright/index.mjs";

const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { PhotoEditor } from '/src/album/PhotoEditor.jsx';
  import { ToastProvider } from '/src/studio.jsx';
  import { prepareImage, saveImage } from '/src/album/utils.js';
  import { createPhotoEngine } from '/src/album/photo-engine.js';
  const root = createRoot(document.getElementById('root'));
  window.exportApi = { prepareImage, saveImage };
  window.downloads = [];
  HTMLAnchorElement.prototype.click = function () {
    window.downloads.push({ name: this.download, href: this.href });
  };
  window.mockSharing = (kind = 'ready') => {
    window.shares = [];
    Object.defineProperty(navigator, 'canShare', {
      configurable: true, value: () => kind !== 'unsupported',
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async ({ files }) => {
        window.shares.push(files[0]);
        if (kind === 'cancel') throw new DOMException('User cancelled', 'AbortError');
        if (kind === 'failure') throw new DOMException('Share unavailable', 'NotAllowedError');
        if (kind === 'held') await new Promise((resolve) => { window.releaseShare = resolve; });
      },
    });
  };
  window.makeCanvas = (red = 90, width = 512, height = 768) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = 'rgb(' + red + ', 120, 155)';
    context.fillRect(0, 0, width, height);
    context.fillStyle = 'rgb(225, 80, 50)';
    context.fillRect(width / 2, 0, width / 2, height);
    canvas.encodes = [];
    canvas.nativeToBlob = canvas.toBlob.bind(canvas);
    canvas.toBlob = (callback, type, quality) => {
      canvas.encodes.push({ type, quality });
      canvas.nativeToBlob(callback, type, quality);
    };
    return canvas;
  };
  window.mountEditor = (mode = 'ready') => {
    window.mockSharing(mode === 'heldShare' ? 'held' : 'ready');
    const state = window.editorState = { canvases: [], renders: [], loads: 0 };
    const engine = createPhotoEngine({
      loadOriginal: (id) => {
        state.loads++;
        const canvas = window.makeCanvas(id === 'one' ? 40 : 170, 320, 480);
        state.canvases.push(canvas);
        return canvas;
      },
      detectFaces: () => [[]],
      applyBeauty: (source, faces, adjust) => {
        state.renders.push(adjust.slim || 0);
        const canvas = window.makeCanvas(adjust.slim || 77, 320, 480);
        state.canvases.push(canvas);
        if (mode === 'heldEncoding') {
          const original = canvas.toBlob;
          canvas.toBlob = (callback, type, quality) => {
            state.releaseEncoding = () => original(callback, type, quality);
            state.encodingStarted = true;
          };
        }
        return canvas;
      },
      isNeutral: (adjust) => !adjust.slim,
      beautyKeys: ['slim'],
      createThumbnail: (canvas) => canvas.toDataURL(),
    });
    root.render(React.createElement(ToastProvider, null,
      React.createElement(PhotoEditor, {
        engine, photos: [{ id: 'one', number: 1 }, { id: 'two', number: 2 }],
        startId: 'one', adjustOf: () => ({ slim: mode === 'heldEncoding' ? 20 : 0 }),
        onFavorite: () => {}, onDelete: () => false, onClose: () => {},
        onSave: () => {}, onApplyAll: () => {},
      })));
  };
`;

let server;
let browser;
let page;
let fixtureUrl;

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
        input: "/__export_fixture__.jsx",
        output: {
          format: "iife",
          name: "ImageExportRegression",
          inlineDynamicImports: true,
        },
      },
    },
    plugins: [
      {
        name: "image-export-regression-fixture",
        enforce: "pre",
        resolveId(id, importer) {
          if (id === "/__export_fixture__.jsx") return "\0export-fixture.jsx";
          if (id === "../beauty" && importer?.includes("PhotoEditor.jsx"))
            return "\0export-beauty.js";
        },
        load(id) {
          if (id === "\0export-fixture.jsx") return fixture;
          if (id === "\0export-beauty.js")
            return "export * from '/src/beauty.js'; export const loadFaceLandmarker = async () => null;";
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
  fixtureUrl = `http://127.0.0.1:${server.address().port}/__image_export_test__`;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  page.setDefaultTimeout(7000);
});

beforeEach(async () => {
  await page.goto(fixtureUrl);
  await page.waitForFunction(() => !!window.exportApi);
});

after(async () => {
  await browser?.close();
  await server?.close();
});

test("prepared downloads preserve full-resolution JPEG 0.95 bytes and share the same encoding", async () => {
  const result = await page.evaluate(async () => {
    const canvas = window.makeCanvas();
    const first = window.exportApi.prepareImage(canvas);
    const second = window.exportApi.prepareImage(canvas);
    const blob = await first;
    const reference = await new Promise((resolve) =>
      canvas.nativeToBlob(resolve, "image/jpeg", 0.95),
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const expected = new Uint8Array(await reference.arrayBuffer());
    const decoded = await createImageBitmap(blob);
    const size = [decoded.width, decoded.height];
    decoded.close();
    window.mockSharing();
    const saved = await window.exportApi.saveImage(
      canvas,
      "full-resolution.jpg",
    );
    return {
      samePromise: first === second,
      identicalBytes:
        bytes.length === expected.length &&
        bytes.every((value, i) => value === expected[i]),
      size,
      type: blob.type,
      encodes: canvas.encodes,
      saved,
      file: {
        name: window.shares[0].name,
        size: window.shares[0].size,
        type: window.shares[0].type,
      },
    };
  });
  assert.equal(result.samePromise, true);
  assert.equal(result.identicalBytes, true);
  assert.deepEqual(result.size, [512, 768]);
  assert.equal(result.type, "image/jpeg");
  assert.deepEqual(result.encodes, [{ type: "image/jpeg", quality: 0.95 }]);
  assert.equal(result.saved, "shared");
  assert.equal(result.file.name, "full-resolution.jpg");
  assert.equal(result.file.type, "image/jpeg");
  assert.ok(result.file.size > 0);
});

test("failed encoding is evicted so a later preparation can succeed", async () => {
  const result = await page.evaluate(async () => {
    const canvas = window.makeCanvas();
    const original = canvas.toBlob;
    let failed = false;
    canvas.toBlob = (callback) => callback(null);
    try {
      await window.exportApi.prepareImage(canvas);
    } catch {
      failed = true;
    }
    canvas.toBlob = original;
    const blob = await window.exportApi.prepareImage(canvas);
    return { failed, type: blob.type, encodes: canvas.encodes.length };
  });
  assert.deepEqual(result, { failed: true, type: "image/jpeg", encodes: 1 });
});

test("cancelled sharing does not trigger an unintended fallback download", async () => {
  const result = await page.evaluate(async () => {
    window.mockSharing("cancel");
    const saved = await window.exportApi.saveImage(
      window.makeCanvas(),
      "cancelled.jpg",
    );
    return {
      saved,
      downloads: window.downloads.length,
      shares: window.shares.length,
    };
  });
  assert.deepEqual(result, { saved: "cancelled", downloads: 0, shares: 1 });
});

test("unsupported sharing and share errors fall back to a JPEG download", async () => {
  const result = await page.evaluate(async () => {
    const canvas = window.makeCanvas();
    window.mockSharing("unsupported");
    const unsupported = await window.exportApi.saveImage(canvas, "desktop.jpg");
    window.mockSharing("failure");
    const failure = await window.exportApi.saveImage(canvas, "fallback.jpg");
    return {
      unsupported,
      failure,
      downloads: window.downloads,
      encodes: canvas.encodes.length,
    };
  });
  assert.equal(result.unsupported, "downloaded");
  assert.equal(result.failure, "downloaded");
  assert.deepEqual(
    result.downloads.map((download) => download.name),
    ["desktop.jpg", "fallback.jpg"],
  );
  assert.ok(
    result.downloads.every((download) => download.href.startsWith("blob:")),
  );
  assert.equal(result.encodes, 1);
});

async function mountEditor(mode) {
  await page.evaluate((value) => window.mountEditor(value), mode);
  await page.getByRole("button", { name: "Xong", exact: true }).waitFor();
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Tải ảnh về"]').disabled,
  );
}

test("the editor encodes only on download and prevents duplicate saves while sharing is open", async () => {
  await mountEditor("heldShare");
  assert.equal(await page.evaluate(() => window.editorState.canvases[0].encodes.length),0,
    "browsing must not start a full-size JPEG encode");
  await page.getByRole("button", { name: "Tải ảnh về", exact: true }).click();
  await page.waitForFunction(() => typeof window.releaseShare === "function");
  assert.equal(
    await page
      .getByRole("button", { name: "Tải ảnh về", exact: true })
      .isDisabled(),
    true,
  );
  await page.evaluate(() =>
    document.querySelector('[aria-label="Tải ảnh về"]').click(),
  );
  const pending = await page.evaluate(() => ({
    shares: window.shares.length,
    encodes: window.editorState.canvases[0].encodes.length,
  }));
  assert.deepEqual(pending, { shares: 1, encodes: 1 });
  await page.evaluate(() => window.releaseShare());
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Tải ảnh về"]').disabled,
  );
});

test("changing photo while encoding cancels the old save instead of sharing the previous portrait", async () => {
  await mountEditor("heldEncoding");
  await page.getByRole("button", { name: "Tải ảnh về", exact: true }).click();
  await page.waitForFunction(() => window.editorState.encodingStarted);
  await page.getByRole("button", { name: "Ảnh tiếp", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".editor-stage canvas").dataset.photo === "two",
  );
  await page.evaluate(() => window.editorState.releaseEncoding());
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Tải ảnh về"]').disabled,
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      shares: window.shares.length,
      downloads: window.downloads.length,
    })),
    { shares: 0, downloads: 0 },
  );
});

test("a changed adjustment downloads new processed pixels without re-encoding the previous version", async () => {
  await mountEditor("ready");
  assert.equal(await page.evaluate(() => window.editorState.canvases[0].encodes.length),0);
  await page.getByRole("tab", { name: "Thon mặt (V-Line)" }).click();
  await page
    .getByRole("slider", { name: "Thon mặt (V-Line)" })
    .evaluate((input) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(input, "85");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await page.waitForFunction(
    () =>
      window.editorState.renders.includes(85) &&
      !document.querySelector('[aria-label="Tải ảnh về"]').disabled,
  );
  await page.getByRole("button", { name: "Tải ảnh về", exact: true }).click();
  await page.waitForFunction(() => window.shares.length === 1);
  const result = await page.evaluate(async () => {
    const image = await createImageBitmap(window.shares[0]);
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    image.close();
    return {
      pixel: [...context.getImageData(10, 10, 1, 1).data],
      encodes: window.editorState.canvases.map(
        (source) => source.encodes.length,
      ),
    };
  });
  assert.ok(
    Math.abs(result.pixel[0] - 85) <= 3,
    `Unexpected red channel: ${result.pixel[0]}`,
  );
  assert.deepEqual(result.encodes, [0, 1]);
});
