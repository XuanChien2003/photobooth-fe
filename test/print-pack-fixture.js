// Test fixtures read print requests in either form: raw sheet bytes (X-Print-Sheets lists their
// sizes) or the older JSON data URLs. Both come back as { images: [data URL], frameName, requestKey }.
export function decodePrintPack(body, headers) {
  const get = (name) => headers[name] ?? headers[name.toLowerCase()];
  if (!/octet-stream/.test(get("Content-Type") || "")) return JSON.parse(body.toString());
  let offset = 0;
  const images = get("X-Print-Sheets").split(",").map(Number).map((size) => {
    const sheet = body.subarray(offset, (offset += size));
    const type = sheet[0] === 0x89 ? "png" : "jpeg";
    return `data:image/${type};base64,${Buffer.from(sheet).toString("base64")}`;
  });
  return { images, frameName: decodeURIComponent(get("X-Print-Frame")), requestKey: get("X-Print-Key") };
}
