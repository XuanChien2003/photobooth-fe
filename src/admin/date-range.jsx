import { useMemo } from "react";
import { CalendarDays } from "lucide-react";
import { localDate } from "../api";
import { useStudio } from "../studio";

// Ngày dạng YYYY-MM-DD theo giờ Việt Nam.
export const addDays = (day, n) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const monthStart = (day) => `${day.slice(0, 7)}-01`;
const lastMonth = (day) => {
  const [y, m] = day.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  return [start, addDays(monthStart(day), -1)];
};

// Các mốc nhanh như trang Snapbox: Hôm nay, Hôm qua, 7 ngày, Tháng này…
export function rangePresets(today = localDate()) {
  return [
    ["today", "Hôm nay", today, today],
    ["yesterday", "Hôm qua", addDays(today, -1), addDays(today, -1)],
    ["7d", "7 ngày", addDays(today, -6), today],
    ["30d", "30 ngày", addDays(today, -29), today],
    ["month", "Tháng này", monthStart(today), today],
    ["last-month", "Tháng trước", ...lastMonth(today)],
    ["year", "Năm nay", `${today.slice(0, 4)}-01-01`, today],
  ];
}

// Thanh lọc dùng chung: mốc thời gian, từ ngày → tới ngày, chi nhánh và máy.
export function RangeFilter({ value, onChange, assignedBranch, presets = rangePresets(), showRoom = true }) {
  const { rooms = [] } = useStudio();
  const branches = useMemo(
    () => [...new Set(rooms.map((r) => r.branch).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi")),
    [rooms],
  );
  const branch = assignedBranch || value.branch;
  const machines = rooms.filter((r) => !branch || r.branch === branch);
  const preset = presets.find(([, , from, to]) => from === value.from && to === value.to)?.[0];
  return (
    <div className="range-filter">
      <div className="range-presets" role="group" aria-label="Chọn nhanh khoảng thời gian">
        {presets.map(([key, label, from, to]) => (
          <button
            type="button"
            key={key}
            className={preset === key ? "active" : ""}
            aria-pressed={preset === key}
            onClick={() => onChange({ ...value, from, to })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="range-fields">
        <label className="order-date-range">
          <CalendarDays size={16} aria-hidden="true" />
          <input
            aria-label="Từ ngày"
            type="date"
            value={value.from}
            max={value.to}
            onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
          />
          <span>→</span>
          <input
            aria-label="Tới ngày"
            type="date"
            value={value.to}
            min={value.from}
            max={localDate()}
            onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
          />
        </label>
        {!assignedBranch && branches.length > 1 && (
          <select
            aria-label="Chi nhánh"
            value={value.branch || ""}
            onChange={(e) => onChange({ ...value, branch: e.target.value, room: "" })}
          >
            <option value="">Tất cả chi nhánh</option>
            {branches.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        )}
        {showRoom && (
          <select
            aria-label="Máy"
            value={value.room || ""}
            onChange={(e) => onChange({ ...value, room: e.target.value })}
          >
            <option value="">Tất cả máy</option>
            {machines.map((r) => (
              <option key={r._id} value={r.name}>{r.name}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

export const rangeQuery = (value, assignedBranch) =>
  new URLSearchParams({
    from: value.from,
    to: value.to,
    ...(!assignedBranch && value.branch ? { branch: value.branch } : {}),
    ...(value.room ? { room: value.room } : {}),
  }).toString();
