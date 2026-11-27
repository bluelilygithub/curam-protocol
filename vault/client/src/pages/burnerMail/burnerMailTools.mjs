// What the Burner Mail page is made of, the plain-words help for it, and the controls its guide (the round button) can point at. The ids
// are the guide's catalogue (server/services/burnerMailTutor.js); npm run test:burner-mail-tutor fails if the two lists drift apart.
// BURNER_TOOLS is the left-hand menu (ToolSidebar); `tool` on a guide entry says which menu item its Open button shows.

export const BURNER_TOOLS = [
  { id: 'make', label: 'New burn', group: 'Create', icon: 'plus' },
  { id: 'live', label: 'Live burns', group: 'Burns', icon: 'mail' },
  { id: 'saved', label: 'Saved burns', group: 'Burns', icon: 'star' },
];

export const GROUPS = ['Create', 'Burns'];

export const GROUP_TIPS = {
  Create: 'Make a new throw-away address (a burn) for a sign-up.',
  Burns: 'Your burns, each with a number like B-12. Open one to copy its address and read its codes and links.',
};

export const TOOL_TIPS = {
  make: 'Make a new throw-away address on your own domain for a sign-up. Choose how long to keep it, or save it later to keep it for good.',
  live: 'Every burn that still receives mail, saved ones included, newest first. Search by name, address or number (B-12).',
  saved: 'Only the burns you saved. A saved burn never expires; it stays until you delete it.',
};

export const TOOL_BLURBS = {
  make: 'Make a burn, use its address on a sign-up form, then wait for the email.',
  live: 'Every burn that still receives mail.',
  saved: 'Burns you saved to keep. They never expire.',
};

/** The reference shown everywhere for a burn, like T-12 for a ticket. */
export const burnNo = (b) => `B-${b.id}`;

/** Search a burn list by name, address or number ("B-12", "b12" or "12"). */
export function matchesBurn(b, q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return true;
  const n = s.replace(/^b-?/, '');
  if (/^\d+$/.test(n) && String(b.id) === n) return true;
  return String(b.label || '').toLowerCase().includes(s) || String(b.address || '').toLowerCase().includes(s);
}

// The longer text for the (i) "How Burner Mail works" box.
export const HOW_IT_WORKS = [
  ['Make a burn', 'Press New burn, type what it is for (optional), choose how long to keep it, and press Make burn. Copy the address and use it on the sign-up form of the other website.'],
  ['Refer to it by number', 'Every burn has a number like B-12, the same way tickets have T-12. Type the number in the search box of Live burns or Saved burns to find it again.'],
  ['Save the ones you need', 'Press Save on a burn to keep it for good: it never expires and keeps receiving mail until you delete it. Unsave gives it seven more days.'],
  ['Wait for the email', 'An open burn checks for new mail every few seconds. The code appears in large type with a Copy button, and any confirm link is listed first.'],
  ['Links are never opened for you', 'Each link shows its site name. Check it matches the service you signed up for, then Open or Copy link.'],
  ['What is kept', 'Only the plain text of each email, its codes and its link addresses. Pictures and layout are never kept. An unsaved burn stops working when it expires, and it is removed a day later with its emails. Deleting a burn or an email is permanent.'],
  ['Be patient', 'Some sites take ten minutes or more to send the email. Wait before pressing Resend on the other site; repeated resends can slow it down.'],
  ['Limits', 'Some websites refuse unfamiliar email domains. Addresses only receive mail; they cannot send or reply.'],
];

// Everything the guide can point at: the menu items plus the controls inside them. `tool` is the menu item the Open button shows.
export const GUIDE_TOOLS = [
  { id: 'make', label: 'New burn', tool: 'make' },
  { id: 'keep', label: 'Keep for', tool: 'make' },
  { id: 'live', label: 'Live burns', tool: 'live' },
  { id: 'saved', label: 'Saved burns', tool: 'saved' },
  { id: 'save', label: 'Save', tool: 'live' },
  { id: 'copy-address', label: 'Copy address', tool: 'live' },
  { id: 'inbox', label: 'Inbox', tool: 'live' },
  { id: 'codes', label: 'Codes', tool: 'live' },
  { id: 'links', label: 'Links', tool: 'live' },
  { id: 'delete-email', label: 'Delete an email', tool: 'live' },
];
