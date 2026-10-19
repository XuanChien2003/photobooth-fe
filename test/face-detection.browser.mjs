// Run after `npm run build`. See face-detection.browser.md for public fixtures.
// This test uses Google's sample portrait/cat and blocks all external requests.
import { createServer } from "node:http";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "../../Photo_BE/node_modules/@playwright/test/index.mjs";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = resolve(project, ".cache/face-detection");
const mpRoot = resolve(project, "node_modules/@mediapipe/tasks-vision");
for (const filename of ["portrait.jpg", "cat.jpg"]) {
  try {
    await readFile(resolve(temp, filename));
  } catch {
    throw new Error(
      `Missing public fixture ${filename}. See test/face-detection.browser.md for download instructions.`,
    );
  }
}
const distAssets = await readdir(resolve(project, "dist/assets"));
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://127.0.0.1").pathname;
  let target;
  if (pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      "<!doctype html><title>Local face detection verification</title><body>Local face detection verification</body>",
    );
    return;
  }
  if (pathname === "/mp.mjs") target = resolve(mpRoot, "vision_bundle.mjs");
  if (
    /^\/wasm\/vision_wasm_(?:nosimd_|module_)?internal\.(?:js|wasm)$/.test(
      pathname,
    )
  )
    target = resolve(mpRoot, pathname.slice(1));
  if (pathname === "/model.task")
    target = resolve(project, "src/assets/models/face_landmarker.task");
  if (pathname === "/face-detection.js")
    target = resolve(project, "src/face-detection.js");
  if (pathname === "/skin-retouch.js")
    target = resolve(project, "src/skin-retouch.js");
  // beauty.js tách phần vẽ chỉnh da ra beauty-render.js (dùng chung với worker xử lý ảnh).
  if (pathname === "/beauty-render.js" || pathname === "/image-canvas.js")
    target = resolve(project, "src" + pathname);
  if (
    /^\/assets\/[A-Za-z0-9_.-]+$/.test(pathname) &&
    distAssets.includes(pathname.slice(8))
  )
    target = resolve(project, "dist", pathname.slice(1));
  if (pathname === "/beauty.js") {
    let source = await readFile(resolve(project, "src/beauty.js"), "utf8");
    for (const [identifier, filename, extension] of [
      ["wasmLoaderUrl", "vision_wasm_internal", ".js"],
      ["wasmBinaryUrl", "vision_wasm_internal", ".wasm"],
      ["noSimdLoaderUrl", "vision_wasm_nosimd_internal", ".js"],
      ["noSimdBinaryUrl", "vision_wasm_nosimd_internal", ".wasm"],
      ["modelUrl", "face_landmarker", ".task"],
    ]) {
      const filenameInBuild = distAssets.find(
        (name) => name.startsWith(`${filename}-`) && name.endsWith(extension),
      );
      source = source.replace(
        new RegExp(`import ${identifier} from \\"[^\\"]+\\";`),
        `const ${identifier} = ${JSON.stringify(`/assets/${filenameInBuild}`)};`,
      );
    }
    source = source.replace(
      'import("@mediapipe/tasks-vision")',
      'import("/mp.mjs")',
    );
    res.writeHead(200, { "Content-Type": "text/javascript" });
    res.end(source);
    return;
  }
  if (/^\/fixture\/(?:portrait|cat)\.jpg$/.test(pathname))
    target = resolve(temp, pathname.split("/").pop());
  if (!target) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const content = await readFile(target);
    const type = target.endsWith(".wasm")
      ? "application/wasm"
      : /\.(?:js|mjs)$/.test(target)
        ? "text/javascript"
        : target.endsWith(".jpg")
          ? "image/jpeg"
          : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  } catch (error) {
    res.writeHead(404);
    res.end(error.message);
  }
});
await new Promise((resolveListen) =>
  server.listen(0, "127.0.0.1", resolveListen),
);
const address = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  const errors = [];
  const externalRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(address)) return route.continue();
    externalRequests.push(route.request().url());
    return route.abort();
  });
  await page.goto(address);
  const baseline = await page.evaluate(async () => {
    const { FilesetResolver, FaceLandmarker } = await import("/mp.mjs");
    const files = await FilesetResolver.forVisionTasks("/wasm");
    const model = await FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: "/model.task", delegate: "CPU" },
      runningMode: "IMAGE",
      numFaces: 6,
    });
    const image = async (name) => {
      const img = new Image();
      img.src = `/fixture/${name}.jpg`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      return canvas;
    };
    const portrait = await image("portrait");
    const first = model.detect(portrait).faceLandmarks;
    if (!first.length)
      throw new Error(
        "Google portrait fixture failed baseline face detection.",
      );
    const f = first[0];
    const left = Math.min(...f.map((p) => p.x)) * portrait.width;
    const right = Math.max(...f.map((p) => p.x)) * portrait.width;
    const top = Math.min(...f.map((p) => p.y)) * portrait.height;
    const bottom = Math.max(...f.map((p) => p.y)) * portrait.height;
    const fw = right - left,
      fh = bottom - top;
    const crop = (margin) => {
      const cropped = document.createElement("canvas");
      cropped.width = 1920;
      cropped.height = 2560;
      const cropWidth = Math.max(
        fw * (1 + 2 * margin),
        (fh * (1 + 2 * margin) * 3) / 4,
      );
      const cropHeight = (cropWidth * 4) / 3;
      const x = (left + right - cropWidth) / 2,
        y = (top + bottom - cropHeight) / 2;
      cropped
        .getContext("2d")
        .drawImage(
          portrait,
          x,
          y,
          cropWidth,
          cropHeight,
          0,
          0,
          cropped.width,
          cropped.height,
        );
      return {
        canvas: cropped,
        expected: f.map((p) => ({
          x: ((p.x * portrait.width - x) / cropWidth) * cropped.width,
          y: ((p.y * portrait.height - y) / cropHeight) * cropped.height,
        })),
      };
    };
    const rotate = (canvas, angle) => {
      const output = document.createElement("canvas");
      output.width = angle % 180 ? canvas.height : canvas.width;
      output.height = angle % 180 ? canvas.width : canvas.height;
      const ctx = output.getContext("2d");
      ctx.translate(output.width / 2, output.height / 2);
      ctx.rotate((angle * Math.PI) / 180);
      ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
      return output;
    };
    const normalClose = crop(0.12),
      tightClose = crop(0.02);
    const rotatePoints = (points, canvas, angle) => {
      if (angle === 90)
        return points.map((p) => ({ x: canvas.height - p.y, y: p.x }));
      if (angle === 180)
        return points.map((p) => ({
          x: canvas.width - p.x,
          y: canvas.height - p.y,
        }));
      throw new Error("Unsupported fixture rotation.");
    };
    const black = document.createElement("canvas");
    black.width = 1024;
    black.height = 1024;
    black.getContext("2d").fillRect(0, 0, 1024, 1024);
    const inputs = new Map([
      ["portrait", { canvas: portrait }],
      ["close-up-1920x2560", normalClose],
      ["tight-close-up-1920x2560", tightClose],
      [
        "sideways-close-up-90",
        {
          canvas: rotate(normalClose.canvas, 90),
          expected: rotatePoints(normalClose.expected, normalClose.canvas, 90),
        },
      ],
      [
        "upside-down-close-up-180",
        {
          canvas: rotate(normalClose.canvas, 180),
          expected: rotatePoints(normalClose.expected, normalClose.canvas, 180),
        },
      ],
      ["cat-no-human-face", { canvas: await image("cat") }],
      ["blank-no-face", { canvas: black }],
    ]);
    const counts = [];
    for (const [name, { canvas }] of inputs) {
      const started = performance.now();
      const result = model.detect(canvas).faceLandmarks;
      counts.push({
        name,
        width: canvas.width,
        height: canvas.height,
        count: result.length,
        points: result[0]?.length || 0,
        ms: Math.round(performance.now() - started),
      });
    }
    window.faceSmoke = { model, inputs };
    return counts;
  });
  console.log(JSON.stringify({ baseline }, null, 2));
  await writeFile(
    resolve(temp, "baseline-results.json"),
    JSON.stringify({ baseline, errors }, null, 2),
  );
  {
    const improved = await page.evaluate(async (confidence) => {
      const { detectFaceLandmarks } = await import("/face-detection.js");
      const { model, inputs } = window.faceSmoke;
      await model.setOptions({
        minFaceDetectionConfidence: confidence,
        minFacePresenceConfidence: 0.5,
      });
      const rows = [];
      for (const [name, { canvas, expected }] of inputs) {
        const started = performance.now();
        const faces = await detectFaceLandmarks(canvas, model);
        const finite = faces.every((face) =>
          face.every(
            (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
          ),
        );
        const face = faces[0];
        const geometry = face
          ? {
              width: Math.hypot(
                face[454].x - face[234].x,
                face[454].y - face[234].y,
              ),
              eyeDistance: Math.hypot(
                face[33].x - face[263].x,
                face[33].y - face[263].y,
              ),
              chinX: face[152].x,
              chinY: face[152].y,
            }
          : null;
        const anchors = [10, 33, 263, 1, 152, 234, 454];
        const maxAnchorError =
          expected && face
            ? Math.max(
                ...anchors.map((index) =>
                  Math.hypot(
                    face[index].x - expected[index].x,
                    face[index].y - expected[index].y,
                  ),
                ),
              )
            : null;
        rows.push({
          name,
          count: faces.length,
          points: face?.length || 0,
          finite,
          geometry,
          maxAnchorError,
          ms: Math.round(performance.now() - started),
        });
      }
      model.close();
      return rows;
    }, 0.5);
    console.log(
      JSON.stringify({ improved, errors, externalRequests }, null, 2),
    );
    await writeFile(
      resolve(temp, "smoke-results.json"),
      JSON.stringify({ baseline, improved, errors, externalRequests }, null, 2),
    );
    assert.equal(errors.length, 0, "no uncaught browser errors");
    for (const row of improved) {
      assert(row.finite, `${row.name}: finite coordinates`);
      if (row.name.includes("no-face") || row.name.includes("no-human-face"))
        assert.equal(row.count, 0, `${row.name}: no false human faces`);
      else {
        assert.equal(row.count, 1, `${row.name}: detect the one face`);
        assert.equal(row.points, 478, `${row.name}: 478 points`);
        assert(
          row.geometry.width > 0 && row.geometry.eyeDistance > 0,
          `${row.name}: nondegenerate face geometry`,
        );
        if (row.maxAnchorError != null)
          assert(
            row.maxAnchorError < 1920 * 0.13,
            `${row.name}: preserve original-source coordinate mapping`,
          );
      }
    }
    console.log(
      "PASS: real local MediaPipe portrait, close-up, orientation, coordinate, and no-face checks.",
    );
  }
  {
    const loader = await page.evaluate(async () => {
      const { loadFaceLandmarker, detectFaces, applyBeauty } =
        await import("/beauty.js");
      const first = loadFaceLandmarker(),
        second = loadFaceLandmarker();
      const samePendingPromise = first === second;
      const model = await first;
      const source = window.faceSmoke.inputs.get("close-up-1920x2560").canvas;
      const face = await detectFaces(source);
      const originalPixels = source
        .getContext("2d")
        .getImageData(0, 0, source.width, source.height).data;
      const variants = {
        neutral: applyBeauty(source, face, {}),
        blush: applyBeauty(source, face, { blush: 70 }),
        slim: applyBeauty(source, face, { slim: 70 }),
        both: applyBeauty(source, face, { slim: 70, blush: 70 }),
        whiten: applyBeauty(source, face, { whiten: 70 }),
        smooth: applyBeauty(source, face, { smooth: 70 }),
        skin: applyBeauty(source, face, { whiten: 70, smooth: 70 }),
      };
      const fw = Math.hypot(
        face[0][454].x - face[0][234].x,
        face[0][454].y - face[0][234].y,
      );
      const cheeks = [50, 280].map((index) => face[0][index]);
      const jaw = [172, 397, 136, 365, 150, 379].map((index) => face[0][index]);
      const statistics = (canvas, landmarks, radius) => {
        const pixels = canvas
          .getContext("2d")
          .getImageData(0, 0, source.width, source.height).data;
        let samples = 0,
          changed = 0,
          difference = 0,
          colorChange = 0;
        const x0 = Math.max(
          0,
          Math.floor(Math.min(...landmarks.map((p) => p.x)) - radius),
        );
        const x1 = Math.min(
          source.width - 1,
          Math.ceil(Math.max(...landmarks.map((p) => p.x)) + radius),
        );
        const y0 = Math.max(
          0,
          Math.floor(Math.min(...landmarks.map((p) => p.y)) - radius),
        );
        const y1 = Math.min(
          source.height - 1,
          Math.ceil(Math.max(...landmarks.map((p) => p.y)) + radius),
        );
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++) {
            if (
              !landmarks.some(
                (point) =>
                  (point.x - x) ** 2 + (point.y - y) ** 2 <= radius ** 2,
              )
            )
              continue;
            const offset = (y * source.width + x) * 4;
            const delta =
              Math.abs(pixels[offset] - originalPixels[offset]) +
              Math.abs(pixels[offset + 1] - originalPixels[offset + 1]) +
              Math.abs(pixels[offset + 2] - originalPixels[offset + 2]);
            samples++;
            difference += delta;
            colorChange +=
              pixels[offset] -
              pixels[offset + 1] -
              (originalPixels[offset] - originalPixels[offset + 1]);
            if (delta) changed++;
          }
        return {
          samples,
          changed,
          meanDifference: difference / samples,
          meanRedMinusGreenChange: colorChange / samples,
        };
      };
      const countChanges = (canvas) => {
        const pixels = canvas
          .getContext("2d")
          .getImageData(0, 0, source.width, source.height).data;
        let changed = 0;
        for (let offset = 0; offset < pixels.length; offset += 4)
          if (
            pixels[offset] !== originalPixels[offset] ||
            pixels[offset + 1] !== originalPixels[offset + 1] ||
            pixels[offset + 2] !== originalPixels[offset + 2] ||
            pixels[offset + 3] !== originalPixels[offset + 3]
          )
            changed++;
        return changed;
      };
      const background = [{ x: 40, y: 40 }];
      const effects = {
        neutralChanged: countChanges(variants.neutral),
        blushCheeks: statistics(variants.blush, cheeks, fw * 0.11),
        blushJaw: statistics(variants.blush, jaw, fw * 0.1),
        blushBackground: statistics(variants.blush, background, 25),
        slimJaw: statistics(variants.slim, jaw, fw * 0.14),
        slimBackground: statistics(variants.slim, background, 25),
        combinedChanged: countChanges(variants.both),
        whiteningCheeks: statistics(variants.whiten, cheeks, fw * 0.08),
        whiteningBackground: statistics(variants.whiten, background, 25),
        smoothingCheeks: statistics(variants.smooth, cheeks, fw * 0.08),
        smoothingBackground: statistics(variants.smooth, background, 25),
        allDimensionsPreserved: Object.values(variants).every(
          (canvas) =>
            canvas.width === source.width && canvas.height === source.height,
        ),
      };
      // Encode source coordinates as colors so the rendered pixels independently
      // reveal the warp displacement, without inspecting implementation details.
      const coordinateCanvas = document.createElement("canvas");
      coordinateCanvas.width = source.width;
      coordinateCanvas.height = source.height;
      const coordinateContext = coordinateCanvas.getContext("2d");
      const coordinatePixels = coordinateContext.createImageData(
        source.width,
        source.height,
      );
      for (let y = 0; y < source.height; y++)
        for (let x = 0; x < source.width; x++) {
          const offset = (y * source.width + x) * 4;
          coordinatePixels.data[offset] = Math.round(
            (x / (source.width - 1)) * 255,
          );
          coordinatePixels.data[offset + 1] = Math.round(
            (y / (source.height - 1)) * 255,
          );
          coordinatePixels.data[offset + 2] = 128;
          coordinatePixels.data[offset + 3] = 255;
        }
      coordinateContext.putImageData(coordinatePixels, 0, 0);
      const warpedCoordinates = applyBeauty(coordinateCanvas, face, {
        slim: 70,
      });
      const warpPixels = warpedCoordinates
        .getContext("2d")
        .getImageData(0, 0, source.width, source.height).data;
      const displacementAt = (x, y) => {
        const offset = (y * source.width + x) * 4;
        return {
          x: (warpPixels[offset] / 255) * (source.width - 1) - x,
          y: (warpPixels[offset + 1] / 255) * (source.height - 1) - y,
        };
      };
      let maxDisplacement = 0;
      for (let y = 0; y < source.height; y += 8)
        for (let x = 0; x < source.width; x += 8) {
          const delta = displacementAt(x, y);
          maxDisplacement = Math.max(
            maxDisplacement,
            Math.hypot(delta.x, delta.y),
          );
        }
      effects.warp = {
        maxDisplacement,
        allowedDisplacement:
          fw * 0.055 + Math.hypot(source.width - 1, source.height - 1) / 255,
        leftJaw: displacementAt(
          Math.round(face[0][136].x),
          Math.round(face[0][136].y),
        ),
        rightJaw: displacementAt(
          Math.round(face[0][365].x),
          Math.round(face[0][365].y),
        ),
      };
      coordinateCanvas.width = coordinateCanvas.height = 1;
      warpedCoordinates.width = warpedCoordinates.height = 1;
      const comparison = document.createElement("canvas");
      comparison.width = 4 * 384;
      comparison.height = 50 + 512 + 34;
      const context = comparison.getContext("2d");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, comparison.width, comparison.height);
      context.fillStyle = "#253c30";
      context.font = "20px Arial";
      context.fillText(
        "Ảnh mẫu công khai MediaPipe • kiểm tra hiệu ứng",
        20,
        32,
      );
      for (const [index, [label, image]] of [
        ["Gốc", source],
        ["Má hồng 70", variants.blush],
        ["Thon mặt 70", variants.slim],
        ["Cả hai 70", variants.both],
      ].entries()) {
        context.drawImage(image, index * 384, 50, 384, 512);
        context.fillText(label, index * 384 + 16, 50 + 512 + 24);
      }
      const skinComparison = document.createElement("canvas");
      skinComparison.width = 4 * 384;
      skinComparison.height = comparison.height;
      const skinContext = skinComparison.getContext("2d");
      skinContext.fillStyle = "#fbf9f5";
      skinContext.fillRect(0, 0, skinComparison.width, skinComparison.height);
      skinContext.fillStyle = "#4b332a";
      skinContext.font = "20px Arial";
      skinContext.fillText(
        "Ảnh mẫu công khai • trắng da và mịn da tự nhiên",
        20,
        32,
      );
      for (const [index, [label, image]] of [
        ["Gốc", source],
        ["Trắng da 70", variants.whiten],
        ["Mịn da 70", variants.smooth],
        ["Cả hai 70", variants.skin],
      ].entries()) {
        skinContext.drawImage(image, index * 384, 50, 384, 512);
        skinContext.fillText(label, index * 384 + 16, 50 + 512 + 24);
      }
      const result = {
        samePendingPromise,
        count: face.length,
        points: face[0]?.length,
        localAssets: true,
        effects,
        comparisonPng: comparison.toDataURL("image/png").split(",")[1],
        skinComparisonPng: skinComparison.toDataURL("image/png").split(",")[1],
      };
      model.close();
      return result;
    });
    const comparisonPng = loader.comparisonPng;
    const skinComparisonPng = loader.skinComparisonPng;
    delete loader.comparisonPng;
    delete loader.skinComparisonPng;
    await writeFile(
      resolve(temp, "beauty-effects-comparison.png"),
      Buffer.from(comparisonPng, "base64"),
    );
    await writeFile(
      resolve(temp, "skin-effects-comparison.png"),
      Buffer.from(skinComparisonPng, "base64"),
    );
    console.log(JSON.stringify({ loader, externalRequests }, null, 2));
    assert(
      loader.samePendingPromise,
      "production loader deduplicates pending model initialization",
    );
    assert.equal(
      loader.count,
      1,
      "production loader and detectFaces recognize real close-up",
    );
    assert.equal(
      loader.points,
      478,
      "production face detection returns478 landmarks",
    );
    assert.equal(
      loader.effects.neutralChanged,
      0,
      "neutral settings preserve every pixel",
    );
    assert(
      loader.effects.blushCheeks.changed > 1000,
      "blush changes real mapped cheek pixels",
    );
    assert(
      loader.effects.blushCheeks.meanRedMinusGreenChange > 3,
      "blush visibly increases cheek redness",
    );
    assert.equal(
      loader.effects.blushJaw.changed,
      0,
      "blush stays away from the jaw",
    );
    assert.equal(
      loader.effects.blushBackground.changed,
      0,
      "blush preserves distant background",
    );
    assert(
      loader.effects.slimJaw.changed > 1000 &&
        loader.effects.slimJaw.meanDifference > 0.5,
      "slimming changes actual jaw pixels",
    );
    assert(
      loader.effects.warp.maxDisplacement <=
        loader.effects.warp.allowedDisplacement,
      "slimming bounds actual pixel displacement rather than accumulating large deformations",
    );
    assert(
      loader.effects.warp.leftJaw.x < 0 && loader.effects.warp.rightJaw.x > 0,
      "jaw sampling moves both face edges inward",
    );
    assert.equal(
      loader.effects.slimBackground.changed,
      0,
      "slimming preserves distant background",
    );
    assert(
      loader.effects.combinedChanged > 1000,
      "slimming and blush work together",
    );
    assert(
      loader.effects.whiteningCheeks.changed > 1000 &&
        loader.effects.whiteningCheeks.meanDifference > 3 &&
        loader.effects.whiteningCheeks.meanDifference < 60,
      "whitening gently lifts actual detected skin",
    );
    assert(
      loader.effects.smoothingCheeks.changed > 1000,
      "smoothing affects actual detected skin",
    );
    assert.equal(loader.effects.whiteningBackground.changed, 0);
    assert.equal(loader.effects.smoothingBackground.changed, 0);
    assert(
      loader.effects.allDimensionsPreserved,
      "beauty edits preserve full-resolution dimensions",
    );
    assert.equal(
      externalRequests.filter(
        (url) => !url.startsWith("https://odml.pa.googleapis.com/v1/log"),
      ).length,
      0,
      "zero CDN/model asset requests",
    );
    let modelRequests = 0;
    await page.route("**/assets/face_landmarker-*.task", async (route) => {
      modelRequests++;
      if (modelRequests === 1)
        return route.fulfill({ status: 503, body: "Fixture model failure" });
      return route.fallback();
    });
    const retry = await page.evaluate(async () => {
      const { loadFaceLandmarker } = await import("/beauty.js?retry");
      let code;
      try {
        await loadFaceLandmarker();
      } catch (error) {
        code = error.code;
      }
      const model = await loadFaceLandmarker();
      const count = model.detect(window.faceSmoke.inputs.get("portrait").canvas)
        .faceLandmarks.length;
      model.close();
      return { code, count };
    });
    assert.equal(
      retry.code,
      "FACE_DETECTION_UNAVAILABLE",
      "a failed model download has a recoverable error",
    );
    assert.equal(
      retry.count,
      1,
      "retry after a temporary model failure really initializes/detects",
    );
    assert.equal(modelRequests, 2, "retry requests the failed model again");
    await writeFile(
      resolve(temp, "loader-results.json"),
      JSON.stringify(
        { loader, retry, modelRequests, externalRequests },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ retry, modelRequests }, null, 2));
    console.log(
      "PASS: production loader uses emitted local WASM/model assets and retries after a temporary download failure.",
    );
  }
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
