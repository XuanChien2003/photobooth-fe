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
import { includedSheets, isInstax, isStrip, piecesLabel, printSizeOf } from "../kiosk/print-count.js";

// Khổ ảnh khách thấy ở màn “Chọn khổ ảnh” của máy chụp; mỗi gói đang bật là một thẻ.
// [khổ, tên nhóm, tên ngắn trong nút / lời nhắn, mô tả]
const SIZE_GROUPS = [
  ["strip", "Khổ nhỏ", "khổ nhỏ", "1 tờ 10 × 15 cm cắt đôi thành 2 tờ nhỏ (5 × 15 cm) · khách in tối thiểu 2 tờ nhỏ"],
  ["full", "Khổ to", "khổ to", "Ảnh 10 × 15 cm nguyên tờ · khách in tối thiểu 2 tờ"],
  ["instax", "Khổ Instax mini", "Instax mini", "Thẻ Instax mini 5,4 × 8,6 cm, in bằng máy Instax mini Link 3 cạnh máy chụp · khách in tối thiểu 2 tấm"],
];
const ART = { strip: 2, full: 2, instax: 1 };

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
            : "Tạo gói đầu tiên với khổ ảnh, giá, thời gian chụp và số tờ in phù hợp."}
        </p>
        {!filtered && onCreate && (
          <button
            type="button"
            className="package-empty-create"
            onClick={() => onCreate()}
          >
            <Plus size={17} aria-hidden="true" />
            Thêm gói chụp
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="package-size-groups">
      {SIZE_GROUPS.map(([size, title, short, note]) => {
        const group = items.filter((item) => printSizeOf(item) === size);
        if (!group.length && filtered) return null;
        const active = group.filter((item) => item.active).length;
        return (
          <section key={size} className="package-size-group" aria-label={title}>
            <header className="package-size-head">
              <span className={`package-size-art is-${size}`} aria-hidden="true">
                {Array.from({ length: ART[size] }, (_, i) => <i key={i} />)}
              </span>
              <div>
                <h3>
                  {title} <small>{active} gói đang bán</small>
                </h3>
                <p>{note}</p>
              </div>
              {onCreate && (
                <button
                  type="button"
                  className="package-card-action package-size-add"
                  onClick={() => onCreate(size)}
                >
                  <Plus size={16} aria-hidden="true" />
                  Thêm gói {short}
                </button>
              )}
            </header>
            {group.length ? (
              <PackageCards items={group} onEdit={onEdit} onDeactivate={onDeactivate} />
            ) : (
              <p className="package-size-empty">
                Chưa có gói {short} — máy chụp chỉ hiện khổ ảnh có gói đang bán.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function PackageCards({ items, onEdit, onDeactivate }) {
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
                  {isInstax(item) ? "Tấm Instax" : "Tờ in 10 × 15"}
                </dt>
                <dd>
                  <strong>{item.prints ?? 0}</strong> {isInstax(item) ? "tấm" : "tờ"}
                  {isStrip(item) && <small> = {piecesLabel(item, includedSheets(item))}</small>}
                </dd>
              </div>
            </dl>

            <p className="package-card-included">
              <Images size={17} aria-hidden="true" />
              {item.shots || 12} lần chụp · chọn {item.selectCount || 4} ảnh · {item.countdownSeconds || 10} giây/ảnh · {isStrip(item) ? "khổ nhỏ (cắt đôi)" : isInstax(item) ? "Instax mini" : "khổ to 10 × 15"}
            </p>
            <p className="package-card-branches">
              {item.branches?.length ? `Cấu hình riêng: ${item.branches.join(", ")}` : "Cấu hình chung · mọi chi nhánh"}
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
