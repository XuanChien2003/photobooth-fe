import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import worker from "../cloudflare/worker.js";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// A real HTTP adapter for the production Worker. Browser tests exercise cookies,
// streamed binary uploads, SSE and Origin translation without a Cloudflare account.
export async function startCloudflareProxyServer({
  apiOrigin,
  frontendDist,
  port = 8082,
}) {
  const directory = path.resolve(frontendDist);
  const env = {
    API_ORIGIN: apiOrigin,
    ASSETS: {
      async fetch(request) {
        if (!["GET", "HEAD"].includes(request.method))
          return new Response("Method not allowed", { status: 405 });
        let pathname;
        try {
          pathname = decodeURIComponent(new URL(request.url).pathname);
        } catch {
          return new Response("Bad request", { status: 400 });
        }
        let file = path.resolve(directory, `.${pathname}`);
        if (file !== directory && !file.startsWith(`${directory}${path.sep}`))
          return new Response("Not found", { status: 404 });
        let metadata = await stat(file).catch(() => null);
        if (!metadata?.isFile()) {
          file = path.join(directory, "index.html");
          metadata = await stat(file);
        }
        return new Response(
          request.method === "HEAD" ? null : Readable.toWeb(createReadStream(file)),
          {
            headers: {
              "Content-Type": MIME_TYPES[path.extname(file)] || "application/octet-stream",
              "Content-Length": String(metadata.size),
            },
          },
        );
      },
    },
  };
  const server = createServer(async (incoming, outgoing) => {
    const controller = new AbortController();
    incoming.once("aborted", () => controller.abort());
    outgoing.once("close", () => {
      if (!outgoing.writableFinished) controller.abort();
    });
    try {
      const headers = new Headers();
      for (let index = 0; index < incoming.rawHeaders.length; index += 2)
        headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
      const request = new Request(
        new URL(incoming.url, `http://${incoming.headers.host}`),
        {
          method: incoming.method,
          headers,
          body: ["GET", "HEAD"].includes(incoming.method)
            ? undefined
            : Readable.toWeb(incoming),
          duplex: "half",
          signal: controller.signal,
        },
      );
      const response = await worker.fetch(request, env);
      outgoing.statusCode = response.status;
      outgoing.statusMessage = response.statusText;
      for (const [name, value] of response.headers) {
        if (name !== "set-cookie") outgoing.setHeader(name, value);
      }
      const cookies = response.headers.getSetCookie();
      if (cookies.length) outgoing.setHeader("Set-Cookie", cookies);
      if (response.body && incoming.method !== "HEAD")
        await pipeline(Readable.fromWeb(response.body), outgoing);
      else {
        await response.body?.cancel();
        outgoing.end();
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (outgoing.headersSent) outgoing.destroy(error);
      else {
        outgoing.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        outgoing.end("Cloudflare test adapter failed");
      }
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  return server;
}
