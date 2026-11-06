// Real-browser before/after benchmark. No production files or git state are changed.
// node scripts/bench-timelapse.mjs --prepare-only
// node scripts/bench-timelapse.mjs --runs 5 --scenario fullhd
// node scripts/bench-timelapse.mjs --runs 5 --scenario all
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const runs = Number(option("--runs", "5"));
const chosen = option("--scenario", "fullhd");
if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error("--runs must be 1–20");
if (!["fullhd", "webcam", "all"].includes(chosen)) throw new Error("--scenario must be fullhd, webcam or all");
const scenarios = [
  { name: "fullhd", width: 1920, height: 1080, light: false, sourceBitrate: 16_000_000 },
  { name: "webcam", width: 1280, height: 720, light: true, sourceBitrate: 5_000_000 },
].filter((scenario) => chosen === "all" || chosen === scenario.name);
const fixtureDir = resolve(root, ".cache/bench-timelapse-fixtures");
const resultPath = resolve(root, option("--output", ".cache/bench-timelapse-results.json"));
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const git = (...gitArgs) => execFileSync("git", gitArgs, { cwd: root, encoding: "utf8" }).trimEnd();
const oldSource = git("show", "HEAD:src/kiosk/clip-recorder.js");
const newSource = await readFile(join(root, "src/kiosk/clip-recorder.js"), "utf8");
const layoutSource = await readFile(join(root, "src/kiosk/live-preview-layout.js"), "utf8");
const routes = new Map([
  ["/old/clip-recorder.js", { body: oldSource, type: "text/javascript" }],
  ["/new/clip-recorder.js", { body: newSource, type: "text/javascript" }],
  ...["old", "new"].map((variant) => [`/${variant}/live-preview-layout.js`, { body: layoutSource, type: "text/javascript" }]),
]);
await mkdir(fixtureDir, { recursive: true });
const server = createServer((request, response) => {
  const route = routes.get(request.url);
  response.setHeader("Cache-Control", "no-store");
  if (route) { response.setHeader("Content-Type", route.type); response.end(route.body); }
  else if (request.url === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end("<!doctype html><title>Timelapse benchmark</title>");
  } else { response.statusCode = 404; response.end(); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const fixtures = [];
  for (const scenario of scenarios) {
    const manifestPath = join(fixtureDir, `${scenario.name}.json`);
    let fixture;
    try {
      fixture = JSON.parse(await readFile(manifestPath, "utf8"));
      if (fixture.version !== 1) fixture = null;
      else {
        for (const clip of fixture.clips) {
          const bytes = await readFile(join(fixtureDir, clip.file));
          if (sha256(bytes) !== clip.sha256) throw new Error("fixture changed");
        }
      }
    } catch { fixture = null; }
    if (!fixture) {
      console.log(`Preparing ${scenario.name}: four fixed 2-second camera-like clips…`);
      const recorded = await page.evaluate(async (settings) => {
        const type = ["video/mp4;codecs=avc1.640028", "video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm"]
          .find((value) => MediaRecorder.isTypeSupported(value));
        const canvas = document.createElement("canvas");
        canvas.width = settings.width; canvas.height = settings.height;
        const ctx = canvas.getContext("2d");
        const clips = [];
        for (let segment = 0; segment < 4; segment++) {
          const stream = canvas.captureStream(30);
          const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: settings.sourceBitrate });
          const chunks = [];
          recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
          const finished = new Promise((done) => { recorder.onstop = done; });
          const began = performance.now();
          recorder.start();
          // The scene varies by frame number, not random input; bytes are recorded
          // once, saved and reused unchanged for every old/new run.
          for (let frame = 0; frame < 60; frame++) {
            ctx.fillStyle = `hsl(${segment * 60} 22% 75%)`;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            for (let y = 0; y < 8; y++) for (let x = 0; x < 14; x++) {
              ctx.fillStyle = (x + y) % 2 ? "#f7f4ef" : "#2b3a48";
              ctx.fillRect(x * canvas.width / 14, y * canvas.height / 8, canvas.width / 28, canvas.height / 16);
            }
            ctx.fillStyle = "#e94835";
            ctx.beginPath();
            ctx.arc((0.15 + frame / 90) * canvas.width, canvas.height / 2, canvas.height / 5, 0, 2 * Math.PI);
            ctx.fill();
            ctx.fillStyle = "#fff"; ctx.font = `${Math.floor(canvas.height / 15)}px sans-serif`;
            ctx.fillText(`Photobooth / segment ${segment + 1} / frame ${frame}`, 40, canvas.height - 60);
            const delay = began + (frame + 1) * 1000 / 30 - performance.now();
            if (delay > 0) await new Promise((done) => setTimeout(done, delay));
          }
          recorder.stop(); await finished;
          stream.getTracks().forEach((track) => track.stop());
          const blob = new Blob(chunks, { type: recorder.mimeType });
          const dataUrl = await new Promise((done, fail) => {
            const reader = new FileReader(); reader.onload = () => done(reader.result);
            reader.onerror = fail; reader.readAsDataURL(blob);
          });
          clips.push({ base64: dataUrl.split(",")[1], type: blob.type, ms: performance.now() - began });
        }
        return clips;
      }, scenario);
      fixture = { version: 1, scenario, clips: [] };
      for (let index = 0; index < recorded.length; index++) {
        const item = recorded[index];
        const bytes = Buffer.from(item.base64, "base64");
        const file = `${scenario.name}-${index}.bin`;
        await writeFile(join(fixtureDir, file), bytes);
        fixture.clips.push({ file, type: item.type, ms: item.ms, bytes: bytes.length, sha256: sha256(bytes) });
      }
      await writeFile(manifestPath, JSON.stringify(fixture, null, 2) + "\n");
    }
    fixtures.push(fixture);
    for (const clip of fixture.clips) routes.set(`/fixtures/${clip.file}`, {
      body: await readFile(join(fixtureDir, clip.file)), type: clip.type,
    });
  }
  if (args.includes("--prepare-only")) {
    console.log(`Fixtures ready at ${fixtureDir}. No timed benchmarks ran.`);
  } else {
    const result = {
      measuredAt: new Date().toISOString(), baselineCommit: git("rev-parse", "HEAD"),
      sourceSha256: { old: sha256(oldSource), new: sha256(newSource) },
      environment: { browser: browser.version(), node: process.version, platform: process.platform,
        architecture: process.arch, os: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length },
      method: "Native Chromium HTML video decode/canvas/MediaRecorder. Fixed local clips, x4 speed, mirrored, default crop; one warmup per variant; alternating paired order. Timings exclude fixtures, metadata inspection and uploads. No timing mocks.",
      scenarios: [],
    };
    const median = (values) => {
      const sorted = values.toSorted((a, b) => a - b), center = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[center] : (sorted[center - 1] + sorted[center]) / 2;
    };
    for (const fixture of fixtures) {
      await page.evaluate(async (input) => {
        window.benchModules = {
          old: await import("/old/clip-recorder.js"), new: await import("/new/clip-recorder.js"),
        };
        window.benchClips = await Promise.all(input.clips.map(async (clip) => {
          const bytes = await (await fetch(`/fixtures/${clip.file}`)).arrayBuffer();
          const group = [new Blob([bytes], { type: clip.type })];
          group.ms = clip.ms;
          return group;
        }));
      }, fixture);
      const run = async (variant) => page.evaluate(async ({ variant, light }) => {
        const NativeRecorder = window.MediaRecorder;
        const nativeCapture = HTMLCanvasElement.prototype.captureStream;
        const nativeCreate = document.createElement;
        const configured = {};
        let loadedVideoElements = 0;
        window.MediaRecorder = class extends NativeRecorder {
          constructor(stream, options) {
            super(stream, options);
            Object.assign(configured, { requestedBitrate: options.videoBitsPerSecond,
              recorderBitrate: this.videoBitsPerSecond, recorderType: this.mimeType });
          }
        };
        HTMLCanvasElement.prototype.captureStream = function (fps) {
          Object.assign(configured, { width: this.width, height: this.height, fps });
          return nativeCapture.call(this, fps);
        };
        document.createElement = function (name, ...rest) {
          if (name.toLowerCase() === "video") loadedVideoElements++;
          return nativeCreate.call(this, name, ...rest);
        };
        let blob, elapsedMs;
        try {
          const began = performance.now();
          blob = await window.benchModules[variant].buildTimelapse(window.benchClips, { light });
          elapsedMs = performance.now() - began;
        } finally {
          window.MediaRecorder = NativeRecorder;
          HTMLCanvasElement.prototype.captureStream = nativeCapture;
          document.createElement = nativeCreate;
        }
        if (!blob) throw new Error(`${variant} returned no video`);
        const url = URL.createObjectURL(blob), video = document.createElement("video");
        video.preload = "metadata";
        try {
          await new Promise((done, fail) => {
            video.onloadedmetadata = done; video.onerror = () => fail(new Error("Output metadata failed"));
            video.src = url;
          });
          if (!Number.isFinite(video.duration)) {
            // Some MediaRecorder WebM files only expose duration after an end seek.
            await new Promise((done) => {
              let timer;
              const finish = () => {
                clearTimeout(timer); video.onseeked = video.ondurationchange = null; done();
              };
              video.onseeked = video.ondurationchange = () => {
                if (Number.isFinite(video.duration)) finish();
              };
              timer = setTimeout(finish, 1000);
              video.currentTime = 1e9;
            });
          }
          // Native canvas recording has only a video track. Count actual encoded
          // MP4 samples from trun/stsz, not rendered frames (which may be dropped).
          // ISO BMFF sample_count layout: https://datatracker.ietf.org/doc/html/draft-einarsson-moq-locmaf-01#section-15.6
          const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer);
          let fragments = 0, tableSamples = 0, valid = true, isMp4 = false;
          const handlers = [];
          const fourcc = (offset) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
          const boxes = (start, end) => {
            for (let offset = start; offset + 8 <= end;) {
              let size = view.getUint32(offset), header = 8;
              const type = fourcc(offset + 4);
              if (size === 1) { size = Number(view.getBigUint64(offset + 8)); header = 16; }
              else if (!size) size = end - offset;
              if (size < header || offset + size > end) { valid = false; return; }
              const payload = offset + header;
              if (type === "ftyp") isMp4 = true;
              if (type === "hdlr" && size >= header + 12) handlers.push(fourcc(payload + 8));
              if (type === "trun" && size >= header + 8) fragments += view.getUint32(payload + 4);
              if (type === "stsz" && size >= header + 12) tableSamples += view.getUint32(payload + 8);
              if (["moov", "trak", "mdia", "minf", "stbl", "moof", "traf"].includes(type)) boxes(payload, offset + size);
              offset += size;
            }
          };
          if (blob.type.startsWith("video/mp4")) boxes(0, bytes.length);
          const frameCount = isMp4 && valid && handlers.length === 1 && handlers[0] === "vide"
            ? fragments || tableSamples || null : null;
          const metadata = { width: video.videoWidth, height: video.videoHeight,
            durationSeconds: Number.isFinite(video.duration) ? video.duration : null, type: blob.type,
            encodedFrameCount: frameCount,
            frameCountMethod: frameCount === null ? null : "single-video-track MP4 trun/stsz sample_count",
            encodedFramesPerSecond: frameCount !== null && Number.isFinite(video.duration) && video.duration > 0
              ? frameCount / video.duration : null };
          return { variant, elapsedMs, bytes: blob.size, configured, loadedVideoElements, metadata,
            timingMinusEncodedDurationMs: metadata.durationSeconds === null ? null : elapsedMs - metadata.durationSeconds * 1000 };
        } finally {
          video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url);
        }
      }, { variant, light: fixture.scenario.light });
      console.log(`Warming ${fixture.scenario.name}: old + new…`);
      const warmups = [await run("old"), await run("new")];
      const measurements = [];
      for (let pair = 0; pair < runs; pair++) {
        for (const variant of pair % 2 ? ["new", "old"] : ["old", "new"]) {
          const measurement = { pair: pair + 1, ...await run(variant) };
          measurements.push(measurement);
          console.log(`${fixture.scenario.name} pair ${pair + 1} ${variant}: ${measurement.elapsedMs.toFixed(1)} ms, ${measurement.bytes} bytes`);
        }
      }
      const old = median(measurements.filter((row) => row.variant === "old").map((row) => row.elapsedMs));
      const current = median(measurements.filter((row) => row.variant === "new").map((row) => row.elapsedMs));
      const summary = { oldMedianMs: old, newMedianMs: current, medianReductionPercent: (old - current) / old * 100,
        oldMedianBytes: median(measurements.filter((row) => row.variant === "old").map((row) => row.bytes)),
        newMedianBytes: median(measurements.filter((row) => row.variant === "new").map((row) => row.bytes)) };
      for (const variant of ["old", "new"]) {
        const rows = measurements.filter((row) => row.variant === variant);
        for (const key of ["durationSeconds", "encodedFrameCount", "encodedFramesPerSecond"]) {
          const values = rows.map((row) => row.metadata[key]).filter((value) => value !== null);
          summary[`${variant}Median_${key}`] = values.length ? median(values) : null;
        }
      }
      summary.temporalCaveat = "Native realtime recording varies in encoded duration/frame count. A wall-time gain alone does not establish equal temporal or perceptual quality; compare the raw metadata alongside timings.";
      result.scenarios.push({ fixture, warmups, measurements, summary });
      console.log(`${fixture.scenario.name} median: ${old.toFixed(1)} → ${current.toFixed(1)} ms (${summary.medianReductionPercent.toFixed(1)}% reduction)`);
    }
    await mkdir(dirname(resultPath), { recursive: true });
    await writeFile(resultPath, JSON.stringify(result, null, 2) + "\n");
    console.log(`Raw results: ${resultPath}`);
  }
  await context.close();
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
