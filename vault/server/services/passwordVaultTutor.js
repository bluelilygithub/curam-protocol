'use strict';

// The Password Vault guide (the round button on Vault's /password-vault page): a person says what they want to do ("save a login for a
// client", "make a strong password", "I forgot my master password") and the guide points at the real controls, in order, or says plainly
// that the Password Vault does not do it. It only knows what is written here. It never sees a password, a title, a client name or
// anything stored, and it must never ask for one. Built on guideCore.js; the ids are the page's own, listed in
// client/src/pages/passwordVault/passwordVaultTools.mjs (a test keeps the two in step). See docs/guide-chat.md and docs/password-vault.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'passwords', label: 'My passwords', group: 'Keep',
    does: 'The list of everything saved: a title, the username and which client it belongs to, with a search box and a client filter. Pick one to see it. The first time, it asks for a master password to set the vault up; after that it asks for it to unlock.',
    notes: 'It is locked until the master password is typed, and it locks again by itself after a quiet spell, when the page is reloaded and when the person signs out.' },
  { id: 'add-password', label: 'Add a password', group: 'Keep',
    does: 'The Add a password button opens a form: a title, username, web address, the password and notes. The Make one button beside the password box fills in a strong random password. Save encrypts it on this device before anything is sent.',
    notes: 'Only the title is required.' },
  { id: 'client-link', label: 'Link to a client', group: 'Keep',
    does: 'The Client choice on an entry links it to one of the CRM clients, so it can be found under that client. It can be changed or cleared at any time.',
    notes: 'The link is the one thing stored in plain form (so the client name can be shown); the title, username, password and notes stay encrypted.' },
  { id: 'client-filter', label: 'Filter by client', group: 'Keep',
    does: 'The Client filter above the list shows all passwords, only those with no client, or only those for one client.',
    notes: 'It works together with the search box.' },
  { id: 'copy-password', label: 'Copy password', group: 'Keep',
    does: 'The Copy button next to a password puts it on the clipboard without showing it. The clipboard is cleared again after 30 seconds if nothing else was copied. The eye button shows or hides the password on screen.',
    notes: 'Copy username and Copy address work the same way.' },
  { id: 'delete-password', label: 'Delete and undo', group: 'Keep',
    does: 'Delete asks Yes or No, then moves the entry to the Recycle bin for 30 days. An Undo button appears straight after, and Settings -> Recycle bin lists it too.',
    notes: 'Still encrypted in the bin. If the master password was changed after the delete, that entry cannot be restored.' },
  { id: 'generator', label: 'Password generator', group: 'Make',
    does: 'Makes a random password on this device using the browser\'s secure random numbers. Length, upper and lower case, numbers, symbols, leaving out look-alike characters like O and 0, and requiring at least one of each kind chosen. It shows a rough strength and has Copy and Make another buttons.',
    notes: 'Nothing it makes is sent anywhere or saved until the person adds it to a password entry. It works even when the vault is locked.' },
  { id: 'generator-options', label: 'Length and characters', group: 'Make',
    does: 'The length slider (8 to 64) and the tick boxes for which kinds of character to include and whether to skip look-alikes.',
    notes: 'Longer is stronger than fancier. Some sites refuse certain symbols; untick Symbols for those.' },
  { id: 'health', label: 'Password health', group: 'Check',
    does: 'Looks over everything saved, on this device, and lists passwords that are weak, short, used for more than one login or not changed for over a year. Each finding says which entry and how to fix it. It needs the vault to be unlocked.',
    notes: 'It cannot tell whether a password has appeared in a data breach: that would mean sending it somewhere.' },
  { id: 'master', label: 'Master password and lock', group: 'Safety',
    does: 'Where the vault is set up, unlocked and locked, and where the master password and auto-lock time are changed. Shows whether the vault is locked now.',
    notes: 'The master password is never sent to Vault and Vault cannot recover it.' },
  { id: 'lock-now', label: 'Lock now', group: 'Safety',
    does: 'The Lock now button forgets the key held in this browser tab straight away, so the passwords need the master password again to be read.',
    notes: 'Also available from the status box at the top of the left-hand list.' },
  { id: 'auto-lock', label: 'Auto-lock time', group: 'Safety',
    does: 'Choose how long without any activity before the vault locks itself: 1, 5, 15 or 30 minutes. The default is 5.',
    notes: 'The choice is remembered on this browser only.' },
  { id: 'change-master', label: 'Change master password', group: 'Safety',
    does: 'Needs the current master password and a new one typed twice. Every saved password is decrypted and encrypted again with the new one on this device, then all swapped in together. Takes a few seconds.',
    notes: 'If it fails part-way nothing changes. Passwords already deleted into the Recycle bin cannot be restored afterwards.' },
  { id: 'reset-vault', label: 'Erase and start again', group: 'Safety',
    does: 'For a forgotten master password: erases every saved password for good and lets a new master password be made. The person must type DELETE EVERYTHING to confirm.',
    notes: 'There is no other way back in. Nobody, including the Vault owner, can read or recover the passwords.' },
];

const RULES = [
  'Passwords are locked with a master password that never leaves the browser. Vault stores only scrambled text it cannot read.',
  'If the master password is forgotten the saved passwords are gone: there is no reset by email or by the owner. Say this plainly whenever it matters.',
  'The vault locks itself after a quiet spell, on reload and on sign-out. Locked means the passwords cannot be read until the master password is typed again.',
  'The password generator needs no unlock and saves nothing; it only makes a password to copy or put into an entry.',
  'Linking an entry to a client only files it under that client in the list; it does not share it with anyone. Each person sees only their own vault.',
  'The Open buttons in this chat only switch to a tool; they never read, copy or reveal a password.',
  'Never ask the person to type or paste a password, the master password or any login detail into this chat, and tell them not to if they start to.',
];

const NOT_POSSIBLE = [
  'Recovering a forgotten master password, or reading anyone\'s passwords for them (including the owner of Vault).',
  'Sharing a password with another Vault user or a client, or giving a team member access to one entry.',
  'Filling logins into websites or apps by itself (no browser extension or autofill), or signing in for the person (the Browser Agent does saved site logins).',
  'Checking whether a password has been in a known data breach.',
  'Importing from or exporting to another password manager, or a plain-text backup file.',
  'Two-factor codes (one-time codes) or storing passkeys.',
  'Changing a password on the website itself.',
];

const SYSTEM = `You are the guide to the Password Vault in Vault for one person who keeps logins, some of them for their clients. They say, in everyday words, what they want to do. You point them to the right controls, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say the Password Vault cannot do.
- You cannot see anything stored: no password, title, username, client name or master password. Never state or guess any. If they start typing a password or login into the chat, tell them not to share it with you.
- Be plain and short, as to a friend who is not technical. Explain any security word (encrypted, master password) in a few everyday words the first time you use it.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- If they ask about a forgotten master password, be kind and honest: it cannot be recovered; the only option is Erase and start again.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Password Vault guide', feature: 'password_vault_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'PASSWORD VAULT TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to do with your passwords, in a sentence? Please do not type any password here.',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askPasswordVaultTutor: guide.ask,
};
