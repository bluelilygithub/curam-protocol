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
  videos: 'videos',
  recipes: 'recipes',
  seo: 'seo',
  searchConsole: 'searchConsole',
  googleAds: 'googleAds',
  domains: 'domains',
  html: 'html',
  webExtractor: 'webExtractor',
  restyle: 'restyle',
  themeBuilder: 'themeBuilder',
  wellbeing: 'wellbeing',
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
  { id: 'videos',    label: 'Video Tools',     path: '/videos',      enabled: true },
  { id: 'recipes',   label: 'Recipes',         path: '/recipes',     enabled: true },
  { id: 'domains',   label: 'Domain',          path: '/domains',     enabled: true },
  { id: 'googleAds', label: 'Adwords',         path: '/google-ads',  enabled: true },
  { id: 'seo',       label: 'SEO',             path: '/seo',         enabled: true },
  { id: 'searchConsole', label: 'Search',      path: '/search-console', enabled: true },
  { id: 'html',      label: 'Lighthouse',      path: '/html',        enabled: true },
  { id: 'webExtractor', label: 'Web Extractor', path: '/web-extractor', enabled: true },
  { id: 'restyle',   label: 'CSS',              path: '/restyle',     enabled: true },
  { id: 'pdf',       label: 'PDF Tools',        path: '/pdf',         enabled: true },
  { id: 'fonts',     label: 'Font Customizer',  path: '/fonts',       enabled: true },
  { id: 'music',     label: 'Music',            path: '/music',       enabled: true },
  { id: 'roomPlanner',   label: 'Room Planner',   path: '/room-planner',   enabled: true },
  { id: 'gardenPlanner', label: 'Garden Planner', path: '/garden-planner', enabled: true },
  { id: 'routeTracer',   label: 'Route Tracer',   path: '/route-tracer',   enabled: true },
  { id: 'cellarPlanner', label: 'Cellar Planner', path: '/cellar-planner', enabled: true },
  { id: 'browserAgent',  label: 'Browser Agent',  path: '/browser-agent',  enabled: true },
  { id: 'documentRedaction', label: 'Redaction',       path: '/document-redaction', enabled: true },
  { id: 'contractReview',    label: 'Contract Review', path: '/contract-review',    enabled: true },
  { id: 'measurements',  label: 'Measurements',   path: '/measurements',   enabled: true },
  { id: 'productScout',  label: 'Amazon Search',  path: '/product-scout',  enabled: true },
  { id: 'translate',     label: 'Translate',      path: '/translate',      enabled: true },
  { id: 'guitar',        label: 'Guitar',         path: '/guitar',         enabled: true },
  { id: 'propertyScenario', label: 'Property',    path: '/property-scenario', enabled: true },
  { id: 'expenseReview', label: 'Invoice Review', path: '/expense-review', enabled: true },
  { id: 'themeBuilder', label: 'WP Theme Builder', path: '/theme-builder', enabled: true },
  { id: 'wellbeing', label: 'Wellbeing Check', path: '/wellbeing',   enabled: true },
  { id: 'gmailIntel', label: 'Inbox Intel',   path: '/gmail-intel', enabled: true },
  { id: 'chat',      label: 'Quick chat',    path: '/chat',        enabled: true },
  { id: 'history',   label: 'Chat History',    path: '/history',     enabled: true },
  { id: 'studentSection', label: 'Student',    path: '/student/quiz', enabled: true },
  { id: 'clients',   label: 'CRM',             path: '/clients',     enabled: true },
  { id: 'pipeline',  label: 'Pipeline',        path: '/pipeline',    enabled: true },
  { id: 'memory',    label: 'Memory',          path: '/memory',      enabled: true },
  { id: 'suggestions', label: 'Suggestions',   path: '/suggestions', enabled: true },
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
