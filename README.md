# Frontend — web nội bộ của tiệm (React + Vite)

Triển khai frontend lên Cloudflare: xem [CLOUDFLARE.md](CLOUDFLARE.md).
Chạy `npm run build:cloudflare` và `npx wrangler@4 deploy`; backend Render và kho R2 giữ nguyên.

Các module được chia theo chức năng trong `src/admin/`, `src/kiosk/`, `src/album/` và
`src/styles/`.

Web chỉ dùng trong tiệm, không có trang giới thiệu hay tra cứu công khai:

| Đường dẫn         | Ai dùng              | Ghi chú                                                                                      |
| ----------------- | -------------------- | -------------------------------------------------------------------------------------------- |
| `/admin`          | Quản trị, lễ tân     | Trang gốc `/` tự chuyển về đây. Tổng quan có bảng phòng trực tiếp + nút “Tạo mã chụp”.       |
| `/kiosk?device=…` | Máy chụp trong phòng | Mở liên kết “Cài kiosk” (Quản trị → Quản lý máy) **một lần**, máy tự nhớ 1 năm.        |
| `/album/<mã>`     | Khách                | Mở bằng mã QR hiện trên máy chụp sau khi chụp xong; lễ tân có thể hiện lại QR ở mục Mã chụp. |

Trang được gắn `noindex` và có `robots.txt` chặn công cụ tìm kiếm.

Kết nối mạng dùng chung trong `src/network.js`: yêu cầu đọc tự thử lại một lần
khi lỗi mạng hoặc máy chủ tạm gián đoạn, trong cùng giới hạn thời gian chờ.
Ảnh tải lên chỉ thử lại với cùng mã ảnh để máy chủ chống trùng; các thao tác
thanh toán, tạo vé và gửi in không bị tự gửi lặp. Sau lỗi liên tiếp, việc làm mới
giãn dần để giảm tải. Đổi Wi-Fi, quay lại tab hoặc mở máy sau chế độ ngủ sẽ
kiểm tra lại bằng yêu cầu thật; trạng thái Wi-Fi của trình duyệt chỉ dùng để gợi ý.
Phiên đăng nhập và bước bắt đầu chụp tự phục hồi sau gián đoạn. Luồng tải ảnh có
giới hạn tổng 90 giây, chuyển sang API nếu R2 không nhận thêm dữ liệu trong
15 giây; vẫn giữ toàn bộ byte của file gốc, không hạ chất lượng để xử lý mạng yếu.

Tải JPEG lên R2 theo dõi số byte thực sự đã truyền: 30 giây không tiến triển thì
hủy đường tải đang treo và lưu qua API, còn tải chậm nhưng vẫn truyền được giữ
ngân sách tối đa 180 giây. Ảnh mới nhất trên kiosk không đổi khi xác nhận lưu ảnh
cũ về sau. Khi rời màn kết quả hoặc đổi khung, các nguồn in tải trước không còn
cần được hủy để nhường mạng và bộ nhớ; nguồn đang được vẽ vẫn hoàn tất bình thường.

Cả trang dùng chung một trạng thái kết nối (`getConnectivity`), lấy từ kết quả thật
của các yêu cầu API: mất mạng, quá thời gian chờ, 502/503/504 (máy chủ đang khởi động lại)
hoặc trang đăng nhập Wi-Fi trả về thay cho API là mất kết nối; mọi câu trả lời khác của
máy chủ là đã kết nối. Trang quản trị chỉ hiện **một** thông báo mất kết nối (các bảng
không báo lặp), tự dò `GET /api/health` (3 → 30 giây, không cache, không bị giới hạn tần
suất) và báo "Đã kết nối lại" rồi tự tải lại dữ liệu. Chuyển cửa sổ chốc lát không tải
lại các bảng; quay lại tab, đổi mạng, mở máy sau khi ngủ thì có. Luồng báo lệnh in mới
tự mở lại khi máy chủ khởi động lại và tải lại hàng chờ để không sót lệnh. Máy chụp hết
giờ lúc mất mạng tự thử chốt phiên giãn dần (không gửi liên tục, báo một lần) rồi hiện QR.

**Giữ máy chủ miễn phí không ngủ:** Render gói free tắt máy chủ sau 15 phút không có yêu cầu,
lần mở sau chờ ~1 phút. Màn máy chụp (`/kiosk`) và trang quản trị (`/admin`) mở suốt ngày trong
tiệm nên tự gọi `GET /api/health` (rất nhẹ, không chạm database) mỗi 8 phút, chỉ trong giờ mở cửa
8h–23h giờ Việt Nam (tiệm mở 9h–23h, giữ thức sớm 1 giờ; `OPEN_HOURS` trong `src/network.js`), nên một
tab bỏ quên qua đêm không giữ máy chủ chạy 24/24 (hạn mức free 750 giờ/tháng; 15 giờ × 31 ngày = 465 giờ). Đóng hết các màn này hoặc ngoài
giờ mở cửa thì máy chủ vẫn ngủ như cũ, màn đầu tiên mở trong ngày sẽ đánh thức nó. Cần giữ thức
ngoài các màn này thì dùng dịch vụ ping ngoài (UptimeRobot, cron-job.org) gọi cùng địa chỉ.

Lễ tân có mục **Quản lý máy**: chọn phòng đang hoạt động → **Cài kiosk** →
**Mở kiosk** trên máy tính trong phòng. Lễ tân cũng có thể sao chép liên kết, quét QR
hoặc tải file cài tự mở cho Windows/Mac. Thêm, sửa và ngừng phòng do quản trị viên quản lý.
Quyền này dùng tài khoản lễ tân hiện có; không cần đổi vai trò tài khoản.

Album của khách (`src/album/AlbumViewer.jsx`) chỉ để xem và tải, giống Snapbox: ảnh lớn ở giữa,
dải ảnh nhỏ bên dưới gồm ảnh đã ghép khung, video tua nhanh rồi tới các ảnh gốc. Khách giữ vào ảnh
để lưu trên điện thoại hoặc bấm tải ảnh gốc, ảnh ghép, video hay cả album (ZIP). Chọn ảnh, ghép
khung và in đều làm ở máy chụp. Album tự làm mới 10 giây/lần khi đang mở để nhận ảnh đồng bộ muộn;
nút **Làm mới ảnh** cập nhật ngay. Giao diện dùng nâu espresso **#4b332a** trên nền kem sáng.

Quản trị khung: ảnh xem trước gọn hơn, nút **↑ / ↓** lưu thứ tự ngay trong bộ mà không mở hộp sửa.
Xóa từ khóa và chọn tất cả trạng thái để sắp xếp toàn bộ; vẫn lọc được theo chủ đề.
Khung trùng tên cùng bộ có nhãn `pink · 01`, `pink · 02` ổn định qua lọc/sắp xếp;
tên gốc được giữ trong dữ liệu. Tổng ô ảnh của bộ chỉ tính khung đang dùng.

Trong **Hàng chờ in → Trợ lí Minh Dâm**, kho ảnh R2 nằm trước phần dữ liệu MongoDB
Atlas; hai kho có dung lượng và mức theo dõi riêng. Phần **Hạn lưu ảnh & dọn dẹp**
hiển thị hạn ảnh gần nhất, dung lượng file đã hết hạn và lý do chưa thể dọn.
Số liệu cập nhật mỗi 30 giây; **Làm mới** lấy lại ngay. Thời điểm cập nhật và trạng
thái **Số liệu cũ** nằm cạnh tiêu đề. Mở **Chi tiết ảnh đang lưu** để xem dung lượng
từng loại file. Giới hạn của hai kho được hiển thị theo cấu hình hiện có của backend;
trang không có ô điều chỉnh hay nút lưu/bỏ giới hạn.
Mọi trang quản trị cùng theo dõi dung lượng: cảnh báo vàng từ **80%**, đỏ từ
**90%**, kèm số MB còn lại. Nút **Mở trợ lí để dọn ảnh** mở thẳng mục trợ lí.
Cảnh báo tự cập nhật mỗi 30 giây khi web đang hiển thị; sau khi dọn,
số liệu dùng chung được cập nhật ngay. Khi mất kết nối, cảnh báo cũ
vẫn hiện và ghi rõ **Số liệu cũ**.
Trong Hàng chờ in, **Ảnh sắp xoá gần nhất** lấy hạn sớm nhất của ảnh đang lưu
(ảnh chụp, ảnh gốc tải lên và ảnh in ở mọi trạng thái), không phụ thuộc tab Chờ in
hay Đã in. Ảnh đã hết hạn nhưng chưa tới lượt dọn hiện **Đã hết hạn, chờ dọn**.
Quản trị viên có thể **Dọn ảnh đã hết hạn** theo thời gian lưu hiện tại hoặc mở
**Xem lệnh đã in** để chọn lệnh muốn xóa. Không tự dọn ảnh còn hạn khi mở mục này.

Giới hạn mặc định **512 MB** theo gói MongoDB Atlas đã xác nhận của studio;
backend đọc mức đã cấu hình, mặc định từ `MEDIA_STORAGE_LIMIT_MB`. Số MB đã dùng lấy từ lệnh
[`atlasSize`](https://www.mongodb.com/docs/atlas/free-tier-commands/), bao gồm dữ liệu
và chỉ mục của mọi database trong cluster. Số còn lại = giới hạn − tổng đã dùng.
MB ở đây = 1.024 × 1.024 byte.

Nếu MongoDB không hỗ trợ hoặc không cho phép đọc dung lượng cluster, trang vẫn
báo MB file ảnh và database ứng dụng, còn số MB trống ghi rõ chưa đo được.
Nếu backend chưa có giới hạn, trang giữ số liệu đã dùng và báo chưa tính được dung lượng còn lại.

```bash
cd photobooth-fe
npm ci
npm run dev
```

Mở http://localhost:5173/admin. Backend cần chạy tại http://localhost:8080.
Đổi địa chỉ backend bằng cách tạo `.env` từ `.env.example` và sửa `API_PROXY_TARGET`.

Ảnh khách có thể lưu trong Cloudflare R2 qua backend; cấu hình theo
[R2_SETUP.md](../photobooth-be/R2_SETUP.md), không đặt khóa trong frontend hoặc biến `VITE_*`.
Dải ảnh nhỏ gọi `?size=thumbnail`; nút tải lấy ảnh đầy đủ.
Ảnh cũ không có thumbnail được backend trả ảnh đầy đủ. **Trợ lí Minh Dâm** theo dõi riêng
MongoDB và kho R2, cảnh báo mức 80/90% và báo chưa biết khi kho R2 không đo được.
Giao diện theo dõi R2 nằm trong `src/admin/r2-storage.jsx`; warning dùng chung toàn admin,
monitor vẫn chỉ gọi một API `/admin/storage` mỗi 30 giây. Mức R2 bằng GB thập phân là
mức theo dõi dung lượng hiện tại, không phải hóa đơn GB-tháng hoặc giới hạn cứng.
Mức mặc định lấy từ `R2_STORAGE_LIMIT_GB` của backend (10 GB); bỏ form điều chỉnh
không thay đổi mức đã lưu hay cấu hình kho ảnh.
Phần MongoDB nằm trong `src/admin/mongo-storage.jsx`; dọn/đếm ngược trong
`src/admin/storage-lifecycle.jsx`; các thành phần hiển thị dùng chung trong `storage-ui.jsx`.
`storage-retention.js` dùng chung hạn ảnh giữa trợ lí và hai tab in. Giao diện tổng
thể nằm trong `src/styles/admin/storage-assistant-overview.css`.
Không đặt MONGO_URI hoặc JWT_SECRET trong frontend.

```bash
npm run build
npm run preview
```

`npm test` chạy các test đơn vị. Test trên trình duyệt chạy bằng `node test/<tên>.browser.mjs`
(cần build trước và repo `photobooth-be` đã cài dependencies nằm cạnh repo này).

Build nằm trong `dist/`. Bản chạy thật ở Cloudflare Workers (https://studio.selfbooth.workers.dev):
`cloudflare/worker.js` chuyển tiếp `/api/*` tới backend, Static Assets trả `index.html` cho các route
React. Cách triển khai và cấu hình: `CLOUDFLARE.md`.

Máy chụp: nên mở trình duyệt ở chế độ toàn màn hình (nút “Bật / tắt toàn màn hình” trong
“Cài đặt máy chụp (nhân viên)” ở màn nhập mã) và cho phép dùng camera.

## Máy ảnh Fujifilm X-S10: chụp ảnh gốc qua dây USB

**Khách chỉ chụp bằng nút chụp / remote của máy ảnh** — màn hình máy chụp không có nút chụp và không chụp từ
webcam. Không có hình trực tiếp (chưa cắm thẻ ghi hình HDMI) vẫn chụp và nhận ảnh bình thường.

Máy chủ chạy trên mạng nên không thấy máy ảnh cắm ở tiệm. Vì vậy **máy chụp (Chrome/Edge trên máy tính
trong phòng) tự đọc thư mục ảnh** mà phần mềm của Fujifilm lưu về, rồi gửi lên.

Cần 2 đường nối từ máy ảnh vào máy tính:

- **Cáp USB-C (truyền dữ liệu, ≤ 1,5 m, cắm thẳng vào máy tính)** → ảnh gốc qua FUJIFILM X Acquire.
- **Cáp micro-HDMI → thẻ ghi hình HDMI (HDMI capture, cắm cổng USB)** → hình trực tiếp. Cổng HDMI của
  laptop là cổng _xuất_ hình, cắm máy ảnh vào đó không nhận được gì.

Không dùng **FUJIFILM X Webcam** cho hình trực tiếp: phần mềm này chiếm máy ảnh nên X Acquire không nhận được
ảnh (Fujifilm yêu cầu thoát X Acquire / Capture One khi dùng X Webcam). Máy chụp tự bỏ qua camera “FUJIFILM …”
và webcam có sẵn của máy tính.

1. Cài **FUJIFILM X Acquire** (miễn phí, tải ở trang Fujifilm) trên máy tính trong phòng chụp.
2. Máy ảnh cần **firmware 2.00 trở lên** (bản có chụp tether; bật máy trong lúc giữ `DISP/BACK` để xem).
   Trên máy ảnh: `MENU → SET UP (cờ lê) → CONNECTION SETTING → CONNECTION MODE → USB TETHER SHOOTING AUTO`
   (firmware cũ ghi `PC CONNECTION MODE`). Chất lượng ảnh **FINE** hoặc **FINE+RAW** (bắt buộc có JPEG).
   Nên tắt tự tắt nguồn (`POWER MANAGEMENT → AUTO POWER OFF: OFF`), tắt hiển thị thông tin khi xuất HDMI
   cho hình sạch, và dùng pin giả / nguồn cắm điện khi chụp cả ngày.
3. Cắm cáp USB-C từ máy ảnh vào máy tính, mở X Acquire, chọn thư mục lưu ảnh — nên tạo thư mục riêng ngoài
   OneDrive, vd. `C:\PhotoBooth\X-S10` (Chrome không cho chọn thẳng Desktop / Documents / Downloads).
4. Khách bấm **nút chụp trên máy ảnh** hoặc **remote có dây** (vd. Fujifilm RR-100 + đầu chuyển 2,5 → 3,5 mm
   cho X-S10). Máy tính không tự bấm chụp được X-S10 nếu không có phần mềm trả phí (Capture One / Lightroom +
   plug-in của Fujifilm).
5. Mở máy chụp (`/kiosk?device=…`) bằng **Chrome hoặc Edge** → “Cài đặt máy chụp (nhân viên)” →
   **Chọn thư mục ảnh** (đúng thư mục ở bước 3).
   Khi trình duyệt hỏi quyền, chọn **“Cho phép mỗi lần truy cập”** để không phải cấp lại sau khi khởi động.
   “Camera live view”: chọn thẻ ghi hình HDMI (không chọn webcam có sẵn của laptop).
6. Bấm **“Thử nhận ảnh từ máy ảnh”** rồi bấm chụp trên máy ảnh: hiện “Đã nhận DSCF….JPG” là xong. Không nhận
   được thì màn hình liệt kê các bước cần kiểm tra; máy ảnh chỉ chụp RAW cũng được báo.

### Máy chụp chạy Windows hoặc macOS

Giống nhau: mở kiosk bằng **Chrome hoặc Edge** (Safari không đọc được thư mục ảnh), cài FUJIFILM X Acquire (có bản
Windows và Mac), thẻ ghi hình HDMI hiện là camera tên kiểu “USB Video”. Khác nhau:

|                                     | Windows                                                                     | macOS                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Thư mục ảnh nên dùng                | `C:\PhotoBooth\X-S10` (ngoài OneDrive)                                      | `Pictures/PhotoBooth`                                                               |
| Không đọc được thư mục              | Chrome chặn đọc thẳng Desktop / Documents / Downloads                       | Bật quyền: System Settings → Privacy & Security → Files and Folders → Google Chrome |
| Webcam có sẵn (máy chụp không dùng) | “Integrated Camera”, “HD Webcam”, “USB2.0 … WebCam”, Surface “Camera Front” | “Camera FaceTime HD”, iPhone (Continuity Camera)                                    |
| Tải lại trang                       | Ctrl+F5                                                                     | Cmd+Shift+R                                                                         |
| App hay chiếm thẻ ghi hình          | app Camera, Teams, Zoom, OBS                                                | QuickTime, Photo Booth, Zoom, OBS                                                   |

Máy chụp **không bao giờ dùng webcam có sẵn của máy tính / iPhone** làm hình trực tiếp (khách sẽ
thấy sai góc máy): không có thẻ ghi hình thì màn chụp báo “Chưa có hình trực tiếp từ máy ảnh”, cắm thẻ vào là hình
tự hiện (không cần tải lại trang). Ảnh chụp vẫn nhận bình thường dù chưa có hình trực tiếp. Hướng dẫn trên màn
hình (thư mục mẫu, cách cấp quyền) tự đổi theo Windows / macOS.

Màn chụp chia đôi: **nửa trên hình trực tiếp, nửa dưới hiện to ảnh vừa chụp** (cột ảnh nhỏ bên phải, bấm để xem
lại; có ảnh mới thì tự về ảnh mới nhất). Dòng nhỏ phía trên ảnh ghi thư mục đang đọc và số ảnh JPG máy chụp thấy
trong đó — chụp mà số này không tăng là máy chụp không thấy ảnh mới (sai thư mục, hoặc trên macOS Chrome chưa được
quyền đọc thư mục: System Settings → Privacy & Security → Files and Folders → Google Chrome; nên để thư mục ảnh
ngoài Desktop / Documents / Downloads). Tải lại trang mà trình duyệt quên quyền đọc thư mục thì màn chụp hiện nút
**“Cho phép đọc thư mục ảnh”**. Máy chụp gửi kèm tình trạng này lên máy chủ (`captureDiag` của vé, chỉ quản trị
xem qua `GET /api/admin/bookings`).

Ghi chú: ảnh gửi lên được thu về 3000 px cạnh dài (đủ in 10 × 15 cm sắc nét, gửi nhanh khi khách chụp liên
tục); bản gốc 26 MP vẫn nằm trong thư mục trên máy tính. Dùng Capture One thì chọn thư mục `Capture` của phiên
Capture One. Ảnh có sẵn trong thư mục lúc bắt đầu phiên và tệp RAW (`.RAF`) được bỏ qua. Ảnh mới xuất hiện
trong phiên luôn được nhận, kể cả khi đồng hồ máy ảnh lệch với máy tính.

Còn ảnh chưa lưu xong lên hệ thống thì nút “Hoàn thành chụp” bị khóa (hiện “Đang lưu N ảnh…”), lưu xong mới
bấm được. Hết giờ đúng lúc còn ảnh đang lưu: máy chụp lưu nốt rồi mới hiện mã QR (mạng hỏng quá 90 giây thì vẫn
hiện QR, ảnh còn lại giữ trên máy và tự gửi vào album khi có mạng).

## Giao diện: Tailwind CSS 4

`src/tailwind.css` là file CSS duy nhất được nạp (trong `main.jsx`), qua plugin `@tailwindcss/vite`.

- Class Tailwind có **tiền tố `tw:`** (vd. `tw:flex tw:gap-2 tw:hover:bg-brand`) để không trùng các class sẵn có
  như `.outline`, `.small`, `.panel`.
- **Không bật preflight** (reset mặc định của Tailwind): kiểu chữ, nút… của các màn cũ giữ nguyên.
- CSS cũ (`style.css`, `theme.css`, `self-booth.css`, `polish.css`, `motion.css`) nằm trong lớp `legacy`, thấp hơn
  `components` và `utilities` — class Tailwind luôn ghi đè được CSS cũ.
- Màu thương hiệu: `brand`, `brand-dark`, `brand-soft`, `ink`, `muted`, `line`, `cream` (vd. `tw:text-brand`).
- `src/admin-ui.css`: giao diện trang quản trị & đăng nhập viết bằng `@apply` (chỉ trong `.admin-shell` /
  `.admin-login`); máy chụp và album của khách giữ thiết kế riêng.

Danh mục gói chụp và khung ảnh được tách để dễ chỉnh sửa:

- `src/admin/catalog-toolbar.jsx`: tìm kiếm không dấu, lọc trạng thái và chủ đề.
- `src/admin/package-catalog.jsx`: thẻ gói chụp, giá và quyền lợi.
- `src/admin/frames.jsx`: thư viện khung, nhóm chủ đề và ảnh xem trước.
- `src/admin/resource-editor.jsx`: form thêm/sửa và xem trước gói chụp.
- `src/styles/admin/catalogs.css`: giao diện hiện tại của các danh mục.
  Các module `src/styles/polish/{catalog-controls,package-catalog}.css`
  là cấu trúc nền, được import trước hệ giao diện hiện tại.

Chạy `node test/admin-catalog.browser.mjs` để kiểm tra tìm/lọc, thêm/sửa/xoá và bố cục máy tính/điện thoại.
Bài kiểm tra dùng dữ liệu mẫu và API giả, không tác động dữ liệu thật.

Màu giao diện hiện tại được đặt ở `src/styles/polish/professional-foundation.css`;
`src/tailwind.css` ánh xạ cùng bảng màu cho các class `tw:`. Các file `legacy` là lớp nền tương thích.

Giao diện được hoàn thiện trong bốn file riêng, nạp cuối `tailwind.css`:

- `src/styles/polish/professional-foundation.css`: chữ, nút, thông báo và hướng dẫn dùng chung.
- `src/styles/polish/professional-entry.css`: đăng nhập, nhập mã, màn chụp và QR nhận ảnh.
- `src/styles/polish/professional-admin.css`: bố cục, bảng, gói/khung, hàng in và dung lượng.
- `src/styles/polish/professional-album.css`: thông tin vé và trang xem, tải ảnh.

Ba file entry/admin/album ở trên là **index import**; CSS thực tế được chia tại:

- `src/styles/entry/{login,kiosk}.css`.
- `src/styles/admin/{workspace,operations,controls,catalogs,forms,printing-and-storage,responsive}.css`.
- `src/styles/album/{workspace,responsive}.css`.

Logo dùng ảnh gốc ở `public/logo-m.jpg`, hiển thị qua `Brand` trong `src/studio.jsx`;
kích thước theo màn hình ở `src/styles/polish/brand-logo.css`. Hướng dẫn bắt đầu thu gọn
và vẫn nhớ trạng thái mở/đóng mà nhân viên đã chọn trên từng máy.

Thiết kế lại bằng [Impeccable](https://github.com/pbakaus/impeccable): nâu espresso,
nền porcelain, menu quản trị màu stone và điểm nhấn hồng từ logo. Font Be Vietnam Pro
được lưu tại `public/fonts` (kèm giấy phép OFL), không cần gọi dịch vụ font bên ngoài.

`src/main.jsx` tải riêng ba nhánh quản trị, kiosk và album bằng `React.lazy`.
Trang quản trị và máy chụp không tải module giao diện album trước khi cần;
trạng thái chờ tải dùng chung `Suspense` hiện có.

- `PRODUCT.md`: chức năng và ràng buộc sản phẩm cần giữ.
- `DESIGN.md` và `.impeccable/design.json`: hệ thiết kế từ giao diện đã hoàn thiện.
- `.impeccable/surfaces/src-main-jsx.md`: phạm vi và hướng bố cục lần thiết kế lại này.
- `.agents/skills/impeccable`: skill và giấy phép gốc, cài riêng cho dự án; Codex có thể
  nhận diện sau khi mở lại phiên. Dùng `$impeccable` cho các lần sửa sau.

Các màn cùng dùng nút, ô nhập và trạng thái chọn nhất quán. Sửa các module giao diện
trên thay vì thêm một lớp CSS ghi đè khác. Ảnh review và trạng thái chạy Impeccable được
gitignore; dữ liệu giả trong bài kiểm tra không tác động album/khách thật.

`src/dialog-focus.jsx`, nạp qua `ToastProvider` trong `src/studio.jsx`, quản lý bàn phím
cho hộp thoại: đưa focus vào form, giữ Tab trong hộp thoại trên cùng, Escape dùng nút
đóng hiện có và trả focus về nút mở. Quy tắc khóa nút khi đang xử lý vẫn do component
nghiệp vụ quyết định.
