import {
  Check,
  Clock3,
  Download,
  House,
  Ticket,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { Button } from "../studio";

export function PrintConfirmation({ job, code, sheets, onGallery, onReview }) {
  const printed = job?.status === "printed";
  const cancelled = job?.status === "cancelled";
  const failed = !printed && job?.spoolStatus === "failed";
  const Icon = failed || cancelled ? TriangleAlert : Check;
  return (
    <section className="print-confirmation" aria-label="Kết quả gửi in">
      <div className="print-confirmation-heading">
        <h2>
          {printed
            ? "Ảnh của bạn đã in xong"
            : cancelled
              ? "Yêu cầu in đã được huỷ"
              : failed
                ? "Lễ tân đang hỗ trợ lệnh in"
                : "Ảnh đã được gửi tới quầy"}
        </h2>
        <p>Cảm ơn bạn! Giữ mã vé để nhận lại những khoảnh khắc của bạn.</p>
      </div>
      <span
        className={`print-confirmation-check ${failed || cancelled ? "is-warning" : ""}`}
        aria-hidden="true"
      >
        <Icon size={68} strokeWidth={1.5} />
      </span>
      <div className="print-confirmation-ticket">
        <Ticket size={19} aria-hidden="true" />
        <span>
          Vé <strong>#{code}</strong> · {sheets} tờ đã gửi in
        </span>
      </div>
      <div className="print-confirmation-notes" role="status">
        <div>
          <UserRound size={29} aria-hidden="true" />
          <span>
            <strong>Mời bạn đến quầy</strong>
            <p>Đọc mã vé #{code} để nhận ảnh và được hỗ trợ.</p>
          </span>
        </div>
        <div>
          <Clock3 size={29} aria-hidden="true" />
          <span>
            <strong>
              {printed
                ? "Ảnh đã sẵn sàng"
                : cancelled
                  ? "Lễ tân đã huỷ yêu cầu này"
                  : failed
                    ? "Nhân viên sẽ kiểm tra máy in"
                    : "Ảnh đang được chuẩn bị"}
            </strong>
            <p>
              {printed
                ? "Lễ tân đã đánh dấu in xong. Bạn có thể nhận ảnh tại quầy."
                : cancelled
                  ? "Liên hệ lễ tân để kiểm tra yêu cầu in và số tờ còn lại trên vé."
                  : failed
                    ? "Không cần gửi lại. Hãy liên hệ lễ tân để được hỗ trợ."
                    : "Lễ tân đã nhận yêu cầu. Bạn có thể theo dõi trạng thái ngay tại đây."}
            </p>
          </span>
        </div>
      </div>
      <p className="print-confirmation-help">
        Có câu hỏi? Nhân viên tại quầy luôn sẵn sàng hỗ trợ bạn.
      </p>
      <div className="print-confirmation-actions">
        <Button onClick={onGallery}>
          <House size={17} aria-hidden="true" /> Về thư viện ảnh
        </Button>
        <Button className="outline" onClick={onReview}>
          <Download size={17} aria-hidden="true" /> Xem và tải ảnh
        </Button>
      </div>
    </section>
  );
}
