import assert from "node:assert/strict";
import { test } from "node:test";
import { api } from "../src/api.js";

const turn = () => new Promise((resolve) => setTimeout(resolve, 0));
function fixture() {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = (url, options) => new Promise((resolve, reject) => {
    const request = { url, options, respond: (body) => resolve(Response.json(body)) };
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    requests.push(request);
  });
  return { requests, restore: () => { globalThis.fetch = original; } };
}

test("shared GETs have independent cancellation and no response cache", async () => {
  const f = fixture();
  try {
    const cancelled = new AbortController();
    const first = api("/catalog/share-fixture", { share: true, signal: cancelled.signal });
    const second = api("/catalog/share-fixture", { share: true });
    await turn();
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].options.credentials, "include");
    cancelled.abort();
    await assert.rejects(first, { name: "AbortError" });
    assert.equal(f.requests[0].options.signal.aborted, false);
    f.requests[0].respond({ generation: 1 });
    assert.deepEqual(await second, { generation: 1 });
    const fresh = api("/catalog/share-fixture", { share: true });
    await turn();
    assert.equal(f.requests.length, 2, "a settled response is not reused");
    f.requests[1].respond({ generation: 2 });
    assert.deepEqual(await fresh, { generation: 2 });
  } finally { f.restore(); }
});

test("immediate remount can reuse the in-flight read; abandoned reads are cancelled", async () => {
  const f = fixture();
  try {
    const firstController = new AbortController();
    const first = api("/catalog/remount-fixture", { share: true, signal: firstController.signal });
    firstController.abort();
    const secondController = new AbortController();
    const second = api("/catalog/remount-fixture", { share: true, signal: secondController.signal });
    await assert.rejects(first, { name: "AbortError" });
    await turn();
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].options.signal.aborted, false);
    secondController.abort();
    await assert.rejects(second, { name: "AbortError" });
    await turn();
    assert.equal(f.requests[0].options.signal.aborted, true);
  } finally { f.restore(); }
});

test("writes, login and logout isolate new private reads from old requests", async () => {
  const f = fixture();
  try {
    for (const mutation of ["/admin/packages/fixture", "/auth/login", "/auth/logout"]) {
      const start = f.requests.length;
      const before = api("/auth/me", { share: true });
      await turn();
      const write = api(mutation, { method: "POST", body: {} });
      const after = api("/auth/me", { share: true });
      await turn();
      assert.equal(f.requests.length - start, 3);
      f.requests[start].respond({ user: "old" });
      f.requests[start + 1].respond({ ok: true });
      f.requests[start + 2].respond({ user: "new" });
      assert.deepEqual(await before, { user: "old" });
      await write;
      assert.deepEqual(await after, { user: "new" });
    }
  } finally { f.restore(); }
});

test("different parsing/timeouts and custom request options never share", async () => {
  const f = fixture();
  try {
    const results = [
      api("/sharing/options", { share: true }),
      api("/sharing/options", { share: true, allowNull: true }),
      api("/sharing/options", { share: true, timeout: 30000 }),
      api("/sharing/options", { share: true, headers: { Authorization: "fixture-only" } }),
      api("/sharing/options", { share: true, credentials: "omit" }),
    ];
    await turn();
    assert.equal(f.requests.length, 5);
    f.requests.forEach((request) => request.respond({ ok: true }));
    await Promise.all(results);
    assert.equal(f.requests.find((request) => request.options.credentials === "omit").options.credentials, "omit");
  } finally { f.restore(); }
});

test("reads started during login cannot be shared after its response changes the session", async () => {
  const f = fixture();
  try {
    const login = api("/auth/login", { method: "POST", body: { email: "fixture@example.test" } });
    const during = api("/auth/me/during-write", { share: true });
    await turn();
    assert.equal(f.requests.length, 2);
    f.requests[0].respond({ user: "current" });
    await login;
    const after = api("/auth/me/during-write", { share: true });
    await turn();
    assert.equal(f.requests.length, 3, "a read started with the previous session is not reused");
    f.requests[1].respond({ user: "previous" });
    f.requests[2].respond({ user: "current" });
    assert.deepEqual(await during, { user: "previous" });
    assert.deepEqual(await after, { user: "current" });
  } finally { f.restore(); }
});

test("failed shared reads are evicted and can be retried", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    if (++calls === 1) throw new TypeError("Fixture unavailable");
    return Response.json({ ok: true });
  };
  try {
    const failed = await Promise.allSettled([
      api("/sharing/failure", { share: true, retry: 0 }),
      api("/sharing/failure", { share: true, retry: 0 }),
    ]);
    assert.equal(calls, 1);
    assert.ok(failed.every((result) => result.status === "rejected"));
    assert.deepEqual(await api("/sharing/failure", { share: true, retry: 0 }), { ok: true });
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});
