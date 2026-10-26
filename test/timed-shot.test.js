import assert from "node:assert/strict";
import { test } from "node:test";
import { runTimedShot } from "../src/kiosk/timed-shot.js";

const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
async function advance(t, ms) {
  for (let left = ms; left > 0; left -= 50) {
    t.mock.timers.tick(Math.min(left, 50));
    await flush();
  }
}
function booth(t, overrides = {}) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100000 });
  const abort = new AbortController(), events = [], counts = [];
  let photo = false, receiving = false;
  const shutter = {
    focus: async () => { events.push("focus"); },
    press: async () => { events.push("press"); },
    release: async () => { events.push("release"); },
  };
  const task = runTimedShot({
    prepare: async () => shutter,
    signal: abort.signal,
    onState: (s) => events.push(s),
    onTick: (n) => counts.push(n),
    onPressed: () => events.push("exposure"),
    hasPhoto: () => photo,
    isReceiving: () => receiving,
    ...overrides,
  });
  // Attach immediately, including to intentionally failing tasks under fake timers.
  const result = task.then(() => null, (e) => e);
  return { abort, events, counts, result, shutter, photo: () => { photo = true; },
    receiving: (value) => { receiving = value; } };
}

test("connects first, counts 3–2–1 once, focuses, fires once and waits for the JPEG", async (t) => {
  let connect;
  const b = booth(t, { prepare: () => new Promise((resolve) => { connect = resolve; }) });
  await advance(t, 5000);
  assert.deepEqual(b.counts, [null]);
  connect(b.shutter);
  await flush();
  assert.deepEqual(b.counts, [null, 3]);
  await advance(t, 2950);
  assert.equal(b.events.includes("press"), false);
  await advance(t, 50);
  assert.deepEqual(b.counts, [null, 3, 2, 1, 0]);
  assert.ok(b.events.indexOf("focus") < b.events.indexOf("press"));
  assert.equal(b.events.filter((e) => e === "press").length, 1);
  await advance(t, 10000); // The old implementation fired a second exposure after 8 s.
  assert.equal(b.events.filter((e) => e === "press").length, 1);
  b.photo();
  await advance(t, 250);
  assert.equal(await b.result, null);
});

test("connection failure never starts counting or fires", async (t) => {
  const b = booth(t, { prepare: async () => { throw new Error("Camera offline"); } });
  assert.match((await b.result).message, /offline/);
  assert.deepEqual(b.counts, [null]);
  assert.equal(b.events.includes("press"), false);
});

test("leaving a session while connecting prevents a late exposure", async (t) => {
  let connect;
  const b = booth(t, { prepare: () => new Promise((resolve) => { connect = resolve; }) });
  b.abort.abort();
  connect(b.shutter);
  await flush();
  await advance(t, 5000);
  assert.equal((await b.result).name, "AbortError");
  assert.equal(b.events.includes("press"), false);
});

test("cancelling during autofocus releases the button and never presses", async (t) => {
  const b = booth(t);
  await flush();
  await advance(t, 2100);
  assert.ok(b.events.includes("focus"));
  b.abort.abort();
  await flush();
  assert.equal((await b.result).name, "AbortError");
  assert.ok(b.events.includes("release"));
  assert.equal(b.events.includes("press"), false);
});

test("slow or missing JPEG pauses automatic shooting without another exposure", async (t) => {
  const b = booth(t);
  await flush();
  await advance(t, 19000);
  assert.match((await b.result).message, /chưa nhận được ảnh/);
  await advance(t, 20000);
  assert.equal(b.events.filter((e) => e === "press").length, 1);
});

test("allows a JPEG already being written to finish without firing again", async (t) => {
  const b = booth(t);
  await flush();
  b.receiving(true);
  await advance(t, 20000);
  b.photo();
  await advance(t, 250);
  assert.equal(await b.result, null);
  assert.equal(b.events.filter((e) => e === "press").length, 1);
});

test("a timed-out pending press receives cancellation so it cannot fire later", async (t) => {
  const b = booth(t);
  let pendingSignal;
  b.shutter.press = (signal) => { pendingSignal = signal; return new Promise(() => {}); };
  await flush();
  await advance(t, 11200);
  assert.match((await b.result).message, /không phản hồi/);
  assert.equal(pendingSignal.aborted, true);
  assert.equal(b.events.includes("exposure"), false);
});
