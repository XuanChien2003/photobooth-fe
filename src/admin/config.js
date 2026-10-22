import {
  LayoutDashboard,
  Users,
  DoorOpen,
  Package,
  Image,
  Ticket,
  Printer,
  Sparkles,
  Scale,
} from "lucide-react";
import {
  custom,
  email as isEmail,
  intRange,
  maxLength,
  minLength,
  required,
} from "../validate";

// Tên hiển thị & luật kiểm tra cho từng loại dữ liệu quản trị.
export const RESOURCE_LABELS = {
  rooms: "phòng",
  packages: "gói chụp",
  frames: "khung",
  users: "nhân viên",
};

// Giá tiền: 0 (miễn phí) hoặc từ 1.000 đ trở lên — chặn gõ thiếu số 0 (vd. 20 thay vì 20.000).
export const priceVND = custom(
  (v) => String(v ?? "").trim() === "" || Number(v) === 0 || Number(v) >= 1000,
  "Giá tối thiểu 1.000 đ (để 0 nếu miễn phí) — kiểm tra có gõ thiếu số 0 không.",
);

export const RESOURCE_RULES = {
  rooms: {
    name: ["Tên phòng", required, maxLength(100)],
    branch: ["Chi nhánh / địa chỉ", required, maxLength(200)],
    description: ["Mô tả", maxLength(1000)],
    machineCode: ["Mã máy", maxLength(100)],
    model: ["Dòng máy", maxLength(100)],
  },
  packages: {
    name: ["Tên gói", required, maxLength(200)],
    description: ["Mô tả", maxLength(1000)],
    price: ["Giá", required, intRange(0, 100000000), priceVND],
    duration: ["Thời gian chụp", required, intRange(1, 30)],
    shots: ["Số ảnh được chụp", required, intRange(1, 40)],
    countdownSeconds: ["Đếm ngược mỗi ảnh", required, intRange(1, 30)],
    prints: ["Số tờ in", required, intRange(0, 20)],
  },
  frames: {
    name: ["Tên khung", required, maxLength(200)],
    themeName: ["Tên bộ chủ đề", maxLength(100)],
    order: ["Thứ tự trong bộ", intRange(0, 999)],
    image: [
      "Ảnh khung",
      custom(
        (v, all) => Boolean(v) && all.slots?.length > 0,
        "Vui lòng import ảnh khung có ít nhất 1 ô đặt ảnh.",
      ),
    ],
  },
  users: {
    name: ["Tên nhân viên", required, maxLength(200)],
    email: ["Email", required, isEmail],
    branch: ["Chi nhánh", maxLength(200)],
    password: [
      "Mật khẩu",
      custom(
        (v, all) => Boolean(all._id) || Boolean(v),
        "Vui lòng đặt mật khẩu cho tài khoản mới.",
      ),
      minLength(10),
      maxLength(128),
    ],
  },
};

export const nav = [
  ["overview", "Tổng quan", LayoutDashboard],
  ["bookings", "Đơn hàng", Ticket],
  ["print", "Hàng chờ in", Printer],
  ["rooms", "Quản lý máy", DoorOpen],
  ["packages", "Bảng giá", Package],
  ["frames", "Khung ảnh", Image],
  ["kiosk", "Nội dung máy chụp", Sparkles],
  ["users", "Nhân viên", Users],
  ["reconciliation", "Đối soát", Scale],
];

export const NAV_DESCRIPTIONS = {
  overview: "Theo dõi hoạt động hôm nay và tạo mã chụp nhanh cho khách.",
  bookings: "Tìm đơn, gửi link ảnh, tải xuống hoặc in lại chỉ trong một màn hình.",
  print: "Kiểm tra file đang chờ và trạng thái in tại từng chi nhánh.",
  rooms: "Quản lý thông tin máy, chi nhánh và liên kết cài đặt kiosk.",
  packages: "Thiết lập giá, thời gian chụp, số ảnh và số tờ in đi kèm.",
  frames: "Thêm khung, chia theo chủ đề và sắp xếp thứ tự khách sẽ thấy.",
  kiosk: "Cấu hình màn hình chờ, bộ lọc ảnh và thư viện nhãn dán.",
  users: "Quản lý tài khoản và phạm vi làm việc của nhân viên.",
  reconciliation: "Mở, đóng và đối chiếu tiền theo từng ca làm việc.",
};

export const definitions = {
  rooms: [
    ["name", "Tên máy / phòng"],
    ["branch", "Chi nhánh / địa chỉ"],
    ["machineCode", "Mã máy"],
    ["model", "Dòng máy"],
    ["importedAt", "Ngày nhập máy", "date"],
    ["expiresAt", "Ngày hết hạn", "date"],
    ["description", "Mô tả", "textarea"],
  ],
  packages: [
    ["name", "Tên gói"],
    ["description", "Mô tả", "textarea"],
    ["price", "Giá (VND)", "number"],
    ["duration", "Thời gian chụp (phút)", "number"],
    ["shots", "Số ảnh được chụp", "number"],
    ["countdownSeconds", "Đếm ngược trước mỗi ảnh (giây)", "number"],
    ["printSize", "Kiểu in", "printSize"],
    ["prints", "Số tờ in 10 × 15 kèm gói", "number"],
  ],
  frames: [
    ["name", "Tên khung"],
    ["themeName", "Tên bộ chủ đề (cùng tên để gom chung)"],
    ["order", "Thứ tự trong bộ", "number"],
    ["printSize", "Kích thước khung", "printSize"],
    ["image", "Ảnh khung", "frameImage"],
  ],
  users: [
    ["name", "Tên nhân viên"],
    ["email", "Email", "email"],
    ["password", "Mật khẩu (để trống khi không đổi)", "password"],
    ["role", "Vai trò", "role"],
    ["branch", "Chi nhánh được phân công (bắt buộc với nhân viên)"],
  ],
};
