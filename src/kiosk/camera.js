import { isMac } from "./folder.js";

// Hình trực tiếp qua USB của máy ảnh Fujifilm (phần mềm FUJIFILM X Webcam): phần mềm này
// chiếm máy ảnh nên X Acquire không nhận được ảnh gốc — Fujifilm yêu cầu thoát X Acquire /
// Capture One khi dùng X Webcam. Ở chế độ ảnh gốc, hình trực tiếp phải lấy qua HDMI.
export const isFujiWebcam = (d) => /fujifilm|x-?s10/i.test(d?.label || "");
export const FUJI_WEBCAM_MESSAGE =
  "Ở chế độ ảnh gốc, máy chụp không dùng FUJIFILM X Webcam làm hình trực tiếp: X Webcam chiếm máy ảnh nên X Acquire không nhận được ảnh. Thoát hẳn FUJIFILM X Webcam; muốn có hình trực tiếp thì cắm cáp micro HDMI từ máy ảnh vào thẻ ghi hình (HDMI capture) rồi chọn thẻ đó ở “Camera live view”.";
export const CAMERA_ERROR =
  "Không mở được camera. Kiểm tra cáp USB của máy ảnh và cấp quyền camera cho trình duyệt.";
const isVirtual = (d) => /obs|virtual/i.test(d.label);
// Webcam có sẵn của máy tính (MacBook "Camera FaceTime HD", laptop "USB2.0 FHD UVC WebCam"…):
// ở chế độ ảnh gốc không dùng làm hình trực tiếp — khách sẽ thấy sai góc máy.
// Windows: "Integrated Camera", "HD Webcam", "HP TrueVision", Surface "Camera Front/Rear";
// macOS: "FaceTime HD", iPhone làm webcam (Continuity Camera, Desk View).
export const isBuiltInCamera = (d) =>
  !isFujiWebcam(d) &&
  /webcam|integrated|built-?in|facetime|truevision|isight|camera (front|rear)|(front|rear) camera|iphone|ipad|continuity|desk view/i.test(
    d?.label || "",
  );
export const NO_HDMI_MESSAGE =
  "Chưa có hình trực tiếp từ máy ảnh: không thấy thẻ ghi hình HDMI (vd. “USB Video”). Ở chế độ ảnh gốc, máy chụp không dùng webcam của máy tính. Kiểm tra cáp micro HDMI từ máy ảnh và thẻ ghi hình cắm vào máy tính — cắm vào là hình tự hiện. Ảnh chụp vẫn nhận bình thường.";
export const hdmiFailed = (label, e) =>
  `Không mở được thẻ ghi hình “${label}” (${e?.name || "lỗi"}). Rút ra cắm lại thẻ ghi hình, tắt app khác đang dùng nó (Zoom, OBS, ${isMac ? "QuickTime, Photo Booth" : "app Camera, Teams"}, tab trình duyệt khác) rồi bấm “Mở lại camera”. Ảnh chụp vẫn nhận bình thường.`;
// Thứ tự tự chọn hình trực tiếp: thẻ ghi hình HDMI của máy ảnh → FUJIFILM X Webcam → camera
// khác → webcam có sẵn của máy tính → không dùng OBS / ảo.
export const cameraRank = (d) =>
  isVirtual(d)
    ? 9
    : /capture|hdmi|cam ?link|elgato|avermedia|live gamer|ugreen|macrosilicon|usb video/i.test(
          d.label,
        )
      ? 0
      : isFujiWebcam(d)
        ? 1
        : isBuiltInCamera(d)
          ? 3
          : 2;
// Camera dùng được làm hình trực tiếp: chỉ thẻ ghi hình HDMI / camera ngoài của máy ảnh.
export const liveUsable = (d) => !isFujiWebcam(d) && !isBuiltInCamera(d);
export const videoConstraints = (deviceId) => ({
  video: {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
  audio: false,
});
