import { useEffect, useMemo, useRef, useState } from "react";
import {
  PiCheckBold,
  PiImagesDuotone,
  PiPrinterDuotone,
  PiSelectionAllBold,
  PiStackDuotone,
} from "react-icons/pi";
import { api } from "../api";
import { onNetworkRecovery } from "../network.js";
import { savePhoto } from "../kiosk/direct-upload.js";
import { prepareCameraImageAsync } from "../image-processing.js";
import { readPending, removePending } from "../capture-store";
import { useStudio, useToast } from "../studio";
import { transition } from "../transitions";
import { DEFAULT_ADJUST } from "../beauty";
import { groupFramePacks, photoLayout } from "../frame-utils";
import { ACCEPTED_IMAGES, MAX_UPLOAD_MB, autoLayouts, isFilled } from "./utils";
import { compositionPhotos, packCapacity } from "./frame-capacity";
import { createFavoriteQueue } from "./favorite-queue";
import { mergeUploadedPhotos, uploadPhotos } from "./upload-photos.js";
import { downloadPhoto } from "./download-photo.js";
import { usePhotoEngine, usePersistedState } from "./hooks";
import { Gallery } from "./Gallery";
import { PhotoEditor } from "./PhotoEditor";
import { ThemePicker } from "./ThemePicker";
import { PackEditor } from "./PackEditor";
import { Result } from "./Result";
import { FavoriteShortageDialog } from "./FavoriteShortageDialog";

const STEPS = [
  ["Ảnh", PiImagesDuotone],
  ["Chủ đề", PiStackDuotone],
  ["Ghép ảnh", PiSelectionAllBold],
  ["Kết quả", PiPrinterDuotone],
];

export function AlbumStudio({
  booking,
  setBooking,
  token,
  reloadBooking,
  onMutationChange = () => {},
}) {
  const { frames: shopFrames, settings } = useStudio();
  // Khách chọn ảnh cho từng số ảnh; ô bản sao, QR và ngày in tự vẽ khi ghép (xem photoLayout).
  const catalog = useMemo(() => shopFrames?.map(photoLayout), [shopFrames]);
  const toast = useToast();
  const photos = booking.photos.filter((p) => p.kind === "original");
  // The gallery and the editor show the newest photo first (numbers still count up from #01).
  const newestFirst = [...photos].reverse();
  const engine = usePhotoEngine(token, photos);
  const favorites = photos.filter((p) => p.favorite);
  const themeOrder = settings?.themes;
  const packs = useMemo(
    () => groupFramePacks(catalog || [], (themeOrder || []).map((t) => t.name)),
    [catalog, themeOrder],
  );
  const [state, setState] = usePersistedState(`photo-flow-v5-${token}`, {
    step: 0,
    adjusts: {},
    defaultAdjust: DEFAULT_ADJUST,
    packId: "",
    frameIndex: 0,
    layouts: {}, // { [frameId]: [{ photo | null, zoom, x, y, rotate }] } — một ảnh dùng được cho nhiều ô
    decorations: {},
    autoFill: false,
  });
  const patch = (changes) => setState((s) => ({ ...s, ...changes }));
  const go = (step) =>
    transition(() => patch({ step }), step > state.step ? "forward" : "back");
  const [editing, setEditing] = useState(null);
  const [shortage, setShortage] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [favoritesSaving, setFavoritesSaving] = useState(false);
  const [printPending, setPrintPending] = useState(false);
  const photoMutationRef = useRef(false);
  const bookingRef = useRef(booking);
  bookingRef.current = booking;
  const pack = packs.find((p) => p.id === state.packId);
  const required = packCapacity(pack);
  const favoriteQueue = useMemo(
    () =>
      createFavoriteQueue({
        save: (ids) =>
          api(`/albums/${token}/favorites`, {
            method: "PUT",
            body: { ids },
          }),
        onSaved: (next, latest) => {
          if (!latest) return;
          bookingRef.current = next;
          setBooking(next);
        },
        onError: (error, confirmed) => {
          if (confirmed) {
            const ids = new Set(confirmed);
            const next = {
              ...bookingRef.current,
              photos: bookingRef.current.photos.map((photo) => ({
                ...photo,
                favorite: ids.has(photo.id),
              })),
            };
            bookingRef.current = next;
            setBooking(next);
          }
          toast.error(error.message);
        },
        onPending: (pending) => {
          setFavoritesSaving(pending);
          onMutationChange(pending || photoMutationRef.current);
        },
      }),
    [token],
  );
  useEffect(() => {
    favoriteQueue.activate();
    return () => favoriteQueue.dispose();
  }, [favoriteQueue]);
  const ready =
    pack &&
    pack.frames.every((f) => state.layouts[f._id]?.length === f.slots.length);
  const filled =
    ready && pack.frames.every((f) => isFilled(f, state.layouts[f._id]));
  const adjustOf = (id) => ({
    ...DEFAULT_ADJUST,
    ...(state.adjusts[id] || state.defaultAdjust),
  });

  // Ảnh chụp ở kiosk nhưng chưa kịp đồng bộ (mất mạng) được gửi nốt từ thiết bị này.
  // Lỗi mạng: thử lại khi có mạng (mỗi ảnh có mã riêng nên gửi lại không bị trùng).
  useEffect(() => {
    let failed = false, warned = false;
    const syncPending = async () => {
      let synced = 0;
      const pending = await readPending(token);
      if (!pending.length || photoMutationRef.current) return;
      photoMutationRef.current = true;
      onMutationChange(true);
      try {
        await favoriteQueue.whenIdle();
        for (const item of pending) {
          setBooking(
            await savePhoto(`/albums/${token}/photos`, item.image, {
              clientKey: item.id, mirrored: item.mirrored, preview: item.preview,
            }),
          );
          await removePending(item.id);
          synced++;
        }
        failed = false;
        if (synced)
          toast.success(
            `Đã đồng bộ ${synced} ảnh chụp còn thiếu vào thư viện.`,
          );
      } finally {
        photoMutationRef.current = false;
        onMutationChange(favoriteQueue.isPending());
      }
    };
    const run = () => syncPending().catch((e) => {
      failed = true;
      if (!warned) toast.warning(`Chưa đồng bộ được ảnh còn thiếu: ${e.message}`);
      warned = true;
    });
    run();
    const unsubscribe = onNetworkRecovery(() => { if (failed) run(); });
    return unsubscribe;
  }, [token]);

  // Bộ/khung bị gỡ hoặc ảnh bị xóa: đưa lựa chọn về trạng thái hợp lệ.
  const ids = photos.map((p) => p.id).join();
  const frameIds = pack?.frames.map((f) => f._id).join();
  useEffect(() => {
    if (!catalog) return;
    if (state.packId && !pack)
      return patch({ packId: "", layouts: {}, step: Math.min(state.step, 1) });
    if (pack && state.step >= 2 && !ready)
      return patch({
        layouts: autoLayouts(pack.frames, compositionPhotos(photos, { includeOthers: state.autoFill }), { repeat: state.autoFill }),
        frameIndex: 0,
        step: 2,
      });
    const alive = new Set(photos.map((p) => p.id));
    const stale = Object.values(state.layouts).some((slots) =>
      slots.some((s) => s.photo && !alive.has(s.photo)),
    );
    if (stale)
      patch({
        layouts: Object.fromEntries(
          Object.entries(state.layouts).map(([id, slots]) => [
            id,
            slots.map((s) =>
              s.photo && !alive.has(s.photo) ? { ...s, photo: null } : s,
            ),
          ]),
        ),
        step: Math.min(state.step, 2),
      });
  }, [catalog, ids, state.packId, frameIds]);

  function toggleFavorite(photo) {
    if (photoMutationRef.current) return;
    const current = bookingRef.current;
    const currentPhoto = current.photos.find((p) => p.id === photo.id);
    if (!currentPhoto) return;
    const currentFavorites = current.photos.filter(
      (p) => p.kind === "original" && p.favorite,
    );
    const nextFavorites = currentPhoto.favorite
      ? currentFavorites.filter((p) => p.id !== photo.id)
      : [...currentFavorites, currentPhoto];
    const next = {
      ...current,
      photos: current.photos.map((p) =>
        p.id === photo.id ? { ...p, favorite: !currentPhoto.favorite } : p,
      ),
    };
    bookingRef.current = next;
    setBooking(next);
    return favoriteQueue.enqueue(
      nextFavorites.map((p) => p.id),
      currentFavorites.map((p) => p.id),
    );
  }
  async function downloadOne(photo) {
    if (downloadingId) return;
    setDownloadingId(photo.id);
    try {
      const result = await downloadPhoto(engine, photo, adjustOf(photo.id),
        `anh-${String(photo.number || 1).padStart(2, "0")}.jpg`);
      if (result !== "cancelled") toast.success("Đã lưu ảnh về máy.");
    } catch (e) {
      toast.error(`Không lưu được ảnh: ${e.message}`);
    } finally {
      setDownloadingId(null);
    }
  }
  async function removePhotos(list) {
    if (
      photoMutationRef.current ||
      !list.length ||
      !window.confirm(`Xóa ${list.length} ảnh khỏi thư viện?`)
    )
      return false;
    photoMutationRef.current = true;
    onMutationChange(true);
    try {
      await favoriteQueue.whenIdle();
      const next = await api(`/albums/${token}/photos`, {
        method: "DELETE",
        body: { ids: list },
      });
      transition(() => setBooking(next), "reorder");
      toast.success(`Đã xóa ${list.length} ảnh.`);
      return true;
    } catch (e) {
      toast.error(e.message);
      return false;
    } finally {
      photoMutationRef.current = false;
      onMutationChange(favoriteQueue.isPending());
    }
  }
  async function upload(selected) {
    if (photoMutationRef.current) return;
    const files = selected.filter(
      (f) =>
        ACCEPTED_IMAGES.test(f.type) && f.size <= MAX_UPLOAD_MB * 1024 * 1024,
    );
    const skipped = selected.length - files.length;
    if (skipped)
      toast.warning(
        `Bỏ qua ${skipped} tệp: chỉ nhận ảnh JPG, PNG, WebP dưới ${MAX_UPLOAD_MB} MB.`,
      );
    if (!files.length) return;
    photoMutationRef.current = true;
    onMutationChange(true);
    if (files.length > 1) toast.info(`Đang tải lên ${files.length} ảnh…`);
    setBusy(true);
    setUploadProgress({ done: 0, total: files.length });
    try {
      await favoriteQueue.whenIdle();
      let confirmed = 0;
      const { done, error } = await uploadPhotos(files, {
        upload: async (file) => {
          const clientKey = crypto.randomUUID();
          // A phone JPEG goes straight to storage like a booth photo: the phone makes the small
          // upright preview, so the free server neither relays 10+ MB nor decodes the original.
          const preview = file.type === "image/jpeg"
            ? await prepareCameraImageAsync(file, false).catch(() => undefined) : undefined;
          const next = await savePhoto(`/albums/${token}/photos`, file, {
            name: file.name, clientKey, preview,
          });
          const photo = next.photos.find(p => p.clientKey === clientKey);
          // CMYK JPEG/PNG/WebP may be converted by the server. Reuse a local
          // file only when the server confirms it kept the original pixels.
          if (photo?.sourcePreserved) engine.rememberUpload(photo.id, file);
          return next;
        },
        onSaved: (response) => {
          const next = mergeUploadedPhotos(bookingRef.current, response);
          bookingRef.current = next;
          setBooking(next);
          setUploadProgress({ done: ++confirmed, total: files.length });
        },
      });
      if (error)
        toast.error(done
          ? `Đã thêm ${done}/${files.length} ảnh. Chưa tải xong: ${error.message}`
          : error.message);
      else toast.success(`Đã thêm ${done} ảnh vào thư viện.`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      photoMutationRef.current = false;
      onMutationChange(favoriteQueue.isPending());
      setBusy(false);
      setUploadProgress(null);
    }
  }
  function choosePack(id) {
    if (id !== state.packId) patch({ packId: id, layouts: {}, frameIndex: 0, autoFill: false });
  }
  function toCompose() {
    if (!pack || !required || !photos.length || favoritesSaving) return;
    if (favorites.length < required) {
      if (state.step !== 1) go(1);
      return setShortage(true);
    }
    beginCompose(false);
  }
  function beginCompose(autoFill) {
    if (!pack || !photos.length || favoritesSaving) return;
    const pool = compositionPhotos(photos, { includeOthers: autoFill });
    const needsAutoFill = autoFill && (!state.autoFill || !filled);
    setShortage(false);
    transition(() => patch({
      step: 2,
      autoFill,
      ...(!ready || needsAutoFill ? {
        layouts: autoLayouts(pack.frames, pool, { repeat: autoFill }),
        frameIndex: 0,
      } : {}),
    }), "forward");
  }
  function reshuffle() {
    transition(
      () => patch({ layouts: autoLayouts(pack.frames,
        compositionPhotos(photos, { includeOthers: state.autoFill }), { repeat: state.autoFill }) }),
      "fade",
    );
    toast.success("Đã xếp lại ảnh trong bộ khung.");
  }

  const step = state.step;
  const favoriteIds = favorites.map((photo) => photo.id).join();
  const carousel = useMemo(() => {
    const used = new Set(
      Object.values(state.layouts).flatMap((slots) =>
        slots.map((s) => s.photo),
      ),
    );
    return state.autoFill
      ? compositionPhotos(photos, { includeOthers: true })
      : photos.filter((p) => p.favorite || used.has(p.id));
  }, [ids, favoriteIds, state.layouts, state.autoFill]);
  const canOpen = (i) => i <= 1 || (i === 2 && ready) || (i === 3 && filled);
  return (
    <div className="studio">
      <nav className="studio-steps" aria-label="Các bước">
        {STEPS.map(([label, Icon], i) => (
          <button
            key={label}
            className={i === step ? "active" : i < step ? "done" : ""}
            aria-current={i === step ? "step" : undefined}
            disabled={printPending || !canOpen(i)}
            onClick={() => i === 2 && step < 2 ? toCompose() : go(i)}
          >
            <span>{i < step ? <PiCheckBold /> : <Icon />}</span>
            {label}
          </button>
        ))}
      </nav>

      {step === 0 && (
        <Gallery
          token={token}
          booking={booking}
          photos={newestFirst}
          favorites={favorites}
          selectedPack={pack}
          favoritesSaving={favoritesSaving}
          adjustOf={adjustOf}
          busy={busy}
          uploadProgress={uploadProgress}
          onFavorite={toggleFavorite}
          onDelete={removePhotos}
          onDownload={downloadOne}
          downloadingId={downloadingId}
          onEdit={(p) => setEditing(p.id)}
          onUpload={upload}
          onNext={() => go(1)}
        />
      )}
      {step === 1 && (
        <ThemePicker
          packs={packs}
          selected={state.packId}
          favorites={favorites.length}
          totalPhotos={photos.length}
          favoritesSaving={favoritesSaving}
          onSelect={choosePack}
          onBack={() => go(0)}
          onNext={toCompose}
        />
      )}
      {step === 2 && ready && (
        <PackEditor
          engine={engine}
          pack={pack}
          layouts={state.layouts}
          decorations={state.decorations || {}}
          index={Math.min(state.frameIndex, pack.frames.length - 1)}
          photos={carousel}
          adjustOf={adjustOf}
          onIndex={(frameIndex) =>
            transition(() => patch({ frameIndex }), "fade")
          }
          onLayouts={(layouts) =>
            setState((s) => ({ ...s, layouts: { ...s.layouts, ...layouts } }))
          }
          onDecorations={(frameId, items) => setState((s) => ({ ...s,
            decorations: { ...s.decorations, [frameId]: items } }))}
          onReshuffle={reshuffle}
          onBack={() => go(1)}
          onNext={() => go(3)}
        />
      )}
      {step === 3 && filled && (
        <Result
          engine={engine}
          token={token}
          booking={booking}
          setBooking={setBooking}
          reloadBooking={reloadBooking}
          onPendingChange={setPrintPending}
          frames={catalog || []}
          layouts={pack.frames.map((f) => ({
            frameId: f._id,
            name: f.name,
            slots: state.layouts[f._id],
            decorations: (state.decorations || {})[f._id] || [],
          }))}
          adjustOf={adjustOf}
          themeName={pack.name}
          onBack={() => go(2)}
          onGallery={() => go(0)}
        />
      )}

      {shortage && step === 1 && pack && favorites.length < required && (
        <FavoriteShortageDialog
          pack={pack}
          required={required}
          favorites={favorites.length}
          totalPhotos={photos.length}
          onMore={() => { setShortage(false); go(0); }}
          onAutomatic={() => beginCompose(true)}
          onClose={() => setShortage(false)}
        />
      )}

      {editing && photos.some((p) => p.id === editing) && (
        <PhotoEditor
          engine={engine}
          photos={newestFirst}
          startId={editing}
          adjustOf={adjustOf}
          onFavorite={toggleFavorite}
          onDelete={removePhotos}
          onClose={() => transition(() => setEditing(null))}
          onSave={(drafts) => {
            transition(() => {
              patch({ adjusts: { ...state.adjusts, ...drafts } });
              setEditing(null);
            });
            const count = Object.keys(drafts).length;
            if (count)
              toast.success(
                count > 1
                  ? `Đã lưu chỉnh sửa cho ${count} ảnh.`
                  : "Đã lưu chỉnh sửa ảnh.",
              );
          }}
          onApplyAll={(adjust) => {
            transition(() => {
              patch({ defaultAdjust: adjust, adjusts: {} });
              setEditing(null);
            });
            toast.success("Đã áp dụng cho tất cả ảnh.");
          }}
        />
      )}
    </div>
  );
}
