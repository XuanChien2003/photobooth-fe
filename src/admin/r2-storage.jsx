import { AlertTriangle, Bot, Cloud, HardDrive, Image } from "lucide-react";
import { formatDateTime } from "../api";
import { Button, ErrorBox } from "../studio";
import { useStorageMonitor } from "./storage-monitor";
import {
  knownSize,
  storageMB,
  storageSize,
  StorageCapacity,
} from "./storage-ui";

const number = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
const gb = (bytes) => number.format(bytes / 1_000_000_000);
const quotaKnown = (r2) =>
  r2?.available &&
  knownSize(r2.usedBytes) &&
  knownSize(r2.quota?.usagePercent) &&
  knownSize(r2.quota?.remainingBytes) &&
  Number.isFinite(r2.quota?.limitGB) &&
  r2.quota.limitGB > 0;
export const r2StorageLevel = (r2) =>
  !quotaKnown(r2)
    ? "unknown"
    : r2.quota.usagePercent >= 90
      ? "critical"
      : r2.quota.usagePercent >= 80
        ? "warning"
        : "normal";

export function R2StorageWarning({ onOpenStorage }) {
  const { summary, loadError } = useStorageMonitor();
  const r2 = summary?.r2;
  const level = r2StorageLevel(r2);
  const high = ["critical", "warning"].includes(level);
  const unavailable =
    r2 &&
    (r2.active || r2.configured || r2.error) &&
    (!r2.available || !knownSize(r2.usedBytes));
  if (!high && !unavailable) return null;
  return (
    <div
      className={`storage-warning storage-warning-${high ? level : "unknown"}`}
      role={high ? "alert" : "status"}
      aria-atomic="true"
    >
      <AlertTriangle size={24} aria-hidden="true" />
      <div className="storage-warning-copy">
        <strong>
          {high
            ? "Kho ảnh R2 gần mức cảnh báo"
            : "Chưa kiểm tra được kho ảnh R2"}
        </strong>
        <p>
          {high
            ? `R2 đang lưu ${gb(r2.usedBytes)} / ${number.format(r2.quota.limitGB)} GB (${number.format(r2.quota.usagePercent)}%).`
            : r2.error || "Chưa có số liệu dung lượng từ kho ảnh."}
        </p>
        <small>
          {loadError
            ? `Số liệu cũ · ${formatDateTime(summary.checkedAt)}. `
            : ""}
          {high
            ? "Dọn ảnh hết hạn để giảm dung lượng. Đây là mức theo dõi; phí R2 còn phụ thuộc sử dụng trong tháng."
            : "Mở trợ lí để xem trạng thái kết nối."}
        </small>
      </div>
      <Button className="outline small" onClick={onOpenStorage}>
        <Bot size={17} aria-hidden="true" /> Mở trợ lí để dọn ảnh
      </Button>
    </div>
  );
}

export function R2Storage() {
  const { summary } = useStorageMonitor();
  const r2 = summary?.r2;
  if (!r2) return null;
  const level = r2StorageLevel(r2);
  const measured = r2.available && knownSize(r2.usedBytes);
  const warning = ["critical", "warning"].includes(level);
  return (
    <section className="panel storage-r2" aria-labelledby="r2-storage-title">
      <header className="storage-store-heading">
        <h4 id="r2-storage-title">
          <Cloud size={18} aria-hidden="true" /> Kho ảnh Cloudflare R2
        </h4>
        <span className={`storage-state is-${level}`}>
          {quotaKnown(r2)
            ? `${number.format(r2.quota.usagePercent)}% đã dùng`
            : measured && r2.quota?.limitGB == null
              ? "Chưa đặt mức theo dõi"
              : "Chưa đủ số liệu"}
        </span>
      </header>
      <p className="storage-store-copy">
        {r2.active
          ? "Đang nhận ảnh mới tại đây. Ảnh cũ trong MongoDB vẫn xem và tải được."
          : "Ảnh mới đang lưu trong MongoDB. R2 chưa được bật để nhận ảnh mới."}
      </p>
      {r2.error && <ErrorBox error={r2.error} />}
      {!r2.configured && !r2.error ? (
        <p className="storage-r2-status">
          Chưa kết nối kho ảnh. Cần tạo bucket R2 và cấu hình kết nối trên máy
          chủ.
        </p>
      ) : (
        <>
          <div className="storage-r2-metrics">
            <article className="storage-r2-used">
              <span>
                <Image size={16} aria-hidden="true" /> Ảnh và file đã dùng
              </span>
              <strong>
                {measured ? storageSize(r2.usedBytes) : "Chưa đo được"}
              </strong>
              <small>
                {measured
                  ? `${storageMB(r2.usedBytes)}${knownSize(r2.files) ? ` · ${number.format(r2.files)} file` : ""}`
                  : "Đang chờ số liệu từ kho ảnh"}
              </small>
            </article>
            <article className="storage-r2-remaining">
              <span>
                <HardDrive size={16} aria-hidden="true" /> Còn trong mức theo
                dõi
              </span>
              <strong>
                {quotaKnown(r2)
                  ? storageSize(r2.quota.remainingBytes)
                  : r2.quota?.limitGB == null
                    ? "Chưa đặt mức"
                    : "Chưa đo được"}
              </strong>
              <small>
                {r2.quota?.limitGB == null
                  ? "Chưa đặt mức theo dõi"
                  : `Mức theo dõi: ${number.format(r2.quota.limitGB)} GB`}
              </small>
            </article>
          </div>
          {quotaKnown(r2) && (
            <StorageCapacity
              level={level}
              label={`Mức theo dõi: ${number.format(r2.quota.limitGB)} GB`}
              percent={r2.quota.usagePercent}
              ariaLabel="Phần trăm dung lượng kho ảnh R2"
            >
              Cảnh báo từ 80%, cần chú ý từ 90%. Mức theo dõi không chặn lưu
              ảnh.
            </StorageCapacity>
          )}
        </>
      )}
      {warning && (
        <p className={`storage-r2-advice storage-level-${level}`} role="alert">
          {r2.quota.usagePercent >= 100
            ? "Đã chạm hoặc vượt mức theo dõi. Nên dọn file hết hạn bên dưới."
            : "Kho ảnh gần mức theo dõi. Bạn có thể dọn file hết hạn bên dưới."}
        </p>
      )}
    </section>
  );
}
