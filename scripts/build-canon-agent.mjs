// Small dependency-free ZIP (stored files) for the staff installer download.
import { mkdir, readFile, writeFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
const files = await Promise.all(["server.js", "driver.js", "CanonWorker.cs", "start.ps1", "install.cmd", "README.md"].map(async (name) => ({ name, data: await readFile(new URL(`scripts/canon-camera/${name}`, root)) })));
files.push({ name: "package.json", data: Buffer.from('{"private":true,"type":"module"}\n') });
const locals = [], central = [];
let offset = 0;
for (const { name, data } of files) {
  const filename = Buffer.from(`canon-camera/${name}`), crc = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
  header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
  const record = Buffer.alloc(46);
  record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
  record.writeUInt16LE(33, 14); record.writeUInt32LE(crc, 16);
  record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(filename.length, 28); record.writeUInt32LE(offset, 42);
  locals.push(header, filename, data); central.push(record, filename);
  offset += header.length + filename.length + data.length;
}
const end = Buffer.alloc(22), directory = Buffer.concat(central);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
await mkdir(new URL("public/downloads/", root), { recursive: true });
await writeFile(new URL("public/downloads/canon-camera-agent.zip", root), Buffer.concat([...locals, directory, end]));
