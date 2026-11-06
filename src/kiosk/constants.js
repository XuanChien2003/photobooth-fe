// Màn hình QR giữ trong 2 phút rồi tự chuyển sang khách tiếp theo.
export const QR_SECONDS = 120;
export const CAMERA_KEY = "photo-camera";
export const MIRROR_KEY = "photo-mirror";
// Thử máy khi không có máy ảnh: dùng webcam máy tính làm hình trực tiếp và chụp bằng nút trên màn hình.
export const WEBCAM_KEY = "kiosk-webcam-test";
// Chế độ máy yếu (mini PC đời cũ, GPU Intel HD 5xx/6xx): hình trực tiếp vẽ bằng canvas. Nhớ trên máy này.
export const LOW_POWER_KEY = "kiosk-low-power";
// A camera change requires selecting the Fujifilm save directory, not reusing Canon's folder.
export const FOLDER_KEY = "camera-folder-fujifilm";
