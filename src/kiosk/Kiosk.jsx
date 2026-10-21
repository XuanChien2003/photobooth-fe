import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  PiCheckCircleBold,
  PiTimerDuotone,
  PiVideoCameraSlashDuotone,
} from "react-icons/pi";
import { api, getApiUrl } from "../api";
import { isTransient, onNetworkRecovery } from "../network.js";
import { mergeUploadedPhotos } from "../album/upload-photos.js";
import { Button, ErrorBox, useToast } from "../studio";
import {
  savePending,
  readPending,
  countPending,
  removePending,
  readSetting,
  saveSetting,
} from "../capture-store";
import { transition } from "../transitions";
import {
  CAMERA_KEY,
  FOLDER_KEY,
  MIRROR_KEY,
  QR_SECONDS,
  SAVING_MESSAGE,
} from "./constants.js";
import {
  CAMERA_ERROR,
  cameraRank,
  FUJI_WEBCAM_MESSAGE,
  hdmiFailed,
  isFujiWebcam,
  liveUsable,
  NO_HDMI_MESSAGE,
  videoConstraints,
} from "./camera.js";
import {
  canPickFolder,
  FOLDER_ACCESS_HINT,
  folderPermission,
  isJpeg,
  listCameraFiles,
} from "./folder.js";
import { prepareCameraPhoto } from "./photo.js";
import { directMediaUrl } from "../media-delivery.js";
import { savePhoto } from "./direct-upload.js";
import { watchCameraFolder } from "./watch-camera-folder.js";
import { orderBoothShots } from "./shot-order.js";
import {
  canApplyKioskPhoto,
  canApplyKioskState,
  createSingleFlight,
  drainPendingPhotos,
  flushPendingPhotos,
  kioskPhotoPath,
  sameKioskSession,
} from "./network-tasks.js";
import { BoothGallery } from "./BoothGallery.jsx";
import { CameraPreview } from "./CameraPreview.jsx";
import { KioskDone } from "./KioskDone.jsx";
import { KioskEntry } from "./KioskEntry.jsx";
import { KioskSettings } from "./KioskSettings.jsx";

// Các chỗ báo lỗi mạng ở màn chụp: mỗi lần mất kết nối chỉ báo một lần, có mạng lại thì xoá.
const NET_SLOTS = ["poll", "sync", "start", "finish"];

export function Kiosk() {
  const [params] = useSearchParams(),
    toast = useToast();
  const device =
    params.get("device") || localStorage.getItem("harrod-device") || "";
  const [code, setCode] = useState(""),
    [step, setStep] = useState("start"),
    [session, setSession] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [mirror, setMirror] = useState(
      () => localStorage.getItem(MIRROR_KEY) !== "0",
    ),
    [folder, setFolder] = useState(null),
    [folderAccess, setFolderAccess] = useState("none"),
    [cameraId, setCameraId] = useState(
      () => localStorage.getItem(CAMERA_KEY) || "",
    ),
    [cameras, setCameras] = useState([]);
  const [ready, setReady] = useState(false),
    [flash, setFlash] = useState(0),
    [done, setDone] = useState(null),
    [left, setLeft] = useState(0),
    [remaining, setRemaining] = useState(0),
    [pending, setPending] = useState([]),
    [timeUp, setTimeUp] = useState(false),
    [confirmEnd, setConfirmEnd] = useState(false),
    // Ảnh máy ảnh đang ghi vào thư mục / đang đọc để gửi lên (chế độ ảnh gốc máy ảnh).
    [detecting, setDetecting] = useState(0),
    [reading, setReading] = useState(0),
    // Lần quét thư mục ảnh gần nhất (số ảnh thấy được, lỗi đọc) — hiện cho nhân viên và gửi
    // kèm trạng thái lên máy chủ.
    [scanInfo, setScanInfo] = useState(null);
  const video = useRef(null),
    stream = useRef(null),
    alive = useRef(true),
    cancel = useRef(0),
    finishing = useRef(false),
    finishRetry = useRef({ at: 0, failures: 0, timer: null }),
    current = useRef(session),
    photoRequests = useRef(createSingleFlight()),
    photoWake = useRef(null),
    stateRequests = useRef(createSingleFlight()),
    request = useRef(0);
  current.current = session;
  const key = "photo-capture-" + device.slice(-24);
  const shown = useRef({});
  const mirrorRef = useRef(mirror);
  mirrorRef.current = mirror;
  // Gửi kèm khi báo trạng thái lên máy chủ: quản trị xem được vì sao ảnh máy ảnh không về.
  const scanRef = useRef(null),
    diagRef = useRef({});
  diagRef.current = {
    mode: "folder",
    folder: folder?.name,
    access: folderAccess,
    cameras: cameras
      .map((c) => c.label || "?")
      .join(", ")
      .slice(0, 300),
  };
  // Lỗi mở hình trực tiếp gần nhất (gửi kèm trạng thái để biết vì sao không có hình máy ảnh).
  const cameraError = useRef("");
  const kioskDiag = () => ({
    ...diagRef.current,
    camera: stream.current?.getVideoTracks()[0]?.label || "",
    cameraError: cameraError.current.slice(0, 300),
    ...scanRef.current,
  });
  // Ảnh chưa lưu xong lên hệ thống: đang chờ gửi + đang đọc / đang ghi từ máy ảnh.
  // Còn ảnh chưa lưu thì không cho bấm "Hoàn thành chụp".
  const unsaved = pending.length + reading + detecting;
  const doneRef = useRef(null);
  doneRef.current = done;
  const unsavedRef = useRef(0),
    readingRef = useRef(0),
    detectingRef = useRef(0),
    pendingRef = useRef(pending);
  unsavedRef.current = unsaved;
  readingRef.current = reading;
  detectingRef.current = detecting;
  pendingRef.current = pending;
  const trackPending = (next) => {
    const rows = typeof next === "function" ? next(pendingRef.current) : next;
    pendingRef.current = rows;
    unsavedRef.current = rows.length + readingRef.current + detectingRef.current;
    setPending(rows);
  };
  const trackReading = (change) => {
    readingRef.current += change;
    unsavedRef.current = pendingRef.current.length + readingRef.current + detectingRef.current;
    setReading(readingRef.current);
  };
  const trackDetecting = (count) => {
    detectingRef.current = count;
    unsavedRef.current = pendingRef.current.length + readingRef.current + count;
    setDetecting(count);
  };
  // Lỗi mạng (báo trạng thái / gửi ảnh) đang hiện ở màn chụp: mạng ổn lại thì tự ẩn và báo.
  const netError = useRef("");
  const showNetError = (slot, message, toastMessage) => {
    netError.current = message;
    setError(message);
    notifyOnce(slot, "warning", toastMessage || message);
  };
  const netRecovered = () => {
    if (!netError.current) return;
    const message = netError.current;
    netError.current = "";
    setError((e) => (e === message ? "" : e));
    for (const slot of NET_SLOTS) delete shown.current[slot];
    toast.success("Đã kết nối lại máy chủ — ảnh tiếp tục được lưu.");
  };
  const notifyOnce = (slot, type, message, duration) => {
    // Lỗi mạng: một thông báo cho mỗi lần mất kết nối, không lặp khi nội dung lỗi đổi.
    if (shown.current[slot] === message || (NET_SLOTS.includes(slot) && shown.current[slot]))
      return;
    shown.current[slot] = message;
    toast[type](message, duration);
  };
  // Thư mục ảnh của máy ảnh đã chọn trước đó (trình duyệt có thể hỏi lại quyền đọc).
  useEffect(() => {
    readSetting(FOLDER_KEY).then(
      async (handle) => {
        if (!handle) return;
        setFolder(handle);
        setFolderAccess(await folderPermission(handle, false));
      },
      () => {},
    );
  }, []);
  async function pickFolder() {
    try {
      const handle = await window.showDirectoryPicker({
        id: "photo-camera",
        mode: "read",
      });
      await saveSetting(FOLDER_KEY, handle);
      setFolder(handle);
      setFolderAccess("granted");
      // Báo ngay số ảnh trong thư mục: chọn nhầm thư mục (0 ảnh) là thấy liền.
      let jpegs = 0;
      try {
        for await (const [path] of listCameraFiles(handle))
          if (isJpeg(path)) jpegs++;
      } catch {
        /* vẫn dùng thư mục; lúc chụp sẽ báo lỗi đọc nếu có */
      }
      if (jpegs)
        toast.success(
          `Đã chọn thư mục ảnh “${handle.name}” — đang có ${jpegs} ảnh JPG.`,
        );
      else
        toast.warning(
          `Đã chọn thư mục ảnh “${handle.name}” nhưng máy chụp chưa thấy ảnh JPG nào. Hãy chọn đúng thư mục FUJIFILM X Acquire đang lưu ảnh (thư mục có các tệp DSCF….JPG), hoặc chụp thử 1 tấm rồi bấm “Thử nhận ảnh từ máy ảnh”. Thư mục có ảnh mà vẫn báo 0: ${FOLDER_ACCESS_HINT}`,
          15000,
        );
    } catch (e) {
      if (e.name !== "AbortError")
        toast.error("Không mở được thư mục ảnh: " + e.message);
    }
  }
  async function grantFolder() {
    const access = await folderPermission(folder, true);
    setFolderAccess(access);
    if (access === "granted") toast.success("Đã cho phép đọc thư mục ảnh.");
    else toast.warning("Trình duyệt chưa cho phép đọc thư mục ảnh.");
  }
  // Máy chụp mở cả ngày: giữ màn hình luôn sáng (trình duyệt hỗ trợ Wake Lock).
  useEffect(() => {
    let lock = null;
    const keepAwake = () =>
      document.visibilityState === "visible" &&
      navigator.wakeLock?.request("screen").then(
        (l) => (lock = l),
        () => {},
      );
    keepAwake();
    document.addEventListener("visibilitychange", keepAwake);
    return () => {
      document.removeEventListener("visibilitychange", keepAwake);
      lock?.release().catch(() => {});
    };
  }, []);
  // Cắm / rút máy ảnh, thẻ ghi hình, đổi chế độ USB trên máy ảnh: cập nhật lại danh sách
  // camera; đang chụp mà chưa có hình trực tiếp thì thử mở lại ngay (cắm thẻ HDMI là hình hiện).
  const reopenRef = useRef(null);
  reopenRef.current = () => {
    if (current.current && !ready && !finishing.current && !doneRef.current)
      openCamera();
  };
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media) return;
    const refresh = (event) =>
      media.enumerateDevices().then(
        (list) => {
          setCameras(list.filter((d) => d.kind === "videoinput"));
          if (event) reopenRef.current();
        },
        () => {},
      );
    refresh();
    media.addEventListener?.("devicechange", refresh);
    return () => media.removeEventListener?.("devicechange", refresh);
  }, []);
  useEffect(() => {
    alive.current = true;
    if (params.get("device")) localStorage.setItem("harrod-device", device);
    try {
      const saved = JSON.parse(sessionStorage.getItem(key));
      if (saved) setSession(saved);
    } catch {}
    return () => {
      alive.current = false;
      cancel.current++;
      request.current++;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  function update(next) {
    if (!alive.current) return;
    // A finish/state request can begin before a new JPEG is read. Keep capture
    // chronology from the live session as well as the incoming booking snapshot.
    if (sameKioskSession(next, current.current) && current.current.captureOrder)
      next = { ...next, captureOrder: [...new Set([
        ...current.current.captureOrder, ...(next.captureOrder || []),
      ])] };
    current.current = next;
    setSession(next);
    sessionStorage.setItem(key, JSON.stringify(next));
  }
  function stop() {
    request.current++;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setReady(false);
  }
  // Mặc định dùng thẻ ghi hình / máy ảnh, không dùng OBS; nhớ lựa chọn của nhân viên
  // (camera tự chọn không ghi đè lựa chọn "Tự động").
  async function openCamera(id = cameraId) {
    const turn = ++request.current;
    const getMedia = (deviceId) =>
      navigator.mediaDevices.getUserMedia(videoConstraints(deviceId));
    const videoInputs = async () =>
      (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === "videoinput",
      );
    // Chế độ ảnh gốc: không mở FUJIFILM X Webcam, webcam của máy tính (xem liveUsable).
    const usable = liveUsable;
    const choose = (list) =>
      list.some((d) => d.deviceId === id && usable(d))
        ? id
        : list
            .filter((d) => usable(d) && cameraRank(d) < 9)
            .sort((a, b) => cameraRank(a) - cameraRank(b))[0]?.deviceId;
    const blocked = new Error("blocked");
    let failed = null;
    try {
      // Đã cấp quyền camera (biết tên thiết bị): mở thẳng camera cần dùng.
      const known = await videoInputs();
      const named = known.some((d) => d.label);
      const first = named ? choose(known) : id;
      blocked.message = known.some(isFujiWebcam)
        ? FUJI_WEBCAM_MESSAGE
        : NO_HDMI_MESSAGE;
      if (named && !first && known.some((d) => !usable(d))) throw blocked;
      let media = await getMedia(first).catch((e) => {
        if (!first) throw e;
        // Thẻ ghi hình có nhưng không mở được (đang bị app khác dùng, lỏng cáp…).
        failed = e;
        const card = known.find((d) => d.deviceId === first);
        blocked.message = hdmiFailed(card?.label || "camera", e);
        return getMedia("");
      });
      const list = await videoInputs();
      const want = choose(list);
      if (want && media.getVideoTracks()[0].getSettings().deviceId !== want)
        try {
          const next = await getMedia(want);
          media.getTracks().forEach((t) => t.stop());
          media = next;
        } catch {
          /* giữ camera đang mở được */
        }
      if (!usable(media.getVideoTracks()[0])) {
        media.getTracks().forEach((t) => t.stop());
        throw blocked;
      }
      if (!alive.current || turn !== request.current) {
        media.getTracks().forEach((t) => t.stop());
        return false;
      }
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = media;
      setCameras(list);
      video.current.srcObject = media;
      await video.current.play();
      setReady(true);
      setError((e) => (e === CAMERA_ERROR ? "" : e));
      cameraError.current = failed
        ? `${failed.name}: ${failed.message}`.trim()
        : "";
      delete shown.current.camera;
      return true;
    } catch (e) {
      if (alive.current && turn === request.current) {
        cameraError.current =
          e === blocked
            ? failed
              ? `${failed.name}: ${failed.message}`.trim()
              : "Không có thẻ ghi hình dùng được"
            : `${e.name}: ${e.message}`.trim();
        if (e === blocked) {
          // Vẫn chụp được bằng nút chụp / điều khiển từ xa của máy ảnh, chỉ thiếu hình trực tiếp.
          stream.current?.getTracks().forEach((t) => t.stop());
          stream.current = null;
          setReady(false);
          notifyOnce("camera", "warning", blocked.message, 15000);
        } else {
          setError(CAMERA_ERROR);
          notifyOnce("camera", "error", CAMERA_ERROR);
        }
      }
      return false;
    }
  }
  async function start(s) {
    try {
      const result = await api("/kiosk/start", {
        method: "POST",
        retry: 1,
        body: { captureToken: s.captureToken },
      });
      if (!canApplyKioskState(s, current.current, {
        active: alive.current && !doneRef.current,
        finishing: finishing.current,
      })) return;
      update({ ...s, booking: result.booking });
      delete shown.current.start;
      netRecovered();
      return true;
    } catch (e) {
      if (!alive.current || !sameKioskSession(s, current.current) || doneRef.current) return;
      if ([401, 409].includes(e.status)) return leaveSession(e.message);
      if (isTransient(e)) {
        showNetError("start", e.message, "Chưa kết nối được máy chủ — đang tự thử lại.");
        return false;
      }
      setError(e.message);
      toast.error(e.message);
      stop();
    }
  }
  // Mã vé đã mở ở máy chụp khác, bị hủy hoặc phiên quá hạn: trả máy về màn nhập mã.
  function leaveSession(message) {
    cancel.current++;
    clearTimeout(finishRetry.current.timer);
    finishRetry.current = { at: 0, failures: 0, timer: null };
    stop();
    sessionStorage.removeItem(key);
    shown.current = {};
    transition(() => {
      setSession(null);
      setConfirmEnd(false);
      setTimeUp(false);
      setCode("");
      setError("");
    }, "zoom");
    toast.warning(message, 8000);
  }
  function showDone(booking, accessToken, expired) {
    setLeft(QR_SECONDS);
    setDone({
      url: `${window.location.origin}/album/${accessToken}`,
      code: booking.code,
      photos: booking.photos.filter((p) => p.kind === "original").length,
      expiresAt: booking.mediaExpiresAt,
      expired,
    });
  }
  useEffect(() => {
    if (!session?.captureToken) return;
    // Camera permission can wait indefinitely; it must not block session recovery.
    openCamera();
    let stopped = false, running = false, timer, failures = 0;
    const resume = async () => {
      if (stopped || running || doneRef.current || !sameKioskSession(session, current.current)) return;
      running = true;
      clearTimeout(timer);
      try {
        const ready = await start(current.current);
        if (!stopped && ready === false)
          timer = setTimeout(resume, Math.min(30000, 3000 * 2 ** Math.min(failures++, 4)));
      } finally { running = false; }
    };
    resume();
    const unsubscribe = onNetworkRecovery(() => {
      if (!current.current?.booking.captureEndsAt) resume();
    });
    return () => { stopped = true; clearTimeout(timer); unsubscribe(); };
  }, [session?.captureToken]);
  async function claim(e) {
    e.preventDefault();
    if (!device)
      return toast.warning(
        "Máy chụp chưa được gán phòng. Nhờ lễ tân mở liên kết Cài máy chụp.",
      );
    if (!/^\d{6}$/.test(code)) return toast.warning("Mã vé gồm đúng 6 chữ số.");
    if (!canPickFolder)
      return toast.warning(
        "Máy chụp cần Chrome hoặc Edge trên máy tính (Windows / macOS) để nhận ảnh từ máy ảnh.",
      );
    if (!folder || folderAccess !== "granted")
      return toast.warning(
        "Máy chụp chưa đọc được thư mục ảnh của máy ảnh. Nhờ nhân viên mở “Cài đặt máy chụp” để chọn / cho phép thư mục.",
      );
    setBusy(true);
    setError("");
    try {
      const claimed = await api("/kiosk/claim", {
        method: "POST",
        body: { code, device },
      });
      if (claimed.completed) {
        // Khách chụp xong nhưng quên quét QR: hiện lại mã QR nhận ảnh.
        transition(
          () => showDone(claimed.booking, claimed.accessToken, false),
          "zoom",
        );
        toast.info("Mã này đã chụp xong — quét QR để nhận ảnh nhé.");
        return;
      }
      transition(() => update(claimed), "zoom");
      shown.current = {};
      toast.success("Mã hợp lệ! Chúc bạn có buổi chụp thật vui.");
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
      // Mã sai: xóa ô mã để khách nhập lại ngay (ô giới hạn 6 số nên mã sai đầy ô sẽ chặn gõ tiếp).
      // Lỗi khác (mạng, mã đang dùng ở phòng khác…) giữ mã để bấm thử lại.
      if (e.status === 400) setCode("");
    } finally {
      setBusy(false);
    }
  }
  async function sync() {
    if (!current.current || !alive.current) return;
    const started = current.current;
    photoWake.current?.();
    return photoRequests.current.run(async () => {
      try {
        await drainPendingPhotos({
          isActive: () => alive.current && sameKioskSession(started, current.current) &&
            Boolean(kioskPhotoPath(current.current)),
          readPending: () => readPending(started.accessToken),
          subscribe: (wake) => {
            photoWake.current = wake;
            return () => { if (photoWake.current === wake) photoWake.current = null; };
          },
          upload: (row) => {
            const live = current.current;
            const path = kioskPhotoPath(live);
            return savePhoto(path, row.image, {
              captureToken: live.captureToken,
              clientKey: row.id,
              mirrored: row.mirrored,
              preview: row.preview,
            });
          },
          onSaved: async (row, b) => {
            const live = current.current;
            if (canApplyKioskPhoto(started, live, b))
              update({ ...live, booking: { ...mergeUploadedPhotos(live.booking, b), status: b.status } });
            await removePending(row.id);
            trackPending((list) => list.filter((p) => p.id !== row.id));
          },
        });
        if (alive.current && sameKioskSession(started, current.current)) netRecovered();
      } catch (e) {
        if (!alive.current || !sameKioskSession(started, current.current)) return;
        // Phiên vừa chốt trong lúc đang gửi: lần thử sau gửi thẳng vào album, không cần báo lỗi.
        if (e.status === 409 && finishing.current) return;
        showNetError(
          "sync",
          "Ảnh đang giữ an toàn trên thiết bị, chưa đồng bộ: " + e.message,
          "Mạng chập chờn — ảnh vẫn được giữ an toàn trên máy và sẽ tự đồng bộ.",
        );
      }
    });
  }
  // Khách bấm kết thúc: chỉ cho phép khi mọi ảnh đã lưu xong lên hệ thống.
  function requestFinish() {
    if (unsavedRef.current > 0) {
      toast.warning(SAVING_MESSAGE);
      sync();
      return;
    }
    finish();
  }
  // Ảnh của phiên còn nằm trên máy chụp (chưa lưu lên hệ thống).
  const leftToSave = async (token) =>
    (await countPending(token)) +
    readingRef.current +
    detectingRef.current;
  async function finish(expired = false) {
    // Đã hiện mã QR: phiên này xong rồi, không chốt lại lần nữa.
    if (finishing.current || !current.current || doneRef.current) return;
    // Bấm hoàn thành khi còn ảnh đang lưu: không cho kết thúc (hết giờ thì vẫn chốt phiên).
    if (!expired && unsavedRef.current > 0) {
      toast.warning(SAVING_MESSAGE);
      return;
    }
    finishing.current = true;
    let ended = false;
    setConfirmEnd(false);
    if (expired) setTimeUp(true);
    cancel.current++;
    stop();
    setBusy(true);
    try {
      const s = current.current;
      const booking = await api("/kiosk/finish", {
        method: "POST",
        retry: 1,
        body: { captureToken: s.captureToken },
      });
      clearTimeout(finishRetry.current.timer);
      finishRetry.current = { at: 0, failures: 0, timer: null };
      netRecovered();
      update({ ...current.current, booking });
      // Lưu nốt mọi ảnh rồi mới hiện QR. Mạng hỏng quá 90 giây thì vẫn hiện QR để phòng
      // không bị kẹt — ảnh còn lại được giữ trên máy và tự gửi vào album khi có mạng.
      const deadline = Date.now() + 90000;
      for (;;) {
        await sync();
        if (!(await leftToSave(s.accessToken)) || Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      sessionStorage.removeItem(key);
      // Đếm cả ảnh vừa đồng bộ xong sau khi chốt phiên.
      const latest = current.current?.booking || booking;
      ended = true; // giữ "đang kết thúc" tới khi sang khách mới
      transition(() => showDone(latest, s.accessToken, expired), "zoom");
      if (expired)
        toast.warning("Đã hết thời gian chụp! Quét mã QR để nhận ảnh.");
      else toast.success("Hoàn tất buổi chụp! Quét mã QR để nhận ảnh.");
    } catch (e) {
      if ([401, 409].includes(e.status)) return leaveSession(e.message);
      if (isTransient(e)) {
        // Ảnh vẫn giữ trên máy; có mạng lại (hoặc hết thời gian chờ) thì tự chốt phiên và hiện QR.
        const retry = finishRetry.current;
        const delay = Math.max(e.retryAfterMs || 0, Math.min(30000, 2000 * 2 ** Math.min(retry.failures++, 4)));
        retry.at = Date.now() + delay;
        clearTimeout(retry.timer);
        retry.timer = setTimeout(() => {
          if (alive.current && current.current && !doneRef.current) finish(expired);
        }, delay);
        showNetError("finish", e.message, "Chưa kết nối được máy chủ — máy chụp sẽ tự thử lại để hiện mã QR nhận ảnh.");
      } else {
        setError(e.message);
        toast.error(e.message);
      }
    } finally {
      if (!ended) finishing.current = false;
      setBusy(false);
    }
  }
  // Màn hình QR tự đóng sau 2 phút để phòng sẵn sàng cho khách tiếp theo.
  function nextGuest() {
    finishing.current = false;
    clearTimeout(finishRetry.current.timer);
    finishRetry.current = { at: 0, failures: 0, timer: null };
    transition(() => {
      setDone(null);
      setSession(null);
      setTimeUp(false);
      setCode("");
      setStep("start");
      setError("");
      trackPending([]);
      shown.current = {};
    }, "zoom");
  }
  useEffect(() => {
    if (!done) return;
    const timer = setInterval(() => setLeft((n) => n - 1), 1000);
    return () => clearInterval(timer);
  }, [done]);
  useEffect(() => {
    if (done && left <= 0) nextGuest();
  }, [done, left]);
  // Ảnh còn kẹt trên máy (mất mạng lúc chụp) được gửi tiếp vào album khi có mạng.
  useEffect(() => {
    if (session && !done) return;
    let stopped = false;
    const isIdle = () => !stopped && alive.current &&
      (!current.current || doneRef.current);
    const flush = () => photoRequests.current.run(() => flushPendingPhotos({
      isIdle,
      readPending,
      upload: (row) => savePhoto(`/albums/${row.token}/photos`, row.image,
        { clientKey: row.id, mirrored: row.mirrored, preview: row.preview }),
      removePending,
      onSaved: (row) => trackPending((list) => list.filter((p) => p.id !== row.id)),
    })).catch(() => {});
    flush();
    const timer = setInterval(flush, 15000);
    const unsubscribe = onNetworkRecovery(flush);
    return () => {
      stopped = true;
      clearInterval(timer);
      unsubscribe();
    };
  }, [session, done]);
  useEffect(() => {
    // Đồng hồ và báo trạng thái chỉ chạy trong lúc chụp; hiện QR rồi thì dừng.
    if (!session?.booking.captureEndsAt || done) return;
    let stopped = false;
    const tick = () => {
      const left = Math.max(
        0,
        Math.ceil(
          (new Date(current.current.booking.captureEndsAt) - Date.now()) / 1000,
        ),
      );
      setRemaining(left);
      if (left > 0 && left <= 60)
        notifyOnce("minute", "warning", "Còn 1 phút chụp!");
      if (!left && Date.now() >= finishRetry.current.at) finish(true);
    };
    tick();
    const timer = setInterval(tick, 250);
    const pollState = () => stateRequests.current.run(async () => {
      const s = current.current;
      const isCurrent = () => canApplyKioskState(s, current.current, {
        active: !stopped && alive.current,
        finishing: finishing.current,
      });
      if (!s || !isCurrent()) return;
      try {
        const result = await api("/kiosk/state", {
          method: "POST",
          timeout: 10000,
          body: { captureToken: s.captureToken, diag: kioskDiag() },
        });
        if (isCurrent()) update({ ...s, booking: result.booking });
        // Photo saves have their own gate; a slow upload must not delay heartbeats.
        if (!stopped && alive.current && !finishing.current &&
            sameKioskSession(s, current.current)) sync();
      } catch (e) {
        if (!isCurrent()) return;
        if ([401, 409].includes(e.status)) return leaveSession(e.message);
        showNetError("poll", e.message, "Mất kết nối máy chủ — ảnh vẫn được giữ trên máy chụp và sẽ tự đồng bộ.");
      }
    });
    const retry = () => { pollState(); sync(); };
    // Folder watching and photo uploads sync immediately on their own. This
    // heartbeat checks session changes without exhausting the free API proxy.
    const poll = setInterval(pollState, 5000);
    const unsubscribe = onNetworkRecovery(retry);
    return () => {
      stopped = true;
      clearInterval(timer);
      clearInterval(poll);
      unsubscribe();
    };
  }, [session?.booking.captureEndsAt, done]);
  useEffect(() => {
    let live = true;
    if (!session?.accessToken) {
      trackPending([]);
      return;
    }
    readPending(session.accessToken).then(
      (rows) => live && trackPending(rows),
      () => {},
    );
    return () => { live = false; };
  }, [session?.accessToken]);
  async function importCameraPhoto(file, path) {
    const s = current.current;
    if (!s) return;
    const quota = Number(s.booking.shots) || Infinity;
    const savedCount = s.booking.photos.filter((p) => p.kind === "original").length;
    if (savedCount + pendingRef.current.length + readingRef.current >= quota) return true;
    trackReading(1);
    try {
      const { id, image, preview, mirrored } = await prepareCameraPhoto(
        file,
        path,
        () => mirrorRef.current,
      );
      const row = {
        id,
        token: s.accessToken,
        image,
        preview,
        mirrored,
      };
      await savePending(row);
      // An in-flight conversion may finish after a canceled/replaced session.
      // Keep its original guest's durable row; never show it to the next guest.
      if (alive.current && sameKioskSession(s, current.current)) {
        const live = current.current;
        if (!live.captureOrder?.includes(id))
          update({ ...live, captureOrder: [...(live.captureOrder || []), id] });
        trackPending((list) =>
          list.some((p) => p.id === id) ? list : [...list, row],
        );
        setFlash((n) => n + 1);
        sync();
      }
      return true;
    } catch (e) {
      if (alive.current && sameKioskSession(s, current.current))
        notifyOnce(
          "folder-photo",
          "error",
          `Không đọc được ảnh ${path} từ máy ảnh: ${e.message}`,
        );
      return false;
    } finally {
      trackReading(-1);
    }
  }
  useEffect(() => {
    const s = session;
    if (
      done ||
      !folder ||
      folderAccess !== "granted" ||
      !s?.booking.captureStartedAt ||
      (Number(s.booking.shots) > 0 &&
        s.booking.photos.filter((p) => p.kind === "original").length + pending.length >= s.booking.shots)
    )
      return;
    const stopWatching = watchCameraFolder({
      folder,
      booking: s.booking,
      onPhoto: importCameraPhoto,
      notifyOnce,
      onScanSuccess: () => delete shown.current.folder,
      onScan: (info, writing) => {
        setScanInfo((old) =>
          old &&
          ["jpegs", "raws", "fresh", "imported", "newest", "error"].every(
            (k) => old[k] === info[k],
          )
            ? old
            : info,
        );
        scanRef.current = info;
        trackDetecting(writing);
      },
    });
    return () => {
      stopWatching();
      trackDetecting(0);
      setScanInfo(null);
      scanRef.current = null;
    };
  }, [
    done,
    folder,
    folderAccess,
    session?.accessToken,
    session?.booking.captureStartedAt,
    session?.booking.photos.length,
    session?.booking.shots,
    pending.length,
  ]);
  useEffect(() => {
    const quota = Number(session?.booking.shots);
    if (!quota || done || finishing.current || unsaved > 0 ||
      session.booking.status !== "checked_in") return;
    const count = session.booking.photos.filter((p) => p.kind === "original").length;
    if (count >= quota) finish();
  }, [session?.booking.photos.length, session?.booking.shots, session?.booking.status, unsaved, done]);
  // Đếm ngược trước mỗi tấm: chạy lại mỗi khi máy chụp nhận thêm một ảnh, dừng khi đủ số tấm của gói.
  const savedKeys = new Set((session?.booking.photos || []).map((p) => p.clientKey).filter(Boolean));
  const taken = (session?.booking.photos || []).filter((p) => p.kind === "original").length +
    pending.filter((p) => !savedKeys.has(p.id)).length;
  const shotQuota = Number(session?.booking.shots) || 0;
  const counting = Boolean(session?.booking.captureStartedAt) &&
    session?.booking.status === "checked_in" && !done && !timeUp && shotQuota > 0 && taken < shotQuota;
  const [shotLeft, setShotLeft] = useState(null);
  useEffect(() => {
    if (!counting) return setShotLeft(null);
    const seconds = Number(session.booking.countdownSeconds) || 10;
    const end = Date.now() + seconds * 1000;
    setShotLeft(seconds);
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setShotLeft(left);
      if (!left) clearInterval(timer);
    }, 200);
    return () => clearInterval(timer);
  }, [counting, taken]);
  if (done)
    return (
      <KioskDone
        done={done}
        pending={pending}
        left={left}
        nextGuest={nextGuest}
      />
    );
  if (!session)
    return (
      <KioskEntry
        step={step}
        setStep={(next) => {
          setError("");
          transition(() => setStep(next), "fade");
        }}
        claim={claim}
        error={error}
        device={device}
        code={code}
        setCode={setCode}
        busy={busy}
        folder={folder}
        folderAccess={folderAccess}
      >
        <KioskSettings
          folder={folder}
          folderAccess={folderAccess}
          pickFolder={pickFolder}
          grantFolder={grantFolder}
          cameras={cameras}
          cameraId={cameraId}
          setCameraId={setCameraId}
          mirror={mirror}
          setMirror={setMirror}
          toast={toast}
        />
      </KioskEntry>
    );
  const photos = session.booking.photos.filter((p) => p.kind === "original");
  // Ảnh đang lưu và ảnh đã lưu dùng chung một mã (clientKey): lưu xong không nạp lại ảnh.
  const saved = new Set(photos.map((p) => p.clientKey).filter(Boolean));
  const shots = orderBoothShots([
    ...[...pending]
      .reverse()
      .filter((p) => !saved.has(p.id))
      .map((p) => ({ key: p.id, src: p.preview || p.image, label: "Đang lưu…" })),
    ...[...photos].reverse().map((p, i) => ({
      key: p.clientKey || p.id,
      // After a reload the newest shot shows the server's 1600 px preview (already mirrored),
      // not the 15 MB camera original.
      src: directMediaUrl(getApiUrl(`/api/albums/${session.accessToken}/photos/${p.id}?size=preview`)),
      label: `#${String(p.number || photos.length - i).padStart(2, "0")}`,
    })),
  ], session.captureOrder);
  const clock = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  return (
    <section className="self-booth">
      <header className="booth-header">
        <div className="booth-package">
          <span className="booth-session-id">
            {session.booking.roomName} · VÉ {session.booking.code}
          </span>
          <strong>{session.booking.packageName}</strong>
          <small>{Number(session.booking.shots) > 0
            ? `${photos.length}/${session.booking.shots} ảnh · ${session.booking.countdownSeconds || 10} giây/ảnh`
            : "Chụp ảnh theo thời gian gói"}</small>
        </div>
        <div
          className={`session-clock ${remaining < 60 ? "urgent" : ""}`}
          role="timer"
          aria-label="Thời gian còn lại"
        >
          <PiTimerDuotone />
          {clock}
        </div>
        <Button
          onClick={() =>
            remaining > 15 ? setConfirmEnd(true) : requestFinish()
          }
          disabled={busy || unsaved > 0}
          title={unsaved > 0 ? SAVING_MESSAGE : undefined}
          className="booth-finish"
        >
          {unsaved > 0 ? (
            <>
              <span className="spinner" aria-hidden="true" /> Đang lưu {unsaved}{" "}
              ảnh…
            </>
          ) : (
            <>
              <PiCheckCircleBold /> Hoàn thành chụp
            </>
          )}
        </Button>
      </header>
      <ErrorBox error={error} />

      <div className="booth-top">
        <div className="self-viewfinder">
          <CameraPreview videoRef={video} />
          {!ready && (
            <div className="camera-cover">
              <PiVideoCameraSlashDuotone size={42} />
              <p>
                Chưa có hình trực tiếp từ máy ảnh (thẻ ghi hình HDMI) — vẫn chụp
                được bằng nút chụp / điều khiển từ xa của máy ảnh
              </p>
              <Button className="outline" onClick={() => start(session)}>
                Mở lại camera
              </Button>
            </div>
          )}
          {flash > 0 && (
            <div className="camera-flash" key={flash} aria-hidden="true" />
          )}
          {shotLeft !== null && !confirmEnd && (
            <div className="shot-countdown" role="timer">
              <small>Tấm {Math.min(taken + 1, shotQuota)}/{shotQuota}</small>
              {shotLeft > 0 ? (
                <strong key={shotLeft}>{shotLeft}</strong>
              ) : (
                <strong className="smile">Cười lên! 📸</strong>
              )}
            </div>
          )}
          {confirmEnd && (
            <div
              className="kiosk-confirm"
              role="dialog"
              aria-modal="true"
              aria-labelledby="end-title"
            >
              <div className="kiosk-confirm-card">
                <PiTimerDuotone size={40} />
                <h2 id="end-title">Kết thúc buổi chụp?</h2>
                <p>
                  Bạn vẫn còn <b>{clock}</b>.{" "}
                  {shots.length
                    ? `Bạn đã chụp ${shots.length} ảnh.`
                    : "Bạn chưa chụp ảnh nào."}{" "}
                  Kết thúc rồi sẽ không chụp tiếp được.
                </p>
                {unsaved > 0 && (
                  <p className="save-count" role="status">
                    <span className="spinner" aria-hidden="true" /> Đang lưu{" "}
                    {unsaved} ảnh — lưu xong mới kết thúc được.
                  </p>
                )}
                <div>
                  <Button
                    className="outline"
                    autoFocus
                    onClick={() => setConfirmEnd(false)}
                  >
                    Chụp tiếp
                  </Button>
                  <Button disabled={unsaved > 0} onClick={requestFinish}>
                    {unsaved > 0 ? "Đang lưu ảnh…" : "Kết thúc & nhận ảnh"}
                  </Button>
                </div>
              </div>
            </div>
          )}
          {timeUp && (
            <div className="camera-timeup" role="alert">
              <PiTimerDuotone size={48} />
              <strong>Đã hết thời gian chụp!</strong>
              {unsaved > 0 ? (
                <>
                  <span className="spinner big" aria-hidden="true" />
                  <span>{SAVING_MESSAGE}</span>
                  <div
                    className="save-progress"
                    role="progressbar"
                    aria-label="Tiến độ lưu ảnh"
                    aria-valuemin={0}
                    aria-valuemax={photos.length + unsaved}
                    aria-valuenow={photos.length}
                  >
                    <i
                      style={{
                        width: `${(photos.length / Math.max(1, photos.length + unsaved)) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="save-count">
                    Đã lưu {photos.length}/{photos.length + unsaved} ảnh — xong
                    sẽ hiện mã QR nhận ảnh.
                  </span>
                </>
              ) : (
                <span>Đang tạo mã QR để bạn nhận ảnh…</span>
              )}
            </div>
          )}
        </div>
      </div>

      <BoothGallery
        shots={shots}
        folder={folder}
        folderAccess={folderAccess}
        scanInfo={scanInfo}
        unsaved={unsaved}
        grantFolder={grantFolder}
        pickFolder={pickFolder}
      />
    </section>
  );
}
