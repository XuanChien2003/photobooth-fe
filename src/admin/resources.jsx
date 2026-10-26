import { useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  X,
  ExternalLink,
  DoorOpen,
  Package,
  Users,
  Info,
  Activity,
  SlidersHorizontal,
  Power,
  Download,
  LoaderCircle,
  Monitor,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api, money } from "../api";
import { Button, ErrorBox, useStudio, useToast } from "../studio";
import { useValidation } from "../validate";
import { RESOURCE_LABELS, RESOURCE_RULES, definitions, DEFAULT_STAFF_PERMISSIONS, PERMISSION_GROUPS, can } from "./config";
import { PriceEditor } from "../extra-prints";
import { TableHeading } from "./table-heading";
import { Guide } from "../guide";
import { download, macScript, windowsScript } from "./kiosk-autostart";
import { CatalogToolbar } from "./catalog-toolbar";
import { PackageCatalog } from "./package-catalog";
import { ResourceEditor } from "./resource-editor";

const searchable = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase();

const shortDate = (value) => value
  ? new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })
      .format(new Date(value))
  : "";

// Lần cuối máy chụp báo còn mở trong 3 phút: coi như đang Online.
const ONLINE_MS = 3 * 60 * 1000;
const FLIP_LABELS = { on: "Có lật ảnh", off: "Không lật ảnh", device: "Theo cài đặt trên máy" };
const PERMISSION_LABELS = Object.fromEntries(PERMISSION_GROUPS.flatMap(([, items]) => items));
const isOnline = (room) => Boolean(room.lastSeenAt) && Date.now() - new Date(room.lastSeenAt) < ONLINE_MS;

const RESOURCE_ICONS = {
  rooms: DoorOpen,
  packages: Package,
  users: Users,
};

export function ResourceManager({ resource, notify, me }) {
  const toast = useToast();
  const { settings = {}, reload: reloadCatalog } = useStudio();
  const form = useValidation();
  const kind = RESOURCE_LABELS[resource] || "mục";
  const [items, setItems] = useState([]);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [device, setDevice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  // Khung ảnh có trang riêng (admin/frames.jsx); đây là máy, gói chụp và tài khoản.
  const isCatalog = resource === "packages";
  const canManage = me?.role === "admin";
  const filtered = Boolean(query.trim()) || status !== "all";
  const visibleItems = items.filter(
    (item) =>
      searchable(
        [item.name, item.description].filter(Boolean).join(" "),
      ).includes(searchable(query.trim())) &&
      (status === "all" || Boolean(item.active) === (status === "active")),
  );
  const load = async () => {
    setLoading(true);
    try {
      setItems(await api(`/admin/${resource}`));
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setEdit(null);
    setError("");
    setDevice(null);
    setQuery("");
    setStatus("all");
    load();
  }, [resource]);
  const openEditor = (item) => {
    if (!canManage) return;
    setError("");
    form.setErrors({});
    setEdit(item);
  };
  const fields = definitions[resource];
  function newItem() {
    openEditor(
      Object.fromEntries([
        ...fields.map(([key, , type]) => [
          key,
          type === "number"
            ? key === "duration"
              ? 15
              : key === "shots"
                ? 12
                : key === "countdownSeconds"
                  ? 10
                  : key === "selectCount"
                    ? 4
              : 0
            : type === "color"
              ? key === "color"
                ? "#522e22"
                : "#ffffff"
              : type === "date"
                ? ""
                : type === "flip"
                  ? "device"
                  : type === "branches"
                    ? []
                    : type === "payment"
                      ? "counter"
                      : type === "checkbox"
                        ? false
                    : type === "permissions"
                      ? DEFAULT_STAFF_PERMISSIONS
                      : type === "role"
                  ? "staff"
                  : type === "printSize"
                    ? "full"
                    : "",
        ]),
        ["active", true],
      ]),
    );
  }
  async function save(e) {
    e.preventDefault();
    if (!canManage) return;
    setError("");
    if (!form.check(edit, RESOURCE_RULES[resource] || {})) return;
    setBusy(true);
    try {
      const body = { ...edit };
      if (!body.password) delete body.password;
      if (resource === "users" && body.role !== "staff") delete body.permissions;
      await api(`/admin/${resource}${edit._id ? `/${edit._id}` : ""}`, {
        method: edit._id ? "PUT" : "POST",
        body,
      });
      setEdit(null);
      await load();
      notify(
        edit._id
          ? `Đã cập nhật ${kind} “${edit.name}”.`
          : `Đã thêm ${kind} “${edit.name}”.`,
      );
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function deactivate(item) {
    if (!canManage) return;
    if (!confirm(`Ngừng sử dụng ${item.name || item.code}?`)) return;
    try {
      await api(`/admin/${resource}/${item._id}`, { method: "DELETE" });
      load();
      notify(`Đã ngừng sử dụng ${kind} “${item.name || item.code}”.`);
    } catch (e) {
      toast.error(e.message);
    }
  }
  async function setup(item) {
    try {
      const d = await api(`/admin/rooms/${item._id}/device`, {
        method: "POST",
      });
      setDevice({
        ...d,
        url: `${window.location.origin}/kiosk?device=${encodeURIComponent(d.token)}`,
      });
    } catch (e) {
      toast.error(e.message);
    }
  }
  return (
    <>
      <ErrorBox error={error} />
      {resource === "rooms" && (
        <Guide
          id="rooms-kiosk"
          title="cài máy chụp cho phòng"
          steps={[
            "Bấm “Cài máy chụp” ở dòng phòng → mở liên kết (hoặc quét QR) trên máy tính trong phòng bằng Chrome / Edge.",
            "Trên máy chụp: mở “Cài đặt máy chụp (nhân viên)”, làm theo hướng dẫn kết nối máy ảnh.",
            "Muốn bật máy tính là tự mở máy chụp: trong hộp “Cài máy chụp” tải “File cài cho Windows / Mac”, chạy 1 lần trên máy trong phòng.",
          ]}
          note="Liên kết máy chụp có hạn 1 năm, chỉ gửi cho nhân viên."
        />
      )}
      {isCatalog ? (
        <CatalogToolbar
          resource={resource}
          items={items}
          visibleCount={visibleItems.length}
          query={query}
          onQueryChange={setQuery}
          status={status}
          onStatusChange={setStatus}
          onCreate={newItem}
          loading={loading}
        />
      ) : (
        <div className="admin-toolbar">
          <p>
            {resource === "rooms"
              ? `${items.length} máy${canManage ? "" : " đang hoạt động"}`
              : `${items.length} mục trong danh sách`}
          </p>
          {canManage && (
            <Button onClick={newItem}>
              <Plus size={16} /> Thêm mới
            </Button>
          )}
        </div>
      )}
      {isCatalog && loading ? (
        <div className="catalog-loading" role="status">
          <LoaderCircle size={24} aria-hidden="true" />
          <span>Đang tải danh mục…</span>
        </div>
      ) : resource === "packages" ? (
        <>
        {canManage && (
          <section className="panel extra-price-panel">
            <div>
              <h3>Giá in thêm tờ ảnh</h3>
              <p className="muted">Khách mua thêm tờ in 10 × 15 cm tại quầy (Đơn hàng → In ảnh → Thêm lượt in).</p>
            </div>
            <PriceEditor price={settings.extraPrintPrice || 0} onSaved={() => reloadCatalog?.()} />
          </section>
        )}
        <PackageCatalog
          items={visibleItems}
          onEdit={(item) => openEditor({ ...item })}
          onDeactivate={deactivate}
          onCreate={newItem}
          filtered={filtered}
        />
        </>
      ) : (
        <div
          className={`table-wrap ${resource === "rooms" ? "room-table" : resource === "users" ? "staff-table" : ""}`}
        >
          <table>
            <thead>
              <tr>
                <TableHeading icon={RESOURCE_ICONS[resource] || Package}>
                  Tên / Mã
                </TableHeading>
                <TableHeading icon={Info}>Thông tin</TableHeading>
                <TableHeading icon={Activity}>Trạng thái</TableHeading>
                <TableHeading icon={SlidersHorizontal}>Thao tác</TableHeading>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item._id}>
                  <td
                    data-label={resource === "rooms" ? "Tên phòng" : "Họ tên"}
                  >
                    <strong>{item.name || item.code}</strong>
                  </td>
                  <td
                    data-label={
                      resource === "rooms" ? "Chi nhánh / địa chỉ" : "Tài khoản"
                    }
                  >
                    {resource === "packages" ? (
                      `${money(item.price)} · ${item.duration} phút · không giới hạn ảnh`
                    ) : resource === "users" ? (
                      <>
                        {item.email}
                        <small>
                          {item.role === "admin"
                            ? "Tài khoản chủ cửa hàng · toàn quyền"
                            : `Nhân viên${item.branch ? ` · ${item.branch}` : ""} · ${
                                (item.permissions ?? DEFAULT_STAFF_PERMISSIONS).length
                              } quyền`}
                        </small>
                        {item.role === "staff" && (
                          <small className="permission-summary">
                            {(item.permissions ?? DEFAULT_STAFF_PERMISSIONS)
                              .map((p) => PERMISSION_LABELS[p])
                              .filter(Boolean)
                              .join(" · ") || "Chỉ xem đơn và máy"}
                          </small>
                        )}
                      </>
                    ) : resource === "rooms" ? (
                      <>
                        {item.branch || "Chưa đặt chi nhánh"}
                        <small>
                          {[item.machineCode && `Mã ${item.machineCode}`, item.model,
                            item.importedAt && `Nhập ${shortDate(item.importedAt)}`,
                            item.expiresAt && `Hạn ${shortDate(item.expiresAt)}`]
                            .filter(Boolean)
                            .join(" · ") || "Chưa nhập thông tin máy"}
                        </small>
                        <small className="room-flip">
                          Chế độ lật ảnh: {FLIP_LABELS[item.flip || "device"]} ·{" "}
                          {item.payment === "cash" ? "Khách đút tiền tại máy" : "Khách mua mã ở quầy"}
                          {item.paymentTest ? " · đang bật chế độ thử" : ""}
                        </small>
                      </>
                    ) : (
                      item.caption || item.description
                    )}
                  </td>
                  <td data-label="Trạng thái">
                    <span
                      className={`badge ${item.active ? "confirmed" : "cancelled"}`}
                    >
                      {item.active ? "Đang hoạt động" : "Đã tắt"}
                    </span>
                    {resource === "rooms" && item.active && (
                      <small className={`machine-online ${isOnline(item) ? "is-online" : "is-offline"}`}>
                        <i aria-hidden="true" />
                        {isOnline(item)
                          ? "Online"
                          : item.lastSeenAt
                            ? `Offline · lần cuối ${new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(new Date(item.lastSeenAt))}`
                            : "Offline · chưa kết nối"}
                      </small>
                    )}
                  </td>
                  <td data-label="Thao tác">
                    {resource === "users" &&
                    (item._id === me?._id ||
                      item.email?.toLowerCase() ===
                        me?.email?.toLowerCase()) ? (
                      // Không tự sửa / tự ngừng tài khoản đang đăng nhập (máy chủ cũng chặn).
                      <span
                        className="self-account"
                        title="Đổi mật khẩu ở mục “Đổi mật khẩu”. Đổi tên / email nhờ quản trị viên khác."
                      >
                        Tài khoản của bạn
                      </span>
                    ) : (
                      <div className="inline-actions">
                        {canManage && (
                          <button
                            title="Chỉnh sửa"
                            aria-label={`Chỉnh sửa ${item.name || item.code}`}
                            className="icon-button"
                            onClick={() => openEditor({ ...item })}
                          >
                            <Pencil size={16} />
                          </button>
                        )}
                        {canManage && item.active && (
                            <button
                              title="Ngừng sử dụng"
                              aria-label={`Ngừng sử dụng ${item.name || item.code}`}
                              className="icon-button"
                              onClick={() => deactivate(item)}
                            >
                              <X size={16} />
                            </button>
                          )}
                        {resource === "rooms" && item.active && can(me, "rooms:setup") && (
                          <Button
                            className="outline small room-kiosk-button"
                            aria-label={`Cài máy chụp cho ${item.name}`}
                            onClick={() => setup(item)}
                          >
                            <Monitor size={16} aria-hidden="true" /> Cài máy chụp
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && (
            <div className="empty-state">
              {loading
                ? "Đang tải danh sách…"
                : !canManage && resource === "rooms"
                  ? "Chưa có phòng đang hoạt động. Liên hệ quản trị viên để thêm hoặc bật phòng."
                  : "Chưa có dữ liệu. Thêm mục đầu tiên của bạn."}
            </div>
          )}
        </div>
      )}
      {edit && canManage && (
        <ResourceEditor
          resource={resource}
          edit={edit}
          form={form}
          busy={busy}
          error={error}
          onChange={setEdit}
          onClose={() => setEdit(null)}
          onSubmit={save}
        />
      )}
      {device && (
        <div className="modal-backdrop">
          <section
            className="modal center"
            role="dialog"
            aria-modal="true"
            aria-label="Cài máy chụp"
          >
            <button
              aria-label="Đóng"
              className="modal-close icon-button"
              onClick={() => setDevice(null)}
            >
              <X />
            </button>
            <h2>Cài máy chụp: {device.name}</h2>
            <p>
              Mở liên kết này một lần trên máy tính trong phòng (hoặc quét QR),
              máy chụp sẽ tự nhớ. Liên kết có hiệu lực 1 năm; chỉ gửi cho nhân
              viên.
            </p>
            <QRCodeSVG value={device.url} size={220} />
            <a
              className="button full"
              href={device.url}
              target="_blank"
              rel="noreferrer"
            >
              Mở máy chụp <ExternalLink size={16} />
            </a>
            <Button
              className="outline full"
              onClick={() =>
                navigator.clipboard
                  .writeText(device.url)
                  .then(() => notify("Đã sao chép liên kết."))
                  .catch(() =>
                    toast.error(
                      "Không sao chép được. Hãy mở máy chụp và sao chép đường dẫn.",
                    ),
                  )
              }
            >
              Sao chép liên kết
            </Button>
            <div className="kiosk-autostart">
              <h3>
                <Power size={16} aria-hidden="true" /> Bật máy tính là tự mở máy chụp
              </h3>
              <p>
                Tải file cài về <b>máy tính trong phòng</b> rồi chạy một lần: từ
                đó mỗi lần bật máy Windows sẽ mở Canon Camera Agent đã cài và Chrome toàn
                màn hình đúng phòng này. Lần đầu nhớ cho phép camera và chọn thư
                mục ảnh trong “Cài đặt máy chụp”.
              </p>
              <div className="kiosk-autostart-actions">
                <Button
                  className="outline small"
                  onClick={() => {
                    download(
                      "cai-kiosk-NXC.bat",
                      windowsScript(device.url, device.name),
                    );
                    notify(
                      "Đã tải file cài cho Windows. Mở file trên máy trong phòng (nếu Windows hỏi: “Thêm thông tin” → “Vẫn chạy”).",
                    );
                  }}
                >
                  <Download size={15} /> File cài cho Windows
                </Button>
                <Button
                  className="outline small"
                  onClick={() => {
                    download(
                      "cai-kiosk-NXC.command",
                      macScript(device.url, device.name),
                    );
                    notify(
                      "Đã tải file cài cho Mac. Mở Terminal, gõ “bash ” rồi kéo file vào và bấm Enter.",
                    );
                  }}
                >
                  <Download size={15} /> File cài cho Mac
                </Button>
              </div>
              <small>
                Windows: bấm dấu tích ở góc trên bên phải để chọn Toàn màn hình
                (F11), Về cửa sổ hoặc Thu xuống taskbar. Khi đã thu nhỏ, bấm
                biểu tượng Chrome / Edge trên thanh tác vụ để mở lại. Đóng máy chụp:
                Alt+F4.
              </small>
              <p>
                <b>Mac:</b> mở Terminal, gõ <code>bash</code> rồi một dấu cách,
                kéo file cài vừa tải vào Terminal và bấm Enter. Để chuyển sang
                màn phụ, đưa chuột lên mép trên, bấm nút xanh để thoát toàn
                màn hình, kéo cửa sổ sang màn phụ rồi phóng to lại. Có thể
                dùng Fn+F hoặc Control+Command+F tùy phiên bản trình duyệt;
                xem phím tắt trong menu Xem. Đóng máy chụp: Cmd+Q.
              </p>
              <p>
                Máy đã cài bản cũ: đóng máy chụp bằng Alt+F4 (Windows) hoặc Cmd+Q
                (Mac), rồi tải và chạy lại file cài tương ứng một lần để cập
                nhật cách điều khiển cửa sổ.
              </p>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
