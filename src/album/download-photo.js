import { isNeutral } from "../beauty";
import { saveBlob, saveImage } from "./utils";

// One photo to the phone or computer. Untouched photos are the exact camera file (no re-encoding,
// full quality, nothing to decode on the phone); edited or mirrored ones are rendered from the
// full original with the guest's adjustments, like "Tải ảnh về" in the editor.
export async function downloadPhoto(engine, photo, adjust, name) {
  if (isNeutral(adjust) && !photo.mirrored)
    return saveBlob(await engine.originalFile(photo.id), name);
  try {
    return await saveImage(await engine.edited(photo.id, adjust), name);
  } finally {
    engine.releaseFull?.(photo.id);
  }
}
