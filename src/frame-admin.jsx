import { useRef, useState } from "react";
import { ScanSearch, Trash2, Upload } from "lucide-react";
import { detectSlots, loadFrameImage } from "./frame-utils";
import { useToast } from "./studio";

export { FrameGrid } from "./admin/frame-catalog";

const MAX_SIDE = 1800;
const MAX_BYTES = 2_900_000;

// Tải ảnh khung (xuất từ Canva), thu nhỏ, rồi tự dò các ô trắng/trong suốt để đặt ảnh.
async function prepareFrame(file) {
  const url = URL.createObjectURL(file);
  try {
    const im = await loadFrameImage(url);
    const scale = Math.min(
      1,
      MAX_SIDE / Math.max(im.naturalWidth, im.naturalHeight),
    );
    const c = document.createElement("canvas");
    c.width = Math.round(im.naturalWidth * scale);
    c.height = Math.round(im.naturalHeight * scale);
    const ctx = c.getContext("2d");
    ctx.drawImage(im, 0, 0, c.width, c.height);
    let image = c.toDataURL(
      file.type === "image/png" ? "image/png" : "image/jpeg",
      0.92,
    );
    if (image.length > MAX_BYTES) {
      // PNG quá lớn: chuyển JPEG trên nền trắng (ô trong suốt thành ô trắng, vẫn dò được).
      const flat = document.createElement("canvas");
      flat.width = c.width;
      flat.height = c.height;
      const f = flat.getContext("2d");
      f.fillStyle = "#ffffff";
      f.fillRect(0, 0, c.width, c.height);
      f.drawImage(c, 0, 0);
      image = flat.toDataURL("image/jpeg", 0.88);
    }
    if (image.length > MAX_BYTES)
      throw new Error(
        "Ảnh khung quá lớn. Hãy xuất từ Canva với kích thước nhỏ hơn.",
      );
    const probe = document.createElement("canvas");
    const k = Math.min(1, 800 / Math.max(c.width, c.height));
    probe.width = Math.round(c.width * k);
    probe.height = Math.round(c.height * k);
    const p = probe.getContext("2d", { willReadFrequently: true });
    p.drawImage(c, 0, 0, probe.width, probe.height);
    const slots = detectSlots(p.getImageData(0, 0, probe.width, probe.height));
    return { image, slots };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function FrameImageField({ value, onChange }) {
  const toast = useToast();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  async function load(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      toast.warning("Vui lòng chọn ảnh khung dạng PNG, JPG hoặc WebP.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const frame = await prepareFrame(file);
      onChange(frame);
      if (!frame.slots.length) {
        const message =
          "Không tìm thấy ô đặt ảnh. Các ô trong khung phải là màu trắng hoặc trong suốt.";
        setError(message);
        toast.warning(message);
      } else
        toast.success(
          `Đã nhận diện ${frame.slots.length} ô đặt ảnh trong khung.`,
        );
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="frame-image-field">
      <label
        className={`frame-drop ${value.image ? "has-image" : ""} ${over ? "over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          load(e.dataTransfer.files?.[0]);
        }}
      >
        <input
          className="visually-hidden"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={(e) => {
            load(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {value.image ? (
          <div className="frame-slot-preview">
            <img src={value.image} alt="Xem trước khung" />
            {(value.slots || []).map((s, i) => (
              <span
                key={i}
                style={{
                  left: `${s.x * 100}%`,
                  top: `${s.y * 100}%`,
                  width: `${s.w * 100}%`,
                  height: `${s.h * 100}%`,
                }}
              >
                {i + 1}
              </span>
            ))}
          </div>
        ) : (
          <span className="frame-drop-empty">
            <Upload size={26} />
            <strong>
              {busy ? "Đang phân tích khung…" : "Chọn hoặc kéo thả ảnh khung"}
            </strong>
            <small>
              PNG / JPG xuất từ Canva · ô đặt ảnh để trắng hoặc trong suốt
            </small>
          </span>
        )}
      </label>
      {error && <small className="error-text">{error}</small>}
      {value.image && (
        <div className="frame-drop-meta">
          <span>
            <ScanSearch size={15} /> Nhận diện{" "}
            <strong>{value.slots?.length || 0}</strong> ô ảnh, đánh số theo thứ
            tự ghép
          </span>
          <button
            type="button"
            className="text-link"
            onClick={() => {
              setError("");
              onChange({ image: "", slots: [] });
            }}
          >
            <Trash2 size={14} /> Bỏ ảnh
          </button>
        </div>
      )}
      {value.image && <FrameZoneEditor image={value.image} slots={value.slots || []}
        onChange={(slots) => onChange({ image: value.image, slots })} />}
    </div>
  );
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
function FrameZoneEditor({ image, slots, onChange }) {
  const canvas = useRef(null);
  const gesture = useRef(null);
  const [selected, setSelected] = useState(0);
  const update = (index, patch) => onChange(slots.map((slot, i) =>
    i === index ? { ...slot, ...patch } : slot));
  const dragStart = (event, index, mode) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = canvas.current.getBoundingClientRect();
    gesture.current = { index, mode, x: event.clientX, y: event.clientY,
      width: bounds.width, height: bounds.height, slot: { ...slots[index] } };
    setSelected(index);
  };
  const dragMove = (event) => {
    const drag = gesture.current;
    if (!drag || drag.index >= slots.length) return;
    const dx = (event.clientX - drag.x) / drag.width;
    const dy = (event.clientY - drag.y) / drag.height;
    if (drag.mode === "resize") update(drag.index, {
      w: clamp(drag.slot.w + dx, 0.04, 1 - drag.slot.x),
      h: clamp(drag.slot.h + dy, 0.04, 1 - drag.slot.y),
    });
    else update(drag.index, {
      x: clamp(drag.slot.x + dx, 0, 1 - drag.slot.w),
      y: clamp(drag.slot.y + dy, 0, 1 - drag.slot.h),
    });
  };
  const slot = slots[selected];
  return (
    <div className="frame-zone-editor">
      <div className="frame-zone-toolbar">
        <button type="button" onClick={() => {
          if (slots.length >= 40) return;
          onChange([...slots, { x: 0.1, y: 0.1, w: 0.38, h: 0.3 }]);
          setSelected(slots.length);
        }}>＋ Thêm vùng ảnh</button>
        <span>{slots.length} vùng ảnh · Kéo để di chuyển, kéo góc để đổi kích thước</span>
      </div>
      <div className="frame-zone-layout">
        <div ref={canvas} className="frame-zone-canvas">
          <img src={image} alt="Nền khung đang chỉnh sửa" draggable="false" />
          {slots.map((area, index) => (
            <div key={index} className={`frame-zone-slot ${selected === index ? "selected" : ""}`}
              style={{ left: `${area.x * 100}%`, top: `${area.y * 100}%`,
                width: `${area.w * 100}%`, height: `${area.h * 100}%` }}
              onPointerDown={(event) => dragStart(event, index, "move")}
              onPointerMove={dragMove}
              onPointerUp={() => { gesture.current = null; }}
              onPointerCancel={() => { gesture.current = null; }}>
              <strong>{index + 1}</strong>
              <span className="frame-zone-resize" aria-label={`Đổi kích thước vùng ${index + 1}`}
                onPointerDown={(event) => { event.stopPropagation(); dragStart(event, index, "resize"); }}
                onPointerMove={dragMove}
                onPointerUp={() => { gesture.current = null; }} />
            </div>
          ))}
        </div>
        {slot && <aside className="frame-zone-inspector">
          <h4>Vùng ảnh {selected + 1}</h4>
          {[["x", "X"], ["y", "Y"], ["w", "Rộng"], ["h", "Cao"]].map(([key, label]) => (
            <label key={key}>{label}
              <input type="number" min="0" max="100" step="0.1"
                value={Math.round(slot[key] * 1000) / 10}
                onChange={(event) => {
                  const next = clamp(Number(event.target.value) / 100,
                    key === "w" || key === "h" ? 0.04 : 0,
                    key === "x" ? 1 - slot.w : key === "y" ? 1 - slot.h :
                      key === "w" ? 1 - slot.x : 1 - slot.y);
                  update(selected, { [key]: next });
                }} />%
            </label>
          ))}
          <button type="button" className="text-link" onClick={() => {
            onChange(slots.filter((_, index) => index !== selected));
            setSelected(Math.max(0, selected - 1));
          }}>Xóa vùng ảnh</button>
        </aside>}
      </div>
    </div>
  );
}
