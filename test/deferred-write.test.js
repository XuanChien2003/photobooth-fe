import assert from "node:assert/strict";
import { test } from "node:test";
import { createDeferredWriter } from "../src/deferred-write.js";

function fixture() {
  let now = 0, sequence = 0;
  const timers = new Map();
  const writes = [];
  let fail = false;
  const writer = createDeferredWriter(value => {
    if (fail) throw new Error("storage unavailable");
    writes.push(value);
  }, {
    setTimer(callback, delay) { const id = ++sequence; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimer(id) { timers.delete(id); },
  });
  const tick = delay => {
    const target = now + delay;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); now = next[1].at; next[1].callback();
    }
    now = target;
  };
  return { writer, writes, tick, timers, fail: value => { fail = value; } };
}

test("a burst of drag updates persists just the final layout after the pause", () => {
  const { writer, writes, tick } = fixture();
  for (let x = 0; x < 100; x++) writer.schedule({ x });
  assert.deepEqual(writes, []);
  tick(249); assert.deepEqual(writes, []);
  tick(1); assert.deepEqual(writes, [{ x: 99 }]);
  tick(2000); assert.equal(writes.length, 1);
});

test("continuous gestures are persisted periodically and page hide flushes the latest position", () => {
  const { writer, writes, tick, timers } = fixture();
  for (let x = 0; x < 15; x++) { writer.schedule({ x }); tick(100); }
  assert.deepEqual(writes, [{ x: 9 }]);
  writer.flush();
  assert.deepEqual(writes, [{ x: 9 }, { x: 14 }]);
  assert.equal(timers.size, 0);
});

test("storage failure keeps input responsive and permits a lifecycle retry", () => {
  const state = fixture();
  state.fail(true); state.writer.schedule({ x: 5 }); state.tick(250);
  assert.deepEqual(state.writes, []);
  state.fail(false); state.writer.flush();
  assert.deepEqual(state.writes, [{ x: 5 }]);
  state.writer.flush(); assert.equal(state.writes.length, 1);
});
