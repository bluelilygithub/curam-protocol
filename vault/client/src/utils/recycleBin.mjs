// Wording for the recycle bin screens, shared by every tool that uses the bin. Pure: node client/src/utils/recycleBin.test.mjs

/** "1 day left", "12 days left", "Last day" (the item goes within 24 hours). */
export function daysLeftText(daysLeft) {
  const n = Number(daysLeft);
  if (!Number.isFinite(n) || n <= 1) return 'Last day';
  return `${n} days left`;
}

/** "just now", "5 minutes ago", "3 hours ago", "yesterday", "4 days ago", else the date. */
export function deletedAgoText(deletedAt, now = new Date()) {
  const when = new Date(deletedAt);
  if (Number.isNaN(when.getTime())) return '';
  const mins = Math.floor((now - when) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** The kinds present in a list of bin items, as [{ type, label, count }] in first-seen order (for the filter chips). */
export function kindsIn(items) {
  const seen = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const cur = seen.get(it.entityType) || { type: it.entityType, label: it.label || it.entityType, count: 0 };
    cur.count += 1;
    seen.set(it.entityType, cur);
  }
  return [...seen.values()];
}
