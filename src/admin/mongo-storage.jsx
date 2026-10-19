import { AlertTriangle, Database, HardDrive, Info } from "lucide-react";
import { useStorageMonitor } from "./storage-monitor";
import {
  knownSize,
  storageMB,
  storageNumber,
  StorageCapacity,
  StorageMetric,
} from "./storage-ui";

export function mongoStorageState(summary) {
  const cluster = summary?.cluster;
  const quota = summary?.quota;
  const measured = cluster?.available && knownSize(cluster.usedBytes);
  const knownQuota =
    measured &&
    quota?.scope === "cluster" &&
    knownSize(quota.remainingBytes) &&
    knownSize(quota.usagePercent) &&
    Number.isFinite(quota.limitMB) &&
    quota.limitMB > 0;
  const level = !knownQuota
    ? "unknown"
    : quota.usagePercent >= 90
      ? "critical"
      : quota.usagePercent >= 80
        ? "warning"
        : "normal";
  return { measured, knownQuota, level };
}

export function MongoStorage() {
  const { summary } = useStorageMonitor();
  const quota = summary.quota;
  const database = summary.database;
  const cluster = summary.cluster;
  const { measured, knownQuota, level } = mongoStorageState(summary);
  const warning = ["critical", "warning"].includes(level);
  return (
    <section
      className="panel storage-mongo"
      aria-labelledby="mongo-storage-title"
    >
      <header className="storage-store-heading">
        <h4 id="mongo-storage-title">
          <Database size={18} aria-hidden="true" /> Dữ liệu MongoDB Atlas
        </h4>
        <span className={`storage-state is-${level}`}>
          {knownQuota
            ? `${storageNumber.format(quota.usagePercent)}% đã dùng`
            : measured && quota.limitMB == null
              ? "Chưa đặt mức theo dõi"
              : "Chưa đủ số liệu"}
        </span>
      </header>
      <p className="storage-store-copy">
        {summary.r2?.active
          ? "Lưu dữ liệu vé, cài đặt và ảnh cũ trong MongoDB. Kho ảnh R2 được tính riêng."
          : "Theo dõi toàn bộ dữ liệu và chỉ mục trên cùng cluster MongoDB."}
      </p>
      <div className="storage-metrics">
        <StorageMetric
          icon={Database}
          title={
            measured
              ? "Dung lượng MongoDB Atlas"
              : "Dung lượng database ứng dụng"
          }
          value={
            measured
              ? storageMB(cluster.usedBytes)
              : database.available
                ? storageMB(database.usedBytes)
                : "Chưa đo được"
          }
        >
          {measured
            ? "Dữ liệu và chỉ mục toàn cluster"
            : "Chỉ tính database của ứng dụng"}
        </StorageMetric>
        <StorageMetric
          icon={HardDrive}
          title="MongoDB Atlas còn lại"
          value={
            knownQuota
              ? storageMB(quota.remainingBytes)
              : quota.limitMB == null
                ? "Chưa biết giới hạn"
                : "Chưa đo được MongoDB"
          }
          className={`storage-remaining storage-level-${level}`}
        >
          {quota.limitMB == null
            ? "Chưa đặt mức theo dõi"
            : `Mức theo dõi: ${storageNumber.format(quota.limitMB)} MB`}
        </StorageMetric>
      </div>
      {knownQuota && (
        <StorageCapacity
          level={level}
          label="Dung lượng MongoDB đã dùng"
          percent={quota.usagePercent}
          ariaLabel="Phần trăm dung lượng đã dùng"
        >
          Cảnh báo từ 80%, cần chú ý từ 90% mức theo dõi.
        </StorageCapacity>
      )}
      {(warning || !knownQuota) && (
        <div
          className={`storage-note storage-note-${level}`}
          role={warning ? "alert" : "note"}
        >
          {warning ? (
            <AlertTriangle size={18} aria-hidden="true" />
          ) : (
            <Info size={18} aria-hidden="true" />
          )}
          <div>
            <strong>
              {warning
                ? "MongoDB gần chạm mức theo dõi"
                : quota.limitMB == null
                  ? "Chưa đặt mức theo dõi MongoDB"
                  : "Chưa đo được dung lượng toàn cluster"}
            </strong>
            <p>
              {warning
                ? "Kiểm tra dữ liệu trong MongoDB và ảnh cũ đã hết hạn để giảm dung lượng tại đây."
                : quota.limitMB == null
                  ? "Chưa có giới hạn để tính dung lượng còn lại."
                  : "Số liệu database ứng dụng chưa đủ để tính phần còn lại của cả cluster."}
            </p>
          </div>
        </div>
      )}
      <p className={`storage-source${measured ? "" : " is-unavailable"}`}>
        {measured
          ? "Đọc trực tiếp từ MongoDB Atlas, gồm các database dùng chung cluster."
          : cluster?.error ||
            "Chưa đọc được dung lượng toàn cluster MongoDB Atlas."}
      </p>
    </section>
  );
}
