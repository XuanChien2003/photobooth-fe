export const storageNumber = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 2,
});
export const storageCount = new Intl.NumberFormat("vi-VN");
export const knownSize = (value) => Number.isFinite(value) && value >= 0;
export const completeMediaMeasurements = (summary) => {
  const r2 = summary?.r2;
  return (
    summary?.media?.available !== false &&
    knownSize(summary?.media?.bytes) &&
    knownSize(summary?.media?.files) &&
    (!(r2?.active || r2?.configured || r2?.error) ||
      (r2.available && knownSize(r2.usedBytes) && knownSize(r2.files)))
  );
};
export const storageMB = (bytes) =>
  knownSize(bytes)
    ? `${storageNumber.format(bytes / 1048576)} MB`
    : "Chưa đo được";
export const storageGB = (bytes) =>
  knownSize(bytes)
    ? `${storageNumber.format(bytes / 1_000_000_000)} GB`
    : "Chưa đo được";
export const storageSize = (bytes) =>
  bytes >= 1_000_000_000 ? storageGB(bytes) : storageMB(bytes);

export function StorageMetric({
  icon: Icon,
  title,
  value,
  children,
  className = "",
}) {
  return (
    <article className={`storage-metric ${className}`}>
      <span>
        <Icon size={17} aria-hidden="true" /> {title}
      </span>
      <strong>{value}</strong>
      <small>{children}</small>
    </article>
  );
}

export function StorageCapacity({
  level,
  label,
  percent,
  ariaLabel,
  children,
}) {
  return (
    <div className={`storage-capacity storage-level-${level}`}>
      <div>
        <span>{label}</span>
        <strong>{storageNumber.format(percent)}%</strong>
      </div>
      <progress
        max="100"
        value={Math.min(100, Math.max(0, percent))}
        aria-label={ariaLabel}
      />
      <small>{children}</small>
    </div>
  );
}
