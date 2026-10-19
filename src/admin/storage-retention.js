// A shared interpretation keeps the assistant and print tabs on the same image
// deadline. Missing/partial measurements never become an empty gallery.
export function imageRetention(summary, now, loadError = "") {
  const retention = summary?.retention;
  const expiresAt = retention?.nextImageExpiresAt;
  const time = typeof expiresAt === "string" ? Date.parse(expiresAt) : NaN;
  if (retention?.available !== false && Number.isFinite(time)) {
    const minutes = Math.max(0, Math.ceil((time - now) / 60000));
    const hours = Math.floor(minutes / 60);
    return {
      known: true,
      expiresAt,
      label:
        time <= now
          ? "Đã hết hạn, chờ dọn"
          : hours
            ? `${hours} giờ ${String(minutes % 60).padStart(2, "0")} phút`
            : `${minutes} phút`,
    };
  }
  return {
    known: false,
    expiresAt: null,
    label:
      retention?.available !== false && expiresAt === null
        ? "Chưa có ảnh đang lưu"
        : !summary && !loadError
          ? "Đang kiểm tra…"
          : "Chưa lấy được hạn xoá ảnh",
  };
}
