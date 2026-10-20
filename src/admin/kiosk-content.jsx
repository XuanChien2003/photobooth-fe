import { useEffect, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { api, assetUrl } from "../api";
import { Button, ErrorBox, useStudio, useToast } from "../studio";

// Thu nhỏ ảnh trước khi lưu vào DB (ảnh nền ≤ 1920 px JPEG, sticker ≤ 512 px PNG giữ nền trong suốt).
async function imageData(file, maxEdge, type, quality) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL(type, quality);
}

// Quản trị → Máy chụp & nhãn dán: màn hình chờ của máy chụp và thư viện nhãn dán ảnh.
export function KioskContent({ notify }) {
  const { reload } = useStudio();
  const toast = useToast();
  const [idle, setIdle] = useState(null);
  const [stickers, setStickers] = useState([]);
  const [name, setName] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const loadStickers = () => api("/admin/stickers").then(setStickers);
  useEffect(() => {
    api("/admin/settings").then(
      (value) => setIdle({ idleTitle: "", idleSubtitle: "", idleImage: "", ...value.kiosk }),
      (e) => setError(e.message),
    );
    loadStickers().catch((e) => setError(e.message));
  }, []);
  async function run(action, message) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      reload?.();
      notify(message);
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  const saveIdle = () => run(async () => {
    setIdle(await api("/admin/settings/kiosk", { method: "PUT", body: idle }).then((v) => v.kiosk));
  }, "Đã lưu màn hình chờ của máy chụp.");
  async function pickIdle(e) {
    const chosen = e.target.files?.[0];
    e.target.value = "";
    if (!chosen) return;
    try {
      setIdle((v) => ({ ...v, idleImage: "" }));
      const data = await imageData(chosen, 1920, "image/jpeg", 0.85);
      setIdle((v) => ({ ...v, idleImage: data }));
    } catch {
      toast.error("Không đọc được ảnh này. Vui lòng chọn ảnh PNG hoặc JPG khác.");
    }
  }
  const addSticker = () => run(async () => {
    if (!name.trim()) throw new Error("Vui lòng đặt tên nhãn dán.");
    if (!file) throw new Error("Vui lòng chọn ảnh nhãn dán (PNG nền trong suốt).");
    // PNG nhiều chi tiết có thể vượt giới hạn máy chủ: thu nhỏ dần tới khi vừa.
    let image = "";
    for (const edge of [512, 384, 256, 192]) {
      image = await imageData(file, edge, "image/png");
      if (image.length <= 690_000) break;
    }
    if (image.length > 690_000) throw new Error("Ảnh nhãn dán quá nhiều chi tiết. Vui lòng chọn ảnh đơn giản hơn.");
    await api("/admin/stickers", { method: "POST",
      body: { name: name.trim(), image, order: stickers.length, active: true } });
    setName("");
    setFile(null);
    await loadStickers();
  }, "Đã thêm nhãn dán.");
  const removeSticker = (s) => {
    if (!window.confirm(`Xóa nhãn dán “${s.name}”? Ảnh khách đã in không bị ảnh hưởng.`)) return;
    run(async () => {
      await api(`/admin/stickers/${s._id}`, { method: "DELETE" });
      await loadStickers();
    }, "Đã xóa nhãn dán.");
  };
  return (
    <div className="kiosk-content">
      <ErrorBox error={error} />
      <section className="panel">
        <h3>Màn hình chờ của máy chụp</h3>
        <p className="muted">Hiện khi máy chụp chưa có khách (màn hình “Chạm để bắt đầu”).</p>
        {!idle ? (
          <p className="muted">Đang tải…</p>
        ) : (
          <div className="idle-editor">
            <div className="idle-fields">
              <label>
                Dòng chữ lớn
                <input maxLength={60} placeholder="Cười lên, mình chụp nhé!" value={idle.idleTitle}
                  onChange={(e) => setIdle({ ...idle, idleTitle: e.target.value })} />
              </label>
              <label>
                Dòng chữ nhỏ
                <input maxLength={120} placeholder="chụp xong in ngay · nhận ảnh trên điện thoại" value={idle.idleSubtitle}
                  onChange={(e) => setIdle({ ...idle, idleSubtitle: e.target.value })} />
              </label>
              <div className="idle-image-actions">
                <label className="button outline">
                  <ImagePlus size={16} /> {idle.idleImage ? "Đổi ảnh nền" : "Chọn ảnh nền"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pickIdle} />
                </label>
                {idle.idleImage && (
                  <Button className="outline" onClick={() => setIdle({ ...idle, idleImage: "" })}>
                    Bỏ ảnh nền
                  </Button>
                )}
              </div>
              <Button disabled={busy} onClick={saveIdle}>{busy ? "Đang lưu…" : "Lưu màn hình chờ"}</Button>
            </div>
            <div className={`idle-preview ${idle.idleImage ? "has-image" : ""}`} aria-label="Xem trước màn hình chờ">
              {idle.idleImage && <img className="idle-polaroid" src={assetUrl(idle.idleImage)} alt="" />}
              <strong>{idle.idleTitle || "Cười lên, mình chụp nhé!"}</strong>
              <span>{idle.idleSubtitle || "chụp xong in ngay · nhận ảnh trên điện thoại"}</span>
              <em>Chạm để bắt đầu</em>
            </div>
          </div>
        )}
      </section>
      <section className="panel">
        <h3>Nhãn dán của tiệm</h3>
        <p className="muted">
          Khách thấy các nhãn dán này đầu tiên ở bước trang trí khung. Nên dùng ảnh PNG nền trong suốt.
        </p>
        <div className="sticker-add">
          <label>
            Tên nhãn dán
            <input maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="button outline">
            <ImagePlus size={16} /> {file ? file.name : "Chọn ảnh PNG"}
            <input type="file" accept="image/png,image/webp" hidden
              onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
          <Button disabled={busy} onClick={addSticker}>Thêm nhãn dán</Button>
        </div>
        {stickers.length ? (
          <ul className="sticker-library">
            {stickers.map((s) => (
              <li key={s._id}>
                <img src={assetUrl(s.image)} alt="" crossOrigin="anonymous" />
                <span>{s.name}</span>
                <button className="icon-button" aria-label={`Xóa nhãn dán ${s.name}`}
                  disabled={busy} onClick={() => removeSticker(s)}>
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Chưa có nhãn dán riêng — khách dùng bộ nhãn dán biểu tượng có sẵn.</p>
        )}
      </section>
    </div>
  );
}
