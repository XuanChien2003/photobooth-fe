import { visibleRegion } from "./live-preview-layout.js";

// Video tua nhanh: trong lúc chụp, hình trực tiếp HDMI được quay liên tục thành từng đoạn ngắn
// (bắt đầu đoạn mới mỗi SEGMENT_MS, giữ đoạn liền trước). Mỗi lần có ảnh, đoạn quanh lúc chụp
// thành một clip — một tấm ảnh, một clip. Chụp xong, các clip được ghép, tua nhanh, lật gương
// thành một video gửi lên album.
const SEGMENT_MS = 8000;
const MIN_CLIP_MS = 4000;
// H.264 trước (máy tính mã hóa bằng phần cứng: nhẹ máy, nét hơn VP8 cùng bitrate), rồi VP9 / VP8.
const RECORD_TYPES = [
  "video/mp4;codecs=avc1.640028",
  "video/mp4;codecs=avc1",
  "video/webm;codecs=h264",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];
// Chế độ nhẹ (thử máy bằng webcam máy tính): VP8 mã hóa bằng phần mềm thay cho H.264 phần cứng —
// webcam laptop + H.264 phần cứng đã làm sập tab Chrome (STATUS_BREAKPOINT) — và bitrate thấp hơn.
const LIGHT_TYPES = ["video/webm;codecs=vp8", "video/webm;codecs=vp9", "video/webm"];
// Video gửi lên album tối đa 60 MB: chừa khoảng an toàn.
const MAX_VIDEO_BYTES = 48 * 1024 * 1024;

const pickType = (types) =>
  typeof MediaRecorder !== "undefined"
    ? types.find((type) => MediaRecorder.isTypeSupported(type)) || ""
    : "";

export function createClipRecorder() {
  let recorder = null, stream = null, startedAt = 0, previous = null, restart = null, light = false;
  let chunks = [];
  const clips = [];
  const stopCurrent = () =>
    new Promise((resolve) => {
      const current = recorder;
      if (!current || current.state === "inactive") return resolve(null);
      const parts = chunks;
      const began = startedAt;
      current.onstop = () =>
        resolve(parts.length ? { blob: new Blob(parts, { type: current.mimeType }), ms: Date.now() - began } : null);
      try {
        current.stop();
      } catch {
        resolve(null);
      }
    });
  const begin = () => {
    clearTimeout(restart);
    if (!stream?.active) return;
    try {
      chunks = [];
      const type = pickType(light ? LIGHT_TYPES : RECORD_TYPES);
      // Bản quay gốc 1080p bitrate cao: video tua nhanh ghép từ đây nên càng nét càng tốt.
      recorder = new MediaRecorder(stream, {
        ...(type && { mimeType: type }),
        videoBitsPerSecond: light ? 3_000_000 : 12_000_000,
      });
      const own = chunks;
      recorder.ondataavailable = (event) => event.data.size && own.push(event.data);
      recorder.start(1000);
      startedAt = Date.now();
      restart = setTimeout(async () => {
        previous = await stopCurrent();
        begin();
      }, SEGMENT_MS);
    } catch {
      recorder = null;
    }
  };
  return {
    // Bắt đầu quay từ luồng hình trực tiếp (không có hình HDMI thì bỏ qua video).
    // options.light: chế độ nhẹ cho webcam máy tính (VP8 phần mềm, bitrate thấp).
    start(liveStream, options = {}) {
      if (!liveStream || typeof MediaRecorder === "undefined" || recorder) return;
      stream = liveStream;
      light = Boolean(options.light);
      begin();
    },
    // Vừa có ảnh: chốt clip của tấm đó (đoạn đang quay, kèm đoạn trước nếu đoạn này quá ngắn).
    async cut() {
      if (!recorder) return;
      clearTimeout(restart);
      const current = await stopCurrent();
      const used = [current?.ms < MIN_CLIP_MS && previous, current].filter(Boolean);
      const parts = used.map((c) => c.blob);
      // Thời lượng clip: video ghép chọn bitrate vừa giới hạn tải lên.
      parts.ms = used.reduce((sum, c) => sum + (c.ms || 0), 0);
      if (parts.length) clips.push(parts);
      previous = null;
      begin();
    },
    async stop() {
      clearTimeout(restart);
      await stopCurrent();
      recorder = null;
      stream = null;
      return clips.slice();
    },
    count: () => clips.length,
  };
}

// Ghép các clip thành một video tua nhanh (mặc định ×4), Full HD 16:9, lật gương như màn hình xem
// trước và cắt bỏ mép có thông số máy ảnh. Chạy trong lúc khách chọn ảnh: mất khoảng ¼ thời lượng
// các clip. Bitrate cao nhất (8 Mbps) mà video vẫn dưới giới hạn tải lên.
export async function buildTimelapse(clips, { zoom = 0, speed = 4, width = 1920, height = 1080, mirror = true, light = false } = {}) {
  // Chế độ nhẹ (webcam máy tính): 1280 × 720, WebM VP8 (mã hóa phần mềm), bitrate tối đa 4 Mbps.
  if (light) [width, height] = [1280, 720];
  const segments = clips.flat();
  if (!segments.length || typeof MediaRecorder === "undefined") return null;
  const seconds = Math.max(1, clips.reduce((sum, clip) => sum + (clip.ms || SEGMENT_MS), 0) / 1000 / speed);
  const bitrate = Math.round(Math.max(light ? 1_500_000 : 2_000_000,
    Math.min(light ? 4_000_000 : 8_000_000, (MAX_VIDEO_BYTES * 8) / seconds)));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  // MP4 (H.264) trước: điện thoại nào cũng xem / lưu được (chế độ nhẹ: WebM VP8).
  const type = pickType(light ? LIGHT_TYPES : [
    "video/mp4;codecs=avc1.640028",
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ]);
  const output = canvas.captureStream(30);
  const recorder = new MediaRecorder(output, { ...(type && { mimeType: type }), videoBitsPerSecond: bitrate });
  const chunks = [];
  recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
  const finished = new Promise((resolve) => (recorder.onstop = resolve));
  recorder.start(1000);
  recorder.pause();
  const region = visibleRegion(zoom);
  const draw = (video) => {
    const sw = video.videoWidth * region.w, sh = video.videoHeight * region.h;
    if (!sw || !sh) return;
    // Phủ kín khung ra (cắt bớt hai bên nếu cần), lật ngang như gương.
    const scale = Math.max(width / sw, height / sh);
    const dw = sw * scale, dh = sh * scale;
    ctx.save();
    if (mirror) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, video.videoWidth * region.x, video.videoHeight * region.y, sw, sh,
      (width - dw) / 2, (height - dh) / 2, dw, dh);
    ctx.restore();
  };
  for (const blob of segments) {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    try {
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = () => reject(new Error("clip"));
        setTimeout(resolve, 4000);
      });
      video.playbackRate = speed;
      await video.play();
      recorder.resume();
      await new Promise((resolve) => {
        let stopped = false;
        const done = () => {
          if (stopped) return;
          stopped = true;
          resolve();
        };
        video.onended = done;
        // Clip lỗi / không phát hết: không để video bị treo.
        setTimeout(done, 20000);
        const frame = () => {
          if (stopped) return;
          draw(video);
          if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(frame);
          else requestAnimationFrame(frame);
        };
        frame();
      });
      recorder.pause();
    } catch {
      /* bỏ qua clip lỗi */
    } finally {
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    }
  }
  recorder.stop();
  await finished;
  output.getTracks().forEach((t) => t.stop());
  canvas.width = canvas.height = 0;
  if (!chunks.length) return null;
  const blob = new Blob(chunks, { type: recorder.mimeType || type || "video/webm" });
  return blob.size > 1000 && blob.size <= 60 * 1024 * 1024 ? blob : null;
}
