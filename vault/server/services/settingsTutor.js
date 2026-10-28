'use strict';

// The Settings and Admin guide (the round button on Vault's /settings and /admin pages): a person says what they want to change or check
// ("make it dark", "stop a member seeing Finance", "add a user", "which AI model is the default", "is my backup working") and the guide
// points at the real section, in order, or says plainly that it is not a setting. It only knows what is written here and it never sees any
// setting value, key, password or user. Built on guideCore.js; the Settings ids are the page's own section ids (SETTINGS_GROUPS in
// client/src/utils/settingsGroups.mjs) and the admin-… ids are the sections of the Admin page; a test keeps both in step.
// See docs/guide-chat.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  // ---- You ----
  { id: 'Appearance', label: 'Appearance', group: 'You',
    does: 'Settings, Appearance: the theme (colours), font, icon style and other ways Vault looks for you.', notes: 'Only changes how it looks for your own login.' },
  { id: 'Profile', label: 'Profile', group: 'You',
    does: 'Settings, Profile: your name and details, and changing your password.', notes: '' },
  { id: 'Tasks', label: 'Tasks', group: 'You',
    does: 'Settings, Tasks: how your task list behaves.', notes: '' },
  { id: 'Recycle bin', label: 'Recycle bin', group: 'You',
    does: 'Settings, Recycle bin: everything you deleted in the last 30 days from tools that use the shared bin (notes, tasks, goals, chats and more), each with a restore button.',
    notes: 'After 30 days an item is gone for good.' },
  { id: 'Vault Shelf', label: 'Vault Shelf', group: 'You',
    does: 'Settings, Vault Shelf: make, name and revoke the keys that connect the Vault Shelf Windows clipboard app to your Vault. A key is shown once when it is made, and each key can be limited to Notes, Invoice Review, the CRM inbox or the sensitive-data check.',
    notes: 'Only shows for a member when an admin has switched the Vault Shelf feature on for them (Settings, Feature Access, or the member\'s own Features). A key can never do more than the person\'s own account may do. If a key is lost, revoke it and make a new one: the old key cannot be shown again.' },
  { id: 'Goals', label: 'Goals', group: 'You',
    does: 'Settings, Goals: how goals and their reviews work. Admin only.', notes: 'Admin only.' },
  { id: 'Tours', label: 'Tours', group: 'You',
    does: 'Settings, Tours: replay the guided tour of each part of Vault. Admin only.', notes: 'Admin only.' },
  // ---- AI and tools (admin) ----
  { id: 'AI & Chat', label: 'AI & Chat', group: 'AI and tools',
    does: 'Settings, AI & Chat: which AI models are available (the model list) and which one is the default for chat, plus other model slots such as branch suggestions, graphics and embeddings, and the standing custom instructions. Admin only.',
    notes: 'Admin only. The default model is the one used for substantive work; cheaper background tasks use a lighter one from the same list.' },
  { id: 'Translation', label: 'Translation', group: 'AI and tools',
    does: 'Settings, Translation: languages and translation choices. Admin only.', notes: 'Admin only.' },
  { id: 'Amazon Search', label: 'Amazon Search', group: 'AI and tools',
    does: 'Settings, Amazon Search: which Amazon store Product Scout searches. Admin only.', notes: 'Admin only. A server setting can fix the store, in which case it cannot be changed here.' },
  { id: 'Topic Research', label: 'Topic Research', group: 'AI and tools',
    does: 'Settings, Topic Research: which AI model writes Topic Research briefs and which one gives a second opinion on structure. Admin only.', notes: 'Admin only. Empty means the workspace default model.' },
  { id: 'Shares', label: 'Shares (alerts)', group: 'AI and tools',
    does: 'Settings, Shares: the Daily Drop Alert. Holdings falling by at least this percent against the previous close email the admin address on each hourly market check. 0 sends the daily movement after every check (test mode). Admin only.',
    notes: 'Admin only.' },
  { id: 'Integrations', label: 'Integrations', group: 'AI and tools',
    does: 'Settings, Integrations: connect Gmail, Google Calendar and Google Drive, and set Inbox Intel (how often it checks mail, how many emails to read, the model that reads PDF invoices, priority vendor domains). Admin only.',
    notes: 'Admin only.' },
  // ---- Workspace (admin) ----
  { id: 'Members', label: 'Members', group: 'Workspace',
    does: 'Settings, Members: the people in this workspace. Add a user (email and a temporary password, at least 8 characters), make or remove an admin, set a new password for someone, delete a user, and open a member\'s Features panel to switch individual features off for just that person. Below that, Accountant access: a read-only login for your accountant (Finance, and Shares if you turn it on for them, nothing else). To create one enter their email, a password of at least 12 characters and, optionally, an end date, then press Create accountant login. The date field means Access ends on: after that day the login stops working; leave it empty for no end date. Each accountant in the list shows Ends <date>, Expired, Disabled or No end date, and has a Shares on/off button and Disable now / Re-enable. A direct sign-in link to copy is at the top, and every sign-in, page view, export and refused attempt is kept in an activity log that cannot be edited or deleted. Admin only.',
    notes: 'Admin only. There is no public sign-up: accounts are created here. A per-person setting can only turn a feature off, never on beyond what Feature Access allows. The same Users list is on the Admin page.' },
  { id: 'Feature Access', label: 'Feature Access', group: 'Workspace',
    does: 'Settings, Feature Access: switch whole parts of Vault on or off for every member (Finance, Shares, CRM and so on) and the Model Selection (Members) option, then press Save Feature Access. Admin only.',
    notes: 'Admin only. Admins always keep access. To limit one person only, use their Features panel in Members.' },
  { id: 'Wellbeing Invites', label: 'Wellbeing Invites', group: 'Workspace',
    does: 'Settings, Wellbeing Invites: the subject and body of the invitation email for Wellbeing, with placeholders such as {{link}} and {{email}}. Admin only.', notes: 'Admin only.' },
  { id: 'Content Restrictions', label: 'Content Restrictions', group: 'Workspace',
    does: 'Settings, Content Restrictions: topics the AI should not discuss. Admin only.', notes: 'Admin only.' },
  // ---- Layout (admin) ----
  { id: 'Mobile', label: 'Mobile', group: 'Layout',
    does: 'Settings, Mobile: what shows on the phone home screen (tiles) and in the phone navigation. Admin only.', notes: 'Admin only.' },
  { id: 'Navigation', label: 'Navigation', group: 'Layout',
    does: 'Settings, Navigation: which items appear in the sidebar and in what order. Admin only.', notes: 'Admin only.' },
  // ---- System (admin) ----
  { id: 'Tool Maintenance', label: 'Tool Maintenance', group: 'System',
    does: 'Settings, Tool Maintenance: checks that each tool is working and reports available updates, without running system commands. Admin only.', notes: 'Admin only.' },
  { id: 'Environment', label: 'Environment', group: 'System',
    does: 'Settings, Environment: the server\'s settings and which keys are connected, read only. Admin only.',
    notes: 'Admin only and read only. Keys are changed where the app is hosted, not here, and their values are never shown.' },
  // ---- Admin page ----
  { id: 'admin-dashboard', label: 'Admin dashboard', group: 'Admin page',
    does: 'The Admin page (admin only), top section: usage across the workspace for a chosen period (today, this week, this month, last month, 6 months, 12 months or custom dates): projects, chat sessions, messages, searches, debates, comparisons and tokens used.',
    notes: 'Admin only.' },
  { id: 'admin-monitors', label: 'Window and session monitors', group: 'Admin page',
    does: 'The Admin page: Claude Windows (usage against the Claude usage windows) and Session Monitor (today\'s sessions, cache hit rate, cache created and cost).', notes: 'Admin only.' },
  { id: 'admin-errors', label: 'Errors (Sentry)', group: 'Admin page',
    does: 'The Admin page: recent errors and counts from Sentry error tracking, when Sentry is connected. Otherwise it links out to Sentry.', notes: 'Admin only.' },
  { id: 'admin-users', label: 'Users', group: 'Admin page',
    does: 'The Admin page: the same user list as Settings, Members (add, admin on or off, new password, delete, per-person Features) plus the landing page choice for each.', notes: 'Admin only.' },
  { id: 'admin-update-report', label: 'Tool update report', group: 'Admin page',
    does: 'The Admin page: Open update report goes to Settings, Tool Maintenance to review available updates without running commands.', notes: 'Admin only.' },
  { id: 'admin-backups', label: 'Backups', group: 'Admin page',
    does: 'The Admin page: Backup now saves the database and files to Google Drive, with a status card and the list of earlier backups. Each backup in the list has a Restore button that asks you to type a word to confirm.', notes: 'Admin only. Needs Google Drive connected in Settings, Integrations. Restoring replaces current data with the backup, so it is a last resort.' },
];

const RULES = [
  'Settings is a menu of sections down the left (a dropdown on a phone), with a search box. Members see only You: Appearance, Profile, Tasks and Recycle bin (and Vault Shelf, when an admin has switched that feature on for them). Everything else is for admins.',
  'The first user was made the admin. Only an admin sees the Admin page and the admin sections of Settings.',
  'Feature Access works in two layers: the workspace switches (Settings, Feature Access) apply to every member, then an admin can narrow one person further in Members. A person\'s own switch can only turn a feature off, never on.',
  'Admins always keep access to every feature, whatever the switches say.',
  'There is no public sign-up. New people are added by an admin under Members (or on the Admin page), with a temporary password.',
  'The model list and default under AI & Chat decide which AI model each tool uses; tools do not have their own hard-coded model.',
  'Sections marked Admin only do not appear for a member at all.',
  'The Open buttons in this chat only take you to a section; they never change a setting.',
];

const NOT_POSSIBLE = [
  'Seeing or changing the keys and passwords the server uses (Environment is read only and never shows values; they are set where the app is hosted).',
  'Reading anyone\'s password: an admin can only set a new one.',
  'Changing a member\'s chats, files or data from the Admin page.',
  'Letting the public sign up on their own.',
  'Giving a member a feature the whole workspace has switched off.',
  'Seeing any setting\'s current value: this chat cannot see them; it only points to the section.',
];

const SYSTEM = `You are the guide to Settings and the Admin page in Vault, a private AI workspace shared by a small group of people. A person says, in everyday words, what they want to change or check, and you point them to the right section, in order, and explain what it does.

Rules:
- Use ONLY the sections and rules given below. Never invent a setting or a button, and never promise something the notes say Vault cannot do.
- You cannot see any setting, key, password, user or usage figure. Never state or guess them.
- Many sections are for admins only. If the answer needs an admin-only section, say it is for the admin and who can do it; do not tell a member to look for something they will not see.
- Be plain and short, as to a friend who is not technical. Explain any unusual word in a few everyday words the first time you use it.
- Give steps in order. Each step names exactly one section by its id and says in a sentence what to do there.
- If you need one more fact to answer, ask ONE short question and give no steps.
- Warn before anything hard to undo or that affects other people: deleting a user, restoring a backup, switching a feature off for everyone, changing the default AI model.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Settings guide', feature: 'settings_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'section', sectionTitle: 'SETTINGS SECTIONS AND ADMIN PAGE',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to change or check, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askSettingsTutor: guide.ask,
};
