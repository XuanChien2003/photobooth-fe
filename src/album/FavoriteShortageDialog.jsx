import { useId } from "react";
import { PiHeartDuotone, PiXBold } from "react-icons/pi";
import { Button } from "../studio";

export function FavoriteShortageDialog({
  pack, required, favorites, totalPhotos, onMore, onAutomatic, onClose,
}) {
  const titleId = useId(), descriptionId = useId();
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal favorite-shortage"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClick={(event) => event.stopPropagation()}
      >
        <button className="icon-button modal-close" aria-label="Đóng" onClick={onClose}>
          <PiXBold />
        </button>
        <span className="favorite-shortage-icon" aria-hidden="true"><PiHeartDuotone /></span>
        <h2 id={titleId}>Chưa đủ ảnh yêu thích</h2>
        <div id={descriptionId} className="favorite-shortage-description">
          <p>Bộ “{pack.name}” có {required} ô ảnh. Bạn đã thích {favorites} ảnh.</p>
          <p className="favorite-shortage-count">
            Còn thiếu {required - favorites} ảnh yêu thích ({favorites}/{required}).
          </p>
          <p>
            {totalPhotos < required
              ? `Thư viện có ${totalPhotos} ảnh cho ${required} ô. Tự động ghép sẽ dùng lại một số ảnh để lấp đầy các ô.`
              : "Tự động ghép sẽ ưu tiên ảnh yêu thích và bổ sung từ ảnh còn lại trong thư viện."}
          </p>
        </div>
        <div className="favorite-shortage-actions">
          <Button onClick={onAutomatic} disabled={!totalPhotos}>Tự động ghép</Button>
          <Button className="outline" onClick={onMore} autoFocus>Chọn thêm</Button>
        </div>
      </section>
    </div>
  );
}
