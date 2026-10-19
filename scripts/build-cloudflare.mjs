import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Cloudflare provides the /api proxy. An inherited VITE_API_URL must never
// accidentally turn Safari login back into a third-party-cookie request.
const vite = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const result = spawnSync(process.execPath, [vite, "build", ...process.argv.slice(2)], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: { ...process.env, VITE_API_URL: "" },
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
