import { useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { api, money } from "./api";
import { Button, ErrorBox, useStudio, useToast } from "./studio";
import {
  FieldError,
  chosen,
  custom,
  maxLength,
  phoneVN,
  useValidation,
} from "./validate";

const RULES = {
  package: ["Gói chụp", chosen],
  name: ["Tên khách", maxLength(100)],
  phone: ["Số điện thoại khách", phoneVN],
  received: [
    "Xác nhận",
    custom((v) => v === true, "Vui lòng xác nhận đã nhận đủ tiền của khách."),
  ],
};

// Trạng thái phòng lúc cấp mã, để gợi ý khách vào phòng đang trống.
const roomStatus = (r, offset = 0) =>
  r.status === "shooting"
    ? `đang chụp, còn ${Math.max(1, Math.ceil((new Date(r.endsAt) - (Date.now() - offset)) / 60000))} phút`
    : r.status === "starting"
      ? "khách đang vào phòng"
      : "đang trống";

export function CounterTicket({ onClose, onCreated }) {
  const { packages = [], rooms = [], settings = {} } = useStudio();
  const [live, setLive] = useState(null);
  useEffect(() => {
    api("/admin/rooms/live").then(
      (data) => setLive({ ...data, offset: Date.now() - data.now }),
      () => {},
    );
  }, []);
  const [form, setForm] = useState({
    package: packages[0]?._id || "",
    room: "",
    name: "",
    phone: "",
    paymentMethod: "cash",
  });
  const [ticket, setTicket] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [quote, setQuote] = useState(null);
  const [received, setReceived] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const toast = useToast();
  const v = useValidation();
  const quoteKey = form.package;
  useEffect(() => {
    if (!form.package) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api("/admin/tickets/quote", {
        method: "POST",
        body: { package: form.package },
        signal: controller.signal,
      })
        .then((result) => {
          if (!controller.signal.aborted)
            setQuote({ ...result, key: quoteKey });
        })
        .catch((e) => {
          if (!controller.signal.aborted)
            setQuote({ error: e.message, key: quoteKey });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [form.package, quoteKey]);
  const request = useRef(null);
  const lock = useRef(false);
  const pack = packages.find((p) => p._id === form.package);
  const change = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    v.clear(key);
  };
  async function create(e) {
    e.preventDefault();
    if (lock.current) return;
    if (!v.check({ ...form, received }, RULES)) return;
    if (quote?.key !== quoteKey || quote.error)
      return toast.warning(
        quote?.error || "Đang tính tiền, vui lòng đợi một chút.",
      );
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const fingerprint = JSON.stringify(form);
      if (request.current?.fingerprint !== fingerprint)
        request.current = { fingerprint, key: crypto.randomUUID() };
      const result = await api("/admin/tickets", {
        method: "POST",
        body: {
          ...form,
          paymentReceived: true,
          expectedTotal: quote.total,
          requestKey: request.current.key,
        },
      });
      setTicket(result);
      onCreated(result);
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal counter-ticket"
        role="dialog"
        aria-modal="true"
        aria-labelledby="counter-title"
      >
        <div className="modal-header">
          <h2 id="counter-title">
            {ticket ? "Mã chụp đã sẵn sàng" : "Tạo mã chụp cho khách"}
          </h2>
          <button
            className="icon-button"
            aria-label="Đóng"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <ErrorBox error={error} />
        {ticket ? (
          <div className="counter-receipt">
            <span className="badge confirmed">
              <Check size={14} /> Đã nhận {money(ticket.total)}
            </span>
            <p>
              Mời khách vào{" "}
              {ticket.roomName ? (
                <strong>{ticket.roomName}</strong>
              ) : (
                "phòng chụp đang trống"
              )}{" "}
              và nhập mã này trên màn hình máy chụp.
            </p>
            <div className="ticket-code" aria-label="Mã chụp của khách">
              {ticket.code}
            </div>
            <p>
              {ticket.packageName} · {ticket.prints} tờ in 10 × 15 cm
            </p>
            <p className="soft-note">
              Mã dùng trong ngày, ở phòng nào cũng được. Chụp xong, máy chụp
              hiện mã QR để khách quét nhận ảnh trên điện thoại.
            </p>
            <Button
              className="outline full"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(ticket.code);
                  setCopied(true);
                  toast.success(`Đã sao chép mã ${ticket.code}.`);
                } catch {
                  toast.warning(
                    "Không sao chép được. Bạn có thể đọc hoặc ghi lại mã 6 số phía trên.",
                  );
                }
              }}
            >
              <Copy size={16} />
              {copied ? "Đã sao chép mã" : "Sao chép mã"}
            </Button>
            <Button className="full" onClick={onClose}>
              Xong
            </Button>
          </div>
        ) : (
          <form className="transaction-form" onSubmit={create} noValidate>
            <div className="transaction-fields">
              <p>
                Chọn gói, nhận tiền rồi cấp mã. Mã dùng được ở mọi phòng chụp
                trong ngày.
              </p>
              <label>
                Gói chụp
                <select
                  name="package"
                  autoFocus
                  aria-invalid={Boolean(v.errors.package)}
                  value={form.package}
                  onChange={(e) => change("package", e.target.value)}
                >
                  <option value="">Chọn gói</option>
                  {packages.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.name} — {money(p.price)}
                    </option>
                  ))}
                </select>
                <FieldError error={v.errors.package} />
              </label>
              {pack && (
                <p className="muted">
                  {pack.duration} phút · không giới hạn ảnh · {pack.prints} tờ
                  in 10 × 15 cm
                </p>
              )}
              <label>
                Phòng gợi ý cho khách (không bắt buộc)
                <select
                  name="room"
                  value={form.room}
                  onChange={(e) => change("room", e.target.value)}
                >
                  <option value="">Phòng trống bất kỳ</option>
                  {(live?.rooms || rooms).map((r) => (
                    <option key={r._id} value={r._id}>
                      {r.name}
                      {r.status ? ` — ${roomStatus(r, live.offset)}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Thanh toán
                <select
                  name="paymentMethod"
                  value={form.paymentMethod}
                  onChange={(e) => change("paymentMethod", e.target.value)}
                >
                  <option value="cash">Tiền mặt</option>
                  <option value="transfer">Chuyển khoản</option>
                </select>
              </label>
              {form.paymentMethod === "transfer" && (
                <div className="soft-note">
                  {settings.bankAccount && (
                    <p>
                      {settings.bank} · {settings.bankAccount}
                      <br />
                      {settings.bankOwner}
                    </p>
                  )}
                  {settings.bankQrImage && (
                    <div className="bank-qr-wrap">
                      <img
                        src={settings.bankQrImage}
                        alt="Mã QR chuyển khoản"
                        className="bank-qr-img"
                      />
                    </div>
                  )}
                  <small>
                    Kiểm tra tiền đã vào tài khoản trước khi cấp mã chụp.
                  </small>
                </div>
              )}
              <details
                className="counter-optional"
                open={moreOpen || Boolean(v.errors.name || v.errors.phone)}
                onToggle={(e) => setMoreOpen(e.currentTarget.open)}
              >
                <summary>Thông tin khách (không bắt buộc)</summary>
                <label>
                  Tên khách
                  <input
                    name="name"
                    aria-invalid={Boolean(v.errors.name)}
                    value={form.name}
                    onChange={(e) => change("name", e.target.value)}
                  />
                  <FieldError error={v.errors.name} />
                </label>
                <label>
                  Số điện thoại khách
                  <input
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    placeholder="VD: 0912345678"
                    aria-invalid={Boolean(v.errors.phone)}
                    value={form.phone}
                    onChange={(e) =>
                      change(
                        "phone",
                        e.target.value.replace(/[^\d]/g, "").slice(0, 10),
                      )
                    }
                  />
                  <FieldError error={v.errors.phone} />
                </label>
                <p className="muted">
                  Có số điện thoại sẽ tra cứu lại album được. Nếu để trống,
                  khách giữ đường dẫn hoặc QR album.
                </p>
              </details>
            </div>
            <div className="transaction-confirmation">
              <div className="summary-total">
                <span>Tiền cần thu</span>
                <strong>
                  {quote?.key === quoteKey && !quote.error
                    ? money(quote.total)
                    : "…"}
                </strong>
              </div>
              {quote?.key === quoteKey && <ErrorBox error={quote.error} />}
              <label className="checkbox">
                <input
                  name="received"
                  type="checkbox"
                  aria-invalid={Boolean(v.errors.received)}
                  checked={received}
                  onChange={(e) => {
                    setReceived(e.target.checked);
                    v.clear("received");
                  }}
                />
                <span>Tôi đã nhận đủ tiền mặt hoặc kiểm tra chuyển khoản.</span>
              </label>
              <FieldError error={v.errors.received} />
              <Button className="full" disabled={busy}>
                {busy ? "Đang tạo mã…" : "Xác nhận thanh toán & tạo mã"}
              </Button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
