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
  PiImageBold,
  PiSparkleBold,
  PiTextTBold,
  PiStickerBold,
  PiSignatureBold,
  PiTrashBold,
} from "react-icons/pi";
import { Button, useStudio, useToast } from "../studio";
import {
  DEFAULT_TRANSFORM,
  composeLayout,
  loadFrameImage,
  slotRect,
} from "../frame-utils";
import { qrImage } from "../qr-image.js";
import { clamp, hitSlot } from "./utils";
import { ActionBar, SheetPhoto, CarouselThumb } from "./shared";
import {
  DECOR_COLORS,
  DECOR_FONTS,
  DECOR_STICKERS,
  MAX_DRAWING_POINTS,
  decorationBox,
  hitDecoration,
  decorationsReady,
  preloadDecorations,
} from "./decorations";

const EMPTY_IMAGES = Object.freeze({});
const NO_DECORATIONS = Object.freeze([]);

// ─── Bước 3: Ghép ảnh vào khung — chạm ô trống để chọn ảnh, được dùng trùng ─
export function FrameEditor({
  engine,
  frame,
  title,
  slots,
  decorations = NO_DECORATIONS,
  photos,
  adjustOf,
  onSlots,
  onDecorations = () => {},
  onReshuffle,
  onBack,
  onNext,
}) {
  const toast = useToast();
  const { stickers: shopStickers = [] } = useStudio();
  const canvas = useRef(null);
  // "photo": chỉnh ảnh trong ô; "decor": thêm chữ / sticker / ký tên lên khung.
  const [mode, setMode] = useState("photo");
  const [decorIndex, setDecorIndex] = useState(-1);
  const [stickers, setStickers] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [brush, setBrush] = useState({ color: "#382b26", width: 6 });
  const decorRef = useRef(decorations);
  decorRef.current = decorations;
  const decorDrag = useRef(null);
  const liveRef = useRef(null);
  const selectedDecor = decorations[decorIndex];
  // Sticker ảnh nạp xong thì vẽ lại khung.
  const [stickerLoads, setStickerLoads] = useState(0);
  // Mã QR của khung (vùng "Thêm QR" của quản trị) = link album này; vẽ lại khi tạo xong.
  const [qr, setQr] = useState(null);
  const hasQr = frame.marks?.some((m) => m.kind === "qr");
  useEffect(() => {
    if (!hasQr) return;
    let live = true;
    qrImage(window.location.origin + window.location.pathname).then((image) => live && setQr(image), () => {});
    return () => {
      live = false;
    };
  }, [hasQr]);
  useEffect(() => {
    // Kéo / sửa chữ liên tục: sticker đã nạp thì không vẽ lại thêm lần nữa.
    if (decorationsReady(decorations)) return;
    let live = true;
    preloadDecorations(decorations).then(() => live && setStickerLoads((n) => n + 1));
    return () => { live = false; };
  }, [decorations]);
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
        decorations,
        // Trang album là /album/<mã>: QR trên khung mở đúng album này.
        { frame, qr },
      );
      const ctx = c.getContext("2d");
      if (mode === "decor") {
        if (!selectedDecor) return;
        const b = decorationBox(ctx, selectedDecor, c.width, c.height);
        ctx.lineWidth = Math.max(2, c.width / 400);
        ctx.strokeStyle = "#7a4b36";
        ctx.setLineDash([ctx.lineWidth * 3, ctx.lineWidth * 2]);
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        return;
      }
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
  }, [bg, images, slots, selected, decorations, mode, selectedDecor, stickerLoads, qr]);

  const setDecor = (items) => onDecorations(items);
  const patchDecor = (i, changes) =>
    setDecor(decorRef.current.map((d, j) => (j === i ? { ...d, ...changes } : d)));
  function addDecor(item) {
    if (decorRef.current.length >= 40)
      return toast.warning("Khung đã có nhiều trang trí — xóa bớt rồi thêm tiếp nhé.");
    setDecor([...decorRef.current, item]);
    setDecorIndex(decorRef.current.length);
    setDrawing(false);
  }
  function removeDecor(i) {
    setDecor(decorRef.current.filter((_, j) => j !== i));
    setDecorIndex(-1);
  }
  // Nét đang ký vẽ thẳng từng đoạn lên khung (giống drawDecorations), không vẽ lại cả khung
  // theo mỗi lần di ngón tay; nhấc tay mới lưu nét và vẽ lại một lần.
  function drawSegment(stroke, from, to) {
    const c = canvas.current;
    const ctx = c.getContext("2d");
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = Math.max(1, Math.min(40, stroke.width)) * c.width / 1200;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(from[0] * c.width, from[1] * c.height);
    ctx.lineTo(to[0] * c.width + (from === to ? 0.1 : 0), to[1] * c.height);
    ctx.stroke();
    ctx.restore();
  }
  // Chạm khung ở chế độ trang trí: vẽ chữ ký, hoặc chọn rồi kéo chữ / sticker.
  function decorDown(e, p) {
    const c = canvas.current;
    if (drawing) {
      const start = [+p.x.toFixed(4), +p.y.toFixed(4)];
      liveRef.current = { type: "drawing", color: brush.color, width: brush.width, points: [start] };
      drawSegment(liveRef.current, start, start);
      return;
    }
    const hit = hitDecoration(c.getContext("2d"), decorRef.current, p.x * c.width, p.y * c.height,
      c.width, c.height);
    setDecorIndex(hit);
    decorDrag.current = hit >= 0 ? { index: hit, origin: p, start: decorRef.current[hit] } : null;
  }
  function decorMove(p) {
    if (drawing) {
      const s = liveRef.current;
      if (!s || s.points.length >= MAX_DRAWING_POINTS) return;
      const [lx, ly] = s.points[s.points.length - 1];
      if (Math.hypot(p.x - lx, p.y - ly) < 0.002) return;
      const next = [+clamp(p.x, 0, 1).toFixed(4), +clamp(p.y, 0, 1).toFixed(4)];
      s.points.push(next);
      drawSegment(s, [lx, ly], next);
      return;
    }
    const d = decorDrag.current;
    if (!d) return;
    const dx = p.x - d.origin.x, dy = p.y - d.origin.y;
    patchDecor(d.index, d.start.type === "drawing"
      ? { points: d.start.points.map(([x, y]) => [clamp(x + dx, 0, 1), clamp(y + dy, 0, 1)]) }
      : { x: clamp(d.start.x + dx, 0, 1), y: clamp(d.start.y + dy, 0, 1) });
  }
  function decorUp() {
    decorDrag.current = null;
    const stroke = liveRef.current;
    liveRef.current = null;
    if (!stroke) return;
    if (decorRef.current.length >= 40) {
      setStickerLoads((n) => n + 1); // xóa nét chưa lưu khỏi khung
      return toast.warning("Khung đã có nhiều trang trí — xóa bớt rồi vẽ tiếp nhé.");
    }
    setDecor([...decorRef.current, stroke]);
  }
  function undoStroke() {
    const last = decorRef.current.map((d) => d.type).lastIndexOf("drawing");
    if (last >= 0) removeDecor(last);
  }
  const swatches = (value, onPick) => (
    <div className="decor-colors" role="radiogroup" aria-label="Màu">
      {DECOR_COLORS.map((color) => (
        <button key={color} role="radio" aria-checked={value === color} aria-label={color}
          style={{ background: color }} onClick={() => onPick(color)} />
      ))}
    </div>
  );
  function decorPanel() {
    const item = selectedDecor;
    return (
      <div className="decor-tools">
        <div className="decor-add">
          <button onClick={() => addDecor({ type: "text", text: "Kỷ niệm của tụi mình",
            font: "handwritten", color: "#382b26", size: 56, x: 0.5, y: 0.92 })}>
            <PiTextTBold /> Thêm chữ
          </button>
          <button aria-pressed={stickers} onClick={() => { setStickers((v) => !v); setDrawing(false); }}>
            <PiStickerBold /> Nhãn dán
          </button>
          <button aria-pressed={drawing} onClick={() => {
            setDrawing((v) => !v); setStickers(false); setDecorIndex(-1);
          }}>
            <PiSignatureBold /> Ký tên
          </button>
        </div>
        {stickers && (
          <div className="decor-stickers">
            {shopStickers.map((s) => (
              <button key={s._id} aria-label={`Nhãn dán ${s.name}`}
                onClick={() => addDecor({ type: "sticker", src: s.image, size: 60,
                  x: 0.3 + Math.random() * 0.4, y: 0.3 + Math.random() * 0.4 })}>
                <img src={s.thumb || s.image} alt="" loading="lazy" decoding="async" />
              </button>
            ))}
            {DECOR_STICKERS.map((s) => (
              <button key={s} aria-label={`Nhãn dán ${s}`}
                onClick={() => addDecor({ type: "sticker", text: s, size: 90,
                  x: 0.3 + Math.random() * 0.4, y: 0.3 + Math.random() * 0.4 })}>
                {s}
              </button>
            ))}
          </div>
        )}
        {drawing ? (
          <div className="decor-edit">
            <p className="muted">Dùng ngón tay ký hoặc vẽ trực tiếp lên khung.</p>
            {swatches(brush.color, (color) => setBrush((b) => ({ ...b, color })))}
            <label>
              Độ dày nét
              <input type="range" min="2" max="24" value={brush.width}
                onChange={(e) => setBrush((b) => ({ ...b, width: Number(e.target.value) }))} />
            </label>
            <div className="decor-row">
              <Button className="outline" onClick={undoStroke}>Hoàn tác nét</Button>
              <Button onClick={() => setDrawing(false)}>Xong</Button>
            </div>
          </div>
        ) : item ? (
          <div className="decor-edit">
            {item.type !== "drawing" && item.type !== "sticker" && (
              <>
                <label>
                  Nội dung
                  <input value={item.text || ""} maxLength={100}
                    onChange={(e) => patchDecor(decorIndex, { text: e.target.value })} />
                </label>
                <div className="decor-fonts" role="radiogroup" aria-label="Phông chữ">
                  {Object.entries(DECOR_FONTS).map(([key, f]) => (
                    <button key={key} role="radio" aria-checked={(item.font || "sans") === key}
                      style={{ fontFamily: f.css }} onClick={() => patchDecor(decorIndex, { font: key })}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </>
            )}
            {item.type !== "sticker" &&
              swatches(item.color, (color) => patchDecor(decorIndex, { color }))}
            {item.type !== "drawing" && (
              <label>
                Cỡ {item.type === "sticker" ? "nhãn dán" : "chữ"}
                <input type="range" min="16" max="160" value={item.size || 36}
                  onChange={(e) => patchDecor(decorIndex, { size: Number(e.target.value) })} />
              </label>
            )}
            <Button className="outline danger" onClick={() => removeDecor(decorIndex)}>
              <PiTrashBold /> Xóa mục này
            </Button>
          </div>
        ) : (
          <p className="muted">
            Thêm chữ, nhãn dán hoặc ký tên. Chạm vào một mục trên khung để chỉnh, kéo để di chuyển.
          </p>
        )}
      </div>
    );
  }

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
    if (mode === "decor") return decorDown(e, point(e.clientX, e.clientY));
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
    if (mode === "decor") return decorMove(point(e.clientX, e.clientY));
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
    if (mode === "decor") return decorUp();
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
                mode === "photo" &&
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
            {mode === "photo"
              ? "Chạm ô để chọn · kéo để di chuyển · chụm 2 ngón để phóng to"
              : drawing
                ? "Đang ký tên · vẽ bằng ngón tay trên khung"
                : "Chạm chữ / nhãn dán để chỉnh · kéo để di chuyển"}
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
        <div className="slot-tools" aria-label={mode === "photo" ? `Ô ${selected + 1}` : "Trang trí khung"}>
          <div className="editor-mode" role="tablist" aria-label="Chế độ chỉnh">
            <button role="tab" aria-selected={mode === "photo"}
              onClick={() => { setMode("photo"); setDrawing(false); setStickers(false); }}>
              <PiImageBold /> Ảnh
            </button>
            <button role="tab" aria-selected={mode === "decor"} onClick={() => setMode("decor")}>
              <PiSparkleBold /> Trang trí
            </button>
          </div>
          {mode === "decor" ? decorPanel() : (<>
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
          </>)}
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
