import { useState } from "react";
import { CalendarDays, Download, Sigma, Ticket, Wallet, History } from "lucide-react";
import { formatDate, localDate, money } from "../api";
import { isConnectivityError } from "../network.js";
import { useLiveData } from "../use-live-data";
import { Button, ErrorBox, useToast } from "../studio";
import { TableHeading } from "./table-heading";
import { RangeFilter, rangePresets, rangeQuery } from "./date-range";

// Số tiền gọn cho trục và nhãn: 1,5 tr · 500 N.
const compact = (v) =>
  v >= 1e6
    ? `${(v / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} tr`
    : v >= 1e3
      ? `${Math.round(v / 1e3).toLocaleString("vi-VN")} N`
      : String(v);
// Bước trục tung tròn số (1 / 2 / 2,5 / 5 × 10ⁿ); 4 khoảng chia.
function niceStep(raw, minimum) {
  if (raw <= 0) return minimum;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return Math.max(minimum, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p);
}
const label = (unit, key) =>
  unit === "day" ? formatDate(key).slice(0, 5) : `T${Number(key.slice(5))}/${key.slice(2, 4)}`;
const longLabel = (unit, key) =>
  unit === "day"
    ? `${new Intl.DateTimeFormat("vi-VN", { weekday: "short", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`))} ${formatDate(key)}`
    : `Tháng ${Number(key.slice(5))}/${key.slice(0, 4)}`;

// Thống kê doanh thu (như trang Snapbox /overview/statistics): doanh thu hoặc số đơn theo ngày /
// tháng, so với kỳ trước (theo ngày) hoặc cùng kỳ năm trước (theo tháng).
export function Statistics({ assignedBranch }) {
  const toast = useToast();
  const today = localDate();
  const month = rangePresets(today).find(([key]) => key === "month");
  const [range, setRange] = useState({ from: month[2], to: month[3], branch: "", room: "" });
  const [metric, setMetric] = useState("revenue");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState(null);
  const query = rangeQuery(range, assignedBranch);
  useLiveData(
    `/admin/stats/chart?${query}`,
    (d) => {
      setData({ ...d, query });
      setError("");
    },
    (e) => {
      setError(e.message);
      if (!isConnectivityError(e)) toast.error(e.message);
    },
    60000,
  );
  const loading = data?.query !== query;
  const points = data?.points || [];
  const value = (p, side = "current") => p[side][metric];
  const format = metric === "revenue" ? money : (n) => `${n.toLocaleString("vi-VN")} đơn`;
  const step = niceStep(Math.max(0, ...points.flatMap((p) => [value(p), value(p, "previous")])) / 4, metric === "revenue" ? 250000 : 1);
  const max = step * 4;
  const ticks = [0, 1, 2, 3, 4].map((i) => i * step);
  const total = (side, key = metric) => points.reduce((n, p) => n + p[side][key], 0);
  const current = total("current"), previous = total("previous");
  const change = previous ? Math.round(((current - previous) / previous) * 1000) / 10 : current ? 100 : 0;
  const best = points.reduce((top, p) => (value(p) > (top ? value(top) : 0) ? p : top), null);
  const compare = data?.unit === "month" ? "Cùng kỳ năm trước" : "Kỳ trước";
  const tip = active !== null && points[active];
  const every = Math.max(1, Math.ceil(points.length / 12));
  function exportCsv() {
    const rows = [
      ["Mốc", "Doanh thu (VND)", "Số đơn", `${compare} — mốc`, `${compare} — doanh thu`, `${compare} — số đơn`],
      ...points.map((p) => [longLabel(data.unit, p.key), p.current.revenue, p.current.orders,
        longLabel(data.unit, p.previousKey), p.previous.revenue, p.previous.orders]),
      ["Tổng", total("current", "revenue"), total("current", "orders"), "", total("previous", "revenue"), total("previous", "orders")],
    ];
    const url = URL.createObjectURL(
      new Blob(["﻿" + rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(",")).join("\r\n")], {
        type: "text/csv;charset=utf-8;",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `thong-ke-doanh-thu-${range.from}-${range.to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success("Đã xuất thống kê doanh thu ra file CSV (mở được bằng Excel).");
  }
  return (
    <>
      <ErrorBox error={error} />
      <section className="panel revenue-panel statistics-panel" aria-labelledby="statistics-title">
        <div className="revenue-head">
          <div>
            <h3 id="statistics-title">{metric === "revenue" ? "Doanh thu" : "Số lượng đơn"} theo {data?.unit === "month" ? "tháng" : "ngày"}</h3>
            <p className="revenue-period">
              {formatDate(range.from)} – {formatDate(range.to)}
            </p>
          </div>
          <div className="revenue-filters">
            <div className="segmented" role="group" aria-label="Chỉ số">
              {[["revenue", "Doanh thu", Wallet], ["orders", "Số lượng đơn", Ticket]].map(([key, text, Icon]) => (
                <button
                  type="button"
                  key={key}
                  className={metric === key ? "active" : ""}
                  aria-pressed={metric === key}
                  onClick={() => setMetric(key)}
                >
                  <Icon size={15} aria-hidden="true" /> {text}
                </button>
              ))}
            </div>
            <Button className="outline small" disabled={!data || loading} onClick={exportCsv}>
              <Download size={15} /> Tải về
            </Button>
          </div>
        </div>
        <RangeFilter value={range} onChange={(v) => { setActive(null); setRange(v); }} assignedBranch={assignedBranch} />
        {!data ? (
          <p className="muted">Đang tải thống kê…</p>
        ) : (
          <div className={`revenue-body ${loading ? "is-loading" : ""}`}>
            <dl className="revenue-summary">
              <div>
                <dt>Kỳ này</dt>
                <dd>{format(current)}</dd>
              </div>
              <div>
                <dt>{compare}</dt>
                <dd>{format(previous)}</dd>
              </div>
              <div>
                <dt>Tăng / giảm</dt>
                <dd className={change >= 0 ? "is-up" : "is-down"}>
                  {change >= 0 ? "↑" : "↓"} {Math.abs(change).toLocaleString("vi-VN")}%
                </dd>
              </div>
              <div>
                <dt>{data.unit === "month" ? "Tháng cao nhất" : "Ngày cao nhất"}</dt>
                <dd>{best ? `${label(data.unit, best.key)} · ${metric === "revenue" ? compact(value(best)) : value(best)}` : "—"}</dd>
              </div>
            </dl>
            <div className="chart-legend" aria-hidden="true">
              <span><i className="legend-current" /> Kỳ này</span>
              <span><i className="legend-previous" /> {compare}</span>
            </div>
            <div className="revenue-chart" style={{ "--days": points.length }}>
              <div className="revenue-axis" aria-hidden="true">
                {ticks.map((t) => (
                  <span key={t} style={{ bottom: `${(t / max) * 100}%` }}>
                    {metric === "revenue" ? compact(t) : t}
                  </span>
                ))}
              </div>
              <div className="revenue-plot" onPointerLeave={() => setActive(null)}>
                {ticks.map((t) => (
                  <i key={t} className="revenue-grid" style={{ bottom: `${(t / max) * 100}%` }} />
                ))}
                {points.map((p, i) => (
                  <button
                    key={p.key}
                    type="button"
                    className={`revenue-day${p.key === today || p.key === today.slice(0, 7) ? " is-today" : ""}${i === active ? " is-active" : ""}`}
                    aria-label={`${longLabel(data.unit, p.key)}: ${format(value(p))}; ${compare.toLowerCase()} ${format(value(p, "previous"))}`}
                    onPointerEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                  >
                    {value(p, "previous") > 0 && (
                      <span className="revenue-bar revenue-bar-previous" style={{ height: `${(value(p, "previous") / max) * 100}%` }} />
                    )}
                    {value(p) > 0 && (
                      <span className="revenue-bar" style={{ height: `${(value(p) / max) * 100}%` }} />
                    )}
                  </button>
                ))}
                {tip && (
                  <div
                    className="revenue-tip"
                    role="status"
                    style={{ left: `clamp(90px, ${((active + 0.5) / points.length) * 100}%, calc(100% - 90px))` }}
                  >
                    <strong>{format(value(tip))}</strong>
                    <span>{longLabel(data.unit, tip.key)}</span>
                    <span>
                      {compare}: {format(value(tip, "previous"))} ({longLabel(data.unit, tip.previousKey)})
                    </span>
                  </div>
                )}
              </div>
              <div className="revenue-x" aria-hidden="true">
                {points.map((p, i) => (
                  <span key={p.key} className={i % every === 0 || i === points.length - 1 ? "major" : "minor statistics-hidden"}>
                    {label(data.unit, p.key)}
                  </span>
                ))}
              </div>
            </div>
            <details className="revenue-table">
              <summary>Bảng chi tiết {points.length} {data.unit === "month" ? "tháng" : "ngày"}</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <TableHeading icon={CalendarDays}>Mốc</TableHeading>
                      <TableHeading icon={Wallet}>Doanh thu</TableHeading>
                      <TableHeading icon={Ticket}>Số đơn</TableHeading>
                      <TableHeading icon={History}>{compare}</TableHeading>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((p) => (
                      <tr key={p.key} className={p.current.orders ? "" : "is-zero"}>
                        <td>{longLabel(data.unit, p.key)}</td>
                        <td>{money(p.current.revenue)}</td>
                        <td>{p.current.orders}</td>
                        <td>{money(p.previous.revenue)} · {p.previous.orders} đơn</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <TableHeading icon={Sigma} scope="row">Tổng</TableHeading>
                      <th>{money(total("current", "revenue"))}</th>
                      <th>{total("current", "orders")}</th>
                      <th>{money(total("previous", "revenue"))} · {total("previous", "orders")} đơn</th>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </details>
          </div>
        )}
      </section>
    </>
  );
}
