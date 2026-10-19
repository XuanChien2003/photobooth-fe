import {
  ArrowUp,
  ArrowDown,
  Check,
  Image,
  ImagePlus,
  Layers,
  LayoutGrid,
  Pause,
  Pencil,
  Ruler,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import {
  compareFrameOrder,
  frameDisplayNames,
  frameTheme,
} from "../frame-catalog-data";

export function FrameGrid({
  items,
  allItems = items,
  onEdit,
  onDelete,
  onCreate,
  filtered = false,
  onMove,
  moving = false,
  reorderFiltered = false,
}) {
  const names = frameDisplayNames(allItems);
  const groups = new Map();
  // Bộ chủ đề theo tên, khung lẻ cuối cùng; trong bộ theo thứ tự đã đặt.
  const sorted = [...items].sort(
    (a, b) =>
      !a.themeName - !b.themeName ||
      (a.themeName || "").localeCompare(b.themeName || "", "vi") ||
      compareFrameOrder(a, b),
  );
  for (const frame of sorted) {
    const theme = frame.themeName?.trim() || "";
    if (!groups.has(theme)) groups.set(theme, []);
    groups.get(theme).push(frame);
  }

  if (!items.length)
    return (
      <div className="frame-catalog-empty" role="status">
        <span className="frame-catalog-empty-icon" aria-hidden="true">
          {filtered ? <Search size={30} /> : <ImagePlus size={30} />}
        </span>
        <h3>
          {filtered
            ? "Không tìm thấy khung phù hợp"
            : "Thêm khung ảnh đầu tiên"}
        </h3>
        <p>
          {filtered
            ? "Thử đổi từ khóa hoặc bộ lọc để xem các khung khác."
            : "Mang thiết kế của studio vào thư viện. Import khung từ Canva để bắt đầu."}
        </p>
        {!filtered && onCreate && (
          <button className="button" type="button" onClick={onCreate}>
            <Upload size={17} aria-hidden="true" /> Import khung
          </button>
        )}
      </div>
    );

  return (
    <div className="frame-catalog">
      {reorderFiltered && (
        <p className="frame-catalog-sort-hint">
          Để đổi thứ tự khung, xóa từ khóa và chọn “Tất cả trạng thái”. Bạn vẫn
          có thể lọc theo chủ đề.
        </p>
      )}
      {[...groups].map(([theme, frames]) => {
        const GroupIcon = theme ? Layers : Image;
        const slots = frames.reduce(
          (total, frame) =>
            total + (frame.active ? frame.slots?.length || 0 : 0),
          0,
        );
        return (
          <section
            className="frame-group frame-catalog-group"
            key={theme || "_single"}
          >
            <header className="frame-catalog-group-header">
              <span className="frame-catalog-group-icon" aria-hidden="true">
                <GroupIcon size={21} />
              </span>
              <div className="frame-catalog-group-title">
                <h3>{theme || "Khung lẻ"}</h3>
                <p>
                  {slots} ô ảnh đang dùng
                  {!theme && " · Mỗi khung là một chủ đề riêng"}
                </p>
              </div>
              <span className="frame-catalog-group-count">
                {frames.length} khung
              </span>
            </header>
            <div className="frame-cards frame-catalog-cards">
              {frames.map((frame) => {
                const siblings = allItems
                  .filter((item) => frameTheme(item) === theme)
                  .sort(compareFrameOrder);
                const index = siblings.findIndex(
                  (item) => item._id === frame._id,
                );
                const name = names.get(frame._id);
                return (
                  <article
                    key={frame._id}
                    className={`frame-card frame-catalog-card ${frame.active ? "" : "is-off"}`}
                  >
                    <div className="frame-catalog-preview">
                      {frame.image ? (
                        <img
                          src={frame.image}
                          alt={name}
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <span className="frame-catalog-no-image">
                          <Image size={34} aria-hidden="true" />
                          Chưa có ảnh khung
                        </span>
                      )}
                    </div>
                    <div className="frame-catalog-card-body">
                      <div className="frame-catalog-card-title">
                        <h4>{name}</h4>
                        <span
                          className={`frame-catalog-status ${frame.active ? "is-active" : "is-inactive"}`}
                        >
                          {frame.active ? (
                            <Check size={12} aria-hidden="true" />
                          ) : (
                            <Pause size={12} aria-hidden="true" />
                          )}
                          {frame.active ? "Đang dùng" : "Đã tắt"}
                        </span>
                      </div>
                      <div className="frame-catalog-metadata">
                        <span>
                          <LayoutGrid size={14} aria-hidden="true" />
                          {frame.slots?.length || 0} ô ảnh
                        </span>
                        <span>
                          <Ruler size={14} aria-hidden="true" />
                          {frame.printSize === "strip"
                            ? "5 × 15 cm"
                            : "10 × 15 cm"}
                        </span>
                      </div>
                      <p className="frame-catalog-order">
                        Thứ tự <strong>{index + 1}</strong> trong bộ
                      </p>
                    </div>
                    <footer className="frame-card-actions frame-catalog-actions">
                      {onMove && (
                        <>
                          <button
                            type="button"
                            className="frame-catalog-move"
                            aria-label={`Đưa ${name} lên trước`}
                            title="Đưa lên trước"
                            disabled={moving || reorderFiltered || index === 0}
                            onClick={() => onMove(frame, "up", siblings)}
                          >
                            <ArrowUp size={17} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="frame-catalog-move"
                            aria-label={`Đưa ${name} xuống sau`}
                            title="Đưa xuống sau"
                            disabled={
                              moving ||
                              reorderFiltered ||
                              index === siblings.length - 1
                            }
                            onClick={() => onMove(frame, "down", siblings)}
                          >
                            <ArrowDown size={17} aria-hidden="true" />
                          </button>
                        </>
                      )}
                      <button
                        className="frame-catalog-edit"
                        type="button"
                        aria-label={`Sửa ${name}`}
                        disabled={moving}
                        onClick={() => onEdit(frame)}
                      >
                        <Pencil size={14} aria-hidden="true" /> Sửa
                      </button>
                      <button
                        className="frame-catalog-delete"
                        type="button"
                        title="Xóa khung"
                        aria-label={`Xóa ${name}`}
                        disabled={moving}
                        onClick={() => onDelete(frame)}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </footer>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
