// Local synthetic files and API responses only; no camera, live album or R2 writes.
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "vite";
import { chromium } from "../../Photo_BE/node_modules/playwright/index.mjs";

let server, browser, base, jpeg, mirrorJpeg, mirrorThumb, printPng, profiles;
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { StudioContext, ToastProvider } from '/src/studio.jsx';
import { AlbumStudio } from '/src/album/AlbumStudio.jsx';
import { usePhotoEngine } from '/src/album/hooks.js';
import { BoothGallery } from '/src/kiosk/BoothGallery.jsx';
import { prepareCameraPhoto } from '/src/kiosk/photo.js';
import { Kiosk } from '/src/kiosk/Kiosk.jsx';
import { fetchMediaBlob } from '/src/media-delivery.js';
import { printPhoto10x15 } from '/src/print.js';
import * as outbox from '/src/capture-store.js';
const root = createRoot(document.getElementById('root'));
window.prepareCameraPhoto = prepareCameraPhoto;
window.fetchMediaBlob = fetchMediaBlob;
window.testPrint = printPhoto10x15;
window.outbox = outbox;
window.renderShots = shots => root.render(React.createElement(BoothGallery, {
 shots, folder: {name:'fixture'}, folderAccess:'granted', unsaved:0,
}));
function Album() {
 const [booking,setBooking] = useState({code:'fixture',status:'completed',photos:[],prints:1});
 return React.createElement(AlbumStudio,{booking,setBooking,token:'fixture',reloadBooking:()=>{}});
}
window.renderAlbum = () => root.render(React.createElement(MemoryRouter,null,
 React.createElement(StudioContext.Provider,{value:{frames:[]}},
 React.createElement(ToastProvider,null,React.createElement(Album)))));
function EngineProbe({photos}) { window.testPhotoEngine=usePhotoEngine('fixture',photos); return null; }
window.renderPhotoEngine = photos => root.render(React.createElement(EngineProbe,{photos}));
window.renderKiosk = () => root.render(React.createElement(MemoryRouter,null,
 React.createElement(ToastProvider,null,React.createElement(Kiosk))));
`;
before(async () => {
  const output = await build({
    root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    esbuild: { jsx: "automatic" }, define: { "import.meta.env.VITE_API_URL": '""' },
    logLevel: "error", build: { write: false, rollupOptions: {
      input: "/__capture_perf__.jsx", output: { format: "iife", inlineDynamicImports: true },
    } }, plugins: [{ name: "fixture", resolveId(id) { if (id === "/__capture_perf__.jsx") return "\0fixture.jsx"; },
      load(id) { if (id === "\0fixture.jsx") return fixture; } }],
  });
  const script = output.output.find(item => item.type === "chunk").code;
  const sharp = createRequire(new URL("../../Photo_BE/package.json", import.meta.url))("sharp");
  jpeg = await sharp({create:{width:2400,height:1600,channels:3,background:'#b77a67'}}).jpeg().toBuffer();
  const raw=Buffer.alloc(400*200*3);
  for(let i=0;i<400*200;i++) raw.set(i%400<200?[235,25,35]:[30,50,225],i*3);
  mirrorJpeg=await sharp(raw,{raw:{width:400,height:200,channels:3}}).jpeg({quality:97}).toBuffer();
  mirrorThumb=await sharp(mirrorJpeg).flop().resize({width:200}).jpeg({quality:80}).toBuffer();
  printPng=await sharp(mirrorJpeg).resize(1200,1800).png().toBuffer();
  profiles=await Promise.all(Array.from({length:8},(_,i)=>sharp(mirrorJpeg)
    .withMetadata({orientation:i+1}).withIccProfile(i%2?'p3':'srgb')
    .jpeg({quality:97,chromaSubsampling:'4:4:4'}).toBuffer()));
  server = createServer((req,res) => {
    const asset = output.output.find(item => `/${item.fileName}` === req.url);
    if (asset?.type === "asset") {
      res.setHeader("Content-Type", req.url.endsWith(".js") ? "application/javascript" : "application/octet-stream");
      res.end(asset.source); return;
    }
    if (req.url.endsWith(".jpg")) { res.setHeader("Content-Type","image/jpeg"); res.end(jpeg); return; }
    if (req.url === "/fixture.js") { res.setHeader("Content-Type","application/javascript; charset=utf-8"); res.end(script); return; }
    res.setHeader("Content-Type","text/html; charset=utf-8");
    res.end('<meta charset="utf-8"><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({headless:true,args:[
    '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
  ]});
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });

test("waiting for HDMI camera permission cannot block starting or receiving ten JPEG shots", async () => {
  const page = await browser.newPage({permissions:['camera']});
  await page.addInitScript(() => {
    Object.defineProperty(navigator,'wakeLock',{value:undefined});
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory())
      .getDirectoryHandle('camera-fixture',{create:true});
  });
  const shots = [];
  const uploaded = [];
  let starts = 0, activeUploads = 0, peakUploads = 0;
  let releaseFirst;
  const firstSave = new Promise(resolve => { releaseFirst = resolve; });
  const booking = {code:'123456',roomName:'Fixture',packageName:'Fixture',status:'checked_in',photos:[]};
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/kiosk/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/start')) {
      starts++;
      booking.captureStartedAt = new Date().toISOString();
      booking.captureEndsAt = new Date(Date.now() + 600000).toISOString();
    }
    if (path.endsWith('/photo')) {
      const key = route.request().headers()['x-photo-key'];
      shots.push(key);
      // The booth appends its own on-screen preview after the camera bytes (X-Photo-Preview-Length).
      const body = route.request().postDataBuffer();
      const previewLength = Number(route.request().headers()['x-photo-preview-length'] || 0);
      const bytes = body.subarray(0, body.length - previewLength);
      const preview = body.subarray(body.length - previewLength);
      uploaded.push({bytes:[...bytes],preview:previewLength > 0 && preview[0] === 0xff && preview[1] === 0xd8,
        mirror:route.request().headers()['x-photo-mirrored']});
      booking.photos.push({id:String(shots.length),number:shots.length,kind:'original',clientKey:key,
        mirrored:route.request().headers()['x-photo-mirrored']==='1'});
      const snapshot = JSON.stringify(booking);
      activeUploads++; peakUploads = Math.max(peakUploads, activeUploads);
      if (shots.length === 1) await firstSave;
      else await new Promise(resolve => setTimeout(resolve, 250));
      activeUploads--;
      await route.fulfill({ contentType:'application/json', body:snapshot });
      return;
    }
    await route.fulfill({json: path.endsWith('/claim')
      ? {booking,accessToken:'fixture',captureToken:'capture-fixture'}
      : path.endsWith('/photo') ? booking : {booking}});
  });
  try {
    await page.goto(base);
    await page.evaluate(async () => {
      localStorage.setItem('harrod-device','fixture');
      Object.defineProperty(navigator.mediaDevices,'enumerateDevices', {value:async()=>[]});
      Object.defineProperty(navigator.mediaDevices,'getUserMedia', {value:()=>new Promise(()=>{})});
      window.testCameraFolder = await window.showDirectoryPicker();
      window.renderKiosk();
    });
    await page.getByText('Cài đặt máy chụp (nhân viên)').click();
    await page.getByRole('button',{name:/Chọn thư mục ảnh/}).click();
    await page.getByText(/Đã chọn thư mục ảnh “camera-fixture”/).first().waitFor();
    await page.getByRole('textbox',{name:'Mã vé'}).fill('123456');
    await page.getByRole('button',{name:'Bắt đầu chụp'}).click();
    try {
      await page.waitForFunction(() => document.querySelector('.booth-header'),null,{timeout:8000});
    } catch (error) {
      throw new Error(JSON.stringify({starts,errors,
        ui:await page.evaluate(()=>document.body.innerText.slice(-1200)),cause:error.message}));
    }
    for (let i = 0; i < 20 && !starts; i++) await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(starts,1,'the capture session starts while getUserMedia remains unresolved');
    await page.evaluate(async bytes => {
      for(let i=0;i<10;i++) {
        const file=await window.testCameraFolder.getFileHandle(`shot-${i}.jpg`,{create:true});
        const writer=await file.createWritable();
        await writer.write(new Uint8Array(bytes));
        await writer.close();
      }
    }, [...jpeg]);
    try {
      await page.waitForFunction(() => document.querySelector('.booth-gallery-head b')?.textContent==='10',null,{timeout:15000});
    } catch (error) {
      const diagnostic = await page.evaluate(async () => ({
        shown:document.querySelector('.booth-gallery-head')?.innerText,
        scan:document.querySelector('.booth-gallery-head + *')?.innerText,
        pending:(await window.outbox.readPending()).length,
        text:document.body.innerText.slice(-1000),
      }));
      throw new Error(JSON.stringify({diagnostic,uploaded:shots.length,errors,cause:error.message}));
    }
    for(let i=0;i<100 && shots.length<10;i++) await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(shots.length,10);
    await page.waitForFunction(async () => (await window.outbox.readPending('fixture')).length === 1);
    const latestKey = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('photo-capture-fixture')).captureOrder.at(-1));
    assert.equal(await page.locator('.booth-shot img').getAttribute('data-photo-key'), latestKey,
      'a newer saved photo stays visible while an older photo still waits for confirmation');
    const latestPreview = await page.locator('.booth-shot img').getAttribute('src');
    releaseFirst();
    await page.waitForFunction(async () => (await window.outbox.readPending('fixture')).length === 0);
    assert.equal(await page.locator('.booth-shot img').getAttribute('data-photo-key'), latestKey);
    assert.equal(await page.locator('.booth-shot img').getAttribute('src'), latestPreview,
      'the final older acknowledgement neither changes the latest photo nor downloads it again');
    assert.equal(peakUploads,2,'a slow camera save does not block the next original upload');
    assert.equal(await page.locator('.booth-gallery-head b').textContent(),'10',
      'late acknowledgements cannot remove more recently confirmed photos');
    assert.equal(new Set(shots).size,10,'each shot uploads once with its own retry key');
    assert.ok(uploaded.every(item => item.mirror === '1'), 'the default session mirror choice is explicit');
    assert.ok(uploaded.every(item => Buffer.from(item.bytes).equals(jpeg)),
      'all ten uploads keep the camera JPEG bytes untouched');
    assert.ok(uploaded.every(item => item.preview), 'each upload carries the booth preview, so the server need not decode the original');
    assert.deepEqual(errors,[]);
  } finally { releaseFirst(); await page.close(); }
});

test("with storage allowing uploads, camera originals go straight to it and the API only gets previews", async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator,'wakeLock',{value:undefined});
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory())
      .getDirectoryHandle('camera-direct',{create:true});
  });
  const booking = {code:'654321',roomName:'Fixture',packageName:'Fixture',status:'checked_in',photos:[]};
  const tickets = [], stored = new Map(), commits = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Private storage on another origin, answering CORS like the R2 bucket policy allows.
  const cors = {'Access-Control-Allow-Origin':base,'Access-Control-Allow-Methods':'GET, HEAD, PUT',
    'Access-Control-Allow-Headers':'Content-Type'};
  await page.route('https://test-media.account.r2.cloudflarestorage.com/**', async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({status:204,headers:cors});
    stored.set(new URL(request.url()).pathname, {bytes:request.postDataBuffer(), type:request.headers()['content-type']});
    await route.fulfill({status:200,headers:cors,body:''});
  });
  await page.route('**/api/kiosk/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith('/start')) {
      booking.captureStartedAt = new Date().toISOString();
      booking.captureEndsAt = new Date(Date.now() + 600000).toISOString();
    }
    if (path.endsWith('/photo/upload-url')) {
      const body = request.postDataJSON();
      tickets.push(body);
      return route.fulfill({json:{upload:{
        url:`https://test-media.account.r2.cloudflarestorage.com/media/${tickets.length}.jpg?X-Amz-Signature=t`,
        stored:`token-${tickets.length}`}}});
    }
    if (path.endsWith('/photo')) {
      const headers = request.headers();
      commits.push({stored:headers['x-photo-stored'],size:request.postDataBuffer().length,
        previewLength:headers['x-photo-preview-length']});
      booking.photos.push({id:String(commits.length),number:commits.length,kind:'original',clientKey:headers['x-photo-key']});
      return route.fulfill({json:booking});
    }
    await route.fulfill({json: path.endsWith('/claim')
      ? {booking,accessToken:'fixture-direct',captureToken:'capture-direct'} : {booking}});
  });
  try {
    await page.goto(base);
    await page.evaluate(async () => {
      localStorage.setItem('harrod-device','fixture');
      Object.defineProperty(navigator.mediaDevices,'enumerateDevices', {value:async()=>[]});
      Object.defineProperty(navigator.mediaDevices,'getUserMedia', {value:()=>new Promise(()=>{})});
      window.testCameraFolder = await window.showDirectoryPicker();
      window.renderKiosk();
    });
    await page.getByText('Cài đặt máy chụp (nhân viên)').click();
    await page.getByRole('button',{name:/Chọn thư mục ảnh/}).click();
    await page.getByText(/Đã chọn thư mục ảnh “camera-direct”/).first().waitFor();
    await page.getByRole('textbox',{name:'Mã vé'}).fill('654321');
    await page.getByRole('button',{name:'Bắt đầu chụp'}).click();
    await page.waitForFunction(() => document.querySelector('.booth-header'),null,{timeout:8000});
    await page.evaluate(async bytes => {
      for (let i = 0; i < 3; i++) {
        const file = await window.testCameraFolder.getFileHandle(`direct-${i}.jpg`,{create:true});
        const writer = await file.createWritable();
        await writer.write(new Uint8Array(bytes));
        await writer.close();
      }
    }, [...jpeg]);
    await page.waitForFunction(() => document.querySelector('.booth-gallery-head b')?.textContent === '3', null, {timeout:15000});
    for (let i = 0; i < 200 && commits.length < 3; i++) await new Promise(resolve => setTimeout(resolve, 50));
    await page.waitForFunction(async () => (await window.outbox.readPending('fixture-direct')).length === 0);
    assert.equal(tickets.length, 3);
    assert.ok(tickets.every(t => t.captureToken === 'capture-direct' && t.size === jpeg.length));
    assert.equal(stored.size, 3, 'each original went to storage once');
    for (const file of stored.values()) {
      assert.ok(file.bytes.equals(jpeg), 'a clean camera JPEG is stored byte for byte');
      assert.equal(file.type, 'image/jpeg');
    }
    assert.deepEqual(commits.map(c => c.stored).sort(), ['token-1','token-2','token-3']);
    assert.ok(commits.every(c => c.previewLength === undefined && c.size < jpeg.length / 2),
      'the API receives only the small preview');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("a kiosk session recovers after failed start requests without a page reload or a second claim", async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'wakeLock', { value: undefined });
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory())
      .getDirectoryHandle('recovery-camera', { create: true });
  });
  let starts = 0, claims = 0;
  const errors = [];
  const booking = { code: '123456', roomName: 'Fixture', packageName: 'Fixture', status: 'checked_in', photos: [] };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/kiosk/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/claim')) {
      claims++;
      return route.fulfill({ json: { booking, accessToken: 'recovery', captureToken: 'capture-recovery' } });
    }
    if (path.endsWith('/start')) {
      starts++;
      if (starts <= 2) return route.fulfill({ status: 503, json: { message: 'Restarting' } });
      booking.captureStartedAt = new Date().toISOString();
      booking.captureEndsAt = new Date(Date.now() + 600000).toISOString();
    }
    return route.fulfill({ json: { booking } });
  });
  try {
    await page.goto(base);
    await page.evaluate(() => {
      localStorage.setItem('harrod-device', 'fixture');
      Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { value: async () => [] });
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => new Promise(() => {}) });
      window.renderKiosk();
    });
    await page.getByText('Cài đặt máy chụp (nhân viên)').click();
    await page.getByRole('button', { name: /Chọn thư mục ảnh/ }).click();
    await page.getByRole('textbox', { name: 'Mã vé' }).fill('123456');
    await page.getByRole('button', { name: 'Bắt đầu chụp' }).click();
    await page.getByText('Restarting', { exact: true }).waitFor({ timeout: 5000 });
    await page.waitForFunction(() => {
      const stored = JSON.parse(sessionStorage.getItem('photo-capture-fixture') || 'null');
      return Boolean(stored?.booking.captureEndsAt);
    }, null, { timeout: 8000 });
    assert.equal(starts, 3);
    assert.equal(claims, 1, 'recovery never reclaims or replaces the capture token');
    assert.equal(await page.getByText('Restarting', { exact: true }).count(), 0);
    assert.equal(await page.locator('.booth-header').count(), 1);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("time-up while offline retries finishing with growing pauses, one notice, then shows the QR", async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'wakeLock', { value: undefined });
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory())
      .getDirectoryHandle('offline-finish-camera', { create: true });
  });
  let finishes = 0, offline = true;
  const errors = [];
  const booking = { code: '654321', roomName: 'Fixture', packageName: 'Fixture', status: 'checked_in', photos: [] };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/kiosk/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/claim'))
      return route.fulfill({ json: { booking, accessToken: 'offline-finish', captureToken: 'capture-offline' } });
    if (path.endsWith('/start')) {
      booking.captureStartedAt = new Date().toISOString();
      booking.captureEndsAt = new Date(Date.now() + 1200).toISOString();
    }
    if (path.endsWith('/finish')) {
      finishes++;
      if (offline) return route.abort('internetdisconnected');
      return route.fulfill({ json: { ...booking, status: 'completed' } });
    }
    return route.fulfill({ json: { booking } });
  });
  try {
    await page.goto(base);
    await page.evaluate(() => {
      localStorage.setItem('harrod-device', 'fixture');
      Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { value: async () => [] });
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => new Promise(() => {}) });
      window.renderKiosk();
    });
    await page.getByText('Cài đặt máy chụp (nhân viên)').click();
    await page.getByRole('button', { name: /Chọn thư mục ảnh/ }).click();
    await page.getByRole('textbox', { name: 'Mã vé' }).fill('654321');
    await page.getByRole('button', { name: 'Bắt đầu chụp' }).click();
    await page.getByText(/ĐÃ HẾT THỜI GIAN CHỤP/i).waitFor({ timeout: 8000 });
    await page.waitForTimeout(3500);
    // Previously every 250 ms tick re-sent the request and added an error toast.
    assert.ok(finishes <= 6, `finish attempts stay bounded while offline (${finishes})`);
    assert.equal(await page.locator('.toast', { hasText: 'tự thử lại để hiện mã QR' }).count(), 1);
    assert.equal(await page.locator('.toast-error').count(), 0);
    offline = false;
    await page.getByRole('heading', { name: /Quét mã để nhận/ }).waitFor({ timeout: 12000 });
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("full-resolution editing fetches its private R2 link directly and recovers when bucket CORS is missing", async () => {
  for (const cors of [true, false]) {
    const page = await browser.newPage();
    const original = `${base}/api/albums/fixture/photos/direct-test`;
    const signed = 'https://fixture.r2.cloudflarestorage.com/media/original.jpg?temporary=signature';
    let proxyReads = 0, linkReads = 0, r2Reads = 0;
    const origins = [];
    await page.route('**/api/albums/fixture/photos/direct-test**',route => {
      if (new URL(route.request().url()).searchParams.get('direct') === 'link') {
        linkReads++;
        return route.fulfill({json:{url:signed}});
      }
      proxyReads++;
      return route.fulfill({contentType:'image/jpeg',body:mirrorJpeg});
    });
    await page.route('https://fixture.r2.cloudflarestorage.com/**',route => {
      r2Reads++; origins.push(route.request().headers().origin);
      return route.fulfill({contentType:'image/jpeg',body:mirrorJpeg,
        headers: {'Access-Control-Allow-Origin':cors ? base : 'https://not-allowed.example'}});
    });
    try {
      await page.goto(base);
      for (let i=0;i<2;i++) {
        const bytes = await page.evaluate(async url => [...new Uint8Array(await
          (await window.fetchMediaBlob(url)).arrayBuffer())],original);
        assert.deepEqual(Buffer.from(bytes),mirrorJpeg,'delivery never substitutes a thumbnail or recompresses the source');
      }
      assert.equal(proxyReads,cors ? 0 : 2);
      assert.equal(linkReads,cors ? 2 : 1);
      assert.equal(r2Reads,cors ? 2 : 1);
      assert.ok(origins.every(origin => origin === base),'canvas requests retain the web origin, not a null redirect origin');
    } finally { await page.close(); }
  }
});

test("web printing loads the native PNG directly and retries the original stream after an R2 failure", async () => {
  for (const unavailable of [false,true]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    let proxyReads = 0, directReads = 0;
    const source = createServer((req,res) => {
      if (req.url === '/native.png') {
        res.statusCode = unavailable ? 403 : 200;
        res.setHeader('Content-Type',unavailable ? 'text/plain' : 'image/png');
        res.end(unavailable ? 'temporary link failed' : printPng);
        return;
      }
      if (new URL(req.url,'http://fixture').searchParams.get('direct') === '1') {
        directReads++;
        res.writeHead(302,{Location:'/native.png'}); res.end(); return;
      }
      proxyReads++;
      res.setHeader('Content-Type','image/png'); res.end(printPng);
    });
    await new Promise(resolve => source.listen(0,'127.0.0.1',resolve));
    const printUrl = `http://127.0.0.1:${source.address().port}/api/albums/fixture/prints/native`;
    try {
      await page.goto(base);
      await page.evaluate(url => {
        const button = document.createElement('button');
        button.textContent = 'Print fixture';
        button.onclick = () => window.testPrint({imageUrl:url,code:'fixture',copies:1});
        document.body.append(button);
      }, printUrl);
      const opened = page.waitForEvent('popup');
      await page.getByRole('button',{name:'Print fixture'}).click();
      const popup = await opened;
      try {
        await popup.waitForFunction(() => document.querySelector('button')?.disabled === false, null, {timeout:8000});
      } catch (error) {
        throw new Error(JSON.stringify({unavailable,proxyReads,directReads,
          state:await popup.evaluate(() => ({text:document.body.innerText,
            image:document.querySelector('.print-sheet img')?.outerHTML,
            ready:document.querySelector('.print-sheet img')?.complete,
            width:document.querySelector('.print-sheet img')?.naturalWidth})),cause:error.message}));
      }
      const dimensions = await popup.locator('.print-sheet img').evaluate(img => [img.naturalWidth,img.naturalHeight]);
      assert.deepEqual(dimensions,[1200,1800],'no thumbnail reaches the print window');
      const pdf=(await popup.pdf({preferCSSPageSize:true,printBackground:true})).toString('latin1');
      const rasters=[...pdf.matchAll(/\/Subtype\s*\/Image\b[\s\S]{0,200}?\/Width\s+(\d+)[\s\S]{0,100}?\/Height\s+(\d+)/g)]
        .map(match=>[Number(match[1]),Number(match[2])]);
      assert.ok(rasters.some(([width,height])=>width===1200&&height===1800),
        `browser printing must retain the 300 ppi image raster: ${JSON.stringify(rasters)}`);
      assert.equal(directReads,1);
      assert.equal(proxyReads,unavailable ? 1 : 0);
    } finally { await context.close(); await new Promise(resolve => source.close(resolve)); }
  }
});

test("camera preparation keeps full JPEG bytes and makes a small mirrored preview", async () => {
  const page = await browser.newPage();
  const workers = [];
  page.on("worker", worker => workers.push(worker.url()));
  try {
    await page.goto(base);
    await page.evaluate(() => {
      window.workerReplies = 0;
      const OriginalWorker = window.Worker;
      window.Worker = class extends OriginalWorker {
        constructor(...args) {
          super(...args);
          this.addEventListener("message", () => window.workerReplies++);
        }
      };
    });
    const result = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width=4000; canvas.height=1000;
      const ctx=canvas.getContext('2d'); ctx.fillStyle='red'; ctx.fillRect(0,0,2000,1000);
      ctx.fillStyle='blue';ctx.fillRect(2000,0,2000,1000);
      const file=new File([await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg'))],'fixture.jpg',{type:'image/jpeg',lastModified:12345});
      const first=await window.prepareCameraPhoto(file,'fixture.jpg',()=>true);
      const again=await window.prepareCameraPhoto(file,'fixture.jpg',()=>true);
      const image=await createImageBitmap(first.image);
      const preview=await createImageBitmap(first.preview);
      canvas.width=preview.width;canvas.height=preview.height;ctx.drawImage(preview,0,0);
      const result={blob:first.image instanceof Blob,type:first.image.type,width:image.width,height:image.height,
        previewWidth:preview.width,previewHeight:preview.height,mirrored:first.mirrored,
        exact:await first.image.arrayBuffer().then(async buffer=>{
          const original=new Uint8Array(await file.arrayBuffer()),uploaded=new Uint8Array(buffer);
          return original.length===uploaded.length && original.every((value,i)=>value===uploaded[i]);
        }),left:[...ctx.getImageData(100,100,1,1).data],sameId:first.id===again.id};
      image.close();preview.close();return result;
    });
    assert.equal(result.blob,true); assert.equal(result.type,'image/jpeg');
    assert.deepEqual([result.width,result.height],[4000,1000]);
    assert.deepEqual([result.previewWidth,result.previewHeight],[1600,400]);
    assert.equal(result.exact,true);
    assert.equal(result.mirrored,true);
    assert.ok(result.left[2]>220 && result.left[0]<30); assert.equal(result.sameId,true);
    assert.equal(workers.length, 1, "the built worker is loaded and shared by successive photos");
    assert.equal(await page.evaluate(() => window.workerReplies), 2,
      "both photos complete in the built worker rather than the fallback");
  } finally { await page.close(); }
});

test("album editing mirrors the full camera original once while thumbnails stay mirrored", async () => {
  const page=await browser.newPage();
  await page.route('**/api/albums/fixture/photos/mirror**',route=>route.fulfill({
    contentType:'image/jpeg',body:route.request().url().includes('size=thumbnail')?mirrorThumb:mirrorJpeg,
  }));
  try {
    await page.goto(base);
    await page.evaluate(()=>window.renderPhotoEngine([{id:'mirror',mirrored:true}]));
    await page.waitForFunction(()=>Boolean(window.testPhotoEngine));
    const result=await page.evaluate(async()=>{
      const full=await window.testPhotoEngine.original('mirror');
      const thumbUrl=await window.testPhotoEngine.thumb('mirror',100);
      const thumb=new Image();thumb.src=thumbUrl;await thumb.decode();
      const canvas=document.createElement('canvas');canvas.width=thumb.width;canvas.height=thumb.height;
      canvas.getContext('2d').drawImage(thumb,0,0);
      const rgb=(c,x)=>[...c.getContext('2d').getImageData(x,Math.floor(c.height/2),1,1).data].slice(0,3);
      return {size:[full.width,full.height],fullLeft:rgb(full,10),fullRight:rgb(full,390),
        thumbLeft:rgb(canvas,5),thumbRight:rgb(canvas,95)};
    });
    assert.deepEqual(result.size,[400,200]);
    for(const side of ['fullLeft','thumbLeft'])
      assert.ok(result[side][2]>result[side][0]+100,JSON.stringify(result));
    for(const side of ['fullRight','thumbRight'])
      assert.ok(result[side][0]>result[side][2]+100,JSON.stringify(result));
  } finally { await page.close(); }
});

test("full-source worker decoding matches browser colour profiles and all eight EXIF orientations", async () => {
  const page=await browser.newPage();
  let reads=0;
  await page.route('**/api/albums/fixture/photos/profile-*',route=>{
    reads++;
    const id=new URL(route.request().url()).pathname.split('/').pop();
    return route.fulfill({contentType:'image/jpeg',body:profiles[Number(id.split('-')[1])]});
  });
  try {
    await page.goto(base);
    await page.evaluate(()=>window.renderPhotoEngine(Array.from({length:8},(_,i)=>({id:'profile-'+i,mirrored:i%3===0}))));
    await page.waitForFunction(()=>window.testPhotoEngine);
    for(let i=0;i<8;i++) {
      const result=await page.evaluate(async({i,bytes})=>{
        const id='profile-'+i,actual=await window.testPhotoEngine.original(id);
        const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'image/jpeg'}));
        try {
          const image=new Image();image.src=url;await image.decode();
          const expected=document.createElement('canvas');expected.width=image.naturalWidth;expected.height=image.naturalHeight;
          const ctx=expected.getContext('2d');if(i%3===0){ctx.translate(expected.width,0);ctx.scale(-1,1);}ctx.drawImage(image,0,0);
          const a=actual.getContext('2d').getImageData(0,0,actual.width,actual.height).data;
          const b=expected.getContext('2d').getImageData(0,0,expected.width,expected.height).data;
          return{same:a.length===b.length&&a.every((v,index)=>v===b[index]),size:[actual.width,actual.height],expected:[expected.width,expected.height]};
        } finally {URL.revokeObjectURL(url);window.testPhotoEngine.releaseFull(id);}
      },{i,bytes:[...profiles[i]]});
      assert.deepEqual(result.size,result.expected);
      assert.equal(result.same,true,`profile/orientation ${i+1} must preserve the established canvas colours`);
    }
    await page.evaluate(()=>window.testPhotoEngine.original('profile-7'));
    assert.equal(reads,8,'a released original reuses its compressed source instead of downloading it again');
  } finally {await page.close();}
});

test("a saved kiosk photo keeps its local preview without downloading the original again", async () => {
  const page = await browser.newPage();
  const downloads=[];
  page.on('request',req=>{if(req.url().endsWith('.jpg'))downloads.push(req.url());});
  try {
    await page.goto(base);
    await page.evaluate(async bytes=>{
      const blob=new Blob([Uint8Array.from(bytes)],{type:'image/jpeg'});
      window.renderShots([{key:'one',src:blob,label:'Saving'}]);
    },[...jpeg]);
    const photo=page.locator('.booth-shot img');
    await photo.waitFor();
    await page.waitForFunction(()=>document.querySelector('.booth-shot img')?.naturalWidth>0);
    const originalSrc=await photo.getAttribute('src');
    assert.ok(originalSrc.startsWith('blob:'));
    await page.evaluate(url=>window.renderShots([{key:'one',src:url,label:'Saved'}]),base+'/saved-original.jpg');
    await page.locator('figcaption').filter({hasText:'Saved'}).waitFor();
    assert.equal(await photo.getAttribute('src'),originalSrc);
    assert.deepEqual(downloads,[]);
    await page.evaluate(url=>window.renderShots([{key:'two',src:url,label:'Next'}]),base+'/next-original.jpg');
    await page.waitForFunction(()=>document.querySelector('.booth-shot img')?.src.endsWith('/next-original.jpg'));
    assert.equal(downloads.length,1);
  } finally { await page.close(); }
});

test("phone file input uploads original bytes and finishes with an editable photo", async () => {
  const page=await browser.newPage();
  let sent;
  const originalDownloads=[];
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/albums/fixture/photos',async route=>{
    const req=route.request(); sent={headers:req.headers(),body:req.postDataBuffer()};
    await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({code:'fixture',status:'completed',prints:1,photos:[{id:'saved-phone',number:1,kind:'original',favorite:false,sourcePreserved:true,clientKey:req.headers()['x-photo-key']}]})});
  });
  await page.route('**/api/albums/fixture/photos/*',route=>{
    if (!route.request().url().includes('size=thumbnail')) originalDownloads.push(route.request().url());
    return route.fulfill({contentType:'image/jpeg',body:jpeg});
  });
  await page.route('**/api/albums/fixture/photos/upload-url',route=>route.fulfill({status:404,json:{message:'API không tồn tại.'}}));
  try {
    await page.goto(base); await page.evaluate(()=>window.renderAlbum());
    await page.locator('input[type=file]').setInputFiles({name:'phone.jpg',mimeType:'image/jpeg',buffer:jpeg});
    await page.getByRole('button',{name:'Xem & chỉnh ảnh 01'}).waitFor();
    // An older server: the original bytes, with the phone's own preview after them.
    const previewLength=Number(sent.headers['x-photo-preview-length']);
    assert.ok(previewLength>0 && previewLength<jpeg.length);
    assert.deepEqual(sent.body.subarray(0,sent.body.length-previewLength),jpeg); assert.equal(sent.headers['content-type'],'image/jpeg');
    assert.ok(sent.headers['x-photo-key']);
    await page.getByRole('button',{name:'Thêm ảnh từ điện thoại'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Thêm ảnh từ điện thoại'}).isEnabled(),true);
    // The download button on the gallery tile saves the untouched photo as its exact file.
    const tileDownload=page.waitForEvent('download');
    await page.getByRole('button',{name:'Tải ảnh 01 về máy'}).click();
    const tileFile=await tileDownload;
    assert.equal(tileFile.suggestedFilename(),'anh-01.jpg');
    const {readFile}=await import('node:fs/promises');
    assert.deepEqual(await readFile(await tileFile.path()),jpeg,'an unedited photo downloads byte for byte, without re-encoding');
    await page.getByRole('button',{name:'Xem & chỉnh ảnh 01'}).click();
    await page.waitForFunction(()=>document.querySelector('.editor-stage canvas')?.dataset.photo==='saved-phone');
    const rendered=await page.evaluate(async bytes=>{
      const canvas=document.querySelector('.editor-stage canvas');
      const image=new Image(),url=URL.createObjectURL(new Blob([Uint8Array.from(bytes)],{type:'image/jpeg'}));
      try {
        image.src=url;await image.decode();
        const source=document.createElement('canvas');source.width=1600;source.height=1067;
        const ctx=source.getContext('2d');ctx.imageSmoothingQuality='high';ctx.drawImage(image,0,0,source.width,source.height);
        const digest=async c=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',c.getContext('2d').getImageData(0,0,c.width,c.height).data))].join(',');
        return {size:[canvas.width,canvas.height],samePixels:await digest(canvas)===await digest(source)};
      } finally { URL.revokeObjectURL(url); }
    },[...jpeg]);
    assert.deepEqual(rendered.size,[1600,1067], 'viewing uses a bounded preview, not a 26 MP canvas');
    assert.equal(rendered.samePixels,true,'the preview uses the same high-quality scaling as the original renderer');
    const downloading=page.waitForEvent('download');
    await page.getByRole('button',{name:'Tải ảnh về',exact:true}).click();
    const downloaded=await downloading;
    const sharp=createRequire(new URL('../../Photo_BE/package.json',import.meta.url))('sharp');
    const metadata=await sharp(await downloaded.path()).metadata();
    assert.deepEqual([metadata.width,metadata.height],[2400,1600],
      'downloading still uses all original pixels rather than the display preview');
    assert.deepEqual(originalDownloads,[], 'editing reuses the exact uploaded original without a second download');
    // An edited photo downloads from its gallery tile with the edit applied, at full size.
    await page.getByRole('button',{name:'Đen trắng',exact:true}).click();
    await page.getByRole('button',{name:'Xong',exact:true}).click();
    await page.getByRole('dialog',{name:'Xem & chỉnh ảnh'}).waitFor({state:'hidden'});
    const editedDownload=page.waitForEvent('download');
    await page.getByRole('button',{name:'Tải ảnh 01 về máy'}).click();
    const edited=await sharp(await (await editedDownload).path()).raw().toBuffer({resolveWithObject:true});
    assert.deepEqual([edited.info.width,edited.info.height],[2400,1600]);
    const [r,g,b]=edited.data;
    assert.ok(Math.abs(r-g)<=2 && Math.abs(g-b)<=2,'the black-and-white edit is in the downloaded file');
  } catch (error) {
    console.log(JSON.stringify({errors,sent:sent && {headers:sent.headers,bytes:sent.body?.length},text:(await page.locator('body').innerText()).slice(-1800)}));
    throw error;
  } finally { await page.close(); }
});

test("a phone JPEG goes straight to storage and the API only receives the phone's preview", async () => {
  const page=await browser.newPage();
  const stored=[], commits=[], errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const cors={'Access-Control-Allow-Origin':base,'Access-Control-Allow-Methods':'GET, HEAD, PUT','Access-Control-Allow-Headers':'Content-Type'};
  await page.route('https://test-media.account.r2.cloudflarestorage.com/**',route=>{
    if (route.request().method()==='OPTIONS') return route.fulfill({status:204,headers:cors});
    stored.push(route.request().postDataBuffer());
    return route.fulfill({status:200,headers:cors,body:''});
  });
  await page.route('**/api/albums/fixture/photos/*',route=>route.fulfill({contentType:'image/jpeg',body:jpeg}));
  await page.route('**/api/albums/fixture/photos/upload-url',route=>route.fulfill({json:{upload:{
    url:'https://test-media.account.r2.cloudflarestorage.com/media/phone.jpg?X-Amz-Signature=t',stored:'phone-token'}}}));
  await page.route('**/api/albums/fixture/photos',route=>{
    const headers=route.request().headers();
    commits.push({headers,size:route.request().postDataBuffer().length});
    return route.fulfill({status:201,json:{photos:[{id:'direct-phone',number:1,kind:'original',favorite:false,
      sourcePreserved:true,clientKey:headers['x-photo-key']}]}});
  });
  try {
    await page.goto(base);await page.evaluate(()=>window.renderAlbum());
    await page.locator('input[type=file]').setInputFiles({name:'ảnh điện thoại.jpg',mimeType:'image/jpeg',buffer:jpeg});
    await page.getByRole('button',{name:'Xem & chỉnh ảnh 01'}).waitFor();
    assert.equal(stored.length,1);
    assert.ok(stored[0].equals(jpeg),'a clean phone JPEG is stored byte for byte');
    assert.equal(commits.length,1);
    assert.equal(commits[0].headers['x-photo-stored'],'phone-token');
    assert.equal(decodeURIComponent(commits[0].headers['x-photo-name']),'ảnh điện thoại.jpg');
    assert.ok(commits[0].size<jpeg.length/2,'only the small preview goes to the API');
    assert.deepEqual(errors,[]);
  } finally { await page.close(); }
});

test("three phone uploads stay responsive and late responses never remove confirmed photos", async () => {
  const page=await browser.newPage();
  const photos=[], bodies=[];
  let active=0, peak=0, releaseFirst;
  const first=new Promise(resolve=>{releaseFirst=resolve;});
  await page.route('**/api/albums/fixture/photos',async route=>{
    const req=route.request(), number=photos.length+1;
    peak=Math.max(peak,++active);bodies.push(req.postDataBuffer());
    photos.push({id:'batch-'+number,number,kind:'original',favorite:false,sourcePreserved:true,clientKey:req.headers()['x-photo-key']});
    const snapshot=JSON.stringify({photos:[...photos]});
    if (number===1) await first;
    await route.fulfill({status:201,contentType:'application/json',body:snapshot});
    active--;
  });
  await page.route('**/api/albums/fixture/photos/*',route=>route.fulfill({contentType:'image/jpeg',body:jpeg}));
  await page.route('**/api/albums/fixture/photos/upload-url',route=>route.fulfill({status:404,json:{message:'API không tồn tại.'}}));
  try {
    await page.goto(base);await page.evaluate(()=>window.renderAlbum());
    await page.locator('input[type=file]').setInputFiles([1,2,3].map(i=>({name:`phone-${i}.jpg`,mimeType:'image/jpeg',buffer:jpeg})));
    await page.waitForFunction(()=>document.querySelectorAll('.studio-grid figure').length===3);
    assert.equal(peak,2);
    assert.equal(await page.getByRole('button',{name:'Thêm ảnh từ điện thoại'}).isEnabled(),false, 'batch remains pending while first confirmation is delayed');
    await page.getByRole('button',{name:'Xem & chỉnh ảnh 02'}).click();
    await page.waitForFunction(()=>document.querySelector('.editor-stage canvas')?.dataset.photo==='batch-2');
    await page.getByRole('button',{name:'Đóng',exact:true}).click();
    releaseFirst();
    await page.waitForFunction(()=>!document.querySelector('.studio-upload-tile')?.disabled);
    assert.equal(await page.locator('.studio-grid figure').count(),3);
    assert.ok(bodies.every(body=>body.subarray(0,jpeg.length).equals(jpeg)));
  } finally { releaseFirst();await page.close(); }
});

test("a converted upload edits the canonical server original rather than its local file", async () => {
  const page=await browser.newPage();
  const originalDownloads=[];
  await page.route('**/api/albums/fixture/photos',route=>route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({
    photos:[{id:'converted',number:1,kind:'original',favorite:false,sourcePreserved:false,clientKey:route.request().headers()['x-photo-key']}],
  })}));
  await page.route('**/api/albums/fixture/photos/*',route=>{
    if (!route.request().url().includes('size=thumbnail')) originalDownloads.push(route.request().url());
    return route.fulfill({contentType:'image/jpeg',body:jpeg});
  });
  await page.route('**/api/albums/fixture/photos/upload-url',route=>route.fulfill({status:404,json:{message:'API không tồn tại.'}}));
  try {
    await page.goto(base);await page.evaluate(()=>window.renderAlbum());
    await page.locator('input[type=file]').setInputFiles({name:'converted.jpg',mimeType:'image/jpeg',buffer:mirrorJpeg});
    await page.getByRole('button',{name:'Xem & chỉnh ảnh 01'}).click();
    await page.waitForFunction(()=>document.querySelector('.editor-stage canvas')?.dataset.photo==='converted');
    assert.equal(originalDownloads.length,1);
    assert.deepEqual(await page.locator('.editor-stage canvas').evaluate(c=>[c.width,c.height]),[1600,1067]);
  } finally { await page.close(); }
});

test("outbox reads stay readonly, select one guest and preserve binary and legacy payloads", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(base);
    const result = await page.evaluate(async () => {
      const store = window.outbox;
      await store.savePending({ id: "one", token: "guest-one", image: new Blob(["binary-photo"], { type: "image/jpeg" }) });
      await store.savePending({ id: "two", token: "guest-two", image: "data:image/jpeg;base64,bGVnYWN5" });
      await store.savePending({ id: "three", token: "guest-one", image: new Blob(["second-photo"]) });
      await store.saveSetting("folder-fixture", "stored-folder");
      const transactions = [];
      const transact = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function(names, mode, ...options) {
        transactions.push(mode);
        return transact.call(this, names, mode, ...options);
      };
      try {
        const own = await store.readPending("guest-one");
        const missing = await store.readPending("missing");
        const ownCount = await store.countPending("guest-one");
        const allCount = await store.countPending();
        const all = await store.readPending();
        const setting = await store.readSetting("folder-fixture");
        const one = own.find((row) => row.id === "one");
        return { ids: own.map((row) => row.id), missing: missing.length,
          ownCount, allCount, setting, bytes: await one.image.text(),
          legacy: all.find((row) => row.id === "two").image,
          version: await new Promise((resolve, reject) => {
            const request = indexedDB.open("photo-selfbooth-outbox");
            request.onsuccess = () => { resolve(request.result.version); request.result.close(); };
            request.onerror = () => reject(request.error);
          }), transactions };
      } finally { IDBDatabase.prototype.transaction = transact; }
    });
    assert.deepEqual(result.ids, ["one", "three"]);
    assert.equal(result.missing, 0);
    assert.equal(result.ownCount, 2); assert.equal(result.allCount, 3);
    assert.equal(result.bytes, "binary-photo");
    assert.equal(result.legacy, "data:image/jpeg;base64,bGVnYWN5");
    assert.equal(result.setting, "stored-folder");
    assert.equal(result.version, 2, "existing kiosk connections need no database upgrade");
    assert.ok(result.transactions.length >= 6 && result.transactions.every((mode) => mode === "readonly"));
  } finally { await context.close(); }
});

test("an aborted outbox write settles with an error and the next durable save can retry", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(base);
    const result = await page.evaluate(async () => {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(...args) {
        const request = original.apply(this, args);
        this.transaction.abort();
        return request;
      };
      let failed = false;
      try { await window.outbox.savePending({ id: "retry", token: "guest", image: new Blob(["keep-me"]) }); }
      catch { failed = true; }
      finally { IDBObjectStore.prototype.put = original; }
      const afterAbort = await window.outbox.countPending("guest");
      await window.outbox.savePending({ id: "retry", token: "guest", image: new Blob(["keep-me"]) });
      return { failed, afterAbort, afterRetry: await window.outbox.countPending("guest") };
    });
    assert.deepEqual(result, { failed: true, afterAbort: 0, afterRetry: 1 });
  } finally { await context.close(); }
});
