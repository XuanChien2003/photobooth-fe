// Run explicitly: node test/dialog-focus.browser.mjs
// Real password/photo dialogs and keyboard interactions; no live API or accounts.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium } from "../../Photo_BE/node_modules/playwright/index.mjs";

const fixture = `
  import React, { useLayoutEffect, useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { createPortal } from 'react-dom';
  import { ToastProvider } from '/src/studio.jsx';
  import { PasswordDialog } from '/src/admin/auth.jsx';
  import { PhotoEditor } from '/src/album/PhotoEditor.jsx';
  import { DEFAULT_ADJUST } from '/src/beauty.js';
  import { createPhotoEngine } from '/src/album/photo-engine.js';
  const canvas = document.createElement('canvas');
  canvas.width = 40; canvas.height = 60;
  const engine = createPhotoEngine({
    loadOriginal: () => canvas, detectFaces: () => [],
    applyBeauty: () => canvas, isNeutral: () => true,
    beautyKeys: ['slim', 'smooth', 'whiten', 'blush'],
    createThumbnail: () => canvas.toDataURL(),
  });
  function App() {
    const [password, setPassword] = useState(null);
    const [photo, setPhoto] = useState(false);
    const [photoHeader, setPhotoHeader] = useState(null);
    const [sheet, setSheet] = useState(false);
    const [dialog, setDialog] = useState(false);
    const [busy, setBusy] = useState(false);
    const [kiosk, setKiosk] = useState(false);
    const [count, setCount] = useState(0);
    useLayoutEffect(() => setPhotoHeader(photo ? document.querySelector('.editor-head') : null), [photo]);
    window.fixture = { setBusy, update: () => setCount((n) => n + 1) };
    const session = {
      password, setPassword, error: '', busy: false,
      passwordForm: { errors: {}, clear: () => {} },
      changePassword: (event) => event.preventDefault(),
      showCurrentPassword: false, setShowCurrentPassword: () => {},
      showNewPassword: false, setShowNewPassword: () => {},
    };
    return React.createElement(React.Fragment, null,
      React.createElement('aside', { id: 'sidebar' },
        React.createElement('button', { id: 'menu-opener' }, 'Menu quản lý'),
        React.createElement('div', { id: 'password-menu' },
          React.createElement('button', { id: 'password-opener', onClick: () => setPassword({ current: '', password: '', confirm: '' }) }, 'Open password'))),
      React.createElement('button', { id: 'photo-opener', onClick: () => setPhoto(true) }, 'Open photo'),
      React.createElement('button', { id: 'dialog-opener', onClick: () => setDialog(true) }, 'Open task'),
      React.createElement('button', { id: 'kiosk-opener', onClick: () => setKiosk(true) }, 'Open kiosk confirmation'),
      React.createElement('input', { id: 'background-field', 'aria-label': 'Background' }),
      React.createElement('span', { id: 'renders' }, count),
      React.createElement(PasswordDialog, { session }),
      photo && React.createElement(PhotoEditor, {
        engine, photos: [{ id: 'one', number: 1 }], startId: 'one',
        adjustOf: () => DEFAULT_ADJUST, onFavorite: () => {}, onDelete: async () => false,
        onClose: () => { window.photoCloses = (window.photoCloses || 0) + 1; setSheet(false); setPhoto(false); },
        onSave: () => {}, onApplyAll: () => {},
      }),
      photo && photoHeader && createPortal(React.createElement('button', {
        id: 'sheet-opener', onClick: () => setSheet(true),
      }, 'Open photo sheet'), photoHeader),
      sheet && createPortal(React.createElement('section', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Nested photo sheet', id: 'photo-sheet' },
        React.createElement('button', { 'aria-label': 'Đóng', onClick: () => setSheet(false) }, 'Close sheet'),
        React.createElement('button', { id: 'choose-photo' }, 'Choose photo'),
      ), document.querySelector('.photo-editor')),
      dialog && React.createElement('section', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Task', id: 'task' },
        React.createElement('button', { 'aria-label': 'Đóng', disabled: busy, onClick: () => setDialog(false) }, 'Close task'),
        React.createElement('input', { autoFocus: true, id: 'autofocus-input', defaultValue: 'preserve me' }),
        React.createElement('button', { id: 'last-task', disabled: busy }, 'Submit task'),
      ),
      kiosk && React.createElement('section', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Kiosk', className: 'kiosk-confirm' },
        React.createElement('div', { className: 'kiosk-confirm-card' },
          React.createElement('button', { className: 'button outline', autoFocus: true, onClick: () => setKiosk(false) }, 'Chụp tiếp'),
          React.createElement('button', { onClick: () => { window.finished = true; setKiosk(false); } }, 'Kết thúc'),
        ),
      ),
    );
  }
  createRoot(document.getElementById('root')).render(
    React.createElement(React.StrictMode, null,
      React.createElement(ToastProvider, null, React.createElement(App))));
`;

let server;
let browser;
let page;
const errors = [];

before(async () => {
  const bundle = await build({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    esbuild: { jsx: "automatic" },
    define: { "process.env.NODE_ENV": '"development"' },
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        input: "/__dialog_fixture__.jsx",
        output: {
          format: "iife",
          name: "DialogRegression",
          inlineDynamicImports: true,
        },
      },
    },
    plugins: [
      {
        name: "dialog-focus-regression-fixture",
        enforce: "pre",
        resolveId(id, importer) {
          if (id === "/__dialog_fixture__.jsx") return "\0dialog-fixture.jsx";
          if (id === "../beauty" && importer?.includes("PhotoEditor.jsx"))
            return "\0dialog-beauty.js";
        },
        load(id) {
          if (id === "\0dialog-fixture.jsx") return fixture;
          if (id === "\0dialog-beauty.js")
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
      '<!doctype html><style>[role="dialog"]{position:fixed;inset:30px;background:white;border:1px solid;padding:20px}#photo-sheet{inset:60px}.editor-workspace{display:flex;gap:20px}button,input{margin:4px}</style><div id="root"></div><script src="/fixture.js"></script>',
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => errors.push(error.message));
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

async function reset() {
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => !!window.fixture);
}

async function focused(selector) {
  await page.waitForFunction(
    (value) => document.activeElement?.matches(value),
    selector,
  );
}

test("password dialog focuses its first field, keeps typing focus, and returns to the opener", async () => {
  await reset();
  await page.locator("#password-opener").click();
  await focused('input[name="current"]');
  await page.locator('input[name="current"]').fill("current password");
  await page.keyboard.type(" more");
  assert.equal(
    await page.locator('input[name="current"]').inputValue(),
    "current password more",
  );
  await page.evaluate(() => window.fixture.update());
  await focused('input[name="current"]');
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await focused("#password-opener");
});

test("Tab and Shift+Tab wrap inside the real password dialog", async () => {
  await reset();
  await page.locator("#password-opener").click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Đổi mật khẩu", exact: true })
    .focus();
  await page.keyboard.press("Tab");
  await focused('[role="dialog"] button[aria-label="Đóng"]');
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement.textContent.trim()),
    "Đổi mật khẩu",
  );
  await page.locator("#background-field").evaluate((input) => input.focus());
  assert.equal(
    await page.evaluate(
      () => !!document.activeElement.closest('[role="dialog"]'),
    ),
    true,
  );
});

test("closing a mobile dialog returns focus to the visible menu when its opener is hidden", async () => {
  await reset();
  await page.locator("#password-opener").click();
  await focused('input[name="current"]');
  await page.locator("#password-menu").evaluate((menu) => {
    menu.style.display = "none";
  });
  await page.keyboard.press("Escape");
  await focused("#menu-opener");
});

test("existing autoFocus survives mounting and busy tasks cannot be dismissed with Escape", async () => {
  await reset();
  await page.locator("#dialog-opener").click();
  await focused("#autofocus-input");
  await page.locator("#autofocus-input").fill("edited");
  await page.evaluate(() => window.fixture.setBusy(true));
  await page.waitForFunction(
    () => document.querySelector('#task button[aria-label="Đóng"]').disabled,
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 1);
  assert.equal(await page.locator("#autofocus-input").inputValue(), "edited");
  await page.keyboard.press("Tab");
  await focused("#autofocus-input");
  await page.evaluate(() => window.fixture.setBusy(false));
  await page.waitForFunction(
    () => !document.querySelector('#task button[aria-label="Đóng"]').disabled,
  );
  await page.keyboard.press("Escape");
  await focused("#dialog-opener");
});

test("the real photo editor owns focus and Escape restores the gallery opener", async () => {
  await reset();
  await page.locator("#photo-opener").click();
  await focused('.photo-editor button[aria-label="Đóng"]');
  await page.waitForFunction(
    () => !document.querySelector(".editor-foot button:last-child").disabled,
  );
  await page.getByRole("button", { name: "Xong", exact: true }).focus();
  await page.keyboard.press("Tab");
  // The sheet control lives in the header; the footer is still last in order.
  await focused('.photo-editor button[aria-label="Đóng"]');
  await page.keyboard.press("Escape");
  await focused("#photo-opener");
  assert.equal(await page.evaluate(() => window.photoCloses), 1);
});

test("a nested photo sheet traps keys and Escape closes only the sheet", async () => {
  await reset();
  await page.locator("#photo-opener").click();
  await page.locator("#sheet-opener").click();
  await focused('#photo-sheet button[aria-label="Đóng"]');
  await page.keyboard.press("Shift+Tab");
  await focused("#choose-photo");
  await page.keyboard.press("Tab");
  await focused('#photo-sheet button[aria-label="Đóng"]');
  await page.keyboard.press("Escape");
  await page.locator("#photo-sheet").waitFor({ state: "detached" });
  assert.equal(await page.locator(".photo-editor").count(), 1);
  assert.equal(await page.evaluate(() => window.photoCloses || 0), 0);
  await focused("#sheet-opener");
  await page.keyboard.press("Escape");
  await focused("#photo-opener");
  assert.equal(await page.evaluate(() => window.photoCloses), 1);
});

test("kiosk Escape chooses Chụp tiếp and repeated StrictMode dialog openings clean up", async () => {
  await reset();
  await page.locator("#kiosk-opener").click();
  await focused(".kiosk-confirm .button.outline");
  await page.keyboard.press("Escape");
  await focused("#kiosk-opener");
  assert.equal(await page.evaluate(() => !!window.finished), false);
  for (let iteration = 0; iteration < 3; iteration++) {
    await page.locator("#dialog-opener").click();
    await focused("#autofocus-input");
    await page.keyboard.press("Escape");
    await focused("#dialog-opener");
  }
  await page.locator("#background-field").focus();
  await focused("#background-field");
  assert.deepEqual(errors, []);
});
