'use strict';

export const DEFAULT_TILES = [
  { id: 'tasks',    label: 'Tasks',        enabled: true },
  { id: 'projects', label: 'Projects',     enabled: true },
  { id: 'finance',  label: 'Finance',      enabled: true },
  { id: 'shares',   label: 'Shares',       enabled: true },
  { id: 'history',  label: 'Chat History', enabled: true },
  { id: 'notes',    label: 'Notes',        enabled: true },
  { id: 'student',  label: 'Student',      enabled: true },
];

export const FEATURE_BY_TILE_ID = {
  finance: 'finance',
  shares: 'shares',
  graphics: 'graphics',
  student: 'student',
  youtube: 'youtube',
};

export const DEFAULT_NAV_ITEMS = [
  { id: 'projects',  label: 'Projects',        path: '/',            enabled: true },
  { id: 'tasks',     label: 'Tasks',           path: '/tasks',       enabled: true },
  { id: 'notes',     label: 'Notes',           path: '/notes',       enabled: true },
  { id: 'goals',     label: 'Goals',           path: '/goals',       enabled: true },
  { id: 'finance',   label: 'Finance',         path: '/finance',     enabled: true },
  { id: 'shares',    label: 'Shares',          path: '/shares',      enabled: true },
  { id: 'youtube',   label: 'YouTube',         path: '/youtube',     enabled: true },
  { id: 'graphics',  label: 'Graphics',        path: '/graphics',    enabled: true },
  { id: 'gmailIntel', label: 'Inbox Intel',   path: '/gmail-intel', enabled: true },
  { id: 'chat',      label: 'General Chat',    path: '/chat',        enabled: true },
  { id: 'history',   label: 'Chat History',    path: '/history',     enabled: true },
  { id: 'studentSection', label: 'Student',    path: '/student/quiz', enabled: true },
  { id: 'clients',   label: 'Clients',         path: '/clients',     enabled: true },
  { id: 'memory',    label: 'Memory',          path: '/memory',      enabled: true },
  { id: 'prompts',   label: 'Prompts',         path: '/prompts',     enabled: true },
  { id: 'personas',  label: 'Personas',        path: '/personas',    enabled: true },
  { id: 'compare',   label: 'Doc Compare',     path: '/compare',     enabled: true },
  { id: 'debate',    label: 'Debate',          path: '/debate',      enabled: true },
  { id: 'chains',    label: 'Prompt Chains',   path: '/chains',      enabled: true },
  { id: 'graph',     label: 'Knowledge Graph', path: '/graph',       enabled: true },
  { id: 'news',      label: 'News Digest',     path: '/news-digest', enabled: true },
  { id: 'mood',      label: 'Mood',            path: '/mood',        enabled: true },
  { id: 'usage',     label: 'Usage & Cost',    path: '/usage',       enabled: true },
  { id: 'admin',     label: 'Admin',           path: '/admin',       enabled: true },
  { id: 'settings',  label: 'Settings',        path: '/settings',    enabled: true },
  { id: 'guide',     label: 'User Guide',      path: '/guide',       enabled: true },
];

export function mergeWithDefaults(saved, defaults) {
  if (!saved || !Array.isArray(saved) || saved.length === 0) return defaults.map(d => ({ ...d }));
  const savedIds = new Set(saved.map(i => i.id));
  const merged = saved.map(s => {
    const def = defaults.find(d => d.id === s.id);
    return def ? { ...def, ...s } : s;
  });
  for (const d of defaults) {
    if (!savedIds.has(d.id)) merged.push({ ...d });
  }
  return merged;
}
