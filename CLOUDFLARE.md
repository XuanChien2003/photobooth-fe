# Frontend trên Cloudflare Workers

## Hai địa chỉ đang sử dụng

- `photobooth.ngathanh.workers.dev`: cấu hình `wrangler.jsonc`, API Render `photobooth-be-5ngq.onrender.com`; triển khai bằng `npm run deploy:cloudflare`.
- `studio.selfbooth.workers.dev`: cấu hình `wrangler.studio.jsonc`, API Render `photo-be-drja.onrender.com`; triển khai bằng `npm run deploy:studio`.

Hai Worker thuộc hai tài khoản Cloudflare khác nhau. Đăng nhập đúng tài khoản trước mỗi lần triển khai; không thay `API_ORIGIN` của trang này bằng backend của trang kia. Phần hướng dẫn bên dưới mô tả cấu hình lịch sử của `studio`.

Frontend chạy bằng Workers Static Assets; backend vẫn là Render, dữ liệu vẫn ở
MongoDB và bucket R2 riêng tư `nxc-media`. Không cần chuyển hay nén lại ảnh.

## Kết nối Git để tự triển khai `studio`

Trong Cloudflare → **Workers & Pages → Create application → Import a repository**,
chọn GitHub **XuanChien2003/photobooth-fe**, nhánh **main**. Nếu Worker `studio` còn kết nối repo cũ `Photo_FE`, commit vào repo hiện tại sẽ không tự cập nhật Worker đó; dùng lệnh CLI bên dưới hoặc cập nhật kết nối Git:

| Mục | Giá trị |
| --- | --- |
| Worker name | `studio` |
| Root directory | để trống (repo này đã là frontend) |
| Build command | `npm run build:cloudflare` |
| Deploy command | `npx wrangler@4 deploy` |
| API_ORIGIN | đã có trong `wrangler.studio.jsonc`: `https://photo-be-drja.onrender.com` |

Chọn Workers, không dùng cách kéo thư mục `dist` lên Pages: cách đó thiếu proxy API.
Địa chỉ miễn phí được Cloudflare cấp khi triển khai:
`https://studio.<subdomain-tài-khoản>.workers.dev` — hiện là **https://studio.selfbooth.workers.dev**
(tên Worker `studio` + subdomain tài khoản `selfbooth`). Đổi tên Worker thì đổi cả `name` trong
`wrangler.jsonc` cho khớp, nếu không bản build từ Git sẽ báo lỗi tên không khớp.
Không điền thông tin MongoDB, JWT, mật khẩu hay khóa R2 vào frontend.
`build:cloudflare` luôn dùng `/api` cùng địa chỉ web, dù môi trường cũ có `VITE_API_URL`.

Hoặc triển khai bằng CLI trong repo này:

```sh
npx wrangler@4 login
npm run deploy:studio
```

Lần đầu cần đăng nhập và cấp quyền triển khai vào tài khoản Cloudflare của tiệm.
Tài khoản trong `wrangler.jsonc` phải là tài khoản chứa bucket `nxc-media`.

Kiểm tra trước khi triển khai (full smoke cần repo `photobooth-be` nằm cạnh repo này và
đã cài dependencies của cả hai repo):

```sh
npm test
npm run build:cloudflare
node ../photobooth-be/test/browser-smoke.mjs --cloudflare
```

Smoke dùng dữ liệu thử trong MongoDB tạm, đi qua chính Worker bằng HTTP local;
không chạm ảnh khách, bucket R2 thật hoặc máy in. Vẫn cần kiểm tra URL Cloudflare
thật sau khi triển khai để xác nhận routing, HTTPS và CORS của tài khoản.

## Cho phép địa chỉ mới truy cập R2

Sau khi có URL thật, vào **R2 → nxc-media → Settings → CORS policy**.
Giữ các origin đang dùng, thêm **đúng origin Cloudflare mới** vào `AllowedOrigins`
của quy tắc cho phép **GET, HEAD, PUT**, với các header **Range, Content-Type**.
Không dùng dấu `*`; không thêm `/admin`, `/kiosk` hoặc dấu `/` ở cuối origin.

Ví dụ cấu trúc quy tắc (thay origin ví dụ bằng URL thật, giữ origin cũ nếu còn dùng):

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:5173",
      "https://studio.selfbooth.workers.dev"
    ],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["Range", "Content-Type"],
    "ExposeHeaders": ["Content-Length", "Content-Type", "Content-Range"],
    "MaxAgeSeconds": 3600
  }
]
```

Thiếu bước CORS, web vẫn có thể dùng đường qua backend để mở/lưu ảnh nhưng sẽ chậm hơn.
Bucket tiếp tục để riêng tư; ảnh được truy cập bằng liên kết có chữ ký và thời hạn.

## Kiểm tra trước khi đổi máy trong tiệm

1. Mở URL mới `/admin`: đăng nhập, tải lại trang, kiểm tra vẫn đăng nhập.
2. Tạo vé thử và mở kiosk từ **Phòng & chi nhánh → Cài kiosk** trên URL mới.
   Chọn lại thư mục ảnh, chụp thử, chờ xác nhận ảnh đã lưu.
3. Mở QR mới trên điện thoại: tải thêm ảnh, chỉnh sửa, ghép khung và gửi in thử.
   Kiểm tra máy in nhận lệnh trực tiếp và file in đúng kích thước/chất lượng.
4. Chỉ chuyển 3 máy chụp, máy in và lễ tân sau khi ảnh chờ của phiên cũ đã lưu xong.
   Cài lại shortcut kiosk từ URL mới để lần mở sau dùng Cloudflare.

Quyền thư mục, mã kiosk, bản chỉnh và ảnh đang chờ lưu thuộc từng địa chỉ web (origin) trong
trình duyệt: đổi địa chỉ web thì phải cấp lại ở máy chụp. Không đổi địa chỉ giữa một buổi chụp.

## Hoạt động và giới hạn

`/api` và `/api/*` được Worker truyền tới Render theo dạng stream, giữ nguyên cookie,
byte JPEG/ICC, dữ liệu in và SSE. Worker kiểm tra origin trước khi chuyển origin
cho backend; không cần tắt bảo vệ nguồn yêu cầu hoặc thay `CLIENT_URL` trên Render.
Worker không lưu phản hồi API và không tự gửi lặp yêu cầu ghi; nó giữ nguyên quy tắc cache backend gửi
về cho trình duyệt (album `private, no-cache` → lần hỏi lại không đổi chỉ nhận 304 rỗng; ảnh khung có mã
phiên bản lưu 1 năm), phản hồi không có quy tắc thì không lưu. Link R2 vẫn trả thẳng về R2.

JS/CSS có tên hash cache 1 năm; font 30 ngày, logo 1 ngày. HTML dùng cache mặc định
có kiểm tra lại để nhận bản mới. `/admin`, `/kiosk`, `/album/...` mở trực tiếp được
nhờ SPA fallback; `/api` không rơi vào fallback.

Static Assets không tính vào lượt Worker; proxy API tính vào giới hạn Worker Free
(hiện 100.000 yêu cầu/ngày). Theo dõi Requests/CPU trong dashboard khi cả tiệm chạy.
Nhịp kiểm tra phiên chụp là 5 giây (3 máy chụp liên tục 15 giờ khoảng 32.400 lượt);
nhận file mới và đẩy ảnh vẫn chạy ngay, độc lập với nhịp kiểm tra phiên.
Chuyển frontend không loại bỏ thời gian Render Free khởi động lại hoặc nghẽn upload.

Tài liệu chính thức: [Static Assets](https://developers.cloudflare.com/workers/static-assets/),
[Git builds](https://developers.cloudflare.com/workers/ci-cd/builds/),
[R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/),
[giới hạn Workers](https://developers.cloudflare.com/workers/platform/limits/).
