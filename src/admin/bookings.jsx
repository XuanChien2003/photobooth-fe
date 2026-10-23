import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronDown, Copy, Download, ExternalLink, FileArchive, Image as ImageIcon, Plus, Printer, RefreshCw, Search, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api, assetUrl, formatDateTime, getApiUrl, labels, localDate, money } from "../api";
import { isConnectivityError } from "../network.js";
import { directMediaUrl } from "../media-delivery.js";
import { useLiveData } from "../use-live-data";
import { Button, ErrorBox, useStudio, useToast } from "../studio";
import { CounterTicket } from "../counter-ticket";
import { ExtraPrints } from "../extra-prints";

const paymentLabel = (method) => method === "cash" ? "Tiền mặt" : method === "transfer" ? "Chuyển khoản" : "—";
const albumUrl = (booking) => booking.accessToken ? `${window.location.origin}/album/${booking.accessToken}` : "";

// Ảnh đại diện của đơn: ảnh đã ghép khung (máy chụp ghép, rồi tới lệnh in gần nhất), chưa có thì
// tấm đầu tiên khách chụp.
function OrderThumb({ booking }) {
  const job = booking.latestPrint;
  const framed = Boolean(booking.composite || job?.image);
  const src = booking.composite
    ? assetUrl(booking.coverPhoto)
    : job?.image
      ? assetUrl(`${job.image}?size=thumbnail`)
      : booking.coverPhoto ? assetUrl(directMediaUrl(booking.coverPhoto)) : "";
  const [failed, setFailed] = useState("");
  return (
    <div className="order-thumb">
      {src && failed !== src
        ? <img src={src} alt={framed ? "Ảnh đã ghép khung" : "Ảnh đầu tiên"} loading="lazy" onError={() => setFailed(src)} />
        : <ImageIcon />}
    </div>
  );
}

// Tải ảnh: tất cả ảnh gốc (ZIP), ảnh đã ghép khung ở máy chụp hoặc file in (final).
function DownloadMenu({ booking }) {
  const [open, setOpen] = useState(false);
  const menu = useRef(null);
  const job = booking.latestPrint;
  const zip = booking.status === "completed" && !booking.mediaDeleted;
  useEffect(() => {
    if (!open) return;
    const close = (event) => {
      if (event.type === "keydown" ? event.key === "Escape" : !menu.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const composite = booking.composite?.url;
  if (!zip && !job?.image && !composite) return null;
  return (
    <div className="order-download" ref={menu}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronDown size={14} aria-hidden="true" /> Tải ảnh <Download size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="order-download-menu" role="menu">
          {zip && (
            <a role="menuitem" href={getApiUrl(`/api/albums/${booking.accessToken}/download`)} onClick={() => setOpen(false)}>
              <FileArchive size={16} aria-hidden="true" /> Tải tất cả ảnh (ZIP)
            </a>
          )}
          {composite && (
            <a role="menuitem" href={`${assetUrl(composite)}?download=1`} onClick={() => setOpen(false)}>
              <ImageIcon size={16} aria-hidden="true" /> Tải ảnh ghép khung (JPG)
            </a>
          )}
          {job?.image && (
            <a role="menuitem" href={`${assetUrl(job.image)}?download=1&sheet=0`} onClick={() => setOpen(false)}>
              <ImageIcon size={16} aria-hidden="true" /> Tải ảnh final ({(job.format || "png").toUpperCase()})
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function PrintOrderDialog({ booking, onClose, onExtra, onPrinted }) {
  const toast = useToast();
  const [copies, setCopies] = useState(1);
  const [busy, setBusy] = useState(false);
  const job = booking.latestPrint;
  async function reprint() {
    if (!job || busy) return;
    setBusy(true);
    try {
      await api(`/admin/bookings/${booking._id}/reprint`, {
        method: "POST", body: { jobId: job._id, copies },
      });
      toast.success(`Đã gửi ${copies} bản vào hàng chờ in.`);
      onPrinted();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal order-print-dialog" role="dialog" aria-modal="true"
        aria-label={`In ảnh đơn ${booking.code}`} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><h2>In ảnh · #{booking.code}</h2><p>In lại file đã ghép gần nhất hoặc cộng thêm lượt in cho khách.</p></div>
          <button className="icon-button" aria-label="Đóng" onClick={onClose}><X /></button>
        </div>
        {job ? (
          <div className="order-print-body">
            <img src={assetUrl(`${job.image}?size=thumbnail`)} alt={`Ảnh in của đơn ${booking.code}`} />
            <dl>
              <div><dt>Khung ảnh</dt><dd>{job.frameName || "Khung đã ghép"}</dd></div>
              <div><dt>Kích thước</dt><dd>{booking.printSize === "strip" ? "5 × 15 cm" : "10 × 15 cm"}</dd></div>
              <div><dt>Số tờ trong file</dt><dd>{job.sheetCount || 1}</dd></div>
            </dl>
            <label>Số bản in lại
              <select value={copies} onChange={(event) => setCopies(Number(event.target.value))}>
                {Array.from({ length: 20 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          </div>
        ) : (
          <div className="order-print-empty"><ImageIcon /><h3>Khách chưa gửi file in</h3><p>Mở album để chọn ảnh, ghép khung và gửi file in lần đầu.</p></div>
        )}
        <div className="order-print-actions">
          {booking.accessToken && <Link className="button outline" to={`/album/${booking.accessToken}`} target="_blank">Mở album <ExternalLink size={15} /></Link>}
          <Button className="outline" onClick={onExtra}>+ Thêm lượt in</Button>
          {job && <Button disabled={busy} onClick={reprint}><Printer size={16} /> {busy ? "Đang gửi…" : "In lại ảnh"}</Button>}
        </div>
      </section>
    </div>
  );
}

export function BookingsManager({ notify, canSeeMoney, canExport = true, canCancel = false, canPrint = true, assignedBranch }) {
  const toast = useToast();
  const { rooms: catalogRooms = [] } = useStudio();
  const lastError = useRef("");
  const today = localDate();
  const [creating, setCreating] = useState(false);
  const [collecting, setCollecting] = useState(null);
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState("");
  const [room, setRoom] = useState("");
  const [payment, setPayment] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [selling, setSelling] = useState(null);
  const [printing, setPrinting] = useState(null);
  const [albumQr, setAlbumQr] = useState(null);
  const params = new URLSearchParams({
    ...(from ? { from } : {}), ...(to ? { to } : {}), ...(status ? { status } : {}),
    ...(room ? { room } : {}), ...(payment ? { paymentMethod: payment } : {}),
  });
  const load = useLiveData(`/admin/bookings?${params}`, (data) => {
    setItems(data); setError(""); lastError.current = "";
  }, (loadError) => {
    setError(loadError.message);
    if (lastError.current !== loadError.message && !isConnectivityError(loadError)) toast.error(loadError.message);
    lastError.current = loadError.message;
  }, 20000);
  const filtered = useMemo(() => items.filter((booking) =>
    `${booking.name} ${booking.phone} ${booking.code} ${booking._id}`.toLowerCase().includes(query.trim().toLowerCase())), [items, query]);
  // Máy trong danh mục (đúng chi nhánh) và cả máy cũ còn trong đơn đã lọc.
  const rooms = useMemo(() => [...new Set([
    ...catalogRooms.filter((r) => !assignedBranch || r.branch === assignedBranch).map((r) => r.name),
    ...items.map((booking) => booking.roomName),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi")), [items, catalogRooms, assignedBranch]);
  const totals = useMemo(() => ({
    revenue: filtered.reduce((sum, booking) => sum + (booking.total || 0), 0),
    received: filtered.reduce((sum, booking) => sum + (booking.paid ? booking.total || 0 : 0), 0),
  }), [filtered]);
  const hasFilters = query.trim() || from !== today || to !== today || status || room || payment;
  const resetFilters = () => {
    setQuery("");
    setFrom(today);
    setTo(today);
    setStatus("");
    setRoom("");
    setPayment("");
  };

  async function update(booking, body) {
    if (body.status === "cancelled" && !confirm("Hủy đơn này? Nếu đã nhận tiền, hãy hoàn tiền riêng cho khách trước khi xác nhận.")) return;
    setBusyId(booking._id);
    try {
      await api(`/admin/bookings/${booking._id}`, { method: "PATCH", body });
      await load();
      notify(body.status === "cancelled" ? `Đã hủy đơn #${booking.code}.` : `Đã cập nhật đơn #${booking.code}.`);
    } catch (updateError) { toast.error(updateError.message); }
    finally { setBusyId(""); }
  }
  async function copyAlbum(booking) {
    try { await navigator.clipboard.writeText(albumUrl(booking)); toast.success("Đã sao chép link ảnh."); }
    catch { toast.error("Không sao chép được. Hãy mở album và sao chép địa chỉ trên trình duyệt."); }
  }
  function csv() {
    if (!filtered.length) return toast.info("Không có đơn nào để xuất.");
    const rows = [
      ["Mã đơn", "Khách", "Điện thoại", "Thời gian", "Gói", "Chủ đề", "Máy", "Kích thước", "Đã gửi in", "Tổng tiền", "Thực nhận", "Thanh toán", "Trạng thái"],
      ...filtered.map((booking) => [booking.code, booking.name, booking.phone, formatDateTime(booking.createdAt), booking.packageName,
        booking.latestPrint?.frameName || booking.frameName || "", booking.roomName, booking.printSize === "strip" ? "Nhỏ" : "Lớn",
        booking.printSheets || 0, canSeeMoney ? booking.total : "", canSeeMoney ? (booking.paid ? booking.total : 0) : "",
        paymentLabel(booking.paymentMethod), labels[booking.status]]),
    ];
    const url = URL.createObjectURL(new Blob(["\ufeff" + rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/^[=+@-]/, "'").replaceAll('"', '""')}"`).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8;" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "don-hang-photobooth.csv"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); notify(`Đã xuất ${filtered.length} đơn hàng.`);
  }

  return <>
    <ErrorBox error={error} />
    <div className="order-toolbar">
      <Button className="outline small" onClick={() => { setFrom(today); setTo(today); }}>Hôm nay</Button>
      <label className="order-date-range"><CalendarDays size={16} />
        <input aria-label="Từ ngày" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /><span>→</span>
        <input aria-label="Đến ngày" type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
      </label>
      <select aria-label="Lọc máy" value={room} onChange={(event) => setRoom(event.target.value)}>
        <option value="">Máy: Tất cả</option>{rooms.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      <select aria-label="Lọc trạng thái" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="">Tất cả trạng thái</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <select aria-label="Lọc thanh toán" value={payment} onChange={(event) => setPayment(event.target.value)}>
        <option value="">Thanh toán: Tất cả</option><option value="cash">Tiền mặt</option><option value="transfer">Chuyển khoản</option>
      </select>
    </div>
    <div className="order-actions-bar">
      <div className="search-box"><Search size={17} /><input aria-label="Tìm đơn" placeholder="Mã đơn, tên, số điện thoại…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      {canExport && <Button className="outline small" onClick={csv}><Download size={15} /> Tải về (Excel)</Button>}
      <Button className="outline small" onClick={() => load()} aria-label="Làm mới"><RefreshCw size={15} /></Button>
      {hasFilters && <Button className="outline small" onClick={resetFilters}><X size={15} /> Xóa bộ lọc</Button>}
      <Button onClick={() => setCreating(true)}><Plus size={15} /> Tạo đơn</Button>
    </div>
    <div className="order-summary" aria-live="polite">
      <span><small>Đơn phù hợp</small><strong>{filtered.length}</strong></span>
      {canSeeMoney && <>
        <span><small>Tổng doanh thu</small><strong>{money(totals.revenue)}</strong></span>
        <span><small>Đã thực nhận</small><strong>{money(totals.received)}</strong></span>
      </>}
    </div>
    <div className="order-list">
      {filtered.map((booking) => {
        const job = booking.latestPrint;
        return <article className="order-card" key={booking._id} title={`Mã hệ thống: ${booking._id}`}>
          <div className="order-identity">
            <OrderThumb booking={booking} />
            <div className="order-main"><time>{formatDateTime(booking.createdAt)}</time><strong>#{booking.code} · {booking.name || "Khách tại quầy"}</strong><small>{booking.roomName || "Chưa chọn máy"} · {booking.packageName || "Gói chụp"}</small>
              <div className="order-card-actions">{booking.accessToken && <>
                <a className="order-album-link" href={albumUrl(booking)} target="_blank" rel="noreferrer">Link ảnh <ExternalLink size={14} /></a>
                {canPrint && <button onClick={() => setPrinting(booking)}>In ảnh <Printer size={14} /></button>}
                <DownloadMenu booking={booking} />
              </>}</div>
            </div>
          </div>
          <dl className="order-details">
            <div><dt>Gói:</dt><dd>{booking.packageName || "—"}</dd></div><div><dt>Chủ đề:</dt><dd>{job?.frameName || booking.frameName || "—"}</dd></div>
            <div><dt>Kích thước:</dt><dd>{booking.printSize === "strip" ? "Nhỏ" : "Lớn"}</dd></div><div><dt>Số lượng:</dt><dd>{booking.printSheets || 0}/{booking.prints ?? 1} tờ</dd></div>
          </dl>
          {canSeeMoney && <dl className="order-pricing"><div><dt>Đơn giá:</dt><dd>{money((booking.total || 0) + (booking.discount || 0))}</dd></div>
            <div><dt>Giảm giá:</dt><dd>{money(booking.discount || 0)}</dd></div><div><dt>Tổng đơn:</dt><dd>{money(booking.total)}</dd></div></dl>}
          <dl className="order-payment"><div><dt>Thanh toán:</dt><dd>{paymentLabel(booking.paymentMethod)}</dd></div>
            {canSeeMoney && <><div><dt>Tổng đơn:</dt><dd>{money(booking.total)}</dd></div><div className={booking.paid ? "received" : "unpaid"}><dt>Thực nhận:</dt><dd>{money(booking.paid ? booking.total : 0)}</dd></div></>}
            <div><dt>Trạng thái:</dt><dd><span className={`badge ${booking.status}`}>{labels[booking.status]}</span></dd></div>
          </dl>
          {((booking.status === "completed" && !booking.mediaDeleted && booking.accessToken) ||
            (booking.status === "pending" && booking.source === "counter") ||
            (canCancel && booking.status === "confirmed")) && (
            <div className="order-more-actions">
              {booking.status === "completed" && !booking.mediaDeleted && booking.accessToken && <button onClick={() => setAlbumQr(booking)}>QR ảnh</button>}
              {booking.status === "pending" && booking.source === "counter" && <button onClick={() => setCollecting(booking)}>Xác nhận đã thu</button>}
              {canCancel && booking.status === "confirmed" && <button disabled={busyId === booking._id} onClick={() => update(booking, { status: "cancelled" })}>Hủy đơn</button>}
            </div>
          )}
        </article>;
      })}
      {!filtered.length && <div className="empty-state"><CalendarDays /><h3>Chưa có đơn hàng phù hợp.</h3><p>Thử đổi khoảng ngày hoặc bộ lọc.</p></div>}
    </div>
    {(creating || collecting) && <CounterTicket assignedBranch={assignedBranch} initialDraft={collecting}
      onClose={() => { setCreating(false); setCollecting(null); load(); }} onCreated={(ticket) => { load(); notify(`Đã cấp mã #${ticket.code} cho ${ticket.name}.`); }} />}
    {albumQr && <div className="modal-backdrop" onClick={() => setAlbumQr(null)}><section className="modal center" role="dialog" aria-modal="true" aria-label="QR nhận ảnh" onClick={(event) => event.stopPropagation()}>
      <button aria-label="Đóng" className="modal-close icon-button" onClick={() => setAlbumQr(null)}><X /></button><h2>QR nhận ảnh · đơn #{albumQr.code}</h2>
      <p>Cho khách quét mã này để mở lại album ảnh.</p><QRCodeSVG value={albumUrl(albumQr)} size={240} marginSize={2} />
      <div className="order-qr-actions">
        <Button className="outline small" onClick={() => copyAlbum(albumQr)}><Copy size={15} /> Sao chép link</Button>
        <a className="button outline small" href={albumUrl(albumQr)} target="_blank" rel="noreferrer">Mở album <ExternalLink size={15} /></a>
      </div>
    </section></div>}
    {printing && <PrintOrderDialog booking={printing} onClose={() => setPrinting(null)} onExtra={() => { setSelling(printing); setPrinting(null); }} onPrinted={() => { setPrinting(null); load(); }} />}
    {selling && <ExtraPrints booking={selling} canEditPrice={canSeeMoney} onClose={() => setSelling(null)} onSold={(updated, sheets) => { setSelling(null); load(); notify(`Đã cộng ${sheets} tờ in cho đơn #${updated.code}.`); }} />}
  </>;
}
