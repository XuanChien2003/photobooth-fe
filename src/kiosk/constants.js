// Màn hình QR giữ trong 2 phút rồi tự chuyển sang khách tiếp theo.
export const QR_SECONDS = 120;
export const CAMERA_KEY = "photo-camera";
// Lật như gương: hình trực tiếp, ảnh chụp và video luôn cùng lật hoặc cùng không lật. Mặc định lật như
// gương (chủ tiệm chọn 7/11). Khoá mới: trước đây hình trực tiếp luôn lật còn ảnh lật theo cài đặt —
// máy nào đã tắt "lật" thì khách thấy ảnh ngược với lúc chụp; nay mọi máy về mặc định lật cả hai.
export const MIRROR_KEY = "kiosk-mirror-v2";
// Thử máy khi không có máy ảnh: dùng webcam máy tính làm hình trực tiếp và chụp bằng nút trên màn hình.
export const WEBCAM_KEY = "kiosk-webcam-test";
// Chế độ máy yếu (mini PC đời cũ, GPU Intel HD 5xx/6xx): hình trực tiếp vẽ bằng canvas. Nhớ trên máy này.
export const LOW_POWER_KEY = "kiosk-low-power";
// A camera change requires selecting the Fujifilm save directory, not reusing Canon's folder.
export const FOLDER_KEY = "camera-folder-fujifilm";
