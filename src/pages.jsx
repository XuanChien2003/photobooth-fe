import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  PiArrowsClockwiseBold as RefreshCw,
  PiClockBold,
  PiTicketBold,
} from "react-icons/pi";
import { QRCodeSVG } from "qrcode.react";
import { Button, ErrorBox, useToast } from "./studio";
import { labels, formatDate, formatDateTime } from "./api";
import { useLiveData } from "./use-live-data";
import { isConnectivityError } from "./network.js";
import { AlbumStudio } from "./album-studio";
import { AlbumViewer } from "./album/AlbumViewer.jsx";

// Trang khách mở bằng mã QR trên máy chụp: chọn, chỉnh, ghép khung, tải và gửi in ảnh.
export function AlbumPage() {
  const { token } = useParams();
  return <AlbumSession key={token} token={token} />;
}

function AlbumSession({ token }) {
  const toast = useToast();
  const [booking, updateBooking] = useState(null);
  const revision = useRef(0);
  const mutation = useRef(false);
  const [mutating, setMutating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const setBooking = useCallback((next) => {
    revision.current++;
    updateBooking(next);
  }, []);
  const onMutationChange = useCallback((busy) => {
    mutation.current = busy;
    revision.current++;
    setMutating(busy);
  }, []);
  const [error, setError] = useState("");
  // The free server sleeps when nobody used it for a while and needs about a minute to wake.
  // Until the album first loads, a slow or unanswered request is that wait, not a failure:
  // say so calmly (the page keeps retrying by itself) instead of showing a connection error.
  const [waking, setWaking] = useState(false);
  const loaded = Boolean(booking);
  useEffect(() => {
    if (loaded) return;
    const timer = setTimeout(() => setWaking(true), 6000);
    return () => clearTimeout(timer);
  }, [loaded]);
  const lastStatus = useRef("");
  const lastError = useRef("");
  const reload = useLiveData(
    `/albums/${token}`,
    (b) => {
      // Khách đang xem vé thì buổi chụp kết thúc: báo ảnh đã sẵn sàng.
      if (
        lastStatus.current &&
        lastStatus.current !== "completed" &&
        b.status === "completed"
      )
        toast.success("Ảnh của bạn đã sẵn sàng! Chạm ♥ để chọn ảnh đẹp nhất.");
      lastStatus.current = b.status;
      lastError.current = "";
      setBooking(b);
      setError("");
    },
    (e) => {
      if (!booking && isConnectivityError(e)) {
        setWaking(true);
        return;
      }
      setError(e.message);
      // Before the album shows, the error box is the page itself; a toast would repeat it.
      if (booking && lastError.current !== e.message) toast.error(e.message);
      lastError.current = e.message;
    },
    10000,
    (b) => b.status === "cancelled" || b.mediaDeleted,
    { canRefresh: () => !mutation.current, version: () => revision.current },
  );
  const ready = booking?.status === "completed" && !booking.mediaDeleted;
  const expires = formatDateTime(booking?.mediaExpiresAt);
  return (
    <section className={`page ${ready ? "studio-page" : "narrow"}`}>
      <ErrorBox error={error} />
      {!booking && !error && (
        <div className="center" role="status">
          <p>Đang mở album…</p>
          {waking && (
            <p className="soft-note">
              Máy chủ vừa nghỉ nên lần mở đầu có thể mất khoảng 1 phút. Trang sẽ tự mở,
              bạn không cần tải lại.
            </p>
          )}
        </div>
      )}
      {ready && (
        <>
          <AlbumViewer token={token} booking={booking} />
          <div className="studio-meta">
            <div className="studio-meta-heading">
              <span className="studio-album-ticket">
                <PiTicketBold aria-hidden="true" /> Vé
                <strong>#{booking.code}</strong>
              </span>
              <span className="studio-album-retention">
                <PiClockBold aria-hidden="true" /> Lưu miễn phí 24 giờ
              </span>
              <Button
                className="outline small studio-album-refresh"
                disabled={mutating || refreshing}
                aria-busy={refreshing}
                onClick={async () => {
                  setRefreshing(true);
                  await reload();
                  setRefreshing(false);
                }}
              >
                <RefreshCw aria-hidden="true" />{" "}
                {refreshing ? "Đang làm mới…" : "Làm mới ảnh"}
              </Button>
            </div>
            <p>Mỗi ảnh lưu 24 giờ kể từ lúc chụp. Tải về máy để giữ lâu hơn.</p>
            {expires && (
              <small>
                Ảnh sắp xóa gần nhất: <strong>{expires}</strong>
              </small>
            )}
          </div>
          <AlbumStudio
            booking={booking}
            setBooking={setBooking}
            reloadBooking={reload}
            onMutationChange={onMutationChange}
            token={token}
          />
        </>
      )}
      {booking && !ready && (
        <div className="ticket-card">
          <div className="ticket-top">
            <span className={`badge ${booking.status}`}>
              {labels[booking.status]}
            </span>
            <p className="eyebrow">MÃ VÉ CỦA BẠN</p>
            <div className="ticket-code" aria-label={`Mã vé ${booking.code}`}>
              {booking.code}
            </div>
            <dl className="ticket-meta">
              <div>
                <dt>Gói chụp</dt>
                <dd>{booking.packageName}</dd>
              </div>
              <div>
                <dt>Phòng</dt>
                <dd>{booking.roomName || "Phòng trống bất kỳ"}</dd>
              </div>
              <div>
                <dt>Ngày</dt>
                <dd>{formatDate(booking.date)}</dd>
              </div>
            </dl>
          </div>
          <div className="ticket-tear" aria-hidden="true" />
          <div className="ticket-bottom">
            <QRCodeSVG value={window.location.href} size={116} />
            <div>
              <p>
                {booking.mediaDeleted
                  ? "Ảnh đã hết hạn lưu trữ (mỗi ảnh lưu 24 giờ kể từ lúc chụp)."
                  : booking.status === "cancelled"
                    ? "Vé đã được hủy. Vui lòng liên hệ lễ tân nếu cần hỗ trợ."
                    : `Vào phòng chụp và nhập mã này trên máy. Ảnh sẽ hiện tại đây ngay khi bạn chụp xong. Vé gồm ${booking.prints ?? 1} tờ in 10 × 15 cm.`}
              </p>
              {!["completed", "cancelled"].includes(booking.status) && (
                <Button
                  className="outline small"
                  onClick={async () => {
                    if (await reload())
                      toast.info("Đã cập nhật trạng thái vé.");
                  }}
                >
                  <RefreshCw size={14} /> Cập nhật
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
