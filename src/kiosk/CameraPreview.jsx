import { useEffect, useRef } from "react";
import { livePreviewLayout } from "./live-preview-layout.js";

// Lúc bấm chụp, máy ảnh đổi tín hiệu HDMI trong giây lát (hiện ảnh vừa chụp, đổi độ phân
// giải): chỉ nhận kích thước nguồn mới khi nó giữ nguyên quá khoảng này, để hình không nhảy.
const SETTLE_MS = 1500;

export function CameraPreview({ videoRef, zoom = 0 }) {
  const viewport = useRef(null);

  useEffect(() => {
    const camera = videoRef.current;
    const frame = viewport.current;
    let source = null, settle = null;
    const apply = () => {
      const layout = source && livePreviewLayout(
        source.width,
        source.height,
        frame.clientWidth,
        frame.clientHeight,
        zoom,
      );
      if (!layout) {
        camera.style.visibility = "hidden";
        return;
      }
      for (const [property, value] of Object.entries(layout))
        camera.style[property] = `${value}px`;
      camera.style.visibility = "visible";
    };
    const sourceChanged = () => {
      const next = { width: camera.videoWidth, height: camera.videoHeight };
      if (!next.width || !next.height) return;
      if (source && source.width === next.width && source.height === next.height) return;
      clearTimeout(settle);
      // Lần đầu có hình: hiện ngay. Đổi kích thước giữa chừng: đợi tín hiệu ổn định.
      if (!source) {
        source = next;
        apply();
        return;
      }
      settle = setTimeout(() => {
        if (camera.videoWidth === next.width && camera.videoHeight === next.height) {
          source = next;
          apply();
        }
      }, SETTLE_MS);
    };

    // Tính lại khi đổi thẻ ghi hình, độ phân giải hoặc kích thước màn hình.
    // Trình duyệt vẫn phát video trực tiếp, không vẽ lại từng khung lên canvas.
    const reset = () => {
      source = null;
      sourceChanged();
    };
    camera.addEventListener("loadedmetadata", reset);
    camera.addEventListener("resize", sourceChanged);
    const observer = new ResizeObserver(apply);
    observer.observe(frame);
    sourceChanged();
    return () => {
      clearTimeout(settle);
      observer.disconnect();
      camera.removeEventListener("loadedmetadata", reset);
      camera.removeEventListener("resize", sourceChanged);
    };
  }, [videoRef, zoom]);

  return (
    <div ref={viewport} className="camera-preview-viewport">
      <video ref={videoRef} autoPlay playsInline muted />
    </div>
  );
}
