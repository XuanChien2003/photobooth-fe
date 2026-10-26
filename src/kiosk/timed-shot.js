export const TIMED_SHOT_SECONDS = 3;
const CONNECT_MS = 12000;
const PHOTO_WAIT_MS = 15000;

// A cancelled session may finish connecting, but must never press the shutter afterwards.
function waitFor(task, ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => finish(reject, signal.reason || new DOMException("Cancelled", "AbortError"));
    const timer = setTimeout(() => finish(reject, new Error("Máy ảnh không phản hồi. Kiểm tra kết nối máy ảnh rồi thử lại.")), ms);
    const finish = (settle, value) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      settle(value);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    Promise.resolve(task).then((value) => finish(resolve, value), (error) => finish(reject, error));
  });
}

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

// Exactly one physical exposure per countdown. Slow JPEG delivery is not permission to
// fire again: a successful exposure can take longer than the folder polling interval.
export async function runTimedShot({ prepare, signal: parentSignal, onState, onTick, onPressed, hasPhoto, isReceiving, countdownSeconds = TIMED_SHOT_SECONDS }) {
  const abort = new AbortController();
  const signal = AbortSignal.any([parentSignal, abort.signal]);
  let shutter, focusing;
  const active = () => signal.throwIfAborted();
  try {
    active();
    onTick(null);
    onState("connecting");
    shutter = await waitFor(prepare(signal), CONNECT_MS, signal);
    active();
    onState("countdown");
    const end = Date.now() + countdownSeconds * 1000;
    let previous;
    while (true) {
      active();
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      if (left !== previous) onTick(left);
      previous = left;
      if (left === 1 && !focusing)
        focusing = waitFor(shutter.focus(signal), 2000, signal).then(() => null, (error) => error);
      if (!left) break;
      await pause(50, signal);
    }
    // Focus and press use the same connection; never overlap GATT commands.
    const focusError = await focusing;
    active();
    if (focusError) throw focusError;
    onState("capturing");
    await waitFor(shutter.press(signal), 8000, signal);
    active();
    onPressed();
    onState("waiting");
    const deadline = Date.now() + PHOTO_WAIT_MS;
    while (!hasPhoto()) {
      await pause(250, signal);
      active();
      if (Date.now() >= deadline && (!isReceiving() || Date.now() >= deadline + PHOTO_WAIT_MS))
        throw new Error("Đã gửi lệnh chụp nhưng chưa nhận được ảnh. Nhờ nhân viên kiểm tra máy ảnh và thư mục lưu ảnh trước khi thử lại.");
    }
  } finally {
    abort.abort();
    if (focusing) {
      await focusing;
      if (shutter.release)
        await waitFor(shutter.release(), 2000, new AbortController().signal).catch(() => {});
    }
  }
}
