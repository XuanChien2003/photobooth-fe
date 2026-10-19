import { Clock3, Image, Infinity as InfinityIcon, Package, Printer, X } from "lucide-react";
import { money } from "../api";
import { Button, ErrorBox } from "../studio";
import { FieldError } from "../validate";
import { FrameImageField } from "../frame-admin";
import { definitions } from "./config";

export function ResourceEditor({
  resource,
  edit,
  form,
  busy,
  error,
  onChange,
  onClose,
  onSubmit,
}) {
  const catalog = resource === "packages" || resource === "frames";
  const frames = resource === "frames";
  const Icon = frames ? Image : Package;
  const title =
    resource === "packages"
      ? `${edit._id ? "Chỉnh sửa" : "Thêm"} gói chụp`
      : frames
        ? edit._id
          ? "Chỉnh sửa khung ảnh"
          : "Import khung"
        : edit._id
          ? "Chỉnh sửa"
          : "Thêm mới";
  const update = (key, value) => {
    onChange({ ...edit, [key]: value });
    form.clear(key);
  };
  const field = ([key, label, type = "text"]) => {
    const Field = type === "frameImage" ? "div" : "label";
    return (
      <Field
        key={key}
        className={
          catalog || type === "frameImage"
            ? `form-field resource-field resource-field-${key}`
            : undefined
        }
      >
        <span>{label}</span>
        {type === "textarea" ? (
          <textarea
            name={key}
            aria-invalid={Boolean(form.errors[key])}
            value={edit[key] || ""}
            onChange={(event) => update(key, event.target.value)}
          />
        ) : type === "frameImage" ? (
          <FrameImageField
            value={edit}
            onChange={(value) => {
              onChange({ ...edit, ...value });
              form.clear("image");
            }}
          />
        ) : type === "printSize" ? (
          <select
            value={edit[key] || "full"}
            onChange={(event) => update(key, event.target.value)}
          >
            <option value="full">10 × 15 cm · Nguyên tờ</option>
            <option value="strip">5 × 15 cm · Hai dải / tờ</option>
          </select>
        ) : type === "role" ? (
          <select
            value={edit[key]}
            onChange={(event) => update(key, event.target.value)}
          >
            <option value="staff">Lễ tân</option>
            <option value="admin">Quản trị viên</option>
          </select>
        ) : (
          <input
            name={key}
            type={type}
            inputMode={type === "number" ? "numeric" : undefined}
            autoComplete={type === "password" ? "new-password" : undefined}
            placeholder={
              type === "password" && edit._id
                ? "Để trống nếu không đổi"
                : undefined
            }
            aria-invalid={Boolean(form.errors[key])}
            value={edit[key] ?? ""}
            onChange={(event) =>
              update(
                key,
                type === "number" && event.target.value !== ""
                  ? Number(event.target.value)
                  : event.target.value,
              )
            }
          />
        )}
        <FieldError error={form.errors[key]} />
      </Field>
    );
  };
  return (
    <div className="modal-backdrop">
      <section
        className={`modal ${catalog ? `catalog-editor catalog-editor-${resource}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Chỉnh sửa dữ liệu"
      >
        <div className="modal-header">
          <div className="resource-editor-title">
            {catalog && (
              <span className="resource-editor-icon">
                <Icon size={23} aria-hidden="true" />
              </span>
            )}
            <div>
              <h2>{title}</h2>
              {catalog && (
                <p>
                  {frames
                    ? "Đặt tên, gom chủ đề và kiểm tra các ô đặt ảnh."
                    : "Thiết lập giá, thời gian chụp và số tờ in đi kèm."}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            aria-label="Đóng"
            onClick={onClose}
            className="icon-button"
          >
            <X />
          </button>
        </div>
        <ErrorBox error={error} />
        <form onSubmit={onSubmit} noValidate>
          <div className="resource-editor-content">
            <div className="resource-editor-fields">
              {definitions[resource]
                .filter(([, , type]) => type !== "frameImage")
                .map(field)}
            </div>
            {frames && (
              <div className="resource-editor-media">
                {definitions[resource]
                  .filter(([, , type]) => type === "frameImage")
                  .map(field)}
              </div>
            )}
            {resource === "packages" && (
              <aside
                className="catalog-editor-preview"
                aria-label="Xem trước gói chụp"
              >
                <h3>{edit.name || "Tên gói chụp"}</h3>
                <strong>{money(Number(edit.price) || 0)}</strong>
                {edit.description && <p>{edit.description}</p>}
                <ul>
                  <li>
                    <Clock3 size={17} aria-hidden="true" />
                    {Number(edit.duration) || 0} phút chụp
                  </li>
                  <li>
                    <Printer size={17} aria-hidden="true" />
                    {Number(edit.prints) || 0} tờ in 10 × 15 cm
                  </li>
                  <li>
                    <InfinityIcon size={17} aria-hidden="true" />
                    Không giới hạn ảnh
                  </li>
                </ul>
              </aside>
            )}
          </div>
          <div className={catalog ? "resource-editor-footer" : undefined}>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={Boolean(edit.active)}
                onChange={(event) =>
                  onChange({ ...edit, active: event.target.checked })
                }
              />{" "}
              Đang hoạt động
            </label>
            <div>
              {catalog && (
                <Button
                  type="button"
                  className="outline"
                  onClick={onClose}
                  disabled={busy}
                >
                  Huỷ
                </Button>
              )}
              <Button disabled={busy} className={catalog ? "" : "full"}>
                {busy ? "Đang lưu…" : "Lưu thay đổi"}
              </Button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
