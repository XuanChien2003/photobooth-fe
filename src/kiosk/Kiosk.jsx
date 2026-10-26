import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, getApiUrl } from "../api";
import { isTransient, onNetworkRecovery } from "../network.js";
import { mergeUploadedPhotos } from "../album/upload-photos.js";
import { ErrorBox, useStudio, useToast } from "../studio";
import {
  savePending,
  readPending,
  removePending,
  readSetting,
  saveSetting,
} from "../capture-store";
import { transition } from "../transitions";
import { CAMERA_KEY, FOLDER_KEY, MIRROR_KEY, QR_SECONDS } from "./constants.js";
import {
  CAMERA_ERROR,
  cameraRank,
  CAMERA_USB_MESSAGE,
  hdmiFailed,
  isCameraUsbVideo,
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
import { cameraPhotoId, prepareCameraPhoto } from "./photo.js";
import { directMediaUrl } from "../media-delivery.js";
import { savePhoto } from "./direct-upload.js";
import { watchCameraFolder } from "./watch-camera-folder.js";
import {
  canApplyKioskPhoto,
  canApplyKioskState,
  createSingleFlight,
  drainPendingPhotos,
  flushPendingPhotos,
  kioskPhotoPath,
  sameKioskSession,
} from "./network-tasks.js";
import { readCrop } from "./live-preview-layout.js";
import { prepareShutter } from "./shutter.js";
import { runTimedShot } from "./timed-shot.js";
import { connectCanonCamera } from "./canon-camera.js";
import { buildTimelapse, createClipRecorder } from "./clip-recorder.js";
import {
  compositeJpeg,
  composePreview,
  frameCandidates,
  printSheets,
  queueKioskComposite,
  queueKioskPrint,
  renderPrintFrame,
  runKioskComposites,
  runKioskPrints,
  watchKioskPrint,
  kioskPrintState,
} from "./compose.js";
import { billAcceptor } from "./bill-acceptor.js";
import { KioskDone } from "./KioskDone.jsx";
import { KioskEntry } from "./KioskEntry.jsx";
import { KioskSettings } from "./KioskSettings.jsx";
import { KioskShoot } from "./KioskShoot.jsx";
import { KioskSelect, useShotBitmaps } from "./KioskSelect.jsx";
import { KioskPackages, KioskPayment } from "./KioskSale.jsx";

// Các chỗ báo lỗi mạng ở màn chụp: mỗi lần mất kết nối chỉ báo một lần, có mạng lại thì xoá.
const NET_SLOTS = ["poll", "sync", "start", "finish"];
const PING_MS = 60_000;
// Thời gian của từng bước sau khi chọn gói: chọn cách chụp, chuẩn bị, chọn ảnh & khung (cùng một màn).
const MODE_SECONDS = 30;
const READY_SECONDS = 3;
const SELECT_SECONDS = 90;
const SHOT_WAIT_MS = 15000;
const SALE_KEY = "kiosk-sale";
// Phòng của máy chụp đọc ngay từ liên kết cài máy (phần giữa của mã), trước khi máy chủ trả lời.
function deviceRoom(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part)).room || "";
  } catch {
    return "";
  }
}
// Bước của lượt chụp (lưu cùng phiên để tải lại trang vẫn tiếp tục đúng chỗ).
const phaseOf = (s) =>
  !s ? null : s.phase || (s.booking.captureStartedAt ? "shoot" : "mode");
const secondsUntil = (at) => Math.max(0, Math.ceil(((at || 0) - Date.now()) / 1000));
function readSale() {
  try {
    return JSON.parse(localStorage.getItem(SALE_KEY)) || null;
  } catch {
    return null;
  }
}

export function Kiosk() {
  const [params] = useSearchParams(),
    toast = useToast();
  const { packages = [], frames: catalogFrames = [], settings = {} } = useStudio();
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
    // Chế độ lật ảnh quản trị đặt cho phòng (Quản lý máy): "device" = theo cài đặt trên máy này.
    [remoteFlip, setRemoteFlip] = useState("device"),
    [roomId, setRoomId] = useState(() => deviceRoom(device)),
    // Cách trả tiền của phòng (Quản lý máy): mua mã ở quầy / đút tiền tại máy, và chế độ thử.
    [roomInfo, setRoomInfo] = useState(null),
    [folder, setFolder] = useState(null),
    [folderAccess, setFolderAccess] = useState("none"),
    [cameraId, setCameraId] = useState(
      () => localStorage.getItem(CAMERA_KEY) || "",
    ),
    [cameras, setCameras] = useState([]),
    [zoom, setZoom] = useState(readCrop);
  const [ready, setReady] = useState(false),
    [flash, setFlash] = useState(0),
    [done, setDone] = useState(null),
    [left, setLeft] = useState(0),
    [remaining, setRemaining] = useState(0),
    [pending, setPending] = useState([]),
    [ending, setEnding] = useState(false),
    [composing, setComposing] = useState(false),
    [tick, setTick] = useState(0),
    // Ảnh máy ảnh đang ghi vào thư mục / đang đọc để gửi lên (chế độ ảnh gốc máy ảnh).
    [detecting, setDetecting] = useState(0),
    [reading, setReading] = useState(0),
    [scanInfo, setScanInfo] = useState(null),
    // Bán lượt chụp tại máy: gói đã chọn và các tờ tiền đã nhận (giữ lại khi tải lại trang).
    [sale, setSaleState] = useState(readSale),
    [video, setVideo] = useState(null),
    [print, setPrint] = useState(null),
    [shotRetry, setShotRetry] = useState(0),
    [captureState, setCaptureState] = useState("idle"),
    [captureError, setCaptureError] = useState("");
  const video$ = useRef(null),
    stream = useRef(null),
    alive = useRef(true),
    finishing = useRef(false),
    finishRetry = useRef({ at: 0, failures: 0, timer: null }),
    current = useRef(session),
    photoRequests = useRef(createSingleFlight()),
    photoWake = useRef(null),
    stateRequests = useRef(createSingleFlight()),
    request = useRef(0),
    // Ảnh của lượt đang chụp còn trên máy (ảnh gốc + ảnh xem nhanh): chọn ảnh, ghép khung và in
    // không phải chờ ảnh gốc tải lên mạng.
    localShots = useRef(new Map()),
    recorder = useRef(createClipRecorder()),
    endingRef = useRef(false);
  current.current = session;
  const phase = phaseOf(session);
  const key = "photo-capture-" + device.slice(-24);
  const shown = useRef({});
  const mirrorRef = useRef(mirror);
  mirrorRef.current = mirror;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const setSale = (next) => {
    setSaleState(next);
    if (next) localStorage.setItem(SALE_KEY, JSON.stringify(next));
    else localStorage.removeItem(SALE_KEY);
  };
  function applyFlip(flip) {
    setRemoteFlip(flip || "device");
    if (flip !== "on" && flip !== "off") return;
    mirrorRef.current = flip === "on";
    setMirror(flip === "on");
    localStorage.setItem(MIRROR_KEY, flip === "on" ? "1" : "0");
  }
  // Báo máy còn mở mỗi phút (Quản lý máy hiện Online / Offline), nhận chế độ lật ảnh và cách trả
  // tiền quản trị đặt từ xa.
  useEffect(() => {
    if (!device) return;
    let stopped = false;
    const ping = () =>
      api("/kiosk/ping", { method: "POST", body: { device } }).then(
        ({ room }) => {
          if (stopped) return;
          setRoomId(room._id);
          setRoomInfo(room);
          applyFlip(room.flip);
        },
        () => {},
      );
    ping();
    const timer = setInterval(ping, PING_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [device]);
  // Máy nhận tiền: mở lại cổng đã cho phép, luôn khóa nhận tiền ngoài màn trả tiền.
  useEffect(() => {
    billAcceptor.connect(false).catch(() => {}).finally(() => billAcceptor.setEnabled(false).catch(() => {}));
    runKioskPrints();
    runKioskComposites();
    connectCanonCamera().catch(() => {});
    return watchKioskPrint((token, state) => {
      if (token === current.current?.accessToken || token === doneRef.current?.token) setPrint(state);
      if (state.status === "manual")
        notifyOnce("print-manual", "warning", "Máy chủ chưa bật in tự động (PRINT_AGENT_TOKEN trên Render) — in ảnh thủ công từ trang Đơn hàng.", 15000);
      if (state.status === "stalled")
        notifyOnce("print-stalled", "warning", "Máy in ở quầy chưa nhận lệnh in — kiểm tra chương trình in tự động (print-agent) đang chạy và máy in DNP đã bật.", 15000);
      if (state.status === "failed" && state.message)
        notifyOnce("print-failed", "error", `Máy in báo lỗi: ${state.message}`, 15000);
    });
  }, []);
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
  const cameraError = useRef("");
  const kioskDiag = () => ({
    ...diagRef.current,
    camera: stream.current?.getVideoTracks()[0]?.label || "",
    cameraError: cameraError.current.slice(0, 300),
    ...scanRef.current,
  });
  const doneRef = useRef(null);
  doneRef.current = done;
  const readingRef = useRef(0),
    detectingRef = useRef(0),
    pendingRef = useRef(pending);
  readingRef.current = reading;
  detectingRef.current = detecting;
  pendingRef.current = pending;
  const trackPending = (next) => {
    const rows = typeof next === "function" ? next(pendingRef.current) : next;
    pendingRef.current = rows;
    setPending(rows);
  };
  const trackReading = (change) => {
    readingRef.current += change;
    setReading(readingRef.current);
  };
  const trackDetecting = (count) => {
    detectingRef.current = count;
    setDetecting(count);
  };
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
          `Đã chọn thư mục ảnh “${handle.name}” nhưng máy chụp chưa thấy ảnh JPG nào. Hãy chọn đúng thư mục Canon Camera Agent đang lưu ảnh (các tệp JPEG gốc từ R100), hoặc chụp thử 1 tấm rồi bấm “Thử nhận ảnh từ máy ảnh”. Thư mục có ảnh mà vẫn báo 0: ${FOLDER_ACCESS_HINT}`,
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
  const liveCamera = ["mode", "ready", "shoot"].includes(phase);
  const reopenRef = useRef(null);
  reopenRef.current = () => {
    if (liveCamera && !ready && !endingRef.current && !doneRef.current) openCamera();
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
      request.current++;
      stream.current?.getTracks().forEach((t) => t.stop());
      billAcceptor.setEnabled(false).catch(() => {});
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
  const patch = (changes) => current.current && update({ ...current.current, ...changes });
  function stop() {
    request.current++;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setReady(false);
  }
  // Mặc định dùng thẻ ghi hình / máy ảnh, không dùng OBS; nhớ lựa chọn của nhân viên.
  async function openCamera(id = cameraId) {
    const turn = ++request.current;
    const getMedia = (deviceId) =>
      navigator.mediaDevices.getUserMedia(videoConstraints(deviceId));
    const videoInputs = async () =>
      (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === "videoinput",
      );
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
      const known = await videoInputs();
      const named = known.some((d) => d.label);
      const first = named ? choose(known) : id;
      blocked.message = known.some(isCameraUsbVideo)
        ? CAMERA_USB_MESSAGE
        : NO_HDMI_MESSAGE;
      if (named && !first && known.some((d) => !usable(d))) throw blocked;
      let media = await getMedia(first).catch((e) => {
        if (!first) throw e;
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
      if (!alive.current || turn !== request.current || !video$.current) {
        media.getTracks().forEach((t) => t.stop());
        return false;
      }
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = media;
      setCameras(list);
      video$.current.srcObject = media;
      await video$.current.play().catch(() => {});
      setReady(true);
      setError((e) => (e === CAMERA_ERROR ? "" : e));
      cameraError.current = failed ? `${failed.name}: ${failed.message}`.trim() : "";
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
    }
  }
  // Mã vé đã mở ở máy chụp khác, bị hủy hoặc phiên quá hạn: trả máy về màn chờ.
  function leaveSession(message) {
    clearTimeout(finishRetry.current.timer);
    finishRetry.current = { at: 0, failures: 0, timer: null };
    stop();
    sessionStorage.removeItem(key);
    shown.current = {};
    transition(() => {
      setSession(null);
      setStep("start");
      setCode("");
      setError("");
    }, "zoom");
    toast.warning(message, 8000);
  }

  // ─── Mở lượt chụp: mã từ quầy hoặc trả tiền tại máy ─────────────────────
  function openSession(opened) {
    applyFlip(opened.flip);
    localShots.current = new Map();
    recorder.current = createClipRecorder();
    setVideo(null);
    setPrint(null);
    transition(() => update({ ...opened, phase: "mode", modeEndsAt: Date.now() + MODE_SECONDS * 1000 }), "zoom");
    shown.current = {};
  }
  const checkFolder = () => {
    if (!canPickFolder) {
      toast.warning("Máy chụp cần Chrome hoặc Edge trên máy tính (Windows / macOS) để nhận ảnh từ máy ảnh.");
      return false;
    }
    if (!folder || folderAccess !== "granted") {
      toast.warning("Máy chụp chưa đọc được thư mục ảnh của máy ảnh. Nhờ nhân viên mở “Cài đặt máy chụp” để chọn / cho phép thư mục.");
      return false;
    }
    return true;
  };
  async function claim(e) {
    e.preventDefault();
    if (!device)
      return toast.warning("Máy chụp chưa được gán phòng. Nhờ lễ tân mở liên kết Cài máy chụp.");
    if (!/^\d{6}$/.test(code)) return toast.warning("Mã vé gồm đúng 6 chữ số.");
    if (!checkFolder()) return;
    setBusy(true);
    setError("");
    try {
      const claimed = await api("/kiosk/claim", { method: "POST", body: { code, device } });
      if (claimed.completed) {
        applyFlip(claimed.flip);
        transition(() => showDone(claimed.booking, claimed.accessToken, {}), "zoom");
        toast.info("Mã này đã chụp xong — quét QR để nhận ảnh nhé.");
        return;
      }
      openSession(claimed);
      toast.success("Mã hợp lệ! Chúc bạn có buổi chụp thật vui.");
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
      if (e.status === 400) setCode("");
    } finally {
      setBusy(false);
    }
  }
  // Đủ tiền (hoặc bỏ qua ở chế độ thử): máy chủ mở lượt chụp bằng đúng mã giao dịch đã lưu.
  async function buy(skip = false) {
    const s = readSale() || sale;
    if (!s?.pack || busy) return;
    if (!checkFolder()) return;
    setBusy(true);
    setError("");
    try {
      const opened = await api("/kiosk/sale", {
        method: "POST",
        retry: 2,
        body: { device, package: s.pack._id, requestKey: s.requestKey, skip, bills: s.bills },
      });
      setSale(null);
      openSession(opened);
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  const roomPackages = useMemo(
    () => packages.filter((p) => !p.branches?.length || p.branches.includes(roomInfo?.branch)),
    [packages, roomInfo?.branch],
  );
  const sellsHere = roomInfo?.payment === "cash" || roomInfo?.paymentTest;

  // ─── Chụp ────────────────────────────────────────────────────────────────
  // Hình trực tiếp mở từ lúc chọn cách chụp (khách thấy mình ngay), tắt khi chuyển sang chọn ảnh.
  useEffect(() => {
    if (!session?.captureToken) return;
    if (liveCamera) {
      if (!stream.current) openCamera();
    } else stop();
  }, [session?.captureToken, liveCamera]);
  // Máy chủ bắt đầu tính giờ trước khi chụp; luồng đếm giờ chỉ đếm khi đã mở phiên thành công.
  useEffect(() => {
    if (!session?.captureToken || phase !== "shoot") return;
    let stopped = false, running = false, timer, failures = 0;
    const resume = async () => {
      if (stopped || running || doneRef.current || !sameKioskSession(session, current.current)) return;
      if (current.current.booking.captureStartedAt) return;
      running = true;
      clearTimeout(timer);
      try {
        const ok = await start(current.current);
        if (!stopped && ok === false)
          timer = setTimeout(resume, Math.min(30000, 3000 * 2 ** Math.min(failures++, 4)));
      } finally {
        running = false;
      }
    };
    resume();
    const unsubscribe = onNetworkRecovery(resume);
    return () => {
      stopped = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [session?.captureToken, phase]);
  // Quay video tua nhanh trong lúc chụp (cần hình trực tiếp HDMI).
  useEffect(() => {
    if (phase === "shoot" && ready && stream.current) recorder.current.start(stream.current);
  }, [phase, ready]);
  // Đồng hồ các bước chọn cách chụp / chọn ảnh / chọn khung.
  useEffect(() => {
    if (!["mode", "ready", "select", "frame"].includes(phase)) return;
    const timer = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(timer);
  }, [phase]);
  const modeLeft = secondsUntil(session?.modeEndsAt);
  const preCount = secondsUntil(session?.readyEndsAt);
  useEffect(() => {
    if (phase === "mode" && session.modeEndsAt && !modeLeft) pickMode("timer");
    if (phase === "ready" && !preCount) patch({ phase: "shoot" });
  }, [phase, modeLeft, preCount]);
  function pickMode(mode) {
    if (phaseOf(current.current) !== "mode") return;
    setCaptureError("");
    setCaptureState(mode === "timer" ? "connecting" : "idle");
    // Đếm giờ có đúng một lượt 3–2–1, sau khi API và máy ảnh sẵn sàng.
    patch({ mode, phase: mode === "timer" ? "shoot" : "ready",
      readyEndsAt: mode === "timer" ? null : Date.now() + READY_SECONDS * 1000 });
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
        // Phiên vừa chốt trong lúc ảnh đang gửi: lần đồng bộ sau gửi thẳng vào album, không phải
        // lỗi mạng nên không báo khách.
        if (e.status === 409) return;
        showNetError(
          "sync",
          "Ảnh đang giữ an toàn trên thiết bị, chưa đồng bộ: " + e.message,
          "Mạng chập chờn — ảnh vẫn được giữ an toàn trên máy và sẽ tự đồng bộ.",
        );
      }
    });
  }
  // Chốt phiên trên máy chủ (chạy nền, tự thử lại): khách đi tiếp sang chọn ảnh ngay, ảnh gốc
  // vẫn tiếp tục tải lên album phía sau.
  async function finishOnServer() {
    const s = current.current;
    if (!s || finishing.current || s.booking.status === "completed") return;
    finishing.current = true;
    try {
      const booking = await api("/kiosk/finish", {
        method: "POST",
        retry: 1,
        body: { captureToken: s.captureToken },
      });
      clearTimeout(finishRetry.current.timer);
      finishRetry.current = { at: 0, failures: 0, timer: null };
      netRecovered();
      if (sameKioskSession(s, current.current)) update({ ...current.current, booking });
      sync();
    } catch (e) {
      if (!sameKioskSession(s, current.current)) return;
      if (isTransient(e) || e.status >= 500) {
        const retry = finishRetry.current;
        const delay = Math.max(e.retryAfterMs || 0, Math.min(30000, 2000 * 2 ** Math.min(retry.failures++, 4)));
        retry.at = Date.now() + delay;
        clearTimeout(retry.timer);
        retry.timer = setTimeout(() => {
          if (alive.current && sameKioskSession(s, current.current)) finishOnServer();
        }, delay);
        showNetError("finish", e.message, "Chưa kết nối được máy chủ — máy chụp tự thử lại, bạn cứ chọn ảnh.");
      }
    } finally {
      finishing.current = false;
    }
  }
  // Ghép các clip thành video tua nhanh trong lúc khách chọn ảnh, rồi gửi lên album.
  async function makeVideo(clips, s) {
    if (!clips.length) return;
    setVideo({ token: s.accessToken, pending: true });
    let blob = null;
    try {
      blob = await buildTimelapse(clips, { zoom: zoomRef.current });
    } catch {
      blob = null;
    }
    if (!blob) {
      setVideo((v) => (v?.token === s.accessToken ? { token: s.accessToken } : v));
      return;
    }
    const url = URL.createObjectURL(blob);
    setVideo((v) => (v?.token === s.accessToken || !v ? { token: s.accessToken, url } : v));
    const body = new Blob([blob], { type: blob.type.split(";")[0] || "video/webm" });
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await api("/kiosk/video", {
          method: "POST",
          body,
          timeout: 180000,
          headers: { "X-Capture-Token": s.captureToken },
        });
        return;
      } catch (e) {
        if (!isTransient(e) && !(e.status >= 500)) return;
        await new Promise((resolve) => setTimeout(resolve, 5000 * (attempt + 1)));
      }
    }
  }
  // Ảnh của lượt chụp theo thứ tự chụp: ảnh trên máy (nhanh) hoặc ảnh đã lưu trên máy chủ.
  const shotsOf = (s) => {
    if (!s) return [];
    const photos = s.booking.photos.filter((p) => p.kind === "original");
    const saved = new Map(photos.map((p) => [p.clientKey || String(p.id), p]));
    const order = [...new Set([...(s.captureOrder || []), ...photos.map((p) => p.clientKey || String(p.id))])];
    return order
      .map((shotKey) => {
        const local = localShots.current.get(shotKey);
        const server = saved.get(shotKey);
        if (!local && !server) return null;
        return {
          key: shotKey,
          preview: local?.preview ||
            directMediaUrl(getApiUrl(`/api/albums/${s.accessToken}/photos/${server.id}?size=preview`)),
          image: local?.image,
          mirrored: local ? local.mirrored : Boolean(server?.mirrored),
          serverId: server?.id,
        };
      })
      .filter(Boolean);
  };
  const shots = useMemo(() => shotsOf(session), [session, pending]);
  const taken = shots.length;
  const shotQuota = Number(session?.booking.shots) || 0;
  // Hết chụp (đủ số tấm, hết giờ hoặc khách bấm xong): sang bước chọn ảnh ngay.
  async function endCapture(expired = false) {
    const s = current.current;
    if (!s || endingRef.current || phaseOf(s) !== "shoot") return;
    endingRef.current = true;
    setEnding(true);
    try {
      // Đợi ảnh đang đọc từ thư mục máy ảnh (trên máy, vài giây) — không đợi tải lên mạng.
      const deadline = Date.now() + (expired ? 15000 : 30000);
      while ((readingRef.current || detectingRef.current) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 300));
      const clips = await recorder.current.stop();
      stop();
      finishOnServer();
      makeVideo(clips, s);
      const live = current.current;
      const list = shotsOf(live);
      if (!list.length) {
        transition(() => showDone(live.booking, live.accessToken, { expired }), "zoom");
        return;
      }
      transition(() => update({
        ...live,
        phase: "select",
        selected: [],
        selectEndsAt: Date.now() + SELECT_SECONDS * 1000,
      }), "zoom");
      if (expired) toast.info("Đã hết thời gian chụp — mời bạn chọn ảnh.");
    } finally {
      endingRef.current = false;
      setEnding(false);
    }
  }
  // Ảnh chưa gửi lên được giữ trên máy và tự gửi tiếp trong lúc khách chọn ảnh & khung.
  useEffect(() => {
    if (!["select", "frame"].includes(phase)) return;
    sync();
    const timer = setInterval(sync, 5000);
    const unsubscribe = onNetworkRecovery(sync);
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [phase, session?.accessToken]);

  // ─── Chọn ảnh & khung ────────────────────────────────────────────────────
  const selectCount = Math.max(1, Number(session?.booking.selectCount) || 4);
  const frames = useMemo(
    () => frameCandidates(catalogFrames, {
      count: Math.min(selectCount, Math.max(1, shots.length)),
      printSize: session?.booking.printSize,
      themeOrder: (settings.themes || []).map((t) => t.name),
    }),
    [catalogFrames, selectCount, shots.length, session?.booking.printSize, settings.themes],
  );
  const flowShots = ["select", "frame"].includes(phase) ? shots : [];
  const bitmaps = useShotBitmaps(flowShots, session?.accessToken);
  const selected = session?.selected || [];
  const need = Math.min(selectCount, shots.length);
  const toggleShot = (shotKey) => {
    const list = current.current.selected || [];
    patch({
      selected: list.includes(shotKey)
        ? list.filter((k) => k !== shotKey)
        : list.length < need ? [...list, shotKey] : list,
    });
  };
  // Chọn ảnh và khung trên cùng một màn ("frame" là bước cũ — lượt dở dang trước khi cập nhật).
  const choosing = phase === "select" || phase === "frame";
  const selectLeft = secondsUntil(session?.selectEndsAt || session?.frameEndsAt);
  // Hết giờ: tự chọn các tấm đầu cho đủ rồi in.
  useEffect(() => {
    if (choosing && (session.selectEndsAt || session.frameEndsAt) && !selectLeft && !composing) confirmFrame();
  }, [phase, selectLeft]);
  const frameIndex = Math.min(session?.frameIndex || 0, Math.max(0, frames.length - 1));
  // Bấm "In ảnh": hiện màn QR ngay với ảnh ghép xem trước; bản in chất lượng cao ghép và gửi máy in
  // ở phía sau.
  async function confirmFrame() {
    const s = current.current;
    if (!s || composing || !["select", "frame"].includes(phaseOf(s))) return;
    // Chưa chọn đủ (hết giờ): thêm các tấm đầu tiên chưa chọn.
    const all = shotsOf(s);
    const keys = [...(s.selected || [])];
    for (const shot of all) if (keys.length < need && !keys.includes(shot.key)) keys.push(shot.key);
    const chosenShots = keys.map((k) => all.find((x) => x.key === k)).filter(Boolean);
    const frame = frames[Math.min(s.frameIndex || 0, Math.max(0, frames.length - 1))];
    setComposing(true);
    try {
      let composite = "";
      const albumLink = `${window.location.origin}/album/${s.accessToken}`;
      const images = chosenShots.map((x) => bitmaps.get(x.key)).filter(Boolean);
      if (frame) {
        const canvas = await composePreview(frame, images, 700, albumLink);
        composite = canvas.toDataURL("image/jpeg", 0.9);
        canvas.width = canvas.height = 0;
      } else {
        // Tiệm chưa bật khung nào: màn cuối hiện tấm đầu tiên khách chọn (chưa ghép).
        notifyOnce("no-frame", "warning", "Chưa có khung ảnh nào đang bật — thêm khung ở Quản lý → Khung ảnh để ghép và in.", 15000);
        if (images[0]) {
          const canvas = document.createElement("canvas");
          canvas.width = 700;
          canvas.height = Math.round((700 * images[0].height) / images[0].width);
          canvas.getContext("2d").drawImage(images[0], 0, 0, canvas.width, canvas.height);
          composite = canvas.toDataURL("image/jpeg", 0.9);
          canvas.width = canvas.height = 0;
        }
      }
      const printsCount = Number(s.booking.prints) || 0;
      transition(() => showDone(s.booking, s.accessToken, { composite, framed: Boolean(frame), prints: printsCount }), "zoom");
      if (frame) {
        if (printsCount) setPrint({ status: "sending" });
        const frameName = frame.themeName?.trim() || frame.name || "Khung ảnh";
        // Bản ghép chất lượng in: gửi vào album (khách xem / tải) và, nếu gói có in, ra máy in.
        (async () => {
          let printFrame = null;
          try {
            printFrame = await renderPrintFrame(frame, chosenShots, s.accessToken, albumLink);
            await queueKioskComposite({
              token: s.accessToken,
              captureToken: s.captureToken,
              image: await compositeJpeg(printFrame),
              frameName,
            }).catch(() => {});
            if (printsCount)
              await queueKioskPrint({
                token: s.accessToken,
                images: await printSheets(printFrame, frame, printsCount),
                frameName,
              });
          } catch (e) {
            if (printsCount) setPrint({ status: "failed", message: e.message });
          } finally {
            if (printFrame) printFrame.width = printFrame.height = 0;
          }
        })();
      }
    } finally {
      setComposing(false);
    }
  }
  function showDone(booking, accessToken, { expired = false, composite = "", framed = true, prints } = {}) {
    setLeft(QR_SECONDS);
    setPrint(kioskPrintState(accessToken) || null);
    setDone({
      token: accessToken,
      url: `${window.location.origin}/album/${accessToken}`,
      code: booking.code,
      photos: booking.photos.filter((p) => p.kind === "original").length,
      composite,
      framed,
      prints: prints ?? 0,
      expired,
    });
  }
  // Màn QR tự đóng sau 2 phút để phòng sẵn sàng cho khách tiếp theo.
  function nextGuest() {
    clearTimeout(finishRetry.current.timer);
    finishRetry.current = { at: 0, failures: 0, timer: null };
    stop();
    sessionStorage.removeItem(key);
    // Ảnh gốc của khách vừa xong vẫn nằm trong hàng gửi (IndexedDB) nếu chưa tải lên hết.
    localShots.current = new Map();
    if (video?.url) setTimeout(() => URL.revokeObjectURL(video.url), 1000);
    transition(() => {
      setDone(null);
      setSession(null);
      setCode("");
      setStep("start");
      setError("");
      setVideo(null);
      setPrint(null);
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
  // Đồng hồ phiên chụp và báo trạng thái: chỉ chạy trong lúc chụp.
  useEffect(() => {
    if (!session?.booking.captureEndsAt || phase !== "shoot" || done) return;
    let stopped = false;
    const clock = () => {
      const secondsLeft = Math.max(
        0,
        Math.ceil((new Date(current.current.booking.captureEndsAt) - Date.now()) / 1000),
      );
      setRemaining(secondsLeft);
      if (!secondsLeft) endCapture(true);
    };
    clock();
    const timer = setInterval(clock, 250);
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
        if (!stopped && alive.current && sameKioskSession(s, current.current)) sync();
      } catch (e) {
        if (!isCurrent()) return;
        if ([401, 409].includes(e.status)) return leaveSession(e.message);
        showNetError("poll", e.message, "Mất kết nối máy chủ — ảnh vẫn được giữ trên máy chụp và sẽ tự đồng bộ.");
      }
    });
    const retry = () => { pollState(); sync(); };
    const poll = setInterval(pollState, 5000);
    const unsubscribe = onNetworkRecovery(retry);
    return () => {
      stopped = true;
      clearInterval(timer);
      clearInterval(poll);
      unsubscribe();
    };
  }, [session?.booking.captureEndsAt, phase, done]);
  // Tải lại trang giữa lượt chụp: ảnh chưa gửi lên vẫn còn trên máy, dùng lại để chọn và in.
  useEffect(() => {
    let live = true;
    if (!session?.accessToken) {
      trackPending([]);
      return;
    }
    readPending(session.accessToken).then(
      (rows) => {
        if (!live) return;
        for (const row of rows)
          if (!localShots.current.has(row.id))
            localShots.current.set(row.id, { image: row.image, preview: row.preview, mirrored: row.mirrored });
        trackPending(rows);
      },
      () => {},
    );
    return () => { live = false; };
  }, [session?.accessToken]);
  // Nhận một ảnh: kiểm tra trùng trước khi đọc tệp (đọc lại thư mục không đọc lại ảnh đã nhận).
  async function importCameraPhoto(file, path) {
    const s = current.current;
    if (!s || phaseOf(s) !== "shoot") return true;
    const id = await cameraPhotoId(file, path);
    if (localShots.current.has(id) || (s.captureOrder || []).includes(id) ||
      s.booking.photos.some((p) => p.clientKey === id)) return true;
    const quota = Number(s.booking.shots) || Infinity;
    if (shotsOf(s).length + readingRef.current >= quota) return true;
    trackReading(1);
    try {
      const { image, preview, mirrored } = await prepareCameraPhoto(file, path, () => mirrorRef.current);
      const row = { id, token: s.accessToken, image, preview, mirrored };
      await savePending(row);
      if (alive.current && sameKioskSession(s, current.current)) {
        localShots.current.set(id, { image, preview, mirrored });
        const live = current.current;
        if (!live.captureOrder?.includes(id))
          update({ ...live, captureOrder: [...(live.captureOrder || []), id] });
        trackPending((list) => (list.some((p) => p.id === id) ? list : [...list, row]));
        // Máy chụp vừa bấm máy thì màn hình đã nháy lúc bấm (cùng lúc flash nổ).
        if (Date.now() - pressedAt.current > SHOT_WAIT_MS) setFlash((n) => n + 1);
        recorder.current.cut();
        sync();
      }
      return true;
    } catch (e) {
      if (alive.current && sameKioskSession(s, current.current))
        notifyOnce("folder-photo", "error", `Không đọc được ảnh ${path} từ máy ảnh: ${e.message}`);
      return false;
    } finally {
      trackReading(-1);
    }
  }
  const takenRef = useRef(0);
  takenRef.current = taken;
  const pressedAt = useRef(0);
  const waitingForCable = session?.mode === "remote" && ["ready", "shoot"].includes(phase) && !done && !ending;
  useEffect(() => {
    if (!waitingForCable) return;
    const abort = new AbortController();
    setCaptureState("connecting");
    setCaptureError("");
    // Prepare USB transfer only. The RS-60E3 cable physically triggers the R100;
    // this mode must never focus or press the camera through software.
    connectCanonCamera(abort.signal).then(() => {
      if (!abort.signal.aborted) setCaptureState("idle");
    }, (error) => {
      if (!abort.signal.aborted) { setCaptureState("error"); setCaptureError(error.message); }
    });
    return () => abort.abort();
  }, [waitingForCable, session?.captureToken, shotRetry]);
  function runCameraShot(abort, before) {
    setCaptureError("");
    return runTimedShot({
      prepare: (signal) => prepareShutter(undefined, signal),
      signal: abort.signal,
      onState: setCaptureState,
      onTick: setShotLeft,
      onPressed: () => { pressedAt.current = Date.now(); setFlash((n) => n + 1); },
      hasPhoto: () => takenRef.current > before,
      isReceiving: () => Boolean(readingRef.current || detectingRef.current),
    }).catch((e) => {
      if (abort.signal.aborted) return;
      setCaptureState("error"); setCaptureError(e.message); setShotLeft(null);
    });
  }
  // Theo dõi thư mục ảnh của máy ảnh trong suốt lúc chụp (không khởi động lại mỗi lần có ảnh).
  useEffect(() => {
    const s = session;
    if (done || phase !== "shoot" || !folder || folderAccess !== "granted" || !s?.booking.captureStartedAt)
      return;
    const stopWatching = watchCameraFolder({
      folder,
      booking: s.booking,
      onPhoto: importCameraPhoto,
      notifyOnce,
      onScanSuccess: () => delete shown.current.folder,
      onScan: (info, writing) => {
        setScanInfo((old) =>
          old && ["jpegs", "raws", "fresh", "imported", "newest", "error"].every((k) => old[k] === info[k])
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
  }, [done, phase, folder, folderAccess, session?.accessToken, session?.booking.captureStartedAt]);
  // Đủ số tấm của gói: sang chọn ảnh.
  useEffect(() => {
    if (phase !== "shoot" || !shotQuota || done || reading || detecting) return;
    if (taken >= shotQuota) endCapture();
  }, [phase, taken, shotQuota, reading, detecting, done]);
  // Chế độ đếm giờ: đếm ngược trước mỗi tấm, hết giờ thì tự chụp; chạy lại khi có ảnh mới.
  const counting = phase === "shoot" && session?.mode === "timer" &&
    Boolean(session?.booking.captureStartedAt) && !done && !ending && shotQuota > 0 && taken < shotQuota;
  const [shotLeft, setShotLeft] = useState(null);
  useEffect(() => {
    if (!counting) return setShotLeft(null);
    const abort = new AbortController();
    runCameraShot(abort, taken);
    return () => abort.abort();
  }, [counting, taken, shotRetry, session?.captureToken]);

  // ─── Màn hình ────────────────────────────────────────────────────────────
  if (done)
    return (
      <KioskDone
        done={{
          ...done,
          print,
          video: video?.token === done.token ? video.url : "",
          videoPending: video?.token === done.token && video.pending,
        }}
        pending={pending.length}
        left={left}
        nextGuest={nextGuest}
      />
    );
  if (session && choosing)
    return (
      <KioskSelect
        shots={shots}
        bitmaps={bitmaps}
        count={need}
        selected={selected}
        onToggle={toggleShot}
        secondsLeft={selectLeft}
        frames={frames}
        index={frameIndex}
        setIndex={(i) => patch({ frameIndex: i })}
        onConfirm={confirmFrame}
        busy={composing}
        prints={Number(session.booking.prints) || 0}
        qrUrl={`${window.location.origin}/album/${session.accessToken}`}
      />
    );
  if (session)
    return (
      <>
        <KioskShoot
          videoRef={video$}
          zoom={zoom}
          ready={ready}
          phase={phase}
          mode={session.mode}
          booking={session.booking}
          preCount={preCount}
          shotLeft={shotLeft}
          sessionLeft={session.booking.captureEndsAt ? remaining : (Number(session.booking.captureDuration) || 0) * 60}
          taken={taken}
          quota={shotQuota}
          shots={shots}
          flash={flash}
          receiving={reading + detecting > 0}
          captureState={captureState}
          captureError={captureError}
          onRetryCapture={() => setShotRetry((n) => n + 1)}
          modeLeft={modeLeft}
          ending={ending}
          onPickMode={pickMode}
          onEnd={() => endCapture(false)}
          onReopenCamera={() => openCamera()}
        />
        {error && !captureError && !(error === CAMERA_ERROR && !ready) && (
          <div className="shoot-error">
            <ErrorBox error={error} />
          </div>
        )}
      </>
    );
  if (step === "package")
    return (
      <KioskPackages
        packages={roomPackages}
        allowCode
        onPick={(pack) => {
          setSale({ pack, requestKey: crypto.randomUUID(), bills: [] });
          transition(() => setStep("pay"), "fade");
        }}
        onCode={() => transition(() => setStep("code"), "fade")}
        onBack={() => transition(() => setStep("start"), "fade")}
      />
    );
  if (step === "pay" && sale?.pack)
    return (
      <KioskPayment
        pack={sale.pack}
        bills={sale.bills}
        testMode={Boolean(roomInfo?.paymentTest)}
        busy={busy}
        error={error}
        onBill={(amount) => {
          const latest = readSale() || sale;
          setSale({ ...latest, bills: [...latest.bills, { amount, at: new Date().toISOString() }] });
        }}
        onPaid={() => buy(false)}
        onSkip={() => buy(true)}
        onBack={() => {
          setSale(null);
          transition(() => setStep(sellsHere ? "package" : "start"), "fade");
        }}
      />
    );
  return (
    <KioskEntry
      step={step === "code" ? "code" : "start"}
      setStep={(next) => {
        setError("");
        transition(() => setStep(next), "fade");
      }}
      onTap={() => {
        setError("");
        // Còn tiền đã đút dở (tải lại trang): quay lại đúng màn trả tiền.
        transition(() => setStep(sale?.pack ? "pay" : sellsHere ? "package" : "code"), "fade");
      }}
      claim={claim}
      error={error}
      device={device}
      code={code}
      setCode={setCode}
      busy={busy}
      folder={folder}
      folderAccess={folderAccess}
      roomId={roomId}
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
        mirrorLocked={remoteFlip !== "device"}
        zoom={zoom}
        setZoom={setZoom}
        roomInfo={roomInfo}
        toast={toast}
      />
    </KioskEntry>
  );
}
