import { createElement, useCallback, useRef, useState } from "react";
import { useToast } from "./studio";

// Kiểm tra dữ liệu form phía trình duyệt với thông báo tiếng Việt thống nhất
// (thay cho bong bóng mặc định của trình duyệt vốn khác nhau và có khi bằng tiếng Anh).
// Mỗi luật nhận (giá trị, nhãn, toàn bộ form) và trả về câu báo lỗi hoặc "".
const empty = (v) => v === undefined || v === null || String(v).trim() === "";

export const required = (v, label) =>
  empty(v) ? `Vui lòng nhập ${label.toLowerCase()}.` : "";
export const chosen = (v, label) =>
  empty(v) ? `Vui lòng chọn ${label.toLowerCase()}.` : "";
export const email = (v) =>
  empty(v) || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim())
    ? ""
    : "Email không đúng định dạng (ví dụ: ten@studio.vn).";
export const phoneVN = (v) =>
  empty(v) || /^0[35789]\d{8}$/.test(String(v).trim())
    ? ""
    : "Số điện thoại cần 10 số, bắt đầu bằng 03, 05, 07, 08 hoặc 09.";
export const hotline = (v) =>
  empty(v) || /^[+\d][\d .-]{6,18}$/.test(String(v).trim())
    ? ""
    : "Số điện thoại không hợp lệ.";
export const minLength = (n) => (v, label) =>
  empty(v) || String(v).length >= n ? "" : `${label} cần tối thiểu ${n} ký tự.`;
export const maxLength = (n) => (v, label) =>
  empty(v) || String(v).length <= n ? "" : `${label} tối đa ${n} ký tự.`;
export const intRange = (min, max) => (v, label) =>
  empty(v) ||
  (Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max)
    ? ""
    : `${label} phải là số nguyên từ ${min.toLocaleString("vi-VN")} đến ${max.toLocaleString("vi-VN")}.`;
export const custom = (test, message) => (v, label, values) =>
  test(v, values) ? "" : message;

// spec: { field: [nhãn, ...luật] }. Trả về { field: câu lỗi đầu tiên }.
export function validate(values, spec) {
  const errors = {};
  for (const [field, [label, ...rules]] of Object.entries(spec)) {
    for (const rule of rules) {
      const message = rule(values[field], label, values);
      if (message) {
        errors[field] = message;
        break;
      }
    }
  }
  return errors;
}

export function useValidation() {
  const toast = useToast();
  const [errors, setErrors] = useState({});
  const warning = useRef(null);
  // Hợp lệ → true. Không hợp lệ → đánh dấu từng ô, báo lỗi đầu tiên và đưa con trỏ tới ô đó.
  const check = useCallback(
    (values, spec) => {
      const next = validate(values, spec);
      setErrors(next);
      const [field, message] = Object.entries(next)[0] || [];
      if (message) {
        warning.current = toast.warning(message);
        document.querySelector(`[name="${field}"]`)?.focus();
      } else if (warning.current) {
        // Đã sửa hết lỗi: ẩn cảnh báo cũ của form này.
        toast.dismiss(warning.current);
        warning.current = null;
      }
      return !message;
    },
    [toast],
  );
  const clear = useCallback(
    (field) =>
      setErrors((current) => {
        if (!current[field]) return current;
        const next = { ...current };
        delete next[field];
        return next;
      }),
    [],
  );
  return { errors, check, clear, setErrors };
}

export function FieldError({ error }) {
  return error
    ? createElement("small", { className: "field-error", role: "alert" }, error)
    : null;
}
