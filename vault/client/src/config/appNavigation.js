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
      { id: 'showcase', label: 'Client Showcase', path: 'https://claude.ai/artifact/STxyMcZUUHCVBZniFbxhtP', icon: 'external-link', featureKey: null, external: true },
    ],
  },
  {
    // Things waiting for your attention/review — deliberately separate from Business, since
    // these are triage inboxes (agent findings, flagged emails, extracted invoices pending
    // approval), not the underlying business records themselves.
    id: 'inbox',
    label: 'Inbox',
    items: [
      { id: 'suggestions', label: 'Suggestions', path: '/suggestions', icon: 'inbox', featureKey: null, badgeKey: 'suggestions' },
      { id: 'gmailIntel', label: 'Inbox Intel', path: '/gmail-intel', icon: 'inbox', featureKey: 'gmailIntel' },
      { id: 'expenseReview', label: 'Invoice Review', path: '/expense-review', icon: 'receipt', featureKey: 'gmailIntel' },
    ],
  },
  {
    // Business operations — CRM/Pipeline (previously stranded under "Admin") and
    // Finance/Shares (previously under a "Money & data" grab-bag with Usage/News, neither of
    // which is actually money) now sit together as the coherent "running the business" set.
    // Dashboard folded in here too rather than being a 1-item "Admin" group on its own — it
    // stays admin-only via adminOnly, unrelated to which group it's filed under.
    id: 'business',
    label: 'Business',
    items: [
      { id: 'clients', label: 'CRM', path: '/clients', icon: 'briefcase', featureKey: 'clients', matchPrefix: true },
      { id: 'pipeline', label: 'Pipeline', path: '/pipeline', icon: 'trending-up', featureKey: 'clients' },
      { id: 'finance', label: 'Finance', path: '/finance', icon: 'finance', featureKey: 'finance' },
      { id: 'shares', label: 'Shares', path: '/shares', icon: 'shares', featureKey: 'shares' },
      { id: 'admin', label: 'Dashboard', path: '/admin', icon: 'bar-chart', featureKey: null, adminOnly: true },
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
      { id: 'documentRedaction', label: 'Redaction', path: '/document-redaction', icon: 'file-pen', featureKey: 'documentRedaction', matchPrefix: true },
      { id: 'contractReview', label: 'Contract Review', path: '/contract-review', icon: 'clipboard-list', featureKey: 'contractReview', matchPrefix: true },
    ],
  },
  {
    // Trimmed to genuine make/edit-a-document-or-media tools — Translate/Guitar/Recipes/
    // YouTube moved out to Research & Utilities, where they're honestly labeled as a catch-all
    // instead of pretending to be content-creation tools.
    id: 'content-creation',
    label: 'Content Creation',
    items: [
      { id: 'pdf', label: 'PDF Tools', path: '/pdf', icon: 'file-text', featureKey: 'pdf' },
      { id: 'fonts', label: 'Font Customizer', path: '/fonts', icon: 'type', featureKey: 'fonts' },
      { id: 'restyle', label: 'CSS', path: '/restyle', icon: 'brush', featureKey: 'restyle' },
      { id: 'graphics', label: 'Graphics', path: '/graphics', icon: 'palette', featureKey: 'graphics' },
      { id: 'videos', label: 'Video Tools', path: '/videos', icon: 'film', featureKey: 'videos' },
    ],
  },
  {
    id: 'website',
    label: 'Web & SEO',
    items: [
      { id: 'seo', label: 'SEO', path: '/seo', icon: 'scan-search', featureKey: 'seo', matchPrefix: true },
      { id: 'searchConsole', label: 'Search', path: '/search-console', icon: 'line-chart', featureKey: 'searchConsole' },
      { id: 'googleAds', label: 'Adwords', path: '/google-ads', icon: 'megaphone', featureKey: 'googleAds', matchPrefix: true },
      { id: 'domains', label: 'Domain', path: '/domains', icon: 'globe', featureKey: 'domains' },
      { id: 'html', label: 'Lighthouse', path: '/html', icon: 'gauge', featureKey: 'html', matchPrefix: true },
      { id: 'webExtractor', label: 'Web Extractor', path: '/web-extractor', icon: 'scissors', featureKey: 'webExtractor' },
      { id: 'themeBuilder', label: 'WP Theme Builder', path: '/theme-builder', icon: 'blocks', featureKey: 'themeBuilder' },
      { id: 'browserAgent', label: 'Browser Agent', path: '/browser-agent', icon: 'mouse-pointer', featureKey: 'browserAgent' },
    ],
  },
  {
    // Honest catch-all — these never fit "content creation" or "business," so name the
    // category for what it actually is instead of hiding them in a mismatched group.
    id: 'research-utilities',
    label: 'Research & Utilities',
    items: [
      { id: 'translate', label: 'Translate', path: '/translate', icon: 'languages', featureKey: 'translate' },
      { id: 'guitar',    label: 'Guitar',    path: '/guitar',    icon: 'guitar',    featureKey: 'guitar'    },
      { id: 'recipes', label: 'Recipes', path: '/recipes', icon: 'utensils', featureKey: 'recipes' },
      { id: 'youtube', label: 'YouTube', path: '/youtube', icon: 'youtube', featureKey: 'youtube' },
      { id: 'productScout', label: 'Amazon Search', path: '/product-scout', icon: 'productScout', featureKey: 'productScout' },
    ],
  },
  {
    // Genuinely personal only now — Inbox Intel/Invoice Review moved to Inbox (work triage,
    // not personal wellbeing), News Digest and Property moved in from the old "Money & data"
    // (News is reading, not finance; Property here is personal mortgage/property planning,
    // not a business asset — confirm this stays true if that ever changes).
    id: 'personal',
    label: 'Personal',
    items: [
      { id: 'mood', label: 'Mood', path: '/mood', icon: 'mood', featureKey: 'mood' },
      { id: 'wellbeing', label: 'Wellbeing Check', path: '/wellbeing', icon: 'heart-pulse', featureKey: 'wellbeing' },
      { id: 'newsDigest', label: 'News Digest', path: '/news-digest', icon: 'news', featureKey: 'newsDigest' },
      { id: 'propertyScenario', label: 'Property', path: '/property-scenario', icon: 'home', featureKey: 'propertyScenario' },
    ],
  },
  {
    // Usage & Cost moved here from "Money & data" — it's app-cost monitoring, not personal
    // finance.
    id: 'productivity',
    label: 'Productivity',
    items: [
      { id: 'goals', label: 'Goals', path: '/goals', icon: 'target', featureKey: 'goals', badgeKey: 'missionReminder' },
      { id: 'student', label: 'Student', path: '/student/quiz', icon: 'graduation-cap', featureKey: 'student', matchPrefix: true },
      { id: 'usage', label: 'Usage & Cost', path: '/usage', icon: 'usage', featureKey: 'usage' },
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
  { id: 'clients', label: 'CRM', path: '/clients', icon: 'briefcase', featureKey: 'clients', matchPrefix: true },
  { id: 'pipeline', label: 'Pipeline', path: '/pipeline', icon: 'trending-up', featureKey: 'clients' },
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

/** Flat catalog of every nav item (id → item + its default group), for the
 * admin nav-layout editor — the editor works from the full catalog, not from
 * what's currently visible to the logged-in admin, so nothing is hidden while
 * arranging it. Includes the 7 Habits shortcuts too (getAppsNavGroups prepends
 * them at runtime, so applyNavLayout sees them and — if the editor didn't also
 * expose them here — they'd only ever land in the auto "Unsorted" group with
 * no way to place them). */
export function getNavItemCatalog() {
  const byId = {};
  for (const group of [...APP_NAV_GROUPS, HABITS_NAV_GROUP]) {
    for (const item of group.items) {
      byId[item.id] = { ...item, defaultGroupId: group.id, defaultGroupLabel: group.label };
    }
  }
  return byId;
}

const UNSORTED_GROUP_ID = '__unsorted';

/**
 * Splits the (already feature/admin-filtered) flat groups from getAppsNavGroups
 * into the admin's two-set nav_layout, when one is configured. Any visible item
 * the layout doesn't mention (new feature shipped since the layout was last
 * saved, or never placed) lands in an auto "Unsorted" group in set 1 — it's
 * never silently dropped from the nav.
 *
 * Returns null when no layout is configured, so callers fall back to rendering
 * `groups` as a single dropdown exactly as before.
 */
export function applyNavLayout(navLayout, groups) {
  if (!navLayout || !Array.isArray(navLayout.sets) || navLayout.sets.length !== 2) return null;

  const itemsById = {};
  for (const group of groups) for (const item of group.items) itemsById[item.id] = item;
  const placedIds = new Set();

  const sets = navLayout.sets.map((set) => ({
    id: set.id,
    label: set.label || 'Apps',
    groups: (set.groups || [])
      .map((g) => ({
        id: g.id,
        label: g.label || 'Group',
        items: (g.itemIds || [])
          .map((id) => itemsById[id])
          .filter(Boolean),
      }))
      .filter((g) => g.items.length > 0),
  }));

  sets.forEach((set) => set.groups.forEach((g) => g.items.forEach((item) => placedIds.add(item.id))));

  const unsorted = groups.flatMap((g) => g.items).filter((item) => !placedIds.has(item.id));
  if (unsorted.length > 0) {
    sets[0].groups.push({ id: UNSORTED_GROUP_ID, label: 'Unsorted', items: unsorted });
  }

  return sets;
}
