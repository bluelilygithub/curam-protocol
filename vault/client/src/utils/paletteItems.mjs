// Command palette (Ctrl/Cmd+K): the pure parts. What can be typed to, how it is ranked, and what is remembered.
// Items are plain data ({ kind, key, title, subtitle, icon, to, event, setTab }) so a recent one can be stored and run again later.

export const ACTIONS = [
  { key: 'new-note', title: 'New note', icon: 'pen-line', to: '/notes?new=1', keywords: 'write create add' },
  { key: 'new-task', title: 'New task (quick capture)', icon: 'list-checks', event: { name: 'vault:open-quick-capture' }, keywords: 'todo add create capture' },
  { key: 'new-chat', title: 'New chat', icon: 'chat', to: '/chat', event: { name: 'vault:new-chat', delay: 120 }, keywords: 'ask conversation' },
  { key: 'talk', title: 'Talk it through', icon: 'mic', to: '/talk', keywords: 'voice speak' },
  { key: 'record-note', title: 'Record a voice note', icon: 'mic', to: '/notes?record=1', keywords: 'dictate microphone' },
  { key: 'open-settings', title: 'Open settings', icon: 'settings', to: '/settings', keywords: 'preferences options' },
];

/** Where each kind of result is listed in the palette, and what its heading says. */
export const SECTION_ORDER = ['recent', 'action', 'app', 'setting', 'note', 'client', 'invoice', 'project', 'task', 'message', 'file'];
export const SECTION_LABEL = {
  recent: 'Recent', action: 'Actions', app: 'Go to', setting: 'Settings', note: 'Notes', client: 'Clients (CRM)',
  invoice: 'Invoices and quotes', project: 'Projects', task: 'Tasks', message: 'Chats', file: 'Files',
};

export function actionItems() {
  return ACTIONS.map((a) => ({ kind: 'action', subtitle: '', ...a }));
}

/** One item per app the person may open (groups come from getAppsNavGroups, already filtered by feature and admin). External links are left out. */
export function appItems(groups = []) {
  const seen = new Set();
  const out = [];
  for (const g of groups) {
    for (const it of g.items || []) {
      if (it.external || !it.path || seen.has(it.id)) continue;
      seen.add(it.id);
      out.push({ kind: 'app', key: it.id, title: it.label, subtitle: g.label, icon: it.icon, to: it.path, keywords: it.aliases || '' });
    }
  }
  return out;
}

/** One item per Settings section the person may open (groups come from visibleGroups). */
export function settingItems(groups = []) {
  const out = [];
  for (const g of groups) {
    for (const t of g.tabs || []) {
      out.push({ kind: 'setting', key: t.id, title: t.id, subtitle: `Settings, ${g.label}`, icon: 'settings', to: `/settings?tab=${encodeURIComponent(t.id)}`, keywords: t.tip || '' });
    }
  }
  return out;
}

/** 0 = no match. Name starting with what was typed beats a word starting with it, beats it appearing anywhere, beats the hidden keywords. */
export function scoreItem(item, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return 0;
  const title = String(item.title || '').toLowerCase();
  if (title === q) return 120;
  if (title.startsWith(q)) return 100;
  if (title.split(/[\s\-/&(),]+/).some((w) => w.startsWith(q))) return 80;
  if (title.includes(q)) return 60;
  const hay = `${title} ${String(item.subtitle || '').toLowerCase()} ${String(item.keywords || '').toLowerCase()}`;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((t) => hay.includes(t))) return 50;
  if (hay.includes(q)) return 30;
  return 0;
}

/** Items matching the query, best first, capped per kind so one kind (say Settings) cannot push everything else off the screen. */
export function rankLocal(items, query, perKind = 5) {
  const counts = {};
  return items
    .map((it, i) => ({ it, s: scoreItem(it, query), i }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .filter((x) => {
      counts[x.it.kind] = (counts[x.it.kind] || 0) + 1;
      return counts[x.it.kind] <= perKind;
    })
    .map((x) => x.it);
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/** Turn the server's /api/search/global answer and the older /api/search + tasks answers into palette items. */
export function remoteItems({ global = {}, search = [], tasks = [] } = {}) {
  const out = [];
  for (const n of global.notes || []) {
    out.push({ kind: 'note', key: `note:${n.id}`, title: n.title || 'Untitled', subtitle: n.snippet || '', icon: 'pen-line', to: `/notes?note=${n.id}` });
  }
  for (const c of global.clients || []) {
    const sub = [c.company, c.status && c.status !== 'active' ? c.status : ''].filter(Boolean).join(', ');
    out.push({ kind: 'client', key: `client:${c.id}`, title: c.name, subtitle: sub, icon: 'briefcase', to: `/clients/${c.id}` });
  }
  for (const i of global.invoices || []) {
    const what = i.docType === 'quote' ? 'Quote' : 'Invoice';
    out.push({ kind: 'invoice', key: `invoice:${i.id}`, title: `${what} ${i.number}`, subtitle: `${i.status}, $${Number(i.total || 0).toFixed(2)}`, icon: 'receipt', to: '/finance' });
  }
  for (const r of search) {
    if (r.type === 'project') {
      out.push({ kind: 'project', key: `project:${r.projectId}`, title: r.title, subtitle: '', icon: 'folder', to: `/projects/${r.projectId}` });
    } else if (r.type === 'file') {
      out.push({ kind: 'file', key: `file:${r.projectId}:${r.title}`, title: r.title, subtitle: stripTags(r.snippet), icon: 'file', to: `/projects/${r.projectId}` });
    } else if (r.type === 'message') {
      out.push({
        kind: 'message', key: `message:${r.sessionId || r.title}`, title: r.title, subtitle: stripTags(r.snippet), icon: 'chat',
        to: r.projectId ? `/projects/${r.projectId}/chat` : '/chat',
        event: r.sessionId ? { name: 'vault:load-session', detail: r.sessionId, delay: 80 } : undefined,
      });
    }
  }
  for (const t of tasks) {
    out.push({ kind: 'task', key: `task:${t.id}`, title: t.title, subtitle: t.notes ? String(t.notes).slice(0, 80) : t.status || '', icon: 'list-checks', to: '/tasks' });
  }
  return out;
}

/** Group items into headed sections in SECTION_ORDER, and give the flat list in the same order (so arrow keys follow what is on screen). */
export function buildSections(items) {
  const byKind = {};
  for (const it of items) (byKind[it.kind] = byKind[it.kind] || []).push(it);
  const sections = SECTION_ORDER.filter((k) => byKind[k]?.length).map((k) => ({ kind: k, label: SECTION_LABEL[k], items: byKind[k] }));
  return { sections, flat: sections.flatMap((s) => s.items) };
}

// ── Recent choices (this browser only) ──────────────────────────────────────
export const RECENTS_KEY = 'vault:paletteRecents';
const MAX_RECENTS = 6;

export function readRecents(storage) {
  try {
    const list = JSON.parse(storage?.getItem(RECENTS_KEY) || '[]');
    return Array.isArray(list) ? list.filter((x) => x && x.key && x.title && (x.to || x.event)).slice(0, MAX_RECENTS) : [];
  } catch (_) { return []; }
}

export function rememberChoice(storage, item) {
  try {
    const { key, title, subtitle, icon, to, event } = item;
    const kind = item.origKind || item.kind; // a recent that is chosen again keeps its real kind
    const entry = { kind, key, title, subtitle, icon, to, event };
    const next = [entry, ...readRecents(storage).filter((x) => !(x.kind === kind && x.key === key))].slice(0, MAX_RECENTS);
    storage?.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch (_) { /* private window or blocked storage: the palette still works */ }
}

/** A recent item is listed under "Recent" but keeps its own icon and destination. */
export function asRecent(item) {
  return { ...item, kind: 'recent', origKind: item.kind };
}
