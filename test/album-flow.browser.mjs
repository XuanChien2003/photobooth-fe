import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, extname, sep } from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { chromium } from "../../Photo_BE/node_modules/playwright/index.mjs";
import { decodePrintPack } from "./print-pack-fixture.js";

// Run after npm run build. Real compiled app, local fixtures, no live database/printer.
const project = fileURLToPath(new URL("..", import.meta.url));
const dist = join(project, "dist");
const output = join(tmpdir(), "nxc-album-flow-review");
await mkdir(output, { recursive: true });
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const target = resolve(dist, "." + pathname);
    if (!target.startsWith(resolve(dist) + sep))
      throw new Error("Outside dist");
    let body,
      type = mime[extname(target)] || "application/octet-stream";
    try {
      body = await readFile(target);
    } catch {
      body = await readFile(join(dist, "index.html"));
      type = "text/html";
    }
    res.writeHead(200, { "Content-Type": type });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;
const token = "flow-review";
const sharp = createRequire(new URL("../../Photo_BE/package.json", import.meta.url))("sharp");
const photoJpeg = await sharp({
  create: { width: 600, height: 900, channels: 3, background: "#e6d4c1" },
}).jpeg({ quality: 90 }).toBuffer();
const image =
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#e6d4c1"/><circle cx="300" cy="310" r="135" fill="#bfa288"/></svg>';
const frames = [
  {
    _id: "frame-1",
    name: "Khung kiểm tra",
    themeName: "Hoa",
    order: 1,
    active: true,
    printSize: "full",
    slots: [{ x: 0.1, y: 0.1, w: 0.8, h: 0.7 }],
    image: "data:image/svg+xml;base64," + Buffer.from(image).toString("base64"),
  },
];
const photo = (i) => ({
  id: "photo-" + i,
  number: i + 1,
  kind: "original",
  favorite: i === 0,
  expiresAt: new Date(Date.now() + 20 * 3600000).toISOString(),
});
const persisted = {
  step: 3,
  adjusts: {},
  defaultAdjust: {
    smooth: 0,
    whiten: 0,
    blush: 0,
    slim: 0,
    filter: "original",
  },
  packId: "theme:Hoa",
  frameIndex: 0,
  layouts: {
    "frame-1": [{ photo: "photo-0", zoom: 1, x: 0, y: 0, rotate: 0 }],
  },
};
const browser = await chromium.launch({ headless: true });

async function fixture(step = 3, twoFrames = false, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const availableFrames = twoFrames
    ? [
        ...frames,
        {
          ...frames[0],
          _id: "frame-2",
          name: "Khung kiểm tra II",
          image:
            "data:image/svg+xml;base64," +
            Buffer.from(image.replace("#e6d4c1", "#643627")).toString("base64"),
        },
      ]
    : frames;
  const layouts = options.layouts || Object.fromEntries(
    availableFrames.map((f) => [f._id, persisted.layouts["frame-1"]]),
  );
  const state = {
    booking: {
      _id: "audit-booking",
      code: "365554",
      accessToken: token,
      status: "completed",
      prints: twoFrames ? 3 : 1,
      printSheets: 0,
      mediaExpiresAt: new Date(Date.now() + 20 * 3600000).toISOString(),
      photos: options.photos || [photo(0)],
    },
    job: null,
    jobs: new Map(),
    requests: [],
    photoReads: [],
    storageReads: [],
    storageOrigins: [],
    reads: { booking: 0, job: 0 },
    errors: [],
    unexpected: [],
  };
  page.on("pageerror", (e) => state.errors.push(e.message));
  await context.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.pathname.includes("/api/")) {
      const path = url.pathname.slice(url.pathname.indexOf("/api/") + 4);
      const headers = {
        "Access-Control-Allow-Origin": base,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      };
      if (req.method() === "OPTIONS")
        return route.fulfill({ status: 204, headers });
      // Ảnh chụp là JPEG thật như máy ảnh gửi lên (bộ giải mã ảnh chạy trong worker).
      if (path.startsWith(`/albums/${token}/photos/`)) {
        state.photoReads.push(path + url.search);
        return route.fulfill({
          status: 200,
          contentType: "image/jpeg",
          headers,
          body: photoJpeg,
        });
      }
      let body,
        status = 200;
      if (path === "/catalog")
        body = {
          settings: { name: "NXC Studio", extraPrintPrice: 30000 },
          frames: availableFrames,
          rooms: [],
          packages: [],
        };
      else if (path === "/auth/me")
        body = { _id: "audit-admin", name: "Kiểm tra", role: "admin" };
      else if (path === `/albums/${token}`) {
        state.reads.booking++;
        body = structuredClone(state.booking);
        if (state.delayBooking) {
          const wait = state.delayBooking;
          state.delayBooking = null;
          await wait;
        }
      } else if (path === `/albums/${token}/favorites`) {
        const ids = new Set(req.postDataJSON().ids);
        state.booking.photos = state.booking.photos.map((p) => ({
          ...p,
          favorite: ids.has(p.id),
        }));
        body = state.booking;
      } else if (path === `/albums/${token}/print`) {
        state.reads.job++;
        const key = url.searchParams.get("requestKey");
        body = key ? state.jobs.get(key) || null : state.job;
        if (key && state.hideLookup) {
          body = null;
          state.hideLookup = false;
        }
        if (body)
          body = {
            ...body,
            prints: state.booking.prints,
            printSheets: state.booking.printSheets,
          };
      } else if (path === `/albums/${token}/print-pack`) {
        const data = decodePrintPack(req.postDataBuffer(), req.headers());
        state.requests.push(data);
        if (state.rejectFirst && state.requests.length === 1)
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            headers,
            body: JSON.stringify({ message: "Ảnh in không hợp lệ." }),
          });
        if (state.noAcceptFirst && state.requests.length === 1)
          return route.abort("failed");
        if (!state.jobs.has(data.requestKey)) {
          state.booking.printSheets += data.images.length;
          state.job = {
            _id: `audit-job-${state.jobs.size + 1}`,
            sheetCount: data.images.length,
            status: "pending",
            spoolStatus: "idle",
            prints: state.booking.prints,
            printSheets: state.booking.printSheets,
          };
          state.jobs.set(data.requestKey, state.job);
        }
        if (state.loseResponse && state.requests.length === 1)
          return route.abort("failed");
        body = {
          ...state.jobs.get(data.requestKey),
          prints: state.booking.prints,
          printSheets: state.booking.printSheets,
        };
      } else {
        status = 404;
        body = { message: "Undefined audit route: " + path };
        state.unexpected.push(path);
      }
      return route.fulfill({
        status,
        contentType: "application/json",
        headers,
        body: JSON.stringify(body),
      });
    }
    // Private storage links the album handed out (R2 answers with CORS for the shop's origin).
    if (url.hostname.endsWith(".r2.cloudflarestorage.com")) {
      state.storageReads.push(url.pathname);
      state.storageOrigins.push(req.headers().origin);
      return route.fulfill({ status: 200, contentType: "image/jpeg", body: photoJpeg,
        headers: { "Access-Control-Allow-Origin": base } });
    }
    if (url.origin !== base) return route.abort();
    return route.continue();
  });
  await context.addInitScript(
    ({ token, persisted, step, layouts }) =>
      localStorage.setItem(
        `photo-flow-v5-${token}`,
        JSON.stringify({ ...persisted, step, layouts }),
      ),
    { token, persisted, step, layouts },
  );
  return { context, page, state };
}

async function latePhotos() {
  const { context, page, state } = await fixture(0);
  try {
    await page.goto(`${base}/album/${token}`, { waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: "Xem & chỉnh ảnh 01", exact: true })
      .waitFor();
    const before = state.reads.booking;
    state.booking.photos.push(photo(1)); // Camera's offline queue finishes syncing.
    await page.waitForTimeout(16500); // Exceeds album's normal 15-second refresh.
    const displayed = await page.locator(".studio-photo").count();
    const result = {
      case: "late-camera-photo",
      serverPhotos: state.booking.photos.length,
      displayedPhotos: displayed,
      bookingReadsBefore: before,
      bookingReadsAfter: state.reads.booking,
      errors: state.errors,
      unexpected: state.unexpected,
    };
    assert.equal(displayed, 2);
    assert.ok(state.reads.booking > before);
    state.booking.photos.push(photo(2));
    await page
      .getByRole("button", { name: "Làm mới ảnh", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Xem & chỉnh ảnh 03", exact: true })
      .waitFor();
    await page.screenshot({
      path: join(output, "late-photo.png"),
      fullPage: true,
    });
    return result;
  } finally {
    await context.close();
  }
}

async function storageLinks() {
  const { context, page, state } = await fixture(0);
  const link = (id, size) =>
    `https://bucket.account.r2.cloudflarestorage.com/media/${id}.${size}.jpg?X-Amz-Signature=${id}`;
  state.booking.photos = [0, 1].map((i) => ({
    ...photo(i),
    links: {
      // The second photo's links have run out: it goes through the API as before.
      until: new Date(Date.now() + (i ? -1000 : 240000)).toISOString(),
      thumbnail: link(`photo-${i}`, "thumbnail"),
      preview: link(`photo-${i}`, "preview"),
    },
  }));
  try {
    await page.goto(`${base}/album/${token}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelectorAll(".fade-img.is-loaded").length === 2);
    const gallery = { storage: [...state.storageReads], api: [...state.photoReads] };
    assert.deepEqual(gallery.storage, ["/media/photo-0.thumbnail.jpg"]);
    // CORS mode, so the cached copy also serves the editor's canvas fetch of the same URL.
    assert.deepEqual(state.storageOrigins, [base]);
    assert.deepEqual(gallery.api, ["/albums/" + token + "/photos/photo-1?size=thumbnail&direct=1"]);
    await page.getByRole("button", { name: "Xem & chỉnh ảnh 01", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".editor-canvas, canvas"));
    await page.waitForTimeout(500);
    assert.ok(state.storageReads.includes("/media/photo-0.preview.jpg"), "the editor preview comes straight from storage");
    assert.ok(!state.photoReads.some((p) => p.includes("photo-0?size=preview")), "no server round trip for it");
    return { case: "album-storage-links", gallery, storage: state.storageReads, api: state.photoReads,
      errors: state.errors, unexpected: state.unexpected };
  } finally {
    await context.close();
  }
}

async function printPrefetch() {
  const link = (id, size) =>
    `https://bucket.account.r2.cloudflarestorage.com/media/${id}.${size}.jpg?X-Amz-Signature=${id}`;
  const photos = [0, 1].map((i) => ({
    ...photo(i),
    printSource: true,
    links: {
      until: new Date(Date.now() + 240000).toISOString(),
      thumbnail: link(`photo-${i}`, "thumbnail"),
      preview: link(`photo-${i}`, "preview"),
      print: link(`photo-${i}`, "print"),
    },
  }));
  const slot = (id) => [{ photo: id, zoom: 1, x: 0, y: 0, rotate: 0 }];
  const { context, page, state } = await fixture(3, true, {
    photos,
    layouts: { "frame-1": slot("photo-0"), "frame-2": slot("photo-1") },
  });
  try {
    await page.goto(`${base}/album/${token}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Tờ in 1", exact: true }).waitFor();
    const prints = state.storageReads.filter((p) => p.endsWith(".print.jpg"));
    // Downloaded ahead while the first sheet was painted, yet each print source exactly once
    // and straight from storage: the prefetched copy is the one that gets painted.
    assert.deepEqual([...prints].sort(), ["/media/photo-0.print.jpg", "/media/photo-1.print.jpg"]);
    assert.ok(!state.photoReads.some((p) => p.includes("size=print")), "no server round trip");
    return { case: "print-sources-prefetched", prints, errors: state.errors, unexpected: state.unexpected };
  } finally {
    await context.close();
  }
}

async function extraPrint() {
  const { context, page, state } = await fixture();
  try {
    await page.goto(`${base}/album/${token}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Tờ in 1", exact: true }).waitFor();
    await page.getByRole("button", { name: /^Gửi in/ }).evaluate((button) => {
      button.click();
      button.click();
    });
    await page.locator(".print-confirmation").waitFor();
    await page
      .getByRole("button", { name: "Xem và tải ảnh", exact: true })
      .click();
    state.booking.prints = 2; // Receptionist sells one additional sheet.
    await page.waitForFunction(
      () =>
        document
          .querySelector(".print-quota")
          ?.textContent.includes("còn 1 tờ"),
      null,
      { timeout: 13000 },
    );
    const result = {
      case: "same-sheet-after-extra-sale",
      quotaText: await page.locator(".print-quota").innerText(),
      sheetDisabled: await page
        .getByRole("button", { name: "Tờ in 1", exact: true })
        .isDisabled(),
      sendDisabled: await page
        .getByRole("button", { name: "Chọn tờ để in", exact: true })
        .isDisabled(),
      errors: state.errors,
      unexpected: state.unexpected,
    };
    assert.equal(result.sheetDisabled, false);
    assert.equal(result.sendDisabled, true);
    assert.equal(
      state.requests.length,
      1,
      "double click creates only one request",
    );
    await page.getByRole("button", { name: "Tờ in 1", exact: true }).click();
    assert.match(await page.locator(".sheet-pick").innerText(), /In tờ này/);
    await page.getByRole("button", { name: /^Gửi in/ }).click();
    await page.locator(".print-confirmation").waitFor();
    assert.equal(state.jobs.size, 2);
    assert.notEqual(state.requests[0].requestKey, state.requests[1].requestKey);
    assert.equal(state.booking.printSheets, 2);
    await page.screenshot({
      path: join(output, "extra-print.png"),
      fullPage: true,
    });
    return result;
  } finally {
    await context.close();
  }
}

async function printerCompletion(spoolStatus = "sent") {
  const { context, page, state } = await fixture();
  try {
    await page.goto(`${base}/album/${token}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Tờ in 1", exact: true }).waitFor();
    await page.getByRole("button", { name: /^Gửi in/ }).click();
    await page.locator(".print-confirmation").waitFor();
    state.job.spoolStatus = spoolStatus;
    await page.waitForTimeout(4500); // Result polls once and sees sent.
    const before = state.reads.job;
    state.job.status = "printed";
    state.booking.printed = true;
    await page.waitForTimeout(9000); // Two job poll cycles should see receptionist's confirmation.
    const result = {
      case: `DNP-${spoolStatus}-then-receptionist-printed`,
      serverStatus: state.job.status,
      heading: await page.locator(".print-confirmation h2").innerText(),
      jobReadsBefore: before,
      jobReadsAfter: state.reads.job,
      bookingReads: state.reads.booking,
      errors: state.errors,
      unexpected: state.unexpected,
    };
    assert.equal(result.heading, "Ảnh của bạn đã in xong");
    assert.ok(state.reads.job > before);
    await page.screenshot({
      path: join(output, `print-status-${spoolStatus}.png`),
      fullPage: true,
    });
    return result;
  } finally {
    await context.close();
  }
}

async function lostPrintResponse({
  reload = false,
  accepted = true,
  hideLookup = false,
  exhaustQuota = false,
} = {}) {
  const { context, page, state } = await fixture(3, true);
  try {
    if (exhaustQuota) state.booking.prints = 1;
    await page.goto(`${base}/album/${token}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Tờ in 2", exact: true }).waitFor();
    if (!exhaustQuota)
      await page.getByRole("button", { name: "Tờ in 2", exact: true }).click(); // Send only sheet 1.
    state.loseResponse = true;
    state.noAcceptFirst = !accepted;
    state.hideLookup = hideLookup;
    await page.getByRole("button", { name: /^Gửi in/ }).click();
    await page
      .getByRole("button", { name: "Kiểm tra và thử lại", exact: true })
      .waitFor();
    assert.equal(state.requests.length, 1);
    if (reload) {
      await page.reload({ waitUntil: "networkidle" });
      await page
        .getByRole("button", { name: "Kiểm tra và thử lại", exact: true })
        .waitFor();
    }
    assert.equal(
      await page
        .getByRole("button", { name: "Tờ in 1", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Tờ in 2", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Chủ đề", exact: true })
        .isDisabled(),
      true,
    );
    const frozen = await page
      .locator(".print-retry-preview img")
      .getAttribute("src");
    assert.equal(frozen, state.requests[0].images[0]);
    await page
      .getByRole("button", { name: "Kiểm tra và thử lại", exact: true })
      .click();
    await page
      .locator(".print-confirmation")
      .waitFor()
      .catch(async (error) => {
        console.error(
          JSON.stringify({
            reload,
            accepted,
            hideLookup,
            requests: state.requests.length,
            jobs: state.jobs.size,
            reads: state.reads,
            errors: state.errors,
            unexpected: state.unexpected,
            text: await page.locator("body").innerText(),
          }),
        );
        throw error;
      });
    await page
      .getByRole("button", { name: "Xem và tải ảnh", exact: true })
      .click();
    assert.equal(state.jobs.size, 1);
    assert.equal(state.booking.printSheets, 1);
    if (state.requests.length > 1)
      assert.deepEqual(
        state.requests[1],
        state.requests[0],
        "retry freezes both images and key",
      );
    else
      assert.equal(
        accepted,
        true,
        "recover the existing request without posting again",
      );
    const picks = await page.locator(".sheet-pick").allTextContents();
    assert.match(picks[0], /Đã gửi/);
    assert.equal(picks[1], "Không in");
    if (exhaustQuota) {
      assert.equal(
        await page
          .getByRole("button", { name: "Tờ in 2", exact: true })
          .isDisabled(),
        true,
      );
    } else {
      await page.getByRole("button", { name: "Tờ in 2", exact: true }).click();
      assert.equal(
        await page
          .getByRole("button", { name: "Tờ in 2", exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
    }
    const result = {
      case: `lost-print-response-reload-${reload}-accepted-${accepted}-lookup-hidden-${hideLookup}-quota-empty-${exhaustQuota}`,
      requests: state.requests.length,
      jobs: state.jobs.size,
      used: state.booking.printSheets,
      errors: state.errors,
      unexpected: state.unexpected,
    };
    await page.screenshot({
      path: join(output, `${result.case}.png`),
      fullPage: true,
    });
    return result;
  } finally {
    await context.close();
  }
}

async function staleRefresh() {
  const { context, page, state } = await fixture(0);
  try {
    await page.goto(`${base}/album/${token}`, { waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: "Bỏ tim ảnh 01", exact: true })
      .waitFor();
    let release;
    state.delayBooking = new Promise((resolve) => {
      release = resolve;
    });
    const before = state.reads.booking;
    await page
      .getByRole("button", { name: "Làm mới ảnh", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document
          .querySelector(".studio-album-refresh")
          ?.getAttribute("aria-busy") === "true",
    );
    while (state.reads.booking === before) await page.waitForTimeout(20);
    await page
      .getByRole("button", { name: "Bỏ tim ảnh 01", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Chọn chủ đề", exact: true })
      .waitFor();
    assert.equal(state.booking.photos[0].favorite, false);
    release();
    await page
      .getByRole("button", { name: "Làm mới ảnh", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Thả tim ảnh 01", exact: true })
      .waitFor();
    assert.equal(state.booking.photos[0].favorite, false);
    return {
      case: "stale-refresh-does-not-undo-a-heart-change",
      errors: state.errors,
      unexpected: state.unexpected,
    };
  } finally {
    await context.close();
  }
}

async function rejectedPrint() {
  const { context, page, state } = await fixture(3, true);
  try {
    await page.goto(`${base}/album/${token}`, { waitUntil: "networkidle" });
    state.rejectFirst = true;
    await page.getByRole("button", { name: /^Gửi in/ }).click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent.includes("Gửi in") && !b.disabled,
      ),
    );
    assert.equal(state.jobs.size, 0);
    assert.equal(await page.locator(".print-retry").count(), 0);
    await page.getByRole("button", { name: "Tờ in 2", exact: true }).click();
    await page.getByRole("button", { name: /^Gửi in/ }).click();
    await page.locator(".print-confirmation").waitFor();
    assert.equal(state.jobs.size, 1);
    assert.notEqual(state.requests[0].requestKey, state.requests[1].requestKey);
    return {
      case: "definitive-rejection-allows-editing",
      errors: state.errors,
      unexpected: state.unexpected,
    };
  } finally {
    await context.close();
  }
}

try {
  const outcomes = await Promise.all([
    latePhotos(),
    storageLinks(),
    printPrefetch(),
    extraPrint(),
    printerCompletion(),
    printerCompletion("failed"),
    staleRefresh(),
    rejectedPrint(),
    lostPrintResponse(),
    lostPrintResponse({ reload: true }),
    lostPrintResponse({ accepted: false }),
    lostPrintResponse({ reload: true, hideLookup: true }),
    lostPrintResponse({ reload: true, exhaustQuota: true }),
  ]);
  assert.ok(outcomes.every((o) => !o.errors.length && !o.unexpected.length));
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        note: "Actual compiled frontend with changing local fixtures. No production data or physical printer.",
        outcomes,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(outcomes, null, 2));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
