// Preserve legacy offline rows while new photos travel as file bytes, without base64.
// preview: the booth's own upright 1600 px JPEG (already made to show the photo on screen). It
// travels after the camera bytes in the same request so the server can skip decoding the 26 MP
// original while the guest waits; X-Photo-Preview-Length says where the camera bytes end.
export function photoUpload(image, { clientKey, name, captureToken, mirrored, preview } = {}) {
  const binary = typeof Blob !== "undefined" && image instanceof Blob;
  const withPreview = binary && preview instanceof Blob && preview.size > 0;
  return {
    method: "POST",
    timeout: 90000,
    // The server deduplicates this stable key even if its acknowledgement was lost.
    ...(clientKey && { retry: 1 }),
    ...(binary
      ? {
          body: withPreview
            ? new Blob([image, preview], { type: image.type || "image/jpeg" })
            : image,
          headers: {
            "X-Photo-Key": clientKey,
            ...(withPreview && { "X-Photo-Preview-Length": String(preview.size) }),
            ...(name !== undefined && { "X-Photo-Name": encodeURIComponent(name) }),
            ...(captureToken && { "X-Capture-Token": captureToken }),
            ...(mirrored !== undefined && { "X-Photo-Mirrored": mirrored ? "1" : "0" }),
          },
        }
      : {
          body: {
            image, clientKey,
            ...(name !== undefined && { name }),
            ...(captureToken && { captureToken }),
            ...(mirrored !== undefined && { mirrored: Boolean(mirrored) }),
          },
        }),
  };
}
