// Máy nhận tiền và relay chụp đều là thiết bị USB-serial: mỗi thiết bị nhớ cổng nhân viên đã
// chọn (theo mã hãng / mã thiết bị USB và thứ tự) để lần sau tự mở đúng cổng, không nhầm sang nhau.
const keyOf = (name) => `serial-port-${name}`;
const infoOf = (port) => {
  const info = port.getInfo?.() || {};
  return { vendor: info.usbVendorId ?? null, product: info.usbProductId ?? null };
};
const same = (a, b) => a.vendor === b.vendor && a.product === b.product;

export async function choosePort(name) {
  const port = await navigator.serial.requestPort();
  const ports = await navigator.serial.getPorts();
  const info = infoOf(port);
  const index = ports.filter((p) => same(infoOf(p), info)).indexOf(port);
  localStorage.setItem(keyOf(name), JSON.stringify({ ...info, index: Math.max(0, index) }));
  return port;
}

export async function savedPort(name) {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(keyOf(name)));
  } catch {
    saved = null;
  }
  if (!saved) return null;
  const matches = (await navigator.serial.getPorts()).filter((p) => same(infoOf(p), saved));
  return matches[saved.index] || matches[0] || null;
}
