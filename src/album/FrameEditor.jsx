import { useEffect, useRef, useState } from "react";
import {
  PiArrowCounterClockwiseBold,
  PiArrowLeftBold,
  PiArrowRightBold,
  PiMagnifyingGlassBold,
  PiMinusBold,
  PiPlusBold,
  PiShuffleBold,
  PiXBold,
} from "react-icons/pi";
import { Button, useToast } from "../studio";
import {
  DEFAULT_TRANSFORM,
  composeLayout,
  loadFrameImage,
  slotRect,
} from "../frame-utils";
import { clamp, hitSlot } from "./utils";
import { ActionBar, SheetPhoto, CarouselThumb } from "./shared";

const EMPTY_IMAGES = Object.freeze({});

// ─── Bước 3: Ghép ảnh vào khung — chạm ô trống để chọn ảnh, được dùng trùng ─
export function FrameEditor({
  engine,
  frame,
  title,
  slots,
  photos,
  adjustOf,
  onSlots,
  onReshuffle,
  onBack,
  onNext,
}) {
  const toast = useToast();
  const canvas = useRef(null);
  const [background, setBackground] = useState(null);
  const [imageState, setImageState] = useState(null);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState(() =>
    Math.max(
      0,
      slots.findIndex((s) => !s.photo),
    ),
  );
  const [picking, setPicking] = useState(null); // chỉ số ô đang chọn ảnh
  const [everySlot, setEverySlot] = useState(false);
  const missing = useRef(null);
  const [ghost, setGhost] = useState(null);
  const gesture = useRef({ pointers: new Map() });
  const drag = useRef(null);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const filledCount = slots.filter((s) => s.photo).length;

  const currentBackground =
    background?.source === frame.image && background.retry === retry
      ? background
      : { kind: "pending" };
  const bg =
    currentBackground.kind === "ready" ? currentBackground.image : null;
  const used = [...new Set(slots.map((s) => s.photo).filter(Boolean))];
  const imageKey = used
    .map((id) => `${id}:${JSON.stringify(adjustOf(id))}`)
    .join();
  const currentImages =
    imageState?.engine === engine &&
    imageState.key === imageKey &&
    imageState.retry === retry
      ? imageState
      : { kind: "pending", images: EMPTY_IMAGES };
  const images = currentImages.images;
  const error = currentBackground.error || currentImages.error;
  const canNext = !!bg && currentImages.kind === "ready";
  const message =
    error ||
    (currentBackground.kind === "pending"
      ? "Đang tải khung…"
      : currentImages.kind === "pending"
        ? "Đang xử lý ảnh trong khung…"
        : "");

  useEffect(() => {
    let live = true;
    setBackground({ source: frame.image, retry, kind: "pending" });
    loadFrameImage(frame.image).then(
      (image) =>
        live &&
        setBackground({ source: frame.image, retry, kind: "ready", image }),
      (error) =>
        live &&
        setBackground({
          source: frame.image,
          retry,
          kind: "error",
          error: error.message,
        }),
    );
    return () => {
      live = false;
    };
  }, [frame.image, retry]);
  useEffect(() => {
    let live = true;
    setImageState({
      engine,
      key: imageKey,
      retry,
      kind: "pending",
      images: EMPTY_IMAGES,
    });
    Promise.allSettled(
      used.map(async (id) => [id, await (engine.preview || engine.edited)(id, adjustOf(id), 640)]),
    ).then((list) => {
      if (!live) return;
      const failures = list.flatMap((result, index) =>
        result.status === "rejected"
          ? [{ id: used[index], error: result.reason }]
          : [],
      );
      setImageState({
        engine,
        key: imageKey,
        retry,
        kind: failures.length ? "error" : "ready",
        images: failures.length
          ? EMPTY_IMAGES
          : Object.fromEntries(list.map((result) => result.value)),
        failedIds: failures.map((failure) => failure.id),
        error: failures[0]?.error.message,
        faceError: failures.some(
          ({ error }) =>
            error.code === "FACE_INFERENCE_FAILED" ||
            error.code === "FACE_NOT_FOUND",
        ),
      });
    });
    return () => {
      live = false;
    };
  }, [engine, imageKey, retry]);
  const retryPreview = () => {
    for (const id of currentImages.failedIds || []) engine.retryFaces(id);
    setRetry((value) => value + 1);
  };
  useEffect(() => {
    const draw = () => {
      const c = canvas.current;
      if (!c) return;
      if (!bg) {
        c.width = 1;
        c.height = 1;
        return;
      }
      const scale = Math.min(
        1,
        1100 / Math.max(bg.naturalWidth, bg.naturalHeight),
      );
      const width = Math.round(bg.naturalWidth * scale);
      const height = Math.round(bg.naturalHeight * scale);
      if (c.width !== width) c.width = width;
      if (c.height !== height) c.height = height;
      composeLayout(
        c,
        bg,
        frame.slots,
        slots.map((s) => s.photo && images[s.photo]),
        slots,
      );
      const ctx = c.getContext("2d");
      // Ô trống: nền hồng nhạt + dấu "+" để khách biết chạm vào chọn ảnh.
      frame.slots.forEach((slot, i) => {
        if (slots[i]?.photo) return;
        const r = slotRect(slot, c.width, c.height);
        ctx.fillStyle = "rgba(241, 183, 189, 0.18)";
        ctx.fillRect(r.x, r.y, r.w, r.h);
        const size = Math.max(18, Math.min(r.w, r.h) * 0.22);
        ctx.fillStyle = "#4b332a";
        ctx.font = `600 ${size}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("+", r.x + r.w / 2, r.y + r.h / 2 - size * 0.3);
        ctx.font = `500 ${Math.max(11, size * 0.32)}px system-ui, sans-serif`;
        ctx.fillText(`Ô ${i + 1}`, r.x + r.w / 2, r.y + r.h / 2 + size * 0.55);
      });
      const r = slotRect(frame.slots[selected], c.width, c.height);
      ctx.lineWidth = Math.max(3, c.width / 220);
      ctx.strokeStyle =
        getComputedStyle(c).getPropertyValue("--wine").trim() || "#4b332a";
      ctx.setLineDash([ctx.lineWidth * 3, ctx.lineWidth * 2]);
      ctx.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
    };
    // Several pointer/zoom updates in a frame need only one redraw. Reuse the
    // backing bitmap instead of reallocating it on every movement.
    const request = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(request);
  }, [bg, images, slots, selected]);

  const update = (i, changes) =>
    onSlots(
      slotsRef.current.map((s, j) => (j === i ? { ...s, ...changes } : s)),
    );
  const assign = (i, photo) => update(i, { photo, ...DEFAULT_TRANSFORM });
  const current = slots[selected] || slots[0];
  const point = (x, y) => {
    const r = canvas.current.getBoundingClientRect();
    return { x: (x - r.left) / r.width, y: (y - r.top) / r.height };
  };

  // Chạm ô: ô trống → mở danh sách ảnh; ô có ảnh → chọn để kéo (1 ngón) / phóng to (2 ngón).
  function onDown(e) {
    const g = gesture.current;
    canvas.current.setPointerCapture(e.pointerId);
    g.pointers.set(e.pointerId, point(e.clientX, e.clientY));
    if (g.pointers.size === 1) {
      const hit = hitSlot(frame.slots, point(e.clientX, e.clientY));
      if (hit >= 0) setSelected(hit);
      g.slot = hit >= 0 ? hit : selected;
      g.tap = { x: e.clientX, y: e.clientY, hit };
    } else g.tap = null;
    g.start = { ...slotsRef.current[g.slot] };
    g.origin = [...g.pointers.values()];
  }
  function onMove(e) {
    const g = gesture.current;
    if (!g.pointers.has(e.pointerId)) return;
    g.pointers.set(e.pointerId, point(e.clientX, e.clientY));
    if (!slotsRef.current[g.slot]?.photo) return;
    const now = [...g.pointers.values()];
    const s = frame.slots[g.slot];
    if (now.length === 1 && g.origin.length === 1)
      update(g.slot, {
        x: clamp(g.start.x + (now[0].x - g.origin[0].x) / s.w, -1, 1),
        y: clamp(g.start.y + (now[0].y - g.origin[0].y) / s.h, -1, 1),
      });
    else if (now.length === 2 && g.origin.length === 2) {
      const d = (a) => Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1;
      update(g.slot, {
        zoom: clamp((g.start.zoom * d(now)) / d(g.origin), 1, 4),
      });
    }
  }
  function onUp(e) {
    const g = gesture.current;
    g.pointers.delete(e.pointerId);
    const tap = g.tap;
    if (
      tap &&
      !g.pointers.size &&
      Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 8
    )
      if (tap.hit >= 0 && !slotsRef.current[tap.hit]?.photo)
        setPicking(tap.hit);
    g.tap = null;
    g.start = { ...slotsRef.current[g.slot] };
    g.origin = [...g.pointers.values()];
  }

  // Dải ảnh tim: chạm = đưa vào ô đang chọn; kéo lên thả vào ô bất kỳ.
  useEffect(() => {
    const move = (e) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x,
        dy = e.clientY - d.y;
      if (!d.active && Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx))
        d.active = true;
      if (d.active) setGhost({ src: d.src, x: e.clientX, y: e.clientY });
    };
    const up = (e) => {
      const d = drag.current;
      drag.current = null;
      setGhost(null);
      if (!d) return;
      if (!d.active) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10)
          assign(selected, d.id);
        return;
      }
      if (document.elementFromPoint(e.clientX, e.clientY) !== canvas.current)
        return;
      const hit = hitSlot(frame.slots, point(e.clientX, e.clientY));
      if (hit >= 0) {
        setSelected(hit);
        assign(hit, d.id);
      }
    };
    const cancel = () => {
      drag.current = null;
      setGhost(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  });

  function pick(photoId) {
    const slot = picking;
    setPicking(null);
    if (everySlot) {
      onSlots(
        slotsRef.current.map((s) => ({
          ...s,
          photo: photoId,
          ...DEFAULT_TRANSFORM,
        })),
      );
      setEverySlot(false);
      return toast.success(`Đã dùng ảnh này cho cả ${slots.length} ô.`);
    }
    assign(slot, photoId);
    // Tự chuyển sang ô trống kế tiếp cho nhanh.
    const next = slotsRef.current.findIndex((s, i) => i !== slot && !s.photo);
    setSelected(next >= 0 ? next : slot);
  }
  function fillAll() {
    onSlots(
      slotsRef.current.map((s) => ({
        ...s,
        photo: current.photo,
        ...DEFAULT_TRANSFORM,
      })),
    );
    toast.success(`Đã dùng ảnh này cho cả ${slots.length} ô.`);
  }
  function next() {
    if (!canNext) return;
    const empty = slots.findIndex((s) => !s.photo);
    if (empty >= 0) {
      setSelected(empty);
      missing.current = toast.warning(
        `Còn ${slots.length - filledCount} ô chưa có ảnh — chạm vào ô trống để chọn ảnh.`,
      );
      return;
    }
    onNext();
  }
  const usage = (id) => slots.filter((s) => s.photo === id).length;
  // Đã điền đủ các ô: ẩn cảnh báo "còn ô trống".
  useEffect(() => {
    if (filledCount === slots.length && missing.current) {
      toast.dismiss(missing.current);
      missing.current = null;
    }
  }, [filledCount]);

  return (
    <>
      <header className="frame-nav">
        <button className="icon-button" aria-label="Quay lại" onClick={onBack}>
          <PiArrowLeftBold />
        </button>
        <strong>{title}</strong>
        <span>
          {filledCount}/{slots.length} ô
        </span>
      </header>
      <div className="frame-workspace">
        <div className="frame-preview-panel">
          <div className="frame-canvas">
            <canvas
              ref={canvas}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onWheel={(e) =>
                current.photo &&
                update(selected, {
                  zoom: clamp(
                    current.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08),
                    1,
                    4,
                  ),
                })
              }
            />
          </div>
          {message && (
            <p className="frame-hint" role="status">
              {message}
            </p>
          )}
          {error && (
            <Button className="outline" onClick={retryPreview}>
              <PiArrowCounterClockwiseBold />
              {currentImages.faceError ? "Thử nhận diện lại" : "Thử lại"}
            </Button>
          )}
          <p className="frame-hint">
            Chạm ô để chọn · kéo để di chuyển · chụm 2 ngón để phóng to
          </p>

          <div className="photo-carousel" aria-label="Ảnh yêu thích">
            {photos.map((p) => (
              <CarouselThumb
                key={p.id}
                engine={engine}
                photo={p}
                active={p.id === current.photo}
                count={usage(p.id)}
                onStart={(e, src) => {
                  drag.current = {
                    id: p.id,
                    src,
                    x: e.clientX,
                    y: e.clientY,
                    active: false,
                  };
                }}
                onPick={() => assign(selected, p.id)}
              />
            ))}
          </div>
        </div>
        <div className="slot-tools" aria-label={`Ô ${selected + 1}`}>
          <div className="slot-tools-head">
            <strong>Ô {selected + 1}</strong>
            <div className="slot-tools-actions">
              <button
                className="text-link"
                onClick={() => setPicking(selected)}
              >
                {current.photo ? "Đổi ảnh" : "Chọn ảnh"}
              </button>
              {current.photo && slots.length > 1 && (
                <button className="text-link" onClick={fillAll}>
                  Dùng cho tất cả ô
                </button>
              )}
              {current.photo && (
                <button
                  className="text-link"
                  onClick={() => update(selected, DEFAULT_TRANSFORM)}
                >
                  Đặt lại
                </button>
              )}
            </div>
          </div>
          <fieldset className="tool-rows" disabled={!current.photo}>
            <div className="tool-row">
              <button
                aria-label="Thu nhỏ"
                onClick={() =>
                  update(selected, { zoom: clamp(current.zoom - 0.1, 1, 4) })
                }
              >
                <PiMinusBold />
              </button>
              <PiMagnifyingGlassBold className="tool-icon" />
              <input
                aria-label="Phóng to ảnh"
                type="range"
                min="1"
                max="4"
                step="0.01"
                value={current.zoom}
                onChange={(e) =>
                  update(selected, { zoom: Number(e.target.value) })
                }
              />
              <button
                aria-label="Phóng to"
                onClick={() =>
                  update(selected, { zoom: clamp(current.zoom + 0.1, 1, 4) })
                }
              >
                <PiPlusBold />
              </button>
            </div>
            <div className="tool-row">
              <button
                aria-label="Xoay về 0°"
                onClick={() => update(selected, { rotate: 0 })}
              >
                <PiArrowCounterClockwiseBold />
              </button>
              <input
                aria-label="Góc xoay"
                type="range"
                min="-180"
                max="180"
                step="1"
                value={current.rotate}
                onChange={(e) =>
                  update(selected, { rotate: Number(e.target.value) })
                }
              />
              <b>{current.rotate}°</b>
            </div>
          </fieldset>
        </div>
      </div>

      <ActionBar>
        <Button className="outline" onClick={onReshuffle}>
          <PiShuffleBold /> Xếp lại
        </Button>
        <Button disabled={!canNext} onClick={next}>
          Xem kết quả <PiArrowRightBold />
        </Button>
      </ActionBar>
      {ghost && (
        <img
          className="drag-ghost"
          src={ghost.src}
          alt=""
          style={{ left: ghost.x, top: ghost.y }}
        />
      )}
      {picking !== null && (
        <div className="modal-backdrop" onClick={() => setPicking(null)}>
          <section
            className="modal photo-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={`Chọn ảnh cho ô ${picking + 1}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>Chọn ảnh cho ô {picking + 1}</h3>
              <button
                className="icon-button"
                aria-label="Đóng"
                onClick={() => setPicking(null)}
              >
                <PiXBold />
              </button>
            </div>
            <p className="muted">Một ảnh có thể dùng cho nhiều ô.</p>
            {slots.length > 1 && (
              <label className="checkbox sheet-every">
                <input
                  type="checkbox"
                  checked={everySlot}
                  onChange={(e) => setEverySlot(e.target.checked)}
                />
                Dùng ảnh chọn cho tất cả {slots.length} ô
              </label>
            )}
            <div className="photo-sheet-grid">
              {photos.map((p) => (
                <SheetPhoto
                  key={p.id}
                  engine={engine}
                  photo={p}
                  count={usage(p.id)}
                  active={slots[picking]?.photo === p.id}
                  onPick={() => pick(p.id)}
                />
              ))}
            </div>
            {!photos.length && (
              <p className="center muted">Chưa có ảnh yêu thích.</p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
