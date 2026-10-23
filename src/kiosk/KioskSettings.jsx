import { PiFolderOpenDuotone } from "react-icons/pi";
import { ChevronDown, Maximize2, Settings2 } from "lucide-react";
import { Button } from "../studio";
import { Guide } from "../guide";
import { CAMERA_KEY, MIRROR_KEY } from "./constants.js";
import {
  cameraRank,
  FUJI_WEBCAM_MESSAGE,
  isBuiltInCamera,
  isFujiWebcam,
  liveUsable,
  NO_HDMI_MESSAGE,
} from "./camera.js";
import { canPickFolder, isMac, PHOTO_FOLDER_EXAMPLE } from "./folder.js";
import { FolderCheck } from "./FolderCheck.jsx";
import { KioskDevices } from "./KioskDevices.jsx";

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
  return (
    <details className="kiosk-settings">
      <summary>
        <span>
          <Settings2 size={18} aria-hidden="true" /> Cài đặt máy chụp (nhân
          viên)
        </span>
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
          title="kết nối máy ảnh X-S10"
          steps={[
            "Cắm cáp USB-C từ máy ảnh vào máy tính, cáp micro HDMI vào thẻ ghi hình (USB). Bật máy ảnh.",
            "Trên máy ảnh: SET UP → CONNECTION SETTING → CONNECTION MODE → USB TETHER SHOOTING AUTO; chất lượng ảnh FINE hoặc FINE+RAW.",
            `Mở FUJIFILM X Acquire, chọn thư mục lưu ảnh (vd. ${PHOTO_FOLDER_EXAMPLE}).`,
            "Bấm “Chọn thư mục ảnh” bên dưới, chọn đúng thư mục đó → “Cho phép mỗi lần truy cập”.",
            "Bấm “Thử nhận ảnh từ máy ảnh” rồi chụp 1 tấm: hiện “Đã nhận DSCF….JPG” là xong.",
            "“Hình trực tiếp từ máy ảnh”: để Tự động hoặc chọn thẻ ghi hình (USB Video), không chọn webcam máy tính.",
          ]}
          note="Muốn bật máy tính là tự mở máy chụp: Quản trị → Phòng & chi nhánh → Cài máy chụp → tải file cài."
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
              Chọn đúng thư mục FUJIFILM X Acquire (hoặc Capture One) lưu ảnh —
              nên là thư mục riêng, vd. {PHOTO_FOLDER_EXAMPLE}
              {isMac ? " (dùng Chrome, không dùng Safari)" : ""}. Máy ảnh
              (firmware 2.00 trở lên) để CONNECTION SETTING → CONNECTION MODE =
              USB TETHER SHOOTING AUTO, chất lượng ảnh FINE hoặc FINE+RAW (cần
              có JPEG). Hình trực tiếp lấy qua cáp HDMI + thẻ ghi hình, không
              dùng FUJIFILM X Webcam. Khách chọn “Bấm dây” (tự bấm dây bấm của máy
              ảnh) hoặc “Đếm giờ” (máy chụp tự chụp — xem mục “Tự chụp” bên dưới).
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
        {cameras.some(isFujiWebcam) && (
          <p className="kiosk-check-result is-warn kiosk-webcam-note">
            {FUJI_WEBCAM_MESSAGE}
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
