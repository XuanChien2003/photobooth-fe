import { connectCanonCamera, focusCanonCamera, pressCanonCamera, releaseCanonCamera } from "./canon-camera.js";

// Timer mode uses Canon EDSDK over USB. Cable mode only connects for photo reception;
// the physical RS-60E3 triggers the shutter, so it must not call prepareShutter/pressShutter.
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
