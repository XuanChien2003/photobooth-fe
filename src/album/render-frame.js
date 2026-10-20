import { drawSlot, slotRect, slotScale } from "../frame-utils.js";
import { drawDecorations } from "./decorations.js";

// Server print sources are 3000 px on the long edge (smaller sources are the full original).
export const PRINT_SOURCE_EDGE = 3000;

// A 26 MP camera source is ~104 MB decoded. Paint slots in their established
// order with one source at a time, using exactly the same drawing math as
// composeLayout. No intermediate JPEG or extra raster/compositing pass.
//
// Engines with print sources (engine.printEdited) paint from the 3000 px copy: frame slots on a
// 1200 × 1800 sheet need far fewer pixels, so the print is the same while the phone downloads
// a fraction of the 15 MB original. Only a slot zoomed beyond what that copy holds switches
// to the camera original, so a print is never upscaled.
export async function renderPrintFrame(canvas, background, frame, slots, engine, adjustOf,
  isActive = () => true, decorations = []) {
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
  let source, previous, full = false;
  const release = () => {
    if (!previous) return;
    engine.releaseFull?.(previous);
    engine.releasePrint?.(previous);
  };
  try {
    for (const [index, slot] of slots.entries()) {
      if (!isActive()) return false;
      if (!slot.photo) continue;
      const rect = slotRect(frame.slots[index], canvas.width, canvas.height);
      if (previous !== slot.photo) {
        release();
        source = null;
        previous = null;
        await new Promise(resolve => setTimeout(resolve, 0));
        if (!isActive()) return false;
        previous = slot.photo;
        // Photos saved before print sources existed are painted from the original as before.
        full = !engine.printEdited || !engine.hasPrintSource?.(slot.photo);
        source = await (full ? engine.edited : engine.printEdited)(slot.photo, adjustOf(slot.photo));
      }
      if (!isActive()) return false;
      if (!full && slotScale(source, rect, slot) > 1.001 &&
          Math.max(source.width, source.height) >= PRINT_SOURCE_EDGE) {
        engine.releasePrint?.(slot.photo);
        full = true;
        source = await engine.edited(slot.photo, adjustOf(slot.photo));
        if (!isActive()) return false;
      }
      drawSlot(ctx, source, rect, slot);
    }
    drawDecorations(ctx, decorations, canvas.width, canvas.height);
    return true;
  } finally {
    release();
  }
}
