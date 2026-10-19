import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { readSetting, saveSetting } from "../capture-store";
import { useToast } from "../studio";
import { useLiveData } from "../use-live-data";
import { printPackUpload } from "./print-upload.js";

// Own the print request separately from rendering/exporting the photo sheets.
export function usePrintRequest({
  token,
  booking,
  sheets,
  themeName,
  picked,
  setPicked,
  setBooking,
  reloadBooking,
  onPendingChange,
}) {
  const toast = useToast();
  const [sentSheets, setSentSheets] = useState(() => new Set());
  const [sending, setSending] = useState(false);
  const [job, setJob] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const sendingRef = useRef(false);
  const attemptRef = useRef(null);
  const [pendingAttempt, setPendingAttempt] = useState(null);
  const [checkingAttempt, setCheckingAttempt] = useState(true);
  const [storageError, setStorageError] = useState("");
  const [jobKey, setJobKey] = useState("");
  const attemptStoreKey = `album-print:${token}`;
  const jobRef = useRef(null);
  const quota = booking.prints ?? 1;
  const used = booking.printSheets || 0;
  const remaining = Math.max(0, quota - used);
  const receiveJob = (next) => {
    const prev = jobRef.current;
    if (prev && next && prev._id === next._id) {
      if (prev.status !== "printed" && next.status === "printed")
        toast.success(
          `Lễ tân đã in xong! Mời bạn đến quầy, đọc mã #${booking.code} để nhận ảnh.`,
          8000,
        );
      else if (prev.spoolStatus !== "failed" && next.spoolStatus === "failed")
        toast.error("Máy in đang gặp sự cố — lễ tân sẽ in lại cho bạn.");
    }
    jobRef.current = next;
    setJob(next);
  };
  useLiveData(
    `/albums/${token}/print${jobKey ? `?requestKey=${jobKey}` : ""}`,
    receiveJob,
    () => {},
    4000,
    (j) => !j || ["printed", "cancelled"].includes(j.status),
    { allowNull: true },
  );
  async function restoreAttempt() {
    setCheckingAttempt(true);
    try {
      const saved = await readSetting(attemptStoreKey);
      attemptRef.current = saved || null;
      setPendingAttempt(saved || null);
      setStorageError("");
    } catch {
      setStorageError(
        "Chưa đọc được yêu cầu in đã lưu trên thiết bị. Bấm kiểm tra lại trước khi gửi in.",
      );
    } finally {
      setCheckingAttempt(false);
    }
  }
  useEffect(() => {
    restoreAttempt();
  }, [token]);
  useEffect(() => {
    onPendingChange(checkingAttempt || sending || Boolean(pendingAttempt));
    return () => onPendingChange(false);
  }, [checkingAttempt, sending, pendingAttempt]);
  useEffect(() => {
    if (pendingAttempt)
      setPicked(
        new Set(
          sheets.flatMap((sheet, i) =>
            pendingAttempt.body.images.includes(sheet.src) ? [i] : [],
          ),
        ),
      );
  }, [pendingAttempt, sheets]);
  const outOfSheets = `Vé đã dùng hết ${quota} tờ in. Muốn in thêm, bạn mua thêm tờ tại quầy nhé.`;
  async function print() {
    if (sendingRef.current || checkingAttempt || storageError) return;
    const list = [...picked].sort((a, b) => a - b);
    let attempt = attemptRef.current;
    if (!attempt && (!list.length || list.length > remaining))
      return toast.warning(
        remaining
          ? `Vé còn ${remaining} tờ. Hãy chọn đủ số tờ muốn in.`
          : outOfSheets,
      );
    const retry = Boolean(attempt);
    if (!attempt)
      attempt = {
        body: {
          images: list.map((i) => sheets[i].src),
          frameName: themeName,
          requestKey: crypto.randomUUID(),
        },
        uncertain: false,
      };
    const wasUncertain = attempt.uncertain;
    sendingRef.current = true;
    setSending(true);
    let posted = false;
    try {
      // Save the exact images before sending. Reloading never creates a new key
      // for a request whose response may have been lost.
      attempt = { ...attempt, uncertain: true };
      await saveSetting(attemptStoreKey, attempt);
      attemptRef.current = attempt;
      setPendingAttempt(attempt);
      let result = retry
        ? await api(
            `/albums/${token}/print?requestKey=${attempt.body.requestKey}`,
            { allowNull: true },
          )
        : null;
      if (!result) {
        posted = true;
        result = await api(`/albums/${token}/print-pack`, printPackUpload(attempt.body));
      }
      receiveJob(result);
      setJobKey(attempt.body.requestKey);
      setConfirmation({
        sheets: result.sheetCount || attempt.body.images.length,
      });
      setBooking((b) => ({
        ...b,
        prints: result.prints ?? b.prints,
        printSheets: result.printSheets ?? b.printSheets,
      }));
      const matched = sheets.flatMap((sheet, i) =>
        attempt.body.images.includes(sheet.src) ? [i] : [],
      );
      setSentSheets((old) => new Set([...old, ...matched]));
      setPicked(new Set());
      await saveSetting(attemptStoreKey, null).catch(() => {});
      attemptRef.current = null;
      setPendingAttempt(null);
      toast.success(
        `Đã gửi ${attempt.body.images.length} tờ in tới quầy. Khi nhận ảnh, bạn đọc mã #${booking.code} nhé.`,
      );
    } catch (e) {
      // A definitive rejection of the first POST is safe to edit. An uncertain
      // retry stays frozen even if its quota check fails while the first POST runs.
      if (posted && !wasUncertain && e.status >= 400 && e.status < 500) {
        await saveSetting(attemptStoreKey, null).catch(() => {});
        attemptRef.current = null;
        setPendingAttempt(null);
      }
      toast.error(e.message);
      reloadBooking(); // số tờ có thể vừa thay đổi (mua thêm / gửi từ máy khác)
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }
  return {
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
    selectionLocked: () =>
      Boolean(attemptRef.current || sendingRef.current || checkingAttempt),
  };
}
