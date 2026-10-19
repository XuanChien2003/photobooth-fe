import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPhotoEngine,
  rememberPromise,
} from "../src/album/photo-engine.js";

const beautyKeys = ["smooth", "whiten", "slim", "blush"];
const isNeutral = (adjust) =>
  !adjust ||
  (beautyKeys.every((key) => !adjust[key]) &&
    (!adjust.filter || adjust.filter === "original"));
const face = [Array.from({ length: 478 }, () => ({ x: 180, y: 240 }))];

test("display edits use small sources while export remains full resolution with separate face inference", async () => {
  const calls = { full:0, preview:0, small:0, detect:[], render:[] };
  const engine = createPhotoEngine({
    loadOriginal: async id => { calls.full++; return {id,width:6240,height:4160}; },
    loadPreview: async id => { calls.preview++; return {id,width:1600,height:1067}; },
    loadThumbnail: async id => { calls.small++; return {id,width:640,height:427}; },
    detectFaces: async source => { calls.detect.push(source.width); return face; },
    applyBeauty: async (source, faces, adjust) => { calls.render.push(source.width); return {...source,adjust,faces}; },
    isNeutral, beautyKeys, createThumbnail: source => source.width,
  });
  assert.equal((await engine.preview("one", {})).width,1600);
  const small=await engine.preview("one", {smooth:30},640);
  assert.equal(small.width,640);
  assert.equal(small.faces[0][0].x,180 * 640 / 1600);
  assert.equal(small.faces[0][0].y,240 * 427 / 1067);
  assert.equal(calls.full,0,"viewing, slider updates and frame placement never download originals");
  assert.deepEqual(calls.detect,[1600]);
  const full=await engine.edited("one",{smooth:30});
  assert.equal(full.width,6240);
  assert.deepEqual(calls.detect,[1600,6240],"printing validates the full source rather than assuming preview detection succeeded");
  engine.releaseFull("one");
  assert.equal((await engine.preview("one",{smooth:30},640)).width,640);
  assert.equal(calls.full,1,"releasing large export buffers preserves light interactive previews");
  await engine.edited("one",{smooth:30});
  assert.equal(calls.full,2,"released full sources are decoded again on demand");
  engine.retryFaces("one");
  await engine.preview("one",{smooth:30});
  assert.deepEqual(calls.detect,[1600,6240,1600]);
});

test("a full-source detection miss can retry after the light preview succeeded", async () => {
  let fullDetections=0;
  const engine=createPhotoEngine({
    loadOriginal:async()=>({width:6240,height:4160}),
    loadPreview:async()=>({width:1600,height:1067}),
    detectFaces:async source=>source.width===6240 && ++fullDetections===1 ? [] : face,
    applyBeauty:async source=>source,isNeutral,beautyKeys,
  });
  await engine.preview('one',{smooth:30});
  await assert.rejects(engine.edited('one',{smooth:30}),e=>e.code==='FACE_NOT_FOUND');
  assert.equal((await engine.edited('one',{smooth:30})).width,6240);
  assert.equal(fullDetections,2);
});

function setup(detect = async () => face) {
  const calls = { original: [], detect: [], render: [], thumbnail: [] };
  const engine = createPhotoEngine({
    loadOriginal: async (id) => {
      calls.original.push(id);
      return { id, width: 360, height: 480 };
    },
    detectFaces: async (source) => {
      calls.detect.push(source.id);
      return detect(source);
    },
    applyBeauty: (source, faces, adjust) => {
      const result = {
        source,
        faces,
        adjust,
        renderNumber: calls.render.length,
      };
      calls.render.push(result);
      return result;
    },
    isNeutral,
    beautyKeys,
    createThumbnail: async (source, size) => {
      calls.thumbnail.push({ id: source.id, size });
      return `${source.id}:${size}`;
    },
  });
  return { engine, calls };
}

test("simultaneous portrait requests reuse one original and one inference", async () => {
  const { engine, calls } = setup();
  const [first, second] = await Promise.all([
    engine.facesOf("portrait"),
    engine.facesOf("portrait"),
  ]);
  assert.equal(first, second);
  assert.deepEqual(calls.original, ["portrait"]);
  assert.deepEqual(calls.detect, ["portrait"]);
  assert.equal(
    await engine.original("portrait"),
    await engine.original("portrait"),
  );
});

test("temporary model failure is reported and evicted instead of becoming cached no-face", async () => {
  let attempts = 0;
  const { engine, calls } = setup(async () => {
    if (++attempts === 1) throw new Error("temporary WASM failure");
    return face;
  });
  await assert.rejects(
    engine.facesOf("portrait"),
    (error) => error.code === "FACE_INFERENCE_FAILED",
  );
  assert.equal(await engine.facesOf("portrait"), face);
  assert.deepEqual(calls.detect, ["portrait", "portrait"]);
  assert.deepEqual(calls.original, ["portrait"]);
});

test("failed face-dependent edits can be retried and never silently cache an unchanged result", async () => {
  let attempts = 0;
  const { engine, calls } = setup(async () => {
    if (++attempts === 1) throw new Error("offline model");
    return face;
  });
  const adjust = { slim: 70, blush: 50 };
  await assert.rejects(
    engine.edited("portrait", adjust),
    (error) => error.code === "FACE_INFERENCE_FAILED",
  );
  assert.equal(calls.render.length, 0);
  const result = await engine.edited("portrait", adjust);
  assert.equal(result.faces, face);
  assert.equal(calls.render.length, 1);
  assert.equal(await engine.edited("portrait", adjust), result);
  assert.equal(calls.detect.length, 2);
});

test("successful no-face detection prevents all skin and face edits without blocking color filters", async () => {
  const { engine, calls } = setup(async () => []);
  await assert.rejects(
    engine.edited("landscape", { slim: 50 }),
    (error) => error.code === "FACE_NOT_FOUND",
  );
  await assert.rejects(
    engine.edited("landscape", { blush: 50 }),
    (error) => error.code === "FACE_NOT_FOUND",
  );
  await assert.rejects(
    engine.edited("landscape", { smooth: 50 }),
    (error) => error.code === "FACE_NOT_FOUND",
  );
  await assert.rejects(
    engine.edited("landscape", { whiten: 50 }),
    (error) => error.code === "FACE_NOT_FOUND",
  );
  assert.equal(calls.render.length, 0);
  assert.equal(calls.detect.length, 1);
  const color = await engine.edited("landscape", { filter: "warm" });
  assert.equal(color.adjust.filter, "warm");
  assert.equal(calls.detect.length, 1);
});

test("neutral originals and color-only edits do not require the face model", async () => {
  const { engine, calls } = setup(async () => {
    throw new Error("model must not be called");
  });
  assert.equal(
    (await engine.edited("portrait", { filter: "original" })).id,
    "portrait",
  );
  assert.equal(
    (await engine.edited("portrait", { filter: "mono" })).adjust.filter,
    "mono",
  );
  assert.deepEqual(calls.detect, []);
  assert.equal(calls.render.length, 1);
});

test("retry invalidates the portrait's edits while retaining other photos and original pixels", async () => {
  const { engine, calls } = setup();
  const adjust = { slim: 65 };
  const first = await engine.edited("portrait-a", adjust);
  const other = await engine.edited("portrait-b", adjust);
  const original = await engine.original("portrait-a");
  await engine.retryFaces("portrait-a");
  const retried = await engine.edited("portrait-a", adjust);
  assert.notEqual(retried, first);
  assert.equal(await engine.edited("portrait-b", adjust), other);
  assert.equal(await engine.original("portrait-a"), original);
  assert.deepEqual(calls.original, ["portrait-a", "portrait-b"]);
  assert.deepEqual(calls.detect, ["portrait-a", "portrait-b", "portrait-a"]);
  assert.equal(calls.render.length, 3);
});

test("slider history releases superseded edits while preserving original, faces and other photos", async () => {
  const { engine, calls } = setup();
  const first = await engine.edited("portrait", { slim: 1 });
  const other = await engine.edited("other", { slim: 20 });
  let latest;
  for (let value = 2; value <= 30; value++)
    latest = await engine.edited("portrait", { slim: value });
  assert.equal(await engine.edited("portrait", { slim: 30 }), latest);
  assert.equal(await engine.edited("other", { slim: 20 }), other);
  assert.notEqual(await engine.edited("portrait", { slim: 1 }), first);
  assert.deepEqual(calls.original, ["portrait", "other"]);
  assert.deepEqual(calls.detect, ["portrait", "other"]);
});

test("returning to the original discards the edited canvas without reloading original pixels", async () => {
  const { engine, calls } = setup();
  const edited = await engine.edited("portrait", { smooth: 50 });
  const original = await engine.original("portrait");
  assert.equal(await engine.edited("portrait", {}), original);
  assert.notEqual(await engine.edited("portrait", { smooth: 50 }), edited);
  assert.deepEqual(calls.original, ["portrait"]);
  assert.deepEqual(calls.detect, ["portrait"]);
});

test("an older rejected detection cannot evict a newer retry in progress", async () => {
  const pending = [];
  const { engine, calls } = setup(
    () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
  );
  const stale = engine.facesOf("portrait");
  const staleRejection = assert.rejects(
    stale,
    (error) => error.code === "FACE_INFERENCE_FAILED",
  );
  await new Promise((resolve) => setImmediate(resolve));
  engine.retryFaces("portrait");
  const retry = engine.facesOf("portrait");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 2);
  pending[0].reject(new Error("old initialization failed"));
  await staleRejection;
  const current = engine.facesOf("portrait");
  pending[1].resolve(face);
  assert.equal(await retry, face);
  assert.equal(await current, face);
  assert.equal(await engine.facesOf("portrait"), face);
  assert.equal(calls.detect.length, 2);
});

test("malformed inference output is a retryable failure instead of a no-face success", async () => {
  let attempts = 0;
  const { engine } = setup(async () => (++attempts === 1 ? null : face));
  await assert.rejects(
    engine.facesOf("portrait"),
    (error) => error.code === "FACE_INFERENCE_FAILED",
  );
  assert.equal(await engine.facesOf("portrait"), face);
  assert.equal(attempts, 2);
});

test("a rejected stale edit promise cannot remove its replacement from the shared cache", async () => {
  const cache = new Map();
  let rejectStale;
  const stale = rememberPromise(
    cache,
    "portrait:slim",
    () =>
      new Promise((_resolve, reject) => {
        rejectStale = reject;
      }),
  );
  const staleRejection = assert.rejects(stale, /old render failed/);
  await new Promise((resolve) => setImmediate(resolve));
  cache.delete("portrait:slim");
  const current = rememberPromise(
    cache,
    "portrait:slim",
    async () => "new edited pixels",
  );
  rejectStale(new Error("old render failed"));
  await staleRejection;
  assert.equal(cache.get("portrait:slim"), current);
  assert.equal(await current, "new edited pixels");
});

test("printing uses the light 3000 px print source, detects faces on it, and keeps the original path for old photos", async () => {
  const calls = { full: 0, print: 0, detect: [], render: [] };
  const engine = createPhotoEngine({
    loadOriginal: async id => { calls.full++; return { id, width: 6240, height: 4160 }; },
    loadPreview: async id => ({ id, width: 1600, height: 1067 }),
    loadPrint: async id => { calls.print++; return { id, width: 3000, height: 2000 }; },
    hasPrintSource: id => id !== "old",
    detectFaces: async source => { calls.detect.push(source.width); return face; },
    applyBeauty: async (source, faces, adjust) => { calls.render.push(source.width); return { ...source, adjust, faces }; },
    isNeutral, beautyKeys, createThumbnail: source => source.width,
  });
  assert.equal(engine.hasPrintSource("one"), true);
  assert.equal(engine.hasPrintSource("old"), false);
  assert.equal((await engine.printEdited("one", {})).width, 3000);
  const retouched = await engine.printEdited("one", { smooth: 30 });
  assert.equal(retouched.width, 3000);
  assert.deepEqual(calls.detect, [3000], "faces are found on the source being printed");
  assert.equal(calls.full, 0, "no 15 MB original download for printing");
  assert.equal(calls.print, 1, "the print source is decoded once");
  assert.equal((await engine.printEdited("old", { smooth: 30 })).width, 6240, "old photos print from the original");
  engine.releasePrint("one");
  await engine.printEdited("one", { smooth: 30 });
  assert.equal(calls.print, 2, "released print sources decode again on demand");
  assert.deepEqual(calls.detect, [3000, 6240], "detection is kept per photo after release");
});

test("a print-source face miss is not remembered", async () => {
  let detections = 0;
  const engine = createPhotoEngine({
    loadOriginal: async () => ({ width: 6240, height: 4160 }),
    loadPrint: async () => ({ width: 3000, height: 2000 }),
    hasPrintSource: () => true,
    detectFaces: async () => (++detections === 1 ? [] : face),
    applyBeauty: async source => source, isNeutral, beautyKeys,
  });
  await assert.rejects(engine.printEdited("one", { smooth: 30 }), e => e.code === "FACE_NOT_FOUND");
  assert.equal((await engine.printEdited("one", { smooth: 30 })).width, 3000);
  assert.equal(detections, 2);
});
