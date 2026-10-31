// Dialog behaviour that does not need a browser: which element Tab should land on, and which open dialog owns Escape.
// The DOM parts live in hooks/useDialogBehavior.js.

export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Where Tab (or Shift+Tab) should go inside a dialog that keeps focus.
 * `count` = how many tabbable elements it has, `current` = index of the focused one (-1 if focus is outside them).
 * Returns the index to focus, or null when the browser's own move is fine (focus is mid-list and not at an edge).
 */
export function nextFocusIndex(count, current, shift) {
  if (count <= 0) return null;
  if (current < 0) return shift ? count - 1 : 0;
  if (shift && current === 0) return count - 1;
  if (!shift && current === count - 1) return 0;
  return null;
}

/** The open dialogs, oldest first. Only the newest one answers Escape, so closing a dialog opened from another leaves the first open. */
export function createDialogStack() {
  const ids = [];
  return {
    push(id) { ids.push(id); },
    remove(id) {
      const i = ids.indexOf(id);
      if (i >= 0) ids.splice(i, 1);
    },
    isTop(id) { return ids.length > 0 && ids[ids.length - 1] === id; },
    get size() { return ids.length; },
  };
}
