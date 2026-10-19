import { useCallback, useEffect, useRef } from "react";
import { api } from "./api";
import { onNetworkRecovery } from "./network.js";

// Refresh visible tabs and queue at most one fresh read after a pending read.
// Filters/unmount still cancel immediately; event bursts never restart a slow GET.
export function useLiveData(
  path,
  onData,
  onError,
  interval,
  finished = () => false,
  options = {},
) {
  const handlers = useRef({ path, onData, onError, finished, options });
  handlers.current = { path, onData, onError, finished, options };
  const request = useRef(null);
  const stopped = useRef(false);
  const failures = useRef(0);
  const nextPoll = useRef(0);
  const lastSuccess = useRef(0);
  const reload = useCallback((refreshOptions) => {
    if (handlers.current.options.canRefresh?.() === false) return;
    const version = handlers.current.options.version?.();
    const running = request.current;
    if (running?.path === path && !running.controller.signal.aborted) {
      running.superseded = true;
      if (!running.next)
        running.next = running.promise.then(() => {
          if (!running.controller.signal.aborted) return reload(refreshOptions);
        });
      return running.next;
    }
    running?.controller.abort();
    stopped.current = false;
    const controller = new AbortController();
    const task = { controller, path, superseded: false, next: null };
    request.current = task;
    const canApply = () =>
      !controller.signal.aborted && !task.superseded && path === handlers.current.path &&
      handlers.current.options.canRefresh?.() !== false &&
      version === handlers.current.options.version?.();
    task.promise = (async () => {
      try {
        const data = await api(path, {
          signal: controller.signal,
          allowNull: handlers.current.options.allowNull,
          share: refreshOptions?.share === true,
        });
        if (canApply()) {
          failures.current = 0;
          nextPoll.current = 0;
          lastSuccess.current = Date.now();
          stopped.current = handlers.current.finished(data);
          handlers.current.onData(data);
        }
        return data;
      } catch (e) {
        if (canApply()) {
          failures.current++;
          nextPoll.current = Date.now() + Math.max(e.retryAfterMs || 0,
            Math.min(30000, interval * 2 ** Math.min(failures.current - 1, 5)));
          handlers.current.onError(e);
        }
      } finally {
        if (request.current === task) request.current = null;
      }
    })();
    return task.promise;
  }, [path, interval]);
  useEffect(() => {
    stopped.current = false;
    failures.current = 0;
    nextPoll.current = 0;
    reload({ share: true });
    const refresh = () => {
      if (!document.hidden && !stopped.current && !request.current && Date.now() >= nextPoll.current) reload();
    };
    const timer = setInterval(refresh, interval);
    const unsubscribe = onNetworkRecovery(({ recovered }) => {
      // Woken only because another request just succeeded: this reader is already fresh.
      if (recovered && !failures.current && Date.now() - lastSuccess.current < 2000) return;
      nextPoll.current = 0;
      // Even a completed album/catalog may have failed while this tab slept.
      reload({ share: true });
    });
    return () => {
      clearInterval(timer);
      unsubscribe();
      request.current?.controller.abort();
    };
  }, [reload, interval]);
  return reload;
}
