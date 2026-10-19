import { useEffect, useRef, useState } from "react";
import {
  PiArrowCounterClockwiseBold,
  PiArrowsInLineHorizontalDuotone,
  PiCaretLeftBold,
  PiCaretRightBold,
  PiCheckBold,
  PiDownloadSimpleBold,
  PiDropHalfDuotone,
  PiEyeBold,
  PiFlowerLotusDuotone,
  PiHeartBold,
  PiHeartFill,
  PiSunDuotone,
  PiTrashBold,
  PiXBold,
} from "react-icons/pi";
import { Button, useToast } from "../studio";
import {
  ADJUST_LABELS,
  COLOR_FILTERS,
  DEFAULT_ADJUST,
  FILTER_CSS,
  isNeutral,
  loadFaceLandmarker,
  warmFaceModel,
} from "../beauty";
import { pad, prepareImage, saveImage } from "./utils";
import { useThumb } from "./hooks";

const ADJUST_ICONS = {
  smooth: PiDropHalfDuotone,
  whiten: PiSunDuotone,
  slim: PiArrowsInLineHorizontalDuotone,
  blush: PiFlowerLotusDuotone,
};

// ─── Popup xem & chỉnh 1 ảnh ─────────────────────────────────────────────
export function PhotoEditor({
  engine,
  photos,
  startId,
  adjustOf,
  onFavorite,
  onDelete,
  onClose,
  onSave,
  onApplyAll,
}) {
  const toast = useToast();
  const [id, setId] = useState(startId);
  const [drafts, setDrafts] = useState({});
  const [tab, setTab] = useState("smooth");
  const [compare, setCompare] = useState(false);
  const [status, setStatus] = useState(null);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [downloadPhase, setDownloadPhase] = useState("");
  const downloadPending = useRef(false);
  const rendering = useRef(null);
  const currentPreview = useRef(null);
  const canvas = useRef(null);
  const index = Math.max(
    0,
    photos.findIndex((p) => p.id === id),
  );
  const photo = photos[index];
  const adjust = drafts[photo.id] || adjustOf(photo.id);
  const needsFace = Object.keys(ADJUST_LABELS).some((key) => adjust[key] > 0);
  const adjustKey = JSON.stringify(adjust);
  const previewKey = `${photo.id}:${adjustKey}:${retry}`;
  currentPreview.current = { engine, key: previewKey };
  const currentStatus =
    status?.engine === engine && status.key === previewKey
      ? status
      : { kind: "pending", message: "Đang xử lý…" };
  const canCommit = currentStatus.kind === "ready" && !saving;
  const set = (a) => setDrafts((d) => ({ ...d, [photo.id]: a }));
  const move = (delta) =>
    setId(photos[(index + delta + photos.length) % photos.length].id);
  // Colour previews are shown up to ~165 px wide (≈330 px on sharp screens): a 96 px
  // thumbnail stretched that far looked blocky.
  const thumb = useThumb(engine, photo.id, 360);

  useEffect(() => {
    // Only download/compile the face model when a portrait adjustment needs it.
    // Viewing originals and applying color filters should not compete with that download.
    if (needsFace) loadFaceLandmarker().catch(() => {});
  }, [needsFace]);
  const shown = currentStatus.kind === "ready";
  useEffect(() => {
    // Once the photo is on screen, fetch the face model quietly in the background so the first
    // "Mịn da" move does not wait for a ~7 MB download (the photo itself never competes with it).
    if (!shown) return;
    const idle = window.requestIdleCallback || ((run) => setTimeout(run, 1200));
    const cancel = window.cancelIdleCallback || clearTimeout;
    const handle = idle(() => warmFaceModel(), { timeout: 3000 });
    return () => cancel(handle);
  }, [shown]);
  useEffect(() => {
    const key = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") move(-1);
      if (e.key === "ArrowRight") move(1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    let live = true;
    if (!compare)
      setStatus({
        engine,
        key: previewKey,
        kind: "pending",
        message: "Đang xử lý…",
      });
    const timer = setTimeout(async () => {
      // Finish the running preview, then render only the latest slider state.
      // Comparing to the original can proceed immediately without a pixel render.
      if (!compare && !isNeutral(adjust) &&
          (needsFace || !rendering.current?.needsFace))
        await rendering.current?.promise?.catch(() => {});
      if (!live) return;
      const draw = (img) => {
        const c = canvas.current;
        if (!live || !c) return;
        c.width = img.width;
        c.height = img.height;
        c.getContext("2d").drawImage(img, 0, 0);
        c.dataset.photo = photo.id;
      };
      let original;
      try {
        // Hiện ảnh gốc ngay, ảnh đã chỉnh thay vào khi xử lý xong.
        original = await (engine.previewOriginal || engine.original)(photo.id);
        if (!live) return;
        if (compare || canvas.current?.dataset.photo !== photo.id)
          draw(original);
        if (compare) return;
        const result = (engine.preview || engine.edited)(photo.id, adjust);
        rendering.current = { promise: result, needsFace };
        const edited = await result;
        draw(edited);
        if (!live) return;
        setStatus({
          engine,
          key: previewKey,
          kind: "ready",
          message: "",
          canvas: edited,
        });
      } catch (e) {
        if (!live) return;
        if (original) draw(original);
        setStatus({
          engine,
          key: previewKey,
          kind: "error",
          message: e.message,
          faceError:
            e.code === "FACE_INFERENCE_FAILED" || e.code === "FACE_NOT_FOUND",
        });
      }
    }, 90);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [engine, photo.id, adjustKey, retry, compare]);

  async function download() {
    if (!canCommit || downloadPending.current) return;
    downloadPending.current = true;
    setDownloadPhase("Đang chuẩn bị ảnh…");
    const isCurrent = () =>
      canvas.current &&
      currentPreview.current.engine === engine &&
      currentPreview.current.key === previewKey;
    try {
      // Display previews are deliberately small. A download always renders from
      // the full camera source and the same adjustment snapshot.
      const source = await engine.edited(photo.id, adjust);
      await prepareImage(source);
      if (!isCurrent()) return;
      setDownloadPhase("Đang lưu ảnh…");
      const result = await saveImage(
        source,
        `anh-${pad(photo.number || index + 1)}.jpg`,
      );
      if (result !== "cancelled" && isCurrent())
        toast.success("Đã lưu ảnh về máy.");
    } catch (e) {
      if (isCurrent()) {
        if (e.code === "FACE_INFERENCE_FAILED" || e.code === "FACE_NOT_FOUND")
          setStatus({ engine, key: previewKey, kind: "error", message: e.message, faceError: true });
        toast.error(`Không lưu được ảnh: ${e.message}`);
      }
    } finally {
      engine.releaseFull?.(photo.id);
      downloadPending.current = false;
      setDownloadPhase("");
    }
  }

  const retryPreview = () => {
    engine.retryFaces(photo.id);
    setRetry((value) => value + 1);
  };

  async function commit(all = false) {
    if (!canCommit) return;
    setSaving(true);
    let checkingId = photo.id;
    try {
      // Một ảnh từng chỉnh bị lỗi vẫn phải được kiểm tra dù khách đã chuyển ảnh.
      const alive = new Set(photos.map((item) => String(item.id)));
      const changes = all
        ? { [photo.id]: adjust }
        : Object.fromEntries(
            Object.entries(drafts).filter(([draftId]) => alive.has(draftId)),
          );
      for (const [draftId, draftAdjust] of Object.entries(changes)) {
        checkingId = draftId;
        await (engine.preview || engine.edited)(draftId, draftAdjust);
      }
      if (all) onApplyAll(adjust);
      else onSave(changes);
    } catch (e) {
      setId(checkingId);
      toast.error(`Chưa lưu được chỉnh sửa: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  const holdCompare = {
    onPointerDown: (e) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setCompare(true);
    },
    onPointerUp: () => setCompare(false),
    onPointerCancel: () => setCompare(false),
    onKeyDown: (e) => e.key === " " && setCompare(true),
    onKeyUp: () => setCompare(false),
    onContextMenu: (e) => e.preventDefault(),
  };
  return (
    <div className="modal-backdrop editor-backdrop">
      <section
        className="photo-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Xem & chỉnh ảnh"
      >
        <header className="editor-head">
          <button className="icon-button" aria-label="Đóng" onClick={onClose}>
            <PiXBold />
          </button>
          <h2>Xem & chỉnh ảnh</h2>
          <button
            className="editor-reset"
            aria-label="Khôi phục ảnh gốc"
            title="Bỏ mọi chỉnh sửa, đưa ảnh này về như lúc chụp"
            onClick={() => {
              set(DEFAULT_ADJUST);
              toast.info("Đã khôi phục ảnh gốc cho ảnh này.");
            }}
          >
            <PiArrowCounterClockwiseBold aria-hidden="true" /> Khôi phục
          </button>
        </header>
        <div className="editor-workspace">
          <div className="editor-preview-panel">
            <div className="editor-stage">
              <canvas ref={canvas} />
              {/* Same strip as the gallery tiles: delete on the left, the heart on the right. */}
              <div className="stage-actions">
                <button
                  className="tile-btn"
                  aria-label="Xóa ảnh"
                  title="Xóa ảnh"
                  onClick={async () => {
                    if (!(await onDelete([photo.id]))) return;
                    if (photos.length > 1) move(1);
                    else onClose();
                  }}
                >
                  <PiTrashBold />
                </button>
                <button
                  className="tile-btn tile-heart"
                  aria-label="Yêu thích"
                  aria-pressed={photo.favorite}
                  title={photo.favorite ? "Bỏ tim" : "Thả tim ảnh yêu thích"}
                  onClick={() => onFavorite(photo)}
                >
                  {photo.favorite ? <PiHeartFill /> : <PiHeartBold />}
                </button>
              </div>
              {photos.length > 1 && (
                <>
                  <button
                    className="editor-prev"
                    aria-label="Ảnh trước"
                    onClick={() => move(-1)}
                  >
                    <PiCaretLeftBold />
                  </button>
                  <button
                    className="editor-next"
                    aria-label="Ảnh tiếp"
                    onClick={() => move(1)}
                  >
                    <PiCaretRightBold />
                  </button>
                </>
              )}
              {compare && <span className="editor-tag">Ảnh gốc</span>}
              {!compare && (currentStatus.message || downloadPhase) && (
                <span className="editor-status" role="status">
                  {currentStatus.message || downloadPhase}
                </span>
              )}
            </div>
            <div className="editor-below">
              <button className="compare-button" {...holdCompare}>
                <PiEyeBold /> Giữ để so sánh
              </button>
              {/* Saving to the phone is what guests look for most: a labelled button, not an icon on the photo. */}
              <button
                className="editor-download"
                aria-label="Tải ảnh về"
                disabled={!canCommit || !!downloadPhase}
                aria-busy={!!downloadPhase}
                onClick={download}
              >
                <PiDownloadSimpleBold aria-hidden="true" /> Tải ảnh về
              </button>
            </div>
            {currentStatus.kind === "error" && (
              <button className="compare-button" onClick={retryPreview}>
                <PiArrowCounterClockwiseBold />
                {currentStatus.faceError ? "Thử nhận diện lại" : "Thử lại"}
              </button>
            )}
          </div>
          <div className="editor-control-panel">
            <h3>Chỉnh ảnh</h3>
            <div className="editor-tabs" role="tablist">
              {Object.entries(ADJUST_LABELS).map(([key, label]) => {
                const Icon = ADJUST_ICONS[key];
                return (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={tab === key}
                    className={tab === key ? "active" : ""}
                    onClick={() => setTab(key)}
                  >
                    <Icon />
                    <span>{label}</span>
                    {adjust[key] > 0 && <i />}
                  </button>
                );
              })}
            </div>
            <label className="editor-slider">
              <input
                aria-label={ADJUST_LABELS[tab]}
                type="range"
                min="0"
                max="100"
                value={adjust[tab] || 0}
                onChange={(e) =>
                  set({ ...adjust, [tab]: Number(e.target.value) })
                }
              />
              <b>{adjust[tab] || 0}%</b>
            </label>
            <h3>Màu ảnh</h3>
            <div className="filter-strip" aria-label="Bộ lọc màu">
              {Object.entries(COLOR_FILTERS).map(([key, label]) => (
                <button
                  key={key}
                  className={
                    (adjust.filter || "original") === key ? "active" : ""
                  }
                  onClick={() => set({ ...adjust, filter: key })}
                >
                  {thumb ? (
                    <img
                      src={thumb}
                      alt=""
                      style={{ filter: FILTER_CSS[key] }}
                    />
                  ) : (
                    <span />
                  )}
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="editor-foot">
          <Button
            className="outline"
            disabled={!canCommit}
            onClick={() => commit(true)}
          >
            Áp dụng cho tất cả ảnh
          </Button>
          <Button disabled={!canCommit} onClick={() => commit()}>
            <PiCheckBold /> {saving ? "Đang lưu…" : "Xong"}
          </Button>
        </div>
      </section>
    </div>
  );
}
