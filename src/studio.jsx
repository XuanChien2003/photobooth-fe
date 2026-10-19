import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { DialogFocusManager } from "./dialog-focus";
import {
  PiCheckCircleDuotone as CheckCircle,
  PiXCircleDuotone as XCircle,
  PiWarningDuotone as Warning,
  PiInfoDuotone as Info,
  PiXBold as X,
} from "react-icons/pi";

export const StudioContext = createContext({});
export const useStudio = () => useContext(StudioContext);

/* ─── Toast System ────────────────────────────────────────────── */
export const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

const DURATIONS = { success: 3500, info: 4500, warning: 5500, error: 6500 };
const MAX_TOASTS = 4;
let _toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());
  const list = useRef([]);
  list.current = toasts;

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)),
    );
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 320);
  }, []);

  const schedule = useCallback(
    (id, duration) => {
      clearTimeout(timers.current.get(id));
      if (duration > 0)
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
    },
    [dismiss],
  );

  // Cùng nội dung đang hiển thị thì chỉ làm mới thời gian, không hiện trùng.
  const toast = useCallback(
    (message, type = "info", duration = DURATIONS[type] ?? 4500) => {
      if (!message) return null;
      const text = String(message);
      const same = list.current.find(
        (t) => !t.leaving && t.type === type && t.message === text,
      );
      if (same) {
        schedule(same.id, duration);
        setToasts((prev) =>
          prev.map((t) =>
            t.id === same.id ? { ...t, bump: (t.bump || 0) + 1 } : t,
          ),
        );
        return same.id;
      }
      const id = ++_toastId;
      setToasts((prev) => {
        const visible = prev.filter((t) => !t.leaving);
        if (visible.length >= MAX_TOASTS)
          setTimeout(() => dismiss(visible[0].id), 0);
        return [...prev, { id, message: text, type, leaving: false }];
      });
      schedule(id, duration);
      return id;
    },
    [dismiss, schedule],
  );

  const api = useMemo(
    () => ({
      toast,
      dismiss,
      success: (msg, dur) => toast(msg, "success", dur),
      info: (msg, dur) => toast(msg, "info", dur),
      warning: (msg, dur) => toast(msg, "warning", dur),
      error: (msg, dur) => toast(msg, "error", dur),
    }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      <DialogFocusManager />
      {children}
      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

const ICONS = {
  success: <CheckCircle size={20} />,
  error: <XCircle size={20} />,
  warning: <Warning size={20} />,
  info: <Info size={20} />,
};

function ToastItem({ t, dismiss }) {
  const urgent = t.type === "error" || t.type === "warning";
  return (
    <div
      role={urgent ? "alert" : "status"}
      aria-live={urgent ? "assertive" : "polite"}
      className={`toast toast-${t.type}${t.leaving ? " toast-leaving" : ""}`}
      key={t.bump || 0}
    >
      <span className="toast-icon">{ICONS[t.type]}</span>
      <span className="toast-msg">{t.message}</span>
      <button
        className="toast-close"
        aria-label="Đóng thông báo"
        onClick={() => dismiss(t.id)}
      >
        <X size={15} />
      </button>
    </div>
  );
}

function ToastContainer({ toasts, dismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-container" aria-label="Thông báo">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} dismiss={dismiss} />
      ))}
    </div>
  );
}

/* ─── Shared UI ───────────────────────────────────────────────── */

export function Button({ children, to, className = "", ...props }) {
  return to ? (
    <Link className={`button ${className}`} to={to} viewTransition {...props}>
      {children}
    </Link>
  ) : (
    <button className={`button ${className}`} {...props}>
      {children}
    </button>
  );
}

export function ErrorBox({ error }) {
  return error ? (
    <div role="alert" className="error-box">
      {error}
    </div>
  ) : null;
}

// Logo dùng chung; tên tiệm vẫn lấy từ cài đặt để đọc bằng trình đọc màn hình.
export function Brand() {
  const { settings } = useStudio();
  return (
    <div className="brand">
      <img
        className="brand-logo"
        src="/studio-logo.jpg"
        alt={`Logo ${settings?.name || "Photobooth"}`}
        width={256}
        height={256}
      />
      <small>CHỤP ẢNH · LƯU KỶ NIỆM</small>
    </div>
  );
}
