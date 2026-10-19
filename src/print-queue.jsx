import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Bot,
  Check,
  Clock,
  Download,
  Printer,
  Trash2,
} from "lucide-react";
import { api, getApiUrl, formatDateTime } from "./api";
import { isConnectivityError, onNetworkRecovery } from "./network.js";
import { printPhoto10x15 } from "./print";
import { useLiveData } from "./use-live-data";
import { Guide } from "./guide";
import { Button, ErrorBox, useToast } from "./studio";
import { StorageAssistant } from "./admin/storage-assistant";
import { useStorageMonitor } from "./admin/storage-monitor";
import { imageRetention } from "./admin/storage-retention";

const SPOOL = {
  queued: "Chờ gửi máy in DNP",
  sending: "Đang gửi máy in DNP",
  sent: "Đã gửi máy in DNP",
  failed: "Lỗi máy in — in thủ công",
};
const time = formatDateTime;

// Mỗi lệnh in lưu 24 giờ kể từ lúc khách gửi rồi tự xóa cùng file tờ in.
const expiresAt = (job) =>
  new Date(job.expiresAt || new Date(job.createdAt).getTime() + 86400000);
const minutesLeft = (job, now) =>
  Math.max(0, Math.ceil((expiresAt(job).getTime() - now) / 60000));
const duration = (minutes) => {
  const h = Math.floor(minutes / 60),
    m = minutes % 60;
  return h ? `${h} giờ ${String(m).padStart(2, "0")} phút` : `${m} phút`;
};
// Đồng hồ cập nhật nửa phút một lần cho các ô đếm ngược.
function useNow(every = 30000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

// Hạn ảnh sớm nhất lấy từ kho ảnh chung, không phụ thuộc tab hoặc trạng thái in.
// Còn lệnh chưa in mà sắp xóa (dưới 1 giờ) thì chuyển màu đỏ.
function RetentionNotice({ jobs, pending, now, summary, loadError }) {
  const expiry = imageRetention(summary, now, loadError);
  const urgentJobs = jobs.filter(
    (j) => j.status === "pending" && minutesLeft(j, now) <= 60,
  ).length;
  return (
    <div
      className={`print-day-note${urgentJobs ? " is-urgent" : ""}`}
      role={urgentJobs ? "alert" : "note"}
    >
      <span className="print-day-icon" aria-hidden="true">
        <Clock size={22} />
      </span>
      <div>
        <strong>Ảnh được lưu {summary?.ttlHours ?? 24} giờ rồi tự xoá</strong>
        <p>
          Ảnh chụp tính từ lúc chụp hoặc tải lên, ảnh in tính từ lúc gửi in. Ảnh
          hết hạn được xoá trong đợt dọn tự động tiếp theo.{" "}
          {urgentJobs ? (
            <>
              Có <b>{urgentJobs} lượt chờ in sắp hết hạn</b> — in ngay.
            </>
          ) : pending > 0 ? (
            <>
              Còn <b>{pending} lượt chờ in</b>.
            </>
          ) : (
            "Hiện không còn lệnh nào chờ in."
          )}
        </p>
      </div>
      <span
        className="print-day-countdown"
        aria-label="Ảnh sắp xoá gần nhất"
        title={
          expiry.known ? `Hết hạn lúc ${time(expiry.expiresAt)}` : undefined
        }
      >
        <small>Ảnh sắp xoá gần nhất</small>
        <b>{expiry.label}</b>
        {loadError && summary && <small>Số liệu cũ</small>}
      </span>
    </div>
  );
}

function beep() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.18, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + i * 0.18 + 0.16,
      );
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.17);
    });
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* trình duyệt chặn âm thanh — bỏ qua */
  }
}

// Nhận lệnh in mới theo thời gian thực (Server-Sent Events) + đếm số lệnh đang chờ.
export function PrintAlerts({ onCount }) {
  const toast = useToast();
  const refresh = useLiveData(
    "/admin/print-jobs?status=pending",
    (jobs) => onCount(jobs.length),
    () => {},
    30000,
  );
  useEffect(() => {
    const load = () => refresh({ share: true });
    window.addEventListener("nxc:print", load);
    // Trình duyệt tự nối lại luồng khi rớt mạng, nhưng bỏ hẳn nếu máy chủ trả lỗi (đang khởi
    // động lại, 502…): tự mở lại luồng với thời gian chờ tăng dần. Nối lại được thì tải lại hàng
    // chờ vì lệnh in gửi trong lúc mất kết nối không có thông báo.
    let source, timer, failures = 0, lost = false, stopped = false;
    const onPrint = (e) => {
      const job = JSON.parse(e.data);
      const text = `Lệnh in mới · vé #${job.code} (${job.sheetCount || 1} tờ)`;
      toast.info(text, 8000);
      beep();
      if ("Notification" in window && Notification.permission === "granted")
        new Notification("NXC — Hàng chờ in", { body: text });
      window.dispatchEvent(new Event("nxc:print"));
    };
    const connect = () => {
      clearTimeout(timer);
      source?.close();
      source = new EventSource(getApiUrl("/api/admin/print-jobs/stream"), {
        withCredentials: true,
      });
      source.addEventListener("print", onPrint);
      source.addEventListener("open", () => {
        failures = 0;
        if (lost) window.dispatchEvent(new Event("nxc:print"));
        lost = false;
      });
      source.addEventListener("error", () => {
        lost = true;
        // CLOSED (2): the browser gave up; CONNECTING: it is already retrying by itself.
        if (stopped || source.readyState !== 2) return;
        timer = setTimeout(connect, Math.min(60000, 2000 * 2 ** Math.min(failures++, 5)));
      });
    };
    connect();
    const unsubscribe = onNetworkRecovery(() => {
      if (source.readyState === 2) connect();
    });
    return () => {
      stopped = true;
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener("nxc:print", load);
      source.close();
    };
  }, [refresh]);
  return null;
}

export function PrintQueue({
  pendingCount = 0,
  canManageStorage = false,
  view: controlledView,
  onViewChange,
}) {
  const now = useNow();
  const { summary, loadError } = useStorageMonitor();
  const toast = useToast();
  const [status, setStatus] = useState("pending");
  const [localView, setLocalView] = useState("prints");
  const view = controlledView ?? localView;
  const setView = onViewChange ?? setLocalView;
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const refreshSource = useRef({});
  const lastError = useRef("");
  const [permission, setPermission] = useState(
    "Notification" in window ? Notification.permission : "unsupported",
  );
  const load = useLiveData(
    `/admin/print-jobs?status=${status}`,
    (list) => {
      setJobs(list);
      setError("");
      lastError.current = "";
    },
    (e) => {
      setError(e.message);
      // Mất kết nối: thông báo chung của trang đã báo, không lặp ở từng bảng.
      if (lastError.current !== e.message && !isConnectivityError(e)) toast.error(e.message);
      lastError.current = e.message;
    },
    15000,
  );
  useEffect(() => {
    const refresh = (event) => {
      if (event.detail?.source !== refreshSource.current) load({ share: true });
    };
    window.addEventListener("nxc:print", refresh);
    return () => window.removeEventListener("nxc:print", refresh);
  }, [load]);
  async function act(job, request, message) {
    setBusyId(job._id);
    try {
      await request();
      const refreshed = load({ share: true });
      window.dispatchEvent(new CustomEvent("nxc:print", {
        detail: { source: refreshSource.current },
      }));
      await refreshed;
      toast.success(message);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusyId("");
    }
  }
  function print(job) {
    try {
      printPhoto10x15({
        imageUrl: getApiUrl(job.image),
        imageUrls: Array.from(
          { length: job.sheetCount || 1 },
          (_, i) => getApiUrl(job.image) + "?sheet=" + i,
        ),
        code: job.code,
        copies: job.copies,
      });
      toast.info(
        `Đang mở bản in vé #${job.code}. Chọn DNP RX1 hoặc Epson L8050, giấy 4 × 6 inch và chất lượng cao.`,
      );
    } catch (e) {
      toast.error(e.message);
    }
  }
  return (
    <>
      {view === "prints" && <ErrorBox error={error} />}
      {view === "prints" && (
        <Guide
          id="print-dnp"
          title="in ảnh bằng DNP RX1 hoặc Epson L8050"
          steps={[
            "Khách bấm “Gửi in” trên điện thoại → lệnh in hiện ở đây (có chuông báo).",
            "Bấm “In 15×10” → cửa sổ in mở ra.",
            "Chọn đúng máy in, giấy 4 × 6 inch (DNP: PR (4x6)), hướng Ngang, tỉ lệ 100%, lề Không có, tắt đầu trang / chân trang.",
            "Với Epson L8050: chọn đúng loại giấy ảnh; chất lượng High trên Windows hoặc Fine trên macOS → In.",
            "Nhận được ảnh in rồi mới bấm “Đã in”. In hỏng thì bấm “In lại”.",
          ]}
          note="Lệnh in tự xóa sau 24 giờ kể từ lúc khách gửi. Lệnh nhiều tờ: nút tải sẽ tải 1 tệp ZIP đủ các tờ."
        />
      )}
      <div className="admin-toolbar">
        <div
          className="segmented print-view-tabs"
          aria-label="Hàng chờ in và dung lượng"
        >
          {[
            ["pending", "Chờ in"],
            ["printed", "Đã in"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={view === "prints" && status === key ? "active" : ""}
              aria-pressed={view === "prints" && status === key}
              onClick={() => {
                setView("prints");
                setStatus(key);
              }}
            >
              {label}
            </button>
          ))}
          <button
            className={view === "storage" ? "active" : ""}
            aria-pressed={view === "storage"}
            onClick={() => setView("storage")}
          >
            <Bot size={16} aria-hidden="true" /> Trợ lí Minh Dâm
          </button>
        </div>
        {permission === "default" && (
          <Button
            className="outline small"
            onClick={() =>
              Notification.requestPermission().then((result) => {
                setPermission(result);
                if (result === "granted")
                  toast.success("Đã bật thông báo lệnh in trên máy này.");
                else
                  toast.warning(
                    "Trình duyệt đang chặn thông báo. Bạn vẫn nhận thông báo trong trang.",
                  );
              })
            }
          >
            <Bell size={15} /> Bật thông báo trên máy
          </Button>
        )}
      </div>
      {view === "storage" ? (
        <StorageAssistant
          canManageStorage={canManageStorage}
          onShowPrinted={() => {
            setStatus("printed");
            setView("prints");
          }}
        />
      ) : (
        <>
          <RetentionNotice
            jobs={jobs}
            pending={status === "pending" ? jobs.length : pendingCount}
            now={now}
            summary={summary}
            loadError={loadError}
          />
          <div className="print-grid">
            {jobs.map((job) => (
              <article key={job._id} className="panel print-card">
                <div
                  className={`print-sheets${(job.sheetCount || 1) > 1 ? " many" : ""}`}
                >
                  {Array.from({ length: job.sheetCount || 1 }, (_, i) => {
                    const src = getApiUrl(`${job.image}?sheet=${i}`);
                    return (
                      <a
                        key={i}
                        href={src}
                        target="_blank"
                        rel="noreferrer"
                        title={`Xem tờ ${i + 1} cỡ lớn`}
                      >
                        <img
                          // Xem lướt dùng bản nhỏ (~10 lần nhẹ hơn); bấm vào mới mở tờ cỡ lớn.
                          src={`${src}&size=thumbnail`}
                          alt={`Tờ ${i + 1} · vé ${job.code}`}
                          loading="lazy"
                          onError={(e) => {
                            // Tờ in không còn trên máy chủ: hiện chữ thay cho ảnh hỏng.
                            e.currentTarget.parentElement.classList.add(
                              "is-missing",
                            );
                            e.currentTarget.parentElement.dataset.label = `Tờ ${i + 1}: ảnh không còn trên máy chủ`;
                          }}
                        />
                      </a>
                    );
                  })}
                </div>
                <div>
                  <strong>
                    #{job.code} · {job.name}
                  </strong>
                  <small>
                    {job.roomName} · {job.frameName || "Khung ảnh"} ·{" "}
                    {job.sheetCount || 1} tờ × {job.copies} bản
                  </small>
                  <small>
                    {status === "pending"
                      ? `Gửi lúc ${time(job.createdAt)}`
                      : `In lúc ${time(job.printedAt)} · ${job.printedBy || ""}`}
                  </small>
                  {(() => {
                    const left = minutesLeft(job, now);
                    const soon = left <= 60;
                    return (
                      <span
                        className={`expiry-chip${soon ? (status === "pending" ? " is-urgent" : " is-soon") : ""}`}
                        title={`Tự xóa lúc ${time(expiresAt(job))} (24 giờ sau khi gửi)`}
                      >
                        <Clock size={13} /> Tự xóa sau {duration(left)}
                      </span>
                    );
                  })()}
                  {SPOOL[job.spoolStatus] && (
                    <span
                      className={`spool-chip ${job.spoolStatus}`}
                      title={job.spoolMessage || ""}
                    >
                      {SPOOL[job.spoolStatus]}
                    </span>
                  )}
                </div>
                <div className="print-actions">
                  <Button className="small" onClick={() => print(job)}>
                    <Printer size={15} />{" "}
                    {status === "pending" ? "In 15×10" : "In lại"}
                  </Button>
                  {status === "pending" && (
                    <Button
                      className="outline small"
                      disabled={busyId === job._id}
                      onClick={() =>
                        act(
                          job,
                          () =>
                            api(`/admin/print-jobs/${job._id}`, {
                              method: "PATCH",
                              body: { status: "printed" },
                            }),
                          `Đã đánh dấu in xong vé #${job.code}.`,
                        )
                      }
                    >
                      <Check size={15} /> Đã in
                    </Button>
                  )}
                  <div className="print-icons">
                    <a
                      className="icon-button"
                      title={
                        (job.sheetCount || 1) > 1
                          ? `Tải cả ${job.sheetCount} tờ (ZIP)`
                          : "Tải file in"
                      }
                      aria-label={
                        (job.sheetCount || 1) > 1
                          ? `Tải cả ${job.sheetCount} tờ (ZIP)`
                          : "Tải file in"
                      }
                      href={getApiUrl(`${job.image}?download=1`)}
                    >
                      <Download size={16} />
                    </a>
                    <button
                      className="icon-button"
                      title="Hủy lệnh in"
                      disabled={busyId === job._id}
                      onClick={() =>
                        window.confirm(
                          status === "pending"
                            ? `Hủy lệnh in của vé #${job.code}? Số tờ được trả lại để khách sửa và gửi in lại.`
                            : `Xóa lệnh in đã in của vé #${job.code} khỏi danh sách?`,
                        ) &&
                        act(
                          job,
                          () =>
                            api(`/admin/print-jobs/${job._id}`, {
                              method: "DELETE",
                            }),
                          "Đã hủy lệnh in.",
                        )
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {!jobs.length && (
            <div className="empty-state">
              <Printer />
              <h3>
                {status === "pending"
                  ? "Chưa có lệnh in nào hôm nay."
                  : "Hôm nay chưa in ảnh nào."}
              </h3>
              <p>
                Khách bấm “Gửi in” trên điện thoại, lệnh in sẽ hiện tại đây
                ngay.
              </p>
            </div>
          )}
        </>
      )}
    </>
  );
}
