import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { build, transformWithEsbuild } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

let server, browser, base;
const fixture = `
  import React, { useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { StudioContext, ToastProvider } from '/src/studio.jsx';
  import { KioskPackages, KioskPrintCount, KioskPayment } from '/src/kiosk/KioskSale.jsx';
  import { billAcceptor } from '/src/kiosk/bill-acceptor.js';
  import '/src/tailwind.css';
  const packs = [
    { _id: 'full', name: 'Khung to', printSize: 'full', price: 80000, prints: 1, shots: 4 },
    { _id: 'strip', name: 'Khung nhỏ', printSize: 'strip', price: 60000, prints: 1, shots: 4 },
  ];
  window.billEnabled = () => billAcceptor.enabled;
  function App() {
    const [step, setStep] = useState('size');
    const [pack, setPack] = useState(null);
    const [prints, setPrints] = useState(1);
    const [code, setCode] = useState('');
    const [voucher, setVoucher] = useState('');
    const [cashReady, setCashReady] = useState(false);
    window.enableCashFixture = () => setCashReady(true);
    return <>
      {step === 'size' && <KioskPackages packages={packs} onPick={(p) => { setPack(p); setPrints(p.prints); setStep('print'); }} onBack={() => {}} />}
      {step === 'print' && <KioskPrintCount pack={pack} prints={prints} extraPrintPrice={20000} onChange={setPrints} onNext={() => setStep('payment')} onBack={() => setStep('size')} />}
      {step === 'payment' && <KioskPayment pack={pack} total={pack.price + (prints - pack.prints) * 20000} prints={prints} code={code} setCode={setCode}
        onVoucher={(e) => { e.preventDefault(); setVoucher(code); }} bills={[]} onBill={() => {}} onPaid={() => {}} onSkip={() => {}} onBack={() => setStep('print')}
        testMode={false} busy={false} error='' cameraReady={true} cashReady={cashReady} />}
      <output data-testid="voucher-result">{voucher}</output>
    </>;
  }
  createRoot(document.getElementById('root')).render(<StudioContext.Provider value={{ settings: { name: 'Mellow' }, screens: [], packages: packs }}><ToastProvider><App /></ToastProvider></StudioContext.Provider>);
`;

before(async () => {
  const bundle = await build({
    configFile: false, logLevel: "error", esbuild: { jsx: "automatic" },
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env.VITE_API_URL": '""' },
    build: { write: false, minify: false, rollupOptions: { input: "virtual:checkout.jsx" } },
    plugins: [tailwindcss(), {
      name: "checkout-fixture", enforce: "pre",
      resolveId: (id) => id.startsWith("virtual:") ? "\0" + id : null,
      load: (id) => id === "\0virtual:checkout.jsx" ? fixture : null,
      transform: (code, id) => id === "\0virtual:checkout.jsx"
        ? transformWithEsbuild(code, id, { loader: "jsx", jsx: "automatic" }) : null,
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

test("size, print count, voucher, and cash are separate steps", async () => {
  const page = await browser.newPage({ viewport: { width: 1328, height: 639 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(base);
    await page.getByRole("heading", { name: "Chọn khổ ảnh" }).waitFor();
    if (process.env.KIOSK_SCREENSHOT) await page.screenshot({ path: `${process.env.KIOSK_SCREENSHOT}-size.png` });
    assert.equal(await page.getByRole("button", { name: /Tiếp tục/ }).isDisabled(), true);
    await page.getByRole("button", { name: /Khung to/ }).click();
    await page.getByRole("button", { name: /Tiếp tục/ }).click();
    await page.getByRole("heading", { name: "Chọn số bản in" }).waitFor();
    if (process.env.KIOSK_SCREENSHOT) await page.screenshot({ path: `${process.env.KIOSK_SCREENSHOT}-prints.png` });
    assert.equal(await page.locator(".kiosk-counter output").innerText(), "1");
    await page.getByRole("button", { name: "Tăng số bản in" }).click();
    assert.equal(await page.locator(".kiosk-counter output").innerText(), "2");
    assert.match(await page.locator(".kiosk-price strong").innerText(), /100.000/);
    await page.getByRole("button", { name: /Chọn thanh toán/ }).click();
    await page.getByRole("heading", { name: "Chọn cách thanh toán" }).waitFor();
    if (process.env.KIOSK_SCREENSHOT) await page.screenshot({ path: `${process.env.KIOSK_SCREENSHOT}-payment.png` });
    assert.equal(await page.getByRole("button", { name: /Quét mã QR/ }).count(), 0);
    assert.equal(await page.evaluate(() => window.billEnabled()), false);
    assert.equal(await page.getByRole("button", { name: /Chọn tiền mặt/ }).isDisabled(), true);
    for (const n of "123456") await page.getByRole("button", { name: n, exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "Mã voucher" }).inputValue(), "123456");
    await page.getByRole("button", { name: "Dùng mã voucher" }).click();
    assert.equal(await page.getByTestId("voucher-result").innerText(), "123456");
    assert.equal(await page.evaluate(() => window.billEnabled()), false);
    await page.evaluate(() => window.enableCashFixture());
    await page.getByRole("button", { name: /Chọn tiền mặt/ }).click();
    await page.getByRole("heading", { name: "Đút tiền để bắt đầu chụp" }).waitFor();
    assert.equal(await page.evaluate(() => window.billEnabled()), false);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
