// Lưu tạm trên máy chụp (IndexedDB): ảnh chờ gửi lên máy chủ và cài đặt của máy chụp
// (vd. thư mục ảnh của máy ảnh — trình duyệt chỉ lưu được quyền đọc thư mục ở đây).
const db = new Promise((resolve, reject) => {
  const r = indexedDB.open("photo-selfbooth-outbox", 2);
  r.onupgradeneeded = () => {
    const database = r.result;
    if (!database.objectStoreNames.contains("photos"))
      database.createObjectStore("photos", { keyPath: "id" });
    if (!database.objectStoreNames.contains("settings"))
      database.createObjectStore("settings");
  };
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
async function run(name, mode, action, result = (request) => request.result) {
  const database = await db;
  return new Promise((resolve, reject) => {
    const tx = database.transaction(name, mode),
      req = action(tx.objectStore(name));
    tx.oncomplete = () => resolve(result(req));
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Không lưu được ảnh trên thiết bị."));
  });
}
export const savePending = (row) => run("photos", "readwrite", (s) => s.put(row));
// Bulk reads are faster than per-record cursors for image rows. Keep the current
// schema so a still-open kiosk tab cannot block a database upgrade at startup.
export const readPending = (token) => run("photos", "readonly", (s) => s.getAll(),
  (request) => token === undefined ? request.result
    : request.result.filter((row) => row.token === token));
export const countPending = (token) => token === undefined
  ? run("photos", "readonly", (s) => s.count())
  : readPending(token).then((rows) => rows.length);
export const removePending = (id) => run("photos", "readwrite", (s) => s.delete(id));
export const saveSetting = (key, value) =>
  run("settings", "readwrite", (s) => s.put(value, key));
export const readSetting = (key) => run("settings", "readonly", (s) => s.get(key));
