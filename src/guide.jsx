import { useState } from "react";
import { ChevronDown, Lightbulb } from "lucide-react";

// Khung hướng dẫn bắt đầu thu gọn để ưu tiên công việc trên trang;
// trình duyệt nhớ lựa chọn mở / thu gọn của nhân viên theo từng khung.
export function Guide({ id, title, steps, note, dark = false }) {
  const key = `nxc-guide-${id}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) === "open";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setOpen((was) => {
      try {
        localStorage.setItem(key, was ? "closed" : "open");
      } catch {
        /* chế độ ẩn danh: không nhớ được, vẫn dùng bình thường */
      }
      return !was;
    });
  };
  return (
    <section
      className={`guide${dark ? " is-dark" : ""}${open ? " is-open" : ""}`}
    >
      <button
        type="button"
        className="guide-head"
        aria-expanded={open}
        onClick={toggle}
      >
        <Lightbulb size={17} aria-hidden="true" />
        <span>
          Hướng dẫn: {title}
          {!open && <small> · {steps.length} bước — bấm để xem</small>}
        </span>
        <ChevronDown size={17} className="guide-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="guide-body">
          <ol>
            {steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          {note && <p className="guide-note">{note}</p>}
        </div>
      )}
    </section>
  );
}
