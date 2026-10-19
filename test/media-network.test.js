import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';

let number = 0;
async function setup(handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const { fetchMediaBlob } = await import('../src/media-delivery.js?fixture=' + ++number);
  return { base, fetchMediaBlob, close: async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  } };
}

test('stalled R2 bytes fall back to the authenticated API and preserve the full original', async () => {
  const originalFetch = globalThis.fetch;
  const bytes = Buffer.from([255, 216, 7, 8, 9, 255, 217]);
  const seen = [];
  const f = await setup((req, res) => {
    if (req.url.includes('direct=link')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: 'https://fixture.r2.cloudflarestorage.com/source' }));
    } else if (req.url === '/source') {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.write(bytes.subarray(0, 2)); // Connection stays open without further bytes.
    } else {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' }); res.end(bytes);
    }
  });
  globalThis.fetch = (url, options) => {
    seen.push({ url: String(url), options });
    return originalFetch(String(url).includes('.r2.cloudflarestorage.com') ? f.base + '/source' : url, options);
  };
  try {
    const url = f.base + '/api/albums/token/photos/photo';
    const blob = await f.fetchMediaBlob(url, { stallTimeout: 80, timeout: 3000 });
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);
    assert.equal(blob.type, 'image/jpeg');
    assert.equal(seen.length, 3);
    assert.equal(seen[0].options.credentials, 'include');
    assert.equal(seen[1].options.credentials, 'omit');
    assert.equal(seen[2].options.credentials, 'include');
    assert.equal(seen[1].options.signal.aborted, true, 'stalled transfer is cancelled before fallback');
    await f.fetchMediaBlob(url);
    assert.equal(seen.length, 4, 'temporarily failed R2 is skipped on the next image');
  } finally { globalThis.fetch = originalFetch; await f.close(); }
});

test('continuous slow progress does not trigger fallback or truncate the JPEG', async () => {
  const bytes = Buffer.alloc(10000, 71); let calls = 0;
  const f = await setup((req, res) => {
    calls++;
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    let cursor = 0;
    const timer = setInterval(() => {
      res.write(bytes.subarray(cursor, cursor += 1000));
      if (cursor >= bytes.length) { clearInterval(timer); res.end(); }
    }, 20);
    res.on('close', () => clearInterval(timer));
  });
  try {
    const blob = await f.fetchMediaBlob(f.base + '/api/albums/token/photos/photo', { stallTimeout: 120, timeout: 3000 });
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);
    assert.equal(calls, 1);
  } finally { await f.close(); }
});

test('cancelling an editor download aborts it without launching a second transfer', async () => {
  let calls = 0;
  const f = await setup((req, res) => {
    calls++;
    res.writeHead(200, { 'Content-Type': 'image/jpeg' }); res.write('partial');
  });
  const controller = new AbortController();
  try {
    const task = f.fetchMediaBlob(f.base + '/api/albums/token/photos/photo', { signal: controller.signal });
    const failed = assert.rejects(task, { name: 'AbortError' });
    while (!calls) await new Promise(resolve => setTimeout(resolve, 5));
    controller.abort();
    await failed;
    assert.equal(calls, 1);
  } finally { await f.close(); }
});

test('rate limits and missing images do not retry through a second route', async () => {
  for (const status of [404, 429]) {
    let calls = 0;
    const f = await setup((req, res) => {
      calls++; res.writeHead(status, { 'Retry-After': '60' }); res.end();
    });
    try {
      await assert.rejects(f.fetchMediaBlob(f.base + '/api/albums/token/photos/photo'), { status });
      assert.equal(calls, 1);
    } finally { await f.close(); }
  }
});
