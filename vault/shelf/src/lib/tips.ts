// Every hover tip on the shelf, in one place (so wording is reviewed together and a test can check none is missing). Plain words, what the control does and
// what happens next. Tips for things that change with the situation are functions.
import type { ActionId } from '../bridge/types';
import type { FilterId } from './describe';

export const FILTER_TIPS: Record<FilterId, string> = {
  all: 'Everything you have copied recently, newest first.',
  text: 'Plain text and code.',
  images: 'Pictures and SVG drawings you copied.',
  links: 'Web addresses.',
  tables: 'Copied rows that look like a table or CSV.',
};

export const TIPS = {
  settings: 'Settings: your Vault address and key, shortcut, appearance and privacy.',
  help: 'How Vault Shelf works, in plain words.',
  tour: 'A short walk around the shelf, step by step.',
  copy: 'Put this back on the clipboard so you can paste it. Enter does this and closes the shelf.',
  remove: 'Take this off the shelf. It is also deleted from this PC. (Delete key)',
  back: 'Back to the shelf.',
  backToPreview: 'Close the check and show the copy again.',
  cardStrip: 'Your recent copies. Arrow keys move, 1 to 9 pick one.',

  // settings
  theme: 'Choose how the shelf looks. These are the same themes as Vault.',
  font: 'The same fonts as Vault.',
  recordShortcut: 'Click, then press the new shortcut. It needs Ctrl, Alt or Win plus a key. Esc cancels.',
  resetShortcut: 'Go back to the usual shortcut.',
  startWithWindows: 'Opens quietly in the tray (near the clock) when you sign in to Windows.',
  closeAfterSend: 'Close the shelf a moment after a copy is sent, so you are straight back to work.',
  vaultAddress: 'The web address you use for Vault, for example https://your-app.up.railway.app.',
  ingestKey: 'The key made in Vault under Settings, then Vault Shelf. It is checked with Vault, then kept in Windows Credential Manager. It is never shown again.',
  saveAndCheck: 'Check the address and key with Vault. They are only saved if Vault accepts them.',
  ignorePasswords: 'Skip anything copied from a password manager or marked sensitive by the program it came from.',
  keepLast: 'How many copies stay on the shelf. Older ones are deleted as new ones arrive.',
  autoClear: 'Delete everything on the shelf after this long, even if it has not been used.',
  excludedApp: 'Copies from this program are never kept. Type the program name, for example keepass.exe.',
  addExcluded: 'Add this program to the list.',
  removeExcluded: (name: string) => `Keep copies from ${name} again.`,
  clearHistory: 'Delete every copy on the shelf. This cannot be undone.',
  confirmClear: 'Yes deletes everything on the shelf for good.',
  actionSwitch: (label: string) => `Show or hide the ${label.replace(/^\S+\s/, '')} button under a preview.`,
} as const;

/** What each send button does, in a sentence. The reason a button is greyed replaces it. */
export const ACTION_TIPS: Record<ActionId, string> = {
  notes: 'Save this copy as a note in Vault Notes. You can file it and search it there.',
  crm: 'Send this copy to Vault CRM. It waits in Unfiled from Shelf until you attach it to a client.',
  finance: 'Send this receipt or invoice to Finance for review. Nothing is posted until you approve it in Vault.',
  redact: 'Check this text for private details (emails, phone numbers, ID numbers). Nothing is stored and the tray stays open.',
};

export function cardTip(kind: string, source: string | null, masked: boolean): string {
  if (masked) return 'A secret was found in this copy and hidden. Click to look at it. It is never sent to Vault.';
  return `${kind}${source ? ` copied from ${source}` : ''}. Click to preview. Enter copies it and closes the shelf.`;
}
