import test from "node:test";
import assert from "node:assert/strict";
import { zipBlobs } from "../src/album/zip-blobs.js";

test("bulk frame ZIP contains every JPEG with valid offsets, names and CRC", async () => {
  const files = [
    { name: "vé-khung-01.jpg", blob: new Blob(["123456789"], { type: "image/jpeg" }) },
    { name: "vé-khung-02.jpg", blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }) },
  ];
  const archive = await zipBlobs(files);
  assert.equal(archive.type, "application/zip");
  const bytes = new Uint8Array(await archive.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const footer = bytes.length - 22;
  assert.equal(view.getUint32(footer, true), 0x06054b50);
  assert.equal(view.getUint16(footer + 10, true), files.length);
  let central = view.getUint32(footer + 16, true);

  for (const [index, expected] of files.entries()) {
    assert.equal(view.getUint32(central, true), 0x02014b50);
    const nameLength = view.getUint16(central + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(central + 46, central + 46 + nameLength));
    assert.equal(name, expected.name);
    const local = view.getUint32(central + 42, true);
    assert.equal(view.getUint32(local, true), 0x04034b50);
    assert.equal(view.getUint32(local + 14, true), view.getUint32(central + 16, true));
    if (index === 0) assert.equal(view.getUint32(central + 16, true), 0xcbf43926);
    const length = view.getUint32(central + 24, true);
    const dataStart = local + 30 + view.getUint16(local + 26, true);
    assert.deepEqual(
      bytes.subarray(dataStart, dataStart + length),
      new Uint8Array(await expected.blob.arrayBuffer()),
    );
    central += 46 + nameLength;
  }
  assert.equal(central, footer);
});
