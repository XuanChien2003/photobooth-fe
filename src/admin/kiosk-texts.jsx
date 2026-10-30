import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { api } from "../api";
import { Button, ErrorBox, useStudio, useToast } from "../studio";
import { KIOSK_TEXT_GROUPS } from "../kiosk/kiosk-texts.js";

// Thiết lập → Chữ trên máy chụp: mọi dòng chữ chính trên màn hình máy chụp (photobooth và Polaroid).
// Ô để trống = dùng chữ mặc định (hiện mờ trong ô). {n}, {s}: chỗ máy chụp điền số.
export function KioskTextsManager({ notify }) {
  const toast = useToast();
  const { reload } = useStudio();
  const [texts, setTexts] = useState(null);
  const [saved, setSaved] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/admin/settings").then(
      (value) => {
        setTexts(value.kioskTexts || {});
        setSaved(value.kioskTexts || {});
      },
      (e) => setError(e.message),
    );
  }, []);
  const changed = texts && JSON.stringify(texts) !== JSON.stringify(saved);
  async function save() {
    setBusy(true);
    try {
      const clean = Object.fromEntries(Object.entries(texts).map(([key, text]) => [key, text.trim()]).filter(([, text]) => text));
      const value = await api("/admin/settings/kiosk-texts", { method: "PUT", body: { kioskTexts: clean } });
      setTexts(value.kioskTexts || {});
      setSaved(value.kioskTexts || {});
      reload?.();
      notify("Đã lưu chữ trên máy chụp. Máy chụp nhận chữ mới khi tải lại danh mục (tối đa 1 phút).");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="kiosk-content kiosk-texts">
      <ErrorBox error={error} />
      {!texts ? (
        <p className="muted">Đang tải…</p>
      ) : (
        <>
          {KIOSK_TEXT_GROUPS.map(([group, rows]) => (
            <section key={group} className="panel kiosk-content-section" aria-label={group}>
              <h3>{group}</h3>
              <div className="kiosk-text-fields">
                {rows.map(([key, label, fallback]) => (
                  <label key={key} className="kiosk-text-field">
                    <span>{label}</span>
                    <div>
                      <input
                        name={key}
                        maxLength={200}
                        placeholder={fallback}
                        value={texts[key] || ""}
                        onChange={(e) => setTexts({ ...texts, [key]: e.target.value })}
                      />
                      {texts[key] && (
                        <button type="button" className="icon-button" aria-label={`Dùng chữ mặc định: ${label}`}
                          title="Dùng chữ mặc định" onClick={() => setTexts({ ...texts, [key]: "" })}>
                          <RotateCcw size={15} />
                        </button>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </section>
          ))}
          <div className="kiosk-texts-save">
            <Button disabled={busy || !changed} onClick={save}>{busy ? "Đang lưu…" : "Lưu chữ trên máy chụp"}</Button>
            <small className="muted">Ô để trống dùng chữ mặc định (chữ mờ trong ô).</small>
          </div>
        </>
      )}
    </div>
  );
}
