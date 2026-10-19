import { flushSync } from "react-dom";

let activeTransition = null;

// Chuyển cảnh mượt trong cùng trang (bước album, tab quản trị, kiosk…) bằng
// View Transitions API. Kiểu hiệu ứng đặt qua html[data-transition] để CSS chọn
// animation: "forward" / "back" (trượt ngang), "zoom", "reorder", mặc định là mờ dần.
// Trình duyệt không hỗ trợ hoặc người dùng tắt chuyển động: cập nhật ngay, không hiệu ứng.
export function transition(update, type = "fade") {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || reduced) {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.transition = type;
  const vt = document.startViewTransition(() => flushSync(update));
  activeTransition = vt;
  // Cập nhật mới có thể bỏ qua animation cũ; trạng thái trang vẫn được cập nhật.
  vt.ready.catch(() => {});
  vt.finished.finally(() => {
    if (activeTransition === vt) {
      delete root.dataset.transition;
      activeTransition = null;
    }
  });
}
