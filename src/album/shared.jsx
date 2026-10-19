import { PiArrowLeftBold, PiHeartFill } from "react-icons/pi";
import { Button } from "../studio";
import { pad } from "./utils";
import { useThumb } from "./hooks";

export function ActionBar({ onBack, children, className = "" }) {
  return (
    <div className={`studio-actions ${className}`}>
      {onBack && (
        <Button className="outline" onClick={onBack}>
          <PiArrowLeftBold /> Quay lại
        </Button>
      )}
      {children}
    </div>
  );
}

export function SheetPhoto({ engine, photo, count, active, onPick }) {
  const src = useThumb(engine, photo.id, 240);
  return (
    <button
      className={active ? "active" : ""}
      aria-label={`Dùng ảnh ${pad(photo.number)}`}
      onClick={onPick}
    >
      {src ? <img src={src} alt="" /> : <span className="thumb-loading" />}
      {count > 0 && <span className="sheet-count">×{count}</span>}
    </button>
  );
}

export function CarouselThumb({ engine, photo, active, count, onStart, onPick }) {
  const src = useThumb(engine, photo.id, 160);
  return (
    <button
      className={active ? "active" : ""}
      aria-label={`Dùng ảnh ${pad(photo.number)} cho ô đang chọn`}
      onPointerDown={(e) => src && onStart(e, src)}
      onClick={(e) => e.detail === 0 && onPick()}
    >
      {src ? (
        <img src={src} alt="" draggable={false} />
      ) : (
        <span className="thumb-loading" />
      )}
      {photo.favorite && (
        <span>
          <PiHeartFill />
        </span>
      )}
      {count > 0 && <span className="sheet-count">×{count}</span>}
    </button>
  );
}
