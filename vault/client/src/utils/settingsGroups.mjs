// The Settings page's sections, grouped by purpose. One list drives the left-hand menu, the phone dropdown, the search box and the
// "is this tab allowed" check, so a section can never appear in one and be missing from another.
// `admin: true` sections (and every section of an admin-only group) are hidden from members.
// `feature: 'key'` sections are hidden from members unless that feature is on for them (the flags the page loaded); admins always see them.

export const SETTINGS_GROUPS = [
  { id: 'you', label: 'You', tabs: [
    { id: 'Appearance', tip: 'Theme, font, icons and how Vault looks for you.' },
    { id: 'Profile', tip: 'Your name, details and password.' },
    { id: 'Tasks', tip: 'How your tasks behave.' },
    { id: 'Recycle bin', tip: 'Things you deleted in the last 30 days, ready to put back.' },
    { id: 'Vault Shelf', tip: 'Keys that connect the Vault Shelf Windows app to your Vault.', feature: 'shelf' },
    { id: 'Goals', tip: 'Goals and reviews.', admin: true },
    { id: 'Tours', tip: 'Replay the guided tours of each part of Vault.', admin: true },
  ] },
  { id: 'ai', label: 'AI and tools', admin: true, tabs: [
    { id: 'AI & Chat', tip: 'Which AI models are available and which one is the default.' },
    { id: 'Translation', tip: 'Languages and translation choices.' },
    { id: 'Amazon Search', tip: 'The Amazon store Product Scout searches.' },
    { id: 'Topic Research', tip: 'Which AI model writes Topic Research briefs.' },
    { id: 'Shares', tip: 'Share portfolio alerts and options.' },
    { id: 'Integrations', tip: 'Connect Gmail, Calendar and Drive.' },
  ] },
  { id: 'workspace', label: 'Workspace', admin: true, tabs: [
    { id: 'Members', tip: 'Add and manage the people who use this workspace.' },
    { id: 'Feature Access', tip: 'Turn parts of Vault on or off for everyone.' },
    { id: 'Wellbeing Invites', tip: 'The invitation email for Wellbeing.' },
    { id: 'Content Restrictions', tip: 'Topics the AI should not discuss.' },
  ] },
  { id: 'layout', label: 'Layout', admin: true, tabs: [
    { id: 'Mobile', tip: 'What shows on a phone.' },
    { id: 'Navigation', tip: 'Which items appear in the sidebar and in what order.' },
  ] },
  { id: 'system', label: 'System', admin: true, tabs: [
    { id: 'Tool Maintenance', tip: 'Checks that each tool is working.' },
    { id: 'Environment', tip: 'Server settings and connected keys, read only.' },
  ] },
];

/** The groups a person may see, with the sections they may open. Empty groups are dropped. `flags` = the person's feature switches (omit = all off). */
export function visibleGroups(isAdmin, groups = SETTINGS_GROUPS, flags = {}) {
  const shown = (t) => isAdmin || (!t.admin && (!t.feature || flags?.[t.feature] === true));
  return groups
    .filter((g) => isAdmin || !g.admin)
    .map((g) => ({ ...g, tabs: g.tabs.filter(shown) }))
    .filter((g) => g.tabs.length > 0);
}

/** Every section id a person may open, in menu order. */
export function allowedTabIds(isAdmin, groups = SETTINGS_GROUPS, flags = {}) {
  return visibleGroups(isAdmin, groups, flags).flatMap((g) => g.tabs.map((t) => t.id));
}

/** Is this a section that only shows while a feature switch is on (so it must not be treated as "gone" before the switches have loaded)? */
export function isFeatureGatedTab(tabId, groups = SETTINGS_GROUPS) {
  return groups.some((g) => g.tabs.some((t) => t.id === tabId && t.feature));
}

/** Filter by what was typed: matches a section name, its description or its group name; case and spacing do not matter. Blank keeps everything. */
export function filterGroups(groups, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((g) => ({ ...g, tabs: g.tabs.filter((t) => `${t.id} ${t.tip} ${g.label}`.toLowerCase().includes(q)) }))
    .filter((g) => g.tabs.length > 0);
}

/** The group a section belongs to, for the heading above the content. */
export function groupOf(tabId, groups = SETTINGS_GROUPS) {
  return groups.find((g) => g.tabs.some((t) => t.id === tabId)) || null;
}
