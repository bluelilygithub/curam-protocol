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
      { id: 'domains', label: 'Domain & Brand', path: '/domains', icon: 'globe', featureKey: 'domains' },
      { id: 'productScout', label: 'Amazon Search', path: '/product-scout', icon: 'productScout', featureKey: 'productScout' },
      { id: 'themeBuilder', label: 'WP Theme Builder', path: '/theme-builder', icon: 'blocks', featureKey: 'themeBuilder' },
      { id: 'youtube', label: 'YouTube', path: '/youtube', icon: 'youtube', featureKey: 'youtube' },
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

export function isNavItemActive(item, pathname) {
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
