/** Flatten message text for list previews. */
export function sessionPreviewText(text, maxLen = 48) {
  if (!text) return '';
  const flat = String(text).replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  if (flat.length <= maxLen) return flat;
  return `${flat.slice(0, maxLen - 1)}…`;
}

/** Primary label for a session row (title → first user message → fallback). */
export function formatSessionLabel(session, { fallback = 'New chat' } = {}) {
  if (session?.title?.trim()) return session.title.trim();
  const preview = sessionPreviewText(session?.firstUserMsg || session?.preview);
  if (preview) return preview;
  return fallback;
}

/** Where the chat lives — project name or Quick chat. */
export function formatSessionLocation(session) {
  if (session?.projectName) return session.projectName;
  if (session?.projectId) return 'Project';
  return 'Quick chat';
}

/** Human-readable relative time for session lists. */
export function formatSessionWhen(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
