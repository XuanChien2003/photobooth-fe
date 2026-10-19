import { api } from "../api.js";
import { photoUpload } from "../photo-upload.js";
import { cleanCameraJpeg } from "./jpeg-clean.js";
import { putToStorage } from "./storage-upload.js";

// Camera originals (~15 MB) go from the booth straight to storage instead of through the free
// server: the booth asks the API for a short-lived upload URL for this photo, uploads the JPEG it
// cleaned of private metadata, then commits the photo with only its small preview. Whenever that
// is not possible (older server, storage not allowing the upload yet, a file still being written)
// the photo is sent the usual way, so nothing is ever lost.
const DIRECT_PAUSE_MS = 10 * 60000;
let directOffUntil = 0;
// Uploads already in storage whose commit did not get an answer: a retry commits them again
// instead of uploading 15 MB a second time.
const storedUploads = new Map();

export const resetDirectUploads = () => { directOffUntil = 0; storedUploads.clear(); };

const isStorageUrl = (src) => {
  try {
    const url = new URL(src);
    return url.protocol === "https:" && url.hostname.endsWith(".r2.cloudflarestorage.com");
  } catch { return false; }
};

// path: "/kiosk/photo" during the session, "/albums/<token>/photos" afterwards.
export async function savePhoto(path, image, options = {}) {
  const viaServer = () => api(path, photoUpload(image, options));
  const { clientKey, captureToken, preview } = options;
  if (!(image instanceof Blob) || !(preview instanceof Blob) || !preview.size || !clientKey ||
      Date.now() < directOffUntil)
    return viaServer();
  let stored = storedUploads.get(clientKey);
  if (!stored) {
    let file;
    try {
      file = await cleanCameraJpeg(image);
    } catch {
      return viaServer(); // not a complete JPEG: the server gives the usual answer
    }
    let ticket;
    try {
      ticket = await api(`${path}/upload-url`, {
        method: "POST",
        body: { clientKey, size: file.size, ...(captureToken && { captureToken }) },
      });
    } catch {
      return viaServer(); // older server, other storage, or the session just ended
    }
    // Saved already (an earlier reply was lost): trust it only if this very photo is there.
    if (ticket?.saved && ticket.booking?.photos?.some((p) => p.clientKey === clientKey))
      return ticket.booking;
    if (!isStorageUrl(ticket?.upload?.url) || typeof ticket.upload.stored !== "string") return viaServer();
    try {
      await putToStorage(ticket.upload.url, file);
    } catch {
      // Storage not reachable from this page (e.g. its CORS rules do not allow uploads yet):
      // use the server for a while instead of failing every photo first.
      directOffUntil = Date.now() + DIRECT_PAUSE_MS;
      return viaServer();
    }
    stored = ticket.upload.stored;
    storedUploads.set(clientKey, stored);
  }
  try {
    const result = await api(path, {
      method: "POST",
      timeout: 60000,
      retry: 1,
      body: preview,
      headers: {
        "X-Photo-Key": clientKey,
        "X-Photo-Stored": stored,
        ...(captureToken && { "X-Capture-Token": captureToken }),
        ...(options.mirrored !== undefined && { "X-Photo-Mirrored": options.mirrored ? "1" : "0" }),
        ...(options.name !== undefined && { "X-Photo-Name": encodeURIComponent(options.name) }),
      },
    });
    storedUploads.delete(clientKey);
    return result;
  } catch (error) {
    // The stored upload cannot be used (422): send the photo the usual way.
    if (error.status === 422) {
      storedUploads.delete(clientKey);
      return viaServer();
    }
    throw error; // connection or session state: the queue retries with the same upload
  }
}
