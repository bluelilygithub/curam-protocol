// What the Burner Mail page is made of, the plain-words help for it, and the controls its guide (the round button) can point at. The ids
// are the guide's catalogue (server/services/burnerMailTutor.js); npm run test:burner-mail-tutor fails if the two lists drift apart.
// The page has no tool menu, so the two "tools" below are its two areas: `tool` on a guide entry says which area its Open button scrolls to
// (the page marks each area with data-guide="make" / "inbox").

export const BURNER_TOOLS = [
  { id: 'make', label: 'Make an address', group: 'Make an address', icon: 'plus' },
  { id: 'inbox', label: 'Inbox', group: 'Inbox', icon: 'mail' },
];

export const GROUPS = ['Make an address', 'Inbox'];

export const GROUP_TIPS = {
  'Make an address': 'Make a new address, choose how long it lasts, and pick which one you are looking at.',
  Inbox: 'The emails that reach the selected address, with the code and links pulled out.',
};

export const TOOL_TIPS = {
  make: 'Make a new throw-away address on your own domain for a sign-up. Choose how long to keep it.',
  inbox: 'The emails that reach the selected address, newest first, with any verification code and confirm link pulled out. Nothing is opened for you.',
};

export const TOOL_BLURBS = {
  make: 'Make an address, use it on a sign-up form, then wait for the email.',
  inbox: 'Codes and links from the emails that reach the address.',
};

// The longer text for the (i) "How Burner Mail works" box.
export const HOW_IT_WORKS = [
  ['Make an address', 'Type what it is for (optional), choose how long to keep it, and press Make address. Copy it and use it on the sign-up form of the other website.'],
  ['Wait for the email', 'The page checks for new mail every few seconds. A verification email can take a few seconds to a couple of minutes. The code appears in large type with a Copy button, and any confirm link is listed first.'],
  ['Links are never opened for you', 'Each link shows its site name. Check it matches the service you signed up for, then Open or Copy link.'],
  ['What is kept', 'Only the plain text of each email, its codes and its link addresses. Pictures and layout are never kept. An address stops working when it expires, and it is removed a day later with its emails. Deleting an address or an email is permanent.'],
  ['Limits', 'Some websites refuse unfamiliar email domains. Addresses only receive mail; they cannot send or reply.'],
];

// Everything the guide can point at: the two areas plus the controls inside them. `tool` is the area the Open button scrolls to.
export const GUIDE_TOOLS = [
  { id: 'make', label: 'New address', tool: 'make' },
  { id: 'keep', label: 'Keep for', tool: 'make' },
  { id: 'addresses', label: 'Your addresses', tool: 'make' },
  { id: 'copy-address', label: 'Copy address', tool: 'inbox' },
  { id: 'inbox', label: 'Inbox', tool: 'inbox' },
  { id: 'codes', label: 'Codes', tool: 'inbox' },
  { id: 'links', label: 'Links', tool: 'inbox' },
  { id: 'delete-email', label: 'Delete an email', tool: 'inbox' },
];
