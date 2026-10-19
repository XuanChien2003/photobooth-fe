import { useMemo, useState } from "react";
import { Download, CalendarDays, Ticket, Wallet, Sigma } from "lucide-react";
import { formatDate, localDate, money } from "./api";
import { Button, useToast } from "./studio";
import { useLiveData } from "./use-live-data";
import { TableHeading } from "./admin/table-heading";

// Các tháng gần nhất (mới → cũ) để xem lại doanh thu, dạng "YYYY-MM".
function recentMonths(count = 24) {
  const [year, month] = localDate().split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}
const monthLabel = (m) => `Tháng ${Number(m.slice(5))}/${m.slice(0, 4)}`;
const weekday = (date) =>
  new Intl.DateTimeFormat("vi-VN", {
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
// Số tiền gọn cho trục và nhãn: 1,5 tr · 500 N.
const compact = (v) =>
  v >= 1e6
    ? `${(v / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} tr`
    : v >= 1e3
      ? `${Math.round(v / 1e3).toLocaleString("vi-VN")} N`
      : String(v);
// Bước trục tung tròn số (1 / 2 / 2,5 / 5 × 10ⁿ); 4 khoảng chia.
function niceStep(raw) {
  if (raw <= 0) return 250000;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

// Doanh thu từng ngày của một tháng: biểu đồ cột + bảng chi tiết, chọn xem lại tháng trước.
export function RevenueByDay({ onError }) {
  const toast = useToast();
  const months = useMemo(() => recentMonths(), []);
  const [month, setMonth] = useState(months[0]);
  const [data, setData] = useState(null);
  const [active, setActive] = useState(null);
  useLiveData(`/admin/stats/revenue?month=${month}`, setData, onError, 60000);
  const loading = data?.month !== month;
  const days = data?.days || [];
  const step = niceStep(Math.max(0, ...days.map((d) => d.revenue)) / 4);
  const max = step * 4;
  const ticks = [0, 1, 2, 3, 4].map((i) => i * step);
  const best = days.reduce(
    (top, d) => (d.revenue > (top?.revenue || 0) ? d : top),
    null,
  );
  const today = localDate();
  const tip = active !== null && days[active];
  function csv() {
    const rows = [
      ["Ngày", "Thứ", "Số vé", "Doanh thu (VND)"],
      ...days.map((d) => [
        formatDate(d.date),
        weekday(d.date),
        d.tickets,
        d.revenue,
      ]),
      ["Cả tháng", "", data.tickets, data.revenue],
    ];
    const url = URL.createObjectURL(
      new Blob(["﻿" + rows.map((r) => r.join(",")).join("\r\n")], {
        type: "text/csv;charset=utf-8;",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `doanh-thu-${month}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(
      `Đã xuất doanh thu ${monthLabel(month).toLowerCase()} ra file CSV.`,
    );
  }
  return (
    <section className="panel revenue-panel" aria-labelledby="revenue-title">
      <div className="revenue-head">
        <div>
          <h3 id="revenue-title">Doanh thu theo ngày</h3>
          <p className="revenue-period">{monthLabel(month)}</p>
        </div>
        <div className="revenue-filters">
          <label>
            Xem tháng
            <select
              name="revenueMonth"
              value={month}
              onChange={(e) => {
                setActive(null);
                setMonth(e.target.value);
              }}
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <Button
            className="outline small"
            disabled={!data || loading}
            onClick={csv}
          >
            <Download size={15} /> CSV
          </Button>
        </div>
      </div>
      {data && (
        <div className={`revenue-body ${loading ? "is-loading" : ""}`}>
          <dl className="revenue-summary">
            <div>
              <dt>Tổng doanh thu</dt>
              <dd>{money(data.revenue)}</dd>
            </div>
            <div>
              <dt>Số vé đã bán</dt>
              <dd>{data.tickets}</dd>
            </div>
            <div>
              <dt>Ngày cao nhất</dt>
              <dd>
                {best
                  ? `${formatDate(best.date).slice(0, 5)} · ${compact(best.revenue)}`
                  : "—"}
              </dd>
            </div>
          </dl>
          {!data.revenue && (
            <p className="muted revenue-empty">
              Chưa có doanh thu trong {monthLabel(month).toLowerCase()}.
            </p>
          )}
          <div className="revenue-chart" style={{ "--days": days.length }}>
            <div className="revenue-axis" aria-hidden="true">
              {ticks.map((t) => (
                <span key={t} style={{ bottom: `${(t / max) * 100}%` }}>
                  {compact(t)}
                </span>
              ))}
            </div>
            <div
              className="revenue-plot"
              onPointerLeave={() => setActive(null)}
            >
              {ticks.map((t) => (
                <i
                  key={t}
                  className="revenue-grid"
                  style={{ bottom: `${(t / max) * 100}%` }}
                />
              ))}
              {days.map((d, i) => (
                <button
                  key={d.date}
                  type="button"
                  className={`revenue-day${d.date === today ? " is-today" : ""}${i === active ? " is-active" : ""}`}
                  aria-label={`${weekday(d.date)} ${formatDate(d.date)}: ${money(d.revenue)}, ${d.tickets} vé`}
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                >
                  {d.revenue > 0 && (
                    <span
                      className="revenue-bar"
                      style={{ height: `${(d.revenue / max) * 100}%` }}
                    />
                  )}
                  {d === best && best.revenue > 0 && (
                    <span
                      className="revenue-peak"
                      style={{ bottom: `${(d.revenue / max) * 100}%` }}
                    >
                      {compact(d.revenue)}
                    </span>
                  )}
                </button>
              ))}
              {tip && (
                <div
                  className="revenue-tip"
                  role="status"
                  style={{
                    // Giữ tooltip trong khung ở ngày đầu / cuối tháng.
                    left: `clamp(70px, ${((active + 0.5) / days.length) * 100}%, calc(100% - 70px))`,
                  }}
                >
                  <strong>{money(tip.revenue)}</strong>
                  <span>
                    {weekday(tip.date)} {formatDate(tip.date)} · {tip.tickets}{" "}
                    vé
                  </span>
                </div>
              )}
            </div>
            <div className="revenue-x" aria-hidden="true">
              {days.map((d, i) => (
                <span
                  key={d.date}
                  // Màn hẹp chỉ ghi ngày 1, 5, 10…; ngày cuối tháng chỉ ghi khi không sát nhãn trước.
                  className={`${i === 0 || (i + 1) % 5 === 0 || (i === days.length - 1 && (i + 1) % 5 >= 3) ? "major" : "minor"}${d.date === today ? " is-today" : ""}`}
                >
                  {i + 1}
                </span>
              ))}
            </div>
          </div>
          <details className="revenue-table">
            <summary>
              Bảng chi tiết {days.length} ngày của{" "}
              {monthLabel(month).toLowerCase()}
            </summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <TableHeading icon={CalendarDays}>Ngày</TableHeading>
                    <TableHeading icon={Ticket}>Số vé</TableHeading>
                    <TableHeading icon={Wallet}>Doanh thu</TableHeading>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.date} className={d.revenue ? "" : "is-zero"}>
                      <td>
                        {weekday(d.date)}, {formatDate(d.date)}
                      </td>
                      <td>{d.tickets}</td>
                      <td>{money(d.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <TableHeading icon={Sigma} scope="row">
                      Cả tháng
                    </TableHeading>
                    <th>{data.tickets}</th>
                    <th>{money(data.revenue)}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
          </details>
        </div>
      )}
      {!data && <p className="muted">Đang tải doanh thu…</p>}
    </section>
  );
}
