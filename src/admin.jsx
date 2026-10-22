import { useState } from "react";
import { LogOut, KeyRound, ChevronDown } from "lucide-react";
import { PrintAlerts, PrintQueue } from "./print-queue";
import { Brand, ErrorBox } from "./studio";
import { transition } from "./transitions";
import { NAV_TREE, nav, definitions, NAV_DESCRIPTIONS, STAFF_PAGES, can } from "./admin/config";
import { ResourceManager } from "./admin/resources";
import { BookingsManager } from "./admin/bookings";
import { Overview } from "./admin/overview";
import { Statistics } from "./admin/statistics";
import { ScreensManager } from "./admin/screens";
import { ThemesManager } from "./admin/themes";
import { StickersManager } from "./admin/stickers";
import { FiltersManager } from "./admin/filters";
import { Reconciliation } from "./admin/reconciliation";
import { useAdminSession } from "./admin/use-admin-session";
import { LoginPage, PasswordDialog } from "./admin/auth";
import { StorageMonitorProvider } from "./admin/storage-monitor";
import { StorageWarning } from "./admin/storage-warning";

const pad = (n) => String(n).padStart(2, "0");

export function Admin() {
  const [tab, setTab] = useState("overview");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [pendingPrints, setPendingPrints] = useState(0);
  const [printView, setPrintView] = useState("prints");
  // Nhóm đang mở trên mục lục (nhóm chứa trang hiện tại luôn mở).
  const [expanded, setExpanded] = useState({});
  const session = useAdminSession(setTab);
  const { user, checking, error, setError, setPassword, globalToast, logout } =
    session;
  if (checking)
    return <div className="page center">Đang kiểm tra phiên đăng nhập…</div>;
  if (!user) return <LoginPage session={session} />;
  const isAdmin = user.role === "admin";
  const allowed = isAdmin ? nav.map(([key]) => key) : STAFF_PAGES(user);
  // Mục lục chỉ gồm trang tài khoản được mở; nhóm không còn trang con thì ẩn.
  const tree = NAV_TREE.map(([key, label, Icon, children]) =>
    children
      ? [key, label, Icon, children.filter(([child]) => allowed.includes(child))]
      : [key, label, Icon],
  ).filter(([key, , , children]) => (children ? children.length : allowed.includes(key)));
  const currentTab = allowed.includes(tab) ? tab : "overview";
  const notify = (msg) => globalToast.success(msg);
  // Tiền (doanh thu, tổng tiền từng vé) chỉ người có quyền xem doanh thu; máy chủ cũng kiểm tra.
  const canSeeMoney = can(user, "revenue:view");
  const activeNav = nav.find(([key]) => key === currentTab);
  const HeaderIcon = activeNav?.[2];
  // Số mục như mục lục: 01, 02… cho mục chính; 1.1, 1.2… cho trang con.
  const numbers = {};
  const parents = {};
  tree.forEach(([key, label, , children], index) => {
    numbers[key] = pad(index + 1);
    children?.forEach(([child], childIndex) => {
      numbers[child] = `${index + 1}.${childIndex + 1}`;
      parents[child] = [key, label];
    });
  });
  const open = (key) =>
    transition(() => {
      setTab(key);
      setMobileMenu(false);
      setError("");
    });
  const navButton = ([key, label, Icon], child = false) => (
    <button
      key={key}
      className={`${currentTab === key ? "active" : ""} ${child ? "admin-nav-child" : ""}`}
      aria-current={currentTab === key ? "page" : undefined}
      onClick={() => open(key)}
    >
      <span className="admin-nav-number" aria-hidden="true">
        {numbers[key]}
      </span>
      <Icon size={18} />
      <span className="admin-nav-text">{label}</span>
      {key === "print" && pendingPrints > 0 && (
        <span className="nav-count">{pendingPrints}</span>
      )}
    </button>
  );
  const parent = parents[currentTab];
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
            <div className="admin-nav-group admin-nav-tree">
              {tree.map(([key, label, Icon, children]) => {
                if (!children) return navButton([key, label, Icon]);
                const holdsCurrent = children.some(([child]) => child === currentTab);
                const isOpen = holdsCurrent || expanded[key];
                const pendingInside =
                  !isOpen && children.some(([child]) => child === "print") && pendingPrints > 0;
                return (
                  <div className={`admin-nav-branch ${holdsCurrent ? "holds-current" : ""}`} key={key}>
                    <button
                      className="admin-nav-parent"
                      aria-expanded={Boolean(isOpen)}
                      aria-controls={`admin-nav-${key}`}
                      onClick={() =>
                        holdsCurrent
                          ? setExpanded((v) => ({ ...v, [key]: !isOpen }))
                          : isOpen
                            ? setExpanded((v) => ({ ...v, [key]: false }))
                            : (setExpanded((v) => ({ ...v, [key]: true })), open(children[0][0]))
                      }
                    >
                      <span className="admin-nav-number" aria-hidden="true">
                        {numbers[key]}
                      </span>
                      <Icon size={18} />
                      <span className="admin-nav-text">{label}</span>
                      {pendingInside ? (
                        <span className="nav-count">{pendingPrints}</span>
                      ) : (
                        <ChevronDown size={16} className="admin-nav-chevron" aria-hidden="true" />
                      )}
                    </button>
                    {isOpen && (
                      <div className="admin-nav-children" id={`admin-nav-${key}`}>
                        {children.map((entry) => navButton(entry, true))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
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
              <span className="admin-eyebrow">
                Mục {numbers[currentTab]}
                {parent ? ` · ${parent[1]}` : ""}
              </span>
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
                <small>{isAdmin ? "Quản trị viên" : "Nhân viên"}</small>
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
              <Overview
                notify={notify}
                canSeeMoney={canSeeMoney}
                canOperateShift={can(user, "shift:operate")}
                assignedBranch={user.branch}
              />
            ) : currentTab === "statistics" ? (
              <Statistics assignedBranch={user.branch} />
            ) : currentTab === "print" ? (
              <PrintQueue
                pendingCount={pendingPrints}
                canManageStorage={isAdmin}
                view={printView}
                onViewChange={setPrintView}
              />
            ) : currentTab === "bookings" ? (
              <BookingsManager
                notify={notify}
                canSeeMoney={canSeeMoney}
                canExport={can(user, "orders:export")}
                canCancel={can(user, "orders:cancel")}
                canPrint={can(user, "print:operate")}
                assignedBranch={user.branch}
              />
            ) : currentTab === "screens" ? (
              <ScreensManager notify={notify} />
            ) : currentTab === "themes" ? (
              <ThemesManager notify={notify} onOpenFrames={() => open("frames")} />
            ) : currentTab === "stickers" ? (
              <StickersManager notify={notify} />
            ) : currentTab === "filters" ? (
              <FiltersManager notify={notify} />
            ) : currentTab === "reconciliation" ? (
              <Reconciliation
                assignedBranch={user.branch}
                notify={notify}
                canSeeMoney={canSeeMoney}
                canOperate={can(user, "shift:operate")}
              />
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
