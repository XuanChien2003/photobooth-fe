// Browser JPEG encoding runs asynchronously; keep the established quality and
// data-URL transport expected by saved print attempts and the print API.
async function imageDataUrl(canvas, type, quality) {
  const blob = await new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("Máy chưa tạo được ảnh, hãy thử lại.")),
    type, quality,
  ));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Không đọc được ảnh đã tạo."));
    reader.readAsDataURL(blob);
  });
}

export const jpegDataUrl = (canvas, quality) => imageDataUrl(canvas, "image/jpeg", quality);

// Print sheets keep every composed pixel: no JPEG compression before or after upload.
export const pngDataUrl = (canvas) => imageDataUrl(canvas, "image/png");
