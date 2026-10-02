// Pure grouping/filtering for the chat list panel (components/ChatListPanel.jsx). Kept free of
// React and of any imports so it can be unit tested with plain node (chatPanelGroups.test.mjs).
//
// A "session" here is a row from GET /api/chat/all-history:
//   { sessionId, title, projectId, projectName, lastAt, starred, firstUserMsg, lastMsg }

export const DATE_GROUPS = ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older'];
export const QUICK_CHAT_LABEL = 'Quick chat';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Whole calendar days between `iso` and `now`, in the user's local time (not 24h blocks:
// 23:50 last night is "Yesterday" even though it was ten minutes ago).
export function daysAgo(iso, now = new Date()) {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return Infinity;
  const diff = Math.round((startOfLocalDay(now) - startOfLocalDay(when)) / DAY_MS);
  return diff < 0 ? 0 : diff; // a timestamp slightly in the future (clock skew) is still "today"
}

export function dateGroupLabel(iso, now = new Date()) {
  const d = daysAgo(iso, now);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d <= 7) return 'Previous 7 days';
  if (d <= 30) return 'Previous 30 days';
  return 'Older';
}

const byRecent = (a, b) => new Date(b.lastAt || 0) - new Date(a.lastAt || 0);

export function groupByDate(sessions, now = new Date()) {
  const buckets = new Map(DATE_GROUPS.map((g) => [g, []]));
  for (const s of sessions) buckets.get(dateGroupLabel(s.lastAt, now)).push(s);
  return DATE_GROUPS
    .map((label) => ({ label, items: buckets.get(label).sort(byRecent) }))
    .filter((g) => g.items.length > 0);
}

// Groups by project (chats without one are "Quick chat"); the project with the most recent chat
// comes first, and chats inside a group are newest first.
export function groupByProject(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const label = s.projectName || (s.projectId ? 'Project' : QUICK_CHAT_LABEL);
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(s);
  }
  return [...map.entries()]
    .map(([label, items]) => ({ label, items: items.sort(byRecent) }))
    .sort((a, b) => byRecent(a.items[0], b.items[0]));
}

// Case-insensitive match against everything the list row carries: title, the first question,
// the last reply, and the project name. Every word typed must match somewhere (AND), so
// "quote acme" finds a chat that mentions both. Empty query returns everything.
export function filterSessions(sessions, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return sessions;
  return sessions.filter((s) => {
    const hay = [s.title, s.firstUserMsg, s.lastMsg, s.projectName, s.projectId ? '' : QUICK_CHAT_LABEL]
      .filter(Boolean).join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function pinnedOnly(sessions) {
  return sessions.filter((s) => Number(s.starred) === 1);
}
