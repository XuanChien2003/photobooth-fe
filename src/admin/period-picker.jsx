import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { localDate } from "../api";
import { addDays } from "./date-range";

// Ngày dạng YYYY-MM-DD, tháng dạng YYYY-MM (giờ Việt Nam, như localDate()).
const pad = (n) => String(n).padStart(2, "0");
const monthOf = (day) => day.slice(0, 7);
export function monthRange(month) {
  const [y, m] = month.split("-").map(Number);
  return [`${month}-01`, `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`];
}
export function shiftMonth(month, n) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}
const dmy = (day) => day.split("-").reverse().join("/");
const monthName = (month) => `Tháng ${Number(month.slice(5))}/${month.slice(0, 4)}`;

// Khoảng đang lọc là một ngày, trọn một tháng, hay khoảng khác (dữ liệu cũ).
export function periodOf(from, to) {
  if (from === to) return { kind: "day", day: from };
  const month = monthOf(from);
  const [start, end] = monthRange(month);
  return from === start && to === end ? { kind: "month", month } : { kind: "range" };
}

// Lọc đơn theo lịch: bấm vào nhãn để chọn một tháng (hoặc một ngày), ‹ › lùi / tới một tháng khi
// đang xem cả tháng, một ngày khi đang xem một ngày. Ngày hiện theo kiểu Việt Nam (dd/mm/yyyy).
export function PeriodPicker({ from, to, onChange }) {
  const today = localDate();
  const thisMonth = monthOf(today);
  const period = periodOf(from, to);
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number(from.slice(0, 4)));
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e) => !box.current?.contains(e.target) && setOpen(false);
    const escape = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const pickMonth = (month) => {
    onChange(...monthRange(month));
    setOpen(false);
  };
  const pickDay = (day) => {
    if (!day) return;
    onChange(day, day);
    setOpen(false);
  };
  const byDay = period.kind === "day";
  const step = (n) => (byDay ? pickDay(addDays(from, n)) : pickMonth(shiftMonth(monthOf(from), n)));
  const canGoOn = byDay ? from < today : shiftMonth(monthOf(from), 1) <= thisMonth;
  const label = period.kind === "month"
    ? monthName(period.month)
    : byDay
      ? from === today ? `Hôm nay · ${dmy(today)}` : `Ngày ${dmy(from)}`
      : `${dmy(from)} – ${dmy(to)}`;
  return (
    <div className="period-picker" ref={box}>
      <button type="button" className="period-step" aria-label={byDay ? "Ngày trước" : "Tháng trước"} onClick={() => step(-1)}>
        <ChevronLeft size={17} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="period-current"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Chọn tháng hoặc ngày: ${label}`}
        onClick={() => {
          setYear(Number(from.slice(0, 4)));
          setOpen(!open);
        }}
      >
        <CalendarDays size={16} aria-hidden="true" />
        <span>{label}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <button type="button" className="period-step" aria-label={byDay ? "Ngày sau" : "Tháng sau"} disabled={!canGoOn} onClick={() => step(1)}>
        <ChevronRight size={17} aria-hidden="true" />
      </button>
      {open && (
        <div className="period-pop" role="dialog" aria-label="Chọn tháng">
          <div className="period-year">
            <button type="button" aria-label="Năm trước" onClick={() => setYear(year - 1)}>
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <strong>Năm {year}</strong>
            <button type="button" aria-label="Năm sau" disabled={year >= Number(today.slice(0, 4))} onClick={() => setYear(year + 1)}>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="period-months">
            {Array.from({ length: 12 }, (_, i) => {
              const month = `${year}-${pad(i + 1)}`;
              const chosen = period.kind === "month" && period.month === month;
              return (
                <button
                  key={month}
                  type="button"
                  className={month === thisMonth ? "is-now" : ""}
                  aria-label={monthName(month)}
                  aria-pressed={chosen}
                  disabled={month > thisMonth}
                  onClick={() => pickMonth(month)}
                >
                  Tháng {i + 1}
                </button>
              );
            })}
          </div>
          <label className="period-day">
            Hoặc xem một ngày
            <input type="date" max={today} value={byDay ? from : ""} onChange={(e) => pickDay(e.target.value)} />
          </label>
        </div>
      )}
    </div>
  );
}
