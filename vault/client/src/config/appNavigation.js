/** Central nav catalog for Apps launcher, mobile nav, and sidebar workspace links. */

export const APP_NAV_GROUPS = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { id: 'personas', label: 'Personas', path: '/personas', icon: 'user', featureKey: null },
      { id: 'memory', label: 'Memory', path: '/memory', icon: 'brain', featureKey: null },
      { id: 'prompts', label: 'Prompt Library', path: '/prompts', icon: 'book', featureKey: null },
      { id: 'guide', label: 'User Guide', path: '/guide', icon: 'help-circle', featureKey: null },
    ],
  },
  {
    id: 'productivity',
    label: 'Productivity',
    items: [
      { id: 'goals', label: 'Goals', path: '/goals', icon: 'target', featureKey: 'goals', badgeKey: 'missionReminder' },
      { id: 'student', label: 'Student', path: '/student/quiz', icon: 'graduation-cap', featureKey: 'student', matchPrefix: true },
    ],
  },
  {
    id: 'ai-tools',
    label: 'AI tools',
    items: [
      { id: 'chains', label: 'Prompt Chains', path: '/chains', icon: 'chains', featureKey: 'chains' },
      { id: 'graph', label: 'Knowledge Graph', path: '/graph', icon: 'share-2', featureKey: 'graph' },
      { id: 'debate', label: 'Multi-Model Debate', path: '/debate', icon: 'debate', featureKey: 'debate' },
      { id: 'compare', label: 'Document Compare', path: '/compare', icon: 'compare', featureKey: 'compare' },
      { id: 'documentRedaction', label: 'Document redaction', path: '/document-redaction', icon: 'file-pen', featureKey: 'documentRedaction', matchPrefix: true },
    ],
  },
  {
    id: 'content-tools',
    label: 'Content tools',
    items: [
      { id: 'pdf', label: 'PDF Tools', path: '/pdf', icon: 'file-text', featureKey: 'pdf' },
      { id: 'graphics', label: 'Graphics', path: '/graphics', icon: 'palette', featureKey: 'graphics' },
      { id: 'videos', label: 'Video Tools', path: '/videos', icon: 'film', featureKey: 'videos' },
      { id: 'recipes', label: 'Recipes', path: '/recipes', icon: 'utensils', featureKey: 'recipes' },
      { id: 'productScout', label: 'Amazon Search', path: '/product-scout', icon: 'productScout', featureKey: 'productScout' },
      { id: 'youtube', label: 'YouTube', path: '/youtube', icon: 'youtube', featureKey: 'youtube' },
    ],
  },
  {
    id: 'website',
    label: 'Website',
    items: [
      { id: 'seo', label: 'SEO', path: '/seo', icon: 'scan-search', featureKey: 'seo', matchPrefix: true },
      { id: 'searchConsole', label: 'Search', path: '/search-console', icon: 'line-chart', featureKey: 'searchConsole' },
      { id: 'googleAds', label: 'Adwords', path: '/google-ads', icon: 'megaphone', featureKey: 'googleAds', matchPrefix: true },
      { id: 'domains', label: 'Domain', path: '/domains', icon: 'globe', featureKey: 'domains' },
      { id: 'html', label: 'HTML', path: '/html', icon: 'gauge', featureKey: 'html', matchPrefix: true },
      { id: 'themeBuilder', label: 'WP Theme Builder', path: '/theme-builder', icon: 'blocks', featureKey: 'themeBuilder' },
    ],
  },
  {
    id: 'money-data',
    label: 'Money & data',
    items: [
      { id: 'finance', label: 'Finance', path: '/finance', icon: 'finance', featureKey: 'finance' },
      { id: 'propertyScenario', label: 'Property scenario', path: '/property-scenario', icon: 'home', featureKey: 'propertyScenario' },
      { id: 'shares', label: 'Shares', path: '/shares', icon: 'shares', featureKey: 'shares' },
      { id: 'usage', label: 'Usage & Cost', path: '/usage', icon: 'usage', featureKey: 'usage' },
      { id: 'newsDigest', label: 'News Digest', path: '/news-digest', icon: 'news', featureKey: 'newsDigest' },
    ],
  },
  {
    id: 'personal',
    label: 'Personal',
    items: [
      { id: 'mood', label: 'Mood', path: '/mood', icon: 'mood', featureKey: 'mood' },
      { id: 'wellbeing', label: 'Wellbeing Check', path: '/wellbeing', icon: 'heart-pulse', featureKey: 'wellbeing' },
      { id: 'gmailIntel', label: 'Inbox Intel', path: '/gmail-intel', icon: 'inbox', featureKey: 'gmailIntel' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    items: [
      { id: 'suggestions', label: 'Suggestions', path: '/suggestions', icon: 'inbox', featureKey: null, badgeKey: 'suggestions' },
      { id: 'clients', label: 'Clients', path: '/clients', icon: 'briefcase', featureKey: 'clients', matchPrefix: true },
      { id: 'admin', label: 'Dashboard', path: '/admin', icon: 'bar-chart', featureKey: null, adminOnly: true },
    ],
  },
];

export function isNavItemActive(item, pathname, search = '') {
  if (item.path.includes('?')) {
    const [path, query] = item.path.split('?');
    return pathname === path && String(search).includes(query);
  }
  if (item.matchPrefix) return pathname.startsWith(item.path.replace(/\/[^/]+$/, '') || item.path);
  if (item.path === '/student/quiz') return pathname.startsWith('/student');
  if (item.path === '/clients') return pathname.startsWith('/clients');
  if (item.path === '/suggestions') return pathname === '/suggestions';
  return pathname === item.path;
}

export function filterNavGroups({ groups = APP_NAV_GROUPS, canUseFeature, isAdmin = false }) {
  return groups
    .map(g => ({
      ...g,
      items: g.items.filter(item => {
        if (item.adminOnly && !isAdmin) return false;
        if (!item.featureKey) return true;
        return canUseFeature(item.featureKey);
      }),
    }))
    .filter(g => g.items.length > 0);
}

export const SIDEBAR_WORKSPACE_LINKS = [
  { id: 'tasks', label: 'Tasks', path: '/tasks', icon: 'list-checks' },
  { id: 'notes', label: 'Notes', path: '/notes', icon: 'pen-line' },
  { id: 'goals', label: 'Goals', path: '/goals', icon: 'target', featureKey: 'goals' },
  { id: 'clients', label: 'Clients', path: '/clients', icon: 'briefcase', featureKey: 'clients', matchPrefix: true },
];

/** 7 Habits shortcuts — shown in Apps launcher when habitsSidebar + goals are enabled. */
export const HABITS_NAV_GROUP = {
  id: 'seven-habits',
  label: '7 Habits',
  items: [
    { id: 'habits-mission', label: 'Mission Statement', path: '/goals?section=mission', icon: 'compass', featureKey: 'goals' },
    { id: 'habits-matrix', label: 'Priority Matrix', path: '/tasks?view=matrix', icon: 'layout-grid', featureKey: null },
    { id: 'habits-renewal', label: 'Renewal Balance', path: '/goals?section=renewal', icon: 'heart-pulse', featureKey: 'goals' },
  ],
};

export function shouldShowHabitsNav(canUseFeature) {
  return canUseFeature('goals') && canUseFeature('habitsSidebar');
}

export function getAppsNavGroups({ canUseFeature, isAdmin = false }) {
  const groups = filterNavGroups({ canUseFeature, isAdmin });
  if (!shouldShowHabitsNav(canUseFeature)) return groups;
  const habitsItems = HABITS_NAV_GROUP.items.filter((item) => !item.featureKey || canUseFeature(item.featureKey));
  if (habitsItems.length === 0) return groups;
  return [{ ...HABITS_NAV_GROUP, items: habitsItems }, ...groups];
}
