'use strict';

// The Burner Mail guide (the round button on Vault's /burner-mail page): a person says what they want to do ("sign up for Spotify without
// my real email", "where is my code", "is this link safe") and the guide points at the real controls, in order, or says plainly that
// Burner Mail does not do it. It only knows what is written here and it never sees any address, email, code or link. Built on guideCore.js;
// the ids are the page's own, listed in client/src/pages/burnerMail/burnerMailTools.mjs (a test keeps the two in step).
// See docs/guide-chat.md and docs/burner-mail.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'make', label: 'New address', group: 'Make an address',
    does: 'The New address box at the top. Optionally type what the address is for (for example Spotify), choose how long to keep it, and press Make address. It makes an address on the owner\'s own domain, such as spotify-a1b2c3@theirdomain, and selects it so its inbox shows on the right.',
    notes: 'The label only makes the address easier to recognise. If Burner Mail has not been set up on the server yet, a note says so and Make address is switched off. Up to 50 live addresses at a time.' },
  { id: 'keep', label: 'Keep for', group: 'Make an address',
    does: 'The Keep choice beside Make address sets how long the address works: 1 day, 7 days (the default) or 30 days. After that it stops receiving mail, and it is removed a day later with its emails.',
    notes: 'It is chosen when the address is made and cannot be extended afterwards: make a new address instead.' },
  { id: 'addresses', label: 'Your addresses', group: 'Make an address',
    does: 'The list on the left shows every live address with its label and how many emails it has received. Click one to see its inbox. The bin on an address deletes it and all its emails, after a Yes / No question.',
    notes: 'Deleting is permanent: there is no recycle bin for Burner Mail.' },
  { id: 'copy-address', label: 'Copy address', group: 'Inbox',
    does: 'Above the inbox, Copy address copies the selected address so you can paste it into the sign-up form on the other website.',
    notes: 'Use the address exactly as shown.' },
  { id: 'inbox', label: 'Inbox', group: 'Inbox',
    does: 'The emails that reach the selected address, newest first. The page checks for new mail every few seconds while it is open, and says when it last checked. Each email shows who sent it, the subject and the time. Show full text opens the plain text of the email.',
    notes: 'Nothing arrives until the other site sends its email, which can take a few seconds to a couple of minutes. Only plain text is shown, never the email\'s pictures or layout.' },
  { id: 'codes', label: 'Codes', group: 'Inbox',
    does: 'When an email contains a verification code, it is shown in large type with a Copy button, ready to paste into the other site. If several numbers look like codes they are all listed as possible codes, best first.',
    notes: 'The code is found by looking for numbers near words like code or verification, so check it against the email text if the site rejects it.' },
  { id: 'links', label: 'Links', group: 'Inbox',
    does: 'Links in the email are listed with the site name in bold. Ones that look like a confirm or verify link are marked confirm and listed first. Each has Copy link and Open. Open goes to that link in a new tab.',
    notes: 'Burner Mail never opens a link itself. Check the site name matches the service you signed up for before you press Open.' },
  { id: 'delete-email', label: 'Delete an email', group: 'Inbox',
    does: 'The bin at the top right of an email deletes just that email, after a Yes / No question.',
    notes: 'Deleting is permanent.' },
];

const RULES = [
  'Make the address first, copy it, use it on the other website\'s sign-up form, then come back to the inbox and wait for the email.',
  'The inbox refreshes by itself every few seconds while the page is open. There is no refresh button.',
  'Codes and links are found by code, not by guesswork about the site, so they can occasionally be missed or wrong: the full text is one click away.',
  'Burner Mail never opens a link and never clicks anything for the person.',
  'Only plain text, codes and link addresses are kept. Emails are removed when their address expires or is deleted.',
  'An address only receives mail until it expires. Mail sent to an expired or deleted address is lost.',
  'The Open buttons in this chat only switch to a tool; they never make, copy or delete anything by themselves.',
];

const NOT_POSSIBLE = [
  'Sending email or replying: addresses only receive.',
  'Filling in the sign-up form on the other website (the Browser Agent can help with forms, but it does not read this inbox).',
  'Getting past a website that refuses to accept the address; some sites block unfamiliar domains and nothing here can change that.',
  'Receiving mail after an address has expired, or extending an address.',
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
- If they ask why an email has not arrived, say how long it can take, that the page checks by itself, and that some sites refuse unfamiliar addresses.
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
