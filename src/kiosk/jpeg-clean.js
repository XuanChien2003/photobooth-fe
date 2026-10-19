// The booth removes private JPEG metadata itself before sending a camera original straight to
// storage. Byte for byte the same rules as the server's cleanJpegMetadata (Photo_BE
// src/services/jpeg-metadata.js; test/jpeg-clean.test.js compares them): pixel data is never
// decoded; the colour profile, JFIF/Adobe colour info and only the EXIF orientation are kept,
// anything after the image (embedded previews) is dropped, and a file still being written
// (no end marker) is refused.
const MINIMAL_EXIF = [0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49, 0x2a, 0x00,
  0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00];

// Node's "ascii" decoding drops each byte's high bit; keep the same comparison.
const ascii = (bytes, from, to) => {
  let text = "";
  for (let i = from; i < to && i < bytes.length; i++) text += String.fromCharCode(bytes[i] & 0x7f);
  return text;
};
const u16 = (bytes, at, little) => little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1];
const u32 = (bytes, at, little) => little
  ? (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
  : ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;

// EXIF orientation (IFD0 tag 0x0112) of the first EXIF segment, as image decoders read it.
export function exifOrientation(bytes) {
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    if (marker === 0xda || marker === 0xd9) return undefined;
    const length = u16(bytes, at + 2, false);
    if (marker === 0xe1 && ascii(bytes, at + 4, at + 10) === "Exif\0\0") {
      const tiff = at + 10, little = bytes[tiff] === 0x49;
      const ifd = tiff + u32(bytes, tiff + 4, little);
      const count = u16(bytes, ifd, little);
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > at + 2 + length) break;
        if (u16(bytes, entry, little) === 0x0112 && u16(bytes, entry + 2, little) === 3)
          return u16(bytes, entry + 8, little);
      }
      return undefined;
    }
    at += 2 + length;
  }
  return undefined;
}

// Returns the cleaned file as parts (views into the original, no 15 MB copy) and whether
// anything changed.
export function cleanJpegParts(bytes, orientation) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("Invalid JPEG");
  const parts = [bytes.subarray(0, 2)];
  let changed = orientation >= 2 && orientation <= 8;
  if (changed) {
    const exif = Uint8Array.from(MINIMAL_EXIF);
    exif[28] = orientation & 0xff;
    exif[29] = orientation >> 8;
    parts.push(exif);
  }
  let at = 2, ended = false;
  while (at < bytes.length) {
    const start = at;
    if (bytes[at++] !== 0xff) throw new Error("Invalid JPEG marker");
    while (bytes[at] === 0xff) at++;
    const marker = bytes[at++];
    if (marker === 0xd9) {
      parts.push(bytes.subarray(start, at));
      ended = true;
      if (at !== bytes.length) changed = true;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.subarray(start, at));
      continue;
    }
    if (at + 2 > bytes.length) throw new Error("Incomplete JPEG");
    const length = u16(bytes, at, false), end = at + length;
    if (length < 2 || end > bytes.length) throw new Error("Incomplete JPEG segment");
    const app = marker >= 0xe0 && marker <= 0xef;
    const icc = marker === 0xe2 && ascii(bytes, at + 2, at + 14) === "ICC_PROFILE\0";
    const jfif = marker === 0xe0 && ascii(bytes, at + 2, at + 7) === "JFIF\0";
    const adobe = marker === 0xee && length === 14 && ascii(bytes, at + 2, at + 7) === "Adobe";
    if ((!app && marker !== 0xfe) || icc || jfif || adobe) parts.push(bytes.subarray(start, end));
    else changed = true;
    at = end;
    if (marker === 0xda) {
      const entropy = at;
      while (at < bytes.length) {
        const ff = bytes.indexOf(0xff, at);
        if (ff < 0) { at = bytes.length; break; }
        at = ff;
        let next = at + 1;
        while (bytes[next] === 0xff) next++;
        const code = bytes[next];
        if (code === 0x00 || (code >= 0xd0 && code <= 0xd7)) { at = next + 1; continue; }
        break;
      }
      parts.push(bytes.subarray(entropy, at));
    }
  }
  if (!ended) throw new Error("Incomplete JPEG");
  return { parts, changed };
}

export async function cleanCameraJpeg(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const { parts, changed } = cleanJpegParts(bytes, exifOrientation(bytes));
  return changed ? new Blob(parts, { type: "image/jpeg" }) : new Blob([bytes], { type: "image/jpeg" });
}
