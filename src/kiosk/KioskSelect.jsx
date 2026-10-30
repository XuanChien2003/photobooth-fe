import { useEffect, useMemo, useRef, useState } from "react";
import {
  PiArrowLeftBold,
  PiArrowRightBold,
  PiCheckBold,
  PiImagesBold,
  PiMinusBold,
  PiPaletteBold,
  PiPlusBold,
  PiPrinterBold,
  PiStickerBold,
  PiTrashBold,
} from "react-icons/pi";
import { Button, useToast } from "../studio";
import { composePreview, previewBitmap } from "./compose.js";
import {
  MAX_STICKERS,
  STICKER_SCALE,
  clampScale,
  drawStickers,
  hitSticker,
  loadStickers,
  photoAt,
  photoFilterId,
  photoRects,
  stickerArea,
  stickerBoxes,
  stickersReady,
} from "./decor.js";
import { useObjectUrl } from "./KioskShoot.jsx";
import { useKioskText } from "./use-kiosk-text.js";

// Ảnh xem nhanh của các tấm đã chụp, giải mã một lần cho cả bước chọn ảnh và chọn khung.
export function useShotBitmaps(shots, token) {
  const [bitmaps, setBitmaps] = useState(() => new Map());
  // Ảnh đã đọc của lượt hiện tại. Kết quả đọc xong giữ lại kể cả khi danh sách tấm vừa đổi (ảnh gốc
  // tải lên xong làm cập nhật lượt chụp) — bỏ đi thì tấm đó không bao giờ được đọc lại và khung
  // ghép xem trước bị trống ô.
  const store = useRef({ token, loading: new Set(), map: bitmaps });
  useEffect(() => {
    let s = store.current;
    // Lượt khách mới, hoặc đã rời bước chọn ảnh / khung: giải phóng ảnh đã giải mã (~10 MB mỗi tấm;
    // máy chụp mở cả ngày).
    if (s.token !== token || !shots.length) {
      if (s.map.size || s.loading.size) {
        for (const bitmap of s.map.values()) bitmap.close?.();
        s = store.current = { token, loading: new Set(), map: new Map() };
        setBitmaps(s.map);
      } else s.token = token;
    }
    for (const shot of shots) {
      if (s.loading.has(shot.key)) continue;
      s.loading.add(shot.key);
      previewBitmap(shot, token).then(
        (bitmap) => {
          if (store.current !== s) return bitmap.close?.();
          s.map = new Map(s.map).set(shot.key, bitmap);
          setBitmaps(s.map);
        },
        () => s.loading.delete(shot.key),
      );
    }
  }, [shots, token]);
  useEffect(() => () => {
    for (const bitmap of store.current.map.values()) bitmap.close?.();
    store.current = { token: null, loading: new Set(), map: new Map() };
  }, []);
  return bitmaps;
}

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const spread = (points) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) || 1;

// Khung ghép xem trước: ảnh đã chọn (đã áp màu ảnh) ghép vào khung, nhãn dán vẽ lên trên.
// Kéo nhãn dán để di chuyển, chụm / mở 2 ngón để thu nhỏ / phóng to. Ô chưa có ảnh hiện số thứ tự.
// stickers: danh sách đang hiển thị (kể cả lúc đang kéo); onDraft khi đang kéo, onCommit khi nhấc tay.
// filters: màu của từng ảnh (cùng thứ tự images). highlight: ảnh đang chọn màu (viền đứt nét);
// onPhotoTap: chạm vào một ảnh trong khung (không trúng nhãn dán).
function DecorStage({
  frame, images, imageKey, qrUrl, filters, filterKey, stickers, picked, onPick, onDraft, onCommit,
  highlight = -1, onPhotoTap = null,
}) {
  const canvas = useRef(null);
  const [base, setBase] = useState(null);
  const [loads, setLoads] = useState(0);
  const area = useMemo(() => stickerArea(frame), [frame]);
  const live = useRef(stickers);
  live.current = stickers;
  const gesture = useRef(null);
  const latestBase = useRef(null);
  // Nền (khung + ảnh đã áp màu) chỉ ghép lại khi đổi khung, ảnh hoặc màu ảnh; nhãn dán vẽ đè mỗi lần.
  useEffect(() => {
    let alive = true;
    composePreview(frame, images, 700, qrUrl, { placeholders: true, filters })
      .then((next) => {
        if (!alive) return void (next.width = next.height = 0);
        const old = latestBase.current;
        latestBase.current = next;
        setBase(next);
        if (old) old.width = old.height = 0;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [frame._id, imageKey, filterKey]);
  useEffect(() => () => {
    if (latestBase.current) latestBase.current.width = latestBase.current.height = 0;
  }, []);
  // Ảnh nhãn dán của tiệm nạp xong thì vẽ lại.
  useEffect(() => {
    if (stickersReady(stickers)) return;
    let alive = true;
    loadStickers(stickers).then(() => alive && setLoads((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [stickers]);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !base?.width) return;
    const request = requestAnimationFrame(() => {
      if (!base.width) return;
      if (c.width !== base.width) c.width = base.width;
      if (c.height !== base.height) c.height = base.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(base, 0, 0);
      drawStickers(ctx, stickers, area, c.width, c.height);
      // Ảnh đang chọn màu riêng: viền đứt nét quanh các ô của ảnh đó (chỉ trên màn hình).
      if (highlight >= 0) {
        const line = Math.max(3, c.width / 200);
        for (const r of photoRects(frame, highlight, c.width, c.height)) {
          ctx.save();
          ctx.lineWidth = line * 2;
          ctx.strokeStyle = "rgb(255 255 255 / 90%)";
          ctx.strokeRect(r.x + line, r.y + line, r.w - line * 2, r.h - line * 2);
          ctx.lineWidth = line;
          ctx.strokeStyle = "#4caf6e";
          ctx.setLineDash([line * 3, line * 2]);
          ctx.strokeRect(r.x + line, r.y + line, r.w - line * 2, r.h - line * 2);
          ctx.restore();
        }
      }
      const index = stickers.findIndex((s) => s.id === picked);
      if (index < 0) return;
      // Nhãn dán đang chọn: viền đứt nét (cả bản lặp ở dải thứ hai) — chỉ trên màn hình, không in.
      const line = Math.max(2, c.width / 280);
      for (const box of stickerBoxes(ctx, stickers, area, index, c.width, c.height)) {
        ctx.save();
        ctx.lineWidth = line * 2.4;
        ctx.strokeStyle = "rgb(255 255 255 / 85%)";
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        ctx.lineWidth = line;
        ctx.strokeStyle = "#522e22";
        ctx.setLineDash([line * 3, line * 2]);
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        ctx.restore();
      }
    });
    return () => cancelAnimationFrame(request);
  }, [base, stickers, picked, loads, area, highlight]);

  // Điểm chạm đổi sang px của canvas (canvas co giãn theo màn hình, giữ tỉ lệ).
  const point = (e) => {
    const c = canvas.current;
    const r = c.getBoundingClientRect();
    const k = Math.min(r.width / c.width, r.height / c.height) || 1;
    return {
      x: (e.clientX - r.left - (r.width - c.width * k) / 2) / k,
      y: (e.clientY - r.top - (r.height - c.height * k) / 2) / k,
    };
  };
  // Giữ ngón tay với khung kể cả khi kéo ra ngoài (con trỏ không còn hoạt động thì bỏ qua).
  const capture = (e) => {
    try {
      canvas.current.setPointerCapture(e.pointerId);
    } catch {
      /* con trỏ đã nhấc */
    }
  };
  function down(e) {
    const c = canvas.current;
    if (!base) return;
    const p = point(e);
    const g = gesture.current;
    // Ngón đầu tiên (isPrimary) luôn bắt đầu thao tác mới, kể cả khi màn cảm ứng làm mất lần nhấc tay trước.
    if (g && !e.isPrimary) {
      // Ngón thứ hai: chụm / mở để đổi cỡ nhãn dán đang kéo.
      capture(e);
      g.pointers.set(e.pointerId, p);
      const sticker = (g.list || live.current).find((s) => s.id === g.id);
      if (g.pointers.size === 2 && sticker)
        g.pinch = { spread: spread([...g.pointers.values()]), scale: clampScale(sticker.scale) };
      return;
    }
    gesture.current = null;
    const hit = hitSticker(c.getContext("2d"), live.current, area, p.x, p.y, c.width, c.height);
    if (hit < 0) {
      onPick(null);
      const photo = onPhotoTap ? photoAt(frame, p.x / c.width, p.y / c.height) : -1;
      if (photo >= 0) onPhotoTap(photo);
      return;
    }
    const sticker = live.current[hit];
    capture(e);
    gesture.current = { id: sticker.id, pointers: new Map([[e.pointerId, p]]), origin: p, start: sticker, list: null };
    onPick(sticker.id);
  }
  function move(e) {
    const g = gesture.current;
    if (!g?.pointers.has(e.pointerId)) return;
    const c = canvas.current;
    g.pointers.set(e.pointerId, point(e));
    const points = [...g.pointers.values()];
    let changes = null;
    if (points.length >= 2 && g.pinch)
      changes = { scale: clampScale((g.pinch.scale * spread(points)) / g.pinch.spread) };
    else if (points.length === 1)
      changes = {
        u: clamp01(g.start.u + (points[0].x - g.origin.x) / (area.w * c.width)),
        v: clamp01(g.start.v + (points[0].y - g.origin.y) / (area.h * c.height)),
      };
    if (!changes) return;
    g.list = (g.list || live.current).map((s) => (s.id === g.id ? { ...s, ...changes } : s));
    onDraft(g.list);
  }
  function up(e) {
    const g = gesture.current;
    if (!g?.pointers.has(e.pointerId)) return;
    g.pointers.delete(e.pointerId);
    if (g.pointers.size) {
      // Nhấc một ngón sau khi chụm: ngón còn lại kéo tiếp từ chỗ đang đứng.
      const [p] = g.pointers.values();
      g.origin = p;
      g.start = (g.list || live.current).find((s) => s.id === g.id) || g.start;
      g.pinch = null;
      return;
    }
    gesture.current = null;
    if (g.list) onCommit(g.list);
  }
  return (
    <canvas
      ref={canvas}
      className={`frame-preview decor-canvas${base ? "" : " is-loading"}`}
      role="img"
      aria-label={`Khung ảnh xem trước: ${frame.themeName?.trim() || frame.name || "khung ảnh"}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    />
  );
}

function Pick({ shot, order, onToggle, disabled }) {
  const src = useObjectUrl(shot.preview);
  return (
    <button
      type="button"
      className={`select-shot ${order ? "is-picked" : ""}`}
      aria-pressed={Boolean(order)}
      disabled={disabled && !order}
      onClick={() => onToggle(shot.key)}
    >
      {src && <img src={src} alt="" loading="lazy" />}
      {order ? <span className="select-order">{order}</span> : null}
    </button>
  );
}

// Ảnh nhỏ trong hàng "Áp dụng cho": số thứ tự trong khung và tên màu riêng (nếu có).
function TargetChip({ shot, number, active, label, css, onPick }) {
  const src = useObjectUrl(shot?.preview);
  return (
    <button type="button" role="radio" aria-checked={active} aria-label={`Ảnh ${number}`} className="color-target-photo" onClick={onPick}>
      {src ? <img src={src} alt="" style={{ filter: css }} /> : <i aria-hidden="true" />}
      <b>{number}</b>
      {label && <small>{label}</small>}
    </button>
  );
}

// Màu ảnh: mỗi lựa chọn hiện ảnh khách đã chọn với màu đó (CSS filter cùng công thức với ảnh in).
function ColorChoices({ shot, filters, value, onChange }) {
  const src = useObjectUrl(shot?.preview);
  return (
    <div className="select-filters" role="radiogroup" aria-label="Màu ảnh">
      {filters.map((f) => (
        <button key={f.id} type="button" role="radio" aria-checked={value === f.id} onClick={() => onChange(f.id)}>
          {src ? <img src={src} alt="" style={{ filter: f.css }} /> : <i aria-hidden="true" />}
          <span>{f.label}</span>
        </button>
      ))}
    </div>
  );
}

const TABS = {
  photos: ["Chọn ảnh", PiImagesBold],
  color: ["Màu ảnh", PiPaletteBold],
  stickers: ["Nhãn dán", PiStickerBold],
};

// Chụp xong: bên trái khung ghép xem trước (nút ‹ › đổi khung), bên phải 3 mục:
// Chọn ảnh — chọn đủ số ảnh của gói (vd. gói 70k chọn 4 tấm); Màu ảnh — một filter cho tất cả ảnh
// hoặc riêng từng ảnh; Nhãn dán — dán, kéo, phóng to / thu nhỏ trên khung. Bấm "In ảnh" (hoặc hết giờ) để ghép
// bản in với đúng màu ảnh và nhãn dán đang thấy rồi gửi máy in.
export function KioskSelect({
  shots, bitmaps, count, selected, onToggle, secondsLeft,
  frames, index, setIndex, onConfirm, busy, prints, qrUrl,
  filters = [], decor, onDecor, shopStickers = [],
}) {
  const toast = useToast();
  const t = useKioskText();
  const frame = frames[index];
  const ready = selected.filter((key) => bitmaps.has(key));
  const images = ready.map((key) => bitmaps.get(key));
  const full = selected.length >= count;
  const move = (by) => frames.length > 1 && setIndex((index + by + frames.length) % frames.length);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // Không có khung thì không có gì để trang trí: chỉ chọn ảnh. Nhãn dán chỉ lấy từ trang quản trị
  // Thiết lập → Nhãn dán (không có bộ biểu tượng dựng sẵn): tiệm chưa tải nhãn dán nào thì ẩn mục.
  const tabs = [
    "photos",
    ...(frame && filters.length > 1 ? ["color"] : []),
    ...(frame && shopStickers.length ? ["stickers"] : []),
  ];
  const [tab, setTab] = useState("photos");
  const current = tabs.includes(tab) ? tab : "photos";
  const panel = (id) =>
    tabs.length > 1 ? { role: "tabpanel", id: `select-panel-${id}`, "aria-labelledby": `select-tab-${id}` } : {};
  const [picked, setPicked] = useState(null);
  const open = (next) => {
    setTab(next);
    if (next !== "stickers") setPicked(null);
  };
  // Chọn đủ ảnh lần đầu: mở luôn mục kế tiếp để khách thấy bước màu ảnh / nhãn dán.
  const advanced = useRef(full);
  useEffect(() => {
    if (!full || advanced.current) return;
    advanced.current = true;
    if (current === "photos" && tabs.length > 1) open(tabs[1]);
  }, [full]);

  // Màu ảnh: áp cho tất cả ảnh ("all") hoặc riêng một tấm (mã tấm ảnh).
  const [colorTarget, setColorTarget] = useState("all");
  const target = colorTarget !== "all" && selected.includes(colorTarget) ? colorTarget : "all";
  const choiceOf = (id) => filters.find((f) => f.id === id) || filters[0];
  const photoFilters = decor?.photoFilters || {};
  const filterOf = (key) => choiceOf(photoFilterId(decor, key));
  const shownFilter = target === "all" ? choiceOf(decor?.filter) : filterOf(target);
  // Màu riêng chỉ tính khi khác màu chung (ảnh vẫn theo màu chung thì không ghi nhãn).
  const ownColor = (key) => photoFilters[key] && photoFilters[key] !== (decor?.filter || "original");
  const applyColor = (id) =>
    target === "all"
      ? onDecor({ filter: id, photoFilters: {} })
      : onDecor({ photoFilters: { ...photoFilters, [target]: id } });
  const readyFilters = ready.map((key) => filterOf(key));
  const [draft, setDraft] = useState(null);
  const stickers = draft || decor?.stickers || [];
  const pickedIndex = stickers.findIndex((s) => s.id === picked);
  const scale = pickedIndex >= 0 ? clampScale(stickers[pickedIndex].scale) : 0;
  const area = useMemo(() => (frame ? stickerArea(frame) : null), [frame]);
  const saveStickers = (list) => {
    setDraft(null);
    onDecor({ stickers: list });
  };
  function addSticker(source) {
    if (stickers.length >= MAX_STICKERS)
      return toast.warning(`Khung đã có ${MAX_STICKERS} nhãn dán — xóa bớt rồi thêm tiếp nhé.`);
    // Dán gần giữa khung, lệch ngẫu nhiên một chút để nhiều nhãn dán không chồng khít lên nhau.
    const near = () => 0.5 + (Math.random() - 0.5) * 0.3;
    const sticker = { id: crypto.randomUUID().slice(0, 8), ...source, scale: STICKER_SCALE.initial, u: near(), v: near() };
    saveStickers([...stickers, sticker]);
    setPicked(sticker.id);
  }
  const resize = (factor) =>
    saveStickers(stickers.map((s) => (s.id === picked ? { ...s, scale: clampScale(scale * factor) } : s)));
  const removePicked = () => {
    saveStickers(stickers.filter((s) => s.id !== picked));
    setPicked(null);
  };
  const clearStickers = () => {
    saveStickers([]);
    setPicked(null);
  };
  const thumbShot = shots.find((s) => s.key === (target === "all" ? selected[0] : target)) || shots[0];
  const lead = {
    photos: `Chọn ${count} tấm để ghép khung · đã chọn ${selected.length}/${count}`,
    color: "Chọn màu cho tất cả ảnh hoặc từng ảnh — khung và nhãn dán giữ nguyên màu",
    stickers: "Chạm nhãn dán để dán lên khung · kéo trên khung để di chuyển",
  }[current];
  return (
    <section className="kiosk-flow select-screen">
      <header className="flow-head">
        <h1>
          {/* Tiêu đề sửa ở quản trị; {s} là số giây còn lại (gạch chân). */}
          {(() => {
            const [before, after] = t("select.title").split("{s}");
            return after === undefined
              ? <>{before} · <u>{secondsLeft}s</u></>
              : <>{before}<u>{secondsLeft}</u>{after}</>;
          })()}
        </h1>
        <p>{lead}</p>
      </header>
      <div className="select-layout">
        <div className="select-preview">
          {frame ? (
            <div className="select-frame-stage">
              <button type="button" className="frame-arrow" aria-label="Khung trước" onClick={() => move(-1)} disabled={frames.length < 2}>
                <PiArrowLeftBold />
              </button>
              <DecorStage
                key={frame._id}
                frame={frame}
                images={images}
                imageKey={`${ready.join()}|${count}`}
                qrUrl={qrUrl}
                filters={readyFilters.map((f) => f?.steps || null)}
                filterKey={readyFilters.map((f) => `${f?.id}|${f?.css}`).join()}
                highlight={current === "color" && target !== "all" ? ready.indexOf(target) : -1}
                onPhotoTap={current === "color" ? (photo) => ready[photo] && setColorTarget(ready[photo]) : null}
                stickers={stickers}
                picked={picked}
                onPick={(id) => {
                  setPicked(id);
                  if (id) setTab("stickers");
                }}
                onDraft={setDraft}
                onCommit={saveStickers}
              />
              <button type="button" className="frame-arrow" aria-label="Khung sau" onClick={() => move(1)} disabled={frames.length < 2}>
                <PiArrowRightBold />
              </button>
            </div>
          ) : (
            <p className="frame-none" role="status">Tiệm chưa có khung ảnh — chọn ảnh rồi bấm “Nhận ảnh”.</p>
          )}
          {frame && (
            <p className="select-frame-name">
              {frame.themeName?.trim() || frame.name}
              {frames.length > 1 && <> · khung {index + 1}/{frames.length}</>}
            </p>
          )}
        </div>
        <i className="select-divider" aria-hidden="true" />
        <div className="select-panel">
          {tabs.length > 1 && (
            <div className="select-tabs" role="tablist" aria-label="Chọn ảnh và trang trí">
              {tabs.map((id) => {
                const [label, Icon] = TABS[id];
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    id={`select-tab-${id}`}
                    aria-selected={current === id}
                    aria-controls={`select-panel-${id}`}
                    onClick={() => open(id)}
                  >
                    <Icon aria-hidden="true" />
                    <span>{label}</span>
                    {id === "photos" && <small>{selected.length}/{count}</small>}
                  </button>
                );
              })}
            </div>
          )}
          {current === "photos" && (
            <div className="select-tab-panel" {...panel("photos")}>
              <div className="select-grid" role="group" aria-label="Ảnh đã chụp">
                {shots.map((shot) => (
                  <Pick
                    key={shot.key}
                    shot={shot}
                    order={selected.indexOf(shot.key) + 1}
                    disabled={full}
                    onToggle={onToggle}
                  />
                ))}
              </div>
            </div>
          )}
          {current === "color" && (
            <div className="select-tab-panel" {...panel("color")}>
              <div className="color-targets" role="radiogroup" aria-label="Áp dụng màu cho">
                <button type="button" role="radio" aria-checked={target === "all"} className="color-target-all"
                  onClick={() => setColorTarget("all")}>
                  Tất cả ảnh
                </button>
                {selected.map((key, i) => (
                  <TargetChip
                    key={key}
                    shot={shots.find((s) => s.key === key)}
                    number={i + 1}
                    active={target === key}
                    label={ownColor(key) ? filterOf(key)?.label : ""}
                    css={filterOf(key)?.css}
                    onPick={() => setColorTarget(key)}
                  />
                ))}
              </div>
              <p className="color-target-hint">
                {target === "all"
                  ? Object.keys(photoFilters).some(ownColor)
                    ? "Chọn màu ở đây sẽ áp cho tất cả ảnh (bỏ màu riêng của từng ảnh)."
                    : "Màu áp cho tất cả ảnh trong khung. Muốn màu riêng: chọn số ảnh, hoặc chạm vào ảnh trên khung."
                  : `Đang chọn màu riêng cho ảnh ${selected.indexOf(target) + 1}.`}
              </p>
              <ColorChoices shot={thumbShot} filters={filters} value={shownFilter?.id} onChange={applyColor} />
            </div>
          )}
          {current === "stickers" && (
            <div className="select-tab-panel select-stickers" {...panel("stickers")}>
              <div className="sticker-tools">
                {pickedIndex >= 0 ? (
                  <>
                    <button type="button" onClick={() => resize(1 / STICKER_SCALE.step)} disabled={scale <= STICKER_SCALE.min}>
                      <PiMinusBold aria-hidden="true" /> Nhỏ hơn
                    </button>
                    <button type="button" onClick={() => resize(STICKER_SCALE.step)} disabled={scale >= STICKER_SCALE.max}>
                      <PiPlusBold aria-hidden="true" /> To hơn
                    </button>
                    <button type="button" className="is-danger" onClick={removePicked}>
                      <PiTrashBold aria-hidden="true" /> Xóa nhãn dán
                    </button>
                  </>
                ) : (
                  <p>
                    {stickers.length
                      ? "Chạm một nhãn dán trên khung để kéo, phóng to / thu nhỏ hoặc xóa."
                      : "Chạm một nhãn dán bên dưới để dán lên khung."}
                  </p>
                )}
              </div>
              <div className="sticker-palette" role="group" aria-label="Thêm nhãn dán">
                {shopStickers.map((s) => (
                  <button key={s._id} type="button" aria-label={`Thêm nhãn dán ${s.name || ""}`.trim()} onClick={() => addSticker({ src: s.image })}>
                    <img src={s.thumb || s.image} alt="" loading="lazy" decoding="async" />
                  </button>
                ))}
              </div>
              {(area?.shift || stickers.length > 0) && (
                <div className="sticker-foot">
                  {area?.shift && <small>Nhãn dán tự lặp sang dải ảnh thứ hai để 2 dải cắt ra giống nhau.</small>}
                  {stickers.length > 0 && (
                    <button type="button" className="text-link" onClick={clearStickers}>
                      Xóa hết nhãn dán ({stickers.length})
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <footer className="flow-foot">
        <Button className="kiosk-next" disabled={busy || !full} onClick={onConfirm}>
          {busy ? (
            "Đang ghép ảnh…"
          ) : frame && prints ? (
            <><PiPrinterBold aria-hidden="true" /> In ảnh</>
          ) : (
            <><PiCheckBold aria-hidden="true" /> Nhận ảnh</>
          )}
        </Button>
        {!full && <small className="select-hint">Chọn thêm {count - selected.length} tấm để {frame && prints ? "in ảnh" : "tiếp tục"}</small>}
      </footer>
    </section>
  );
}
