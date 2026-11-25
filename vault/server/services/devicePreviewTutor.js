'use strict';

// The Device preview guide (the round button on Vault's /device-preview page): a person says what they want to check ("does my page work on
// an iPhone", "see it on a tablet on its side", "I want a size that is not in the list") and the guide points at the real controls, in order,
// or says plainly that Device preview does not do it. It only knows what is written here and it never sees any address typed or any page.
// Built on guideCore.js; the ids are the page's own, listed in client/src/pages/devicePreview/devicePreviewTools.mjs (a test keeps the two
// in step). See docs/guide-chat.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'address', label: 'Address box', group: 'Show a page',
    does: 'The box at the top. Type the address of a public web page, such as https://www.example.com/, or say it with the microphone. Press Enter or the Show the page button to load it.',
    notes: 'It must be a page anyone can open. A page that needs a login cannot be loaded.' },
  { id: 'script-option', label: 'Builds itself with JavaScript', group: 'Show a page',
    does: 'A tick box under the address. Tick it if the page comes up empty or half-built: the page is opened in a real browser first so its scripts can build it. It is slower and limited to a few an hour.',
    notes: 'It is only offered when the server is set up for it. Even then the page is shown without its scripts, so menus that open and sliders will not work.' },
  { id: 'show', label: 'Show the page', group: 'Show a page',
    does: 'Loads the page and its style files and shows it on every screen chosen below. Press it again with a different address to look at another page.',
    notes: 'It only looks. Nothing is saved and nothing on the page is changed.' },
  { id: 'choose-screens', label: 'Choose screens', group: 'Choose screens',
    does: 'Rows of buttons for Phones (iPhone SE to iPhone 16 Pro Max, Samsung Galaxy, Google Pixel), Tablets (iPad mini, iPad, iPad Air, iPad Pro, Galaxy Tab, Pixel Tablet, Surface Pro) and Laptops and monitors. Tap one to show it and tap it again to remove it. Each shows its width and height. Up to four screens at once.',
    notes: 'Each screen is drawn at the real width of that device, so the page changes shape the way it does there. Sizes are the published screen sizes in CSS pixels; a real phone also has browser bars that use some of the height.' },
  { id: 'own-size', label: 'Your own size', group: 'Choose screens',
    does: 'Two boxes for a width and a height in pixels, and an Add button. The size joins the list and is shown. Up to three of your own sizes; each can be removed with its small x.',
    notes: 'Sizes must be between 200 and 4000 pixels.' },
  { id: 'turn', label: 'Turn on its side', group: 'Choose screens',
    does: 'The phone-symbol button under the choices holds phones and tablets on their side, so a phone becomes wider than it is tall. Press it again to stand them upright.',
    notes: 'Laptops and monitors are never turned.' },
  { id: 'size-on-screen', label: 'Size on screen', group: 'Choose screens',
    does: 'The Fit, 100%, 75% and 50% buttons choose how big each screen is drawn on your page. Fit shrinks each one so it fits without scrolling down. 100% is the real size, which can need scrolling sideways.',
    notes: 'This only changes how big it is drawn. The page still sees the real width of the device.' },
  { id: 'countries', label: 'Screens or Countries', group: 'Countries',
    does: 'Two buttons at the top of the page. Screens is the side-by-side view of devices. Countries shows the page as visitors in other countries see it: each country is opened in a real browser through an internet connection in that country, in its language and time zone.',
    notes: 'The switch only appears when Countries is switched on for the person (an admin turns it on in Settings, Feature Access) and the connection service is set up on the server. Otherwise Countries says it is not set up yet.' },
  { id: 'country-list', label: 'Countries to check', group: 'Countries',
    does: 'Chips with each country code and name. Remove one with its small x, add one from the Add a country list (over 30 countries), and press Save as my list to use the same countries every time.',
    notes: 'Up to 12 countries in one check. The starting list is Australia, New Zealand, United States, United Kingdom, Germany and Japan.' },
  { id: 'country-screens', label: 'Screens for the check', group: 'Countries',
    does: 'The same phone, tablet and monitor buttons as Screens, for the check. Up to four. Each country is loaded once and a picture is taken at each screen size.',
    notes: 'Countries times screens can be at most 24 pictures. The site is told it is a phone only when every screen chosen is a phone; otherwise it sees a desktop browser made narrower.' },
  { id: 'country-start', label: 'Check these countries', group: 'Countries',
    does: 'Starts the check. A line above it estimates how many pictures, how much will be downloaded and roughly what it costs in Australian dollars. The check runs on the server with a progress bar and a Stop button; you can leave the page, and it shows under Needs attention when it is ready. Video and sound are skipped unless the tick box is ticked.',
    notes: 'The connections are paid for by the amount downloaded. One check runs at a time for the whole workspace, and each person can start up to 6 an hour.' },
  { id: 'country-results', label: 'Pictures by country', group: 'Countries',
    does: 'A grid with a row per country and a column per screen. Each picture says Verified when the connection really came from that country, Unverified: exited from XX when it came from somewhere else, or that the site showed a refusal or robot check. Click a picture to see it full size, and pick a second one to show beside it; the two scroll together.',
    notes: 'Pictures stop at 8,000 pixels tall. An Unverified picture is still shown, but it may not be what visitors in that country see.' },
  { id: 'country-differences', label: 'What differs', group: 'Countries',
    does: 'A plain list above the pictures of what differs between the countries: redirects, language, page title, currency, prices, a cookie notice, and headings or buttons shown in some countries only. Compare with an earlier check of this page lists what changed since then, country by country.',
    notes: 'Worked out by plain rules, not AI. Headings and buttons are only compared between countries that got the page in the same language. Sites that change their offers on every visit show changes even minutes apart.' },
  { id: 'country-summary', label: 'Summarise with AI', group: 'Countries',
    does: 'An optional button above the list. The AI model reads the differences and looks at the top of one picture per country, then writes a short note on what differs and what looks wrong.',
    notes: 'It uses a little of the AI allowance each time and can be wrong, so check the pictures before acting on it.' },
  { id: 'country-saved', label: 'Saved checks', group: 'Countries',
    does: 'Every check is kept in Saved checks, newest first. Click one to open it again. Delete asks Yes or No, and the check stays in the recycle bin for 30 days (Undo puts it straight back).',
    notes: 'The pictures count toward the attachment space of the person who ran the check.' },
];

const RULES = [
  'Type the address, press Show the page, then choose the screens. Choosing a screen after the page is loaded shows it straight away.',
  'At most four screens are shown at once; remove one to add another.',
  "Every screen is an exact copy of the page at that device's width, so layout rules for small screens switch on just as they do on the real device.",
  'The page is shown without its scripts, and it only looks: nothing is saved and nothing on the page is changed.',
  'Countries checks are saved and run on the server; Screens only looks and saves nothing.',
  'The Open buttons in this chat only switch to a tool (they scroll to its area); they never load a page or change a choice by themselves.',
];

const NOT_POSSIBLE = [
  "Changing the page's styling or fixing how it looks (use the Style editor, which has a device list of its own).",
  'Testing menus that open, sliders, forms or anything that needs the page\'s scripts to run.',
  'Pages that need a login or a password, or pages on a private network.',
  'Real phones and real browsers: sizes are close, not exact, and touch, fonts and browser bars are not reproduced.',
  'Checking how fast the page loads (use Page speed).',
  'Saving a Screens view or sharing one with someone (Countries checks are saved, but not shared).',
  'Countries: pages behind a login, choosing a city or internet provider within a country, or checking on a schedule by itself.',
];

const SYSTEM = `You are the guide to Device preview in Vault for one person who wants to see how a public web page looks on phones, tablets and monitors of different sizes, or (in its Countries view) from other countries. They say, in everyday words, what they want to check. You point them to the right controls, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say Device preview cannot do.
- You cannot see any address they typed or any page. Never state or guess how a particular page will look.
- Be plain and short, as to a friend who is not technical. Explain any web word (pixel, breakpoint) in a few everyday words the first time you use it.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- If they want to change how the page looks, say Device preview only looks and send them to the Style editor.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Device preview guide', feature: 'device_preview_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'DEVICE PREVIEW TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to check about the page, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askDevicePreviewTutor: guide.ask,
};
