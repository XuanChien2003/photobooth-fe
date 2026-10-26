import { connectCanonCamera, focusCanonCamera, pressCanonCamera, releaseCanonCamera } from "./canon-camera.js";

// Both capture modes use Canon EDSDK over USB on the booth computer.
// Legacy Bluetooth/relay preferences cannot select the previous camera driver.
export async function prepareShutter(_legacyMode, signal) {
  await connectCanonCamera(signal);
  signal?.throwIfAborted();
  return { focus: focusCanonCamera, press: pressCanonCamera, release: releaseCanonCamera };
}
export async function pressShutter() {
  const shutter = await prepareShutter();
  return shutter.press();
}
