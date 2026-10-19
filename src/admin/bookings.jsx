import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Guide } from "../guide";
import {
  CalendarDays,
  Package,
  Ticket,
  Plus,
  X,
  Download,
  Search,
  Activity,
  RefreshCw,
  Wallet,
  SlidersHorizontal,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api, money, labels, formatDate, formatDateTime } from "../api";
import { isConnectivityError } from "../network.js";
import { useLiveData } from "../use-live-data";
import { Button, ErrorBox, useToast } from "../studio";
import { CounterTicket } from "../counter-ticket";
import { ExtraPrints } from "../extra-prints";
import { TableHeading } from "./table-heading";

export function BookingsManager({ notify, canSeeMoney }) {
  const toast = useToast();
  const lastError = useRef("");
  const [creating, setCreating] = useState(false);
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [selling, setSelling] = useState(null);
  const [albumQr, setAlbumQr] = useState(null);
  const path = `/admin/bookings?${new URLSearchParams({ ...(date ? { date } : {}), ...(status ? { status } : {}) })}`;
  const load = useLiveData(
    path,
    (data) => {
      setItems(data);
      setError("");
      lastError.current = "";
    },
    (e) => {
      setError(e.message);
      // Tự làm mới mỗi 20 giây: chỉ báo khi lỗi mới xuất hiện, không lặp lại.
      // Mất kết nối: thông báo chung của trang đã báo, không lặp ở từng bảng.
      if (lastError.current !== e.message && !isConnectivityError(e)) toast.error(e.message);
      lastError.current = e.message;
    },
    20000,
  );
  const filtered = items.filter((b) =>
    `${b.name} ${b.phone} ${b.code}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  async function update(b, body) {
    if (
      body.status === "cancelled" &&
      !confirm(
        "Hủy vé này? Nếu đã nhận tiền, hãy hoàn tiền riêng cho khách trước khi xác nhận.",
      )
    )
      return;
    setBusyId(b._id);
    setError("");
    try {
      await api(`/admin/bookings/${b._id}`, { method: "PATCH", body });
      await load();
      notify(
        body.status === "cancelled"
          ? `Đã hủy vé #${b.code}.`
          : `Đã cập nhật vé #${b.code}.`,
      );
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusyId("");
    }
  }
  function csv() {
    if (!filtered.length) return toast.info("Không có vé nào để xuất.");
    const rows = [
      [
        "Mã vé",
        "Tên",
        "Điện thoại",
        "Ngày",
        "Giờ",
        "Phòng",
        "Tờ in (đã gửi/được in)",
        ...(canSeeMoney ? ["Tổng tiền"] : []),
        "Trạng thái",
      ],
      ...filtered.map((b) => [
        b.code,
        b.name,
        b.phone,
        formatDate(b.date),
        b.time,
        b.roomName,
        `${b.printSheets || 0}/${b.prints ?? 1}`,
        ...(canSeeMoney ? [b.total] : []),
        labels[b.status],
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob(
        [
          "\ufeff" +
            rows
              .map((r) =>
                r
                  .map(
                    (c) =>
                      `"${String(c)
                        .replace(/^[=+@-]/, "'")
                        .replaceAll('"', '""')}"`,
                  )
                  .join(","),
              )
              .join("\r\n"),
        ],
        { type: "text/csv;charset=utf-8;" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "nxc-bookings.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(`Đã xuất ${filtered.length} vé ra file CSV.`);
  }
  return (
    <>
      <ErrorBox error={error} />
      <Guide
        id="bookings-flow"
        title="một lượt khách"
        steps={[
          "Thu tiền → bấm “Tạo mã chụp”, chọn gói, tích “đã nhận đủ tiền” → đọc mã 6 số cho khách.",
          "Khách vào phòng, nhập mã trên máy chụp và chụp bằng nút / remote của máy ảnh.",
          "Chụp xong máy chụp hiện mã QR: khách quét để lấy ảnh, ghép khung, gửi in.",
          "Khách quên quét QR: bấm “QR nhận ảnh” ở dòng vé để hiện lại. Muốn in thêm: “Bán thêm tờ in”.",
        ]}
      />
      <div className="admin-toolbar">
        <div className="search-box">
          <Search size={17} />
          <input
            aria-label="Tìm vé"
            placeholder="Tên, số điện thoại, mã vé…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="toolbar-filter toolbar-date">
          <input
            aria-label="Lọc ngày"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <CalendarDays size={17} aria-hidden="true" />
        </div>
        <div className="toolbar-filter toolbar-status">
          <SlidersHorizontal size={17} aria-hidden="true" />
          <select
            aria-label="Trạng thái"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Tất cả trạng thái</option>
            {Object.entries(labels).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <Button className="outline small" onClick={csv}>
          <Download size={15} /> CSV
        </Button>
        <Button
          className="outline small"
          onClick={async () => {
            if (await load()) toast.info("Đã làm mới danh sách vé.");
          }}
          aria-label="Làm mới danh sách"
          title="Làm mới danh sách"
        >
          <RefreshCw size={15} />
        </Button>
        <Button onClick={() => setCreating(true)}>
          <Plus size={15} /> Tạo mã chụp
        </Button>
      </div>
      <div className="table-wrap booking-table">
        <table>
          <thead>
            <tr>
              {[
                ["Mã vé / Khách", Ticket],
                ["Ngày cấp mã", CalendarDays],
                ["Gói & phòng", Package],
                ["Thanh toán", Wallet],
                ["Trạng thái", Activity],
                ["Thao tác", SlidersHorizontal],
              ].map(([label, Icon]) => (
                <TableHeading key={label} icon={Icon}>
                  {label}
                </TableHeading>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((b) => (
              <tr key={b._id}>
                <td data-label="Mã vé / Khách">
                  <strong>
                    #{b.code} · {b.name}
                  </strong>
                  <small>{b.phone}</small>
                </td>
                <td data-label="Ngày cấp mã">
                  {formatDate(b.date)}
                  <small>
                    {b.source === "counter" ? "Khách tại quầy" : b.time}
                  </small>
                </td>
                <td data-label="Gói & phòng">
                  {b.packageName}
                  <small>
                    {b.roomName ||
                      (b.status === "confirmed" ? "Chưa vào phòng" : "—")}{" "}
                    · In {b.printSheets || 0}/{b.prints ?? 1} tờ
                  </small>
                </td>
                <td data-label="Thanh toán">
                  {canSeeMoney && <strong>{money(b.total)}</strong>}
                  <small>
                    {b.paymentMethod === "cash" ? "Tiền mặt" : "Chuyển khoản"} ·{" "}
                    {b.paid ? "Đã nhận" : "Chưa nhận"}
                  </small>
                </td>
                <td data-label="Trạng thái">
                  <span className={`badge ${b.status}`}>
                    {labels[b.status]}
                  </span>
                </td>
                <td data-label="Thao tác">
                  <div className="table-actions">
                    {b.status === "completed" && !b.mediaDeleted && (
                      <button onClick={() => setAlbumQr(b)}>QR nhận ảnh</button>
                    )}
                    <Link to={`/album/${b.accessToken}`} target="_blank">
                      Mở album ↗
                    </Link>
                    {b.paid &&
                      ["confirmed", "checked_in", "completed"].includes(
                        b.status,
                      ) &&
                      !b.mediaDeleted && (
                        <button onClick={() => setSelling(b)}>
                          + Bán thêm tờ in
                        </button>
                      )}
                    {b.status === "confirmed" && (
                      <button
                        disabled={busyId === b._id}
                        onClick={() => update(b, { status: "cancelled" })}
                      >
                        Hủy vé
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <div className="empty-state">
            <CalendarDays />
            <h3>Chưa có vé phù hợp.</h3>
            <p>Mã vừa cấp sẽ tự xuất hiện tại đây.</p>
          </div>
        )}
      </div>
      <p className="muted">
        Hiển thị tối đa 500 vé gần nhất theo bộ lọc. Dữ liệu tự cập nhật mỗi 20
        giây.
      </p>
      {creating && (
        <CounterTicket
          onClose={() => setCreating(false)}
          onCreated={(t) => {
            load();
            notify(`Đã cấp mã #${t.code} cho ${t.name}.`);
          }}
        />
      )}
      {albumQr && (
        <div className="modal-backdrop" onClick={() => setAlbumQr(null)}>
          <section
            className="modal center"
            role="dialog"
            aria-modal="true"
            aria-label="QR nhận ảnh"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              aria-label="Đóng"
              className="modal-close icon-button"
              onClick={() => setAlbumQr(null)}
            >
              <X />
            </button>
            <h2>QR nhận ảnh · vé #{albumQr.code}</h2>
            <p>
              Cho khách quét mã này bằng camera điện thoại để mở lại album
              {albumQr.mediaExpiresAt &&
                ` (mỗi ảnh lưu 24 giờ kể từ lúc chụp — ảnh đầu tiên tự xóa lúc ${formatDateTime(albumQr.mediaExpiresAt)})`}
              .
            </p>
            <QRCodeSVG
              value={`${window.location.origin}/album/${albumQr.accessToken}`}
              size={240}
              marginSize={2}
            />
          </section>
        </div>
      )}
      {selling && (
        <ExtraPrints
          booking={selling}
          canEditPrice={canSeeMoney}
          onClose={() => setSelling(null)}
          onSold={(updated, sheets) => {
            setSelling(null);
            load();
            notify(
              `Đã cộng ${sheets} tờ in cho vé #${updated.code}. Khách bấm “Gửi in” lại trên điện thoại.`,
            );
          }}
        />
      )}
    </>
  );
}
