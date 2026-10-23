import { Package, Plus, Search, X } from "lucide-react";
import { Button } from "../studio";

export function CatalogToolbar({
  resource,
  items,
  visibleCount,
  query,
  onQueryChange,
  status,
  onStatusChange,
  onCreate,
  loading,
}) {
  const noun = "gói chụp";
  const active = items.filter((item) => item.active).length;
  return (
    <section className="catalog-toolbar" aria-label={`Quản lý ${noun}`}>
      <div className="catalog-intro">
        <span className="catalog-intro-icon">
          <Package size={24} aria-hidden="true" />
        </span>
        <div className="catalog-intro-copy">
          <h3>Gói chụp dành cho khách</h3>
          <p>Giá, thời gian chụp và quyền lợi của từng gói trong một góc nhìn.</p>
        </div>
        <Button onClick={onCreate}>
          <Plus size={17} aria-hidden="true" />
          Thêm gói chụp
        </Button>
      </div>
      <div className="catalog-controls">
        <div className="catalog-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            aria-label={`Tìm ${noun}`}
            placeholder="Tìm tên gói, mô tả…"
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
