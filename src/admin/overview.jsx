import { useEffect, useRef, useState } from "react";
import { CalendarDays, Plus, Printer, Wallet } from "lucide-react";
import { money, labels, localDate } from "../api";
import { isConnectivityError } from "../network.js";
import { useLiveData } from "../use-live-data";
import { Button, ErrorBox, useToast } from "../studio";
import { CounterTicket } from "../counter-ticket";
import { RevenueByDay } from "../revenue";
import { ShiftPanel } from "./shift-panel";

const clockOf = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function Overview({ notify, canSeeMoney, assignedBranch }) {
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [today, setToday] = useState([]);
  const [live, setLive] = useState(null);
  const [creating, setCreating] = useState(false);
  const [sales, setSales] = useState(0);
  const [error, setError] = useState("");
  const [, setTick] = useState(0);
  const lastError = useRef("");
  const onError = (e) => {
    setError(e.message);
    // Mất kết nối: thông báo chung của trang đã báo, không lặp ở từng bảng.
    if (lastError.current !== e.message && !isConnectivityError(e)) toast.error(e.message);
    lastError.current = e.message;
  };
  const onData = (set) => (data) => {
    set(data);
    setError("");
    lastError.current = "";
  };
  const reloadStats = useLiveData(
    "/admin/stats",
    onData(setStats),
    onError,
    30000,
  );
  const reloadToday = useLiveData(
    `/admin/bookings?date=${localDate()}`,
    onData(setToday),
    onError,
    20000,
  );
  // Phòng đang chụp / đang trống: làm mới 5 giây/lần, đồng hồ đếm lùi từng giây.
  useLiveData(
    "/admin/rooms/live",
    onData((d) => setLive({ ...d, offset: Date.now() - d.now })),
    onError,
    5000,
  );
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const rooms = live?.rooms || [];
  const freeRooms = rooms.filter((r) => r.status === "free").length;
  return (
    <>
      <ErrorBox error={error} />
      <div className="overview-date">
        <CalendarDays size={17} aria-hidden="true" />
        <time dateTime={localDate()}>
          {new Intl.DateTimeFormat("vi-VN", {
            weekday: "long",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            timeZone: "Asia/Ho_Chi_Minh",
          }).format(new Date())}
        </time>
      </div>
      <ShiftPanel assignedBranch={assignedBranch} notify={notify} refreshKey={sales} />
      <section className="panel room-board">
        <div className="room-board-head">
          <div>
            <h3>Phòng chụp lúc này</h3>
            <p className="room-board-summary">
              {live
                ? `${freeRooms}/${rooms.length} phòng đang trống`
                : "Đang tải trạng thái phòng…"}
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus size={15} /> Tạo mã chụp
          </Button>
        </div>
        <div className="room-board-grid">
          {rooms.map((r) => (
            <div key={r._id} className={`room-tile ${r.status}`}>
              <div className="room-tile-heading">
                <strong>{r.name}</strong>
                <span className="room-state">
                  {r.status === "shooting"
                    ? "Đang chụp"
                    : r.status === "starting"
                      ? "Đang vào phòng"
                      : "Đang trống"}
                </span>
              </div>
              {r.status === "shooting" ? (
                <>
                  <span className="room-clock">
                    {clockOf(new Date(r.endsAt) - (Date.now() - live.offset))}
                  </span>
                  <small>
                    Đang chụp · #{r.code} · {r.customer}
                    {!r.online && " · máy chụp mất tín hiệu"}
                  </small>
                </>
              ) : r.status === "starting" ? (
                <small>Khách đang vào phòng · #{r.code}</small>
              ) : (
                <small>Đang trống — mời khách tiếp theo</small>
              )}
            </div>
          ))}
          {live && !rooms.length && (
            <p className="muted">
              Chưa có phòng chụp. Thêm phòng trong mục Phòng & chi nhánh.
            </p>
          )}
        </div>
      </section>
      {stats && (
        <>
          <div className="stats-grid">
            {[
              canSeeMoney && [
                "Doanh thu (trong ngày)",
                money(stats.todayRevenue),
                Wallet,
                `Tính đến ${new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date())} hôm nay`,
              ],
              ["Mã chụp hôm nay", stats.today, CalendarDays],
              ["Lệnh in đang chờ", stats.printQueue ?? 0, Printer],
            ]
              .filter(Boolean)
              .map(([l, v, Icon, note]) => (
                <div className="stat-card" key={l}>
                  <span>
                    <Icon size={16} /> {l}
                  </span>
                  <strong>{v}</strong>
                  {note && <small>{note}</small>}
                </div>
              ))}
          </div>
          {canSeeMoney && <RevenueByDay onError={onError} />}
          <div className="dashboard-grid">
            <section className="panel">
              <h3>Mã vừa được cấp</h3>
              {today
                .filter((b) => b.status !== "cancelled")
                .slice(0, 8)
                .map((b) => (
                  <div className="today-booking" key={b._id}>
                    <strong>#{b.code}</strong>
                    <div>
                      {b.name}
                      <small>{b.roomName || "Chưa vào phòng"}</small>
                    </div>
                    <span className={`badge ${b.status}`}>
                      {labels[b.status]}
                    </span>
                  </div>
                ))}
              {!today.length && <p>Chưa có mã chụp hôm nay.</p>}
            </section>
            <section className="panel occupancy-panel">
              <h3>Số lượt chụp hôm nay</h3>
              {stats.occupancy?.map((r) => (
                <div className="occupancy-row" key={r.name}>
                  <div>
                    <strong>{r.name}</strong>
                    <small>{r.branch}</small>
                  </div>

                  <div className="occupancy-bar">
                    <i
                      style={{
                        width: `${(r.booked / Math.max(1, ...stats.occupancy.map((x) => x.booked))) * 100}%`,
                      }}
                    />
                  </div>
                  <span>{r.booked} lượt khách</span>
                </div>
              ))}
            </section>
          </div>
        </>
      )}
      {creating && (
        <CounterTicket
          assignedBranch={assignedBranch}
          onClose={() => setCreating(false)}
          onCreated={(t) => {
            reloadToday();
            reloadStats();
            setSales((n) => n + 1);
            notify(`Đã cấp mã #${t.code} cho ${t.name}.`);
          }}
        />
      )}
    </>
  );
}
