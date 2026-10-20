import { useToast } from "../studio";
import { isFilled } from "./utils";
import { FrameEditor } from "./FrameEditor";

// ─── Bước 3: Ghép lồng cả bộ — mọi khung đã có ảnh, chuyển tab để chỉnh ───
export function PackEditor({
  engine,
  pack,
  layouts,
  decorations,
  index,
  photos,
  adjustOf,
  onIndex,
  onLayouts,
  onDecorations,
  onReshuffle,
  onBack,
  onNext,
}) {
  const toast = useToast();
  const frame = pack.frames[index];
  function next() {
    const empty = pack.frames.findIndex((f) => !isFilled(f, layouts[f._id]));
    if (empty < 0) return onNext();
    onIndex(empty);
    toast.warning(`Khung “${pack.frames[empty].name}” còn ô chưa có ảnh.`);
  }
  return (
    <>
      {pack.frames.length > 1 && (
        <div
          className="frame-tabs"
          role="tablist"
          aria-label="Các khung trong bộ"
        >
          {pack.frames.map((f, i) => (
            <button
              key={f._id}
              role="tab"
              aria-selected={i === index}
              aria-label={f.name}
              className={isFilled(f, layouts[f._id]) ? "" : "missing"}
              onClick={() => onIndex(i)}
            >
              <img src={f.image} alt="" crossOrigin="anonymous" />
              <span>{f.name}</span>
            </button>
          ))}
        </div>
      )}
      <FrameEditor
        key={frame._id}
        engine={engine}
        frame={frame}
        title={
          pack.frames.length > 1
            ? `${frame.name} · ${index + 1}/${pack.frames.length}`
            : frame.name
        }
        slots={layouts[frame._id]}
        decorations={decorations[frame._id] || []}
        photos={photos}
        adjustOf={adjustOf}
        onSlots={(slots) => onLayouts({ [frame._id]: slots })}
        onDecorations={(items) => onDecorations(frame._id, items)}
        onReshuffle={onReshuffle}
        onBack={onBack}
        onNext={next}
      />
    </>
  );
}
