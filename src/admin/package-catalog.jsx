import {
  Camera,
  Clock3,
  Images,
  Pencil,
  Plus,
  Power,
  Printer,
} from "lucide-react";
import { money } from "../api";

export function PackageCatalog({
  items,
  onEdit,
  onDeactivate,
  onCreate,
  filtered = false,
}) {
  if (!items.length) {
    return (
      <div className="package-catalog-empty" role="status">
        <span className="package-empty-icon" aria-hidden="true">
          <Camera size={28} strokeWidth={1.5} />
        </span>
        <h3>{filtered ? "Không tìm thấy gói chụp" : "Chưa có gói chụp"}</h3>
        <p>
          {filtered
            ? "Thử tên khác hoặc đổi bộ lọc trạng thái."
            : "Tạo gói đầu tiên với giá, thời gian chụp và số tờ in phù hợp."}
        </p>
        {!filtered && onCreate && (
          <button
            type="button"
            className="package-empty-create"
            onClick={onCreate}
          >
            <Plus size={17} aria-hidden="true" />
            Thêm gói chụp
          </button>
        )}
      </div>
    );
  }

  return (
    <ul className="package-catalog-grid" aria-label="Danh sách gói chụp">
      {items.map((item) => (
        <li key={item._id} className="package-catalog-item">
          <article
            className={`package-card${item.active ? "" : " is-inactive"}`}
          >
            <div className="package-card-heading">
              <div className="package-card-topline">
                <span className="package-card-icon" aria-hidden="true">
                  <Camera size={23} strokeWidth={1.6} />
                </span>
                <span
                  className={`package-card-status ${item.active ? "is-active" : "is-inactive"}`}
                >
                  <span aria-hidden="true" />
                  {item.active ? "Đang hoạt động" : "Đã tắt"}
                </span>
              </div>
              <h3 className="package-card-name">{item.name || item.code}</h3>
              {item.description && (
                <p className="package-card-description">{item.description}</p>
              )}
            </div>

            <div className="package-card-price">
              <span>Giá gói</span>
              <strong>{money(item.price)}</strong>
            </div>

            <dl className="package-card-details">
              <div>
                <dt>
                  <Clock3 size={17} aria-hidden="true" />
                  Thời gian chụp
                </dt>
                <dd>
                  <strong>{item.duration ?? "—"}</strong> phút
                </dd>
              </div>
              <div>
                <dt>
                  <Printer size={17} aria-hidden="true" />
                  Tờ in 10 × 15
                </dt>
                <dd>
                  <strong>{item.prints ?? 0}</strong> tờ
                </dd>
              </div>
            </dl>

            <p className="package-card-included">
              <Images size={17} aria-hidden="true" />
              Không giới hạn ảnh chụp
            </p>

            <div className="package-card-actions">
              <button
                type="button"
                className="package-card-action package-card-edit"
                onClick={() => onEdit(item)}
                aria-label={`Chỉnh sửa ${item.name || item.code}`}
                title={`Chỉnh sửa gói ${item.name || item.code}`}
              >
                <Pencil size={16} aria-hidden="true" />
                Chỉnh sửa
              </button>
              {item.active && (
                <button
                  type="button"
                  className="package-card-action package-card-deactivate"
                  onClick={() => onDeactivate(item)}
                  aria-label={`Ngừng sử dụng ${item.name || item.code}`}
                  title={`Ngừng sử dụng gói ${item.name || item.code}`}
                >
                  <Power size={16} aria-hidden="true" />
                  Ngừng
                </button>
              )}
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
