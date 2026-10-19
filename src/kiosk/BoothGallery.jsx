import { PiFolderOpenDuotone, PiImagesDuotone } from "react-icons/pi";
import { useEffect, useState } from "react";
import { Button } from "../studio";
import { retryMediaImage } from "../media-delivery.js";

export function BoothGallery({
  shots,
  folder,
  folderAccess,
  scanInfo,
  unsaved,
  grantFolder,
  pickFolder,
}) {
  const folderBlocked = !folder || folderAccess !== "granted";
  const latest = shots[0];
  const [preview, setPreview] = useState(null);
  // Keep the local preview after the upload succeeds: no second full-image download.
  useEffect(() => {
    if (!latest) {
      setPreview(null);
      return;
    }
    const binary = latest.src instanceof Blob;
    const src = binary ? URL.createObjectURL(latest.src) : latest.src;
    setPreview({ key: latest.key, src, mirrored: !binary && Boolean(latest.mirrored) });
    return () => { if (binary) URL.revokeObjectURL(src); };
  }, [latest?.key]);
  const previewSrc = preview?.key === latest?.key
    ? preview?.src
    : typeof latest?.src === "string" ? latest.src : undefined;
  const previewMirrored = latest && preview?.key === latest.key
    ? preview.mirrored : Boolean(latest?.mirrored);
  return (
    <div className="booth-bottom">
      <div className="booth-gallery-head">
        <h3>
          Vừa chụp <b>{shots.length}</b> ảnh
        </h3>
        <span
          className={
            scanInfo?.error || scanInfo?.jpegs === 0 ? "is-warn" : undefined
          }
        >
          {`Ảnh gốc từ máy ảnh · thư mục ${folder?.name || ""}${
            !scanInfo
              ? ""
              : scanInfo.jpegs
                ? ` · thấy ${scanInfo.jpegs} ảnh JPG`
                : " · thư mục chưa có ảnh JPG nào — kiểm tra đúng thư mục X Acquire lưu ảnh chưa"
          }${scanInfo?.error ? ` · lỗi đọc: ${scanInfo.error}` : ""}`}
          {unsaved > 0 && ` · ${unsaved} ảnh đang lưu`}
        </span>
      </div>
      {folderBlocked && (
        <div className="booth-folder-alert" role="alert">
          <p>
            Máy chụp chưa được phép đọc thư mục ảnh của máy ảnh nên ảnh vừa chụp
            chưa hiện ở đây.
          </p>
          <Button
            type="button"
            className="small"
            onClick={folder ? grantFolder : pickFolder}
          >
            <PiFolderOpenDuotone />{" "}
            {folder ? "Cho phép đọc thư mục ảnh" : "Chọn thư mục ảnh"}
          </Button>
        </div>
      )}
      {latest ? (
        <div className="booth-review">
          <figure className="booth-shot">
            <img
              key={latest.key}
              data-photo-key={latest.key}
              src={previewSrc}
              style={previewMirrored ? { transform: "scaleX(-1)" } : undefined}
              onError={retryMediaImage}
              alt={`Ảnh vừa chụp ${latest.label}`}
            />
            <figcaption>{latest.label} · ảnh mới nhất</figcaption>
          </figure>
        </div>
      ) : (
        <p className="booth-empty">
          <PiImagesDuotone size={30} /> Ảnh vừa chụp sẽ hiện to ở đây
        </p>
      )}
    </div>
  );
}
