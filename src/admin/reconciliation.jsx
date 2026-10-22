import { useMemo, useState } from "react";
import { Banknote, Building2, Clock, Download, Landmark, Scale, Sigma, Ticket, User, Wallet } from "lucide-react";
import { localDate, money } from "../api";
import { isConnectivityError } from "../network.js";
import { useLiveData } from "../use-live-data";
import { Button, ErrorBox, useStudio, useToast } from "../studio";
import { ShiftPanel } from "./shift-panel";
import { TableHeading } from "./table-heading";

const timeOf = (value) =>
  value
    ? new Intl.DateTimeFormat("vi-VN", {
        hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh",
      }).format(new Date(value))
    : "—";
function recentMonths(count = 24) {
  const [year, month] = localDate().split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}
const monthLabel = (m) => `Tháng ${Number(m.slice(5))}/${m.slice(0, 4)}`;

// Đối soát theo tháng: các ca đã đóng (tiền nên có so với tiền đếm được) và tiền đã thu từng chi nhánh.
function MonthlyReport({ assignedBranch }) {
  const toast = useToast();
  const { rooms = [] } = useStudio();
  const months = useMemo(() => recentMonths(), []);
  const branches = [...new Set(rooms.map((r) => r.branch).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi"));
  const [month, setMonth] = useState(months[0]);
  const [branch, setBranch] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const query = new URLSearchParams({ month, ...(!assignedBranch && branch ? { branch } : {}) }).toString();
  useLiveData(
    `/admin/shifts/report?${query}`,
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
  function exportCsv() {
    const rows = [
      [`Đối soát ${monthLabel(month).toLowerCase()}`, assignedBranch || branch || "Tất cả chi nhánh"],
      [],
      ["Chi nhánh", "Số vé", "Tờ in thêm", "Tiền mặt", "Chuyển khoản", "Tổng"],
      ...data.branches.map((b) => [b.branch, b.tickets, b.extraSheets, b.cash, b.transfer, b.total]),
      ["Tổng", data.totals.tickets, data.totals.extraSheets, data.totals.cash, data.totals.transfer, data.totals.total],
      [],
      ["Mở ca", "Đóng ca", "Chi nhánh", "Người mở", "Người đóng", "Tiền đầu ca", "Tiền mặt thu", "Chuyển khoản", "Tiền mặt nên có", "Tiền đếm được", "Chênh lệch", "Ghi chú"],
      ...data.shifts.map((s) => [timeOf(s.openedAt), timeOf(s.closedAt), s.branch, s.openedByName, s.closedByName,
        s.openingCash || 0, s.summary?.cash || 0, s.summary?.transfer || 0, s.expectedCash, s.closingCash ?? 0, s.difference, s.note || ""]),
    ];
    const url = URL.createObjectURL(
      new Blob(["﻿" + rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/^[=+@-]/, "'").replaceAll('"', '""')}"`).join(",")).join("\r\n")], {
        type: "text/csv;charset=utf-8;",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `doi-soat-${month}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(`Đã xuất đối soát ${monthLabel(month).toLowerCase()}.`);
  }
  return (
    <section className="panel reconciliation-report" aria-labelledby="report-title">
      <div className="revenue-head">
        <div>
          <h3 id="report-title"><Scale size={18} aria-hidden="true" /> Đối soát theo tháng</h3>
          <p className="revenue-period">{monthLabel(month)}{assignedBranch ? ` · ${assignedBranch}` : branch ? ` · ${branch}` : ""}</p>
        </div>
        <div className="revenue-filters">
          <select aria-label="Tháng" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          {!assignedBranch && branches.length > 1 && (
            <select aria-label="Chi nhánh" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">Tất cả chi nhánh</option>
              {branches.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          )}
          <Button className="outline small" disabled={!data || loading} onClick={exportCsv}>
            <Download size={15} /> Tải về
          </Button>
        </div>
      </div>
      <ErrorBox error={error} />
      {!data ? (
        <p className="muted">Đang tải đối soát…</p>
      ) : (
        <div className={`revenue-body ${loading ? "is-loading" : ""}`}>
          <dl className="revenue-summary">
            <div><dt>Tổng đã thu</dt><dd>{money(data.totals.total)}</dd></div>
            <div><dt>Tiền mặt</dt><dd>{money(data.totals.cash)}</dd></div>
            <div><dt>Chuyển khoản</dt><dd>{money(data.totals.transfer)}</dd></div>
            <div><dt>Ca đã đóng</dt><dd>{data.totals.matched}/{data.totals.shifts} ca khớp</dd></div>
            <div>
              <dt>Tổng chênh lệch</dt>
              <dd className={data.totals.difference ? "is-down" : "is-up"}>{money(data.totals.difference)}</dd>
            </div>
          </dl>
          <h4 className="report-subtitle">Theo chi nhánh</h4>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <TableHeading icon={Building2}>Chi nhánh</TableHeading>
                  <TableHeading icon={Ticket}>Số vé</TableHeading>
                  <TableHeading icon={Banknote}>Tiền mặt</TableHeading>
                  <TableHeading icon={Landmark}>Chuyển khoản</TableHeading>
                  <TableHeading icon={Wallet}>Tổng</TableHeading>
                </tr>
              </thead>
              <tbody>
                {data.branches.map((b) => (
                  <tr key={b.branch}>
                    <td data-label="Chi nhánh">{b.branch}</td>
                    <td data-label="Số vé">{b.tickets}{b.extraSheets > 0 && <small>+ {b.extraSheets} tờ in thêm</small>}</td>
                    <td data-label="Tiền mặt">{money(b.cash)}</td>
                    <td data-label="Chuyển khoản">{money(b.transfer)}</td>
                    <td data-label="Tổng"><strong>{money(b.total)}</strong></td>
                  </tr>
                ))}
              </tbody>
              {data.branches.length > 1 && (
                <tfoot>
                  <tr>
                    <TableHeading icon={Sigma} scope="row">Tổng</TableHeading>
                    <th>{data.totals.tickets}</th>
                    <th>{money(data.totals.cash)}</th>
                    <th>{money(data.totals.transfer)}</th>
                    <th>{money(data.totals.total)}</th>
                  </tr>
                </tfoot>
              )}
            </table>
            {!data.branches.length && <div className="empty-state">Chưa có dữ liệu trong {monthLabel(month).toLowerCase()}.</div>}
          </div>
          <h4 className="report-subtitle">Các ca trong tháng</h4>
          <div className="table-wrap shift-report-table">
            <table>
              <thead>
                <tr>
                  <TableHeading icon={Clock}>Thời gian</TableHeading>
                  <TableHeading icon={User}>Nhân viên</TableHeading>
                  <TableHeading icon={Banknote}>Tiền mặt nên có</TableHeading>
                  <TableHeading icon={Wallet}>Đếm được</TableHeading>
                  <TableHeading icon={Scale}>Trạng thái</TableHeading>
                </tr>
              </thead>
              <tbody>
                {data.shifts.map((s) => (
                  <tr key={s._id}>
                    <td data-label="Thời gian">
                      {timeOf(s.openedAt)} → {timeOf(s.closedAt)}
                      <small>{s.branch} · {s.summary?.tickets || 0} vé · CK {money(s.summary?.transfer)}</small>
                    </td>
                    <td data-label="Nhân viên">
                      {s.openedByName || "—"}
                      {s.closedByName && s.closedByName !== s.openedByName && <small>Đóng ca: {s.closedByName}</small>}
                    </td>
                    <td data-label="Tiền mặt nên có">
                      {money(s.expectedCash)}
                      <small>Đầu ca {money(s.openingCash)} + thu {money(s.summary?.cash)}</small>
                    </td>
                    <td data-label="Đếm được">{money(s.closingCash)}{s.note && <small>{s.note}</small>}</td>
                    <td data-label="Trạng thái">
                      <span className={`badge ${s.difference ? "cancelled" : "confirmed"}`}>
                        {s.difference ? `Lệch ${money(s.difference)}` : "Khớp"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.shifts.length && <div className="empty-state">Chưa có ca nào được đóng trong {monthLabel(month).toLowerCase()}.</div>}
          </div>
        </div>
      )}
    </section>
  );
}

// Đối soát (như Snapbox /cost-reconciliation, theo nghiệp vụ của tiệm): ca trực đang mở và đối
// soát tiền theo tháng.
export function Reconciliation({ assignedBranch, notify, canSeeMoney, canOperate }) {
  return (
    <>
      <ShiftPanel assignedBranch={assignedBranch} notify={notify} canOperate={canOperate} />
      {canSeeMoney && <MonthlyReport assignedBranch={assignedBranch} />}
    </>
  );
}
