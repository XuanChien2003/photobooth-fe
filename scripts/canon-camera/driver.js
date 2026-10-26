import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
const here = dirname(fileURLToPath(import.meta.url));

export function createCanonDriver({ sdkDirectory, folder }) {
  let worker, opening, state = { connected: false, model: "", folder };
  const requests = new Map();
  const fail = (error) => {
    state.connected = false;
    for (const p of requests.values()) { clearTimeout(p.timer); p.reject(error); }
    requests.clear();
  };
  async function start() {
    if (worker) return;
    if (process.platform !== "win32") throw new Error("Canon Camera Agent hiện hỗ trợ Windows x64.");
    if (!sdkDirectory) throw new Error("Chưa cài Canon EDSDK x64. Đặt CANON_SDK_DIR tới thư mục chứa EDSDK.dll.");
    const sdk = resolve(sdkDirectory);
    await access(join(sdk, "EDSDK.dll"));
    const runtime = join(here, ".runtime");
    await mkdir(runtime, { recursive: true });
    const exe = join(runtime, "CanonWorker.exe");
    const compiler = join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
    await new Promise((done, reject) => {
      const build = spawn(compiler, ["/nologo", "/target:exe", "/platform:x64", "/reference:System.Web.Extensions.dll", "/reference:System.Windows.Forms.dll", `/out:${exe}`, join(here, "CanonWorker.cs")], { windowsHide: true });
      let errors = "";
      build.stdout.on("data", (data) => { errors += data; });
      build.stderr.on("data", (data) => { errors += data; });
      build.once("error", reject);
      build.once("exit", (code) => code === 0 ? done() : reject(new Error(errors || "Không biên dịch được Canon Camera Agent.")));
    });
    const child = spawn(exe, [folder], { cwd: sdk, windowsHide: true, env: { ...process.env, PATH: `${sdk};${process.env.PATH}` } });
    worker = child;
    child.on("error", (error) => { if (worker === child) { worker = null; fail(error); } });
    child.on("exit", () => { if (worker === child) { worker = null; fail(new Error("Canon Camera Agent đã dừng. Kiểm tra EDSDK và khởi động lại.")); } });
    child.stderr.on("data", () => {});
    createInterface({ input: child.stdout }).on("line", (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.type === "fatal") { fail(new Error(message.error)); child.kill(); return; }
      if (message.type === "warning") { state.error = message.error; return; }
      if (message.type === "photo") { state.lastPhoto = message.name; state.error = ""; return; }
      const pending = requests.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer); requests.delete(message.id);
      if (message.ok) { state = { ...state, ...message.value }; pending.resolve(state); }
      else pending.reject(new Error(message.error));
    });
  }
  return {
    async request(action, payload = {}) {
      if (action === "status" && !worker) return state;
      opening ??= start().finally(() => { opening = null; });
      await opening;
      return new Promise((done, reject) => {
        const id = randomUUID();
        const timer = setTimeout(() => { requests.delete(id); reject(new Error("Canon R100 không phản hồi; lệnh không được tự gửi lại.")); worker?.kill(); }, 10000);
        requests.set(id, { resolve: done, reject, timer });
        worker.stdin.write(JSON.stringify({ ...payload, id, action }) + "\n", (error) => { if (error) fail(error); });
      });
    },
    close() { worker?.stdin.end(); },
  };
}
