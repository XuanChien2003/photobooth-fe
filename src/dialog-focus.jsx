import { useLayoutEffect } from "react";

const DIALOG = '[role="dialog"][aria-modal="true"]';
const FOCUSABLE =
  'a[href], area[href], button, input:not([type="hidden"]), select, textarea, iframe, [contenteditable="true"], [tabindex]';

function visible(element) {
  if (
    !element?.isConnected ||
    element.closest('[hidden], [inert], [aria-hidden="true"]')
  )
    return false;
  const style = getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    element.getClientRects().length > 0
  );
}

function usable(element) {
  return (
    visible(element) && !element.matches(':disabled, [aria-disabled="true"]')
  );
}

function controls(dialog) {
  return [...dialog.querySelectorAll(FOCUSABLE)]
    .filter(
      (element) =>
        element.closest(DIALOG) === dialog &&
        element.tabIndex >= 0 &&
        usable(element),
    )
    .map((element, order) => ({ element, order }))
    .sort(
      (a, b) =>
        (a.element.tabIndex || Infinity) - (b.element.tabIndex || Infinity) ||
        a.order - b.order,
    )
    .map(({ element }) => element);
}

// One manager covers existing dialogs, including those opened by lazy pages.
// Keep dismissal in the component's own button so its busy/permission rules apply.
export function DialogFocusManager() {
  useLayoutEffect(() => {
    const records = new Map();
    let active = null;
    let previousFocus = document.activeElement;
    let focusing = false;
    let synchronizing = false;

    function focus(element) {
      if (!element || element === document.activeElement) return;
      focusing = true;
      element.focus({ preventScroll: true });
      focusing = false;
    }

    function initialFocus(dialog) {
      const choices = controls(dialog);
      const preferred =
        choices.find((element) => element.hasAttribute("autofocus")) ||
        choices.find((element) =>
          element.matches(
            'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select',
          ),
        );
      return preferred || choices[0] || dialog;
    }

    function returnScopes(element) {
      const scopes = [];
      for (
        let parent = element?.parentElement;
        parent;
        parent = parent.parentElement
      )
        scopes.push(parent);
      return scopes;
    }

    function rememberedFocus(dialog) {
      const last = records.get(dialog)?.lastFocus;
      return usable(last) && last.closest(DIALOG) === dialog
        ? last
        : initialFocus(dialog);
    }

    function returnFallback(record) {
      // A responsive menu may hide the original opener while its dialog is
      // open. Return to the nearest surviving control, such as the menu toggle.
      for (const scope of record.returnScopes) {
        if (!scope.isConnected) continue;
        const target = [...scope.querySelectorAll(FOCUSABLE)].find(
          (element) =>
            element.tabIndex >= 0 &&
            !element.closest(DIALOG) &&
            usable(element),
        );
        if (target) return target;
      }
      return null;
    }

    function synchronize() {
      if (synchronizing) return active;
      synchronizing = true;
      const dialogs = [...document.querySelectorAll(DIALOG)].filter(visible);
      for (const dialog of dialogs) {
        if (records.has(dialog)) continue;
        records.set(dialog, {
          returnTo: previousFocus,
          returnScopes: returnScopes(previousFocus),
          lastFocus: null,
          addedTabIndex: !dialog.hasAttribute("tabindex"),
        });
        if (!dialog.hasAttribute("tabindex"))
          dialog.setAttribute("tabindex", "-1");
      }

      // Nested dialogs appear after their parent; overlays in this app are also
      // rendered after the page they protect. The last visible dialog owns keys.
      const next = dialogs.at(-1) || null;
      const removed = [...records].filter(
        ([dialog]) => !dialogs.includes(dialog),
      );
      const closing =
        active && !dialogs.includes(active) ? records.get(active) : null;
      active = next;
      for (const [dialog, record] of removed) {
        if (record.addedTabIndex) dialog.removeAttribute("tabindex");
        records.delete(dialog);
      }

      if (closing) {
        const target = closing.returnTo;
        if (usable(target) && (!active || active.contains(target)))
          focus(target);
        else if (active) focus(rememberedFocus(active));
        else focus(returnFallback(closing));
      }
      if (active && !active.contains(document.activeElement))
        focus(rememberedFocus(active));
      synchronizing = false;
      return active;
    }

    function onFocus(event) {
      if (focusing) {
        previousFocus = event.target;
        if (active?.contains(event.target))
          records.get(active).lastFocus = event.target;
        return;
      }
      const dialog = synchronize();
      if (dialog && !dialog.contains(event.target)) {
        focus(rememberedFocus(dialog));
        return;
      }
      previousFocus = event.target;
      if (dialog) records.get(dialog).lastFocus = event.target;
    }

    function onKey(event) {
      if (event.key !== "Tab" && event.key !== "Escape") return;
      const dialog = synchronize();
      if (!dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const dismiss = [
          ...dialog.querySelectorAll(
            'button[aria-label="Đóng"], [data-dialog-dismiss], .kiosk-confirm-card .button.outline',
          ),
        ].find((button) => button.closest(DIALOG) === dialog);
        if (usable(dismiss)) dismiss.click();
        return;
      }
      const choices = controls(dialog);
      const current = choices.indexOf(document.activeElement);
      if (!choices.length) {
        event.preventDefault();
        focus(dialog);
      } else if (
        current === -1 ||
        (event.shiftKey && current === 0) ||
        (!event.shiftKey && current === choices.length - 1)
      ) {
        event.preventDefault();
        focus(event.shiftKey ? choices.at(-1) : choices[0]);
      }
    }

    const observer = new MutationObserver(synchronize);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "aria-modal",
        "hidden",
        "inert",
        "aria-hidden",
        "disabled",
        "style",
        "class",
      ],
    });
    document.addEventListener("focusin", onFocus, true);
    window.addEventListener("keydown", onKey, true);
    synchronize();
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", onFocus, true);
      window.removeEventListener("keydown", onKey, true);
      for (const [dialog, record] of records)
        if (record.addedTabIndex) dialog.removeAttribute("tabindex");
    };
  }, []);
  return null;
}
