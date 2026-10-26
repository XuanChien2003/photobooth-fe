import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanonDriver } from "./driver.js";
export const DEFAULT_ORIGINS = ["https://photobooth.ngathanh.workers.dev", "https://studio.selfbooth.workers.dev", "http://localhost:5173", "http://127.0.0.1:5173"];

export function createCanonServer({ driver, token, origins = DEFAULT_ORIGINS }) {
  const shots = new Map();
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const json = (status, data) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(data)); };
    res.setHeader("Cache-Control", "no-store");
    if (!/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host || "")) return json(403, { error: "Invalid local host." });
    if (origin && !origins.includes(origin)) return json(403, { error: "Kiosk origin not allowed." });
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Private-Network", "true");
    }
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    const actual = Buffer.from(req.headers.authorization || ""), expected = Buffer.from(`Bearer ${token}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return json(401, { error: "Mã kết nối Canon Camera Agent không đúng." });
    const action = req.url?.slice(1);
    if (!(["connect", "focus", "shoot", "release"].includes(action) && req.method === "POST") && !(action === "status" && req.method === "GET")) return json(404, { error: "Unknown camera command." });
    try {
      let body = "";
      for await (const chunk of req) { body += chunk; if (body.length > 4096) return json(413, { error: "Request too large." }); }
      let payload;
      try { payload = body ? JSON.parse(body) : {}; } catch { return json(400, { error: "Invalid JSON." }); }
      if (["focus", "shoot"].includes(action) && (!Number.isFinite(payload.expiresAt) || payload.expiresAt < Date.now() || payload.expiresAt > Date.now() + 5000)) return json(409, { error: "Lệnh chụp đã hết hạn. Không thực hiện chụp muộn." });
      if (action === "shoot") {
        if (!/^[\w-]{8,100}$/.test(payload.requestId || "")) return json(400, { error: "Missing exposure ID." });
        // Keep ambiguous failures too: the same exposure ID must never fire again.
        if (!shots.has(payload.requestId)) {
          if (shots.size >= 10000) return json(503, { error: "Khởi động lại Camera Agent trước lượt khách tiếp theo." });
          shots.set(payload.requestId, driver.request(action, payload).then((value) => ({ status: 200, value }), (error) => ({ status: 503, value: { error: error.message } })));
        }
        const result = await shots.get(payload.requestId); return json(result.status, result.value);
      }
      return json(200, await driver.request(action, payload));
    } catch (error) { return json(503, { error: error.message }); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = join(process.env.LOCALAPPDATA || homedir(), "NXC-Kiosk");
  const path = join(directory, "canon-agent.json");
  await mkdir(directory, { recursive: true });
  let config;
  try { config = JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; config = { token: randomBytes(24).toString("hex"), folder: "C:\\PhotoBooth\\CanonR50" }; }
  if (process.env.CANON_SDK_DIR) config.sdkDirectory = resolve(process.env.CANON_SDK_DIR);
  if (process.env.CANON_PHOTO_DIR) config.folder = resolve(process.env.CANON_PHOTO_DIR);
  await writeFile(path, JSON.stringify(config, null, 2), { mode: 0o600 });
  const driver = createCanonDriver(config);
  const origins = process.env.CANON_KIOSK_ORIGINS?.split(",").map((s) => s.trim()) || DEFAULT_ORIGINS;
  const server = createCanonServer({ driver, token: config.token, origins });
  server.listen(8788, "127.0.0.1", () => {
    console.log("Canon Camera Agent: http://127.0.0.1:8788");
    console.log("Mã kết nối (nhập trong Cài đặt máy chụp):", config.token);
    console.log("Thư mục ảnh:", config.folder);
    console.log(config.sdkDirectory ? "EDSDK: " + config.sdkDirectory : "Chưa có EDSDK: đặt CANON_SDK_DIR tới thư mục EDSDK x64 chứa EDSDK.dll.");
  });
  process.on("SIGINT", () => { driver.close(); server.close(); });
}
