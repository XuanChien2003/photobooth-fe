import { useEffect, useRef } from "react";
import { livePreviewLayout } from "./live-preview-layout.js";

export function CameraPreview({ videoRef }) {
  const viewport = useRef(null);

  useEffect(() => {
    const camera = videoRef.current;
    const frame = viewport.current;
    const updateLayout = () => {
      const layout = livePreviewLayout(
        camera.videoWidth,
        camera.videoHeight,
        frame.clientWidth,
        frame.clientHeight,
      );
      if (!layout) {
        camera.style.visibility = "hidden";
        return;
      }
      for (const [property, value] of Object.entries(layout))
        camera.style[property] = `${value}px`;
      camera.style.visibility = "visible";
    };

    // Tính lại khi đổi thẻ ghi hình, độ phân giải hoặc kích thước màn hình.
    // Trình duyệt vẫn phát video trực tiếp, không vẽ lại từng khung lên canvas.
    camera.addEventListener("loadedmetadata", updateLayout);
    camera.addEventListener("resize", updateLayout);
    const observer = new ResizeObserver(updateLayout);
    observer.observe(frame);
    updateLayout();
    return () => {
      observer.disconnect();
      camera.removeEventListener("loadedmetadata", updateLayout);
      camera.removeEventListener("resize", updateLayout);
    };
  }, [videoRef]);

  return (
    <div ref={viewport} className="camera-preview-viewport">
      <video ref={videoRef} autoPlay playsInline muted />
    </div>
  );
}
