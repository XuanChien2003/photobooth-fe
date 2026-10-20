import { useEffect, useState } from "react";
import { Clock, LogIn, LogOut } from "lucide-react";
import { api, money } from "../api";
import { useLiveData } from "../use-live-data";
import { Button, ErrorBox, useStudio, useToast } from "../studio";

const timeOf = (value) =>
  new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value));
const digits = (value) => value.replace(/\D/g, "").slice(0, 10);

// Ca trực của lễ tân: mở ca với tiền đầu ca, theo dõi tiền đã thu, đóng ca và đối chiếu tiền mặt.
export function ShiftPanel({ assignedBranch, notify, refreshKey = 0 }) {
  const { rooms = [] } = useStudio();
  const toast = useToast();
  const branches = [...new Set(rooms.map((r) => r.branch).filter(Boolean))];
  const [chosen, setChosen] = useState(branches[0] || "");
  const branch = assignedBranch || chosen;
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState("");
  const [closing, setClosing] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = useLiveData(
    `/admin/shifts${assignedBranch ? "" : `?branch=${encodeURIComponent(branch)}`}`,
    (d) => { setData(d); setError(""); },
    (e) => setError(e.message),
    30000,
  );
  // Vừa thu tiền một vé ở quầy: cập nhật tiền trong ca ngay.
  useEffect(() => {
    if (refreshKey) reload();
  }, [refreshKey]);
  const current = data?.current;
  const expectedCash = current ? (current.openingCash || 0) + (current.summary?.cash || 0) : 0;
  async function run(action) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      await reload();
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  const open = () => run(async () => {
    await api("/admin/shifts/open", { method: "POST",
      body: { branch, openingCash: Number(opening) || 0 } });
    setOpening("");
    notify(`Đã mở ca tại ${branch}.`);
  });
  const close = () => run(async () => {
    if (closing === "") throw new Error("Vui lòng nhập số tiền mặt đếm được cuối ca.");
    await api(`/admin/shifts/${current._id}/close`, { method: "POST",
      body: { closingCash: Number(closing), note } });
    setClosing("");
    setNote("");
    notify(`Đã đóng ca tại ${current.branch}.`);
  });
  return (
    <section className="panel shift-panel">
      <div className="shift-head">
        <h3><Clock size={18} aria-hidden="true" /> Ca trực</h3>
        {!assignedBranch && (
          <select aria-label="Chi nhánh" value={chosen} onChange={(e) => setChosen(e.target.value)}>
            {branches.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        )}
      </div>
      <ErrorBox error={error} />
      {!data ? (
        <p className="muted">Đang tải ca trực…</p>
      ) : current ? (
        <>
          <p className="shift-status open">
            Đang mở ca từ <b>{timeOf(current.openedAt)}</b> · {current.openedByName || "—"} ·
            tiền đầu ca {money(current.openingCash)}
          </p>
          <div className="shift-stats">
            <div>
              <span>Vé đã thu</span>
              <strong>{current.summary?.tickets || 0}</strong>
              {current.summary?.extraSheets > 0 && <small>+ {current.summary.extraSheets} tờ in thêm</small>}
            </div>
            <div><span>Tiền mặt</span><strong>{money(current.summary?.cash)}</strong></div>
            <div><span>Chuyển khoản</span><strong>{money(current.summary?.transfer)}</strong></div>
            <div><span>Tiền mặt trong két nên có</span><strong>{money(expectedCash)}</strong></div>
          </div>
          <div className="shift-form">
            <label>
              Tiền mặt đếm được cuối ca
              <input inputMode="numeric" placeholder="VD: 1500000" value={closing}
                onChange={(e) => setClosing(digits(e.target.value))} />
            </label>
            <label>
              Ghi chú (không bắt buộc)
              <input maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            {closing !== "" && (
              <p className={`shift-diff ${Number(closing) === expectedCash ? "ok" : "off"}`}>
                {Number(closing) === expectedCash
                  ? "Khớp với số tiền nên có."
                  : `Chênh lệch ${money(Number(closing) - expectedCash)}`}
              </p>
            )}
            <Button disabled={busy} onClick={close}>
              <LogOut size={16} /> {busy ? "Đang đóng ca…" : "Đóng ca"}
            </Button>
          </div>
        </>
      ) : (
        <div className="shift-form">
          <p className="shift-status">Chưa mở ca{branch ? ` tại ${branch}` : ""}. Mở ca trước khi thu tiền khách.</p>
          <label>
            Tiền mặt đầu ca
            <input inputMode="numeric" placeholder="0" value={opening}
              onChange={(e) => setOpening(digits(e.target.value))} />
          </label>
          <Button disabled={busy || !branch} onClick={open}>
            <LogIn size={16} /> {busy ? "Đang mở ca…" : "Mở ca"}
          </Button>
        </div>
      )}
      {data?.recent?.length > 0 && (
        <details className="shift-history">
          <summary>Ca gần đây</summary>
          <ul>
            {data.recent.slice(0, 10).map((s) => {
              const diff = (s.closingCash ?? 0) - ((s.openingCash || 0) + (s.summary?.cash || 0));
              return (
                <li key={s._id}>
                  <span>{timeOf(s.openedAt)} → {s.closedAt ? timeOf(s.closedAt) : "—"}</span>
                  <span>{s.openedByName}{s.closedByName && s.closedByName !== s.openedByName ? ` / ${s.closedByName}` : ""}</span>
                  <span>{s.summary?.tickets || 0} vé · {money(s.summary?.total)}</span>
                  <span className={diff ? "off" : "ok"}>{diff ? `Lệch ${money(diff)}` : "Khớp"}</span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}
