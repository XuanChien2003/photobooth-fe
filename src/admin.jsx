import { useState } from "react";
import { LogOut, KeyRound } from "lucide-react";
import { PrintAlerts, PrintQueue } from "./print-queue";
import { Brand, ErrorBox } from "./studio";
import { transition } from "./transitions";
import { nav, definitions, NAV_DESCRIPTIONS } from "./admin/config";
import { ResourceManager } from "./admin/resources";
import { BookingsManager } from "./admin/bookings";
import { Overview } from "./admin/overview";
import { KioskContent } from "./admin/kiosk-content";
import { useAdminSession } from "./admin/use-admin-session";
import { LoginPage, PasswordDialog } from "./admin/auth";
import { StorageMonitorProvider } from "./admin/storage-monitor";
import { StorageWarning } from "./admin/storage-warning";
import { ShiftPanel } from "./admin/shift-panel";

// Nhóm menu quản trị (thứ tự này cũng là số mục 01, 02… trên menu và đầu trang).
const NAV_GROUPS = [
  ["Vận hành", ["overview", "bookings", "print", "rooms", "reconciliation"]],
  ["Thiết lập", ["packages", "frames", "kiosk", "users"]],
];

export function Admin() {
  const [tab, setTab] = useState("overview");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [pendingPrints, setPendingPrints] = useState(0);
  const [printView, setPrintView] = useState("prints");
  const session = useAdminSession(setTab);
  const { user, checking, error, setError, setPassword, globalToast, logout } =
    session;
  if (checking)
    return <div className="page center">Đang kiểm tra phiên đăng nhập…</div>;
  if (!user) return <LoginPage session={session} />;
  const visibleNav =
    user.role === "admin"
      ? nav
      : nav.filter(([key]) =>
          ["overview", "bookings", "print", "rooms"].includes(key),
        );
  const currentTab = visibleNav.some(([key]) => key === tab) ? tab : "overview";
  const notify = (msg) => globalToast.success(msg);
  // Tiền (doanh thu, tổng tiền từng vé) chỉ quản trị viên xem; máy chủ cũng không gửi cho lễ tân.
  const canSeeMoney = user.role === "admin";
  const activeNav = nav.find(([key]) => key === currentTab);
  const HeaderIcon = activeNav?.[2];
  // Menu như mục lục tạp chí: đánh số 01, 02… theo đúng thứ tự hiển thị; đầu trang ghi “Mục 0X · Nhóm”.
  const sections = NAV_GROUPS.map(([group, keys]) => [
    group,
    visibleNav.filter(([key]) => keys.includes(key)),
  ]).filter(([, entries]) => entries.length);
  const order = sections.flatMap(([group, entries]) => entries.map(([key]) => [key, group]));
  const position = order.findIndex(([key]) => key === currentTab);
  const sectionNumber = (index) => String(index + 1).padStart(2, "0");
  return (
    <StorageMonitorProvider key={user._id || user.email}>
      <div className="admin-shell">
        <aside className={`admin-sidebar ${mobileMenu ? "mobile-open" : ""}`}>
          <Brand />
          <button
            className="admin-menu-toggle"
            onClick={() => setMobileMenu(!mobileMenu)}
            aria-expanded={mobileMenu}
            aria-controls="admin-navigation"
          >
            {mobileMenu ? "Đóng menu" : "Menu quản lý"}
          </button>
          <nav id="admin-navigation" aria-label="Quản lý studio">
            {sections.map(([group, entries]) => {
              return (
                <div className="admin-nav-group" key={group}>
                  <span className="admin-nav-label">{group}</span>
                  {entries.map(([key, label, Icon]) => (
                    <button
                      key={key}
                      className={currentTab === key ? "active" : ""}
                      aria-current={currentTab === key ? "page" : undefined}
                      onClick={() =>
                        transition(() => {
                          setTab(key);
                          setMobileMenu(false);
                          setError("");
                        })
                      }
                    >
                      <span className="admin-nav-number" aria-hidden="true">
                        {sectionNumber(order.findIndex(([k]) => k === key))}
                      </span>
                      <Icon size={18} />
                      <span className="admin-nav-text">{label}</span>
                      {key === "print" && pendingPrints > 0 && (
                        <span className="nav-count">{pendingPrints}</span>
                      )}
                    </button>
                  ))}
                </div>
              );
            })}
          </nav>
          <div className="sidebar-bottom">
            <button
              onClick={() => {
                setMobileMenu(false);
                setPassword({ current: "", password: "", confirm: "" });
              }}
            >
              <KeyRound size={16} /> Đổi mật khẩu
            </button>
            <button onClick={logout}>
              <LogOut size={16} /> Đăng xuất
            </button>
          </div>
        </aside>
        <div className="admin-main">
          <header className="admin-header">
            <div>
              {position >= 0 && (
                <span className="admin-eyebrow">
                  {order[position][1]}
                </span>
              )}
              <h2>
                {HeaderIcon && <HeaderIcon size={26} aria-hidden="true" />}
                {activeNav?.[1]}
              </h2>
              <p className="admin-page-description">
                {NAV_DESCRIPTIONS[currentTab]}
              </p>
            </div>
            <div className="admin-user">
              <span>
                {user.name}
                <small>
                  {user.role === "admin" ? "Quản trị viên" : "Lễ tân"}
                </small>
              </span>
              <div>{user.name.slice(0, 1)}</div>
            </div>
          </header>
          <div className="admin-content">
            <StorageWarning
              onOpenStorage={() =>
                transition(() => {
                  setTab("print");
                  setPrintView("storage");
                  setMobileMenu(false);
                  setError("");
                })
              }
            />
            <ErrorBox error={error} />
            <PrintAlerts onCount={setPendingPrints} />
            {currentTab === "overview" ? (
              <Overview notify={notify} canSeeMoney={canSeeMoney} assignedBranch={user.branch} />
            ) : currentTab === "print" ? (
              <PrintQueue
                pendingCount={pendingPrints}
                canManageStorage={user.role === "admin"}
                view={printView}
                onViewChange={setPrintView}
              />
            ) : currentTab === "kiosk" ? (
              <KioskContent notify={notify} />
            ) : currentTab === "bookings" ? (
              <BookingsManager notify={notify} canSeeMoney={canSeeMoney} assignedBranch={user.branch} />
            ) : currentTab === "reconciliation" ? (
              <ShiftPanel assignedBranch={user.branch} notify={notify} />
            ) : definitions[currentTab] ? (
              <ResourceManager
                key={currentTab}
                resource={currentTab}
                notify={notify}
                me={user}
              />
            ) : null}
          </div>
        </div>

        <PasswordDialog session={session} />
      </div>
    </StorageMonitorProvider>
  );
}
