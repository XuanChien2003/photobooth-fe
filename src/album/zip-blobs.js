// Store already-compressed JPEGs without recompressing them in the browser.
const encoder = new TextEncoder();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

export async function zipBlobs(files) {
  if (!files.length || files.length > 0xffff)
    throw new Error("Số lượng ảnh không hợp lệ để tạo file ZIP.");

  const parts = [];
  const directory = [];
  let offset = 0;
  let directorySize = 0;

  for (const { name, blob } of files) {
    const filename = encoder.encode(name);
    const size = blob.size;
    if (filename.length > 0xffff || size > 0xffffffff || offset + 30 + filename.length + size > 0xffffffff)
      throw new Error("File ảnh quá lớn để tải chung; hãy tải từng khung.");

    const checksum = crc32(new Uint8Array(await blob.arrayBuffer()));
    const local = new Uint8Array(30);
    const entry = new DataView(local.buffer);
    entry.setUint32(0, 0x04034b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 0x0800, true); // UTF-8 filenames
    entry.setUint16(12, 0x21, true); // 1980-01-01, valid DOS date
    entry.setUint32(14, checksum, true);
    entry.setUint32(18, size, true);
    entry.setUint32(22, size, true);
    entry.setUint16(26, filename.length, true);
    parts.push(local, filename, blob);

    const central = new Uint8Array(46);
    const record = new DataView(central.buffer);
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(4, 20, true);
    record.setUint16(6, 20, true);
    record.setUint16(8, 0x0800, true);
    record.setUint16(14, 0x21, true);
    record.setUint32(16, checksum, true);
    record.setUint32(20, size, true);
    record.setUint32(24, size, true);
    record.setUint16(28, filename.length, true);
    record.setUint32(42, offset, true);
    directory.push(central, filename);
    directorySize += central.length + filename.length;
    offset += local.length + filename.length + size;
  }

  if (offset + directorySize > 0xffffffff)
    throw new Error("File ZIP quá lớn; hãy tải từng khung.");

  const end = new Uint8Array(22);
  const footer = new DataView(end.buffer);
  footer.setUint32(0, 0x06054b50, true);
  footer.setUint16(8, files.length, true);
  footer.setUint16(10, files.length, true);
  footer.setUint32(12, directorySize, true);
  footer.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: "application/zip" });
}
