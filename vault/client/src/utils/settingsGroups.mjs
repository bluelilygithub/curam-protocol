// The Settings page's sections, grouped by purpose. One list drives the left-hand menu, the phone dropdown, the search box and the
// "is this tab allowed" check, so a section can never appear in one and be missing from another.
// `admin: true` sections (and every section of an admin-only group) are hidden from members.

export const SETTINGS_GROUPS = [
  { id: 'you', label: 'You', tabs: [
    { id: 'Appearance', tip: 'Theme, font, icons and how Vault looks for you.' },
    { id: 'Profile', tip: 'Your name, details and password.' },
    { id: 'Tasks', tip: 'How your tasks behave.' },
    { id: 'Recycle bin', tip: 'Things you deleted in the last 30 days, ready to put back.' },
    { id: 'Goals', tip: 'Goals and reviews.', admin: true },
    { id: 'Tours', tip: 'Replay the guided tours of each part of Vault.', admin: true },
  ] },
  { id: 'ai', label: 'AI and tools', admin: true, tabs: [
    { id: 'AI & Chat', tip: 'Which AI models are available and which one is the default.' },
    { id: 'Translation', tip: 'Languages and translation choices.' },
    { id: 'Amazon Search', tip: 'The Amazon store Product Scout searches.' },
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

/** The groups a person may see, with the sections they may open. Empty groups are dropped. */
export function visibleGroups(isAdmin, groups = SETTINGS_GROUPS) {
  return groups
    .filter((g) => isAdmin || !g.admin)
    .map((g) => ({ ...g, tabs: g.tabs.filter((t) => isAdmin || !t.admin) }))
    .filter((g) => g.tabs.length > 0);
}

/** Every section id a person may open, in menu order. */
export function allowedTabIds(isAdmin, groups = SETTINGS_GROUPS) {
  return visibleGroups(isAdmin, groups).flatMap((g) => g.tabs.map((t) => t.id));
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
