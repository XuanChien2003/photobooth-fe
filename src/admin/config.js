import {
  LayoutDashboard,
  Users,
  DoorOpen,
  Package,
  Image,
  HardDrive,
  Settings2,
  Scale,
  ChartColumn,
  Monitor,
  Layers,
  Sticker,
  SlidersHorizontal,
  ClipboardList,
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
    shots: ["Số lần chụp", required, intRange(1, 40)],
    selectCount: ["Số ảnh khách chọn để ghép", required, intRange(1, 12)],
    countdownSeconds: ["Đếm ngược mỗi ảnh", required, intRange(1, 30)],
    prints: ["Số tờ in", required, intRange(0, 20)],
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

// Mục lục quản trị theo thứ tự trang Snapbox CMS (bỏ Khuyến mãi, Cấu hình giao diện, Tiếp thị).
// [mã, tên, icon, mục con?]. Mục có mục con chỉ là nhóm, bấm vào mở trang con đầu tiên.
export const NAV_TREE = [
  ["overview-group", "Tổng quan", LayoutDashboard, [
    ["overview", "Tổng hợp", LayoutDashboard],
    ["statistics", "Thống kê doanh thu", ChartColumn],
  ]],
  ["bookings", "Đơn hàng", ClipboardList],
  ["rooms", "Quản lý máy", DoorOpen],
  ["setup-group", "Thiết lập", Settings2, [
    ["screens", "Màn hình chờ", Monitor],
    ["themes", "Chủ đề", Layers],
    ["frames", "Khung ảnh", Image],
    ["packages", "Bảng giá", Package],
    ["stickers", "Nhãn dán", Sticker],
    ["filters", "Quản lý filter", SlidersHorizontal],
  ]],
  ["users", "Tài khoản", Users],
  ["reconciliation", "Đối soát", Scale],
];
// Danh sách phẳng các trang (mục lá) để tìm tên / icon theo mã.
export const nav = NAV_TREE.flatMap(([key, label, Icon, children]) =>
  children ? children : [[key, label, Icon]],
);
// Trang không có trên mục lục, mở từ nút trong trang khác (vd. cảnh báo dung lượng → trợ lí dọn ảnh).
export const HIDDEN_PAGES = [["storage", "Dung lượng lưu trữ", HardDrive]];

// Quyền cấp cho nhân viên (Tài khoản → Phân quyền), nhóm theo mục lục. Máy chủ kiểm tra lại.
export const PERMISSION_GROUPS = [
  ["1. Tổng quan", [["revenue:view", "Xem doanh thu, thống kê doanh thu & đối soát tháng"]]],
  ["2. Đơn hàng", [
    ["orders:export", "Xuất danh sách đơn hàng ra file Excel/CSV"],
    ["orders:cancel", "Hủy đơn đã thu tiền"],
    ["print:operate", "In lại ảnh, bán thêm tờ in, đánh dấu đã in"],
  ]],
  ["3. Quản lý máy", [["rooms:setup", "Cài máy chụp cho phòng (liên kết / QR)"]]],
  ["6. Đối soát", [["shift:operate", "Mở ca, đóng ca và đếm tiền"]]],
];
export const DEFAULT_STAFF_PERMISSIONS = ["orders:export", "print:operate", "shift:operate", "rooms:setup"];
// Quản trị viên có mọi quyền; nhân viên theo quyền máy chủ trả về khi đăng nhập.
export const can = (user, permission) =>
  user?.role === "admin" || Boolean(user?.permissions?.includes(permission));
// Trang nhân viên được mở (quản trị viên mở mọi trang).
export const STAFF_PAGES = (user) => [
  "overview",
  ...(can(user, "revenue:view") ? ["statistics"] : []),
  "bookings",
  "storage",
  "rooms",
  "reconciliation",
];

export const NAV_DESCRIPTIONS = {
  overview: "Doanh thu, số đơn so với kỳ trước, xếp hạng chủ đề, gói và máy; tạo mã chụp nhanh cho khách.",
  statistics: "Biểu đồ doanh thu và số đơn theo ngày hoặc tháng, so sánh với kỳ trước.",
  bookings: "Tìm đơn, gửi link ảnh, tải xuống hoặc in lại chỉ trong một màn hình.",
  storage: "Dung lượng kho ảnh và trợ lí dọn ảnh đã hết hạn để còn chỗ lưu ảnh mới.",
  rooms: "Thông tin máy, chế độ lật ảnh, trạng thái kết nối và liên kết cài máy chụp.",
  screens: "Ảnh và lời mời trên màn hình chờ: cấu hình chung cho mọi máy hoặc riêng từng máy.",
  themes: "Nhóm khung theo chủ đề, bật / tắt chủ đề và sắp xếp thứ tự khách thấy.",
  frames: "Xem mọi khung, lọc theo kích thước / chủ đề; thêm khung mới và đặt vùng ảnh, QR, ngày in.",
  packages: "Giá, thời gian chụp, số tờ in của từng gói, chi nhánh áp dụng và giá in thêm.",
  stickers: "Thư viện nhãn dán khách dùng để trang trí ảnh.",
  filters: "Bật bộ lọc có sẵn và tự tạo filter màu riêng của tiệm.",
  users: "Tài khoản nhân viên, chi nhánh phụ trách và phân quyền truy cập.",
  reconciliation: "Mở, đóng ca và đối soát tiền theo ca, theo tháng và từng chi nhánh.",
};

export const definitions = {
  rooms: [
    ["name", "Tên máy / phòng"],
    ["branch", "Chi nhánh / địa chỉ"],
    ["machineCode", "Mã máy"],
    ["model", "Dòng máy"],
    ["importedAt", "Ngày nhập máy", "date"],
    ["expiresAt", "Ngày hết hạn", "date"],
    ["flip", "Chế độ lật ảnh", "flip"],
    ["payment", "Khách trả tiền", "payment"],
    ["paymentTest", "Chế độ thử: có nút bỏ qua đút tiền (không tính doanh thu)", "checkbox"],
    ["description", "Mô tả", "textarea"],
  ],
  packages: [
    ["name", "Tên gói"],
    ["description", "Mô tả", "textarea"],
    ["price", "Giá (VND)", "number"],
    ["duration", "Thời gian chụp (phút)", "number"],
    ["shots", "Số lần chụp (số lần bấm dây / tự chụp)", "number"],
    ["selectCount", "Số ảnh khách chọn để ghép khung", "number"],
    ["countdownSeconds", "Đếm ngược trước mỗi ảnh (giây)", "number"],
    ["printSize", "Kiểu in", "printSize"],
    ["prints", "Số tờ in 10 × 15 kèm gói", "number"],
    ["branches", "Chi nhánh áp dụng", "branches"],
  ],
  users: [
    ["name", "Tên nhân viên"],
    ["email", "Email", "email"],
    ["password", "Mật khẩu (để trống khi không đổi)", "password"],
    ["role", "Vai trò", "role"],
    ["branch", "Chi nhánh được phân công (bắt buộc với nhân viên)"],
    ["permissions", "Phân quyền truy cập chức năng", "permissions"],
  ],
};
