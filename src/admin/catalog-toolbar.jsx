import { Image, Package, Plus, Search, Upload, X } from "lucide-react";
import { Button } from "../studio";

export function CatalogToolbar({
  resource,
  items,
  visibleCount,
  query,
  onQueryChange,
  status,
  onStatusChange,
  theme,
  onThemeChange,
  onCreate,
  loading,
}) {
  const frames = resource === "frames";
  const Icon = frames ? Image : Package;
  const noun = frames ? "khung ảnh" : "gói chụp";
  const active = items.filter((item) => item.active).length;
  const themes = [
    ...new Set(items.map((item) => item.themeName?.trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "vi"));
  return (
    <section className="catalog-toolbar" aria-label={`Quản lý ${noun}`}>
      <div className="catalog-intro">
        <span className="catalog-intro-icon">
          <Icon size={24} aria-hidden="true" />
        </span>
        <div className="catalog-intro-copy">
          <h3>{frames ? "Bộ sưu tập khung ảnh" : "Gói chụp dành cho khách"}</h3>
          <p>
            {frames
              ? "Sắp xếp theo chủ đề, xem khung và chỉnh sửa ở một nơi."
              : "Giá, thời gian chụp và quyền lợi của từng gói trong một góc nhìn."}
          </p>
        </div>
        <Button onClick={onCreate}>
          {frames ? (
            <Upload size={17} aria-hidden="true" />
          ) : (
            <Plus size={17} aria-hidden="true" />
          )}
          {frames ? "Nhập khung" : "Thêm gói chụp"}
        </Button>
      </div>
      <div className="catalog-controls">
        <div className="catalog-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            aria-label={`Tìm ${noun}`}
            placeholder={
              frames ? "Tìm tên khung, chủ đề…" : "Tìm tên gói, mô tả…"
            }
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          {query && (
            <button
              type="button"
              aria-label="Xoá tìm kiếm"
              onClick={() => onQueryChange("")}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        {frames && (
          <select
            aria-label="Lọc chủ đề"
            value={theme}
            onChange={(event) => onThemeChange(event.target.value)}
          >
            <option value="all">Tất cả chủ đề</option>
            {themes.map((name) => (
              <option key={name} value={`theme:${name}`}>
                {name}
              </option>
            ))}
            {items.some((item) => !item.themeName?.trim()) && (
              <option value="none">Khung lẻ</option>
            )}
          </select>
        )}
        <select
          aria-label="Lọc trạng thái"
          value={status}
          onChange={(event) => onStatusChange(event.target.value)}
        >
          <option value="all">Tất cả trạng thái</option>
          <option value="active">Đang hoạt động</option>
          <option value="inactive">Đã tắt</option>
        </select>
      </div>
      <div className="catalog-results" aria-live="polite">
        <span>
          {loading
            ? "Đang tải danh mục…"
            : `${visibleCount} / ${items.length} ${noun}`}
        </span>
        {!loading && (
          <div className="catalog-counts">
            <span>
              <i />
              {active} đang hoạt động
            </span>
            <span>{items.length - active} đã tắt</span>
          </div>
        )}
      </div>
    </section>
  );
}
