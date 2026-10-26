import { useEffect, useState } from "react";
import { PiFolderOpenDuotone } from "react-icons/pi";
import { ChevronDown, Maximize2, Settings2 } from "lucide-react";
import { Button } from "../studio";
import { Guide } from "../guide";
import { CAMERA_KEY, MIRROR_KEY } from "./constants.js";
import {
  cameraRank,
  CAMERA_USB_MESSAGE,
  isBuiltInCamera,
  isCameraUsbVideo,
  liveUsable,
  NO_HDMI_MESSAGE,
} from "./camera.js";
import { canPickFolder, isMac, PHOTO_FOLDER_EXAMPLE } from "./folder.js";
import { FolderCheck } from "./FolderCheck.jsx";
import { KioskDevices } from "./KioskDevices.jsx";
import { canonCameraState, watchCanonCamera } from "./canon-camera.js";

export function KioskSettings({
  folder,
  folderAccess,
  pickFolder,
  grantFolder,
  cameras,
  cameraId,
  setCameraId,
  mirror,
  setMirror,
  mirrorLocked = false,
  zoom,
  setZoom,
  roomInfo,
  toast,
}) {
  // Chưa có cách nào bấm máy ảnh: báo trước khi khách bắt đầu chụp tự động.
  const [shutterReady, setShutterReady] = useState(() => canonCameraState().connected);
  useEffect(() => watchCanonCamera((state) => setShutterReady(state.connected)), []);
  return (
    <details className="kiosk-settings">
      <summary>
        <span>
          <Settings2 size={18} aria-hidden="true" /> Cài đặt máy chụp (nhân
          viên)
        </span>
        {!shutterReady && (
          <em className="kiosk-settings-warn">Chưa kết nối máy ảnh</em>
        )}
        <ChevronDown
          size={18}
          className="kiosk-settings-chevron"
          aria-hidden="true"
        />
      </summary>
      <div className="kiosk-settings-body">
        <Guide
          id="kiosk-camera"
          dark
          title="kết nối Canon EOS R100"
          steps={[
            "Cắm cáp USB-C từ máy ảnh vào máy tính, cáp micro HDMI vào thẻ ghi hình (USB). Bật máy ảnh.",
            "Trên R100: ảnh JPEG Large/Fine hoặc RAW+JPEG, Single shooting, ngắt kết nối Wi-Fi; khuyến nghị firmware 1.3.0 cho EDSDK.",
            `Mở Canon Camera Agent trên Windows, kết nối R100; thư mục ảnh mặc định ${PHOTO_FOLDER_EXAMPLE}. Thoát EOS Utility và EOS Webcam Utility.`,
            "Bấm “Chọn thư mục ảnh” bên dưới, chọn đúng thư mục đó → “Cho phép mỗi lần truy cập”.",
            "Nhập mã Camera Agent ở mục Canon EOS R100 bên dưới, bấm Kết nối R100 và Bấm thử; xác nhận ảnh gốc và flash.",
            "“Hình trực tiếp từ máy ảnh”: để Tự động hoặc chọn thẻ ghi hình (USB Video), không chọn webcam máy tính.",
          ]}
          note="Muốn bật máy tính là tự mở máy chụp: Quản trị → Quản lý máy → Cài máy chụp → tải file cài."
        />
        <div className="kiosk-folder">
          <p>
            Thư mục ảnh: <b>{folder ? folder.name : "chưa chọn"}</b>
            {folder &&
              (folderAccess === "granted"
                ? " · đã cho phép đọc"
                : " · cần cho phép đọc lại")}
          </p>
          <div className="kiosk-folder-actions">
            <Button
              type="button"
              className="outline small"
              onClick={pickFolder}
              disabled={!canPickFolder}
            >
              <PiFolderOpenDuotone />{" "}
              {folder ? "Đổi thư mục" : "Chọn thư mục ảnh"}
            </Button>
            {folder && folderAccess !== "granted" && (
              <Button type="button" className="small" onClick={grantFolder}>
                Cho phép đọc thư mục
              </Button>
            )}
          </div>
          {folder && folderAccess === "granted" && (
            <FolderCheck key={folder.name} folder={folder} />
          )}
          <details className="kiosk-camera-note">
            <summary>
              <span>Chi tiết kết nối & lưu ảnh</span>
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <small>
              Chọn đúng thư mục Canon Camera Agent lưu ảnh —
              nên là thư mục riêng, vd. {PHOTO_FOLDER_EXAMPLE}
              {isMac ? " (dùng Chrome; Camera Agent hiện cần Windows x64)" : ""}.
              R100 dùng USB dữ liệu và Camera Agent; khuyến nghị firmware 1.3.0 hỗ trợ EDSDK, ngắt kết nối Wi-Fi.
              Hình trực tiếp dùng micro-HDMI + thẻ ghi hình; không dùng USB streaming đồng thời.
              Khách chọn “Bấm dây” (RS-60E3 hoặc dây tương thích cắm vào cổng remote R100)
              hoặc “Hẹn giờ” (máy ảnh tự chụp sau 3 giây).
            </small>
          </details>
        </div>
        <label>
          Hình trực tiếp từ máy ảnh
          <select
            aria-label="Hình trực tiếp từ máy ảnh"
            value={
              cameras.some((c) => c.deviceId === cameraId && !liveUsable(c))
                ? ""
                : cameraId
            }
            onChange={(e) => {
              setCameraId(e.target.value);
              localStorage.setItem(CAMERA_KEY, e.target.value);
              toast.success("Đã lưu camera cho phòng chụp này.");
            }}
          >
            <option value="">
              Tự động (ưu tiên thẻ ghi hình HDMI / máy ảnh)
            </option>
            {cameras.map((c, i) => (
              <option
                key={c.deviceId || i}
                value={c.deviceId}
                disabled={!liveUsable(c)}
              >
                {c.label || `Camera ${i + 1}`}
                {liveUsable(c)
                  ? ""
                  : isBuiltInCamera(c)
                    ? " — webcam máy tính, không dùng"
                    : " — không dùng (chiếm máy ảnh)"}
              </option>
            ))}
          </select>
        </label>
        {cameras.some(isCameraUsbVideo) && (
          <p className="kiosk-check-result is-warn kiosk-webcam-note">
            {CAMERA_USB_MESSAGE}
          </p>
        )}
        {cameras.some((c) => c.label) &&
          !cameras.some((c) => liveUsable(c) && cameraRank(c) < 9) && (
            <p className="kiosk-check-result is-warn kiosk-hdmi-note">
              {NO_HDMI_MESSAGE}
            </p>
          )}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={mirror}
            disabled={mirrorLocked}
            onChange={(e) => {
              setMirror(e.target.checked);
              localStorage.setItem(MIRROR_KEY, e.target.checked ? "1" : "0");
              toast.success(
                e.target.checked
                  ? "Đã lưu: ảnh chụp lật như gương (giống hình trên màn hình)."
                  : "Đã lưu: ảnh chụp giữ nguyên chiều như máy ảnh.",
              );
            }}
          />
          Lưu ảnh lật như gương (giống hình trên màn hình)
          {mirrorLocked && " — quản trị đã đặt ở mục Quản lý máy"}
        </label>
        <KioskDevices zoom={zoom} setZoom={setZoom} roomInfo={roomInfo} toast={toast} />
        <Button
          type="button"
          className="outline small"
          onClick={() =>
            document.fullscreenElement
              ? document.exitFullscreen()
              : document.documentElement
                  .requestFullscreen()
                  .catch(() =>
                    toast.warning("Trình duyệt không cho bật toàn màn hình."),
                  )
          }
        >
          <Maximize2 size={17} aria-hidden="true" />
          Bật / tắt toàn màn hình
        </Button>
      </div>
    </details>
  );
}
