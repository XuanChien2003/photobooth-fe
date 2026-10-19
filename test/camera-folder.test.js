import assert from "node:assert/strict";
import { test } from "node:test";
import { watchCameraFolder } from "../src/kiosk/watch-camera-folder.js";

const settle = () => new Promise((resolve) => setImmediate(resolve));
function fixture(t, onPhoto, initialFiles = []) {
  const now = Date.now();
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now });
  const files = new Map(initialFiles), reports = [], attempts = [];
  const folder = { name: "fixture", async *entries() {
    for (const [name, file] of files) yield [name, {
      kind: "file", getFile: async () => ({ ...file }),
    }];
  } };
  const stop = watchCameraFolder({ folder,
    booking: { captureStartedAt: new Date(now - 500), captureEndsAt: new Date(now + 60000) },
    onPhoto: async (file, path) => { attempts.push(path); return onPhoto(file, path); },
    notifyOnce: () => {}, onScanSuccess: () => {},
    onScan: (info, writing) => reports.push({ ...info, writing }),
  });
  t.after(stop);
  return { files, reports, attempts, stop, now,
    scan: async () => { t.mock.timers.tick(300); await settle(); },
  };
}

test("a JPEG that pauses during writing is retried and imported exactly once", async () => {
  let attempts=0, firstScan, imported;
  const first=new Promise(resolve=>{firstScan=resolve;});
  const complete=new Promise(resolve=>{imported=resolve;});
  const now=Date.now();
  const file={size:100,lastModified:now};
  const folder={name:'fixture',async *entries(){yield ['new.jpg',{kind:'file',getFile:async()=>file}];}};
  const stop=watchCameraFolder({folder,
    booking:{captureStartedAt:new Date(now-500),captureEndsAt:new Date(now+60000)},
    onPhoto:async()=>++attempts>1,notifyOnce:()=>{},onScanSuccess:()=>{},
    onScan:info=>{firstScan();if(info.imported===1)imported(info);},
  });
  let timeout;
  try {
    await first; assert.equal(attempts,0,'wait for a second stable file observation');
    const result=await Promise.race([complete,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('JPEG was never retried')),4000);})]);
    assert.equal(result.imported,1);assert.equal(attempts,2);
  } finally {stop();clearTimeout(timeout);}
});

test("new shots stabilize while the previous JPEG is still preparing, without concurrent conversions", async (t) => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const state = fixture(t, async (_, path) => {
    if (path === "one.jpg") await waiting;
    return true;
  });
  await settle();
  state.files.set("one.jpg", { size: 100, lastModified: state.now });
  await state.scan(); await state.scan();
  assert.deepEqual(state.attempts, ["one.jpg"]);
  state.files.set("two.jpg", { size: 200, lastModified: state.now + 600 });
  await state.scan(); await state.scan();
  assert.equal(state.reports.at(-1).jpegs, 2, "directory enumeration continues during conversion");
  assert.equal(state.reports.at(-1).writing, 1, "queued photo is counted as unsaved; the active conversion has its own reading count");
  assert.deepEqual(state.attempts, ["one.jpg"], "only one full-size conversion runs at a time");
  release(); await settle();
  assert.deepEqual(state.attempts, ["one.jpg", "two.jpg"]);
  await state.scan();
  assert.equal(state.reports.at(-1).imported, 2);
  assert.equal(state.reports.at(-1).writing, 0);
});

test("changing size or timestamp must stabilize twice and an incomplete JPEG can retry", async (t) => {
  let tries = 0;
  const state = fixture(t, () => ++tries > 1);
  state.files.set("partial.jpg", { size: 100, lastModified: state.now });
  await settle();
  state.files.set("partial.jpg", { size: 200, lastModified: state.now });
  await state.scan();
  state.files.set("partial.jpg", { size: 200, lastModified: state.now + 300 });
  await state.scan();
  assert.equal(tries, 0);
  await state.scan(); assert.equal(tries, 1);
  for (let i = 0; i < 3; i++) await state.scan();
  assert.equal(tries, 1, "partial file retry is throttled");
  await state.scan(); assert.equal(tries, 2);
  await state.scan(); assert.equal(state.reports.at(-1).imported, 1);
});

test("stopping a watcher lets its current durable save finish and discards queued old-session callbacks", async (t) => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const state = fixture(t, () => waiting);
  state.files.set("one.jpg", { size: 100, lastModified: state.now });
  state.files.set("two.jpg", { size: 200, lastModified: state.now });
  await settle(); await state.scan(); await state.scan();
  assert.deepEqual(state.attempts, ["one.jpg"]);
  assert.equal(state.reports.at(-1).writing, 1);
  const scans = state.reports.length;
  state.stop(); release(true); await settle(); await state.scan();
  assert.deepEqual(state.attempts, ["one.jpg"]);
  assert.equal(state.reports.length, scans);
});

test("ten successive shots can reuse a filename without being silently skipped", async (t) => {
  const state = fixture(t, () => true);
  await settle();
  for (let shot = 0; shot < 10; shot++) {
    state.files.set("capture.jpg", { size: 100 + shot, lastModified: state.now + shot * 1200 });
    for (let scan = 0; scan < 5; scan++) await state.scan();
    assert.equal(state.attempts.length, shot + 1, `shot ${shot + 1} must be imported`);
  }
  for (let scan = 0; scan < 4; scan++) await state.scan();
  assert.equal(state.attempts.length, 10, "unchanged files must not import twice");
});

test("an old file ignored at startup can be replaced by a new shot during the session", async (t) => {
  const state = fixture(t, () => true, [["capture.jpg", {
    size: 100, lastModified: Date.now() - 3600000,
  }]]);
  await settle(); await state.scan();
  assert.equal(state.attempts.length, 0, "the previous guest's file stays ignored");
  state.files.set("capture.jpg", { size: 100, lastModified: state.now + 1200 });
  for (let scan = 0; scan < 4; scan++) await state.scan();
  assert.deepEqual(state.attempts, ["capture.jpg"]);
});

test("a replacement written after the capture window cannot enter the previous guest's album", async (t) => {
  const state = fixture(t, () => true);
  await settle();
  state.files.set("capture.jpg", { size: 100, lastModified: state.now });
  await state.scan(); await state.scan();
  assert.equal(state.attempts.length, 1);
  t.mock.timers.tick(66000); await settle();
  state.files.set("capture.jpg", { size: 200, lastModified: Date.now() });
  for (let scan = 0; scan < 5; scan++) await state.scan();
  assert.equal(state.attempts.length, 1);
});
