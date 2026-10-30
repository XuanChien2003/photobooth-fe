// Trợ lí Minh: ảnh khuôn mặt (nền đã tách, trong suốt) thay icon robot ở mọi chỗ nhắc tới trợ lí
// (WebP 192 px, ~10 KB). Ảnh gốc là JPEG nên nền đã xoá vẫn còn màu trắng: đã cắt bỏ khi tạo file.
export function AssistantAvatar({ size = 18 }) {
  return (
    <img
      className="assistant-avatar"
      src="/tro-li-minh.webp"
      alt=""
      width={size}
      height={size}
      decoding="async"
    />
  );
}
