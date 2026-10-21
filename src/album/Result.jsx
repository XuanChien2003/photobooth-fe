import { useEffect, useRef, useState } from "react";
import {
  PiCheckBold,
  PiDownloadSimpleBold,
  PiPrinterBold,
  PiPrinterDuotone,
} from "react-icons/pi";
import { getApiUrl, money } from "../api";
import { Button, useStudio, useToast } from "../studio";
import {
  frameOutputSize,
  loadFrameImage,
  packPrintSheets,
} from "../frame-utils";
import { pad, prepareImage, saveImage } from "./utils";
import { ActionBar } from "./shared";
import { PrintConfirmation } from "./PrintConfirmation";
import { usePrintRequest } from "./use-print-request";
import { jpegDataUrl, pngDataUrl } from "./encode-jpeg.js";
import { renderPrintFrame } from "./render-frame.js";

// ─── Bước 4: Kết quả, tải về & gửi in ────────────────────────────────────
// Vé gồm một số tờ in 10 × 15 cm (theo gói + tờ mua thêm tại quầy): khách chọn tờ muốn in.
export function Result({
  engine,
  token,
  booking,
  setBooking,
  reloadBooking = () => {},
  onPendingChange = () => {},
  frames,
  layouts,
  adjustOf,
  themeName,
  onBack,
  onGallery,
}) {
  const toast = useToast();
  const { settings = {} } = useStudio();
  const [outputs, setOutputs] = useState([]);
  const [sheets, setSheets] = useState([]); // [{ src, frames }]
  const [picked, setPicked] = useState(() => new Set());
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(null);
  const downloadPending = useRef(false);
  const quota = booking.prints ?? 1;
  const originalCount = booking.photos?.filter((photo) =>
    photo.kind === "original" && !photo.deleted &&
    new Date(photo.expiresAt).getTime() > Date.now()
  ).length || 0;
  const used = booking.printSheets || 0;
  const remaining = Math.max(0, quota - used);
  const {
    job,
    confirmation,
    setConfirmation,
    sentSheets,
    sending,
    pendingAttempt,
    checkingAttempt,
    storageError,
    restoreAttempt,
    print,
    selectionLocked,
  } = usePrintRequest({
    token,
    booking,
    sheets,
    themeName,
    picked,
    setPicked,
    setBooking,
    reloadBooking,
    onPendingChange,
  });
  useEffect(() => {
    let live = true;
    // Download the next photos while the current one is painted (in painting order).
    engine.prefetchPrints?.([...new Set(layouts.flatMap((l) => (l.slots || []).map((s) => s?.photo)).filter(Boolean))]);
    (async () => {
      const results = [];
      for (const l of layouts) {
        if (!live) return;
        // Let controls and loading feedback paint between complete frames.
        await new Promise(resolve => setTimeout(resolve, 0));
        if (!live) return;
        const frame = frames.find((f) => f._id === l.frameId);
        if (!frame)
          throw new Error("Khung đã thay đổi. Vui lòng chọn lại chủ đề.");
        const bg = await loadFrameImage(frame.image);
        if (!live) return;
        const canvas = document.createElement("canvas");
        Object.assign(canvas, frameOutputSize(frame, bg));
        if (!await renderPrintFrame(canvas, bg, frame, l.slots, engine, adjustOf, () => live, l.decorations)) {
          canvas.width = canvas.height = 0;
          return;
        }
        results.push({
          canvas,
          name: l.name,
          printSize: frame.printSize,
          url: await jpegDataUrl(canvas, 0.85),
        });
      }
      if (!live) return;
      const pages = [];
      for (const sheet of packPrintSheets(results)) {
        if (!live) return;
        pages.push({ src: await pngDataUrl(sheet.canvas), frames: sheet.frames });
        sheet.canvas.width = sheet.canvas.height = 0;
      }
      if (live) {
        setOutputs(results);
        setSheets(pages);
        // Chọn sẵn các tờ đầu tiên, vừa đủ số tờ còn lại của vé.
        setPicked(new Set(pages.slice(0, remaining).map((_, i) => i)));
      }
    })().catch((e) => live && setError(e.message));
    return () => {
      live = false;
      engine.cancelPrintPrefetch?.();
    };
  }, []);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      // Chuẩn bị lần lượt sau khi đã hiện kết quả; không giữ nhiều phiên mã
      // hoá ảnh lớn đồng thời. Bấm tải sẽ dùng chung kết quả đang chuẩn bị.
      for (const output of outputs) {
        if (!live) return;
        await prepareImage(output.canvas).catch(() => {});
      }
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [outputs]);

  async function download(output, index) {
    if (downloadPending.current) return;
    downloadPending.current = true;
    setDownloading(index);
    try {
      const result = await saveImage(
        output.canvas,
        `${booking.code}-khung-${pad(index + 1)}.jpg`,
      );
      if (result !== "cancelled") toast.success(`Đã lưu “${output.name}”.`);
    } catch (e) {
      toast.error(`Không lưu được ảnh: ${e.message}`);
    } finally {
      downloadPending.current = false;
      setDownloading(null);
    }
  }
  const outOfSheets = `Vé đã dùng hết ${quota} tờ in. Muốn in thêm, bạn mua thêm tờ tại quầy nhé.`;
  function toggle(i) {
    if (selectionLocked()) return;
    if (picked.has(i))
      return setPicked((old) => new Set([...old].filter((k) => k !== i)));
    if (picked.size >= remaining)
      return toast.warning(
        remaining
          ? `Vé của bạn còn ${remaining} tờ in — bỏ chọn một tờ khác trước.`
          : outOfSheets,
      );
    setPicked((old) => new Set(old).add(i));
  }
  const pickedFrames = [...picked].reduce(
    (n, i) => n + (sheets[i]?.frames || 0),
    0,
  );
  const message =
    job?.status === "printed"
      ? `Lễ tân đã in xong — mời bạn đến quầy, đọc mã #${booking.code} để nhận ảnh.`
      : job?.spoolStatus === "sent"
        ? "Đã gửi toàn bộ tờ tới máy in DNP."
        : job?.spoolStatus === "failed"
          ? `Máy in báo lỗi: ${job.spoolMessage}. Lễ tân sẽ hỗ trợ bạn.`
          : job?.spoolStatus === "idle"
            ? "Lễ tân đã nhận lệnh in và đang chuẩn bị ảnh cho bạn."
            : "Đang gửi tới máy in…";
  const price = Number(settings.extraPrintPrice) || 0;
  if (confirmation && job)
    return (
      <PrintConfirmation
        job={job}
        code={booking.code}
        sheets={confirmation.sheets}
        onGallery={onGallery || onBack}
        onReview={() => setConfirmation(null)}
      />
    );
  return (
    <>
      <div className="studio-head result-head">
        <div>
          <h2>Thành phẩm của bạn</h2>
          <p>
            {error
              ? "Chưa tạo được thành phẩm. Kiểm tra thông báo bên dưới."
              : outputs.length
                ? "Chọn tờ muốn in, hoặc tải từng khung về máy."
                : "Đang tạo ảnh chất lượng cao…"}
          </p>
        </div>
      </div>
      <p className={`print-quota ${remaining ? "" : "empty"}`}>
        <PiPrinterDuotone />
        <span>
          Vé #{booking.code} gồm <b>{quota} tờ in</b> 10 × 15 cm · đã gửi {used}{" "}
          · còn <b>{remaining} tờ</b>
          {remaining > 0 && sheets.length > 1 && (
            <small>Chạm vào tờ để chọn / bỏ chọn tờ muốn in.</small>
          )}
          {!remaining && (
            <small>
              Muốn in thêm? Mua thêm tờ tại quầy
              {price > 0 && ` (${money(price)}/tờ)`} — lễ tân cộng tờ vào vé,
              bạn chỉ cần bấm Gửi in lại.
            </small>
          )}
        </span>
      </p>
      {storageError && (
        <div className="print-retry" role="alert">
          <p>{storageError}</p>
          <Button className="outline" onClick={restoreAttempt}>
            Kiểm tra lại yêu cầu in
          </Button>
        </div>
      )}
      {pendingAttempt && !sending && (
        <section className="print-retry" role="alert">
          <strong>Chưa xác nhận được yêu cầu in</strong>
          <p>
            Giữ nguyên {pendingAttempt.body.images.length} tờ bên dưới. Bấm
            “Kiểm tra và thử lại” để xác nhận yêu cầu này trước khi chọn tờ
            khác.
          </p>
          <div className="print-retry-preview">
            {pendingAttempt.body.images.map((src, i) => (
              <img key={i} src={src} alt={`Tờ đang chờ xác nhận ${i + 1}`} />
            ))}
          </div>
        </section>
      )}
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {!sheets.length && !error && (
        <p className="center muted">Đang tạo ảnh chất lượng cao…</p>
      )}
      <div className="sheet-strip">
        {sheets.map((s, i) => {
          const state = picked.has(i)
            ? "is-picked"
            : sentSheets.has(i)
              ? "is-sent"
              : "is-skipped";
          return (
            <figure key={i} className={state}>
              <button
                type="button"
                aria-pressed={picked.has(i)}
                aria-label={`Tờ in ${i + 1}`}
                disabled={
                  sending ||
                  checkingAttempt ||
                  Boolean(pendingAttempt) ||
                  (!remaining && !picked.has(i))
                }
                onClick={() => toggle(i)}
              >
                <img src={s.src} alt={`Tờ in ${i + 1}`} />
                <span className="sheet-pick">
                  {state === "is-sent" ? (
                    <>
                      <PiCheckBold />{" "}
                      {remaining ? "Đã gửi · chọn để in thêm" : "Đã gửi in"}
                    </>
                  ) : state === "is-picked" ? (
                    <>
                      <PiPrinterBold /> In tờ này
                    </>
                  ) : (
                    "Không in"
                  )}
                </span>
              </button>
              <figcaption>
                Tờ {i + 1}/{sheets.length} · 10 × 15 cm
              </figcaption>
            </figure>
          );
        })}
      </div>
      {outputs.length > 0 && (
        <section className="frame-list">
          <h3>Tải từng khung nhỏ</h3>
          <p>({outputs.length} khung – chạm Tải → chọn Lưu ảnh)</p>
          {outputs.map((o, i) => (
            <div className="frame-row" key={i}>
              <img src={o.url} alt="" />
              <span>{o.name}</span>
              <Button
                className="outline small"
                disabled={downloading !== null}
                aria-busy={downloading === i}
                onClick={() => download(o, i)}
              >
                <PiDownloadSimpleBold />{" "}
                {downloading === i ? "Đang chuẩn bị…" : "Tải"}
              </Button>
            </div>
          ))}
        </section>
      )}
      {originalCount > 0 && (
        <section className="original-download">
          <div>
            <h3>Tải tất cả ảnh đã chụp</h3>
            <p>{originalCount} ảnh gốc, đầy đủ chất lượng · tải chung trong một file ZIP.</p>
          </div>
          <a
            className="button outline"
            href={getApiUrl(`/api/albums/${token}/download`)}
            onClick={() => toast.info(`Đang chuẩn bị file ZIP ${originalCount} ảnh gốc, vui lòng đợi…`)}
          >
            <PiDownloadSimpleBold /> Tải tất cả ảnh gốc
          </a>
        </section>
      )}
      {job && (
        <p className={`print-status ${job.status}`} role="status">
          <PiPrinterDuotone /> {message}
        </p>
      )}
      <ActionBar
        onBack={pendingAttempt || sending ? undefined : onBack}
        className="result-action-bar"
      >
        <Button
          disabled={
            sending ||
            checkingAttempt ||
            Boolean(storageError) ||
            (!pendingAttempt && (!picked.size || picked.size > remaining))
          }
          onClick={print}
        >
          <PiPrinterBold />{" "}
          {sending
            ? "Đang gửi…"
            : checkingAttempt
              ? "Đang kiểm tra…"
              : pendingAttempt
                ? "Kiểm tra và thử lại"
                : picked.size
                  ? `Gửi in (${pickedFrames} khung → ${picked.size} tờ)`
                  : remaining
                    ? "Chọn tờ để in"
                    : "Đã dùng hết tờ in"}
        </Button>
      </ActionBar>
    </>
  );
}
