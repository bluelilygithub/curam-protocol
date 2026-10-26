// What the Password Vault page shows in its left-hand list, the hover text for it, and the controls its guide (the round button) can point
// at. The ids are the guide's catalogue (server/services/passwordVaultTutor.js); npm run test:password-vault-tutor fails if the two lists
// drift apart. `tool` is the page the guide's Open button switches to.

export const VAULT_TOOLS = [
  { id: 'passwords', label: 'My passwords', group: 'Keep', icon: 'key-round', tour: 'vault-tab-passwords' },
  { id: 'generator', label: 'Password generator', group: 'Make', icon: 'refresh-cw', tour: 'vault-tab-generator' },
  { id: 'health', label: 'Password health', group: 'Check', icon: 'shield-check', tour: 'vault-tab-health' },
  { id: 'master', label: 'Master password and lock', group: 'Safety', icon: 'lock', tour: 'vault-tab-master' },
];

export const GROUPS = ['Keep', 'Make', 'Check', 'Safety'];

export const GROUP_TIPS = {
  Keep: 'Your saved logins: add, find, copy, link to a client, delete.',
  Make: 'Make a strong random password to copy or save. A login\'s own Make one button opens the same options.',
  Check: 'Spot passwords that are weak, reused or old.',
  Safety: 'Set up or change the master password, lock the vault, and choose how soon it locks itself.',
};

export const TOOL_TIPS = {
  passwords: 'Your saved logins. Search them, filter by client, copy a password without showing it, and add or change one. Needs the master password.',
  generator: 'Make a random password: choose the length, which characters to use and which to never use. Made on this device and not saved until you put it in a login.',
  health: 'Looks over your saved passwords on this device and lists any that are weak, used twice or not changed for over a year.',
  master: 'Create or change the master password, lock the vault now, choose the auto-lock time, or start again if the master password is forgotten.',
};

// One short line shown under the page title for the open tool.
export const TOOL_BLURBS = {
  passwords: 'Everything here is locked on this device before it is saved. Vault only stores scrambled text it cannot read.',
  generator: 'Strong random passwords, made on this device. Nothing is saved until you put one in a login.',
  health: 'A check of your saved passwords, done on this device.',
  master: 'The one password that opens everything. Vault never sees it and cannot recover it.',
};

// The longer text for the (i) "How Password Vault works" box.
export const HOW_IT_WORKS = [
  ['The master password', 'You choose one master password. Your browser turns it into a key and locks every login with it before anything is sent. Vault stores only scrambled text, so nobody who gets into the database, including the owner of this Vault, can read your passwords.'],
  ['No way back in', 'Because Vault never sees the master password, it cannot reset it. If it is forgotten, the only option is to erase the vault and start again. Pick something you will remember and keep a copy somewhere safe, away from the computer.'],
  ['Adding and finding logins', 'Add a login with its title, username, web address, password and notes. Search by any of them. Copy puts the password on the clipboard without showing it, and clears it again after 30 seconds.'],
  ['Clients', 'A login can be linked to one of your clients, then found by filtering on that client. The link is the only thing not locked, so the client\'s name can be shown. It does not share the login with anyone.'],
  ['Generator and health', 'The generator makes random passwords on this device. Make one on a login opens it with its own rules (length, characters, characters to avoid), which can be kept with that login. Password health lists weak, reused and old passwords. Both work on this device only; health cannot tell if a password was in a data breach.'],
  ['Locking', 'The vault locks itself after a quiet spell (5 minutes unless you change it), when the page is reloaded and when you sign out. You can lock it yourself at any time.'],
  ['Deleting', 'A deleted login goes to the Recycle bin for 30 days and can be put back. It stays locked there too.'],
  ['Not included', 'Filling logins into websites for you, sharing a login with another person, one-time codes, importing from another password manager, and breach checks.'],
];

// Everything the guide can point at: the four tools plus the controls inside them.
export const GUIDE_TOOLS = [
  { id: 'passwords', label: 'My passwords', tool: 'passwords' },
  { id: 'add-password', label: 'Add a password', tool: 'passwords' },
  { id: 'login-rules', label: 'Rules for one login', tool: 'passwords' },
  { id: 'client-link', label: 'Link to a client', tool: 'passwords' },
  { id: 'client-filter', label: 'Filter by client', tool: 'passwords' },
  { id: 'copy-password', label: 'Copy password', tool: 'passwords' },
  { id: 'delete-password', label: 'Delete and undo', tool: 'passwords' },
  { id: 'generator', label: 'Password generator', tool: 'generator' },
  { id: 'generator-options', label: 'Length and characters', tool: 'generator' },
  { id: 'health', label: 'Password health', tool: 'health' },
  { id: 'master', label: 'Master password and lock', tool: 'master' },
  { id: 'lock-now', label: 'Lock now', tool: 'master' },
  { id: 'auto-lock', label: 'Auto-lock time', tool: 'master' },
  { id: 'change-master', label: 'Change master password', tool: 'master' },
  { id: 'reset-vault', label: 'Erase and start again', tool: 'master' },
];
