'use strict';

// The Burner Mail guide (the round button on Vault's /burner-mail page): a person says what they want to do ("sign up for Spotify without
// my real email", "where is my code", "is this link safe") and the guide points at the real controls, in order, or says plainly that
// Burner Mail does not do it. It only knows what is written here and it never sees any address, email, code or link. Built on guideCore.js;
// the ids are the page's own, listed in client/src/pages/burnerMail/burnerMailTools.mjs (a test keeps the two in step).
// See docs/guide-chat.md and docs/burner-mail.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'make', label: 'New burn', group: 'Create',
    does: 'New burn in the menu on the left. Optionally type what the burn is for (for example Spotify), choose how long to keep it, and press Make burn. It makes an address on the owner\'s own domain, such as spotify-a1b2c3@theirdomain, and opens the new burn with its address ready to copy.',
    notes: 'The name only makes the burn easier to recognise. If Burner Mail has not been set up on the server yet, a note says so and Make burn is switched off. Up to 50 unsaved live burns at a time.' },
  { id: 'keep', label: 'Keep for', group: 'Create',
    does: 'The Keep choice beside Make burn sets how long the address works: 1 day, 7 days (the default) or 30 days, or Keep for good, which saves it straight away. After its time it stops receiving mail, and its emails are deleted a day later, unless it has been saved.',
    notes: 'Use Keep for good for an account you will keep, so password resets still arrive. The number of days cannot be changed afterwards, but Save on the burn keeps it for good. An address is never given to anyone again after it expires or is deleted.' },
  { id: 'live', label: 'Live burns', group: 'Burns',
    does: 'Live burns in the menu lists every burn that still receives mail, saved ones included, newest first. Each shows its number (like B-12), name, address, how many emails it has and when it expires. The search box finds a burn by name, address or number. Click a burn to open it.',
    notes: 'Each burn has a number like B-12, the same way tickets have T-12, so it can be referred to and found again. Inside a burn, the bin deletes it and all its emails after a Yes / No question. Deleting is permanent: there is no recycle bin for Burner Mail.' },
  { id: 'saved', label: 'Saved burns', group: 'Burns',
    does: 'Saved burns in the menu lists only the burns that were saved, with the same search box.',
    notes: 'A burn appears here after Save is pressed on it.' },
  { id: 'save', label: 'Save', group: 'Burns',
    does: 'Inside an open burn, Save keeps it for good: it never expires and keeps receiving mail until it is deleted. Press it again (it then says Saved) to unsave; the burn then expires again, seven days from then at the earliest. Click the burn\'s name at the top to rename it.',
    notes: 'Saving an expired burn brings it back if it has not been removed yet (removal happens a day after expiry).' },
  { id: 'copy-address', label: 'Copy address', group: 'Burns',
    does: 'Inside an open burn, Copy address copies its address so you can paste it into the sign-up form on the other website.',
    notes: 'Use the address exactly as shown.' },
  { id: 'inbox', label: 'Inbox', group: 'Burns',
    does: 'Inside an open burn, the emails that reach it, newest first. It checks for new mail every few seconds while the burn is open, and says when it last checked. Each email shows who sent it, the subject and the time. Show full text opens the plain text of the email.',
    notes: 'Nothing arrives until the other site sends its email, which can take a few seconds, and some sites take ten minutes or more. Pressing Resend on the other site again and again can make it slower, so wait about ten minutes first. Only plain text is shown, never the email\'s pictures or layout.' },
  { id: 'codes', label: 'Codes', group: 'Burns',
    does: 'When an email contains a verification code, it is shown in large type with a Copy button, ready to paste into the other site. If several numbers look like codes they are all listed as possible codes, best first.',
    notes: 'The code is found by looking for numbers near words like code or verification, so check it against the email text if the site rejects it.' },
  { id: 'links', label: 'Links', group: 'Burns',
    does: 'Links in the email are listed with the site name in bold. Ones that look like a confirm or verify link are marked confirm and listed first. Each has Copy link and Open. Open goes to that link in a new tab.',
    notes: 'Burner Mail never opens a link itself. Check the site name matches the service you signed up for before you press Open.' },
  { id: 'delete-email', label: 'Delete an email', group: 'Burns',
    does: 'The bin at the top right of an email deletes just that email, after a Yes / No question.',
    notes: 'Deleting is permanent.' },
];

const RULES = [
  'Make a burn first (New burn), copy its address, use it on the other website\'s sign-up form, then come back to the burn and wait for the email.',
  'The inbox of an open burn refreshes by itself every few seconds. There is no refresh button.',
  'Codes and links are found by code, not by guesswork about the site, so they can occasionally be missed or wrong: the full text is one click away.',
  'Burner Mail never opens a link and never clicks anything for the person.',
  'Only plain text, codes and link addresses are kept. Emails are removed when their burn expires (unless saved) or is deleted. An address is never reissued to anyone, even after it is deleted.',
  'An unsaved burn only receives mail until it expires; a saved one never expires. Mail sent to an expired or deleted address is lost.',
  'The Open buttons in this chat only switch to a tool; they never make, copy or delete anything by themselves.',
];

const NOT_POSSIBLE = [
  'Sending email or replying: addresses only receive.',
  'Filling in the sign-up form on the other website (the Browser Agent can help with forms, but it does not read this inbox).',
  'Getting past a website that refuses to accept the address; some sites block unfamiliar domains and nothing here can change that.',
  'Receiving mail after an address has expired, or extending an address by a set number of days (Save keeps it for good instead).',
  'Showing an email\'s pictures, layout or attachments: only the plain text, codes and links are kept.',
  'Judging whether an email or link is safe or a scam: it only shows the site name so the person can decide.',
  'Forwarding mail to a real inbox.',
];

const SYSTEM = `You are the guide to Burner Mail in Vault for one person who makes throw-away email addresses for web sign-ups and reads the verification emails here. They say, in everyday words, what they want to do. You point them to the right controls, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say Burner Mail cannot do.
- You cannot see any address, email, code or link. Never state or guess what is in them, and never say a link or email is safe or unsafe: tell them to check the site name.
- Be plain and short, as to a friend who is not technical. Avoid jargon.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- If they ask why an email has not arrived, say it can take ten minutes or more with some sites, to wait before pressing Resend on that site, that the page checks by itself, and that some sites refuse unfamiliar addresses.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Burner Mail guide', feature: 'burner_mail_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'BURNER MAIL TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to sign up for or find, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askBurnerMailTutor: guide.ask,
};
