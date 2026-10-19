import { useState } from "react";
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
    </div>
  );
}
