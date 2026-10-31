// Vault has several things that pop up on their own (the morning digest, the task reminder, the home-office hours prompt, the reflection
// reminder). Left alone they pile up on top of each other. This decides which one may show: the most important one that wants to, and the
// rest wait their turn (until it is dismissed). Nothing is dropped; each simply appears after the one before it.

/** Most important first. An id not listed here waits behind all of these. */
export const POPUP_PRIORITY = ['morning-digest', 'task-reminder', 'wfh-hours', 'inquiry-reminder'];

/** Of the popups that want to show right now, the one that may. Null when none want to. */
export function pickPopup(wanting = []) {
  const set = new Set(wanting);
  if (set.size === 0) return null;
  for (const id of POPUP_PRIORITY) if (set.has(id)) return id;
  return [...set].sort()[0];
}
